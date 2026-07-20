from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

from .config import MemorySettings
from .context import CONTEXT_VERSION, build_calendar_context
from .sources import (
    CONFIGURATION_STREAMS,
    ORDER_STREAMS,
    REPORT_STREAMS,
    WAREHOUSE_STREAMS,
)
from .stores import MemoryMongoStore
from .stores.mongo import classify_authenticated_roles


ROME_TZ = ZoneInfo("Europe/Rome")
SNAPSHOT_VERSION = 1
MAX_FACTS_PER_DOMAIN = 10000


def _closed_business_date(value: Optional[str] = None) -> str:
    if value:
        parsed = date.fromisoformat(value)
    else:
        parsed = datetime.now(ROME_TZ).date() - timedelta(days=1)
    if parsed >= datetime.now(ROME_TZ).date():
        raise ValueError("Gli snapshot automatici accettano solo giornate chiuse")
    return parsed.isoformat()


async def _next_automatic_business_date(
    store: MemoryMongoStore,
    *,
    epoch: dict,
    today_rome: Optional[date] = None,
) -> Optional[str]:
    today = today_rome or datetime.now(ROME_TZ).date()
    first_date = epoch["activated_at"].astimezone(ROME_TZ).date()
    last_closed = today - timedelta(days=1)
    if first_date > last_closed:
        return None
    existing = await store.read_memory_documents(
        "memory_daily_snapshots",
        {
            "epoch_id": epoch["id"],
            "scope_type": "warehouse_global",
            "scope_id": "warehouse",
            "is_current": True,
        },
        {"_id": 0, "business_date": 1},
        limit=10000,
    )
    built_dates = {
        item["business_date"]
        for item in existing
        if item.get("business_date")
    }
    candidate = first_date
    while candidate <= last_closed:
        if candidate.isoformat() not in built_dates:
            return candidate.isoformat()
        candidate += timedelta(days=1)
    return last_closed.isoformat()


def _date_end_utc(business_date: str) -> datetime:
    parsed = date.fromisoformat(business_date)
    return datetime.combine(
        parsed + timedelta(days=1),
        time.min,
        tzinfo=ROME_TZ,
    ).astimezone(timezone.utc)


def _state_at_end_of_day(query: dict, business_date: str) -> dict:
    day_end = _date_end_utc(business_date)
    return {
        **query,
        "valid_from": {"$lt": day_end},
        "$or": [
            {"valid_to": None},
            {"valid_to": {"$gte": day_end}},
        ],
    }


def _fact_reference(collection: str, fact: dict) -> dict:
    return {
        "collection": collection,
        "fact_id": fact.get("id"),
        "fact_kind": fact.get("fact_kind"),
        "raw_version_id": fact.get("raw_version_id"),
        "source_id": fact.get("source_id"),
    }


def _fact_references(collection: str, facts: Iterable[dict]) -> list[dict]:
    return [_fact_reference(collection, fact) for fact in facts]


def _coverage_for_domain(
    watermarks: dict[str, dict],
    stream_keys: Iterable[str],
    *,
    day_end: datetime,
) -> dict:
    missing = []
    incomplete = []
    stale = []
    for key in stream_keys:
        watermark = watermarks.get(key)
        if not watermark:
            missing.append(key)
            continue
        if (
            "cycle_complete" in watermark
            and watermark.get("cycle_complete") is not True
        ):
            incomplete.append(key)
        success = watermark.get("last_success_at")
        if not isinstance(success, datetime) or success < day_end:
            stale.append(key)
    return {
        "status": (
            "covered"
            if not missing and not incomplete and not stale
            else "partial"
        ),
        "expected_streams": list(stream_keys),
        "missing_watermarks": missing,
        "incomplete_cycles": incomplete,
        "stale_watermarks": stale,
    }


