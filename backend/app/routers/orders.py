import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from app.core.config import UPLOADS_DIR
from app.core.database import db
from app.core.deps import _effective_restaurant_id
from app.core.security import verify_token
from app.core.state import RESTAURANT_LOCATION_CACHE
from app.core.time import ROME_TZ, _today_rome_bounds_utc
from app.core.ws_manager import manager
from app.schemas import OrderCreate, OrderResponse, OrderUpdate
from app.services.orders import _highest_order_number_today


logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/orders", response_model=OrderResponse)
async def create_order(data: OrderCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Two distinct flows:
    # (a) No order_number provided -> atomic $inc on counter (race-safe).
    # (b) Explicit order_number provided -> honour the cashier's choice.
    #     Uniqueness in active orders is enforced by the UNIQUE index on
    #     (restaurant_id, order_number); concurrent collisions raise
    #     DuplicateKeyError which we translate to 409. The counter is moved
    #     forward to MAX(current, requested) so subsequent auto-numbers stay
    #     consistent.
    if data.order_number and data.order_number > 0:
        requested = data.order_number
        active_collision = await db.orders.find_one(
            {
                "restaurant_id": restaurant_id,
                "order_number": requested,
            },
            {"_id": 0, "id": 1},
        )
        if active_collision:
            raise HTTPException(
                status_code=409,
                detail=f"Numero #{requested} già in uso tra gli ordini attivi",
            )
        # Honour the cashier's explicit choice: set the counter to the
        # requested number (forward OR backward). This lets the cashier
        # restart the day's numbering at will (e.g. "annulla tutto, riparto
        # da 1"). Concurrency safety against duplicates among ACTIVE orders
        # is enforced by the UNIQUE index (restaurant_id, order_number) on
        # the `orders` collection - any collision raises DuplicateKeyError
        # and is translated to HTTP 409 below.
        result = await db.restaurants.find_one_and_update(
            {"id": restaurant_id},
            {"$set": {"order_counter": requested}},
            return_document=True,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Restaurant not found")
        order_number = requested
    else:
        result = await db.restaurants.find_one_and_update(
            {"id": restaurant_id},
            {"$inc": {"order_counter": 1}},
            return_document=True,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Restaurant not found")
        order_number = result["order_counter"]

    order_id = str(uuid.uuid4())

    order = {
        "id": order_id,
        "order_number": order_number,
        "description": data.description,  # Keep original case
        "restaurant_id": restaurant_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timer_started": False,
        "timer_start_time": None,
        "timer_paused": False,
        "timer_elapsed": 0,
        "kitchen_completed": False,
        "monitor_visible": False,
        "hidden_generale": False
    }

    try:
        await db.orders.insert_one(order)
    except DuplicateKeyError:
        # The unique index (restaurant_id, order_number) rejected the insert
        # because that number is already in use among active orders. This can
        # happen if the cashier explicitly requests a number that's currently
        # active, or if two cashiers race on the same explicit number.
        raise HTTPException(
            status_code=409,
            detail=f"Numero #{order_number} già in uso tra gli ordini attivi"
        )

    # Backup to file for Flaminio
    restaurant = await db.restaurants.find_one({"id": restaurant_id})
    if restaurant and restaurant.get("location") == "Flaminio":
        backup_file = UPLOADS_DIR / "backup_flaminio.txt"
        with open(backup_file, "a") as f:
            f.write(f"{order_number} {data.description}\n")

    # Broadcast to all connected clients
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_created",
        "order": {k: v for k, v in order.items() if k != "_id"}
    })

    return OrderResponse(**{k: v for k, v in order.items() if k != "_id"})


@router.get("/orders", response_model=List[OrderResponse])
async def get_orders(
    status: Optional[str] = "pending",
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]

    # Belt-and-suspenders: only serve orders created in the CURRENT Rome day.
    # Even if `midnight_reset` failed silently and left stale rows in `db.orders`,
    # this filter prevents yesterday's high-numbered orders from leaking into the
    # Tablet Generale during today's service.
    start_utc, end_utc = _today_rome_bounds_utc()
    query = {
        "restaurant_id": restaurant_id,
        "created_at": {"$gte": start_utc, "$lt": end_utc},
    }
    if status and status != "all":
        query["status"] = status

    orders = await db.orders.find(query, {"_id": 0}).sort("order_number", -1).to_list(500)
    return [OrderResponse(**o) for o in orders]


@router.get("/orders/next-number")
async def get_next_order_number(token_data: dict = Depends(verify_token)):
    """Return the next order_number that would be assigned for this restaurant.
    Reads `order_counter` directly from the DB (authoritative). Used by Cassa
    to display the upcoming number without relying on a possibly-pruned local
    pending list (which would otherwise reuse already-used numbers)."""
    restaurant_id = token_data["restaurant_id"]
    rest = await db.restaurants.find_one(
        {"id": restaurant_id}, {"_id": 0, "order_counter": 1}
    )
    if not rest:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return {"next_number": (rest.get("order_counter", 0) or 0) + 1}


@router.get("/orders/today-paste-list")
async def get_today_paste_list(
    request: Request,
    token_data: dict = Depends(verify_token),
):
    """Return ALL pasta orders for the CURRENT Rome day of the effective
    restaurant (supports Admin/Supervisor impersonation via X-Restaurant-Id).

    Used by ReportBetaPage to auto-populate the paste column so that the
    cashier does not need to manually paste the list.

    Includes orders with hidden_generale=True (they were still sold/cashed).
    """
    rid = await _effective_restaurant_id(request, token_data)
    start_utc, end_utc = _today_rome_bounds_utc()
    cursor = db.orders.find(
        {
            "restaurant_id": rid,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        },
        {"_id": 0, "order_number": 1, "description": 1, "hidden_generale": 1},
    ).sort("order_number", 1)
    docs = await cursor.to_list(2000)
    items = [
        {
            "order_number": d.get("order_number"),
            "description": (d.get("description") or "").strip(),
            "hidden_generale": bool(d.get("hidden_generale", False)),
        }
        for d in docs
    ]
    return {"items": items, "count": len(items)}


@router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: str, token_data: dict = Depends(verify_token)):
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderResponse(**order)


