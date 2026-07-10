import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server import (
    _compute_cash_sera_full,
    _compute_cash_sera_full_legacy_manual_prices,
    _compute_paste_total_eur,
    _compute_paste_unrecognized,
)


PASTA_DICT = {"CARB": 8, "AMAT": 8}
PASTE_TEXT = "1 CARB\n2 X UNKNOWN\n3 AMAT"


def test_paste_total_uses_normalized_line_key_for_manual_prices():
    manual_prices = {"2 X UNKNOWN": "5"}

    assert _compute_paste_total_eur(PASTE_TEXT, manual_prices, PASTA_DICT) == 21


def test_paste_total_keeps_legacy_index_fallback_for_manual_prices():
    manual_prices = {"1": "5"}

    assert _compute_paste_total_eur(PASTE_TEXT, manual_prices, PASTA_DICT) == 21


def test_unrecognized_paste_reports_manual_price_from_normalized_line_key():
    manual_prices = {"2 X UNKNOWN": "5"}

    rows = _compute_paste_unrecognized(PASTE_TEXT, manual_prices, PASTA_DICT)

    assert rows == [{"idx": 1, "text": "2 X UNKNOWN", "manual_price": 5}]


def test_cash_sera_legacy_manual_price_total_can_be_reconciled():
    cash_row = {
        "mattina": "100",
        "paste_text": PASTE_TEXT,
        "manual_prices": {"2 X UNKNOWN": "395"},
    }

    assert _compute_cash_sera_full_legacy_manual_prices(cash_row, [], PASTA_DICT) == 116
    assert _compute_cash_sera_full(cash_row, [], PASTA_DICT) == 511
