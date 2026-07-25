from datetime import datetime, timezone

from .config import MemoryConfigurationError, MemorySettings
from .sources import (
    CONFIGURATION_STREAMS,
    ORDER_STREAMS,
    REPORT_STREAMS,
    WAREHOUSE_STREAMS,
    collect_configuration_stream,
    collect_order_stream,
    collect_report_stream,
    collect_warehouse_stream,
    pasta_annotation_aliases_from_documents,
)
from .sources.configuration import (
    default_annotation_semantics_rule,
    default_pasta_rule,
)
from .stores import MemoryMongoStore, ReadOnlyMongoSource
from .stores.mongo import classify_authenticated_roles


def _activation_datetime(settings: MemorySettings) -> datetime:
    return datetime.fromisoformat(
        settings.activation_epoch_utc.replace("Z", "+00:00")
    ).astimezone(timezone.utc)


async def _verify_collection_permissions(
    source: ReadOnlyMongoSource,
    store: MemoryMongoStore,
    settings: MemorySettings,
) -> dict:
    source_roles = classify_authenticated_roles(
        await source.connection_status(),
        settings.source_db_name,
    )
    target_roles = classify_authenticated_roles(
        await store.connection_status(),
        settings.memory_db_name,
    )
    if source_roles["write_capable"]:
        raise MemoryConfigurationError(
            "La credenziale Mongo sorgente possiede privilegi di scrittura"
        )
    if source_roles["unclassified_roles"]:
        raise MemoryConfigurationError(
            "La credenziale Mongo sorgente possiede ruoli non classificabili "
            "come sola lettura"
        )
    if (
        not source_roles["authentication_visible"]
        or not target_roles["authentication_visible"]
    ) and not settings.allow_unverified_mongo_roles:
        raise MemoryConfigurationError(
            "Ruoli Mongo non verificabili: configurare SCRAM oppure usare "
            "MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=true soltanto nei test locali"
        )
    if target_roles["authentication_visible"] and not target_roles["write_capable"]:
        raise MemoryConfigurationError(
            "La credenziale Mongo Memoria non possiede privilegi di scrittura"
        )
    return {"source": source_roles, "memory": target_roles}


