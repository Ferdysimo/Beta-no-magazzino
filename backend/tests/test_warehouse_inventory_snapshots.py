import asyncio
import copy
import sys
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.time import ROME_TZ
from app.routers import warehouse
from app.tasks import warehouse_inventory_snapshots as snapshots_task


def _matches(doc, query):
    for key, expected in query.items():
        actual = doc.get(key)
        if isinstance(expected, dict):
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = copy.deepcopy(docs)

    def sort(self, field, direction):
        self.docs.sort(key=lambda doc: doc.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.docs[:length])


class _Collection:
    def __init__(self, docs=None):
        self.docs = copy.deepcopy(docs or [])
        self.last_query = None

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    def find(self, query, projection=None):
        self.last_query = copy.deepcopy(query)
        return _Cursor([doc for doc in self.docs if _matches(doc, query)])

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                return SimpleNamespace(upserted_id=None)
        if upsert:
            inserted = copy.deepcopy(update["$setOnInsert"])
            self.docs.append(inserted)
            return SimpleNamespace(upserted_id=inserted["id"])
        return SimpleNamespace(upserted_id=None)


def _db(products=None, movements=None, stored_snapshots=None):
    return SimpleNamespace(
        products=_Collection(products),
        stock_movements=_Collection(movements),
        warehouse_inventory_snapshots=_Collection(stored_snapshots),
    )


def _rome(value):
    return datetime.fromisoformat(value).replace(tzinfo=ROME_TZ)


SIMONE = {"username": "Simone", "role": "admin", "restaurant_id": "simone-id"}


def test_scheduled_snapshot_captures_point_in_time_inventory_once(monkeypatch):
    fake_db = _db(products=[
        {"id": "pecorino", "name": "Pecorino", "quantity": 80, "unit": "buste", "supplier": "Test"},
        {"id": "grana", "name": "Grana", "quantity": 45, "unit": "buste", "supplier": "Test"},
    ])
    monkeypatch.setattr(snapshots_task, "db", fake_db)

    first = asyncio.run(snapshots_task.capture_warehouse_inventory_snapshot(
        now_rome=_rome("2026-10-07T06:00:10"),
    ))
    second = asyncio.run(snapshots_task.capture_warehouse_inventory_snapshot(
        now_rome=_rome("2026-10-07T06:00:30"),
    ))

    assert first["created"] is True
    assert second["created"] is False
    assert len(fake_db.warehouse_inventory_snapshots.docs) == 1
    snapshot = fake_db.warehouse_inventory_snapshots.docs[0]
    assert snapshot["business_date"] == "2026-10-07"
    assert snapshot["scheduled_at"].startswith("2026-10-07T06:00:00")
    assert snapshot["data_quality"] == "point_in_time"
    assert [(item["product_id"], item["quantity"]) for item in snapshot["products"]] == [
        ("grana", 45),
        ("pecorino", 80),
    ]


def test_late_snapshot_reconstructs_six_oclock_from_ledger(monkeypatch):
    fake_db = _db(
        products=[
            {
                "id": "pecorino", "name": "Pecorino", "quantity": 90,
                "unit": "buste", "supplier": "Test", "created_at": "2026-01-01T10:00:00+00:00",
            },
            {
                "id": "grana", "name": "Grana", "quantity": 50,
                "unit": "buste", "supplier": "Test", "created_at": "2026-01-01T10:00:00+00:00",
            },
            {
                "id": "new", "name": "Prodotto nuovo", "quantity": 5,
                "unit": "pz", "supplier": "Test", "created_at": "2026-10-07T05:00:00+00:00",
            },
        ],
        movements=[
            {"product_id": "pecorino", "delta": -10, "timestamp": "2026-10-07T05:00:00+00:00"},
            {"product_id": "grana", "delta": 20, "timestamp": "2026-10-07T05:30:00+00:00"},
            {"product_id": "new", "delta": 5, "timestamp": "2026-10-07T05:00:00+00:00"},
            {"product_id": "pecorino", "delta": -99, "timestamp": "2026-10-07T03:00:00+00:00"},
        ],
    )
    monkeypatch.setattr(snapshots_task, "db", fake_db)

    result = asyncio.run(snapshots_task.capture_warehouse_inventory_snapshot(
        now_rome=_rome("2026-10-07T08:00:00"),
        trigger="startup_recovery",
    ))

    assert result["created"] is True
    snapshot = fake_db.warehouse_inventory_snapshots.docs[0]
    assert snapshot["data_quality"] == "reconstructed_from_ledger"
    assert snapshot["movement_count_used"] == 3
    quantities = {item["product_id"]: item["quantity"] for item in snapshot["products"]}
    assert quantities == {"pecorino": 100, "grana": 30}
    assert fake_db.stock_movements.last_query == {
        "timestamp": {
            "$gte": "2026-10-07T04:00:00+00:00",
            "$lte": "2026-10-07T06:00:00+00:00",
        },
    }


def test_snapshot_rejects_capture_before_six(monkeypatch):
    monkeypatch.setattr(snapshots_task, "db", _db())
    with pytest.raises(ValueError):
        asyncio.run(snapshots_task.capture_warehouse_inventory_snapshot(
            now_rome=_rome("2026-10-07T05:59:59"),
        ))


def test_scheduler_delay_respects_rome_daylight_saving_changes():
    before_spring_change = _rome("2026-03-28T06:00:00")
    spring_target = snapshots_task._scheduled_at_rome(date(2026, 3, 29))
    assert snapshots_task._seconds_until(spring_target, before_spring_change) == 23 * 3600

    before_autumn_change = _rome("2026-10-24T06:00:00")
    autumn_target = snapshots_task._scheduled_at_rome(date(2026, 10, 25))
    assert snapshots_task._seconds_until(autumn_target, before_autumn_change) == 25 * 3600


def test_simone_can_read_snapshots_by_date_and_other_roles_cannot(monkeypatch):
    fake_db = _db(stored_snapshots=[
        {"id": "snap-1", "business_date": "2026-10-06", "products": []},
        {"id": "snap-2", "business_date": "2026-10-07", "products": []},
        {"id": "snap-old", "business_date": "2026-09-30", "products": []},
    ])
    monkeypatch.setattr(warehouse, "db", fake_db)

    result = asyncio.run(warehouse.list_warehouse_inventory_snapshots(
        "2026-10-01", "2026-10-31", SIMONE,
    ))
    assert [item["business_date"] for item in result["snapshots"]] == [
        "2026-10-07", "2026-10-06",
    ]

    for token in (
        {"username": "Admin", "role": "admin"},
        {"username": "Federico", "role": "supervisor"},
        {"username": "Magazziniere", "role": "magazzino"},
        {"username": "Flaminio", "role": "restaurant"},
    ):
        with pytest.raises(HTTPException) as forbidden:
            asyncio.run(warehouse.list_warehouse_inventory_snapshots(
                "2026-10-01", "2026-10-31", token,
            ))
        assert forbidden.value.status_code == 403


def test_snapshot_route_rejects_anonymous_requests():
    async def exercise():
        app = FastAPI()
        app.include_router(warehouse.router)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/admin/warehouse-inventory-snapshots",
                params={"date_from": "2026-10-01", "date_to": "2026-10-31"},
            )
        assert response.status_code in (401, 403)

    asyncio.run(exercise())
