import logging
import uuid
from datetime import datetime, timezone
from typing import Dict

from app.core.database import db
from app.core.time import _rome_date_from_iso, _today_rome_bounds_utc
from app.services.orders import _highest_order_number_today
from app.services.report_snapshots import _snapshot_report_paste_text_for_date


logger = logging.getLogger(__name__)


async def recover_stale_orders():
    """Self-healing: at boot, archive any orders whose created_at is before today's
    Rome midnight. Prevents stale orders from yesterday polluting today's tablets
    in case midnight_reset never ran (server downtime, deploy, crash).
    Records an alert in system_alerts collection if stale orders were found."""
    try:
        start_utc, _ = _today_rome_bounds_utc()
        stale = await db.orders.find(
            {"created_at": {"$lt": start_utc}}, {"_id": 0}
        ).to_list(100000)
        if not stale:
            logger.info("[RECOVERY] No stale orders found at boot")
            return
        logger.warning(f"[RECOVERY] Found {len(stale)} stale orders at boot, archiving...")
        stale_by_date: Dict[str, set] = {}
        for order in stale:
            date_rome = _rome_date_from_iso(order.get("created_at"))
            rid = order.get("restaurant_id")
            if date_rome and rid:
                stale_by_date.setdefault(date_rome, set()).add(rid)
        for date_rome, rids in sorted(stale_by_date.items()):
            try:
                paste_summary = await _snapshot_report_paste_text_for_date(
                    date_rome,
                    restaurant_ids=sorted(rids),
                    snapshot_source="recovery",
                )
                logger.warning(f"[RECOVERY] Report paste snapshot for {date_rome}: {paste_summary}")
            except Exception as e:
                logger.error(f"[RECOVERY] paste snapshot failed for {date_rome}: {e}", exc_info=True)

        # Archive stale orders atomically
        result = await db.archived_orders.insert_many([{**o} for o in stale], ordered=False)
        if len(result.inserted_ids) != len(stale):
            logger.error(
                f"[RECOVERY] Archive mismatch {len(result.inserted_ids)}/{len(stale)}, ABORTING"
            )
            return
        stale_ids = [o["id"] for o in stale]
        del_res = await db.orders.delete_many({"id": {"$in": stale_ids}})
        logger.warning(f"[RECOVERY] Archived {len(stale)} stale orders, deleted {del_res.deleted_count}")

        # Recompute order_counter per restaurant from remaining active orders
        # so today's numbering continues correctly
        per_restaurant = {}
        for rid_doc in await db.restaurants.find({"role": "restaurant"}, {"_id": 0, "id": 1, "location": 1}).to_list(100):
            rid = rid_doc["id"]
            loc = rid_doc.get("location", "?")
            count_for_rid = sum(1 for s in stale if s.get("restaurant_id") == rid)
            highest = await _highest_order_number_today(rid)
            await db.restaurants.update_one(
                {"id": rid}, {"$set": {"order_counter": highest}}
            )
            if count_for_rid > 0:
                per_restaurant[loc] = count_for_rid
            logger.warning(f"[RECOVERY] Restaurant {rid} counter set to {highest}")

        # Record alert for Admin dashboard
        await db.system_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "stale_orders_recovered",
            "stale_count": len(stale),
            "per_restaurant": per_restaurant,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "acknowledged": False,
        })
    except Exception as e:
        logger.error(f"[RECOVERY] recover_stale_orders failed: {e}", exc_info=True)
