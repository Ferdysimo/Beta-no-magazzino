import logging
import re
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from app.core.config import API_VERSION, SIMONE_MIN_TOKEN_VERSION, UPLOADS_DIR
from app.core.database import db
from app.core.diagnostics import (
    api_call_log,
    api_error_log,
    frontend_device_state,
    frontend_error_log,
)
from app.core.rate_limit import limiter
from app.core.runtime import SERVER_GIT_COMMIT, SERVER_STARTED_AT
from app.core.security import create_token, pwd_context, verify_token
from app.core.state import RESTAURANT_LOCATION_CACHE
from app.core.time import ROME_TZ
from app.core.ws_manager import manager
from app.schemas import (
    FrontendDiagnosticsPayload,
    FrontendErrorPayload,
    LocalRestaurantCreate,
    LoginRequest,
    LoginResponse,
    RestaurantCreate,
    RestaurantResponse,
)
from app.services.seeding import (
    PRIVILEGED_SEED_ACCOUNTS,
    ensure_seed_account,
    ensure_simone_token_version,
)


logger = logging.getLogger(__name__)
router = APIRouter()

__all__ = [
    "root",
    "version_check",
    "frontend_heartbeat",
    "frontend_error",
    "serve_upload",
    "create_restaurant",
    "get_restaurants",
    "login",
    "get_current_restaurant",
    "get_admin_restaurants",
    "create_local_restaurant",
    "get_system_alerts",
    "acknowledge_system_alert",
    "get_diagnostics",
    "seed_data",
]


@router.get("/")
async def root():
    return {"message": "Pastasciutta Roma API", "version": API_VERSION}

