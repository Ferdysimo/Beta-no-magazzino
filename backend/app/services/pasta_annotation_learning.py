import hashlib
import uuid
from collections import Counter
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Iterable

from annotation_semantics import (
    annotation_target_alias_map,
    annotation_target_canonicals,
    canonicalize_annotation_target,
    normalize_annotation_target,
)

MAX_LEARNED_ALIASES = 500
MAX_DISMISSED_PAIRS = 2000
MAX_SUGGESTIONS = 20
MAX_SUGGESTION_TARGET_PROFILES = 1000
PASTA_ANNOTATION_LEARNING_VERSION = 1


def pasta_annotation_pair_key(left: str, right: str) -> str:
    normalized = sorted(
        {
            normalize_annotation_target(left),
            normalize_annotation_target(right),
        }
    )
    if len(normalized) != 2 or not all(normalized):
        raise ValueError("La coppia deve contenere due termini diversi")
    payload = "|".join(normalized)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def learned_alias_map(documents: Iterable[dict]) -> dict[str, str]:
    aliases = {}
    for document in documents or []:
        if document.get("active") is False:
            continue
        alias = normalize_annotation_target(document.get("alias_normalized") or "")
        canonical = normalize_annotation_target(
            document.get("canonical_normalized") or ""
        )
        if alias and canonical and alias != canonical:
            aliases[alias] = canonical
    return aliases


async def load_pasta_annotation_learning(database) -> dict:
    aliases = await database.lab_pasta_annotation_aliases.find(
        {"active": {"$ne": False}},
        {"_id": 0},
    ).to_list(MAX_LEARNED_ALIASES)
    dismissals = await database.lab_pasta_annotation_dismissals.find(
        {},
        {"_id": 0},
    ).to_list(MAX_DISMISSED_PAIRS)
    aliases.sort(
        key=lambda item: (
            str(item.get("canonical_normalized") or ""),
            str(item.get("alias_normalized") or ""),
        )
    )
    dismissals.sort(
        key=lambda item: (
            str(item.get("left_normalized") or ""),
            str(item.get("right_normalized") or ""),
        )
    )
    return {
        "alias_map": learned_alias_map(aliases),
        "confirmed_aliases": aliases,
        "dismissed_pairs": dismissals,
    }


def _signal_context(signal: dict) -> str:
    action = str(signal.get("code") or "").split(":", 1)[0]
    return f"{signal.get('dimension') or 'unknown'}:{action}"


def _profile_payload(profile: dict) -> dict:
    return {
        "target": profile["target"],
        "count": profile["count"],
        "source_terms": [
            {"value": value, "count": count}
            for value, count in profile["source_terms"].most_common(4)
        ],
        "pasta_counts": dict(profile["pasta_counts"].most_common()),
        "location_counts": dict(profile["location_counts"].most_common()),
        "examples": profile["examples"][:3],
    }


def _target_profiles(signals: Iterable[dict]) -> dict[str, dict]:
    profiles = {}
    for signal in signals or []:
        target = normalize_annotation_target(signal.get("target") or "")
        if len(target) < 3:
            continue
        profile = profiles.setdefault(
            target,
            {
                "target": target,
                "count": 0,
                "contexts": set(),
                "source_terms": Counter(),
                "pasta_counts": Counter(),
                "location_counts": Counter(),
                "examples": [],
                "example_keys": set(),
            },
        )
        profile["count"] += int(signal.get("count") or 0)
        profile["contexts"].add(_signal_context(signal))
        profile["source_terms"].update(
            {
                str(item.get("value") or ""): int(item.get("count") or 0)
                for item in signal.get("source_terms") or []
                if item.get("value")
            }
        )
        profile["pasta_counts"].update(signal.get("pasta_counts") or {})
        profile["location_counts"].update(signal.get("location_counts") or {})
        for example in signal.get("examples") or []:
            key = (
                example.get("order_id"),
                example.get("order_number"),
                example.get("restaurant_id"),
            )
            if key in profile["example_keys"]:
                continue
            profile["example_keys"].add(key)
            profile["examples"].append(example)
    return profiles


