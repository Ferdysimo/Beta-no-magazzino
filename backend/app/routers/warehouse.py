import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import UPLOADS_DIR
from app.core.database import db
from app.core.files import build_upload_url, save_image_to_disk
from app.core.security import require_admin, verify_token
from app.core.time import ROME_TZ
from app.schemas import (
    CaricoCreate,
    CaricoUpdate,
    FatturaUpload,
    ProductCreate,
    ProductQuantityUpdate,
    ProductUpdate,
    RichiestaCreate,
    RichiestaErrorReport,
    RichiestaReceptionConfirm,
)


router = APIRouter()

__all__ = [
    "get_products",
    "create_product",
    "update_product",
    "update_product_quantity",
    "get_product_movements",
    "list_stock_movements",
    "delete_product",
    "get_warehouse_products_for_request",
    "create_richiesta",
    "list_richieste",
    "list_all_pending",
    "list_history_all",
    "list_transport_checks",
    "get_richiesta",
    "update_richiesta",
    "evade_richiesta",
    "conferma_richiesta",
    "segnala_errore_richiesta",
    "delete_richiesta",
    "create_carico",
    "list_carichi",
    "get_carico",
    "update_carico",
    "delete_carico",
    "upload_carico_fattura",
    "delete_carico_fattura",
]


# ==================== RICHIESTE MERCE (WAREHOUSE REQUESTS) ====================

# Indirizzi locali (DESTINATARIO del DDT)
LOCATION_ADDRESSES = {
    "Flaminio": {"address": "Piazzale Flaminio 10", "postal_code": "00196", "city": "Roma"},
    "Grazie": {"address": "Via delle Grazie 5", "postal_code": "00193", "city": "Roma"},
    "Largo di Brazzà": {"address": "Largo Pietro Di Brazzà 27", "postal_code": "00187", "city": "Roma"},
    "Brazza": {"address": "Largo Pietro Di Brazzà 27", "postal_code": "00187", "city": "Roma"},
}

MITTENTE_INFO = {
    "name": "Pastasciutta Srl",
    "address": "Via del Casale Santarelli, 125",
    "postal_code": "00118",
    "city": "Roma",
}


def _clean_transport_checker_name(value: str) -> str:
    checker_name = " ".join((value or "").split())
    if len(checker_name) < 2:
        raise HTTPException(status_code=400, detail="Inserisci il nome di chi ha controllato la merce")
    if len(checker_name) > 80:
        raise HTTPException(status_code=400, detail="Il nome del controllore è troppo lungo")
    return checker_name


# ==================== PRODUCTS (WAREHOUSE) ====================

@router.get("/products")
async def get_products(supplier: str = None, token_data: dict = Depends(verify_token)):
    """Get all warehouse products (shared across restaurants)"""
    query = {}
    if supplier:
        query["supplier"] = supplier
    products = await db.products.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    for p in products:
        if p.get("image_file"):
            p["image_url"] = build_upload_url(p["image_file"])
        elif p.get("image_data") and p["image_data"].startswith("data:"):
            p["image_url"] = p["image_data"]
        else:
            p["image_url"] = ""
        p.pop("image_file", None)
        p.pop("image_data", None)
        # Ensure quantity field exists
        if "quantity" not in p:
            p["quantity"] = 0
    return products

