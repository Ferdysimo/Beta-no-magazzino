import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.catalogs import BEVERAGES_CATALOG, UNITS_PER_CASE
from app.core.database import db
from app.core.deps import _effective_restaurant_id
from app.core.files import build_upload_url, save_image_to_disk
from app.core.security import can_impersonate, verify_token
from app.core.time import ROME_TZ, _today_rome_bounds_utc
from app.schemas import BeverageCaricoCreate
from app.services.beverage_prices import (
    _beverage_price_for_row,
    _get_beverage_catalog_for,
)
from app.services.report import _resolve_historical_mode
from app.tasks.maintenance import UPLOADS_RETENTION_DAYS, cleanup_old_uploads


logger = logging.getLogger(__name__)
router = APIRouter()

__all__ = [
    "list_beverages",
    "get_beverage_inventory",
    "admin_cleanup_old_uploads",
    "get_generale_hide_log",
    "create_beverage_carico",
    "list_beverage_carichi",
    "delete_beverage_carico",
    "register_beverage_sale",
    "undo_beverage_sale",
    "get_beverage_sales_today",
    "beverage_report",
    "analisi_magazzino",
]


async def _get_flaminio_restaurant_id() -> Optional[str]:
    r = await db.restaurants.find_one({"username": "Flaminio"}, {"_id": 0, "id": 1})
    return r["id"] if r else None


def _require_flaminio_access(token_data: dict, flaminio_id: str) -> None:
    if token_data.get("restaurant_id") != flaminio_id and not can_impersonate(token_data):
        raise HTTPException(status_code=403, detail="Funzione riservata a Flaminio")


# ==================== BEVANDE (FLAMINIO ONLY) ====================

@router.get("/beverages")
async def list_beverages(request: Request, token_data: dict = Depends(verify_token)):
    """Catalog of 9 beverages (sigla, name, price). Sorted by sort_order."""
    rid = await _effective_restaurant_id(request, token_data)
    return await _get_beverage_catalog_for(rid)


@router.get("/beverages/inventory")
async def get_beverage_inventory(
    request: Request,
    date: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """On-hand inventory of beverages for the current restaurant."""
    historical = _resolve_historical_mode(date, restaurant_id, token_data, allow_self=True)
    if historical:
        target_date, rid = historical
    else:
        target_date = None
        rid = await _effective_restaurant_id(request, token_data)
    beverages = await _get_beverage_catalog_for(rid)
    if target_date:
        daily_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": target_date},
            {"_id": 0, "sigla": 1, "price_snapshot": 1},
        ).to_list(20)
        daily_by_sigla = {row.get("sigla"): row for row in daily_docs}
        fallback_prices = {item["sigla"]: item["price"] for item in beverages}
        beverages = [
            {
                **item,
                "price": _beverage_price_for_row(
                    daily_by_sigla.get(item["sigla"], {"sigla": item["sigla"]}),
                    fallback_prices,
                ),
            }
            for item in beverages
        ]
    inv_docs = await db.beverage_inventory.find(
        {"restaurant_id": rid}, {"_id": 0}
    ).to_list(20)
    inv_map = {d["sigla"]: d.get("quantity", 0) for d in inv_docs}
    return [{**b, "quantity": inv_map.get(b["sigla"], 0)} for b in beverages]


# ---------- Daily counts (Magazzino Bevande page persistence) ----------












# ---------- Cash daily counts (Report page — riepilogo cassa Flaminio) ----------

# Helper: evaluate "=..." expressions safely; mirror of the JS evaluateValue




# Moltiplicatori spicci (mazzette/rotolini aperti) — devono restare allineati al frontend

# Listino paste DI DEFAULT (deve restare allineato a PASTA_PRICES nel frontend ReportBetaPage.js).
# Ogni ristorante può sovrascrivere il dizionario nella collection `pasta_dictionary`.












# Regex per matchare una sigla SOLO se appare immediatamente dopo un eventuale
# numero d'ordine + whitespace iniziale. Esempio:
#   "42 CARB - PIET"    → match CARB ✓
#   "42 PIETRO CARB"    → NO match ✗
#   "42 - CARB"         → NO match ✗  (c'è '-' tra numero e sigla)
#   "CARB tavolo 5"     → match CARB ✓ (nessun numero, sigla è prima parola)























































