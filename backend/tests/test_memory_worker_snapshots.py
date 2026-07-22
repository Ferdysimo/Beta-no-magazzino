import asyncio
from datetime import date, datetime, timezone

import pytest

from memory_worker.context import build_calendar_context
from memory_worker.snapshots import (
    _annotation_summary,
    _closed_business_date,
    _next_automatic_business_date,
)
from annotation_semantics import extract_pasta_annotation


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

    selected = asyncio.run(
        _next_automatic_business_date(
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
        )
    )

    assert selected == "2026-07-19"


def test_annotation_snapshot_uses_only_final_non_deleted_order_states():
    def state(entity_key, order_number, description, occurred_at):
        return {
            "entity_key": entity_key,
            "restaurant_id": "restaurant-1",
            "business_date": "2026-07-21",
            "occurred_at": occurred_at,
            "order_number": order_number,
            "order_id": entity_key,
            "pasta_annotation": extract_pasta_annotation(
                description,
                {"CARB", "CACIO"},
            ),
        }

    states = [
        state("order-a", 1, "CARB C TA 12", "2026-07-21T19:00:00+00:00"),
        state("order-b", 2, "CACIO C TA 12", "2026-07-21T19:00:20+00:00"),
        state("order-c", 3, "CARB T 7", "2026-07-21T19:01:00+00:00"),
    ]
    result = _annotation_summary(
        states,
        [{"entity_key": "order-c"}],
    )

    assert result["valid_order_count"] == 2
    assert result["recognized_pasta_row_count"] == 2
    assert result["unknown_text_row_count"] == 0
    assert result["pager_groups"]["reconstructed_group_count"] == 1
    assert result["pager_groups"]["multi_pasta_group_count"] == 1
    take_away = next(
        item
        for item in result["signals"]
        if item["signal_key"] == "service_mode:take_away"
    )
    assert take_away["pasta_row_count"] == 2
    assert take_away["reconstructed_group_count"] == 1
    assert result["quality"]["deleted_orders_excluded"] is True


def test_annotation_snapshot_can_reparse_custom_restaurant_pasta_codes():
    states = [
        {
            "entity_key": "order-custom",
            "restaurant_id": "restaurant-1",
            "business_date": "2026-07-21",
            "occurred_at": "2026-07-21T19:00:00+00:00",
            "order_number": 1,
            "order_id": "order-custom",
            "description": "NEW TA 4",
            "pasta_annotation": None,
        }
    ]

    result = _annotation_summary(
        states,
        [],
        pasta_codes={"NEW"},
        dictionary_source="restaurant_override",
    )

    assert result["recognized_pasta_row_count"] == 1
    assert result["signals"][0]["signal_key"] == "service_mode:take_away"
    assert result["quality"]["restaurant_dictionary_overrides_applied"] is True
