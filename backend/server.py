from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timezone
import json
import jwt
import asyncio
from zoneinfo import ZoneInfo
from passlib.context import CryptContext
import gspread
from google.oauth2.service_account import Credentials

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
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

ROME_TZ = ZoneInfo("Europe/Rome")

# Google Sheets integration
SPREADSHEET_ID = "1stWnCov8ipM_KzkYJiW2Iq4HmobLBJ19jGXj3oVrdyQ"
GOOGLE_CREDS_FILE = os.path.join(os.path.dirname(__file__), "google_credentials.json")
gs_client = None

def get_sheets_client():
    global gs_client
    if gs_client is None:
        try:
            creds = Credentials.from_service_account_file(GOOGLE_CREDS_FILE, scopes=[
                "https://www.googleapis.com/auth/spreadsheets"
            ])
            gs_client = gspread.authorize(creds)
            logger.info("Google Sheets client initialized")
        except Exception as e:
            logger.error(f"Google Sheets init error: {e}")
            return None
    return gs_client

def sync_append_to_sheets(order_number, description, restaurant_location):
    try:
        client = get_sheets_client()
        if not client:
            return
        now = datetime.now(ROME_TZ)
        orario = now.strftime("%H:%M")
        data_str = now.strftime("%d/%m/%Y")
        
        sheet = client.open_by_key(SPREADSHEET_ID).sheet1
        sheet.append_row([order_number, description])
        logger.info(f"Sheets: added order #{order_number} for {restaurant_location}")
    except Exception as e:
        logger.error(f"Sheets append error: {e}")
        global gs_client
        gs_client = None

# Midnight reset: archive orders and reset counters
async def midnight_reset():
    logger.info("Running midnight reset - archiving orders and resetting counters")
    try:
        # Get all orders
        all_orders = await db.orders.find({}, {"_id": 0}).to_list(10000)
        
        if all_orders:
            # Insert into archived_orders
            await db.archived_orders.insert_many([{**o} for o in all_orders])
            # Delete all orders
            await db.orders.delete_many({})
            logger.info(f"Archived {len(all_orders)} orders")
        
        # Reset all restaurant counters to 0
        await db.restaurants.update_many(
            {"role": "restaurant"},
            {"$set": {"order_counter": 0}}
        )
        logger.info("Order counters reset to 0")
        
        # Broadcast reset to all connected clients
        for rid in list(manager.active_connections.keys()):
            await manager.broadcast_to_restaurant(rid, {
                "type": "daily_reset"
            })
    except Exception as e:
        logger.error(f"Midnight reset error: {e}")

async def midnight_scheduler():
    while True:
        now = datetime.now(ROME_TZ)
        # Calculate seconds until next midnight Rome time
        tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if now >= tomorrow:
            from datetime import timedelta
            tomorrow += timedelta(days=1)
        wait_seconds = (tomorrow - now).total_seconds()
        logger.info(f"Next midnight reset in {wait_seconds:.0f} seconds ({tomorrow.isoformat()})")
        await asyncio.sleep(wait_seconds)
        await midnight_reset()

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
    role: str = "restaurant"

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
    order_number: Optional[int] = None
    status: Optional[str] = None
    timer_started: Optional[bool] = None
    timer_start_time: Optional[str] = None
    timer_paused: Optional[bool] = None
    timer_elapsed: Optional[int] = None

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

class InvoiceCreate(BaseModel):
    supplier: str
    paid: bool = False
    control_code: str
    image_data: str  # Base64 encoded image
    invoice_date: str = None  # Date selected by user

class InvoiceResponse(BaseModel):
    id: str
    restaurant_id: str
    supplier: str
    paid: bool
    control_code: str
    image_url: str
    created_at: str
    uploaded_by: str

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

class ProductCreate(BaseModel):
    name: str
    unit: str = ""
    supplier: str = ""
    image_data: str = ""  # Base64 on create, saved to disk

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    supplier: Optional[str] = None
    image_data: Optional[str] = None  # New image if provided

