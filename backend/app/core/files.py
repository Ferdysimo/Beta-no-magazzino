import base64
import uuid

from .config import UPLOADS_DIR


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
    (UPLOADS_DIR / filename).write_bytes(base64.b64decode(data))
    return filename
