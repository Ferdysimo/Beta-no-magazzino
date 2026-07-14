from typing import Dict, List, Optional

from pydantic import BaseModel


class BeverageCaricoItem(BaseModel):
    sigla: str
    quantity: int


class BeverageCaricoCreate(BaseModel):
    supplier: str
    invoice_image_data: Optional[str] = None
    invoice_date: Optional[str] = None
    items: List[BeverageCaricoItem]
    notes: Optional[str] = None


class BeverageDailyUpsert(BaseModel):
    sigla: str
    mattina: Optional[str] = ""
    inUsc: Optional[str] = ""
    scarti: Optional[str] = ""
    sera: Optional[str] = ""
    mattina_casse: Optional[str] = ""
    mattina_sfuse: Optional[str] = ""
    inUsc_casse: Optional[str] = ""
    sera_casse: Optional[str] = ""
    sera_sfuse: Optional[str] = ""
    comments: Optional[Dict[str, str]] = None
    date: Optional[str] = None
    restaurant_id: Optional[str] = None
    revision: Optional[str] = None
