import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server import _compute_bev_total_eur


def test_beverage_negative_quantities_reduce_total_eur():
    docs = [
        {"sigla": "C", "mattina": "20", "inUsc": "", "scarti": "", "sera": "10"},
        {"sigla": "CZ", "mattina": "", "inUsc": "", "scarti": "", "sera": "10"},
    ]

    assert _compute_bev_total_eur(docs) == 0


def test_beverage_zero_evening_stock_still_means_not_closed():
    docs = [
        {"sigla": "C", "mattina": "10", "inUsc": "", "scarti": "", "sera": "0"},
    ]

    assert _compute_bev_total_eur(docs) == 0


def test_beverage_waste_reduces_total_even_before_evening_count():
    docs = [
        {"sigla": "C", "mattina": "10", "inUsc": "", "scarti": "2", "sera": "0"},
    ]

    assert _compute_bev_total_eur(docs) == -4


def test_beverage_total_uses_restaurant_price_list_when_no_snapshot_exists():
    docs = [
        {"sigla": "C", "mattina": "20", "inUsc": "", "scarti": "", "sera": "10"},
    ]

    assert _compute_bev_total_eur(docs, {"C": 3.25}) == 32.5


def test_beverage_daily_price_snapshot_wins_over_later_price_changes():
    docs = [
        {
            "sigla": "C",
            "mattina": "20",
            "inUsc": "",
            "scarti": "",
            "sera": "10",
            "price_snapshot": 2,
        },
    ]

    assert _compute_bev_total_eur(docs, {"C": 3.25}) == 20
