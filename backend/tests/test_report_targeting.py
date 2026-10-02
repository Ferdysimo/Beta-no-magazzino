import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import report as report_router
from app.schemas import BeverageDailyUpsert, CashDailyUpsert
from app.services.report import _normalize_audit_user_label


FEDERICO = {
    "role": "supervisor",
    "username": "Federico",
    "restaurant_id": "federico-id",
    "authenticated_restaurant_id": "federico-id",
}
ADMIN = {
    "role": "admin",
    "username": "Admin",
    "restaurant_id": "admin-id",
    "authenticated_restaurant_id": "admin-id",
}


class _Restaurants:
    async def find_one(self, query, projection=None):
        if query.get("role") == "restaurant" and query.get("id") in {
            "flaminio-id", "brazza-id",
        }:
            return {"id": query["id"]}
        return None


def _request(headers=None):
    raw_headers = [
        (str(key).lower().encode("latin-1"), str(value).encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "method": "PUT", "path": "/", "headers": raw_headers})


@pytest.fixture(autouse=True)
def _fake_database(monkeypatch):
    monkeypatch.setattr(report_router, "db", SimpleNamespace(restaurants=_Restaurants()))


@pytest.mark.parametrize("token_data", [FEDERICO, ADMIN])
def test_privileged_live_report_requires_an_explicit_operational_target(token_data):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router._resolve_live_report_target(_request(), token_data))
    assert exc.value.status_code == 400


def test_target_may_come_from_payload_or_legacy_header():
    assert asyncio.run(report_router._resolve_live_report_target(
        _request(), FEDERICO, "brazza-id",
    )) == "brazza-id"
    assert asyncio.run(report_router._resolve_live_report_target(
        _request({"X-Restaurant-Id": "flaminio-id"}), FEDERICO,
    )) == "flaminio-id"


@pytest.mark.parametrize("headers", [
    {"X-Restaurant-Id": "flaminio-id"},
    {"X-Admin-Restaurant-Id": "flaminio-id"},
])
def test_payload_and_impersonation_headers_cannot_disagree(headers):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router._resolve_live_report_target(
            _request(headers), FEDERICO, "brazza-id",
        ))
    assert exc.value.status_code == 409


def test_technical_account_is_never_a_report_owner():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router._resolve_live_report_target(
            _request(), FEDERICO, "federico-id",
        ))
    assert exc.value.status_code == 400


def test_restaurant_is_bound_to_its_own_report():
    restaurant = {
        "role": "restaurant",
        "username": "Brazzà",
        "restaurant_id": "brazza-id",
        "authenticated_restaurant_id": "brazza-id",
    }
    assert asyncio.run(report_router._resolve_live_report_target(
        _request(), restaurant,
    )) == "brazza-id"
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router._resolve_live_report_target(
            _request(), restaurant, "flaminio-id",
        ))
    assert exc.value.status_code == 403


def test_other_supervisors_cannot_impersonate_report_targets():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(report_router._resolve_live_report_target(
            _request(), {**FEDERICO, "username": "Altro"}, "brazza-id",
        ))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("route,data", [
    (report_router.upsert_cash_daily, CashDailyUpsert(cd1="31")),
    (report_router.upsert_beverage_daily, BeverageDailyUpsert(sigla="C", sera="1")),
])
def test_live_report_write_routes_reject_missing_target(route, data):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(route(data=data, request=_request(), token_data=FEDERICO))
    assert exc.value.status_code == 400


def test_audit_label_keeps_federico_distinct_from_admin():
    assert _normalize_audit_user_label({
        "by_role": "supervisor",
        "by_user": "Federico",
        "is_impersonating": True,
    }, {}) == "Federico"
    assert _normalize_audit_user_label({
        "by_role": "admin",
        "by_user": "Simone",
        "is_impersonating": True,
    }, {}) == "Admin"
