import pytest
from fastapi import HTTPException
from datetime import datetime, timedelta, timezone

from app.routers.laboratory import _parse_lab_date, _require_simone_laboratory
from app.bootstrap import app
from app.services.pasta_annotations import (
    PASTA_ANNOTATION_PARSER_VERSION,
    build_pasta_annotation_stats,
    clean_pasta_annotation_text,
    extract_pasta_annotation,
    normalize_pasta_annotation,
)

PASTA_DICT = {"CARB": 8, "AMAT": 8}


def test_extracts_only_annotations_from_pastas_recognized_by_current_parser():
    extracted = extract_pasta_annotation("CARB - no  pepe", PASTA_DICT)
    assert {
        key: extracted[key]
        for key in (
            "pasta_sigla",
            "annotation_source_raw",
            "annotation_raw",
            "annotation_normalized",
            "parser_version",
        )
    } == {
        "pasta_sigla": "CARB",
        "annotation_source_raw": "no  pepe",
        "annotation_raw": "no pepe",
        "annotation_normalized": "NO PEPE",
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
    }
    assert extracted["signals"][0]["code"] == "without:pepe"
    assert extracted["unknown_fragments"] == []

    extracted = extract_pasta_annotation("42 AMAT asporto", PASTA_DICT)
    assert {
        key: extracted[key]
        for key in (
            "pasta_sigla",
            "annotation_source_raw",
            "annotation_raw",
            "annotation_normalized",
            "parser_version",
        )
    } == {
        "pasta_sigla": "AMAT",
        "annotation_source_raw": "asporto",
        "annotation_raw": "asporto",
        "annotation_normalized": "ASPORTO",
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
    }


@pytest.mark.parametrize(
    "description",
    [
        "CARBB NO PEPE",
        "PIETRO CARB",
        "CARB XL",
        "SCONOSCIUTA",
    ],
)
def test_intentionally_unrecognized_pastas_do_not_generate_annotations(description):
    assert extract_pasta_annotation(description, PASTA_DICT) is None


def test_annotation_normalization_does_not_guess_semantic_equivalence():
    assert normalize_pasta_annotation(" - no   pepe ") == "NO PEPE"
    assert normalize_pasta_annotation("senza pepe") == "SENZA PEPE"
    assert normalize_pasta_annotation("no-pepe") == "NO-PEPE"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("12", ""),
        ("12 13", ""),
        ("12 - NO PEPE", "NO PEPE"),
        ("NO PEPE - 12", "NO PEPE"),
        ("PAGER 12 SENZA GUANCIALE", "SENZA GUANCIALE"),
        ("DISCHETTO N. 12 / NO SALE", "NO SALE"),
        ("DISCO 12 AS PORTO", "AS PORTO"),
        ("N° 12 / AS PORTO", "AS PORTO"),
        ("TAVOLO 12", "TAVOLO"),
        ("NO 2x PEPE", "NO PEPE"),
    ],
)
def test_annotation_text_excludes_pager_numbers(value, expected):
    assert clean_pasta_annotation_text(value) == expected


def test_extract_keeps_source_but_exposes_only_text_as_annotation():
    extracted = extract_pasta_annotation(
        "81 CARB pager 12 - no pepe",
        PASTA_DICT,
    )
    assert {
        key: extracted[key]
        for key in (
            "pasta_sigla",
            "annotation_source_raw",
            "annotation_raw",
            "annotation_normalized",
            "parser_version",
        )
    } == {
        "pasta_sigla": "CARB",
        "annotation_source_raw": "pager 12 - no pepe",
        "annotation_raw": "no pepe",
        "annotation_normalized": "NO PEPE",
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
    }
    assert extracted["pager"] == {
        "value": 12,
        "detection": "explicit_marker",
        "confidence": "high",
        "grouping_eligible": True,
    }


