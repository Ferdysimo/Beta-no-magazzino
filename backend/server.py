from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import os
import re
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone, timedelta
import json
import jwt
import asyncio
from zoneinfo import ZoneInfo
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Settings — il secret DEVE essere fornito via env, niente fallback per evitare
# che in caso di .env mancante l'app parta con un secret hard-coded (forgiabile).
SECRET_KEY = os.environ.get('JWT_SECRET')
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET env var is required; refuse to start with insecure fallback")
ALGORITHM = "HS256"

# Rate limiter (slowapi). Usa l'IP del client come chiave; per scopi auth è sufficiente.
limiter = Limiter(key_func=get_remote_address)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Create the main app
app = FastAPI()
# Wire up rate limiter (slowapi) — handler restituisce 429 quando lo si supera.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Gzip compression - responses > 500 bytes get compressed
app.add_middleware(GZipMiddleware, minimum_size=500)


# Cache di restaurant_id -> location, popolata al boot. Usata dal middleware
# diagnostico per allegare il nome del locale a ogni log API senza colpire
# il DB ad ogni richiesta.
RESTAURANT_LOCATION_CACHE: Dict[str, str] = {}


# In-memory diagnostics middleware: records each /api/* HTTP call
# (method, path, status, duration_ms, timestamp). Used by the Admin
# Diagnostica Live page. Out-of-process tooling not needed.
@app.middleware("http")
async def diagnostics_middleware(request: Request, call_next):
    import time as _t
    start = _t.perf_counter()
    status_code = 500
    error_text = None
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as e:
        error_text = repr(e)
        raise
    finally:
        try:
            path = request.url.path
            if path.startswith("/api/"):
                duration_ms = int((_t.perf_counter() - start) * 1000)
                # Best-effort extraction of caller restaurant from JWT.
                # We tolerate any failure (no token, expired, etc.) silently.
                rid = ""
                rname = ""
                role = ""
                try:
                    auth = request.headers.get("authorization") or request.headers.get("Authorization")
                    if auth and auth.lower().startswith("bearer "):
                        payload = jwt.decode(
                            auth.split(" ", 1)[1],
                            SECRET_KEY,
                            algorithms=[ALGORITHM],
                            options={"verify_exp": False},
                        )
                        rid = payload.get("restaurant_id", "") or ""
                        rname = payload.get("restaurant_name", "") or ""
                        role = payload.get("role", "") or ""
                        # Admin/supervisor overriding a specific restaurant via header
                        if role in ("admin",):
                            override = request.headers.get("X-Admin-Restaurant-Id")
                            if override:
                                rid = override
                                rname = f"({role} → {RESTAURANT_LOCATION_CACHE.get(rid, rid[:8])})"
                except Exception:
                    pass
                location = RESTAURANT_LOCATION_CACHE.get(rid, "")
                entry = {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "method": request.method,
                    "path": path,
                    "status": status_code,
                    "ms": duration_ms,
                    "restaurant_id": rid,
                    "location": location,
                    "user": rname,
                    "role": role,
                }
                api_call_log.append(entry)
                if status_code >= 500 or error_text:
                    api_error_log.append({**entry, "error": error_text or f"HTTP {status_code}"})
        except Exception:
            pass

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ROME_TZ = ZoneInfo("Europe/Rome")


def _today_rome_bounds_utc():
    """Return (start_utc_iso, end_utc_iso) for the current day in Europe/Rome."""
    now_rome = datetime.now(ROME_TZ)
    start_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    end_rome = start_rome + timedelta(days=1)
    return (
        start_rome.astimezone(timezone.utc).isoformat(),
        end_rome.astimezone(timezone.utc).isoformat(),
    )


async def _atomic_archive_and_clear(collection_name: str, archive_name: str) -> int:
    """Atomically archive a collection then clear it. Returns archived count.

    Strategy: read all -> insert_many into archive -> verify inserted_count matches ->
    only THEN delete from source. If insert fails or count mismatches, abort and keep
    the source untouched.
    """
    src = db[collection_name]
    arc = db[archive_name]
    docs = await src.find({}, {"_id": 0}).to_list(100000)
    if not docs:
        return 0
    try:
        result = await arc.insert_many([{**d} for d in docs], ordered=False)
        if len(result.inserted_ids) != len(docs):
            logger.error(
                f"[ATOMIC] {collection_name}: archived {len(result.inserted_ids)}/{len(docs)}, "
                f"ABORTING delete to prevent data loss"
            )
            return 0
    except Exception as e:
        logger.error(f"[ATOMIC] Failed to archive {collection_name}: {e}. NOT deleting source.")
        return 0
    # Archive succeeded -> safe to delete source
    delete_res = await src.delete_many({})
    logger.info(f"[ATOMIC] {collection_name}: archived={len(docs)}, deleted={delete_res.deleted_count}")
    return len(docs)


# Midnight reset: archive orders and reset counters
async def midnight_reset():
    logger.info("Running midnight reset - archiving orders and resetting counters")
    archived_count = 0
    try:
        archived_count = await _atomic_archive_and_clear("orders", "archived_orders")
        await _atomic_archive_and_clear("deletion_logs", "archived_deletion_logs")
        await _atomic_archive_and_clear("modification_logs", "archived_modification_logs")
        await _atomic_archive_and_clear("beverage_sales", "archived_beverage_sales")

        # Reset all restaurant counters to 0 ONLY if archive of orders succeeded
        # (or there were no orders to archive)
        await db.restaurants.update_many(
            {"role": "restaurant"},
            {"$set": {"order_counter": 0}}
        )
        logger.info(f"Order counters reset to 0 (archived {archived_count} orders)")

        # Broadcast reset to all connected clients
        for rid in list(manager.active_connections.keys()):
            await manager.broadcast_to_restaurant(rid, {
                "type": "daily_reset"
            })

        # Retention: delete fatture/versamenti/chiusure older than 3 months
        # (and their image files). Best-effort, doesn't block the reset.
        try:
            await cleanup_old_uploads()
        except Exception as e:
            logger.error(f"[CLEANUP] cleanup_old_uploads in midnight_reset failed: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Midnight reset error: {e}", exc_info=True)


# Retention policy for upload-style collections (fatture / versamenti / chiusure).
# Documents older than this many days are auto-deleted together with their
# associated image files on disk. Keeps Mongo & disk usage bounded.
UPLOADS_RETENTION_DAYS = 90  # ~3 mesi

async def cleanup_old_uploads(retention_days: int = UPLOADS_RETENTION_DAYS) -> Dict[str, int]:
    """Delete fatture / versamenti / chiusure older than `retention_days` together
    with their associated image files on disk.

    For warehouse carichi (`carichi_magazzino`, `beverage_carichi`) we only strip
    the DDT/fattura image files from disk and null out the filename fields —
    the documents themselves are kept so `/analisi/magazzino` keeps working on
    historical ranges.

    Cutoff is based on `created_at` (ISO 8601 UTC string, lexicographically
    comparable). Returns a dict {collection: deleted_or_stripped_count}.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    # Full-delete collections: doc + image files are all removed.
    delete_targets = [
        ("invoices",   ["image_file"]),
        ("versamenti", ["image_file"]),
        ("chiusure",   ["image_file", "piatti_file"]),
    ]
    # Strip-only collections: keep the doc (needed for analytics), drop the
    # associated images from disk and clear the filename fields.
    strip_targets = [
        ("carichi_magazzino", ["photo_file", "fattura_file"]),
        ("beverage_carichi",  ["invoice_file"]),
    ]
    summary: Dict[str, int] = {}

    for coll_name, file_fields in delete_targets:
        try:
            coll = db[coll_name]
            projection = {"_id": 0, "id": 1}
            for f in file_fields:
                projection[f] = 1
            old_docs = await coll.find(
                {"created_at": {"$lt": cutoff}}, projection
            ).to_list(100000)
            if not old_docs:
                summary[coll_name] = 0
                continue
            files_removed = 0
            for d in old_docs:
                for f in file_fields:
                    fn = d.get(f)
                    if not fn:
                        continue
                    try:
                        p = UPLOADS_DIR / fn
                        if p.exists():
                            p.unlink()
                            files_removed += 1
                    except Exception as e:
                        logger.warning(f"[CLEANUP] Could not delete file {fn} for {coll_name}: {e}")
            old_ids = [d["id"] for d in old_docs if d.get("id")]
            del_res = await coll.delete_many({"id": {"$in": old_ids}})
            summary[coll_name] = del_res.deleted_count
            logger.info(
                f"[CLEANUP] {coll_name}: deleted {del_res.deleted_count} docs older than "
                f"{retention_days}d, removed {files_removed} image files"
            )
        except Exception as e:
            logger.error(f"[CLEANUP] Failed for {coll_name}: {e}", exc_info=True)
            summary[coll_name] = -1

    for coll_name, file_fields in strip_targets:
        try:
            coll = db[coll_name]
            projection = {"_id": 0, "id": 1}
            for f in file_fields:
                projection[f] = 1
            # Only docs that still hold at least one image filename.
            file_filter = {"$or": [{f: {"$nin": ["", None]}} for f in file_fields]}
            old_docs = await coll.find(
                {"created_at": {"$lt": cutoff}, **file_filter}, projection
            ).to_list(100000)
            if not old_docs:
                summary[coll_name] = 0
                continue
            files_removed = 0
            stripped_ids: List[str] = []
            for d in old_docs:
                touched = False
                for f in file_fields:
                    fn = d.get(f)
                    if not fn:
                        continue
                    try:
                        p = UPLOADS_DIR / fn
                        if p.exists():
                            p.unlink()
                            files_removed += 1
                    except Exception as e:
                        logger.warning(f"[CLEANUP] Could not delete file {fn} for {coll_name}: {e}")
                    touched = True
                if touched and d.get("id"):
                    stripped_ids.append(d["id"])
            if stripped_ids:
                # Null-out filename fields + invoice_url (computed at create time
                # for beverage_carichi). We touch them all unconditionally:
                # already-empty fields stay empty, no other data is affected.
                unset_fields = {f: "" for f in file_fields}
                if coll_name == "beverage_carichi":
                    unset_fields["invoice_url"] = ""
                await coll.update_many(
                    {"id": {"$in": stripped_ids}},
                    {"$set": unset_fields},
                )
            summary[coll_name] = len(stripped_ids)
            logger.info(
                f"[CLEANUP] {coll_name}: stripped DDT from {len(stripped_ids)} docs older "
                f"than {retention_days}d, removed {files_removed} image files (docs kept for analytics)"
            )
        except Exception as e:
            logger.error(f"[CLEANUP] Failed for {coll_name}: {e}", exc_info=True)
            summary[coll_name] = -1

    return summary


async def recover_stale_orders():
    """Self-healing: at boot, archive any orders whose created_at is before today's
    Rome midnight. Prevents stale orders from yesterday polluting today's tablets
    in case midnight_reset never ran (server downtime, deploy, crash).
    Records an alert in system_alerts collection if stale orders were found."""
    try:
        start_utc, _ = _today_rome_bounds_utc()
        stale = await db.orders.find(
            {"created_at": {"$lt": start_utc}}, {"_id": 0}
        ).to_list(100000)
        if not stale:
            logger.info("[RECOVERY] No stale orders found at boot")
            return
        logger.warning(f"[RECOVERY] Found {len(stale)} stale orders at boot, archiving...")
        # Archive stale orders atomically
        result = await db.archived_orders.insert_many([{**o} for o in stale], ordered=False)
        if len(result.inserted_ids) != len(stale):
            logger.error(
                f"[RECOVERY] Archive mismatch {len(result.inserted_ids)}/{len(stale)}, ABORTING"
            )
            return
        stale_ids = [o["id"] for o in stale]
        del_res = await db.orders.delete_many({"id": {"$in": stale_ids}})
        logger.warning(f"[RECOVERY] Archived {len(stale)} stale orders, deleted {del_res.deleted_count}")

        # Recompute order_counter per restaurant from remaining active orders
        # so today's numbering continues correctly
        per_restaurant = {}
        for rid_doc in await db.restaurants.find({"role": "restaurant"}, {"_id": 0, "id": 1, "location": 1}).to_list(100):
            rid = rid_doc["id"]
            loc = rid_doc.get("location", "?")
            count_for_rid = sum(1 for s in stale if s.get("restaurant_id") == rid)
            highest = await _highest_order_number_today(rid)
            await db.restaurants.update_one(
                {"id": rid}, {"$set": {"order_counter": highest}}
            )
            if count_for_rid > 0:
                per_restaurant[loc] = count_for_rid
            logger.warning(f"[RECOVERY] Restaurant {rid} counter set to {highest}")

        # Record alert for Admin dashboard
        await db.system_alerts.insert_one({
            "id": str(uuid.uuid4()),
            "type": "stale_orders_recovered",
            "stale_count": len(stale),
            "per_restaurant": per_restaurant,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "acknowledged": False,
        })
    except Exception as e:
        logger.error(f"[RECOVERY] recover_stale_orders failed: {e}", exc_info=True)


async def _highest_order_number_today(restaurant_id: str) -> int:
    """Return the highest order_number used today for this restaurant across:
    active orders, archived_orders of today, and deletion_logs of today.
    Used to safely set order_counter without ever going backwards."""
    start_utc, end_utc = _today_rome_bounds_utc()
    max_n = 0
    # Active orders
    doc = await db.orders.find_one(
        {"restaurant_id": restaurant_id},
        sort=[("order_number", -1)], projection={"_id": 0, "order_number": 1}
    )
    if doc and doc.get("order_number"):
        max_n = max(max_n, doc["order_number"])
    # Archived orders of today
    doc = await db.archived_orders.find_one(
        {"restaurant_id": restaurant_id, "created_at": {"$gte": start_utc, "$lt": end_utc}},
        sort=[("order_number", -1)], projection={"_id": 0, "order_number": 1}
    )
    if doc and doc.get("order_number"):
        max_n = max(max_n, doc["order_number"])
    # Deletion logs of today
    doc = await db.deletion_logs.find_one(
        {"restaurant_id": restaurant_id, "deleted_at": {"$gte": start_utc, "$lt": end_utc}},
        sort=[("order_number", -1)], projection={"_id": 0, "order_number": 1}
    )
    if doc and doc.get("order_number"):
        max_n = max(max_n, doc["order_number"])
    return max_n

async def midnight_scheduler():
    while True:
        now = datetime.now(ROME_TZ)
        # Calculate seconds until next midnight Rome time
        tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if now >= tomorrow:
            tomorrow += timedelta(days=1)
        wait_seconds = (tomorrow - now).total_seconds()
        logger.info(f"Next midnight reset in {wait_seconds:.0f} seconds ({tomorrow.isoformat()})")
        await asyncio.sleep(wait_seconds)
        await midnight_reset()

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Per-connection metadata: ws -> {"restaurant_id", "connected_at", "last_seen"}
        self.connection_meta: Dict[WebSocket, dict] = {}
        # Per-restaurant: list of recent disconnect events (last 50)
        # Used by the admin diagnostics page to spot flaky networks.
        self.recent_disconnects: Dict[str, List[str]] = {}
    
    async def connect(self, websocket: WebSocket, restaurant_id: str):
        await websocket.accept()
        if restaurant_id not in self.active_connections:
            self.active_connections[restaurant_id] = []
        self.active_connections[restaurant_id].append(websocket)
        now_iso = datetime.now(timezone.utc).isoformat()
        self.connection_meta[websocket] = {
            "restaurant_id": restaurant_id,
            "connected_at": now_iso,
            "last_seen": now_iso,
        }
        logger.info(f"WebSocket connected for restaurant {restaurant_id}")
    
    def disconnect(self, websocket: WebSocket, restaurant_id: str):
        if restaurant_id in self.active_connections:
            if websocket in self.active_connections[restaurant_id]:
                self.active_connections[restaurant_id].remove(websocket)
            logger.info(f"WebSocket disconnected for restaurant {restaurant_id}")
        self.connection_meta.pop(websocket, None)
        # Track disconnect for diagnostics
        events = self.recent_disconnects.setdefault(restaurant_id, [])
        events.append(datetime.now(timezone.utc).isoformat())
        if len(events) > 50:
            del events[: len(events) - 50]
    
    def touch(self, websocket: WebSocket):
        """Update last_seen timestamp on ping/pong/message."""
        meta = self.connection_meta.get(websocket)
        if meta:
            meta["last_seen"] = datetime.now(timezone.utc).isoformat()
    
    async def broadcast_to_restaurant(self, restaurant_id: str, message: dict):
        if restaurant_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[restaurant_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message: {e}")
                    disconnected.append(connection)
            for conn in disconnected:
                self.disconnect(conn, restaurant_id)

manager = ConnectionManager()

# ----- API call diagnostics (in-memory ring buffer) -----
# Keeps the last 200 API calls and last 100 errors so the admin can spot
# slow endpoints or 5xx spikes without external tooling.
from collections import deque
api_call_log: deque = deque(maxlen=200)
api_error_log: deque = deque(maxlen=100)

# Pydantic Models
class RestaurantCreate(BaseModel):
    name: str
    username: str
    password: str
    location: str

class RestaurantResponse(BaseModel):
    id: str
    name: str
    username: str
    location: str
    created_at: str
    role: str = "restaurant"

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    restaurant: RestaurantResponse

class OrderCreate(BaseModel):
    description: str

class OrderUpdate(BaseModel):
    description: Optional[str] = None
    order_number: Optional[int] = None
    status: Optional[str] = None
    timer_started: Optional[bool] = None
    timer_start_time: Optional[str] = None
    timer_paused: Optional[bool] = None
    timer_elapsed: Optional[int] = None

class DeletionLog(BaseModel):
    id: str
    order_number: int
    description: str
    restaurant_id: str
    deleted_at: str
    original_created_at: str

class ModificationLog(BaseModel):
    id: str
    order_id: str
    order_number: int
    old_description: str
    new_description: str
    restaurant_id: str
    modified_at: str


# =========================
# BEVERAGES (Flaminio only)
# =========================
BEVERAGES_CATALOG = [
    {"sigla": "AL", "name": "Acqua naturale", "price": 1.00, "sort_order": 1},
    {"sigla": "AG", "name": "Acqua leggermente frizzante", "price": 1.00, "sort_order": 2},
    {"sigla": "C", "name": "Coca-Cola", "price": 2.00, "sort_order": 3},
    {"sigla": "CZ", "name": "Coca-Cola Zero", "price": 2.00, "sort_order": 4},
    {"sigla": "F", "name": "Fanta", "price": 2.00, "sort_order": 5},
    {"sigla": "S", "name": "Sprite", "price": 2.00, "sort_order": 6},
    {"sigla": "B", "name": "Peroni", "price": 2.50, "sort_order": 7},
    {"sigla": "VB", "name": "Vino bianco", "price": 2.50, "sort_order": 8},
    {"sigla": "VR", "name": "Vino rosso", "price": 2.50, "sort_order": 9},
]

# A carico is entered in "casse" (cases); each case contains this many units.
UNITS_PER_CASE = 24


class BeverageCaricoItem(BaseModel):
    sigla: str
    # Number of CASES (each case = UNITS_PER_CASE units).
    # Kept named `quantity` to not break existing API consumers; the value
    # semantically represents cases, and the stored record preserves both
    # `cases` and `units` for clarity in the history view.
    quantity: int


class BeverageCaricoCreate(BaseModel):
    supplier: str
    invoice_image_data: Optional[str] = None  # base64 - optional
    invoice_date: Optional[str] = None
    items: List[BeverageCaricoItem]
    notes: Optional[str] = None


async def _get_flaminio_restaurant_id() -> Optional[str]:
    r = await db.restaurants.find_one({"username": "Flaminio"}, {"_id": 0, "id": 1})
    return r["id"] if r else None


async def _effective_restaurant_id(request: Request, token_data: dict) -> str:
    """Restituisce il restaurant_id "effettivo" della chiamata.
    - Per Admin/Supervisor: usa l'header X-Restaurant-Id se presente (impersonificazione).
    - Per altri ruoli: usa sempre il restaurant_id del token.
    """
    can_impersonate = token_data.get("role") in ("admin",)
    if can_impersonate:
        rid = request.headers.get("X-Restaurant-Id") or request.headers.get("x-restaurant-id")
        if rid:
            return rid
    rid = token_data.get("restaurant_id")
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id non disponibile")
    return rid


async def _ensure_beverages_seeded():
    """Insert the beverage catalog the first time the backend starts."""
    existing = await db.beverages.count_documents({})
    if existing == 0:
        await db.beverages.insert_many([{**b} for b in BEVERAGES_CATALOG])
        logger.info(f"Seeded {len(BEVERAGES_CATALOG)} beverages")


class InvoiceCreate(BaseModel):
    supplier: str
    paid: bool = False
    control_code: Optional[str] = ""
    image_data: str  # Base64 encoded image
    invoice_date: str = None  # Date selected by user
    importo: Optional[float] = 0.0  # LEGACY: tenuto per i DDT vecchi già caricati
    ddt_number: Optional[str] = ""  # NEW: numero DDT (obbligatorio per i nuovi)

class InvoiceResponse(BaseModel):
    id: str
    restaurant_id: str
    supplier: str
    paid: bool
    control_code: Optional[str] = ""
    image_url: str
    created_at: str
    uploaded_by: str
    importo: Optional[float] = 0.0
    ddt_number: Optional[str] = ""

class OrderResponse(BaseModel):
    id: str
    order_number: int
    description: str
    restaurant_id: str
    status: str
    created_at: str
    timer_started: bool
    timer_start_time: Optional[str]
    timer_paused: bool
    timer_elapsed: int
    kitchen_completed: bool = False
    monitor_visible: bool = False
    hidden_generale: bool = False
    hidden_generale_timer: int = 0

class ProductCreate(BaseModel):
    name: str
    unit: str = ""
    supplier: str = ""
    quantity: int = 0
    image_data: str = ""  # Base64 on create, saved to disk

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    supplier: Optional[str] = None
    quantity: Optional[int] = None
    image_data: Optional[str] = None  # New image if provided

class ProductQuantityUpdate(BaseModel):
    quantity: int

# ==================== RICHIESTE MERCE (WAREHOUSE REQUESTS) ====================

class RichiestaItem(BaseModel):
    product_id: str
    product_name: str
    unit: str
    supplier: str = ""
    quantity: int

class RichiestaCreate(BaseModel):
    items: List[RichiestaItem]
    extra_note: Optional[str] = None

class RichiestaErrorReport(BaseModel):
    reason: str

# Indirizzi locali (DESTINATARIO del DDT)
LOCATION_ADDRESSES = {
    "Flaminio": {"address": "Piazzale Flaminio 10", "postal_code": "00196", "city": "Roma"},
    "Grazie": {"address": "Via delle Grazie 5", "postal_code": "00193", "city": "Roma"},
    "Largo di Brazzà": {"address": "Largo Pietro Di Brazzà 27", "postal_code": "00187", "city": "Roma"},
    "Brazza": {"address": "Largo Pietro Di Brazzà 27", "postal_code": "00187", "city": "Roma"},
}

MITTENTE_INFO = {
    "name": "Pastasciutta Srl",
    "address": "Via del Casale Santarelli, 125",
    "postal_code": "00118",
    "city": "Roma",
}

# ==================== CARICHI MAGAZZINO (INCOMING GOODS FROM SUPPLIERS) ====================

class CaricoItem(BaseModel):
    product_id: str
    product_name: str
    unit: str = ""
    quantity_added: int

class CaricoCreate(BaseModel):
    supplier_name: str
    ddt_number_fornitore: str
    photo_data: Optional[str] = None  # optional for suppliers without invoice (Derrate, ragù)
    fattura_data: Optional[str] = None  # optional base64 fattura
    items: List[CaricoItem]

class CaricoUpdate(BaseModel):
    supplier_name: Optional[str] = None
    ddt_number_fornitore: Optional[str] = None
    photo_data: Optional[str] = None  # optional on update
    fattura_data: Optional[str] = None  # optional on update
    items: Optional[List[CaricoItem]] = None

class FatturaUpload(BaseModel):
    fattura_data: str

# Auth helpers
def save_image_to_disk(base64_data: str, prefix: str) -> str:
    """Save base64 image to disk, return filename."""
    if not base64_data:
        return ""
    # Strip data URI prefix if present (e.g. data:image/jpeg;base64,)
    if "," in base64_data:
        header, data = base64_data.split(",", 1)
        # Detect extension from header
        ext = "jpg"
        if "png" in header:
            ext = "png"
        elif "webp" in header:
            ext = "webp"
        elif "gif" in header:
            ext = "gif"
    else:
        data = base64_data
        ext = "jpg"
    
    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(base64.b64decode(data))
    return filename

def create_token(restaurant_id: str, restaurant_name: str, role: str = "restaurant", username: str = "") -> str:
    payload = {
        "restaurant_id": restaurant_id,
        "restaurant_name": restaurant_name,
        "username": username or restaurant_name,
        "role": role,
        "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security), request: Request = None) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        # Solo "Federico" (supervisor) ha gli stessi privilegi operativi dell'Admin.
        # Altri supervisori restano col loro ruolo limitato.
        if payload.get("role") == "supervisor":
            payload["original_role"] = "supervisor"
            if payload.get("username") == "Federico":
                payload["role"] = "admin"
        # Admin (e Federico promosso) può agire come qualsiasi locale via header
        if payload.get("role") == "admin" and request:
            admin_restaurant_id = request.headers.get("X-Admin-Restaurant-Id")
            if admin_restaurant_id:
                payload["restaurant_id"] = admin_restaurant_id
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Pastasciutta Roma API", "version": "2026060108"}

@api_router.get("/version")
async def version_check():
    return {"version": "2026060108", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.get("/uploads/{filename}")
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
@api_router.post("/restaurants", response_model=RestaurantResponse)
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

@api_router.get("/restaurants", response_model=List[RestaurantResponse])
async def get_restaurants():
    restaurants = await db.restaurants.find({}, {"_id": 0, "password": 0}).to_list(100)
    return [RestaurantResponse(**r) for r in restaurants]

# Auth Routes
@api_router.post("/auth/login", response_model=LoginResponse)
@limiter.limit("10/minute")
async def login(request: Request, data: LoginRequest):
    restaurant = await db.restaurants.find_one({"username": data.username})
    
    if not restaurant or not pwd_context.verify(data.password, restaurant["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(restaurant["id"], restaurant["name"], restaurant.get("role", "restaurant"), restaurant.get("username", ""))
    
    return LoginResponse(
        token=token,
        restaurant=RestaurantResponse(
            id=restaurant["id"],
            name=restaurant["name"],
            username=restaurant["username"],
            location=restaurant["location"],
            created_at=restaurant["created_at"],
            role=restaurant.get("role", "restaurant")
        )
    )

@api_router.get("/auth/me", response_model=RestaurantResponse)
async def get_current_restaurant(token_data: dict = Depends(verify_token)):
    restaurant = await db.restaurants.find_one(
        {"id": token_data["restaurant_id"]},
        {"_id": 0, "password": 0}
    )
    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return RestaurantResponse(**restaurant)

@api_router.get("/admin/restaurants")
async def get_admin_restaurants(token_data: dict = Depends(verify_token)):
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "password": 0}
    ).to_list(100)
    return restaurants


@api_router.get("/admin/system-alerts")
async def get_system_alerts(token_data: dict = Depends(verify_token)):
    """Return unacknowledged system alerts (e.g. stale orders recovered at boot)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    alerts = await db.system_alerts.find(
        {"acknowledged": False},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"alerts": alerts}