# ---------- Storico Chiusure (Admin only) ----------



@router.post("/admin/_cleanup-old-uploads")
async def admin_cleanup_old_uploads(
    retention_days: int = UPLOADS_RETENTION_DAYS,
    token_data: dict = Depends(verify_token)
):
    """Admin-only: cancella manualmente fatture / versamenti / chiusure più
    vecchie di `retention_days` (default 90 = 3 mesi). Restituisce il numero
    di documenti eliminati per ciascuna collezione. La pulizia gira anche
    automaticamente ad ogni scatto di mezzanotte e all'avvio del server.
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if retention_days < 1:
        raise HTTPException(status_code=400, detail="retention_days deve essere >= 1")
    logger.info(f"[ADMIN] Manual cleanup_old_uploads triggered (retention={retention_days}d)")
    deleted = await cleanup_old_uploads(retention_days=retention_days)
    return {"retention_days": retention_days, "deleted": deleted}


@router.get("/admin/generale-hide-log")
async def get_generale_hide_log(
    restaurant_id: Optional[str] = None,
    limit: int = 200,
    token_data: dict = Depends(verify_token),
):
    """Audit log silenzioso: ogni volta che qualcuno preme il cestino sul
    Tablet Generale per nascondere un ordine, qui viene registrato chi/quando/
    quale ordine. Admin only. Filtrabile per restaurant_id.
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    query = {}
    if restaurant_id:
        query["restaurant_id"] = restaurant_id
    limit = max(1, min(limit, 1000))
    rows = await db.generale_hide_log.find(query, {"_id": 0}).sort("hidden_at", -1).to_list(limit)
    return {"items": rows, "count": len(rows)}



















# ─── DIZIONARIO PASTE PER RISTORANTE ─────────────────────────────────────────
















