#!/usr/bin/env python3
"""
Backfill `stock_movements` ledger from existing carichi/richieste data.

Esegue una RICOSTRUZIONE STORICA del ledger a partire dai dati gia' presenti:
  - per ogni `carichi_magazzino`  -> 1 movimento "carico" (+N) per ogni item
  - per ogni `richieste` evase/confermate -> 1 movimento "evasione" (-N) per ogni item

Ordina cronologicamente (per `created_at` o `evasa_at`) e calcola il
`balance_after` di ogni movimento. Se al termine il bilancio ricostruito
non corrisponde a `products.quantity` corrente, inserisce un singolo
movimento di rettifica "stock_iniziale" all'inizio della timeline per
allineare i due valori (rappresenta lo stock di partenza inserito a mano
prima dell'introduzione del ledger).

ATTENZIONE: cancella e ricostruisce TUTTI i movimenti generati automaticamente.
Movimenti con causale "forzatura_admin" inseriti dopo il deploy del ledger
NON vengono toccati.

Uso:
  ./venv/bin/python backfill_stock_ledger.py            # dry-run
  ./venv/bin/python backfill_stock_ledger.py --apply    # esegue
"""
import asyncio
import os
import sys
import uuid
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

if not MONGO_URL or not DB_NAME:
    print("ERRORE: MONGO_URL o DB_NAME mancanti in backend/.env")
    sys.exit(1)


async def main():
    apply = "--apply" in sys.argv
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # --- Collect events ---
    events = []  # list of (timestamp, kind, product_id, delta, ref_id, note, product_name)

    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    products_by_id = {p["id"]: p for p in products}

    async for c in db.carichi_magazzino.find({}, {"_id": 0}):
        ts = c.get("created_at")
        if not ts:
            continue
        for it in c.get("items", []):
            qty = int(it.get("quantity_added", 0))
            if qty:
                events.append((
                    ts, "carico", it["product_id"], qty, c["id"],
                    c.get("supplier_name", ""),
                    products_by_id.get(it["product_id"], {}).get("name", ""),
                ))

    async for r in db.richieste.find(
        {"status": {"$in": ["evasa", "confermata"]}}, {"_id": 0}
    ):
        ts = r.get("evasa_at") or r.get("created_at")
        if not ts:
            continue
        for it in r.get("items", []):
            qty = int(it.get("quantity", 0))
            if qty:
                events.append((
                    ts, "evasione", it["product_id"], -qty, r["id"],
                    f"DDT {r.get('ddt_number', '')} -> {r.get('restaurant_location', '')}",
                    products_by_id.get(it["product_id"], {}).get("name", ""),
                ))

    events.sort(key=lambda e: e[0])

    # --- Reconstruct per-product running balance ---
    running = defaultdict(int)
    movements = []
    for ts, kind, pid, delta, ref_id, note, pname in events:
        running[pid] += delta
        movements.append({
            "id": str(uuid.uuid4()),
            "product_id": pid,
            "product_name": pname,
            "delta": delta,
            "balance_after": running[pid],
            "cause": kind,
            "ref_type": "carico" if kind == "carico" else "richiesta",
            "ref_id": ref_id,
            "user_id": "",
            "user_name": "(backfill)",
            "user_role": "system",
            "note": note,
            "timestamp": ts,
        })

    # --- Detect mismatches and prepend stock_iniziale entries ---
    initial_entries = []
    discrepancies = 0
    for pid, p in products_by_id.items():
        actual = int(p.get("quantity", 0))
        reconstructed = running.get(pid, 0)
        gap = actual - reconstructed
        if gap != 0:
            discrepancies += 1
            # Add an opening entry with timestamp slightly before the earliest event
            ts_first = "2020-01-01T00:00:00+00:00"
            initial_entries.append({
                "id": str(uuid.uuid4()),
                "product_id": pid,
                "product_name": p.get("name", ""),
                "delta": gap,
                "balance_after": gap,  # opening balance
                "cause": "stock_iniziale",
                "ref_type": "backfill",
                "ref_id": pid,
                "user_id": "",
                "user_name": "(backfill)",
                "user_role": "system",
                "note": "Stock iniziale (rettifica per allineare a inventario corrente)",
                "timestamp": ts_first,
            })
            # adjust subsequent balance_after for this product
            for m in movements:
                if m["product_id"] == pid:
                    m["balance_after"] += gap

    final_movements = initial_entries + movements

    print("=" * 70)
    print(f"BACKFILL STOCK LEDGER  —  DB: {DB_NAME}")
    print("=" * 70)
    print(f"Prodotti totali:                        {len(products_by_id)}")
    print(f"Movimenti ricostruiti dai carichi:      {sum(1 for e in events if e[1] == 'carico')}")
    print(f"Movimenti ricostruiti dalle evasioni:   {sum(1 for e in events if e[1] == 'evasione')}")
    print(f"Voci 'stock_iniziale' di rettifica:     {len(initial_entries)} (prodotti con gap)")
    print(f"TOTALE movimenti da scrivere:           {len(final_movements)}")
    print("-" * 70)

    if not apply:
        print("DRY-RUN — nessuna modifica eseguita.")
        print("Esegui con `--apply` per popolare il ledger.")
        client.close()
        return

    # Wipe automatic-cause entries; preserve any forzatura_admin already logged.
    res_wipe = await db.stock_movements.delete_many(
        {"cause": {"$in": ["carico", "carico_modifica", "carico_cancellato",
                            "evasione", "stock_iniziale"]}}
    )
    print(f"Movimenti pre-esistenti rimossi: {res_wipe.deleted_count}")

    if final_movements:
        # insert in chunks
        BATCH = 1000
        inserted = 0
        for i in range(0, len(final_movements), BATCH):
            chunk = final_movements[i:i+BATCH]
            await db.stock_movements.insert_many(chunk, ordered=False)
            inserted += len(chunk)
        print(f"Movimenti inseriti: {inserted}")

    # ensure indexes exist
    await db.stock_movements.create_index([("product_id", 1), ("timestamp", -1)])
    await db.stock_movements.create_index([("timestamp", -1)])
    await db.stock_movements.create_index([("cause", 1), ("timestamp", -1)])

    print()
    print("FATTO. Il ledger e' allineato all'inventario corrente.")
    print("Da ora in poi, ogni nuova mutazione di stock generera' una voce automatica.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
