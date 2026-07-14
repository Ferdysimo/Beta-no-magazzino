from typing import Optional

from pydantic import BaseModel


class FrontendDiagnosticsPayload(BaseModel):
    device_id: str
    tab_id: Optional[str] = ""
    frontend_version: Optional[str] = ""
    path: Optional[str] = ""
    user_agent: Optional[str] = ""
    browser: Optional[str] = ""
    os: Optional[str] = ""
    device_type: Optional[str] = ""
    platform: Optional[str] = ""
    language: Optional[str] = ""
    screen: Optional[str] = ""
    viewport: Optional[str] = ""
    timezone: Optional[str] = ""
    online: bool = True
    visibility: Optional[str] = ""
    restaurant_id: Optional[str] = ""
    restaurant_location: Optional[str] = ""


class FrontendErrorPayload(FrontendDiagnosticsPayload):
    kind: str = "frontend_error"
    message: str
    source: Optional[str] = ""
    stack: Optional[str] = ""
    status: Optional[int] = None
    method: Optional[str] = ""
    url: Optional[str] = ""
