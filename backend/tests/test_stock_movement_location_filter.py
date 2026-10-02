import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import warehouse


class _Cursor:
    def __init__(self, docs):
        self.docs = [dict(doc) for doc in docs]

    def sort(self, field, direction):
        self.docs.sort(key=lambda doc: doc.get(field, ""), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return self.docs[:length]


class _Restaurants:
    def __init__(self):
        self.docs = [
            {"id": "grazie-id", "role": "restaurant", "location": "Grazie"},
            {"id": "flaminio-id", "role": "restaurant", "location": "Flaminio"},
            {"id": "warehouse-id", "role": "magazzino", "location": "Magazzino"},
        ]

    def find(self, query, projection=None):
        return _Cursor([
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ])

    async def find_one(self, query, projection=None):
        return next((
            dict(doc) for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ), None)


class _Requests:
    def __init__(self):
        self.docs = [
            {"id": "request-flaminio-1", "restaurant_id": "flaminio-id"},
            {"id": "request-flaminio-2", "restaurant_id": "flaminio-id"},
            {"id": "request-grazie-1", "restaurant_id": "grazie-id"},
        ]

    async def distinct(self, field, query):
        return list(dict.fromkeys(
            doc.get(field) for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ))


class _Movements:
    def __init__(self):
        self.last_query = None

    def find(self, query, projection=None):
        self.last_query = dict(query)
        return _Cursor([{
            "id": "movement-1",
            "product_id": "product-1",
            "cause": "evasione",
            "ref_type": "richiesta",
            "ref_id": "request-flaminio-1",
            "timestamp": "2026-10-02T10:00:00+00:00",
        }])


class _Products:
    async def find_one(self, query, projection=None):
        if query.get("id") == "product-1":
            return {"id": "product-1", "name": "Pecorino", "quantity": 25}
        return None


def _database():
    return SimpleNamespace(
        restaurants=_Restaurants(),
        richieste=_Requests(),
        stock_movements=_Movements(),
        products=_Products(),
    )


@pytest.mark.parametrize("role", ["admin", "magazzino"])
def test_global_movements_filter_uses_requests_for_selected_location(monkeypatch, role):
    fake_db = _database()
    monkeypatch.setattr(warehouse, "db", fake_db)

    result = asyncio.run(warehouse.list_stock_movements(
        date_from="2026-10-01",
        date_to="2026-10-02",
        restaurant_id="flaminio-id",
        token_data={"role": role},
    ))

    assert fake_db.stock_movements.last_query["ref_type"] == "richiesta"
    assert fake_db.stock_movements.last_query["ref_id"] == {
        "$in": ["request-flaminio-1", "request-flaminio-2"],
    }
    assert fake_db.stock_movements.last_query["timestamp"] == {
        "$gte": "2026-10-01T00:00:00",
        "$lt": "2026-10-03T00:00:00",
    }
    assert result["locations"] == [
        {"id": "flaminio-id", "location": "Flaminio"},
        {"id": "grazie-id", "location": "Grazie"},
    ]


def test_product_movements_supports_location_and_cause_together(monkeypatch):
    fake_db = _database()
    monkeypatch.setattr(warehouse, "db", fake_db)

    result = asyncio.run(warehouse.get_product_movements(
        product_id="product-1",
        cause="evasione",
        restaurant_id="grazie-id",
        token_data={"role": "admin"},
    ))

    assert fake_db.stock_movements.last_query == {
        "product_id": "product-1",
        "cause": "evasione",
        "ref_type": "richiesta",
        "ref_id": {"$in": ["request-grazie-1"]},
    }
    assert result["product_name"] == "Pecorino"
    assert result["current_quantity"] == 25


def test_location_filter_rejects_unknown_location_and_forbidden_roles(monkeypatch):
    monkeypatch.setattr(warehouse, "db", _database())

    with pytest.raises(HTTPException) as unknown:
        asyncio.run(warehouse.list_stock_movements(
            restaurant_id="missing-id",
            token_data={"role": "admin"},
        ))
    assert unknown.value.status_code == 404

    for role in ("restaurant", "supervisor"):
        with pytest.raises(HTTPException) as forbidden:
            asyncio.run(warehouse.list_stock_movements(
                restaurant_id="flaminio-id",
                token_data={"role": role},
            ))
        assert forbidden.value.status_code == 403
