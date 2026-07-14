import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import server
from app.core import files as files_module
from app.core.config import ALGORITHM, SECRET_KEY
from app.core.database import db
from app.core.security import create_token, verify_token
from app.core.time import _rome_date_bounds_utc
from app.schemas import OrderCreate


EXPECTED_OPENAPI_SHA256 = "87e7464fd4c1fa025c2bbf738e7b066410070a0410c66435845c1edf6ea1f776"


def _request(headers=None) -> Request:
    raw_headers = [
        (str(key).lower().encode("latin-1"), str(value).encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw_headers})


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _raw_token(**overrides) -> str:
    payload = {
        "restaurant_id": "restaurant-1",
        "restaurant_name": "Flaminio",
        "username": "Flaminio",
        "role": "restaurant",
        "token_version": 1,
        "exp": datetime.now(timezone.utc).timestamp() + 3600,
        **overrides,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def test_openapi_contract_is_unchanged():
    spec = server.app.openapi()
    encoded = json.dumps(
        spec,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode()

    assert hashlib.sha256(encoded).hexdigest() == EXPECTED_OPENAPI_SHA256
    assert len(spec["paths"]) == 89
    assert len(spec.get("components", {}).get("schemas", {})) == 32


def test_server_keeps_legacy_reexports_and_one_canonical_order_schema():
    assert server.db is db
    assert server.verify_token is verify_token
    assert server.OrderCreate is OrderCreate
    assert set(OrderCreate.model_fields) == {"description", "order_number"}
    assert OrderCreate(description="CARB").order_number is None


def test_foundation_modules_do_not_import_server():
    app_dir = BACKEND_DIR / "app"
    for path in app_dir.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "import server" not in source
        assert "from server import" not in source


def test_create_and_verify_restaurant_token():
    token = create_token("restaurant-1", "Flaminio", username="Flaminio")
    payload = verify_token(_credentials(token), _request())

    assert payload["restaurant_id"] == "restaurant-1"
    assert payload["restaurant_name"] == "Flaminio"
    assert payload["role"] == "restaurant"


def test_only_admin_impersonation_header_changes_restaurant():
    restaurant_payload = verify_token(
        _credentials(_raw_token()),
        _request({"X-Admin-Restaurant-Id": "restaurant-2"}),
    )
    admin_payload = verify_token(
        _credentials(_raw_token(role="admin", username="Admin")),
        _request({"X-Admin-Restaurant-Id": "restaurant-2"}),
    )

    assert restaurant_payload["restaurant_id"] == "restaurant-1"
    assert admin_payload["restaurant_id"] == "restaurant-2"


def test_federico_is_promoted_without_losing_original_role():
    payload = verify_token(
        _credentials(_raw_token(role="supervisor", username="Federico")),
        _request(),
    )

    assert payload["role"] == "admin"
    assert payload["original_role"] == "supervisor"


def test_old_simone_token_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        verify_token(
            _credentials(_raw_token(role="admin", username="Simone", token_version=1)),
            _request(),
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Token revoked"


def test_rome_day_bounds_keep_dst_semantics():
    spring_start, spring_end = map(datetime.fromisoformat, _rome_date_bounds_utc("2026-03-29"))
    autumn_start, autumn_end = map(datetime.fromisoformat, _rome_date_bounds_utc("2026-10-25"))

    assert (spring_end - spring_start).total_seconds() == 23 * 3600
    assert (autumn_end - autumn_start).total_seconds() == 25 * 3600


def test_image_storage_keeps_data_uri_extension_and_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(files_module, "UPLOADS_DIR", tmp_path)

    filename = files_module.save_image_to_disk("data:image/png;base64,aGVsbG8=", "test")

    assert filename.startswith("test_")
    assert filename.endswith(".png")
    assert (tmp_path / filename).read_bytes() == b"hello"