# Auth helpers
def save_image_to_disk(base64_data: str, prefix: str) -> str:
    """Save base64 image to disk, return filename."""
    if not base64_data:
        return ""
    # Strip data URI prefix if present (e.g. data:image/jpeg;base64,)
    if "," in base64_data:
        header, data = base64_data.split(",", 1)
        # Detect extension from header
        ext = "jpg"
        if "png" in header:
            ext = "png"
        elif "webp" in header:
            ext = "webp"
        elif "gif" in header:
            ext = "gif"
    else:
        data = base64_data
        ext = "jpg"
    
    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = UPLOADS_DIR / filename
    filepath.write_bytes(base64.b64decode(data))
    return filename

def create_token(restaurant_id: str, restaurant_name: str, role: str = "restaurant") -> str:
    payload = {
        "restaurant_id": restaurant_id,
        "restaurant_name": restaurant_name,
        "role": role,
        "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security), request: Request = None) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        # Admin can act as any restaurant via header
        if payload.get("role") == "admin" and request:
            admin_restaurant_id = request.headers.get("X-Admin-Restaurant-Id")
            if admin_restaurant_id:
                payload["restaurant_id"] = admin_restaurant_id
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Pastasciutta Roma API", "version": "2026031501"}

@api_router.get("/version")
async def version_check():
    return {"version": "2026031501", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    filepath = UPLOADS_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)

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
    
    token = create_token(restaurant["id"], restaurant["name"], restaurant.get("role", "restaurant"))
    
    return LoginResponse(
        token=token,
        restaurant=RestaurantResponse(
            id=restaurant["id"],
            name=restaurant["name"],
            username=restaurant["username"],
            location=restaurant["location"],
            created_at=restaurant["created_at"],
            role=restaurant.get("role", "restaurant")
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

@api_router.get("/admin/restaurants")
async def get_admin_restaurants(token_data: dict = Depends(verify_token)):
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "password": 0}
    ).to_list(100)
    return restaurants

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
        "timer_elapsed": 0,
        "kitchen_completed": False,
        "monitor_visible": False,
        "hidden_generale": False
    }
    
    await db.orders.insert_one(order)
    
    # Backup to file for Flaminio
    restaurant = await db.restaurants.find_one({"id": restaurant_id})
    if restaurant and restaurant.get("location") == "Flaminio":
        backup_file = UPLOADS_DIR / "backup_flaminio.txt"
        with open(backup_file, "a") as f:
            f.write(f"{order_number} {data.description}\n")
    
    # Append to Google Sheets in background
    location = restaurant["location"] if restaurant else restaurant_id
    asyncio.get_event_loop().run_in_executor(None, sync_append_to_sheets, order_number, data.description, location)
    
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
    
    # Get original order for logging
    original_order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not original_order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    # Log modification if description changed
    if "description" in update_data and update_data["description"] != original_order["description"]:
        modification_log = {
            "id": str(uuid.uuid4()),
            "order_id": order_id,
            "order_number": original_order["order_number"],
            "old_description": original_order["description"],
            "new_description": update_data["description"],
            "restaurant_id": restaurant_id,
            "modified_at": datetime.now(timezone.utc).isoformat()
        }
        await db.modification_logs.insert_one(modification_log)
    
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
    
    # Get the order first to log it
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Log the deletion
    deletion_log = {
        "id": str(uuid.uuid4()),
        "order_number": order["order_number"],
        "description": order["description"],
        "restaurant_id": restaurant_id,
        "deleted_at": datetime.now(timezone.utc).isoformat(),
        "original_created_at": order["created_at"]
    }
    await db.deletion_logs.insert_one(deletion_log)
    
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
        await db.restaurants.update_one(
            {"id": restaurant_id},
            {"$set": {"order_counter": highest_order["order_number"]}}
        )
    else:
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
        {"$set": {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat()
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
    
    return {"message": "Order completed"}

@api_router.post("/orders/{order_id}/kitchen-complete")
async def kitchen_complete_order(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"kitchen_completed": True}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order kitchen completed"}

@api_router.post("/orders/{order_id}/hide-generale")
async def hide_from_generale(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Calculate frozen timer value at this moment
    frozen_timer = 0
    if order.get("timer_started"):
        if order.get("timer_paused"):
            frozen_timer = order.get("timer_elapsed", 0)
        elif order.get("timer_start_time"):
            start = datetime.fromisoformat(order["timer_start_time"])
            now = datetime.now(timezone.utc)
            frozen_timer = int((now - start).total_seconds()) + (order.get("timer_elapsed", 0))
    
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"hidden_generale": True, "hidden_generale_timer": frozen_timer, "monitor_visible": False}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": "Order hidden from generale"}

@api_router.post("/orders/{order_id}/monitor-toggle")
async def toggle_monitor_visibility(order_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    order = await db.orders.find_one({"id": order_id, "restaurant_id": restaurant_id})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    new_val = not order.get("monitor_visible", False)
    result = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": restaurant_id},
        {"$set": {"monitor_visible": new_val}},
        return_document=True
    )
    
    order_response = {k: v for k, v in result.items() if k != "_id"}
    
    await manager.broadcast_to_restaurant(restaurant_id, {
        "type": "order_updated",
        "order": order_response
    })
    
    return {"message": f"Monitor visibility: {new_val}", "monitor_visible": new_val}

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
    
    return {"message": "Timer started", "timer_start_time": result["timer_start_time"]}

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

# Logs endpoints
@api_router.get("/logs/deletions")
async def get_deletion_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Get today's deletions
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    logs = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)
    
    return {"count": len(logs), "logs": logs}

@api_router.get("/logs/modifications")
async def get_modification_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    # Get today's modifications
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    logs = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)
    
    return {"count": len(logs), "logs": logs}

