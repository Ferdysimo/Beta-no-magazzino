import asyncio

from app.schemas import DocumentScanFeedback
from app.services.document_scanner import (
    DOCUMENT_SCANNER_VERSION,
    build_document_scan_draft,
    normalize_scanner_text,
    parse_document_decimal,
    save_document_scan_feedback,
)


SUPPLIERS = [{"id": "supplier-1", "name": "Roma Forniture SRL"}]
PRODUCTS = [
    {
        "id": "product-1",
        "name": "Pomodori pelati",
        "supplier": "Roma Forniture SRL",
        "unit": "pz",
    },
    {
        "id": "product-2",
        "name": "Olio EVO",
        "supplier": "Roma Forniture SRL",
        "unit": "lt",
    },
]


def test_document_scanner_extracts_only_values_printed_on_document():
    draft = build_document_scan_draft(
        """
        ROMA FORNITURE SRL
        FATTURA N. 123/A
        DATA 19/07/2026
        POMODORI PELATI 10 1,20 12,00
        OLIO EVO 2 7,50 15,00
        TOTALE DOCUMENTO 27,00
        """,
        suppliers=SUPPLIERS,
        products=PRODUCTS,
        aliases=[],
        ocr_confidence=91.4,
        file_name="fattura.jpg",
        file_fingerprint="abc",
    )

    assert draft["scanner_version"] == DOCUMENT_SCANNER_VERSION
    assert draft["document"] == {
        "type": "invoice",
        "supplier_id": "supplier-1",
        "supplier_name": "Roma Forniture SRL",
        "supplier_confidence": 98,
        "supplier_source_text": "ROMA FORNITURE SRL",
        "supplier_candidates": [{
            "id": "supplier-1",
            "name": "Roma Forniture SRL",
            "confidence": 98,
            "source_text": "ROMA FORNITURE SRL",
        }],
        "number": "123/A",
        "number_source_text": "FATTURA N. 123/A",
        "date": "2026-07-19",
        "total": 27.0,
        "total_source_text": "TOTALE DOCUMENTO 27,00",
    }
    assert [
        (
            row["product_id"],
            row["quantity"],
            row["unit_price"],
            row["line_total"],
        )
        for row in draft["rows"]
    ] == [
        ("product-1", 10.0, 1.2, 12.0),
        ("product-2", 2.0, 7.5, 15.0),
    ]


def test_missing_price_stays_missing_even_when_alias_has_an_old_price():
    draft = build_document_scan_draft(
        "FORNITURE ROMANE\nPOMODORI SCATOLA 4 PZ",
        suppliers=SUPPLIERS,
        products=PRODUCTS,
        aliases=[
            {
                "kind": "supplier",
                "source_normalized": "FORNITURE ROMANE",
                "target_id": "supplier-1",
            },
            {
                "kind": "product",
                "source_normalized": "POMODORI SCATOLA",
                "target_id": "product-1",
                "supplier_name": "Roma Forniture SRL",
                "last_observed_unit_price": 99.0,
            },
        ],
    )

    assert draft["document"]["supplier_id"] == "supplier-1"
    assert draft["rows"][0]["product_id"] == "product-1"
    assert draft["rows"][0]["quantity"] == 4.0
    assert draft["rows"][0]["unit_price"] is None
    assert draft["rows"][0]["line_total"] is None


def test_document_decimal_supports_italian_and_international_notation():
    assert parse_document_decimal("1.234,56") == 1234.56
    assert parse_document_decimal("1,234.56") == 1234.56
    assert parse_document_decimal("132,00 EUR") == 132.0
    assert parse_document_decimal("") is None


def test_scanner_normalization_is_stable_for_learned_aliases():
    assert normalize_scanner_text("  Caffè d'orzo - 1kg ") == "CAFFE D ORZO 1KG"


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, _length):
        return [dict(item) for item in self.docs]


class _Collection:
    def __init__(self, docs=None):
        self.docs = [dict(item) for item in (docs or [])]

    async def find_one(self, query, projection=None):
        for item in self.docs:
            if _matches(item, query):
                return _project(item, projection)
        return None

    def find(self, query, projection=None):
        return _Cursor([
            _project(item, projection)
            for item in self.docs
            if _matches(item, query)
        ])

    async def insert_one(self, document):
        self.docs.append(dict(document))

    async def update_one(self, query, update, upsert=False):
        target = next((item for item in self.docs if _matches(item, query)), None)
        if target is None and upsert:
            target = dict(query)
            target.update(update.get("$setOnInsert", {}))
            self.docs.append(target)
        if target is None:
            return
        target.update(update.get("$set", {}))
        for key, value in update.get("$addToSet", {}).items():
            target.setdefault(key, [])
            if value not in target[key]:
                target[key].append(value)


def _matches(item, query):
    for key, expected in query.items():
        actual = item.get(key)
        if isinstance(expected, dict) and "$in" in expected:
            if actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


def _project(item, projection):
    if not projection:
        return dict(item)
    return {
        key: value
        for key, value in item.items()
        if key != "_id" and projection.get(key)
    }


class _Database:
    def __init__(self):
        self.suppliers = _Collection(SUPPLIERS)
        self.products = _Collection(PRODUCTS)
        self.lab_document_scan_feedback = _Collection()
        self.lab_document_aliases = _Collection()


def test_confirmed_feedback_stores_minimal_learning_data_and_is_idempotent():
    database = _Database()
    feedback = DocumentScanFeedback(
        scan_id="scan-1",
        ocr_text_sha256="a" * 64,
        file_fingerprint="b" * 64,
        ocr_confidence=88,
        document_type="ddt",
        supplier_id="supplier-1",
        supplier_source_text="R0MA F0RNITURE SRL",
        document_number="77",
        document_date="2026-07-20",
        document_total=12,
        rows=[{
            "source_text": "POMOD0RI PELATI 10 1,20 12,00",
            "source_description": "POMOD0RI PELATI",
            "product_id": "product-1",
            "quantity": 10,
            "unit_price": 1.2,
            "line_total": 12,
        }],
    )

    async def exercise():
        first = await save_document_scan_feedback(
            database,
            feedback,
            {"restaurant_id": "simone", "username": "Simone"},
        )
        second = await save_document_scan_feedback(
            database,
            feedback,
            {"restaurant_id": "simone", "username": "Simone"},
        )
        return first, second

    first, second = asyncio.run(exercise())
    stored = database.lab_document_scan_feedback.docs[0]

    assert first["already_recorded"] is False
    assert second["already_recorded"] is True
    assert "ocr_text" not in stored
    assert "image" not in stored
    assert stored["learning_applied"] is True
    assert len(database.lab_document_aliases.docs) == 2
    assert all(
        alias["confirmed_scan_ids"] == ["scan-1"]
        for alias in database.lab_document_aliases.docs
    )
