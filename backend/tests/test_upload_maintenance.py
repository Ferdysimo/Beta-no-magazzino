import asyncio
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.tasks import maintenance


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, _length):
        return [dict(doc) for doc in self._docs]


class _Collection:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]
        self.deleted_queries = []
        self.updated_queries = []

    def find(self, _query, _projection=None):
        return _Cursor(self.docs)

    async def delete_many(self, query):
        self.deleted_queries.append(query)
        ids = set((query.get("id") or {}).get("$in", []))
        if ids:
            before = len(self.docs)
            self.docs = [doc for doc in self.docs if doc.get("id") not in ids]
            deleted_count = before - len(self.docs)
        else:
            deleted_count = 0
        return type("DeleteResult", (), {"deleted_count": deleted_count})()

    async def update_many(self, query, update):
        self.updated_queries.append((query, update))


class _Database:
    def __init__(self, collections):
        self.collections = collections

    def __getitem__(self, name):
        return self.collections[name]

    def __getattr__(self, name):
        return self.collections[name]


def test_expired_warehouse_load_deletes_row_and_images_but_not_stock_movement(
    monkeypatch, tmp_path
):
    photo = tmp_path / "carico_old.jpg"
    invoice = tmp_path / "fattura_carico_old.jpg"
    photo.write_bytes(b"ddt")
    invoice.write_bytes(b"invoice")

    carichi = _Collection([{
        "id": "load-old",
        "created_at": "2020-01-01T00:00:00+00:00",
        "photo_file": photo.name,
        "fattura_file": invoice.name,
    }])
    stock_movements = _Collection([{
        "id": "movement-1",
        "ref_type": "carico",
        "ref_id": "load-old",
        "cause": "carico",
        "delta": 12,
    }])
    collections = {
        "invoices": _Collection(),
        "versamenti": _Collection(),
        "chiusure": _Collection(),
        "carichi_magazzino": carichi,
        "beverage_carichi": _Collection(),
        "upload_attempts": _Collection(),
        "stock_movements": stock_movements,
    }
    monkeypatch.setattr(maintenance, "db", _Database(collections))
    monkeypatch.setattr(maintenance, "UPLOADS_DIR", tmp_path)

    summary = asyncio.run(maintenance.cleanup_old_uploads(retention_days=90))

    assert summary["carichi_magazzino"] == 1
    assert carichi.docs == []
    assert not photo.exists()
    assert not invoice.exists()
    assert stock_movements.docs == [{
        "id": "movement-1",
        "ref_type": "carico",
        "ref_id": "load-old",
        "cause": "carico",
        "delta": 12,
    }]
    assert stock_movements.deleted_queries == []
    assert stock_movements.updated_queries == []
