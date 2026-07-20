import ast
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional
from zoneinfo import ZoneInfo


ROME_TZ = ZoneInfo("Europe/Rome")
REPORT_NORMALIZER_VERSION = 1
REPORT_RULE_VERSION = 1
UNITS_PER_CASE = Decimal("24")

CASH_FIELD_SIGNS = {
    "mattina": 1,
    "altro": 1,
    "glo": -1,
    "just": -1,
    "delv": -1,
    "bp": -1,
    "sat": -1,
    "ft": -1,
    "pos": -1,
    "vers": -1,
    "arr": 1,
}
SPICCI_MULTIPLIERS = {
    "sp5": Decimal("50"),
    "sp2": Decimal("50"),
    "sp1": Decimal("25"),
    "sp05": Decimal("20"),
}
CASSETTO_DENOMINATIONS = {
    "cd5": Decimal("5"),
    "cd2": Decimal("2"),
    "cd1": Decimal("1"),
    "cd05": Decimal("0.5"),
}
CASSETTO_SPICCI_FIELD = {
    "cd5": "sp5",
    "cd2": "sp2",
    "cd1": "sp1",
    "cd05": "sp05",
}
CASH_DENOMINATIONS = {
    "big100": Decimal("100"),
    "big": Decimal("50"),
    "d20": Decimal("20"),
    "d10": Decimal("10"),
    "d5": Decimal("5"),
    "c2": Decimal("2"),
    "c1": Decimal("1"),
    "c50": Decimal("0.5"),
    "c20": Decimal("0.2"),
    "c10": Decimal("0.1"),
}
BEVERAGE_PRICES = {
    "AL": Decimal("1"),
    "AG": Decimal("1"),
    "C": Decimal("2"),
    "CZ": Decimal("2"),
    "F": Decimal("2"),
    "S": Decimal("2"),
    "B": Decimal("2.5"),
    "VB": Decimal("2.5"),
    "VR": Decimal("2.5"),
}

_EXPRESSION_RE = re.compile(r"^[\d+\-*/.() \s]*$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_EXPRESSION_LENGTH = 500
_MAX_ABS_VALUE = Decimal("1000000000000")


@dataclass(frozen=True)
class Evaluation:
    status: str
    value: Optional[Decimal]


@dataclass(frozen=True)
class ReportStream:
    key: str
    collection: str
    logical_stream: str
    event_kind: str
    timestamp_field: str
    cyclic_scan: bool
    cursor_fields: tuple[str, ...]


REPORT_STREAMS = (
    ReportStream(
        "cash_daily",
        "cash_daily_counts",
        "report_cash_daily",
        "cash_daily_state",
        "updated_at",
        True,
        ("date_rome", "restaurant_id", "_id"),
    ),
    ReportStream(
        "beverage_daily",
        "beverage_daily_counts",
        "report_beverage_daily",
        "beverage_daily_state",
        "updated_at",
        True,
        ("date_rome", "restaurant_id", "sigla", "_id"),
    ),
    ReportStream(
        "report_audit",
        "cash_audit_log",
        "report_audit",
        "report_audit_event",
        "last_at",
        True,
        ("last_at", "id", "_id"),
    ),
    ReportStream(
        "beverage_sales_finalized",
        "archived_beverage_sales",
        "beverage_sales_finalized",
        "beverage_sale_finalized",
        "created_at",
        True,
        ("id", "_id"),
    ),
)


def _parse_utc_datetime(value, *, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} non contiene una data ISO valida") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} non contiene il fuso orario")
    return parsed.astimezone(timezone.utc)


