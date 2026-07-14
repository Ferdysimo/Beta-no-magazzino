import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel

from app.core.catalogs import BEVERAGES_CATALOG
from app.core.database import db
from app.core.time import ROME_TZ, _today_rome_str


logger = logging.getLogger(__name__)

SPICCI_MULTIPLIERS = {"sp5": 50, "sp2": 50, "sp1": 25, "sp05": 20}
PASTA_PRICES_MAP = {
    "CARB": 8,
    "AMAT": 8,
    "CACIO": 8,
    "PESTO": 8,
    "TART": 8,
    "RAGU": 8,
    "POM": 7,
    "CARZUC": 8,
}
CASH_FIELDS = ["mattina", "altro", "glo", "just", "delv", "bp", "sat", "ft", "pos", "vers", "arr"]
SPICCI_FIELDS = ["sp5", "sp2", "sp1", "sp05"]
CASSETTO_FIELDS = ["cd5", "cd2", "cd1", "cd05"]
CASSETTO_SPICCI_FIELD = {"cd5": "sp5", "cd2": "sp2", "cd1": "sp1", "cd05": "sp05"}
ALL_CASH_FIELDS = CASH_FIELDS + SPICCI_FIELDS + CASSETTO_FIELDS


def _resolve_historical_mode(
    date_param: Optional[str], rid_param: Optional[str], token_data: dict,
    allow_self: bool = False,
) -> Optional[tuple]:
    """Se l'utente è admin/supervisor E vengono passati sia `date` che `restaurant_id`,
    ritorna `(date_str, rid)` per operare in MODALITÀ STORICA. Altrimenti `None`
    (caller userà today + effective rid). Solleva 400 su date malformata.

    `allow_self=True` consente anche agli utenti normali di accedere in modalità
    storica SOLO per il proprio locale (usato dai GET di sola lettura, mai dai PUT).
    """
    if not date_param and not rid_param:
        return None
    if not date_param or not rid_param:
        # Entrambi devono essere presenti per attivare la modalità storica
        return None
    is_admin = token_data.get("role") in ("admin",)
    if not is_admin:
        if not allow_self:
            raise HTTPException(status_code=403, detail="Modalità storica scrittura riservata ad Admin")
        own_rid = token_data.get("restaurant_id")
        if rid_param != own_rid:
            raise HTTPException(status_code=403, detail="Modalità storica consentita solo per il proprio locale")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_param):
        raise HTTPException(status_code=400, detail="Data non valida (formato YYYY-MM-DD)")
    today = _today_rome_str()
    if date_param > today:
        raise HTTPException(status_code=400, detail="Data non può essere nel futuro")
    return (date_param, rid_param)


def _payload_fields(model: BaseModel) -> set:
    """Return fields explicitly sent by the client, compatible with Pydantic v1/v2."""
    fields = getattr(model, "model_fields_set", None)
    if fields is None:
        fields = getattr(model, "__fields_set__", set())
    return set(fields or set())


def _eval_cash_value(v) -> float:
    """Valuta un'espressione aritmetica come fa il frontend (evaluateValue):
    - "=" iniziale è OPZIONALE → anche "10+5" viene calcolato come 15.
    - Strippa eventuali tag HTML (campo VERS rich-text con span colorati).
    - Whitelist di caratteri: solo cifre, operatori, parentesi, spazi.
    Importante: questa funzione deve restare allineata bit-per-bit con la
    `evaluateValue` del frontend, altrimenti i numeri nelle viste aggregate
    (Storico chiusure / Excel grid / cash_sera) divergono da quelli mostrati
    nella pagina Report.
    """
    if v is None:
        return 0.0
    s = str(v)
    # Strip HTML tags — il VERS può contenere <span style="color:...">…</span>
    if "<" in s:
        s = re.sub(r"<[^>]*>", "", s)
    s = s.strip().replace(",", ".")
    if not s:
        return 0.0
    if s.startswith("="):
        s = s[1:].strip()
    if not s:
        return 0.0
    if not re.match(r"^[\d+\-*/.() \s]*$", s):
        return 0.0
    try:
        # Safe: il regex sopra ammette solo cifre/operatori/parentesi/spazi.
        return float(eval(s, {"__builtins__": {}}, {}))  # noqa: S307
    except Exception:
        return 0.0


