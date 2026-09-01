from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.core.catalogs import BEVERAGES_CATALOG
from app.core.database import db


def _default_beverage_catalog() -> List[Dict]:
    """Return a detached, consistently ordered copy of the fixed catalog."""
    return [
        {
            "sigla": str(item["sigla"]),
            "name": str(item["name"]),
            "price": float(item["price"]),
            "sort_order": int(item.get("sort_order", 999)),
        }
        for item in sorted(BEVERAGES_CATALOG, key=lambda row: row.get("sort_order", 999))
    ]


def _beverage_price_overrides_from_doc(doc: Optional[Dict]) -> Dict[str, float]:
    overrides: Dict[str, float] = {}
    for item in (doc or {}).get("prices") or []:
        if not isinstance(item, dict):
            continue
        sigla = str(item.get("sigla", "")).upper().strip()
        try:
            price = float(item.get("price"))
        except (TypeError, ValueError):
            continue
        if sigla and 0 <= price <= 1000:
            overrides[sigla] = price
    return overrides


async def _get_beverage_catalog_for(restaurant_id: Optional[str]) -> List[Dict]:
    """Merge the fixed beverage identities with a restaurant-specific price list."""
    catalog = _default_beverage_catalog()
    if not restaurant_id:
        return catalog
    doc = await db.beverage_price_dictionary.find_one(
        {"restaurant_id": restaurant_id},
        {"_id": 0, "prices": 1},
    )
    overrides = _beverage_price_overrides_from_doc(doc)
    return [
        {**item, "price": overrides.get(item["sigla"], item["price"])}
        for item in catalog
    ]


async def _get_beverage_prices_for(restaurant_id: Optional[str]) -> Dict[str, float]:
    return {
        item["sigla"]: float(item["price"])
        for item in await _get_beverage_catalog_for(restaurant_id)
    }


def _beverage_price_for_row(row: Dict, fallback_prices: Optional[Dict[str, float]] = None) -> float:
    """Use the immutable daily snapshot when present, otherwise the supplied list."""
    try:
        snapshot = float(row.get("price_snapshot"))
        if 0 <= snapshot <= 1000:
            return snapshot
    except (TypeError, ValueError):
        pass
    return float((fallback_prices or {}).get(str(row.get("sigla", "")), 0) or 0)


def _beverage_price_snapshot_fields(
    price: float,
    *,
    source: str,
    captured_at: Optional[str] = None,
) -> Dict[str, object]:
    return {
        "price_snapshot": float(price),
        "price_snapshot_version": 1,
        "price_snapshot_at": captured_at or datetime.now(timezone.utc).isoformat(),
        "price_snapshot_source": source,
    }


async def _freeze_existing_beverage_days(
    restaurant_id: str,
    current_prices: Dict[str, float],
    *,
    source: str,
) -> int:
    """Freeze every existing row before changing a restaurant price list.

    Legacy rows did not store the price used by their report. Backfilling them
    with the list that was effective immediately before a change prevents a new
    price from rewriting historical closures.
    """
    captured_at = datetime.now(timezone.utc).isoformat()
    modified = 0
    for sigla, price in current_prices.items():
        result = await db.beverage_daily_counts.update_many(
            {
                "restaurant_id": restaurant_id,
                "sigla": sigla,
                "$or": [
                    {"price_snapshot": {"$exists": False}},
                    {"price_snapshot": None},
                ],
            },
            {"$set": _beverage_price_snapshot_fields(
                price,
                source=source,
                captured_at=captured_at,
            )},
        )
        modified += int(getattr(result, "modified_count", 0) or 0)
    return modified