@api_router.get("/logs/today")
async def get_today_logs(token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": today_start.isoformat()}
        },
        {"_id": 0}
    ).sort("deleted_at", -1).to_list(500)
    
    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": today_start.isoformat()}
        },
        {"_id": 0}
    ).sort("modified_at", -1).to_list(500)
    
    return {
        "deletions": {"count": len(deletions), "logs": deletions},
        "modifications": {"count": len(modifications), "logs": modifications}
    }

@api_router.get("/report/daily")
async def get_daily_report(date: str = None, token_data: dict = Depends(verify_token)):
    """Get daily report with all orders and their status changes"""
    restaurant_id = token_data["restaurant_id"]
    
    # Parse date or use today
    if date:
        try:
            report_date = datetime.fromisoformat(date.replace('Z', '+00:00'))
        except:
            report_date = datetime.now(timezone.utc)
    else:
        report_date = datetime.now(timezone.utc)
    
    day_start = report_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    # Get all orders created on this day (including completed ones)
    # Check both active orders and archived orders
    orders = await db.orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(1000)
    
    archived = await db.archived_orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(1000)
    
    # Merge, avoiding duplicates by order id
    seen_ids = {o["id"] for o in orders}
    for a in archived:
        if a["id"] not in seen_ids:
            orders.append(a)
    orders.sort(key=lambda x: x["order_number"])
    
    # Get deletions for this day
    deletions = await db.deletion_logs.find(
        {
            "restaurant_id": restaurant_id,
            "deleted_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(1000)
    
    # Get modifications for this day
    modifications = await db.modification_logs.find(
        {
            "restaurant_id": restaurant_id,
            "modified_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).to_list(1000)
    
    # Build report items - combine orders and deleted orders
    report_items = []
    
    # Add existing orders
    for order in orders:
        item = {
            "order_number": order["order_number"],
            "description": order["description"],
            "created_at": order["created_at"],
            "completed_at": None,
            "deleted_at": None,
            "modified_at": None,
            "status": order["status"]
        }
        
        # Check if order was completed (status changed)
        if order["status"] == "completed":
            # We don't have exact completion time stored, so we'll use status
            item["completed_at"] = order.get("completed_at")
        
        # Check for modifications
        order_mods = [m for m in modifications if m.get("order_id") == order["id"]]
        if order_mods:
            # Get the latest modification
            latest_mod = max(order_mods, key=lambda x: x["modified_at"])
            item["modified_at"] = latest_mod["modified_at"]
        
        report_items.append(item)
    
    # Add deleted orders (they won't be in orders collection anymore)
    for deletion in deletions:
        # Check if this order number is already in report (shouldn't be, but just in case)
        existing = next((r for r in report_items if r["order_number"] == deletion["order_number"]), None)
        if not existing:
            item = {
                "order_number": deletion["order_number"],
                "description": deletion["description"],
                "created_at": deletion["original_created_at"],
                "completed_at": None,
                "deleted_at": deletion["deleted_at"],
                "modified_at": None,
                "status": "deleted"
            }
            
            # Check for modifications before deletion
            order_mods = [m for m in modifications if m.get("order_number") == deletion["order_number"]]
            if order_mods:
                latest_mod = max(order_mods, key=lambda x: x["modified_at"])
                item["modified_at"] = latest_mod["modified_at"]
            
            report_items.append(item)
    
    # Sort by order number
    report_items.sort(key=lambda x: x["order_number"])
    
    return {
        "date": day_start.isoformat(),
        "total_orders": len(report_items),
        "completed": len([r for r in report_items if r["status"] == "completed"]),
        "deleted": len([r for r in report_items if r["status"] == "deleted"]),
        "pending": len([r for r in report_items if r["status"] == "pending"]),
        "items": report_items
    }

# Seed data endpoint for initial setup
@api_router.post("/seed")
async def seed_data():
    # Only create restaurants if they don't exist
    existing = await db.restaurants.count_documents({})
    if existing > 0:
        # Check if Magazziniere exists, add if not
        mag = await db.restaurants.find_one({"username": "Magazziniere"})
        if not mag:
            await db.restaurants.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Pastasciutta Roma",
                "username": "Magazziniere",
                "password": pwd_context.hash("Pastasciutt4!"),
                "location": "Magazzino",
                "role": "magazzino",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0
            })
        # Check if Admin exists, add if not
        admin = await db.restaurants.find_one({"username": "Admin"})
        if not admin:
            await db.restaurants.insert_one({
                "id": str(uuid.uuid4()),
                "name": "Amministratore",
                "username": "Admin",
                "password": pwd_context.hash("Pastasciutt4!"),
                "location": "Amministrazione",
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "order_counter": 0
            })
        return {"message": "Database già configurato", "accounts": [
            {"username": "Flaminio", "location": "Flaminio"},
            {"username": "Grazie", "location": "Grazie"},
            {"username": "Brazza", "location": "Largo di Brazzà"},
            {"username": "Magazziniere", "location": "Magazzino"},
            {"username": "Admin", "location": "Amministrazione"},
        ]}
    
    # Create the 3 restaurants + magazziniere
    restaurants = [
        {"name": "Pastasciutta Roma", "username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà", "role": "restaurant"},
        {"name": "Pastasciutta Roma", "username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino", "role": "magazzino"},
        {"name": "Amministratore", "username": "Admin", "password": "Pastasciutt4!", "location": "Amministrazione", "role": "admin"},
    ]
    
    for r in restaurants:
        restaurant_id = str(uuid.uuid4())
        await db.restaurants.insert_one({
            "id": restaurant_id,
            "name": r["name"],
            "username": r["username"],
            "password": pwd_context.hash(r["password"]),
            "location": r["location"],
            "role": r.get("role", "restaurant"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "order_counter": 0
        })
    
    return {"message": "Credenziali create", "accounts": [
        {"username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio"},
        {"username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie"},
        {"username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà"},
        {"username": "Magazziniere", "password": "Pastasciutt4!", "location": "Magazzino"},
    ]}

# WebSocket endpoint
@app.websocket("/api/ws/{restaurant_id}")
async def websocket_endpoint(websocket: WebSocket, restaurant_id: str):
    await manager.connect(websocket, restaurant_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                else:
                    logger.info(f"Received WS message: {message}")
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, restaurant_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, restaurant_id)

# ==================== INVOICES (FATTURE) ====================

@api_router.post("/invoices")
async def create_invoice(data: InvoiceCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]
    
    # Check for duplicate control code
    existing = await db.invoices.find_one({
        "restaurant_id": restaurant_id,
        "control_code": data.control_code
    })
    if existing:
        raise HTTPException(status_code=400, detail="Codice di controllo già esistente")
    
    invoice_id = str(uuid.uuid4())
    
    # Save image to disk instead of DB
    image_filename = save_image_to_disk(data.image_data, "fattura")
    
    invoice = {
        "id": invoice_id,
        "restaurant_id": restaurant_id,
        "supplier": data.supplier,
        "paid": data.paid,
        "control_code": data.control_code,
        "image_file": image_filename,
        "invoice_date": data.invoice_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }
    
    await db.invoices.insert_one(invoice)
    
    return {
        "id": invoice_id,
        "message": "Fattura caricata con successo"
    }

@api_router.get("/invoices")
async def get_invoices(
    date: str = None,
    supplier: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Filter by date
    if date:
        day_start = datetime.fromisoformat(date.replace('Z', '+00:00')).replace(hour=0, minute=0, second=0)
        day_end = day_start.replace(hour=23, minute=59, second=59)
        query["created_at"] = {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
    
    # Filter by supplier
    if supplier and supplier != "all":
        query["supplier"] = supplier
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Build image_url from file or keep legacy base64
    for inv in invoices:
        if inv.get("image_file"):
            inv["image_data"] = f"/api/uploads/{inv['image_file']}"
        inv.pop("image_file", None)
    
    return invoices

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if invoice.get("image_file"):
        invoice["image_data"] = f"/api/uploads/{invoice['image_file']}"
    invoice.pop("image_file", None)
    return invoice

@api_router.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, paid: bool, token_data: dict = Depends(verify_token)):
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"$set": {"paid": paid}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"message": "Fattura aggiornata"}

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    result = await db.invoices.delete_one({
        "id": invoice_id,
        "restaurant_id": token_data["restaurant_id"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"message": "Fattura eliminata"}

@api_router.get("/suppliers")
async def get_suppliers(token_data: dict = Depends(verify_token)):
    """Get all suppliers (shared across all restaurants)"""
    suppliers = await db.suppliers.find(
        {},
        {"_id": 0}
    ).sort("name", 1).to_list(100)
    
    return suppliers

@api_router.post("/suppliers")
async def create_supplier(name: str, token_data: dict = Depends(verify_token)):
    """Add a new supplier (shared across all restaurants)"""
    # Check if exists
    existing = await db.suppliers.find_one({
        "name": {"$regex": f"^{name}$", "$options": "i"}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Fornitore già esistente")
    
    supplier_id = str(uuid.uuid4())
    await db.suppliers.insert_one({
        "id": supplier_id,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"id": supplier_id, "name": name}

@api_router.patch("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, name: str, token_data: dict = Depends(verify_token)):
    """Update supplier name (affects all restaurants)"""
    result = await db.suppliers.find_one_and_update(
        {"id": supplier_id},
        {"$set": {"name": name}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"id": supplier_id, "name": name}

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, token_data: dict = Depends(verify_token)):
    """Delete a supplier (affects all restaurants)"""
    result = await db.suppliers.delete_one({
        "id": supplier_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"message": "Fornitore eliminato"}


# ==================== PRODUCTS (WAREHOUSE) ====================

@api_router.get("/products")
async def get_products(supplier: str = None, token_data: dict = Depends(verify_token)):
    """Get all warehouse products (shared across restaurants)"""
    query = {}
    if supplier:
        query["supplier"] = supplier
    products = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    for p in products:
        if p.get("image_file"):
            p["image_url"] = f"/api/uploads/{p['image_file']}"
        elif p.get("image_data") and p["image_data"].startswith("data:"):
            p["image_url"] = p["image_data"]
        else:
            p["image_url"] = ""
        p.pop("image_file", None)
        p.pop("image_data", None)
    return products

@api_router.post("/products")
async def create_product(data: ProductCreate, token_data: dict = Depends(verify_token)):
    """Create a warehouse product (shared)"""
    product_id = str(uuid.uuid4())
    
    image_filename = ""
    if data.image_data:
        image_filename = save_image_to_disk(data.image_data, "product")
    
    product = {
        "id": product_id,
        "name": data.name,
        "unit": data.unit,
        "supplier": data.supplier,
        "image_file": image_filename,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.products.insert_one(product)
    
    response = {k: v for k, v in product.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = f"/api/uploads/{response['image_file']}"
    else:
        response["image_url"] = ""
    response.pop("image_file", None)
    
    return response

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, token_data: dict = Depends(verify_token)):
    """Update a warehouse product"""
    update_fields = {}
    if data.name is not None:
        update_fields["name"] = data.name
    if data.unit is not None:
        update_fields["unit"] = data.unit
    if data.supplier is not None:
        update_fields["supplier"] = data.supplier
    if data.image_data:
        old_product = await db.products.find_one({"id": product_id})
        if old_product and old_product.get("image_file"):
            old_path = UPLOADS_DIR / old_product["image_file"]
            if old_path.exists():
                old_path.unlink()
        update_fields["image_file"] = save_image_to_disk(data.image_data, "product")
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")
    
    result = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": update_fields},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    
    response = {k: v for k, v in result.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = f"/api/uploads/{response['image_file']}"
    else:
        response["image_url"] = ""
    response.pop("image_file", None)
    
    return response

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, token_data: dict = Depends(verify_token)):
    """Delete a warehouse product"""
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    
    if product.get("image_file"):
        old_path = UPLOADS_DIR / product["image_file"]
        if old_path.exists():
            old_path.unlink()
    
    await db.products.delete_one({"id": product_id})
    return {"message": "Prodotto eliminato"}

# ==================== VERSAMENTI (DEPOSITS) ====================

class VersamentoCreate(BaseModel):
    description: str = ""
    control_code: str = ""
    image_data: str = ""
    versamento_date: str = None

@api_router.post("/versamenti")
async def create_versamento(data: VersamentoCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]
    
    # Check for duplicate control code if provided
    if data.control_code:
        existing = await db.versamenti.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già esistente")
    
    versamento_id = str(uuid.uuid4())
    
    # Save image to disk instead of DB
    image_filename = save_image_to_disk(data.image_data, "versamento")
    
    versamento = {
        "id": versamento_id,
        "restaurant_id": restaurant_id,
        "description": data.description,
        "control_code": data.control_code,
        "image_file": image_filename,
        "versamento_date": data.versamento_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }
    
    await db.versamenti.insert_one(versamento)
    
    return {
        "id": versamento_id,
        "message": "Versamento caricato con successo"
    }

@api_router.get("/versamenti")
async def get_versamenti(
    search: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Search in description
    if search:
        query["description"] = {"$regex": search, "$options": "i"}
    
    versamenti = await db.versamenti.find(query, {"_id": 0}).sort("versamento_date", -1).to_list(500)
    
    for v in versamenti:
        if v.get("image_file"):
            v["image_data"] = f"/api/uploads/{v['image_file']}"
        v.pop("image_file", None)
    
    return versamenti

@api_router.delete("/versamenti/{versamento_id}")
async def delete_versamento(versamento_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.versamenti.delete_one({
        "id": versamento_id,
        "restaurant_id": restaurant_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Versamento non trovato")
    
    return {"message": "Versamento eliminato"}

# ==================== CHIUSURE (CLOSURES) ====================

class ChiusuraCreate(BaseModel):
    description: str = ""
    tipologia: str = "Piatti"
    control_code: str = ""
    image_data: str = ""
    chiusura_date: str = None

@api_router.post("/chiusure")
async def create_chiusura(data: ChiusuraCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]
    
    # Check for duplicate control code if provided
    if data.control_code:
        existing = await db.chiusure.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già esistente")
    
    chiusura_id = str(uuid.uuid4())
    
    # Save image to disk instead of DB
    image_filename = save_image_to_disk(data.image_data, "chiusura")
    
    chiusura = {
        "id": chiusura_id,
        "restaurant_id": restaurant_id,
        "description": data.description,
        "tipologia": data.tipologia,
        "control_code": data.control_code,
        "image_file": image_filename,
        "chiusura_date": data.chiusura_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }
    
    await db.chiusure.insert_one(chiusura)
    
    return {
        "id": chiusura_id,
        "message": "Chiusura caricata con successo"
    }

@api_router.get("/chiusure")
async def get_chiusure(
    search: str = None,
    tipologia: str = None,
    token_data: dict = Depends(verify_token)
):
    restaurant_id = token_data["restaurant_id"]
    
    query = {"restaurant_id": restaurant_id}
    
    # Filter by tipologia
    if tipologia and tipologia != "all":
        query["tipologia"] = tipologia
    
    # Search in description
    if search:
        query["description"] = {"$regex": search, "$options": "i"}
    
    chiusure = await db.chiusure.find(query, {"_id": 0}).sort("chiusura_date", -1).to_list(500)
    
    for c in chiusure:
        if c.get("image_file"):
            c["image_data"] = f"/api/uploads/{c['image_file']}"
        c.pop("image_file", None)
    
    return chiusure

@api_router.delete("/chiusure/{chiusura_id}")
async def delete_chiusura(chiusura_id: str, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.chiusure.delete_one({
        "id": chiusura_id,
        "restaurant_id": restaurant_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    
    return {"message": "Chiusura eliminata"}

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

@app.on_event("startup")
async def startup_scheduler():
    asyncio.create_task(midnight_scheduler())
