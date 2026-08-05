import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import httpx
from fastapi import FastAPI, HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import beverages, warehouse
from app.schemas import ProductWasteCreate


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args):
        return self

    async def to_list(self, length):
        return self.docs[:length]


class _Products:
    def __init__(self, docs):
        self.docs = {doc["id"]: dict(doc) for doc in docs}

    async def find_one_and_update(self, query, update, **kwargs):
        doc = self.docs.get(query.get("id"))
        if not doc:
            return None
        minimum = (query.get("quantity") or {}).get("$gte")
        if minimum is not None and int(doc.get("quantity", 0)) < minimum:
            return None
        doc["quantity"] = int(doc.get("quantity", 0)) + int(update["$inc"]["quantity"])
        doc.update(update.get("$set") or {})
        return dict(doc)

    async def find_one(self, query, projection=None):
        doc = self.docs.get(query.get("id"))
        return dict(doc) if doc else None

    def find(self, query, projection=None):
        return _Cursor([dict(doc) for doc in self.docs.values()])


class _Movements:
    def __init__(self, aggregate_docs=None):
        self.inserted = []
        self.aggregate_docs = aggregate_docs or []
        self.pipeline = None

    async def insert_one(self, document):
        self.inserted.append(dict(document))

    def aggregate(self, pipeline):
        self.pipeline = pipeline
        return _Cursor(self.aggregate_docs)


class _AggregateCollection:
    def __init__(self, docs):
        self.docs = docs

    def aggregate(self, pipeline):
        return _Cursor(self.docs)


class _FindCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query, projection=None):
        return _Cursor(self.docs)


ADMIN_TOKEN = {
    "role": "admin",
    "restaurant_id": "admin-id",
    "restaurant_name": "Amministrazione",
}


@pytest.mark.parametrize("username", ["Admin", "Simone"])
def test_admin_waste_decrements_stock_and_records_reason(monkeypatch, username):
    products = _Products([{"id": "p1", "name": "Farina test", "quantity": 12}])
    movements = _Movements()
    monkeypatch.setattr(
        warehouse,
        "db",
        SimpleNamespace(products=products, stock_movements=movements),
    )

    result = asyncio.run(warehouse.create_product_waste(
        "p1",
        ProductWasteCreate(quantity=4, reason="  confezione   rotta  "),
        {**ADMIN_TOKEN, "username": username},
    ))

    assert result["balance_after"] == 8
    assert result["reason"] == "confezione rotta"
    assert products.docs["p1"]["quantity"] == 8
    assert movements.inserted[0]["delta"] == -4
    assert movements.inserted[0]["cause"] == "scarto_admin"
    assert movements.inserted[0]["reason"] == "confezione rotta"


def test_waste_rejects_non_admin_and_insufficient_stock(monkeypatch):
    products = _Products([{"id": "p1", "name": "Farina test", "quantity": 2}])
    movements = _Movements()
    monkeypatch.setattr(
        warehouse,
        "db",
        SimpleNamespace(products=products, stock_movements=movements),
    )

    for token in (
        {"role": "restaurant", "username": "Flaminio"},
        {"role": "magazzino", "username": "Magazziniere"},
        {"role": "supervisor", "username": "Federico"},
    ):
        with pytest.raises(HTTPException) as forbidden:
            asyncio.run(warehouse.create_product_waste(
                "p1",
                ProductWasteCreate(quantity=1, reason="rotta"),
                token,
            ))
        assert forbidden.value.status_code == 403

    with pytest.raises(HTTPException) as insufficient:
        asyncio.run(warehouse.create_product_waste(
            "p1",
            ProductWasteCreate(quantity=3, reason="rotta"),
            ADMIN_TOKEN,
        ))
    assert insufficient.value.status_code == 400
    assert products.docs["p1"]["quantity"] == 2
    assert movements.inserted == []


def test_waste_rejects_anonymous_requests():
    asyncio.run(_assert_anonymous_rejected())


async def _assert_anonymous_rejected():
    app = FastAPI()
    app.include_router(warehouse.router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/products/p1/waste",
            json={"quantity": 1, "reason": "rotta"},
        )

    assert response.status_code in (401, 403)


def test_warehouse_analysis_exposes_waste_as_last_metric(monkeypatch):
    movements = _Movements([{"_id": "p1", "total": 3}])
    monkeypatch.setattr(
        beverages,
        "db",
        SimpleNamespace(
            restaurants=_FindCollection([{"location": "Flaminio"}]),
            carichi_magazzino=_AggregateCollection([{"_id": "p1", "total": 10}]),
            stock_movements=movements,
            richieste=_AggregateCollection([]),
            products=_Products([{
                "id": "p1",
                "name": "Farina test",
                "unit": "pz",
                "supplier": "Test",
                "quantity": 7,
            }]),
        ),
    )

    result = asyncio.run(beverages.analisi_magazzino(
        "2026-08-01",
        "2026-08-31",
        {"role": "admin"},
    ))

    assert result["products"][0]["incoming"] == 10
    assert result["products"][0]["waste"] == 3
    match = movements.pipeline[0]["$match"]
    assert match["cause"] == "scarto_admin"
    assert match["delta"] == {"$lt": 0}
