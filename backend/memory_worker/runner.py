import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional
from zoneinfo import ZoneInfo

from .collector import (
    collect_configuration_once,
    collect_orders_once,
    collect_report_once,
    collect_warehouse_once,
)
from .config import MemoryConfigurationError, MemorySettings
from .preflight import run_preflight
from .snapshots import build_daily_snapshots
from .stores import MemoryMongoStore, ReadOnlyMongoSource


logger = logging.getLogger("pastasciutta-memory")
ROME_TZ = ZoneInfo("Europe/Rome")


class MemoryResourceGuardError(RuntimeError):
    pass


def _has_closed_business_day(settings: MemorySettings) -> bool:
    activation = datetime.fromisoformat(
        settings.activation_epoch_utc.replace("Z", "+00:00")
    ).astimezone(ROME_TZ)
    last_closed = datetime.now(ROME_TZ).date() - timedelta(days=1)
    return last_closed >= activation.date()


async def check_runtime_resources(settings: MemorySettings) -> dict:
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
    try:
        started = time.perf_counter()
        await source.ping()
        source_latency_ms = round(
            (time.perf_counter() - started) * 1000,
            2,
        )
        if source_latency_ms > settings.max_source_latency_ms:
            raise MemoryResourceGuardError(
                "Latenza Mongo sorgente oltre il limite: "
                f"{source_latency_ms} ms > "
                f"{settings.max_source_latency_ms} ms"
            )
        await store.ping()
        stats = await store.database_stats()
        storage_mb = round(
            (
                stats["storage_size_bytes"]
                + stats["index_size_bytes"]
            )
            / (1024 * 1024),
            2,
        )
        if storage_mb > settings.max_memory_storage_mb:
            raise MemoryResourceGuardError(
                "Storage Memoria oltre il limite: "
                f"{storage_mb} MB > {settings.max_memory_storage_mb} MB"
            )
        return {
            "source_latency_ms": source_latency_ms,
            "memory_storage_mb": storage_mb,
            "memory_database": stats,
        }
    finally:
        source.close()
        store.close()


async def collect_all_once(settings: MemorySettings) -> dict:
    guard = await check_runtime_resources(settings)
    orders = await collect_orders_once(settings)
    report = await collect_report_once(settings)
    warehouse = await collect_warehouse_once(settings)
    configuration = await collect_configuration_once(settings)
    return {
        "guard": guard,
        "collectors": {
            "orders": orders["totals"],
            "report": report["totals"],
            "warehouse": warehouse["totals"],
            "configuration": configuration["totals"],
        },
    }


def _backoff_seconds(settings: MemorySettings, failures: int) -> int:
    exponent = max(0, failures - 1)
    return min(
        settings.max_backoff_seconds,
        settings.poll_seconds * (2 ** exponent),
    )


async def run_continuous(
    settings: MemorySettings,
    *,
    stop_event: Optional[asyncio.Event] = None,
    max_cycles: Optional[int] = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> dict:
    if not settings.enabled:
        raise MemoryConfigurationError(
            "Il runner richiede MEMORY_ENABLED=true"
        )
    if not settings.dry_run:
        settings.require_collection_activation()
    stop = stop_event or asyncio.Event()
    cycles = 0
    successful_cycles = 0
    failed_cycles = 0
    consecutive_failures = 0
    circuit_open_count = 0
    last_result = None
    last_error = None
    last_snapshot_monotonic = None

    while not stop.is_set():
        cycle_started = time.monotonic()
        try:
            if settings.dry_run:
                last_result = await run_preflight(settings)
            else:
                last_result = await collect_all_once(settings)
                snapshot_due = (
                    last_snapshot_monotonic is None
                    or cycle_started - last_snapshot_monotonic
                    >= settings.snapshot_interval_seconds
                )
                if snapshot_due:
                    if _has_closed_business_day(settings):
                        last_result["snapshot"] = await build_daily_snapshots(
                            settings
                        )
                    else:
                        last_result["snapshot"] = {
                            "status": "skipped",
                            "reason": "no_closed_day_since_activation",
                        }
                    last_snapshot_monotonic = cycle_started
            successful_cycles += 1
            consecutive_failures = 0
            last_error = None
            delay = max(
                0,
                settings.poll_seconds - (time.monotonic() - cycle_started),
            )
            logger.info(
                "memory_cycle_ok mode=%s cycle=%s delay_seconds=%s",
                "dry_run" if settings.dry_run else "active",
                cycles + 1,
                round(delay, 2),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            failed_cycles += 1
            consecutive_failures += 1
            last_error = {
                "type": type(exc).__name__,
                "message": str(exc)[:500],
                "at": datetime.now(timezone.utc).isoformat(),
            }
            delay = _backoff_seconds(settings, consecutive_failures)
            circuit_open = (
                consecutive_failures
                >= settings.circuit_breaker_failures
            )
            if circuit_open:
                circuit_open_count += 1
                delay = settings.max_backoff_seconds
            logger.error(
                "memory_cycle_failed cycle=%s failures=%s "
                "circuit_open=%s retry_seconds=%s error=%s",
                cycles + 1,
                consecutive_failures,
                circuit_open,
                delay,
                last_error,
            )
        cycles += 1
        if max_cycles is not None and cycles >= max_cycles:
            break
        if stop.is_set():
            break
        if stop_event is None:
            await sleep(delay)
        else:
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass

    return {
        "mode": "dry_run" if settings.dry_run else "active",
        "cycles": cycles,
        "successful_cycles": successful_cycles,
        "failed_cycles": failed_cycles,
        "consecutive_failures": consecutive_failures,
        "circuit_open_count": circuit_open_count,
        "last_error": last_error,
        "last_result": last_result,
    }
