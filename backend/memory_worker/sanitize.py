import copy
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any


SANITIZER_VERSION = 1
MAX_STRING_LENGTH = 20000
MAX_DEPTH = 12
EXCLUDED_EXACT_KEYS = {
    "_id",
    "authorization",
    "cookie",
    "cookies",
    "fattura_data",
    "fattura_file",
    "google_credentials",
    "image_data",
    "image_file",
    "invoice_file",
    "invoice_url",
    "jwt",
    "password",
    "password_hash",
    "photo_data",
    "photo_file",
    "photo_url",
    "fattura_url",
    "secret",
    "token",
}
EXCLUDED_KEY_SUFFIXES = (
    "_password",
    "_secret",
    "_token",
    "_credentials",
)


@dataclass(frozen=True)
class SanitizationResult:
    document: dict
    removed_paths: tuple[str, ...]
    truncated_paths: tuple[str, ...]
    sanitizer_version: int = SANITIZER_VERSION


def _is_excluded_key(value: Any) -> bool:
    normalized = str(value or "").strip().casefold()
    return (
        normalized in EXCLUDED_EXACT_KEYS
        or normalized.endswith(EXCLUDED_KEY_SUFFIXES)
    )


def sanitize_memory_document(document: dict) -> SanitizationResult:
    source = copy.deepcopy(document)
    removed = []
    truncated = []

    def clean(value: Any, path: str, depth: int) -> Any:
        if depth > MAX_DEPTH:
            removed.append(path or "$")
            return None
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                child_path = f"{path}.{key}" if path else str(key)
                if _is_excluded_key(key):
                    removed.append(child_path)
                    continue
                result[str(key)] = clean(item, child_path, depth + 1)
            return result
        if isinstance(value, (list, tuple)):
            return [
                clean(item, f"{path}[{index}]", depth + 1)
                for index, item in enumerate(value)
            ]
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, bytes):
            removed.append(path or "$")
            return None
        if isinstance(value, str) and len(value) > MAX_STRING_LENGTH:
            truncated.append(path or "$")
            return value[:MAX_STRING_LENGTH]
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    cleaned = clean(source, "", 0)
    return SanitizationResult(
        document=cleaned,
        removed_paths=tuple(removed),
        truncated_paths=tuple(truncated),
    )
