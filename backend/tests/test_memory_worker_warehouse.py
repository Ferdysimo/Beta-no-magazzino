from datetime import datetime, timezone

from memory_worker.sanitize import sanitize_memory_document
from memory_worker.sources.warehouse import (
    WAREHOUSE_STREAMS,
    normalize_warehouse_record,
)


CAPTURED = datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)
ACTIVATION = datetime(2026, 7, 20, 14, 0, tzinfo=timezone.utc)


def _stream(key: str):
    return next(item for item in WAREHOUSE_STREAMS if item.key == key)


def test_product_baseline_preserves_operational_stock_without_images():
    _, timestamp, fact = normalize_warehouse_record(
        {
            "id": "product-1",
            "name": "Pomodori",
            "unit": "kg",
            "supplier": "Derrate",
            "quantity": 18,
            "created_at": "2026-07-19T12:00:00+00:00",
            "image_file": "product-secret.jpg",
        },
        _stream("warehouse_products"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert timestamp == datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    assert fact["fact_kind"] == "product_state"
    assert fact["stock_quantity"] == 18
    assert fact["baseline_at_epoch"] is True
    assert fact["quality"]["stock_is_operational_balance"] is True

    sanitized = sanitize_memory_document({
        "id": "product-1",
        "image_file": "product-secret.jpg",
    })
    assert "image_file" not in sanitized.document


def test_stock_movement_reconstructs_before_delta_after_and_semantics():
    _, _, fact = normalize_warehouse_record(
        {
            "id": "movement-1",
            "product_id": "product-1",
            "product_name": "Pomodori",
            "delta": -6,
            "balance_after": 12,
            "cause": "evasione",
            "ref_type": "richiesta",
            "ref_id": "request-1",
            "user_id": "warehouse-1",
            "user_name": "Magazziniere",
            "user_role": "magazzino",
            "timestamp": "2026-07-20T14:10:00+00:00",
        },
        _stream("warehouse_stock_movements"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert fact["quantity_before"] == 18
    assert fact["quantity_delta"] == -6
    assert fact["quantity_after"] == 12
    assert fact["movement_meaning"] == "evaso_al_locale"
    assert fact["quality"]["is_real_consumption"] is False
    assert fact["quality"]["logistic_consumption_proxy_eligible"] is True


def test_request_tracks_lifecycle_without_calling_it_real_consumption():
    _, _, fact = normalize_warehouse_record(
        {
            "id": "request-1",
            "ddt_number": 12,
            "restaurant_id": "restaurant-1",
            "restaurant_location": "Flaminio",
            "items": [{
                "product_id": "product-1",
                "product_name": "Pomodori",
                "unit": "kg",
                "supplier": "Derrate",
                "quantity": 6,
            }],
            "status": "confermata",
            "created_at": "2026-07-20T14:05:00+00:00",
            "dispatch_date": "2026-07-21T10:00:00+00:00",
            "evasa_at": "2026-07-20T14:20:00+00:00",
            "confermata_at": "2026-07-20T14:30:00+00:00",
        },
        _stream("warehouse_requests"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert fact["items"][0]["requested_quantity"] == 6
    assert fact["logistics"] == {
        "requested_from_location": True,
        "fulfilled_to_location": True,
        "receipt_confirmed": True,
        "delivery_issue_reported": False,
        "is_real_consumption": False,
    }
    assert fact["quality"]["fulfilled_quantity_assumed_from_request"] is True


def test_structured_load_excludes_document_files_and_keeps_ddt_rows():
    document = {
        "id": "load-1",
        "supplier_name": "Derrate",
        "ddt_number_fornitore": "DDT-42",
        "photo_file": "ddt.jpg",
        "fattura_file": "fattura.jpg",
        "items": [{
            "product_id": "product-1",
            "product_name": "Pomodori",
            "unit": "kg",
            "quantity_added": 25,
        }],
        "created_at": "2026-07-20T14:10:00+00:00",
        "updated_at": "2026-07-20T14:12:00+00:00",
        "created_by_id": "warehouse-1",
    }
    _, _, fact = normalize_warehouse_record(
        document,
        _stream("warehouse_loads"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )
    sanitized = sanitize_memory_document(document)

    assert fact["supplier_ddt_number"] == "DDT-42"
    assert fact["items"][0]["received_quantity"] == 25
    assert fact["movement_meaning"] == "ricevuto_da_fornitore"
    assert fact["quality"]["images_excluded"] is True
    assert "photo_file" not in sanitized.document
    assert "fattura_file" not in sanitized.document


def test_beverage_inventory_and_load_use_units_explicitly():
    _, _, inventory = normalize_warehouse_record(
        {
            "restaurant_id": "restaurant-1",
            "sigla": "B",
            "quantity": -2,
            "updated_at": "2026-07-20T14:10:00+00:00",
        },
        _stream("beverage_inventory"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )
    _, _, load = normalize_warehouse_record(
        {
            "id": "beverage-load-1",
            "restaurant_id": "restaurant-1",
            "supplier": "Gioia",
            "invoice_file": "invoice.jpg",
            "invoice_url": "/api/uploads/invoice.jpg",
            "items": [{
                "sigla": "B",
                "cases": 2,
                "units": 48,
                "quantity": 2,
            }],
            "units_per_case": 24,
            "created_at": "2026-07-20T14:10:00+00:00",
            "created_by": "restaurant-1",
        },
        _stream("beverage_loads"),
        captured_at=CAPTURED,
        activation_epoch=ACTIVATION,
    )

    assert inventory["quantity_units"] == -2
    assert inventory["quality"]["operational_balance_can_be_negative"] is True
    assert load["items"][0] == {
        "beverage_code": "B",
        "received_cases": 2,
        "received_units": 48,
        "units_per_case": 24,
        "units_match_cases": True,
    }


def test_warehouse_streams_cover_all_requested_logistics_sources():
    assert {stream.collection for stream in WAREHOUSE_STREAMS} == {
        "products",
        "stock_movements",
        "richieste",
        "carichi_magazzino",
        "beverage_inventory",
        "beverage_carichi",
    }
    assert next(
        item for item in WAREHOUSE_STREAMS
        if item.key == "warehouse_stock_movements"
    ).stateful is False
