import asyncio
import logging
from datetime import datetime, timedelta

from app.core.database import db
from app.core.time import ROME_TZ, _today_rome_str
from app.core.ws_manager import manager
from app.services.report import _materialize_report_day_opening_for_restaurant
from app.services.report_snapshots import _snapshot_report_paste_text_for_date
from app.tasks.maintenance import _atomic_archive_and_clear, cleanup_old_uploads


logger = logging.getLogger(__name__)


async def midnight_reset():
    logger.info("Running midnight reset - archiving orders and resetting counters")
    archived_count = 0
    try:
        closed_day_rome = (datetime.now(ROME_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
        try:
            paste_summary = await _snapshot_report_paste_text_for_date(
                closed_day_rome,
                snapshot_source="midnight",
            )
            logger.info(f"[REPORT_PASTE_SNAPSHOT] closed_day={closed_day_rome}: {paste_summary}")
        except Exception as e:
            logger.error(f"[REPORT_PASTE_SNAPSHOT] failed for {closed_day_rome}: {e}", exc_info=True)

        archived_count = await _atomic_archive_and_clear("orders", "archived_orders")
        await _atomic_archive_and_clear("deletion_logs", "archived_deletion_logs")
        await _atomic_archive_and_clear("modification_logs", "archived_modification_logs")
        await _atomic_archive_and_clear("beverage_sales", "archived_beverage_sales")

        # Reset all restaurant counters to 0 ONLY if archive of orders succeeded
        # (or there were no orders to archive)
        await db.restaurants.update_many(
            {"role": "restaurant"},
            {"$set": {"order_counter": 0}}
        )
        logger.info(f"Order counters reset to 0 (archived {archived_count} orders)")

        try:
            today_rome = _today_rome_str()
            opening_summary = {"cash_fields": 0, "beverage_rows": 0, "restaurants": 0}
            restaurants = await db.restaurants.find(
                {"role": "restaurant"}, {"_id": 0, "id": 1}
            ).to_list(100)
            for r in restaurants:
                rid = r.get("id")
                if not rid:
                    continue
                partial = await _materialize_report_day_opening_for_restaurant(rid, today_rome)
                opening_summary["restaurants"] += 1
                opening_summary["cash_fields"] += partial.get("cash_fields", 0)
                opening_summary["beverage_rows"] += partial.get("beverage_rows", 0)
            logger.info(f"[REPORT_OPENING] midnight carry-over materialized: {opening_summary}")
        except Exception as e:
            logger.error(f"[REPORT_OPENING] midnight carry-over failed: {e}", exc_info=True)

        # Broadcast reset to all connected clients
        for rid in list(manager.active_connections.keys()):
            await manager.broadcast_to_restaurant(rid, {
                "type": "daily_reset"
            })

        # Retention: delete fatture/versamenti/chiusure older than 3 months
        # (and their image files). Best-effort, doesn't block the reset.
        try:
            await cleanup_old_uploads()
        except Exception as e:
            logger.error(f"[CLEANUP] cleanup_old_uploads in midnight_reset failed: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Midnight reset error: {e}", exc_info=True)


async def midnight_scheduler():
    while True:
        now = datetime.now(ROME_TZ)
        # Calculate seconds until next midnight Rome time
        tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if now >= tomorrow:
            tomorrow += timedelta(days=1)
        wait_seconds = (tomorrow - now).total_seconds()
        logger.info(f"Next midnight reset in {wait_seconds:.0f} seconds ({tomorrow.isoformat()})")
        await asyncio.sleep(wait_seconds)
        await midnight_reset()