@router.post("/products")
async def create_product(data: ProductCreate, token_data: dict = Depends(verify_token)):
    """Create a warehouse product (shared)"""
    require_admin(token_data)
    product_id = str(uuid.uuid4())

    image_filename = ""
    if data.image_data:
        image_filename = save_image_to_disk(data.image_data, "product")

    product = {
        "id": product_id,
        "name": data.name,
        "unit": data.unit,
        "supplier": data.supplier,
        "quantity": data.quantity,
        "image_file": image_filename,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    await db.products.insert_one(product)

    # Log initial stock as opening movement (cause = stock_iniziale)
    initial_qty = int(data.quantity or 0)
    if initial_qty > 0:
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()),
            "product_id": product_id,
            "product_name": data.name,
            "delta": initial_qty,
            "balance_after": initial_qty,
            "cause": "stock_iniziale",
            "ref_type": "admin",
            "ref_id": product_id,
            "user_id": token_data.get("restaurant_id", ""),
            "user_name": token_data.get("restaurant_name", ""),
            "user_role": token_data.get("role", ""),
            "note": "Creazione prodotto",
            "timestamp": product["created_at"],
        })

    response = {k: v for k, v in product.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = build_upload_url(response["image_file"])
    else:
        response["image_url"] = ""
    response.pop("image_file", None)

    return response

@router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductUpdate, token_data: dict = Depends(verify_token)):
    """Update a warehouse product"""
    require_admin(token_data)
    update_fields = {}
    if data.name is not None:
        update_fields["name"] = data.name
    if data.unit is not None:
        update_fields["unit"] = data.unit
    if data.supplier is not None:
        update_fields["supplier"] = data.supplier
    quantity_change_requested = data.quantity is not None
    if quantity_change_requested:
        update_fields["quantity"] = data.quantity
    if data.image_data:
        old_product = await db.products.find_one({"id": product_id})
        if old_product and old_product.get("image_file"):
            old_path = UPLOADS_DIR / old_product["image_file"]
            if old_path.exists():
                old_path.unlink()
        update_fields["image_file"] = save_image_to_disk(data.image_data, "product")

    if not update_fields:
        raise HTTPException(status_code=400, detail="Nessun campo da aggiornare")

    # If quantity was explicitly provided, log the delta as a forzatura.
    if quantity_change_requested:
        old_doc = await db.products.find_one({"id": product_id}, {"_id": 0, "quantity": 1, "name": 1})
        if not old_doc:
            raise HTTPException(status_code=404, detail="Prodotto non trovato")
        new_qty = max(0, int(data.quantity))
        update_fields["quantity"] = new_qty
        delta = new_qty - int(old_doc.get("quantity", 0))
        result = await db.products.find_one_and_update(
            {"id": product_id},
            {"$set": update_fields},
            return_document=True,
        )
        if delta != 0:
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()),
                "product_id": product_id,
                "product_name": old_doc.get("name", ""),
                "delta": delta,
                "balance_after": new_qty,
                "cause": "forzatura_admin",
                "ref_type": "admin",
                "ref_id": product_id,
                "user_id": token_data.get("restaurant_id", ""),
                "user_name": token_data.get("restaurant_name", ""),
                "user_role": token_data.get("role", ""),
                "note": "PUT /products",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
    else:
        result = await db.products.find_one_and_update(
            {"id": product_id},
            {"$set": update_fields},
            return_document=True
        )

    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")

    response = {k: v for k, v in result.items() if k != "_id"}
    if response.get("image_file"):
        response["image_url"] = build_upload_url(response["image_file"])
    else:
        response["image_url"] = ""
    response.pop("image_file", None)
    if "quantity" not in response:
        response["quantity"] = 0

    return response

