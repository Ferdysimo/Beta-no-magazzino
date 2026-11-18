import re
from datetime import datetime, timezone
from typing import Iterable

from app.core.database import db
from app.core.time import _today_rome_str


DEFAULT_BOILER2_SIGLAS = ("CARB", "PESTO", "POM", "AMAT")
_VALID_SIGLA_RE = re.compile(r"^[A-Z0-9_-]{1,20}$")
_TRAILING_ROUTE_MARKER_RE = re.compile(r"\s*-\s*$")


def normalize_boiler2_siglas(values: Iterable[str] | None) -> list[str]:
    """Return unique, uppercase routing siglas in stable input order."""
    clean: list[str] = []
    seen: set[str] = set()
    for raw_value in values or []:
        sigla = str(raw_value or "").strip().upper()
        if not sigla or sigla in seen:
            continue
        if not _VALID_SIGLA_RE.fullmatch(sigla):
            raise ValueError(f"Sigla non valida: {sigla}")
        seen.add(sigla)
        clean.append(sigla)
    return clean


def kitchen_routing_config_from_restaurant(restaurant: dict | None) -> dict:
    """Build the effective config, automatically expiring yesterday's toggle."""
    stored = (restaurant or {}).get("kitchen_routing") or {}
    try:
        siglas = normalize_boiler2_siglas(stored.get("boiler2_siglas"))
    except ValueError:
        siglas = []
    if not siglas and "boiler2_siglas" not in stored:
        siglas = list(DEFAULT_BOILER2_SIGLAS)
    try:
        standard_siglas = normalize_boiler2_siglas(stored.get("standard_siglas"))
    except ValueError:
        standard_siglas = []

    today = _today_rome_str()
    enabled = bool(stored.get("enabled")) and stored.get("enabled_date") == today
    return {
        "enabled": enabled,
        "enabled_date": today if enabled else None,
        "boiler2_siglas": siglas,
        "standard_siglas": standard_siglas,
        "standard_siglas_configured": "standard_siglas" in stored,
        "updated_at": stored.get("updated_at"),
        "updated_by": stored.get("updated_by"),
    }


async def get_kitchen_routing_config(restaurant_id: str) -> dict:
    restaurant = await db.restaurants.find_one(
        {"id": restaurant_id},
        {"_id": 0, "id": 1, "boiler_count": 1, "kitchen_routing": 1},
    )
    if not restaurant:
        return {}
    boiler_count = int(restaurant.get("boiler_count") or 1)
    effective = kitchen_routing_config_from_restaurant(restaurant)
    if boiler_count < 2:
        effective = {**effective, "enabled": False, "enabled_date": None}
    return {
        **effective,
        "restaurant_id": restaurant_id,
        "boiler_count": boiler_count,
    }


def route_order_description(description: str, config: dict) -> str:
    """Apply the legacy trailing-dash marker from the authoritative config.

    Bollitore 2 already displays descriptions ending in ``-``; the standard
    bollitore displays descriptions without it. Removing an operator-entered
    marker here is intentional: while this feature is available the Divisioni
    switch is the single source of truth for newly created orders.
    """
    base_description = _TRAILING_ROUTE_MARKER_RE.sub("", str(description or "")).strip()
    first_token = base_description.split(maxsplit=1)[0].upper() if base_description else ""
    boiler2_siglas = set(config.get("boiler2_siglas") or [])
    if config.get("enabled") and first_token in boiler2_siglas:
        return f"{base_description} -"
    return base_description


async def update_kitchen_routing_config(
    restaurant_id: str,
    *,
    enabled: bool | None,
    boiler2_siglas: Iterable[str] | None,
    standard_siglas: Iterable[str] | None,
    updated_by: str,
) -> dict:
    restaurant = await db.restaurants.find_one(
        {"id": restaurant_id},
        {"_id": 0, "id": 1, "boiler_count": 1, "kitchen_routing": 1},
    )
    if not restaurant:
        return {}

    boiler_count = int(restaurant.get("boiler_count") or 1)
    if enabled is True and boiler_count < 2:
        raise ValueError("Divisioni disponibili solo nei locali con due bollitori")

    current_config = kitchen_routing_config_from_restaurant(restaurant)
    clean_boiler2_siglas = (
        normalize_boiler2_siglas(boiler2_siglas)
        if boiler2_siglas is not None
        else current_config["boiler2_siglas"]
    )
    clean_standard_siglas = (
        normalize_boiler2_siglas(standard_siglas)
        if standard_siglas is not None
        else current_config["standard_siglas"]
    )
    duplicates = sorted(set(clean_boiler2_siglas) & set(clean_standard_siglas))
    if duplicates:
        raise ValueError(
            "Sigle presenti in entrambi i bollitori: " + ", ".join(duplicates)
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    set_payload = {
        "kitchen_routing.updated_at": now_iso,
        "kitchen_routing.updated_by": updated_by,
    }
    if enabled is not None:
        set_payload["kitchen_routing.enabled"] = bool(enabled)
        set_payload["kitchen_routing.enabled_date"] = _today_rome_str() if enabled else None
    if boiler2_siglas is not None:
        set_payload["kitchen_routing.boiler2_siglas"] = clean_boiler2_siglas
    if standard_siglas is not None:
        set_payload["kitchen_routing.standard_siglas"] = clean_standard_siglas

    await db.restaurants.update_one(
        {"id": restaurant_id},
        {"$set": set_payload},
    )
    return await get_kitchen_routing_config(restaurant_id)
