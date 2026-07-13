import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from server import (
    _compute_cash_sera_full,
    _compute_paste_breakdown_for_export,
    _compute_cash_sera_full_legacy_manual_prices,
    _compute_cassetto_total,
    _compute_paste_total_eur,
    _compute_paste_unrecognized,
    _paste_text_from_order_docs,
    _write_analysis_locale_sheet,
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


def test_export_paste_breakdown_counts_types_and_altro():
    manual_prices = {"2 X UNKNOWN": "5"}

    result = _compute_paste_breakdown_for_export(PASTE_TEXT, manual_prices, PASTA_DICT)

    assert result["breakdown"]["CARB"]["count"] == 1
    assert result["breakdown"]["AMAT"]["count"] == 1
    assert result["unrecognized_count"] == 1
    assert result["total_count"] == 3
    assert result["total_eur"] == 21


def test_cash_sera_legacy_manual_price_total_can_be_reconciled():
    cash_row = {
        "mattina": "100",
        "paste_text": PASTE_TEXT,
        "manual_prices": {"2 X UNKNOWN": "395"},
    }

    assert _compute_cash_sera_full_legacy_manual_prices(cash_row, [], PASTA_DICT) == 116
    assert _compute_cash_sera_full(cash_row, [], PASTA_DICT) == 511


def test_paste_text_from_order_docs_matches_report_frontend_format():
    docs = [
        {"order_number": 3, "description": " AMAT "},
        {"order_number": 1, "description": "CARB"},
        {"order_number": 2, "description": ""},
    ]

    assert _paste_text_from_order_docs(docs) == "1  CARB\n3  AMAT"


def test_cassetto_total_uses_loose_coin_values():
    row = {"cd5": "2", "cd2": "3", "cd1": "4", "cd05": "5"}

    assert _compute_cassetto_total(row) == 22.5


def test_analysis_locale_sheet_matches_reference_structure_and_style():
    wb = Workbook()
    wb.remove(wb.active)
    rest_data = {
        "location": "Flaminio",
        "pasta_dict": {"RAGU": 8, "AMAT": 8},
        "rows": [{
            "date": datetime(2026, 1, 1),
            "paste": {
                "breakdown": {
                    "RAGU": {"count": 2, "price": 8, "total": 16},
                    "AMAT": {"count": 1, "price": 8, "total": 8},
                },
                "unrecognized_count": 1,
                "unrecognized_eur": 5,
            },
            "paste_total_count": 4,
            "paste_total_eur": 29,
            "beverages": {
                sigla: {
                    "mattina": 10,
                    "inUsc": 2,
                    "scarti": 1,
                    "sera": 4,
                    "qty": 7,
                    "price": 2.5,
                    "incasso": 17.5,
                }
                for sigla in ("AL", "AG")
            },
            "bev_total_inc": 35,
            "cash": {"mattina": 100, "altro": 10},
            "spicci_total": 50,
            "cassetto_total": 22.5,
            "cash_sera": 146,
        }],
    }
    data = {"bev_sigle": ["AL", "AG"]}

    _write_analysis_locale_sheet(wb, rest_data, data, set())
    ws = wb["Flaminio"]
    row6 = [cell.value for cell in ws[6]]
    row7 = [cell.value for cell in ws[7]]

    assert ws["B2"].value.startswith("IN QUESTO FOGLIO VANNO MODIFICATE A MANO")
    assert ws["B4"].value == "PIATTI"
    assert "BEVANDE" in [cell.value for cell in ws[4]]
    assert "OUTPUT AUTOMATICO (n. Piatti)" in row6
    assert "Prezzi e incassi" in row6
    assert "SCARICHI" in row6
    assert "Altri utilizzi / scarti" in row6
    assert "INCASSI TOTALI" in row6
    assert "PASTE - NUMERO" not in row6
    assert "PASTE - INCASSO" not in row6
    assert "TOT EURO" not in row7
    assert "A L" in row7
    assert "A G" in row7
    assert "Cash in cassa mattina" in row7
    assert "Cash in cassa sera" in row7
    assert "€ 0,5" in row7

    price_group_start = row6.index("Prezzi e incassi") + 1
    assert ws.cell(8, price_group_start).value == 8
    assert ws.cell(8, price_group_start).fill.fgColor.rgb == "FFF4F5C1"
    assert ws.cell(8, price_group_start).number_format == "0"

    spicci_open_col = row7.index("Spicci aperti / portati") + 1
    cash_sera_col = row7.index("Cash in cassa sera") + 1
    assert ws.cell(8, spicci_open_col).value == 22.5
    assert ws.cell(8, spicci_open_col).number_format == "0.##"
    assert ws.cell(8, cash_sera_col).fill.fgColor.rgb == "FFF4F5C1"
    assert ws["B7"].font.name == "Calibri"
    assert ws["B8"].font.color.rgb == "FF000000"
    assert ws.sheet_view.showGridLines is True
    assert ws.sheet_view.zoomScale == 70
