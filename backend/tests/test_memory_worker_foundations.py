from datetime import datetime, timezone
from pathlib import Path

import pytest

from memory_worker.config import (
    MemoryConfigurationError,
    MemorySettings,
    redact_mongo_url,
)
from memory_worker.contracts import (
    MEMORY_DATABASE_COLLECTIONS,
    MEMORY_SCHEMA_VERSION,
    SOURCE_COLLECTIONS,
)
from memory_worker.sanitize import sanitize_memory_document
from memory_worker.sources.orders import (
    ORDER_STREAMS,
    normalize_order_record,
)
from memory_worker.stores import MemoryMongoStore, ReadOnlyMongoSource
from memory_worker.stores.mongo import classify_authenticated_roles


BACKEND_DIR = Path(__file__).resolve().parents[1]


def _connection_env(**overrides):
    values = {
        "SOURCE_MONGO_URL": "mongodb://source-user:source-password@localhost:27017",
        "SOURCE_DB_NAME": "pastasciutta",
        "MEMORY_MONGO_URL": "mongodb://memory-user:memory-password@localhost:27017",
        "MEMORY_DB_NAME": "pastasciutta_memory",
        **overrides,
    }
    return values


def test_memory_is_disabled_and_unconfigured_by_default():
    settings = MemorySettings.from_env({})

    assert settings.enabled is False
    assert settings.write_enabled is False
    assert settings.source_mongo_url == ""
    assert settings.memory_mongo_url == ""
    assert settings.poll_seconds == 60
    assert settings.batch_size == 50


def test_source_and_memory_database_must_be_different():
    with pytest.raises(MemoryConfigurationError, match="devono essere diversi"):
        MemorySettings.from_env(
            _connection_env(MEMORY_DB_NAME="PASTASCIUTTA"),
            require_connections=True,
        )


def test_writes_require_both_explicit_enablement_and_activation_epoch():
    with pytest.raises(MemoryConfigurationError, match="MEMORY_ENABLED=true"):
        MemorySettings.from_env(_connection_env(MEMORY_WRITE_ENABLED="true"))

    with pytest.raises(MemoryConfigurationError, match="EPOCH"):
        MemorySettings.from_env(_connection_env(
            MEMORY_ENABLED="true",
            MEMORY_WRITE_ENABLED="true",
        ))

    settings = MemorySettings.from_env(_connection_env(
        MEMORY_ENABLED="true",
        MEMORY_WRITE_ENABLED="true",
        MEMORY_ACTIVATION_EPOCH_UTC="2026-07-21T04:00:00Z",
    ))
    assert settings.enabled is True
    assert settings.write_enabled is True
    assert settings.activation_epoch_utc == "2026-07-21T04:00:00+00:00"


def test_collection_command_stays_locked_without_both_switches():
    with pytest.raises(MemoryConfigurationError, match="MEMORY_ENABLED"):
        MemorySettings.from_env(
            _connection_env(),
            require_connections=True,
        ).require_collection_activation()


def test_limits_reject_unbounded_or_aggressive_configuration():
    with pytest.raises(MemoryConfigurationError, match="MEMORY_BATCH_SIZE"):
        MemorySettings.from_env(_connection_env(MEMORY_BATCH_SIZE="10000"))
    with pytest.raises(MemoryConfigurationError, match="MEMORY_POLL_SECONDS"):
        MemorySettings.from_env(_connection_env(MEMORY_POLL_SECONDS="1"))


def test_safe_summary_never_exposes_mongo_credentials():
    settings = MemorySettings.from_env(
        _connection_env(),
        require_connections=True,
    )
    summary = settings.safe_summary()
    rendered = repr(summary)

    assert "source-password" not in rendered
    assert "memory-password" not in rendered
    assert summary["source"]["url"] == "mongodb://localhost:27017"
    assert summary["memory"]["url"] == "mongodb://localhost:27017"
    assert redact_mongo_url("") == "(non configurato)"


def test_sanitizer_removes_secrets_images_and_binary_without_mutating_source():
    original = {
        "id": "order-1",
        "description": "2 CARB NO PEPE",
        "token_version": 3,
        "password": "never-copy",
        "nested": {
            "access_token": "never-copy",
            "photo_file": "ddt.jpg",
            "created_at": datetime(2026, 7, 20, tzinfo=timezone.utc),
            "binary": b"image",
        },
        "items": [{"name": "Pomodori", "quantity": 2}],
    }

    result = sanitize_memory_document(original)

    assert original["password"] == "never-copy"
    assert "password" not in result.document
    assert "access_token" not in result.document["nested"]
    assert "photo_file" not in result.document["nested"]
    assert result.document["nested"]["binary"] is None
    assert result.document["token_version"] == 3
    assert result.document["nested"]["created_at"] == "2026-07-20T00:00:00+00:00"
    assert set(result.removed_paths) == {
        "password",
        "nested.access_token",
        "nested.photo_file",
        "nested.binary",
    }


def test_source_api_exposes_no_write_primitive_and_target_has_no_generic_writes():
    forbidden = {
        "insert_one",
        "insert_many",
        "update_one",
        "update_many",
        "replace_one",
        "delete_one",
        "delete_many",
        "bulk_write",
    }

    assert forbidden.isdisjoint(dir(ReadOnlyMongoSource))
    assert forbidden.isdisjoint(dir(MemoryMongoStore))
    assert {"find_batch", "estimated_counts"} <= set(dir(ReadOnlyMongoSource))
    assert {
        "ensure_epoch",
        "save_watermark",
        "save_order_version",
        "save_report_version",
        "save_warehouse_version",
        "save_configuration_version",
        "save_daily_context",
        "save_daily_snapshot",
        "sync_snapshot_gaps",
        "save_integrity_run",
    } <= set(
        dir(MemoryMongoStore)
    )


