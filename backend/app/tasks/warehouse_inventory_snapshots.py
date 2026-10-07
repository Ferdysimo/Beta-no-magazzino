import asyncio
import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from app.core.database import db
from app.core.time import ROME_TZ


logger = logging.getLogger(__name__)

SNAPSHOT_HOUR_ROME = 6
ON_TIME_GRACE_SECONDS = 90
RETRY_SECONDS = 300


def _scheduled_at_rome(business_date: date) -> datetime:
    return datetime.combine(
        business_date,
        time(hour=SNAPSHOT_HOUR_ROME),
        tzinfo=ROME_TZ,
    )


def _seconds_until(target_rome: datetime, now_rome: datetime) -> float:
    return (
        target_rome.astimezone(timezone.utc)
        - now_rome.astimezone(timezone.utc)
    ).total_seconds()


def _parse_iso_datetime(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def capture_warehouse_inventory_snapshot(
    *,
    business_date: Optional[date] = None,
    now_rome: Optional[datetime] = None,
    trigger: str = "scheduler",
) -> dict:
    """Persist one immutable inventory picture for 06:00 Europe/Rome."""
    observed_rome = now_rome or datetime.now(ROME_TZ)
    if observed_rome.tzinfo is None:
        observed_rome = observed_rome.replace(tzinfo=ROME_TZ)
    else:
        observed_rome = observed_rome.astimezone(ROME_TZ)

    selected_date = business_date or observed_rome.date()
    scheduled_rome = _scheduled_at_rome(selected_date)
    if observed_rome < scheduled_rome:
        raise ValueError("La fotografia non può essere acquisita prima delle 06:00")

    date_rome = selected_date.isoformat()
    existing = await db.warehouse_inventory_snapshots.find_one(
        {"business_date": date_rome},
        {"_id": 0, "id": 1, "business_date": 1},
    )
    if existing:
        return {"created": False, "snapshot_id": existing.get("id"), "business_date": date_rome}

    products = await db.products.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "quantity": 1,
            "unit": 1,
            "supplier": 1,
            "created_at": 1,
        },
    ).sort("name", 1).to_list(5000)

    captured_at_utc = observed_rome.astimezone(timezone.utc)
    scheduled_at_utc = scheduled_rome.astimezone(timezone.utc)
    delay_seconds = max(0, int((observed_rome - scheduled_rome).total_seconds()))
    reconstructed = delay_seconds > ON_TIME_GRACE_SECONDS
    movement_count = 0
    delta_by_product = defaultdict(int)

    if reconstructed:
        movements = await db.stock_movements.find(
            {
                "timestamp": {
                    "$gte": scheduled_at_utc.isoformat(),
                    "$lte": captured_at_utc.isoformat(),
                },
            },
            {"_id": 0, "product_id": 1, "delta": 1},
        ).to_list(100000)
        movement_count = len(movements)
        for movement in movements:
            product_id = str(movement.get("product_id") or "")
            if product_id:
                delta_by_product[product_id] += int(movement.get("delta") or 0)

    snapshot_products = []
    for product in products:
        product_id = str(product.get("id") or "")
        if not product_id:
            continue
        created_at = _parse_iso_datetime(product.get("created_at"))
        if reconstructed and created_at and created_at > scheduled_at_utc:
            continue
        current_quantity = int(product.get("quantity") or 0)
        quantity_at_six = current_quantity - delta_by_product.get(product_id, 0)
        snapshot_products.append({
            "product_id": product_id,
            "product_name": product.get("name") or "",
            "quantity": quantity_at_six,
            "unit": product.get("unit") or "",
            "supplier": product.get("supplier") or "",
        })

    snapshot_id = f"warehouse-inventory-{date_rome}"
    document = {
        "id": snapshot_id,
        "business_date": date_rome,
        "scheduled_at": scheduled_rome.isoformat(),
        "captured_at": captured_at_utc.isoformat(),
        "capture_trigger": trigger,
        "data_quality": (
            "reconstructed_from_ledger" if reconstructed else "point_in_time"
        ),
        "capture_delay_seconds": delay_seconds,
        "movement_count_used": movement_count,
        "product_count": len(snapshot_products),
        "products": snapshot_products,
        "notes": (
            ["La ricostruzione usa lo stock corrente meno i movimenti registrati dopo le 06:00."]
            if reconstructed else []
        ),
    }
    result = await db.warehouse_inventory_snapshots.update_one(
        {"business_date": date_rome},
        {"$setOnInsert": document},
        upsert=True,
    )
    created = result.upserted_id is not None
    return {"created": created, "snapshot_id": snapshot_id, "business_date": date_rome}


async def warehouse_inventory_snapshot_scheduler() -> None:
    """Capture at 06:00 Rome time and recover a missing current-day snapshot."""
    first_cycle = True
    while True:
        now_rome = datetime.now(ROME_TZ)
        scheduled_today = _scheduled_at_rome(now_rome.date())
        if now_rome < scheduled_today:
            await asyncio.sleep(_seconds_until(scheduled_today, now_rome))
            first_cycle = False
            continue

        trigger = "startup_recovery" if first_cycle else "scheduler"
        try:
            result = await capture_warehouse_inventory_snapshot(
                business_date=now_rome.date(),
                now_rome=now_rome,
                trigger=trigger,
            )
            logger.info("[WAREHOUSE_SNAPSHOT] %s", result)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "[WAREHOUSE_SNAPSHOT] capture failed; retry in %s seconds: %s",
                RETRY_SECONDS,
                exc,
                exc_info=True,
            )
            await asyncio.sleep(RETRY_SECONDS)
            first_cycle = False
            continue

        first_cycle = False
        next_run = _scheduled_at_rome(now_rome.date() + timedelta(days=1))
        await asyncio.sleep(max(1, _seconds_until(next_run, datetime.now(ROME_TZ))))