async def collect_orders_once(settings: MemorySettings) -> dict:
    settings.require_collection_activation()
    source = ReadOnlyMongoSource(
        settings.source_mongo_url,
        settings.source_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    store = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    started_at = datetime.now(timezone.utc)
    try:
        await source.ping()
        await store.ping()
        permissions = await _verify_collection_permissions(
            source,
            store,
            settings,
        )
        await store.initialize_schema()
        epoch = await store.ensure_epoch(
            source_database=settings.source_db_name,
            activated_at=_activation_datetime(settings),
        )
        alias_documents = await source.find_batch(
            "lab_pasta_annotation_aliases",
            {"active": {"$ne": False}},
            {
                "_id": 0,
                "alias_normalized": 1,
                "canonical_normalized": 1,
                "active": 1,
            },
            sort=[("alias_normalized", 1)],
            limit=500,
        )
        target_aliases = pasta_annotation_aliases_from_documents(
            alias_documents
        )
        lease_owner = await store.acquire_collector_lease(
            epoch_id=epoch["id"],
            collector="orders",
        )
        try:
            streams = []
            for stream in ORDER_STREAMS:
                streams.append(
                    await collect_order_stream(
                        source,
                        store,
                        epoch=epoch,
                        stream=stream,
                        batch_size=settings.batch_size,
                        captured_at=started_at,
                        target_aliases=target_aliases,
                    )
                )
        finally:
            await store.release_collector_lease(
                epoch_id=epoch["id"],
                collector="orders",
                owner_id=lease_owner,
            )
        return {
            "mode": "collect_orders_once",
            "started_at_utc": started_at.isoformat(),
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "epoch": {
                "id": epoch["id"],
                "activated_at_utc": epoch["activated_at"].isoformat(),
            },
            "permissions": permissions,
            "annotation_aliases_loaded": len(target_aliases),
            "streams": streams,
            "totals": {
                "seen": sum(item["seen"] for item in streams),
                "inserted": sum(item["inserted"] for item in streams),
                "duplicates": sum(item["duplicates"] for item in streams),
                "quarantined": sum(item["quarantined"] for item in streams),
            },
            "collections": await store.collection_counts(),
        }
    finally:
        source.close()
        store.close()


async def collect_report_once(settings: MemorySettings) -> dict:
    settings.require_collection_activation()
    source = ReadOnlyMongoSource(
        settings.source_mongo_url,
        settings.source_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    store = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    started_at = datetime.now(timezone.utc)
    try:
        await source.ping()
        await store.ping()
        permissions = await _verify_collection_permissions(
            source,
            store,
            settings,
        )
        await store.initialize_schema()
        epoch = await store.ensure_epoch(
            source_database=settings.source_db_name,
            activated_at=_activation_datetime(settings),
        )
        lease_owner = await store.acquire_collector_lease(
            epoch_id=epoch["id"],
            collector="report",
        )
        try:
            streams = []
            for stream in REPORT_STREAMS:
                streams.append(
                    await collect_report_stream(
                        source,
                        store,
                        epoch=epoch,
                        stream=stream,
                        batch_size=settings.batch_size,
                        captured_at=started_at,
                    )
                )
        finally:
            await store.release_collector_lease(
                epoch_id=epoch["id"],
                collector="report",
                owner_id=lease_owner,
            )
        return {
            "mode": "collect_report_once",
            "started_at_utc": started_at.isoformat(),
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "epoch": {
                "id": epoch["id"],
                "activated_at_utc": epoch["activated_at"].isoformat(),
            },
            "permissions": permissions,
            "streams": streams,
            "totals": {
                "seen": sum(item["seen"] for item in streams),
                "inserted": sum(item["inserted"] for item in streams),
                "duplicates": sum(item["duplicates"] for item in streams),
                "quarantined": sum(item["quarantined"] for item in streams),
            },
            "collections": await store.collection_counts(),
        }
    finally:
        source.close()
        store.close()


async def collect_warehouse_once(settings: MemorySettings) -> dict:
    settings.require_collection_activation()
    source = ReadOnlyMongoSource(
        settings.source_mongo_url,
        settings.source_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    store = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    started_at = datetime.now(timezone.utc)
    try:
        await source.ping()
        await store.ping()
        permissions = await _verify_collection_permissions(
            source,
            store,
            settings,
        )
        await store.initialize_schema()
        epoch = await store.ensure_epoch(
            source_database=settings.source_db_name,
            activated_at=_activation_datetime(settings),
        )
        lease_owner = await store.acquire_collector_lease(
            epoch_id=epoch["id"],
            collector="warehouse",
        )
        try:
            streams = []
            for stream in WAREHOUSE_STREAMS:
                streams.append(
                    await collect_warehouse_stream(
                        source,
                        store,
                        epoch=epoch,
                        stream=stream,
                        batch_size=settings.batch_size,
                        captured_at=started_at,
                    )
                )
        finally:
            await store.release_collector_lease(
                epoch_id=epoch["id"],
                collector="warehouse",
                owner_id=lease_owner,
            )
        return {
            "mode": "collect_warehouse_once",
            "started_at_utc": started_at.isoformat(),
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "epoch": {
                "id": epoch["id"],
                "activated_at_utc": epoch["activated_at"].isoformat(),
            },
            "permissions": permissions,
            "streams": streams,
            "totals": {
                "seen": sum(item["seen"] for item in streams),
                "inserted": sum(item["inserted"] for item in streams),
                "duplicates": sum(item["duplicates"] for item in streams),
                "quarantined": sum(item["quarantined"] for item in streams),
                "disappeared": sum(item["disappeared"] for item in streams),
            },
            "collections": await store.collection_counts(),
        }
    finally:
        source.close()
        store.close()


async def collect_configuration_once(settings: MemorySettings) -> dict:
    settings.require_collection_activation()
    source = ReadOnlyMongoSource(
        settings.source_mongo_url,
        settings.source_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    store = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    started_at = datetime.now(timezone.utc)
    try:
        await source.ping()
        await store.ping()
        permissions = await _verify_collection_permissions(
            source,
            store,
            settings,
        )
        await store.initialize_schema()
        epoch = await store.ensure_epoch(
            source_database=settings.source_db_name,
            activated_at=_activation_datetime(settings),
        )
        lease_owner = await store.acquire_collector_lease(
            epoch_id=epoch["id"],
            collector="configuration",
        )
        try:
            streams = []
            for stream in CONFIGURATION_STREAMS:
                streams.append(
                    await collect_configuration_stream(
                        source,
                        store,
                        epoch=epoch,
                        stream=stream,
                        batch_size=settings.batch_size,
                        captured_at=started_at,
                    )
                )
            rule_results = {}
            for rule_name, rule_factory in (
                ("default_pasta_prices", default_pasta_rule),
                ("annotation_semantics", default_annotation_semantics_rule),
            ):
                source_id, source_timestamp, fact, raw = rule_factory(
                    captured_at=started_at,
                    activation_epoch=epoch["activated_at"],
                )
                rule_results[rule_name] = await store.save_configuration_version(
                    epoch_id=epoch["id"],
                    logical_stream="configuration_memory_rules",
                    source_collection="memory_worker_rules",
                    source_id=source_id,
                    source_timestamp=source_timestamp,
                    captured_at=started_at,
                    normalized_fact=fact,
                    raw_document=raw,
                    initial_valid_from=epoch["activated_at"],
                )
        finally:
            await store.release_collector_lease(
                epoch_id=epoch["id"],
                collector="configuration",
                owner_id=lease_owner,
            )
        return {
            "mode": "collect_configuration_once",
            "started_at_utc": started_at.isoformat(),
            "finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "epoch": {
                "id": epoch["id"],
                "activated_at_utc": epoch["activated_at"].isoformat(),
            },
            "permissions": permissions,
            "streams": streams,
            "rules": {
                f"{name}_inserted": result["inserted"]
                for name, result in rule_results.items()
            },
            "totals": {
                "seen": sum(item["seen"] for item in streams) + len(rule_results),
                "inserted": (
                    sum(item["inserted"] for item in streams)
                    + sum(int(result["inserted"]) for result in rule_results.values())
                ),
                "duplicates": (
                    sum(item["duplicates"] for item in streams)
                    + sum(
                        int(not result["inserted"]) for result in rule_results.values()
                    )
                ),
                "quarantined": sum(item["quarantined"] for item in streams),
                "disappeared": sum(item["disappeared"] for item in streams),
            },
            "collections": await store.collection_counts(),
        }
    finally:
        source.close()
        store.close()