def _paste_summary(cash: Optional[dict]) -> dict:
    if not cash:
        return {
            "status": "missing",
            "total_count": None,
            "recognized_count": None,
            "manual_count": None,
            "missing_price_count": None,
            "by_code": {},
            "total_value_cents": None,
        }
    paste = cash.get("paste") or {}
    lines = paste.get("lines") or []
    by_code = Counter(
        line["recognized_sigla"]
        for line in lines
        if line.get("recognized_sigla")
    )
    return {
        "status": "available",
        "total_count": paste.get("total_count"),
        "recognized_count": paste.get("recognized_count"),
        "manual_count": sum(
            1 for line in lines
            if line.get("price_source") == "manual"
        ),
        "missing_price_count": paste.get("missing_price_count"),
        "by_code": dict(sorted(by_code.items())),
        "total_value_cents": paste.get("operational_total_cents"),
        "dictionary": paste.get("dictionary") or {},
    }


def _beverage_summary(
    facts: list[dict],
    *,
    expected_codes: set[str],
    applicable: bool,
) -> dict:
    rows = {}
    revenue = 0
    unknown_revenue = []
    for fact in facts:
        code = str(
            fact.get("beverage_code") or fact.get("sigla") or ""
        ).strip().upper()
        if not code:
            continue
        rows[code] = {
            "sold_quantity_decimal": fact.get("sold_quantity_decimal"),
            "revenue_cents": fact.get("revenue_cents"),
            "unit_price_cents": fact.get("unit_price_cents"),
            "waste": (
                (fact.get("inventory_fields") or {}).get("scarti")
            ),
        }
        if fact.get("revenue_cents") is None:
            unknown_revenue.append(code)
        else:
            revenue += int(fact["revenue_cents"])
    observed_codes = set(rows)
    if not applicable:
        status = "not_applicable"
        missing_codes = []
    else:
        missing_codes = sorted(expected_codes - observed_codes)
        status = (
            "complete"
            if not missing_codes and not unknown_revenue
            else "partial"
        )
    return {
        "status": status,
        "applicable": applicable,
        "expected_codes": sorted(expected_codes) if applicable else [],
        "observed_codes": sorted(observed_codes),
        "missing_codes": missing_codes,
        "unknown_revenue_codes": sorted(unknown_revenue),
        "rows": dict(sorted(rows.items())),
        "observed_revenue_cents": revenue,
    }


def _orders_summary(
    states: list[dict],
    deletions: list[dict],
    modifications: list[dict],
) -> dict:
    deleted_entities = {
        item.get("entity_key")
        for item in deletions
        if item.get("entity_key")
    }
    valid = [
        item for item in states
        if item.get("entity_key") not in deleted_entities
    ]
    status_counts = Counter(
        str(item.get("status") or "unknown")
        for item in valid
    )
    return {
        "valid_count": len(valid),
        "deleted_count": len(deleted_entities),
        "modification_event_count": len(modifications),
        "status_counts": dict(sorted(status_counts.items())),
        "quality": {
            "deletions_excluded_from_valid_count": True,
            "modification_business_date_may_use_event_time": True,
        },
    }


def _request_summary(
    states: list[dict],
    disappearances: list[dict],
    movements: list[dict],
) -> dict:
    statuses = Counter(
        str(item.get("status") or "unknown")
        for item in states
    )
    requested = defaultdict(int)
    fulfilled = defaultdict(int)
    durations = []
    for state in states:
        fulfilled_state = (state.get("logistics") or {}).get(
            "fulfilled_to_location",
            False,
        )
        for item in state.get("items") or []:
            product_id = str(item.get("product_id") or "")
            quantity = int(item.get("requested_quantity") or 0)
            requested[product_id] += quantity
            if fulfilled_state:
                fulfilled[product_id] += quantity
        created_at = state.get("created_at")
        evasa_at = state.get("evasa_at")
        if isinstance(created_at, datetime) and isinstance(evasa_at, datetime):
            durations.append(max(0, int((evasa_at - created_at).total_seconds())))
    movement_delta = defaultdict(int)
    for movement in movements:
        movement_delta[str(movement.get("product_id") or "")] += int(
            movement.get("quantity_delta") or 0
        )
    return {
        "current_request_count": len(states),
        "physically_deleted_count": len(disappearances),
        "status_counts": dict(sorted(statuses.items())),
        "requested_by_product": dict(sorted(requested.items())),
        "fulfilled_by_product": dict(sorted(fulfilled.items())),
        "stock_delta_by_product": dict(sorted(movement_delta.items())),
        "average_fulfillment_seconds": (
            round(sum(durations) / len(durations))
            if durations
            else None
        ),
        "quality": {
            "fulfilled_is_logistics_not_real_consumption": True,
            "deleted_reason_available": False,
        },
    }


