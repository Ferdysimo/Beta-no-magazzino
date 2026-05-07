#!/usr/bin/env python3
"""
Reset Analisi Magazzino — riporta a 0 tutti i valori della pagina Analisi.

Cosa fa:
  1) Cancella TUTTI i documenti in `carichi_magazzino` (azzera "Quantità entrate")
  2) Cancella TUTTE le richieste con status "evasa" o "confermata"
     (azzera "Trasporti a [locale]")

Cosa NON tocca:
  - Inventario corrente (`products.stock`)
  - Richieste pending o in errore
  - Ordini, archivi, bevande, anagrafica fornitori/prodotti

Uso:
  python reset_analisi.py             # dry-run, mostra solo cosa farebbe
  python reset_analisi.py --apply     # esegue davvero, chiede conferma "SI"
  python reset_analisi.py --apply -y  # esegue senza chiedere conferma
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
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
    skip_confirm = "-y" in sys.argv

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    n_carichi = await db.carichi_magazzino.count_documents({})
    n_richieste = await db.richieste.count_documents(
        {"status": {"$in": ["evasa", "confermata"]}}
    )

    print("=" * 60)
    print(f"DB: {DB_NAME}")
    print(f"Data: {datetime.now(timezone.utc).isoformat()}")
    print("-" * 60)
    print(f"  carichi_magazzino da cancellare: {n_carichi}")
    print(f"  richieste evase/confermate da cancellare: {n_richieste}")
    print("-" * 60)

    if not apply:
        print("DRY-RUN — nessuna modifica eseguita.")
        print("Esegui con `--apply` per procedere.")
        client.close()
        return

    if not skip_confirm:
        print()
        print("ATTENZIONE: l'operazione e' IRREVERSIBILE.")
        ans = input("Scrivi 'SI' per confermare: ").strip()
        if ans != "SI":
            print("Annullato.")
            client.close()
            return

    res1 = await db.carichi_magazzino.delete_many({})
    res2 = await db.richieste.delete_many(
        {"status": {"$in": ["evasa", "confermata"]}}
    )

    print()
    print("FATTO:")
    print(f"  carichi_magazzino cancellati: {res1.deleted_count}")
    print(f"  richieste cancellate:         {res2.deleted_count}")
    print()
    print("La pagina Analisi ora mostrera' 0 su tutte le righe del periodo.")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
