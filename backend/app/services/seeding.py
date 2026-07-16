import logging

from app.core.catalogs import BEVERAGES_CATALOG
from app.core.database import db


logger = logging.getLogger(__name__)


async def _ensure_beverages_seeded():
    """Insert the beverage catalog the first time the backend starts."""
    existing = await db.beverages.count_documents({})
    if existing == 0:
        await db.beverages.insert_many([{**b} for b in BEVERAGES_CATALOG])
        logger.info(f"Seeded {len(BEVERAGES_CATALOG)} beverages")
