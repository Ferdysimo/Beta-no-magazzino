import asyncio
import os
import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from memory_worker.collector import (
    collect_configuration_once,
    collect_orders_once,
    collect_report_once,
    collect_warehouse_once,
)
from memory_worker.config import MemorySettings
from memory_worker.snapshots import build_daily_snapshots
from memory_worker.stores import MemoryMongoStore


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MEMORY_LIVE_TESTS") != "1",
    reason="Test Mongo snapshot Memoria isolato: abilitarlo esplicitamente",
)


def test_daily_snapshot_versions_coverage_gaps_and_provenance():
    async def scenario():
        mongo_url = os.environ.get(
            "MEMORY_TEST_MONGO_URL",
            "mongodb://127.0.0.1:27017",
        )
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_snapshot_source_test_{suffix}"
        target_name = f"memory_snapshot_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        rome = ZoneInfo("Europe/Rome")
        business_day = datetime.now(rome).date() - timedelta(days=1)
        business_date = business_day.isoformat()
        activation = datetime.combine(
            business_day,
            time.min,
            tzinfo=rome,
        ).astimezone(timezone.utc)
        occurred = activation + timedelta(hours=10)
        source_db = client[source_name]
        target_db = client[target_name]
        try:
            await source_db.restaurants.insert_one({
                "id": "restaurant-1",
                "name": "Pastasciutta Roma",
                "username": "Flaminio",
                "password": "source-only",
                "location": "Flaminio",
                "role": "restaurant",
                "boiler_count": 2,
                "report_code": "F",
                "address": "Piazzale Flaminio 10",
                "postal_code": "00196",
                "city": "Roma",
                "created_at": activation.isoformat(),
            })
            beverages = [
                ("AL", "Acqua naturale", 1),
                ("AG", "Acqua frizzante", 1),
                ("C", "Coca-Cola", 2),
                ("CZ", "Coca-Cola Zero", 2),
                ("F", "Fanta", 2),
                ("S", "Sprite", 2),
                ("B", "Peroni", 2.5),
                ("VB", "Vino bianco", 2.5),
                ("VR", "Vino rosso", 2.5),
            ]
            await source_db.beverages.insert_many([
                {
                    "sigla": code,
                    "name": name,
                    "price": price,
                    "sort_order": index,
                }
                for index, (code, name, price) in enumerate(beverages, 1)
            ])
            await source_db.cash_daily_counts.insert_one({
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "updated_at": occurred.isoformat(),
                "mattina": "1000",
                "paste_text": "1 CARB",
                "pasta_dict_snapshot": [
                    {"sigla": "CARB", "price": 8},
                ],
                "pasta_dict_snapshot_version": 1,
            })
            await source_db.beverage_daily_counts.insert_many([
                {
                    "restaurant_id": "restaurant-1",
                    "date_rome": business_date,
                    "sigla": code,
                    "updated_at": occurred.isoformat(),
                    "mattina": "24",
                    "inUsc": "0",
                    "scarti": "0",
                    "sera": "24",
                }
                for code, _, _ in beverages
            ])
            await source_db.orders.insert_one({
                "id": "order-1",
                "restaurant_id": "restaurant-1",
                "order_number": 1,
                "description": "CARB",
                "status": "completed",
                "created_at": occurred.isoformat(),
            })
            await source_db.products.insert_one({
                "id": "product-1",
                "name": "Pomodori",
                "unit": "kg",
                "supplier": "Derrate",
                "quantity": 14,
                "created_at": activation.isoformat(),
            })
            await source_db.richieste.insert_one({
                "id": "request-1",
                "ddt_number": 1,
                "restaurant_id": "restaurant-1",
                "restaurant_location": "Flaminio",
                "items": [{
                    "product_id": "product-1",
                    "product_name": "Pomodori",
                    "unit": "kg",
                    "supplier": "Derrate",
                    "quantity": 6,
                }],
                "status": "evasa",
                "created_at": occurred.isoformat(),
                "evasa_at": (
                    occurred + timedelta(minutes=30)
                ).isoformat(),
            })
            await source_db.stock_movements.insert_one({
                "id": "movement-1",
                "product_id": "product-1",
                "product_name": "Pomodori",
                "delta": -6,
                "balance_after": 14,
                "cause": "evasione",
                "ref_type": "richiesta",
                "ref_id": "request-1",
                "timestamp": (
                    occurred + timedelta(minutes=30)
                ).isoformat(),
            })

            settings = MemorySettings.from_env({
                "MEMORY_ENABLED": "true",
                "MEMORY_WRITE_ENABLED": "true",
                "MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES": "true",
                "MEMORY_ACTIVATION_EPOCH_UTC": activation.isoformat(),
                "SOURCE_MONGO_URL": mongo_url,
                "SOURCE_DB_NAME": source_name,
                "MEMORY_MONGO_URL": mongo_url,
                "MEMORY_DB_NAME": target_name,
                "MEMORY_BATCH_SIZE": "50",
            })
            await collect_orders_once(settings)
            await collect_report_once(settings)
            await collect_warehouse_once(settings)
            await collect_configuration_once(settings)

            first = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            assert first["summary"]["status"] == "complete"
            assert first["summary"]["snapshot_count"] == 2
            restaurant_result = next(
                item for item in first["snapshots"]
                if item["scope_type"] == "restaurant"
            )
            assert restaurant_result["version"] == 1
            snapshot = await target_db.memory_daily_snapshots.find_one(
                {"id": restaurant_result["id"]},
                {"_id": 0},
            )
            payload = snapshot["snapshot"]
            assert payload["paste"]["by_code"] == {"CARB": 1}
            assert payload["cash"]["cash_sera_cents"] == 100800
            assert payload["orders"]["valid_count"] == 1
            assert payload["warehouse"]["requests"][
                "fulfilled_by_product"
            ] == {"product-1": 6}
            assert payload["provenance"]["source_fact_count"] > 10
            assert await target_db.memory_gaps.count_documents({
                "resolved_at": None,
            }) == 0

            repeated = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            repeated_restaurant = next(
                item for item in repeated["snapshots"]
                if item["scope_type"] == "restaurant"
            )
            assert repeated_restaurant["inserted"] is False
            assert repeated_restaurant["version"] == 1

            await source_db.cash_daily_counts.update_one(
                {
                    "restaurant_id": "restaurant-1",
                    "date_rome": business_date,
                },
                {"$set": {
                    "altro": "50",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            await collect_report_once(settings)
            corrected = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            corrected_restaurant = next(
                item for item in corrected["snapshots"]
                if item["scope_type"] == "restaurant"
            )
            assert corrected_restaurant["version"] == 2
            current = await target_db.memory_daily_snapshots.find_one(
                {
                    "scope_type": "restaurant",
                    "scope_id": "restaurant-1",
                    "business_date": business_date,
                    "is_current": True,
                },
                {"_id": 0},
            )
            assert current["snapshot"]["cash"]["cash_sera_cents"] == 105800
            assert await target_db.memory_daily_snapshots.count_documents({
                "scope_type": "restaurant",
                "scope_id": "restaurant-1",
                "business_date": business_date,
            }) == 2

            await source_db.beverage_daily_counts.delete_one({
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "sigla": "B",
            })
            report_result = await collect_report_once(settings)
            beverage_stream = next(
                item for item in report_result["streams"]
                if item["source"] == "beverage_daily"
            )
            assert beverage_stream["disappeared"] == 1
            partial = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            assert partial["summary"]["status"] == "partial"
            active_gap = await target_db.memory_gaps.find_one(
                {
                    "scope_id": "restaurant-1",
                    "code": "beverage_daily_partial",
                    "resolved_at": None,
                },
                {"_id": 0},
            )
            assert active_gap["details"]["missing_codes"] == ["B"]

            await source_db.beverage_daily_counts.insert_one({
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "sigla": "B",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "mattina": "24",
                "inUsc": "0",
                "scarti": "0",
                "sera": "24",
            })
            await collect_report_once(settings)
            recovered = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            assert recovered["summary"]["status"] == "complete"
            assert await target_db.memory_gaps.count_documents({
                "scope_id": "restaurant-1",
                "code": "beverage_daily_partial",
                "resolved_at": {"$ne": None},
            }) == 1

            configuration_changed_at = datetime.now(timezone.utc)
            await source_db.restaurants.update_one(
                {"id": "restaurant-1"},
                {"$set": {
                    "boiler_count": 9,
                    "updated_at": configuration_changed_at.isoformat(),
                }},
            )
            await source_db.beverages.insert_one({
                "sigla": "NEW",
                "name": "Nuova bevanda",
                "price": 3,
                "sort_order": 99,
            })
            await collect_configuration_once(settings)
            historical = await build_daily_snapshots(
                settings,
                business_date=business_date,
            )
            assert historical["summary"]["status"] == "complete"
            historical_restaurant = next(
                item for item in historical["snapshots"]
                if item["scope_type"] == "restaurant"
            )
            historical_document = (
                await target_db.memory_daily_snapshots.find_one(
                    {"id": historical_restaurant["id"]},
                    {"_id": 0},
                )
            )
            assert historical_document["snapshot"]["configuration"][
                "boiler_count"
            ] == 2
            assert "NEW" not in historical_document["snapshot"][
                "beverages"
            ]["expected_codes"]
            assert historical_restaurant["inserted"] is False

            assert await target_db.memory_integrity_runs.count_documents({
                "kind": "daily_snapshot_build",
            }) == 6

            store = MemoryMongoStore(
                mongo_url,
                target_name,
                timeout_ms=2500,
            )
            try:
                captured = datetime.now(timezone.utc)
                versions = []
                for offset, value in enumerate(("A", "B", "A")):
                    versions.append(await store.save_daily_snapshot(
                        epoch_id="version-cycle-epoch",
                        scope_type="test",
                        scope_id="version-cycle",
                        business_date=business_date,
                        snapshot={
                            "coverage": {"status": "complete"},
                            "value": value,
                        },
                        captured_at=captured + timedelta(seconds=offset),
                    ))
                assert [item["version"] for item in versions] == [1, 2, 3]
                assert len({item["id"] for item in versions}) == 3
                cycle_current = (
                    await target_db.memory_daily_snapshots.find_one(
                        {
                            "epoch_id": "version-cycle-epoch",
                            "scope_id": "version-cycle",
                            "is_current": True,
                        },
                        {"_id": 0},
                    )
                )
                assert cycle_current["version"] == 3
                assert cycle_current["snapshot"]["value"] == "A"
                assert "superseded_at" not in cycle_current
                assert "superseded_by" not in cycle_current
            finally:
                store.close()
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())
