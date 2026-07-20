import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from memory_worker.collector import collect_report_once
from memory_worker.config import MemorySettings
from memory_worker.stores import MemoryMongoStore


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MEMORY_LIVE_TESTS") != "1",
    reason="Test Mongo Report Memoria isolato: abilitarlo esplicitamente",
)


def test_report_collector_is_temporal_idempotent_and_source_safe():
    async def scenario():
        mongo_url = os.environ.get(
            "MEMORY_TEST_MONGO_URL",
            "mongodb://127.0.0.1:27017",
        )
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_report_source_test_{suffix}"
        target_name = f"memory_report_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        activation = datetime.now(timezone.utc) - timedelta(minutes=5)
        current_date = activation.astimezone(
            ZoneInfo("Europe/Rome")
        ).date()
        business_date = current_date.isoformat()
        previous_date = (current_date - timedelta(days=1)).isoformat()
        source_db = client[source_name]
        target_db = client[target_name]
        try:
            cash = {
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "updated_at": (
                    activation + timedelta(minutes=1)
                ).isoformat(),
                "mattina": "1000",
                "altro": "20",
                "sp5": "1",
                "cd5": "3",
                "paste_text": "1 CARB\n2 - AMAT",
                "manual_prices": {"2 - AMAT": "9"},
                "pasta_dict_snapshot": [
                    {"sigla": "CARB", "price": 8},
                    {"sigla": "AMAT", "price": 8},
                ],
                "pasta_dict_snapshot_version": 1,
                "password": "must-not-be-copied",
            }
            malformed_cash = {
                "date_rome": business_date,
                "updated_at": (
                    activation + timedelta(minutes=2)
                ).isoformat(),
                "mattina": "500",
            }
            beverage = {
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "sigla": "AL",
                "updated_at": (
                    activation + timedelta(minutes=1)
                ).isoformat(),
                "mattina": "48",
                "inUsc": "24",
                "scarti": "2",
                "sera": "30",
                "mattina_casse": "2",
                "mattina_sfuse": "0",
                "inUsc_casse": "1",
                "sera_casse": "1",
                "sera_sfuse": "6",
            }
            malformed_beverage = {
                "date_rome": business_date,
                "sigla": "C",
                "updated_at": (
                    activation + timedelta(minutes=2)
                ).isoformat(),
                "mattina": "24",
            }
            audit = {
                "id": "audit-1",
                "restaurant_id": "restaurant-1",
                "date_rome": business_date,
                "category": "cash",
                "field": "altro",
                "old_value": "",
                "new_value": "20",
                "by_role": "restaurant",
                "by_user": "Flaminio",
                "by_user_id": "restaurant-1",
                "is_impersonating": False,
                "first_at": (
                    activation + timedelta(minutes=1)
                ).isoformat(),
                "last_at": (
                    activation + timedelta(minutes=1)
                ).isoformat(),
                "changes_count": 1,
            }
            malformed_audit = {
                "id": "audit-bad",
                "date_rome": business_date,
                "category": "cash",
                "field": "altro",
                "last_at": (
                    activation + timedelta(minutes=2)
                ).isoformat(),
            }
            sale = {
                "id": "sale-z",
                "restaurant_id": "restaurant-1",
                "sigla": "B",
                "name": "Peroni",
                "quantity": 1,
                "price_each": 2.5,
                "total": 2.5,
                "created_at": (
                    activation + timedelta(minutes=1)
                ).isoformat(),
                "created_by": "restaurant-1",
            }
            malformed_sale = {
                "id": "sale-bad",
                "restaurant_id": "restaurant-1",
                "sigla": "B",
                "quantity": "not-a-number",
                "price_each": 2.5,
                "total": 2.5,
                "created_at": (
                    activation + timedelta(minutes=2)
                ).isoformat(),
            }
            await source_db.cash_daily_counts.insert_many([
                cash,
                malformed_cash,
                {
                    **cash,
                    "date_rome": previous_date,
                    "updated_at": activation.isoformat(),
                },
            ])
            await source_db.beverage_daily_counts.insert_many([
                beverage,
                malformed_beverage,
                {
                    **beverage,
                    "date_rome": previous_date,
                    "updated_at": activation.isoformat(),
                },
            ])
            await source_db.cash_audit_log.insert_many([
                audit,
                malformed_audit,
                {
                    **audit,
                    "id": "audit-before-epoch",
                    "last_at": (
                        activation - timedelta(minutes=1)
                    ).isoformat(),
                },
            ])
            await source_db.archived_beverage_sales.insert_many([
                sale,
                malformed_sale,
                {
                    **sale,
                    "id": "sale-before-epoch",
                    "created_at": (
                        activation - timedelta(minutes=1)
                    ).isoformat(),
                },
            ])
            await source_db.beverage_sales.insert_one({
                **sale,
                "id": "sale-still-provisional",
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

            first = await collect_report_once(settings)
            assert first["totals"] == {
                "seen": 8,
                "inserted": 4,
                "duplicates": 0,
                "quarantined": 4,
            }, first["streams"]
            assert first["collections"] == {
                "memory_epochs": 1,
                "memory_watermarks": 4,
                "memory_raw_versions": 4,
                "memory_order_facts": 0,
                "memory_report_facts": 4,
                "memory_warehouse_facts": 0,
                "memory_configuration_versions": 0,
                "memory_context_daily": 0,
                "memory_daily_snapshots": 0,
                "memory_gaps": 0,
                "memory_integrity_runs": 0,
                "memory_quarantine": 4,
            }
            assert await target_db.memory_report_facts.count_documents({
                "business_date": previous_date,
            }) == 0
            assert await target_db.memory_raw_versions.count_documents({
                "source_id": {
                    "$in": [
                        "audit-before-epoch",
                        "sale-before-epoch",
                    ]
                },
            }) == 0
            assert await target_db.memory_collector_leases.count_documents(
                {}
            ) == 0
            raw_cash = await target_db.memory_raw_versions.find_one(
                {"source_id": f"cash:restaurant-1:{business_date}"},
                {"_id": 0},
            )
            assert "password" not in raw_cash["raw"]
            assert "password" in raw_cash["removed_paths"]
            cash_fact = await target_db.memory_report_facts.find_one(
                {"fact_kind": "cash_daily_state"},
                {"_id": 0},
            )
            assert cash_fact["cash_before_beverages_cents"] == 108700
            beverage_fact = await target_db.memory_report_facts.find_one(
                {"fact_kind": "beverage_daily_state"},
                {"_id": 0},
            )
            assert beverage_fact["sold_quantity_decimal"] == "40"
            assert beverage_fact["revenue_cents"] == 4000
            assert await target_db.memory_raw_versions.count_documents({
                "source_collection_first": "beverage_sales",
            }) == 0

            lock_store = MemoryMongoStore(
                mongo_url,
                target_name,
                timeout_ms=2500,
            )
            lock_owner = await lock_store.acquire_collector_lease(
                epoch_id=first["epoch"]["id"],
                collector="report",
            )
            try:
                with pytest.raises(RuntimeError, match="gia in esecuzione"):
                    await collect_report_once(settings)
            finally:
                await lock_store.release_collector_lease(
                    epoch_id=first["epoch"]["id"],
                    collector="report",
                    owner_id=lock_owner,
                )
                lock_store.close()

            await source_db.cash_daily_counts.update_one(
                {
                    "restaurant_id": "restaurant-1",
                    "date_rome": business_date,
                },
                {"$set": {
                    "altro": "75",
                    "updated_at": (
                        activation + timedelta(minutes=3)
                    ).isoformat(),
                }},
            )
            await source_db.beverage_daily_counts.update_one(
                {
                    "restaurant_id": "restaurant-1",
                    "date_rome": business_date,
                    "sigla": "AL",
                },
                {"$set": {
                    "sera": "25",
                    "sera_casse": "1",
                    "sera_sfuse": "1",
                    "updated_at": (
                        activation + timedelta(minutes=3)
                    ).isoformat(),
                }},
            )
            await source_db.cash_audit_log.insert_one({
                **{k: v for k, v in audit.items() if k != "_id"},
                "id": "audit-2",
                "old_value": "20",
                "new_value": "75",
                "first_at": (
                    activation + timedelta(minutes=3)
                ).isoformat(),
                "last_at": (
                    activation + timedelta(minutes=3)
                ).isoformat(),
            })
            await source_db.archived_beverage_sales.insert_one({
                **{k: v for k, v in sale.items() if k != "_id"},
                "id": "sale-a-late",
                "created_at": (
                    activation + timedelta(seconds=30)
                ).isoformat(),
            })

            second = await collect_report_once(settings)
            assert second["totals"] == {
                "seen": 10,
                "inserted": 4,
                "duplicates": 2,
                "quarantined": 4,
            }
            assert await target_db.memory_raw_versions.count_documents({}) == 8
            assert await target_db.memory_report_facts.count_documents({}) == 8
            open_cash = await target_db.memory_report_facts.count_documents({
                "fact_kind": "cash_daily_state",
                "valid_to": None,
            })
            closed_cash = await target_db.memory_report_facts.count_documents({
                "fact_kind": "cash_daily_state",
                "valid_to": {"$ne": None},
            })
            assert open_cash == 1
            assert closed_cash == 1

            await source_db.cash_daily_counts.update_one(
                {
                    "restaurant_id": "restaurant-1",
                    "date_rome": business_date,
                },
                {"$set": {
                    "altro": "20",
                    "updated_at": (
                        activation + timedelta(minutes=4)
                    ).isoformat(),
                }},
            )
            third = await collect_report_once(settings)
            assert third["totals"]["inserted"] == 1
            assert await target_db.memory_raw_versions.count_documents({}) == 9
            assert await target_db.memory_report_facts.count_documents({}) == 9
            assert await target_db.memory_report_facts.count_documents({
                "fact_kind": "cash_daily_state",
                "valid_to": None,
            }) == 1
            assert await target_db.memory_report_facts.count_documents({
                "fact_kind": "cash_daily_state",
                "valid_to": {"$ne": None},
            }) == 2

            source_snapshot = {
                name: await source_db[name].count_documents({})
                for name in (
                    "cash_daily_counts",
                    "beverage_daily_counts",
                    "cash_audit_log",
                    "archived_beverage_sales",
                    "beverage_sales",
                )
            }
            fourth = await collect_report_once(settings)
            assert fourth["totals"]["inserted"] == 0
            assert await target_db.memory_raw_versions.count_documents({}) == 9
            assert await target_db.memory_report_facts.count_documents({}) == 9
            assert {
                name: await source_db[name].count_documents({})
                for name in source_snapshot
            } == source_snapshot
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())
