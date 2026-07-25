from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.core.database import db
from app.core.security import verify_token
from app.core.time import ROME_TZ, _rome_date_bounds_utc
from app.schemas import (
    DocumentScanAnalyzeRequest,
    DocumentScanFeedback,
    PastaAnnotationDecision,
)
from app.services.analysis import (
    ANALYSIS_ORDER_SOURCES,
    _analysis_order_identity,
    _normalize_analysis_order_doc,
)
from app.services.document_scanner import (
    DOCUMENT_SCANNER_VERSION,
    build_document_scan_draft,
    load_document_scanner_catalog,
    save_document_scan_feedback,
)
from app.services.pasta_annotation_learning import (
    PASTA_ANNOTATION_LEARNING_VERSION,
    build_pasta_annotation_suggestions,
    delete_pasta_annotation_decision,
    load_pasta_annotation_learning,
    save_pasta_annotation_decision,
)
from app.services.pasta_annotations import build_pasta_annotation_stats
from app.services.report import _get_pasta_dict_for, _pasta_dict_from_snapshot


router = APIRouter()
MAX_LAB_RANGE_DAYS = 366


def _require_simone_laboratory(token_data: dict) -> None:
    if (
        token_data.get("username") != "Simone"
        or token_data.get("role") != "admin"
    ):
        raise HTTPException(status_code=403, detail="Laboratorio riservato a Simone")


def _parse_lab_date(value: Optional[str], *, default: date, field: str) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"{field} deve usare il formato YYYY-MM-DD",
        ) from exc


