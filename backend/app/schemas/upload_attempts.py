from typing import Literal, Optional

from pydantic import BaseModel


UploadStage = Literal[
    "file_selected",
    "compression_started",
    "compression_succeeded",
    "compression_failed",
    "upload_started",
    "upload_succeeded",
    "upload_failed",
    "server_received",
    "server_saved",
]

UploadKind = Literal["closure_primary", "closure_secondary"]


class UploadAttemptEventCreate(BaseModel):
    attempt_id: str
    event_id: Optional[str] = ""
    stage: UploadStage
    upload_kind: UploadKind = "closure_primary"
    client_at: Optional[str] = None
    device_id: Optional[str] = ""
    path: Optional[str] = ""
    online: Optional[bool] = None
    browser: Optional[str] = ""
    os: Optional[str] = ""
    platform: Optional[str] = ""
    connection_effective_type: Optional[str] = ""
    file_size_bytes: Optional[int] = None
    compressed_size_bytes: Optional[int] = None
    mime_type: Optional[str] = ""
    target_closure_id: Optional[str] = ""
    error_kind: Optional[str] = ""
    error_message: Optional[str] = ""
    http_status: Optional[int] = None