@router.patch("/orders/{order_id}", response_model=OrderResponse)
async def update_order(
    order_id: str,
    data: OrderUpdate,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]

    # Get original order for logging
    original_order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not original_order:
        raise HTTPException(status_code=404, detail="Order not found")

    update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    # Pre-check: if order_number is being changed, ensure it isn't already used
    # by another active order of the same restaurant. The unique compound index
    # on (restaurant_id, order_number) is the last line of defense, but we
    # surface a clean 400 message here so the cashier knows what happened
    # instead of seeing 500 retries.
    if "order_number" in update_data:
        new_number = int(update_data["order_number"])
        if new_number != int(original_order.get("order_number", -1)):
            clash = await db.orders.find_one(
                {
                    "restaurant_id": restaurant_id,
                    "order_number": new_number,
                    "id": {"$ne": order_id},
                },
                {"_id": 0, "id": 1},
            )
            if clash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Numero {new_number} già usato per un altro ordine attivo di questo locale. Scegli un altro numero.",
                )

    # Log modification if description changed
    if "description" in update_data and update_data["description"] != original_order["description"]:
        modification_log = {
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "order_number": original_order["order_number"],
            "old_description": original_order["description"],
            "new_description": update_data["description"],
            "restaurant_id": restaurant_id,
            "modified_at": datetime.now(timezone.utc).isoformat()
        }
        await db.modification_logs.insert_one(modification_log)

    try:
        result = await db.orders.find_one_and_update(
            {"id": order_id, "restaurant_id": restaurant_id},
            {"$set": update_data},
            return_document=True
        )
    except DuplicateKeyError:
        # Race: another concurrent request took the same order_number between
        # our pre-check and the find_one_and_update. Fall back to the same
        # human-readable error.
        raise HTTPException(
            status_code=400,
            detail=f"Numero {update_data.get('order_number')} già usato per un altro ordine attivo di questo locale. Scegli un altro numero.",
        )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    # Broadcast update
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return OrderResponse(**order_response)


