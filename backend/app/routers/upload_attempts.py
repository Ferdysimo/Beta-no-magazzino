from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import db
from app.core.security import verify_token
from app.schemas import UploadAttemptEventCreate
from app.services.upload_attempts import (
    classify_attempt_status,
    record_upload_attempt_event,
)


router = APIRouter()

__all__ = ["create_upload_attempt_event", "list_upload_attempts"]


def _require_upload_monitor_access(token_data: dict) -> None:
    identity = (token_data.get("username"), token_data.get("role"))
    if identity not in {("Simone", "admin"), ("Federico", "supervisor")}:
        raise HTTPException(
            status_code=403,
            detail="Pagina riservata a Simone e Federico",
        )


def _require_upload_event_access(token_data: dict) -> None:
    role = token_data.get("role")
    identity = (token_data.get("username"), role)
    if role not in {"restaurant", "admin"} and identity != ("Federico", "supervisor"):
        raise HTTPException(status_code=403, detail="Account non autorizzato")


def _normalized_date_filter(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Intervallo date non valido")


@router.post("/upload-attempts/events")
async def create_upload_attempt_event(
    payload: UploadAttemptEventCreate,
    request: Request,
    token_data: dict = Depends(verify_token),
):
    _require_upload_event_access(token_data)
    attempt_id = payload.attempt_id.strip()
    if not attempt_id or len(attempt_id) > 120:
        raise HTTPException(status_code=400, detail="Tentativo non valido")
    return await record_upload_attempt_event(
        payload.model_dump(),
        token_data,
        user_agent=request.headers.get("user-agent", ""),
    )


@router.get("/admin/upload-attempts")
async def list_upload_attempts(
    date_from: str = "",
    date_to: str = "",
    restaurant_id: str = "",
    status: str = "",
    limit: int = Query(default=500, ge=1, le=2000),
    token_data: dict = Depends(verify_token),
):
    _require_upload_monitor_access(token_data)

    query = {}
    date_filter = {}
    if date_from:
        date_filter["$gte"] = _normalized_date_filter(date_from)
    if date_to:
        date_filter["$lte"] = _normalized_date_filter(date_to)
    if date_filter:
        query["first_seen"] = date_filter
    if restaurant_id:
        query["restaurant_id"] = restaurant_id

    documents = await db.upload_attempts.find(query, {"_id": 0}).sort(
        "last_seen", -1
    ).to_list(limit)
    now = datetime.now(timezone.utc)
    all_items = []
    for document in documents:
        item = dict(document)
        item["events"] = sorted(
            item.get("events") or [],
            key=lambda event: event.get("client_at") or event.get("server_at") or "",
        )
        if any(event.get("stage") == "server_saved" for event in item["events"]):
            item["current_stage"] = "server_saved"
        elif item["events"]:
            item["current_stage"] = item["events"][-1].get("stage") or item.get("current_stage")
        item["display_status"] = classify_attempt_status(item, now)
        all_items.append(item)

    items = [
        item
        for item in all_items
        if not status or status == "all" or item["display_status"] == status
    ]

    restaurant_rows = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "id": 1, "location": 1, "username": 1},
    ).sort("location", 1).to_list(200)
    restaurants = [
        {
            "id": row.get("id"),
            "location": row.get("location") or row.get("username") or "Locale",
        }
        for row in restaurant_rows
        if row.get("id")
    ]
    summary = {
        key: sum(1 for item in all_items if item["display_status"] == key)
        for key in ("saved", "failed", "incomplete", "pending")
    }
    return {
        "items": items,
        "summary": summary,
        "restaurants": restaurants,
        "generated_at": now.isoformat(),
    }
