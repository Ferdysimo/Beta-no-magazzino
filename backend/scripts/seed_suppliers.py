"""
Seed Suppliers - Cancella tutti i fornitori esistenti e inserisce la lista ufficiale.

Uso sul VPS:
  cd /opt/pastasciutta/backend
  ./venv/bin/python scripts/seed_suppliers.py
"""
import asyncio
import os
import uuid
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Carica .env dalla cartella backend (un livello sopra /scripts)
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

SUPPLIERS = [
    "Artokart",
    "BARTOLINI TARGHE",
    "Bombelli",
    "Bricofer",
    "Ceracchi",
    "Copystore",
    "Cremona",
    "Demetra",
    "Derrate",
    "Edil cimini",
    "Euronics",
    "Faic",
    "Farmacia guarnacci",
    "Fiorucci",
    "Frigo panichi srl",
    "Gallo",
    "Gioia",
    "Golmar",
    "GPS bags",
    "iCash",
    "Ikea",
    "Inkoffice",
    "Lavaservice",
    "Leroy Merlin",
    "Mauceri ferramenta",
    "Mr Carni",
    "Nova SRL",
    "PAMA ROMA",
    "Pelli Francesca",
    "Pestone srl",
    "Pinna",
    "Pratesi Hotel Division",
    "Prodotti Plastici",
    "Ragù (Pastasciutta)",
    "Scalificio Monaca",
    "Scatolificio del garda",
    "Silversti e fabi",
    "Siver",
    "Tabriz tappeti",
    "Viander",
    "Your Music",
]


async def main():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    print(f"[seed_suppliers] Connessione a DB: {db_name}")

    existing = await db.suppliers.count_documents({})
    print(f"[seed_suppliers] Fornitori esistenti: {existing}")

    deleted = await db.suppliers.delete_many({})
    print(f"[seed_suppliers] Cancellati: {deleted.deleted_count}")

    docs = [{"id": str(uuid.uuid4()), "name": name} for name in SUPPLIERS]
    await db.suppliers.insert_many(docs)
    print(f"[seed_suppliers] Inseriti: {len(docs)}")

    total = await db.suppliers.count_documents({})
    print(f"[seed_suppliers] Totale ora: {total}")


if __name__ == "__main__":
    asyncio.run(main())
