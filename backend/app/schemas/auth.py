from typing import Optional

from pydantic import BaseModel


class RestaurantCreate(BaseModel):
    name: str
    username: str
    password: str
    location: str


class LocalRestaurantCreate(BaseModel):
    username: str
    location: str
    password: str
    report_code: str
    boiler_count: int = 1
    address: str
    postal_code: str
    city: str
    monitor_customers_enabled: bool = False


class RestaurantResponse(BaseModel):
    id: str
    name: str
    username: str
    location: str
    created_at: str
    role: str = "restaurant"
    boiler_count: int = 1
    report_code: str = ""
    address: str = ""
    postal_code: str = ""
    city: str = ""
    monitor_customers_enabled: Optional[bool] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    restaurant: RestaurantResponse
