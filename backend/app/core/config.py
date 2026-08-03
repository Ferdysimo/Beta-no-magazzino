import os
import subprocess
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

PROJECT_ROOT = ROOT_DIR.parent
APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()
IS_DEVELOPMENT = APP_ENV in {"development", "dev", "local", "test"}
ENABLE_API_DOCS = os.environ.get("ENABLE_API_DOCS", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}

UPLOADS_DIR = Path(
    os.environ.get("UPLOADS_DIR", str(PROJECT_ROOT / "uploads"))
).expanduser().resolve()
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_URL_TTL_SECONDS = max(60, int(os.environ.get("UPLOAD_URL_TTL_SECONDS", "28800")))
WS_TICKET_TTL_SECONDS = max(10, int(os.environ.get("WS_TICKET_TTL_SECONDS", "30")))

API_VERSION = "2026060108"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

SECRET_KEY = os.environ.get("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET env var is required; refuse to start with insecure fallback")

ALGORITHM = "HS256"
SIMONE_MIN_TOKEN_VERSION = 2
ADMIN_MIN_TOKEN_VERSION = max(
    0,
    int(os.environ.get("ADMIN_MIN_TOKEN_VERSION", "0")),
)

_DEFAULT_PRODUCTION_ORIGINS = (
    "https://pasta-app.it",
    "https://www.pasta-app.it",
)
CORS_ALLOWED_ORIGINS = tuple(
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        ",".join(_DEFAULT_PRODUCTION_ORIGINS),
    ).split(",")
    if origin.strip()
)


def origin_is_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    normalized = origin.rstrip("/")
    if normalized in CORS_ALLOWED_ORIGINS:
        return True
    if IS_DEVELOPMENT:
        return normalized.startswith("http://localhost:") or normalized.startswith(
            "http://127.0.0.1:"
        )
    return False


def git_commit_short() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(ROOT_DIR.parent),
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
    except Exception:
        return ""
