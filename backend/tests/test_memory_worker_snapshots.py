import asyncio
from datetime import date, datetime, timezone

import pytest

from memory_worker.context import build_calendar_context
from memory_worker.snapshots import (
    _closed_business_date,
    _next_automatic_business_date,
)


def test_calendar_context_knows_fixed_and_movable_italian_holidays():
    christmas = build_calendar_context("2026-12-25")
    easter_monday = build_calendar_context("2026-04-06")

    assert christmas["holiday"]["name"] == "Natale"
    assert christmas["holiday"]["is_national_holiday"] is True
    assert christmas["calendar"]["quarter"] == 4
    assert easter_monday["holiday"]["name"] == "Lunedi dell'Angelo"
    assert easter_monday["quality"]["weather_available"] is False


def test_snapshot_rejects_today_future_and_invalid_dates():
    today = date.today().isoformat()

    with pytest.raises(ValueError, match="giornate chiuse"):
        _closed_business_date(today)
    with pytest.raises(ValueError):
        _closed_business_date("2026-02-31")


def test_automatic_snapshot_date_fills_oldest_missing_day_first():
    class FakeStore:
        async def read_memory_documents(
            self,
            _collection,
            _query,
            _projection,
            *,
            limit,
        ):
            assert limit == 10000
            return [
                {"business_date": "2026-07-18"},
                {"business_date": "2026-07-20"},
            ]

    selected = asyncio.run(_next_automatic_business_date(
        FakeStore(),
        epoch={
            "id": "epoch-1",
            "activated_at": datetime(
                2026,
                7,
                18,
                4,
                tzinfo=timezone.utc,
            ),
        },
        today_rome=date(2026, 7, 22),
    ))

    assert selected == "2026-07-19"
