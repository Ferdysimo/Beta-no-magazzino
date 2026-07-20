from datetime import datetime, timezone

from app.services.report import (
    _compute_bev_total_eur,
    _compute_cash_sera,
    _compute_paste_total_eur,
    _compute_spicci_total,
    _eval_cash_value,
)
from memory_worker.sources.report import (
    REPORT_STREAMS,
    evaluate_report_expression,
    normalize_report_record,
)


CAPTURED = datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)


def _stream(key: str):
    return next(item for item in REPORT_STREAMS if item.key == key)


def test_report_expression_distinguishes_missing_invalid_and_valid():
    missing = evaluate_report_expression("")
    invalid = evaluate_report_expression("10 + lettere")
    division_by_zero = evaluate_report_expression("10/0")
    valid = evaluate_report_expression("=10,50 + 3,20")
    rich_text = evaluate_report_expression(
        '<span style="color:red">10</span>+5'
    )

    assert (missing.status, missing.value) == ("missing", None)
    assert (invalid.status, invalid.value) == ("invalid", None)
    assert (division_by_zero.status, division_by_zero.value) == (
        "invalid",
        None,
    )
    assert str(valid.value) == "13.7"
    assert str(rich_text.value) == "15"


def test_cash_normalizer_preserves_formulas_and_structures_report_values():
    source_id, timestamp, fact = normalize_report_record(
        {
            "restaurant_id": "restaurant-1",
            "date_rome": "2026-07-20",
            "updated_at": "2026-07-20T14:59:00+00:00",
            "mattina": "=1000+50",
            "altro": "20",
            "glo": "100",
            "just": "",
            "delv": "invalid",
            "bp": "20",
            "sat": "10",
            "ft": "5",
            "pos": "200",
            "vers": '<span style="color:red">100</span>',
            "arr": "25",
            "sp5": "2",
            "sp2": "1",
            "sp1": "",
            "sp05": "",
            "cd5": "4",
            "cd2": "3",
            "cd1": "",
            "cd05": "",
            "cash_banconote": {
                "big100": "2",
                "d20": "3",
                "c10": "-2",
            },
            "paste_text": "1 CARB NO PEPE\n2 - AMAT\nCARB XL",
            "manual_prices": {"2 - AMAT": "9,50"},
            "pasta_dict_snapshot": [
                {"sigla": "CARB", "price": 8},
                {"sigla": "AMAT", "price": 8},
            ],
            "pasta_dict_snapshot_version": 1,
            "pasta_dict_snapshot_source": "live_report",
            "comments": {"altro": "nota"},
        },
        _stream("cash_daily"),
        captured_at=CAPTURED,
    )

    assert source_id == "cash:restaurant-1:2026-07-20"
    assert timestamp == datetime(2026, 7, 20, 14, 59, tzinfo=timezone.utc)
    assert fact["fact_kind"] == "cash_daily_state"
    assert fact["cash_fields"]["mattina"]["value_cents"] == 105000
    assert fact["cash_fields"]["delv"]["status"] == "invalid"
    assert fact["spicci"]["rows"]["sp5"]["value_cents"] == 10000
    assert fact["spicci"]["total_cents"] == 15000
    assert fact["cassetto"]["rows"]["cd5"]["remaining_decimal"] == "2"
    assert fact["cassetto"]["stock_total_cents"] == 2600
    assert fact["banknotes"]["total_cents"] == 26000
    assert fact["quality"]["negative_banknote_fields_ignored"] == ["c10"]
    assert fact["paste"]["total_count"] == 3
    assert fact["paste"]["recognized_count"] == 1
    assert fact["paste"]["operational_total_cents"] == 1750
    assert fact["paste"]["missing_price_count"] == 1
    assert fact["quality"]["paste_price_coverage_complete"] is False
    assert "delv" in fact["quality"]["invalid_expression_fields"]
    assert fact["comments"] == {"altro": "nota"}


def test_beverage_normalizer_matches_operational_sales_formula():
    _, _, fact = normalize_report_record(
        {
            "restaurant_id": "restaurant-1",
            "date_rome": "2026-07-20",
            "sigla": "AL",
            "updated_at": "2026-07-20T14:59:00+00:00",
            "mattina": "48",
            "inUsc": "24",
            "scarti": "2",
            "sera": "30",
            "mattina_casse": "2",
            "mattina_sfuse": "0",
            "inUsc_casse": "1",
            "sera_casse": "1",
            "sera_sfuse": "6",
        },
        _stream("beverage_daily"),
        captured_at=CAPTURED,
    )

    assert fact["sold_quantity_decimal"] == "40"
    assert fact["unit_price_cents"] == 100
    assert fact["revenue_cents"] == 4000
    assert fact["quality"]["component_mismatches"] == []
    assert fact["quality"][
        "evening_zero_uses_operational_zero_sales_rule"
    ] is False


