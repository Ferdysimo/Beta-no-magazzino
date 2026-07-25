import hashlib
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from typing import Iterable, Optional

ANNOTATION_PARSER_VERSION = 3
ANNOTATION_RULESET_VERSION = 2
PAGER_GROUPING_RULE_VERSION = 1
PAGER_GROUP_MAX_GAP_SECONDS = 90
PAGER_GROUP_MAX_ORDER_GAP = 8

_LEADING_SEPARATOR = re.compile(r"^[\s\-:;,/|#\u00b0\u00ba]+")
_TRAILING_SEPARATOR = re.compile(r"[\s\-:;,/|#\u00b0\u00ba]+$")
_EXPLICIT_PAGER = re.compile(
    r"(?<!\w)(?:PAGER|DISCHETTO|DISCO)\s*"
    r"(?:N(?:UM(?:ERO)?)?|NR)?\s*[\u00b0\u00ba#.:/\-]*\s*"
    r"(?P<number>\d+)(?!\w)",
    re.IGNORECASE,
)
_NUMBERED_PAGER = re.compile(
    r"(?<!\w)(?:N(?:UM(?:ERO)?)?|NR)\s*"
    r"[\u00b0\u00ba#.:/\-]+\s*(?P<number>\d+)(?!\w)",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*(?:\s*[xX])?")
_INTEGER = re.compile(r"(?<![\w.,])\d{1,4}(?![\w.,])")
_WORD = re.compile(r"[A-Z]+")

_QUANTITY_FOLLOWERS = {
    "BIC",
    "BICC",
    "BICCH",
    "BICCHIERE",
    "BICCHIERI",
    "BUSTA",
    "BUSTE",
    "COCA",
    "COLA",
    "FORC",
    "FORCH",
    "FORCHETTA",
    "FORCHETTE",
    "TOV",
    "TOVAGLIOLO",
    "TOVAGLIOLI",
}
_NON_PAGER_NUMBER_CONTEXT = {"TAV", "TAVOLO"}

_STATIC_SIGNAL_RULES = (
    {
        "rule_id": "service.take_away",
        "aliases": (("TAKE", "AWAY"), ("AS", "PORTO"), ("ASPORTO",), ("TA",)),
        "dimension": "service_mode",
        "code": "take_away",
        "label": "Take away",
        "certainty": "confirmed",
    },
    {
        "rule_id": "container.cardboard_bowl",
        "aliases": (("C",),),
        "dimension": "serving_container",
        "code": "cardboard_bowl",
        "label": "Ciotola di cartone",
        "certainty": "confirmed",
    },
    {
        "rule_id": "coordination.solo_customer",
        "aliases": (("S",),),
        "dimension": "kitchen_coordination",
        "code": "solo_customer",
        "label": "Cliente da solo",
        "certainty": "confirmed",
    },
    {
        "rule_id": "dining.outdoor",
        "aliases": (("F",),),
        "dimension": "dining_area",
        "code": "outdoor",
        "label": "Tavoli fuori",
        "certainty": "confirmed",
    },
    {
        "rule_id": "packaging.lid_only",
        "aliases": (("CHIUSA",),),
        "dimension": "packaging",
        "code": "lid_only_no_bag",
        "label": "Chiusa, senza busta",
        "certainty": "confirmed",
    },
    {
        "rule_id": "format.rig",
        "aliases": (("RIG",),),
        "dimension": "pasta_format",
        "code": "rig",
        "label": "RIG",
        "certainty": "observed_code",
    },
)

_ACTION_WORDS = {
    "ALLERG",
    "ALLERGIA",
    "ALLERGICA",
    "ALLERGICO",
    "ALLERGIE",
    "BEN",
    "NO",
    "PIU",
    "POCO",
    "POCHISSIMO",
    "SENZA",
}
_ALLERGY_WORDS = {
    "ALLERG",
    "ALLERGIA",
    "ALLERGICA",
    "ALLERGICO",
    "ALLERGIE",
}
_WELL_DONE_WORDS = {"COTTA", "COTTO", "COTTE", "COTTI"}

_TARGET_ALIAS_RULES = (
    {
        "rule_id": "target.guanciale",
        "canonical": "GUANCIALE",
        "aliases": (
            "GUANCIALE",
            "GUANC",
            "GUAN",
            "GUIANCIEL",
            "GUANVIAALE",
        ),
    },
    {
        "rule_id": "target.pepe",
        "canonical": "PEPE",
        "aliases": ("PEPE", "PEP", "PEPPE"),
    },
    {
        "rule_id": "target.mantecatura",
        "canonical": "MANTECATURA",
        "aliases": (
            "MANTECATURA",
            "MANTECATA",
            "MANTECAT",
            "MANTEC",
            "MANT",
        ),
    },
    {
        "rule_id": "target.parmigiano",
        "canonical": "PARMIGIANO",
        "aliases": ("PARMIGIANO", "PARMIGGIANO", "PARM"),
    },
    {
        "rule_id": "target.pecorino",
        "canonical": "PECORINO",
        "aliases": ("PECORINO", "PEC"),
    },
    {
        "rule_id": "target.formaggio",
        "canonical": "FORMAGGIO",
        "aliases": ("FORMAGGIO", "FORM", "FORAGGIO", "CHEESE"),
    },
    {
        "rule_id": "target.maiale",
        "canonical": "MAIALE",
        "aliases": ("MAIALE", "PORK", "PORKO", "POK", "PORCK"),
    },
    {
        "rule_id": "target.uovo",
        "canonical": "UOVO",
        "aliases": ("UOVO", "UOVA"),
    },
    {
        "rule_id": "target.latte",
        "canonical": "LATTE",
        "aliases": ("LATTE", "MILK"),
    },
)
_TARGET_ALIAS_INDEX = {
    alias: rule
    for rule in _TARGET_ALIAS_RULES
    for alias in rule["aliases"]
}


def _ascii_upper(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    return normalized.encode("ascii", "ignore").decode("ascii").upper()


def clean_annotation_text(value: str) -> str:
    """Remove pager/quantity numbers while preserving meaningful source text."""
    cleaned = str(value or "").strip()
    cleaned = _EXPLICIT_PAGER.sub(" ", cleaned)
    cleaned = _NUMBERED_PAGER.sub(" ", cleaned)
    cleaned = _NUMBER.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = _LEADING_SEPARATOR.sub("", cleaned)
    cleaned = _TRAILING_SEPARATOR.sub("", cleaned).strip()
    if not any(character.isalpha() for character in cleaned):
        return ""
    return cleaned


def normalize_annotation_text(value: str) -> str:
    """Normalize presentation only; spelling and meaning stay untouched."""
    return clean_annotation_text(value).upper()


def recognize_pasta_sigla(
    description: str,
    pasta_codes: Iterable[str],
) -> Optional[str]:
    """Mirror the strict operational recognition rule for isolated consumers."""
    raw = str(description or "")
    upper = raw.upper()
    if re.search(r"\bXL\b", upper):
        return None
    codes = sorted(
        {str(code).strip().upper() for code in pasta_codes if str(code).strip()},
        key=len,
        reverse=True,
    )
    for code in codes:
        pattern = rf"^\s*(?:\d+\s+)?{re.escape(code)}(?:\b|$)"
        if re.search(pattern, upper):
            return code
    return None


def _description_tail(description: str, pasta_sigla: str) -> Optional[str]:
    pattern = re.compile(
        rf"^\s*(?:\d+\s+)?{re.escape(pasta_sigla)}(?:\b|$)",
        re.IGNORECASE,
    )
    match = pattern.search(str(description or ""))
    if not match:
        return None
    return _LEADING_SEPARATOR.sub(
        "",
        str(description or "")[match.end() :].strip(),
    ).strip()


def _number_observations(source: str) -> tuple[Optional[dict], list[dict]]:
    source_text = str(source or "")
    matches = list(_INTEGER.finditer(source_text))
    observations = [
        {
            "value": int(match.group(0)),
            "raw": match.group(0),
            "position": match.start(),
            "role": "unclassified_number",
        }
        for match in matches
    ]
    if not matches:
        return None, observations

    explicit_spans = []
    for pattern in (_EXPLICIT_PAGER, _NUMBERED_PAGER):
        for match in pattern.finditer(source_text):
            explicit_spans.append((match.span("number"), match))

    pager_index = None
    detection = None
    confidence = None
    if explicit_spans:
        explicit_span, _ = sorted(explicit_spans, key=lambda item: item[0][0])[0]
        for index, match in enumerate(matches):
            if match.span() == explicit_span:
                pager_index = index
                detection = "explicit_marker"
                confidence = "high"
                break

    if pager_index is None:
        terminal_candidates = []
        for index, match in enumerate(matches):
            trailing = source_text[match.end() :]
            preceding_words = _WORD.findall(_ascii_upper(source_text[: match.start()]))
            preceding_word = preceding_words[-1] if preceding_words else ""
            is_contextual_number = preceding_word in (
                _QUANTITY_FOLLOWERS | _NON_PAGER_NUMBER_CONTEXT
            )
            if (
                not is_contextual_number
                and not _TRAILING_SEPARATOR.sub("", trailing).strip()
            ):
                terminal_candidates.append(index)
        if terminal_candidates:
            candidate = terminal_candidates[-1]
            value = observations[candidate]["value"]
            if 1 <= value <= 99:
                pager_index = candidate
                detection = "terminal_number"
                confidence = "high"

    if pager_index is None:
        alpha_without_markers = _EXPLICIT_PAGER.sub(" ", source_text)
        alpha_without_markers = _NUMBERED_PAGER.sub(" ", alpha_without_markers)
        alpha_without_numbers = _NUMBER.sub(" ", alpha_without_markers)
        if not any(character.isalpha() for character in alpha_without_numbers):
            candidate = len(matches) - 1
            value = observations[candidate]["value"]
            if 1 <= value <= 99:
                pager_index = candidate
                detection = "numeric_only"
                confidence = "high"

    for index, match in enumerate(matches):
        if index == pager_index:
            observations[index]["role"] = "pager"
            continue
        preceding_words = _WORD.findall(_ascii_upper(source_text[: match.start()]))
        preceding_word = preceding_words[-1] if preceding_words else ""
        following = _ascii_upper(source_text[match.end() :]).lstrip(" -:;,/|#")
        following_word = _WORD.match(following)
        if preceding_word in _QUANTITY_FOLLOWERS or (
            following_word and following_word.group(0) in _QUANTITY_FOLLOWERS
        ):
            observations[index]["role"] = "quantity"
        elif preceding_word in _NON_PAGER_NUMBER_CONTEXT:
            observations[index]["role"] = "context_number"
        elif 1 <= observations[index]["value"] <= 99:
            observations[index]["role"] = "pager_or_quantity_candidate"

    if pager_index is None:
        return None, observations
    selected = observations[pager_index]
    return {
        "value": selected["value"],
        "detection": detection,
        "confidence": confidence,
        "grouping_eligible": confidence == "high",
    }, observations


def _signal(
    *,
    dimension: str,
    code: str,
    label: str,
    certainty: str,
    rule_id: str,
    source: str,
    target: Optional[str] = None,
) -> dict:
    result = {
        "dimension": dimension,
        "code": code,
        "label": label,
        "certainty": certainty,
        "rule_id": rule_id,
        "source": source,
    }
    if target:
        result["target"] = target
    return result


def semantic_signal_key(signal: dict) -> str:
    return f"{signal.get('dimension', '')}:{signal.get('code', '')}"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", _ascii_upper(value).lower()).strip("_")


def normalize_annotation_target(value: str) -> str:
    return " ".join(_WORD.findall(_ascii_upper(value)))


def annotation_target_alias_map() -> dict[str, str]:
    return {
        alias: rule["canonical"]
        for alias, rule in _TARGET_ALIAS_INDEX.items()
    }


def annotation_target_canonicals() -> set[str]:
    return {rule["canonical"] for rule in _TARGET_ALIAS_RULES}


def canonicalize_annotation_target(
    value: str,
    target_aliases: Optional[dict[str, str]] = None,
) -> tuple[str, Optional[str]]:
    normalized = normalize_annotation_target(value)
    current = normalized
    seen = set()
    learned = False

    while current:
        if current in seen:
            return normalized, None
        seen.add(current)
        static_rule = _TARGET_ALIAS_INDEX.get(current)
        if static_rule is not None:
            return static_rule["canonical"], (
                f"target.learned.{_slug(normalized)}"
                if learned
                else static_rule["rule_id"]
            )
        next_target = normalize_annotation_target(
            (target_aliases or {}).get(current) or ""
        )
        if not next_target:
            break
        current = next_target
        learned = True

    return current or normalized, (
        f"target.learned.{_slug(normalized)}" if learned else None
    )


def _target_tokens(
    tokens: list[str],
    consumed: list[bool],
    start: int,
    *,
    maximum: int = 3,
) -> list[int]:
    indexes = []
    for index in range(start, min(len(tokens), start + maximum)):
        if consumed[index] or tokens[index] in _ACTION_WORDS:
            break
        indexes.append(index)
    return indexes


def _semantic_signals(
    annotation_text: str,
    target_aliases: Optional[dict[str, str]] = None,
) -> tuple[list[dict], list[str], list[str]]:
    tokens = _WORD.findall(_ascii_upper(annotation_text))
    consumed = [False] * len(tokens)
    signals = []

    for rule in _STATIC_SIGNAL_RULES:
        aliases = sorted(rule["aliases"], key=len, reverse=True)
        for index in range(len(tokens)):
            if consumed[index]:
                continue
            for alias in aliases:
                end = index + len(alias)
                if end > len(tokens) or any(consumed[index:end]):
                    continue
                if tuple(tokens[index:end]) != alias:
                    continue
                signals.append(
                    _signal(
                        dimension=rule["dimension"],
                        code=rule["code"],
                        label=rule["label"],
                        certainty=rule["certainty"],
                        rule_id=rule["rule_id"],
                        source=" ".join(alias),
                    )
                )
                consumed[index:end] = [True] * len(alias)
                break

    for index, token in enumerate(tokens):
        if consumed[index]:
            continue
        target_indexes = _target_tokens(
            tokens,
            consumed,
            index + 1,
            maximum=3 if token in _ALLERGY_WORDS else 1,
        )
        target = " ".join(tokens[item] for item in target_indexes)

        if token in _ALLERGY_WORDS:
            consumed[index] = True
            for item in target_indexes:
                consumed[item] = True
            canonical_target, target_rule_id = canonicalize_annotation_target(
                target,
                target_aliases,
            )
            code = (
                f"allergy_declared:{_slug(canonical_target)}"
                if canonical_target
                else "allergy_declared"
            )
            signal = _signal(
                dimension="safety_note",
                code=code,
                label=(
                    f"Allergia dichiarata: {canonical_target}"
                    if canonical_target
                    else "Allergia dichiarata"
                ),
                certainty="literal",
                rule_id="request.allergy_declared",
                source=" ".join([token, target]).strip(),
                target=canonical_target or None,
            )
            if target_rule_id and target != canonical_target:
                signal["target_source"] = target
                signal["target_rule_id"] = target_rule_id
            signals.append(signal)
            continue

        if token in {"NO", "SENZA"} and target:
            consumed[index] = True
            for item in target_indexes:
                consumed[item] = True
            canonical_target, target_rule_id = canonicalize_annotation_target(
                target,
                target_aliases,
            )
            signal = _signal(
                dimension="preparation_request",
                code=f"without:{_slug(canonical_target)}",
                label=f"Senza {canonical_target}",
                certainty="literal",
                rule_id="request.without",
                source=f"{token} {target}",
                target=canonical_target,
            )
            if target_rule_id and target != canonical_target:
                signal["target_source"] = target
                signal["target_rule_id"] = target_rule_id
            signals.append(signal)
            continue

        if token in {"POCO", "POCHISSIMO"} and target:
            consumed[index] = True
            for item in target_indexes:
                consumed[item] = True
            canonical_target, target_rule_id = canonicalize_annotation_target(
                target,
                target_aliases,
            )
            signal = _signal(
                dimension="preparation_request",
                code=f"less:{_slug(canonical_target)}",
                label=f"Poco {canonical_target}",
                certainty="literal",
                rule_id="request.less",
                source=f"{token} {target}",
                target=canonical_target,
            )
            if target_rule_id and target != canonical_target:
                signal["target_source"] = target
                signal["target_rule_id"] = target_rule_id
            signals.append(signal)
            continue

        if token == "PIU" and target:
            consumed[index] = True
            for item in target_indexes:
                consumed[item] = True
            canonical_target, target_rule_id = canonicalize_annotation_target(
                target,
                target_aliases,
            )
            signal = _signal(
                dimension="preparation_request",
                code=f"more:{_slug(canonical_target)}",
                label=f"Piu {canonical_target}",
                certainty="literal",
                rule_id="request.more",
                source=f"PIU {target}",
                target=canonical_target,
            )
            if target_rule_id and target != canonical_target:
                signal["target_source"] = target
                signal["target_rule_id"] = target_rule_id
            signals.append(signal)
            continue

        if (
            token == "BEN"
            and target_indexes
            and tokens[target_indexes[0]] in _WELL_DONE_WORDS
        ):
            cooked_index = target_indexes[0]
            consumed[index] = True
            consumed[cooked_index] = True
            signals.append(
                _signal(
                    dimension="cooking_request",
                    code="well_done",
                    label="Ben cotta",
                    certainty="literal",
                    rule_id="request.well_done",
                    source=f"BEN {tokens[cooked_index]}",
                )
            )

    unique = {}
    for item in signals:
        key = semantic_signal_key(item)
        existing = unique.get(key)
        if existing is None:
            unique[key] = {**item, "source_terms": [item["source"]]}
        elif item["source"] not in existing["source_terms"]:
            existing["source_terms"].append(item["source"])

    unknown_fragments = []
    current = []
    for index, token in enumerate(tokens):
        if consumed[index]:
            if current:
                unknown_fragments.append(" ".join(current))
                current = []
        else:
            current.append(token)
    if current:
        unknown_fragments.append(" ".join(current))
    unknown_tokens = [
        token for index, token in enumerate(tokens) if not consumed[index]
    ]
    return list(unique.values()), unknown_fragments, unknown_tokens


def parse_recognized_pasta_annotation(
    description: str,
    pasta_sigla: str,
    *,
    target_aliases: Optional[dict[str, str]] = None,
) -> Optional[dict]:
    source = _description_tail(description, pasta_sigla)
    if source is None:
        return None
    annotation_raw = clean_annotation_text(source)
    annotation_normalized = normalize_annotation_text(annotation_raw)
    pager, numbers = _number_observations(source)
    signals, unknown_fragments, unknown_tokens = _semantic_signals(
        annotation_normalized,
        target_aliases,
    )
    if not annotation_normalized:
        semantic_status = "no_text"
    elif signals and not unknown_tokens:
        semantic_status = "classified"
    elif signals:
        semantic_status = "partial"
    else:
        semantic_status = "unclassified"
    return {
        "pasta_sigla": str(pasta_sigla).upper(),
        "annotation_source_raw": source,
        "annotation_raw": annotation_raw,
        "annotation_normalized": annotation_normalized,
        "parser_version": ANNOTATION_PARSER_VERSION,
        "ruleset_version": ANNOTATION_RULESET_VERSION,
        "pager": pager,
        "numbers": numbers,
        "signals": signals,
        "unknown_fragments": unknown_fragments,
        "unknown_tokens": unknown_tokens,
        "semantic_status": semantic_status,
    }


def extract_pasta_annotation(
    description: str,
    pasta_codes: Iterable[str],
    *,
    target_aliases: Optional[dict[str, str]] = None,
) -> Optional[dict]:
    recognized = recognize_pasta_sigla(description, pasta_codes)
    if recognized is None:
        return None
    return parse_recognized_pasta_annotation(
        description,
        recognized,
        target_aliases=target_aliases,
    )


def annotation_rule_manifest() -> dict:
    return {
        "parser_version": ANNOTATION_PARSER_VERSION,
        "ruleset_version": ANNOTATION_RULESET_VERSION,
        "pager_grouping_rule_version": PAGER_GROUPING_RULE_VERSION,
        "pager_grouping": {
            "same_restaurant": True,
            "same_business_date": True,
            "same_pager": True,
            "max_adjacent_gap_seconds": PAGER_GROUP_MAX_GAP_SECONDS,
            "max_adjacent_order_gap": PAGER_GROUP_MAX_ORDER_GAP,
            "authoritative": False,
        },
        "static_signals": [
            {
                "rule_id": rule["rule_id"],
                "aliases": [" ".join(alias) for alias in rule["aliases"]],
                "dimension": rule["dimension"],
                "code": rule["code"],
                "label": rule["label"],
                "certainty": rule["certainty"],
            }
            for rule in _STATIC_SIGNAL_RULES
        ],
        "dynamic_rules": [
            "allergy_declared",
            "without",
            "less",
            "more",
            "well_done",
        ],
        "target_aliases": [
            {
                "rule_id": rule["rule_id"],
                "canonical": rule["canonical"],
                "aliases": list(rule["aliases"]),
            }
            for rule in _TARGET_ALIAS_RULES
        ],
        "unknown_tokens_preserved": True,
        "source_text_preserved": True,
    }


def _coerce_datetime(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_order_number(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def reconstruct_probable_pager_groups(
    observations: Iterable[dict],
    *,
    max_examples: int = 8,
) -> dict:
    eligible = []
    invalid_timestamp_count = 0
    for observation in observations:
        annotation = observation.get("annotation") or {}
        pager = annotation.get("pager") or {}
        if not pager.get("grouping_eligible"):
            continue
        occurred_at = _coerce_datetime(
            observation.get("occurred_at") or observation.get("created_at")
        )
        if occurred_at is None:
            invalid_timestamp_count += 1
            continue
        eligible.append(
            {
                **observation,
                "_occurred_at": occurred_at,
                "_order_number": _coerce_order_number(observation.get("order_number")),
                "_pager_value": pager.get("value"),
            }
        )

    eligible.sort(
        key=lambda item: (
            str(item.get("restaurant_id") or ""),
            str(item.get("business_date") or ""),
            int(item.get("_pager_value") or 0),
            item["_occurred_at"],
            item.get("_order_number") if item.get("_order_number") is not None else -1,
        )
    )

    groups = []
    current = []
    current_key = None
    for item in eligible:
        key = (
            str(item.get("restaurant_id") or ""),
            str(item.get("business_date") or ""),
            item.get("_pager_value"),
        )
        should_split = key != current_key or not current
        if not should_split:
            previous = current[-1]
            time_gap = (item["_occurred_at"] - previous["_occurred_at"]).total_seconds()
            previous_number = previous.get("_order_number")
            current_number = item.get("_order_number")
            number_close = (
                previous_number is not None
                and current_number is not None
                and 0 <= current_number - previous_number <= PAGER_GROUP_MAX_ORDER_GAP
            )
            should_split = not (
                0 <= time_gap <= PAGER_GROUP_MAX_GAP_SECONDS and number_close
            )
        if should_split:
            if current:
                groups.append(current)
            current = [item]
            current_key = key
        else:
            current.append(item)
    if current:
        groups.append(current)

    signal_group_counts = Counter()
    confidence_counts = Counter()
    examples = []
    multi_rows = 0
    for group in groups:
        if len(group) == 1:
            confidence = "single_row"
        else:
            gaps = [
                (
                    group[index]["_occurred_at"] - group[index - 1]["_occurred_at"]
                ).total_seconds()
                for index in range(1, len(group))
            ]
            order_gaps = [
                group[index]["_order_number"] - group[index - 1]["_order_number"]
                for index in range(1, len(group))
            ]
            confidence = (
                "high" if max(gaps) <= 30 and max(order_gaps) <= 3 else "medium"
            )
            multi_rows += len(group)
        confidence_counts[confidence] += 1
        group_signal_keys = {
            semantic_signal_key(signal)
            for item in group
            for signal in (item.get("annotation") or {}).get("signals") or []
        }
        signal_group_counts.update(group_signal_keys)

        if len(group) > 1 and len(examples) < max_examples:
            first = group[0]
            stable_seed = "|".join(
                [
                    str(first.get("restaurant_id") or ""),
                    str(first.get("business_date") or ""),
                    str(first.get("_pager_value") or ""),
                    first["_occurred_at"].isoformat(),
                ]
            )
            pasta_counts = Counter(str(item.get("pasta_sigla") or "") for item in group)
            examples.append(
                {
                    "group_id": hashlib.sha256(stable_seed.encode("utf-8")).hexdigest()[
                        :16
                    ],
                    "restaurant_id": first.get("restaurant_id"),
                    "location": first.get("location") or first.get("restaurant_id"),
                    "business_date": first.get("business_date"),
                    "pager": first.get("_pager_value"),
                    "first_at": first["_occurred_at"].isoformat(),
                    "last_at": group[-1]["_occurred_at"].isoformat(),
                    "row_count": len(group),
                    "pasta_counts": dict(sorted(pasta_counts.items())),
                    "order_numbers": [item.get("order_number") for item in group],
                    "annotations": [
                        (item.get("annotation") or {}).get("annotation_normalized")
                        or ""
                        for item in group
                    ],
                    "confidence": confidence,
                }
            )

    examples.sort(key=lambda item: item["first_at"], reverse=True)
    group_count = len(groups)
    return {
        "rule_version": PAGER_GROUPING_RULE_VERSION,
        "max_adjacent_gap_seconds": PAGER_GROUP_MAX_GAP_SECONDS,
        "max_adjacent_order_gap": PAGER_GROUP_MAX_ORDER_GAP,
        "authoritative": False,
        "pager_linked_rows": len(eligible),
        "invalid_timestamp_rows": invalid_timestamp_count,
        "reconstructed_group_count": group_count,
        "multi_pasta_group_count": sum(1 for group in groups if len(group) > 1),
        "pasta_rows_in_multi_groups": multi_rows,
        "average_rows_per_group": (
            round(len(eligible) / group_count, 2) if group_count else 0
        ),
        "confidence_counts": dict(sorted(confidence_counts.items())),
        "signal_group_counts": dict(sorted(signal_group_counts.items())),
        "examples": examples,
    }
