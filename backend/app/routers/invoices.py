import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.database import db
from app.core.files import build_upload_url, save_image_to_disk
from app.core.security import require_admin, verify_token
from app.core.time import _today_rome_utc_range
from app.schemas import InvoiceCreate


router = APIRouter()

__all__ = [
    "create_invoice",
    "get_invoices",
    "get_invoice",
    "update_invoice",
    "delete_invoice",
    "get_suppliers",
    "create_supplier",
    "update_supplier",
    "delete_supplier",
]


# ==================== INVOICES (FATTURE) ====================


@router.post("/invoices")
async def create_invoice(data: InvoiceCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]

    # Codice di controllo: ora opzionale. Verifichiamo duplicati nel giorno
    # solo se l'utente lo specifica esplicitamente, altrimenti accettiamo
    # qualsiasi numero di fatture.
    if data.control_code and data.control_code.strip():
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.invoices.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")

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
        "uploaded_by": restaurant_name,
        "importo": float(data.importo or 0),
        "ddt_number": (data.ddt_number or "").strip(),
    }

    await db.invoices.insert_one(invoice)

    return {
        "id": invoice_id,
        "message": "Fattura caricata con successo"
    }

@router.get("/invoices")
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
            inv["image_data"] = build_upload_url(inv["image_file"])
        inv.pop("image_file", None)

    return invoices

@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if invoice.get("image_file"):
        invoice["image_data"] = build_upload_url(invoice["image_file"])
    invoice.pop("image_file", None)
    return invoice

@router.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, paid: bool, token_data: dict = Depends(verify_token)):
    result = await db.invoices.find_one_and_update(
        {"id": invoice_id, "restaurant_id": token_data["restaurant_id"]},
        {"$set": {"paid": paid}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    return {"message": "Fattura aggiornata"}

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": invoice_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.invoices.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura non trovata")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    await db.invoices.delete_one({"id": invoice_id})
    return {"message": "Fattura eliminata"}

@router.get("/suppliers")
async def get_suppliers(token_data: dict = Depends(verify_token)):
    """Get all suppliers (shared across all restaurants)"""
    suppliers = await db.suppliers.find(
        {},
        {"_id": 0}
    ).sort("name", 1).to_list(100)

    return suppliers

@router.post("/suppliers")
async def create_supplier(name: str, token_data: dict = Depends(verify_token)):
    """Add a new supplier (shared across all restaurants)"""
    require_admin(token_data)
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

@router.patch("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, name: str, token_data: dict = Depends(verify_token)):
    """Update supplier name (affects all restaurants)"""
    require_admin(token_data)
    result = await db.suppliers.find_one_and_update(
        {"id": supplier_id},
        {"$set": {"name": name}},
        return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")

    return {"id": supplier_id, "name": name}

@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, token_data: dict = Depends(verify_token)):
    """Delete a supplier (affects all restaurants)"""
    require_admin(token_data)
    result = await db.suppliers.delete_one({
        "id": supplier_id
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornitore non trovato")

    return {"message": "Fornitore eliminato"}
