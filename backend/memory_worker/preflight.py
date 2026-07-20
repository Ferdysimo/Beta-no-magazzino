from datetime import datetime, timezone

from .config import MemorySettings
from .contracts import MEMORY_SCHEMA_VERSION, SOURCE_COLLECTIONS
from .stores import MemoryMongoStore, ReadOnlyMongoSource
from .stores.mongo import classify_authenticated_roles


async def run_preflight(settings: MemorySettings) -> dict:
    source = ReadOnlyMongoSource(
        settings.source_mongo_url,
        settings.source_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    target = MemoryMongoStore(
        settings.memory_mongo_url,
        settings.memory_db_name,
        timeout_ms=settings.mongo_timeout_ms,
    )
    warnings = []
    try:
        await source.ping()
        await target.ping()
        existing_collections = set(await source.collection_names())
        present = [
            name for name in SOURCE_COLLECTIONS if name in existing_collections
        ]
        missing = [
            name for name in SOURCE_COLLECTIONS if name not in existing_collections
        ]
        counts = await source.estimated_counts(present)

        source_roles = classify_authenticated_roles(
            await source.connection_status(),
            settings.source_db_name,
        )
        target_roles = classify_authenticated_roles(
            await target.connection_status(),
            settings.memory_db_name,
        )
        if not source_roles["authentication_visible"]:
            warnings.append(
                "Ruoli Mongo sorgente non visibili: il read-only non e verificabile"
            )
        elif source_roles["write_capable"]:
            warnings.append(
                "La credenziale sorgente possiede privilegi di scrittura"
            )
        elif source_roles["unclassified_roles"]:
            warnings.append(
                "La credenziale sorgente possiede ruoli non classificabili "
                "come sola lettura"
            )
        if not target_roles["authentication_visible"]:
            warnings.append(
                "Ruoli Mongo Memoria non visibili: i privilegi non sono verificabili"
            )
        if missing:
            warnings.append(
                f"Collection sorgente non presenti: {', '.join(missing)}"
            )

        return {
            "checked_at_utc": datetime.now(timezone.utc).isoformat(),
            "schema_version": MEMORY_SCHEMA_VERSION,
            "mode": "read_only_preflight",
            "writes_performed": 0,
            "source": {
                "database": settings.source_db_name,
                "collections_present": present,
                "collections_missing": missing,
                "estimated_counts": counts,
                "credentials": source_roles,
            },
            "memory": {
                "database": settings.memory_db_name,
                "credentials": target_roles,
            },
            "warnings": warnings,
            "ready_for_local_foundation": not source_roles["write_capable"],
            "ready_for_production_activation": (
                not warnings
                and not settings.enabled
                and not settings.write_enabled
            ),
        }
    finally:
        source.close()
        target.close()