def _parse_business_date(value) -> str:
    cleaned = str(value or "").strip()
    if not _DATE_RE.fullmatch(cleaned):
        raise ValueError("date_rome non contiene una data YYYY-MM-DD valida")
    try:
        datetime.strptime(cleaned, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("date_rome non contiene una data reale") from exc
    return cleaned


def _date_start_utc(date_rome: str) -> datetime:
    return datetime.strptime(
        date_rome,
        "%Y-%m-%d",
    ).replace(tzinfo=ROME_TZ).astimezone(timezone.utc)


def _decimal_string(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def _to_cents(value: Decimal) -> int:
    return int(
        (value * Decimal("100")).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def _eval_ast(node) -> Decimal:
    if isinstance(node, ast.Expression):
        return _eval_ast(node.body)
    if isinstance(node, ast.Constant) and type(node.value) in {int, float}:
        return Decimal(str(node.value))
    if isinstance(node, ast.UnaryOp) and isinstance(
        node.op,
        (ast.UAdd, ast.USub),
    ):
        value = _eval_ast(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and isinstance(
        node.op,
        (ast.Add, ast.Sub, ast.Mult, ast.Div),
    ):
        left = _eval_ast(node.left)
        right = _eval_ast(node.right)
        if isinstance(node.op, ast.Add):
            value = left + right
        elif isinstance(node.op, ast.Sub):
            value = left - right
        elif isinstance(node.op, ast.Mult):
            value = left * right
        else:
            value = left / right
        if abs(value) > _MAX_ABS_VALUE:
            raise ValueError("risultato fuori limite")
        return value
    raise ValueError("espressione non supportata")


def evaluate_report_expression(value) -> Evaluation:
    if value is None:
        return Evaluation("missing", None)
    expression = str(value)
    if "<" in expression:
        expression = re.sub(r"<[^>]*>", "", expression)
    expression = expression.strip().replace(",", ".")
    if not expression:
        return Evaluation("missing", None)
    if expression.startswith("="):
        expression = expression[1:].strip()
    if (
        not expression
        or len(expression) > _MAX_EXPRESSION_LENGTH
        or not _EXPRESSION_RE.fullmatch(expression)
    ):
        return Evaluation("invalid", None)
    try:
        parsed = ast.parse(expression, mode="eval")
        result = _eval_ast(parsed)
        if not result.is_finite() or abs(result) > _MAX_ABS_VALUE:
            return Evaluation("invalid", None)
        return Evaluation("valid", result)
    except (
        InvalidOperation,
        RecursionError,
        SyntaxError,
        TypeError,
        ValueError,
        ZeroDivisionError,
    ):
        return Evaluation("invalid", None)


def _evaluation_payload(evaluation: Evaluation, *, monetary: bool = False) -> dict:
    payload = {"status": evaluation.status}
    if evaluation.value is not None:
        payload["value_decimal"] = _decimal_string(evaluation.value)
        if monetary:
            payload["value_cents"] = _to_cents(evaluation.value)
    return payload


def _value_or_zero(evaluation: Evaluation) -> Decimal:
    return evaluation.value if evaluation.value is not None else Decimal("0")


def _source_timestamp(
    document: dict,
    *,
    field: str,
    captured_at: datetime,
    business_date: Optional[str] = None,
) -> tuple[datetime, str]:
    raw = document.get(field)
    if raw not in (None, ""):
        return _parse_utc_datetime(raw, field=field), "source"
    if business_date:
        return _date_start_utc(business_date), "business_date_start"
    return captured_at, "captured_at"


def _manual_price_key(line: str) -> str:
    return re.sub(r"\s+", " ", str(line or "").strip().upper())[:200]


def _pasta_dictionary(document: dict) -> tuple[dict[str, Decimal], dict]:
    snapshot = document.get("pasta_dict_snapshot")
    result = {}
    invalid_entries = 0
    if isinstance(snapshot, list):
        for item in snapshot:
            if not isinstance(item, dict):
                invalid_entries += 1
                continue
            sigla = str(item.get("sigla") or "").strip().upper()
            try:
                price = Decimal(str(item.get("price")))
            except (InvalidOperation, TypeError, ValueError):
                invalid_entries += 1
                continue
            if not sigla or not price.is_finite() or price < 0:
                invalid_entries += 1
                continue
            result[sigla] = price
    return result, {
        "available": bool(result),
        "snapshot_version": document.get("pasta_dict_snapshot_version"),
        "snapshot_at": document.get("pasta_dict_snapshot_at"),
        "snapshot_source": document.get("pasta_dict_snapshot_source"),
        "invalid_entries": invalid_entries,
    }


def _recognized_pasta_sigla(
    line: str,
    dictionary: dict[str, Decimal],
) -> Optional[str]:
    upper = str(line or "").upper()
    if re.search(r"\bXL\b", upper):
        return None
    for sigla in sorted(dictionary, key=len, reverse=True):
        pattern = rf"^\s*(?:\d+\s+)?{re.escape(sigla)}(?:\b|$)"
        if re.search(pattern, upper):
            return sigla
    return None


def _manual_price(
    manual_prices: dict,
    *,
    index: int,
    line: str,
) -> Optional[Decimal]:
    values = manual_prices if isinstance(manual_prices, dict) else {}
    raw = values.get(
        _manual_price_key(line),
        values.get(str(index), values.get(index)),
    )
    if raw in (None, ""):
        return None
    try:
        value = Decimal(str(raw).replace(",", ".").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    return value


def _normalize_paste(document: dict) -> dict:
    dictionary, dictionary_meta = _pasta_dictionary(document)
    manual_prices = document.get("manual_prices") or {}
    lines = [
        line.strip()
        for line in str(document.get("paste_text") or "").splitlines()
        if line.strip()
    ]
    normalized_lines = []
    total = Decimal("0")
    recognized_count = 0
    missing_price_count = 0
    for index, line in enumerate(lines):
        sigla = _recognized_pasta_sigla(line, dictionary)
        if sigla:
            price = dictionary[sigla]
            source = "dictionary_snapshot"
            recognized_count += 1
        else:
            price = _manual_price(
                manual_prices,
                index=index,
                line=line,
            )
            source = "manual" if price is not None else "missing"
        if price is None:
            missing_price_count += 1
        else:
            total += price
        normalized_lines.append({
            "index": index,
            "raw": line,
            "normalized_key": _manual_price_key(line),
            "recognized_sigla": sigla,
            "price_source": source,
            "unit_price_cents": _to_cents(price) if price is not None else None,
        })
    return {
        "lines": normalized_lines,
        "total_count": len(lines),
        "recognized_count": recognized_count,
        "unrecognized_count": len(lines) - recognized_count,
        "missing_price_count": missing_price_count,
        "operational_total_cents": _to_cents(total),
        "price_coverage_complete": missing_price_count == 0,
        "manual_override": bool(document.get("paste_manual_override", False)),
        "dictionary": dictionary_meta,
    }


def _normalize_cash(
    document: dict,
    *,
    captured_at: datetime,
) -> tuple[str, datetime, dict]:
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    business_date = _parse_business_date(document.get("date_rome"))
    source_timestamp, timestamp_quality = _source_timestamp(
        document,
        field="updated_at",
        captured_at=captured_at,
        business_date=business_date,
    )
    source_id = f"cash:{restaurant_id}:{business_date}"
    evaluations = {
        field: evaluate_report_expression(document.get(field))
        for field in (
            *CASH_FIELD_SIGNS,
            *SPICCI_MULTIPLIERS,
            *CASSETTO_DENOMINATIONS,
        )
    }
    invalid_fields = [
        field for field, result in evaluations.items()
        if result.status == "invalid"
    ]
    missing_fields = [
        field for field, result in evaluations.items()
        if result.status == "missing"
    ]
    cash_base = sum(
        (
            _value_or_zero(evaluations[field]) * sign
            for field, sign in CASH_FIELD_SIGNS.items()
        ),
        Decimal("0"),
    )
    spicci_rows = {}
    spicci_total = Decimal("0")
    for field, multiplier in SPICCI_MULTIPLIERS.items():
        opened = _value_or_zero(evaluations[field])
        value = opened * multiplier
        spicci_total += value
        spicci_rows[field] = {
            "opened": _evaluation_payload(evaluations[field]),
            "bundle_value_cents": _to_cents(multiplier),
            "value_cents": _to_cents(value),
        }
    cassetto_rows = {}
    cassetto_total = Decimal("0")
    for field, denomination in CASSETTO_DENOMINATIONS.items():
        stock = _value_or_zero(evaluations[field])
        opened = _value_or_zero(
            evaluations[CASSETTO_SPICCI_FIELD[field]]
        )
        value = stock * denomination
        cassetto_total += value
        cassetto_rows[field] = {
            "stock": _evaluation_payload(evaluations[field]),
            "opened_decimal": _decimal_string(opened),
            "remaining_decimal": _decimal_string(stock - opened),
            "denomination_cents": _to_cents(denomination),
            "stock_value_cents": _to_cents(value),
        }
    banknotes = {}
    banknotes_total = Decimal("0")
    negative_banknote_fields = []
    raw_banknotes = document.get("cash_banconote") or {}
    if not isinstance(raw_banknotes, dict):
        raw_banknotes = {}
    for field, denomination in CASH_DENOMINATIONS.items():
        evaluation = evaluate_report_expression(raw_banknotes.get(field))
        count = _value_or_zero(evaluation)
        if count < 0:
            negative_banknote_fields.append(field)
            subtotal = Decimal("0")
        else:
            subtotal = count * denomination
        banknotes_total += subtotal
        banknotes[field] = {
            "count": _evaluation_payload(evaluation),
            "denomination_cents": _to_cents(denomination),
            "subtotal_cents": _to_cents(subtotal),
        }
    pasta = _normalize_paste(document)
    before_beverages_cents = (
        _to_cents(cash_base)
        + _to_cents(spicci_total)
        + pasta["operational_total_cents"]
    )
    fact = {
        "normalizer_version": REPORT_NORMALIZER_VERSION,
        "rule_version": REPORT_RULE_VERSION,
        "fact_kind": "cash_daily_state",
        "entity_key": source_id,
        "restaurant_id": restaurant_id,
        "business_date": business_date,
        "occurred_at": source_timestamp,
        "cash_fields": {
            field: _evaluation_payload(result, monetary=True)
            for field, result in evaluations.items()
            if field in CASH_FIELD_SIGNS
        },
        "cash_base_cents": _to_cents(cash_base),
        "spicci": {
            "rows": spicci_rows,
            "total_cents": _to_cents(spicci_total),
        },
        "cassetto": {
            "rows": cassetto_rows,
            "stock_total_cents": _to_cents(cassetto_total),
        },
        "banknotes": {
            "rows": banknotes,
            "total_cents": _to_cents(banknotes_total),
        },
        "paste": pasta,
        "cash_before_beverages_cents": before_beverages_cents,
        "comments": (
            document.get("comments")
            if isinstance(document.get("comments"), dict)
            else {}
        ),
        "carry": {
            "mattina_auto": document.get("mattina_auto_carry"),
            "mattina_from_date": document.get("mattina_carry_from_date"),
            "mattina_value": document.get("mattina_carry_value"),
            "cassetto": {
                field: {
                    "auto": document.get(f"{field}_auto_carry"),
                    "from_date": document.get(f"{field}_carry_from_date"),
                    "value": document.get(f"{field}_carry_value"),
                }
                for field in CASSETTO_DENOMINATIONS
            },
        },
        "quality": {
            "source_timestamp": timestamp_quality,
            "missing_expression_fields": missing_fields,
            "invalid_expression_fields": invalid_fields,
            "negative_banknote_fields_ignored": negative_banknote_fields,
            "cash_sera_requires_beverage_facts": True,
            "paste_price_coverage_complete": pasta["price_coverage_complete"],
        },
    }
    return source_id, source_timestamp, fact


def _component_total(
    document: dict,
    *,
    prefix: str,
) -> tuple[Optional[Decimal], dict]:
    cases = evaluate_report_expression(document.get(f"{prefix}_casse"))
    loose = (
        evaluate_report_expression(document.get(f"{prefix}_sfuse"))
        if prefix in {"mattina", "sera"}
        else Evaluation("valid", Decimal("0"))
    )
    if cases.value is None and loose.value is None:
        total = None
    else:
        total = (
            _value_or_zero(cases) * UNITS_PER_CASE
            + _value_or_zero(loose)
        )
    return total, {
        "cases": _evaluation_payload(cases),
        "loose": _evaluation_payload(loose),
        "computed_units_decimal": (
            _decimal_string(total) if total is not None else None
        ),
    }


def _normalize_beverage_daily(
    document: dict,
    *,
    captured_at: datetime,
) -> tuple[str, datetime, dict]:
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    business_date = _parse_business_date(document.get("date_rome"))
    sigla = str(document.get("sigla") or "").strip().upper()
    if not sigla:
        raise ValueError("sigla mancante")
    source_timestamp, timestamp_quality = _source_timestamp(
        document,
        field="updated_at",
        captured_at=captured_at,
        business_date=business_date,
    )
    source_id = f"beverage:{restaurant_id}:{business_date}:{sigla}"
    fields = {
        field: evaluate_report_expression(document.get(field))
        for field in ("mattina", "inUsc", "scarti", "sera")
    }
    morning = _value_or_zero(fields["mattina"])
    movements = _value_or_zero(fields["inUsc"])
    waste = _value_or_zero(fields["scarti"])
    evening = _value_or_zero(fields["sera"])
    sold = (
        Decimal("0")
        if evening == 0
        else morning + movements - evening
    ) - waste
    price = BEVERAGE_PRICES.get(sigla)
    revenue = sold * price if price is not None else None
    component_rows = {}
    component_mismatches = []
    for prefix, direct_field in (
        ("mattina", "mattina"),
        ("inUsc", "inUsc"),
        ("sera", "sera"),
    ):
        component_total, payload = _component_total(
            document,
            prefix=prefix,
        )
        direct_value = fields[direct_field].value
        if (
            component_total is not None
            and direct_value is not None
            and component_total != direct_value
        ):
            component_mismatches.append(prefix)
        payload["matches_direct_total"] = (
            component_total == direct_value
            if component_total is not None and direct_value is not None
            else None
        )
        component_rows[prefix] = payload
    fact = {
        "normalizer_version": REPORT_NORMALIZER_VERSION,
        "rule_version": REPORT_RULE_VERSION,
        "fact_kind": "beverage_daily_state",
        "entity_key": source_id,
        "restaurant_id": restaurant_id,
        "business_date": business_date,
        "occurred_at": source_timestamp,
        "sigla": sigla,
        "inventory_fields": {
            field: _evaluation_payload(result)
            for field, result in fields.items()
        },
        "components": component_rows,
        "sold_quantity_decimal": _decimal_string(sold),
        "unit_price_cents": _to_cents(price) if price is not None else None,
        "revenue_cents": _to_cents(revenue) if revenue is not None else None,
        "comments": (
            document.get("comments")
            if isinstance(document.get("comments"), dict)
            else {}
        ),
        "carry": {
            "mattina_auto": document.get("mattina_auto_carry"),
            "mattina_from_date": document.get("mattina_carry_from_date"),
            "mattina_value": document.get("mattina_carry_value"),
        },
        "quality": {
            "source_timestamp": timestamp_quality,
            "catalog_version": REPORT_RULE_VERSION,
            "catalog_price_available": price is not None,
            "missing_fields": [
                field for field, result in fields.items()
                if result.status == "missing"
            ],
            "invalid_fields": [
                field for field, result in fields.items()
                if result.status == "invalid"
            ],
            "component_mismatches": component_mismatches,
            "evening_zero_uses_operational_zero_sales_rule": evening == 0,
        },
    }
    return source_id, source_timestamp, fact


def _normalize_audit_event(
    document: dict,
    *,
    captured_at: datetime,
) -> tuple[str, datetime, dict]:
    source_id = str(document.get("id") or "").strip()
    if not source_id:
        raise ValueError("id sorgente mancante")
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    business_date = _parse_business_date(document.get("date_rome"))
    source_timestamp, timestamp_quality = _source_timestamp(
        document,
        field="last_at",
        captured_at=captured_at,
        business_date=business_date,
    )
    fact = {
        "normalizer_version": REPORT_NORMALIZER_VERSION,
        "rule_version": REPORT_RULE_VERSION,
        "fact_kind": "report_audit_event",
        "entity_key": f"report-audit:{source_id}",
        "restaurant_id": restaurant_id,
        "business_date": business_date,
        "occurred_at": source_timestamp,
        "category": str(document.get("category") or ""),
        "field": str(document.get("field") or ""),
        "old_value": str(document.get("old_value") or ""),
        "new_value": str(document.get("new_value") or ""),
        "actor": {
            "role": str(document.get("by_role") or ""),
            "user": str(document.get("by_user") or ""),
            "user_id": str(document.get("by_user_id") or ""),
            "is_impersonating": bool(
                document.get("is_impersonating", False)
            ),
        },
        "first_at": document.get("first_at"),
        "last_at": document.get("last_at"),
        "changes_count": document.get("changes_count"),
        "quality": {
            "source_timestamp": timestamp_quality,
            "known_category": document.get("category") in {"cash", "beverage"},
        },
    }
    return source_id, source_timestamp, fact


def _finite_decimal(value, *, field: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field} non numerico") from exc
    if not parsed.is_finite():
        raise ValueError(f"{field} non finito")
    return parsed


def _normalize_finalized_beverage_sale(
    document: dict,
    *,
    captured_at: datetime,
) -> tuple[str, datetime, dict]:
    source_id = str(document.get("id") or "").strip()
    if not source_id:
        raise ValueError("id sorgente mancante")
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    source_timestamp, timestamp_quality = _source_timestamp(
        document,
        field="created_at",
        captured_at=captured_at,
    )
    quantity = _finite_decimal(document.get("quantity"), field="quantity")
    price_each = _finite_decimal(
        document.get("price_each"),
        field="price_each",
    )
    total = _finite_decimal(document.get("total"), field="total")
    sigla = str(document.get("sigla") or "").strip().upper()
    if not sigla:
        raise ValueError("sigla mancante")
    expected_total = quantity * price_each
    fact = {
        "normalizer_version": REPORT_NORMALIZER_VERSION,
        "rule_version": REPORT_RULE_VERSION,
        "fact_kind": "beverage_sale_finalized",
        "entity_key": f"beverage-sale:{source_id}",
        "restaurant_id": restaurant_id,
        "business_date": source_timestamp.astimezone(
            ROME_TZ
        ).date().isoformat(),
        "occurred_at": source_timestamp,
        "sigla": sigla,
        "name": str(document.get("name") or ""),
        "quantity_decimal": _decimal_string(quantity),
        "price_each_cents": _to_cents(price_each),
        "total_cents": _to_cents(total),
        "created_by": str(document.get("created_by") or ""),
        "quality": {
            "source_timestamp": timestamp_quality,
            "finalized_by_midnight_archive": True,
            "total_matches_quantity_times_price": total == expected_total,
        },
    }
    return source_id, source_timestamp, fact


def normalize_report_record(
    document: dict,
    stream: ReportStream,
    *,
    captured_at: datetime,
) -> tuple[str, datetime, dict]:
    if stream.event_kind == "cash_daily_state":
        return _normalize_cash(document, captured_at=captured_at)
    if stream.event_kind == "beverage_daily_state":
        return _normalize_beverage_daily(document, captured_at=captured_at)
    if stream.event_kind == "report_audit_event":
        return _normalize_audit_event(document, captured_at=captured_at)
    if stream.event_kind == "beverage_sale_finalized":
        return _normalize_finalized_beverage_sale(
            document,
            captured_at=captured_at,
        )
    raise ValueError(f"Tipo evento Report non supportato: {stream.event_kind}")


def report_source_id(document: dict, stream: ReportStream) -> str:
    if stream.event_kind == "cash_daily_state":
        restaurant_id = str(document.get("restaurant_id") or "").strip()
        business_date = str(document.get("date_rome") or "").strip()
        return (
            f"cash:{restaurant_id}:{business_date}"
            if restaurant_id and business_date
            else ""
        )
    if stream.event_kind == "beverage_daily_state":
        restaurant_id = str(document.get("restaurant_id") or "").strip()
        business_date = str(document.get("date_rome") or "").strip()
        sigla = str(document.get("sigla") or "").strip().upper()
        return (
            f"beverage:{restaurant_id}:{business_date}:{sigla}"
            if restaurant_id and business_date and sigla
            else ""
        )
    return str(document.get("id") or "").strip()


def _lexicographic_after_query(
    fields: tuple[str, ...],
    cursor: dict,
) -> Optional[dict]:
    if not cursor or any(field not in cursor for field in fields):
        return None
    clauses = []
    for index, field in enumerate(fields):
        clause = {
            previous: cursor[previous]
            for previous in fields[:index]
        }
        clause[field] = {"$gt": cursor[field]}
        clauses.append(clause)
    return {"$or": clauses}


async def collect_report_stream(
    source,
    store,
    *,
    epoch: dict,
    stream: ReportStream,
    batch_size: int,
    captured_at: Optional[datetime] = None,
) -> dict:
    captured = (captured_at or datetime.now(timezone.utc)).astimezone(
        timezone.utc
    )
    activation_epoch = epoch["activated_at"].astimezone(timezone.utc)
    activation_date = activation_epoch.astimezone(ROME_TZ).date().isoformat()
    watermark = await store.get_watermark(epoch["id"], stream.key)
    cycle_id = str(watermark.get("cycle_id") or uuid.uuid4())
    stateful = stream.event_kind in {
        "cash_daily_state",
        "beverage_daily_state",
    }

    if stream.cyclic_scan:
        base_query = (
            {"date_rome": {"$gte": activation_date}}
            if stream.event_kind in {
                "cash_daily_state",
                "beverage_daily_state",
            }
            else {
                stream.timestamp_field: {
                    "$gte": activation_epoch.isoformat()
                }
            }
        )
        cursor = watermark.get("cursor") or {}
        after_query = _lexicographic_after_query(
            stream.cursor_fields,
            cursor,
        )
        query = (
            {"$and": [base_query, after_query]}
            if after_query
            else base_query
        )
        documents = await source.find_batch(
            stream.collection,
            query,
            None,
            sort=[(field, 1) for field in stream.cursor_fields],
            limit=batch_size,
        )
    else:
        last_seen_at = watermark.get("last_seen_at")
        last_seen_value = (
            last_seen_at.astimezone(timezone.utc).isoformat()
            if isinstance(last_seen_at, datetime)
            else str(last_seen_at or activation_epoch.isoformat())
        )
        last_seen_id = str(watermark.get("last_seen_id") or "")
        query = {
            "$or": [
                {stream.timestamp_field: {"$gt": last_seen_value}},
                {
                    stream.timestamp_field: last_seen_value,
                    "id": {"$gt": last_seen_id},
                },
            ]
        }
        documents = await source.find_batch(
            stream.collection,
            query,
            None,
            sort=[(stream.timestamp_field, 1), ("id", 1)],
            limit=batch_size,
        )

    inserted = 0
    duplicates = 0
    quarantined = 0
    for document in documents:
        observed_source_id = report_source_id(document, stream)
        if stateful and observed_source_id:
            await store.mark_state_observed(
                fact_collection_name="memory_report_facts",
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_id=observed_source_id,
                cycle_id=cycle_id,
                observed_at=captured,
            )
        try:
            source_id, source_timestamp, fact = normalize_report_record(
                document,
                stream,
                captured_at=captured,
            )
            result = await store.save_report_version(
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_collection=stream.collection,
                source_id=source_id,
                source_timestamp=source_timestamp,
                captured_at=captured,
                normalized_fact=fact,
                raw_document=document,
            )
            if stateful:
                await store.mark_state_observed(
                    fact_collection_name="memory_report_facts",
                    epoch_id=epoch["id"],
                    logical_stream=stream.logical_stream,
                    source_id=source_id,
                    cycle_id=cycle_id,
                    observed_at=captured,
                )
            if result["inserted"]:
                inserted += 1
            else:
                duplicates += 1
        except Exception as exc:
            quarantined += 1
            await store.save_quarantine(
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_collection=stream.collection,
                raw_document=document,
                error=exc,
            )

    if stream.cyclic_scan:
        cycle_complete = len(documents) < batch_size
        disappeared = 0
        if cycle_complete and stateful:
            disappeared = await store.finalize_state_scan(
                fact_collection_name="memory_report_facts",
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                stateful_fact_kinds={stream.event_kind},
                cycle_id=cycle_id,
                completed_at=captured,
            )
        next_cursor = (
            {}
            if cycle_complete
            else {
                field: documents[-1].get(field)
                for field in stream.cursor_fields
            }
        )
        watermark_fields = {
            "cursor": next_cursor,
            "cycle_id": "" if cycle_complete else cycle_id,
            "cycle_complete": cycle_complete,
            "cycle_completed_at": captured if cycle_complete else None,
            "last_batch_disappeared": disappeared,
        }
    else:
        watermark_fields = {}
        if documents:
            last_document = documents[-1]
            watermark_fields = {
                "last_seen_at": str(
                    last_document.get(stream.timestamp_field) or ""
                ),
                "last_seen_id": str(last_document.get("id") or ""),
            }

    await store.save_watermark(
        epoch_id=epoch["id"],
        source=stream.key,
        fields={
            **watermark_fields,
            "last_batch_at": captured,
            "last_batch_seen": len(documents),
            "last_batch_inserted": inserted,
            "last_batch_duplicates": duplicates,
            "last_batch_quarantined": quarantined,
        },
    )
    return {
        "source": stream.key,
        "seen": len(documents),
        "inserted": inserted,
        "duplicates": duplicates,
        "quarantined": quarantined,
        **(
            {
                "cycle_complete": watermark_fields["cycle_complete"],
                "disappeared": watermark_fields["last_batch_disappeared"],
            }
            if stream.cyclic_scan
            else {}
        ),
    }
