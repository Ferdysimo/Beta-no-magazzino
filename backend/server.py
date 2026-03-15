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
    orders = await db.orders.find(
        {
            "restaurant_id": restaurant_id,
            "created_at": {"$gte": day_start.isoformat(), "$lte": day_end.isoformat()}
        },
        {"_id": 0}
    ).sort("order_number", 1).to_list(1000)
    
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
        return {"message": "Database già configurato", "accounts": [
            {"username": "Flaminio", "location": "Flaminio"},
            {"username": "Grazie", "location": "Grazie"},
            {"username": "Brazza", "location": "Largo di Brazzà"},
        ]}
    
    # Create the 3 restaurants with new credentials
    restaurants = [
        {"name": "Pastasciutta Roma", "username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio"},
        {"name": "Pastasciutta Roma", "username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie"},
        {"name": "Pastasciutta Roma", "username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà"},
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
    
    return {"message": "Credenziali create", "accounts": [
        {"username": "Flaminio", "password": "Pastasciutt4!", "location": "Flaminio"},
        {"username": "Grazie", "password": "Pastasciutt4!", "location": "Grazie"},
        {"username": "Brazza", "password": "Pastasciutt4!", "location": "Largo di Brazzà"},
    ]}

# WebSocket endpoint
@app.websocket("/ws/{restaurant_id}")
async def websocket_endpoint(websocket: WebSocket, restaurant_id: str):
    await manager.connect(websocket, restaurant_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            logger.info(f"Received WS message: {message}")
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
    
    invoice = {
        "id": invoice_id,
        "restaurant_id": restaurant_id,
        "supplier": data.supplier,
        "paid": data.paid,
        "control_code": data.control_code,
        "image_data": data.image_data,
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
    
    return invoices

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
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
    """Get unique suppliers for this restaurant"""
    restaurant_id = token_data["restaurant_id"]
    
    # Get suppliers from dedicated collection
    suppliers = await db.suppliers.find(
        {"restaurant_id": restaurant_id},
        {"_id": 0}
    ).sort("name", 1).to_list(100)
    
    return suppliers

@api_router.post("/suppliers")
async def create_supplier(name: str, token_data: dict = Depends(verify_token)):
    """Add a new supplier"""
    restaurant_id = token_data["restaurant_id"]
    
    # Check if exists
    existing = await db.suppliers.find_one({
        "restaurant_id": restaurant_id,
        "name": {"$regex": f"^{name}$", "$options": "i"}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Fornitore già esistente")
    
    supplier_id = str(uuid.uuid4())
    await db.suppliers.insert_one({
        "id": supplier_id,
        "name": name,
        "restaurant_id": restaurant_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"id": supplier_id, "name": name}

@api_router.patch("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, name: str, token_data: dict = Depends(verify_token)):
    """Update supplier name"""
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.suppliers.find_one_and_update(
        {"id": supplier_id, "restaurant_id": restaurant_id},
        {"$set": {"name": name}},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"id": supplier_id, "name": name}

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, token_data: dict = Depends(verify_token)):
    """Delete a supplier"""
    restaurant_id = token_data["restaurant_id"]
    
    result = await db.suppliers.delete_one({
        "id": supplier_id,
        "restaurant_id": restaurant_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")
    
    return {"message": "Fornitore eliminato"}

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