def test_beverage_normalizer_declares_component_mismatch_and_unknown_price():
    _, _, fact = normalize_report_record(
        {
            "restaurant_id": "restaurant-1",
            "date_rome": "2026-07-20",
            "sigla": "NUOVA",
            "updated_at": "2026-07-20T14:59:00+00:00",
            "mattina": "48",
            "inUsc": "0",
            "scarti": "0",
            "sera": "0",
            "mattina_casse": "1",
            "mattina_sfuse": "0",
        },
        _stream("beverage_daily"),
        captured_at=CAPTURED,
    )

    assert fact["unit_price_cents"] is None
    assert fact["revenue_cents"] is None
    assert fact["quality"]["catalog_price_available"] is False
    assert fact["quality"]["component_mismatches"] == ["mattina"]
    assert fact["sold_quantity_decimal"] == "0"


def test_report_audit_normalizer_keeps_actor_and_real_business_day():
    source_id, timestamp, fact = normalize_report_record(
        {
            "id": "audit-1",
            "restaurant_id": "restaurant-1",
            "date_rome": "2026-07-19",
            "category": "cash",
            "field": "mattina",
            "old_value": "100",
            "new_value": "120",
            "by_role": "admin",
            "by_user": "Admin",
            "by_user_id": "admin-1",
            "is_impersonating": True,
            "first_at": "2026-07-20T10:00:00+00:00",
            "last_at": "2026-07-20T10:00:00+00:00",
            "changes_count": 1,
        },
        _stream("report_audit"),
        captured_at=CAPTURED,
    )

    assert source_id == "audit-1"
    assert timestamp == datetime(2026, 7, 20, 10, 0, tzinfo=timezone.utc)
    assert fact["business_date"] == "2026-07-19"
    assert fact["actor"]["user"] == "Admin"
    assert fact["actor"]["is_impersonating"] is True


def test_archived_beverage_sale_is_marked_final_and_checked():
    source_id, _, fact = normalize_report_record(
        {
            "id": "sale-1",
            "restaurant_id": "restaurant-1",
            "sigla": "B",
            "name": "Peroni",
            "quantity": 2,
            "price_each": 2.5,
            "total": 5,
            "created_at": "2026-07-20T10:00:00+00:00",
            "created_by": "restaurant-1",
        },
        _stream("beverage_sales_finalized"),
        captured_at=CAPTURED,
    )

    assert source_id == "sale-1"
    assert fact["business_date"] == "2026-07-20"
    assert fact["quantity_decimal"] == "2"
    assert fact["price_each_cents"] == 250
    assert fact["total_cents"] == 500
    assert fact["quality"]["finalized_by_midnight_archive"] is True
    assert fact["quality"]["total_matches_quantity_times_price"] is True


def test_phase2_streams_exclude_provisional_beverage_sales():
    collections = {stream.collection for stream in REPORT_STREAMS}

    assert collections == {
        "cash_daily_counts",
        "beverage_daily_counts",
        "cash_audit_log",
        "archived_beverage_sales",
    }
    assert "beverage_sales" not in collections


def test_memory_report_rules_match_operational_rules_on_realistic_values():
    for raw in (
        "",
        "10",
        "=10+5",
        "10,50+3,20",
        "(20-5)/3",
        '<span style="color:red">25</span>-5',
        "invalid",
    ):
        evaluation = evaluate_report_expression(raw)
        memory_value = float(evaluation.value or 0)
        assert round(memory_value, 8) == round(_eval_cash_value(raw), 8)

    cash = {
        "restaurant_id": "restaurant-1",
        "date_rome": "2026-07-20",
        "updated_at": "2026-07-20T14:59:00+00:00",
        "mattina": "=1000+50",
        "altro": "20",
        "glo": "100",
        "bp": "20",
        "sp5": "2",
        "sp2": "1",
        "paste_text": "1 CARB\n2 - AMAT",
        "manual_prices": {"2 - AMAT": "9"},
        "pasta_dict_snapshot": [
            {"sigla": "CARB", "price": 8},
            {"sigla": "AMAT", "price": 8},
        ],
        "pasta_dict_snapshot_version": 1,
    }
    _, _, cash_fact = normalize_report_record(
        cash,
        _stream("cash_daily"),
        captured_at=CAPTURED,
    )
    assert cash_fact["cash_base_cents"] == round(
        _compute_cash_sera(cash) * 100
    )
    assert cash_fact["spicci"]["total_cents"] == round(
        _compute_spicci_total(cash) * 100
    )
    assert cash_fact["paste"]["operational_total_cents"] == round(
        _compute_paste_total_eur(
            cash["paste_text"],
            cash["manual_prices"],
            {"CARB": 8, "AMAT": 8},
        ) * 100
    )

    beverage = {
        "restaurant_id": "restaurant-1",
        "date_rome": "2026-07-20",
        "sigla": "AL",
        "updated_at": "2026-07-20T14:59:00+00:00",
        "mattina": "48",
        "inUsc": "24",
        "scarti": "2",
        "sera": "30",
    }
    _, _, beverage_fact = normalize_report_record(
        beverage,
        _stream("beverage_daily"),
        captured_at=CAPTURED,
    )
    assert beverage_fact["revenue_cents"] == round(
        _compute_bev_total_eur([beverage]) * 100
    )