@router.patch("/products/{product_id}/quantity")
async def update_product_quantity(product_id: str, data: ProductQuantityUpdate, token_data: dict = Depends(verify_token)):
    """Force stock override. ADMIN ONLY (Inventario / Forza il sistema)."""
    require_admin(token_data)
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo l'Admin può forzare le quantità")
    result = await _set_stock_absolute(
        product_id=product_id,
        new_quantity=max(0, data.quantity),
        cause="forzatura_admin",
        ref_type="admin",
        ref_id=product_id,
        token_data=token_data,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")
    return {"id": product_id, "quantity": result.get("quantity", 0)}


# ==================== STOCK MOVEMENTS LEDGER - QUERY ENDPOINTS ====================

@router.get("/products/{product_id}/movements")
async def get_product_movements(
    product_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    cause: Optional[str] = None,
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """
    Cronologia movimenti di stock per un prodotto. Magazziniere/Admin.
    Filtri opzionali:
      - date_from / date_to (YYYY-MM-DD, inclusivi)
      - cause: carico | carico_modifica | carico_cancellato | evasione |
               forzatura_admin | stock_iniziale
    """
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query: Dict = {"product_id": product_id}
    if date_from or date_to:
        ts: Dict = {}
        if date_from:
            ts["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                ts["$lt"] = dt_to.strftime("%Y-%m-%dT00:00:00")
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato date_to non valido")
        query["timestamp"] = ts
    if cause:
        query["cause"] = cause
    docs = await db.stock_movements.find(query, {"_id": 0}).sort("timestamp", -1).to_list(max(1, min(limit, 5000)))
    # Bilancio corrente
    product = await db.products.find_one({"id": product_id}, {"_id": 0, "name": 1, "quantity": 1})
    return {
        "product_id": product_id,
        "product_name": product.get("name", "") if product else "",
        "current_quantity": int(product.get("quantity", 0)) if product else 0,
        "count": len(docs),
        "movements": docs,
    }


@router.get("/stock-movements")
async def list_stock_movements(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    cause: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """Cronologia globale di tutti i movimenti. Magazziniere/Admin."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query: Dict = {}
    if date_from or date_to:
        ts: Dict = {}
        if date_from:
            ts["$gte"] = f"{date_from}T00:00:00"
        if date_to:
            try:
                dt_to = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
                ts["$lt"] = dt_to.strftime("%Y-%m-%dT00:00:00")
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato date_to non valido")
        query["timestamp"] = ts
    if cause:
        query["cause"] = cause
    if user_id:
        query["user_id"] = user_id
    docs = await db.stock_movements.find(query, {"_id": 0}).sort("timestamp", -1).to_list(max(1, min(limit, 5000)))
    return {"count": len(docs), "movements": docs}

@router.delete("/products/{product_id}")
async def delete_product(product_id: str, token_data: dict = Depends(verify_token)):
    """Delete a warehouse product"""
    require_admin(token_data)
    product = await db.products.find_one({"id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Prodotto non trovato")

    if product.get("image_file"):
        old_path = UPLOADS_DIR / product["image_file"]
        if old_path.exists():
            old_path.unlink()

    await db.products.delete_one({"id": product_id})
    return {"message": "Prodotto eliminato"}

# ==================== RICHIESTE MERCE (WAREHOUSE REQUESTS) - ENDPOINTS ====================

async def _get_next_ddt_number() -> int:
    """Atomic counter for DDT numbers (globale across all locations)."""
    result = await db.counters.find_one_and_update(
        {"_id": "ddt_number"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    return int(result["value"])

async def _enrich_richiesta(r: dict) -> dict:
    """Attach restaurant info + clean _id for DDT display."""
    r = {k: v for k, v in r.items() if k != "_id"}
    rest = await db.restaurants.find_one({"id": r.get("restaurant_id")}, {"_id": 0, "password": 0})
    if rest:
        r["restaurant_name"] = rest.get("name", "")
        r["restaurant_location"] = rest.get("location", "")
        loc = rest.get("location", "")
        legacy_addr = LOCATION_ADDRESSES.get(loc, {})
        addr = {
            "address": rest.get("address") or legacy_addr.get("address") or loc,
            "postal_code": rest.get("postal_code") or legacy_addr.get("postal_code") or "",
            "city": rest.get("city") or legacy_addr.get("city") or "",
        }
        r["destinatario"] = {
            "name": loc,
            "address": addr["address"],
            "postal_code": addr["postal_code"],
            "city": addr["city"],
        }
    r["mittente"] = MITTENTE_INFO
    return r

@router.get("/warehouse/products")
async def get_warehouse_products_for_request(token_data: dict = Depends(verify_token)):
    """
    Product list for 'Nuova richiesta merce'. Each product carries:
      - quantity (stock presente a magazzino)
      - real_quantity = quantity - sum(pending requests from all locations for today)
      - image_url, unit, supplier
    """
    # Fetch all products
    products = await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(1000)

    # Compute total pending quantities per product across all pending (not yet evase) requests
    pending_agg = await db.richieste.aggregate([
        {"$match": {"status": "pending"}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.product_id", "total": {"$sum": "$items.quantity"}}},
    ]).to_list(5000)
    pending_map = {p["_id"]: p["total"] for p in pending_agg}

    for p in products:
        if p.get("image_file"):
            p["image_url"] = build_upload_url(p["image_file"])
        elif p.get("image_data") and p["image_data"].startswith("data:"):
            p["image_url"] = p["image_data"]
        else:
            p["image_url"] = ""
        p.pop("image_file", None)
        p.pop("image_data", None)
        qty = int(p.get("quantity", 0) or 0)
        pending = int(pending_map.get(p["id"], 0))
        p["quantity"] = qty
        p["real_quantity"] = max(0, qty - pending)
    return products

@router.post("/richieste")
async def create_richiesta(data: RichiestaCreate, token_data: dict = Depends(verify_token)):
    """Locale (or admin impersonating a locale) creates a new request."""
    if token_data.get("role") == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non può creare richieste")
    if not data.items and not (data.extra_note and data.extra_note.strip()):
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto o un extra")

    restaurant_id = token_data["restaurant_id"]
    restaurant = await db.restaurants.find_one({"id": restaurant_id}, {"_id": 0, "password": 0})
    if not restaurant:
        raise HTTPException(status_code=404, detail="Locale non trovato")

    # Filter out zero-quantity items
    clean_items = [i.dict() for i in data.items if i.quantity and i.quantity > 0]
    extra_note = (data.extra_note or "").strip()
    if not clean_items and not extra_note:
        raise HTTPException(status_code=400, detail="Nessuna quantità richiesta")

    ddt_number = await _get_next_ddt_number()
    richiesta_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    # Dispatch date = day AFTER creation, in Europe/Rome time.
    # The DDT is created the day before the goods are physically transported,
    # so the printed DDT date reflects the actual transport day.
    now_rome = datetime.now(ROME_TZ)
    dispatch_rome = now_rome + timedelta(days=1)
    dispatch_date_iso = dispatch_rome.replace(hour=12, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()

    doc = {
        "id": richiesta_id,
        "ddt_number": ddt_number,
        "restaurant_id": restaurant_id,
        "restaurant_location": restaurant.get("location", ""),
        "items": clean_items,
        "extra_note": extra_note,
        "status": "pending",
        "created_at": now_iso,
        "dispatch_date": dispatch_date_iso,
        "evasa_at": None,
        "confermata_at": None,
    }
    await db.richieste.insert_one(doc)
    return await _enrich_richiesta(doc)

@router.get("/richieste")
async def list_richieste(token_data: dict = Depends(verify_token)):
    """List requests for the current restaurant (pending + evase + confermate)."""
    restaurant_id = token_data["restaurant_id"]
    docs = await db.richieste.find(
        {"restaurant_id": restaurant_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return docs

@router.get("/richieste/pending-all")
async def list_all_pending(token_data: dict = Depends(verify_token)):
    """Magazziniere only: all non-confermate across all restaurants (pending + evase)."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    docs = await db.richieste.find(
        {"status": {"$in": ["pending", "evasa"]}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    # Attach restaurant location
    for d in docs:
        if not d.get("restaurant_location"):
            rest = await db.restaurants.find_one({"id": d.get("restaurant_id")}, {"_id": 0})
            if rest:
                d["restaurant_location"] = rest.get("location", "")
    return docs

@router.get("/richieste/history-all")
async def list_history_all(token_data: dict = Depends(verify_token)):
    """Magazziniere only: confermate + errori (storico)."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    docs = await db.richieste.find(
        {"status": {"$in": ["confermata", "errore"]}}, {"_id": 0}
    ).sort([("confermata_at", -1), ("error_reported_at", -1)]).limit(200).to_list(200)
    for d in docs:
        if not d.get("restaurant_location"):
            rest = await db.restaurants.find_one({"id": d.get("restaurant_id")}, {"_id": 0})
            if rest:
                d["restaurant_location"] = rest.get("location", "")
    return docs


@router.get("/admin/transport-checks")
async def list_transport_checks(
    restaurant_id: str,
    date_from: str,
    date_to: str,
    token_data: dict = Depends(verify_token),
):
    """Admin-only transport checks read directly from existing DDT requests."""
    require_admin(token_data)
    try:
        start_day = datetime.strptime(date_from, "%Y-%m-%d").date()
        end_day = datetime.strptime(date_to, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Periodo non valido")
    if end_day < start_day:
        raise HTTPException(status_code=400, detail="Periodo non valido")
    if (end_day - start_day).days > 370:
        raise HTTPException(status_code=400, detail="Il periodo massimo è di 371 giorni")

    start_iso = datetime.combine(
        start_day,
        datetime.min.time(),
        tzinfo=ROME_TZ,
    ).astimezone(timezone.utc).isoformat()
    end_iso = datetime.combine(
        end_day + timedelta(days=1),
        datetime.min.time(),
        tzinfo=ROME_TZ,
    ).astimezone(timezone.utc).isoformat()
    docs = await db.richieste.find(
        {
            "restaurant_id": restaurant_id,
            "dispatch_date": {"$gte": start_iso, "$lt": end_iso},
            "status": {"$in": ["evasa", "confermata", "errore"]},
        },
        {
            "_id": 0,
            "id": 1,
            "ddt_number": 1,
            "restaurant_id": 1,
            "restaurant_location": 1,
            "dispatch_date": 1,
            "status": 1,
            "evasa_at": 1,
            "confermata_at": 1,
            "error_reported_at": 1,
            "error_reason": 1,
            "transport_checked_by": 1,
            "transport_checked_at": 1,
            "transport_check_outcome": 1,
            "transport_checked_account": 1,
        },
    ).sort([("dispatch_date", 1), ("ddt_number", 1)]).to_list(500)
    return docs


@router.get("/richieste/{richiesta_id}")
async def get_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Get single request with MITTENTE/DESTINATARIO populated for DDT view."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    # Access control: restaurant can only see its own; magazziniere/admin can see all
    role = token_data.get("role")
    if role not in ("magazzino", "admin") and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    return await _enrich_richiesta(doc)

@router.patch("/richieste/{richiesta_id}")
async def update_richiesta(
    richiesta_id: str,
    data: RichiestaCreate,
    token_data: dict = Depends(verify_token),
):
    """Edit a pending richiesta. Only the requesting locale or an admin can
    modify it, and only within 20 minutes from creation (admin bypasses).
    A request that has already been evasa/confermata cannot be modified."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    is_admin = role == "admin"
    is_owner = doc.get("restaurant_id") == token_data["restaurant_id"]
    if not (is_admin or is_owner):
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già evasa o confermata, non modificabile")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"])
            if (datetime.now(timezone.utc) - created).total_seconds() > 20 * 60:
                raise HTTPException(status_code=403, detail="Modificabile solo entro 20 minuti dalla creazione")
        except (KeyError, ValueError):
            raise HTTPException(status_code=400, detail="Data creazione non valida")
    # Validate items (same logic as create)
    clean_items = [i.dict() for i in data.items if i.quantity and i.quantity > 0]
    extra_note = (data.extra_note or "").strip()
    if not clean_items and not extra_note:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto o un extra")
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {
            "items": clean_items,
            "extra_note": extra_note,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        return_document=True,
    )
    return await _enrich_richiesta(updated)


@router.patch("/richieste/{richiesta_id}/evade")
async def evade_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Magazziniere marks the request as fulfilled. Decrements product stock."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo il magazziniere può evadere")
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="La richiesta non è in stato 'pending'")

    # Decrement stock atomically + log movement
    for item in doc.get("items", []):
        qty = int(item.get("quantity", 0))
        if qty:
            await _apply_stock_delta(
                product_id=item["product_id"],
                delta=-qty,
                cause="evasione",
                ref_type="richiesta",
                ref_id=richiesta_id,
                token_data=token_data,
                note=f"DDT {doc.get('ddt_number', '')} -> {doc.get('restaurant_location', '')}",
            )
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {"status": "evasa", "evasa_at": now_iso}},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@router.patch("/richieste/{richiesta_id}/conferma")
async def conferma_richiesta(
    richiesta_id: str,
    data: RichiestaReceptionConfirm,
    token_data: dict = Depends(verify_token),
):
    """Locale (or admin) confirms reception of the goods."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non conferma")
    if role != "admin" and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "evasa":
        raise HTTPException(status_code=400, detail="La richiesta deve essere evasa prima di confermarla")
    checker_name = _clean_transport_checker_name(data.checker_name)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {
            "status": "confermata",
            "confermata_at": now_iso,
            "transport_checked_by": checker_name,
            "transport_checked_at": now_iso,
            "transport_check_outcome": "confermata",
            "transport_checked_account": token_data.get("username", ""),
        }},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@router.patch("/richieste/{richiesta_id}/errore")
async def segnala_errore_richiesta(richiesta_id: str, data: RichiestaErrorReport, token_data: dict = Depends(verify_token)):
    """Locale (or admin) flags the request as 'errore' (wrong/incomplete delivery)."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non segnala errori")
    if role != "admin" and doc.get("restaurant_id") != token_data["restaurant_id"]:
        raise HTTPException(status_code=403, detail="Non autorizzato")
    if doc.get("status") != "evasa":
        raise HTTPException(status_code=400, detail="Puoi segnalare l'errore solo su richieste evase")
    if not data.reason or not data.reason.strip():
        raise HTTPException(status_code=400, detail="Spiega il motivo dell'errore")
    checker_name = _clean_transport_checker_name(data.checker_name)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.richieste.find_one_and_update(
        {"id": richiesta_id},
        {"$set": {
            "status": "errore",
            "error_reason": data.reason.strip(),
            "error_reported_at": now_iso,
            "transport_checked_by": checker_name,
            "transport_checked_at": now_iso,
            "transport_check_outcome": "errore",
            "transport_checked_account": token_data.get("username", ""),
        }},
        return_document=True,
    )
    return await _enrich_richiesta(updated)

