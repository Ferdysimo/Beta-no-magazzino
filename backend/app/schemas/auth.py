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
    boiler_count: int = 1


class RestaurantResponse(BaseModel):
    id: str
    name: str
    username: str
    location: str
    created_at: str
    role: str = "restaurant"
    boiler_count: int = 1


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    restaurant: RestaurantResponse
