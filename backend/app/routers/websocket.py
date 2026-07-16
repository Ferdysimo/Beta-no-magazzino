import asyncio
import json
import logging
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.core.config import WS_TICKET_TTL_SECONDS, origin_is_allowed
from app.core.database import db
from app.core.security import verify_token
from app.core.ws_manager import manager


logger = logging.getLogger(__name__)
router = APIRouter()
_ticket_lock = asyncio.Lock()
_tickets: dict[str, dict] = {}


async def _issue_ticket(restaurant_id: str) -> str:
    now = time.time()
    async with _ticket_lock:
        expired = [key for key, value in _tickets.items() if value["expires_at"] <= now]
        for key in expired:
            _tickets.pop(key, None)
        ticket = secrets.token_urlsafe(32)
        _tickets[ticket] = {
            "restaurant_id": restaurant_id,
            "expires_at": now + WS_TICKET_TTL_SECONDS,
        }
    return ticket


async def _consume_ticket(ticket: str) -> str | None:
    async with _ticket_lock:
        payload = _tickets.pop(ticket, None)
    if not payload or payload["expires_at"] <= time.time():
        return None
    return payload["restaurant_id"]


@router.post("/api/ws-ticket")
async def create_websocket_ticket(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data.get("restaurant_id")
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurant_id non disponibile")
    restaurant = await db.restaurants.find_one({"id": restaurant_id}, {"_id": 0, "id": 1})
    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return {
        "ticket": await _issue_ticket(restaurant_id),
        "expires_in": WS_TICKET_TTL_SECONDS,
    }


@router.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, ticket: str = ""):
    if not origin_is_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008, reason="Origin not allowed")
        return
    restaurant_id = await _consume_ticket(ticket)
    if not restaurant_id:
        await websocket.close(code=1008, reason="Invalid or expired ticket")
        return
    await manager.connect(websocket, restaurant_id)

    # Server-side heartbeat: detect dead connections
    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(30)
                await websocket.send_json({"type": "ping"})
        except Exception:
            pass

    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            data = await websocket.receive_text()
            manager.touch(websocket)
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurant_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, restaurant_id)
    finally:
        heartbeat_task.cancel()