@router.delete("/orders/{order_id}")
async def delete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Get the order first to log it
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Log the deletion
    deletion_log = {
        "id": str(uuid.uuid4()),
        "order_number": order["order_number"],
        "description": order["description"],
        "restaurant_id": restaurant_id,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "original_created_at": order["created_at"]
    }
    await db.deletion_logs.insert_one(deletion_log)

    # Delete the order
    result = await db.orders.delete_one(
        {"id": order_id, "restaurant_id": restaurant_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")

    # Recompute order_counter as the MAX across:
    # - active orders (remaining)
    # - archived orders of today
    # - deletion logs of today
    # This guarantees the counter NEVER goes backwards during the day,
    # preventing reused numbers and duplicated orders on tablets/Excel.
    new_counter = await _highest_order_number_today(restaurant_id)
    await db.restaurants.update_one(
        {"id": restaurant_id},
        {"$set": {"order_counter": new_counter}}
    )

    # Broadcast deletion
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_deleted",
        "order_id": order_id
    })

    return {"message": "Order deleted"}


@router.post("/orders/{order_id}/complete")
async def complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat()
        }},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Order completed"}


@router.post("/orders/{order_id}/kitchen-complete")
async def kitchen_complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"kitchen_completed": True}},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Order kitchen completed"}


@router.post("/orders/{order_id}/hide-generale")
async def hide_from_generale(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Calculate frozen timer value at this moment
    frozen_timer = 0
    if order.get("timer_started"):
        if order.get("timer_paused"):
            frozen_timer = order.get("timer_elapsed", 0)
        elif order.get("timer_start_time"):
            start = datetime.fromisoformat(order["timer_start_time"])
            now = datetime.now(timezone.utc)
            frozen_timer = int((now - start).total_seconds()) + (order.get("timer_elapsed", 0))

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"hidden_generale": True, "hidden_generale_timer": frozen_timer, "monitor_visible": False}},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    # Audit silenzioso: tracciamo CHI ha nascosto QUALE ordine e QUANDO.
    # Serve a diagnosticare segnalazioni del tipo "paste sparite da sole" sui
    # tablet Generale. La collezione `generale_hide_log` è admin-only.
    try:
        await db.generale_hide_log.insert_one({
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "order_number": result.get("order_number"),
            "order_description": result.get("description"),
            "restaurant_id": restaurant_id,
            "restaurant_location": RESTAURANT_LOCATION_CACHE.get(restaurant_id),
            "by_user_id": token_data.get("user_id") or token_data.get("sub"),
            "by_username": token_data.get("username"),
            "by_role": token_data.get("original_role") or token_data.get("role"),
            "hidden_at": datetime.now(timezone.utc).isoformat(),
            "frozen_timer": frozen_timer,
        })
    except Exception as e:
        logger.warning(f"[HIDE_LOG] could not log hide_generale: {e}")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Order hidden from generale"}


@router.post("/orders/{order_id}/monitor-toggle")
async def toggle_monitor_visibility(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    new_val = not order.get("monitor_visible", False)
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"monitor_visible": new_val}},
        return_document=True
    )

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": f"Monitor visibility: {new_val}", "monitor_visible": new_val}


@router.post("/orders/{order_id}/timer/start")
async def start_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": True,
            "timer_start_time": datetime.now(timezone.utc).isoformat(),
            "timer_paused": False
        }},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Timer started", "timer_start_time": result["timer_start_time"]}


@router.post("/orders/{order_id}/timer/pause")
async def pause_timer(order_id: str, elapsed: int = 0, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_paused": True,
            "timer_elapsed": elapsed
        }},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Timer paused"}


@router.post("/orders/{order_id}/timer/reset")
async def reset_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": False,
            "timer_start_time": None,
            "timer_paused": False,
            "timer_elapsed": 0
        }},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    order_response = {k: v for k, v in result.items() if k != "_id"}

    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })

    return {"message": "Timer reset"}


