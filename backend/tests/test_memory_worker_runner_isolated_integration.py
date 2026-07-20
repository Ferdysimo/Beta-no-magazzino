import asyncio
import os
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from memory_worker.config import MemorySettings
from memory_worker.runner import check_runtime_resources, run_continuous


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MEMORY_LIVE_TESTS") != "1",
    reason="Test Mongo runner Memoria isolato: abilitarlo esplicitamente",
)


def test_dry_run_is_read_only_and_runtime_guard_reads_bounded_stats():
    async def scenario():
        mongo_url = os.environ.get(
            "MEMORY_TEST_MONGO_URL",
            "mongodb://127.0.0.1:27017",
        )
        suffix = uuid.uuid4().hex[:10]
        source_name = f"memory_runner_source_test_{suffix}"
        target_name = f"memory_runner_target_test_{suffix}"
        client = AsyncIOMotorClient(
            mongo_url,
            serverSelectionTimeoutMS=2500,
        )
        try:
            await client[source_name].orders.insert_one({
                "id": "source-remains-untouched",
            })
            settings = MemorySettings.from_env({
                "MEMORY_ENABLED": "true",
                "MEMORY_DRY_RUN": "true",
                "MEMORY_WRITE_ENABLED": "false",
                "MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES": "true",
                "SOURCE_MONGO_URL": mongo_url,
                "SOURCE_DB_NAME": source_name,
                "MEMORY_MONGO_URL": mongo_url,
                "MEMORY_DB_NAME": target_name,
            })

            result = await run_continuous(settings, max_cycles=1)

            assert result["mode"] == "dry_run"
            assert result["successful_cycles"] == 1
            assert result["last_result"]["writes_performed"] == 0
            assert target_name not in await client.list_database_names()
            assert await client[source_name].orders.count_documents({}) == 1

            await client[target_name].probe.insert_one({"ok": True})
            active_settings = MemorySettings.from_env({
                "MEMORY_ENABLED": "true",
                "MEMORY_WRITE_ENABLED": "true",
                "MEMORY_ACTIVATION_EPOCH_UTC": "2026-07-19T22:00:00Z",
                "MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES": "true",
                "SOURCE_MONGO_URL": mongo_url,
                "SOURCE_DB_NAME": source_name,
                "MEMORY_MONGO_URL": mongo_url,
                "MEMORY_DB_NAME": target_name,
                "MEMORY_MAX_SOURCE_LATENCY_MS": "5000",
            })
            guard = await check_runtime_resources(active_settings)
            assert guard["source_latency_ms"] >= 0
            assert guard["memory_storage_mb"] >= 0
        finally:
            await client.drop_database(source_name)
            await client.drop_database(target_name)
            client.close()

    asyncio.run(scenario())