@router.delete("/richieste/{richiesta_id}")
async def delete_richiesta(richiesta_id: str, token_data: dict = Depends(verify_token)):
    """Locale cancella una richiesta che ha creato (solo se pending). Admin può cancellare qualsiasi."""
    doc = await db.richieste.find_one({"id": richiesta_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    role = token_data.get("role")
    if role == "magazzino":
        raise HTTPException(status_code=403, detail="Il magazziniere non può cancellare")
    if role != "admin":
        if doc.get("restaurant_id") != token_data["restaurant_id"]:
            raise HTTPException(status_code=403, detail="Non autorizzato")
        if doc.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Puoi cancellare solo richieste non ancora evase")
    await db.richieste.delete_one({"id": richiesta_id})
    return {"message": "Richiesta cancellata"}


# ==================== CARICHI MAGAZZINO - ENDPOINTS ====================

# ---- Stock movements ledger ----
# Every change to products.quantity is logged in `stock_movements` for audit.
async def _apply_stock_delta(
    product_id: str,
    delta: int,
    cause: str,
    ref_type: str,
    ref_id: str,
    token_data: dict,
    note: str = "",
) -> Optional[int]:
    """
    Atomically apply +/- delta to product.quantity AND log the movement.
    Returns the new balance (post-mutation) or None if product not found.

    `cause`:    one of "carico", "carico_modifica", "carico_cancellato",
                       "evasione", "forzatura_admin", "stock_iniziale".
    `ref_type`: "carico" | "richiesta" | "admin" | "backfill".
    `ref_id`:   id of the source document (carico_id, richiesta_id, etc).
    """
    if delta == 0:
        return None
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$inc": {"quantity": int(delta)}},
        return_document=True,
        projection={"_id": 0, "quantity": 1, "name": 1},
    )
    if not updated:
        return None
    balance_after = int(updated.get("quantity", 0))
    await db.stock_movements.insert_one({
        "id": str(uuid.uuid4()),
        "product_id": product_id,
        "product_name": updated.get("name", ""),
        "delta": int(delta),
        "balance_after": balance_after,
        "cause": cause,
        "ref_type": ref_type,
        "ref_id": ref_id,
        "user_id": token_data.get("restaurant_id", ""),
        "user_name": token_data.get("restaurant_name", ""),
        "user_role": token_data.get("role", ""),
        "note": note,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return balance_after


async def _set_stock_absolute(
    product_id: str,
    new_quantity: int,
    cause: str,
    ref_type: str,
    ref_id: str,
    token_data: dict,
    note: str = "",
) -> Optional[dict]:
    """
    Force-set product.quantity to an absolute value AND log the resulting delta.
    Used by Admin "Forza il sistema". Returns the updated product or None.
    """
    new_quantity = max(0, int(new_quantity))
    # Capture old quantity first so we can compute delta after the set.
    old = await db.products.find_one({"id": product_id}, {"_id": 0, "quantity": 1, "name": 1})
    if not old:
        return None
    old_qty = int(old.get("quantity", 0))
    delta = new_quantity - old_qty
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": {"quantity": new_quantity}},
        return_document=True,
    )
    if not updated:
        return None
    if delta != 0:
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()),
            "product_id": product_id,
            "product_name": old.get("name", ""),
            "delta": delta,
            "balance_after": new_quantity,
            "cause": cause,
            "ref_type": ref_type,
            "ref_id": ref_id,
            "user_id": token_data.get("restaurant_id", ""),
            "user_name": token_data.get("restaurant_name", ""),
            "user_role": token_data.get("role", ""),
            "note": note,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    return updated


def _serialize_carico(c: dict) -> dict:
    c = {k: v for k, v in c.items() if k != "_id"}
    photo = c.pop("photo_file", None)
    c["photo_url"] = build_upload_url(photo)
    fattura = c.pop("fattura_file", None)
    c["fattura_url"] = build_upload_url(fattura)
    return c

@router.post("/carichi")
async def create_carico(data: CaricoCreate, token_data: dict = Depends(verify_token)):
    """Magazziniere: register incoming goods from a supplier. Increments product stock."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo il magazziniere può caricare merce")
    if not data.supplier_name:
        raise HTTPException(status_code=400, detail="Seleziona un fornitore")
    clean_items = [i.dict() for i in (data.items or []) if i.quantity_added and i.quantity_added > 0]
    if not clean_items:
        raise HTTPException(status_code=400, detail="Aggiungi almeno un prodotto con quantità > 0")

    # Photo (DDT/fattura) is optional for the "Derrate" supplier and for
    # carichi composed only of ragù items. Required in every other case.
    supplier_lower = (data.supplier_name or "").strip().lower()
    all_ragu = all("rag" in (it.get("product_name", "") or "").lower() for it in clean_items)
    invoice_optional = supplier_lower == "derrate" or all_ragu
    if not data.photo_data and not invoice_optional:
        raise HTTPException(status_code=400, detail="La foto del DDT è obbligatoria")

    photo_filename = save_image_to_disk(data.photo_data, "carico") if data.photo_data else ""
    fattura_filename = save_image_to_disk(data.fattura_data, "fattura_carico") if data.fattura_data else ""
    carico_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    doc = {
        "id": carico_id,
        "supplier_name": data.supplier_name,
        "ddt_number_fornitore": data.ddt_number_fornitore or "",
        "photo_file": photo_filename,
        "fattura_file": fattura_filename,
        "items": clean_items,
        "created_at": now_iso,
        "updated_at": now_iso,
        "created_by_id": token_data.get("restaurant_id"),
    }
    await db.carichi_magazzino.insert_one(doc)

    # Increment product stock + log movement
    for it in clean_items:
        await _apply_stock_delta(
            product_id=it["product_id"],
            delta=int(it["quantity_added"]),
            cause="carico",
            ref_type="carico",
            ref_id=carico_id,
            token_data=token_data,
            note=data.supplier_name or "",
        )

    return _serialize_carico(doc)

@router.get("/carichi")
async def list_carichi(
    supplier: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """List all carichi (magazziniere/admin only) sorted desc by date."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    query = {}
    if supplier:
        query["supplier_name"] = supplier
    if date_from or date_to:
        r = {}
        if date_from:
            r["$gte"] = date_from
        if date_to:
            r["$lte"] = date_to
        query["created_at"] = r
    docs = await db.carichi_magazzino.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_serialize_carico(d) for d in docs]

