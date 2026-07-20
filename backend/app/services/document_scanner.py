import hashlib
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Iterable, Optional


DOCUMENT_SCANNER_VERSION = "document-scanner-v1"
MAX_SCAN_ROWS = 80
_SPACE_RE = re.compile(r"\s+")
_NON_WORD_RE = re.compile(r"[^A-Z0-9]+")
_NUMBER_RE = re.compile(
    r"(?<![A-Z0-9])(?:\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![A-Z])",
    re.IGNORECASE,
)
_DATE_RE = re.compile(r"\b([0-3]?\d)[/.\-]([01]?\d)[/.\-](\d{2,4})\b")
_NON_ITEM_WORDS = {
    "BANCA",
    "CODICE FISCALE",
    "DESTINATARIO",
    "IBAN",
    "IMPONIBILE",
    "IVA",
    "PAGAMENTO",
    "PARTITA IVA",
    "SCADENZA",
    "SCONTO",
    "TOTALE",
    "TRASPORTO",
}


def normalize_scanner_text(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", str(value or "")).encode(
        "ascii", "ignore"
    ).decode("ascii")
    return _SPACE_RE.sub(
        " ",
        _NON_WORD_RE.sub(" ", ascii_value.upper()),
    ).strip()


def parse_document_decimal(value: str) -> Optional[float]:
    raw = str(value or "").strip().replace("EUR", "").replace("€", "")
    raw = raw.replace(" ", "")
    if not raw:
        return None
    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif raw.count(".") > 1:
        raw = raw.replace(".", "")
    elif "." in raw:
        decimals = raw.rsplit(".", 1)[-1]
        if len(decimals) == 3:
            raw = raw.replace(".", "")
    try:
        return round(float(raw), 4)
    except (TypeError, ValueError):
        return None


def _line_numbers(line: str) -> list[float]:
    values = []
    for match in _NUMBER_RE.finditer(line):
        parsed = parse_document_decimal(match.group(0))
        if parsed is not None:
            values.append(parsed)
    return values


def _description_fragment(line: str) -> str:
    without_numbers = _NUMBER_RE.sub(" ", line)
    without_units = re.sub(
        r"\b(?:EUR|EURO|PZ|PZZ|PEZZI|KG|GR|G|LT|L|NR|N)\b",
        " ",
        without_numbers,
        flags=re.IGNORECASE,
    )
    return _SPACE_RE.sub(" ", without_units).strip(" -:;,.")


def _sequence_score(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    overlap = (
        len(left_tokens & right_tokens) / max(1, len(right_tokens))
    )
    ratio = SequenceMatcher(None, left, right).ratio()
    return max(ratio * 0.75 + overlap * 0.25, overlap * 0.9)


def _confidence_percent(score: float) -> int:
    return max(0, min(100, int(round(score * 100))))


def _catalog_name(item: dict) -> str:
    return str(item.get("name") or "").strip()


def _supplier_candidates(
    lines: list[str],
    suppliers: list[dict],
    aliases: list[dict],
) -> list[dict]:
    normalized_lines = [
        (line, normalize_scanner_text(line))
        for line in lines[:40]
        if normalize_scanner_text(line)
    ]
    alias_by_target = {}
    for alias in aliases:
        if alias.get("kind") != "supplier":
            continue
        target_id = alias.get("target_id")
        source = alias.get("source_normalized")
        if target_id and source:
            alias_by_target.setdefault(target_id, []).append(source)

    candidates = []
    for supplier in suppliers:
        supplier_id = supplier.get("id")
        supplier_name = _catalog_name(supplier)
        normalized_name = normalize_scanner_text(supplier_name)
        best_score = 0.0
        best_line = ""
        for raw_line, normalized_line in normalized_lines:
            if normalized_name and normalized_name in normalized_line:
                score = 0.98
            else:
                score = _sequence_score(normalized_line, normalized_name)
            for alias in alias_by_target.get(supplier_id, []):
                if alias in normalized_line:
                    score = max(score, 0.995)
                else:
                    score = max(score, _sequence_score(normalized_line, alias) * 0.98)
            if score > best_score:
                best_score = score
                best_line = raw_line
        if best_score >= 0.42:
            candidates.append({
                "id": supplier_id,
                "name": supplier_name,
                "confidence": _confidence_percent(best_score),
                "source_text": best_line[:500],
            })
    return sorted(
        candidates,
        key=lambda item: (-item["confidence"], item["name"].lower()),
    )[:5]


def _product_candidates(
    line: str,
    products: list[dict],
    aliases: list[dict],
    supplier_name: str,
) -> list[dict]:
    normalized_line = normalize_scanner_text(line)
    description = normalize_scanner_text(_description_fragment(line))
    normalized_supplier = normalize_scanner_text(supplier_name)
    alias_by_target = {}
    for alias in aliases:
        if alias.get("kind") != "product":
            continue
        target_id = alias.get("target_id")
        source = alias.get("source_normalized")
        alias_supplier = normalize_scanner_text(alias.get("supplier_name") or "")
        if (
            target_id
            and source
            and (not normalized_supplier or not alias_supplier or alias_supplier == normalized_supplier)
        ):
            alias_by_target.setdefault(target_id, []).append(source)

    candidates = []
    for product in products:
        product_name = _catalog_name(product)
        normalized_name = normalize_scanner_text(product_name)
        if not normalized_name:
            continue
        product_supplier = normalize_scanner_text(product.get("supplier") or "")
        supplier_bonus = (
            0.04
            if normalized_supplier
            and product_supplier
            and normalized_supplier == product_supplier
            else 0
        )
        if normalized_name in normalized_line:
            score = 0.96
        else:
            score = _sequence_score(description, normalized_name)
        for alias in alias_by_target.get(product.get("id"), []):
            if alias in normalized_line:
                score = max(score, 0.99)
            else:
                score = max(score, _sequence_score(description, alias) * 0.98)
        score = min(1.0, score + supplier_bonus)
        if score >= 0.42:
            candidates.append({
                "id": product.get("id"),
                "name": product_name,
                "supplier": product.get("supplier") or "",
                "unit": product.get("unit") or "",
                "confidence": _confidence_percent(score),
            })
    return sorted(
        candidates,
        key=lambda item: (-item["confidence"], item["name"].lower()),
    )[:5]


def _parse_document_date(text: str) -> str:
    for match in _DATE_RE.finditer(text):
        day, month, year = (int(part) for part in match.groups())
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day).date().isoformat()
        except ValueError:
            continue
    return ""


