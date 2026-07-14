import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import UPLOADS_DIR
from app.core.database import db
from app.core.files import save_image_to_disk
from app.core.security import verify_token
from app.core.time import _today_rome_utc_range
from app.schemas import (
    ChiusuraCreate,
    ChiusuraPiattiUpload,
    FatturaGlobaleCreate,
    VersamentoCreate,
)


router = APIRouter()

__all__ = [
    "create_versamento",
    "get_versamenti",
    "delete_versamento",
    "create_chiusura",
    "get_chiusure",
    "delete_chiusura",
    "upload_chiusura_piatti",
    "delete_chiusura_piatti",
    "create_fattura_globale",
    "list_fatture_globali",
    "list_all_ddt",
    "list_locale_invoices_by_supplier",
    "link_invoice_to_global",
    "unlink_invoice_from_global",
    "mark_global_paid",
    "delete_fattura_globale",
]


# ==================== VERSAMENTI (DEPOSITS) ====================

@router.post("/versamenti")
async def create_versamento(data: VersamentoCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]

    # Check for duplicate control code within today if provided
    if data.control_code:
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.versamenti.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")

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

@router.get("/versamenti")
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

@router.delete("/versamenti/{versamento_id}")
async def delete_versamento(versamento_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": versamento_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.versamenti.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Versamento non trovato")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    await db.versamenti.delete_one({"id": versamento_id})
    return {"message": "Versamento eliminato"}

# ==================== CHIUSURE (CLOSURES) ====================

@router.post("/chiusure")
async def create_chiusura(data: ChiusuraCreate, token_data: dict = Depends(verify_token)):
    restaurant_id = token_data["restaurant_id"]
    restaurant_name = token_data["restaurant_name"]

    # Check for duplicate control code within today if provided
    if data.control_code:
        start_utc, end_utc = _today_rome_utc_range()
        existing = await db.chiusure.find_one({
            "restaurant_id": restaurant_id,
            "control_code": data.control_code,
            "created_at": {"$gte": start_utc, "$lte": end_utc}
        })
        if existing:
            raise HTTPException(status_code=400, detail="Codice di controllo già usato oggi")

    chiusura_id = str(uuid.uuid4())

    # Save images to disk
    image_filename = save_image_to_disk(data.image_data, "chiusura")
    piatti_filename = save_image_to_disk(data.piatti_data, "chiusura_piatti") if data.piatti_data else ""

    chiusura = {
        "id": chiusura_id,
        "restaurant_id": restaurant_id,
        "description": data.description,
        "tipologia": data.tipologia,
        "control_code": data.control_code,
        "image_file": image_filename,
        "piatti_file": piatti_filename,
        "chiusura_date": data.chiusura_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": restaurant_name
    }

    await db.chiusure.insert_one(chiusura)

    return {
        "id": chiusura_id,
        "message": "Chiusura caricata con successo"
    }

@router.get("/chiusure")
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
        piatti = c.pop("piatti_file", None)
        c["piatti_url"] = f"/api/uploads/{piatti}" if piatti else ""

    return chiusure

