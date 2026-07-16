import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import APIRouter, FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.core.config import CORS_ALLOWED_ORIGINS, ENABLE_API_DOCS, IS_DEVELOPMENT
from app.core.database import client, db
from app.core.diagnostics import diagnostics_middleware
from app.core.rate_limit import limiter
from app.core.state import RESTAURANT_LOCATION_CACHE
from app.routers.analysis import router as analysis_router
from app.routers.beverages import router as beverages_router
from app.routers.documents import router as documents_router
from app.routers.invoices import router as invoices_router
from app.routers.orders import router as orders_router
from app.routers.report import router as report_router
from app.routers.system import router as system_router
from app.routers.warehouse import router as warehouse_router
from app.routers.websocket import router as websocket_router
from app.services.seeding import _ensure_beverages_seeded
from app.tasks.maintenance import cleanup_old_uploads
from app.tasks.midnight import midnight_scheduler
from app.tasks.stale_orders import recover_stale_orders


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def shutdown_db_client():
    client.close()

async def initialize_application():
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

    try:
        await db.restaurants.update_many(
            {"boiler_count": {"$exists": False}},
            {"$set": {"boiler_count": 1}}
        )
        await db.restaurants.update_one(
            {"username": "Flaminio", "role": "restaurant"},
            {"$set": {"boiler_count": 2}}
        )
    except Exception as e:
        logger.warning(f"[SEED] Could not normalize boiler_count: {e}")

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
    await db.deletion_logs.create_index([("restaurant_id", 1), ("original_created_at", -1)])
    await db.archived_deletion_logs.create_index(
        [("restaurant_id", 1), ("original_created_at", -1)]
    )
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



@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler_task = asyncio.create_task(midnight_scheduler())
    try:
        await initialize_application()
        yield
    finally:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task
        await shutdown_db_client()


async def startup_scheduler():
    """Compatibility wrapper for the former FastAPI startup handler."""
    asyncio.create_task(midnight_scheduler())
    await initialize_application()


api_router = APIRouter(prefix="/api")
api_router.include_router(orders_router)
api_router.include_router(report_router)
api_router.include_router(analysis_router)
api_router.include_router(system_router)
api_router.include_router(invoices_router)
api_router.include_router(warehouse_router)
api_router.include_router(beverages_router)
api_router.include_router(documents_router)


def create_app() -> FastAPI:
    docs_enabled = ENABLE_API_DOCS or IS_DEVELOPMENT
    application = FastAPI(
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    application.state.limiter = limiter
    application.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    application.add_middleware(GZipMiddleware, minimum_size=500)
    application.middleware("http")(diagnostics_middleware)

    # Keep WebSocket registration before the HTTP router, matching the legacy app.
    application.include_router(websocket_router)
    application.include_router(api_router)
    application.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=list(CORS_ALLOWED_ORIGINS),
        allow_origin_regex=(
            r"^http://(localhost|127\.0\.0\.1)(:\d+)?$" if IS_DEVELOPMENT else None
        ),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "Content-Disposition",
            "X-Analysis-Warning-Count",
            "X-Analysis-Missing-Snapshot-Count",
            "X-Analysis-Manual-Override-Count",
        ],
    )
    return application


app = create_app()
