from collections import Counter
from typing import Dict, Iterable, Optional

from annotation_semantics import (
    ANNOTATION_PARSER_VERSION,
    ANNOTATION_RULESET_VERSION,
    clean_annotation_text,
    normalize_annotation_text,
    parse_recognized_pasta_annotation,
    reconstruct_probable_pager_groups,
    semantic_signal_key,
)
from app.services.report import _pasta_recognized_sigla

PASTA_ANNOTATION_PARSER_VERSION = ANNOTATION_PARSER_VERSION
PASTA_ANNOTATION_RULESET_VERSION = ANNOTATION_RULESET_VERSION


def clean_pasta_annotation_text(value: str) -> str:
    return clean_annotation_text(value)


def normalize_pasta_annotation(value: str) -> str:
    return normalize_annotation_text(value)


def extract_pasta_annotation(
    description: str,
    dict_map: Dict[str, float],
) -> Optional[dict]:
    """Use the operational pasta recognizer, then apply shared semantics."""
    raw_description = str(description or "").strip()
    recognized_sigla = _pasta_recognized_sigla(raw_description, dict_map)
    if recognized_sigla is None:
        return None
    return parse_recognized_pasta_annotation(
        raw_description,
        recognized_sigla,
    )


def _example(
    doc: dict,
    extracted: dict,
    *,
    restaurant_id: str,
    business_date: str,
    location: str,
) -> dict:
    return {
        "restaurant_id": restaurant_id,
        "location": location,
        "business_date": business_date,
        "pasta_sigla": extracted["pasta_sigla"],
        "annotation_source_raw": extracted["annotation_source_raw"],
        "annotation_raw": extracted["annotation_raw"],
        "order_id": doc.get("id"),
        "order_number": doc.get("order_number"),
    }


def _new_breakdown_group(**values) -> dict:
    return {
        **values,
        "count": 0,
        "pasta_counts": Counter(),
        "location_counts": Counter(),
        "pasta_location_counts": {},
        "examples": [],
        "pasta_examples": {},
    }


def _record_breakdown(
    group: dict,
    *,
    sigla: str,
    location: str,
    example: dict,
    max_examples: int,
) -> None:
    group["count"] += 1
    group["pasta_counts"][sigla] += 1
    group["location_counts"][location] += 1
    group["pasta_location_counts"].setdefault(sigla, Counter())[location] += 1
    if len(group["examples"]) < max_examples:
        group["examples"].append(example)
    pasta_examples = group["pasta_examples"].setdefault(sigla, [])
    if len(pasta_examples) < max_examples:
        pasta_examples.append(example)


def _serialized_breakdown(group: dict) -> dict:
    return {
        "count": group["count"],
        "pasta_counts": dict(group["pasta_counts"].most_common()),
        "location_counts": dict(group["location_counts"].most_common()),
        "pasta_location_counts": {
            sigla: dict(location_counts.most_common())
            for sigla, location_counts in group["pasta_location_counts"].items()
        },
        "examples": group["examples"],
        "pasta_examples": group["pasta_examples"],
    }