def _compute_cash_sera(row: dict) -> float:
    if not row:
        return 0.0
    plus = _eval_cash_value(row.get("mattina", "")) \
        + _eval_cash_value(row.get("altro", "")) \
        + _eval_cash_value(row.get("arr", ""))
    minus = _eval_cash_value(row.get("glo", "")) \
        + _eval_cash_value(row.get("just", "")) \
        + _eval_cash_value(row.get("delv", "")) \
        + _eval_cash_value(row.get("bp", "")) \
        + _eval_cash_value(row.get("sat", "")) \
        + _eval_cash_value(row.get("ft", "")) \
        + _eval_cash_value(row.get("pos", "")) \
        + _eval_cash_value(row.get("vers", ""))
    return plus - minus


async def _get_pasta_dict_for(restaurant_id: Optional[str]) -> Dict[str, float]:
    """Ritorna il dizionario {sigla: prezzo} effettivo per il ristorante.
    Se la collection `pasta_dictionary` ha un override per quel ristorante,
    usa quello; altrimenti torna il `PASTA_PRICES_MAP` di default."""
    if restaurant_id:
        doc = await db.pasta_dictionary.find_one({"restaurant_id": restaurant_id}, {"_id": 0, "siglas": 1})
        if doc and doc.get("siglas"):
            try:
                return {
                    str(s["sigla"]).upper().strip(): float(s["price"])
                    for s in doc["siglas"]
                    if str(s.get("sigla", "")).strip()
                }
            except Exception as e:
                logger.warning(f"[PASTA_DICT] Override invalid for rid={restaurant_id}: {e}")
    return dict(PASTA_PRICES_MAP)


def _pasta_dict_snapshot_from_map(dict_map: Dict[str, float]) -> List[Dict]:
    return [
        {"sigla": str(sigla).upper().strip(), "price": float(price or 0)}
        for sigla, price in (dict_map or {}).items()
        if str(sigla).strip()
    ]


def _pasta_dict_snapshot_fields(
    dict_map: Dict[str, float],
    *,
    source: str,
    captured_at: str,
) -> Dict[str, object]:
    return {
        "pasta_dict_snapshot": _pasta_dict_snapshot_from_map(dict_map),
        "pasta_dict_snapshot_version": 1,
        "pasta_dict_snapshot_at": captured_at,
        "pasta_dict_snapshot_source": source,
    }


def _should_create_pasta_dict_snapshot(*, historical: bool, existing_snapshot) -> bool:
    return not historical and not _pasta_dict_from_snapshot(existing_snapshot)


def _pasta_dict_from_snapshot(snapshot) -> Optional[Dict[str, float]]:
    if not isinstance(snapshot, list):
        return None
    out: Dict[str, float] = {}
    for item in snapshot:
        if not isinstance(item, dict):
            continue
        sigla = str(item.get("sigla", "")).upper().strip()
        if not sigla:
            continue
        try:
            out[sigla] = float(item.get("price", 0) or 0)
        except Exception:
            continue
    return out or None


def _pasta_recognized_sigla(line: str, dict_map: Dict[str, float]) -> Optional[str]:
    if not line:
        return None
    upper = line.upper()
    # XL esclude la riga (va in manuali)
    if re.search(r"\bXL\b", upper):
        return None
    siglas_sorted = sorted(dict_map.keys(), key=len, reverse=True)
    for sigla in siglas_sorted:
        # ^\s*(?:\d+\s+)?SIGLA(?:\b|$)
        pattern = rf"^\s*(?:\d+\s+)?{re.escape(sigla)}(?:\b|$)"
        if re.search(pattern, upper):
            return sigla
    return None


def _compute_spicci_total(row: dict) -> float:
    return sum(_eval_cash_value(row.get(k, "")) * v for k, v in SPICCI_MULTIPLIERS.items())


def _compute_cassetto_total(row: dict) -> float:
    return (
        _eval_cash_value(row.get("cd5", "")) * 5
        + _eval_cash_value(row.get("cd2", "")) * 2
        + _eval_cash_value(row.get("cd1", ""))
        + _eval_cash_value(row.get("cd05", "")) * 0.5
    )


def _manual_price_key_for_line(line: str) -> str:
    return re.sub(r"\s+", " ", str(line or "").strip().upper())[:200]