@api_router.post("/admin/system-alerts/{alert_id}/acknowledge")
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


@api_router.get("/admin/diagnostics")
async def get_diagnostics(token_data: dict = Depends(verify_token)):
    """Live system diagnostics for the Admin dashboard.
    Reports per-restaurant WebSocket state, recent disconnect events,
    last 50 API calls and last 50 errors."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    now = datetime.now(timezone.utc)
    cutoff_1h = (now - timedelta(hours=1)).isoformat()

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

    # API calls (last 50, newest first)
    recent_calls = list(api_call_log)[-50:][::-1]
    recent_errors = list(api_error_log)[-50:][::-1]

    # Aggregate slow endpoints (>500ms) in the buffer
    slow_calls = [c for c in api_call_log if c.get("ms", 0) > 500]

    return {
        "server_time": now.isoformat(),
        "websockets": ws_state,
        "recent_calls": recent_calls,
        "recent_errors": recent_errors,
        "slow_calls_count": len(slow_calls),
        "buffer_size": len(api_call_log),
    }

@api_router.get("/admin/media-locali")
async def get_media_locali(token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    # Get all restaurants
    restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "password": 0}
    ).to_list(100)
    
    # Date range: same day last month to today.
    # NB: usare semplicemente `today.replace(month=today.month - 1)` esplode
    # ogni volta che il giorno corrente non esiste nel mese precedente
    # (es. 31 maggio → 31 aprile). Si clampa al massimo numero di giorni
    # del mese di destinazione.
    import calendar
    today = datetime.now(ROME_TZ).replace(hour=23, minute=59, second=59)
    if today.month > 1:
        prev_year, prev_month = today.year, today.month - 1
    else:
        prev_year, prev_month = today.year - 1, 12
    last_day_prev = calendar.monthrange(prev_year, prev_month)[1]
    from_date = today.replace(
        year=prev_year, month=prev_month, day=min(today.day, last_day_prev)
    )
    
    result = []
    
    # For each day in range
    current = today.replace(hour=0, minute=0, second=0, microsecond=0)
    from_start = from_date.replace(hour=0, minute=0, second=0, microsecond=0)
    
    while current >= from_start:
        day_start = current.astimezone(timezone.utc).isoformat()
        day_end = current.replace(hour=23, minute=59, second=59).astimezone(timezone.utc).isoformat()
        
        day_data = {"date": current.strftime("%d/%m/%Y"), "locations": {}}
        
        for rest in restaurants:
            # Check both orders and archived_orders for the highest order number
            max_order = 0
            
            # Active orders
            active = await db.orders.find(
                {"restaurant_id": rest["id"], "created_at": {"$gte": day_start, "$lte": day_end}},
                {"_id": 0, "order_number": 1}
            ).sort("order_number", -1).limit(1).to_list(1)
            if active:
                max_order = max(max_order, active[0]["order_number"])
            
            # Archived orders
            archived = await db.archived_orders.find(
                {"restaurant_id": rest["id"], "created_at": {"$gte": day_start, "$lte": day_end}},
                {"_id": 0, "order_number": 1}
            ).sort("order_number", -1).limit(1).to_list(1)
            if archived:
                max_order = max(max_order, archived[0]["order_number"])
            
            # Deletion logs (orders that were deleted)
            deleted = await db.deletion_logs.find(
                {"restaurant_id": rest["id"], "deleted_at": {"$gte": day_start, "$lte": day_end}},
                {"_id": 0, "order_number": 1}
            ).sort("order_number", -1).limit(1).to_list(1)
            if deleted:
                max_order = max(max_order, deleted[0].get("order_number", 0))
            
            day_data["locations"][rest["location"]] = max_order
        
        result.append(day_data)
        current -= timedelta(days=1)
    
    # Calculate averages per location, EXCLUDING days with 0/empty values
    # so empty cells in the table don't dilute the average.
    averages = {}
    for rest in restaurants:
        loc = rest["location"]
        values = []
        for d in result:
            v = d["locations"].get(loc)
            try:
                v_int = int(v) if v else 0
            except (TypeError, ValueError):
                v_int = 0
            if v_int > 0:
                values.append(v_int)
        averages[loc] = round(sum(values) / len(values), 2) if values else 0
    
    return {
        "locations": [r["location"] for r in restaurants],
        "averages": averages,
        "days": result
    }

# Order Routes
class OrderCreate(BaseModel):
    description: str
    order_number: Optional[int] = None

@api_router.post("/orders", response_model=OrderResponse)
async def create_order(data: OrderCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Two distinct flows:
    # (a) No order_number provided -> atomic $inc on counter (race-safe).
    # (b) Explicit order_number provided -> honour the cashier's choice.
    #     Uniqueness in active orders is enforced by the UNIQUE index on
    #     (restaurant_id, order_number); concurrent collisions raise
    #     DuplicateKeyError which we translate to 409. The counter is moved
    #     forward to MAX(current, requested) so subsequent auto-numbers stay
    #     consistent.
    if data.order_number and data.order_number > 0:
        requested = data.order_number
        # Honour the cashier's explicit choice: set the counter to the
        # requested number (forward OR backward). This lets the cashier
        # restart the day's numbering at will (e.g. "annulla tutto, riparto
        # da 1"). Concurrency safety against duplicates among ACTIVE orders
        # is enforced by the UNIQUE index (restaurant_id, order_number) on
        # the `orders` collection - any collision raises DuplicateKeyError
        # and is translated to HTTP 409 below.
        result = await db.restaurants.find_one_and_update(
            {"id": restaurant_id},
            {"$set": {"order_counter": requested}},
            return_document=True,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Restaurant not found")
        order_number = requested
    else:
        result = await db.restaurants.find_one_and_update(
            {"id": restaurant_id},
            {"$inc": {"order_counter": 1}},
            return_document=True,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Restaurant not found")
        order_number = result["order_counter"]
    
    order_id = str(uuid.uuid4())
    
    order = {
        "id": order_id,
        "order_number": order_number,
        "description": data.description,  # Keep original case
        "restaurant_id": restaurant_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timer_started": False,
        "timer_start_time": None,
        "timer_paused": False,
        "timer_elapsed": 0,
        "kitchen_completed": False,
        "monitor_visible": False,
        "hidden_generale": False
    }
    
    try:
        await db.orders.insert_one(order)
    except DuplicateKeyError:
        # The unique index (restaurant_id, order_number) rejected the insert
        # because that number is already in use among active orders. This can
        # happen if the cashier explicitly requests a number that's currently
        # active, or if two cashiers race on the same explicit number.
        raise HTTPException(
            status_code=409,
            detail=f"Numero #{order_number} già in uso tra gli ordini attivi"
        )
    
    # Backup to file for Flaminio
    restaurant = await db.restaurants.find_one({"id": restaurant_id})
    if restaurant and restaurant.get("location") == "Flaminio":
        backup_file = UPLOADS_DIR / "backup_flaminio.txt"
        with open(backup_file, "a") as f:
            f.write(f"{order_number} {data.description}\n")
    
    # Broadcast to all connected clients
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_created",
        "order": {k: v for k, v in order.items() if k != "_id"}
    })
    
    return OrderResponse(**{k: v for k, v in order.items() if k != "_id"})

@api_router.get("/orders", response_model=List[OrderResponse])
async def get_orders(
    status: Optional[str] = "pending",
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]

    # Belt-and-suspenders: only serve orders created in the CURRENT Rome day.
    # Even if `midnight_reset` failed silently and left stale rows in `db.orders`,
    # this filter prevents yesterday's high-numbered orders from leaking into the
    # Tablet Generale during today's service.
    start_utc, end_utc = _today_rome_bounds_utc()
    query = {
        "restaurant_id": restaurant_id,
        "created_at": {"$gte": start_utc, "$lt": end_utc},
    }
    if status and status != "all":
        query["status"] = status

    orders = await db.orders.find(query, {"_id": 0}).sort("order_number", -1).to_list(500)
    return [OrderResponse(**o) for o in orders]


@api_router.get("/orders/next-number")
async def get_next_order_number(token_data: dict = Depends(verify_token)):
    """Return the next order_number that would be assigned for this restaurant.
    Reads `order_counter` directly from the DB (authoritative). Used by Cassa
    to display the upcoming number without relying on a possibly-pruned local
    pending list (which would otherwise reuse already-used numbers)."""
    restaurant_id = token_data["restaurant_id"]
    rest = await db.restaurants.find_one(
        {"id": restaurant_id}, {"_id": 0, "order_counter": 1}
    )
    if not rest:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return {"next_number": (rest.get("order_counter", 0) or 0) + 1}


@api_router.get("/orders/today-paste-list")
async def get_today_paste_list(
    request: Request,
    token_data: dict = Depends(verify_token),
):
    """Return ALL pasta orders for the CURRENT Rome day of the effective
    restaurant (supports Admin/Supervisor impersonation via X-Restaurant-Id).

    Used by ReportBetaPage to auto-populate the paste column so that the
    cashier does not need to manually paste the list.

    Includes orders with hidden_generale=True (they were still sold/cashed).
    """
    rid = await _effective_restaurant_id(request, token_data)
    start_utc, end_utc = _today_rome_bounds_utc()
    cursor = db.orders.find(
        {
            "restaurant_id": rid,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        },
        {"_id": 0, "order_number": 1, "description": 1, "hidden_generale": 1},
    ).sort("order_number", 1)
    docs = await cursor.to_list(2000)
    items = [
        {
            "order_number": d.get("order_number"),
            "description": (d.get("description") or "").strip(),
            "hidden_generale": bool(d.get("hidden_generale", False)),
        }
        for d in docs
    ]
    return {"items": items, "count": len(items)}

@api_router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: str, token_data: dict = Depends(verify_token)):
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderResponse(**order)

@api_router.patch("/orders/{order_id}", response_model=OrderResponse)
async def update_order(
    order_id: str,
    data: OrderUpdate,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    # Get original order for logging
    original_order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not original_order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    # Pre-check: if order_number is being changed, ensure it isn't already used
    # by another active order of the same restaurant. The unique compound index
    # on (restaurant_id, order_number) is the last line of defense, but we
    # surface a clean 400 message here so the cashier knows what happened
    # instead of seeing 500 retries.
    if "order_number" in update_data:
        new_number = int(update_data["order_number"])
        if new_number != int(original_order.get("order_number", -1)):
            clash = await db.orders.find_one(
                {
                    "restaurant_id": restaurant_id,
                    "order_number": new_number,
                    "id": {"$ne": order_id},
                },
                {"_id": 0, "id": 1},
            )
            if clash:
                raise HTTPException(
                    status_code=400,
                    detail=f"Numero {new_number} già usato per un altro ordine attivo di questo locale. Scegli un altro numero.",
                )

    # Log modification if description changed
    if "description" in update_data and update_data["description"] != original_order["description"]:
        modification_log = {
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "order_number": original_order["order_number"],
            "old_description": original_order["description"],
            "new_description": update_data["description"],
            "restaurant_id": restaurant_id,
            "modified_at": datetime.now(timezone.utc).isoformat()
        }
        await db.modification_logs.insert_one(modification_log)

    try:
        result = await db.orders.find_one_and_update(
            {"id": order_id, "restaurant_id": restaurant_id},
            {"$set": update_data},
            return_document=True
        )
    except DuplicateKeyError:
        # Race: another concurrent request took the same order_number between
        # our pre-check and the find_one_and_update. Fall back to the same
        # human-readable error.
        raise HTTPException(
            status_code=400,
            detail=f"Numero {update_data.get('order_number')} già usato per un altro ordine attivo di questo locale. Scegli un altro numero.",
        )

    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    # Broadcast update
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return OrderResponse(**order_response)

@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Get the order first to log it
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Log the deletion
    deletion_log = {
        "id": str(uuid.uuid4()),
        "order_number": order["order_number"],
        "description": order["description"],
        "restaurant_id": restaurant_id,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "original_created_at": order["created_at"]
    }
    await db.deletion_logs.insert_one(deletion_log)
    
    # Delete the order
    result = await db.orders.delete_one(
        {"id": order_id, "restaurant_id": restaurant_id}
    )
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Recompute order_counter as the MAX across:
    # - active orders (remaining)
    # - archived orders of today
    # - deletion logs of today
    # This guarantees the counter NEVER goes backwards during the day,
    # preventing reused numbers and duplicated orders on tablets/Excel.
    new_counter = await _highest_order_number_today(restaurant_id)
    await db.restaurants.update_one(
        {"id": restaurant_id},
        {"$set": {"order_counter": new_counter}}
    )
    
    # Broadcast deletion
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_deleted",
        "order_id": order_id
    })
    
    return {"message": "Order deleted"}

@api_router.post("/orders/{order_id}/complete")
async def complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat()
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order completed"}

@api_router.post("/orders/{order_id}/kitchen-complete")
async def kitchen_complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"kitchen_completed": True}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order kitchen completed"}

@api_router.post("/orders/{order_id}/hide-generale")
async def hide_from_generale(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Calculate frozen timer value at this moment
    frozen_timer = 0
    if order.get("timer_started"):
        if order.get("timer_paused"):
            frozen_timer = order.get("timer_elapsed", 0)
        elif order.get("timer_start_time"):
            start = datetime.fromisoformat(order["timer_start_time"])
            now = datetime.now(timezone.utc)
            frozen_timer = int((now - start).total_seconds()) + (order.get("timer_elapsed", 0))
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"hidden_generale": True, "hidden_generale_timer": frozen_timer, "monitor_visible": False}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")

    # Audit silenzioso: tracciamo CHI ha nascosto QUALE ordine e QUANDO.
    # Serve a diagnosticare segnalazioni del tipo "paste sparite da sole" sui
    # tablet Generale. La collezione `generale_hide_log` è admin-only.
    try:
        await db.generale_hide_log.insert_one({
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "order_number": result.get("order_number"),
            "order_description": result.get("description"),
            "restaurant_id": restaurant_id,
            "restaurant_location": RESTAURANT_LOCATION_CACHE.get(restaurant_id),
            "by_user_id": token_data.get("user_id") or token_data.get("sub"),
            "by_username": token_data.get("username"),
            "by_role": token_data.get("original_role") or token_data.get("role"),
            "hidden_at": datetime.now(timezone.utc).isoformat(),
            "frozen_timer": frozen_timer,
        })
    except Exception as e:
        logger.warning(f"[HIDE_LOG] could not log hide_generale: {e}")

    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order hidden from generale"}

@api_router.post("/orders/{order_id}/monitor-toggle")
async def toggle_monitor_visibility(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_val = not order.get("monitor_visible", False)
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"monitor_visible": new_val}},
        return_document=True
    )
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": f"Monitor visibility: {new_val}", "monitor_visible": new_val}

@api_router.post("/orders/{order_id}/timer/start")
async def start_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": True,
            "timer_start_time": datetime.now(timezone.utc).isoformat(),
            "timer_paused": False
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer started", "timer_start_time": result["timer_start_time"]}

@api_router.post("/orders/{order_id}/timer/pause")
async def pause_timer(order_id: str, elapsed: int = 0, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_paused": True,
            "timer_elapsed": elapsed
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer paused"}

@api_router.post("/orders/{order_id}/timer/reset")
async def reset_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": False,
            "timer_start_time": None,
            "timer_paused": False,
            "timer_elapsed": 0
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer reset"}

# Logs endpoints
@api_router.get("/logs/deletions")
async def get_deletion_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Today's deletions — Rome operating day
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    logs = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)

    return {"count": len(logs), "logs": logs}

@api_router.get("/logs/modifications")
async def get_modification_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Today's modifications — Rome operating day
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    logs = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)

    return {"count": len(logs), "logs": logs}

@api_router.get("/logs/today")
async def get_today_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]

    # Cut-off at midnight in Rome timezone (operating day), converted to UTC
    # because logs are stored with UTC isoformat strings.
    now_rome = datetime.now(ROME_TZ)
    midnight_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_utc = midnight_rome.astimezone(timezone.utc)

    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)

    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start_utc.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)

    return {
        "deletions": {"count": len(deletions), "logs": deletions},
        "modifications": {"count": len(modifications), "logs": modifications}
    }

@api_router.get("/report/daily")
async def get_daily_report(date: str = None, token_data: dict = Depends(verify_token)):
    """Get daily report with all orders and their status changes.
    `date` is interpreted as an Italian (Europe/Rome) calendar day."""
    restaurant_id = token_data["restaurant_id"]

    # Parse date string as Rome-local day; default to today Rome.
    if date:
        try:
            parsed = datetime.fromisoformat(date.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                day_rome = parsed.replace(tzinfo=ROME_TZ, hour=0, minute=0, second=0, microsecond=0)
            else:
                day_rome = parsed.astimezone(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        except Exception:
            day_rome = datetime.now(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        day_rome = datetime.now(ROME_TZ).replace(hour=0, minute=0, second=0, microsecond=0)

    day_start = day_rome.astimezone(timezone.utc)
    day_end = (day_rome + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc)
    
    # Get all orders created on this day (including completed ones)
    # Check both active orders and archived orders
    orders = await db.orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(None)
    
    archived = await db.archived_orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(None)
    
    # Merge, avoiding duplicates by order id
    seen_ids = {o["id"] for o in orders}
    for a in archived:
        if a["id"] not in seen_ids:
            orders.append(a)
    orders.sort(key=lambda x: x["order_number"])
    
    # Get deletions for this day
    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(None)
    
    # Get modifications for this day
    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(None)
    
    # Build report items - combine orders and deleted orders
    report_items = []
    
    # Add existing orders
    for order in orders:
        item = {
            "order_number": order["order_number"],
            "description": order["description"],
            "created_at": order["created_at"],
            "completed_at": None,
            "deleted_at": None,
            "modified_at": None,
            "status": order["status"]
        }
        
        # Check if order was completed (status changed)
        if order["status"] == "completed":
            # We don't have exact completion time stored, so we'll use status
            item["completed_at"] = order.get("completed_at")
        
        # Check for modifications
        order_mods = [m for m in modifications if m.get("order_id") == order["id"]]
        if order_mods:
            # Get the latest modification
            latest_mod = max(order_mods, key=lambda x: x["modified_at"])
            item["modified_at"] = latest_mod["modified_at"]
        
        report_items.append(item)
    
    # Add deleted orders (they won't be in orders collection anymore)
    for deletion in deletions:
        # Check if this order number is already in report (shouldn't be, but just in case)
        existing = next((r for r in report_items if r["order_number"] == deletion["order_number"]), None)
        if not existing:
            item = {
                "order_number": deletion["order_number"],
                "description": deletion["description"],
                "created_at": deletion["original_created_at"],
                "completed_at": None,
                "deleted_at": deletion["deleted_at"],
                "modified_at": None,
                "status": "deleted"
            }
            
            # Check for modifications before deletion
            order_mods = [m for m in modifications if m.get("order_number") == deletion["order_number"]]
            if order_mods:
                latest_mod = max(order_mods, key=lambda x: x["modified_at"])
                item["modified_at"] = latest_mod["modified_at"]
            
            report_items.append(item)
    
    # Sort by order number
    report_items.sort(key=lambda x: x["order_number"])
    
    return {
        "date": day_rome.date().isoformat(),
        "total_orders": len(report_items),
        "completed": len([r for r in report_items if r["status"] == "completed"]),
        "deleted": len([r for r in report_items if r["status"] == "deleted"]),
        "pending": len([r for r in report_items if r["status"] == "pending"]),
        "items": report_items
    }

# Seed data endpoint for initial setup
@api_router.post("/seed")
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
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0
            })
        # Check if Admin exists, add if not
        admin = await db.restaurants.find_one({"username": "Admin"})
        if not admin:
            await db.restaurants.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Amministratore",
                "username": "Admin",
                "password": pwd_context.hash("Pastasciutt4!"),
                "location": "Amministrazione",
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0
            })
        return {"message": "Database già configurato", "accounts": [
            {"username": "Flaminio", "location": "Flaminio"},
            {"username": "Grazie", "location": "Grazie"},
            {"username": "Brazza", "location": "Largo di Brazzà"},
            {"username": "Magazziniere", "location": "Magazzino"},
            {"username": "Admin", "location": "Amministrazione"},
        ]}
    
    # Create the 3 restaurants + magazziniere
    restaurants = [
        {"name": "Pastasciutta Roma", "username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino", "role": "magazzino"},
        {"name": "Amministratore", "username": "Admin", "password": "Pastasciutt4!", "location": "Amministrazione", "role": "admin"},
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
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order_counter": 0
        })
    
    return {"message": "Credenziali create", "accounts": [
        {"username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio"},
        {"username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie"},
        {"username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà"},
        {"username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino"},
    ]}

# WebSocket endpoint
@app.websocket("/api/ws/{restaurant_id}")
async def websocket_endpoint(websocket: WebSocket, restaurant_id: str):
    await manager.connect(websocket, restaurant_id)
    
    # Server-side heartbeat: detect dead connections
    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(30)
                await websocket.send_json({"type": "ping"})
        except Exception:
            pass
    
    heartbeat_task = asyncio.create_task(heartbeat())
    
    try:
        while True:
            data = await websocket.receive_text()
            manager.touch(websocket)
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurant_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, restaurant_id)
    finally:
        heartbeat_task.cancel()

# ==================== INVOICES (FATTURE) ====================

def _today_rome_utc_range():
    """Returns (start_utc_iso, end_utc_iso) for today's Rome operating day."""
    now_rome = datetime.now(ROME_TZ)
    day_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = day_rome.astimezone(timezone.utc).isoformat()
    end_utc = (day_rome + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc).isoformat()
    return start_utc, end_utc


