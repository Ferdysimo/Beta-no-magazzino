import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from app.core.config import UPLOADS_DIR
from app.core.database import db


logger = logging.getLogger(__name__)
UPLOADS_RETENTION_DAYS = 90


async def _atomic_archive_and_clear(collection_name: str, archive_name: str) -> int:
    """Atomically archive a collection then clear it. Returns archived count.

    Strategy: read all -> insert_many into archive -> verify inserted_count matches ->
    only THEN delete from source. If insert fails or count mismatches, abort and keep
    the source untouched.
    """
    src = db[collection_name]
    arc = db[archive_name]
    docs = await src.find({}, {"_id": 0}).to_list(100000)
    if not docs:
        return 0
    try:
        result = await arc.insert_many([{**d} for d in docs], ordered=False)
        if len(result.inserted_ids) != len(docs):
            logger.error(
                f"[ATOMIC] {collection_name}: archived {len(result.inserted_ids)}/{len(docs)}, "
                f"ABORTING delete to prevent data loss"
            )
            return 0
    except Exception as e:
        logger.error(f"[ATOMIC] Failed to archive {collection_name}: {e}. NOT deleting source.")
        return 0
    # Archive succeeded -> safe to delete source
    delete_res = await src.delete_many({})
    logger.info(f"[ATOMIC] {collection_name}: archived={len(docs)}, deleted={delete_res.deleted_count}")
    return len(docs)


async def cleanup_old_uploads(retention_days: int = UPLOADS_RETENTION_DAYS) -> Dict[str, int]:
    """Delete fatture / versamenti / chiusure older than `retention_days` together
    with their associated image files on disk.

    For warehouse carichi (`carichi_magazzino`, `beverage_carichi`) we only strip
    the DDT/fattura image files from disk and null out the filename fields —
    the documents themselves are kept so `/analisi/magazzino` keeps working on
    historical ranges.

    Cutoff is based on `created_at` (ISO 8601 UTC string, lexicographically
    comparable). Returns a dict {collection: deleted_or_stripped_count}.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
    # Full-delete collections: doc + image files are all removed.
    delete_targets = [
        ("invoices",   ["image_file"]),
        ("versamenti", ["image_file"]),
        ("chiusure",   ["image_file", "piatti_file"]),
    ]
    # Strip-only collections: keep the doc (needed for analytics), drop the
    # associated images from disk and clear the filename fields.
    strip_targets = [
        ("carichi_magazzino", ["photo_file", "fattura_file"]),
        ("beverage_carichi",  ["invoice_file"]),
    ]
    summary: Dict[str, int] = {}

    for coll_name, file_fields in delete_targets:
        try:
            coll = db[coll_name]
            projection = {"_id": 0, "id": 1}
            for f in file_fields:
                projection[f] = 1
            old_docs = await coll.find(
                {"created_at": {"$lt": cutoff}}, projection
            ).to_list(100000)
            if not old_docs:
                summary[coll_name] = 0
                continue
            files_removed = 0
            for d in old_docs:
                for f in file_fields:
                    fn = d.get(f)
                    if not fn:
                        continue
                    try:
                        p = UPLOADS_DIR / fn
                        if p.exists():
                            p.unlink()
                            files_removed += 1
                    except Exception as e:
                        logger.warning(f"[CLEANUP] Could not delete file {fn} for {coll_name}: {e}")
            old_ids = [d["id"] for d in old_docs if d.get("id")]
            del_res = await coll.delete_many({"id": {"$in": old_ids}})
            summary[coll_name] = del_res.deleted_count
            logger.info(
                f"[CLEANUP] {coll_name}: deleted {del_res.deleted_count} docs older than "
                f"{retention_days}d, removed {files_removed} image files"
            )
        except Exception as e:
            logger.error(f"[CLEANUP] Failed for {coll_name}: {e}", exc_info=True)
            summary[coll_name] = -1

    for coll_name, file_fields in strip_targets:
        try:
            coll = db[coll_name]
            projection = {"_id": 0, "id": 1}
            for f in file_fields:
                projection[f] = 1
            # Only docs that still hold at least one image filename.
            file_filter = {"$or": [{f: {"$nin": ["", None]}} for f in file_fields]}
            old_docs = await coll.find(
                {"created_at": {"$lt": cutoff}, **file_filter}, projection
            ).to_list(100000)
            if not old_docs:
                summary[coll_name] = 0
                continue
            files_removed = 0
            stripped_ids: List[str] = []
            for d in old_docs:
                touched = False
                for f in file_fields:
                    fn = d.get(f)
                    if not fn:
                        continue
                    try:
                        p = UPLOADS_DIR / fn
                        if p.exists():
                            p.unlink()
                            files_removed += 1
                    except Exception as e:
                        logger.warning(f"[CLEANUP] Could not delete file {fn} for {coll_name}: {e}")
                    touched = True
                if touched and d.get("id"):
                    stripped_ids.append(d["id"])
            if stripped_ids:
                # Null-out filename fields + invoice_url (computed at create time
                # for beverage_carichi). We touch them all unconditionally:
                # already-empty fields stay empty, no other data is affected.
                unset_fields = {f: "" for f in file_fields}
                if coll_name == "beverage_carichi":
                    unset_fields["invoice_url"] = ""
                await coll.update_many(
                    {"id": {"$in": stripped_ids}},
                    {"$set": unset_fields},
                )
            summary[coll_name] = len(stripped_ids)
            logger.info(
                f"[CLEANUP] {coll_name}: stripped DDT from {len(stripped_ids)} docs older "
                f"than {retention_days}d, removed {files_removed} image files (docs kept for analytics)"
            )
        except Exception as e:
            logger.error(f"[CLEANUP] Failed for {coll_name}: {e}", exc_info=True)
            summary[coll_name] = -1

    # Upload-attempt diagnostics contain metadata only and follow the same
    # 90-day window as the closure images they explain.
    try:
        result = await db.upload_attempts.delete_many({"first_seen": {"$lt": cutoff}})
        summary["upload_attempts"] = result.deleted_count
    except Exception as e:
        logger.error("[CLEANUP] Failed for upload_attempts: %s", e, exc_info=True)
        summary["upload_attempts"] = -1

    return summary