def _document_number(lines: list[str]) -> tuple[str, str]:
    patterns = [
        re.compile(
            r"\b(?:DDT|D\.?D\.?T\.?|FATTURA|DOCUMENTO|DOC)\s*(?:N(?:R|UMERO)?\.?|NO\.?|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./\-]{1,30})",
            re.IGNORECASE,
        ),
        re.compile(
            r"\bN(?:R|UMERO)?\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./\-]{1,30})",
            re.IGNORECASE,
        ),
    ]
    for line in lines[:30]:
        for pattern in patterns:
            match = pattern.search(line)
            if match:
                return match.group(1).strip(" .-/"), line[:500]
    return "", ""


def _document_total(lines: list[str]) -> tuple[Optional[float], str]:
    for line in reversed(lines):
        normalized = normalize_scanner_text(line)
        if "TOTALE" not in normalized:
            continue
        if any(word in normalized for word in ("IMPONIBILE", "IVA", "SCONTO")):
            continue
        values = _line_numbers(line)
        if values:
            return values[-1], line[:500]
    return None, ""


def _document_type(text: str) -> str:
    normalized = normalize_scanner_text(text)
    if "NOTA DI CREDITO" in normalized:
        return "credit_note"
    if "FATTURA" in normalized:
        return "invoice"
    return "ddt"


def _looks_like_item_line(line: str, matched: bool) -> bool:
    normalized = normalize_scanner_text(line)
    if len(normalized) < 3 or _DATE_RE.search(line):
        return False
    if any(word in normalized for word in _NON_ITEM_WORDS):
        return False
    letters = sum(char.isalpha() for char in line)
    numbers = _line_numbers(line)
    return matched or (letters >= 4 and len(numbers) >= 2)


def _row_values(line: str) -> tuple[Optional[float], Optional[float], Optional[float]]:
    values = _line_numbers(line)
    if len(values) >= 3:
        quantity, unit_price, line_total = values[-3:]
        return quantity, unit_price, line_total
    if len(values) == 2:
        return values[0], values[1], None
    if len(values) == 1:
        normalized = normalize_scanner_text(line)
        if re.search(r"\b(?:PZ|PZZ|PEZZI|KG|GR|G|LT|L)\b", normalized):
            return values[0], None, None
        return None, None, values[0]
    return None, None, None


