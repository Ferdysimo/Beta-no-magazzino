from collections import deque
from datetime import datetime, timezone
from typing import Dict

import jwt
from fastapi import Request

from app.core.config import ALGORITHM, SECRET_KEY
from app.core.state import RESTAURANT_LOCATION_CACHE


# Shared process-local diagnostic buffers. Import these objects; never replace them.
api_call_log: deque = deque(maxlen=200)
api_error_log: deque = deque(maxlen=100)
frontend_device_state: Dict[str, dict] = {}
frontend_error_log: deque = deque(maxlen=100)


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
