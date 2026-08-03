import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.routers import warehouse


class _FakeCursor:
    def __init__(self, docs):
        self.docs = docs
        self.sort_args = None

    def sort(self, *args):
        self.sort_args = args
        return self

    async def to_list(self, length):
        return self.docs[:length]


class _FakeRichieste:
    def __init__(self, docs):
        self.cursor = _FakeCursor(docs)
        self.query = None
        self.projection = None

    def find(self, query, projection):
        self.query = query
        self.projection = projection
        return self.cursor


def test_extra_notes_are_read_only_filtered_and_trimmed(monkeypatch):
    richieste = _FakeRichieste([{
        "id": "request-1",
        "ddt_number": 42,
        "restaurant_location": "Flaminio",
        "created_at": "2026-07-27T08:00:00+00:00",
        "status": "pending",
        "extra_note": "  Due colli fuori catalogo  ",
    }])
    monkeypatch.setattr(
        warehouse,
        "db",
        SimpleNamespace(richieste=richieste),
    )

    result = asyncio.run(warehouse.list_extra_notes(
        "2026-07-27",
        "2026-07-28",
        {"role": "magazzino"},
    ))

    assert result[0]["extra_note"] == "Due colli fuori catalogo"
    assert richieste.query["extra_note"] == {
        "$type": "string",
        "$regex": r"\S",
    }
    assert richieste.query["created_at"]["$gte"].startswith("2026-07-26T22:00:00")
    assert richieste.query["created_at"]["$lt"].startswith("2026-07-28T22:00:00")
    assert set(richieste.projection) == {
        "_id",
        "id",
        "ddt_number",
        "restaurant_location",
        "created_at",
        "status",
        "extra_note",
    }
    assert richieste.cursor.sort_args == ("created_at", -1)


@pytest.mark.parametrize("role", ["restaurant", "supervisor", ""])
def test_extra_notes_rejects_non_warehouse_roles(role):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(warehouse.list_extra_notes(
            "2026-07-27",
            "2026-07-27",
            {"role": role},
        ))
    assert exc.value.status_code == 403


def test_extra_notes_validates_date_range():
    for date_from, date_to in (
        ("27/07/2026", "2026-07-27"),
        ("2026-07-28", "2026-07-27"),
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(warehouse.list_extra_notes(
                date_from,
                date_to,
                {"role": "admin"},
            ))
        assert exc.value.status_code == 400
