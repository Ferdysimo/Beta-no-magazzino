from copy import deepcopy
import re
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.state import RESTAURANT_LOCATION_CACHE
from app.routers import system as system_router
from app.routers import warehouse as warehouse_router
from app.schemas import LocalRestaurantCreate
from app.services.analysis import _media_code_for_restaurant
from conftest import run_isolated


class _ListCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _limit):
        return deepcopy(self.documents)


class _FakeRestaurants:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    @staticmethod
    def _matches(document, query):
        for field, expected in query.items():
            actual = document.get(field)
            if isinstance(expected, dict) and "$regex" in expected:
                flags = re.IGNORECASE if expected.get("$options") == "i" else 0
                if re.fullmatch(expected["$regex"], str(actual or ""), flags) is None:
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        for document in self.documents:
            if self._matches(document, query):
                return deepcopy(document)
        return None

    def find(self, query, projection=None):
        return _ListCursor([
            document for document in self.documents
            if self._matches(document, query)
        ])

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document["id"])


def _payload(**overrides):
    data = {
        "username": "Trastevere",
        "location": "Trastevere",
        "password": "Password@123",
        "report_code": "TR",
        "boiler_count": 2,
        "address": "Via Roma 10",
        "postal_code": "00153",
        "city": "Roma",
        "monitor_customers_enabled": True,
    }
    data.update(overrides)
    return LocalRestaurantCreate(**data)


def test_create_local_restaurant_persists_complete_configuration(monkeypatch):
    restaurants = _FakeRestaurants([
        {"id": "flaminio", "username": "Flaminio", "location": "Flaminio", "role": "restaurant"},
        {"id": "grazie", "username": "Grazie", "location": "Grazie", "role": "restaurant"},
    ])
    monkeypatch.setattr(system_router, "db", SimpleNamespace(restaurants=restaurants))
    monkeypatch.setattr(system_router.pwd_context, "hash", lambda password: f"hashed:{password}")
    previous_cache = dict(RESTAURANT_LOCATION_CACHE)

    try:
        response = run_isolated(system_router.create_local_restaurant(
            _payload(),
            {"username": "Simone", "role": "admin"},
        ))
        saved = restaurants.documents[-1]

        assert response.location == "Trastevere"
        assert response.report_code == "TR"
        assert response.monitor_customers_enabled is True
        assert saved["password"] == "hashed:Password@123"
        assert saved["boiler_count"] == 2
        assert saved["address"] == "Via Roma 10"
        assert saved["postal_code"] == "00153"
        assert saved["city"] == "Roma"
        assert RESTAURANT_LOCATION_CACHE[saved["id"]] == "Trastevere"
    finally:
        RESTAURANT_LOCATION_CACHE.clear()
        RESTAURANT_LOCATION_CACHE.update(previous_cache)


def test_create_local_restaurant_rejects_legacy_media_code_collision(monkeypatch):
    restaurants = _FakeRestaurants([
        {"id": "flaminio", "username": "Flaminio", "location": "Flaminio", "role": "restaurant"},
    ])
    monkeypatch.setattr(system_router, "db", SimpleNamespace(restaurants=restaurants))

    with pytest.raises(HTTPException) as exc:
        run_isolated(system_router.create_local_restaurant(
            _payload(report_code="F"),
            {"username": "Simone", "role": "admin"},
        ))

    assert exc.value.status_code == 400
    assert "Sigla Excel" in exc.value.detail


def test_dynamic_ddt_address_uses_restaurant_configuration(monkeypatch):
    restaurants = _FakeRestaurants([{
        "id": "trastevere",
        "name": "Pastasciutta Roma",
        "location": "Trastevere",
        "address": "Via Roma 10",
        "postal_code": "00153",
        "city": "Roma",
    }])
    monkeypatch.setattr(warehouse_router, "db", SimpleNamespace(restaurants=restaurants))

    enriched = run_isolated(warehouse_router._enrich_richiesta({
        "id": "request-1",
        "restaurant_id": "trastevere",
    }))

    assert enriched["destinatario"] == {
        "name": "Trastevere",
        "address": "Via Roma 10",
        "postal_code": "00153",
        "city": "Roma",
    }


def test_media_code_prefers_configured_code_and_keeps_legacy_fallback():
    assert _media_code_for_restaurant({"location": "Trastevere", "report_code": "tr"}) == "TR"
    assert _media_code_for_restaurant({"location": "Flaminio"}) == "F"