@router.get("/lab/document-scanner/context")
async def get_document_scanner_context(
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    catalog = await load_document_scanner_catalog(db)
    confirmed_scans = await db.lab_document_scan_feedback.count_documents({})
    learned_aliases = await db.lab_document_aliases.count_documents({})
    return {
        "scanner_version": DOCUMENT_SCANNER_VERSION,
        "suppliers": catalog["suppliers"],
        "products": catalog["products"],
        "learning": {
            "confirmed_scans": confirmed_scans,
            "learned_aliases": learned_aliases,
        },
        "privacy": {
            "image_stored": False,
            "full_ocr_text_stored": False,
        },
    }


@router.post("/lab/document-scanner/analyze")
async def analyze_document_scanner(
    data: DocumentScanAnalyzeRequest,
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    catalog = await load_document_scanner_catalog(db)
    return build_document_scan_draft(
        data.ocr_text,
        suppliers=catalog["suppliers"],
        products=catalog["products"],
        aliases=catalog["aliases"],
        ocr_confidence=data.ocr_confidence,
        file_name=data.file_name,
        file_fingerprint=data.file_fingerprint,
    )


@router.post("/lab/document-scanner/feedback")
async def confirm_document_scanner_feedback(
    data: DocumentScanFeedback,
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    try:
        return await save_document_scan_feedback(db, data, token_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/lab/pasta-annotations")
async def get_pasta_annotations_lab(
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    restaurant_id: Optional[str] = Query(default=None),
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    learning_state = await load_pasta_annotation_learning(db)

    today = datetime.now(ROME_TZ).date()
    selected_end = _parse_lab_date(end_date, default=today, field="end_date")
    selected_start = _parse_lab_date(
        start_date,
        default=selected_end - timedelta(days=29),
        field="start_date",
    )
    if selected_start > selected_end:
        raise HTTPException(status_code=400, detail="Intervallo date non valido")
    if (selected_end - selected_start).days + 1 > MAX_LAB_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Intervallo massimo: {MAX_LAB_RANGE_DAYS} giorni",
        )

    all_restaurants = await db.restaurants.find(
        {"role": "restaurant"},
        {"_id": 0, "id": 1, "location": 1, "username": 1},
    ).to_list(200)
    restaurants_by_id = {
        item["id"]: item for item in all_restaurants if item.get("id")
    }
    if restaurant_id and restaurant_id not in restaurants_by_id:
        raise HTTPException(status_code=404, detail="Locale non trovato")
    restaurants = (
        [restaurants_by_id[restaurant_id]]
        if restaurant_id
        else all_restaurants
    )

    restaurant_ids = [item["id"] for item in restaurants if item.get("id")]
    all_locations_by_id = {
        item["id"]: item.get("location") or item.get("username") or item["id"]
        for item in all_restaurants
        if item.get("id")
    }
    locations_by_id = {
        item["id"]: item.get("location") or item.get("username") or item["id"]
        for item in restaurants
        if item.get("id")
    }
    restaurants_payload = sorted(
        [
            {"id": item["id"], "location": all_locations_by_id[item["id"]]}
            for item in all_restaurants
            if item.get("id")
        ],
        key=lambda item: item["location"].lower(),
    )

    if not restaurant_ids:
        empty = build_pasta_annotation_stats(
            [],
            dictionaries_by_key={},
            fallback_dictionaries={},
            locations_by_id={},
            target_aliases=learning_state["alias_map"],
        )
        return {
            **empty,
            "period": {
                "start_date": selected_start.isoformat(),
                "end_date": selected_end.isoformat(),
            },
            "restaurants": [],
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "data_scope": "read_only_operational_history",
            "learning": {
                "version": PASTA_ANNOTATION_LEARNING_VERSION,
                "suggestions": [],
                "confirmed_aliases": learning_state["confirmed_aliases"],
                "dismissed_pairs": learning_state["dismissed_pairs"],
            },
        }

    start_utc, _ = _rome_date_bounds_utc(selected_start.isoformat())
    _, end_utc = _rome_date_bounds_utc(selected_end.isoformat())
    projection = {
        "_id": 0,
        "id": 1,
        "restaurant_id": 1,
        "created_at": 1,
        "order_number": 1,
        "description": 1,
    }
    canonical_orders = {}
    for collection_name, timestamp_field in ANALYSIS_ORDER_SOURCES:
        cursor = db[collection_name].find(
            {
                "restaurant_id": {"$in": restaurant_ids},
                timestamp_field: {"$gte": start_utc, "$lt": end_utc},
            },
            projection,
        )
        async for raw_doc in cursor:
            normalized = _normalize_analysis_order_doc(raw_doc, timestamp_field)
            if normalized:
                canonical_orders.setdefault(
                    _analysis_order_identity(normalized),
                    normalized,
                )

    start_key = selected_start.isoformat()
    end_key = selected_end.isoformat()
    dictionaries_by_key = {}
    cash_cursor = db.cash_daily_counts.find(
        {
            "restaurant_id": {"$in": restaurant_ids},
            "date_rome": {"$gte": start_key, "$lte": end_key},
        },
        {"_id": 0, "restaurant_id": 1, "date_rome": 1, "pasta_dict_snapshot": 1},
    )
    async for cash_doc in cash_cursor:
        snapshot = _pasta_dict_from_snapshot(cash_doc.get("pasta_dict_snapshot"))
        if snapshot:
            dictionaries_by_key[(
                cash_doc.get("restaurant_id"),
                cash_doc.get("date_rome"),
            )] = snapshot

    fallback_dictionaries = {}
    for rid in restaurant_ids:
        fallback_dictionaries[rid] = await _get_pasta_dict_for(rid)

    result = await run_in_threadpool(
        build_pasta_annotation_stats,
        canonical_orders.values(),
        dictionaries_by_key=dictionaries_by_key,
        fallback_dictionaries=fallback_dictionaries,
        locations_by_id=locations_by_id,
        target_aliases=learning_state["alias_map"],
    )
    suggestions = await run_in_threadpool(
        build_pasta_annotation_suggestions,
        result["signals"],
        dismissed_pair_keys={
            item.get("pair_key")
            for item in learning_state["dismissed_pairs"]
            if item.get("pair_key")
        },
    )
    return {
        **result,
        "period": {
            "start_date": selected_start.isoformat(),
            "end_date": selected_end.isoformat(),
        },
        "restaurants": restaurants_payload,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data_scope": "read_only_operational_history",
        "learning": {
            "version": PASTA_ANNOTATION_LEARNING_VERSION,
            "suggestions": suggestions,
            "confirmed_aliases": learning_state["confirmed_aliases"],
            "dismissed_pairs": learning_state["dismissed_pairs"],
        },
    }


@router.post("/lab/pasta-annotations/decisions")
async def confirm_pasta_annotation_decision(
    data: PastaAnnotationDecision,
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    try:
        return await save_pasta_annotation_decision(db, data, token_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/lab/pasta-annotations/decisions/{decision_id}")
async def undo_pasta_annotation_decision(
    decision_id: str,
    token_data: dict = Depends(verify_token),
):
    _require_simone_laboratory(token_data)
    try:
        return await delete_pasta_annotation_decision(db, decision_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
