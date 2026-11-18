import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import orders as orders_router
from app.services import kitchen_routing


def _run(coro):
    return asyncio.run(coro)


def test_routing_adds_marker_only_to_configured_sigla_when_enabled():
    config = {
        "enabled": True,
        "boiler2_siglas": ["CARB", "PESTO", "POM", "AMAT"],
    }

    assert kitchen_routing.route_order_description("carb rig 12", config) == "carb rig 12 -"
    assert kitchen_routing.route_order_description("POM TA 8 -", config) == "POM TA 8 -"
    assert kitchen_routing.route_order_description("cacio 4 -", config) == "cacio 4"


def test_routing_disabled_sends_every_new_order_to_standard_boiler():
    config = {"enabled": False, "boiler2_siglas": ["CARB"]}

    assert kitchen_routing.route_order_description("CARB 7 -", config) == "CARB 7"
    assert kitchen_routing.route_order_description("RAGU 9", config) == "RAGU 9"


def test_stored_toggle_expires_on_the_next_rome_day(monkeypatch):
    monkeypatch.setattr(kitchen_routing, "_today_rome_str", lambda: "2026-11-18")
    restaurant = {
        "kitchen_routing": {
            "enabled": True,
            "enabled_date": "2026-11-17",
            "boiler2_siglas": ["CARB"],
        }
    }

    result = kitchen_routing.kitchen_routing_config_from_restaurant(restaurant)

    assert result["enabled"] is False
    assert result["enabled_date"] is None
    assert result["boiler2_siglas"] == ["CARB"]


def test_single_boiler_restaurant_cannot_enable_divisions(monkeypatch):
    class Restaurants:
        async def find_one(self, _query, _projection):
            return {"id": "grazie", "boiler_count": 1}

    monkeypatch.setattr(kitchen_routing, "db", type("Db", (), {"restaurants": Restaurants()})())

    with pytest.raises(ValueError, match="due bollitori"):
        _run(kitchen_routing.update_kitchen_routing_config(
            "grazie",
            enabled=True,
            boiler2_siglas=None,
            standard_siglas=None,
            updated_by="Grazie",
        ))


def test_toggle_updates_only_enabled_fields_and_preserves_sigla_list(monkeypatch):
    class Restaurants:
        def __init__(self):
            self.document = {
                "id": "flaminio",
                "boiler_count": 2,
                "kitchen_routing": {"boiler2_siglas": ["CARB", "CACIO"]},
            }
            self.last_update = None

        async def find_one(self, _query, _projection):
            return self.document

        async def update_one(self, _query, update):
            self.last_update = update
            for path, value in update["$set"].items():
                _, field = path.split(".", 1)
                self.document.setdefault("kitchen_routing", {})[field] = value

    restaurants = Restaurants()
    monkeypatch.setattr(kitchen_routing, "db", type("Db", (), {"restaurants": restaurants})())
    monkeypatch.setattr(kitchen_routing, "_today_rome_str", lambda: "2026-11-18")

    result = _run(kitchen_routing.update_kitchen_routing_config(
        "flaminio",
        enabled=True,
        boiler2_siglas=None,
        standard_siglas=None,
        updated_by="Flaminio",
    ))

    assert "kitchen_routing.boiler2_siglas" not in restaurants.last_update["$set"]
    assert "kitchen_routing.standard_siglas" not in restaurants.last_update["$set"]
    assert result["enabled"] is True
    assert result["boiler2_siglas"] == ["CARB", "CACIO"]


def test_same_sigla_cannot_be_saved_in_both_boilers(monkeypatch):
    class Restaurants:
        async def find_one(self, _query, _projection):
            return {"id": "flaminio", "boiler_count": 2}

    monkeypatch.setattr(kitchen_routing, "db", type("Db", (), {"restaurants": Restaurants()})())

    with pytest.raises(ValueError, match="entrambi i bollitori: CARB"):
        _run(kitchen_routing.update_kitchen_routing_config(
            "flaminio",
            enabled=None,
            boiler2_siglas=["carb", "pesto"],
            standard_siglas=["CARB", "CACIO"],
            updated_by="Flaminio",
        ))


@pytest.mark.parametrize("role", ["restaurant", "admin", "supervisor"])
def test_cassa_roles_can_read_routing(monkeypatch, role):
    async def fake_get(_restaurant_id):
        return {"restaurant_id": "flaminio", "enabled": False, "boiler2_siglas": []}

    monkeypatch.setattr(orders_router, "get_kitchen_routing_config", fake_get)
    result = _run(orders_router.read_kitchen_routing({
        "role": role,
        "restaurant_id": "flaminio",
    }))

    assert result["restaurant_id"] == "flaminio"


def test_warehouse_role_cannot_change_cassa_routing():
    with pytest.raises(HTTPException) as exc:
        _run(orders_router.write_kitchen_routing(
            kitchen_routing_config_update(enabled=True),
            {"role": "magazzino", "restaurant_id": "warehouse"},
        ))

    assert exc.value.status_code == 403


def kitchen_routing_config_update(**kwargs):
    return orders_router.KitchenRoutingConfigUpdate(**kwargs)