def _similarity(left: str, right: str) -> tuple[float, str]:
    sequence = SequenceMatcher(None, left, right).ratio()
    common_prefix = 0
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        common_prefix += 1
    shorter = min(len(left), len(right))
    longer = max(len(left), len(right))
    prefix_coverage = shorter / longer if longer else 0
    is_prefix = common_prefix == shorter

    if sequence >= 0.82:
        return sequence, "Ortografia molto simile"
    if is_prefix and common_prefix >= 4 and prefix_coverage >= 0.45:
        score = max(sequence, min(0.94, 0.76 + prefix_coverage * 0.18))
        return score, "Possibile abbreviazione"
    if common_prefix >= 5 and sequence >= 0.70:
        return sequence, "Possibile refuso"
    return 0, ""


def _preferred_canonical(left: dict, right: dict) -> tuple[str, str]:
    canonicals = annotation_target_canonicals()
    left_fixed = left["target"] in canonicals
    right_fixed = right["target"] in canonicals
    if left_fixed != right_fixed:
        canonical = left["target"] if left_fixed else right["target"]
    elif left["count"] != right["count"]:
        canonical = left["target"] if left["count"] > right["count"] else right["target"]
    elif len(left["target"]) != len(right["target"]):
        canonical = (
            left["target"]
            if len(left["target"]) > len(right["target"])
            else right["target"]
        )
    else:
        canonical = min(left["target"], right["target"])
    alias = right["target"] if canonical == left["target"] else left["target"]
    return canonical, alias


def build_pasta_annotation_suggestions(
    signals: Iterable[dict],
    *,
    dismissed_pair_keys: Iterable[str] = (),
    max_suggestions: int = MAX_SUGGESTIONS,
) -> list[dict]:
    profiles = _target_profiles(signals)
    values = [
        item["target"]
        for item in sorted(
            profiles.values(),
            key=lambda item: (-item["count"], item["target"]),
        )[:MAX_SUGGESTION_TARGET_PROFILES]
    ]
    values.sort()
    dismissed = set(dismissed_pair_keys or [])
    static_canonicals = annotation_target_canonicals()
    suggestions = []

    for left_index, left_target in enumerate(values):
        left = profiles[left_target]
        for right_target in values[left_index + 1 :]:
            right = profiles[right_target]
            shared_contexts = sorted(left["contexts"] & right["contexts"])
            if not shared_contexts:
                continue
            if left_target in static_canonicals and right_target in static_canonicals:
                continue
            pair_key = pasta_annotation_pair_key(left_target, right_target)
            if pair_key in dismissed:
                continue
            score, reason = _similarity(left_target, right_target)
            if not score:
                continue
            canonical, alias = _preferred_canonical(left, right)
            suggestions.append(
                {
                    "id": pair_key,
                    "left": _profile_payload(left),
                    "right": _profile_payload(right),
                    "suggested_canonical": canonical,
                    "suggested_alias": alias,
                    "similarity_percent": round(score * 100),
                    "reason": reason,
                    "shared_contexts": shared_contexts,
                }
            )

    suggestions.sort(
        key=lambda item: (
            -item["similarity_percent"],
            -(item["left"]["count"] + item["right"]["count"]),
            item["suggested_canonical"],
            item["suggested_alias"],
        )
    )
    return suggestions[:max_suggestions]


def _decision_values(data) -> tuple[str, str, str]:
    left = normalize_annotation_target(data.left_target)
    right = normalize_annotation_target(data.right_target)
    if len(left) < 3 or len(right) < 3:
        raise ValueError("I termini devono contenere almeno 3 lettere")
    pair_key = pasta_annotation_pair_key(left, right)
    return left, right, pair_key


