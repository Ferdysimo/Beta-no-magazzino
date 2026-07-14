from typing import Optional

from pydantic import BaseModel


class InvoiceCreate(BaseModel):
    supplier: str
    paid: bool = False
    control_code: Optional[str] = ""
    image_data: str
    invoice_date: str = None
    importo: Optional[float] = 0.0
    ddt_number: Optional[str] = ""


class InvoiceResponse(BaseModel):
    id: str
    restaurant_id: str
    supplier: str
    paid: bool
    control_code: Optional[str] = ""
    image_url: str
    created_at: str
    uploaded_by: str
    importo: Optional[float] = 0.0
    ddt_number: Optional[str] = ""


class FatturaUpload(BaseModel):
    fattura_data: str


class VersamentoCreate(BaseModel):
    description: str = ""
    control_code: str = ""
    image_data: str = ""
    versamento_date: str = None


class ChiusuraCreate(BaseModel):
    description: str = ""
    tipologia: str = "Piatti"
    control_code: str = ""
    image_data: str = ""
    piatti_data: Optional[str] = None
    chiusura_date: str = None


class ChiusuraPiattiUpload(BaseModel):
    piatti_data: str


class FatturaGlobaleCreate(BaseModel):
    supplier: str
    importo: Optional[float] = 0.0
    ddt_numbers: Optional[str] = ""
    image_data: str
    invoice_date: Optional[str] = None
