import asyncio
from datetime import datetime, timezone

import pytest

from memory_worker import runner
from memory_worker.config import MemoryConfigurationError, MemorySettings


def _env(**overrides):
    return {
        "MEMORY_ENABLED": "true",
        "MEMORY_WRITE_ENABLED": "true",
        "MEMORY_ACTIVATION_EPOCH_UTC": "2026-07-19T22:00:00Z",
        "MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES": "true",
        "SOURCE_MONGO_URL": "mongodb://127.0.0.1:27017",
        "SOURCE_DB_NAME": "source",
        "MEMORY_MONGO_URL": "mongodb://127.0.0.1:27017",
        "MEMORY_DB_NAME": "memory",
        "MEMORY_POLL_SECONDS": "30",
        "MEMORY_MAX_BACKOFF_SECONDS": "120",
        "MEMORY_CIRCUIT_BREAKER_FAILURES": "2",
        **overrides,
    }


def test_dry_run_is_explicit_and_mutually_exclusive_with_writes():
    dry_run = MemorySettings.from_env(_env(
        MEMORY_DRY_RUN="true",
        MEMORY_WRITE_ENABLED="false",
        MEMORY_ACTIVATION_EPOCH_UTC="",
    ))
    assert dry_run.dry_run is True
    assert dry_run.write_enabled is False

    with pytest.raises(MemoryConfigurationError, match="non puo"):
        MemorySettings.from_env(_env(MEMORY_DRY_RUN="true"))


def test_backoff_is_bounded_and_opens_after_configured_failures():
    settings = MemorySettings.from_env(_env())

    assert runner._backoff_seconds(settings, 1) == 30
    assert runner._backoff_seconds(settings, 2) == 60
    assert runner._backoff_seconds(settings, 3) == 120
    assert runner._backoff_seconds(settings, 20) == 120


def test_dry_run_loop_never_calls_collectors(monkeypatch):
    settings = MemorySettings.from_env(_env(
        MEMORY_DRY_RUN="true",
        MEMORY_WRITE_ENABLED="false",
        MEMORY_ACTIVATION_EPOCH_UTC="",
    ))
    calls = []

    async def fake_preflight(_settings):
        calls.append("preflight")
        return {"mode": "read_only_preflight", "writes_performed": 0}

    async def forbidden_collect(_settings):
        raise AssertionError("collector called during dry-run")

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(runner, "run_preflight", fake_preflight)
    monkeypatch.setattr(runner, "collect_all_once", forbidden_collect)

    result = asyncio.run(runner.run_continuous(
        settings,
        max_cycles=2,
        sleep=no_sleep,
    ))

    assert calls == ["preflight", "preflight"]
    assert result["mode"] == "dry_run"
    assert result["successful_cycles"] == 2
    assert result["failed_cycles"] == 0


def test_runner_circuit_breaker_contains_repeated_failures(monkeypatch):
    settings = MemorySettings.from_env(_env())
    calls = []
    sleeps = []

    async def failing_collect(_settings):
        calls.append(datetime.now(timezone.utc))
        raise RuntimeError("source unavailable")

    async def no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(runner, "collect_all_once", failing_collect)

    result = asyncio.run(runner.run_continuous(
        settings,
        max_cycles=3,
        sleep=no_sleep,
    ))

    assert len(calls) == 3
    assert sleeps == [30, 120]
    assert result["successful_cycles"] == 0
    assert result["failed_cycles"] == 3
    assert result["circuit_open_count"] == 2
    assert result["last_error"]["type"] == "RuntimeError"


def test_runner_recovers_after_temporary_failure(monkeypatch):
    settings = MemorySettings.from_env(_env())
    attempts = 0
    sleeps = []

    async def flaky_collect(_settings):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("temporary outage")
        return {"collectors": {}}

    async def fake_snapshot(_settings):
        return {"summary": {"status": "complete"}}

    async def no_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(runner, "collect_all_once", flaky_collect)
    monkeypatch.setattr(runner, "build_daily_snapshots", fake_snapshot)

    result = asyncio.run(runner.run_continuous(
        settings,
        max_cycles=2,
        sleep=no_sleep,
    ))

    assert attempts == 2
    assert sleeps == [30]
    assert result["successful_cycles"] == 1
    assert result["failed_cycles"] == 1
    assert result["consecutive_failures"] == 0
    assert result["last_error"] is None


