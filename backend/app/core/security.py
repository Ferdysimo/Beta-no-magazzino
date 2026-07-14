from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from .config import ALGORITHM, SECRET_KEY, SIMONE_MIN_TOKEN_VERSION


security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_token(
    restaurant_id: str,
    restaurant_name: str,
    role: str = "restaurant",
    username: str = "",
    token_version: int = 1,
) -> str:
    payload = {
        "restaurant_id": restaurant_id,
        "restaurant_name": restaurant_name,
        "username": username or restaurant_name,
        "role": role,
        "token_version": token_version,
        "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None,
) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("username") == "Simone" and int(payload.get("token_version") or 0) < SIMONE_MIN_TOKEN_VERSION:
            raise HTTPException(status_code=401, detail="Token revoked")
        if payload.get("role") == "supervisor":
            payload["original_role"] = "supervisor"
            if payload.get("username") == "Federico":
                payload["role"] = "admin"
        if payload.get("role") == "admin" and request:
            admin_restaurant_id = request.headers.get("X-Admin-Restaurant-Id")
            if admin_restaurant_id:
                payload["restaurant_id"] = admin_restaurant_id
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
