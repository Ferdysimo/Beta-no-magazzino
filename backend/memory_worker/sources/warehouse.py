import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional
from zoneinfo import ZoneInfo

from .orders import parse_utc_datetime


ROME_TZ = ZoneInfo("Europe/Rome")
WAREHOUSE_NORMALIZER_VERSION = 1

MOVEMENT_MEANINGS = {
    "stock_iniziale": "stock_iniziale",
    "carico": "ricevuto_da_fornitore",
    "carico_modifica": "rettifica_carico",
    "carico_cancellato": "annullamento_carico",
    "evasione": "evaso_al_locale",
    "forzatura_admin": "rettifica_amministrativa",
    "scarto_admin": "scarto_magazzino",
}


@dataclass(frozen=True)
class WarehouseStream:
    key: str
    collection: str
    logical_stream: str
    event_kind: str
    timestamp_fields: tuple[str, ...]
    cursor_fields: tuple[str, ...]
    include_pre_epoch: bool = False
    stateful: bool = True


WAREHOUSE_STREAMS = (
    WarehouseStream(
        "warehouse_products",
        "products",
        "warehouse_products",
        "product_state",
        ("updated_at", "created_at"),
        ("id", "_id"),
        include_pre_epoch=True,
    ),
    WarehouseStream(
        "warehouse_stock_movements",
        "stock_movements",
        "warehouse_stock_movements",
        "stock_movement_event",
        ("timestamp",),
        ("timestamp", "id", "_id"),
        stateful=False,
    ),
    WarehouseStream(
        "warehouse_requests",
        "richieste",
        "warehouse_requests",
        "request_state",
        (
            "updated_at",
            "error_reported_at",
            "confermata_at",
            "evasa_at",
            "created_at",
        ),
        ("created_at", "id", "_id"),
    ),
    WarehouseStream(
        "warehouse_loads",
        "carichi_magazzino",
        "warehouse_loads",
        "warehouse_load_state",
        ("updated_at", "created_at"),
        ("created_at", "id", "_id"),
    ),
    WarehouseStream(
        "beverage_inventory",
        "beverage_inventory",
        "beverage_inventory",
        "beverage_inventory_state",
        ("updated_at",),
        ("restaurant_id", "sigla", "_id"),
        include_pre_epoch=True,
    ),
    WarehouseStream(
        "beverage_loads",
        "beverage_carichi",
        "beverage_loads",
        "beverage_load_state",
        ("created_at",),
        ("created_at", "id", "_id"),
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


def _integer(value, *, field: str) -> int:
    parsed = _decimal(value, field=field)
    integral = parsed.to_integral_value()
    if parsed != integral:
        raise ValueError(f"{field} deve essere intero")
    return int(integral)


def _decimal_string(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


def _business_date(value: datetime) -> str:
    return value.astimezone(ROME_TZ).date().isoformat()


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


def warehouse_source_id(document: dict, stream: WarehouseStream) -> str:
    source_id = str(document.get("id") or "").strip()
    if source_id:
        return source_id
    if stream.event_kind == "beverage_inventory_state":
        restaurant_id = str(document.get("restaurant_id") or "").strip()
        sigla = str(document.get("sigla") or "").strip().upper()
        if restaurant_id and sigla:
            return f"beverage-inventory:{restaurant_id}:{sigla}"
    return ""


def _normalize_product(
    document: dict,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("id prodotto mancante")
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
    quantity = _integer(document.get("quantity", 0), field="quantity")
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "product_state",
        "entity_key": f"warehouse-product:{source_id}",
        "product_id": source_id,
        "occurred_at": timestamp,
        "present": True,
        "name": str(document.get("name") or "").strip(),
        "unit": str(document.get("unit") or "").strip(),
        "supplier_name": str(document.get("supplier") or "").strip(),
        "stock_quantity": quantity,
        "baseline_at_epoch": bool(
            created_at is None or created_at < activation_epoch
        ),
        "quality": {
            "state_change_time_known": timestamp_source == "updated_at",
            "timestamp_source": timestamp_source,
            "stock_is_operational_balance": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_stock_movement(
    document: dict,
    *,
    captured_at: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("id movimento mancante")
    product_id = str(document.get("product_id") or "").strip()
    if not product_id:
        raise ValueError("product_id mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    delta = _integer(document.get("delta"), field="delta")
    balance_after = _integer(
        document.get("balance_after"),
        field="balance_after",
    )
    cause = str(document.get("cause") or "").strip()
    meaning = MOVEMENT_MEANINGS.get(cause, "movimento_non_classificato")
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "stock_movement_event",
        "entity_key": f"stock-movement:{source_id}",
        "movement_id": source_id,
        "product_id": product_id,
        "product_name": str(document.get("product_name") or "").strip(),
        "business_date": _business_date(timestamp),
        "occurred_at": timestamp,
        "quantity_before": balance_after - delta,
        "quantity_delta": delta,
        "quantity_after": balance_after,
        "cause": cause,
        "movement_meaning": meaning,
        "reference": {
            "type": str(document.get("ref_type") or "").strip(),
            "id": str(document.get("ref_id") or "").strip(),
        },
        "actor": {
            "id": str(document.get("user_id") or "").strip(),
            "name": str(document.get("user_name") or "").strip(),
            "role": str(document.get("user_role") or "").strip(),
        },
        "note": str(document.get("note") or ""),
        "waste_reason": str(document.get("reason") or ""),
        "quality": {
            "timestamp_source": timestamp_source,
            "authoritative_stock_ledger": True,
            "is_real_consumption": cause == "scarto_admin",
            "logistic_consumption_proxy_eligible": cause == "evasione",
        },
    }
    return source_id, timestamp, fact


def _request_items(document: dict) -> list[dict]:
    normalized = []
    for index, item in enumerate(document.get("items") or []):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] non e un oggetto")
        product_id = str(item.get("product_id") or "").strip()
        if not product_id:
            raise ValueError(f"items[{index}].product_id mancante")
        normalized.append({
            "product_id": product_id,
            "product_name": str(item.get("product_name") or "").strip(),
            "unit": str(item.get("unit") or "").strip(),
            "supplier_name": str(item.get("supplier") or "").strip(),
            "requested_quantity": _integer(
                item.get("quantity"),
                field=f"items[{index}].quantity",
            ),
        })
    return normalized


def _optional_datetime(document: dict, field: str) -> Optional[datetime]:
    value = document.get(field)
    if value in (None, ""):
        return None
    return parse_utc_datetime(value, field=field)


def _normalize_request(
    document: dict,
    *,
    captured_at: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("id richiesta mancante")
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    created_at = parse_utc_datetime(
        document.get("created_at"),
        field="created_at",
    )
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    status = str(document.get("status") or "").strip()
    items = _request_items(document)
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "request_state",
        "entity_key": f"warehouse-request:{source_id}",
        "request_id": source_id,
        "restaurant_id": restaurant_id,
        "restaurant_location": str(
            document.get("restaurant_location") or ""
        ).strip(),
        "business_date": _business_date(created_at),
        "occurred_at": timestamp,
        "created_at": created_at,
        "present": True,
        "ddt_number": document.get("ddt_number"),
        "dispatch_at": _optional_datetime(document, "dispatch_date"),
        "status": status,
        "items": items,
        "line_count": len(items),
        "extra_note": str(document.get("extra_note") or ""),
        "evasa_at": _optional_datetime(document, "evasa_at"),
        "confermata_at": _optional_datetime(document, "confermata_at"),
        "error_reported_at": _optional_datetime(
            document,
            "error_reported_at",
        ),
        "error_reason": str(document.get("error_reason") or ""),
        "logistics": {
            "requested_from_location": True,
            "fulfilled_to_location": status in {
                "evasa",
                "confermata",
                "errore",
            },
            "receipt_confirmed": status == "confermata",
            "delivery_issue_reported": status == "errore",
            "is_real_consumption": False,
        },
        "quality": {
            "timestamp_source": timestamp_source,
            "fulfilled_quantity_assumed_from_request": status in {
                "evasa",
                "confermata",
                "errore",
            },
        },
    }
    return source_id, timestamp, fact


def _warehouse_load_items(document: dict) -> list[dict]:
    normalized = []
    for index, item in enumerate(document.get("items") or []):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] non e un oggetto")
        product_id = str(item.get("product_id") or "").strip()
        if not product_id:
            raise ValueError(f"items[{index}].product_id mancante")
        normalized.append({
            "product_id": product_id,
            "product_name": str(item.get("product_name") or "").strip(),
            "unit": str(item.get("unit") or "").strip(),
            "received_quantity": _integer(
                item.get("quantity_added"),
                field=f"items[{index}].quantity_added",
            ),
        })
    return normalized


def _normalize_warehouse_load(
    document: dict,
    *,
    captured_at: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("id carico mancante")
    created_at = parse_utc_datetime(
        document.get("created_at"),
        field="created_at",
    )
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    items = _warehouse_load_items(document)
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "warehouse_load_state",
        "entity_key": f"warehouse-load:{source_id}",
        "load_id": source_id,
        "business_date": _business_date(created_at),
        "occurred_at": timestamp,
        "created_at": created_at,
        "present": True,
        "supplier_name": str(document.get("supplier_name") or "").strip(),
        "supplier_ddt_number": str(
            document.get("ddt_number_fornitore") or ""
        ).strip(),
        "items": items,
        "line_count": len(items),
        "created_by_id": str(document.get("created_by_id") or "").strip(),
        "movement_meaning": "ricevuto_da_fornitore",
        "quality": {
            "timestamp_source": timestamp_source,
            "structured_ddt_only": True,
            "images_excluded": True,
        },
    }
    return source_id, timestamp, fact


def _normalize_beverage_inventory(
    document: dict,
    *,
    captured_at: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("identita inventario bevanda mancante")
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    sigla = str(document.get("sigla") or "").strip().upper()
    if not restaurant_id or not sigla:
        raise ValueError("restaurant_id o sigla mancante")
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "beverage_inventory_state",
        "entity_key": f"beverage-inventory:{restaurant_id}:{sigla}",
        "restaurant_id": restaurant_id,
        "beverage_code": sigla,
        "occurred_at": timestamp,
        "present": True,
        "quantity_units": _integer(
            document.get("quantity", 0),
            field="quantity",
        ),
        "baseline_at_epoch": timestamp_source == "captured_at",
        "quality": {
            "timestamp_source": timestamp_source,
            "operational_balance_can_be_negative": True,
        },
    }
    return source_id, timestamp, fact


def _beverage_load_items(document: dict) -> list[dict]:
    units_per_case = _integer(
        document.get("units_per_case", 24),
        field="units_per_case",
    )
    normalized = []
    for index, item in enumerate(document.get("items") or []):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] non e un oggetto")
        sigla = str(item.get("sigla") or "").strip().upper()
        if not sigla:
            raise ValueError(f"items[{index}].sigla mancante")
        cases = _integer(
            item.get("cases", item.get("quantity", 0)),
            field=f"items[{index}].cases",
        )
        units = _integer(
            item.get("units", cases * units_per_case),
            field=f"items[{index}].units",
        )
        normalized.append({
            "beverage_code": sigla,
            "received_cases": cases,
            "received_units": units,
            "units_per_case": units_per_case,
            "units_match_cases": units == cases * units_per_case,
        })
    return normalized


def _normalize_beverage_load(
    document: dict,
    *,
    captured_at: datetime,
    stream: WarehouseStream,
) -> tuple[str, datetime, dict]:
    source_id = warehouse_source_id(document, stream)
    if not source_id:
        raise ValueError("id carico bevande mancante")
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    created_at = parse_utc_datetime(
        document.get("created_at"),
        field="created_at",
    )
    timestamp, timestamp_source = _source_timestamp(
        document,
        stream.timestamp_fields,
        captured_at=captured_at,
    )
    items = _beverage_load_items(document)
    fact = {
        "normalizer_version": WAREHOUSE_NORMALIZER_VERSION,
        "fact_kind": "beverage_load_state",
        "entity_key": f"beverage-load:{source_id}",
        "load_id": source_id,
        "restaurant_id": restaurant_id,
        "business_date": _business_date(created_at),
        "occurred_at": timestamp,
        "created_at": created_at,
        "present": True,
        "supplier_name": str(document.get("supplier") or "").strip(),
        "invoice_date": str(document.get("invoice_date") or "").strip(),
        "items": items,
        "line_count": len(items),
        "notes": str(document.get("notes") or ""),
        "created_by_id": str(document.get("created_by") or "").strip(),
        "movement_meaning": "ricevuto_da_fornitore",
        "quality": {
            "timestamp_source": timestamp_source,
            "structured_document_only": True,
            "images_excluded": True,
        },
    }
    return source_id, timestamp, fact


def normalize_warehouse_record(
    document: dict,
    stream: WarehouseStream,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
) -> tuple[str, datetime, dict]:
    if stream.event_kind == "product_state":
        return _normalize_product(
            document,
            captured_at=captured_at,
            activation_epoch=activation_epoch,
            stream=stream,
        )
    if stream.event_kind == "stock_movement_event":
        return _normalize_stock_movement(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "request_state":
        return _normalize_request(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "warehouse_load_state":
        return _normalize_warehouse_load(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "beverage_inventory_state":
        return _normalize_beverage_inventory(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    if stream.event_kind == "beverage_load_state":
        return _normalize_beverage_load(
            document,
            captured_at=captured_at,
            stream=stream,
        )
    raise ValueError(
        f"Tipo evento magazzino non supportato: {stream.event_kind}"
    )


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


async def collect_warehouse_stream(
    source,
    store,
    *,
    epoch: dict,
    stream: WarehouseStream,
    batch_size: int,
    captured_at: Optional[datetime] = None,
) -> dict:
    captured = (captured_at or datetime.now(timezone.utc)).astimezone(
        timezone.utc
    )
    activation_epoch = epoch["activated_at"].astimezone(timezone.utc)
    watermark = await store.get_watermark(epoch["id"], stream.key)
    cycle_id = str(watermark.get("cycle_id") or uuid.uuid4())
    base_query = {}
    if not stream.include_pre_epoch:
        base_query[stream.cursor_fields[0]] = {
            "$gte": activation_epoch.isoformat()
        }
    cursor = watermark.get("cursor") or {}
    after_query = _lexicographic_after_query(
        stream.cursor_fields,
        cursor,
    )
    query = (
        {"$and": [base_query, after_query]}
        if base_query and after_query
        else after_query or base_query
    )
    documents = await source.find_batch(
        stream.collection,
        query,
        None,
        sort=[(field, 1) for field in stream.cursor_fields],
        limit=batch_size,
    )

    inserted = 0
    duplicates = 0
    quarantined = 0
    for document in documents:
        observed_source_id = warehouse_source_id(document, stream)
        if stream.stateful and observed_source_id:
            await store.mark_state_observed(
                fact_collection_name="memory_warehouse_facts",
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_id=observed_source_id,
                cycle_id=cycle_id,
                observed_at=captured,
            )
        try:
            source_id, source_timestamp, fact = normalize_warehouse_record(
                document,
                stream,
                captured_at=captured,
                activation_epoch=activation_epoch,
            )
            result = await store.save_warehouse_version(
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_collection=stream.collection,
                source_id=source_id,
                source_timestamp=source_timestamp,
                captured_at=captured,
                normalized_fact=fact,
                raw_document=document,
            )
            if stream.stateful:
                await store.mark_state_observed(
                    fact_collection_name="memory_warehouse_facts",
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
    if cycle_complete and stream.stateful:
        disappeared = await store.finalize_state_scan(
            fact_collection_name="memory_warehouse_facts",
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
    await store.save_watermark(
        epoch_id=epoch["id"],
        source=stream.key,
        fields={
            "cursor": next_cursor,
            "cycle_id": "" if cycle_complete else cycle_id,
            "cycle_complete": cycle_complete,
            "cycle_completed_at": captured if cycle_complete else None,
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
