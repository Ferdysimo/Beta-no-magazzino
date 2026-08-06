from typing import Optional

from pydantic import BaseModel, Field


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
    device_model: Optional[str] = ""
    platform_version: Optional[str] = ""
    architecture: Optional[str] = ""
    bitness: Optional[str] = ""
    browser_full_version: Optional[str] = ""
    battery_level: Optional[int] = None
    battery_charging: Optional[bool] = None
    battery_charging_time: Optional[float] = None
    battery_discharging_time: Optional[float] = None
    connection_type: Optional[str] = ""
    connection_effective_type: Optional[str] = ""
    connection_downlink_mbps: Optional[float] = None
    connection_rtt_ms: Optional[int] = None
    connection_save_data: Optional[bool] = None
    heartbeat_rtt_ms: Optional[int] = None
    heartbeat_failures: int = 0
    last_heartbeat_failure_at: Optional[str] = ""


class FrontendErrorPayload(FrontendDiagnosticsPayload):
    kind: str = "frontend_error"
    message: str
    source: Optional[str] = ""
    stack: Optional[str] = ""
    status: Optional[int] = None
    method: Optional[str] = ""
    url: Optional[str] = ""


class DiagnosticDeviceRegistryUpdate(BaseModel):
    display_name: str = Field(default="", max_length=80)
    model_override: str = Field(default="", max_length=120)