async def create_beverage_carico(
    data: BeverageCaricoCreate, token_data: dict = Depends(verify_token)
):
    """Register a beverage carico: increases inventory of each beverage at Flaminio."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    if not data.items:
        raise HTTPException(status_code=400, detail="Aggiungi almeno una bevanda")
    # Validate siglas
    valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
    for it in data.items:
        if it.sigla not in valid_siglas:
            raise HTTPException(status_code=400, detail=f"Sigla non valida: {it.sigla}")
        if it.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantità non valida per {it.sigla}")
    # Normalise items: store both `cases` and the resulting `units`
    items_saved = [
        {
            "sigla": it.sigla,
            "cases": int(it.quantity),
            "units": int(it.quantity) * UNITS_PER_CASE,
            # Back-compat: some downstream code may still look at `quantity`.
            # We keep it equal to cases to preserve the "human-readable"
            # count shown in the carico form.
            "quantity": int(it.quantity),
        }
        for it in data.items
    ]
    invoice_filename = save_image_to_disk(data.invoice_image_data, "beverage_invoice") if data.invoice_image_data else ""
    carico_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": carico_id,
        "restaurant_id": flaminio_id,
        "supplier": data.supplier.strip() or "Gioia",
        "invoice_file": invoice_filename,
        "invoice_url": build_upload_url(invoice_filename),
        "invoice_date": data.invoice_date or "",
        "items": items_saved,
        "units_per_case": UNITS_PER_CASE,
        "notes": (data.notes or "").strip(),
        "created_at": now_iso,
        "created_by": token_data["restaurant_id"],
    }
    await db.beverage_carichi.insert_one(doc)
    # Atomically increment inventory in UNITS for each beverage
    for it in items_saved:
        await db.beverage_inventory.update_one(
            {"restaurant_id": flaminio_id, "sigla": it["sigla"]},
            {
                "$inc": {"quantity": it["units"]},
                "$setOnInsert": {"id": str(uuid.uuid4())},
                "$set": {"updated_at": now_iso},
            },
            upsert=True,
        )
    doc.pop("_id", None)
    return doc


async def list_beverage_carichi(token_data: dict = Depends(verify_token)):
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return []
    docs = await db.beverage_carichi.find(
        {"restaurant_id": flaminio_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return docs


async def delete_beverage_carico(carico_id: str, token_data: dict = Depends(verify_token)):
    """Delete a carico and revert its inventory impact. Within 20min for non-admins."""
    flaminio_id = await _get_flaminio_restaurant_id()
    doc = await db.beverage_carichi.find_one({"id": carico_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Carico non trovato")
    # 20-minute rule for non-admins
    if token_data.get("role") != "admin":
        created = datetime.fromisoformat(doc["created_at"])
        if (datetime.now(timezone.utc) - created).total_seconds() > 20 * 60:
            raise HTTPException(status_code=403, detail="Carico modificabile solo entro 20 minuti")
    # Revert inventory (in units, falling back to quantity×UPC for legacy items)
    for it in doc.get("items", []):
        units = int(it.get("units") or (it.get("quantity", 0) * doc.get("units_per_case", UNITS_PER_CASE)))
        await db.beverage_inventory.update_one(
            {"restaurant_id": flaminio_id, "sigla": it["sigla"]},
            {"$inc": {"quantity": -units}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    await db.beverage_carichi.delete_one({"id": carico_id})
    return {"message": "Carico eliminato"}


@router.post("/beverages/sales")
async def register_beverage_sale(
    data: dict, token_data: dict = Depends(verify_token)
):
    """Register a +1 sale for a beverage. Decrements inventory by 1."""
    sigla = data.get("sigla")
    if not sigla:
        raise HTTPException(status_code=400, detail="sigla mancante")
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    beverages = await _get_beverage_catalog_for(flaminio_id)
    bev = next((item for item in beverages if item["sigla"] == sigla), None)
    if not bev:
        raise HTTPException(status_code=404, detail="Bevanda non trovata")
    _require_flaminio_access(token_data, flaminio_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    sale = {
        "id": str(uuid.uuid4()),
        "restaurant_id": flaminio_id,
        "sigla": sigla,
        "name": bev["name"],
        "quantity": 1,
        "price_each": bev["price"],
        "total": bev["price"],
        "created_at": now_iso,
        "created_by": token_data["restaurant_id"],
    }
    await db.beverage_sales.insert_one(sale)
    # Atomically decrement inventory (allowed to go negative to reflect reality)
    await db.beverage_inventory.update_one(
        {"restaurant_id": flaminio_id, "sigla": sigla},
        {
            "$inc": {"quantity": -1},
            "$setOnInsert": {"id": str(uuid.uuid4())},
            "$set": {"updated_at": now_iso},
        },
        upsert=True,
    )
    sale.pop("_id", None)
    return sale


@router.post("/beverages/sales/undo")
async def undo_beverage_sale(data: dict, token_data: dict = Depends(verify_token)):
    """Undo the most recent TODAY sale for a given sigla. Restores inventory +1."""
    sigla = data.get("sigla")
    if not sigla:
        raise HTTPException(status_code=400, detail="sigla mancante")
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        raise HTTPException(status_code=404, detail="Ristorante Flaminio non trovato")
    _require_flaminio_access(token_data, flaminio_id)
    # "Today" in Europe/Rome
    start_utc, end_utc = _today_rome_bounds_utc()
    last = await db.beverage_sales.find_one(
        {
            "restaurant_id": flaminio_id,
            "sigla": sigla,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        },
        sort=[("created_at", -1)],
        projection={"_id": 0},
    )
    if not last:
        raise HTTPException(status_code=400, detail="Nessuna vendita di oggi da stornare")
    await db.beverage_sales.delete_one({"id": last["id"]})
    await db.beverage_inventory.update_one(
        {"restaurant_id": flaminio_id, "sigla": sigla},
        {"$inc": {"quantity": 1}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"message": "Vendita stornata", "sigla": sigla}


@router.get("/beverages/sales/today")
async def get_beverage_sales_today(token_data: dict = Depends(verify_token)):
    """Summary of today's sales per beverage for the Cassa box.
    Returns [{sigla, name, price, count, inventory}]."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return []
    _require_flaminio_access(token_data, flaminio_id)
    start_utc, end_utc = _today_rome_bounds_utc()
    # Aggregate today's sales
    pipeline = [
        {"$match": {
            "restaurant_id": flaminio_id,
            "created_at": {"$gte": start_utc, "$lt": end_utc},
        }},
        {"$group": {"_id": "$sigla", "count": {"$sum": "$quantity"}}},
    ]
    agg = await db.beverage_sales.aggregate(pipeline).to_list(20)
    count_map = {a["_id"]: a["count"] for a in agg}
    # Inventory map
    inv_docs = await db.beverage_inventory.find(
        {"restaurant_id": flaminio_id}, {"_id": 0, "sigla": 1, "quantity": 1}
    ).to_list(20)
    inv_map = {d["sigla"]: d.get("quantity", 0) for d in inv_docs}
    beverages = await _get_beverage_catalog_for(flaminio_id)
    return [
        {
            "sigla": b["sigla"],
            "name": b["name"],
            "price": b["price"],
            "count": count_map.get(b["sigla"], 0),
            "inventory": inv_map.get(b["sigla"], 0),
        }
        for b in beverages
    ]


