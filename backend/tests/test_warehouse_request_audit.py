import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import httpx
from fastapi import FastAPI
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import warehouse
from app.schemas import RichiestaCreate


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, branch) for branch in expected):
                return False
            continue
        if key == "edit_history.changed_at":
            values = [entry.get("changed_at") for entry in doc.get("edit_history", [])]
            if not any(
                value is not None
                and value >= expected.get("$gte", value)
                and value < expected.get("$lt", value + "z")
                for value in values
            ):
                return False
            continue
        actual = doc.get(key)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            if "$lt" in expected and (actual is None or actual >= expected["$lt"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, field, direction=None):
        field_name = field[0][0] if isinstance(field, list) else field
        reverse = (field[0][1] if isinstance(field, list) else direction) == -1
        self.docs.sort(key=lambda doc: doc.get(field_name) or "", reverse=reverse)
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.docs[:length])


class _Richieste:
    def __init__(self, docs):
        self.docs = {doc["id"]: copy.deepcopy(doc) for doc in docs}
        self.last_find_query = None

    async def find_one(self, query, projection=None):
        for doc in self.docs.values():
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    async def find_one_and_update(self, query, update, **kwargs):
        for doc in self.docs.values():
            if not _matches(doc, query):
                continue
            doc.update(copy.deepcopy(update.get("$set") or {}))
            for key, value in (update.get("$push") or {}).items():
                doc.setdefault(key, []).append(copy.deepcopy(value))
            return copy.deepcopy(doc)
        return None

    def find(self, query, projection=None):
        self.last_find_query = copy.deepcopy(query)
        docs = [copy.deepcopy(doc) for doc in self.docs.values() if _matches(doc, query)]
        if projection:
            docs = [
                {key: value for key, value in doc.items() if projection.get(key)}
                for doc in docs
            ]
        return _Cursor(docs)


class _Restaurants:
    async def find_one(self, query, projection=None):
        return {"id": query.get("id"), "name": "Locale", "location": "Flaminio"}


def _request_doc(**overrides):
    doc = {
        "id": "request-1",
        "ddt_number": 942,
        "restaurant_id": "restaurant-1",
        "restaurant_location": "Flaminio",
        "items": [{
            "product_id": "pecorino",
            "product_name": "Pecorino",
            "unit": "buste",
            "supplier": "Test",
            "quantity": 7,
        }],
        "extra_note": "",
        "status": "pending",
        "created_at": "2026-09-22T10:16:00+00:00",
        "dispatch_date": "2026-09-23T10:00:00+00:00",
    }
    doc.update(overrides)
    return doc


SIMONE = {"username": "Simone", "role": "admin", "restaurant_id": "simone-id"}
OWNER = {"username": "Flaminio", "role": "restaurant", "restaurant_id": "restaurant-1"}


def test_soft_cancel_preserves_request_and_simone_can_audit_it(monkeypatch):
    richieste = _Richieste([_request_doc()])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste, restaurants=_Restaurants()))

    result = asyncio.run(warehouse.delete_richiesta("request-1", OWNER))

    stored = richieste.docs["request-1"]
    assert result["status"] == "annullata"
    assert stored["status"] == "annullata"
    assert stored["items"][0]["quantity"] == 7
    assert stored["cancelled_by_username"] == "Flaminio"

    operational = asyncio.run(warehouse.list_richieste(OWNER))
    assert operational == []
    assert richieste.last_find_query["status"] == {"$ne": "annullata"}

    cancellation_date = stored["cancelled_at"][:10]
    audit = asyncio.run(warehouse.list_cancelled_requests(
        cancellation_date, cancellation_date, None, SIMONE,
    ))
    assert audit[0]["ddt_number"] == 942
    assert audit[0]["items"][0]["quantity"] == 7


