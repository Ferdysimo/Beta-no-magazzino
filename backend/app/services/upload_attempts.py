import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.database import db
from app.core.state import RESTAURANT_LOCATION_CACHE


logger = logging.getLogger(__name__)

SAVED_STAGES = {"upload_succeeded", "server_saved"}
FAILED_STAGES = {"compression_failed", "upload_failed"}


def _clean(value, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def _event_status(stage: str) -> str:
    if stage in SAVED_STAGES:
        return "saved"
    if stage in FAILED_STAGES:
        return "failed"
    return "pending"


def _normalized_client_time(value) -> str:
    if not value:
        return ""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return ""


def _restaurant_location(token_data: dict) -> str:
    restaurant_id = _clean(token_data.get("restaurant_id"), 120)
    return _clean(
        RESTAURANT_LOCATION_CACHE.get(restaurant_id)
        or token_data.get("restaurant_location")
        or token_data.get("restaurant_name")
        or token_data.get("username"),
        120,
    )


async def record_upload_attempt_event(
    payload: dict,
    token_data: dict,
    *,
    user_agent: str = "",
) -> dict:
    """Append a metadata-only upload event and update the attempt summary."""
    attempt_id = _clean(payload.get("attempt_id"), 120)
    if not attempt_id:
        raise ValueError("attempt_id required")

    stage = _clean(payload.get("stage"), 40)
    now = datetime.now(timezone.utc).isoformat()
    client_at = _normalized_client_time(payload.get("client_at"))
    occurred_at = client_at or now
    event = {
        "event_id": _clean(payload.get("event_id"), 120),
        "stage": stage,
        "server_at": now,
        "client_at": client_at,
        "online": payload.get("online"),
        "error_kind": _clean(payload.get("error_kind"), 80),
        "error_message": _clean(payload.get("error_message"), 500),
        "http_status": payload.get("http_status"),
        "file_size_bytes": payload.get("file_size_bytes"),
        "compressed_size_bytes": payload.get("compressed_size_bytes"),
    }
    event = {key: value for key, value in event.items() if value not in (None, "")}

    existing = await db.upload_attempts.find_one(
        {"attempt_id": attempt_id},
        {"_id": 0, "status": 1, "events.event_id": 1},
    )
    event_id = event.get("event_id")
    if event_id and existing:
        known_ids = {
            item.get("event_id")
            for item in (existing.get("events") or [])
            if isinstance(item, dict)
        }
        if event_id in known_ids:
            return {"ok": True, "duplicate": True}

    next_status = _event_status(stage)
    current_status = (existing or {}).get("status")
    if current_status == "saved" and next_status != "saved":
        next_status = "saved"

    summary = {
        "current_stage": stage,
        "status": next_status,
        "restaurant_id": _clean(token_data.get("restaurant_id"), 120),
        "restaurant_location": _restaurant_location(token_data),
        "username": _clean(token_data.get("username"), 120),
        "upload_kind": _clean(payload.get("upload_kind") or "closure_primary", 40),
        "device_id": _clean(payload.get("device_id"), 160),
        "path": _clean(payload.get("path"), 240),
        "browser": _clean(payload.get("browser"), 80),
        "os": _clean(payload.get("os"), 80),
        "platform": _clean(payload.get("platform"), 120),
        "connection_effective_type": _clean(
            payload.get("connection_effective_type"), 40
        ),
        "mime_type": _clean(payload.get("mime_type"), 100),
        "target_closure_id": _clean(payload.get("target_closure_id"), 120),
        "user_agent": _clean(user_agent, 500),
    }
    summary = {key: value for key, value in summary.items() if value not in (None, "")}
    if current_status == "saved" and stage not in SAVED_STAGES:
        summary.pop("current_stage", None)

    await db.upload_attempts.update_one(
        {"attempt_id": attempt_id},
        {
            "$setOnInsert": {
                "attempt_id": attempt_id,
            },
            "$set": summary,
            "$min": {"first_seen": occurred_at},
            "$max": {"last_seen": occurred_at},
            "$push": {"events": event},
        },
        upsert=True,
    )
    return {"ok": True}


async def safe_record_server_upload_event(
    *,
    attempt_id: str,
    stage: str,
    upload_kind: str,
    token_data: dict,
    device_id: str = "",
    target_closure_id: str = "",
    error_kind: str = "",
    error_message: str = "",
) -> None:
    """Upload telemetry must never be able to break the upload itself."""
    if not attempt_id:
        return
    try:
        await asyncio.wait_for(
            record_upload_attempt_event(
                {
                    "attempt_id": attempt_id,
                    "stage": stage,
                    "upload_kind": upload_kind,
                    "device_id": device_id,
                    "target_closure_id": target_closure_id,
                    "error_kind": error_kind,
                    "error_message": error_message,
                },
                token_data,
            ),
            timeout=0.75,
        )
    except Exception:
        logger.warning("Could not record upload attempt %s", attempt_id, exc_info=True)


def classify_attempt_status(document: dict, now: Optional[datetime] = None) -> str:
    events = document.get("events") or []
    stages = {event.get("stage") for event in events if isinstance(event, dict)}
    if stages & SAVED_STAGES:
        return "saved"
    ordered_events = sorted(
        (event for event in events if isinstance(event, dict)),
        key=lambda event: event.get("client_at") or event.get("server_at") or "",
    )
    latest_stage = ordered_events[-1].get("stage") if ordered_events else ""
    if latest_stage in FAILED_STAGES:
        return "failed"
    current = now or datetime.now(timezone.utc)
    try:
        last_seen = datetime.fromisoformat(
            str(document.get("last_seen") or "").replace("Z", "+00:00")
        )
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        if (current - last_seen).total_seconds() >= 120:
            return "incomplete"
    except (TypeError, ValueError):
        return "incomplete"
    return "pending"