@api_router.post("/invoices")
async def create_invoice(data: InvoiceCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]

    # Codice di controllo: ora opzionale. Verifichiamo duplicati nel giorno
    # solo se l'utente lo specifica esplicitamente, altrimenti accettiamo
    # qualsiasi numero di fatture.
    if data.control_code and data.control_code.strip():
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.invoices.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")
    
    invoice_id = str(uuid.uuid4())
    
    # Save image to disk instead of DB
    image_filename = save_image_to_disk(data.image_data, "fattura")
    
    invoice = {
        "id": invoice_id,
        "restaurant_id": restaurant_id,
        "supplier": data.supplier,
        "paid": data.paid,
        "control_code": data.control_code,
        "image_file": image_filename,
        "invoice_date": data.invoice_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name,
        "importo": float(data.importo or 0),
        "ddt_number": (data.ddt_number or "").strip(),
    }
    
    await db.invoices.insert_one(invoice)
    
    return {
        "id": invoice_id,
        "message": "Fattura caricata con successo"
    }

@api_router.get("/invoices")
async def get_invoices(
    date: str = None,
    supplier: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Filter by date
    if date:
        day_start = datetime.fromisoformat(date.replace('Z', '+00:00')).replace(hour=0, minute=0, second=0)
        day_end = day_start.replace(hour=23, minute=59, second=59)
        query["created_at"] = {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
    
    # Filter by supplier
    if supplier and supplier != "all":
        query["supplier"] = supplier
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Build image_url from file or keep legacy base64
    for inv in invoices:
        if inv.get("image_file"):
            inv["image_data"] = f"/api/uploads/{inv['image_file']}"
        inv.pop("image_file", None)
    
    return invoices

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if invoice.get("image_file"):
        invoice["image_data"] = f"/api/uploads/{invoice['image_file']}"
    invoice.pop("image_file", None)
    return invoice

@api_router.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, paid: bool, token_data: dict = Depends(verify_token)):
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"$set": {"paid": paid}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"message": "Fattura aggiornata"}

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": invoice_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.invoices.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    await db.invoices.delete_one({"id": invoice_id})
    return {"message": "Fattura eliminata"}

@api_router.get("/suppliers")
async def get_suppliers(token_data: dict = Depends(verify_token)):
    """Get all suppliers (shared across all restaurants)"""
    suppliers = await db.suppliers.find(
        {},
        {"_id": 0}
    ).sort("name", 1).to_list(100)
    
    return suppliers