@router.get("/logs/deletions")
async def get_deletion_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Today's deletions — Rome operating day
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    logs = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)

    return {"count": len(logs), "logs": logs}


@router.get("/logs/modifications")
async def get_modification_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Today's modifications — Rome operating day
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    logs = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)

    return {"count": len(logs), "logs": logs}


@router.get("/logs/today")
async def get_today_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Cut-off at midnight in Rome timezone (operating day), converted to UTC
    # because logs are stored with UTC isoformat strings.
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)

    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)

    return {
        "deletions": {"count": len(deletions), "logs": deletions},
        "modifications": {"count": len(modifications), "logs": modifications}
    }


@router.get("/report/daily")
async def get_daily_report(date: str = None, token_data: dict = Depends(verify_token)):
    """Get daily report with all orders and their status changes.
    `date` is interpreted as an Italian (Europe/Rome) calendar day."""
    restaurant_id = token_data["restaurant_id"]

    # Parse date string as Rome-local day; default to today Rome.
    if date:
        try:
            parsed = datetime.fromisoformat(date.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                day_rome = parsed.replace(tzinfo=ROME_TZ, hour=0, minute=0, second=0, microsecond=0)
            else:
                day_rome = parsed.astimezone(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        except Exception:
            day_rome = datetime.now(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day_rome = datetime.now(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)

    day_start = day_rome.astimezone(timezone.utc)
    day_end = (day_rome + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc)

    # Get all orders created on this day (including completed ones)
    # Check both active orders and archived orders
    orders = await db.orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(None)

    archived = await db.archived_orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(None)

    # Merge, avoiding duplicates by order id
    seen_ids = {o["id"] for o in orders}
    for a in archived:
        if a["id"] not in seen_ids:
            orders.append(a)
    orders.sort(key=lambda x: x["order_number"])

    # Get deletions for this day
    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(None)

    # Get modifications for this day
    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(None)

    # Build report items - combine orders and deleted orders
    report_items = []

    # Add existing orders
    for order in orders:
        item = {
            "order_number": order["order_number"],
            "description": order["description"],
            "created_at": order["created_at"],
            "completed_at": None,
            "deleted_at": None,
            "modified_at": None,
            "status": order["status"]
        }

        # Check if order was completed (status changed)
        if order["status"] == "completed":
            # We don't have exact completion time stored, so we'll use status
            item["completed_at"] = order.get("completed_at")

        # Check for modifications
        order_mods = [m for m in modifications if m.get("order_id") == order["id"]]
        if order_mods:
            # Get the latest modification
            latest_mod = max(order_mods, key=lambda x: x["modified_at"])
            item["modified_at"] = latest_mod["modified_at"]

        report_items.append(item)

    # Add deleted orders (they won't be in orders collection anymore)
    for deletion in deletions:
        # Check if this order number is already in report (shouldn't be, but just in case)
        existing = next((r for r in report_items if r["order_number"] == deletion["order_number"]), None)
        if not existing:
            item = {
                "order_number": deletion["order_number"],
                "description": deletion["description"],
                "created_at": deletion["original_created_at"],
                "completed_at": None,
                "deleted_at": deletion["deleted_at"],
                "modified_at": None,
                "status": "deleted"
            }

            # Check for modifications before deletion
            order_mods = [m for m in modifications if m.get("order_number") == deletion["order_number"]]
            if order_mods:
                latest_mod = max(order_mods, key=lambda x: x["modified_at"])
                item["modified_at"] = latest_mod["modified_at"]

            report_items.append(item)

    # Sort by order number
    report_items.sort(key=lambda x: x["order_number"])

    return {
        "date": day_rome.date().isoformat(),
        "total_orders": len(report_items),
        "completed": len([r for r in report_items if r["status"] == "completed"]),
        "deleted": len([r for r in report_items if r["status"] == "deleted"]),
        "pending": len([r for r in report_items if r["status"] == "pending"]),
        "items": report_items
    }