def _manual_price_for_paste_line(manual_prices: dict, idx: int, line: str):
    mp = manual_prices or {}
    text_key = _manual_price_key_for_line(line)
    return mp.get(text_key, mp.get(str(idx), mp.get(idx, "")))


def _manual_price_for_paste_line_legacy_index_only(manual_prices: dict, idx: int):
    mp = manual_prices or {}
    return mp.get(str(idx), mp.get(idx, ""))


def _compute_paste_total_eur(
    paste_text: str,
    manual_prices: Optional[dict] = None,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    """Somma € paste: riconosciute (prezzo da dict_map) + non riconosciute con
    prezzo manuale assegnato. Mirror del frontend `pasteAnalysis.totalEuro`."""
    if not paste_text:
        return 0.0
    if dict_map is None:
        dict_map = PASTA_PRICES_MAP
    lines = [l.strip() for l in paste_text.split("\n")]
    lines = [l for l in lines if l]
    total = 0.0
    mp = manual_prices or {}
    for idx, line in enumerate(lines):
        recognized_sigla = _pasta_recognized_sigla(line, dict_map)
        if recognized_sigla is not None:
            total += dict_map[recognized_sigla]
        else:
            raw = _manual_price_for_paste_line(mp, idx, line)
            try:
                n = float(str(raw).replace(",", ".").strip()) if str(raw).strip() else 0.0
                if n > 0:
                    total += n
            except Exception:
                pass
    return total


def _compute_paste_total_eur_legacy_index_only(
    paste_text: str,
    manual_prices: Optional[dict] = None,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    if not paste_text:
        return 0.0
    if dict_map is None:
        dict_map = PASTA_PRICES_MAP
    lines = [l.strip() for l in paste_text.split("\n")]
    lines = [l for l in lines if l]
    total = 0.0
    mp = manual_prices or {}
    for idx, line in enumerate(lines):
        recognized_sigla = _pasta_recognized_sigla(line, dict_map)
        if recognized_sigla is not None:
            total += dict_map[recognized_sigla]
        else:
            raw = _manual_price_for_paste_line_legacy_index_only(mp, idx)
            try:
                n = float(str(raw).replace(",", ".").strip()) if str(raw).strip() else 0.0
                if n > 0:
                    total += n
            except Exception:
                pass
    return total


def _compute_bev_total_eur(bev_docs: list) -> float:
    """Somma incassi bevande. Le qty negative rettificano il totale."""
    prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    total = 0.0
    for r in bev_docs:
        m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
        s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
        qty = (0 if e == 0 else (m + u - e)) - s
        total += qty * prices.get(r["sigla"], 0)
    return total


def _compute_paste_count(paste_text: str) -> int:
    """Conta TUTTE le righe non vuote del paste_text (riconosciute + non riconosciute).
    Mirror del frontend: `totalCount = recognized + unrecognized`."""
    if not paste_text:
        return 0
    return sum(1 for line in paste_text.split("\n") if line.strip())


def _compute_paste_unrecognized(
    paste_text: str,
    manual_prices: dict,
    dict_map: Optional[Dict[str, float]] = None,
) -> List[Dict]:
    """Estrae le righe non riconosciute (sigla pasta non valida per la regola di posizionamento).
    L'indice usato per il match con manual_prices è quello della riga dopo split + trim+filter,
    coerente col frontend ReportBetaPage `pasteAnalysis`."""
    if not paste_text:
        return []
    if dict_map is None:
        dict_map = PASTA_PRICES_MAP
    lines = [l.strip() for l in paste_text.split("\n")]
    lines = [l for l in lines if l]
    out: List[Dict] = []
    mp = manual_prices or {}
    for idx, line in enumerate(lines):
        if _pasta_recognized_sigla(line, dict_map) is not None:
            continue
        raw_price = _manual_price_for_paste_line(mp, idx, line)
        try:
            price = float(str(raw_price).replace(",", ".").strip()) if str(raw_price).strip() else 0.0
            if price < 0:
                price = 0.0
        except Exception:
            price = 0.0
        out.append({"idx": idx, "text": line, "manual_price": price})
    return out


def _compute_cash_sera_full(
    cash_row: dict,
    bev_docs: list,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    """Cash sera completo: include paste (riconosciute + manuali), bevande e spicci."""
    base = _compute_cash_sera(cash_row)
    return base + _compute_spicci_total(cash_row) \
                + _compute_paste_total_eur(
                    cash_row.get("paste_text", "") or "",
                    cash_row.get("manual_prices") or {},
                    dict_map,
                ) \
                + _compute_bev_total_eur(bev_docs)


def _compute_cash_sera_full_legacy_manual_prices(
    cash_row: dict,
    bev_docs: list,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    base = _compute_cash_sera(cash_row)
    return base + _compute_spicci_total(cash_row) \
                + _compute_paste_total_eur_legacy_index_only(
                    cash_row.get("paste_text", "") or "",
                    cash_row.get("manual_prices") or {},
                    dict_map,
                ) \
                + _compute_bev_total_eur(bev_docs)


def _format_report_number(value) -> str:
    try:
        n = float(value)
    except Exception:
        return ""
    if abs(n - round(n)) < 0.000001:
        return str(int(round(n)))
    return f"{round(n, 2):.2f}".rstrip("0").rstrip(".")


def _split_beverage_stock(value) -> tuple[str, str]:
    total = _eval_cash_value(value)
    if total <= 0 or abs(total - round(total)) > 0.000001:
        return "", ""
    units = int(round(total))
    return str(units // 24) if units // 24 else "", str(units % 24) if units % 24 else ""


def _report_numbers_equal(a, b) -> bool:
    return abs(_eval_cash_value(a) - _eval_cash_value(b)) < 0.000001


async def _cash_mattina_carry_fields(
    *, rid: str, target_date: str, today_cash: dict, last_cash: dict,
    prev_bev_docs: list, dict_map: Optional[Dict[str, float]] = None,
) -> Dict[str, object]:
    if not last_cash:
        return {}
    prev_date = last_cash.get("date_rome", "")
    current_value = today_cash.get("mattina", "")
    carry_value = _format_report_number(round(_compute_cash_sera_full(last_cash, prev_bev_docs, dict_map), 2))
    legacy_value = _format_report_number(round(_compute_cash_sera_full_legacy_manual_prices(last_cash, prev_bev_docs, dict_map), 2))

    should_write = not str(current_value or "").strip()
    auto_marker = today_cash.get("mattina_auto_carry")
    if not should_write and auto_marker is True:
        carry_from = today_cash.get("mattina_carry_from_date") or ""
        if carry_from in ("", prev_date):
            should_write = (
                carry_from != prev_date
                or not _report_numbers_equal(current_value, carry_value)
                or str(today_cash.get("mattina_carry_value") or "") != carry_value
            )
    if not should_write and auto_marker is None:
        if legacy_value and not _report_numbers_equal(legacy_value, carry_value) and _report_numbers_equal(current_value, legacy_value):
            manual_audit = await db.cash_audit_log.find_one(
                {
                    "restaurant_id": rid,
                    "date_rome": target_date,
                    "category": "cash",
                    "field": "mattina",
                },
                {"_id": 1},
            )
            should_write = manual_audit is None

    if not should_write:
        return {}
    return {
        "mattina": carry_value,
        "mattina_auto_carry": True,
        "mattina_carry_from_date": prev_date,
        "mattina_carry_value": carry_value,
    }


async def _cash_cassetto_carry_fields(
    *, rid: str, target_date: str, today_cash: dict, last_cash: dict,
) -> Dict[str, object]:
    if not last_cash:
        return {}
    prev_date = last_cash.get("date_rome", "")
    carry_fields: Dict[str, object] = {}
    for cf in CASSETTO_FIELDS:
        sp_field = CASSETTO_SPICCI_FIELD[cf]
        prev_cd = str(last_cash.get(cf) or "").strip()
        prev_sp = str(last_cash.get(sp_field) or "").strip()
        if not prev_cd and not prev_sp:
            continue
        carry_value = _format_report_number(_eval_cash_value(prev_cd) - _eval_cash_value(prev_sp))
        current_value = today_cash.get(cf, "")
        auto_key = f"{cf}_auto_carry"
        from_key = f"{cf}_carry_from_date"
        value_key = f"{cf}_carry_value"
        auto_marker = today_cash.get(auto_key)

        should_write = not str(current_value or "").strip()
        if not should_write and auto_marker is True:
            carry_from = today_cash.get(from_key) or ""
            if carry_from in ("", prev_date):
                should_write = (
                    carry_from != prev_date
                    or not _report_numbers_equal(current_value, carry_value)
                    or str(today_cash.get(value_key) or "") != carry_value
                )
        if not should_write and auto_marker is None:
            manual_audit = await db.cash_audit_log.find_one(
                {
                    "restaurant_id": rid,
                    "date_rome": target_date,
                    "category": "cash",
                    "field": cf,
                },
                {"_id": 1},
            )
            should_write = manual_audit is None

        if should_write:
            carry_fields[cf] = carry_value
            carry_fields[auto_key] = True
            carry_fields[from_key] = prev_date
            carry_fields[value_key] = carry_value
    return carry_fields


async def _beverage_mattina_carry_fields(
    *, rid: str, target_date: str, sigla: str, today_row: dict, prev_row: dict,
) -> Dict[str, object]:
    if not prev_row:
        return {}
    prev_date = prev_row.get("date_rome", "")
    sera_value = prev_row.get("sera", "")
    if not str(sera_value or "").strip():
        return {}
    carry_value = str(sera_value)
    carry_casse, carry_sfuse = _split_beverage_stock(carry_value)
    current_value = today_row.get("mattina", "")
    auto_marker = today_row.get("mattina_auto_carry")

    should_write = not str(current_value or "").strip()
    if not should_write and auto_marker is True:
        carry_from = today_row.get("mattina_carry_from_date") or ""
        if carry_from in ("", prev_date):
            should_write = (
                carry_from != prev_date
                or not _report_numbers_equal(current_value, carry_value)
                or str(today_row.get("mattina_carry_value") or "") != carry_value
                or str(today_row.get("mattina_casse") or "") != carry_casse
                or str(today_row.get("mattina_sfuse") or "") != carry_sfuse
            )
    if not should_write and auto_marker is None:
        manual_audit = await db.cash_audit_log.find_one(
            {
                "restaurant_id": rid,
                "date_rome": target_date,
                "category": "beverage",
                "field": f"{sigla}.mattina",
            },
            {"_id": 1},
        )
        should_write = manual_audit is None

    if not should_write:
        return {}
    return {
        "mattina": carry_value,
        "mattina_casse": carry_casse,
        "mattina_sfuse": carry_sfuse,
        "mattina_auto_carry": True,
        "mattina_carry_from_date": prev_date,
        "mattina_carry_value": carry_value,
    }


async def _materialize_report_day_opening_for_restaurant(rid: str, target_date: str) -> Dict[str, int]:
    """Persist report carry-over rows for a restaurant/day without overwriting filled fields."""
    summary = {"cash_fields": 0, "beverage_rows": 0}
    now_iso = datetime.now(timezone.utc).isoformat()

    last_bev_day = await db.beverage_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0, "date_rome": 1},
    )
    if last_bev_day:
        prev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": last_bev_day["date_rome"]},
            {"_id": 0, "date_rome": 1, "sigla": 1, "sera": 1},
        ).to_list(100)
        valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
        for prev in prev_docs:
            sigla = prev.get("sigla")
            if sigla not in valid_siglas:
                continue
            today = await db.beverage_daily_counts.find_one(
                {"restaurant_id": rid, "date_rome": target_date, "sigla": sigla},
                {"_id": 0},
            ) or {}
            carry_fields = await _beverage_mattina_carry_fields(
                rid=rid,
                target_date=target_date,
                sigla=sigla,
                today_row=today,
                prev_row=prev,
            )
            if not carry_fields:
                continue
            await db.beverage_daily_counts.update_one(
                {"restaurant_id": rid, "date_rome": target_date, "sigla": sigla},
                {"$set": {
                    **carry_fields,
                    "restaurant_id": rid,
                    "date_rome": target_date,
                    "sigla": sigla,
                    "updated_at": now_iso,
                }, "$setOnInsert": {
                    "inUsc": "",
                    "scarti": "",
                    "sera": "",
                    "inUsc_casse": "",
                    "sera_casse": "",
                    "sera_sfuse": "",
                    "comments": {},
                }},
                upsert=True,
            )
            summary["beverage_rows"] += 1

    today_cash = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ) or {}
    last_cash = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0},
    )
    if last_cash:
        prev_bev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": last_cash["date_rome"]},
            {"_id": 0},
        ).to_list(100)
        dmap = await _get_pasta_dict_for(rid)
        carry_fields = {}
        carry_fields.update(await _cash_mattina_carry_fields(
            rid=rid,
            target_date=target_date,
            today_cash=today_cash,
            last_cash=last_cash,
            prev_bev_docs=prev_bev_docs,
            dict_map=dmap,
        ))
        carry_fields.update(await _cash_cassetto_carry_fields(
            rid=rid,
            target_date=target_date,
            today_cash=today_cash,
            last_cash=last_cash,
        ))
        if carry_fields:
            await db.cash_daily_counts.update_one(
                {"restaurant_id": rid, "date_rome": target_date},
                {"$set": {
                    **carry_fields,
                    "restaurant_id": rid,
                    "date_rome": target_date,
                    "updated_at": now_iso,
                }},
                upsert=True,
            )
            summary["cash_fields"] = len(carry_fields)

    return summary


