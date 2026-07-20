from typing import List, Optional

from pydantic import BaseModel, Field


class DocumentScanAnalyzeRequest(BaseModel):
    ocr_text: str = Field(min_length=1, max_length=60000)
    ocr_confidence: Optional[float] = Field(default=None, ge=0, le=100)
    file_name: str = Field(default="", max_length=255)
    file_fingerprint: str = Field(default="", max_length=128)


class DocumentScanFeedbackRow(BaseModel):
    source_text: str = Field(default="", max_length=500)
    source_description: str = Field(default="", max_length=300)
    product_id: Optional[str] = Field(default=None, max_length=100)
    quantity: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    unit_price: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    line_total: Optional[float] = Field(default=None, ge=0, le=100_000_000)


class DocumentScanFeedback(BaseModel):
    scan_id: str = Field(min_length=1, max_length=100)
    ocr_text_sha256: str = Field(min_length=64, max_length=64)
    file_fingerprint: str = Field(default="", max_length=128)
    ocr_confidence: Optional[float] = Field(default=None, ge=0, le=100)
    document_type: str = Field(default="ddt", pattern="^(ddt|invoice|credit_note)$")
    supplier_id: Optional[str] = Field(default=None, max_length=100)
    supplier_source_text: str = Field(default="", max_length=500)
    document_number: str = Field(default="", max_length=100)
    document_date: str = Field(default="", max_length=20)
    document_total: Optional[float] = Field(default=None, ge=0, le=100_000_000)
    rows: List[DocumentScanFeedbackRow] = Field(default_factory=list, max_length=80)
