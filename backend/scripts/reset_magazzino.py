"""
Reset del magazzino — Cancella tutti i dati di test, mantiene prodotti+fornitori.

Cosa fa:
  • Cancella tutte le richieste merce (incluse DDT interni)
  • Cancella tutti i carichi magazzino + elimina le foto DDT dal disco
  • Azzera la quantità di tutti i prodotti a 0
  • Resetta il contatore DDT globale a 0 (prossima richiesta sarà #1)
  • Mantiene INTATTI: lista prodotti (nomi, foto, unità, fornitori) e lista fornitori

Uso sul VPS:
  cd /opt/pastasciutta/backend
  ./venv/bin/python scripts/reset_magazzino.py
"""
import asyncio
import os
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
UPLOADS_DIR = BACKEND_DIR.parent / "uploads"


async def main():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"[reset_magazzino] DB: {db_name}")
    print()

    # 1) Collect photo filenames BEFORE deleting carichi (so we can remove them from disk)
    photo_files = []
    async for c in db.carichi_magazzino.find({}, {"photo_file": 1, "_id": 0}):
        if c.get("photo_file"):
            photo_files.append(c["photo_file"])
    print(f"Foto DDT da eliminare dal disco: {len(photo_files)}")

    # 2) Delete richieste
    r1 = await db.richieste.delete_many({})
    print(f"Richieste cancellate: {r1.deleted_count}")

    # 3) Delete carichi
    r2 = await db.carichi_magazzino.delete_many({})
    print(f"Carichi cancellati: {r2.deleted_count}")

    # 4) Delete photo files from disk
    removed = 0
    for fname in photo_files:
        p = UPLOADS_DIR / fname
        try:
            if p.exists():
                p.unlink()
                removed += 1
        except Exception as e:
            print(f"  ! Impossibile eliminare {fname}: {e}")
    print(f"File foto rimossi dal disco: {removed}/{len(photo_files)}")

    # 5) Reset product quantities
    r3 = await db.products.update_many({}, {"$set": {"quantity": 0}})
    print(f"Prodotti azzerati: {r3.modified_count}")

    # 6) Reset DDT counter
    await db.counters.delete_many({"_id": "ddt_number"})
    print("Contatore DDT resettato (prossimo DDT = #1)")

    print()
    print("[reset_magazzino] ✅ Fatto.")


if __name__ == "__main__":
    asyncio.run(main())