def test_role_classification_detects_write_capable_source_credentials():
    status = {
        "authInfo": {
            "authenticatedUserRoles": [
                {"role": "readWrite", "db": "pastasciutta"},
                {"role": "read", "db": "other"},
            ]
        }
    }

    result = classify_authenticated_roles(status, "pastasciutta")

    assert result["authentication_visible"] is True
    assert result["write_capable"] is True
    assert result["write_roles"] == [{
        "role": "readWrite",
        "db": "pastasciutta",
    }]


def test_role_classification_flags_unknown_source_database_roles():
    status = {
        "authInfo": {
            "authenticatedUserRoles": [
                {"role": "customCollector", "db": "pastasciutta"},
            ]
        }
    }

    result = classify_authenticated_roles(status, "pastasciutta")

    assert result["write_capable"] is False
    assert result["unclassified_roles"] == [{
        "role": "customCollector",
        "db": "pastasciutta",
    }]


def test_memory_contract_starts_versioned_with_expected_domains():
    assert MEMORY_SCHEMA_VERSION == 1
    assert "orders" in SOURCE_COLLECTIONS
    assert "cash_daily_counts" in SOURCE_COLLECTIONS
    assert "stock_movements" in SOURCE_COLLECTIONS
    assert "memory_epochs" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_collector_leases" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_quarantine" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_warehouse_facts" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_configuration_versions" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_context_daily" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_daily_snapshots" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_gaps" in MEMORY_DATABASE_COLLECTIONS
    assert "memory_integrity_runs" in MEMORY_DATABASE_COLLECTIONS
    assert "archived_deletion_logs" in SOURCE_COLLECTIONS
    assert "archived_modification_logs" in SOURCE_COLLECTIONS
    assert "archived_beverage_sales" in SOURCE_COLLECTIONS
    assert "beverage_inventory" in SOURCE_COLLECTIONS
    assert "beverage_carichi" in SOURCE_COLLECTIONS
    assert "beverages" in SOURCE_COLLECTIONS
    assert "suppliers" in SOURCE_COLLECTIONS


def test_order_state_and_deletion_share_stable_business_identity():
    captured = datetime(2026, 7, 20, 12, 5, tzinfo=timezone.utc)
    activation = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
    active_stream = next(item for item in ORDER_STREAMS if item.key == "orders_active")
    deletion_stream = next(
        item for item in ORDER_STREAMS
        if item.key == "order_deletions_active"
    )
    state = {
        "id": "order-1",
        "restaurant_id": "restaurant-1",
        "order_number": 7,
        "description": "CARB",
        "created_at": "2026-07-20T11:59:00+00:00",
        "status": "pending",
    }
    deletion = {
        "id": "deletion-1",
        "restaurant_id": "restaurant-1",
        "order_number": 7,
        "description": "CARB",
        "original_created_at": "2026-07-20T11:59:00+00:00",
        "deleted_at": "2026-07-20T12:04:00+00:00",
    }

    _, _, state_fact = normalize_order_record(
        state,
        active_stream,
        captured_at=captured,
        activation_epoch=activation,
    )
    _, _, deletion_fact = normalize_order_record(
        deletion,
        deletion_stream,
        captured_at=captured,
        activation_epoch=activation,
    )

    assert state_fact["entity_key"] == deletion_fact["entity_key"]
    assert state_fact["baseline_active_at_epoch"] is True
    assert state_fact["business_date"] == "2026-07-20"
    assert deletion_fact["fact_kind"] == "order_deleted"


def test_order_modification_declares_temporal_quality_limit():
    stream = next(
        item for item in ORDER_STREAMS
        if item.key == "order_modifications_active"
    )
    _, timestamp, fact = normalize_order_record(
        {
            "id": "modification-1",
            "order_id": "order-1",
            "restaurant_id": "restaurant-1",
            "order_number": 7,
            "old_description": "CARB",
            "new_description": "CARB NO PEPE",
            "modified_at": "2026-07-20T12:04:00+00:00",
        },
        stream,
        captured_at=datetime(2026, 7, 20, 12, 5, tzinfo=timezone.utc),
        activation_epoch=datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc),
    )

    assert timestamp == datetime(2026, 7, 20, 12, 4, tzinfo=timezone.utc)
    assert fact["entity_key"] == "order-id:order-1"
    assert fact["quality"] == {
        "original_created_at_available": False,
        "business_date_uses_modification_time": True,
    }


def test_archived_order_streams_use_cyclic_scans_for_late_arrivals():
    cyclic_streams = {
        item.key
        for item in ORDER_STREAMS
        if item.cyclic_scan
    }

    assert cyclic_streams == {
        "orders_active",
        "orders_archived",
        "order_deletions_archived",
        "order_modifications_archived",
    }
    active = next(item for item in ORDER_STREAMS if item.key == "orders_active")
    assert active.include_pre_epoch is True
    assert active.baseline_active_at_epoch is True
    assert all(
        item.include_pre_epoch is False
        for item in ORDER_STREAMS
        if item.key != "orders_active"
    )


def test_operational_application_cannot_import_memory_worker():
    for path in (BACKEND_DIR / "app").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "memory_worker" not in source
    assert "memory_worker" not in (BACKEND_DIR / "server.py").read_text(
        encoding="utf-8"
    )

    for path in (BACKEND_DIR / "memory_worker").rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "from app" not in source
        assert "import app" not in source
