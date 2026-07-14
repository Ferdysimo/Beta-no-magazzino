import logging
import uuid
from datetime import datetime, timezone

from app.core.catalogs import BEVERAGES_CATALOG
from app.core.config import SIMONE_MIN_TOKEN_VERSION
from app.core.database import db
from app.core.security import pwd_context


logger = logging.getLogger(__name__)


# Seed data endpoint for initial setup
PRIVILEGED_SEED_ACCOUNTS = [
    {
        "name": "Amministratore",
        "username": "Admin",
        "password": "Pastasciutt4!",
        "location": "Amministrazione",
        "role": "admin",
    },
    {
        "name": "Simone",
        "username": "Simone",
        "password": "aothj7nejx",
        "location": "Amministrazione",
        "role": "admin",
        "token_version": SIMONE_MIN_TOKEN_VERSION,
    },
]


async def ensure_seed_account(account: dict) -> bool:
    existing = await db.restaurants.find_one({"username": account["username"]})
    if existing:
        return False

    await db.restaurants.insert_one({
        "id": str(uuid.uuid4()),
        "name": account["name"],
        "username": account["username"],
        "password": pwd_context.hash(account["password"]),
        "location": account["location"],
        "role": account["role"],
        "token_version": account.get("token_version", 1),
        "boiler_count": account.get("boiler_count", 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order_counter": 0
    })
    return True


async def ensure_simone_token_version() -> None:
    await db.restaurants.update_one(
        {"username": "Simone"},
        {"$set": {"token_version": SIMONE_MIN_TOKEN_VERSION}},
    )


async def _ensure_beverages_seeded():
    """Insert the beverage catalog the first time the backend starts."""
    existing = await db.beverages.count_documents({})
    if existing == 0:
        await db.beverages.insert_many([{**b} for b in BEVERAGES_CATALOG])
        logger.info(f"Seeded {len(BEVERAGES_CATALOG)} beverages")