@api_router.post("/suppliers")
async def create_supplier(name: str, token_data: dict = Depends(verify_token)):
    """Add a new supplier (shared across all restaurants)"""
    # Check if exists
    existing = await db.suppliers.find_one({
        "name": {"$regex": f"^{name}$", "$options": "i"}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Fornitore già esistente")
    
    supplier_id = str(uuid.uuid4())
    await db.suppliers.insert_one({
        "id": supplier_id,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"id": supplier_id, "name": name}

@api_router.patch("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, name: str, token_data: dict = Depends(verify_token)):
    """Update supplier name (affects all restaurants)"""
    result = await db.suppliers.find_one_and_update(
        {"id": supplier_id},
        {"$set": {"name": name}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"id": supplier_id, "name": name}

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, token_data: dict = Depends(verify_token)):
    """Delete a supplier (affects all restaurants)"""
    result = await db.suppliers.delete_one({
        "id": supplier_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"message": "Fornitore eliminato"}


# ==================== PRODUCTS (WAREHOUSE) ====================

@api_router.get("/products")
async def get_products(supplier: str = None, token_data: dict = Depends(verify_token)):
    """Get all warehouse products (shared across restaurants)"""
    query = {}
    if supplier:
        query["supplier"] = supplier
    products = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    for p in products:
        if p.get("image_file"):
            p["image_url"] = f"/api/uploads/{p['image_file']}"
        elif p.get("image_data") and p["image_data"].startswith("data:"):
            p["image_url"] = p["image_data"]
        else:
            p["image_url"] = ""
        p.pop("image_file", None)
        p.pop("image_data", None)
        # Ensure quantity field exists
        if "quantity" not in p:
            p["quantity"] = 0
    return products

@api_router.post("/products")
async def create_product(data: ProductCreate, token_data: dict = Depends(verify_token)):
    """Create a warehouse product (shared)"""
    product_id = str(uuid.uuid4())
    
    image_filename = ""
    if data.image_data:
        image_filename = save_image_to_disk(data.image_data, "product")
    
    product = {
        "id": product_id,
        "name": data.name,
        "unit": data.unit,
        "supplier": data.supplier,
        "quantity": data.quantity,
        "image_file": image_filename,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.products.insert_one(product)

    # Log initial stock as opening movement (cause = stock_iniziale)
    initial_qty = int(data.quantity or 0)
    if initial_qty > 0:
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()),
            "product_id": product_id,
            "product_name": data.name,
            "delta": initial_qty,
            "balance_after": initial_qty,
            "cause": "stock_iniziale",
            "ref_type": "admin",
            "ref_id": product_id,
            "user_id": token_data.get("restaurant_id", ""),
            "user_name": token_data.get("restaurant_name", ""),
            "user_role": token_data.get("role", ""),
            "note": "Creazione prodotto",
            "timestamp": product["created_at"],
        })

    response = {k: v for k, v in product.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = f"/api/uploads/{response['image_file']}"
    else:
        response["image_url"] = ""
    response.pop("image_file", None)
    
    return response

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, token_data: dict = Depends(verify_token)):
    """Update a warehouse product"""
    update_fields = {}
    if data.name is not None:
        update_fields["name"] = data.name
    if data.unit is not None:
        update_fields["unit"] = data.unit
    if data.supplier is not None:
        update_fields["supplier"] = data.supplier
    quantity_change_requested = data.quantity is not None
    if quantity_change_requested:
        update_fields["quantity"] = data.quantity
    if data.image_data:
        old_product = await db.products.find_one({"id": product_id})
        if old_product and old_product.get("image_file"):
            old_path = UPLOADS_DIR / old_product["image_file"]
            if old_path.exists():
                old_path.unlink()
        update_fields["image_file"] = save_image_to_disk(data.image_data, "product")
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")

    # If quantity was explicitly provided, log the delta as a forzatura.
    if quantity_change_requested:
        old_doc = await db.products.find_one({"id": product_id}, {"_id": 0, "quantity": 1, "name": 1})
        if not old_doc:
            raise HTTPException(status_code=404, detail="Prodotto non trovato")
        new_qty = max(0, int(data.quantity))
        update_fields["quantity"] = new_qty
        delta = new_qty - int(old_doc.get("quantity", 0))
        result = await db.products.find_one_and_update(
            {"id": product_id},
            {"$set": update_fields},
            return_document=True,
        )
        if delta != 0:
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()),
                "product_id": product_id,
                "product_name": old_doc.get("name", ""),
                "delta": delta,
                "balance_after": new_qty,
                "cause": "forzatura_admin",
                "ref_type": "admin",
                "ref_id": product_id,
                "user_id": token_data.get("restaurant_id", ""),
                "user_name": token_data.get("restaurant_name", ""),
                "user_role": token_data.get("role", ""),
                "note": "PUT /products",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
    else:
        result = await db.products.find_one_and_update(
            {"id": product_id},
            {"$set": update_fields},
            return_document=True
        )
    
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    
    response = {k: v for k, v in result.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = f"/api/uploads/{response['image_file']}"
    else:
        response["image_url"] = ""
    response.pop("image_file", None)
    if "quantity" not in response:
        response["quantity"] = 0
    
    return response

@api_router.patch("/products/{product_id}/quantity")
async def update_product_quantity(product_id: str, data: ProductQuantityUpdate, token_data: dict = Depends(verify_token)):
    """Force stock override. ADMIN ONLY (Inventario / Forza il sistema)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo l'Admin può forzare le quantità")
    result = await _set_stock_absolute(
        product_id=product_id,
        new_quantity=max(0, data.quantity),
        cause="forzatura_admin",
        ref_type="admin",
        ref_id=product_id,
        token_data=token_data,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    return {"id": product_id, "quantity": result.get("quantity", 0)}


# ==================== STOCK MOVEMENTS LEDGER - QUERY ENDPOINTS ====================

@api_router.get("/products/{product_id}/movements")
async def get_product_movements(
    product_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    cause: Optional[str] = None,
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """
    Cronologia movimenti di stock per un prodotto. Magazziniere/Admin.
    Filtri opzionali:
      - date_from / date_to (YYYY-MM-DD, inclusivi)
      - cause: carico | carico_modifica | carico_cancellato | evasione |
               forzatura_admin | stock_iniziale
    """
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query: Dict = {"product_id": product_id}
    if date_from or date_to:
        ts: Dict = {}
        if date_from:
            ts["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                ts["$lt"] = dt_to.strftime("%Y-%m-%dT00:00:00")
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato date_to non valido")
        query["timestamp"] = ts
    if cause:
        query["cause"] = cause
    docs = await db.stock_movements.find(query, {"_id": 0}).sort("timestamp", -1).to_list(max(1, min(limit, 5000)))
    # Bilancio corrente
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "name": 1, "quantity": 1})
    return {
        "product_id": product_id,
        "product_name": product.get("name", "") if product else "",
        "current_quantity": int(product.get("quantity", 0)) if product else 0,
        "count": len(docs),
        "movements": docs,
    }


@api_router.get("/stock-movements")
async def list_stock_movements(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    cause: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """Cronologia globale di tutti i movimenti. Magazziniere/Admin."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query: Dict = {}
    if date_from or date_to:
        ts: Dict = {}
        if date_from:
            ts["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                ts["$lt"] = dt_to.strftime("%Y-%m-%dT00:00:00")
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato date_to non valido")
        query["timestamp"] = ts
    if cause:
        query["cause"] = cause
    if user_id:
        query["user_id"] = user_id
    docs = await db.stock_movements.find(query, {"_id": 0}).sort("timestamp", -1).to_list(max(1, min(limit, 5000)))
    return {"count": len(docs), "movements": docs}

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, token_data: dict = Depends(verify_token)):
    """Delete a warehouse product"""
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    
    if product.get("image_file"):
        old_path = UPLOADS_DIR / product["image_file"]
        if old_path.exists():
            old_path.unlink()
    
    await db.products.delete_one({"id": product_id})
    return {"message": "Prodotto eliminato"}

# ==================== RICHIESTE MERCE (WAREHOUSE REQUESTS) - ENDPOINTS ====================

async def _get_next_ddt_number() -> int:
    """Atomic counter for DDT numbers (globale across all locations)."""
    result = await db.counters.find_one_and_update(
        {"_id": "ddt_number"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    return int(result["value"])

async def _enrich_richiesta(r: dict) -> dict:
    """Attach restaurant info + clean _id for DDT display."""
    r = {k: v for k, v in r.items() if k != "_id"}
    rest = await db.restaurants.find_one({"id": r.get("restaurant_id")}, {"_id": 0, "password": 0})
    if rest:
        r["restaurant_name"] = rest.get("name", "")
        r["restaurant_location"] = rest.get("location", "")
        loc = rest.get("location", "")
        addr = LOCATION_ADDRESSES.get(loc, {"address": loc, "postal_code": "", "city": ""})
        r["destinatario"] = {
            "name": loc,
            "address": addr["address"],
            "postal_code": addr["postal_code"],
            "city": addr["city"],
        }
    r["mittente"] = MITTENTE_INFO
    return r

@api_router.get("/warehouse/products")
async def get_warehouse_products_for_request(token_data: dict = Depends(verify_token)):
    """
    Product list for 'Nuova richiesta merce'. Each product carries:
      - quantity (stock presente a magazzino)
      - real_quantity = quantity - sum(pending requests from all locations for today)
      - image_url, unit, supplier
    """
    # Fetch all products
    products = await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(1000)

    # Compute total pending quantities per product across all pending (not yet evase) requests
    pending_agg = await db.richieste.aggregate([
        {"$match": {"status": "pending"}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.product_id", "total": {"$sum": "$items.quantity"}}},
    ]).to_list(5000)
    pending_map = {p["_id"]: p["total"] for p in pending_agg}

    for p in products:
        if p.get("image_file"):
            p["image_url"] = f"/api/uploads/{p['image_file']}"
        elif p.get("image_data") and p["image_data"].startswith("data:"):
            p["image_url"] = p["image_data"]
        else:
            p["image_url"] = ""
        p.pop("image_file", None)
        p.pop("image_data", None)
        qty = int(p.get("quantity", 0) or 0)
        pending = int(pending_map.get(p["id"], 0))
        p["quantity"] = qty
        p["real_quantity"] = max(0, qty - pending)
    return products

@api_router.post("/richieste")
async def create_richiesta(data: RichiestaCreate, token_data: dict = Depends(verify_token)):
    """Locale (or admin impersonating a locale) creates a new request."""
    if token_data.get("role") == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non può creare richieste")
    if not data.items and not (data.extra_note and data.extra_note.strip()):
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto o un extra")

    restaurant_id = token_data["restaurant_id"]
    restaurant = await db.restaurants.find_one({"id": restaurant_id}, {"_id": 0, "password": 0})
    if not restaurant:
        raise HTTPException(status_code=404, detail="Locale non trovato")

    # Filter out zero-quantity items
    clean_items = [i.dict() for i in data.items if i.quantity and i.quantity > 0]
    extra_note = (data.extra_note or "").strip()
    if not clean_items and not extra_note:
        raise HTTPException(status_code=400, detail="Nessuna quantità richiesta")

    ddt_number = await _get_next_ddt_number()
    richiesta_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    # Dispatch date = day AFTER creation, in Europe/Rome time.
    # The DDT is created the day before the goods are physically transported,
    # so the printed DDT date reflects the actual transport day.
    now_rome = datetime.now(ROME_TZ)
    dispatch_rome = now_rome + timedelta(days=1)
    dispatch_date_iso = dispatch_rome.replace(hour=12, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()

    doc = {
        "id": richiesta_id,
        "ddt_number": ddt_number,
        "restaurant_id": restaurant_id,
        "restaurant_location": restaurant.get("location", ""),
        "items": clean_items,
        "extra_note": extra_note,
        "status": "pending",
        "created_at": now_iso,
        "dispatch_date": dispatch_date_iso,
        "evasa_at": None,
        "confermata_at": None,
    }
    await db.richieste.insert_one(doc)
    return await _enrich_richiesta(doc)

@api_router.get("/richieste")
async def list_richieste(token_data: dict = Depends(verify_token)):
    """List requests for the current restaurant (pending + evase + confermate)."""
    restaurant_id = token_data["restaurant_id"]
    docs = await db.richieste.find(
        {"restaurant_id": restaurant_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return docs

@api_router.get("/richieste/pending-all")
async def list_all_pending(token_data: dict = Depends(verify_token)):
    """Magazziniere only: all non-confermate across all restaurants (pending + evase)."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    docs = await db.richieste.find(
        {"status": {"$in": ["pending", "evasa"]}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    # Attach restaurant location
    for d in docs:
        if not d.get("restaurant_location"):
            rest = await db.restaurants.find_one({"id": d.get("restaurant_id")}, {"_id": 0})
            if rest:
                d["restaurant_location"] = rest.get("location", "")
    return docs

@api_router.get("/richieste/history-all")
async def list_history_all(token_data: dict = Depends(verify_token)):
    """Magazziniere only: confermate + errori (storico)."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    docs = await db.richieste.find(
        {"status": {"$in": ["confermata", "errore"]}}, {"_id": 0}
    ).sort([("confermata_at", -1), ("error_reported_at", -1)]).limit(200).to_list(200)
    for d in docs:
        if not d.get("restaurant_location"):
            rest = await db.restaurants.find_one({"id": d.get("restaurant_id")}, {"_id": 0})
            if rest:
                d["restaurant_location"] = rest.get("location", "")
    return docs

@api_router.get("/richieste/{richiesta_id}")
async def get_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Get single request with MITTENTE/DESTINATARIO populated for DDT view."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    # Access control: restaurant can only see its own; magazziniere/admin can see all
    role = token_data.get("role")
    if role not in ("magazzino", "admin") and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return await _enrich_richiesta(doc)

@api_router.patch("/richieste/{richiesta_id}")
async def update_richiesta(
    richiesta_id: str,
    data: RichiestaCreate,
    token_data: dict = Depends(verify_token),
):
    """Edit a pending richiesta. Only the requesting locale or an admin can
    modify it, and only within 20 minutes from creation (admin bypasses).
    A request that has already been evasa/confermata cannot be modified."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    is_admin = role == "admin"
    is_owner = doc.get("restaurant_id") == token_data["restaurant_id"]
    if not (is_admin or is_owner):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già evasa o confermata, non modificabile")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"])
            if (datetime.now(timezone.utc) - created).total_seconds() > 20 * 60:
                raise HTTPException(status_code=403, detail="Modificabile solo entro 20 minuti dalla creazione")
        except (KeyError, ValueError):
            raise HTTPException(status_code=400, detail="Data creazione non valida")
    # Validate items (same logic as create)
    clean_items = [i.dict() for i in data.items if i.quantity and i.quantity > 0]
    extra_note = (data.extra_note or "").strip()
    if not clean_items and not extra_note:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto o un extra")
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {
            "items": clean_items,
            "extra_note": extra_note,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        return_document=True,
    )
    return await _enrich_richiesta(updated)


@api_router.patch("/richieste/{richiesta_id}/evade")
async def evade_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Magazziniere marks the request as fulfilled. Decrements product stock."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo il magazziniere può evadere")
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="La richiesta non è in stato 'pending'")

    # Decrement stock atomically + log movement
    for item in doc.get("items", []):
        qty = int(item.get("quantity", 0))
        if qty:
            await _apply_stock_delta(
                product_id=item["product_id"],
                delta=-qty,
                cause="evasione",
                ref_type="richiesta",
                ref_id=richiesta_id,
                token_data=token_data,
                note=f"DDT {doc.get('ddt_number', '')} -> {doc.get('restaurant_location', '')}",
            )
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {"status": "evasa", "evasa_at": now_iso}},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@api_router.patch("/richieste/{richiesta_id}/conferma")
async def conferma_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Locale (or admin) confirms reception of the goods."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non conferma")
    if role != "admin" and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "evasa":
        raise HTTPException(status_code=400, detail="La richiesta deve essere evasa prima di confermarla")
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {"status": "confermata", "confermata_at": now_iso}},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@api_router.patch("/richieste/{richiesta_id}/errore")
async def segnala_errore_richiesta(richiesta_id: str, data: RichiestaErrorReport, token_data: dict = Depends(verify_token)):
    """Locale (or admin) flags the request as 'errore' (wrong/incomplete delivery)."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non segnala errori")
    if role != "admin" and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "evasa":
        raise HTTPException(status_code=400, detail="Puoi segnalare l'errore solo su richieste evase")
    if not data.reason or not data.reason.strip():
        raise HTTPException(status_code=400, detail="Spiega il motivo dell'errore")
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {
            "status": "errore",
            "error_reason": data.reason.strip(),
            "error_reported_at": now_iso,
        }},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@api_router.delete("/richieste/{richiesta_id}")
async def delete_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Locale cancella una richiesta che ha creato (solo se pending). Admin può cancellare qualsiasi."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non può cancellare")
    if role != "admin":
        if doc.get("restaurant_id") != token_data["restaurant_id"]:
            raise HTTPException(status_code=403, detail="Non autorizzato")
        if doc.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Puoi cancellare solo richieste non ancora evase")
    await db.richieste.delete_one({"id": richiesta_id})
    return {"message": "Richiesta cancellata"}


# ==================== CARICHI MAGAZZINO - ENDPOINTS ====================

# ---- Stock movements ledger ----
# Every change to products.quantity is logged in `stock_movements` for audit.
async def _apply_stock_delta(
    product_id: str,
    delta: int,
    cause: str,
    ref_type: str,
    ref_id: str,
    token_data: dict,
    note: str = "",
) -> Optional[int]:
    """
    Atomically apply +/- delta to product.quantity AND log the movement.
    Returns the new balance (post-mutation) or None if product not found.

    `cause`:    one of "carico", "carico_modifica", "carico_cancellato",
                       "evasione", "forzatura_admin", "stock_iniziale".
    `ref_type`: "carico" | "richiesta" | "admin" | "backfill".
    `ref_id`:   id of the source document (carico_id, richiesta_id, etc).
    """
    if delta == 0:
        return None
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$inc": {"quantity": int(delta)}},
        return_document=True,
        projection={"_id": 0, "quantity": 1, "name": 1},
    )
    if not updated:
        return None
    balance_after = int(updated.get("quantity", 0))
    await db.stock_movements.insert_one({
        "id": str(uuid.uuid4()),
        "product_id": product_id,
        "product_name": updated.get("name", ""),
        "delta": int(delta),
        "balance_after": balance_after,
        "cause": cause,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "user_id": token_data.get("restaurant_id", ""),
        "user_name": token_data.get("restaurant_name", ""),
        "user_role": token_data.get("role", ""),
        "note": note,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return balance_after


async def _set_stock_absolute(
    product_id: str,
    new_quantity: int,
    cause: str,
    ref_type: str,
    ref_id: str,
    token_data: dict,
    note: str = "",
) -> Optional[dict]:
    """
    Force-set product.quantity to an absolute value AND log the resulting delta.
    Used by Admin "Forza il sistema". Returns the updated product or None.
    """
    new_quantity = max(0, int(new_quantity))
    # Capture old quantity first so we can compute delta after the set.
    old = await db.products.find_one({"id": product_id}, {"_id": 0, "quantity": 1, "name": 1})
    if not old:
        return None
    old_qty = int(old.get("quantity", 0))
    delta = new_quantity - old_qty
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": {"quantity": new_quantity}},
        return_document=True,
    )
    if not updated:
        return None
    if delta != 0:
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()),
            "product_id": product_id,
            "product_name": old.get("name", ""),
            "delta": delta,
            "balance_after": new_quantity,
            "cause": cause,
            "ref_type": ref_type,
            "ref_id": ref_id,
            "user_id": token_data.get("restaurant_id", ""),
            "user_name": token_data.get("restaurant_name", ""),
            "user_role": token_data.get("role", ""),
            "note": note,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    return updated


def _serialize_carico(c: dict) -> dict:
    c = {k: v for k, v in c.items() if k != "_id"}
    photo = c.pop("photo_file", None)
    c["photo_url"] = f"/api/uploads/{photo}" if photo else ""
    fattura = c.pop("fattura_file", None)
    c["fattura_url"] = f"/api/uploads/{fattura}" if fattura else ""
    return c

@api_router.post("/carichi")
async def create_carico(data: CaricoCreate, token_data: dict = Depends(verify_token)):
    """Magazziniere: register incoming goods from a supplier. Increments product stock."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo il magazziniere può caricare merce")
    if not data.supplier_name:
        raise HTTPException(status_code=400, detail="Seleziona un fornitore")
    clean_items = [i.dict() for i in (data.items or []) if i.quantity_added and i.quantity_added > 0]
    if not clean_items:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto con quantità > 0")

    # Photo (DDT/fattura) is optional for the "Derrate" supplier and for
    # carichi composed only of ragù items. Required in every other case.
    supplier_lower = (data.supplier_name or "").strip().lower()
    all_ragu = all("rag" in (it.get("product_name", "") or "").lower() for it in clean_items)
    invoice_optional = supplier_lower == "derrate" or all_ragu
    if not data.photo_data and not invoice_optional:
        raise HTTPException(status_code=400, detail="La foto del DDT è obbligatoria")

    photo_filename = save_image_to_disk(data.photo_data, "carico") if data.photo_data else ""
    fattura_filename = save_image_to_disk(data.fattura_data, "fattura_carico") if data.fattura_data else ""
    carico_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    doc = {
        "id": carico_id,
        "supplier_name": data.supplier_name,
        "ddt_number_fornitore": data.ddt_number_fornitore or "",
        "photo_file": photo_filename,
        "fattura_file": fattura_filename,
        "items": clean_items,
        "created_at": now_iso,
        "updated_at": now_iso,
        "created_by_id": token_data.get("restaurant_id"),
    }
    await db.carichi_magazzino.insert_one(doc)

    # Increment product stock + log movement
    for it in clean_items:
        await _apply_stock_delta(
            product_id=it["product_id"],
            delta=int(it["quantity_added"]),
            cause="carico",
            ref_type="carico",
            ref_id=carico_id,
            token_data=token_data,
            note=data.supplier_name or "",
        )

    return _serialize_carico(doc)

@api_router.get("/carichi")
async def list_carichi(
    supplier: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """List all carichi (magazziniere/admin only) sorted desc by date."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query = {}
    if supplier:
        query["supplier_name"] = supplier
    if date_from or date_to:
        r = {}
        if date_from:
            r["$gte"] = date_from
        if date_to:
            r["$lte"] = date_to
        query["created_at"] = r
    docs = await db.carichi_magazzino.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_serialize_carico(d) for d in docs]

@api_router.get("/carichi/{carico_id}")
async def get_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    return _serialize_carico(doc)

@api_router.put("/carichi/{carico_id}")
async def update_carico(carico_id: str, data: CaricoUpdate, token_data: dict = Depends(verify_token)):
    """Edit a carico: rolls back old stock delta and applies new one atomically-ish."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    old = await db.carichi_magazzino.find_one({"id": carico_id})
    if not old:
        raise HTTPException(status_code=404, detail="Carico non trovato")

    update_fields: Dict = {}
    if data.supplier_name is not None:
        update_fields["supplier_name"] = data.supplier_name
    if data.ddt_number_fornitore is not None:
        update_fields["ddt_number_fornitore"] = data.ddt_number_fornitore

    if data.photo_data:
        # Replace photo file
        old_photo = old.get("photo_file")
        if old_photo:
            op = UPLOADS_DIR / old_photo
            if op.exists():
                op.unlink()
        update_fields["photo_file"] = save_image_to_disk(data.photo_data, "carico")

    if data.fattura_data:
        # Replace fattura file
        old_fattura = old.get("fattura_file")
        if old_fattura:
            op = UPLOADS_DIR / old_fattura
            if op.exists():
                op.unlink()
        update_fields["fattura_file"] = save_image_to_disk(data.fattura_data, "fattura_carico")

    if data.items is not None:
        new_items = [i.dict() for i in data.items if i.quantity_added and i.quantity_added > 0]
        if not new_items:
            raise HTTPException(status_code=400, detail="Deve esserci almeno un prodotto")
        # Compute deltas: subtract old, add new per product_id
        old_map: Dict[str, int] = {}
        for it in old.get("items", []):
            old_map[it["product_id"]] = old_map.get(it["product_id"], 0) + int(it.get("quantity_added", 0))
        new_map: Dict[str, int] = {}
        for it in new_items:
            new_map[it["product_id"]] = new_map.get(it["product_id"], 0) + int(it["quantity_added"])

        all_ids = set(old_map) | set(new_map)
        for pid in all_ids:
            delta = new_map.get(pid, 0) - old_map.get(pid, 0)
            if delta != 0:
                await _apply_stock_delta(
                    product_id=pid,
                    delta=delta,
                    cause="carico_modifica",
                    ref_type="carico",
                    ref_id=carico_id,
                    token_data=token_data,
                )
        update_fields["items"] = new_items

    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()

    updated = await db.carichi_magazzino.find_one_and_update(
        {"id": carico_id}, {"$set": update_fields}, return_document=True
    )
    return _serialize_carico(updated)

@api_router.delete("/carichi/{carico_id}")
async def delete_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    """Delete a carico: rolls back the stock addition."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    old = await db.carichi_magazzino.find_one({"id": carico_id})
    if not old:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    # Rollback stock + log movement
    for it in old.get("items", []):
        qty = int(it.get("quantity_added", 0))
        if qty:
            await _apply_stock_delta(
                product_id=it["product_id"],
                delta=-qty,
                cause="carico_cancellato",
                ref_type="carico",
                ref_id=carico_id,
                token_data=token_data,
            )
    # Delete photo file
    ph = old.get("photo_file")
    if ph:
        p = UPLOADS_DIR / ph
        if p.exists():
            p.unlink()
    # Delete fattura file
    ft = old.get("fattura_file")
    if ft:
        p = UPLOADS_DIR / ft
        if p.exists():
            p.unlink()
    await db.carichi_magazzino.delete_one({"id": carico_id})
    return {"message": "Carico cancellato e stock ripristinato"}


@api_router.put("/carichi/{carico_id}/fattura")
async def upload_carico_fattura(carico_id: str, data: FatturaUpload, token_data: dict = Depends(verify_token)):
    """Attach/replace the fattura image for a given carico."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    if not data.fattura_data:
        raise HTTPException(status_code=400, detail="Immagine fattura mancante")
    old_fattura = doc.get("fattura_file")
    if old_fattura:
        op = UPLOADS_DIR / old_fattura
        if op.exists():
            op.unlink()
    filename = save_image_to_disk(data.fattura_data, "fattura_carico")
    updated = await db.carichi_magazzino.find_one_and_update(
        {"id": carico_id},
        {"$set": {"fattura_file": filename, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
    )
    return _serialize_carico(updated)


@api_router.delete("/carichi/{carico_id}/fattura")
async def delete_carico_fattura(carico_id: str, token_data: dict = Depends(verify_token)):
    """Remove the fattura image from a carico."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    old_fattura = doc.get("fattura_file")
    if old_fattura:
        op = UPLOADS_DIR / old_fattura
        if op.exists():
            op.unlink()
    await db.carichi_magazzino.update_one(
        {"id": carico_id},
        {"$unset": {"fattura_file": ""}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"message": "Fattura rimossa"}

# ==================== BEVANDE (FLAMINIO ONLY) ====================

@api_router.get("/beverages")
async def list_beverages(token_data: dict = Depends(verify_token)):
    """Catalog of 9 beverages (sigla, name, price). Sorted by sort_order."""
    docs = await db.beverages.find({}, {"_id": 0}).sort("sort_order", 1).to_list(20)
    return docs


@api_router.get("/beverages/inventory")
async def get_beverage_inventory(request: Request, token_data: dict = Depends(verify_token)):
    """On-hand inventory of beverages for the current restaurant."""
    rid = await _effective_restaurant_id(request, token_data)
    beverages = await db.beverages.find({}, {"_id": 0}).sort("sort_order", 1).to_list(20)
    inv_docs = await db.beverage_inventory.find(
        {"restaurant_id": rid}, {"_id": 0}
    ).to_list(20)
    inv_map = {d["sigla"]: d.get("quantity", 0) for d in inv_docs}
    return [{**b, "quantity": inv_map.get(b["sigla"], 0)} for b in beverages]


# ---------- Daily counts (Magazzino Bevande page persistence) ----------

def _today_rome_str() -> str:
    return datetime.now(ROME_TZ).strftime("%Y-%m-%d")


def _resolve_historical_mode(
    date_param: Optional[str], rid_param: Optional[str], token_data: dict,
    allow_self: bool = False,
) -> Optional[tuple]:
    """Se l'utente è admin/supervisor E vengono passati sia `date` che `restaurant_id`,
    ritorna `(date_str, rid)` per operare in MODALITÀ STORICA. Altrimenti `None`
    (caller userà today + effective rid). Solleva 400 su date malformata.

    `allow_self=True` consente anche agli utenti normali di accedere in modalità
    storica SOLO per il proprio locale (usato dai GET di sola lettura, mai dai PUT).
    """
    if not date_param and not rid_param:
        return None
    if not date_param or not rid_param:
        # Entrambi devono essere presenti per attivare la modalità storica
        return None
    is_admin = token_data.get("role") in ("admin",)
    if not is_admin:
        if not allow_self:
            raise HTTPException(status_code=403, detail="Modalità storica scrittura riservata ad Admin")
        own_rid = token_data.get("restaurant_id")
        if rid_param != own_rid:
            raise HTTPException(status_code=403, detail="Modalità storica consentita solo per il proprio locale")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_param):
        raise HTTPException(status_code=400, detail="Data non valida (formato YYYY-MM-DD)")
    today = _today_rome_str()
    if date_param > today:
        raise HTTPException(status_code=400, detail="Data non può essere nel futuro")
    return (date_param, rid_param)


class BeverageDailyUpsert(BaseModel):
    sigla: str
    mattina: Optional[str] = ""
    inUsc: Optional[str] = ""
    scarti: Optional[str] = ""
    sera: Optional[str] = ""
    # NEW (09/06/2026) — "mattina" e "sera" possono essere espressi come
    # somma di casse (×24) + sfuse. "inUsc" (ingressi) può essere espresso
    # come numero di casse (×24). Il frontend manda comunque il totale
    # calcolato come stringa intera in mattina/inUsc/sera per retrocompatibilità.
    mattina_casse: Optional[str] = ""
    mattina_sfuse: Optional[str] = ""
    inUsc_casse: Optional[str] = ""
    sera_casse: Optional[str] = ""
    sera_sfuse: Optional[str] = ""
    comments: Optional[Dict[str, str]] = None  # { 'inUsc': '...', 'scarti': '...' }
    # Modalità storica (Admin/Supervisor)
    date: Optional[str] = None
    restaurant_id: Optional[str] = None


@api_router.get("/beverages/daily")
async def get_beverage_daily_counts(
    request: Request,
    date: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Returns today's counts for the current restaurant + previous-day sera values.

    Modalità storica (Admin/Supervisor): se `date` + `restaurant_id` sono
    presenti, restituisce i counts di QUEL giorno per QUEL locale.
    """
    historical = _resolve_historical_mode(date, restaurant_id, token_data, allow_self=True)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()

    today_docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ).to_list(50)
    counts = {d["sigla"]: {
        "mattina": d.get("mattina", ""),
        "inUsc": d.get("inUsc", ""),
        "scarti": d.get("scarti", ""),
        "sera": d.get("sera", ""),
        "mattina_casse": d.get("mattina_casse", ""),
        "mattina_sfuse": d.get("mattina_sfuse", ""),
        "inUsc_casse": d.get("inUsc_casse", ""),
        "sera_casse": d.get("sera_casse", ""),
        "sera_sfuse": d.get("sera_sfuse", ""),
        "comments": d.get("comments") or {},
    } for d in today_docs}

    prev_sera = {}
    last_day_doc = await db.beverage_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0, "date_rome": 1},
    )
    if last_day_doc:
        prev_date = last_day_doc["date_rome"]
        prev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": prev_date},
            {"_id": 0, "sigla": 1, "sera": 1},
        ).to_list(50)
        prev_sera = {d["sigla"]: d.get("sera", "") for d in prev_docs}

    return {"date": target_date, "counts": counts, "prev_sera": prev_sera, "historical": bool(historical)}


@api_router.put("/beverages/daily")
async def upsert_beverage_daily(
    data: BeverageDailyUpsert, request: Request, token_data: dict = Depends(verify_token)
):
    """Upsert a single beverage row for today's counts (auto-save from frontend).
    Modalità storica: se `data.date` + `data.restaurant_id` sono presenti
    (e l'utente è admin/supervisor), salva per quel giorno+locale."""
    historical = _resolve_historical_mode(data.date, data.restaurant_id, token_data)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
    if data.sigla not in valid_siglas:
        raise HTTPException(status_code=400, detail=f"Sigla non valida: {data.sigla}")
    set_body = {
        "restaurant_id": rid,
        "date_rome": target_date,
        "sigla": data.sigla,
        "mattina": data.mattina or "",
        "inUsc": data.inUsc or "",
        "scarti": data.scarti or "",
        "sera": data.sera or "",
        "mattina_casse": data.mattina_casse or "",
        "mattina_sfuse": data.mattina_sfuse or "",
        "inUsc_casse": data.inUsc_casse or "",
        "sera_casse": data.sera_casse or "",
        "sera_sfuse": data.sera_sfuse or "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Sanitize commenti (max 500 char per chiave, scarto chiavi non-valide)
    if data.comments is not None:
        clean: Dict[str, str] = {}
        for k in ("inUsc", "scarti"):
            v = data.comments.get(k)
            if isinstance(v, str) and v.strip():
                clean[k] = v.strip()[:500]
        set_body["comments"] = clean
    # Audit-log: registro diff per ogni colonna della riga bevanda
    old_doc = await db.beverage_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date, "sigla": data.sigla}, {"_id": 0}
    ) or {}
    # Sicurezza: i campi MATTINA (mattina + mattina_casse + mattina_sfuse) della
    # bevanda — coperti dal toggle "Forza Magazzino Mattina" — possono essere
    # modificati SOLO da admin/Federico. Per gli altri utenti preserviamo il
    # valore esistente nel DB ignorando ciò che è stato inviato.
    if token_data.get("role") != "admin":
        for k in ("mattina", "mattina_casse", "mattina_sfuse"):
            set_body[k] = old_doc.get(k, "")
    try:
        ui = _audit_user_info(request, token_data)
        if historical:
            ui = {**ui, "mode": "historical"}
        for col in ("mattina", "inUsc", "scarti", "sera"):
            await _audit_log_change(
                category="beverage", rid=rid, date_rome=target_date,
                field=f"{data.sigla}.{col}",
                old_value=old_doc.get(col, ""), new_value=set_body.get(col, ""),
                user_info=ui,
            )
        if "comments" in set_body:
            old_c = old_doc.get("comments") or {}
            new_c = set_body.get("comments") or {}
            for k in set(old_c.keys()) | set(new_c.keys()):
                await _audit_log_change(
                    category="beverage", rid=rid, date_rome=target_date,
                    field=f"{data.sigla}.comment.{k}",
                    old_value=old_c.get(k, ""), new_value=new_c.get(k, ""),
                    user_info=ui,
                )
    except Exception as e:
        logger.warning(f"[AUDIT] beverage diff failed (non-blocking): {e}")
    await db.beverage_daily_counts.update_one(
        {"restaurant_id": rid, "date_rome": target_date, "sigla": data.sigla},
        {"$set": set_body},
        upsert=True,
    )
    return {"ok": True, "historical": bool(historical)}


@api_router.get("/beverages/daily/history")
async def get_beverage_daily_history(
    request: Request, days: int = 60, token_data: dict = Depends(verify_token)
):
    """Returns the last N days of beverage daily counts grouped by date."""
    rid = await _effective_restaurant_id(request, token_data)
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=max(1, min(days, 365)))).strftime("%Y-%m-%d")
    docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("date_rome", -1).to_list(2000)
    grouped: dict = {}
    for d in docs:
        grouped.setdefault(d["date_rome"], []).append(d)
    return {
        "days": [
            {"date": date, "rows": rows}
            for date, rows in sorted(grouped.items(), reverse=True)
        ]
    }


# ---------- Cash daily counts (Report page — riepilogo cassa Flaminio) ----------

# Helper: evaluate "=..." expressions safely; mirror of the JS evaluateValue
def _eval_cash_value(v) -> float:
    """Valuta un'espressione aritmetica come fa il frontend (evaluateValue):
    - "=" iniziale è OPZIONALE → anche "10+5" viene calcolato come 15.
    - Strippa eventuali tag HTML (campo VERS rich-text con span colorati).
    - Whitelist di caratteri: solo cifre, operatori, parentesi, spazi.
    Importante: questa funzione deve restare allineata bit-per-bit con la
    `evaluateValue` del frontend, altrimenti i numeri nelle viste aggregate
    (Storico chiusure / Excel grid / cash_sera) divergono da quelli mostrati
    nella pagina Report.
    """
    if v is None:
        return 0.0
    s = str(v)
    # Strip HTML tags — il VERS può contenere <span style="color:...">…</span>
    if "<" in s:
        s = re.sub(r"<[^>]*>", "", s)
    s = s.strip().replace(",", ".")
    if not s:
        return 0.0
    if s.startswith("="):
        s = s[1:].strip()
    if not s:
        return 0.0
    if not re.match(r"^[\d+\-*/.() \s]*$", s):
        return 0.0
    try:
        # Safe: il regex sopra ammette solo cifre/operatori/parentesi/spazi.
        return float(eval(s, {"__builtins__": {}}, {}))  # noqa: S307
    except Exception:
        return 0.0


def _compute_cash_sera(row: dict) -> float:
    if not row:
        return 0.0
    plus = _eval_cash_value(row.get("mattina", "")) \
        + _eval_cash_value(row.get("altro", "")) \
        + _eval_cash_value(row.get("arr", ""))
    minus = _eval_cash_value(row.get("glo", "")) \
        + _eval_cash_value(row.get("just", "")) \
        + _eval_cash_value(row.get("delv", "")) \
        + _eval_cash_value(row.get("bp", "")) \
        + _eval_cash_value(row.get("sat", "")) \
        + _eval_cash_value(row.get("ft", "")) \
        + _eval_cash_value(row.get("pos", "")) \
        + _eval_cash_value(row.get("vers", ""))
    return plus - minus


# Moltiplicatori spicci (mazzette/rotolini aperti) — devono restare allineati al frontend
SPICCI_MULTIPLIERS = {"sp5": 50, "sp2": 50, "sp1": 25, "sp05": 20}

# Listino paste DI DEFAULT (deve restare allineato a PASTA_PRICES nel frontend ReportBetaPage.js).
# Ogni ristorante può sovrascrivere il dizionario nella collection `pasta_dictionary`.
PASTA_PRICES_MAP = {
    "CARB": 8, "AMAT": 8, "CACIO": 8, "PESTO": 8,
    "TART": 8, "RAGU": 8, "POM": 7, "CARZUC": 8,
}


async def _get_pasta_dict_for(restaurant_id: Optional[str]) -> Dict[str, float]:
    """Ritorna il dizionario {sigla: prezzo} effettivo per il ristorante.
    Se la collection `pasta_dictionary` ha un override per quel ristorante,
    usa quello; altrimenti torna il `PASTA_PRICES_MAP` di default."""
    if restaurant_id:
        doc = await db.pasta_dictionary.find_one({"restaurant_id": restaurant_id}, {"_id": 0, "siglas": 1})
        if doc and doc.get("siglas"):
            try:
                return {
                    str(s["sigla"]).upper().strip(): float(s["price"])
                    for s in doc["siglas"]
                    if str(s.get("sigla", "")).strip()
                }
            except Exception as e:
                logger.warning(f"[PASTA_DICT] Override invalid for rid={restaurant_id}: {e}")
    return dict(PASTA_PRICES_MAP)


# Regex per matchare una sigla SOLO se appare immediatamente dopo un eventuale
# numero d'ordine + whitespace iniziale. Esempio:
#   "42 CARB - PIET"    → match CARB ✓
#   "42 PIETRO CARB"    → NO match ✗
#   "42 - CARB"         → NO match ✗  (c'è '-' tra numero e sigla)
#   "CARB tavolo 5"     → match CARB ✓ (nessun numero, sigla è prima parola)
def _pasta_recognized_sigla(line: str, dict_map: Dict[str, float]) -> Optional[str]:
    if not line:
        return None
    upper = line.upper()
    # XL esclude la riga (va in manuali)
    if re.search(r"\bXL\b", upper):
        return None
    siglas_sorted = sorted(dict_map.keys(), key=len, reverse=True)
    for sigla in siglas_sorted:
        # ^\s*(?:\d+\s+)?SIGLA(?:\b|$)
        pattern = rf"^\s*(?:\d+\s+)?{re.escape(sigla)}(?:\b|$)"
        if re.search(pattern, upper):
            return sigla
    return None



def _compute_spicci_total(row: dict) -> float:
    return sum(_eval_cash_value(row.get(k, "")) * v for k, v in SPICCI_MULTIPLIERS.items())


def _compute_paste_total_eur(
    paste_text: str,
    manual_prices: Optional[dict] = None,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    """Somma € paste: riconosciute (prezzo da dict_map) + non riconosciute con
    prezzo manuale assegnato. Mirror del frontend `pasteAnalysis.totalEuro`."""
    if not paste_text:
        return 0.0
    if dict_map is None:
        dict_map = PASTA_PRICES_MAP
    lines = [l.strip() for l in paste_text.split("\n")]
    lines = [l for l in lines if l]
    total = 0.0
    mp = manual_prices or {}
    for idx, line in enumerate(lines):
        recognized_sigla = _pasta_recognized_sigla(line, dict_map)
        if recognized_sigla is not None:
            total += dict_map[recognized_sigla]
        else:
            raw = mp.get(str(idx), mp.get(idx, ""))
            try:
                n = float(str(raw).replace(",", ".").strip()) if str(raw).strip() else 0.0
                if n > 0:
                    total += n
            except Exception:
                pass
    return total


def _compute_bev_total_eur(bev_docs: list) -> float:
    """Somma incassi bevande (qty>0 only). Skip se sera==0 (giorno non chiuso)."""
    prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    total = 0.0
    for r in bev_docs:
        m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
        s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
        qty = 0 if e == 0 else (m + u - s - e)
        if qty > 0:
            total += qty * prices.get(r["sigla"], 0)
    return total


def _compute_paste_count(paste_text: str) -> int:
    """Conta TUTTE le righe non vuote del paste_text (riconosciute + non riconosciute).
    Mirror del frontend: `totalCount = recognized + unrecognized`."""
    if not paste_text:
        return 0
    return sum(1 for line in paste_text.split("\n") if line.strip())


def _compute_paste_unrecognized(
    paste_text: str,
    manual_prices: dict,
    dict_map: Optional[Dict[str, float]] = None,
) -> List[Dict]:
    """Estrae le righe non riconosciute (sigla pasta non valida per la regola di posizionamento).
    L'indice usato per il match con manual_prices è quello della riga dopo split + trim+filter,
    coerente col frontend ReportBetaPage `pasteAnalysis`."""
    if not paste_text:
        return []
    if dict_map is None:
        dict_map = PASTA_PRICES_MAP
    lines = [l.strip() for l in paste_text.split("\n")]
    lines = [l for l in lines if l]
    out: List[Dict] = []
    mp = manual_prices or {}
    for idx, line in enumerate(lines):
        if _pasta_recognized_sigla(line, dict_map) is not None:
            continue
        raw_price = mp.get(str(idx), mp.get(idx, ""))
        try:
            price = float(str(raw_price).replace(",", ".").strip()) if str(raw_price).strip() else 0.0
            if price < 0:
                price = 0.0
        except Exception:
            price = 0.0
        out.append({"idx": idx, "text": line, "manual_price": price})
    return out


def _compute_cash_sera_full(
    cash_row: dict,
    bev_docs: list,
    dict_map: Optional[Dict[str, float]] = None,
) -> float:
    """Cash sera completo: include paste (riconosciute + manuali), bevande e spicci."""
    base = _compute_cash_sera(cash_row)
    return base + _compute_spicci_total(cash_row) \
                + _compute_paste_total_eur(
                    cash_row.get("paste_text", "") or "",
                    cash_row.get("manual_prices") or {},
                    dict_map,
                ) \
                + _compute_bev_total_eur(bev_docs)


CASH_FIELDS = ["mattina", "altro", "glo", "just", "delv", "bp", "sat", "ft", "pos", "vers", "arr"]
SPICCI_FIELDS = ["sp5", "sp2", "sp1", "sp05"]
CASSETTO_FIELDS = ["cd5", "cd2", "cd1", "cd05"]
ALL_CASH_FIELDS = CASH_FIELDS + SPICCI_FIELDS + CASSETTO_FIELDS


def _audit_user_info(request: Request, token_data: dict) -> dict:
    """Restituisce metadati utente per audit-log."""
    role = token_data.get("role")
    is_admin = role == "admin"
    impersonated = bool(request.headers.get("X-Restaurant-Id") or request.headers.get("x-restaurant-id")) if is_admin else False
    return {
        "by_role": role or "unknown",
        "by_user": token_data.get("restaurant_name") or "unknown",
        "by_user_id": token_data.get("restaurant_id") or "",
        "is_impersonating": impersonated,
    }


async def _audit_log_change(
    *, category: str, rid: str, date_rome: str, field: str,
    old_value, new_value, user_info: dict,
) -> None:
    """Inserisce una entry di audit-log per ogni cambio reale.
    NO coalescing: ogni salvataggio con un valore diverso crea una riga distinta
    (così le correzioni successive 3 → 2 → 5 sono tutte tracciate separatamente).
    I salvataggi senza modifica (`old == new`) non vengono loggati.
    """
    def _stringify(v) -> str:
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            try:
                import json as _j
                return _j.dumps(v, ensure_ascii=False)[:240]
            except Exception:
                return str(v)[:240]
        return str(v)[:240]
    old_s = _stringify(old_value)
    new_s = _stringify(new_value)
    if old_s == new_s:
        return
    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()),
        "restaurant_id": rid,
        "date_rome": date_rome,
        "category": category,
        "field": field,
        "old_value": old_s,
        "new_value": new_s,
        "by_role": user_info["by_role"],
        "by_user": user_info["by_user"],
        "by_user_id": user_info["by_user_id"],
        "is_impersonating": user_info["is_impersonating"],
        "first_at": now.isoformat(),
        "last_at": now.isoformat(),
        "changes_count": 1,
    }
    await db.cash_audit_log.insert_one(entry)


async def _audit_diff_cash(
    *, rid: str, date_rome: str, old_doc: dict, set_payload: dict, user_info: dict,
) -> None:
    """Diff field-by-field tra il vecchio doc cash e il nuovo set_payload, e logga ogni delta."""
    old_doc = old_doc or {}
    # Campi scalari
    scalar_fields = list(ALL_CASH_FIELDS) + ["vers_color", "paste_text"]
    for k in scalar_fields:
        if k not in set_payload:
            continue
        await _audit_log_change(
            category="cash", rid=rid, date_rome=date_rome, field=k,
            old_value=old_doc.get(k, ""), new_value=set_payload.get(k, ""),
            user_info=user_info,
        )
    # Dict fields: cash_banconote.<k>, manual_prices.<k>, comments.<k>
    for parent in ("cash_banconote", "manual_prices", "comments"):
        if parent not in set_payload:
            continue
        old_d = (old_doc.get(parent) or {})
        new_d = (set_payload.get(parent) or {})
        keys = set(old_d.keys()) | set(new_d.keys())
        for k in keys:
            await _audit_log_change(
                category="cash", rid=rid, date_rome=date_rome,
                field=f"{parent}.{k}",
                old_value=old_d.get(k, ""), new_value=new_d.get(k, ""),
                user_info=user_info,
            )


class CashDailyUpsert(BaseModel):
    mattina: Optional[str] = ""
    altro: Optional[str] = ""
    glo: Optional[str] = ""
    just: Optional[str] = ""
    delv: Optional[str] = ""
    bp: Optional[str] = ""
    sat: Optional[str] = ""
    ft: Optional[str] = ""
    pos: Optional[str] = ""
    vers: Optional[str] = ""
    arr: Optional[str] = ""
    sp5: Optional[str] = ""
    sp2: Optional[str] = ""
    sp1: Optional[str] = ""
    sp05: Optional[str] = ""
    cd5: Optional[str] = ""
    cd2: Optional[str] = ""
    cd1: Optional[str] = ""
    cd05: Optional[str] = ""
    vers_color: Optional[str] = ""
    comments: Optional[Dict[str, str]] = None
    # Persistenza pagina Report (paste incollate, cassa banconote, prezzi manuali)
    paste_text: Optional[str] = None
    cash_banconote: Optional[Dict[str, str]] = None
    manual_prices: Optional[Dict[str, str]] = None
    # Modalità storica (Admin/Supervisor): se entrambi presenti il salvataggio
    # avviene per il giorno+locale indicati invece che per oggi/ristorante effettivo.
    date: Optional[str] = None          # YYYY-MM-DD
    restaurant_id: Optional[str] = None


@api_router.get("/cash/daily")
async def get_cash_daily(
    request: Request,
    date: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Returns today's cash row for the current restaurant + previous-day computed cash_sera
    so the frontend can auto-fill CASH MATTINA when starting a new day.

    Modalità storica (Admin/Supervisor): se `date` + `restaurant_id` sono
    presenti, ritorna i dati di QUEL giorno per QUEL locale.
    """
    historical = _resolve_historical_mode(date, restaurant_id, token_data, allow_self=True)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    today_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ) or {}
    data = {f: today_doc.get(f, "") for f in ALL_CASH_FIELDS}
    vers_color = today_doc.get("vers_color", "") or ""
    comments = today_doc.get("comments") or {}
    paste_text = today_doc.get("paste_text", "") or ""
    cash_banconote = today_doc.get("cash_banconote") or {}
    manual_prices = today_doc.get("manual_prices") or {}

    prev_cash_sera = ""
    prev_row = None
    prev_date = ""
    last_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0},
    )
    if last_doc:
        # IMPORTANTE: il "cash sera" del giorno prima deve includere paste, bevande e
        # spicci (stessa formula del frontend), altrimenti la mattina del giorno dopo
        # sarebbe più bassa del cassetto reale. Recupero le bevande dello stesso
        # giorno per il calcolo completo.
        prev_bev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": last_doc["date_rome"]},
            {"_id": 0},
        ).to_list(100)
        prev_cash_sera = round(_compute_cash_sera_full(last_doc, prev_bev_docs), 2)
        # Riga di ieri completa (per la vista read-only nel Report)
        prev_date = last_doc.get("date_rome", "")
        prev_row = {f: last_doc.get(f, "") for f in ALL_CASH_FIELDS}
        prev_row["paste_text"] = last_doc.get("paste_text", "") or ""
        # CARRY-OVER STOCK CASSETTO: lo stock spicci nel cassetto è un magazzino
        # fisico che persiste tra i giorni. Se oggi non c'è ancora valore per cd*,
        # eredito quello di ieri così la quantità non sparisce dopo l'archiviazione.
        for cf in CASSETTO_FIELDS:
            if not data.get(cf):
                data[cf] = last_doc.get(cf, "") or ""
    return {
        "date": target_date,
        "data": data,
        "prev_cash_sera": prev_cash_sera,
        "prev_date": prev_date,
        "prev_row": prev_row,
        "comments": comments,
        "vers_color": vers_color,
        "paste_text": paste_text,
        "cash_banconote": cash_banconote,
        "manual_prices": manual_prices,
        "historical": bool(historical),
    }


@api_router.put("/cash/daily")
async def upsert_cash_daily(
    data: CashDailyUpsert, request: Request, token_data: dict = Depends(verify_token)
):
    """Upsert today's cash row (auto-save dal frontend) per il ristorante effettivo.
    Modalità storica: se `data.date` + `data.restaurant_id` sono presenti
    (e admin/supervisor), salva per quel giorno+locale."""
    historical = _resolve_historical_mode(data.date, data.restaurant_id, token_data)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    payload = {f: (getattr(data, f) or "") for f in ALL_CASH_FIELDS}
    set_payload = {
        **payload,
        "restaurant_id": rid,
        "date_rome": target_date,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # vers_color: solo valori validi
    allowed_colors = {"", "black", "red", "green", "blue", "orange"}
    if data.vers_color is not None and data.vers_color in allowed_colors:
        set_payload["vers_color"] = data.vers_color
    # Paste text (multiline area Report)
    if data.paste_text is not None:
        set_payload["paste_text"] = str(data.paste_text)[:50000]
    # Cassa banconote (input pezzi/€)
    if data.cash_banconote is not None:
        clean_b = {str(k)[:20]: str(v)[:50] for k, v in (data.cash_banconote or {}).items() if isinstance(k, str)}
        set_payload["cash_banconote"] = clean_b
    # Prezzi manuali per le paste non riconosciute (idx → prezzo)
    if data.manual_prices is not None:
        clean_p = {str(k)[:20]: str(v)[:50] for k, v in (data.manual_prices or {}).items() if isinstance(k, (str, int))}
        set_payload["manual_prices"] = clean_p
    # Sanitize commenti: solo str→str, max 500 char, scarto chiavi/valori vuoti
    if data.comments is not None:
        clean: Dict[str, str] = {}
        for k, v in data.comments.items():
            if not isinstance(k, str) or not isinstance(v, str):
                continue
            t = v.strip()
            if t:
                clean[k[:50]] = t[:500]
        set_payload["comments"] = clean
    # Audit-log: registro ogni delta rispetto al doc esistente
    old_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ) or {}
    # Sicurezza: il campo `mattina` (CASH MATTINA "Forza Mattina") può essere
    # modificato SOLO da admin/Federico. Per gli altri utenti preserviamo il
    # valore esistente nel DB ignorando ciò che è stato inviato lato client.
    if token_data.get("role") != "admin":
        set_payload["mattina"] = old_doc.get("mattina", "")
    try:
        ui = _audit_user_info(request, token_data)
        if historical:
            ui = {**ui, "mode": "historical"}
        await _audit_diff_cash(
            rid=rid, date_rome=target_date, old_doc=old_doc, set_payload=set_payload,
            user_info=ui,
        )
    except Exception as e:
        logger.warning(f"[AUDIT] cash diff failed (non-blocking): {e}")
    await db.cash_daily_counts.update_one(
        {"restaurant_id": rid, "date_rome": target_date},
        {"$set": set_payload},
        upsert=True,
    )
    return {"ok": True, "historical": bool(historical)}


# ---------- Storico Chiusure (Admin only) ----------

async def _orders_aggregate_for_date(date_rome_str: str, restaurant_id: Optional[str] = None) -> Dict:
    """Aggrega le paste della data indicata (Rome) leggendo da `archived_orders`
    e da `orders` (per il giorno corrente, ancora non archiviato)."""
    try:
        d0 = datetime.strptime(date_rome_str, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
    except Exception:
        return {"total_orders": 0, "by_restaurant": {}}
    d1 = d0 + timedelta(days=1)
    q = {"created_at": {"$gte": d0.isoformat(), "$lt": d1.isoformat()}}
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    results = {"total_orders": 0, "by_restaurant": {}}
    for coll in ("archived_orders", "orders"):
        async for o in db[coll].find(q, {"_id": 0}):
            rid = o.get("restaurant_id") or "?"
            entry = results["by_restaurant"].setdefault(rid, {"count": 0, "completed": 0})
            entry["count"] += 1
            if o.get("status") == "completed":
                entry["completed"] += 1
            results["total_orders"] += 1
    return results


@api_router.post("/admin/_cleanup-old-uploads")
async def admin_cleanup_old_uploads(
    retention_days: int = UPLOADS_RETENTION_DAYS,
    token_data: dict = Depends(verify_token)
):
    """Admin-only: cancella manualmente fatture / versamenti / chiusure più
    vecchie di `retention_days` (default 90 = 3 mesi). Restituisce il numero
    di documenti eliminati per ciascuna collezione. La pulizia gira anche
    automaticamente ad ogni scatto di mezzanotte e all'avvio del server.
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if retention_days < 1:
        raise HTTPException(status_code=400, detail="retention_days deve essere >= 1")
    logger.info(f"[ADMIN] Manual cleanup_old_uploads triggered (retention={retention_days}d)")
    deleted = await cleanup_old_uploads(retention_days=retention_days)
    return {"retention_days": retention_days, "deleted": deleted}


@api_router.get("/admin/generale-hide-log")
async def get_generale_hide_log(
    restaurant_id: Optional[str] = None,
    limit: int = 200,
    token_data: dict = Depends(verify_token),
):
    """Audit log silenzioso: ogni volta che qualcuno preme il cestino sul
    Tablet Generale per nascondere un ordine, qui viene registrato chi/quando/
    quale ordine. Admin only. Filtrabile per restaurant_id.
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    query = {}
    if restaurant_id:
        query["restaurant_id"] = restaurant_id
    limit = max(1, min(limit, 1000))
    rows = await db.generale_hide_log.find(query, {"_id": 0}).sort("hidden_at", -1).to_list(limit)
    return {"items": rows, "count": len(rows)}


@api_router.post("/admin/_simulate-midnight-reset")
async def admin_simulate_midnight_reset(token_data: dict = Depends(verify_token)):
    """Admin-only: simula completamente lo scatto di mezzanotte.
    - Esegue `midnight_reset` (archive orders/logs, reset counters, broadcast WS).
    - Inoltre **risposta le righe di oggi** di `cash_daily_counts` e `beverage_daily_counts`
      al giorno precedente, così la chiusura corrente diventa "storico" e il Report
      ricomincia da zero (con carry-over della sera di ieri sulla mattina di oggi).
    Utile per testing e simulazioni controllate.
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    logger.info("[ADMIN] Manual midnight reset triggered")
    await midnight_reset()

    today = _today_rome_str()
    yesterday = (datetime.now(ROME_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
    # Sposta le righe di oggi → ieri (collisioni risolte sovrascrivendo: ieri non esisteva
    # per definizione "ripartiamo da zero").
    moved_cash = 0
    moved_bev = 0
    # cash_daily_counts: chiave logica (restaurant_id, date_rome)
    async for d in db.cash_daily_counts.find({"date_rome": today}, {"_id": 0}):
        rid = d.get("restaurant_id")
        if not rid:
            continue
        new_doc = {**d, "date_rome": yesterday}
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": yesterday},
            {"$set": new_doc},
            upsert=True,
        )
        await db.cash_daily_counts.delete_one({"restaurant_id": rid, "date_rome": today})
        moved_cash += 1
    # beverage_daily_counts: chiave logica (restaurant_id, date_rome, sigla)
    async for d in db.beverage_daily_counts.find({"date_rome": today}, {"_id": 0}):
        rid = d.get("restaurant_id")
        sigla = d.get("sigla")
        if not rid or not sigla:
            continue
        new_doc = {**d, "date_rome": yesterday}
        await db.beverage_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": yesterday, "sigla": sigla},
            {"$set": new_doc},
            upsert=True,
        )
        await db.beverage_daily_counts.delete_one(
            {"restaurant_id": rid, "date_rome": today, "sigla": sigla}
        )
        moved_bev += 1
    logger.info(
        f"[ADMIN] Spostate {moved_cash} righe cash + {moved_bev} righe beverage "
        f"da {today} → {yesterday} per simulare il rollover di giornata"
    )
    # Broadcast a tutti i client connessi così Report/Bevande si ricaricano
    for rid in list(manager.active_connections.keys()):
        await manager.broadcast_to_restaurant(rid, {"type": "daily_reset"})

    return {
        "ok": True,
        "message": "Midnight reset eseguito",
        "moved_cash_rows": moved_cash,
        "moved_beverage_rows": moved_bev,
        "from_date": today,
        "to_date": yesterday,
    }



@api_router.get("/admin/closures")
async def list_closures(
    days: int = 60,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Lista delle chiusure (date) con riepilogo: incasso, # paste, # bevande, ecc.
    Filtra per `restaurant_id` se fornito (richiesto per la vista per-locale).
    """
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=max(1, min(days, 365)))).strftime("%Y-%m-%d")
    today = _today_rome_str()
    base_q = {"date_rome": {"$gte": cutoff, "$lt": today}}
    if restaurant_id:
        base_q["restaurant_id"] = restaurant_id
    dates: set = set()
    async for d in db.cash_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    async for d in db.beverage_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    items = []
    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    # Dizionario paste per ristorante (se single restaurant); altrimenti per riga
    dict_for_rid_cache: Dict[str, Dict[str, float]] = {}
    async def _dict_for(rid_local: Optional[str]) -> Dict[str, float]:
        if not rid_local:
            return dict(PASTA_PRICES_MAP)
        if rid_local not in dict_for_rid_cache:
            dict_for_rid_cache[rid_local] = await _get_pasta_dict_for(rid_local)
        return dict_for_rid_cache[rid_local]
    for date_str in sorted(dates, reverse=True):
        cash_q = {"date_rome": date_str}
        bev_q = {"date_rome": date_str}
        if restaurant_id:
            cash_q["restaurant_id"] = restaurant_id
            bev_q["restaurant_id"] = restaurant_id
        cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
        bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
        rid_for_dict = restaurant_id or cash_doc.get("restaurant_id")
        dmap = await _dict_for(rid_for_dict)
        cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap), 2) if cash_doc else 0.0
        bev_total_qty = 0
        bev_total_inc = 0.0
        for r in bev_docs:
            m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
            s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
            qty = 0 if e == 0 else (m + u - s - e)
            if qty > 0:
                bev_total_qty += int(qty)
                bev_total_inc += qty * bev_prices.get(r["sigla"], 0)
        orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)
        paste_count = _compute_paste_count(cash_doc.get("paste_text", "") if cash_doc else "")
        items.append({
            "date": date_str,
            "cash_sera": cash_sera,
            "bev_total_qty": bev_total_qty,
            "bev_total_inc": round(bev_total_inc, 2),
            "orders_total": orders_info["total_orders"],
            "paste_count": paste_count,
        })
    return {"items": items}


@api_router.post("/admin/beverages/reset")
async def admin_beverages_reset(payload: Dict, token_data: dict = Depends(verify_token)):
    """Admin-only: azzera (cancella tutte le righe) il Magazzino Bevande di un locale.
    Tutte le date vengono rimosse. Riaprendo la pagina partirà tutto da 0 (anche la
    colonna Mattina, perché viene calcolata dal Sera di ieri che non esiste più)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rid = (payload or {}).get("restaurant_id")
    if not rid or not isinstance(rid, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    res = await db.beverage_daily_counts.delete_many({"restaurant_id": rid})
    logger.info(f"[ADMIN] Reset Magazzino Bevande per {rid}: {res.deleted_count} righe cancellate")
    return {"ok": True, "deleted": res.deleted_count}


@api_router.get("/admin/audit-log/groups")
async def admin_audit_log_groups(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Raggruppa l'audit-log per (locale, data report). Una entry = una chiusura/report."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    match: Dict[str, object] = {}
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        match["date_rome"] = rng
    if restaurant_id:
        match["restaurant_id"] = restaurant_id
    pipeline = [
        {"$match": match} if match else {"$match": {}},
        {"$group": {
            "_id": {"rid": "$restaurant_id", "date": "$date_rome"},
            "count": {"$sum": 1},
            "total_changes": {"$sum": "$changes_count"},
            "cash_count": {"$sum": {"$cond": [{"$eq": ["$category", "cash"]}, 1, 0]}},
            "bev_count": {"$sum": {"$cond": [{"$eq": ["$category", "beverage"]}, 1, 0]}},
            "admin_count": {"$sum": {"$cond": ["$is_impersonating", 1, 0]}},
            "first_at": {"$min": "$first_at"},
            "last_at": {"$max": "$last_at"},
            "users": {"$addToSet": "$by_user"},
        }},
        {"$sort": {"_id.date": -1, "last_at": -1}},
        {"$limit": 500},
    ]
    rows = await db.cash_audit_log.aggregate(pipeline).to_list(500)
    rids = list({r["_id"]["rid"] for r in rows if r["_id"].get("rid")})
    rest_map: Dict[str, str] = {}
    if rids:
        async for r in db.restaurants.find({"id": {"$in": rids}}, {"_id": 0, "id": 1, "username": 1, "location": 1}):
            rest_map[r["id"]] = r.get("location") or r.get("username") or r["id"][:8]
    items = []
    for r in rows:
        rid = r["_id"]["rid"]
        items.append({
            "restaurant_id": rid,
            "restaurant_label": rest_map.get(rid, "?"),
            "date_rome": r["_id"]["date"],
            "count": r["count"],
            "total_changes": r["total_changes"],
            "cash_count": r["cash_count"],
            "bev_count": r["bev_count"],
            "admin_count": r["admin_count"],
            "first_at": r["first_at"],
            "last_at": r["last_at"],
            "users": r.get("users") or [],
        })
    return {"items": items, "count": len(items)}


@api_router.get("/admin/audit-log")
async def admin_audit_log(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    category: Optional[str] = None,         # 'cash' | 'beverage'
    field_q: Optional[str] = None,          # full-text regex su 'field'
    user_q: Optional[str] = None,           # full-text regex su 'by_user'
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """Audit-log dei salvataggi su Report (Cassa + Bevande). Admin only."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    q: Dict[str, object] = {}
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["date_rome"] = rng
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    if category in ("cash", "beverage"):
        q["category"] = category
    if field_q:
        q["field"] = {"$regex": re.escape(field_q), "$options": "i"}
    if user_q:
        q["by_user"] = {"$regex": re.escape(user_q), "$options": "i"}
    limit = max(1, min(int(limit or 500), 2000))
    docs = await db.cash_audit_log.find(q, {"_id": 0}).sort("last_at", -1).to_list(limit)
    # Arricchisco con nome locale (cache map già presente _locations_cache: skip — uso restaurants live)
    rest_map = {}
    rids = list({d.get("restaurant_id") for d in docs if d.get("restaurant_id")})
    if rids:
        async for r in db.restaurants.find({"id": {"$in": rids}}, {"_id": 0, "id": 1, "username": 1, "location": 1}):
            rest_map[r["id"]] = r.get("location") or r.get("username") or r["id"][:8]
    for d in docs:
        d["restaurant_label"] = rest_map.get(d.get("restaurant_id"), "?")
    return {"items": docs, "count": len(docs)}



async def _build_closure_detail(date_str: str, restaurant_id: Optional[str]) -> Dict:
    """Build the full closure detail payload (used by Admin storico + report-ieri)."""
    cash_q = {"date_rome": date_str}
    bev_q = {"date_rome": date_str}
    if restaurant_id:
        cash_q["restaurant_id"] = restaurant_id
        bev_q["restaurant_id"] = restaurant_id
    cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
    bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
    dmap = await _get_pasta_dict_for(restaurant_id or cash_doc.get("restaurant_id"))
    cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap), 2) if cash_doc else 0.0
    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    bev_names = {b["sigla"]: b["name"] for b in BEVERAGES_CATALOG}
    bev_rows = []
    bev_total_qty = 0
    bev_total_inc = 0.0
    for r in bev_docs:
        m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
        s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
        qty = 0 if e == 0 else (m + u - s - e)
        inc = max(0, qty) * bev_prices.get(r["sigla"], 0)
        bev_rows.append({
            "sigla": r["sigla"],
            "name": bev_names.get(r["sigla"], r["sigla"]),
            "mattina": r.get("mattina", ""),
            "inUsc": r.get("inUsc", ""),
            "scarti": r.get("scarti", ""),
            "sera": r.get("sera", ""),
            "quantita": qty,
            "incasso": round(inc, 2),
            "comments": r.get("comments") or {},
        })
        if qty > 0:
            bev_total_qty += int(qty)
            bev_total_inc += inc
    orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)
    bev_sort_idx = {b["sigla"]: b.get("sort_order", 999) for b in BEVERAGES_CATALOG}
    bev_rows.sort(key=lambda r: bev_sort_idx.get(r["sigla"], 999))
    paste_count = _compute_paste_count(cash_doc.get("paste_text", "") if cash_doc else "")
    paste_unrecognized = _compute_paste_unrecognized(
        cash_doc.get("paste_text", "") if cash_doc else "",
        (cash_doc.get("manual_prices") if cash_doc else None) or {},
        dmap,
    )
    paste_total_eur = round(_compute_paste_total_eur(
        cash_doc.get("paste_text", "") if cash_doc else "",
        (cash_doc.get("manual_prices") if cash_doc else None) or {},
        dmap,
    ), 2)
    return {
        "date": date_str,
        "cash": cash_doc,
        "cash_sera": cash_sera,
        "beverages": bev_rows,
        "bev_total_qty": bev_total_qty,
        "bev_total_inc": round(bev_total_inc, 2),
        "orders": orders_info,
        "paste_count": paste_count,
        "paste_total_eur": paste_total_eur,
        "paste_unrecognized": paste_unrecognized,
    }


@api_router.get("/admin/closures/grid")
async def closures_grid_admin(
    days: int = 30,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Vista Excel-like: una riga per giorno con TUTTI i campi cash + bevande
    (mattina/inUsc/scarti/sera + qty + incasso per ogni sigla) + totali calcolati.
    Filtrabile per restaurant_id (richiesto per la vista per-locale).

    Accessibile anche da utenti normali (in sola lettura, forzati sul proprio locale).
    """
    is_admin = token_data.get("role") in ("admin",)
    if not is_admin:
        # Utente normale: forziamo il restaurant_id sul proprio
        restaurant_id = token_data.get("restaurant_id")
        if not restaurant_id:
            raise HTTPException(status_code=403, detail="Restaurant_id assente nel token")
    days = max(1, min(int(days or 30), 365))
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=days)).strftime("%Y-%m-%d")
    today = _today_rome_str()
    base_q = {"date_rome": {"$gte": cutoff, "$lt": today}}
    if restaurant_id:
        base_q["restaurant_id"] = restaurant_id

    dates: set = set()
    async for d in db.cash_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    async for d in db.beverage_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])

    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    bev_sigle_sorted = [b["sigla"] for b in sorted(BEVERAGES_CATALOG, key=lambda x: x.get("sort_order", 999))]
    # Cache dizionario paste per ristorante
    _dict_cache: Dict[str, Dict[str, float]] = {}
    async def _dict_for_grid(rid_local: Optional[str]) -> Dict[str, float]:
        if not rid_local:
            return dict(PASTA_PRICES_MAP)
        if rid_local not in _dict_cache:
            _dict_cache[rid_local] = await _get_pasta_dict_for(rid_local)
        return _dict_cache[rid_local]

    rows: List[Dict] = []
    for date_str in sorted(dates, reverse=True):
        cash_q = {"date_rome": date_str}
        bev_q = {"date_rome": date_str}
        if restaurant_id:
            cash_q["restaurant_id"] = restaurant_id
            bev_q["restaurant_id"] = restaurant_id
        cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
        bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
        bev_by_sigla = {b["sigla"]: b for b in bev_docs}
        dmap_row = await _dict_for_grid(restaurant_id or cash_doc.get("restaurant_id"))

        cash_flat: Dict[str, float] = {}
        for f in ALL_CASH_FIELDS:
            cash_flat[f] = _eval_cash_value(cash_doc.get(f, ""))

        bev_flat: Dict[str, Dict] = {}
        bev_total_qty = 0
        bev_total_inc = 0.0
        for sigla in bev_sigle_sorted:
            r = bev_by_sigla.get(sigla, {})
            m = _eval_cash_value(r.get("mattina"))
            u = _eval_cash_value(r.get("inUsc"))
            s = _eval_cash_value(r.get("scarti"))
            e = _eval_cash_value(r.get("sera"))
            qty = 0 if e == 0 else (m + u - s - e)
            inc = max(0, qty) * bev_prices.get(sigla, 0)
            bev_flat[sigla] = {
                "mattina": m, "inUsc": u, "scarti": s, "sera": e,
                "qty": int(qty), "incasso": round(inc, 2),
            }
            if qty > 0:
                bev_total_qty += int(qty)
                bev_total_inc += inc

        cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap_row), 2) if cash_doc else 0.0
        cash_sera_base = round(_compute_cash_sera(cash_doc), 2) if cash_doc else 0.0
        spicci_total = round(_compute_spicci_total(cash_doc), 2) if cash_doc else 0.0
        paste_text = cash_doc.get("paste_text", "") if cash_doc else ""
        manual_prices = cash_doc.get("manual_prices") or {}
        paste_count = _compute_paste_count(paste_text)
        paste_total_eur = round(_compute_paste_total_eur(paste_text, manual_prices, dmap_row), 2)
        orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)

        rows.append({
            "date": date_str,
            "is_mock": bool(cash_doc.get("mock") or any(b.get("mock") for b in bev_docs)),
            "cash": cash_flat,
            "vers_color": cash_doc.get("vers_color", ""),
            "beverages": bev_flat,
            "bev_total_qty": bev_total_qty,
            "bev_total_inc": round(bev_total_inc, 2),
            "cash_sera_base": cash_sera_base,
            "spicci_total": spicci_total,
            "paste_count": paste_count,
            "paste_total_eur": paste_total_eur,
            "orders_total": orders_info.get("total_orders", 0),
            "cash_sera": cash_sera,
        })

    return {
        "items": rows,
        "count": len(rows),
        "cash_fields": list(ALL_CASH_FIELDS),
        "bev_sigle": bev_sigle_sorted,
        "bev_prices": bev_prices,
    }


