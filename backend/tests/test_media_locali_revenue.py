from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace

from app.core.time import ROME_TZ
from app.routers import analysis as analysis_router
from conftest import run_isolated


class _Cursor:
    def __init__(self, documents):
        self.documents = deepcopy(documents)

    async def to_list(self, _limit):
        return deepcopy(self.documents)


class _Collection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, _query, _projection):
        return _Cursor(self.documents)


def test_media_locali_returns_report_revenue_and_its_average(monkeypatch):
    today = datetime.now(ROME_TZ).strftime("%Y-%m-%d")
    restaurants = [{
        "id": "restaurant-1",
        "username": "Flaminio",
        "location": "Flaminio",
        "role": "restaurant",
    }]
    cash_docs = [{
        "restaurant_id": "restaurant-1",
        "date_rome": today,
        "paste_text": "1 CARB",
        "manual_prices": {},
        "pasta_dict_snapshot": [{"sigla": "CARB", "price": 9}],
    }]
    beverage_docs = [{
        "restaurant_id": "restaurant-1",
        "date_rome": today,
        "sigla": "C",
        "mattina": "10",
        "inUsc": "2",
        "scarti": "1",
        "sera": "7",
        "price_snapshot": 2,
    }]
    monkeypatch.setattr(analysis_router, "db", SimpleNamespace(
        restaurants=_Collection(restaurants),
        cash_daily_counts=_Collection(cash_docs),
        beverage_daily_counts=_Collection(beverage_docs),
    ))

    async def fake_order_data(*_args, **_kwargs):
        return {"texts": {}, "counts": {("restaurant-1", today): 2}}

    async def fake_pasta_prices(_restaurant_id):
        return {"CARB": 100}

    async def fake_beverage_prices(_restaurant_id):
        return {"C": 50}

    monkeypatch.setattr(
        analysis_router, "_prefetch_analysis_order_data", fake_order_data
    )
    monkeypatch.setattr(
        analysis_router, "_get_pasta_dict_for", fake_pasta_prices
    )
    monkeypatch.setattr(
        analysis_router, "_get_beverage_prices_for", fake_beverage_prices
    )

    result = run_isolated(analysis_router.get_media_locali(
        {"role": "admin", "username": "Simone"}
    ))

    assert result["locations"] == ["Flaminio"]
    assert result["averages"]["Flaminio"] == 2
    assert result["revenue_averages"]["Flaminio"] == 17
    assert result["days"][0]["locations"]["Flaminio"] == 2
    assert result["days"][0]["revenues"]["Flaminio"] == 17
