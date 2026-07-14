import sys
import asyncio
from collections import Counter
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server
from app.core.database import db
from app.core.ws_manager import manager
from app.routers import analysis, orders, report
from app.services import analysis as analysis_service
from app.services import orders as orders_service
from app.services import report as report_service
from app.tasks import midnight, stale_orders


def test_critical_modules_share_database_and_websocket_singletons():
    assert server.db is db
    assert analysis_service.db is db
    assert orders_service.db is db
    assert report_service.db is db

    assert server.manager is manager
    assert orders.manager is manager
    assert midnight.manager is manager


def test_critical_routes_are_owned_once():
    route_pairs = [
        (method, route.path)
        for route in server.app.routes
        for method in (getattr(route, "methods", None) or [])
        if method not in {"HEAD", "OPTIONS"}
    ]
    duplicates = {
        pair: count
        for pair, count in Counter(route_pairs).items()
        if count > 1
    }

    assert duplicates == {}
    assert len(orders.router.routes) == 18
    assert len(report.router.routes) == 18
    assert len(analysis.router.routes) == 4


def test_server_keeps_phase2_compatibility_reexports():
    assert server.create_order is orders.create_order
    assert server.get_cash_daily is report.get_cash_daily
    assert server.export_analisi_mensile_excel is analysis.export_analisi_mensile_excel
    assert server.midnight_reset is midnight.midnight_reset
    assert server.recover_stale_orders is stale_orders.recover_stale_orders


def test_critical_modules_do_not_depend_on_server_module():
    for directory in (
        BACKEND_DIR / "app" / "routers",
        BACKEND_DIR / "app" / "services",
        BACKEND_DIR / "app" / "tasks",
    ):
        for path in directory.rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            assert "import server" not in source
            assert "from server import" not in source


def test_cash_mattina_carries_previous_cash_sera_without_overwriting_manual_value():
    previous = {
        "date_rome": "2026-07-13",
        "mattina": "100",
        "altro": "10",
        "pos": "20",
    }
    automatic = asyncio.run(report_service._cash_mattina_carry_fields(
        rid="r1",
        target_date="2026-07-14",
        today_cash={},
        last_cash=previous,
        prev_bev_docs=[],
        dict_map={},
    ))
    manual = asyncio.run(report_service._cash_mattina_carry_fields(
        rid="r1",
        target_date="2026-07-14",
        today_cash={"mattina": "999", "mattina_auto_carry": False},
        last_cash=previous,
        prev_bev_docs=[],
        dict_map={},
    ))

    assert automatic["mattina"] == "90"
    assert automatic["mattina_auto_carry"] is True
    assert automatic["mattina_carry_from_date"] == "2026-07-13"
    assert manual == {}


def test_cash_drawer_and_beverage_openings_keep_previous_evening_values():
    cash_fields = asyncio.run(report_service._cash_cassetto_carry_fields(
        rid="r1",
        target_date="2026-07-14",
        today_cash={},
        last_cash={"date_rome": "2026-07-13", "cd5": "20", "sp5": "2"},
    ))
    beverage_fields = asyncio.run(report_service._beverage_mattina_carry_fields(
        rid="r1",
        target_date="2026-07-14",
        sigla="AL",
        today_row={},
        prev_row={"date_rome": "2026-07-13", "sera": "25"},
    ))

    assert cash_fields["cd5"] == "18"
    assert cash_fields["cd5_auto_carry"] is True
    assert beverage_fields["mattina"] == "25"
    assert beverage_fields["mattina_casse"] == "1"
    assert beverage_fields["mattina_sfuse"] == "1"