@api_router.post("/admin/closures/generate-mock")
async def admin_generate_mock_closures(
    payload: Dict, token_data: dict = Depends(verify_token)
):
    """Genera N chiusure mock per il locale indicato, partendo dal giorno
    precedente e andando indietro. Le righe sono marcate `mock: true` così
    da poter essere cancellate con `DELETE /api/admin/closures/mock`.
    Body: {restaurant_id: str, days: int = 7, overwrite: bool = false}
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rid = (payload or {}).get("restaurant_id")
    days = int((payload or {}).get("days") or 7)
    overwrite = bool((payload or {}).get("overwrite") or False)
    if not rid or not isinstance(rid, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    days = max(1, min(days, 90))

    import random
    random.seed()
    pasta_siglas = list(PASTA_PRICES_MAP.keys())
    bev_sigle = [b["sigla"] for b in BEVERAGES_CATALOG]

    created_cash = 0
    created_bev = 0
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for offset in range(1, days + 1):
        date_str = (datetime.now(ROME_TZ) - timedelta(days=offset)).strftime("%Y-%m-%d")

        existing = await db.cash_daily_counts.find_one(
            {"restaurant_id": rid, "date_rome": date_str}, {"_id": 0, "mock": 1}
        )
        if existing and not (existing.get("mock") or overwrite):
            skipped += 1
            continue

        mattina = random.randint(80, 250)
        altro = random.randint(0, 60)
        glo = random.randint(20, 120)
        just = random.randint(10, 80)
        delv = random.randint(20, 100)
        bp = random.randint(50, 200)
        sat = random.randint(40, 180)
        ft = random.randint(20, 90)
        pos = random.randint(150, 450)
        vers = random.randint(200, 800)
        arr = random.randint(0, 20)
        sp5 = random.randint(0, 3)
        sp2 = random.randint(0, 4)
        sp1 = random.randint(0, 6)
        sp05 = random.randint(0, 6)
        cd5 = random.randint(2, 8)
        cd2 = random.randint(3, 10)
        cd1 = random.randint(5, 15)
        cd05 = random.randint(5, 15)
        n_paste = random.randint(15, 50)
        paste_lines = []
        for _ in range(n_paste):
            sigla = random.choice(pasta_siglas)
            descr = random.choice(["", " - tavolo 5", " - asporto", " - PIET", " - LUCA"])
            paste_lines.append(f"{sigla}{descr}")
        paste_text = "\n".join(paste_lines)

        cash_set = {
            "restaurant_id": rid, "date_rome": date_str,
            "mattina": str(mattina), "altro": str(altro),
            "glo": str(glo), "just": str(just), "delv": str(delv),
            "bp": str(bp), "sat": str(sat), "ft": str(ft),
            "pos": str(pos), "vers": str(vers), "arr": str(arr),
            "sp5": str(sp5), "sp2": str(sp2), "sp1": str(sp1), "sp05": str(sp05),
            "cd5": str(cd5), "cd2": str(cd2), "cd1": str(cd1), "cd05": str(cd05),
            "vers_color": random.choice(["", "green", "blue", "black"]),
            "paste_text": paste_text,
            "manual_prices": {}, "cash_banconote": {}, "comments": {},
            "mock": True,
            "updated_at": now_iso,
        }
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": date_str},
            {"$set": cash_set},
            upsert=True,
        )
        created_cash += 1

        for sigla in bev_sigle:
            existing_bev = await db.beverage_daily_counts.find_one(
                {"restaurant_id": rid, "date_rome": date_str, "sigla": sigla},
                {"_id": 0, "mock": 1},
            )
            if existing_bev and not (existing_bev.get("mock") or overwrite):
                continue
            mattina_q = random.randint(40, 100)
            ingressi = random.randint(0, 24)
            scarti = random.randint(0, 3)
            vendute = random.randint(5, min(40, max(6, mattina_q + ingressi - scarti)))
            sera_q = max(0, mattina_q + ingressi - scarti - vendute)
            await db.beverage_daily_counts.update_one(
                {"restaurant_id": rid, "date_rome": date_str, "sigla": sigla},
                {"$set": {
                    "restaurant_id": rid, "date_rome": date_str, "sigla": sigla,
                    "mattina": str(mattina_q),
                    "inUsc": str(ingressi),
                    "scarti": str(scarti),
                    "sera": str(sera_q),
                    "mattina_casse": "", "mattina_sfuse": "",
                    "inUsc_casse": "",
                    "sera_casse": "", "sera_sfuse": "",
                    "comments": {}, "mock": True,
                    "updated_at": now_iso,
                }},
                upsert=True,
            )
            created_bev += 1

    return {
        "ok": True, "days_requested": days,
        "cash_rows_written": created_cash,
        "bev_rows_written": created_bev,
        "skipped_existing": skipped,
    }


@api_router.delete("/admin/closures/mock")
async def admin_delete_mock_closures(
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Elimina TUTTE le chiusure marcate `mock:true` (cash + bev).
    Filtrabile per `restaurant_id` (raccomandato)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q = {"mock": True}
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    res_cash = await db.cash_daily_counts.delete_many(q)
    res_bev = await db.beverage_daily_counts.delete_many(q)
    return {"ok": True, "cash_deleted": res_cash.deleted_count, "bev_deleted": res_bev.deleted_count}


# ─── DIZIONARIO PASTE PER RISTORANTE ─────────────────────────────────────────
class PastaDictionaryUpsert(BaseModel):
    restaurant_id: str
    siglas: List[Dict]  # [{sigla: "CARB", price: 8}, ...]


@api_router.get("/pasta-dictionary")
async def get_pasta_dictionary(
    request: Request,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Ritorna il dizionario paste per il ristorante. Se non c'è override in DB,
    torna il default `PASTA_PRICES_MAP`. Tutti possono leggere il proprio dict;
    Admin/Supervisor possono leggere quello di qualsiasi locale specificando `restaurant_id`."""
    role = token_data.get("role")
    if restaurant_id and role not in ("admin",):
        # Utenti non admin/supervisor non possono leggere il dict di un altro locale
        raise HTTPException(status_code=403, detail="Admin only per leggere dict altri locali")
    rid = restaurant_id
    if not rid:
        rid = await _effective_restaurant_id(request, token_data)
    if not rid:
        # Nessun rid → torna il default
        siglas = [{"sigla": k, "price": v} for k, v in PASTA_PRICES_MAP.items()]
        return {"restaurant_id": None, "siglas": siglas, "is_default": True}
    doc = await db.pasta_dictionary.find_one({"restaurant_id": rid}, {"_id": 0})
    if doc and doc.get("siglas"):
        return {
            "restaurant_id": rid,
            "siglas": doc["siglas"],
            "is_default": False,
            "updated_at": doc.get("updated_at"),
            "updated_by": doc.get("updated_by"),
        }
    siglas = [{"sigla": k, "price": v} for k, v in PASTA_PRICES_MAP.items()]
    return {"restaurant_id": rid, "siglas": siglas, "is_default": True}