@pytest.mark.parametrize("token", [
    {"username": "Admin", "role": "admin"},
    {"username": "Federico", "role": "supervisor"},
    {"username": "Magazziniere", "role": "magazzino"},
    {"username": "Flaminio", "role": "restaurant"},
])
def test_request_audit_is_reserved_to_simone(monkeypatch, token):
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=_Richieste([])))
    for endpoint in (warehouse.list_cancelled_requests, warehouse.list_modified_requests):
        with pytest.raises(HTTPException) as forbidden:
            asyncio.run(endpoint("2026-09-01", "2026-09-30", None, token))
        assert forbidden.value.status_code == 403


def test_request_audit_rejects_anonymous_requests():
    async def exercise():
        app = FastAPI()
        app.include_router(warehouse.router)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            for path in ("cancelled-requests", "modified-requests"):
                response = await client.get(
                    f"/admin/{path}",
                    params={"date_from": "2026-09-01", "date_to": "2026-09-30"},
                )
                assert response.status_code in (401, 403)

    asyncio.run(exercise())


def test_edit_records_before_and_after_and_modified_audit(monkeypatch):
    richieste = _Richieste([_request_doc()])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste, restaurants=_Restaurants()))
    payload = RichiestaCreate(items=[{
        "product_id": "pecorino",
        "product_name": "Pecorino",
        "unit": "buste",
        "supplier": "Test",
        "quantity": 4,
    }], extra_note="controllato")

    asyncio.run(warehouse.update_richiesta("request-1", payload, SIMONE))

    stored = richieste.docs["request-1"]
    assert stored["items"][0]["quantity"] == 4
    assert len(stored["edit_history"]) == 1
    edit = stored["edit_history"][0]
    assert edit["before_items"][0]["quantity"] == 7
    assert edit["after_items"][0]["quantity"] == 4
    assert edit["changed_by_username"] == "Simone"

    date = stored["updated_at"][:10]
    audit = asyncio.run(warehouse.list_modified_requests(date, date, None, SIMONE))
    assert audit[0]["edit_history"][0]["before_items"][0]["quantity"] == 7


def test_noop_edit_does_not_create_false_history(monkeypatch):
    original = _request_doc()
    richieste = _Richieste([original])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste, restaurants=_Restaurants()))
    payload = RichiestaCreate(items=copy.deepcopy(original["items"]), extra_note="")

    asyncio.run(warehouse.update_richiesta("request-1", payload, SIMONE))

    assert "updated_at" not in richieste.docs["request-1"]
    assert "edit_history" not in richieste.docs["request-1"]


def test_legacy_modified_request_remains_visible_without_invented_history(monkeypatch):
    richieste = _Richieste([_request_doc(
        status="confermata",
        updated_at="2026-09-20T12:00:00+00:00",
    )])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste))

    audit = asyncio.run(warehouse.list_modified_requests(
        "2026-09-01", "2026-09-30", None, SIMONE,
    ))

    assert audit[0]["ddt_number"] == 942
    assert "edit_history" not in audit[0]


def test_request_is_found_in_month_of_an_older_edit(monkeypatch):
    richieste = _Richieste([_request_doc(
        status="confermata",
        updated_at="2026-10-02T12:00:00+00:00",
        edit_history=[{
            "id": "edit-september",
            "changed_at": "2026-09-20T12:00:00+00:00",
            "before_items": [],
            "after_items": [],
        }],
    )])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste))

    audit = asyncio.run(warehouse.list_modified_requests(
        "2026-09-01", "2026-09-30", None, SIMONE,
    ))

    assert [row["ddt_number"] for row in audit] == [942]


def test_nonpending_request_cannot_be_cancelled(monkeypatch):
    richieste = _Richieste([_request_doc(status="evasa")])
    monkeypatch.setattr(warehouse, "db", SimpleNamespace(richieste=richieste))

    with pytest.raises(HTTPException) as invalid:
        asyncio.run(warehouse.delete_richiesta("request-1", SIMONE))
    assert invalid.value.status_code == 400
    assert richieste.docs["request-1"]["status"] == "evasa"