def _audit_user_info(request: Request, token_data: dict) -> dict:
    """Restituisce metadati utente per audit-log."""
    role = token_data.get("role")
    is_admin = role == "admin"
    impersonated = bool(request.headers.get("X-Restaurant-Id") or request.headers.get("x-restaurant-id")) if is_admin else False
    username = token_data.get("username") or token_data.get("restaurant_name") or "unknown"
    return {
        "by_role": role or "unknown",
        "by_user": "Admin" if is_admin else username,
        "by_user_id": token_data.get("restaurant_id") or "",
        "is_impersonating": impersonated,
    }


def _normalize_audit_user_label(entry: dict, user_map: Dict[str, str]) -> str:
    """Display name for audit UI: real locale username, or Admin for admin edits."""
    raw_user = (entry.get("by_user") or "").strip()
    if entry.get("by_role") == "admin" or entry.get("is_impersonating") or raw_user in ("Admin", "Amministratore", "Simone"):
        return "Admin"
    if raw_user == "Pastasciutta Roma" or not raw_user:
        return user_map.get(entry.get("by_user_id")) or user_map.get(entry.get("restaurant_id")) or raw_user or "?"
    return raw_user


async def _audit_log_change(
    *, category: str, rid: str, date_rome: str, field: str,
    old_value, new_value, user_info: dict,
) -> None:
    """Inserisce una entry di audit-log per ogni cambio reale.
    NO coalescing: ogni salvataggio con un valore diverso crea una riga distinta
    (così le correzioni successive 3 → 2 → 5 sono tutte tracciate separatamente).
    I salvataggi senza modifica (`old == new`) non vengono loggati.
    """
    def _stringify(v) -> str:
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            try:
                import json as _j
                return _j.dumps(v, ensure_ascii=False)[:240]
            except Exception:
                return str(v)[:240]
        return str(v)[:240]
    old_s = _stringify(old_value)
    new_s = _stringify(new_value)
    if old_s == new_s:
        return
    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()),
        "restaurant_id": rid,
        "date_rome": date_rome,
        "category": category,
        "field": field,
        "old_value": old_s,
        "new_value": new_s,
        "by_role": user_info["by_role"],
        "by_user": user_info["by_user"],
        "by_user_id": user_info["by_user_id"],
        "is_impersonating": user_info["is_impersonating"],
        "first_at": now.isoformat(),
        "last_at": now.isoformat(),
        "changes_count": 1,
    }
    await db.cash_audit_log.insert_one(entry)


