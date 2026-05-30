#!/usr/bin/env python3
"""
Diagnostica ordini "spariti": stampa TUTTO ciò che è successo per un locale
in una fascia oraria odierna — ordini attivi, archiviati, cancellati e modificati.

USO (da /app/backend o /app):
    cd /app/backend && python3 ../scripts/check_orders.py Brazza            # tutta la giornata
    cd /app/backend && python3 ../scripts/check_orders.py Brazza 12:00 14:30 # solo finestra oraria
"""

import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv(".env")  # eseguito da /app/backend

from motor.motor_asyncio import AsyncIOMotorClient

ROME = ZoneInfo("Europe/Rome")


def parse_hm(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    location = sys.argv[1]
    h_from = parse_hm(sys.argv[2]) if len(sys.argv) > 2 else (0, 0)
    h_to = parse_hm(sys.argv[3]) if len(sys.argv) > 3 else (23, 59)

    now_rome = datetime.now(ROME)
    start_rome = now_rome.replace(hour=h_from[0], minute=h_from[1], second=0, microsecond=0)
    end_rome = now_rome.replace(hour=h_to[0], minute=h_to[1], second=59, microsecond=999999)
    start_utc = start_rome.astimezone(timezone.utc).isoformat()
    end_utc = end_rome.astimezone(timezone.utc).isoformat()

    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    rest = await db.restaurants.find_one({"location": location}, {"_id": 0, "id": 1})
    if not rest:
        # fallback: prova come username
        rest = await db.restaurants.find_one({"username": location}, {"_id": 0, "id": 1, "location": 1})
        if not rest:
            print(f"Nessun locale trovato con location/username = {location!r}")
            sys.exit(2)
    rid = rest["id"]

    def fmt_rome(iso: str) -> str:
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(ROME).strftime("%H:%M:%S")
        except Exception:
            return iso

    def in_window(iso: str) -> bool:
        return start_utc <= iso <= end_utc

    print(f"\n=== {location} ({rid}) — finestra {h_from[0]:02d}:{h_from[1]:02d} → {h_to[0]:02d}:{h_to[1]:02d} (Rome) ===\n")

    # 1) ORDINI ATTIVI
    actives = await db.orders.find(
        {"restaurant_id": rid, "created_at": {"$gte": start_utc, "$lte": end_utc}},
        {"_id": 0},
    ).sort("order_number", 1).to_list(5000)
    print(f"[ATTIVI] {len(actives)} ordini ancora nel sistema")
    for o in actives:
        print(f"  #{o.get('order_number'):>4}  {fmt_rome(o.get('created_at',''))}  "
              f"status={o.get('status'):<10} hidden_generale={o.get('hidden_generale', False)}  "
              f"desc={o.get('description','')!r}")

    # 2) ORDINI ARCHIVIATI OGGI
    archived = await db.archived_orders.find(
        {"restaurant_id": rid, "created_at": {"$gte": start_utc, "$lte": end_utc}},
        {"_id": 0},
    ).sort("order_number", 1).to_list(5000)
    print(f"\n[ARCHIVIATI] {len(archived)} ordini archiviati (normalmente vuoto se non c'è stato reset)")
    for o in archived:
        print(f"  #{o.get('order_number'):>4}  {fmt_rome(o.get('created_at',''))}  "
              f"status={o.get('status'):<10} desc={o.get('description','')!r}")

    # 3) CANCELLAZIONI
    deletions = await db.deletion_logs.find(
        {"restaurant_id": rid, "deleted_at": {"$gte": start_utc, "$lte": end_utc}},
        {"_id": 0},
    ).sort("deleted_at", 1).to_list(5000)
    print(f"\n[CANCELLAZIONI] {len(deletions)} ordini cancellati nella finestra")
    for d in deletions:
        print(f"  #{d.get('order_number'):>4}  {fmt_rome(d.get('deleted_at',''))}  "
              f"by={d.get('deleted_by','?')!r}  desc={d.get('description','')!r}")

    # 4) MODIFICHE
    mods = await db.modification_logs.find(
        {"restaurant_id": rid, "modified_at": {"$gte": start_utc, "$lte": end_utc}},
        {"_id": 0},
    ).sort("modified_at", 1).to_list(5000)
    print(f"\n[MODIFICHE] {len(mods)} ordini modificati nella finestra")
    for m in mods:
        print(f"  #{m.get('order_number'):>4}  {fmt_rome(m.get('modified_at',''))}  "
              f"{m.get('old_description','')!r} → {m.get('new_description','')!r}")

    # 5) RIASSUNTO numerico per quadrare i conti
    nums_active = {o.get("order_number") for o in actives}
    nums_arch = {o.get("order_number") for o in archived}
    nums_del = {d.get("order_number") for d in deletions}
    nums_all = nums_active | nums_arch | nums_del
    if nums_all:
        max_n = max(n for n in nums_all if isinstance(n, int))
        missing = sorted(set(range(1, max_n + 1)) - nums_all)
        print(f"\n[RIASSUNTO] Massimo numero usato: {max_n} · "
              f"Totale distinti tracciati: {len(nums_all)} · "
              f"Numeri saltati: {missing if missing else 'nessuno'}")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
