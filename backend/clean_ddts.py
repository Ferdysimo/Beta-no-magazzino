"""Wipe all DDTs (richieste merce) and reset the DDT counter to 0.

Usage on VPS:
    cd /opt/pastasciutta/backend && venv/bin/python clean_ddts.py

Asks for confirmation before deleting. After this:
- All `richieste` documents are removed (active + history).
- The global DDT counter is reset to 0, so the next created DDT will be #1.
- This does NOT touch orders, archived_orders, products, carichi, fatture, etc.
"""
import os
import sys
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

if not MONGO_URL or not DB_NAME:
    print("ERROR: MONGO_URL or DB_NAME not set in .env", file=sys.stderr)
    sys.exit(1)


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    total = await db.richieste.count_documents({})
    counter_doc = await db.counters.find_one({"_id": "ddt_number"})
    current_counter = int(counter_doc["value"]) if counter_doc else 0

    print("=" * 60)
    print(f"DB: {DB_NAME}")
    print(f"Richieste/DDT presenti: {total}")
    print(f"Contatore DDT attuale: {current_counter}")
    print("=" * 60)

    if total == 0 and current_counter == 0:
        print("Niente da pulire. Esco.")
        client.close()
        return

    answer = input(
        "\nDigita 'CONFERMA' per cancellare TUTTE le richieste e azzerare il "
        "contatore DDT (irreversibile): "
    ).strip()
    if answer != "CONFERMA":
        print("Operazione annullata.")
        client.close()
        return

    res_richieste = await db.richieste.delete_many({})
    res_counter = await db.counters.update_one(
        {"_id": "ddt_number"},
        {"$set": {"value": 0}},
        upsert=True,
    )
    print()
    print(f"  Cancellate {res_richieste.deleted_count} richieste.")
    print(f"  Contatore DDT azzerato (matched={res_counter.matched_count}, "
          f"upserted={res_counter.upserted_id is not None}).")
    print("\nFatto. Il prossimo DDT creato sarà #1.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