async def save_pasta_annotation_decision(database, data, token_data: dict) -> dict:
    left, right, pair_key = _decision_values(data)
    state = await load_pasta_annotation_learning(database)
    aliases = state["alias_map"]
    now = datetime.now(timezone.utc)
    actor = {
        "created_by_id": token_data.get("restaurant_id"),
        "created_by_username": token_data.get("username"),
    }

    if data.decision == "different":
        if canonicalize_annotation_target(left, aliases)[0] == (
            canonicalize_annotation_target(right, aliases)[0]
        ):
            raise ValueError(
                "I termini sono gia uniti da una regola: annullala prima"
            )
        decision_id = str(uuid.uuid4())
        await database.lab_pasta_annotation_dismissals.update_one(
            {"pair_key": pair_key},
            {
                "$set": {
                    "left_normalized": min(left, right),
                    "right_normalized": max(left, right),
                    "learning_version": PASTA_ANNOTATION_LEARNING_VERSION,
                    "updated_at": now,
                    **actor,
                },
                "$setOnInsert": {
                    "id": decision_id,
                    "pair_key": pair_key,
                    "created_at": now,
                },
            },
            upsert=True,
        )
        return {"saved": True, "decision": "different", "pair_key": pair_key}

    canonical = normalize_annotation_target(data.canonical_target or "")
    if canonical not in {left, right}:
        raise ValueError("Il termine principale deve appartenere alla coppia")
    alias = right if canonical == left else left
    resolved_canonical = canonicalize_annotation_target(canonical, aliases)[0]
    static_aliases = annotation_target_alias_map()
    if alias in static_aliases:
        if static_aliases[alias] == resolved_canonical:
            return {"saved": False, "decision": "same", "already_known": True}
        raise ValueError("Una regola fissa non puo essere sovrascritta")
    if alias in annotation_target_canonicals() and alias != resolved_canonical:
        raise ValueError("Un termine principale fisso non puo diventare un alias")
    if alias == resolved_canonical:
        return {"saved": False, "decision": "same", "already_known": True}

    existing = await database.lab_pasta_annotation_aliases.find_one(
        {"alias_normalized": alias},
        {"_id": 0},
    )
    if (
        existing
        and normalize_annotation_target(existing.get("canonical_normalized") or "")
        != resolved_canonical
    ):
        raise ValueError(
            f"{alias} e gia associato a "
            f"{existing.get('canonical_normalized')}"
        )

    decision_id = existing.get("id") if existing else str(uuid.uuid4())
    await database.lab_pasta_annotation_aliases.update_one(
        {"alias_normalized": alias},
        {
            "$set": {
                "canonical_normalized": resolved_canonical,
                "active": True,
                "learning_version": PASTA_ANNOTATION_LEARNING_VERSION,
                "source": "assisted_confirmation",
                "updated_at": now,
                **actor,
            },
            "$setOnInsert": {
                "id": decision_id,
                "alias_normalized": alias,
                "created_at": now,
            },
        },
        upsert=True,
    )
    await database.lab_pasta_annotation_dismissals.delete_one(
        {"pair_key": pair_key}
    )
    return {
        "saved": True,
        "decision": "same",
        "alias": alias,
        "canonical": resolved_canonical,
        "id": decision_id,
    }


async def delete_pasta_annotation_decision(
    database,
    decision_id: str,
) -> dict:
    normalized_id = str(decision_id or "").strip()
    if not normalized_id or len(normalized_id) > 100:
        raise ValueError("Decisione non valida")
    result = await database.lab_pasta_annotation_aliases.delete_one(
        {"id": normalized_id}
    )
    if result.deleted_count:
        return {"deleted": True, "kind": "alias"}
    result = await database.lab_pasta_annotation_dismissals.delete_one(
        {"id": normalized_id}
    )
    if result.deleted_count:
        return {"deleted": True, "kind": "dismissal"}
    raise ValueError("Decisione non trovata")