def build_document_scan_draft(
    ocr_text: str,
    *,
    suppliers: Iterable[dict],
    products: Iterable[dict],
    aliases: Iterable[dict],
    ocr_confidence: Optional[float] = None,
    file_name: str = "",
    file_fingerprint: str = "",
) -> dict:
    clean_text = str(ocr_text or "").replace("\x00", "").strip()
    lines = [
        _SPACE_RE.sub(" ", line).strip()
        for line in clean_text.splitlines()
        if _SPACE_RE.sub(" ", line).strip()
    ]
    supplier_list = list(suppliers)
    product_list = list(products)
    alias_list = list(aliases)
    supplier_candidates = _supplier_candidates(lines, supplier_list, alias_list)
    selected_supplier = (
        supplier_candidates[0]
        if supplier_candidates and supplier_candidates[0]["confidence"] >= 58
        else None
    )
    supplier_name = selected_supplier["name"] if selected_supplier else ""

    rows = []
    seen_lines = set()
    for line in lines:
        normalized_line = normalize_scanner_text(line)
        if normalized_line in seen_lines:
            continue
        product_candidates = _product_candidates(
            line,
            product_list,
            alias_list,
            supplier_name,
        )
        selected_product = (
            product_candidates[0]
            if product_candidates and product_candidates[0]["confidence"] >= 58
            else None
        )
        if not _looks_like_item_line(line, selected_product is not None):
            continue
        quantity, unit_price, line_total = _row_values(line)
        rows.append({
            "source_text": line[:500],
            "source_description": _description_fragment(line)[:300],
            "product_id": selected_product["id"] if selected_product else None,
            "product_name": selected_product["name"] if selected_product else "",
            "product_confidence": (
                selected_product["confidence"] if selected_product else 0
            ),
            "product_candidates": product_candidates,
            "quantity": quantity,
            "unit_price": unit_price,
            "line_total": line_total,
        })
        seen_lines.add(normalized_line)
        if len(rows) >= MAX_SCAN_ROWS:
            break

    document_number, number_source = _document_number(lines)
    document_total, total_source = _document_total(lines)
    text_sha256 = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
    return {
        "scan_id": str(uuid.uuid4()),
        "scanner_version": DOCUMENT_SCANNER_VERSION,
        "ocr_text_sha256": text_sha256,
        "file_name": file_name,
        "file_fingerprint": file_fingerprint,
        "ocr_confidence": ocr_confidence,
        "document": {
            "type": _document_type(clean_text),
            "supplier_id": selected_supplier["id"] if selected_supplier else None,
            "supplier_name": selected_supplier["name"] if selected_supplier else "",
            "supplier_confidence": (
                selected_supplier["confidence"] if selected_supplier else 0
            ),
            "supplier_source_text": (
                selected_supplier["source_text"] if selected_supplier else ""
            ),
            "supplier_candidates": supplier_candidates,
            "number": document_number,
            "number_source_text": number_source,
            "date": _parse_document_date(clean_text),
            "total": document_total,
            "total_source_text": total_source,
        },
        "rows": rows,
        "warnings": _draft_warnings(
            selected_supplier=selected_supplier,
            rows=rows,
            document_total=document_total,
        ),
    }


def _draft_warnings(
    *,
    selected_supplier: Optional[dict],
    rows: list[dict],
    document_total: Optional[float],
) -> list[str]:
    warnings = []
    if not selected_supplier:
        warnings.append("Fornitore non riconosciuto")
    if not rows:
        warnings.append("Nessuna riga prodotto riconosciuta")
    elif any(not row.get("product_id") for row in rows):
        warnings.append("Alcune righe non sono associate a un prodotto")
    if any(row.get("unit_price") is None for row in rows):
        warnings.append("Alcuni prezzi unitari non sono leggibili")
    if document_total is None:
        warnings.append("Totale documento non riconosciuto")
    return warnings


async def load_document_scanner_catalog(database) -> dict:
    suppliers = await database.suppliers.find(
        {},
        {"_id": 0, "id": 1, "name": 1},
    ).sort("name", 1).to_list(500)
    products = await database.products.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "supplier": 1, "unit": 1},
    ).sort("name", 1).to_list(3000)
    aliases = await database.lab_document_aliases.find(
        {},
        {
            "_id": 0,
            "kind": 1,
            "source_normalized": 1,
            "target_id": 1,
            "supplier_name": 1,
        },
    ).to_list(10000)
    return {
        "suppliers": suppliers,
        "products": products,
        "aliases": aliases,
    }


