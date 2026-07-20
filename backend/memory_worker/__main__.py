import argparse
import asyncio
import json
import logging
import signal
import sys

from .config import MemoryConfigurationError, MemorySettings
from .collector import (
    collect_configuration_once,
    collect_orders_once,
    collect_report_once,
    collect_warehouse_once,
)
from .preflight import run_preflight
from .runner import run_continuous
from .snapshots import build_daily_snapshots


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m memory_worker",
        description="Fondazioni isolate della Memoria operativa",
    )
    parser.add_argument(
        "command",
        choices=(
            "status",
            "preflight",
            "collect-orders-once",
            "collect-report-once",
            "collect-warehouse-once",
            "collect-configuration-once",
            "snapshot-day",
            "run",
        ),
        nargs="?",
        default="status",
    )
    parser.add_argument(
        "--date",
        help="Giornata Europe/Rome YYYY-MM-DD per snapshot-day",
    )
    return parser


async def _run_service(settings: MemorySettings) -> dict:
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop() -> None:
        stop_event.set()

    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, request_stop)
        except (NotImplementedError, RuntimeError):
            signal.signal(
                signum,
                lambda _signum, _frame: loop.call_soon_threadsafe(
                    request_stop
                ),
            )
    return await run_continuous(settings, stop_event=stop_event)


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "run":
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
    try:
        settings = MemorySettings.from_env(
            require_connections=args.command in {
                "preflight",
                "collect-orders-once",
                "collect-report-once",
                "collect-warehouse-once",
                "collect-configuration-once",
                "snapshot-day",
                "run",
            }
        )
        if args.command == "status":
            payload = {
                "phase": 6,
                "collector_implemented": [
                    "orders_once",
                    "report_once",
                    "warehouse_once",
                    "configuration_once",
                    "daily_snapshots",
                    "continuous_runner",
                ],
                "collection_active": (
                    settings.enabled and settings.write_enabled
                ),
                "settings": settings.safe_summary(),
            }
        elif args.command == "preflight":
            payload = asyncio.run(run_preflight(settings))
        elif args.command == "collect-orders-once":
            payload = asyncio.run(collect_orders_once(settings))
        elif args.command == "collect-report-once":
            payload = asyncio.run(collect_report_once(settings))
        elif args.command == "collect-warehouse-once":
            payload = asyncio.run(collect_warehouse_once(settings))
        elif args.command == "collect-configuration-once":
            payload = asyncio.run(collect_configuration_once(settings))
        elif args.command == "snapshot-day":
            payload = asyncio.run(build_daily_snapshots(
                settings,
                business_date=args.date,
            ))
        else:
            payload = asyncio.run(_run_service(settings))
    except MemoryConfigurationError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": type(exc).__name__,
            "detail": str(exc)[:500],
        }, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, **payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
