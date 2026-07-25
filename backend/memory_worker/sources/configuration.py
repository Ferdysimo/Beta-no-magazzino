import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from annotation_semantics import (
    annotation_rule_manifest,
    normalize_annotation_target,
)

from .orders import parse_utc_datetime

CONFIGURATION_NORMALIZER_VERSION = 1
CONFIGURATION_RULE_VERSION = 1
DEFAULT_PASTA_PRICES = {
    "CARB": Decimal("8"),
    "AMAT": Decimal("8"),
    "CACIO": Decimal("8"),
    "PESTO": Decimal("8"),
    "TART": Decimal("8"),
    "RAGU": Decimal("8"),
    "POM": Decimal("7"),
    "CARZUC": Decimal("8"),
}


@dataclass(frozen=True)
class ConfigurationStream:
    key: str
    collection: str
    logical_stream: str
    event_kind: str
    timestamp_fields: tuple[str, ...]
    cursor_fields: tuple[str, ...]
    projection: Optional[dict] = None


CONFIGURATION_STREAMS = (
    ConfigurationStream(
        "configuration_restaurants",
        "restaurants",
        "configuration_restaurants",
        "restaurant_configuration_state",
        ("updated_at", "created_at"),
        ("id", "_id"),
        {
            "_id": 1,
            "id": 1,
            "name": 1,
            "username": 1,
            "location": 1,
            "role": 1,
            "boiler_count": 1,
            "report_code": 1,
            "address": 1,
            "postal_code": 1,
            "city": 1,
            "monitor_customers_enabled": 1,
            "created_at": 1,
            "updated_at": 1,
        },
    ),
    ConfigurationStream(
        "configuration_pasta_dictionaries",
        "pasta_dictionary",
        "configuration_pasta_dictionaries",
        "pasta_dictionary_state",
        ("updated_at",),
        ("restaurant_id", "_id"),
    ),
    ConfigurationStream(
        "configuration_pasta_annotation_aliases",
        "lab_pasta_annotation_aliases",
        "configuration_pasta_annotation_aliases",
        "pasta_annotation_alias_state",
        ("updated_at", "created_at"),
        ("alias_normalized", "_id"),
        {
            "_id": 1,
            "id": 1,
            "alias_normalized": 1,
            "canonical_normalized": 1,
            "active": 1,
            "learning_version": 1,
            "source": 1,
            "created_by_id": 1,
            "created_by_username": 1,
            "created_at": 1,
            "updated_at": 1,
        },
    ),
    ConfigurationStream(
        "configuration_beverages",
        "beverages",
        "configuration_beverages",
        "beverage_catalog_state",
        (),
        ("sigla", "_id"),
    ),
    ConfigurationStream(
        "configuration_suppliers",
        "suppliers",
        "configuration_suppliers",
        "supplier_state",
        ("updated_at", "created_at"),
        ("id", "_id"),
    ),
)


def _decimal(value, *, field: str) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{field} non e numerico")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field} non e numerico") from exc
    if not parsed.is_finite():
        raise ValueError(f"{field} non e finito")
    return parsed


