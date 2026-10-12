import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import beverages as beverages_router


class _Cursor:
    def __init__(self, rows):
        self._rows = list(rows)

    async def to_list(self, _limit):
        return list(self._rows)


class _Collection:
    def __init__(self, rows):
        self._rows = list(rows)
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(query)
        matching = [
            row for row in self._rows
            if all(row.get(key) == value for key, value in query.items())
        ]
        return _Cursor(matching)


def _run(coro):
    return asyncio.run(coro)


def test_live_inventory_uses_today_price_snapshot_after_catalog_change(monkeypatch):
    rid = "flaminio"
    daily = _Collection([{
        "restaurant_id": rid,
        "date_rome": "2026-10-07",
        "sigla": "B",
        "price_snapshot": 2.5,
    }])
    inventory = _Collection([{"restaurant_id": rid, "sigla": "B", "quantity": 77}])

    async def effective_restaurant_id(_request, _token_data):
        return rid

    async def catalog(_restaurant_id):
        return [{"sigla": "B", "name": "Birra", "price": 3.0, "sort_order": 1}]

    monkeypatch.setattr(beverages_router, "db", SimpleNamespace(
        beverage_daily_counts=daily,
        beverage_inventory=inventory,
    ))
    monkeypatch.setattr(beverages_router, "_effective_restaurant_id", effective_restaurant_id)
    monkeypatch.setattr(beverages_router, "_get_beverage_catalog_for", catalog)
    monkeypatch.setattr(beverages_router, "_today_rome_str", lambda: "2026-10-07")

    result = _run(beverages_router.get_beverage_inventory(
        request=SimpleNamespace(headers={}),
        token_data={"role": "restaurant", "restaurant_id": rid},
    ))

    assert daily.queries == [{"restaurant_id": rid, "date_rome": "2026-10-07"}]
    assert result[0]["price"] == 2.5
    assert result[0]["quantity"] == 77


def test_live_inventory_falls_back_to_current_price_without_daily_snapshot(monkeypatch):
    rid = "flaminio"
    daily = _Collection([])
    inventory = _Collection([])

    async def effective_restaurant_id(_request, _token_data):
        return rid

    async def catalog(_restaurant_id):
        return [{"sigla": "B", "name": "Birra", "price": 3.0, "sort_order": 1}]

    monkeypatch.setattr(beverages_router, "db", SimpleNamespace(
        beverage_daily_counts=daily,
        beverage_inventory=inventory,
    ))
    monkeypatch.setattr(beverages_router, "_effective_restaurant_id", effective_restaurant_id)
    monkeypatch.setattr(beverages_router, "_get_beverage_catalog_for", catalog)
    monkeypatch.setattr(beverages_router, "_today_rome_str", lambda: "2026-10-07")

    result = _run(beverages_router.get_beverage_inventory(
        request=SimpleNamespace(headers={}),
        token_data={"role": "restaurant", "restaurant_id": rid},
    ))

    assert result[0]["price"] == 3.0
    assert result[0]["quantity"] == 0