@router.delete("/chiusure/{chiusura_id}")
async def delete_chiusura(chiusura_id: str, token_data: dict = Depends(verify_token)):
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    if not is_admin:
        try:
            created = datetime.fromisoformat(doc["created_at"].replace('Z', '+00:00'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.now(timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=20):
            raise HTTPException(status_code=403, detail="Puoi cancellare solo entro 20 minuti dal caricamento. Solo l'Admin può cancellare in qualsiasi momento.")
    # Remove associated images from disk
    for key in ("image_file", "piatti_file"):
        fn = doc.get(key)
        if fn:
            p = UPLOADS_DIR / fn
            if p.exists():
                p.unlink()
    await db.chiusure.delete_one({"id": chiusura_id})
    return {"message": "Chiusura eliminata"}


@router.put("/chiusure/{chiusura_id}/piatti")
async def upload_chiusura_piatti(chiusura_id: str, data: ChiusuraPiattiUpload, token_data: dict = Depends(verify_token)):
    """Attach/replace the 'piatti' photo for a given chiusura."""
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    if not data.piatti_data:
        raise HTTPException(status_code=400, detail="Immagine piatti mancante")
    old = doc.get("piatti_file")
    if old:
        p = UPLOADS_DIR / old
        if p.exists():
            p.unlink()
    filename = save_image_to_disk(data.piatti_data, "chiusura_piatti")
    await db.chiusure.update_one(
        {"id": chiusura_id},
        {"$set": {"piatti_file": filename}}
    )
    return {"piatti_url": f"/api/uploads/{filename}"}


@router.delete("/chiusure/{chiusura_id}/piatti")
async def delete_chiusura_piatti(chiusura_id: str, token_data: dict = Depends(verify_token)):
    """Remove the 'piatti' photo from a chiusura."""
    is_admin = token_data.get("role") == "admin"
    query = {"id": chiusura_id}
    if not is_admin:
        query["restaurant_id"] = token_data["restaurant_id"]
    doc = await db.chiusure.find_one(query)
    if not doc:
        raise HTTPException(status_code=404, detail="Chiusura non trovata")
    old = doc.get("piatti_file")
    if old:
        p = UPLOADS_DIR / old
        if p.exists():
            p.unlink()
    await db.chiusure.update_one({"id": chiusura_id}, {"$unset": {"piatti_file": ""}})
    return {"message": "Foto piatti rimossa"}


# ==================== FATTURE GLOBALI (Admin only) ====================
# Schema fattura_globale (collezione `fatture_globali`):
#   id, supplier, importo (LEGACY), ddt_numbers (string), image_file, invoice_date,
#   created_at, uploaded_by, paid (bool), paid_at (ISO or None),
#   linked_invoice_ids: [string]   # ID delle invoices (DDT) dei locali abbinate
# Match per NUMERO DDT (non più per importo):
#   - paid=true → ORO
#   - tutti i numeri DDT dichiarati sono linkati e nessun linked è "extra" → VERDE
#   - ci sono linked ma non coincidono con i declared → ROSSO
#   - 0 link → BLU

def _normalize_ddt_number(s: str) -> str:
    """Normalizza il numero DDT per il confronto: lowercase + rimuove spazi."""
    if not s:
        return ""
    return "".join(str(s).split()).lower()


def _parse_ddt_numbers(text: str) -> list:
    """Parsa stringa tipo '12345, 67/abc , 999' → lista di numeri normalizzati,
    preservando però il valore originale (trimmato) per la visualizzazione.
    Ritorna lista di dict {raw, norm}."""
    if not text:
        return []
    parts = [p.strip() for p in str(text).split(",")]
    out = []
    seen = set()
    for p in parts:
        if not p:
            continue
        norm = _normalize_ddt_number(p)
        if norm in seen:
            continue
        seen.add(norm)
        out.append({"raw": p, "norm": norm})
    return out


async def _enrich_global_invoice(doc: dict) -> dict:
    """Aggiunge URL immagini, dettagli invoices linkate e stato match per numero DDT."""
    base_url = "/api/uploads/"
    linked_ids = doc.get("linked_invoice_ids") or []
    linked_docs = []
    linked_norms = set()
    if linked_ids:
        cursor = db.invoices.find({"id": {"$in": linked_ids}}, {"_id": 0})
        async for inv in cursor:
            ddt_n = (inv.get("ddt_number") or "").strip()
            linked_norms.add(_normalize_ddt_number(ddt_n))
            linked_docs.append({
                "id": inv.get("id"),
                "supplier": inv.get("supplier") or "",
                "importo": float(inv.get("importo") or 0),
                "ddt_number": ddt_n,
                "image_url": base_url + inv["image_file"] if inv.get("image_file") else "",
                "uploaded_by": inv.get("uploaded_by") or "",
                "created_at": inv.get("created_at"),
                "restaurant_id": inv.get("restaurant_id"),
            })

    declared = _parse_ddt_numbers(doc.get("ddt_numbers") or "")
    declared_norms = {d["norm"] for d in declared}
    missing = [d["raw"] for d in declared if d["norm"] not in linked_norms]
    extra = [n for n in linked_norms if n not in declared_norms and n != ""]

    return {
        "id": doc.get("id"),
        "supplier": doc.get("supplier") or "",
        "importo": float(doc.get("importo") or 0),  # legacy
        "ddt_numbers": doc.get("ddt_numbers") or "",
        "declared_ddt": [d["raw"] for d in declared],
        "missing_ddt": missing,
        "extra_ddt_count": len(extra),
        "image_url": base_url + doc["image_file"] if doc.get("image_file") else "",
        "invoice_date": doc.get("invoice_date"),
        "created_at": doc.get("created_at"),
        "uploaded_by": doc.get("uploaded_by") or "",
        "paid": bool(doc.get("paid", False)),
        "paid_at": doc.get("paid_at"),
        "linked_invoices": linked_docs,
    }


def _require_admin(token_data: dict):
    if token_data.get("role") not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="Solo admin")


@router.post("/admin/fatture-globali")
async def create_fattura_globale(
    data: FatturaGlobaleCreate,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    if not data.supplier.strip():
        raise HTTPException(status_code=400, detail="Fornitore obbligatorio")
    if not (data.ddt_numbers or "").strip():
        raise HTTPException(status_code=400, detail="Inserisci almeno un numero DDT")
    if not data.image_data:
        raise HTTPException(status_code=400, detail="Foto fattura obbligatoria")
    image_filename = save_image_to_disk(data.image_data, "fattura_globale")
    declared = _parse_ddt_numbers(data.ddt_numbers)
    declared_norms = [d["norm"] for d in declared]

    # Auto-link: cerca tra le invoices del fornitore quelli con ddt_number che
    # combacia (normalizzato). Esclude quelli già linkati ad ALTRE globali.
    auto_link_ids = []
    if declared_norms:
        candidates = db.invoices.find({
            "supplier": data.supplier.strip(),
            "ddt_number": {"$nin": ["", None]},
        }, {"_id": 0, "id": 1, "ddt_number": 1})
        # Set di invoice_id già linkate altrove
        linked_elsewhere = set()
        async for fg in db.fatture_globali.find({}, {"linked_invoice_ids": 1}):
            for x in (fg.get("linked_invoice_ids") or []):
                linked_elsewhere.add(x)
        async for inv in candidates:
            n = _normalize_ddt_number(inv.get("ddt_number") or "")
            if n and n in declared_norms and inv["id"] not in linked_elsewhere:
                auto_link_ids.append(inv["id"])

    doc = {
        "id": str(uuid.uuid4()),
        "supplier": data.supplier.strip(),
        "importo": float(data.importo or 0),
        "ddt_numbers": data.ddt_numbers.strip(),
        "image_file": image_filename,
        "invoice_date": data.invoice_date or datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": token_data.get("restaurant_name") or "admin",
        "paid": False,
        "paid_at": None,
        "linked_invoice_ids": auto_link_ids,
    }
    await db.fatture_globali.insert_one(doc)
    return await _enrich_global_invoice(doc)


@router.get("/admin/fatture-globali")
async def list_fatture_globali(token_data: dict = Depends(verify_token)):
    _require_admin(token_data)
    # Filtro legacy: mostriamo solo le fatture globali nuove (con ddt_numbers).
    # Le vecchie (solo importo, senza ddt_numbers) restano in DB ma non vengono mostrate.
    docs = await db.fatture_globali.find(
        {"ddt_numbers": {"$nin": ["", None]}},
        {"_id": 0},
    ).sort([("paid", 1), ("created_at", -1)]).to_list(1000)
    return [await _enrich_global_invoice(d) for d in docs]


@router.get("/admin/ddt-list")
async def list_all_ddt(token_data: dict = Depends(verify_token)):
    """Ritorna TUTTI i DDT (invoices) dei locali con ddt_number valorizzato,
    ordinati per fornitore e poi per data desc. Include flag `already_linked`
    per indicare se sono già abbinati a una fattura globale."""
    _require_admin(token_data)
    docs = await db.invoices.find(
        {"ddt_number": {"$nin": ["", None]}},
        {"_id": 0},
    ).sort([("supplier", 1), ("created_at", -1)]).to_list(5000)

    linked_to_globals = set()
    async for fg in db.fatture_globali.find({}, {"linked_invoice_ids": 1}):
        for x in (fg.get("linked_invoice_ids") or []):
            linked_to_globals.add(x)

    out = []
    for d in docs:
        out.append({
            "id": d.get("id"),
            "supplier": d.get("supplier") or "",
            "ddt_number": d.get("ddt_number") or "",
            "image_url": ("/api/uploads/" + d["image_file"]) if d.get("image_file") else "",
            "uploaded_by": d.get("uploaded_by") or "",
            "created_at": d.get("created_at"),
            "invoice_date": d.get("invoice_date"),
            "restaurant_id": d.get("restaurant_id"),
            "already_linked": d.get("id") in linked_to_globals,
            "paid": bool(d.get("paid", False)),
        })
    return out


@router.get("/admin/fatture-locali-by-supplier")
async def list_locale_invoices_by_supplier(
    supplier: str,
    token_data: dict = Depends(verify_token),
):
    """Ritorna i DDT dei locali per un fornitore specifico (vista di compatibilità).
    Mostra solo DDT con `ddt_number` valorizzato (i vecchi sono nascosti dalla pagina admin)."""
    _require_admin(token_data)
    if not supplier or not supplier.strip():
        return []
    docs = await db.invoices.find(
        {"supplier": supplier.strip(), "ddt_number": {"$nin": ["", None]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    linked_to_others = set()
    async for fg in db.fatture_globali.find({"supplier": supplier.strip()}, {"linked_invoice_ids": 1}):
        for x in (fg.get("linked_invoice_ids") or []):
            linked_to_others.add(x)
    out = []
    for d in docs:
        out.append({
            "id": d.get("id"),
            "supplier": d.get("supplier") or "",
            "importo": float(d.get("importo") or 0),
            "ddt_number": d.get("ddt_number") or "",
            "image_url": ("/api/uploads/" + d["image_file"]) if d.get("image_file") else "",
            "uploaded_by": d.get("uploaded_by") or "",
            "created_at": d.get("created_at"),
            "restaurant_id": d.get("restaurant_id"),
            "already_linked": d.get("id") in linked_to_others,
        })
    return out


@router.post("/admin/fatture-globali/{fg_id}/link/{invoice_id}")
async def link_invoice_to_global(
    fg_id: str,
    invoice_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    fg = await db.fatture_globali.find_one({"id": fg_id})
    if not fg:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Fattura locale non trovata")
    # Evita link duplicati (anche su altre globali)
    already = await db.fatture_globali.find_one({"linked_invoice_ids": invoice_id})
    if already and already.get("id") != fg_id:
        raise HTTPException(status_code=400, detail="Questa fattura locale è già abbinata a un'altra fattura globale")
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$addToSet": {"linked_invoice_ids": invoice_id}},
    )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    return await _enrich_global_invoice(new_doc)


@router.delete("/admin/fatture-globali/{fg_id}/link/{invoice_id}")
async def unlink_invoice_from_global(
    fg_id: str,
    invoice_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$pull": {"linked_invoice_ids": invoice_id}},
    )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    if not new_doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    return await _enrich_global_invoice(new_doc)


@router.post("/admin/fatture-globali/{fg_id}/pay")
async def mark_global_paid(
    fg_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    doc = await db.fatture_globali.find_one({"id": fg_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    enriched = await _enrich_global_invoice(doc)
    # Check match per numero DDT: tutti i numeri dichiarati devono essere coperti
    # dai DDT linkati (no missing) e niente DDT linkati "extra" (non dichiarati).
    if enriched.get("missing_ddt"):
        raise HTTPException(
            status_code=400,
            detail=f"DDT mancanti: {', '.join(enriched['missing_ddt'])}",
        )
    if enriched.get("extra_ddt_count", 0) > 0:
        raise HTTPException(
            status_code=400,
            detail="Ci sono DDT abbinati che non sono dichiarati nella fattura",
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.fatture_globali.update_one(
        {"id": fg_id},
        {"$set": {"paid": True, "paid_at": now_iso}},
    )
    # Propaga il pagamento a TUTTE le fatture locali (DDT) abbinate:
    # diventano automaticamente "PAGATO" lato pagina DDT dei vari locali.
    linked_ids = doc.get("linked_invoice_ids") or []
    if linked_ids:
        await db.invoices.update_many(
            {"id": {"$in": linked_ids}},
            {"$set": {"paid": True, "paid_at": now_iso, "paid_via_global_id": fg_id}},
        )
    new_doc = await db.fatture_globali.find_one({"id": fg_id}, {"_id": 0})
    return await _enrich_global_invoice(new_doc)


@router.delete("/admin/fatture-globali/{fg_id}")
async def delete_fattura_globale(
    fg_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_admin(token_data)
    doc = await db.fatture_globali.find_one({"id": fg_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Fattura globale non trovata")
    img = doc.get("image_file")
    if img:
        p = UPLOADS_DIR / img
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    await db.fatture_globali.delete_one({"id": fg_id})
    return {"message": "Fattura globale eliminata"}
