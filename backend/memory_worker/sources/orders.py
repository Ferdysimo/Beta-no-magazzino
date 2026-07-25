import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from annotation_semantics import (
    extract_pasta_annotation,
    normalize_annotation_target,
)

ROME_TZ = ZoneInfo("Europe/Rome")
ORDER_NORMALIZER_VERSION = 2
DEFAULT_MEMORY_PASTA_CODES = (
    "AMAT",
    "CACIO",
    "CARB",
    "CARZUC",
    "PESTO",
    "POM",
    "RAGU",
    "TART",
)


@dataclass(frozen=True)
class OrderStream:
    key: str
    collection: str
    logical_stream: str
    event_kind: str
    timestamp_field: str
    cyclic_scan: bool = False
    include_pre_epoch: bool = False
    baseline_active_at_epoch: bool = False


ORDER_STREAMS = (
    OrderStream(
        "orders_active",
        "orders",
        "orders",
        "order_state",
        "created_at",
        cyclic_scan=True,
        include_pre_epoch=True,
        baseline_active_at_epoch=True,
    ),
    OrderStream(
        "orders_archived",
        "archived_orders",
        "orders",
        "order_state",
        "created_at",
        cyclic_scan=True,
    ),
    OrderStream(
        "order_deletions_active",
        "deletion_logs",
        "order_deletions",
        "order_deleted",
        "deleted_at",
    ),
    OrderStream(
        "order_deletions_archived",
        "archived_deletion_logs",
        "order_deletions",
        "order_deleted",
        "deleted_at",
        cyclic_scan=True,
    ),
    OrderStream(
        "order_modifications_active",
        "modification_logs",
        "order_modifications",
        "order_modified",
        "modified_at",
    ),
    OrderStream(
        "order_modifications_archived",
        "archived_modification_logs",
        "order_modifications",
        "order_modified",
        "modified_at",
        cyclic_scan=True,
    ),
)


def parse_utc_datetime(value, *, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} non contiene una data ISO valida") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} non contiene il fuso orario")
    return parsed.astimezone(timezone.utc)


def _business_date(value: datetime) -> str:
    return value.astimezone(ROME_TZ).date().isoformat()


def _order_identity(
    restaurant_id: str,
    created_at: datetime,
    order_number,
) -> str:
    canonical = (
        f"{restaurant_id}|{created_at.isoformat(timespec='microseconds')}|"
        f"{order_number}"
    )
    return f"order:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def pasta_annotation_aliases_from_documents(
    documents: list[dict],
) -> dict[str, str]:
    aliases = {}
    for item in documents or []:
        if item.get("active") is False:
            continue
        alias = normalize_annotation_target(item.get("alias_normalized") or "")
        canonical = normalize_annotation_target(
            item.get("canonical_normalized") or ""
        )
        if alias and canonical and alias != canonical:
            aliases[alias] = canonical
    return aliases


def _memory_annotation(
    description: str,
    target_aliases: Optional[dict[str, str]] = None,
) -> Optional[dict]:
    return extract_pasta_annotation(
        description,
        DEFAULT_MEMORY_PASTA_CODES,
        target_aliases=target_aliases,
    )


