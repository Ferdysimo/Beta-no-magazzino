from app.core.database import db
from app.core.time import _today_rome_bounds_utc


async def _highest_order_number_today(restaurant_id: str) -> int:
    """Return the highest order number used today across all order stores."""
    start_utc, end_utc = _today_rome_bounds_utc()
    max_number = 0

    document = await db.orders.find_one(
        {"restaurant_id": restaurant_id},
        sort=[("order_number", -1)],
        projection={"_id": 0, "order_number": 1},
    )
    if document and document.get("order_number"):
        max_number = max(max_number, document["order_number"])

    document = await db.archived_orders.find_one(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        },
        sort=[("order_number", -1)],
        projection={"_id": 0, "order_number": 1},
    )
    if document and document.get("order_number"):
        max_number = max(max_number, document["order_number"])

    document = await db.deletion_logs.find_one(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": start_utc, "$lt": end_utc},
        },
        sort=[("order_number", -1)],
        projection={"_id": 0, "order_number": 1},
    )
    if document and document.get("order_number"):
        max_number = max(max_number, document["order_number"])

    return max_number