async def _read(
    store: MemoryMongoStore,
    collection: str,
    query: dict,
    *,
    sort: Optional[list[tuple[str, int]]] = None,
    limit: int = MAX_FACTS_PER_DOMAIN,
) -> list[dict]:
    return await store.read_memory_documents(
        collection,
        query,
        {"_id": 0},
        sort=sort,
        limit=limit,
    )


async def _restaurant_snapshot(
    store: MemoryMongoStore,
    *,
    epoch: dict,
    business_date: str,
    restaurant_id: str,
    configuration: Optional[dict],
    context_id: str,
    watermarks: dict[str, dict],
    expected_beverage_codes: set[str],
    captured_at: datetime,
) -> tuple[dict, list[dict]]:
    common = {
        "epoch_id": epoch["id"],
        "restaurant_id": restaurant_id,
        "business_date": business_date,
    }
    cash_rows = await _read(
        store,
        "memory_report_facts",
        {
            **common,
            "fact_kind": "cash_daily_state",
            "valid_to": None,
        },
        sort=[("valid_from", -1)],
        limit=2,
    )
    cash = cash_rows[0] if cash_rows else None
    beverages = await _read(
        store,
        "memory_report_facts",
        {
            **common,
            "fact_kind": "beverage_daily_state",
            "valid_to": None,
        },
    )
    audit = await _read(
        store,
        "memory_report_facts",
        {
            **common,
            "fact_kind": "report_audit_event",
        },
    )
    order_states = await _read(
        store,
        "memory_order_facts",
        {
            **common,
            "fact_kind": "order_state",
            "valid_to": None,
        },
    )
    order_deletions = await _read(
        store,
        "memory_order_facts",
        {
            **common,
            "fact_kind": "order_deleted",
        },
    )
    order_modifications = await _read(
        store,
        "memory_order_facts",
        {
            **common,
            "fact_kind": "order_modified",
        },
    )
    requests = await _read(
        store,
        "memory_warehouse_facts",
        {
            **common,
            "fact_kind": "request_state",
            "valid_to": None,
        },
    )
    request_disappearances = await _read(
        store,
        "memory_warehouse_facts",
        {
            **common,
            "fact_kind": "source_state_disappeared",
            "state_fact_kind": "request_state",
        },
    )
    request_ids = {
        item.get("request_id")
        for item in [*requests, *request_disappearances]
        if item.get("request_id")
    }
    request_movements = (
        await _read(
            store,
            "memory_warehouse_facts",
            {
                "epoch_id": epoch["id"],
                "business_date": business_date,
                "fact_kind": "stock_movement_event",
                "reference.type": "richiesta",
                "reference.id": {"$in": sorted(request_ids)},
            },
        )
        if request_ids
        else []
    )
    beverage_loads = await _read(
        store,
        "memory_warehouse_facts",
        {
            **common,
            "fact_kind": "beverage_load_state",
            "valid_to": None,
        },
    )

    username = str((configuration or {}).get("username") or "")
    location = str((configuration or {}).get("location") or "")
    beverage_applicable = (
        username.casefold() == "flaminio"
        or location.casefold() == "flaminio"
    )
    beverage_summary = _beverage_summary(
        beverages,
        expected_codes=expected_beverage_codes,
        applicable=beverage_applicable,
    )
    cash_before_beverages = (
        cash.get("cash_before_beverages_cents")
        if cash
        else None
    )
    cash_sera = None
    if cash_before_beverages is not None and beverage_summary["status"] in {
        "complete",
        "not_applicable",
    }:
        cash_sera = int(cash_before_beverages) + int(
            beverage_summary["observed_revenue_cents"]
        )

    day_end = _date_end_utc(business_date)
    domain_coverage = {
        "orders": _coverage_for_domain(
            watermarks,
            (stream.key for stream in ORDER_STREAMS),
            day_end=day_end,
        ),
        "report": _coverage_for_domain(
            watermarks,
            (stream.key for stream in REPORT_STREAMS),
            day_end=day_end,
        ),
        "warehouse": _coverage_for_domain(
            watermarks,
            (stream.key for stream in WAREHOUSE_STREAMS),
            day_end=day_end,
        ),
        "configuration": _coverage_for_domain(
            watermarks,
            (stream.key for stream in CONFIGURATION_STREAMS),
            day_end=day_end,
        ),
    }
    gaps = []
    if configuration is None:
        gaps.append({
            "code": "restaurant_configuration_missing",
            "severity": "error",
            "details": {},
        })
    if cash is None:
        gaps.append({
            "code": "cash_daily_missing",
            "severity": "error",
            "details": {},
        })
    if beverage_summary["status"] == "partial":
        gaps.append({
            "code": "beverage_daily_partial",
            "severity": "warning",
            "details": {
                "missing_codes": beverage_summary["missing_codes"],
                "unknown_revenue_codes": beverage_summary[
                    "unknown_revenue_codes"
                ],
            },
        })
    for domain, coverage in domain_coverage.items():
        if coverage["status"] != "covered":
            gaps.append({
                "code": f"{domain}_coverage_partial",
                "severity": "warning",
                "details": coverage,
            })
    activation = epoch["activated_at"].astimezone(ROME_TZ)
    if activation.date().isoformat() == business_date and activation.time() > time.min:
        gaps.append({
            "code": "epoch_started_during_business_day",
            "severity": "warning",
            "details": {"activated_at": activation.isoformat()},
        })
    coverage_status = "complete" if not gaps else "partial"

    source_facts = [
        *_fact_references("memory_configuration_versions", [configuration] if configuration else []),
        *_fact_references("memory_report_facts", cash_rows),
        *_fact_references("memory_report_facts", beverages),
        *_fact_references("memory_report_facts", audit),
        *_fact_references("memory_order_facts", order_states),
        *_fact_references("memory_order_facts", order_deletions),
        *_fact_references("memory_order_facts", order_modifications),
        *_fact_references("memory_warehouse_facts", requests),
        *_fact_references("memory_warehouse_facts", request_disappearances),
        *_fact_references("memory_warehouse_facts", request_movements),
        *_fact_references("memory_warehouse_facts", beverage_loads),
    ]
    snapshot = {
        "snapshot_version": SNAPSHOT_VERSION,
        "scope": {
            "type": "restaurant",
            "id": restaurant_id,
            "name": (
                (configuration or {}).get("location")
                or (configuration or {}).get("username")
                or restaurant_id
            ),
        },
        "business_date": business_date,
        "context_id": context_id,
        "configuration": {
            "available": configuration is not None,
            "fact_id": (configuration or {}).get("id"),
            "location": (configuration or {}).get("location"),
            "boiler_count": (configuration or {}).get("boiler_count"),
            "report_code": (configuration or {}).get("report_code"),
        },
        "orders": _orders_summary(
            order_states,
            order_deletions,
            order_modifications,
        ),
        "paste": _paste_summary(cash),
        "cash": {
            "status": "available" if cash else "missing",
            "cash_base_cents": (cash or {}).get("cash_base_cents"),
            "spicci_total_cents": (
                ((cash or {}).get("spicci") or {}).get("total_cents")
            ),
            "cassetto_total_cents": (
                ((cash or {}).get("cassetto") or {}).get(
                    "stock_total_cents"
                )
            ),
            "cash_before_beverages_cents": cash_before_beverages,
            "cash_sera_cents": cash_sera,
            "cash_sera_status": (
                "complete"
                if cash_sera is not None
                else "unavailable"
            ),
        },
        "beverages": beverage_summary,
        "report_audit": {
            "event_count": len(audit),
            "manual_change_count": sum(
                int(item.get("changes_count") or 1)
                for item in audit
            ),
        },
        "warehouse": {
            "requests": _request_summary(
                requests,
                request_disappearances,
                request_movements,
            ),
            "beverage_load_count": len(beverage_loads),
        },
        "coverage": {
            "status": coverage_status,
            "domains": domain_coverage,
            "gap_codes": [item["code"] for item in gaps],
        },
        "provenance": {
            "context_id": context_id,
            "source_fact_count": len(source_facts),
            "source_facts": source_facts,
            "rules": [
                {"name": "snapshot", "version": SNAPSHOT_VERSION},
                {"name": "calendar_context", "version": CONTEXT_VERSION},
                {"name": "cash_sera", "version": 1},
            ],
        },
    }
    return snapshot, gaps