@router.get("/carichi/{carico_id}")
async def get_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    return _serialize_carico(doc)

@router.put("/carichi/{carico_id}")
async def update_carico(carico_id: str, data: CaricoUpdate, token_data: dict = Depends(verify_token)):
    """Edit a carico: rolls back old stock delta and applies new one atomically-ish."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    old = await db.carichi_magazzino.find_one({"id": carico_id})
    if not old:
        raise HTTPException(status_code=404, detail="Carico non trovato")

    update_fields: Dict = {}
    if data.supplier_name is not None:
        update_fields["supplier_name"] = data.supplier_name
    if data.ddt_number_fornitore is not None:
        update_fields["ddt_number_fornitore"] = data.ddt_number_fornitore

    if data.photo_data:
        # Replace photo file
        old_photo = old.get("photo_file")
        if old_photo:
            op = UPLOADS_DIR / old_photo
            if op.exists():
                op.unlink()
        update_fields["photo_file"] = save_image_to_disk(data.photo_data, "carico")

    if data.fattura_data:
        # Replace fattura file
        old_fattura = old.get("fattura_file")
        if old_fattura:
            op = UPLOADS_DIR / old_fattura
            if op.exists():
                op.unlink()
        update_fields["fattura_file"] = save_image_to_disk(data.fattura_data, "fattura_carico")

    if data.items is not None:
        new_items = [i.dict() for i in data.items if i.quantity_added and i.quantity_added > 0]
        if not new_items:
            raise HTTPException(status_code=400, detail="Deve esserci almeno un prodotto")
        # Compute deltas: subtract old, add new per product_id
        old_map: Dict[str, int] = {}
        for it in old.get("items", []):
            old_map[it["product_id"]] = old_map.get(it["product_id"], 0) + int(it.get("quantity_added", 0))
        new_map: Dict[str, int] = {}
        for it in new_items:
            new_map[it["product_id"]] = new_map.get(it["product_id"], 0) + int(it["quantity_added"])

        all_ids = set(old_map) | set(new_map)
        for pid in all_ids:
            delta = new_map.get(pid, 0) - old_map.get(pid, 0)
            if delta != 0:
                await _apply_stock_delta(
                    product_id=pid,
                    delta=delta,
                    cause="carico_modifica",
                    ref_type="carico",
                    ref_id=carico_id,
                    token_data=token_data,
                )
        update_fields["items"] = new_items

    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()

    updated = await db.carichi_magazzino.find_one_and_update(
        {"id": carico_id}, {"$set": update_fields}, return_document=True
    )
    return _serialize_carico(updated)

@router.delete("/carichi/{carico_id}")
async def delete_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    """Delete a carico: rolls back the stock addition."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    old = await db.carichi_magazzino.find_one({"id": carico_id})
    if not old:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    # Rollback stock + log movement
    for it in old.get("items", []):
        qty = int(it.get("quantity_added", 0))
        if qty:
            await _apply_stock_delta(
                product_id=it["product_id"],
                delta=-qty,
                cause="carico_cancellato",
                ref_type="carico",
                ref_id=carico_id,
                token_data=token_data,
            )
    # Delete photo file
    ph = old.get("photo_file")
    if ph:
        p = UPLOADS_DIR / ph
        if p.exists():
            p.unlink()
    # Delete fattura file
    ft = old.get("fattura_file")
    if ft:
        p = UPLOADS_DIR / ft
        if p.exists():
            p.unlink()
    await db.carichi_magazzino.delete_one({"id": carico_id})
    return {"message": "Carico cancellato e stock ripristinato"}