@router.get("/version")
async def version_check():
    return {
        "version": API_VERSION,
        "git_commit": SERVER_GIT_COMMIT,
        "started_at": SERVER_STARTED_AT.isoformat(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _frontend_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip", "")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""


def _is_restaurant_frontend_entry(entry: dict) -> bool:
    return (entry.get("role") or "").lower() == "restaurant"


def _record_frontend_heartbeat(payload: FrontendDiagnosticsPayload, token_data: dict, request: Request) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    device_id = (payload.device_id or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")
    # One row per physical/browser device. `tab_id` is accepted for backward
    # compatibility, but diagnostics intentionally collapse multiple tabs into
    # the same device so the admin sees tablets, not browser sessions.
    frontend_device_state[device_id] = {
        "client_id": device_id,
        "device_id": device_id,
        "tab_id": payload.tab_id or "",
        "ip": _frontend_client_ip(request),
        "last_seen": now_iso,
        "first_seen": frontend_device_state.get(device_id, {}).get("first_seen", now_iso),
        "frontend_version": payload.frontend_version or "",
        "path": payload.path or "",
        "user_agent": (payload.user_agent or "")[:240],
        "browser": payload.browser or "",
        "os": payload.os or "",
        "device_type": payload.device_type or "",
        "platform": payload.platform or "",
        "language": payload.language or "",
        "screen": payload.screen or "",
        "viewport": payload.viewport or "",
        "timezone": payload.timezone or "",
        "online": bool(payload.online),
        "visibility": payload.visibility or "",
        "restaurant_id": payload.restaurant_id or token_data.get("restaurant_id", ""),
        "restaurant_location": payload.restaurant_location or token_data.get("restaurant_name", ""),
        "username": token_data.get("username", ""),
        "role": token_data.get("role", ""),
    }
    return frontend_device_state[device_id]


@router.post("/diagnostics/frontend")
async def frontend_heartbeat(
    payload: FrontendDiagnosticsPayload,
    request: Request,
    token_data: dict = Depends(verify_token),
):
    _record_frontend_heartbeat(payload, token_data, request)
    return {"ok": True}

@router.post("/diagnostics/frontend/error")
async def frontend_error(
    payload: FrontendErrorPayload,
    request: Request,
    token_data: dict = Depends(verify_token),
):
    _record_frontend_heartbeat(payload, token_data, request)
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "device_id": payload.device_id,
        "tab_id": payload.tab_id or "",
        "client_id": payload.device_id,
        "ip": _frontend_client_ip(request),
        "kind": payload.kind,
        "message": payload.message[:500],
        "source": (payload.source or "")[:240],
        "stack": (payload.stack or "")[:1200],
        "status": payload.status,
        "method": payload.method or "",
        "url": (payload.url or "")[:300],
        "path": payload.path or "",
        "restaurant_id": payload.restaurant_id or token_data.get("restaurant_id", ""),
        "restaurant_location": payload.restaurant_location or token_data.get("restaurant_name", ""),
        "username": token_data.get("username", ""),
        "role": token_data.get("role", ""),
        "frontend_version": payload.frontend_version or "",
    }
    frontend_error_log.append(entry)
    return {"ok": True}

@router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    """Serve un file caricato. Protetto da:
    - rifiuta filename con separatori path o ".." (path traversal),
    - verifica che il path risolto sia effettivamente dentro UPLOADS_DIR (anti symlink escape).

    Note di sicurezza: per ora l'endpoint è pubblico (no JWT). Il filename è un
    UUID 12-hex (~5e28 combinazioni) quindi enumerare a forza bruta è impraticabile,
    ma per difesa in profondità sarebbe meglio firmare l'URL o servire via blob.
    TODO(security): convertire in signed-URL temporanea o blob fetch con auth.
    """
    if (
        not filename
        or "/" in filename
        or "\\" in filename
        or filename.startswith(".")
        or ".." in filename
    ):
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = (UPLOADS_DIR / filename).resolve()
    try:
        filepath.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)

# Restaurant Routes
@router.post("/restaurants", response_model=RestaurantResponse)
async def create_restaurant(data: RestaurantCreate):
    existing = await db.restaurants.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    restaurant_id = str(uuid.uuid4())
    hashed_password = pwd_context.hash(data.password)

    restaurant = {
        "id": restaurant_id,
        "name": data.name,
        "username": data.username,
        "password": hashed_password,
        "location": data.location,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order_counter": 0
    }

    await db.restaurants.insert_one(restaurant)

    return RestaurantResponse(
        id=restaurant_id,
        name=data.name,
        username=data.username,
        location=data.location,
        created_at=restaurant["created_at"]
    )

@router.get("/restaurants", response_model=List[RestaurantResponse])
async def get_restaurants():
    restaurants = await db.restaurants.find({}, {"_id": 0, "password": 0}).to_list(100)
    return [RestaurantResponse(**r) for r in restaurants]

# Auth Routes
@router.post("/auth/login", response_model=LoginResponse)
@limiter.limit("10/minute")
async def login(request: Request, data: LoginRequest):
    restaurant = await db.restaurants.find_one({"username": data.username})

    if not restaurant or not pwd_context.verify(data.password, restaurant["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(
        restaurant["id"],
        restaurant["name"],
        restaurant.get("role", "restaurant"),
        restaurant.get("username", ""),
        int(restaurant.get("token_version") or 1),
    )

    return LoginResponse(
        token=token,
        restaurant=RestaurantResponse(
            id=restaurant["id"],
            name=restaurant["name"],
            username=restaurant["username"],
            location=restaurant["location"],
            created_at=restaurant["created_at"],
            role=restaurant.get("role", "restaurant"),
            boiler_count=restaurant.get("boiler_count", 1),
            report_code=restaurant.get("report_code", ""),
            address=restaurant.get("address", ""),
            postal_code=restaurant.get("postal_code", ""),
            city=restaurant.get("city", ""),
            monitor_customers_enabled=restaurant.get("monitor_customers_enabled"),
        )
    )

@router.get("/auth/me", response_model=RestaurantResponse)
async def get_current_restaurant(token_data: dict = Depends(verify_token)):
    restaurant = await db.restaurants.find_one(
        {"id": token_data["restaurant_id"]},
        {"_id": 0, "password": 0}
    )
    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return RestaurantResponse(**restaurant)

@router.get("/admin/restaurants")
async def get_admin_restaurants(token_data: dict = Depends(verify_token)):
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "password": 0}
    ).to_list(100)
    return restaurants


