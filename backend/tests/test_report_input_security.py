import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.analysis import _excel_arithmetic_expression
from app.services.report import _eval_cash_value
from app.services.vers_html import sanitize_vers_html


def test_report_arithmetic_keeps_supported_formulas():
    assert _eval_cash_value("10+5*2") == 20
    assert _eval_cash_value("=(10,50 + 3,20) / 2") == 6.85
    assert _eval_cash_value("-5 + +2") == -3
    assert _eval_cash_value('<span style="color:red">50</span>+30') == 80


def test_report_arithmetic_rejects_expensive_or_unsupported_operators():
    assert _eval_cash_value("9**9**9") == 0
    assert _eval_cash_value("10//2") == 0
    assert _eval_cash_value("1+" * 101 + "1") == 0
    assert _excel_arithmetic_expression("9**9**9") is None
    assert _excel_arithmetic_expression("10+5*2") == "10+5*2"


def test_vers_sanitizer_keeps_only_text_and_supported_colors():
    raw = (
        '<img src=x onerror="alert(1)">'
        '<span class="bad" onclick="alert(2)" style="color: rgb(220, 38, 38); background:url(x)">50</span>'
        '<script>alert(3)</script>+<span style="color: blue">30</span>'
    )

    clean = sanitize_vers_html(raw)

    assert "img" not in clean
    assert "script" not in clean
    assert "onerror" not in clean
    assert "onclick" not in clean
    assert "background" not in clean
    assert "blue" not in clean
    assert '<span style="color: #dc2626">50</span>' in clean
    assert "+<span>30</span>" in clean