@api_router.put("/pasta-dictionary")
async def upsert_pasta_dictionary(
    data: PastaDictionaryUpsert,
    request: Request,
    token_data: dict = Depends(verify_token),
):
    """Sovrascrive il dizionario paste di un ristorante. Solo Admin/Supervisor."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Solo Admin/Supervisor possono modificare il dizionario")
    if not data.restaurant_id or not isinstance(data.restaurant_id, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    # Sanitizzazione: sigla maiuscola, no spazi, prezzo numerico positivo
    clean: List[Dict] = []
    seen = set()
    for item in (data.siglas or []):
        try:
            sigla = str(item.get("sigla", "")).upper().strip()
            price = float(item.get("price", 0))
        except Exception:
            continue
        if not sigla or sigla in seen:
            continue
        if not re.match(r"^[A-Z0-9_-]{1,20}$", sigla):
            raise HTTPException(status_code=400, detail=f"Sigla non valida: '{sigla}' (solo A-Z, 0-9, max 20 char)")
        if price < 0 or price > 1000:
            raise HTTPException(status_code=400, detail=f"Prezzo non valido per '{sigla}'")
        seen.add(sigla)
        clean.append({"sigla": sigla, "price": price})

    username = token_data.get("name") or token_data.get("username") or token_data.get("sub") or "admin"
    await db.pasta_dictionary.update_one(
        {"restaurant_id": data.restaurant_id},
        {"$set": {
            "restaurant_id": data.restaurant_id,
            "siglas": clean,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": username,
        }},
        upsert=True,
    )
    return {"ok": True, "count": len(clean)}


@api_router.delete("/pasta-dictionary")
async def reset_pasta_dictionary(
    restaurant_id: str,
    token_data: dict = Depends(verify_token),
):
    """Resetta il dizionario di un ristorante al default. Solo Admin/Supervisor."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Solo Admin/Supervisor")
    res = await db.pasta_dictionary.delete_one({"restaurant_id": restaurant_id})
    return {"ok": True, "deleted": res.deleted_count}