async def _audit_diff_cash(
    *, rid: str, date_rome: str, old_doc: dict, set_payload: dict, user_info: dict,
) -> None:
    """Diff field-by-field tra il vecchio doc cash e il nuovo set_payload, e logga ogni delta."""
    old_doc = old_doc or {}
    # Campi scalari
    scalar_fields = list(ALL_CASH_FIELDS) + ["vers_color", "paste_text", "paste_manual_override"]
    for k in scalar_fields:
        if k not in set_payload:
            continue
        await _audit_log_change(
            category="cash", rid=rid, date_rome=date_rome, field=k,
            old_value=old_doc.get(k, ""), new_value=set_payload.get(k, ""),
            user_info=user_info,
        )
    # Dict fields: cash_banconote.<k>, manual_prices.<k>, comments.<k>
    for parent in ("cash_banconote", "manual_prices", "comments"):
        if parent not in set_payload:
            continue
        old_d = (old_doc.get(parent) or {})
        new_d = (set_payload.get(parent) or {})
        keys = set(old_d.keys()) | set(new_d.keys())
        for k in keys:
            await _audit_log_change(
                category="cash", rid=rid, date_rome=date_rome,
                field=f"{parent}.{k}",
                old_value=old_d.get(k, ""), new_value=new_d.get(k, ""),
                user_info=user_info,
            )


