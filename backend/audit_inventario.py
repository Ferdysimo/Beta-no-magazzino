#!/usr/bin/env python3
"""
Audit Inventario Magazzino — READ-ONLY, non modifica nulla.

Per ogni prodotto ricalcola lo stock atteso a partire da:
  + somma di tutti i `carichi_magazzino` (items.quantity_added)
  - somma di tutte le richieste evase/confermate (items.quantity)

E lo confronta con `products.quantity` attuale.

Se i due valori coincidono => l'inventario e' MATEMATICAMENTE coerente.
Se differiscono => puo' essere uno dei seguenti casi NON-bug:
  - stock iniziale impostato manualmente all'avvio del sistema
  - override Admin via "Forza il sistema" (PATCH /products/{id}/quantity)
  - richieste in stato "errore" (la merce e' uscita ma il locale ha contestato)

Uso:
  ./venv/bin/python audit_inventario.py            # report tutti i prodotti
  ./venv/bin/python audit_inventario.py --diff     # solo prodotti con discrepanza
"""
import asyncio
import os
import sys
from pathlib import Path
from collections import defaultdict

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
    only_diff = "--diff" in sys.argv
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    products_by_id = {p["id"]: p for p in products}

    # Sum incoming per product
    incoming = defaultdict(int)
    async for c in db.carichi_magazzino.find({}, {"_id": 0, "items": 1}):
        for it in c.get("items", []):
            incoming[it["product_id"]] += int(it.get("quantity_added", 0))

    # Sum outgoing per product (evasa + confermata, ovvero merce uscita)
    outgoing = defaultdict(int)
    n_errore = 0
    async for r in db.richieste.find(
        {"status": {"$in": ["evasa", "confermata"]}},
        {"_id": 0, "items": 1, "status": 1},
    ):
        for it in r.get("items", []):
            outgoing[it["product_id"]] += int(it.get("quantity", 0))

    n_errore = await db.richieste.count_documents({"status": "errore"})

    rows = []
    for pid, p in products_by_id.items():
        actual = int(p.get("quantity", 0))
        expected_from_movements = incoming[pid] - outgoing[pid]
        diff = actual - expected_from_movements
        rows.append({
            "name": p.get("name", "?"),
            "supplier": p.get("supplier", ""),
            "actual": actual,
            "in": incoming[pid],
            "out": outgoing[pid],
            "expected_from_movements": expected_from_movements,
            "diff": diff,
        })

    rows.sort(key=lambda r: (-abs(r["diff"]), r["name"]))

    print("=" * 100)
    print(f"AUDIT INVENTARIO  —  DB: {DB_NAME}")
    print("=" * 100)
    print(f"Prodotti totali:                {len(rows)}")
    print(f"Prodotti coerenti (diff = 0):   {sum(1 for r in rows if r['diff'] == 0)}")
    print(f"Prodotti con discrepanza:       {sum(1 for r in rows if r['diff'] != 0)}")
    print(f"Richieste in stato 'errore' (da risolvere a mano): {n_errore}")
    print("-" * 100)
    print(f"{'Prodotto':<40} {'Stock':>6} {'Carichi':>8} {'Uscite':>8} {'Atteso':>8} {'Diff':>6}")
    print("-" * 100)
    shown = 0
    for r in rows:
        if only_diff and r["diff"] == 0:
            continue
        flag = ""
        if r["diff"] > 0:
            flag = "  (extra: stock iniziale o forzatura admin)"
        elif r["diff"] < 0:
            flag = "  (mancante: forzatura admin in giu', errore o richiesta cancellata)"
        print(f"{r['name'][:40]:<40} {r['actual']:>6} {r['in']:>8} {r['out']:>8} "
              f"{r['expected_from_movements']:>8} {r['diff']:>+6}{flag}")
        shown += 1

    if only_diff and shown == 0:
        print("Nessuna discrepanza. L'inventario e' perfettamente in linea con i movimenti registrati.")

    print("-" * 100)
    print("INTERPRETAZIONE:")
    print("  diff = 0  -> inventario perfetto su questo prodotto")
    print("  diff > 0  -> hai piu' stock di quanto suggeriscano carichi-richieste")
    print("               (= stock iniziale di partenza o forzatura admin verso l'alto)")
    print("  diff < 0  -> hai meno stock del previsto")
    print("               (= forzatura admin verso il basso, errori non risolti, oppure")
    print("                  un carico cancellato dopo che la merce era gia' uscita)")
    print()
    print("Se la maggior parte dei prodotti ha diff = 0 e quelli con diff != 0")
    print("hanno una spiegazione (stock iniziale, forzature note), il sistema funziona bene.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
