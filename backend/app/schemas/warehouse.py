from typing import List, Optional

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    name: str
    unit: str = ""
    supplier: str = ""
    quantity: int = 0
    image_data: str = ""


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    supplier: Optional[str] = None
    quantity: Optional[int] = None
    image_data: Optional[str] = None


class ProductQuantityUpdate(BaseModel):
    quantity: int


class ProductWasteCreate(BaseModel):
    quantity: int = Field(ge=1)
    reason: str = Field(min_length=2, max_length=300)


class RichiestaItem(BaseModel):
    product_id: str
    product_name: str
    unit: str
    supplier: str = ""
    quantity: int


class RichiestaCreate(BaseModel):
    items: List[RichiestaItem]
    extra_note: Optional[str] = None


class RichiestaReceptionConfirm(BaseModel):
    checker_name: str


class RichiestaErrorReport(BaseModel):
    reason: str
    checker_name: str


class CaricoItem(BaseModel):
    product_id: str
    product_name: str
    unit: str = ""
    quantity_added: int


class CaricoCreate(BaseModel):
    supplier_name: str
    ddt_number_fornitore: str
    photo_data: Optional[str] = None
    fattura_data: Optional[str] = None
    items: List[CaricoItem]


class CaricoUpdate(BaseModel):
    supplier_name: Optional[str] = None
    ddt_number_fornitore: Optional[str] = None
    photo_data: Optional[str] = None
    fattura_data: Optional[str] = None
    items: Optional[List[CaricoItem]] = None
