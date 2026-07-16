import logging
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.catalogs import BEVERAGES_CATALOG
from app.core.database import db
from app.core.deps import _effective_restaurant_id
from app.core.security import (
    can_impersonate,
    require_admin_or_federico,
    verify_token,
)
from app.core.time import ROME_TZ, _today_rome_str
from app.schemas import BeverageDailyUpsert, CashDailyUpsert, PastaDictionaryUpsert
from app.services.report import (
    ALL_CASH_FIELDS,
    CASSETTO_FIELDS,
    PASTA_PRICES_MAP,
    _audit_diff_cash,
    _audit_log_change,
    _audit_user_info,
    _beverage_mattina_carry_fields,
    _build_closure_detail,
    _cash_cassetto_carry_fields,
    _cash_mattina_carry_fields,
    _compute_cash_sera,
    _compute_cash_sera_full,
    _compute_paste_count,
    _compute_paste_total_eur,
    _compute_spicci_total,
    _eval_cash_value,
    _get_pasta_dict_for,
    _normalize_audit_user_label,
    _orders_aggregate_for_date,
    _payload_fields,
    _resolve_historical_mode,
    _should_create_pasta_dict_snapshot,
    _pasta_dict_snapshot_fields,
)


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/beverages/daily")
async def get_beverage_daily_counts(
    request: Request,
    date: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Returns today's counts for the current restaurant + previous-day sera values.

    Modalità storica (Admin/Supervisor): se `date` + `restaurant_id` sono
    presenti, restituisce i counts di QUEL giorno per QUEL locale.
    """
    historical = _resolve_historical_mode(date, restaurant_id, token_data, allow_self=True)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()

    today_docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ).to_list(50)
    today_by_sigla = {d["sigla"]: d for d in today_docs}
    counts = {d["sigla"]: {
        "mattina": d.get("mattina", ""),
        "inUsc": d.get("inUsc", ""),
        "scarti": d.get("scarti", ""),
        "sera": d.get("sera", ""),
        "mattina_casse": d.get("mattina_casse", ""),
        "mattina_sfuse": d.get("mattina_sfuse", ""),
        "inUsc_casse": d.get("inUsc_casse", ""),
        "sera_casse": d.get("sera_casse", ""),
        "sera_sfuse": d.get("sera_sfuse", ""),
        "comments": d.get("comments") or {},
        "revision": d.get("updated_at", "") or "",
    } for d in today_docs}

    prev_sera = {}
    last_day_doc = await db.beverage_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0, "date_rome": 1},
    )
    if last_day_doc:
        prev_date = last_day_doc["date_rome"]
        prev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": prev_date},
            {"_id": 0, "date_rome": 1, "sigla": 1, "sera": 1},
        ).to_list(50)
        prev_sera = {d["sigla"]: d.get("sera", "") for d in prev_docs}

    if not historical and prev_sera:
        now_iso = datetime.now(timezone.utc).isoformat()
        valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
        for prev_doc in prev_docs:
            sigla = prev_doc.get("sigla")
            if sigla not in valid_siglas:
                continue
            current_doc = today_by_sigla.get(sigla) or {}
            current = counts.get(sigla) or {}
            carry_fields = await _beverage_mattina_carry_fields(
                rid=rid,
                target_date=target_date,
                sigla=sigla,
                today_row=current_doc,
                prev_row=prev_doc,
            )
            if not carry_fields:
                continue
            update_fields = {
                **carry_fields,
                "restaurant_id": rid,
                "date_rome": target_date,
                "sigla": sigla,
                "updated_at": now_iso,
            }
            if not current:
                update_fields.update({
                    "inUsc": "",
                    "scarti": "",
                    "sera": "",
                    "inUsc_casse": "",
                    "sera_casse": "",
                    "sera_sfuse": "",
                    "comments": {},
                })
            await db.beverage_daily_counts.update_one(
                {"restaurant_id": rid, "date_rome": target_date, "sigla": sigla},
                {"$set": update_fields},
                upsert=True,
            )
            counts[sigla] = {
                **current,
                "mattina": carry_fields["mattina"],
                "mattina_casse": carry_fields["mattina_casse"],
                "mattina_sfuse": carry_fields["mattina_sfuse"],
                "inUsc": current.get("inUsc", ""),
                "scarti": current.get("scarti", ""),
                "sera": current.get("sera", ""),
                "inUsc_casse": current.get("inUsc_casse", ""),
                "sera_casse": current.get("sera_casse", ""),
                "sera_sfuse": current.get("sera_sfuse", ""),
                "comments": current.get("comments") or {},
                "revision": now_iso,
            }

    return {"date": target_date, "counts": counts, "prev_sera": prev_sera, "historical": bool(historical)}


@router.put("/beverages/daily")
async def upsert_beverage_daily(
    data: BeverageDailyUpsert, request: Request, token_data: dict = Depends(verify_token)
):
    """Upsert a single beverage row for today's counts (auto-save from frontend).
    Modalità storica: se `data.date` + `data.restaurant_id` sono presenti
    (e l'utente è admin/supervisor), salva per quel giorno+locale."""
    historical = _resolve_historical_mode(data.date, data.restaurant_id, token_data)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    valid_siglas = {b["sigla"] for b in BEVERAGES_CATALOG}
    if data.sigla not in valid_siglas:
        raise HTTPException(status_code=400, detail=f"Sigla non valida: {data.sigla}")

    old_doc = await db.beverage_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date, "sigla": data.sigla}, {"_id": 0}
    ) or {}
    sent_fields = _payload_fields(data)
    now_iso = datetime.now(timezone.utc).isoformat()
    set_body = {
        "restaurant_id": rid,
        "date_rome": target_date,
        "sigla": data.sigla,
        "updated_at": now_iso,
    }
    for k in ("mattina", "inUsc", "scarti", "sera", "mattina_casse", "mattina_sfuse", "inUsc_casse", "sera_casse", "sera_sfuse"):
        if k in sent_fields:
            set_body[k] = getattr(data, k) or ""
    # Sanitize commenti (max 500 char per chiave, scarto chiavi non-valide)
    if "comments" in sent_fields and data.comments is not None:
        clean: Dict[str, str] = {}
        for k in ("inUsc", "scarti"):
            v = data.comments.get(k)
            if isinstance(v, str) and v.strip():
                clean[k] = v.strip()[:500]
        set_body["comments"] = clean
    # Sicurezza: i campi MATTINA (mattina + mattina_casse + mattina_sfuse) della
    # bevanda — coperti dal toggle "Forza Magazzino Mattina" — possono essere
    # modificati SOLO da admin/Federico. Per gli altri utenti preserviamo il
    # valore esistente nel DB ignorando ciò che è stato inviato.
    if not can_impersonate(token_data):
        for k in ("mattina", "mattina_casse", "mattina_sfuse"):
            if k in set_body:
                set_body[k] = old_doc.get(k, "")
    elif any(k in set_body for k in ("mattina", "mattina_casse", "mattina_sfuse")):
        set_body["mattina_auto_carry"] = False
        set_body["mattina_carry_from_date"] = ""
        set_body["mattina_carry_value"] = ""
    try:
        ui = _audit_user_info(request, token_data)
        if historical:
            ui = {**ui, "mode": "historical"}
        for col in ("mattina", "inUsc", "scarti", "sera"):
            if col not in set_body:
                continue
            await _audit_log_change(
                category="beverage", rid=rid, date_rome=target_date,
                field=f"{data.sigla}.{col}",
                old_value=old_doc.get(col, ""), new_value=set_body.get(col, ""),
                user_info=ui,
            )
        if "comments" in set_body:
            old_c = old_doc.get("comments") or {}
            new_c = set_body.get("comments") or {}
            for k in set(old_c.keys()) | set(new_c.keys()):
                await _audit_log_change(
                    category="beverage", rid=rid, date_rome=target_date,
                    field=f"{data.sigla}.comment.{k}",
                    old_value=old_c.get(k, ""), new_value=new_c.get(k, ""),
                    user_info=ui,
                )
    except Exception as e:
        logger.warning(f"[AUDIT] beverage diff failed (non-blocking): {e}")
    await db.beverage_daily_counts.update_one(
        {"restaurant_id": rid, "date_rome": target_date, "sigla": data.sigla},
        {"$set": set_body},
        upsert=True,
    )
    return {"ok": True, "historical": bool(historical), "revision": now_iso}


