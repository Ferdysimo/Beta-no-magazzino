import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

from conftest import run_isolated


if os.environ.get("PASTA_RUN_ISOLATED_INTEGRATION") != "1":
    pytest.skip(
        "Set PASTA_RUN_ISOLATED_INTEGRATION=1 with an isolated DB_NAME",
        allow_module_level=True,
    )

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server
from app.services.report import _compute_cash_sera_full


def test_concurrent_orders_and_midnight_carry_over_in_isolated_database():
    run_isolated(_exercise_concurrent_orders_and_midnight_carry_over())


async def _exercise_concurrent_orders_and_midnight_carry_over():
    db_name = os.environ["DB_NAME"]
    assert db_name.startswith("pastasciutta_refactor_test_")

    restaurant_id = str(uuid.uuid4())
    rome_now = datetime.now(ZoneInfo("Europe/Rome"))
    today = rome_now.strftime("%Y-%m-%d")
    yesterday = (rome_now - timedelta(days=1)).strftime("%Y-%m-%d")

    await server.client.drop_database(db_name)
    try:
        await server.db.restaurants.insert_one({
            "id": restaurant_id,
            "name": "Refactor test",
            "username": "RefactorTest",
            "location": "Refactor test",
            "role": "restaurant",
            "order_counter": 0,
            "created_at": datetime.now(ZoneInfo("UTC")).isoformat(),
        })
        await server.db.orders.create_index(
            [("restaurant_id", 1), ("order_number", 1)],
            unique=True,
            name="uniq_restaurant_order_number",
        )

        token = server.create_token(
            restaurant_id,
            "Refactor test",
            username="RefactorTest",
        )
        headers = {"Authorization": f"Bearer {token}"}
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            timeout=30,
        ) as client:
            responses = await asyncio.gather(*[
                client.post(
                    "/api/orders",
                    json={"description": f"TEST {index}"},
                    headers=headers,
                )
                for index in range(20)
            ])
            assert all(response.status_code == 200 for response in responses)
            numbers = sorted(response.json()["order_number"] for response in responses)
            assert numbers == list(range(1, 21))

            duplicate = await client.post(
                "/api/orders",
                json={"description": "DUPLICATE", "order_number": 1},
                headers=headers,
            )
            assert duplicate.status_code == 409

            next_number = await client.get("/api/orders/next-number", headers=headers)
            assert next_number.status_code == 200
            assert next_number.json()["next_number"] == 21

        previous_cash = {
            "restaurant_id": restaurant_id,
            "date_rome": yesterday,
            "mattina": "100",
            "altro": "10",
            "pos": "20",
            "cd5": "20",
            "sp5": "2",
        }
        previous_beverage = {
            "restaurant_id": restaurant_id,
            "date_rome": yesterday,
            "sigla": "AL",
            "mattina": "25",
            "inUsc": "",
            "scarti": "",
            "sera": "25",
        }
        await server.db.cash_daily_counts.insert_one(previous_cash)
        await server.db.beverage_daily_counts.insert_one(previous_beverage)
        expected_cash_mattina = _compute_cash_sera_full(
            previous_cash,
            [previous_beverage],
            {},
        )

        await server.midnight_reset()

        assert await server.db.orders.count_documents({}) == 0
        assert await server.db.archived_orders.count_documents(
            {"restaurant_id": restaurant_id}
        ) == 20
        restaurant = await server.db.restaurants.find_one({"id": restaurant_id})
        assert restaurant["order_counter"] == 0

        today_cash = await server.db.cash_daily_counts.find_one({
            "restaurant_id": restaurant_id,
            "date_rome": today,
        })
        assert float(today_cash["mattina"]) == expected_cash_mattina
        assert today_cash["mattina_auto_carry"] is True
        assert today_cash["cd5"] == "18"
        assert today_cash["cd5_auto_carry"] is True

        today_beverage = await server.db.beverage_daily_counts.find_one({
            "restaurant_id": restaurant_id,
            "date_rome": today,
            "sigla": "AL",
        })
        assert today_beverage["mattina"] == "25"
        assert today_beverage["mattina_casse"] == "1"
        assert today_beverage["mattina_sfuse"] == "1"
        assert today_beverage["mattina_auto_carry"] is True
    finally:
        await server.client.drop_database(db_name)
