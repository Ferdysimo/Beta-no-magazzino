import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..contracts import MEMORY_SCHEMA_VERSION
from ..sanitize import sanitize_memory_document


WRITE_ROLES = {
    "dbAdminAnyDatabase",
    "dbOwner",
    "readWrite",
    "readWriteAnyDatabase",
    "restore",
    "root",
}
READ_ONLY_ROLES = {
    "read",
    "readAnyDatabase",
}


def classify_authenticated_roles(connection_status: dict, database_name: str) -> dict:
    auth_info = connection_status.get("authInfo") or {}
    roles = auth_info.get("authenticatedUserRoles") or []
    relevant = [
        {
            "role": str(item.get("role") or ""),
            "db": str(item.get("db") or ""),
        }
        for item in roles
        if item.get("role")
    ]
    write_roles = [
        item
        for item in relevant
        if item["role"] in WRITE_ROLES
        and item["db"] in {database_name, "admin"}
    ]
    unclassified_roles = [
        item
        for item in relevant
        if item["db"] in {database_name, "admin"}
        and item["role"] not in WRITE_ROLES | READ_ONLY_ROLES
    ]
    return {
        "authentication_visible": bool(relevant),
        "roles": relevant,
        "write_capable": bool(write_roles),
        "write_roles": write_roles,
        "unclassified_roles": unclassified_roles,
    }


class ReadOnlyMongoSource:
    """Narrow source API: intentionally exposes no Mongo write primitive."""

    def __init__(
        self,
        mongo_url: str,
        database_name: str,
        *,
        timeout_ms: int,
    ):
        self._client = AsyncIOMotorClient(
            mongo_url,
            tz_aware=True,
            serverSelectionTimeoutMS=timeout_ms,
            connectTimeoutMS=timeout_ms,
            socketTimeoutMS=timeout_ms,
            appname="pastasciutta-memory-source",
        )
        self._database = self._client[database_name]
        self.database_name = database_name

    async def ping(self) -> None:
        await self._client.admin.command("ping")

    async def collection_names(self) -> list[str]:
        return await self._database.list_collection_names()

    async def estimated_counts(self, collection_names: list[str]) -> dict[str, int]:
        result = {}
        for name in collection_names:
            result[name] = await self._database[name].estimated_document_count()
        return result

    async def connection_status(self) -> dict:
        return await self._database.command("connectionStatus")

    async def find_batch(
        self,
        collection_name: str,
        query: dict,
        projection: Optional[dict],
        *,
        sort: list[tuple[str, int]],
        limit: int,
    ) -> list[dict]:
        cursor = self._database[collection_name].find(query, projection)
        if sort:
            cursor = cursor.sort(sort)
        return await cursor.limit(limit).to_list(limit)

    def close(self) -> None:
        self._client.close()


