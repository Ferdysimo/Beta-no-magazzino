from annotation_semantics import (
    ANNOTATION_PARSER_VERSION,
    ANNOTATION_RULESET_VERSION,
    PAGER_GROUPING_RULE_VERSION,
    annotation_rule_manifest,
    extract_pasta_annotation,
    reconstruct_probable_pager_groups,
    recognize_pasta_sigla,
)

PASTA_CODES = {"CARB", "CACIO", "AMAT"}


def _observation(
    description,
    *,
    order_number,
    occurred_at,
    restaurant_id="rest-1",
):
    annotation = extract_pasta_annotation(description, PASTA_CODES)
    return {
        "restaurant_id": restaurant_id,
        "location": restaurant_id,
        "business_date": "2026-07-22",
        "occurred_at": occurred_at,
        "order_number": order_number,
        "order_id": f"order-{restaurant_id}-{order_number}",
        "pasta_sigla": annotation["pasta_sigla"],
        "annotation": annotation,
    }


def test_confirmed_operational_example_becomes_independent_signals():
    parsed = extract_pasta_annotation("CARB RIG C S TA 12", PASTA_CODES)

    assert parsed["annotation_normalized"] == "RIG C S TA"
    assert parsed["pager"]["value"] == 12
    assert parsed["pager"]["detection"] == "terminal_number"
    assert {
        (signal["dimension"], signal["code"], signal["certainty"])
        for signal in parsed["signals"]
    } == {
        ("pasta_format", "rig", "observed_code"),
        ("serving_container", "cardboard_bowl", "confirmed"),
        ("kitchen_coordination", "solo_customer", "confirmed"),
        ("service_mode", "take_away", "confirmed"),
    }
    assert parsed["unknown_fragments"] == []
    assert parsed["semantic_status"] == "classified"


def test_unknown_t_is_preserved_without_an_invented_meaning():
    parsed = extract_pasta_annotation("CARB T 12", PASTA_CODES)

    assert parsed["signals"] == []
    assert parsed["unknown_fragments"] == ["T"]
    assert parsed["unknown_tokens"] == ["T"]
    assert parsed["semantic_status"] == "unclassified"


def test_outdoor_and_lid_only_codes_use_the_confirmed_meanings():
    parsed = extract_pasta_annotation("AMAT F CHIUSA 9", PASTA_CODES)
    signals = {signal["code"]: signal for signal in parsed["signals"]}

    assert signals["outdoor"]["dimension"] == "dining_area"
    assert signals["lid_only_no_bag"]["dimension"] == "packaging"
    assert signals["outdoor"]["certainty"] == "confirmed"
    assert signals["lid_only_no_bag"]["certainty"] == "confirmed"


def test_literal_requests_are_structured_without_correcting_the_target():
    no_pepe = extract_pasta_annotation("CACIO NO PEPE 7", PASTA_CODES)
    allergy = extract_pasta_annotation(
        "CARB (ALLERGICA FORMAGGIO) TA 8",
        PASTA_CODES,
    )

    assert no_pepe["signals"][0]["code"] == "without:pepe"
    assert no_pepe["signals"][0]["target"] == "PEPE"
    assert no_pepe["signals"][0]["certainty"] == "literal"
    assert {signal["dimension"] for signal in allergy["signals"]} == {
        "safety_note",
        "service_mode",
    }
    assert allergy["unknown_fragments"] == []


def test_quantity_and_pager_numbers_keep_different_roles():
    parsed = extract_pasta_annotation("CARB 2 COCA DEL 12", PASTA_CODES)

    assert parsed["pager"]["value"] == 12
    assert [(item["value"], item["role"]) for item in parsed["numbers"]] == [
        (2, "quantity"),
        (12, "pager"),
    ]
    assert parsed["annotation_normalized"] == "COCA DEL"
    assert parsed["unknown_fragments"] == ["COCA DEL"]


def test_ambiguous_non_terminal_number_is_not_used_for_grouping():
    parsed = extract_pasta_annotation("CARB 12 SOLA", PASTA_CODES)

    assert parsed["pager"] is None
    assert parsed["numbers"][0]["role"] == "pager_or_quantity_candidate"
    assert parsed["annotation_normalized"] == "SOLA"


def test_table_and_trailing_quantity_numbers_are_not_promoted_to_pagers():
    table = extract_pasta_annotation("CARB TAVOLO 12", PASTA_CODES)
    quantity = extract_pasta_annotation("CARB COCA 2", PASTA_CODES)

    assert table["pager"] is None
    assert quantity["pager"] is None
    assert table["numbers"][0]["role"] == "context_number"
    assert quantity["numbers"][0]["role"] == "quantity"


def test_request_target_does_not_swallow_following_unknown_codes():
    parsed = extract_pasta_annotation("CARB NO PEPE DEL 12", PASTA_CODES)

    assert parsed["signals"][0]["code"] == "without:pepe"
    assert parsed["unknown_fragments"] == ["DEL"]


def test_probable_groups_require_same_scope_pager_time_and_nearby_orders():
    observations = [
        _observation(
            "CARB C TA 12",
            order_number=100,
            occurred_at="2026-07-22T10:00:00+00:00",
        ),
        _observation(
            "CACIO C TA 12",
            order_number=101,
            occurred_at="2026-07-22T10:00:20+00:00",
        ),
        _observation(
            "AMAT TA 12",
            order_number=102,
            occurred_at="2026-07-22T10:02:20+00:00",
        ),
        _observation(
            "CARB TA 12",
            order_number=1,
            occurred_at="2026-07-22T10:00:10+00:00",
            restaurant_id="rest-2",
        ),
    ]

    grouped = reconstruct_probable_pager_groups(observations)

    assert grouped["rule_version"] == PAGER_GROUPING_RULE_VERSION
    assert grouped["pager_linked_rows"] == 4
    assert grouped["reconstructed_group_count"] == 3
    assert grouped["multi_pasta_group_count"] == 1
    assert grouped["pasta_rows_in_multi_groups"] == 2
    assert grouped["confidence_counts"] == {
        "high": 1,
        "single_row": 2,
    }
    assert grouped["signal_group_counts"]["service_mode:take_away"] == 3
    assert grouped["examples"][0]["row_count"] == 2
    assert grouped["examples"][0]["pasta_counts"] == {
        "CACIO": 1,
        "CARB": 1,
    }


def test_rule_manifest_is_versioned_and_does_not_assign_t():
    manifest = annotation_rule_manifest()

    assert manifest["parser_version"] == ANNOTATION_PARSER_VERSION
    assert manifest["ruleset_version"] == ANNOTATION_RULESET_VERSION
    assert manifest["pager_grouping"]["authoritative"] is False
    assert "T" not in {
        alias for rule in manifest["static_signals"] for alias in rule["aliases"]
    }


def test_isolated_recognizer_keeps_the_operational_strictness():
    assert recognize_pasta_sigla("2 CARB C 12", PASTA_CODES) == "CARB"
    assert recognize_pasta_sigla("CARB XL C 12", PASTA_CODES) is None
    assert recognize_pasta_sigla("CARBB C 12", PASTA_CODES) is None
    assert recognize_pasta_sigla("NOTE CARB C 12", PASTA_CODES) is None