@router.post("/admin/locali", response_model=RestaurantResponse)
async def create_local_restaurant(
    data: LocalRestaurantCreate,
    token_data: dict = Depends(verify_token)
):
    if token_data.get("username") != "Simone" or token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo Simone puo creare nuovi locali")

    username = data.username.strip()
    location = data.location.strip()
    password = data.password.strip()
    report_code = data.report_code.strip().upper()
    address = data.address.strip()
    postal_code = data.postal_code.strip()
    city = data.city.strip()
    if not all((username, location, password, report_code, address, postal_code, city)):
        raise HTTPException(status_code=400, detail="Compila tutti i campi obbligatori")
    if len(username) > 50 or len(location) > 80 or len(address) > 120 or len(city) > 80:
        raise HTTPException(status_code=400, detail="Uno dei campi supera la lunghezza consentita")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La password deve contenere almeno 8 caratteri")
    if not re.fullmatch(r"[A-Z0-9]{1,4}", report_code):
        raise HTTPException(status_code=400, detail="La sigla Excel deve contenere da 1 a 4 lettere o numeri")
    if not re.fullmatch(r"\d{5}", postal_code):
        raise HTTPException(status_code=400, detail="Il CAP deve contenere esattamente 5 cifre")

    boiler_count = int(data.boiler_count or 1)
    if boiler_count < 1 or boiler_count > 2:
        raise HTTPException(status_code=400, detail="Numero bollitori supportato: 1 o 2")

    existing_username = await db.restaurants.find_one({
        "username": {"$regex": f"^{re.escape(username)}$", "$options": "i"}
    })
    if existing_username:
        raise HTTPException(status_code=400, detail="Username gia esistente")
    existing_location = await db.restaurants.find_one({
        "location": {"$regex": f"^{re.escape(location)}$", "$options": "i"},
        "role": "restaurant",
    })
    if existing_location:
        raise HTTPException(status_code=400, detail="Nome locale gia esistente")

    existing_restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "location": 1, "report_code": 1},
    ).to_list(100)
    used_report_codes = {
        str(r.get("report_code") or (r.get("location") or "")[:1]).strip().upper()
        for r in existing_restaurants
        if r.get("report_code") or r.get("location")
    }
    if report_code in used_report_codes:
        raise HTTPException(status_code=400, detail="Sigla Excel gia utilizzata da un altro locale")

    restaurant = {
        "id": str(uuid.uuid4()),
        "name": "Pastasciutta Roma",
        "username": username,
        "password": pwd_context.hash(password),
        "location": location,
        "role": "restaurant",
        "boiler_count": boiler_count,
        "report_code": report_code,
        "address": address,
        "postal_code": postal_code,
        "city": city,
        "monitor_customers_enabled": bool(data.monitor_customers_enabled),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order_counter": 0
    }
    await db.restaurants.insert_one(restaurant)
    RESTAURANT_LOCATION_CACHE[restaurant["id"]] = location

    return RestaurantResponse(**{k: v for k, v in restaurant.items() if k != "password"})