def test_runner_honors_stop_signal_after_current_cycle(monkeypatch):
    settings = MemorySettings.from_env(_env())
    stop = asyncio.Event()

    async def collect_then_stop(_settings):
        stop.set()
        return {"collectors": {}}

    async def fake_snapshot(_settings):
        return {"summary": {"status": "complete"}}

    async def forbidden_sleep(_seconds):
        raise AssertionError("runner slept after stop signal")

    monkeypatch.setattr(runner, "collect_all_once", collect_then_stop)
    monkeypatch.setattr(runner, "build_daily_snapshots", fake_snapshot)

    result = asyncio.run(runner.run_continuous(
        settings,
        stop_event=stop,
        sleep=forbidden_sleep,
    ))

    assert result["cycles"] == 1
    assert result["successful_cycles"] == 1


def test_active_runner_collects_each_cycle_and_throttles_snapshots(monkeypatch):
    settings = MemorySettings.from_env(_env())
    collected = []
    snapshots = []

    async def fake_collect(_settings):
        collected.append(True)
        return {"collectors": {}}

    async def fake_snapshot(_settings):
        snapshots.append(True)
        return {"summary": {"status": "complete"}}

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(runner, "collect_all_once", fake_collect)
    monkeypatch.setattr(runner, "build_daily_snapshots", fake_snapshot)
    monkeypatch.setattr(
        runner,
        "_has_closed_business_day",
        lambda _settings: True,
    )

    result = asyncio.run(runner.run_continuous(
        settings,
        max_cycles=2,
        sleep=no_sleep,
    ))

    assert len(collected) == 2
    assert len(snapshots) == 1
    assert result["successful_cycles"] == 2


def test_runner_skips_snapshot_until_first_post_epoch_day_closes(monkeypatch):
    settings = MemorySettings.from_env(_env())

    async def fake_collect(_settings):
        return {"collectors": {}}

    async def forbidden_snapshot(_settings):
        raise AssertionError("snapshot called before a valid day closed")

    monkeypatch.setattr(runner, "collect_all_once", fake_collect)
    monkeypatch.setattr(runner, "build_daily_snapshots", forbidden_snapshot)
    monkeypatch.setattr(
        runner,
        "_has_closed_business_day",
        lambda _settings: False,
    )

    result = asyncio.run(runner.run_continuous(
        settings,
        max_cycles=1,
    ))

    assert result["successful_cycles"] == 1
    assert result["last_result"]["snapshot"] == {
        "status": "skipped",
        "reason": "no_closed_day_since_activation",
    }


def test_resource_guard_stops_before_storage_limit(monkeypatch):
    settings = MemorySettings.from_env(_env(MEMORY_MAX_STORAGE_MB="32"))

    class FakeSource:
        def __init__(self, *_args, **_kwargs):
            self.closed = False

        async def ping(self):
            return None

        def close(self):
            self.closed = True

    class FakeStore:
        def __init__(self, *_args, **_kwargs):
            self.closed = False

        async def ping(self):
            return None

        async def database_stats(self):
            return {
                "data_size_bytes": 1,
                "storage_size_bytes": 20 * 1024 * 1024,
                "index_size_bytes": 13 * 1024 * 1024,
                "collections": 1,
                "objects": 1,
            }

        def close(self):
            self.closed = True

    monkeypatch.setattr(runner, "ReadOnlyMongoSource", FakeSource)
    monkeypatch.setattr(runner, "MemoryMongoStore", FakeStore)

    with pytest.raises(runner.MemoryResourceGuardError, match="Storage"):
        asyncio.run(runner.check_runtime_resources(settings))


def test_resource_guard_stops_before_source_latency_limit(monkeypatch):
    settings = MemorySettings.from_env(_env(
        MEMORY_MAX_SOURCE_LATENCY_MS="50",
    ))

    class FakeSource:
        def __init__(self, *_args, **_kwargs):
            pass

        async def ping(self):
            return None

        def close(self):
            pass

    class FakeStore:
        def __init__(self, *_args, **_kwargs):
            pass

        async def ping(self):
            raise AssertionError("target pinged after source guard failed")

        def close(self):
            pass

    ticks = iter((10.0, 10.051))
    monkeypatch.setattr(runner, "ReadOnlyMongoSource", FakeSource)
    monkeypatch.setattr(runner, "MemoryMongoStore", FakeStore)
    monkeypatch.setattr(runner.time, "perf_counter", lambda: next(ticks))

    with pytest.raises(runner.MemoryResourceGuardError, match="Latenza"):
        asyncio.run(runner.check_runtime_resources(settings))
