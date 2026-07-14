import logging
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import WebSocket


logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.connection_meta: Dict[WebSocket, dict] = {}
        self.recent_disconnects: Dict[str, List[str]] = {}

    async def connect(self, websocket: WebSocket, restaurant_id: str):
        await websocket.accept()
        if restaurant_id not in self.active_connections:
            self.active_connections[restaurant_id] = []
        self.active_connections[restaurant_id].append(websocket)
        now_iso = datetime.now(timezone.utc).isoformat()
        self.connection_meta[websocket] = {
            "restaurant_id": restaurant_id,
            "connected_at": now_iso,
            "last_seen": now_iso,
        }
        logger.info("WebSocket connected for restaurant %s", restaurant_id)

    def disconnect(self, websocket: WebSocket, restaurant_id: str):
        if restaurant_id in self.active_connections:
            if websocket in self.active_connections[restaurant_id]:
                self.active_connections[restaurant_id].remove(websocket)
            logger.info("WebSocket disconnected for restaurant %s", restaurant_id)
        self.connection_meta.pop(websocket, None)
        events = self.recent_disconnects.setdefault(restaurant_id, [])
        events.append(datetime.now(timezone.utc).isoformat())
        if len(events) > 50:
            del events[: len(events) - 50]

    def touch(self, websocket: WebSocket):
        meta = self.connection_meta.get(websocket)
        if meta:
            meta["last_seen"] = datetime.now(timezone.utc).isoformat()

    async def broadcast_to_restaurant(self, restaurant_id: str, message: dict):
        if restaurant_id not in self.active_connections:
            return

        disconnected = []
        for connection in self.active_connections[restaurant_id]:
            try:
                await connection.send_json(message)
            except Exception as exc:
                logger.error("Error sending message: %s", exc)
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection, restaurant_id)


manager = ConnectionManager()
