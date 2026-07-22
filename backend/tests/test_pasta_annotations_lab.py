import pytest
from fastapi import HTTPException

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
    assert extract_pasta_annotation("CARB - no  pepe", PASTA_DICT) == {
        "pasta_sigla": "CARB",
        "annotation_source_raw": "no  pepe",
        "annotation_raw": "no pepe",
        "annotation_normalized": "NO PEPE",
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
    }
    assert extract_pasta_annotation("42 AMAT asporto", PASTA_DICT) == {
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
    assert extract_pasta_annotation("81 CARB pager 12 - no pepe", PASTA_DICT) == {
        "pasta_sigla": "CARB",
        "annotation_source_raw": "pager 12 - no pepe",
        "annotation_raw": "no pepe",
        "annotation_normalized": "NO PEPE",
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
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

    assert result["summary"] == {
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


def test_historical_dictionary_takes_precedence_over_current_dictionary():
    docs = [{
        "id": "1",
        "restaurant_id": "rest-a",
        "date_rome": "2026-07-19",
        "created_at": "2026-07-19T10:00:00+00:00",
        "order_number": 1,
        "description": "OLD NO SALE",
    }]
    result = build_pasta_annotation_stats(
        docs,
        dictionaries_by_key={("rest-a", "2026-07-19"): {"OLD": 7}},
        fallback_dictionaries={"rest-a": {"NEW": 9}},
        locations_by_id={"rest-a": "Flaminio"},
    )

    assert result["summary"]["recognized_orders"] == 1
    assert result["annotations"][0]["annotation"] == "NO SALE"


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
