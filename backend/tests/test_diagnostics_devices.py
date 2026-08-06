import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.core.diagnostics import frontend_device_state
from app.routers import system
from app.schemas import DiagnosticDeviceRegistryUpdate, FrontendDiagnosticsPayload


class _RegistryCollection:
    def __init__(self):
        self.documents = {}

    async def update_one(self, query, update, upsert=False):
        assert upsert is True
        self.documents[query["device_id"]] = dict(update["$set"])

    async def delete_one(self, query):
        self.documents.pop(query["device_id"], None)


def test_frontend_heartbeat_keeps_optional_device_telemetry(monkeypatch):
    frontend_device_state.clear()
    monkeypatch.setitem(system.RESTAURANT_LOCATION_CACHE, "rest-1", "Flaminio")
    payload = FrontendDiagnosticsPayload(
        device_id="dev-tablet-1",
        device_model="Galaxy Tab A9",
        platform_version="15",
        architecture="arm",
        bitness="64",
        browser_full_version="Chrome 139.0",
        battery_level=72,
        battery_charging=False,
        connection_effective_type="4g",
        connection_downlink_mbps=18.5,
        connection_rtt_ms=75,
        heartbeat_rtt_ms=41,
        heartbeat_failures=2,
        last_heartbeat_failure_at="2026-08-06T08:00:00+00:00",
        restaurant_id="spoofed-id",
        restaurant_location="Locale falso",
    )
    request = SimpleNamespace(headers={}, client=SimpleNamespace(host="127.0.0.1"))

    saved = system._record_frontend_heartbeat(
        payload,
        {"restaurant_id": "rest-1", "restaurant_name": "Flaminio", "role": "restaurant"},
        request,
    )

    assert saved["device_model"] == "Galaxy Tab A9"
    assert saved["battery_level"] == 72
    assert saved["connection_effective_type"] == "4g"
    assert saved["heartbeat_rtt_ms"] == 41
    assert saved["heartbeat_failures"] == 2
    assert saved["restaurant_id"] == "rest-1"
    assert saved["restaurant_location"] == "Flaminio"
    frontend_device_state.clear()


def test_admin_can_name_device_and_clear_registry(monkeypatch):
    registry = _RegistryCollection()
    monkeypatch.setattr(system, "db", SimpleNamespace(diagnostic_device_registry=registry))

    saved = asyncio.run(system.update_diagnostic_device_registry(
        " dev-tablet-1 ",
        DiagnosticDeviceRegistryUpdate(
            display_name=" Tablet cassa ",
            model_override=" Samsung A9 ",
        ),
        {"role": "admin", "username": "Simone"},
    ))

    assert saved["device_id"] == "dev-tablet-1"
    assert saved["display_name"] == "Tablet cassa"
    assert saved["model_override"] == "Samsung A9"
    assert registry.documents["dev-tablet-1"]["updated_by"] == "Simone"

    cleared = asyncio.run(system.update_diagnostic_device_registry(
        "dev-tablet-1",
        DiagnosticDeviceRegistryUpdate(),
        {"role": "admin", "username": "Admin"},
    ))
    assert cleared == {
        "device_id": "dev-tablet-1",
        "display_name": "",
        "model_override": "",
    }
    assert registry.documents == {}


@pytest.mark.parametrize("token_data", [
    {"role": "supervisor", "username": "Federico"},
    {"role": "restaurant", "username": "Flaminio"},
])
def test_only_admin_can_edit_device_registry(monkeypatch, token_data):
    registry = _RegistryCollection()
    monkeypatch.setattr(system, "db", SimpleNamespace(diagnostic_device_registry=registry))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(system.update_diagnostic_device_registry(
            "dev-tablet-1",
            DiagnosticDeviceRegistryUpdate(display_name="Tablet cassa"),
            token_data,
        ))

    assert exc.value.status_code == 403
    assert registry.documents == {}


@pytest.mark.parametrize(("role", "username", "expected_status"), [
    (None, None, 401),
    ("restaurant", "Flaminio", 403),
    ("magazzino", "Magazzino", 403),
    ("supervisor", "Federico", 403),
    ("admin", "Admin", 200),
    ("admin", "Simone", 200),
])
def test_device_registry_http_authorization_matrix(monkeypatch, role, username, expected_status):
    registry = _RegistryCollection()
    monkeypatch.setattr(system, "db", SimpleNamespace(diagnostic_device_registry=registry))

    async def fake_verify_token(request: Request):
        test_role = request.headers.get("x-test-role")
        if not test_role:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {
            "role": test_role,
            "username": request.headers.get("x-test-username", ""),
        }

    app = FastAPI()
    app.put("/api/admin/diagnostics/devices/{device_id}")(
        system.update_diagnostic_device_registry
    )
    app.dependency_overrides[system.verify_token] = fake_verify_token
    headers = {}
    if role:
        headers = {"x-test-role": role, "x-test-username": username}

    response = TestClient(app).put(
        "/api/admin/diagnostics/devices/dev-tablet-1",
        headers=headers,
        json={"display_name": "Tablet cassa", "model_override": "Samsung A9"},
    )

    assert response.status_code == expected_status
    if expected_status == 200:
        assert registry.documents["dev-tablet-1"]["updated_by"] == username
    else:
        assert registry.documents == {}