def _to_cents(value: Decimal) -> int:
    return int(
        (value * Decimal("100")).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def _source_timestamp(
    document: dict,
    fields: tuple[str, ...],
    *,
    captured_at: datetime,
) -> tuple[datetime, str]:
    for field in fields:
        value = document.get(field)
        if value not in (None, ""):
            return parse_utc_datetime(value, field=field), field
    return captured_at, "captured_at"


def configuration_source_id(
    document: dict,
    stream: ConfigurationStream,
) -> str:
    if stream.event_kind in {
        "restaurant_configuration_state",
        "supplier_state",
    }:
        return str(document.get("id") or "").strip()
    if stream.event_kind == "pasta_dictionary_state":
        restaurant_id = str(document.get("restaurant_id") or "").strip()
        return f"pasta-dictionary:{restaurant_id}" if restaurant_id else ""
    if stream.event_kind == "pasta_annotation_alias_state":
        alias = normalize_annotation_target(
            document.get("alias_normalized") or ""
        )
        return f"pasta-annotation-alias:{alias}" if alias else ""
    if stream.event_kind == "beverage_catalog_state":
        sigla = str(document.get("sigla") or "").strip().upper()
        return f"beverage:{sigla}" if sigla else ""
    return ""


def _normalize_restaurant(
    document: dict,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
    stream: ConfigurationStream,
) -> tuple[str, datetime, dict]:
    source_id = configuration_source_id(document, stream)
    if not source_id:
        raise ValueError("id locale mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    created_at = None
    if document.get("created_at"):
        created_at = parse_utc_datetime(
            document["created_at"],
            field="created_at",
        )
    monitor_value = document.get("monitor_customers_enabled")
    monitor = (
        {"status": "missing"}
        if monitor_value is None
        else {"status": "configured", "value": bool(monitor_value)}
    )
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "restaurant_configuration_state",
        "entity_key": f"restaurant-configuration:{source_id}",
        "restaurant_id": source_id,
        "occurred_at": timestamp,
        "present": True,
        "name": str(document.get("name") or "").strip(),
        "username": str(document.get("username") or "").strip(),
        "location": str(document.get("location") or "").strip(),
        "role": str(document.get("role") or "restaurant").strip(),
        "boiler_count": int(document.get("boiler_count") or 1),
        "report_code": str(document.get("report_code") or "").strip(),
        "address": {
            "street": str(document.get("address") or "").strip(),
            "postal_code": str(document.get("postal_code") or "").strip(),
            "city": str(document.get("city") or "").strip(),
        },
        "monitor_customers": monitor,
        "baseline_at_epoch": bool(created_at is None or created_at < activation_epoch),
        "quality": {
            "timestamp_source": timestamp_source,
            "state_change_time_known": timestamp_source == "updated_at",
            "authentication_secrets_excluded": True,
            "runtime_counters_excluded": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_pasta_dictionary(
    document: dict,
    *,
    captured_at: datetime,
    stream: ConfigurationStream,
) -> tuple[str, datetime, dict]:
    source_id = configuration_source_id(document, stream)
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not source_id or not restaurant_id:
        raise ValueError("restaurant_id dizionario mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    entries = []
    seen = set()
    for index, item in enumerate(document.get("siglas") or []):
        if not isinstance(item, dict):
            raise ValueError(f"siglas[{index}] non e un oggetto")
        sigla = str(item.get("sigla") or "").strip().upper()
        if not sigla:
            raise ValueError(f"siglas[{index}].sigla mancante")
        if sigla in seen:
            raise ValueError(f"sigla duplicata: {sigla}")
        seen.add(sigla)
        entries.append(
            {
                "code": sigla,
                "price_cents": _to_cents(
                    _decimal(
                        item.get("price"),
                        field=f"siglas[{index}].price",
                    )
                ),
            }
        )
    entries.sort(key=lambda item: item["code"])
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "pasta_dictionary_state",
        "entity_key": f"pasta-dictionary:{restaurant_id}",
        "restaurant_id": restaurant_id,
        "occurred_at": timestamp,
        "present": True,
        "dictionary_source": "restaurant_override",
        "entries": entries,
        "entry_count": len(entries),
        "updated_by": str(document.get("updated_by") or "").strip(),
        "quality": {
            "timestamp_source": timestamp_source,
            "prices_use_integer_cents": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_pasta_annotation_alias(
    document: dict,
    *,
    captured_at: datetime,
    stream: ConfigurationStream,
) -> tuple[str, datetime, dict]:
    source_id = configuration_source_id(document, stream)
    alias = normalize_annotation_target(document.get("alias_normalized") or "")
    canonical = normalize_annotation_target(
        document.get("canonical_normalized") or ""
    )
    if not source_id or len(alias) < 3 or len(canonical) < 3:
        raise ValueError("alias annotazione pasta non valido")
    if alias == canonical:
        raise ValueError("alias annotazione pasta identico al termine principale")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "pasta_annotation_alias_state",
        "entity_key": source_id,
        "occurred_at": timestamp,
        "present": bool(document.get("active", True)),
        "alias_normalized": alias,
        "canonical_normalized": canonical,
        "learning_version": int(document.get("learning_version") or 1),
        "source": str(document.get("source") or ""),
        "confirmed_by": {
            "id": str(document.get("created_by_id") or ""),
            "username": str(document.get("created_by_username") or ""),
        },
        "quality": {
            "timestamp_source": timestamp_source,
            "human_confirmation_required": True,
            "raw_order_text_replayable": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_beverage(
    document: dict,
    *,
    captured_at: datetime,
    stream: ConfigurationStream,
) -> tuple[str, datetime, dict]:
    source_id = configuration_source_id(document, stream)
    sigla = str(document.get("sigla") or "").strip().upper()
    if not source_id or not sigla:
        raise ValueError("sigla bevanda mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "beverage_catalog_state",
        "entity_key": f"beverage-catalog:{sigla}",
        "beverage_code": sigla,
        "occurred_at": timestamp,
        "present": True,
        "name": str(document.get("name") or "").strip(),
        "price_cents": _to_cents(_decimal(document.get("price"), field="price")),
        "sort_order": int(document.get("sort_order") or 0),
        "quality": {
            "timestamp_source": timestamp_source,
            "prices_use_integer_cents": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_supplier(
    document: dict,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
    stream: ConfigurationStream,
) -> tuple[str, datetime, dict]:
    source_id = configuration_source_id(document, stream)
    if not source_id:
        raise ValueError("id fornitore mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    created_at = None
    if document.get("created_at"):
        created_at = parse_utc_datetime(
            document["created_at"],
            field="created_at",
        )
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "supplier_state",
        "entity_key": f"supplier:{source_id}",
        "supplier_id": source_id,
        "occurred_at": timestamp,
        "present": True,
        "name": str(document.get("name") or "").strip(),
        "baseline_at_epoch": bool(created_at is None or created_at < activation_epoch),
        "quality": {
            "timestamp_source": timestamp_source,
            "state_change_time_known": timestamp_source == "updated_at",
        },
    }
    return source_id, timestamp, fact


def normalize_configuration_record(
    document: dict,
    stream: ConfigurationStream,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
) -> tuple[str, datetime, dict]:
    if stream.event_kind == "restaurant_configuration_state":
        return _normalize_restaurant(
            document,
            captured_at=captured_at,
            activation_epoch=activation_epoch,
            stream=stream,
        )
    if stream.event_kind == "pasta_dictionary_state":
        return _normalize_pasta_dictionary(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "pasta_annotation_alias_state":
        return _normalize_pasta_annotation_alias(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "beverage_catalog_state":
        return _normalize_beverage(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "supplier_state":
        return _normalize_supplier(
            document,
            captured_at=captured_at,
            activation_epoch=activation_epoch,
            stream=stream,
        )
    raise ValueError(f"Tipo configurazione non supportato: {stream.event_kind}")


def initial_configuration_valid_from(
    fact: dict,
    *,
    source_timestamp: datetime,
    activation_epoch: datetime,
    baseline_scan: bool,
) -> datetime:
    timestamp_source = str((fact.get("quality") or {}).get("timestamp_source") or "")
    if timestamp_source == "captured_at":
        return activation_epoch if baseline_scan else source_timestamp
    return max(activation_epoch, source_timestamp)


def default_pasta_rule(
    *,
    captured_at: datetime,
    activation_epoch: datetime,
) -> tuple[str, datetime, dict, dict]:
    source_id = "default-pasta-prices"
    entries = [
        {"code": code, "price_cents": _to_cents(price)}
        for code, price in sorted(DEFAULT_PASTA_PRICES.items())
    ]
    raw = {
        "id": source_id,
        "rule_kind": "default_pasta_prices",
        "rule_version": CONFIGURATION_RULE_VERSION,
        "entries": entries,
    }
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "memory_rule_state",
        "entity_key": "memory-rule:default-pasta-prices",
        "occurred_at": activation_epoch,
        "present": True,
        "rule_kind": "default_pasta_prices",
        "rule_version": CONFIGURATION_RULE_VERSION,
        "entries": entries,
        "quality": {
            "authoritative_source_copy": False,
            "versioned_worker_rule_copy": True,
            "parity_test_required": True,
        },
    }
    return source_id, activation_epoch, fact, raw


def default_annotation_semantics_rule(
    *,
    captured_at: datetime,
    activation_epoch: datetime,
) -> tuple[str, datetime, dict, dict]:
    source_id = "annotation-semantics"
    manifest = annotation_rule_manifest()
    raw = {
        "id": source_id,
        "rule_kind": "annotation_semantics",
        **manifest,
    }
    fact = {
        "normalizer_version": CONFIGURATION_NORMALIZER_VERSION,
        "fact_kind": "memory_rule_state",
        "entity_key": "memory-rule:annotation-semantics",
        "occurred_at": activation_epoch,
        "present": True,
        "rule_kind": "annotation_semantics",
        **manifest,
        "quality": {
            "authoritative_source_copy": False,
            "versioned_worker_rule_copy": True,
            "raw_order_text_replayable": True,
            "unknown_tokens_preserved": True,
        },
    }
    return source_id, activation_epoch, fact, raw


def _lexicographic_after_query(
    fields: tuple[str, ...],
    cursor: dict,
) -> Optional[dict]:
    if not cursor or any(field not in cursor for field in fields):
        return None
    clauses = []
    for index, field in enumerate(fields):
        clause = {previous: cursor[previous] for previous in fields[:index]}
        clause[field] = {"$gt": cursor[field]}
        clauses.append(clause)
    return {"$or": clauses}


async def collect_configuration_stream(
    source,
    store,
    *,
    epoch: dict,
    stream: ConfigurationStream,
    batch_size: int,
    captured_at: Optional[datetime] = None,
) -> dict:
    captured = (captured_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    activation_epoch = epoch["activated_at"].astimezone(timezone.utc)
    watermark = await store.get_watermark(epoch["id"], stream.key)
    baseline_scan = watermark.get("initial_scan_completed_at") is None
    cycle_id = str(watermark.get("cycle_id") or uuid.uuid4())
    cursor = watermark.get("cursor") or {}
    query = _lexicographic_after_query(stream.cursor_fields, cursor) or {}
    documents = await source.find_batch(
        stream.collection,
        query,
        stream.projection,
        sort=[(field, 1) for field in stream.cursor_fields],
        limit=batch_size,
    )

    inserted = 0
    duplicates = 0
    quarantined = 0
    for document in documents:
        observed_source_id = configuration_source_id(document, stream)
        if observed_source_id:
            await store.mark_state_observed(
                fact_collection_name="memory_configuration_versions",
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_id=observed_source_id,
                cycle_id=cycle_id,
                observed_at=captured,
            )
        try:
            source_id, source_timestamp, fact = normalize_configuration_record(
                document,
                stream,
                captured_at=captured,
                activation_epoch=activation_epoch,
            )
            result = await store.save_configuration_version(
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_collection=stream.collection,
                source_id=source_id,
                source_timestamp=source_timestamp,
                captured_at=captured,
                normalized_fact=fact,
                raw_document=document,
                initial_valid_from=initial_configuration_valid_from(
                    fact,
                    source_timestamp=source_timestamp,
                    activation_epoch=activation_epoch,
                    baseline_scan=baseline_scan,
                ),
            )
            await store.mark_state_observed(
                fact_collection_name="memory_configuration_versions",
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

    cycle_complete = len(documents) < batch_size
    disappeared = 0
    if cycle_complete:
        disappeared = await store.finalize_state_scan(
            fact_collection_name="memory_configuration_versions",
            epoch_id=epoch["id"],
            logical_stream=stream.logical_stream,
            stateful_fact_kinds={stream.event_kind},
            cycle_id=cycle_id,
            completed_at=captured,
        )
    next_cursor = (
        {}
        if cycle_complete
        else {field: documents[-1].get(field) for field in stream.cursor_fields}
    )
    await store.save_watermark(
        epoch_id=epoch["id"],
        source=stream.key,
        fields={
            "cursor": next_cursor,
            "cycle_id": "" if cycle_complete else cycle_id,
            "cycle_complete": cycle_complete,
            "cycle_completed_at": captured if cycle_complete else None,
            "initial_scan_completed_at": (
                watermark.get("initial_scan_completed_at")
                or (captured if cycle_complete else None)
            ),
            "last_batch_at": captured,
            "last_batch_seen": len(documents),
            "last_batch_inserted": inserted,
            "last_batch_duplicates": duplicates,
            "last_batch_quarantined": quarantined,
            "last_batch_disappeared": disappeared,
        },
    )
    return {
        "source": stream.key,
        "seen": len(documents),
        "inserted": inserted,
        "duplicates": duplicates,
        "quarantined": quarantined,
        "disappeared": disappeared,
        "cycle_complete": cycle_complete,
    }
