from fastapi import HTTPException, Request

from .security import can_impersonate


async def _effective_restaurant_id(request: Request, token_data: dict) -> str:
    """Resolve the restaurant targeted by the current request."""
    if can_impersonate(token_data):
        restaurant_id = (
            request.headers.get("X-Restaurant-Id")
            or request.headers.get("x-restaurant-id")
        )
        if restaurant_id:
            return restaurant_id

    restaurant_id = token_data.get("restaurant_id")
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurant_id non disponibile")
    return restaurant_id