async def _warehouse_global_snapshot(
    store: MemoryMongoStore,
    *,
    epoch: dict,
    business_date: str,
    context_id: str,
    watermarks: dict[str, dict],
) -> tuple[dict, list[dict]]:
    movements = await _read(
        store,
        "memory_warehouse_facts",
        {
            "epoch_id": epoch["id"],
            "business_date": business_date,
            "fact_kind": "stock_movement_event",
        },
    )
    loads = await _read(
        store,
        "memory_warehouse_facts",
        {
            "epoch_id": epoch["id"],
            "business_date": business_date,
            "fact_kind": "warehouse_load_state",
            "valid_to": None,
        },
    )
    load_disappearances = await _read(
        store,
        "memory_warehouse_facts",
        {
            "epoch_id": epoch["id"],
            "business_date": business_date,
            "fact_kind": "source_state_disappeared",
            "state_fact_kind": "warehouse_load_state",
        },
    )
    meaning_counts = Counter(
        str(item.get("movement_meaning") or "unknown")
        for item in movements
    )
    delta_by_product = defaultdict(int)
    for item in movements:
        delta_by_product[str(item.get("product_id") or "")] += int(
            item.get("quantity_delta") or 0
        )
    coverage = _coverage_for_domain(
        watermarks,
        (stream.key for stream in WAREHOUSE_STREAMS),
        day_end=_date_end_utc(business_date),
    )
    gaps = []
    if coverage["status"] != "covered":
        gaps.append({
            "code": "warehouse_coverage_partial",
            "severity": "warning",
            "details": coverage,
        })
    facts = [
        *_fact_references("memory_warehouse_facts", movements),
        *_fact_references("memory_warehouse_facts", loads),
        *_fact_references(
            "memory_warehouse_facts",
            load_disappearances,
        ),
    ]
    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "scope": {
            "type": "warehouse_global",
            "id": "warehouse",
            "name": "Magazzino centrale",
        },
        "business_date": business_date,
        "context_id": context_id,
        "movements": {
            "count": len(movements),
            "by_meaning": dict(sorted(meaning_counts.items())),
            "net_delta_by_product": dict(sorted(delta_by_product.items())),
            "is_real_consumption": False,
        },
        "loads": {
            "current_count": len(loads),
            "physically_deleted_count": len(load_disappearances),
        },
        "coverage": {
            "status": "complete" if not gaps else "partial",
            "domains": {"warehouse": coverage},
            "gap_codes": [item["code"] for item in gaps],
        },
        "provenance": {
            "context_id": context_id,
            "source_fact_count": len(facts),
            "source_facts": facts,
            "rules": [
                {"name": "snapshot", "version": SNAPSHOT_VERSION},
                {"name": "calendar_context", "version": CONTEXT_VERSION},
            ],
        },
    }, gaps


