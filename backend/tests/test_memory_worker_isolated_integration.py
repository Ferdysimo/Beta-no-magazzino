import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from memory_worker.collector import collect_orders_once
from memory_worker.config import MemorySettings
from memory_worker.stores import MemoryMongoStore


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MEMORY_LIVE_TESTS") != "1",
    reason="Test Mongo Memoria isolato: abilitarlo esplicitamente",
)


def test_orders_collector_is_versioned_idempotent_and_source_safe():
    async def scenario():
        mongo_url = os.environ.get("MEMORY_TEST_MONGO_URL", "mongodb://127.0.0.1:27017")
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_source_test_{suffix}"
        target_name = f"memory_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        activation = datetime.now(timezone.utc) - timedelta(minutes=5)
        created_before_epoch = activation - timedelta(minutes=1)
        created_after_epoch = activation + timedelta(minutes=1)
        source_db = client[source_name]
        target_db = client[target_name]
        try:
            active_order = {
                "id": "order-active",
                "restaurant_id": "restaurant-1",
                "order_number": 1,
                "description": "CARB",
                "created_at": created_before_epoch.isoformat(),
                "status": "pending",
                "password": "must-not-be-copied",
            }
            malformed_order = {
                "id": "order-malformed",
                "order_number": 99,
                "description": "MISSING RESTAURANT",
                "created_at": created_after_epoch.isoformat(),
            }
            archived_order = {
                "id": "order-archived",
                "restaurant_id": "restaurant-1",
                "order_number": 2,
                "description": "AMAT",
                "created_at": created_after_epoch.isoformat(),
                "status": "completed",
            }
            deletion = {
                "id": "deletion-1",
                "restaurant_id": "restaurant-1",
                "order_number": 2,
                "description": "AMAT",
                "original_created_at": created_after_epoch.isoformat(),
                "deleted_at": (
                    activation + timedelta(minutes=2)
                ).isoformat(),
            }
            modification = {
                "id": "modification-1",
                "order_id": "order-active",
                "restaurant_id": "restaurant-1",
                "order_number": 1,
                "old_description": "CARB",
                "new_description": "CARB NO PEPE",
                "modified_at": (
                    activation + timedelta(minutes=3)
                ).isoformat(),
            }
            await source_db.orders.insert_many([
                active_order,
                malformed_order,
            ])
            await source_db.archived_orders.insert_one(archived_order)
            await source_db.deletion_logs.insert_one(deletion)
            await source_db.archived_deletion_logs.insert_one(dict(deletion))
            await source_db.archived_modification_logs.insert_one(modification)

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

            first = await collect_orders_once(settings)
            assert first["totals"] == {
                "seen": 6,
                "inserted": 4,
                "duplicates": 1,
                "quarantined": 1,
            }
            assert first["collections"] == {
                "memory_epochs": 1,
                "memory_watermarks": 6,
                "memory_raw_versions": 4,
                "memory_order_facts": 4,
                "memory_report_facts": 0,
                "memory_warehouse_facts": 0,
                "memory_configuration_versions": 0,
                "memory_context_daily": 0,
                "memory_daily_snapshots": 0,
                "memory_gaps": 0,
                "memory_integrity_runs": 0,
                "memory_quarantine": 1,
            }
            source_snapshot = {
                name: await source_db[name].count_documents({})
                for name in (
                    "orders",
                    "archived_orders",
                    "deletion_logs",
                    "archived_deletion_logs",
                    "modification_logs",
                    "archived_modification_logs",
                )
            }
            raw_active = await target_db.memory_raw_versions.find_one(
                {"source_id": "order-active"},
                {"_id": 0},
            )
            assert "password" not in raw_active["raw"]
            assert "password" in raw_active["removed_paths"]
            assert await target_db.memory_collector_leases.count_documents({}) == 0

            lock_store = MemoryMongoStore(
                mongo_url,
                target_name,
                timeout_ms=2500,
            )
            lock_owner = await lock_store.acquire_collector_lease(
                epoch_id=first["epoch"]["id"],
                collector="orders",
            )
            try:
                with pytest.raises(RuntimeError, match="gia in esecuzione"):
                    await collect_orders_once(settings)
            finally:
                await lock_store.release_collector_lease(
                    epoch_id=first["epoch"]["id"],
                    collector="orders",
                    owner_id=lock_owner,
                )
                lock_store.close()

            await source_db.orders.update_one(
                {"id": "order-active"},
                {"$set": {"status": "completed", "kitchen_completed": True}},
            )
            await source_db.archived_orders.insert_one({
                "id": "order-late-archive",
                "restaurant_id": "restaurant-1",
                "order_number": 3,
                "description": "GRIC",
                "created_at": (
                    activation + timedelta(seconds=30)
                ).isoformat(),
                "status": "completed",
            })
            source_snapshot["archived_orders"] += 1
            second = await collect_orders_once(settings)
            assert second["totals"]["inserted"] == 2
            assert await target_db.memory_raw_versions.count_documents({}) == 6
            assert await target_db.memory_order_facts.count_documents({}) == 6
            open_states = await target_db.memory_order_facts.count_documents({
                "order_id": "order-active",
                "fact_kind": "order_state",
                "valid_to": None,
            })
            closed_states = await target_db.memory_order_facts.count_documents({
                "order_id": "order-active",
                "fact_kind": "order_state",
                "valid_to": {"$ne": None},
            })
            assert open_states == 1
            assert closed_states == 1

            await source_db.orders.update_one(
                {"id": "order-active"},
                {
                    "$set": {"status": "pending"},
                    "$unset": {"kitchen_completed": ""},
                },
            )
            third = await collect_orders_once(settings)
            assert third["totals"]["inserted"] == 1
            assert await target_db.memory_raw_versions.count_documents({}) == 6
            assert await target_db.memory_order_facts.count_documents({}) == 7
            assert await target_db.memory_order_facts.count_documents({
                "order_id": "order-active",
                "fact_kind": "order_state",
                "valid_to": None,
            }) == 1
            assert await target_db.memory_order_facts.count_documents({
                "order_id": "order-active",
                "fact_kind": "order_state",
                "valid_to": {"$ne": None},
            }) == 2

            fourth = await collect_orders_once(settings)
            assert fourth["totals"]["inserted"] == 0
            assert await target_db.memory_raw_versions.count_documents({}) == 6
            assert await target_db.memory_order_facts.count_documents({}) == 7
            assert {
                name: await source_db[name].count_documents({})
                for name in source_snapshot
            } == source_snapshot
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())
