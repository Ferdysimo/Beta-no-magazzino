from datetime import date, timedelta


CONTEXT_VERSION = 1
ITALIAN_WEEKDAYS = (
    "lunedi",
    "martedi",
    "mercoledi",
    "giovedi",
    "venerdi",
    "sabato",
    "domenica",
)
FIXED_ITALIAN_HOLIDAYS = {
    (1, 1): "Capodanno",
    (1, 6): "Epifania",
    (4, 25): "Festa della Liberazione",
    (5, 1): "Festa dei Lavoratori",
    (6, 2): "Festa della Repubblica",
    (8, 15): "Ferragosto",
    (11, 1): "Tutti i Santi",
    (12, 8): "Immacolata Concezione",
    (12, 25): "Natale",
    (12, 26): "Santo Stefano",
}


def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _season(month: int) -> str:
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    return "autumn"


def build_calendar_context(business_date: str) -> dict:
    parsed = date.fromisoformat(business_date)
    easter = _easter_sunday(parsed.year)
    movable = {
        easter: "Pasqua",
        easter + timedelta(days=1): "Lunedi dell'Angelo",
    }
    holiday_name = (
        movable.get(parsed)
        or FIXED_ITALIAN_HOLIDAYS.get((parsed.month, parsed.day))
    )
    iso_year, iso_week, iso_weekday = parsed.isocalendar()
    return {
        "calendar": {
            "year": parsed.year,
            "month": parsed.month,
            "day": parsed.day,
            "quarter": ((parsed.month - 1) // 3) + 1,
            "season": _season(parsed.month),
            "weekday_iso": iso_weekday,
            "weekday_name_it": ITALIAN_WEEKDAYS[parsed.weekday()],
            "iso_year": iso_year,
            "iso_week": iso_week,
            "is_weekend": parsed.weekday() >= 5,
        },
        "holiday": {
            "country": "IT",
            "is_national_holiday": holiday_name is not None,
            "name": holiday_name,
            "source": "versioned_local_rule",
        },
        "quality": {
            "context_version": CONTEXT_VERSION,
            "external_context_available": False,
            "weather_available": False,
        },
    }