async def _orders_aggregate_for_date(date_rome_str: str, restaurant_id: Optional[str] = None) -> Dict:
    """Aggrega le paste della data indicata (Rome) leggendo da `archived_orders`
    e da `orders` (per il giorno corrente, ancora non archiviato)."""
    try:
        d0 = datetime.strptime(date_rome_str, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
    except Exception:
        return {"total_orders": 0, "by_restaurant": {}}
    d1 = d0 + timedelta(days=1)
    q = {"created_at": {"$gte": d0.isoformat(), "$lt": d1.isoformat()}}
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    results = {"total_orders": 0, "by_restaurant": {}}
    for coll in ("archived_orders", "orders"):
        async for o in db[coll].find(q, {"_id": 0}):
            rid = o.get("restaurant_id") or "?"
            entry = results["by_restaurant"].setdefault(rid, {"count": 0, "completed": 0})
            entry["count"] += 1
            if o.get("status") == "completed":
                entry["completed"] += 1
            results["total_orders"] += 1
    return results


async def _build_closure_detail(date_str: str, restaurant_id: Optional[str]) -> Dict:
    """Build the full closure detail payload (used by Admin storico + report-ieri)."""
    cash_q = {"date_rome": date_str}
    bev_q = {"date_rome": date_str}
    if restaurant_id:
        cash_q["restaurant_id"] = restaurant_id
        bev_q["restaurant_id"] = restaurant_id
    cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
    bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
    dmap = await _get_pasta_dict_for(restaurant_id or cash_doc.get("restaurant_id"))
    cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap), 2) if cash_doc else 0.0
    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    bev_names = {b["sigla"]: b["name"] for b in BEVERAGES_CATALOG}
    bev_rows = []
    bev_total_qty = 0
    bev_total_inc = 0.0
    for r in bev_docs:
        m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
        s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
        qty = (0 if e == 0 else (m + u - e)) - s
        inc = qty * bev_prices.get(r["sigla"], 0)
        bev_rows.append({
            "sigla": r["sigla"],
            "name": bev_names.get(r["sigla"], r["sigla"]),
            "mattina": r.get("mattina", ""),
            "inUsc": r.get("inUsc", ""),
            "scarti": r.get("scarti", ""),
            "sera": r.get("sera", ""),
            "quantita": qty,
            "incasso": round(inc, 2),
            "comments": r.get("comments") or {},
        })
        bev_total_qty += int(qty)
        bev_total_inc += inc
    orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)
    bev_sort_idx = {b["sigla"]: b.get("sort_order", 999) for b in BEVERAGES_CATALOG}
    bev_rows.sort(key=lambda r: bev_sort_idx.get(r["sigla"], 999))
    paste_count = _compute_paste_count(cash_doc.get("paste_text", "") if cash_doc else "")
    paste_unrecognized = _compute_paste_unrecognized(
        cash_doc.get("paste_text", "") if cash_doc else "",
        (cash_doc.get("manual_prices") if cash_doc else None) or {},
        dmap,
    )
    paste_total_eur = round(_compute_paste_total_eur(
        cash_doc.get("paste_text", "") if cash_doc else "",
        (cash_doc.get("manual_prices") if cash_doc else None) or {},
        dmap,
    ), 2)
    return {
        "date": date_str,
        "cash": cash_doc,
        "cash_sera": cash_sera,
        "beverages": bev_rows,
        "bev_total_qty": bev_total_qty,
        "bev_total_inc": round(bev_total_inc, 2),
        "orders": orders_info,
        "paste_count": paste_count,
        "paste_total_eur": paste_total_eur,
        "paste_unrecognized": paste_unrecognized,
    }