def test_numeric_pager_only_orders_are_not_counted_as_annotations():
    docs = [
        {
            "id": f"numeric-{number}",
            "restaurant_id": "rest-a",
            "date_rome": "2026-07-22",
            "created_at": f"2026-07-22T10:{number:02d}:00+00:00",
            "order_number": number,
            "description": f"CARB {number}",
        }
        for number in range(1, 21)
    ]
    docs.extend(
        [
            {
                "id": "text-1",
                "restaurant_id": "rest-a",
                "date_rome": "2026-07-22",
                "created_at": "2026-07-22T11:00:00+00:00",
                "order_number": 21,
                "description": "CARB 12 NO PEPE",
            },
            {
                "id": "text-2",
                "restaurant_id": "rest-a",
                "date_rome": "2026-07-22",
                "created_at": "2026-07-22T11:01:00+00:00",
                "order_number": 22,
                "description": "AMAT PAGER 7 - AS PORTO",
            },
        ]
    )

    result = build_pasta_annotation_stats(
        docs,
        dictionaries_by_key={},
        fallback_dictionaries={"rest-a": PASTA_DICT},
        locations_by_id={"rest-a": "Flaminio"},
    )

    assert result["summary"]["recognized_orders"] == 22
    assert result["summary"]["annotated_orders"] == 2
    assert result["summary"]["annotation_rate_percent"] == 9.09
    assert [item["annotation"] for item in result["annotations"]] == [
        "AS PORTO",
        "NO PEPE",
    ]


def test_build_stats_groups_annotations_and_keeps_raw_examples():
    docs = [
        {
            "id": "1",
            "restaurant_id": "rest-a",
            "date_rome": "2026-07-19",
            "created_at": "2026-07-19T10:00:00+00:00",
            "order_number": 1,
            "description": "CARB NO PEPE",
        },
        {
            "id": "2",
            "restaurant_id": "rest-a",
            "date_rome": "2026-07-19",
            "created_at": "2026-07-19T11:00:00+00:00",
            "order_number": 2,
            "description": "AMAT no   pepe",
        },
        {
            "id": "3",
            "restaurant_id": "rest-b",
            "date_rome": "2026-07-19",
            "created_at": "2026-07-19T12:00:00+00:00",
            "order_number": 3,
            "description": "CARB",
        },
        {
            "id": "4",
            "restaurant_id": "rest-b",
            "date_rome": "2026-07-19",
            "created_at": "2026-07-19T13:00:00+00:00",
            "order_number": 4,
            "description": "CARBB NO PEPE",
        },
    ]
    result = build_pasta_annotation_stats(
        docs,
        dictionaries_by_key={},
        fallback_dictionaries={"rest-a": PASTA_DICT, "rest-b": PASTA_DICT},
        locations_by_id={"rest-a": "Flaminio", "rest-b": "Grazie"},
    )

    assert {
        key: result["summary"][key]
        for key in (
            "valid_orders",
            "recognized_orders",
            "annotated_orders",
            "unrecognized_orders",
            "annotation_rate_percent",
        )
    } == {
        "valid_orders": 4,
        "recognized_orders": 3,
        "annotated_orders": 2,
        "unrecognized_orders": 1,
        "annotation_rate_percent": 66.67,
    }
    assert result["pasta_counts"] == {"CARB": 2, "AMAT": 1}
    assert len(result["annotations"]) == 1
    annotation = result["annotations"][0]
    assert annotation["annotation"] == "NO PEPE"
    assert annotation["count"] == 2
    assert annotation["pasta_counts"] == {"AMAT": 1, "CARB": 1}
    assert annotation["location_counts"] == {"Flaminio": 2}
    assert annotation["pasta_location_counts"] == {
        "AMAT": {"Flaminio": 1},
        "CARB": {"Flaminio": 1},
    }
    assert {item["annotation_raw"] for item in annotation["examples"]} == {
        "NO PEPE",
        "no pepe",
    }
    assert result["signals"][0]["code"] == "without:pepe"
    assert result["signals"][0]["count"] == 2
    assert result["summary"]["fully_classified_orders"] == 2