async def beverage_report(
    date_from: str,
    date_to: str,
    token_data: dict = Depends(verify_token),
):
    """Aggregated sales between date_from and date_to (inclusive), Europe/Rome.
    Returns per-beverage totals and grand total."""
    flaminio_id = await _get_flaminio_restaurant_id()
    if not flaminio_id:
        return {"items": [], "grand_total": 0, "total_count": 0}
    try:
        from_date = datetime.strptime(date_from, "%Y-%m-%d")
        to_date = datetime.strptime(date_to, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato data non valido, usa YYYY-MM-DD")
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="date_to precede date_from")
    start_rome = from_date.replace(tzinfo=ROME_TZ)
    end_rome = (to_date + timedelta(days=1)).replace(tzinfo=ROME_TZ)
    start_utc = start_rome.astimezone(timezone.utc).isoformat()
    end_utc = end_rome.astimezone(timezone.utc).isoformat()
    # Query BOTH current and archived sales collections (midnight reset archives)
    beverages = await _get_beverage_catalog_for(flaminio_id)
    bev_map = {b["sigla"]: b for b in beverages}

    results = {b["sigla"]: {"sigla": b["sigla"], "name": b["name"], "price": b["price"], "count": 0, "total": 0.0} for b in beverages}

    for coll in ("beverage_sales", "archived_beverage_sales"):
        pipeline = [
            {"$match": {
                "restaurant_id": flaminio_id,
                "created_at": {"$gte": start_utc, "$lt": end_utc},
            }},
            {"$group": {
                "_id": "$sigla",
                "count": {"$sum": "$quantity"},
                "total": {"$sum": "$total"},
            }},
        ]
        agg = await db[coll].aggregate(pipeline).to_list(20)
        for a in agg:
            sig = a["_id"]
            if sig in results:
                results[sig]["count"] += int(a["count"])
                results[sig]["total"] += float(a["total"])

    items = [results[b["sigla"]] for b in beverages]
    grand_total = round(sum(x["total"] for x in items), 2)
    total_count = sum(x["count"] for x in items)
    return {
        "from": date_from,
        "to": date_to,
        "items": items,
        "grand_total": grand_total,
        "total_count": total_count,
    }


# ==================== ANALISI MAGAZZINO ====================

