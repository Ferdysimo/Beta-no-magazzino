from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import json
import jwt
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Settings
SECRET_KEY = os.environ.get('JWT_SECRET', 'pastasciutta-roma-secret-key-2024')
ALGORITHM = "HS256"

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, restaurant_id: str):
        await websocket.accept()
        if restaurant_id not in self.active_connections:
            self.active_connections[restaurant_id] = []
        self.active_connections[restaurant_id].append(websocket)
        logger.info(f"WebSocket connected for restaurant {restaurant_id}")
    
    def disconnect(self, websocket: WebSocket, restaurant_id: str):
        if restaurant_id in self.active_connections:
            if websocket in self.active_connections[restaurant_id]:
                self.active_connections[restaurant_id].remove(websocket)
            logger.info(f"WebSocket disconnected for restaurant {restaurant_id}")
    
    async def broadcast_to_restaurant(self, restaurant_id: str, message: dict):
        if restaurant_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[restaurant_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message: {e}")
                    disconnected.append(connection)
            for conn in disconnected:
                self.disconnect(conn, restaurant_id)

manager = ConnectionManager()

# Pydantic Models
class RestaurantCreate(BaseModel):
    name: str
    username: str
    password: str
    location: str

class RestaurantResponse(BaseModel):
    id: str
    name: str
    username: str
    location: str
    created_at: str

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    token: str
    restaurant: RestaurantResponse

class OrderCreate(BaseModel):
    description: str

class OrderUpdate(BaseModel):
    description: Optional[str] = None
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

# Auth helpers
def create_token(restaurant_id: str, restaurant_name: str) -> str:
    payload = {
        "restaurant_id": restaurant_id,
        "restaurant_name": restaurant_name,
        "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Pastasciutta Roma API"}

# Restaurant Routes
@api_router.post("/restaurants", response_model=RestaurantResponse)
async def create_restaurant(data: RestaurantCreate):
    existing = await db.restaurants.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    restaurant_id = str(uuid.uuid4())
    hashed_password = pwd_context.hash(data.password)
    
    restaurant = {
        "id": restaurant_id,
        "name": data.name,
        "username": data.username,
        "password": hashed_password,
        "location": data.location,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "order_counter": 0
    }
    
    await db.restaurants.insert_one(restaurant)
    
    return RestaurantResponse(
        id=restaurant_id,
        name=data.name,
        username=data.username,
        location=data.location,
        created_at=restaurant["created_at"]
    )

@api_router.get("/restaurants", response_model=List[RestaurantResponse])
async def get_restaurants():
    restaurants = await db.restaurants.find({}, {"_id": 0, "password": 0}).to_list(100)
    return [RestaurantResponse(**r) for r in restaurants]

# Auth Routes
@api_router.post("/auth/login", response_model=LoginResponse)
async def login(data: LoginRequest):
    restaurant = await db.restaurants.find_one({"username": data.username})
    
    if not restaurant or not pwd_context.verify(data.password, restaurant["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(restaurant["id"], restaurant["name"])
    
    return LoginResponse(
        token=token,
        restaurant=RestaurantResponse(
            id=restaurant["id"],
            name=restaurant["name"],
            username=restaurant["username"],
            location=restaurant["location"],
            created_at=restaurant["created_at"]
        )
    )

@api_router.get("/auth/me", response_model=RestaurantResponse)
async def get_current_restaurant(token_data: dict = Depends(verify_token)):
    restaurant = await db.restaurants.find_one(
        {"id": token_data["restaurant_id"]},
        {"_id": 0, "password": 0}
    )
    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return RestaurantResponse(**restaurant)

# Order Routes
class OrderCreate(BaseModel):
    description: str
    order_number: Optional[int] = None

@api_router.post("/orders", response_model=OrderResponse)
async def create_order(data: OrderCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Use provided order number or get next one
    if data.order_number:
        order_number = data.order_number
        # Update counter if provided number is higher
        await db.restaurants.update_one(
            {"id": restaurant_id, "order_counter": {"$lt": data.order_number}},
            {"$set": {"order_counter": data.order_number}}
        )
    else:
        # Get and increment order counter
        result = await db.restaurants.find_one_and_update(
            {"id": restaurant_id},
            {"$inc": {"order_counter": 1}},
            return_document=True
        )
        order_number = result["order_counter"]
    
    order_id = str(uuid.uuid4())
    
    order = {
        "id": order_id,
        "order_number": order_number,
        "description": data.description,  # Keep original case
        "restaurant_id": restaurant_id,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timer_started": False,
        "timer_start_time": None,
        "timer_paused": False,
        "timer_elapsed": 0
    }
    
    await db.orders.insert_one(order)
    
    # Broadcast to all connected clients
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_created",
        "order": {k: v for k, v in order.items() if k != "_id"}
    })
    
    return OrderResponse(**{k: v for k, v in order.items() if k != "_id"})

@api_router.get("/orders", response_model=List[OrderResponse])
async def get_orders(
    status: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    if status:
        query["status"] = status
    
    orders = await db.orders.find(query, {"_id": 0}).sort("order_number", -1).to_list(500)
    return [OrderResponse(**o) for o in orders]

@api_router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: str, token_data: dict = Depends(verify_token)):
    order = await db.orders.find_one(
        {"id": order_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return OrderResponse(**order)

@api_router.patch("/orders/{order_id}", response_model=OrderResponse)
async def update_order(
    order_id: str,
    data: OrderUpdate,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    # Broadcast update
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return OrderResponse(**order_response)

@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Get the order first to know its number
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Delete the order
    result = await db.orders.delete_one(
        {"id": order_id, "restaurant_id": restaurant_id}
    )
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Check if this was the highest order number and decrement counter
    highest_order = await db.orders.find_one(
        {"restaurant_id": restaurant_id},
        sort=[("order_number", -1)]
    )
    
    if highest_order:
        # Set counter to highest remaining order number
        await db.restaurants.update_one(
            {"id": restaurant_id},
            {"$set": {"order_counter": highest_order["order_number"]}}
        )
    else:
        # No orders left, reset counter to 0
        await db.restaurants.update_one(
            {"id": restaurant_id},
            {"$set": {"order_counter": 0}}
        )
    
    # Broadcast deletion
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_deleted",
        "order_id": order_id
    })
    
    return {"message": "Order deleted"}

@api_router.post("/orders/{order_id}/complete")
async def complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"status": "completed"}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order completed"}

@api_router.post("/orders/{order_id}/timer/start")
async def start_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": True,
            "timer_start_time": datetime.now(timezone.utc).isoformat(),
            "timer_paused": False
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer started"}

@api_router.post("/orders/{order_id}/timer/pause")
async def pause_timer(order_id: str, elapsed: int = 0, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_paused": True,
            "timer_elapsed": elapsed
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer paused"}

@api_router.post("/orders/{order_id}/timer/reset")
async def reset_timer(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {
            "timer_started": False,
            "timer_start_time": None,
            "timer_paused": False,
            "timer_elapsed": 0
        }},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Timer reset"}

# Seed data endpoint for initial setup
@api_router.post("/seed")
async def seed_data():
    # Check if already seeded
    existing = await db.restaurants.find_one({"username": "brazza"})
    if existing:
        return {"message": "Data already seeded"}
    
    # Create sample restaurants
    restaurants = [
        {"name": "Pastasciutta Roma", "username": "brazza", "password": "brazza123", "location": "Largo di Brazzà"},
        {"name": "Pastasciutta Roma", "username": "trastevere", "password": "trastevere123", "location": "Trastevere"},
        {"name": "Pastasciutta Roma", "username": "termini", "password": "termini123", "location": "Termini"},
    ]
    
    for r in restaurants:
        restaurant_id = str(uuid.uuid4())
        await db.restaurants.insert_one({
            "id": restaurant_id,
            "name": r["name"],
            "username": r["username"],
            "password": pwd_context.hash(r["password"]),
            "location": r["location"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order_counter": 0
        })
    
    return {"message": "Seeded 3 restaurants", "credentials": [
        {"username": "brazza", "password": "brazza123", "location": "Largo di Brazzà"},
        {"username": "trastevere", "password": "trastevere123", "location": "Trastevere"},
        {"username": "termini", "password": "termini123", "location": "Termini"},
    ]}

# WebSocket endpoint
@app.websocket("/ws/{restaurant_id}")
async def websocket_endpoint(websocket: WebSocket, restaurant_id: str):
    await manager.connect(websocket, restaurant_id)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle any incoming messages if needed
            message = json.loads(data)
            logger.info(f"Received WS message: {message}")
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurant_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, restaurant_id)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
