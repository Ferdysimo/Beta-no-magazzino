import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.routers import upload_attempts
from app.services import upload_attempts as service


class _UploadAttemptsCollection:
    def __init__(self):
        self.documents = {}

    async def find_one(self, query, projection=None):
        document = self.documents.get(query["attempt_id"])
        return deepcopy(document) if document else None

    async def update_one(self, query, update, upsert=False):
        attempt_id = query["attempt_id"]
        document = self.documents.setdefault(attempt_id, {})
        for key, value in update.get("$setOnInsert", {}).items():
            document.setdefault(key, deepcopy(value))
        document.update(deepcopy(update.get("$set", {})))
        for key, value in update.get("$min", {}).items():
            if key not in document or value < document[key]:
                document[key] = deepcopy(value)
        for key, value in update.get("$max", {}).items():
            if key not in document or value > document[key]:
                document[key] = deepcopy(value)
        document.setdefault("events", []).append(deepcopy(update["$push"]["events"]))


class _ReadCursor:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length):
        return deepcopy(self.documents[:length])


class _ReadCollection:
    def __init__(self, documents=None):
        self.documents = documents or []

    def find(self, *args, **kwargs):
        return _ReadCursor(self.documents)


def test_upload_events_use_authoritative_restaurant_and_keep_metadata_only(monkeypatch):
    collection = _UploadAttemptsCollection()
    monkeypatch.setattr(service, "db", SimpleNamespace(upload_attempts=collection))
    monkeypatch.setitem(service.RESTAURANT_LOCATION_CACHE, "rest-1", "Flaminio")

    result = asyncio.run(service.record_upload_attempt_event(
        {
            "attempt_id": "attempt-1",
            "event_id": "event-1",
            "stage": "file_selected",
            "upload_kind": "closure_primary",
            "device_id": "device-1",
            "file_size_bytes": 1024,
            "image_data": "data:image/jpeg;base64,NEVER_STORE_THIS",
        },
        {
            "restaurant_id": "rest-1",
            "restaurant_name": "Nome non autorevole",
            "username": "Flaminio",
        },
        user_agent="Test browser",
    ))

    assert result == {"ok": True}
    saved = collection.documents["attempt-1"]
    assert saved["restaurant_id"] == "rest-1"
    assert saved["restaurant_location"] == "Flaminio"
    assert saved["device_id"] == "device-1"
    assert saved["events"][0]["file_size_bytes"] == 1024
    assert "image_data" not in str(saved)


def test_attempt_status_distinguishes_saved_failed_and_stale():
    assert service.classify_attempt_status({
        "events": [
            {"stage": "upload_failed", "client_at": "2026-08-27T20:00:00+00:00"},
            {"stage": "server_saved", "server_at": "2026-08-27T20:01:00+00:00"},
        ],
    }) == "saved"
    assert service.classify_attempt_status({
        "events": [{"stage": "upload_failed"}],
    }) == "failed"
    assert service.classify_attempt_status({
        "last_seen": "2026-08-27T20:00:00+00:00",
        "events": [{"stage": "upload_started"}],
    }) == "incomplete"


@pytest.mark.parametrize("token_data", [
    {"role": "restaurant", "username": "Flaminio"},
    {"role": "admin", "username": "Admin"},
    {"role": "supervisor", "username": "Altro"},
])
def test_upload_monitor_rejects_every_account_except_federico_and_simone(token_data):
    with pytest.raises(HTTPException) as exc:
        upload_attempts._require_upload_monitor_access(token_data)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("token_data", [
    {"role": "admin", "username": "Simone"},
    {"role": "supervisor", "username": "Federico"},
])
def test_upload_monitor_accepts_federico_and_simone(token_data):
    upload_attempts._require_upload_monitor_access(token_data)


@pytest.mark.parametrize(("token_data", "allowed"), [
    ({"role": "restaurant", "username": "Flaminio"}, True),
    ({"role": "admin", "username": "Admin"}, True),
    ({"role": "admin", "username": "Simone"}, True),
    ({"role": "supervisor", "username": "Federico"}, True),
    ({"role": "supervisor", "username": "Altro"}, False),
    ({"role": "magazzino", "username": "Magazzino"}, False),
])
def test_upload_event_authorization_matrix(token_data, allowed):
    if allowed:
        upload_attempts._require_upload_event_access(token_data)
        return
    with pytest.raises(HTTPException) as exc:
        upload_attempts._require_upload_event_access(token_data)
    assert exc.value.status_code == 403


@pytest.mark.parametrize(("path", "method", "role", "username", "expected"), [
    ("/api/upload-attempts/events", "post", "", "", 401),
    ("/api/upload-attempts/events", "post", "restaurant", "Flaminio", 200),
    ("/api/upload-attempts/events", "post", "magazzino", "Magazzino", 403),
    ("/api/upload-attempts/events", "post", "supervisor", "Federico", 200),
    ("/api/upload-attempts/events", "post", "admin", "Admin", 200),
    ("/api/upload-attempts/events", "post", "admin", "Simone", 200),
    ("/api/admin/upload-attempts", "get", "", "", 401),
    ("/api/admin/upload-attempts", "get", "restaurant", "Flaminio", 403),
    ("/api/admin/upload-attempts", "get", "magazzino", "Magazzino", 403),
    ("/api/admin/upload-attempts", "get", "supervisor", "Federico", 200),
    ("/api/admin/upload-attempts", "get", "admin", "Admin", 403),
    ("/api/admin/upload-attempts", "get", "admin", "Simone", 200),
])
def test_upload_attempt_http_authorization_matrix(
    monkeypatch,
    path,
    method,
    role,
    username,
    expected,
):
    async def fake_verify_token(request: Request):
        test_role = request.headers.get("x-test-role")
        if not test_role:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {
            "role": test_role,
            "username": request.headers.get("x-test-username", ""),
            "restaurant_id": "rest-1",
            "restaurant_name": "Flaminio",
        }

    async def fake_record(*args, **kwargs):
        return {"ok": True}

    monkeypatch.setattr(upload_attempts, "record_upload_attempt_event", fake_record)
    monkeypatch.setattr(
        upload_attempts,
        "db",
        SimpleNamespace(
            upload_attempts=_ReadCollection(),
            restaurants=_ReadCollection([{"id": "rest-1", "location": "Flaminio"}]),
        ),
    )
    app = FastAPI()
    app.include_router(upload_attempts.router, prefix="/api")
    app.dependency_overrides[upload_attempts.verify_token] = fake_verify_token
    client = TestClient(app)
    headers = {"x-test-role": role, "x-test-username": username} if role else {}

    if method == "post":
        response = client.post(
            path,
            headers=headers,
            json={
                "attempt_id": "attempt-http-1",
                "stage": "file_selected",
                "upload_kind": "closure_primary",
            },
        )
    else:
        response = client.get(path, headers=headers)

    assert response.status_code == expected