class MemoryMongoStore:
    """Versioned target store. It never receives the operational source handle."""

    def __init__(
        self,
        mongo_url: str,
        database_name: str,
        *,
        timeout_ms: int,
    ):
        self._client = AsyncIOMotorClient(
            mongo_url,
            tz_aware=True,
            serverSelectionTimeoutMS=timeout_ms,
            connectTimeoutMS=timeout_ms,
            socketTimeoutMS=timeout_ms,
            appname="pastasciutta-memory-target",
        )
        self._database = self._client[database_name]
        self.database_name = database_name

    async def ping(self) -> None:
        await self._client.admin.command("ping")

    async def connection_status(self) -> dict:
        return await self._database.command("connectionStatus")

    async def initialize_schema(self) -> None:
        await self._database.memory_epochs.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_epoch_id",
        )
        await self._database.memory_epochs.create_index(
            [("status", 1)],
            unique=True,
            partialFilterExpression={"status": "active"},
            name="uniq_active_memory_epoch",
        )
        await self._database.memory_collector_leases.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_collector_lease",
        )
        await self._database.memory_collector_leases.create_index(
            [("expires_at", 1)],
            expireAfterSeconds=0,
            name="expire_memory_collector_lease",
        )
        await self._database.memory_watermarks.create_index(
            [("epoch_id", 1), ("source", 1)],
            unique=True,
            name="uniq_memory_watermark",
        )
        await self._database.memory_raw_versions.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_raw_version",
        )
        await self._database.memory_raw_versions.create_index(
            [("epoch_id", 1), ("logical_stream", 1), ("source_id", 1), ("captured_at", -1)]
        )
        await self._database.memory_order_facts.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_order_fact",
        )
        await self._database.memory_order_facts.create_index(
            [("epoch_id", 1), ("entity_key", 1), ("fact_kind", 1), ("valid_from", 1)]
        )
        await self._database.memory_report_facts.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_report_fact",
        )
        await self._database.memory_report_facts.create_index(
            [("epoch_id", 1), ("entity_key", 1), ("fact_kind", 1), ("valid_from", 1)]
        )
        await self._database.memory_report_facts.create_index(
            [("epoch_id", 1), ("restaurant_id", 1), ("business_date", 1)]
        )
        await self._database.memory_warehouse_facts.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_warehouse_fact",
        )
        await self._database.memory_warehouse_facts.create_index(
            [("epoch_id", 1), ("entity_key", 1), ("fact_kind", 1), ("valid_from", 1)]
        )
        await self._database.memory_warehouse_facts.create_index(
            [("epoch_id", 1), ("product_id", 1), ("occurred_at", 1)]
        )
        await self._database.memory_warehouse_facts.create_index(
            [("epoch_id", 1), ("restaurant_id", 1), ("occurred_at", 1)]
        )
        await self._database.memory_configuration_versions.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_configuration_version",
        )
        await self._database.memory_configuration_versions.create_index(
            [("epoch_id", 1), ("entity_key", 1), ("fact_kind", 1), ("valid_from", 1)]
        )
        await self._database.memory_context_daily.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_context_daily",
        )
        await self._database.memory_context_daily.create_index(
            [("epoch_id", 1), ("business_date", 1), ("context_version", 1)],
            unique=True,
            name="uniq_memory_context_date_version",
        )
        await self._database.memory_daily_snapshots.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_daily_snapshot",
        )
        await self._database.memory_daily_snapshots.create_index(
            [("epoch_id", 1), ("scope_type", 1), ("scope_id", 1), ("business_date", 1), ("version", 1)],
            unique=True,
            name="uniq_memory_snapshot_version",
        )
        await self._database.memory_daily_snapshots.create_index(
            [("epoch_id", 1), ("scope_type", 1), ("scope_id", 1), ("business_date", 1)],
            unique=True,
            partialFilterExpression={"is_current": True},
            name="uniq_current_memory_snapshot",
        )
        await self._database.memory_gaps.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_gap",
        )
        await self._database.memory_gaps.create_index(
            [("epoch_id", 1), ("scope_type", 1), ("scope_id", 1), ("business_date", 1), ("code", 1)]
        )
        await self._database.memory_integrity_runs.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_integrity_run",
        )
        await self._database.memory_integrity_runs.create_index(
            [("epoch_id", 1), ("started_at", -1)]
        )
        await self._database.memory_quarantine.create_index(
            [("id", 1)],
            unique=True,
            name="uniq_memory_quarantine",
        )

    async def ensure_epoch(
        self,
        *,
        source_database: str,
        activated_at: datetime,
    ) -> dict:
        activated_utc = activated_at.astimezone(timezone.utc)
        epoch_seed = (
            f"{source_database}|{activated_utc.isoformat()}|"
            f"{MEMORY_SCHEMA_VERSION}"
        )
        epoch_id = hashlib.sha256(epoch_seed.encode("utf-8")).hexdigest()[:32]
        active = await self._database.memory_epochs.find_one(
            {"status": "active"},
            {"_id": 0},
        )
        if active and active.get("id") != epoch_id:
            raise RuntimeError(
                "Esiste gia un memory_epoch attivo con un momento zero diverso"
            )
        now = datetime.now(timezone.utc)
        await self._database.memory_epochs.update_one(
            {"id": epoch_id},
            {
                "$setOnInsert": {
                    "id": epoch_id,
                    "schema_version": MEMORY_SCHEMA_VERSION,
                    "source_database": source_database,
                    "activated_at": activated_utc,
                    "created_at": now,
                    "status": "active",
                }
            },
            upsert=True,
        )
        return await self._database.memory_epochs.find_one(
            {"id": epoch_id},
            {"_id": 0},
        )

    async def acquire_collector_lease(
        self,
        *,
        epoch_id: str,
        collector: str,
        lease_seconds: int = 900,
    ) -> str:
        now = datetime.now(timezone.utc)
        owner_id = str(uuid.uuid4())
        lease_id = hashlib.sha256(
            f"{epoch_id}|{collector}".encode("utf-8")
        ).hexdigest()
        try:
            lease = await self._database.memory_collector_leases.find_one_and_update(
                {
                    "id": lease_id,
                    "$or": [
                        {"expires_at": {"$lte": now}},
                        {"expires_at": {"$exists": False}},
                    ],
                },
                {
                    "$set": {
                        "epoch_id": epoch_id,
                        "collector": collector,
                        "owner_id": owner_id,
                        "acquired_at": now,
                        "expires_at": now + timedelta(seconds=lease_seconds),
                    },
                    "$setOnInsert": {
                        "id": lease_id,
                        "created_at": now,
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0},
            )
        except DuplicateKeyError as exc:
            raise RuntimeError(
                f"Collector {collector} gia in esecuzione"
            ) from exc
        if not lease or lease.get("owner_id") != owner_id:
            raise RuntimeError(f"Collector {collector} gia in esecuzione")
        return owner_id

    async def release_collector_lease(
        self,
        *,
        epoch_id: str,
        collector: str,
        owner_id: str,
    ) -> None:
        lease_id = hashlib.sha256(
            f"{epoch_id}|{collector}".encode("utf-8")
        ).hexdigest()
        await self._database.memory_collector_leases.delete_one({
            "id": lease_id,
            "owner_id": owner_id,
        })

    async def get_watermark(self, epoch_id: str, source: str) -> dict:
        return (
            await self._database.memory_watermarks.find_one(
                {"epoch_id": epoch_id, "source": source},
                {"_id": 0},
            )
            or {}
        )

    async def save_watermark(
        self,
        *,
        epoch_id: str,
        source: str,
        fields: dict,
    ) -> None:
        await self._database.memory_watermarks.update_one(
            {"epoch_id": epoch_id, "source": source},
            {
                "$set": {
                    **fields,
                    "status": "ok",
                    "last_success_at": datetime.now(timezone.utc),
                    "schema_version": MEMORY_SCHEMA_VERSION,
                },
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "epoch_id": epoch_id,
                    "source": source,
                    "created_at": datetime.now(timezone.utc),
                },
            },
            upsert=True,
        )

    async def save_order_version(
        self,
        *,
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        source_id: str,
        source_timestamp: datetime,
        captured_at: datetime,
        normalized_fact: dict,
        raw_document: dict,
    ) -> dict:
        return await self._save_versioned_fact(
            fact_collection_name="memory_order_facts",
            stateful_fact_kinds={"order_state"},
            epoch_id=epoch_id,
            logical_stream=logical_stream,
            source_collection=source_collection,
            source_id=source_id,
            source_timestamp=source_timestamp,
            captured_at=captured_at,
            normalized_fact=normalized_fact,
            raw_document=raw_document,
        )

    async def save_report_version(
        self,
        *,
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        source_id: str,
        source_timestamp: datetime,
        captured_at: datetime,
        normalized_fact: dict,
        raw_document: dict,
    ) -> dict:
        return await self._save_versioned_fact(
            fact_collection_name="memory_report_facts",
            stateful_fact_kinds={
                "cash_daily_state",
                "beverage_daily_state",
            },
            epoch_id=epoch_id,
            logical_stream=logical_stream,
            source_collection=source_collection,
            source_id=source_id,
            source_timestamp=source_timestamp,
            captured_at=captured_at,
            normalized_fact=normalized_fact,
            raw_document=raw_document,
        )

    async def save_warehouse_version(
        self,
        *,
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        source_id: str,
        source_timestamp: datetime,
        captured_at: datetime,
        normalized_fact: dict,
        raw_document: dict,
    ) -> dict:
        return await self._save_versioned_fact(
            fact_collection_name="memory_warehouse_facts",
            stateful_fact_kinds={
                "product_state",
                "request_state",
                "warehouse_load_state",
                "beverage_inventory_state",
                "beverage_load_state",
            },
            epoch_id=epoch_id,
            logical_stream=logical_stream,
            source_collection=source_collection,
            source_id=source_id,
            source_timestamp=source_timestamp,
            captured_at=captured_at,
            normalized_fact=normalized_fact,
            raw_document=raw_document,
        )

    async def save_configuration_version(
        self,
        *,
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        source_id: str,
        source_timestamp: datetime,
        captured_at: datetime,
        normalized_fact: dict,
        raw_document: dict,
        initial_valid_from: Optional[datetime] = None,
    ) -> dict:
        return await self._save_versioned_fact(
            fact_collection_name="memory_configuration_versions",
            stateful_fact_kinds={
                "restaurant_configuration_state",
                "pasta_dictionary_state",
                "beverage_catalog_state",
                "supplier_state",
                "memory_rule_state",
            },
            epoch_id=epoch_id,
            logical_stream=logical_stream,
            source_collection=source_collection,
            source_id=source_id,
            source_timestamp=source_timestamp,
            captured_at=captured_at,
            normalized_fact=normalized_fact,
            raw_document=raw_document,
            initial_valid_from=initial_valid_from,
        )

    async def read_memory_documents(
        self,
        collection_name: str,
        query: dict,
        projection: Optional[dict] = None,
        *,
        sort: Optional[list[tuple[str, int]]] = None,
        limit: int = 10000,
    ) -> list[dict]:
        allowed = {
            "memory_epochs",
            "memory_watermarks",
            "memory_raw_versions",
            "memory_order_facts",
            "memory_report_facts",
            "memory_warehouse_facts",
            "memory_configuration_versions",
            "memory_context_daily",
            "memory_daily_snapshots",
            "memory_gaps",
            "memory_quarantine",
            "memory_integrity_runs",
        }
        if collection_name not in allowed:
            raise ValueError("Collection Memoria non leggibile")
        bounded_limit = max(1, min(int(limit), 10000))
        cursor = self._database[collection_name].find(query, projection)
        if sort:
            cursor = cursor.sort(sort)
        return await cursor.limit(bounded_limit).to_list(bounded_limit)

    async def save_daily_context(
        self,
        *,
        epoch_id: str,
        business_date: str,
        context_version: int,
        context: dict,
        captured_at: datetime,
    ) -> dict:
        context_id = hashlib.sha256(
            (
                f"{epoch_id}|{business_date}|context|"
                f"{context_version}"
            ).encode("utf-8")
        ).hexdigest()
        result = await self._database.memory_context_daily.update_one(
            {"id": context_id},
            {"$setOnInsert": {
                "id": context_id,
                "epoch_id": epoch_id,
                "schema_version": MEMORY_SCHEMA_VERSION,
                "business_date": business_date,
                "context_version": context_version,
                "captured_at": captured_at,
                **context,
            }},
            upsert=True,
        )
        return {
            "id": context_id,
            "inserted": result.upserted_id is not None,
        }

    async def save_daily_snapshot(
        self,
        *,
        epoch_id: str,
        scope_type: str,
        scope_id: str,
        business_date: str,
        snapshot: dict,
        captured_at: datetime,
    ) -> dict:
        sanitized = sanitize_memory_document(snapshot).document
        canonical = json.dumps(
            sanitized,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        current_query = {
            "epoch_id": epoch_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "business_date": business_date,
            "is_current": True,
        }
        current = await self._database.memory_daily_snapshots.find_one(
            current_query,
            {"_id": 0},
        )
        if current and current.get("content_sha256") == content_hash:
            await self._database.memory_daily_snapshots.update_one(
                {"id": current["id"]},
                {"$set": {"last_recomputed_at": captured_at}},
            )
            return {
                "id": current["id"],
                "version": current["version"],
                "inserted": False,
                "content_sha256": content_hash,
            }
        version = int(
            await self._database.memory_daily_snapshots.count_documents({
                "epoch_id": epoch_id,
                "scope_type": scope_type,
                "scope_id": scope_id,
                "business_date": business_date,
            })
        ) + 1
        snapshot_id = hashlib.sha256(
            (
                f"{epoch_id}|{scope_type}|{scope_id}|{business_date}|"
                f"{version}|{content_hash}"
            ).encode("utf-8")
        ).hexdigest()
        await self._database.memory_daily_snapshots.update_one(
            {"id": snapshot_id},
            {"$setOnInsert": {
                "id": snapshot_id,
                "epoch_id": epoch_id,
                "schema_version": MEMORY_SCHEMA_VERSION,
                "scope_type": scope_type,
                "scope_id": scope_id,
                "business_date": business_date,
                "version": version,
                "content_sha256": content_hash,
                "created_at": captured_at,
                "last_recomputed_at": captured_at,
                "is_current": False,
                "snapshot": sanitized,
            }},
            upsert=True,
        )
        if current:
            await self._database.memory_daily_snapshots.update_one(
                {"id": current["id"], "is_current": True},
                {"$set": {
                    "is_current": False,
                    "snapshot_state": "superseded",
                    "superseded_at": captured_at,
                    "superseded_by": snapshot_id,
                }},
            )
        await self._database.memory_daily_snapshots.update_one(
            {"id": snapshot_id},
            {"$set": {
                "is_current": True,
                "snapshot_state": sanitized.get("coverage", {}).get(
                    "status",
                    "partial",
                ),
                "last_recomputed_at": captured_at,
            }},
        )
        return {
            "id": snapshot_id,
            "version": version,
            "inserted": True,
            "content_sha256": content_hash,
        }

    async def sync_snapshot_gaps(
        self,
        *,
        epoch_id: str,
        scope_type: str,
        scope_id: str,
        business_date: str,
        snapshot_id: str,
        gaps: list[dict],
        observed_at: datetime,
    ) -> dict:
        base_query = {
            "epoch_id": epoch_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "business_date": business_date,
            "resolved_at": None,
        }
        active = await self._database.memory_gaps.find(
            base_query,
            {"_id": 0},
        ).to_list(None)
        active_by_code = {item["code"]: item for item in active}
        incoming_codes = {item["code"] for item in gaps}
        opened = 0
        for gap in gaps:
            existing = active_by_code.get(gap["code"])
            if existing:
                await self._database.memory_gaps.update_one(
                    {"id": existing["id"]},
                    {"$set": {
                        "last_seen_at": observed_at,
                        "last_snapshot_id": snapshot_id,
                        "details": gap.get("details") or {},
                    }},
                )
                continue
            gap_id = hashlib.sha256(
                (
                    f"{epoch_id}|{scope_type}|{scope_id}|{business_date}|"
                    f"{gap['code']}|{snapshot_id}"
                ).encode("utf-8")
            ).hexdigest()
            await self._database.memory_gaps.update_one(
                {"id": gap_id},
                {"$setOnInsert": {
                    "id": gap_id,
                    "epoch_id": epoch_id,
                    "schema_version": MEMORY_SCHEMA_VERSION,
                    "scope_type": scope_type,
                    "scope_id": scope_id,
                    "business_date": business_date,
                    "code": gap["code"],
                    "severity": gap.get("severity", "warning"),
                    "details": gap.get("details") or {},
                    "first_seen_at": observed_at,
                    "last_seen_at": observed_at,
                    "first_snapshot_id": snapshot_id,
                    "last_snapshot_id": snapshot_id,
                    "resolved_at": None,
                }},
                upsert=True,
            )
            opened += 1
        resolved = 0
        for code, existing in active_by_code.items():
            if code in incoming_codes:
                continue
            result = await self._database.memory_gaps.update_one(
                {"id": existing["id"], "resolved_at": None},
                {"$set": {
                    "resolved_at": observed_at,
                    "resolved_by_snapshot_id": snapshot_id,
                }},
            )
            resolved += result.modified_count
        return {
            "active": len(gaps),
            "opened": opened,
            "resolved": resolved,
        }

    async def save_integrity_run(
        self,
        *,
        epoch_id: str,
        started_at: datetime,
        finished_at: datetime,
        result: dict,
    ) -> str:
        run_id = str(uuid.uuid4())
        await self._database.memory_integrity_runs.insert_one({
            "id": run_id,
            "epoch_id": epoch_id,
            "schema_version": MEMORY_SCHEMA_VERSION,
            "started_at": started_at,
            "finished_at": finished_at,
            **sanitize_memory_document(result).document,
        })
        return run_id

    async def database_stats(self) -> dict:
        stats = await self._database.command("dbStats", scale=1)
        return {
            "data_size_bytes": int(stats.get("dataSize") or 0),
            "storage_size_bytes": int(stats.get("storageSize") or 0),
            "index_size_bytes": int(stats.get("indexSize") or 0),
            "collections": int(stats.get("collections") or 0),
            "objects": int(stats.get("objects") or 0),
        }

    async def mark_state_observed(
        self,
        *,
        fact_collection_name: str,
        epoch_id: str,
        logical_stream: str,
        source_id: str,
        cycle_id: str,
        observed_at: datetime,
    ) -> int:
        result = await self._database[fact_collection_name].update_many(
            {
                "epoch_id": epoch_id,
                "logical_stream": logical_stream,
                "source_id": source_id,
                "valid_to": None,
                "fact_kind": {"$ne": "source_state_disappeared"},
            },
            {"$set": {
                "last_observed_cycle_id": cycle_id,
                "last_observed_at": observed_at,
            }},
        )
        return result.modified_count

    async def finalize_state_scan(
        self,
        *,
        fact_collection_name: str,
        epoch_id: str,
        logical_stream: str,
        stateful_fact_kinds: set[str],
        cycle_id: str,
        completed_at: datetime,
    ) -> int:
        collection = self._database[fact_collection_name]
        missing = await collection.find(
            {
                "epoch_id": epoch_id,
                "logical_stream": logical_stream,
                "fact_kind": {"$in": sorted(stateful_fact_kinds)},
                "valid_to": None,
                "last_observed_cycle_id": {"$ne": cycle_id},
            },
            {
                "_id": 0,
                "id": 1,
                "entity_key": 1,
                "fact_kind": 1,
                "source_id": 1,
                "restaurant_id": 1,
                "product_id": 1,
                "business_date": 1,
                "request_id": 1,
                "load_id": 1,
                "supplier_id": 1,
                "beverage_code": 1,
            },
        ).to_list(None)
        disappeared = 0
        for previous in missing:
            event_seed = (
                f"{epoch_id}|{logical_stream}|{previous['id']}|"
                "source-state-disappeared"
            )
            event_id = hashlib.sha256(event_seed.encode("utf-8")).hexdigest()
            event = {
                "id": event_id,
                "epoch_id": epoch_id,
                "schema_version": MEMORY_SCHEMA_VERSION,
                "normalizer_version": 1,
                "logical_stream": logical_stream,
                "source_id": previous.get("source_id"),
                "source_timestamp": completed_at,
                "captured_at": completed_at,
                "valid_from": completed_at,
                "valid_to": None,
                "fact_kind": "source_state_disappeared",
                "entity_key": previous["entity_key"],
                "state_fact_kind": previous["fact_kind"],
                "previous_fact_id": previous["id"],
                "occurred_at": completed_at,
                "restaurant_id": previous.get("restaurant_id"),
                "product_id": previous.get("product_id"),
                "business_date": previous.get("business_date"),
                "request_id": previous.get("request_id"),
                "load_id": previous.get("load_id"),
                "supplier_id": previous.get("supplier_id"),
                "beverage_code": previous.get("beverage_code"),
                "quality": {
                    "source_event_available": False,
                    "detected_after_complete_scan": True,
                    "meaning": "source_document_no_longer_present",
                },
            }
            await collection.update_one(
                {"id": event_id},
                {"$setOnInsert": event},
                upsert=True,
            )
            closed = await collection.update_one(
                {"id": previous["id"], "valid_to": None},
                {"$set": {
                    "valid_to": completed_at,
                    "missing_observed_at": completed_at,
                    "missing_observation_cycle_id": cycle_id,
                }},
            )
            disappeared += closed.modified_count
        return disappeared

    async def _save_versioned_fact(
        self,
        *,
        fact_collection_name: str,
        stateful_fact_kinds: set[str],
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        source_id: str,
        source_timestamp: datetime,
        captured_at: datetime,
        normalized_fact: dict,
        raw_document: dict,
        initial_valid_from: Optional[datetime] = None,
    ) -> dict:
        sanitized = sanitize_memory_document(raw_document)
        canonical = json.dumps(
            sanitized.document,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        version_seed = (
            f"{epoch_id}|{logical_stream}|{source_id}|{content_hash}"
        )
        version_id = hashlib.sha256(version_seed.encode("utf-8")).hexdigest()
        raw_result = await self._database.memory_raw_versions.update_one(
            {"id": version_id},
            {
                "$setOnInsert": {
                    "id": version_id,
                    "epoch_id": epoch_id,
                    "schema_version": MEMORY_SCHEMA_VERSION,
                    "sanitizer_version": sanitized.sanitizer_version,
                    "logical_stream": logical_stream,
                    "source_id": source_id,
                    "source_collection_first": source_collection,
                    "source_timestamp": source_timestamp,
                    "captured_at": captured_at,
                    "content_sha256": content_hash,
                    "raw": sanitized.document,
                    "removed_paths": list(sanitized.removed_paths),
                    "truncated_paths": list(sanitized.truncated_paths),
                },
                "$addToSet": {"observed_collections": source_collection},
            },
            upsert=True,
        )
        fact_kind = normalized_fact["fact_kind"]
        entity_key = normalized_fact["entity_key"]
        fact_collection = self._database[fact_collection_name]
        valid_from = captured_at
        if fact_kind in stateful_fact_kinds:
            latest = await fact_collection.find_one(
                {
                    "epoch_id": epoch_id,
                    "entity_key": entity_key,
                    "fact_kind": fact_kind,
                },
                {"_id": 0, "id": 1, "raw_version_id": 1, "valid_to": 1},
                sort=[("valid_from", -1)],
            )
            if (
                latest
                and latest.get("raw_version_id") == version_id
                and latest.get("valid_to") is None
            ):
                return {
                    "version_id": version_id,
                    "fact_id": latest["id"],
                    "raw_inserted": raw_result.upserted_id is not None,
                    "inserted": False,
                    "removed_paths": list(sanitized.removed_paths),
                }
            predecessor_id = latest.get("id") if latest else "initial"
            if latest is None and initial_valid_from is not None:
                valid_from = initial_valid_from.astimezone(timezone.utc)
            fact_seed = f"{version_id}|after|{predecessor_id}"
            fact_id = hashlib.sha256(fact_seed.encode("utf-8")).hexdigest()
            await fact_collection.update_many(
                {
                    "epoch_id": epoch_id,
                    "entity_key": entity_key,
                    "fact_kind": fact_kind,
                    "valid_to": None,
                    "raw_version_id": {"$ne": version_id},
                },
                {"$set": {"valid_to": captured_at}},
            )
        else:
            fact_id = version_id
        fact_result = await fact_collection.update_one(
            {"id": fact_id},
            {
                "$setOnInsert": {
                    "id": fact_id,
                    "epoch_id": epoch_id,
                    "schema_version": MEMORY_SCHEMA_VERSION,
                    "normalizer_version": 1,
                    "raw_version_id": version_id,
                    "raw_content_sha256": content_hash,
                    "logical_stream": logical_stream,
                    "source_id": source_id,
                    "source_timestamp": source_timestamp,
                    "captured_at": captured_at,
                    "valid_from": valid_from,
                    "valid_to": None,
                    **normalized_fact,
                }
            },
            upsert=True,
        )
        return {
            "version_id": version_id,
            "fact_id": fact_id,
            "raw_inserted": raw_result.upserted_id is not None,
            "inserted": fact_result.upserted_id is not None,
            "removed_paths": list(sanitized.removed_paths),
        }

    async def save_quarantine(
        self,
        *,
        epoch_id: str,
        logical_stream: str,
        source_collection: str,
        raw_document: dict,
        error: Exception,
    ) -> str:
        sanitized = sanitize_memory_document(raw_document)
        sanitized_canonical = json.dumps(
            sanitized.document,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        fallback_hash = hashlib.sha256(
            sanitized_canonical.encode("utf-8")
        ).hexdigest()[:24]
        source_id = str(
            raw_document.get("id") or f"missing-id:{fallback_hash}"
        )
        seed = f"{epoch_id}|{logical_stream}|{source_collection}|{source_id}"
        quarantine_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        await self._database.memory_quarantine.update_one(
            {"id": quarantine_id},
            {
                "$set": {
                    "last_seen_at": now,
                    "error_type": type(error).__name__,
                    "error_message": str(error)[:500],
                    "raw": sanitized.document,
                    "removed_paths": list(sanitized.removed_paths),
                },
                "$setOnInsert": {
                    "id": quarantine_id,
                    "epoch_id": epoch_id,
                    "schema_version": MEMORY_SCHEMA_VERSION,
                    "logical_stream": logical_stream,
                    "source_collection": source_collection,
                    "source_id": source_id,
                    "first_seen_at": now,
                },
                "$inc": {"seen_count": 1},
            },
            upsert=True,
        )
        return quarantine_id

    async def collection_counts(self) -> dict[str, int]:
        names = (
            "memory_epochs",
            "memory_watermarks",
            "memory_raw_versions",
            "memory_order_facts",
            "memory_report_facts",
            "memory_warehouse_facts",
            "memory_configuration_versions",
            "memory_context_daily",
            "memory_daily_snapshots",
            "memory_gaps",
            "memory_quarantine",
            "memory_integrity_runs",
        )
        return {
            name: await self._database[name].count_documents({})
            for name in names
        }

    def close(self) -> None:
        self._client.close()
