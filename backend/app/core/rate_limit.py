from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import APP_ENV


limiter = Limiter(key_func=get_remote_address, enabled=APP_ENV != "test")
