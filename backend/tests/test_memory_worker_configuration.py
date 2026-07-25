from datetime import datetime, timezone
from decimal import Decimal

from app.services.report import PASTA_PRICES_MAP
from memory_worker.sources.configuration import (
    CONFIGURATION_STREAMS,
    DEFAULT_PASTA_PRICES,
    default_annotation_semantics_rule,
    default_pasta_rule,
    initial_configuration_valid_from,
    normalize_configuration_record,
)

CAPTURED = datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)
ACTIVATION = datetime(2026, 7, 20, 14, 0, tzinfo=timezone.utc)


def _stream(key: str):
    return next(item for item in CONFIGURATION_STREAMS if item.key == key)


def test_restaurant_configuration_keeps_operations_and_excludes_runtime_fields():
    stream = _stream("configuration_restaurants")
    _, _, fact = normalize_configuration_record(
        {
            "id": "restaurant-1",
            "name": "Pastasciutta Roma",
            "username": "Flaminio",
            "location": "Flaminio",
            "role": "restaurant",
            "boiler_count": 2,
            "report_code": "F",
            "address": "Piazzale Flaminio 10",
            "postal_code": "00196",
            "city": "Roma",
            "monitor_customers_enabled": True,
            "created_at": "2026-01-01T10:00:00+00:00",
        },
        stream,
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert fact["restaurant_id"] == "restaurant-1"
    assert fact["boiler_count"] == 2
    assert fact["address"]["postal_code"] == "00196"
    assert fact["monitor_customers"]["value"] is True
    assert fact["quality"]["authentication_secrets_excluded"] is True
    assert "password" not in stream.projection
    assert "token_version" not in stream.projection
    assert "order_counter" not in stream.projection


def test_pasta_dictionary_and_beverage_prices_use_integer_cents():
    _, _, dictionary = normalize_configuration_record(
        {
            "restaurant_id": "restaurant-1",
            "siglas": [
                {"sigla": "POM", "price": 7},
                {"sigla": "CARB", "price": 8.5},
            ],
            "updated_at": "2026-07-20T14:10:00+00:00",
            "updated_by": "Admin",
        },
        _stream("configuration_pasta_dictionaries"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )
    _, _, beverage = normalize_configuration_record(
        {
            "sigla": "VB",
            "name": "Vino bianco",
            "price": 2.5,
            "sort_order": 8,
        },
        _stream("configuration_beverages"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert dictionary["entries"] == [
        {"code": "CARB", "price_cents": 850},
        {"code": "POM", "price_cents": 700},
    ]
    assert dictionary["dictionary_source"] == "restaurant_override"
    assert beverage["price_cents"] == 250


def test_confirmed_pasta_alias_is_collected_as_versioned_configuration():
    source_id, timestamp, fact = normalize_configuration_record(
        {
            "id": "alias-1",
            "alias_normalized": "guanci",
            "canonical_normalized": "guanciale",
            "active": True,
            "learning_version": 1,
            "source": "assisted_confirmation",
            "created_by_username": "Simone",
            "created_at": "2026-07-20T14:10:00+00:00",
            "updated_at": "2026-07-20T14:12:00+00:00",
        },
        _stream("configuration_pasta_annotation_aliases"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert source_id == "pasta-annotation-alias:GUANCI"
    assert timestamp == datetime(2026, 7, 20, 14, 12, tzinfo=timezone.utc)
    assert fact["alias_normalized"] == "GUANCI"
    assert fact["canonical_normalized"] == "GUANCIALE"
    assert fact["confirmed_by"]["username"] == "Simone"
    assert fact["quality"]["human_confirmation_required"] is True


def test_default_pasta_rule_is_versioned_and_matches_operational_backend():
    source_id, timestamp, fact, raw = default_pasta_rule(
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert source_id == "default-pasta-prices"
    assert timestamp == ACTIVATION
    assert fact["quality"]["authoritative_source_copy"] is False
    assert fact["quality"]["parity_test_required"] is True
    assert raw["rule_version"] == 1
    assert {
        code: float(price) for code, price in DEFAULT_PASTA_PRICES.items()
    } == PASTA_PRICES_MAP
    assert all(isinstance(value, Decimal) for value in DEFAULT_PASTA_PRICES.values())


def test_annotation_semantics_rule_is_versioned_for_future_replay():
    source_id, timestamp, fact, raw = default_annotation_semantics_rule(
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert source_id == "annotation-semantics"
    assert timestamp == ACTIVATION
    assert fact["rule_kind"] == "annotation_semantics"
    assert fact["quality"]["raw_order_text_replayable"] is True
    assert raw["pager_grouping"]["authoritative"] is False
    assert raw["unknown_tokens_preserved"] is True


def test_initial_configuration_validity_distinguishes_baseline_and_later_records():
    captured_fact = {"quality": {"timestamp_source": "captured_at"}}
    later = datetime(2026, 7, 20, 16, 0, tzinfo=timezone.utc)

    assert (
        initial_configuration_valid_from(
            captured_fact,
            source_timestamp=CAPTURED,
            activation_epoch=ACTIVATION,
            baseline_scan=True,
        )
        == ACTIVATION
    )
    assert (
        initial_configuration_valid_from(
            captured_fact,
            source_timestamp=later,
            activation_epoch=ACTIVATION,
            baseline_scan=False,
        )
        == later
    )
    assert (
        initial_configuration_valid_from(
            {"quality": {"timestamp_source": "updated_at"}},
            source_timestamp=later,
            activation_epoch=ACTIVATION,
            baseline_scan=True,
        )
        == later
    )


def test_configuration_streams_cover_local_prices_catalog_and_suppliers():
    assert {stream.collection for stream in CONFIGURATION_STREAMS} == {
        "restaurants",
        "pasta_dictionary",
        "lab_pasta_annotation_aliases",
        "beverages",
        "suppliers",
    }
