import re
from collections import Counter
from typing import Dict, Iterable, Optional

from app.services.report import _pasta_recognized_sigla


PASTA_ANNOTATION_PARSER_VERSION = 2
_LEADING_ANNOTATION_SEPARATOR = re.compile(r"^[\s\-:;,/|#°º]+")
_TRAILING_ANNOTATION_SEPARATOR = re.compile(r"[\s\-:;,/|#°º]+$")
_PAGER_NUMBER = re.compile(
    r"(?<!\w)(?:(?:PAGER|DISCHETTO|DISCO)\s*(?:N(?:UM(?:ERO)?)?|NR)?|"
    r"N(?:UM(?:ERO)?)?|NR)\s*[°º#.:/\-]*\s*\d+(?!\w)",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*(?:[xX])?")


def clean_pasta_annotation_text(value: str) -> str:
    """Keep only meaningful written annotation text, excluding pager numbers."""
    cleaned = str(value or "").strip()
    cleaned = _PAGER_NUMBER.sub(" ", cleaned)
    cleaned = _NUMBER.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = _LEADING_ANNOTATION_SEPARATOR.sub("", cleaned)
    cleaned = _TRAILING_ANNOTATION_SEPARATOR.sub("", cleaned).strip()
    if not any(character.isalpha() for character in cleaned):
        return ""
    return cleaned


def normalize_pasta_annotation(value: str) -> str:
    """Normalize presentation differences without guessing meaning or spelling."""
    return clean_pasta_annotation_text(value).upper()


def extract_pasta_annotation(
    description: str,
    dict_map: Dict[str, float],
) -> Optional[dict]:
    """Extract the annotation only after the existing parser recognizes a pasta."""
    raw_description = str(description or "").strip()
    recognized_sigla = _pasta_recognized_sigla(raw_description, dict_map)
    if recognized_sigla is None:
        return None

    pattern = re.compile(
        rf"^\s*(?:\d+\s+)?{re.escape(recognized_sigla)}(?:\b|$)",
        re.IGNORECASE,
    )
    match = pattern.search(raw_description)
    if not match:
        return None

    annotation_source_raw = _LEADING_ANNOTATION_SEPARATOR.sub(
        "",
        raw_description[match.end():].strip(),
    ).strip()
    annotation_raw = clean_pasta_annotation_text(annotation_source_raw)
    return {
        "pasta_sigla": recognized_sigla,
        "annotation_source_raw": annotation_source_raw,
        "annotation_raw": annotation_raw,
        "annotation_normalized": normalize_pasta_annotation(annotation_raw),
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
    }


def build_pasta_annotation_stats(
    order_docs: Iterable[dict],
    *,
    dictionaries_by_key: Dict[tuple, Dict[str, float]],
    fallback_dictionaries: Dict[str, Dict[str, float]],
    locations_by_id: Dict[str, str],
    max_examples: int = 5,
) -> dict:
    groups: Dict[str, dict] = {}
    valid_orders = 0
    recognized_orders = 0
    annotated_orders = 0
    unrecognized_orders = 0
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
        extracted = extract_pasta_annotation(doc.get("description") or "", dict_map)
        if extracted is None:
            unrecognized_orders += 1
            continue

        recognized_orders += 1
        sigla = extracted["pasta_sigla"]
        pasta_counts[sigla] += 1
        annotation = extracted["annotation_normalized"]
        if not annotation:
            continue

        annotated_orders += 1
        location = locations_by_id.get(restaurant_id, restaurant_id)
        group = groups.setdefault(
            annotation,
            {
                "annotation": annotation,
                "count": 0,
                "pasta_counts": Counter(),
                "location_counts": Counter(),
                "pasta_location_counts": {},
                "raw_variants": Counter(),
                "examples": [],
                "pasta_examples": {},
            },
        )
        group["count"] += 1
        group["pasta_counts"][sigla] += 1
        group["location_counts"][location] += 1
        group["pasta_location_counts"].setdefault(sigla, Counter())[location] += 1
        group["raw_variants"][extracted["annotation_raw"]] += 1
        example = {
            "restaurant_id": restaurant_id,
            "location": location,
            "business_date": business_date,
            "pasta_sigla": sigla,
            "annotation_source_raw": extracted["annotation_source_raw"],
            "annotation_raw": extracted["annotation_raw"],
            "order_id": doc.get("id"),
            "order_number": doc.get("order_number"),
        }
        if len(group["examples"]) < max_examples:
            group["examples"].append(example)
        pasta_examples = group["pasta_examples"].setdefault(sigla, [])
        if len(pasta_examples) < max_examples:
            pasta_examples.append(example)

    annotations = []
    for group in groups.values():
        annotations.append({
            "annotation": group["annotation"],
            "count": group["count"],
            "recognized_share_percent": round(
                (group["count"] / recognized_orders * 100) if recognized_orders else 0,
                2,
            ),
            "annotated_share_percent": round(
                (group["count"] / annotated_orders * 100) if annotated_orders else 0,
                2,
            ),
            "pasta_counts": dict(group["pasta_counts"].most_common()),
            "location_counts": dict(group["location_counts"].most_common()),
            "pasta_location_counts": {
                sigla: dict(location_counts.most_common())
                for sigla, location_counts in group["pasta_location_counts"].items()
            },
            "raw_variants": [
                {"value": value, "count": count}
                for value, count in group["raw_variants"].most_common(5)
            ],
            "examples": group["examples"],
            "pasta_examples": group["pasta_examples"],
        })
    annotations.sort(key=lambda item: (-item["count"], item["annotation"]))

    return {
        "parser_version": PASTA_ANNOTATION_PARSER_VERSION,
        "summary": {
            "valid_orders": valid_orders,
            "recognized_orders": recognized_orders,
            "annotated_orders": annotated_orders,
            "unrecognized_orders": unrecognized_orders,
            "annotation_rate_percent": round(
                (annotated_orders / recognized_orders * 100) if recognized_orders else 0,
                2,
            ),
        },
        "pasta_counts": dict(pasta_counts.most_common()),
        "annotations": annotations,
    }
