import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.services import pasta_annotation_learning
from app.services.pasta_annotation_learning import (
    build_pasta_annotation_suggestions,
    delete_pasta_annotation_decision,
    load_pasta_annotation_learning,
    pasta_annotation_pair_key,
    save_pasta_annotation_decision,
)


class _Result:
    def __init__(self, deleted_count=0):
        self.deleted_count = deleted_count


class _Cursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length):
        return deepcopy(self.documents[:length])


def _matches(document, query):
    for key, expected in (query or {}).items():
        actual = document.get(key)
        if isinstance(expected, dict) and "$ne" in expected:
            if actual == expected["$ne"]:
                return False
        elif actual != expected:
            return False
    return True


class _Collection:
    def __init__(self):
        self.documents = []

    def find(self, query=None, projection=None):
        return _Cursor(
            [item for item in self.documents if _matches(item, query)]
        )

    async def find_one(self, query, projection=None):
        for item in self.documents:
            if _matches(item, query):
                return deepcopy(item)
        return None

    async def update_one(self, query, update, upsert=False):
        target = None
        for item in self.documents:
            if _matches(item, query):
                target = item
                break
        if target is None:
            if not upsert:
                return _Result()
            target = {
                **query,
                **deepcopy(update.get("$setOnInsert") or {}),
            }
            self.documents.append(target)
        target.update(deepcopy(update.get("$set") or {}))
        return _Result()

    async def delete_one(self, query):
        for index, item in enumerate(self.documents):
            if _matches(item, query):
                self.documents.pop(index)
                return _Result(deleted_count=1)
        return _Result()


class _Database:
    def __init__(self):
        self.lab_pasta_annotation_aliases = _Collection()
        self.lab_pasta_annotation_dismissals = _Collection()


def _signal(target, count, *, source, code="without"):
    return {
        "target": target,
        "dimension": "preparation_request",
        "code": f"{code}:{target.lower()}",
        "count": count,
        "source_terms": [{"value": source, "count": count}],
        "pasta_counts": {"CARB": count},
        "location_counts": {"Flaminio": count},
        "examples": [{"order_id": f"{target}-1", "annotation_raw": source}],
    }


def test_suggestions_are_conservative_and_prefer_a_fixed_canonical():
    signals = [
        _signal("GUANCIALE", 40, source="NO GUANCIALE"),
        _signal("GUANCI", 3, source="NO GUANCI"),
        _signal("SALE", 20, source="NO SALE"),
    ]

    suggestions = build_pasta_annotation_suggestions(signals)

    assert len(suggestions) == 1
    suggestion = suggestions[0]
    assert suggestion["suggested_canonical"] == "GUANCIALE"
    assert suggestion["suggested_alias"] == "GUANCI"
    assert suggestion["left"]["count"] + suggestion["right"]["count"] == 43
    assert suggestion["reason"] in {
        "Ortografia molto simile",
        "Possibile abbreviazione",
        "Possibile refuso",
    }


def test_dismissed_pair_is_not_suggested_again():
    signals = [
        _signal("GUANCIALE", 40, source="NO GUANCIALE"),
        _signal("GUANCI", 3, source="NO GUANCI"),
    ]
    pair_key = pasta_annotation_pair_key("GUANCI", "GUANCIALE")

    assert build_pasta_annotation_suggestions(
        signals,
        dismissed_pair_keys={pair_key},
    ) == []


def test_suggestion_generation_bounds_fuzzy_comparisons(monkeypatch):
    calls = 0
    original_similarity = pasta_annotation_learning._similarity

    def counted_similarity(left, right):
        nonlocal calls
        calls += 1
        return original_similarity(left, right)

    monkeypatch.setattr(
        pasta_annotation_learning,
        "_similarity",
        counted_similarity,
    )
    signals = [
        _signal(
            f"GUANCIALEVARIANTE{chr(65 + first)}{chr(65 + second)}",
            1,
            source=f"NO GUANCIALE VARIANTE {first} {second}",
        )
        for first in range(26)
        for second in range(26)
    ]

    build_pasta_annotation_suggestions(signals)

    assert calls < 15000


def test_first_character_typo_remains_a_candidate():
    signals = [
        _signal("GUANCIALE", 40, source="NO GUANCIALE"),
        _signal("HUANCIALE", 2, source="NO HUANCIALE"),
    ]

    suggestions = build_pasta_annotation_suggestions(signals)

    assert len(suggestions) == 1
    assert suggestions[0]["suggested_alias"] == "HUANCIALE"
    assert suggestions[0]["suggested_canonical"] == "GUANCIALE"


def test_same_decision_persists_an_alias_and_can_be_undone():
    async def scenario():
        database = _Database()
        data = SimpleNamespace(
            left_target="GUANCIALE",
            right_target="GUANCI",
            decision="same",
            canonical_target="GUANCIALE",
        )

        saved = await save_pasta_annotation_decision(
            database,
            data,
            {"restaurant_id": "simone-id", "username": "Simone"},
        )
        state = await load_pasta_annotation_learning(database)

        assert saved["alias"] == "GUANCI"
        assert saved["canonical"] == "GUANCIALE"
        assert state["alias_map"] == {"GUANCI": "GUANCIALE"}
        assert state["confirmed_aliases"][0]["created_by_username"] == "Simone"

        deleted = await delete_pasta_annotation_decision(database, saved["id"])
        assert deleted == {"deleted": True, "kind": "alias"}
        assert (await load_pasta_annotation_learning(database))["alias_map"] == {}

    asyncio.run(scenario())


def test_different_decision_is_remembered_and_can_be_undone():
    async def scenario():
        database = _Database()
        data = SimpleNamespace(
            left_target="GUANCIALE",
            right_target="GUANCI",
            decision="different",
            canonical_target=None,
        )

        saved = await save_pasta_annotation_decision(
            database,
            data,
            {"restaurant_id": "simone-id", "username": "Simone"},
        )
        state = await load_pasta_annotation_learning(database)

        assert saved["pair_key"] == pasta_annotation_pair_key(
            "GUANCI",
            "GUANCIALE",
        )
        assert len(state["dismissed_pairs"]) == 1
        deleted = await delete_pasta_annotation_decision(
            database,
            state["dismissed_pairs"][0]["id"],
        )
        assert deleted == {"deleted": True, "kind": "dismissal"}

    asyncio.run(scenario())


def test_fixed_canonical_cannot_be_remapped():
    async def scenario():
        database = _Database()
        data = SimpleNamespace(
            left_target="PEPE",
            right_target="PEPENERO",
            decision="same",
            canonical_target="PEPENERO",
        )

        with pytest.raises(ValueError, match="regola fissa"):
            await save_pasta_annotation_decision(
                database,
                data,
                {"restaurant_id": "simone-id", "username": "Simone"},
            )

    asyncio.run(scenario())