@router.get("/beverages/daily/history")
async def get_beverage_daily_history(
    request: Request, days: int = 60, token_data: dict = Depends(verify_token)
):
    """Returns the last N days of beverage daily counts grouped by date."""
    rid = await _effective_restaurant_id(request, token_data)
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=max(1, min(days, 365)))).strftime("%Y-%m-%d")
    docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": {"$gte": cutoff}},
        {"_id": 0},
    ).sort("date_rome", -1).to_list(2000)
    grouped: dict = {}
    for d in docs:
        grouped.setdefault(d["date_rome"], []).append(d)
    return {
        "days": [
            {"date": date, "rows": rows}
            for date, rows in sorted(grouped.items(), reverse=True)
        ]
    }


@router.get("/cash/daily")
async def get_cash_daily(
    request: Request,
    date: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Returns today's cash row for the current restaurant + previous-day computed cash_sera
    so the frontend can auto-fill CASH MATTINA when starting a new day.

    Modalità storica (Admin/Supervisor): se `date` + `restaurant_id` sono
    presenti, ritorna i dati di QUEL giorno per QUEL locale.
    """
    historical = _resolve_historical_mode(date, restaurant_id, token_data, allow_self=True)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    today_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ) or {}
    data = {f: today_doc.get(f, "") for f in ALL_CASH_FIELDS}
    vers_color = today_doc.get("vers_color", "") or ""
    comments = today_doc.get("comments") or {}
    paste_text = today_doc.get("paste_text", "") or ""
    paste_manual_override = bool(today_doc.get("paste_manual_override", False))
    cash_banconote = today_doc.get("cash_banconote") or {}
    manual_prices = today_doc.get("manual_prices") or {}
    revision = today_doc.get("updated_at", "") or ""

    prev_cash_sera = ""
    prev_row = None
    prev_date = ""
    last_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": {"$lt": target_date}},
        sort=[("date_rome", -1)],
        projection={"_id": 0},
    )
    if last_doc:
        # IMPORTANTE: il "cash sera" del giorno prima deve includere paste, bevande e
        # spicci (stessa formula del frontend), altrimenti la mattina del giorno dopo
        # sarebbe più bassa del cassetto reale. Recupero le bevande dello stesso
        # giorno per il calcolo completo.
        prev_bev_docs = await db.beverage_daily_counts.find(
            {"restaurant_id": rid, "date_rome": last_doc["date_rome"]},
            {"_id": 0},
        ).to_list(100)
        dmap = await _get_pasta_dict_for(rid)
        prev_cash_sera = round(_compute_cash_sera_full(last_doc, prev_bev_docs, dmap), 2)
        # Riga di ieri completa (per la vista read-only nel Report)
        prev_date = last_doc.get("date_rome", "")
        prev_row = {f: last_doc.get(f, "") for f in ALL_CASH_FIELDS}
        prev_row["paste_text"] = last_doc.get("paste_text", "") or ""
        # Day opening: materialize the carry-over on the server so the new
        # report day is stable even before the frontend autosave runs.
        if not historical:
            carry_fields = {}
            carry_fields.update(await _cash_mattina_carry_fields(
                rid=rid,
                target_date=target_date,
                today_cash=today_doc,
                last_cash=last_doc,
                prev_bev_docs=prev_bev_docs,
                dict_map=dmap,
            ))
            carry_fields.update(await _cash_cassetto_carry_fields(
                rid=rid,
                target_date=target_date,
                today_cash=today_doc,
                last_cash=last_doc,
            ))
            if carry_fields:
                carry_fields.update({
                    "restaurant_id": rid,
                    "date_rome": target_date,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                await db.cash_daily_counts.update_one(
                    {"restaurant_id": rid, "date_rome": target_date},
                    {"$set": carry_fields},
                    upsert=True,
                )
                for k, v in carry_fields.items():
                    if k in data:
                        data[k] = v
                revision = carry_fields["updated_at"]
    return {
        "date": target_date,
        "data": data,
        "prev_cash_sera": prev_cash_sera,
        "prev_date": prev_date,
        "prev_row": prev_row,
        "comments": comments,
        "vers_color": vers_color,
        "paste_text": paste_text,
        "paste_manual_override": paste_manual_override,
        "cash_banconote": cash_banconote,
        "manual_prices": manual_prices,
        "historical": bool(historical),
        "revision": revision,
    }


@router.put("/cash/daily")
async def upsert_cash_daily(
    data: CashDailyUpsert, request: Request, token_data: dict = Depends(verify_token)
):
    """Upsert today's cash row (auto-save dal frontend) per il ristorante effettivo.
    Modalità storica: se `data.date` + `data.restaurant_id` sono presenti
    (e admin/supervisor), salva per quel giorno+locale."""
    historical = _resolve_historical_mode(data.date, data.restaurant_id, token_data)
    if historical:
        target_date, rid = historical
    else:
        rid = await _effective_restaurant_id(request, token_data)
        target_date = _today_rome_str()
    old_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": target_date}, {"_id": 0}
    ) or {}
    sent_fields = _payload_fields(data)
    now_iso = datetime.now(timezone.utc).isoformat()
    set_payload = {
        "restaurant_id": rid,
        "date_rome": target_date,
        "updated_at": now_iso,
    }
    for f in ALL_CASH_FIELDS:
        if f in sent_fields:
            set_payload[f] = getattr(data, f) or ""
    # vers_color: solo valori validi
    allowed_colors = {"", "black", "red", "green", "blue", "orange"}
    if "vers_color" in sent_fields and data.vers_color is not None and data.vers_color in allowed_colors:
        set_payload["vers_color"] = data.vers_color
    # Paste text (multiline area Report)
    if "paste_text" in sent_fields and data.paste_text is not None:
        set_payload["paste_text"] = str(data.paste_text)[:50000]
    if "paste_manual_override" in sent_fields and data.paste_manual_override is not None:
        set_payload["paste_manual_override"] = bool(data.paste_manual_override)
    # Cassa banconote (input pezzi/€)
    if "cash_banconote" in sent_fields and data.cash_banconote is not None:
        clean_b = {str(k)[:20]: str(v)[:50] for k, v in (data.cash_banconote or {}).items() if isinstance(k, str)}
        set_payload["cash_banconote"] = clean_b
    # Prezzi manuali per le paste non riconosciute (idx → prezzo)
    if "manual_prices" in sent_fields and data.manual_prices is not None:
        clean_p = {str(k)[:200]: str(v)[:50] for k, v in (data.manual_prices or {}).items() if isinstance(k, (str, int))}
        set_payload["manual_prices"] = clean_p
    # Sanitize commenti: solo str→str, max 500 char, scarto chiavi/valori vuoti
    if "comments" in sent_fields and data.comments is not None:
        clean: Dict[str, str] = {}
        for k, v in data.comments.items():
            if not isinstance(k, str) or not isinstance(v, str):
                continue
            t = v.strip()
            if t:
                clean[k[:50]] = t[:500]
        set_payload["comments"] = clean
    # Lo snapshot del dizionario è storico: si crea una sola volta durante il
    # giorno operativo e non viene sostituito da normali correzioni successive.
    # Le modifiche storiche Admin restano quindi incapaci di applicare in modo
    # silenzioso il listino corrente a una giornata passata.
    if _should_create_pasta_dict_snapshot(
        historical=bool(historical),
        existing_snapshot=old_doc.get("pasta_dict_snapshot"),
    ):
        set_payload.update(_pasta_dict_snapshot_fields(
            await _get_pasta_dict_for(rid),
            source="live_report",
            captured_at=now_iso,
        ))
    # Sicurezza: il campo `mattina` (CASH MATTINA "Forza Mattina") può essere
    # modificato SOLO da admin/Federico. Per gli altri utenti preserviamo il
    # valore esistente nel DB ignorando ciò che è stato inviato lato client.
    if not can_impersonate(token_data) and "mattina" in set_payload:
        set_payload["mattina"] = old_doc.get("mattina", "")
    elif can_impersonate(token_data) and "mattina" in set_payload:
        set_payload["mattina_auto_carry"] = False
        set_payload["mattina_carry_from_date"] = ""
        set_payload["mattina_carry_value"] = ""
    if can_impersonate(token_data):
        for cf in CASSETTO_FIELDS:
            if cf in set_payload:
                set_payload[f"{cf}_auto_carry"] = False
                set_payload[f"{cf}_carry_from_date"] = ""
                set_payload[f"{cf}_carry_value"] = ""
    try:
        ui = _audit_user_info(request, token_data)
        if historical:
            ui = {**ui, "mode": "historical"}
        await _audit_diff_cash(
            rid=rid, date_rome=target_date, old_doc=old_doc, set_payload=set_payload,
            user_info=ui,
        )
    except Exception as e:
        logger.warning(f"[AUDIT] cash diff failed (non-blocking): {e}")
    await db.cash_daily_counts.update_one(
        {"restaurant_id": rid, "date_rome": target_date},
        {"$set": set_payload},
        upsert=True,
    )
    return {"ok": True, "historical": bool(historical), "revision": now_iso}


@router.get("/admin/closures")
async def list_closures(
    days: int = 60,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Lista delle chiusure (date) con riepilogo: incasso, # paste, # bevande, ecc.
    Filtra per `restaurant_id` se fornito (richiesto per la vista per-locale).
    """
    require_admin_or_federico(token_data)
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=max(1, min(days, 365)))).strftime("%Y-%m-%d")
    today = _today_rome_str()
    base_q = {"date_rome": {"$gte": cutoff, "$lt": today}}
    if restaurant_id:
        base_q["restaurant_id"] = restaurant_id
    dates: set = set()
    async for d in db.cash_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    async for d in db.beverage_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    items = []
    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    # Dizionario paste per ristorante (se single restaurant); altrimenti per riga
    dict_for_rid_cache: Dict[str, Dict[str, float]] = {}
    async def _dict_for(rid_local: Optional[str]) -> Dict[str, float]:
        if not rid_local:
            return dict(PASTA_PRICES_MAP)
        if rid_local not in dict_for_rid_cache:
            dict_for_rid_cache[rid_local] = await _get_pasta_dict_for(rid_local)
        return dict_for_rid_cache[rid_local]
    for date_str in sorted(dates, reverse=True):
        cash_q = {"date_rome": date_str}
        bev_q = {"date_rome": date_str}
        if restaurant_id:
            cash_q["restaurant_id"] = restaurant_id
            bev_q["restaurant_id"] = restaurant_id
        cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
        bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
        rid_for_dict = restaurant_id or cash_doc.get("restaurant_id")
        dmap = await _dict_for(rid_for_dict)
        cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap), 2) if cash_doc else 0.0
        bev_total_qty = 0
        bev_total_inc = 0.0
        for r in bev_docs:
            m = _eval_cash_value(r.get("mattina")); u = _eval_cash_value(r.get("inUsc"))
            s = _eval_cash_value(r.get("scarti"));  e = _eval_cash_value(r.get("sera"))
            qty = (0 if e == 0 else (m + u - e)) - s
            bev_total_qty += int(qty)
            bev_total_inc += qty * bev_prices.get(r["sigla"], 0)
        orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)
        paste_count = _compute_paste_count(cash_doc.get("paste_text", "") if cash_doc else "")
        items.append({
            "date": date_str,
            "cash_sera": cash_sera,
            "bev_total_qty": bev_total_qty,
            "bev_total_inc": round(bev_total_inc, 2),
            "orders_total": orders_info["total_orders"],
            "paste_count": paste_count,
        })
    return {"items": items}