def normalize_order_record(
    document: dict,
    stream: OrderStream,
    *,
    captured_at: datetime,
    activation_epoch: datetime,
    target_aliases: Optional[dict[str, str]] = None,
) -> tuple[str, datetime, dict]:
    restaurant_id = str(document.get("restaurant_id") or "").strip()
    if not restaurant_id:
        raise ValueError("restaurant_id mancante")
    source_id = str(document.get("id") or "").strip()
    if not source_id:
        raise ValueError("id sorgente mancante")
    source_timestamp = parse_utc_datetime(
        document.get(stream.timestamp_field),
        field=stream.timestamp_field,
    )

    if stream.event_kind == "order_state":
        created_at = parse_utc_datetime(
            document.get("created_at"),
            field="created_at",
        )
        order_number = document.get("order_number")
        if order_number in (None, ""):
            raise ValueError("order_number mancante")
        entity_key = _order_identity(
            restaurant_id,
            created_at,
            order_number,
        )
        description = str(document.get("description") or "")
        fact = {
            "normalizer_version": ORDER_NORMALIZER_VERSION,
            "fact_kind": "order_state",
            "entity_key": entity_key,
            "order_id": source_id,
            "restaurant_id": restaurant_id,
            "business_date": _business_date(created_at),
            "occurred_at": created_at,
            "order_number": order_number,
            "description": description,
            "pasta_annotation": _memory_annotation(
                description,
                target_aliases,
            ),
            "annotation_quality": {
                "dictionary_source": "worker_default_codes",
                "restaurant_overrides_applied": False,
                "raw_description_replayable": True,
            },
            "status": str(document.get("status") or ""),
            "timer_started": bool(document.get("timer_started", False)),
            "timer_paused": bool(document.get("timer_paused", False)),
            "timer_elapsed": document.get("timer_elapsed", 0),
            "kitchen_completed": bool(document.get("kitchen_completed", False)),
            "monitor_visible": bool(document.get("monitor_visible", False)),
            "hidden_generale": bool(document.get("hidden_generale", False)),
            "baseline_active_at_epoch": (
                stream.baseline_active_at_epoch and created_at < activation_epoch
            ),
            "quality": {
                "state_change_time_known": False,
                "state_observed_at": captured_at,
            },
        }
        return source_id, source_timestamp, fact

    if stream.event_kind == "order_deleted":
        original_created_at = parse_utc_datetime(
            document.get("original_created_at"),
            field="original_created_at",
        )
        order_number = document.get("order_number")
        if order_number in (None, ""):
            raise ValueError("order_number mancante")
        description = str(document.get("description") or "")
        fact = {
            "normalizer_version": ORDER_NORMALIZER_VERSION,
            "fact_kind": "order_deleted",
            "entity_key": _order_identity(
                restaurant_id,
                original_created_at,
                order_number,
            ),
            "deletion_log_id": source_id,
            "restaurant_id": restaurant_id,
            "business_date": _business_date(original_created_at),
            "occurred_at": source_timestamp,
            "original_created_at": original_created_at,
            "order_number": order_number,
            "description": description,
            "pasta_annotation": _memory_annotation(
                description,
                target_aliases,
            ),
            "quality": {"original_order_id_available": False},
        }
        return source_id, source_timestamp, fact

    if stream.event_kind == "order_modified":
        related_order_id = str(document.get("order_id") or "").strip()
        entity_seed = related_order_id or (
            f"{restaurant_id}|{document.get('order_number')}|{source_id}"
        )
        old_description = str(document.get("old_description") or "")
        new_description = str(document.get("new_description") or "")
        fact = {
            "normalizer_version": ORDER_NORMALIZER_VERSION,
            "fact_kind": "order_modified",
            "entity_key": (
                f"order-id:{related_order_id}"
                if related_order_id
                else f"order-modification:{hashlib.sha256(entity_seed.encode('utf-8')).hexdigest()}"
            ),
            "modification_log_id": source_id,
            "related_order_id": related_order_id or None,
            "restaurant_id": restaurant_id,
            "business_date": _business_date(source_timestamp),
            "occurred_at": source_timestamp,
            "order_number": document.get("order_number"),
            "old_description": old_description,
            "new_description": new_description,
            "old_pasta_annotation": _memory_annotation(
                old_description,
                target_aliases,
            ),
            "new_pasta_annotation": _memory_annotation(
                new_description,
                target_aliases,
            ),
            "quality": {
                "original_created_at_available": False,
                "business_date_uses_modification_time": True,
            },
        }
        return source_id, source_timestamp, fact

    raise ValueError(f"Tipo evento ordini non supportato: {stream.event_kind}")


async def collect_order_stream(
    source,
    store,
    *,
    epoch: dict,
    stream: OrderStream,
    batch_size: int,
    captured_at: Optional[datetime] = None,
    target_aliases: Optional[dict[str, str]] = None,
) -> dict:
    captured = (captured_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    activation_epoch = epoch["activated_at"].astimezone(timezone.utc)
    watermark = await store.get_watermark(epoch["id"], stream.key)

    if stream.cyclic_scan:
        cursor_after_id = str(watermark.get("cursor_after_id") or "")
        query = {}
        if cursor_after_id:
            query["id"] = {"$gt": cursor_after_id}
        if not stream.include_pre_epoch:
            query[stream.timestamp_field] = {"$gte": activation_epoch.isoformat()}
        documents = await source.find_batch(
            stream.collection,
            query,
            {"_id": 0},
            sort=[("id", 1)],
            limit=batch_size,
        )
    else:
        last_seen_at = watermark.get("last_seen_at")
        if isinstance(last_seen_at, datetime):
            last_seen_value = last_seen_at.astimezone(timezone.utc).isoformat()
        else:
            last_seen_value = (
                str(last_seen_at) if last_seen_at else activation_epoch.isoformat()
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
            {"_id": 0},
            sort=[(stream.timestamp_field, 1), ("id", 1)],
            limit=batch_size,
        )

    inserted = 0
    duplicates = 0
    quarantined = 0
    for document in documents:
        try:
            source_id, source_timestamp, fact = normalize_order_record(
                document,
                stream,
                captured_at=captured,
                activation_epoch=activation_epoch,
                target_aliases=target_aliases,
            )
            result = await store.save_order_version(
                epoch_id=epoch["id"],
                logical_stream=stream.logical_stream,
                source_collection=stream.collection,
                source_id=source_id,
                source_timestamp=source_timestamp,
                captured_at=captured,
                normalized_fact=fact,
                raw_document=document,
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
        next_cursor = "" if cycle_complete else str(documents[-1].get("id") or "")
        watermark_fields = {
            "cursor_after_id": next_cursor,
            "cycle_complete": cycle_complete,
            "cycle_completed_at": captured if cycle_complete else None,
        }
    else:
        watermark_fields = {}
        if documents:
            last_document = documents[-1]
            watermark_fields = {
                "last_seen_at": parse_utc_datetime(
                    last_document.get(stream.timestamp_field),
                    field=stream.timestamp_field,
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
            {"cycle_complete": watermark_fields["cycle_complete"]}
            if stream.cyclic_scan
            else {}
        ),
    }
