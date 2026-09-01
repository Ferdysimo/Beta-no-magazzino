import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import report as report_router
from app.schemas import BeveragePriceDictionaryUpsert
from app.services.beverage_prices import _default_beverage_catalog


class _WriteResult:
    modified_count = 1
    deleted_count = 1


class _DictionaryCollection:
    def __init__(self):
        self.update = None

    async def update_one(self, query, update, upsert=False):
        self.update = {"query": query, "update": update, "upsert": upsert}
        return _WriteResult()

    async def find_one(self, query, projection=None):
        return None

    async def delete_one(self, query):
        return _WriteResult()


class _FakeDb:
    def __init__(self):
        self.beverage_price_dictionary = _DictionaryCollection()


def _payload(restaurant_id="restaurant-1"):
    return BeveragePriceDictionaryUpsert(
        restaurant_id=restaurant_id,
        prices=[
            {"sigla": row["sigla"], "price": row["price"] + 0.5}
            for row in _default_beverage_catalog()
        ],
    )


@pytest.mark.parametrize("token_data", [
    {},
    {"role": "restaurant", "username": "Flaminio"},
    {"role": "magazzino", "username": "Magazziniere"},
    {"role": "supervisor", "username": "Altro supervisore"},
])
def test_beverage_price_write_rejects_every_non_privileged_identity(token_data):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router.upsert_beverage_price_dictionary(
            _payload(),
            token_data=token_data,
        ))

    assert exc.value.status_code == 403


@pytest.mark.parametrize("token_data", [
    {"role": "supervisor", "username": "Federico"},
    {"role": "admin", "username": "Admin"},
    {"role": "admin", "username": "Simone"},
])
def test_beverage_price_write_allows_federico_admin_and_simone(monkeypatch, token_data):
    fake_db = _FakeDb()

    async def fake_current_prices(restaurant_id):
        return {row["sigla"]: row["price"] for row in _default_beverage_catalog()}

    async def fake_freeze(restaurant_id, current_prices, source):
        assert restaurant_id == "restaurant-1"
        assert source == "before_price_dictionary_change"
        return 7

    monkeypatch.setattr(report_router, "db", fake_db)
    monkeypatch.setattr(report_router, "_get_beverage_prices_for", fake_current_prices)
    monkeypatch.setattr(report_router, "_freeze_existing_beverage_days", fake_freeze)

    result = asyncio.run(report_router.upsert_beverage_price_dictionary(
        _payload(),
        token_data=token_data,
    ))

    assert result == {"ok": True, "count": 9, "frozen_rows": 7}
    stored = fake_db.beverage_price_dictionary.update["update"]["$set"]
    assert stored["restaurant_id"] == "restaurant-1"
    assert len(stored["prices"]) == 9
    assert stored["updated_by"] == token_data["username"]


def test_beverage_price_write_requires_the_complete_fixed_catalog(monkeypatch):
    payload = _payload()
    payload.prices = payload.prices[:-1]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router.upsert_beverage_price_dictionary(
            payload,
            token_data={"role": "supervisor", "username": "Federico"},
        ))

    assert exc.value.status_code == 400
    assert "Listino incompleto" in exc.value.detail
