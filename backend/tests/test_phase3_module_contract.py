import asyncio
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server
from app import bootstrap
from app.core.database import db
from app.core.diagnostics import (
    api_call_log,
    api_error_log,
    frontend_device_state,
    frontend_error_log,
)
from app.core.rate_limit import limiter
from app.core.state import RESTAURANT_LOCATION_CACHE
from app.core.ws_manager import manager
from app.routers import beverages, documents, invoices, system, warehouse, websocket


EXPECTED_OPENAPI_SHA256 = "bcfa91f4e3686e4d8e721dc8775efd3f394698e984ddcc07840d1b44afe8b0a6"


def test_phase3_keeps_exact_openapi_contract_and_unique_routes():
    schema = server.app.openapi()
    payload = json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()
    assert hashlib.sha256(payload).hexdigest() == EXPECTED_OPENAPI_SHA256
    assert len(schema["paths"]) == 81

    route_pairs = [
        (method, route.path)
        for route in server.app.routes
        for method in (getattr(route, "methods", None) or [])
        if method not in {"HEAD", "OPTIONS"}
    ]
    assert {pair: count for pair, count in Counter(route_pairs).items() if count > 1} == {}


def test_phase3_router_ownership_counts_are_stable():
    assert len(system.router.routes) == 12
    assert len(invoices.router.routes) == 9
    assert len(warehouse.router.routes) == 25
    assert len(beverages.router.routes) == 8
    assert len(documents.router.routes) == 16
    assert len(websocket.router.routes) == 2


def test_phase3_singletons_and_compatibility_reexports_are_shared():
    assert server.db is db
    assert server.manager is manager
    assert server.limiter is limiter
    assert server.RESTAURANT_LOCATION_CACHE is RESTAURANT_LOCATION_CACHE
    assert server.api_call_log is api_call_log
    assert server.api_error_log is api_error_log
    assert server.frontend_device_state is frontend_device_state
    assert server.frontend_error_log is frontend_error_log

    assert server.login is system.login
    assert server.create_product is warehouse.create_product
    assert server.create_invoice is invoices.create_invoice
    assert server.create_versamento is documents.create_versamento
    assert server.create_beverage_carico is beverages.create_beverage_carico
    assert server.websocket_endpoint is websocket.websocket_endpoint


def test_server_is_a_small_facade_and_app_modules_do_not_import_it():
    server_source = (BACKEND_DIR / "server.py").read_text(encoding="utf-8")
    assert len(server_source.splitlines()) < 350
    assert "@app.on_event" not in server_source

    for path in (BACKEND_DIR / "app").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "import server" not in source
        assert "from server import" not in source
        assert "@app.on_event" not in source


def test_lifespan_initializes_then_cancels_scheduler_and_shuts_down(monkeypatch):
    events = []
    scheduler_started = asyncio.Event()

    async def fake_scheduler():
        events.append("scheduler-started")
        scheduler_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            events.append("scheduler-cancelled")

    async def fake_initialize():
        events.append("initialized")

    async def fake_shutdown():
        events.append("shutdown")

    monkeypatch.setattr(bootstrap, "midnight_scheduler", fake_scheduler)
    monkeypatch.setattr(bootstrap, "initialize_application", fake_initialize)
    monkeypatch.setattr(bootstrap, "shutdown_db_client", fake_shutdown)

    async def exercise():
        async with bootstrap.lifespan(server.app):
            await asyncio.wait_for(scheduler_started.wait(), timeout=1)
            assert events == ["initialized", "scheduler-started"]

    asyncio.run(exercise())
    assert events == ["initialized", "scheduler-started", "scheduler-cancelled", "shutdown"]


def test_websocket_manager_tracks_broadcast_touch_and_disconnect():
    class FakeWebSocket:
        def __init__(self):
            self.accepted = False
            self.messages = []

        async def accept(self):
            self.accepted = True

        async def send_json(self, message):
            self.messages.append(message)

    async def exercise():
        restaurant_id = "phase3-websocket-test"
        socket = FakeWebSocket()
        manager.recent_disconnects.pop(restaurant_id, None)
        await manager.connect(socket, restaurant_id)
        assert socket.accepted is True
        connected_at = manager.connection_meta[socket]["last_seen"]
        manager.touch(socket)
        assert manager.connection_meta[socket]["last_seen"] >= connected_at
        await manager.broadcast_to_restaurant(restaurant_id, {"type": "test"})
        assert socket.messages == [{"type": "test"}]
        manager.disconnect(socket, restaurant_id)
        assert socket not in manager.connection_meta
        assert manager.active_connections[restaurant_id] == []
        assert len(manager.recent_disconnects[restaurant_id]) == 1
        manager.active_connections.pop(restaurant_id, None)
        manager.recent_disconnects.pop(restaurant_id, None)

    asyncio.run(exercise())
