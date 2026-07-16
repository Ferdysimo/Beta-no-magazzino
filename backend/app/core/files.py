import base64
import hashlib
import hmac
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException

from .config import SECRET_KEY, UPLOADS_DIR, UPLOAD_URL_TTL_SECONDS


def _validate_upload_filename(filename: str) -> str:
    if (
        not filename
        or "/" in filename
        or "\\" in filename
        or filename.startswith(".")
        or ".." in filename
    ):
        raise HTTPException(status_code=400, detail="Invalid filename")
    return filename


def resolve_upload_path(filename: str) -> Path:
    filepath = (UPLOADS_DIR / _validate_upload_filename(filename)).resolve()
    try:
        filepath.relative_to(UPLOADS_DIR)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid filename") from exc
    return filepath


def _upload_signature(filename: str, expires: int) -> str:
    payload = f"{filename}:{expires}".encode("utf-8")
    signing_key = hmac.new(
        SECRET_KEY.encode("utf-8"), b"pastasciutta-upload-url", hashlib.sha256
    ).digest()
    return hmac.new(signing_key, payload, hashlib.sha256).hexdigest()


def build_upload_url(filename: str, ttl_seconds: int = UPLOAD_URL_TTL_SECONDS) -> str:
    if not filename:
        return ""
    _validate_upload_filename(filename)
    expires = int(time.time()) + max(60, ttl_seconds)
    signature = _upload_signature(filename, expires)
    return (
        f"/api/uploads/{quote(filename)}?expires={expires}"
        f"&signature={signature}"
    )


def verify_upload_signature(filename: str, expires: int, signature: str) -> Path:
    filepath = resolve_upload_path(filename)
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Upload URL expired")
    expected = _upload_signature(filename, expires)
    if not signature or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=403, detail="Invalid upload signature")
    return filepath


def save_image_to_disk(base64_data: str, prefix: str) -> str:
    """Save a base64 image to the uploads directory and return its filename."""
    if not base64_data:
        return ""

    if "," in base64_data:
        header, data = base64_data.split(",", 1)
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
    resolve_upload_path(filename).write_bytes(base64.b64decode(data, validate=True))
    return filename