@api_router.post("/admin/closures/snapshot-today")
async def admin_snapshot_today(
    payload: Dict, request: Request, token_data: dict = Depends(verify_token),
):
    """[TEST] Copia la chiusura di OGGI alla data target (default: ieri),
    così l'admin può vederla subito nella Vista Excel senza aspettare mezzanotte.
    Non tocca i dati di oggi. Sovrascrive eventuali dati esistenti sulla data target.
    Body: {restaurant_id?: str, target_date?: 'YYYY-MM-DD'}
    """
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Solo Admin/Supervisor")
    p = payload or {}
    rid = p.get("restaurant_id") or await _effective_restaurant_id(request, token_data)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    target_date = p.get("target_date") or (
        datetime.now(ROME_TZ) - timedelta(days=1)
    ).strftime("%Y-%m-%d")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", target_date):
        raise HTTPException(status_code=400, detail="target_date formato non valido")
    today = _today_rome_str()
    if target_date >= today:
        raise HTTPException(status_code=400, detail="target_date deve essere precedente a oggi")

    # Copia cash_daily_counts
    cash_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": today}, {"_id": 0}
    )
    cash_copied = 0
    if cash_doc:
        cash_copy = {**cash_doc, "date_rome": target_date, "mock": True,
                     "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": target_date},
            {"$set": cash_copy},
            upsert=True,
        )
        cash_copied = 1

    # Copia beverage_daily_counts (tutte le sigle)
    bev_docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": today}, {"_id": 0}
    ).to_list(50)
    bev_copied = 0
    for b in bev_docs:
        b_copy = {**b, "date_rome": target_date, "mock": True,
                  "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.beverage_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": target_date, "sigla": b["sigla"]},
            {"$set": b_copy},
            upsert=True,
        )
        bev_copied += 1

    return {
        "ok": True,
        "restaurant_id": rid,
        "target_date": target_date,
        "cash_copied": cash_copied,
        "bev_copied": bev_copied,
    }


@api_router.get("/admin/closures/{date_str}")
async def closure_detail_admin(
    date_str: str,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Dettaglio completo di una chiusura (data Rome YYYY-MM-DD). Admin only."""
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        raise HTTPException(status_code=400, detail="Data non valida")
    return await _build_closure_detail(date_str, restaurant_id)





@api_router.get("/closures/yesterday")
async def closure_yesterday(request: Request, token_data: dict = Depends(verify_token)):
    """Dettaglio della chiusura di IERI (limitata al locale corrente).
    Disponibile anche ai ristoranti (non solo Admin) — usa `_effective_restaurant_id`
    quindi Admin può comunque impersonare via X-Restaurant-Id."""
    rid = await _effective_restaurant_id(request, token_data)
    yesterday = (datetime.now(ROME_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
    return await _build_closure_detail(yesterday, rid)



@api_router.post("/beverages/carichi")
async def create_beverage_carico(
    data: BeverageCaricoCreate, token_data: dict = Depends(verify_token)
):
    """Register a beverage carico: increases inventory of each beverage at Flaminio."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    if not data.items:
        raise HTTPException(status_code=400, detail="Aggiungi almeno una bevanda")
    # Validate siglas
    valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
    for it in data.items:
        if it.sigla not in valid_siglas:
            raise HTTPException(status_code=400, detail=f"Sigla non valida: {it.sigla}")
        if it.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantità non valida per {it.sigla}")
    # Normalise items: store both `cases` and the resulting `units`
    items_saved = [
        {
            "sigla": it.sigla,
            "cases": int(it.quantity),
            "units": int(it.quantity) * UNITS_PER_CASE,
            # Back-compat: some downstream code may still look at `quantity`.
            # We keep it equal to cases to preserve the "human-readable"
            # count shown in the carico form.
            "quantity": int(it.quantity),
        }
        for it in data.items
    ]
    invoice_filename = save_image_to_disk(data.invoice_image_data, "beverage_invoice") if data.invoice_image_data else ""
    carico_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": carico_id,
        "restaurant_id": flaminio_id,
        "supplier": data.supplier.strip() or "Gioia",
        "invoice_file": invoice_filename,
        "invoice_url": f"/api/uploads/{invoice_filename}" if invoice_filename else "",
        "invoice_date": data.invoice_date or "",
        "items": items_saved,
        "units_per_case": UNITS_PER_CASE,
        "notes": (data.notes or "").strip(),
        "created_at": now_iso,
        "created_by": token_data["restaurant_id"],
    }
    await db.beverage_carichi.insert_one(doc)
    # Atomically increment inventory in UNITS for each beverage
    for it in items_saved:
        await db.beverage_inventory.update_one(
            {"restaurant_id": flaminio_id, "sigla": it["sigla"]},
            {
                "$inc": {"quantity": it["units"]},
                "$setOnInsert": {"id": str(uuid.uuid4())},
                "$set": {"updated_at": now_iso},
            },
            upsert=True,
        )
    doc.pop("_id", None)
    return doc


