from datetime import datetime, timezone
from typing import Dict, Optional

from app.core.database import db
from app.services.analysis import _build_paste_text_for_date
from app.services.report import (
    _get_pasta_dict_for,
    _pasta_dict_from_snapshot,
    _pasta_dict_snapshot_fields,
)


async def _snapshot_report_paste_text_for_date(
    date_rome_str: str,
    *,
    restaurant_ids: Optional[list[str]] = None,
    snapshot_source: str = "server",
) -> Dict[str, int]:
    """Persist the Report paste_text snapshot server-side for a closed Rome day."""
    summary = {"restaurants": 0, "updated": 0, "manual_skipped": 0}
    if restaurant_ids is None:
        restaurants = await db.restaurants.find(
            {"role": "restaurant"}, {"_id": 0, "id": 1}
        ).to_list(200)
        restaurant_ids = [r.get("id") for r in restaurants if r.get("id")]

    now_iso = datetime.now(timezone.utc).isoformat()
    for rid in restaurant_ids:
        if not rid:
            continue
        summary["restaurants"] += 1
        paste_text = await _build_paste_text_for_date(
            rid,
            date_rome_str,
        )
        cash_doc = await db.cash_daily_counts.find_one(
            {"restaurant_id": rid, "date_rome": date_rome_str},
            {
                "_id": 0,
                "paste_text": 1,
                "paste_manual_override": 1,
                "paste_snapshot_at": 1,
                "pasta_dict_snapshot": 1,
                "pasta_dict_snapshot_version": 1,
                "pasta_dict_snapshot_at": 1,
                "pasta_dict_snapshot_source": 1,
            },
        ) or {}
        if cash_doc.get("paste_manual_override") is True:
            summary["manual_skipped"] += 1
            continue
        if not paste_text and not cash_doc:
            continue
        set_fields = {
            "restaurant_id": rid,
            "date_rome": date_rome_str,
            "paste_text": paste_text,
            "paste_snapshot_at": now_iso,
            "paste_snapshot_source": snapshot_source,
            "updated_at": now_iso,
        }
        existing_snapshot = _pasta_dict_from_snapshot(cash_doc.get("pasta_dict_snapshot"))
        if not existing_snapshot:
            set_fields.update(
                _pasta_dict_snapshot_fields(
                    await _get_pasta_dict_for(rid),
                    source=snapshot_source,
                    captured_at=now_iso,
                )
            )
        elif not cash_doc.get("pasta_dict_snapshot_version"):
            set_fields.update({
                "pasta_dict_snapshot_version": 1,
                "pasta_dict_snapshot_at": cash_doc.get("paste_snapshot_at") or now_iso,
                "pasta_dict_snapshot_source": "legacy",
            })
        snapshot_metadata_complete = bool(
            cash_doc.get("pasta_dict_snapshot_version")
            and cash_doc.get("pasta_dict_snapshot_at")
            and cash_doc.get("pasta_dict_snapshot_source")
        )
        if (
            (cash_doc.get("paste_text") or "") == paste_text
            and existing_snapshot
            and snapshot_metadata_complete
        ):
            continue
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": date_rome_str},
            {"$set": set_fields},
            upsert=True,
        )
        summary["updated"] += 1
    return summary