async def save_document_scan_feedback(database, feedback, token_data: dict) -> dict:
    existing = await database.lab_document_scan_feedback.find_one(
        {"scan_id": feedback.scan_id},
        {"_id": 0, "id": 1, "learning_applied": 1},
    )
    if existing and existing.get("learning_applied"):
        return {"saved": True, "already_recorded": True, "id": existing["id"]}

    supplier = None
    if feedback.supplier_id:
        supplier = await database.suppliers.find_one(
            {"id": feedback.supplier_id},
            {"_id": 0, "id": 1, "name": 1},
        )
        if not supplier:
            raise ValueError("Fornitore selezionato non trovato")

    product_ids = {
        row.product_id for row in feedback.rows if row.product_id
    }
    products = []
    if product_ids:
        products = await database.products.find(
            {"id": {"$in": list(product_ids)}},
            {"_id": 0, "id": 1, "name": 1, "supplier": 1, "unit": 1},
        ).to_list(len(product_ids))
    products_by_id = {item["id"]: item for item in products}
    if set(products_by_id) != product_ids:
        raise ValueError("Uno o più prodotti selezionati non esistono")

    now = datetime.now(timezone.utc)
    feedback_id = existing["id"] if existing else str(uuid.uuid4())
    clean_rows = []
    for row in feedback.rows:
        product = products_by_id.get(row.product_id)
        clean_rows.append({
            "source_text": row.source_text,
            "source_description": row.source_description,
            "product_id": product.get("id") if product else None,
            "product_name": product.get("name") if product else "",
            "product_supplier": product.get("supplier") if product else "",
            "quantity": row.quantity,
            "unit_price": row.unit_price,
            "line_total": row.line_total,
        })

    document = {
        "id": feedback_id,
        "scan_id": feedback.scan_id,
        "scanner_version": DOCUMENT_SCANNER_VERSION,
        "ocr_text_sha256": feedback.ocr_text_sha256,
        "file_fingerprint": feedback.file_fingerprint,
        "ocr_confidence": feedback.ocr_confidence,
        "document_type": feedback.document_type,
        "supplier_id": supplier.get("id") if supplier else None,
        "supplier_name": supplier.get("name") if supplier else "",
        "document_number": feedback.document_number,
        "document_date": feedback.document_date,
        "document_total": feedback.document_total,
        "rows": clean_rows,
        "created_at": now,
        "created_by_id": token_data.get("restaurant_id"),
        "created_by_username": token_data.get("username"),
        "learning_applied": False,
    }
    if not existing:
        await database.lab_document_scan_feedback.insert_one(document)
    else:
        await database.lab_document_scan_feedback.update_one(
            {"scan_id": feedback.scan_id},
            {
                "$set": {
                    key: value
                    for key, value in document.items()
                    if key not in {"id", "scan_id", "created_at"}
                }
            },
        )

    if supplier and feedback.supplier_source_text:
        await _reinforce_alias(
            database,
            kind="supplier",
            source_text=feedback.supplier_source_text,
            target=supplier,
            supplier_name="",
            unit_price=None,
            now=now,
            scan_id=feedback.scan_id,
        )
    for row in clean_rows:
        product = products_by_id.get(row.get("product_id"))
        if not product or not row.get("source_description"):
            continue
        await _reinforce_alias(
            database,
            kind="product",
            source_text=row["source_description"],
            target=product,
            supplier_name=product.get("supplier") or (
                supplier.get("name") if supplier else ""
            ),
            unit_price=row.get("unit_price"),
            now=now,
            scan_id=feedback.scan_id,
        )
    await database.lab_document_scan_feedback.update_one(
        {"scan_id": feedback.scan_id},
        {"$set": {"learning_applied": True}},
    )

    return {
        "saved": True,
        "already_recorded": bool(existing),
        "id": feedback_id,
        "learned_supplier": bool(supplier and feedback.supplier_source_text),
        "learned_products": sum(
            1 for row in clean_rows
            if row.get("product_id") and row.get("source_description")
        ),
    }


async def _reinforce_alias(
    database,
    *,
    kind: str,
    source_text: str,
    target: dict,
    supplier_name: str,
    unit_price: Optional[float],
    now: datetime,
    scan_id: str,
) -> None:
    normalized = normalize_scanner_text(source_text)
    if len(normalized) < 3:
        return
    set_fields = {
        "source_text_example": source_text[:300],
        "target_id": target.get("id"),
        "target_name": target.get("name"),
        "supplier_name": supplier_name,
        "last_confirmed_at": now,
    }
    if unit_price is not None:
        set_fields["last_observed_unit_price"] = round(float(unit_price), 4)
    await database.lab_document_aliases.update_one(
        {
            "kind": kind,
            "source_normalized": normalized,
            "supplier_name": supplier_name,
        },
        {
            "$set": set_fields,
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "kind": kind,
                "source_normalized": normalized,
                "created_at": now,
            },
            "$addToSet": {"confirmed_scan_ids": scan_id},
        },
        upsert=True,
    )