@router.put("/carichi/{carico_id}/fattura")
async def upload_carico_fattura(carico_id: str, data: FatturaUpload, token_data: dict = Depends(verify_token)):
    """Attach/replace the fattura image for a given carico."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    if not data.fattura_data:
        raise HTTPException(status_code=400, detail="Immagine fattura mancante")
    old_fattura = doc.get("fattura_file")
    if old_fattura:
        op = UPLOADS_DIR / old_fattura
        if op.exists():
            op.unlink()
    filename = save_image_to_disk(data.fattura_data, "fattura_carico")
    updated = await db.carichi_magazzino.find_one_and_update(
        {"id": carico_id},
        {"$set": {"fattura_file": filename, "updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
    )
    return _serialize_carico(updated)


@router.delete("/carichi/{carico_id}/fattura")
async def delete_carico_fattura(carico_id: str, token_data: dict = Depends(verify_token)):
    """Remove the fattura image from a carico."""
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")
    doc = await db.carichi_magazzino.find_one({"id": carico_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    old_fattura = doc.get("fattura_file")
    if old_fattura:
        op = UPLOADS_DIR / old_fattura
        if op.exists():
            op.unlink()
    await db.carichi_magazzino.update_one(
        {"id": carico_id},
        {"$unset": {"fattura_file": ""}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"message": "Fattura rimossa"}