@router.get("/admin/system-alerts")
async def get_system_alerts(token_data: dict = Depends(verify_token)):
    """Return unacknowledged system alerts (e.g. stale orders recovered at boot)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    alerts = await db.system_alerts.find(
        {"acknowledged": False},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"alerts": alerts}


@router.post("/admin/system-alerts/{alert_id}/acknowledge")
async def acknowledge_system_alert(alert_id: str, token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.system_alerts.update_one(
        {"id": alert_id},
        {"$set": {"acknowledged": True, "acknowledged_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"message": "Alert acknowledged"}


@router.get("/admin/diagnostics")
async def get_diagnostics(token_data: dict = Depends(verify_token)):
    """Live system diagnostics for the Admin dashboard.
    Reports per-restaurant WebSocket state, recent disconnect events,
    last 50 API calls and last 50 errors."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    now = datetime.now(timezone.utc)
    cutoff_15m_dt = now - timedelta(minutes=15)
    cutoff_1h_dt = now - timedelta(hours=1)
    cutoff_24h_dt = now - timedelta(hours=24)
    cutoff_1h = cutoff_1h_dt.isoformat()
    today_rome = datetime.now(ROME_TZ)
    today_start_utc = today_rome.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    today_end_utc = today_rome.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc).isoformat()

    mongo_ok = True
    mongo_error = ""
    try:
        await db.command("ping")
    except Exception as exc:
        mongo_ok = False
        mongo_error = repr(exc)

    # Per-restaurant WS state
    restaurants = await db.restaurants.find(
        {"role": {"$in": ["restaurant", "magazzino"]}},
        {"_id": 0, "id": 1, "location": 1, "username": 1, "role": 1},
    ).to_list(100)
    ws_state = []
    for r in restaurants:
        rid = r["id"]
        conns = manager.active_connections.get(rid, [])
        last_seen = None
        connected_since = None
        for ws in conns:
            meta = manager.connection_meta.get(ws)
            if meta:
                if last_seen is None or meta["last_seen"] > last_seen:
                    last_seen = meta["last_seen"]
                if connected_since is None or meta["connected_at"] < connected_since:
                    connected_since = meta["connected_at"]
        recent = manager.recent_disconnects.get(rid, [])
        recent_disconnects_1h = [d for d in recent if d >= cutoff_1h]
        ws_state.append({
            "restaurant_id": rid,
            "location": r.get("location", ""),
            "username": r.get("username", ""),
            "role": r.get("role", ""),
            "active_connections": len(conns),
            "connected_since": connected_since,
            "last_seen": last_seen,
            "disconnects_last_hour": len(recent_disconnects_1h),
        })

    operational_locations = []
    for r in restaurants:
        if r.get("role") != "restaurant":
            continue
        rid = r["id"]
        active_orders_today = await db.orders.count_documents({
            "restaurant_id": rid,
            "created_at": {"$gte": today_start_utc, "$lte": today_end_utc},
        })
        archived_orders_today = await db.archived_orders.count_documents({
            "restaurant_id": rid,
            "created_at": {"$gte": today_start_utc, "$lte": today_end_utc},
        })
        deleted_orders_today = await db.deletion_logs.count_documents({
            "restaurant_id": rid,
            "deleted_at": {"$gte": today_start_utc, "$lte": today_end_utc},
        })
        last_order = await db.orders.find(
            {"restaurant_id": rid},
            {"_id": 0, "created_at": 1, "order_number": 1},
        ).sort("created_at", -1).limit(1).to_list(1)
        last_archived = await db.archived_orders.find(
            {"restaurant_id": rid},
            {"_id": 0, "created_at": 1, "order_number": 1},
        ).sort("created_at", -1).limit(1).to_list(1)
        last_seen_candidates = [
            d.get("created_at") for d in [*(last_order or []), *(last_archived or [])] if d.get("created_at")
        ]
        operational_locations.append({
            "restaurant_id": rid,
            "location": r.get("location", ""),
            "orders_today": active_orders_today + archived_orders_today + deleted_orders_today,
            "active_orders_today": active_orders_today,
            "archived_orders_today": archived_orders_today,
            "deleted_orders_today": deleted_orders_today,
            "last_order_at": max(last_seen_candidates) if last_seen_candidates else None,
        })

    pending_ddt_count = await db.richieste.count_documents({"status": "pending"})
    evase_waiting_count = await db.richieste.count_documents({"status": "evasa"})
    missing_supplier_invoice_count = await db.carichi_magazzino.count_documents({
        "supplier_name": {"$not": {"$regex": "derrate", "$options": "i"}},
        "$or": [
            {"fattura_file": {"$exists": False}},
            {"fattura_file": None},
            {"fattura_file": ""},
        ]
    })
    linked_invoice_ids = set()
    async for fg in db.fatture_globali.find({}, {"linked_invoice_ids": 1}):
        linked_invoice_ids.update(fg.get("linked_invoice_ids") or [])
    unpaired_local_invoices_count = await db.invoices.count_documents({
        "ddt_number": {"$nin": ["", None]},
        "id": {"$nin": list(linked_invoice_ids)},
    })
    try:
        disk = shutil.disk_usage(UPLOADS_DIR)
        disk_state = {
            "total_gb": round(disk.total / (1024 ** 3), 1),
            "free_gb": round(disk.free / (1024 ** 3), 1),
            "used_percent": round((disk.used / disk.total) * 100, 1) if disk.total else None,
        }
    except Exception:
        disk_state = {"total_gb": None, "free_gb": None, "used_percent": None}

    # API calls (last 50, newest first)
    all_calls = list(api_call_log)
    all_errors = list(api_error_log)
    recent_calls = all_calls[-50:][::-1]
    recent_errors = all_errors[-50:][::-1]

    # Aggregate slow endpoints (>500ms) in the buffer
    slow_calls = [c for c in all_calls if c.get("ms", 0) > 500]

    def parse_diag_ts(value):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None

    def calls_since(cutoff_dt):
        return [
            c for c in all_calls
            if (parse_diag_ts(c.get("ts")) or datetime.min.replace(tzinfo=timezone.utc)) >= cutoff_dt
        ]

    def ws_disconnects_since(cutoff_dt):
        total = 0
        for events in manager.recent_disconnects.values():
            for event_ts in events:
                parsed = parse_diag_ts(event_ts)
                if parsed and parsed >= cutoff_dt:
                    total += 1
        return total

    def summarize_window(label, cutoff_dt):
        window_calls = calls_since(cutoff_dt)
        latencies = [c.get("ms", 0) for c in window_calls]
        error_count = len([c for c in window_calls if c.get("status", 0) >= 400])
        server_error_count = len([c for c in window_calls if c.get("status", 0) >= 500])
        slow_count = len([c for c in window_calls if c.get("ms", 0) > 500])
        max_ms = max(latencies) if latencies else 0
        avg_ms = int(sum(latencies) / len(latencies)) if latencies else 0
        return {
            "label": label,
            "calls": len(window_calls),
            "errors": error_count,
            "server_errors": server_error_count,
            "slow_calls": slow_count,
            "avg_ms": avg_ms,
            "max_ms": max_ms,
            "ws_disconnects": ws_disconnects_since(cutoff_dt),
        }

    health_history = [
        summarize_window("15 min", cutoff_15m_dt),
        summarize_window("1 ora", cutoff_1h_dt),
        summarize_window("24 ore", cutoff_24h_dt),
    ]

    frontend_devices = []
    frontend_errors_by_client: Dict[str, int] = {}
    for err in frontend_error_log:
        if not _is_restaurant_frontend_entry(err):
            continue
        cid = err.get("client_id") or err.get("device_id")
        if cid:
            frontend_errors_by_client[cid] = frontend_errors_by_client.get(cid, 0) + 1
    for device in frontend_device_state.values():
        if not _is_restaurant_frontend_entry(device):
            continue
        last_seen_dt = parse_diag_ts(device.get("last_seen"))
        seconds_since_seen = int((now - last_seen_dt).total_seconds()) if last_seen_dt else None
        client_id = device.get("client_id") or device.get("device_id")
        frontend_devices.append({
            **device,
            "seconds_since_seen": seconds_since_seen,
            "status": "online" if seconds_since_seen is not None and seconds_since_seen <= 90 and device.get("online", True) else "offline",
            "recent_errors_count": frontend_errors_by_client.get(client_id, 0),
        })
    frontend_devices = sorted(
        frontend_devices,
        key=lambda d: d.get("last_seen") or "",
        reverse=True,
    )[:50]
    frontend_recent_errors = [
        err for err in list(frontend_error_log)[::-1]
        if _is_restaurant_frontend_entry(err)
    ][:30]
    frontend_online = len([d for d in frontend_devices if d.get("status") == "online"])
    frontend_offline = len([d for d in frontend_devices if d.get("status") != "online"])
    frontend_locations: Dict[str, dict] = {}
    for device in frontend_devices:
        location_key = device.get("restaurant_id") or device.get("restaurant_location") or "unknown"
        location_label = device.get("restaurant_location") or device.get("username") or "Sconosciuto"
        row = frontend_locations.setdefault(location_key, {
            "restaurant_id": device.get("restaurant_id") or "",
            "location": location_label,
            "role": device.get("role") or "",
            "devices_total": 0,
            "online": 0,
            "offline": 0,
            "visible": 0,
            "errors": 0,
            "versions": set(),
            "last_seen": "",
        })
        row["devices_total"] += 1
        row["online" if device.get("status") == "online" else "offline"] += 1
        row["visible"] += 1 if device.get("visibility") == "visible" else 0
        row["errors"] += device.get("recent_errors_count", 0) or 0
        if device.get("frontend_version"):
            row["versions"].add(device.get("frontend_version"))
        if not row["last_seen"] or (device.get("last_seen") or "") > row["last_seen"]:
            row["last_seen"] = device.get("last_seen") or ""
    frontend_locations_summary = []
    for row in frontend_locations.values():
        frontend_locations_summary.append({
            **row,
            "versions": sorted(row["versions"]),
        })
    frontend_locations_summary.sort(key=lambda x: (x["offline"] > 0, x["errors"] > 0, x["online"], x["location"]), reverse=True)

    api_server_errors = [c for c in all_calls if c.get("status", 0) >= 500]
    api_client_errors = [c for c in all_calls if 400 <= c.get("status", 0) < 500]
    ws_unstable = [w for w in ws_state if w.get("disconnects_last_hour", 0) > 5]
    ws_offline = [
        w for w in ws_state
        if w.get("role") == "restaurant" and w.get("active_connections", 0) == 0
    ]

    health_reasons = []
    if not mongo_ok:
        health_reasons.append({
            "level": "critical",
            "title": "MongoDB non risponde",
            "detail": mongo_error or "Ping database fallito",
        })
    if api_server_errors:
        latest = api_server_errors[-1]
        health_reasons.append({
            "level": "critical",
            "title": f"{len(api_server_errors)} errori server nel buffer",
            "detail": f"Ultimo: {latest.get('method')} {latest.get('path')} -> {latest.get('status')}",
        })
    if disk_state.get("used_percent") is not None and disk_state["used_percent"] >= 85:
        health_reasons.append({
            "level": "warning",
            "title": "Disco uploads quasi pieno",
            "detail": f"Uso disco {disk_state['used_percent']}%, liberi {disk_state.get('free_gb')} GB",
        })
    if slow_calls:
        slowest = max(slow_calls, key=lambda c: c.get("ms", 0))
        health_reasons.append({
            "level": "warning",
            "title": f"{len(slow_calls)} chiamate lente nel buffer",
            "detail": f"Picco: {slowest.get('path')} in {slowest.get('ms')} ms",
        })
    if ws_unstable:
        names = ", ".join([w.get("location") or w.get("username") or w.get("restaurant_id", "")[:8] for w in ws_unstable[:3]])
        health_reasons.append({
            "level": "warning",
            "title": "WebSocket instabili",
            "detail": f"Disconnessioni elevate: {names}",
        })
    if api_client_errors and not api_server_errors:
        latest = api_client_errors[-1]
        health_reasons.append({
            "level": "warning",
            "title": f"{len(api_client_errors)} errori HTTP 4xx nel buffer",
            "detail": f"Ultimo: {latest.get('method')} {latest.get('path')} -> {latest.get('status')}",
        })
    if frontend_recent_errors:
        latest = frontend_recent_errors[0]
        health_reasons.append({
            "level": "warning",
            "title": f"{len(frontend_recent_errors)} errori frontend recenti",
            "detail": f"Ultimo: {latest.get('message')}",
        })
    if frontend_offline > 0:
        health_reasons.append({
            "level": "warning",
            "title": f"{frontend_offline} tablet/browser offline",
            "detail": "Almeno un dispositivo registrato non invia heartbeat da oltre 90 secondi.",
        })
    if not health_reasons:
        health_reasons.append({
            "level": "ok",
            "title": "Nessuna anomalia evidente",
            "detail": "Backend, MongoDB, disco, API e WebSocket non mostrano segnali critici nel buffer corrente.",
        })

    timeline_events = [{
        "ts": SERVER_STARTED_AT.isoformat(),
        "level": "neutral",
        "type": "server_started",
        "title": "Backend avviato",
        "detail": "Processo FastAPI partito",
    }]
    if not mongo_ok:
        timeline_events.append({
            "ts": now.isoformat(),
            "level": "critical",
            "type": "mongo_error",
            "title": "MongoDB non risponde",
            "detail": mongo_error,
        })
    for call in all_errors[-20:]:
        timeline_events.append({
            "ts": call.get("ts"),
            "level": "critical" if call.get("status", 0) >= 500 else "warning",
            "type": "api_error",
            "title": f"{call.get('method')} {call.get('path')} -> {call.get('status')}",
            "detail": call.get("error") or call.get("location") or "Errore API",
        })
    for call in sorted(slow_calls, key=lambda c: c.get("ms", 0), reverse=True)[:12]:
        timeline_events.append({
            "ts": call.get("ts"),
            "level": "warning",
            "type": "slow_call",
            "title": f"Chiamata lenta: {call.get('path')}",
            "detail": f"{call.get('ms')} ms",
        })
    for ws in ws_state:
        if ws.get("active_connections", 0) == 0 and ws.get("role") == "restaurant":
            timeline_events.append({
                "ts": now.isoformat(),
                "level": "warning",
                "type": "ws_offline",
                "title": f"WebSocket offline: {ws.get('location') or ws.get('username')}",
                "detail": "Nessuna connessione attiva",
            })
        for event_ts in manager.recent_disconnects.get(ws.get("restaurant_id"), [])[-10:]:
            timeline_events.append({
                "ts": event_ts,
                "level": "warning",
                "type": "ws_disconnect",
                "title": f"Disconnessione WebSocket: {ws.get('location') or ws.get('username')}",
                "detail": "Connessione chiusa",
            })
    for err in frontend_recent_errors[:10]:
        timeline_events.append({
            "ts": err.get("ts"),
            "level": "warning",
            "type": "frontend_error",
            "title": f"Errore frontend: {err.get('restaurant_location') or err.get('username') or err.get('device_id')}",
            "detail": err.get("message") or err.get("url") or "Errore browser",
        })
    timeline_events = sorted(
        [e for e in timeline_events if e.get("ts")],
        key=lambda e: e.get("ts"),
        reverse=True,
    )[:30]

    frontend_versions = sorted({
        d.get("frontend_version")
        for d in frontend_devices
        if d.get("frontend_version")
    })

    return {
        "server_time": now.isoformat(),
        "server_started_at": SERVER_STARTED_AT.isoformat(),
        "deployment": {
            "backend_version": API_VERSION,
            "backend_git_commit": SERVER_GIT_COMMIT,
            "backend_started_at": SERVER_STARTED_AT.isoformat(),
            "frontend_versions": frontend_versions,
        },
        "system": {
            "backend_ok": True,
            "mongo_ok": mongo_ok,
            "mongo_error": mongo_error,
            "disk": disk_state,
        },
        "health_reasons": health_reasons,
        "timeline_events": timeline_events,
        "health_history": health_history,
        "frontend": {
            "devices": frontend_devices,
            "locations": frontend_locations_summary,
            "online_count": frontend_online,
            "offline_count": frontend_offline,
            "recent_errors": frontend_recent_errors,
        },
        "operations": {
            "date": today_rome.date().isoformat(),
            "locations": operational_locations,
            "pending_ddt_count": pending_ddt_count,
            "evase_waiting_count": evase_waiting_count,
            "missing_supplier_invoice_count": missing_supplier_invoice_count,
            "unpaired_local_invoices_count": unpaired_local_invoices_count,
        },
        "websockets": ws_state,
        "recent_calls": recent_calls,
        "recent_errors": recent_errors,
        "slow_calls_count": len(slow_calls),
        "buffer_size": len(api_call_log),
    }