@router.post("/admin/beverages/reset")
async def admin_beverages_reset(payload: Dict, token_data: dict = Depends(verify_token)):
    """Admin-only: azzera (cancella tutte le righe) il Magazzino Bevande di un locale.
    Tutte le date vengono rimosse. Riaprendo la pagina partirà tutto da 0 (anche la
    colonna Mattina, perché viene calcolata dal Sera di ieri che non esiste più)."""
    require_admin_or_federico(token_data)
    rid = (payload or {}).get("restaurant_id")
    if not rid or not isinstance(rid, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    res = await db.beverage_daily_counts.delete_many({"restaurant_id": rid})
    logger.info(f"[ADMIN] Reset Magazzino Bevande per {rid}: {res.deleted_count} righe cancellate")
    return {"ok": True, "deleted": res.deleted_count}


@router.get("/admin/audit-log/groups")
async def admin_audit_log_groups(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Raggruppa l'audit-log per (locale, data report). Una entry = una chiusura/report."""
    require_admin_or_federico(token_data)
    match: Dict[str, object] = {}
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        match["date_rome"] = rng
    if restaurant_id:
        match["restaurant_id"] = restaurant_id
    pipeline = [
        {"$match": match} if match else {"$match": {}},
        {"$group": {
            "_id": {"rid": "$restaurant_id", "date": "$date_rome"},
            "count": {"$sum": 1},
            "total_changes": {"$sum": "$changes_count"},
            "cash_count": {"$sum": {"$cond": [{"$eq": ["$category", "cash"]}, 1, 0]}},
            "bev_count": {"$sum": {"$cond": [{"$eq": ["$category", "beverage"]}, 1, 0]}},
            "admin_count": {"$sum": {"$cond": ["$is_impersonating", 1, 0]}},
            "first_at": {"$min": "$first_at"},
            "last_at": {"$max": "$last_at"},
            "users": {"$addToSet": "$by_user"},
        }},
        {"$sort": {"_id.date": -1, "last_at": -1}},
        {"$limit": 500},
    ]
    rows = await db.cash_audit_log.aggregate(pipeline).to_list(500)
    rids = list({r["_id"]["rid"] for r in rows if r["_id"].get("rid")})
    rest_map: Dict[str, str] = {}
    user_map: Dict[str, str] = {}
    if rids:
        async for r in db.restaurants.find({"id": {"$in": rids}}, {"_id": 0, "id": 1, "username": 1, "location": 1}):
            rest_map[r["id"]] = r.get("location") or r.get("username") or r["id"][:8]
            user_map[r["id"]] = r.get("username") or r.get("location") or r["id"][:8]
    items = []
    for r in rows:
        rid = r["_id"]["rid"]
        restaurant_label = rest_map.get(rid, "?")
        users = set(r.get("users") or [])
        if r.get("admin_count", 0) > 0:
            users.discard("Simone")
            users.discard("Amministratore")
            users.add("Admin")
        if "Pastasciutta Roma" in users:
            users.discard("Pastasciutta Roma")
            users.add(user_map.get(rid, restaurant_label))
        items.append({
            "restaurant_id": rid,
            "restaurant_label": restaurant_label,
            "date_rome": r["_id"]["date"],
            "count": r["count"],
            "total_changes": r["total_changes"],
            "cash_count": r["cash_count"],
            "bev_count": r["bev_count"],
            "admin_count": r["admin_count"],
            "first_at": r["first_at"],
            "last_at": r["last_at"],
            "users": sorted(users),
        })
    return {"items": items, "count": len(items)}


@router.get("/admin/audit-log")
async def admin_audit_log(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    restaurant_id: Optional[str] = None,
    category: Optional[str] = None,         # 'cash' | 'beverage'
    field_q: Optional[str] = None,          # full-text regex su 'field'
    user_q: Optional[str] = None,           # full-text sul nome utente normalizzato
    limit: int = 500,
    token_data: dict = Depends(verify_token),
):
    """Audit-log dei salvataggi su Report (Cassa + Bevande). Admin only."""
    require_admin_or_federico(token_data)
    q: Dict[str, object] = {}
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["date_rome"] = rng
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    if category in ("cash", "beverage"):
        q["category"] = category
    if field_q:
        q["field"] = {"$regex": re.escape(field_q), "$options": "i"}
    limit = max(1, min(int(limit or 500), 2000))
    normalized_user_q = (user_q or "").strip().casefold()
    fetch_limit = 10000 if normalized_user_q else limit
    docs = await db.cash_audit_log.find(q, {"_id": 0}).sort("last_at", -1).to_list(fetch_limit)
    # Arricchisco con nome locale (cache map già presente _locations_cache: skip — uso restaurants live)
    rest_map = {}
    user_map = {}
    rids = list({
        rid
        for d in docs
        for rid in (d.get("restaurant_id"), d.get("by_user_id"))
        if rid
    })
    if rids:
        async for r in db.restaurants.find({"id": {"$in": rids}}, {"_id": 0, "id": 1, "username": 1, "location": 1}):
            rest_map[r["id"]] = r.get("location") or r.get("username") or r["id"][:8]
            user_map[r["id"]] = r.get("username") or r.get("location") or r["id"][:8]
    for d in docs:
        d["restaurant_label"] = rest_map.get(d.get("restaurant_id"), "?")
        d["_raw_by_user"] = d.get("by_user", "")
        d["by_user"] = _normalize_audit_user_label(d, user_map)
    if normalized_user_q:
        docs = [
            d for d in docs
            if normalized_user_q in str(d.get("by_user", "")).casefold()
            or normalized_user_q in str(d.get("_raw_by_user", "")).casefold()
        ][:limit]
    for d in docs:
        d.pop("_raw_by_user", None)
    return {"items": docs, "count": len(docs)}


@router.get("/admin/closures/grid")
async def closures_grid_admin(
    days: int = 30,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Vista Excel-like: una riga per giorno con TUTTI i campi cash + bevande
    (mattina/inUsc/scarti/sera + qty + incasso per ogni sigla) + totali calcolati.
    Filtrabile per restaurant_id (richiesto per la vista per-locale).

    Accessibile anche da utenti normali (in sola lettura, forzati sul proprio locale).
    """
    is_admin = can_impersonate(token_data)
    if not is_admin:
        # Utente normale: forziamo il restaurant_id sul proprio
        restaurant_id = token_data.get("restaurant_id")
        if not restaurant_id:
            raise HTTPException(status_code=403, detail="Restaurant_id assente nel token")
    days = max(1, min(int(days or 30), 365))
    cutoff = (datetime.now(ROME_TZ) - timedelta(days=days)).strftime("%Y-%m-%d")
    today = _today_rome_str()
    base_q = {"date_rome": {"$gte": cutoff, "$lt": today}}
    if restaurant_id:
        base_q["restaurant_id"] = restaurant_id

    dates: set = set()
    async for d in db.cash_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])
    async for d in db.beverage_daily_counts.find(base_q, {"date_rome": 1, "_id": 0}):
        dates.add(d["date_rome"])

    bev_prices = {b["sigla"]: b["price"] for b in BEVERAGES_CATALOG}
    bev_sigle_sorted = [b["sigla"] for b in sorted(BEVERAGES_CATALOG, key=lambda x: x.get("sort_order", 999))]
    # Cache dizionario paste per ristorante
    _dict_cache: Dict[str, Dict[str, float]] = {}
    async def _dict_for_grid(rid_local: Optional[str]) -> Dict[str, float]:
        if not rid_local:
            return dict(PASTA_PRICES_MAP)
        if rid_local not in _dict_cache:
            _dict_cache[rid_local] = await _get_pasta_dict_for(rid_local)
        return _dict_cache[rid_local]

    rows: List[Dict] = []
    for date_str in sorted(dates, reverse=True):
        cash_q = {"date_rome": date_str}
        bev_q = {"date_rome": date_str}
        if restaurant_id:
            cash_q["restaurant_id"] = restaurant_id
            bev_q["restaurant_id"] = restaurant_id
        cash_doc = await db.cash_daily_counts.find_one(cash_q, {"_id": 0}) or {}
        bev_docs = await db.beverage_daily_counts.find(bev_q, {"_id": 0}).to_list(50)
        bev_by_sigla = {b["sigla"]: b for b in bev_docs}
        dmap_row = await _dict_for_grid(restaurant_id or cash_doc.get("restaurant_id"))

        cash_flat: Dict[str, float] = {}
        for f in ALL_CASH_FIELDS:
            cash_flat[f] = _eval_cash_value(cash_doc.get(f, ""))

        bev_flat: Dict[str, Dict] = {}
        bev_total_qty = 0
        bev_total_inc = 0.0
        for sigla in bev_sigle_sorted:
            r = bev_by_sigla.get(sigla, {})
            m = _eval_cash_value(r.get("mattina"))
            u = _eval_cash_value(r.get("inUsc"))
            s = _eval_cash_value(r.get("scarti"))
            e = _eval_cash_value(r.get("sera"))
            qty = (0 if e == 0 else (m + u - e)) - s
            inc = qty * bev_prices.get(sigla, 0)
            bev_flat[sigla] = {
                "mattina": m, "inUsc": u, "scarti": s, "sera": e,
                "qty": int(qty), "incasso": round(inc, 2),
            }
            bev_total_qty += int(qty)
            bev_total_inc += inc

        cash_sera = round(_compute_cash_sera_full(cash_doc, bev_docs, dmap_row), 2) if cash_doc else 0.0
        cash_sera_base = round(_compute_cash_sera(cash_doc), 2) if cash_doc else 0.0
        spicci_total = round(_compute_spicci_total(cash_doc), 2) if cash_doc else 0.0
        paste_text = cash_doc.get("paste_text", "") if cash_doc else ""
        manual_prices = cash_doc.get("manual_prices") or {}
        paste_count = _compute_paste_count(paste_text)
        paste_total_eur = round(_compute_paste_total_eur(paste_text, manual_prices, dmap_row), 2)
        orders_info = await _orders_aggregate_for_date(date_str, restaurant_id=restaurant_id)

        rows.append({
            "date": date_str,
            "is_mock": bool(cash_doc.get("mock") or any(b.get("mock") for b in bev_docs)),
            "cash": cash_flat,
            "vers_color": cash_doc.get("vers_color", ""),
            "beverages": bev_flat,
            "bev_total_qty": bev_total_qty,
            "bev_total_inc": round(bev_total_inc, 2),
            "cash_sera_base": cash_sera_base,
            "spicci_total": spicci_total,
            "paste_count": paste_count,
            "paste_total_eur": paste_total_eur,
            "orders_total": orders_info.get("total_orders", 0),
            "cash_sera": cash_sera,
        })

    return {
        "items": rows,
        "count": len(rows),
        "cash_fields": list(ALL_CASH_FIELDS),
        "bev_sigle": bev_sigle_sorted,
        "bev_prices": bev_prices,
    }


async def admin_generate_mock_closures(
    payload: Dict, token_data: dict = Depends(verify_token)
):
    """Genera N chiusure mock per il locale indicato, partendo dal giorno
    precedente e andando indietro. Le righe sono marcate `mock: true` così
    da poter essere cancellate con `DELETE /api/admin/closures/mock`.
    Body: {restaurant_id: str, days: int = 7, overwrite: bool = false}
    """
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    rid = (payload or {}).get("restaurant_id")
    days = int((payload or {}).get("days") or 7)
    overwrite = bool((payload or {}).get("overwrite") or False)
    if not rid or not isinstance(rid, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    days = max(1, min(days, 90))

    import random
    random.seed()
    pasta_siglas = list(PASTA_PRICES_MAP.keys())
    bev_sigle = [b["sigla"] for b in BEVERAGES_CATALOG]

    created_cash = 0
    created_bev = 0
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for offset in range(1, days + 1):
        date_str = (datetime.now(ROME_TZ) - timedelta(days=offset)).strftime("%Y-%m-%d")

        existing = await db.cash_daily_counts.find_one(
            {"restaurant_id": rid, "date_rome": date_str}, {"_id": 0, "mock": 1}
        )
        if existing and not (existing.get("mock") or overwrite):
            skipped += 1
            continue

        mattina = random.randint(80, 250)
        altro = random.randint(0, 60)
        glo = random.randint(20, 120)
        just = random.randint(10, 80)
        delv = random.randint(20, 100)
        bp = random.randint(50, 200)
        sat = random.randint(40, 180)
        ft = random.randint(20, 90)
        pos = random.randint(150, 450)
        vers = random.randint(200, 800)
        arr = random.randint(0, 20)
        sp5 = random.randint(0, 3)
        sp2 = random.randint(0, 4)
        sp1 = random.randint(0, 6)
        sp05 = random.randint(0, 6)
        cd5 = random.randint(2, 8)
        cd2 = random.randint(3, 10)
        cd1 = random.randint(5, 15)
        cd05 = random.randint(5, 15)
        n_paste = random.randint(15, 50)
        paste_lines = []
        for _ in range(n_paste):
            sigla = random.choice(pasta_siglas)
            descr = random.choice(["", " - tavolo 5", " - asporto", " - PIET", " - LUCA"])
            paste_lines.append(f"{sigla}{descr}")
        paste_text = "\n".join(paste_lines)

        cash_set = {
            "restaurant_id": rid, "date_rome": date_str,
            "mattina": str(mattina), "altro": str(altro),
            "glo": str(glo), "just": str(just), "delv": str(delv),
            "bp": str(bp), "sat": str(sat), "ft": str(ft),
            "pos": str(pos), "vers": str(vers), "arr": str(arr),
            "sp5": str(sp5), "sp2": str(sp2), "sp1": str(sp1), "sp05": str(sp05),
            "cd5": str(cd5), "cd2": str(cd2), "cd1": str(cd1), "cd05": str(cd05),
            "vers_color": random.choice(["", "green", "blue", "black"]),
            "paste_text": paste_text,
            "manual_prices": {}, "cash_banconote": {}, "comments": {},
            "mock": True,
            "updated_at": now_iso,
        }
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": date_str},
            {"$set": cash_set},
            upsert=True,
        )
        created_cash += 1

        for sigla in bev_sigle:
            existing_bev = await db.beverage_daily_counts.find_one(
                {"restaurant_id": rid, "date_rome": date_str, "sigla": sigla},
                {"_id": 0, "mock": 1},
            )
            if existing_bev and not (existing_bev.get("mock") or overwrite):
                continue
            mattina_q = random.randint(40, 100)
            ingressi = random.randint(0, 24)
            scarti = random.randint(0, 3)
            vendute = random.randint(5, min(40, max(6, mattina_q + ingressi - scarti)))
            sera_q = max(0, mattina_q + ingressi - scarti - vendute)
            await db.beverage_daily_counts.update_one(
                {"restaurant_id": rid, "date_rome": date_str, "sigla": sigla},
                {"$set": {
                    "restaurant_id": rid, "date_rome": date_str, "sigla": sigla,
                    "mattina": str(mattina_q),
                    "inUsc": str(ingressi),
                    "scarti": str(scarti),
                    "sera": str(sera_q),
                    "mattina_casse": "", "mattina_sfuse": "",
                    "inUsc_casse": "",
                    "sera_casse": "", "sera_sfuse": "",
                    "comments": {}, "mock": True,
                    "updated_at": now_iso,
                }},
                upsert=True,
            )
            created_bev += 1

    return {
        "ok": True, "days_requested": days,
        "cash_rows_written": created_cash,
        "bev_rows_written": created_bev,
        "skipped_existing": skipped,
    }


async def admin_delete_mock_closures(
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Elimina TUTTE le chiusure marcate `mock:true` (cash + bev).
    Filtrabile per `restaurant_id` (raccomandato)."""
    if token_data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    q = {"mock": True}
    if restaurant_id:
        q["restaurant_id"] = restaurant_id
    res_cash = await db.cash_daily_counts.delete_many(q)
    res_bev = await db.beverage_daily_counts.delete_many(q)
    return {"ok": True, "cash_deleted": res_cash.deleted_count, "bev_deleted": res_bev.deleted_count}


@router.get("/pasta-dictionary")
async def get_pasta_dictionary(
    request: Request,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Ritorna il dizionario paste per il ristorante. Se non c'è override in DB,
    torna il default `PASTA_PRICES_MAP`. Tutti possono leggere il proprio dict;
    Admin/Supervisor possono leggere quello di qualsiasi locale specificando `restaurant_id`."""
    role = token_data.get("role")
    if restaurant_id and not can_impersonate(token_data):
        # Utenti non admin/supervisor non possono leggere il dict di un altro locale
        raise HTTPException(status_code=403, detail="Admin only per leggere dict altri locali")
    rid = restaurant_id
    if not rid:
        rid = await _effective_restaurant_id(request, token_data)
    if not rid:
        # Nessun rid → torna il default
        siglas = [{"sigla": k, "price": v} for k, v in PASTA_PRICES_MAP.items()]
        return {"restaurant_id": None, "siglas": siglas, "is_default": True}
    doc = await db.pasta_dictionary.find_one({"restaurant_id": rid}, {"_id": 0})
    if doc and doc.get("siglas"):
        return {
            "restaurant_id": rid,
            "siglas": doc["siglas"],
            "is_default": False,
            "updated_at": doc.get("updated_at"),
            "updated_by": doc.get("updated_by"),
        }
    siglas = [{"sigla": k, "price": v} for k, v in PASTA_PRICES_MAP.items()]
    return {"restaurant_id": rid, "siglas": siglas, "is_default": True}


@router.put("/pasta-dictionary")
async def upsert_pasta_dictionary(
    data: PastaDictionaryUpsert,
    request: Request,
    token_data: dict = Depends(verify_token),
):
    """Sovrascrive il dizionario paste di un ristorante. Solo Admin/Supervisor."""
    require_admin_or_federico(token_data)
    if not data.restaurant_id or not isinstance(data.restaurant_id, str):
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    # Sanitizzazione: sigla maiuscola, no spazi, prezzo numerico positivo
    clean: List[Dict] = []
    seen = set()
    for item in (data.siglas or []):
        try:
            sigla = str(item.get("sigla", "")).upper().strip()
            price = float(item.get("price", 0))
        except Exception:
            continue
        if not sigla or sigla in seen:
            continue
        if not re.match(r"^[A-Z0-9_-]{1,20}$", sigla):
            raise HTTPException(status_code=400, detail=f"Sigla non valida: '{sigla}' (solo A-Z, 0-9, max 20 char)")
        if price < 0 or price > 1000:
            raise HTTPException(status_code=400, detail=f"Prezzo non valido per '{sigla}'")
        seen.add(sigla)
        clean.append({"sigla": sigla, "price": price})

    username = token_data.get("name") or token_data.get("username") or token_data.get("sub") or "admin"
    await db.pasta_dictionary.update_one(
        {"restaurant_id": data.restaurant_id},
        {"$set": {
            "restaurant_id": data.restaurant_id,
            "siglas": clean,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": username,
        }},
        upsert=True,
    )
    return {"ok": True, "count": len(clean)}


@router.delete("/pasta-dictionary")
async def reset_pasta_dictionary(
    restaurant_id: str,
    token_data: dict = Depends(verify_token),
):
    """Resetta il dizionario di un ristorante al default. Solo Admin/Supervisor."""
    require_admin_or_federico(token_data)
    res = await db.pasta_dictionary.delete_one({"restaurant_id": restaurant_id})
    return {"ok": True, "deleted": res.deleted_count}


async def admin_snapshot_today(
    payload: Dict, request: Request, token_data: dict = Depends(verify_token),
):
    """[TEST] Copia la chiusura di OGGI alla data target (default: ieri),
    così l'admin può vederla subito nella Vista Excel senza aspettare mezzanotte.
    Non tocca i dati di oggi. Sovrascrive eventuali dati esistenti sulla data target.
    Body: {restaurant_id?: str, target_date?: 'YYYY-MM-DD'}
    """
    if token_data.get("role") not in ("admin",):
        raise HTTPException(status_code=403, detail="Solo Admin/Supervisor")
    p = payload or {}
    rid = p.get("restaurant_id") or await _effective_restaurant_id(request, token_data)
    if not rid:
        raise HTTPException(status_code=400, detail="restaurant_id mancante")
    target_date = p.get("target_date") or (
        datetime.now(ROME_TZ) - timedelta(days=1)
    ).strftime("%Y-%m-%d")
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", target_date):
        raise HTTPException(status_code=400, detail="target_date formato non valido")
    today = _today_rome_str()
    if target_date >= today:
        raise HTTPException(status_code=400, detail="target_date deve essere precedente a oggi")

    # Copia cash_daily_counts
    cash_doc = await db.cash_daily_counts.find_one(
        {"restaurant_id": rid, "date_rome": today}, {"_id": 0}
    )
    cash_copied = 0
    if cash_doc:
        cash_copy = {**cash_doc, "date_rome": target_date, "mock": True,
                     "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.cash_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": target_date},
            {"$set": cash_copy},
            upsert=True,
        )
        cash_copied = 1

    # Copia beverage_daily_counts (tutte le sigle)
    bev_docs = await db.beverage_daily_counts.find(
        {"restaurant_id": rid, "date_rome": today}, {"_id": 0}
    ).to_list(50)
    bev_copied = 0
    for b in bev_docs:
        b_copy = {**b, "date_rome": target_date, "mock": True,
                  "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.beverage_daily_counts.update_one(
            {"restaurant_id": rid, "date_rome": target_date, "sigla": b["sigla"]},
            {"$set": b_copy},
            upsert=True,
        )
        bev_copied += 1

    return {
        "ok": True,
        "restaurant_id": rid,
        "target_date": target_date,
        "cash_copied": cash_copied,
        "bev_copied": bev_copied,
    }


@router.get("/admin/closures/{date_str}")
async def closure_detail_admin(
    date_str: str,
    restaurant_id: Optional[str] = None,
    token_data: dict = Depends(verify_token),
):
    """Dettaglio completo di una chiusura (data Rome YYYY-MM-DD). Admin only."""
    require_admin_or_federico(token_data)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        raise HTTPException(status_code=400, detail="Data non valida")
    return await _build_closure_detail(date_str, restaurant_id)


@router.get("/closures/yesterday")
async def closure_yesterday(request: Request, token_data: dict = Depends(verify_token)):
    """Dettaglio della chiusura di IERI (limitata al locale corrente).
    Disponibile anche ai ristoranti (non solo Admin) — usa `_effective_restaurant_id`
    quindi Admin può comunque impersonare via X-Restaurant-Id."""
    rid = await _effective_restaurant_id(request, token_data)
    yesterday = (datetime.now(ROME_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
    return await _build_closure_detail(yesterday, rid)