def test_historical_dictionary_takes_precedence_over_current_dictionary():
    docs = [
        {
            "id": "1",
            "restaurant_id": "rest-a",
            "date_rome": "2026-07-19",
            "created_at": "2026-07-19T10:00:00+00:00",
            "order_number": 1,
            "description": "OLD NO SALE",
        }
    ]
    result = build_pasta_annotation_stats(
        docs,
        dictionaries_by_key={("rest-a", "2026-07-19"): {"OLD": 7}},
        fallback_dictionaries={"rest-a": {"NEW": 9}},
        locations_by_id={"rest-a": "Flaminio"},
    )

    assert result["summary"]["recognized_orders"] == 1
    assert result["annotations"][0]["annotation"] == "NO SALE"


def test_two_month_multi_location_simulation_keeps_portions_and_groups_distinct():
    docs = []
    order_number = 0
    start = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    descriptions = (
        "CARB RIG C S TA {pager}",
        "CACIO NO PEPE C TA {pager}",
        "AMAT T {pager}",
    )
    restaurant_ids = ("rest-a", "rest-b", "rest-c")
    for day in range(60):
        for restaurant_index, restaurant_id in enumerate(restaurant_ids):
            for group_index in range(20):
                group_start = (
                    start
                    + timedelta(days=day)
                    + timedelta(minutes=group_index * 3)
                    + timedelta(seconds=restaurant_index)
                )
                pager = group_index % 10 + 1
                for row_index, template in enumerate(descriptions):
                    order_number += 1
                    created_at = group_start + timedelta(seconds=row_index * 5)
                    docs.append(
                        {
                            "id": f"sim-{order_number}",
                            "restaurant_id": restaurant_id,
                            "date_rome": created_at.date().isoformat(),
                            "created_at": created_at.isoformat(),
                            "order_number": order_number,
                            "description": template.format(pager=pager),
                        }
                    )

    result = build_pasta_annotation_stats(
        docs,
        dictionaries_by_key={},
        fallback_dictionaries={
            restaurant_id: {"CARB": 8, "CACIO": 8, "AMAT": 8}
            for restaurant_id in restaurant_ids
        },
        locations_by_id={
            "rest-a": "Flaminio",
            "rest-b": "Grazie",
            "rest-c": "Largo di Brazza",
        },
    )

    signals = {item["signal_key"]: item for item in result["signals"]}
    assert result["summary"]["recognized_orders"] == 10800
    assert result["summary"]["annotated_orders"] == 10800
    assert result["grouping"]["pager_linked_rows"] == 10800
    assert result["grouping"]["reconstructed_group_count"] == 3600
    assert result["grouping"]["multi_pasta_group_count"] == 3600
    assert signals["service_mode:take_away"]["count"] == 7200
    assert signals["service_mode:take_away"]["reconstructed_group_count"] == 3600
    assert signals["preparation_request:without:pepe"]["count"] == 3600
    assert result["unknown_fragments"][0]["fragment"] == "T"
    assert result["unknown_fragments"][0]["count"] == 3600


@pytest.mark.parametrize(
    ("token_data", "allowed"),
    [
        ({"username": "Simone", "role": "admin"}, True),
        ({"username": "Admin", "role": "admin"}, False),
        ({"username": "Federico", "role": "supervisor"}, False),
        ({"username": "Flaminio", "role": "restaurant"}, False),
        ({"username": "Magazzino", "role": "magazzino"}, False),
        ({}, False),
    ],
)
def test_laboratory_backend_access_matrix(token_data, allowed):
    if allowed:
        _require_simone_laboratory(token_data)
        return
    with pytest.raises(HTTPException) as exc:
        _require_simone_laboratory(token_data)
    assert exc.value.status_code == 403


def test_lab_date_validation_is_strict():
    with pytest.raises(HTTPException) as exc:
        _parse_lab_date("20/07/2026", default=None, field="start_date")
    assert exc.value.status_code == 400


def test_lab_endpoint_is_part_of_the_explicit_openapi_contract():
    operations = app.openapi()["paths"]["/api/lab/pasta-annotations"]
    assert set(operations) == {"get"}


def test_document_scanner_endpoints_are_part_of_the_explicit_openapi_contract():
    paths = app.openapi()["paths"]
    assert set(paths["/api/lab/document-scanner/context"]) == {"get"}
    assert set(paths["/api/lab/document-scanner/analyze"]) == {"post"}
    assert set(paths["/api/lab/document-scanner/feedback"]) == {"post"}
