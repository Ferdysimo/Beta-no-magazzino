from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo


ROME_TZ = ZoneInfo("Europe/Rome")


def _rome_date_bounds_utc(date_rome_str: str):
    """Return the half-open UTC interval for a Rome calendar day."""
    start_rome = datetime.strptime(date_rome_str, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
    end_rome = start_rome + timedelta(days=1)
    return (
        start_rome.astimezone(timezone.utc).isoformat(),
        end_rome.astimezone(timezone.utc).isoformat(),
    )


def _rome_date_from_iso(value: str) -> Optional[str]:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ROME_TZ).strftime("%Y-%m-%d")
    except Exception:
        return None


def _today_rome_bounds_utc():
    return _rome_date_bounds_utc(_today_rome_str())


def _today_rome_str() -> str:
    return datetime.now(ROME_TZ).strftime("%Y-%m-%d")


def _today_rome_utc_range():
    """Return the inclusive UTC range used by legacy daily document queries."""
    now_rome = datetime.now(ROME_TZ)
    day_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = day_rome.astimezone(timezone.utc).isoformat()
    end_utc = (day_rome + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc).isoformat()
    return start_utc, end_utc
