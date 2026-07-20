import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from memory_worker.collector import (
    collect_configuration_once,
    collect_warehouse_once,
)
from memory_worker.config import MemorySettings


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MEMORY_LIVE_TESTS") != "1",
    reason="Test Mongo Fasi 3-4 Memoria isolato: abilitarlo esplicitamente",
)


def test_phase34_collectors_version_disappearances_and_never_write_source():
    async def scenario():
        mongo_url = os.environ.get(
            "MEMORY_TEST_MONGO_URL",
            "mongodb://127.0.0.1:27017",
        )
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_phase34_source_test_{suffix}"
        target_name = f"memory_phase34_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        activation = datetime.now(timezone.utc) - timedelta(minutes=5)
        before_epoch = activation - timedelta(days=1)
        after_epoch = activation + timedelta(minutes=1)
        source_db = client[source_name]
        target_db = client[target_name]
        try:
            await source_db.products.insert_one({
                "id": "product-1",
                "name": "Pomodori",
                "unit": "kg",
                "supplier": "Derrate",
                "quantity": 30,
                "created_at": before_epoch.isoformat(),
                "image_file": "product.jpg",
            })
            await source_db.stock_movements.insert_many([
                {
                    "id": "movement-before-epoch",
                    "product_id": "product-1",
                    "product_name": "Pomodori",
                    "delta": 20,
                    "balance_after": 20,
                    "cause": "stock_iniziale",
                    "timestamp": before_epoch.isoformat(),
                },
                {
                    "id": "movement-load",
                    "product_id": "product-1",
                    "product_name": "Pomodori",
                    "delta": 10,
                    "balance_after": 30,
                    "cause": "carico",
                    "ref_type": "carico",
                    "ref_id": "load-1",
                    "timestamp": after_epoch.isoformat(),
                },
            ])
            await source_db.richieste.insert_many([
                {
                    "id": "request-1",
                    "ddt_number": 7,
                    "restaurant_id": "restaurant-1",
                    "restaurant_location": "Flaminio",
                    "items": [{
                        "product_id": "product-1",
                        "product_name": "Pomodori",
                        "unit": "kg",
                        "supplier": "Derrate",
                        "quantity": 6,
                    }],
                    "status": "pending",
                    "created_at": after_epoch.isoformat(),
                },
                {
                    "id": "request-malformed",
                    "items": [],
                    "status": "pending",
                    "created_at": (
                        after_epoch + timedelta(seconds=1)
                    ).isoformat(),
                },
                {
                    "id": "request-before-epoch",
                    "restaurant_id": "restaurant-1",
                    "items": [],
                    "status": "confermata",
                    "created_at": before_epoch.isoformat(),
                },
            ])
            await source_db.carichi_magazzino.insert_many([
                {
                    "id": "load-1",
                    "supplier_name": "Derrate",
                    "ddt_number_fornitore": "DDT-1",
                    "photo_file": "ddt.jpg",
                    "fattura_file": "invoice.jpg",
                    "items": [{
                        "product_id": "product-1",
                        "product_name": "Pomodori",
                        "unit": "kg",
                        "quantity_added": 10,
                    }],
                    "created_at": after_epoch.isoformat(),
                    "updated_at": after_epoch.isoformat(),
                    "created_by_id": "warehouse-1",
                },
                {
                    "id": "load-before-epoch",
                    "supplier_name": "Derrate",
                    "items": [],
                    "created_at": before_epoch.isoformat(),
                    "updated_at": before_epoch.isoformat(),
                },
            ])
            await source_db.beverage_inventory.insert_one({
                "restaurant_id": "restaurant-1",
                "sigla": "B",
                "quantity": 48,
                "updated_at": after_epoch.isoformat(),
            })
            await source_db.beverage_carichi.insert_many([
                {
                    "id": "beverage-load-1",
                    "restaurant_id": "restaurant-1",
                    "supplier": "Gioia",
                    "invoice_file": "beverage-invoice.jpg",
                    "invoice_url": "/api/uploads/beverage-invoice.jpg",
                    "items": [{
                        "sigla": "B",
                        "cases": 2,
                        "units": 48,
                        "quantity": 2,
                    }],
                    "units_per_case": 24,
                    "created_at": after_epoch.isoformat(),
                    "created_by": "restaurant-1",
                },
                {
                    "id": "beverage-load-before-epoch",
                    "restaurant_id": "restaurant-1",
                    "items": [],
                    "created_at": before_epoch.isoformat(),
                },
            ])

            await source_db.restaurants.insert_many([
                {
                    "id": "restaurant-1",
                    "name": "Pastasciutta Roma",
                    "username": "Flaminio",
                    "password": "must-never-leave-source",
                    "token_version": 9,
                    "order_counter": 44,
                    "location": "Flaminio",
                    "role": "restaurant",
                    "boiler_count": 2,
                    "report_code": "F",
                    "address": "Piazzale Flaminio 10",
                    "postal_code": "00196",
                    "city": "Roma",
                    "created_at": before_epoch.isoformat(),
                },
                {
                    "id": "restaurant-malformed",
                    "username": "Broken",
                    "boiler_count": "not-an-integer",
                    "created_at": before_epoch.isoformat(),
                },
            ])
            await source_db.pasta_dictionary.insert_one({
                "restaurant_id": "restaurant-1",
                "siglas": [{"sigla": "CARB", "price": 8}],
                "updated_at": after_epoch.isoformat(),
                "updated_by": "Admin",
            })
            await source_db.beverages.insert_one({
                "sigla": "B",
                "name": "Peroni",
                "price": 2.5,
                "sort_order": 7,
            })
            await source_db.suppliers.insert_one({
                "id": "supplier-1",
                "name": "Derrate",
                "created_at": before_epoch.isoformat(),
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

            first_warehouse = await collect_warehouse_once(settings)
            assert first_warehouse["totals"] == {
                "seen": 7,
                "inserted": 6,
                "duplicates": 0,
                "quarantined": 1,
                "disappeared": 0,
            }, first_warehouse["streams"]
            assert await target_db.memory_warehouse_facts.count_documents({
                "source_id": {
                    "$in": [
                        "movement-before-epoch",
                        "request-before-epoch",
                        "load-before-epoch",
                        "beverage-load-before-epoch",
                    ]
                },
            }) == 0
            raw_load = await target_db.memory_raw_versions.find_one(
                {"source_id": "load-1"},
                {"_id": 0},
            )
            assert "photo_file" not in raw_load["raw"]
            assert "fattura_file" not in raw_load["raw"]

            first_configuration = await collect_configuration_once(settings)
            assert first_configuration["totals"] == {
                "seen": 6,
                "inserted": 5,
                "duplicates": 0,
                "quarantined": 1,
                "disappeared": 0,
            }, first_configuration["streams"]
            raw_restaurant = await target_db.memory_raw_versions.find_one(
                {"source_id": "restaurant-1"},
                {"_id": 0},
            )
            assert "password" not in raw_restaurant["raw"]
            assert "token_version" not in raw_restaurant["raw"]
            assert "order_counter" not in raw_restaurant["raw"]

            await source_db.products.update_one(
                {"id": "product-1"},
                {"$set": {"quantity": 20}},
            )
            await source_db.stock_movements.insert_one({
                "id": "movement-load-deleted",
                "product_id": "product-1",
                "product_name": "Pomodori",
                "delta": -10,
                "balance_after": 20,
                "cause": "carico_cancellato",
                "ref_type": "carico",
                "ref_id": "load-1",
                "timestamp": (
                    after_epoch + timedelta(minutes=1)
                ).isoformat(),
            })
            await source_db.richieste.delete_one({"id": "request-1"})
            await source_db.carichi_magazzino.delete_one({"id": "load-1"})
            await source_db.beverage_inventory.update_one(
                {
                    "restaurant_id": "restaurant-1",
                    "sigla": "B",
                },
                {"$set": {
                    "quantity": 47,
                    "updated_at": (
                        after_epoch + timedelta(minutes=1)
                    ).isoformat(),
                }},
            )

            second_warehouse = await collect_warehouse_once(settings)
            assert second_warehouse["totals"]["inserted"] == 3
            assert second_warehouse["totals"]["disappeared"] == 2
            assert await target_db.memory_warehouse_facts.count_documents({
                "fact_kind": "source_state_disappeared",
            }) == 2
            assert await target_db.memory_warehouse_facts.count_documents({
                "request_id": "request-1",
                "fact_kind": "request_state",
                "valid_to": None,
            }) == 0
            cancellation = await target_db.memory_warehouse_facts.find_one(
                {"movement_id": "movement-load-deleted"},
                {"_id": 0},
            )
            assert cancellation["movement_meaning"] == "annullamento_carico"
            assert cancellation["quantity_before"] == 30
            assert cancellation["quantity_after"] == 20

            await source_db.restaurants.update_one(
                {"id": "restaurant-1"},
                {"$set": {
                    "order_counter": 99,
                    "boiler_count": 1,
                }},
            )
            await source_db.pasta_dictionary.delete_one({
                "restaurant_id": "restaurant-1",
            })
            await source_db.suppliers.delete_one({"id": "supplier-1"})

            second_configuration = await collect_configuration_once(settings)
            assert second_configuration["totals"]["inserted"] == 1
            assert second_configuration["totals"]["disappeared"] == 2
            assert await target_db.memory_configuration_versions.count_documents({
                "fact_kind": "source_state_disappeared",
            }) == 2
            restaurant_versions = await target_db.memory_configuration_versions.find(
                {
                    "restaurant_id": "restaurant-1",
                    "fact_kind": "restaurant_configuration_state",
                },
                {"_id": 0, "boiler_count": 1},
            ).to_list(None)
            assert sorted(v["boiler_count"] for v in restaurant_versions) == [1, 2]

            source_snapshot = {
                name: await source_db[name].count_documents({})
                for name in (
                    "products",
                    "stock_movements",
                    "richieste",
                    "carichi_magazzino",
                    "beverage_inventory",
                    "beverage_carichi",
                    "restaurants",
                    "pasta_dictionary",
                    "beverages",
                    "suppliers",
                )
            }
            third_warehouse = await collect_warehouse_once(settings)
            third_configuration = await collect_configuration_once(settings)
            assert third_warehouse["totals"]["inserted"] == 0
            assert third_warehouse["totals"]["disappeared"] == 0
            assert third_configuration["totals"]["inserted"] == 0
            assert third_configuration["totals"]["disappeared"] == 0
            assert await target_db.memory_warehouse_facts.count_documents({
                "fact_kind": "source_state_disappeared",
            }) == 2
            assert await target_db.memory_configuration_versions.count_documents({
                "fact_kind": "source_state_disappeared",
            }) == 2
            assert {
                name: await source_db[name].count_documents({})
                for name in source_snapshot
            } == source_snapshot
            assert await target_db.memory_collector_leases.count_documents(
                {}
            ) == 0
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())


def test_disappearance_is_never_declared_during_an_incomplete_scan():
    async def scenario():
        mongo_url = os.environ.get(
            "MEMORY_TEST_MONGO_URL",
            "mongodb://127.0.0.1:27017",
        )
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_scan_source_test_{suffix}"
        target_name = f"memory_scan_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        activation = datetime.now(timezone.utc) - timedelta(minutes=5)
        source_db = client[source_name]
        target_db = client[target_name]
        try:
            for product_id in ("product-a", "product-b"):
                await source_db.products.insert_one({
                    "id": product_id,
                    "name": product_id,
                    "unit": "pz",
                    "quantity": 1,
                    "created_at": activation.isoformat(),
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
                "MEMORY_BATCH_SIZE": "1",
            })

            await collect_warehouse_once(settings)
            await collect_warehouse_once(settings)
            await collect_warehouse_once(settings)
            assert await target_db.memory_warehouse_facts.count_documents({
                "fact_kind": "product_state",
                "valid_to": None,
            }) == 2

            await source_db.products.delete_one({"id": "product-a"})
            partial = await collect_warehouse_once(settings)
            product_stream = next(
                item for item in partial["streams"]
                if item["source"] == "warehouse_products"
            )
            assert product_stream["cycle_complete"] is False
            assert product_stream["disappeared"] == 0
            assert await target_db.memory_warehouse_facts.count_documents({
                "product_id": "product-a",
                "fact_kind": "product_state",
                "valid_to": None,
            }) == 1

            completed = await collect_warehouse_once(settings)
            product_stream = next(
                item for item in completed["streams"]
                if item["source"] == "warehouse_products"
            )
            assert product_stream["cycle_complete"] is True
            assert product_stream["disappeared"] == 1
            assert await target_db.memory_warehouse_facts.count_documents({
                "product_id": "product-a",
                "fact_kind": "product_state",
                "valid_to": None,
            }) == 0
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())