@api_router.get("/beverages/carichi")
async def list_beverage_carichi(token_data: dict = Depends(verify_token)):
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return []
    docs = await db.beverage_carichi.find(
        {"restaurant_id": flaminio_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return docs


@api_router.delete("/beverages/carichi/{carico_id}")
async def delete_beverage_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    """Delete a carico and revert its inventory impact. Within 20min for non-admins."""
    flaminio_id = await _get_flaminio_restaurant_id()
    doc = await db.beverage_carichi.find_one({"id": carico_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    # 20-minute rule for non-admins
    if token_data.get("role") != "admin":
        created = datetime.fromisoformat(doc["created_at"])
        if (datetime.now(timezone.utc) - created).total_seconds() > 20 * 60:
            raise HTTPException(status_code=403, detail="Carico modificabile solo entro 20 minuti")
    # Revert inventory (in units, falling back to quantity×UPC for legacy items)
    for it in doc.get("items", []):
        units = int(it.get("units") or (it.get("quantity", 0) * doc.get("units_per_case", UNITS_PER_CASE)))
        await db.beverage_inventory.update_one(
            {"restaurant_id": flaminio_id, "sigla": it["sigla"]},
            {"$inc": {"quantity": -units}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    await db.beverage_carichi.delete_one({"id": carico_id})
    return {"message": "Carico eliminato"}


@api_router.post("/beverages/sales")
async def register_beverage_sale(
    data: dict, token_data: dict = Depends(verify_token)
):
    """Register a +1 sale for a beverage. Decrements inventory by 1."""
    sigla = data.get("sigla")
    if not sigla:
        raise HTTPException(status_code=400, detail="sigla mancante")
    bev = await db.beverages.find_one({"sigla": sigla}, {"_id": 0})
    if not bev:
        raise HTTPException(status_code=404, detail="Bevanda non trovata")
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    now_iso = datetime.now(timezone.utc).isoformat()
    sale = {
        "id": str(uuid.uuid4()),
        "restaurant_id": flaminio_id,
        "sigla": sigla,
        "name": bev["name"],
        "quantity": 1,
        "price_each": bev["price"],
        "total": bev["price"],
        "created_at": now_iso,
        "created_by": token_data["restaurant_id"],
    }
    await db.beverage_sales.insert_one(sale)
    # Atomically decrement inventory (allowed to go negative to reflect reality)
    await db.beverage_inventory.update_one(
        {"restaurant_id": flaminio_id, "sigla": sigla},
        {
            "$inc": {"quantity": -1},
            "$setOnInsert": {"id": str(uuid.uuid4())},
            "$set": {"updated_at": now_iso},
        },
        upsert=True,
    )
    sale.pop("_id", None)
    return sale


@api_router.post("/beverages/sales/undo")
async def undo_beverage_sale(data: dict, token_data: dict = Depends(verify_token)):
    """Undo the most recent TODAY sale for a given sigla. Restores inventory +1."""
    sigla = data.get("sigla")
    if not sigla:
        raise HTTPException(status_code=400, detail="sigla mancante")
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    # "Today" in Europe/Rome
    start_utc, end_utc = _today_rome_bounds_utc()
    last = await db.beverage_sales.find_one(
        {
            "restaurant_id": flaminio_id,
            "sigla": sigla,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        },
        sort=[("created_at", -1)],
        projection={"_id": 0},
    )
    if not last:
        raise HTTPException(status_code=400, detail="Nessuna vendita di oggi da stornare")
    await db.beverage_sales.delete_one({"id": last["id"]})
    await db.beverage_inventory.update_one(
        {"restaurant_id": flaminio_id, "sigla": sigla},
        {"$inc": {"quantity": 1}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"message": "Vendita stornata", "sigla": sigla}


@api_router.get("/beverages/sales/today")
async def get_beverage_sales_today(token_data: dict = Depends(verify_token)):
    """Summary of today's sales per beverage for the Cassa box.
    Returns [{sigla, name, price, count, inventory}]."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return []
    start_utc, end_utc = _today_rome_bounds_utc()
    # Aggregate today's sales
    pipeline = [
        {"$match": {
            "restaurant_id": flaminio_id,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        }},
        {"$group": {"_id": "$sigla", "count": {"$sum": "$quantity"}}},
    ]
    agg = await db.beverage_sales.aggregate(pipeline).to_list(20)
    count_map = {a["_id"]: a["count"] for a in agg}
    # Inventory map
    inv_docs = await db.beverage_inventory.find(
        {"restaurant_id": flaminio_id}, {"_id": 0, "sigla": 1, "quantity": 1}
    ).to_list(20)
    inv_map = {d["sigla"]: d.get("quantity", 0) for d in inv_docs}
    beverages = await db.beverages.find({}, {"_id": 0}).sort("sort_order", 1).to_list(20)
    return [
        {
            "sigla": b["sigla"],
            "name": b["name"],
            "price": b["price"],
            "count": count_map.get(b["sigla"], 0),
            "inventory": inv_map.get(b["sigla"], 0),
        }
        for b in beverages
    ]


@api_router.get("/beverages/report")
async def beverage_report(
    date_from: str,
    date_to: str,
    token_data: dict = Depends(verify_token),
):
    """Aggregated sales between date_from and date_to (inclusive), Europe/Rome.
    Returns per-beverage totals and grand total."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return {"items": [], "grand_total": 0, "total_count": 0}
    try:
        from_date = datetime.strptime(date_from, "%Y-%m-%d")
        to_date = datetime.strptime(date_to, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato data non valido, usa YYYY-MM-DD")
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="date_to precede date_from")
    start_rome = from_date.replace(tzinfo=ROME_TZ)
    end_rome = (to_date + timedelta(days=1)).replace(tzinfo=ROME_TZ)
    start_utc = start_rome.astimezone(timezone.utc).isoformat()
    end_utc = end_rome.astimezone(timezone.utc).isoformat()
    # Query BOTH current and archived sales collections (midnight reset archives)
    beverages = await db.beverages.find({}, {"_id": 0}).sort("sort_order", 1).to_list(20)
    bev_map = {b["sigla"]: b for b in beverages}

    results = {b["sigla"]: {"sigla": b["sigla"], "name": b["name"], "price": b["price"], "count": 0, "total": 0.0} for b in beverages}

    for coll in ("beverage_sales", "archived_beverage_sales"):
        pipeline = [
            {"$match": {
                "restaurant_id": flaminio_id,
                "created_at": {"$gte": start_utc, "$lt": end_utc},
            }},
            {"$group": {
                "_id": "$sigla",
                "count": {"$sum": "$quantity"},
                "total": {"$sum": "$total"},
            }},
        ]
        agg = await db[coll].aggregate(pipeline).to_list(20)
        for a in agg:
            sig = a["_id"]
            if sig in results:
                results[sig]["count"] += int(a["count"])
                results[sig]["total"] += float(a["total"])

    items = [results[b["sigla"]] for b in beverages]
    grand_total = round(sum(x["total"] for x in items), 2)
    total_count = sum(x["count"] for x in items)
    return {
        "from": date_from,
        "to": date_to,
        "items": items,
        "grand_total": grand_total,
        "total_count": total_count,
    }


# ==================== ANALISI MAGAZZINO ====================

@api_router.get("/analisi/magazzino")
async def analisi_magazzino(
    date_from: str,
    date_to: str,
    token_data: dict = Depends(verify_token),
):
    """
    Analisi movimenti magazzino in un range di date.
    date_from/date_to in formato YYYY-MM-DD (inclusivi).
    Ritorna per ogni prodotto con almeno un movimento:
      - incoming: unità entrate (dai carichi)
      - outgoing: dict {location: unità uscite}  (richieste evase)
    """
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")

    # ISO range strings. Stored created_at/evasa_at have format
    # "YYYY-MM-DDTHH:MM:SS.ffffff+00:00" (UTC). The user picks Rome-local days,
    # so we need to convert the Rome-local midnight boundaries to UTC ISO
    # strings before doing the lexicographic comparison. Without this, every
    # carico/richiesta done in the first ~2 hours of a Rome day was mis-
    # attributed to the previous day (and viceversa).
    try:
        dt_from_rome = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
        dt_to_rome = datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato data non valido (attendo YYYY-MM-DD)")
    if dt_to_rome < dt_from_rome:
        raise HTTPException(status_code=400, detail="La data finale deve essere >= data iniziale")
    # [Rome midnight of date_from, Rome midnight of date_to + 1 day) in UTC ISO
    from_iso = dt_from_rome.astimezone(timezone.utc).isoformat()
    to_iso_excl = (dt_to_rome + timedelta(days=1)).astimezone(timezone.utc).isoformat()

    # Active restaurant locations (columns)
    restaurants = await db.restaurants.find(
        {"role": "restaurant"}, {"_id": 0, "location": 1}
    ).to_list(20)
    locations = [r["location"] for r in restaurants if r.get("location")]

    # Incoming: from carichi_magazzino
    incoming_agg = await db.carichi_magazzino.aggregate([
        {"$match": {"created_at": {"$gte": from_iso, "$lt": to_iso_excl}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "total": {"$sum": "$items.quantity_added"},
        }},
    ]).to_list(5000)
    incoming_map = {r["_id"]: int(r["total"]) for r in incoming_agg}

    # Outgoing: from richieste — attribuite al giorno di CREAZIONE della
    # richiesta (non più al giorno di evasione). Una richiesta entra nel
    # report solo dopo che è passata 1 ora dalla sua creazione (grace
    # period: entro l'ora i locali possono ancora modificarla — di fatto
    # la finestra di modifica è 20 min, ma teniamo 1h come margine pieno).
    # Stato: qualunque, perché le richieste cancellate vengono `delete_one`
    # in DB → spariscono automaticamente da qui.
    grace_cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    outgoing_agg = await db.richieste.aggregate([
        {"$match": {
            "created_at": {
                "$gte": from_iso,
                "$lt": to_iso_excl,
                "$lte": grace_cutoff_iso,
            },
        }},
        {"$unwind": "$items"},
        {"$group": {
            "_id": {
                "product_id": "$items.product_id",
                "location": "$restaurant_location",
            },
            "total": {"$sum": "$items.quantity"},
        }},
    ]).to_list(10000)

    outgoing_map: Dict[str, Dict[str, int]] = {}
    for r in outgoing_agg:
        pid = r["_id"]["product_id"]
        loc = r["_id"]["location"] or ""
        outgoing_map.setdefault(pid, {})[loc] = int(r["total"])

    # Union of product_ids with activity
    active_ids = set(incoming_map.keys()) | set(outgoing_map.keys())

    # Fetch ALL products (with or without activity in this range).
    # NB: il frontend mostra tutto, righe senza movimenti = totali a zero.
    products = await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(5000)

    result_products = []
    for p in products:
        pid = p["id"]
        image_url = ""
        if p.get("image_file"):
            image_url = f"/api/uploads/{p['image_file']}"
        elif p.get("image_data", "").startswith("data:"):
            image_url = p["image_data"]

        out = outgoing_map.get(pid, {})
        result_products.append({
            "product_id": pid,
            "name": p.get("name", ""),
            "unit": p.get("unit", ""),
            "supplier": p.get("supplier", ""),
            "image_url": image_url,
            "incoming": incoming_map.get(pid, 0),
            "outgoing": {loc: out.get(loc, 0) for loc in locations},
            "outgoing_total": sum(out.values()),
            "has_activity": pid in active_ids,
        })

    return {
        "date_from": date_from,
        "date_to": date_to,
        "locations": locations,
        "products": result_products,
    }




# ==================== VERSAMENTI (DEPOSITS) ====================

class VersamentoCreate(BaseModel):
    description: str = ""
    control_code: str = ""
    image_data: str = ""
    versamento_date: str = None

@api_router.post("/versamenti")
async def create_versamento(data: VersamentoCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]
    
    # Check for duplicate control code within today if provided
    if data.control_code:
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.versamenti.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")
    
    versamento_id = str(uuid.uuid4())
    
    # Save image to disk instead of DB
    image_filename = save_image_to_disk(data.image_data, "versamento")
    
    versamento = {
        "id": versamento_id,
        "restaurant_id": restaurant_id,
        "description": data.description,
        "control_code": data.control_code,
        "image_file": image_filename,
        "versamento_date": data.versamento_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }
    
    await db.versamenti.insert_one(versamento)
    
    return {
        "id": versamento_id,
        "message": "Versamento caricato con successo"
    }

@api_router.get("/versamenti")
async def get_versamenti(
    search: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Search in description
    if search:
        query["description"] = {"$regex": search, "$options": "i"}
    
    versamenti = await db.versamenti.find(query, {"_id": 0}).sort("versamento_date", -1).to_list(500)
    
    for v in versamenti:
        if v.get("image_file"):
            v["image_data"] = f"/api/uploads/{v['image_file']}"
        v.pop("image_file", None)
    
    return versamenti

@api_router.delete("/versamenti/{versamento_id}")
async def delete_versamento(versamento_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": versamento_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.versamenti.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Versamento non trovato")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    await db.versamenti.delete_one({"id": versamento_id})
    return {"message": "Versamento eliminato"}

# ==================== CHIUSURE (CLOSURES) ====================

class ChiusuraCreate(BaseModel):
    description: str = ""
    tipologia: str = "Piatti"
    control_code: str = ""
    image_data: str = ""
    piatti_data: Optional[str] = None
    chiusura_date: str = None

class ChiusuraPiattiUpload(BaseModel):
    piatti_data: str

@api_router.post("/chiusure")
async def create_chiusura(data: ChiusuraCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]
    
    # Check for duplicate control code within today if provided
    if data.control_code:
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.chiusure.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")
    
    chiusura_id = str(uuid.uuid4())
    
    # Save images to disk
    image_filename = save_image_to_disk(data.image_data, "chiusura")
    piatti_filename = save_image_to_disk(data.piatti_data, "chiusura_piatti") if data.piatti_data else ""

    chiusura = {
        "id": chiusura_id,
        "restaurant_id": restaurant_id,
        "description": data.description,
        "tipologia": data.tipologia,
        "control_code": data.control_code,
        "image_file": image_filename,
        "piatti_file": piatti_filename,
        "chiusura_date": data.chiusura_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }
    
    await db.chiusure.insert_one(chiusura)
    
    return {
        "id": chiusura_id,
        "message": "Chiusura caricata con successo"
    }

@api_router.get("/chiusure")
async def get_chiusure(
    search: str = None,
    tipologia: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Filter by tipologia
    if tipologia and tipologia != "all":
        query["tipologia"] = tipologia
    
    # Search in description
    if search:
        query["description"] = {"$regex": search, "$options": "i"}
    
    chiusure = await db.chiusure.find(query, {"_id": 0}).sort("chiusura_date", -1).to_list(500)
    
    for c in chiusure:
        if c.get("image_file"):
            c["image_data"] = f"/api/uploads/{c['image_file']}"
        c.pop("image_file", None)
        piatti = c.pop("piatti_file", None)
        c["piatti_url"] = f"/api/uploads/{piatti}" if piatti else ""

    return chiusure

@api_router.delete("/chiusure/{chiusura_id}")
async def delete_chiusura(chiusura_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    # Remove associated images from disk
    for key in ("image_file", "piatti_file"):
        fn = doc.get(key)
        if fn:
            p = UPLOADS_DIR / fn
            if p.exists():
                p.unlink()
    await db.chiusure.delete_one({"id": chiusura_id})
    return {"message": "Chiusura eliminata"}


@api_router.put("/chiusure/{chiusura_id}/piatti")
async def upload_chiusura_piatti(chiusura_id: str, data: ChiusuraPiattiUpload, token_data: dict = Depends(verify_token)):
    """Attach/replace the 'piatti' photo for a given chiusura."""
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    if not data.piatti_data:
        raise HTTPException(status_code=400, detail="Immagine piatti mancante")
    old = doc.get("piatti_file")
    if old:
        p = UPLOADS_DIR / old
        if p.exists():
            p.unlink()
    filename = save_image_to_disk(data.piatti_data, "chiusura_piatti")
    await db.chiusure.update_one(
        {"id": chiusura_id},
        {"$set": {"piatti_file": filename}}
    )
    return {"piatti_url": f"/api/uploads/{filename}"}


@api_router.delete("/chiusure/{chiusura_id}/piatti")
async def delete_chiusura_piatti(chiusura_id: str, token_data: dict = Depends(verify_token)):
    """Remove the 'piatti' photo from a chiusura."""
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    old = doc.get("piatti_file")
    if old:
        p = UPLOADS_DIR / old
        if p.exists():
            p.unlink()
    await db.chiusure.update_one({"id": chiusura_id}, {"$unset": {"piatti_file": ""}})
    return {"message": "Foto piatti rimossa"}


# ==================== FATTURE GLOBALI (Admin only) ====================
# Schema fattura_globale (collezione `fatture_globali`):
#   id, supplier, importo (LEGACY), ddt_numbers (string), image_file, invoice_date,
#   created_at, uploaded_by, paid (bool), paid_at (ISO or None),
#   linked_invoice_ids: [string]   # ID delle invoices (DDT) dei locali abbinate
# Match per NUMERO DDT (non più per importo):
#   - paid=true → ORO
#   - tutti i numeri DDT dichiarati sono linkati e nessun linked è "extra" → VERDE
#   - ci sono linked ma non coincidono con i declared → ROSSO
#   - 0 link → BLU

def _normalize_ddt_number(s: str) -> str:
    """Normalizza il numero DDT per il confronto: lowercase + rimuove spazi."""
    if not s:
        return ""
    return "".join(str(s).split()).lower()


def _parse_ddt_numbers(text: str) -> list:
    """Parsa stringa tipo '12345, 67/abc , 999' → lista di numeri normalizzati,
    preservando però il valore originale (trimmato) per la visualizzazione.
    Ritorna lista di dict {raw, norm}."""
    if not text:
        return []
    parts = [p.strip() for p in str(text).split(",")]
    out = []
    seen = set()
    for p in parts:
        if not p:
            continue
        norm = _normalize_ddt_number(p)
        if norm in seen:
            continue
        seen.add(norm)
        out.append({"raw": p, "norm": norm})
    return out


class FatturaGlobaleCreate(BaseModel):
    supplier: str
    importo: Optional[float] = 0.0  # LEGACY: non più richiesto
    ddt_numbers: Optional[str] = ""  # NEW: testo libero con numeri separati da virgola
    image_data: str  # base64
    invoice_date: Optional[str] = None


async def _enrich_global_invoice(doc: dict) -> dict:
    """Aggiunge URL immagini, dettagli invoices linkate e stato match per numero DDT."""
    base_url = "/api/uploads/"
    linked_ids = doc.get("linked_invoice_ids") or []
    linked_docs = []
    linked_norms = set()
    if linked_ids:
        cursor = db.invoices.find({"id": {"$in": linked_ids}}, {"_id": 0})
        async for inv in cursor:
            ddt_n = (inv.get("ddt_number") or "").strip()
            linked_norms.add(_normalize_ddt_number(ddt_n))
            linked_docs.append({
                "id": inv.get("id"),
                "supplier": inv.get("supplier") or "",
                "importo": float(inv.get("importo") or 0),
                "ddt_number": ddt_n,
                "image_url": base_url + inv["image_file"] if inv.get("image_file") else "",
                "uploaded_by": inv.get("uploaded_by") or "",
                "created_at": inv.get("created_at"),
                "restaurant_id": inv.get("restaurant_id"),
            })

    declared = _parse_ddt_numbers(doc.get("ddt_numbers") or "")
    declared_norms = {d["norm"] for d in declared}
    missing = [d["raw"] for d in declared if d["norm"] not in linked_norms]
    extra = [n for n in linked_norms if n not in declared_norms and n != ""]

    return {
        "id": doc.get("id"),
        "supplier": doc.get("supplier") or "",
        "importo": float(doc.get("importo") or 0),  # legacy
        "ddt_numbers": doc.get("ddt_numbers") or "",
        "declared_ddt": [d["raw"] for d in declared],
        "missing_ddt": missing,
        "extra_ddt_count": len(extra),
        "image_url": base_url + doc["image_file"] if doc.get("image_file") else "",
        "invoice_date": doc.get("invoice_date"),
        "created_at": doc.get("created_at"),
        "uploaded_by": doc.get("uploaded_by") or "",
        "paid": bool(doc.get("paid", False)),
        "paid_at": doc.get("paid_at"),
        "linked_invoices": linked_docs,
    }


def _require_admin(token_data: dict):
    if token_data.get("role") not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="Solo admin")


@api_router.post("/admin/fatture-globali")
async def create_fattura_globale(
    data: FatturaGlobaleCreate,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    if not data.supplier.strip():
        raise HTTPException(status_code=400, detail="Fornitore obbligatorio")
    if not (data.ddt_numbers or "").strip():
        raise HTTPException(status_code=400, detail="Inserisci almeno un numero DDT")
    if not data.image_data:
        raise HTTPException(status_code=400, detail="Foto fattura obbligatoria")
    image_filename = save_image_to_disk(data.image_data, "fattura_globale")
    declared = _parse_ddt_numbers(data.ddt_numbers)
    declared_norms = [d["norm"] for d in declared]

    # Auto-link: cerca tra le invoices del fornitore quelli con ddt_number che
    # combacia (normalizzato). Esclude quelli già linkati ad ALTRE globali.
    auto_link_ids = []
    if declared_norms:
        candidates = db.invoices.find({
            "supplier": data.supplier.strip(),
            "ddt_number": {"$nin": ["", None]},
        }, {"_id": 0, "id": 1, "ddt_number": 1})
        # Set di invoice_id già linkate altrove
        linked_elsewhere = set()
        async for fg in db.fatture_globali.find({}, {"linked_invoice_ids": 1}):
            for x in (fg.get("linked_invoice_ids") or []):
                linked_elsewhere.add(x)
        async for inv in candidates:
            n = _normalize_ddt_number(inv.get("ddt_number") or "")
            if n and n in declared_norms and inv["id"] not in linked_elsewhere:
                auto_link_ids.append(inv["id"])

    doc = {
        "id": str(uuid.uuid4()),
        "supplier": data.supplier.strip(),
        "importo": float(data.importo or 0),
        "ddt_numbers": data.ddt_numbers.strip(),
        "image_file": image_filename,
        "invoice_date": data.invoice_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": token_data.get("restaurant_name") or "admin",
        "paid": False,
        "paid_at": None,
        "linked_invoice_ids": auto_link_ids,
    }
    await db.fatture_globali.insert_one(doc)
    return await _enrich_global_invoice(doc)


@api_router.get("/admin/fatture-globali")
async def list_fatture_globali(token_data: dict = Depends(verify_token)):
    _require_admin(token_data)
    # Filtro legacy: mostriamo solo le fatture globali nuove (con ddt_numbers).
    # Le vecchie (solo importo, senza ddt_numbers) restano in DB ma non vengono mostrate.
    docs = await db.fatture_globali.find(
        {"ddt_numbers": {"$nin": ["", None]}},
        {"_id": 0},
    ).sort([("paid", 1), ("created_at", -1)]).to_list(1000)
    return [await _enrich_global_invoice(d) for d in docs]


@api_router.get("/admin/ddt-list")
async def list_all_ddt(token_data: dict = Depends(verify_token)):
    """Ritorna TUTTI i DDT (invoices) dei locali con ddt_number valorizzato,
    ordinati per fornitore e poi per data desc. Include flag `already_linked`
    per indicare se sono già abbinati a una fattura globale."""
    _require_admin(token_data)
    docs = await db.invoices.find(
        {"ddt_number": {"$nin": ["", None]}},
        {"_id": 0},
    ).sort([("supplier", 1), ("created_at", -1)]).to_list(5000)

    linked_to_globals = set()
    async for fg in db.fatture_globali.find({}, {"linked_invoice_ids": 1}):
        for x in (fg.get("linked_invoice_ids") or []):
            linked_to_globals.add(x)

    out = []
    for d in docs:
        out.append({
            "id": d.get("id"),
            "supplier": d.get("supplier") or "",
            "ddt_number": d.get("ddt_number") or "",
            "image_url": ("/api/uploads/" + d["image_file"]) if d.get("image_file") else "",
            "uploaded_by": d.get("uploaded_by") or "",
            "created_at": d.get("created_at"),
            "invoice_date": d.get("invoice_date"),
            "restaurant_id": d.get("restaurant_id"),
            "already_linked": d.get("id") in linked_to_globals,
            "paid": bool(d.get("paid", False)),
        })
    return out


@api_router.get("/admin/fatture-locali-by-supplier")
async def list_locale_invoices_by_supplier(
    supplier: str,
    token_data: dict = Depends(verify_token),
):
    """Ritorna i DDT dei locali per un fornitore specifico (vista di compatibilità).
    Mostra solo DDT con `ddt_number` valorizzato (i vecchi sono nascosti dalla pagina admin)."""
    _require_admin(token_data)
    if not supplier or not supplier.strip():
        return []
    docs = await db.invoices.find(
        {"supplier": supplier.strip(), "ddt_number": {"$nin": ["", None]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    linked_to_others = set()
    async for fg in db.fatture_globali.find({"supplier": supplier.strip()}, {"linked_invoice_ids": 1}):
        for x in (fg.get("linked_invoice_ids") or []):
            linked_to_others.add(x)
    out = []
    for d in docs:
        out.append({
            "id": d.get("id"),
            "supplier": d.get("supplier") or "",
            "importo": float(d.get("importo") or 0),
            "ddt_number": d.get("ddt_number") or "",
            "image_url": ("/api/uploads/" + d["image_file"]) if d.get("image_file") else "",
            "uploaded_by": d.get("uploaded_by") or "",
            "created_at": d.get("created_at"),
            "restaurant_id": d.get("restaurant_id"),
            "already_linked": d.get("id") in linked_to_others,
        })
    return out


@api_router.post("/admin/fatture-globali/{fg_id}/link/{invoice_id}")
async def link_invoice_to_global(
    fg_id: str,
    invoice_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    fg = await db.fatture_globali.find_one({"id": fg_id})
    if not fg:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Fattura locale non trovata")
    # Evita link duplicati (anche su altre globali)
    already = await db.fatture_globali.find_one({"linked_invoice_ids": invoice_id})
    if already and already.get("id") != fg_id:
        raise HTTPException(status_code=400, detail="Questa fattura locale è già abbinata a un'altra fattura globale")
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$addToSet": {"linked_invoice_ids": invoice_id}},
    )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    return await _enrich_global_invoice(new_doc)


@api_router.delete("/admin/fatture-globali/{fg_id}/link/{invoice_id}")
async def unlink_invoice_from_global(
    fg_id: str,
    invoice_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$pull": {"linked_invoice_ids": invoice_id}},
    )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    if not new_doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    return await _enrich_global_invoice(new_doc)


@api_router.post("/admin/fatture-globali/{fg_id}/pay")
async def mark_global_paid(
    fg_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    doc = await db.fatture_globali.find_one({"id": fg_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    enriched = await _enrich_global_invoice(doc)
    # Check match per numero DDT: tutti i numeri dichiarati devono essere coperti
    # dai DDT linkati (no missing) e niente DDT linkati "extra" (non dichiarati).
    if enriched.get("missing_ddt"):
        raise HTTPException(
            status_code=400,
            detail=f"DDT mancanti: {', '.join(enriched['missing_ddt'])}",
        )
    if enriched.get("extra_ddt_count", 0) > 0:
        raise HTTPException(
            status_code=400,
            detail="Ci sono DDT abbinati che non sono dichiarati nella fattura",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$set": {"paid": True, "paid_at": now_iso}},
    )
    # Propaga il pagamento a TUTTE le fatture locali (DDT) abbinate:
    # diventano automaticamente "PAGATO" lato pagina DDT dei vari locali.
    linked_ids = doc.get("linked_invoice_ids") or []
    if linked_ids:
        await db.invoices.update_many(
            {"id": {"$in": linked_ids}},
            {"$set": {"paid": True, "paid_at": now_iso, "paid_via_global_id": fg_id}},
        )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    return await _enrich_global_invoice(new_doc)


@api_router.delete("/admin/fatture-globali/{fg_id}")
async def delete_fattura_globale(
    fg_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    doc = await db.fatture_globali.find_one({"id": fg_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    img = doc.get("image_file")
    if img:
        p = UPLOADS_DIR / img
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    await db.fatture_globali.delete_one({"id": fg_id})
    return {"message": "Fattura globale eliminata"}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # Origini esplicitamente autorizzate. Preview Emergent + VPS prod (IP e dominio,
    # http+https) + localhost per sviluppo. Quando aggiungerai un nuovo dominio,
    # includi qui entrambe le varianti http:// e https://.
    allow_origins=[
        # Preview Emergent
        "https://real-time-orders-3.preview.emergentagent.com",
        # Produzione VPS — HTTP
        "http://51.91.125.232",
        "http://pasta-app.it",
        "http://www.pasta-app.it",
        # Produzione VPS — HTTPS (già pronti per il futuro switch)
        "https://51.91.125.232",
        "https://pasta-app.it",
        "https://www.pasta-app.it",
    ],
    # Sviluppo locale: localhost / 127.0.0.1 su qualsiasi porta (CRA 3000, Vite 5173, ecc.)
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

@app.on_event("startup")
async def startup_scheduler():
    asyncio.create_task(midnight_scheduler())
    
    # Self-healing: archive any stale orders left from previous day
    # (in case midnight_reset never ran due to server downtime)
    await recover_stale_orders()

    # Retention: drop fatture / versamenti / chiusure older than 3 months
    # at boot too, so admins don't have to wait for the next midnight.
    try:
        await cleanup_old_uploads()
    except Exception as e:
        logger.error(f"[CLEANUP] startup cleanup_old_uploads failed: {e}", exc_info=True)
    
    # Seed beverage catalog if empty (9 beverages for Flaminio)
    await _ensure_beverages_seeded()

    # Seed Federico (role "supervisor"): has access to Storico Chiusure,
    # Controllo Report (audit-cassa) and Diagnostica Live — nothing else.
    try:
        federico = await db.restaurants.find_one({"username": "Federico"})
        if not federico:
            await db.restaurants.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Supervisore",
                "username": "Federico",
                "password": pwd_context.hash("Pastasciutta@32"),
                "location": "Supervisione",
                "role": "supervisor",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0,
            })
            logger.info("[SEED] Created Federico (role=supervisor)")
    except Exception as e:
        logger.warning(f"[SEED] Could not ensure Federico account: {e}")
    
    # Create MongoDB indexes for faster queries
    await db.orders.create_index([("restaurant_id", 1), ("status", 1)])
    await db.orders.create_index([("restaurant_id", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("kitchen_completed", 1)])
    # UNIQUE index: prevents two orders for the same restaurant having the same
    # order_number in the active orders collection. Last-line-of-defense against
    # the duplicate-number bug. Active orders are cleared every midnight so the
    # uniqueness scope is naturally per-day.
    try:
        await db.orders.create_index(
            [("restaurant_id", 1), ("order_number", 1)],
            unique=True,
            name="uniq_restaurant_order_number",
        )
    except Exception as e:
        logger.warning(f"Could not create unique index on orders (likely existing duplicates): {e}")
    await db.archived_orders.create_index([("restaurant_id", 1), ("created_at", -1)])
    await db.deletion_logs.create_index([("restaurant_id", 1), ("deleted_at", -1)])
    # Stock movements ledger
    await db.stock_movements.create_index([("product_id", 1), ("timestamp", -1)])
    await db.stock_movements.create_index([("timestamp", -1)])
    await db.stock_movements.create_index([("cause", 1), ("timestamp", -1)])
    # Beverage daily counts (Magazzino Bevande page)
    await db.beverage_daily_counts.create_index(
        [("restaurant_id", 1), ("date_rome", -1), ("sigla", 1)], unique=True
    )
    await db.beverage_daily_counts.create_index([("date_rome", -1)])
    # Cash daily counts (Report page — riepilogo cassa)
    await db.cash_daily_counts.create_index(
        [("restaurant_id", 1), ("date_rome", -1)], unique=True
    )
    await db.cash_daily_counts.create_index([("date_rome", -1)])
    # Audit log (Report Cassa + Bevande)
    await db.cash_audit_log.create_index([("last_at", -1)])
    await db.cash_audit_log.create_index([("restaurant_id", 1), ("date_rome", -1), ("last_at", -1)])
    await db.cash_audit_log.create_index([("category", 1), ("field", 1), ("last_at", -1)])
    logger.info("MongoDB indexes created")

    # Populate the in-memory restaurant->location cache used by the
    # diagnostics middleware to attach `location` to each API log entry.
    try:
        async for r in db.restaurants.find({}, {"_id": 0, "id": 1, "location": 1, "username": 1}):
            rid = r.get("id") or ""
            if rid:
                RESTAURANT_LOCATION_CACHE[rid] = r.get("location") or r.get("username") or rid[:8]
        logger.info(f"Restaurant location cache populated: {len(RESTAURANT_LOCATION_CACHE)} entries")
    except Exception as e:
        logger.warning(f"Could not populate restaurant cache: {e}")
