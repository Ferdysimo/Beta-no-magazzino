"""Diagnostic script for the orders collection.

Usage on VPS:
    cd /opt/pastasciutta/backend && venv/bin/python diagnose_orders.py

Reports:
- For each restaurant: active order count, min/max order number, gaps
- Stale orders (created_at before today's Rome midnight)
- Number collisions between active orders and archived_orders of today
- Current order_counter vs MAX(active, archived today, deleted today)
"""
import os
import sys
import asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

if not MONGO_URL or not DB_NAME:
    print("ERROR: MONGO_URL or DB_NAME not set in .env", file=sys.stderr)
    sys.exit(1)

ROME_TZ = ZoneInfo("Europe/Rome")


def today_bounds_utc():
    now_rome = datetime.now(ROME_TZ)
    start_rome = now_rome.replace(hour=0, minute=0, second=0, microsecond=0)
    end_rome = start_rome + timedelta(days=1)
    return (
        start_rome.astimezone(timezone.utc).isoformat(),
        end_rome.astimezone(timezone.utc).isoformat(),
        start_rome.isoformat(),
    )


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    start_utc, end_utc, start_rome_str = today_bounds_utc()
    print("=" * 70)
    print(f"DIAGNOSTICA ORDINI — {datetime.now(ROME_TZ).strftime('%Y-%m-%d %H:%M:%S')} Rome")
    print(f"Today bounds (Rome): {start_rome_str}")
    print(f"Today bounds (UTC) : {start_utc}  ->  {end_utc}")
    print("=" * 70)

    restaurants = await db.restaurants.find(
        {"role": "restaurant"}, {"_id": 0}
    ).to_list(100)

    total_stale = 0
    for r in restaurants:
        rid = r["id"]
        loc = r.get("location", "?")
        counter = r.get("order_counter", 0)

        active = await db.orders.find(
            {"restaurant_id": rid}, {"_id": 0, "order_number": 1, "created_at": 1, "description": 1}
        ).sort("order_number", 1).to_list(10000)

        archived_today = await db.archived_orders.find(
            {"restaurant_id": rid, "created_at": {"$gte": start_utc, "$lt": end_utc}},
            {"_id": 0, "order_number": 1, "description": 1},
        ).sort("order_number", 1).to_list(10000)

        deleted_today = await db.deletion_logs.find(
            {"restaurant_id": rid, "deleted_at": {"$gte": start_utc, "$lt": end_utc}},
            {"_id": 0, "order_number": 1},
        ).sort("order_number", 1).to_list(10000)

        # Stale: active orders with created_at before today's Rome midnight
        stale = [o for o in active if o.get("created_at", "") < start_utc]

        active_nums = [o["order_number"] for o in active]
        archived_nums = [o["order_number"] for o in archived_today]
        deleted_nums = [o.get("order_number", 0) for o in deleted_today]

        max_active = max(active_nums) if active_nums else 0
        max_archived = max(archived_nums) if archived_nums else 0
        max_deleted = max(deleted_nums) if deleted_nums else 0
        expected_counter = max(max_active, max_archived, max_deleted)

        # Collisions: same order_number in both active AND archived_today
        collisions = sorted(set(active_nums) & set(archived_nums))

        print(f"\n--- {loc} (id={rid[:8]}...) ---")
        print(f"  order_counter (DB)        : {counter}")
        print(f"  expected counter (MAX)    : {expected_counter}")
        if counter < expected_counter:
            print(f"  *** ANOMALIA: counter più basso del MAX storico! ***")
        print(f"  Active orders             : {len(active)}  (min={min(active_nums) if active_nums else '-'}, max={max_active})")
        print(f"  Archived today            : {len(archived_today)} (max={max_archived})")
        print(f"  Deleted today             : {len(deleted_today)} (max={max_deleted})")
        print(f"  Stale active orders       : {len(stale)}  *** PROBLEM if > 0 ***")
        if stale:
            for s in stale[:5]:
                print(f"     - #{s['order_number']} created_at={s.get('created_at')} desc={s.get('description','')[:40]}")
            if len(stale) > 5:
                print(f"     ... e altri {len(stale)-5}")
        print(f"  Number collisions today   : {len(collisions)}  *** PROBLEM if > 0 ***")
        if collisions:
            print(f"     numbers reused: {collisions[:20]}{'...' if len(collisions)>20 else ''}")

        total_stale += len(stale)

    print("\n" + "=" * 70)
    print(f"TOTAL STALE ORDERS ACROSS ALL RESTAURANTS: {total_stale}")
    if total_stale > 0:
        print("\n>>> Per pulire: riavvia il backend (`sudo systemctl restart pastasciutta-backend`)")
        print(">>> All'avvio la nuova funzione recover_stale_orders() li archivierà automaticamente.")
    print("=" * 70)

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
