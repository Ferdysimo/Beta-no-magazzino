from typing import Optional

from pydantic import BaseModel


class OrderCreate(BaseModel):
    description: str
    order_number: Optional[int] = None


class OrderUpdate(BaseModel):
    description: Optional[str] = None
    order_number: Optional[int] = None
    status: Optional[str] = None
    timer_started: Optional[bool] = None
    timer_start_time: Optional[str] = None
    timer_paused: Optional[bool] = None
    timer_elapsed: Optional[int] = None


class OrderResponse(BaseModel):
    id: str
    order_number: int
    description: str
    restaurant_id: str
    status: str
    created_at: str
    timer_started: bool
    timer_start_time: Optional[str]
    timer_paused: bool
    timer_elapsed: int
    kitchen_completed: bool = False
    monitor_visible: bool = False
    hidden_generale: bool = False
    hidden_generale_timer: int = 0


class DeletionLog(BaseModel):
    id: str
    order_number: int
    description: str
    restaurant_id: str
    deleted_at: str
    original_created_at: str


class ModificationLog(BaseModel):
    id: str
    order_id: str
    order_number: int
    old_description: str
    new_description: str
    restaurant_id: str
    modified_at: str