def build_pasta_annotation_stats(
    order_docs: Iterable[dict],
    *,
    dictionaries_by_key: Dict[tuple, Dict[str, float]],
    fallback_dictionaries: Dict[str, Dict[str, float]],
    locations_by_id: Dict[str, str],
    max_examples: int = 5,
) -> dict:
    annotation_groups: Dict[str, dict] = {}
    signal_groups: Dict[str, dict] = {}
    unknown_groups: Dict[str, dict] = {}
    semantic_observations = []
    valid_orders = 0
    recognized_orders = 0
    annotated_orders = 0
    unrecognized_orders = 0
    orders_with_signals = 0
    orders_with_unknown_text = 0
    fully_classified_orders = 0
    partially_classified_orders = 0
    pager_linked_orders = 0
    pasta_counts: Counter = Counter()

    docs = sorted(
        list(order_docs or []),
        key=lambda item: str(item.get("created_at") or ""),
        reverse=True,
    )
    for doc in docs:
        valid_orders += 1
        restaurant_id = str(doc.get("restaurant_id") or "")
        business_date = str(doc.get("date_rome") or "")
        dict_map = (
            dictionaries_by_key.get((restaurant_id, business_date))
            or fallback_dictionaries.get(restaurant_id)
            or {}
        )
        extracted = extract_pasta_annotation(
            doc.get("description") or "",
            dict_map,
        )
        if extracted is None:
            unrecognized_orders += 1
            continue

        recognized_orders += 1
        sigla = extracted["pasta_sigla"]
        pasta_counts[sigla] += 1
        location = locations_by_id.get(restaurant_id, restaurant_id)
        example = _example(
            doc,
            extracted,
            restaurant_id=restaurant_id,
            business_date=business_date,
            location=location,
        )
        semantic_observations.append(
            {
                "restaurant_id": restaurant_id,
                "location": location,
                "business_date": business_date,
                "occurred_at": doc.get("created_at"),
                "order_number": doc.get("order_number"),
                "order_id": doc.get("id"),
                "pasta_sigla": sigla,
                "annotation": extracted,
            }
        )

        pager = extracted.get("pager") or {}
        if pager.get("grouping_eligible"):
            pager_linked_orders += 1

        signals = extracted.get("signals") or []
        unknown_fragments = extracted.get("unknown_fragments") or []
        if signals:
            orders_with_signals += 1
        if unknown_fragments:
            orders_with_unknown_text += 1
        if extracted["semantic_status"] == "classified":
            fully_classified_orders += 1
        elif extracted["semantic_status"] == "partial":
            partially_classified_orders += 1

        for signal in signals:
            key = semantic_signal_key(signal)
            group = signal_groups.setdefault(
                key,
                _new_breakdown_group(
                    signal_key=key,
                    dimension=signal["dimension"],
                    code=signal["code"],
                    label=signal["label"],
                    certainty=signal["certainty"],
                    target=signal.get("target"),
                    source_terms=Counter(),
                ),
            )
            group["source_terms"].update(signal.get("source_terms") or [])
            _record_breakdown(
                group,
                sigla=sigla,
                location=location,
                example=example,
                max_examples=max_examples,
            )

        for fragment in set(unknown_fragments):
            group = unknown_groups.setdefault(
                fragment,
                _new_breakdown_group(fragment=fragment),
            )
            _record_breakdown(
                group,
                sigla=sigla,
                location=location,
                example=example,
                max_examples=max_examples,
            )

        annotation = extracted["annotation_normalized"]
        if not annotation:
            continue
        annotated_orders += 1
        group = annotation_groups.setdefault(
            annotation,
            {
                **_new_breakdown_group(
                    annotation=annotation,
                    raw_variants=Counter(),
                ),
            },
        )
        group["raw_variants"][extracted["annotation_raw"]] += 1
        _record_breakdown(
            group,
            sigla=sigla,
            location=location,
            example=example,
            max_examples=max_examples,
        )

    grouping = reconstruct_probable_pager_groups(
        semantic_observations,
        max_examples=30,
    )

    annotations = []
    for group in annotation_groups.values():
        annotations.append(
            {
                "annotation": group["annotation"],
                **_serialized_breakdown(group),
                "recognized_share_percent": round(
                    (
                        (group["count"] / recognized_orders * 100)
                        if recognized_orders
                        else 0
                    ),
                    2,
                ),
                "annotated_share_percent": round(
                    (
                        (group["count"] / annotated_orders * 100)
                        if annotated_orders
                        else 0
                    ),
                    2,
                ),
                "raw_variants": [
                    {"value": value, "count": count}
                    for value, count in group["raw_variants"].most_common(5)
                ],
            }
        )
    annotations.sort(key=lambda item: (-item["count"], item["annotation"]))

    semantic_signals = []
    for key, group in signal_groups.items():
        semantic_signals.append(
            {
                "signal_key": key,
                "dimension": group["dimension"],
                "code": group["code"],
                "label": group["label"],
                "certainty": group["certainty"],
                "target": group.get("target"),
                **_serialized_breakdown(group),
                "recognized_share_percent": round(
                    (
                        (group["count"] / recognized_orders * 100)
                        if recognized_orders
                        else 0
                    ),
                    2,
                ),
                "reconstructed_group_count": (
                    grouping["signal_group_counts"].get(key, 0)
                ),
                "source_terms": [
                    {"value": value, "count": count}
                    for value, count in group["source_terms"].most_common()
                ],
            }
        )
    semantic_signals.sort(
        key=lambda item: (-item["count"], item["dimension"], item["label"])
    )

    unknowns = []
    for group in unknown_groups.values():
        unknowns.append(
            {
                "fragment": group["fragment"],
                **_serialized_breakdown(group),
                "annotated_share_percent": round(
                    (
                        (group["count"] / annotated_orders * 100)
                        if annotated_orders
                        else 0
                    ),
                    2,
                ),
            }
        )
    unknowns.sort(key=lambda item: (-item["count"], item["fragment"]))

    return {
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
        "ruleset_version": PASTA_ANNOTATION_RULESET_VERSION,
        "summary": {
            "valid_orders": valid_orders,
            "recognized_orders": recognized_orders,
            "annotated_orders": annotated_orders,
            "unrecognized_orders": unrecognized_orders,
            "annotation_rate_percent": round(
                (
                    (annotated_orders / recognized_orders * 100)
                    if recognized_orders
                    else 0
                ),
                2,
            ),
            "orders_with_signals": orders_with_signals,
            "orders_with_unknown_text": orders_with_unknown_text,
            "fully_classified_orders": fully_classified_orders,
            "partially_classified_orders": partially_classified_orders,
            "semantic_coverage_percent": round(
                (
                    (orders_with_signals / annotated_orders * 100)
                    if annotated_orders
                    else 0
                ),
                2,
            ),
            "pager_linked_orders": pager_linked_orders,
        },
        "pasta_counts": dict(pasta_counts.most_common()),
        "signals": semantic_signals,
        "unknown_fragments": unknowns,
        "grouping": grouping,
        "annotations": annotations,
    }