@router.get("/analisi/magazzino")
async def analisi_magazzino(
    date_from: str,
    date_to: str,
    token_data: dict = Depends(verify_token),
):
    """
    Analisi movimenti magazzino in un range di date.
    date_from/date_to in formato YYYY-MM-DD (inclusivi).
    Ritorna per ogni prodotto con almeno un movimento:
      - incoming: unità entrate (dai carichi)
      - outgoing: dict {location: unità uscite}  (richieste evase)
    """
    if token_data.get("role") not in ("magazzino", "admin"):
        raise HTTPException(status_code=403, detail="Solo magazziniere/admin")

    # ISO range strings. Stored created_at/evasa_at have format
    # "YYYY-MM-DDTHH:MM:SS.ffffff+00:00" (UTC). The user picks Rome-local days,
    # so we need to convert the Rome-local midnight boundaries to UTC ISO
    # strings before doing the lexicographic comparison. Without this, every
    # carico/richiesta done in the first ~2 hours of a Rome day was mis-
    # attributed to the previous day (and viceversa).
    try:
        dt_from_rome = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
        dt_to_rome = datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=ROME_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato data non valido (attendo YYYY-MM-DD)")
    if dt_to_rome < dt_from_rome:
        raise HTTPException(status_code=400, detail="La data finale deve essere >= data iniziale")
    # [Rome midnight of date_from, Rome midnight of date_to + 1 day) in UTC ISO
    from_iso = dt_from_rome.astimezone(timezone.utc).isoformat()
    to_iso_excl = (dt_to_rome + timedelta(days=1)).astimezone(timezone.utc).isoformat()

    # Active restaurant locations (columns)
    restaurants = await db.restaurants.find(
        {"role": "restaurant"}, {"_id": 0, "location": 1}
    ).to_list(20)
    locations = [r["location"] for r in restaurants if r.get("location")]

    # Incoming: from carichi_magazzino
    incoming_agg = await db.carichi_magazzino.aggregate([
        {"$match": {"created_at": {"$gte": from_iso, "$lt": to_iso_excl}}},
        {"$unwind": "$items"},
        {"$group": {
            "_id": "$items.product_id",
            "total": {"$sum": "$items.quantity_added"},
        }},
    ]).to_list(5000)
    incoming_map = {r["_id"]: int(r["total"]) for r in incoming_agg}

    # New warehouse waste is stored in the stock ledger with a negative delta.
    waste_agg = await db.stock_movements.aggregate([
        {"$match": {
            "cause": "scarto_admin",
            "delta": {"$lt": 0},
            "timestamp": {"$gte": from_iso, "$lt": to_iso_excl},
        }},
        {"$group": {
            "_id": "$product_id",
            "total": {"$sum": {"$multiply": ["$delta", -1]}},
        }},
    ]).to_list(5000)
    waste_map = {r["_id"]: int(r["total"]) for r in waste_agg}

    # Outgoing: from richieste — attribuite al giorno di CREAZIONE della
    # richiesta (non più al giorno di evasione). Una richiesta entra nel
    # report solo dopo che è passata 1 ora dalla sua creazione (grace
    # period: entro l'ora i locali possono ancora modificarla — di fatto
    # la finestra di modifica è 20 min, ma teniamo 1h come margine pieno).
    # Stato: qualunque, perché le richieste cancellate vengono `delete_one`
    # in DB → spariscono automaticamente da qui.
    grace_cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    outgoing_agg = await db.richieste.aggregate([
        {"$match": {
            "created_at": {
                "$gte": from_iso,
                "$lt": to_iso_excl,
                "$lte": grace_cutoff_iso,
            },
        }},
        {"$unwind": "$items"},
        {"$group": {
            "_id": {
                "product_id": "$items.product_id",
                "location": "$restaurant_location",
            },
            "total": {"$sum": "$items.quantity"},
        }},
    ]).to_list(10000)

    outgoing_map: Dict[str, Dict[str, int]] = {}
    for r in outgoing_agg:
        pid = r["_id"]["product_id"]
        loc = r["_id"]["location"] or ""
        outgoing_map.setdefault(pid, {})[loc] = int(r["total"])

    # Union of product_ids with activity
    active_ids = set(incoming_map.keys()) | set(outgoing_map.keys()) | set(waste_map.keys())

    # Fetch ALL products (with or without activity in this range).
    # NB: il frontend mostra tutto, righe senza movimenti = totali a zero.
    products = await db.products.find({}, {"_id": 0}).sort("name", 1).to_list(5000)

    result_products = []
    for p in products:
        pid = p["id"]
        image_url = ""
        if p.get("image_file"):
            image_url = build_upload_url(p["image_file"])
        elif p.get("image_data", "").startswith("data:"):
            image_url = p["image_data"]

        out = outgoing_map.get(pid, {})
        result_products.append({
            "product_id": pid,
            "name": p.get("name", ""),
            "unit": p.get("unit", ""),
            "supplier": p.get("supplier", ""),
            "image_url": image_url,
            "incoming": incoming_map.get(pid, 0),
            "outgoing": {loc: out.get(loc, 0) for loc in locations},
            "outgoing_total": sum(out.values()),
            "waste": waste_map.get(pid, 0),
            "has_activity": pid in active_ids,
        })

    return {
        "date_from": date_from,
        "date_to": date_to,
        "locations": locations,
        "products": result_products,
    }