@router.post("/seed")
async def seed_data():
    # Only create restaurants if they don't exist
    existing = await db.restaurants.count_documents({})
    if existing > 0:
        # Check if Magazziniere exists, add if not
        mag = await db.restaurants.find_one({"username": "Magazziniere"})
        if not mag:
            await db.restaurants.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Pastasciutta Roma",
                "username": "Magazziniere",
                "password": pwd_context.hash("Pastasciutt4!"),
                "location": "Magazzino",
                "role": "magazzino",
                "boiler_count": 1,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0
            })
        for account in PRIVILEGED_SEED_ACCOUNTS:
            await ensure_seed_account(account)
        await ensure_simone_token_version()
        return {"message": "Database già configurato", "accounts": [
            {"username": "Flaminio", "location": "Flaminio"},
            {"username": "Grazie", "location": "Grazie"},
            {"username": "Brazza", "location": "Largo di Brazzà"},
            {"username": "Magazziniere", "location": "Magazzino"},
            {"username": "Admin", "location": "Amministrazione"},
            {"username": "Simone", "location": "Amministrazione"},
        ]}

    # Create the 3 restaurants + magazziniere
    restaurants = [
        {"name": "Pastasciutta Roma", "username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio", "role": "restaurant", "boiler_count": 2},
        {"name": "Pastasciutta Roma", "username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie", "role": "restaurant", "boiler_count": 1},
        {"name": "Pastasciutta Roma", "username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà", "role": "restaurant", "boiler_count": 1},
        {"name": "Pastasciutta Roma", "username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino", "role": "magazzino", "boiler_count": 1},
        {"name": "Amministratore", "username": "Admin", "password": "Pastasciutt4!", "location": "Amministrazione", "role": "admin", "boiler_count": 1},
        {"name": "Simone", "username": "Simone", "password": "aothj7nejx", "location": "Amministrazione", "role": "admin", "boiler_count": 1, "token_version": SIMONE_MIN_TOKEN_VERSION},
    ]

    for r in restaurants:
        restaurant_id = str(uuid.uuid4())
        await db.restaurants.insert_one({
            "id": restaurant_id,
            "name": r["name"],
            "username": r["username"],
            "password": pwd_context.hash(r["password"]),
            "location": r["location"],
            "role": r.get("role", "restaurant"),
            "token_version": r.get("token_version", 1),
            "boiler_count": r.get("boiler_count", 1),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order_counter": 0
        })

    return {"message": "Credenziali create", "accounts": [
        {"username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio"},
        {"username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie"},
        {"username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà"},
        {"username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino"},
        {"username": "Admin", "password": "Pastasciutt4!", "location": "Amministrazione"},
        {"username": "Simone", "password": "aothj7nejx", "location": "Amministrazione"},
    ]}