async def build_daily_snapshots(
    settings: MemorySettings,
    *,
    business_date: Optional[str] = None,
) -> dict:
    settings.require_collection_activation()
    selected_date = (
        _closed_business_date(business_date)
        if business_date
        else None
    )
    store = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    started_at = datetime.now(timezone.utc)
    try:
        await store.ping()
        target_roles = classify_authenticated_roles(
            await store.connection_status(),
            settings.memory_db_name,
        )
        if (
            target_roles["authentication_visible"]
            and not target_roles["write_capable"]
        ):
            raise RuntimeError(
                "La credenziale Mongo Memoria non puo scrivere snapshot"
            )
        if (
            not target_roles["authentication_visible"]
            and not settings.allow_unverified_mongo_roles
        ):
            raise RuntimeError("Ruoli Mongo Memoria non verificabili")
        await store.initialize_schema()
        activation = datetime.fromisoformat(
            settings.activation_epoch_utc.replace("Z", "+00:00")
        ).astimezone(timezone.utc)
        if date.fromisoformat(selected_date) < activation.astimezone(
            ROME_TZ
        ).date():
            raise ValueError("La giornata precede il momento zero")
        epoch = await store.ensure_epoch(
            source_database=settings.source_db_name,
            activated_at=activation,
        )
        if selected_date is None:
            selected_date = await _next_automatic_business_date(
                store,
                epoch=epoch,
            )
            if selected_date is None:
                return {
                    "mode": "build_daily_snapshots",
                    "status": "skipped",
                    "reason": "no_closed_day_since_activation",
                    "started_at_utc": started_at.isoformat(),
                    "finished_at_utc": datetime.now(timezone.utc).isoformat(),
                    "epoch_id": epoch["id"],
                    "snapshots": [],
                    "collections": await store.collection_counts(),
                }
        owner = await store.acquire_collector_lease(
            epoch_id=epoch["id"],
            collector=f"snapshots:{selected_date}",
        )
        try:
            context = build_calendar_context(selected_date)
            context_result = await store.save_daily_context(
                epoch_id=epoch["id"],
                business_date=selected_date,
                context_version=CONTEXT_VERSION,
                context=context,
                captured_at=started_at,
            )
            watermark_docs = await _read(
                store,
                "memory_watermarks",
                {"epoch_id": epoch["id"]},
            )
            watermarks = {
                item["source"]: item
                for item in watermark_docs
                if item.get("source")
            }
            configurations = await _read(
                store,
                "memory_configuration_versions",
                _state_at_end_of_day({
                    "epoch_id": epoch["id"],
                    "fact_kind": "restaurant_configuration_state",
                }, selected_date),
            )
            config_by_id = {
                item["restaurant_id"]: item
                for item in configurations
                if item.get("restaurant_id")
            }
            candidate_ids = {
                item["restaurant_id"]
                for item in configurations
                if item.get("role") == "restaurant"
                and item.get("restaurant_id")
            }
            for collection in (
                "memory_order_facts",
                "memory_report_facts",
                "memory_warehouse_facts",
            ):
                rows = await store.read_memory_documents(
                    collection,
                    {
                        "epoch_id": epoch["id"],
                        "business_date": selected_date,
                        "restaurant_id": {"$nin": [None, ""]},
                    },
                    {"_id": 0, "restaurant_id": 1},
                    limit=MAX_FACTS_PER_DOMAIN,
                )
                candidate_ids.update(
                    item["restaurant_id"]
                    for item in rows
                    if item.get("restaurant_id")
                )
            beverage_catalog = await _read(
                store,
                "memory_configuration_versions",
                _state_at_end_of_day({
                    "epoch_id": epoch["id"],
                    "fact_kind": "beverage_catalog_state",
                }, selected_date),
            )
            expected_beverage_codes = {
                str(item.get("beverage_code") or "").strip().upper()
                for item in beverage_catalog
                if item.get("beverage_code")
            }

            results = []
            complete = 0
            partial = 0
            opened_gaps = 0
            resolved_gaps = 0
            for restaurant_id in sorted(candidate_ids):
                snapshot, gaps = await _restaurant_snapshot(
                    store,
                    epoch=epoch,
                    business_date=selected_date,
                    restaurant_id=restaurant_id,
                    configuration=config_by_id.get(restaurant_id),
                    context_id=context_result["id"],
                    watermarks=watermarks,
                    expected_beverage_codes=expected_beverage_codes,
                    captured_at=started_at,
                )
                saved = await store.save_daily_snapshot(
                    epoch_id=epoch["id"],
                    scope_type="restaurant",
                    scope_id=restaurant_id,
                    business_date=selected_date,
                    snapshot=snapshot,
                    captured_at=started_at,
                )
                gap_result = await store.sync_snapshot_gaps(
                    epoch_id=epoch["id"],
                    scope_type="restaurant",
                    scope_id=restaurant_id,
                    business_date=selected_date,
                    snapshot_id=saved["id"],
                    gaps=gaps,
                    observed_at=started_at,
                )
                opened_gaps += gap_result["opened"]
                resolved_gaps += gap_result["resolved"]
                status = snapshot["coverage"]["status"]
                complete += int(status == "complete")
                partial += int(status != "complete")
                results.append({
                    "scope_type": "restaurant",
                    "scope_id": restaurant_id,
                    "status": status,
                    **saved,
                    "gaps": gap_result,
                })

            global_snapshot, global_gaps = await _warehouse_global_snapshot(
                store,
                epoch=epoch,
                business_date=selected_date,
                context_id=context_result["id"],
                watermarks=watermarks,
            )
            global_saved = await store.save_daily_snapshot(
                epoch_id=epoch["id"],
                scope_type="warehouse_global",
                scope_id="warehouse",
                business_date=selected_date,
                snapshot=global_snapshot,
                captured_at=started_at,
            )
            global_gap_result = await store.sync_snapshot_gaps(
                epoch_id=epoch["id"],
                scope_type="warehouse_global",
                scope_id="warehouse",
                business_date=selected_date,
                snapshot_id=global_saved["id"],
                gaps=global_gaps,
                observed_at=started_at,
            )
            opened_gaps += global_gap_result["opened"]
            resolved_gaps += global_gap_result["resolved"]
            global_status = global_snapshot["coverage"]["status"]
            complete += int(global_status == "complete")
            partial += int(global_status != "complete")
            results.append({
                "scope_type": "warehouse_global",
                "scope_id": "warehouse",
                "status": global_status,
                **global_saved,
                "gaps": global_gap_result,
            })
        finally:
            await store.release_collector_lease(
                epoch_id=epoch["id"],
                collector=f"snapshots:{selected_date}",
                owner_id=owner,
            )
        finished_at = datetime.now(timezone.utc)
        integrity = {
            "kind": "daily_snapshot_build",
            "business_date": selected_date,
            "status": "complete" if partial == 0 else "partial",
            "snapshot_count": len(results),
            "complete_count": complete,
            "partial_count": partial,
            "gaps_opened": opened_gaps,
            "gaps_resolved": resolved_gaps,
        }
        integrity_run_id = await store.save_integrity_run(
            epoch_id=epoch["id"],
            started_at=started_at,
            finished_at=finished_at,
            result=integrity,
        )
        return {
            "mode": "build_daily_snapshots",
            "business_date": selected_date,
            "started_at_utc": started_at.isoformat(),
            "finished_at_utc": finished_at.isoformat(),
            "epoch_id": epoch["id"],
            "context": context_result,
            "integrity_run_id": integrity_run_id,
            "summary": integrity,
            "snapshots": results,
            "collections": await store.collection_counts(),
        }
    finally:
        store.close()
