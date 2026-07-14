from typing import Dict, List, Optional

from pydantic import BaseModel


class CashDailyUpsert(BaseModel):
    mattina: Optional[str] = ""
    altro: Optional[str] = ""
    glo: Optional[str] = ""
    just: Optional[str] = ""
    delv: Optional[str] = ""
    bp: Optional[str] = ""
    sat: Optional[str] = ""
    ft: Optional[str] = ""
    pos: Optional[str] = ""
    vers: Optional[str] = ""
    arr: Optional[str] = ""
    sp5: Optional[str] = ""
    sp2: Optional[str] = ""
    sp1: Optional[str] = ""
    sp05: Optional[str] = ""
    cd5: Optional[str] = ""
    cd2: Optional[str] = ""
    cd1: Optional[str] = ""
    cd05: Optional[str] = ""
    vers_color: Optional[str] = ""
    comments: Optional[Dict[str, str]] = None
    paste_text: Optional[str] = None
    paste_manual_override: Optional[bool] = None
    cash_banconote: Optional[Dict[str, str]] = None
    manual_prices: Optional[Dict[str, str]] = None
    date: Optional[str] = None
    restaurant_id: Optional[str] = None
    revision: Optional[str] = None


class PastaDictionaryUpsert(BaseModel):
    restaurant_id: str
    siglas: List[Dict]
