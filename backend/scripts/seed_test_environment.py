"""Create accounts in an explicitly isolated test database."""

import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import client, db  # noqa: E402
from app.core.security import pwd_context  # noqa: E402


ALLOWED_DB_PREFIXES = ("pastasciutta_p0_live_test_", "pastasciutta_refactor_test_")


async def main(drop_only: bool = False) -> None:
    db_name = os.environ.get("DB_NAME", "")
    if not db_name.startswith(ALLOWED_DB_PREFIXES):
        raise SystemExit("Refusing to seed a database without an isolated test prefix")

    if drop_only:
        await client.drop_database(db_name)
        client.close()
        print(f"Dropped isolated database: {db_name}")
        return

    password = os.environ.get("PASTA_TEST_PASSWORD", "")
    if len(password) < 12:
        raise SystemExit("PASTA_TEST_PASSWORD must contain at least 12 characters")

    await client.drop_database(db_name)
    now = datetime.now(timezone.utc).isoformat()
    accounts = (
        ("Admin", "Amministratore", "Amministrazione", "admin", 1),
        ("Simone", "Simone", "Amministrazione", "admin", 1),
        ("Federico", "Supervisore", "Supervisione", "supervisor", 1),
        ("Flaminio", "Pastasciutta Roma", "Flaminio", "restaurant", 2),
        ("Grazie", "Pastasciutta Roma", "Grazie", "restaurant", 1),
        ("Brazza", "Pastasciutta Roma", "Largo di Brazz\u00e0", "restaurant", 1),
        ("Magazziniere", "Magazziniere", "Magazzino", "magazzino", 1),
    )
    await db.restaurants.insert_many([
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "username": username,
            "password": pwd_context.hash(password),
            "location": location,
            "role": role,
            "token_version": 2 if username == "Simone" else 1,
            "boiler_count": boiler_count,
            "created_at": now,
            "order_counter": 0,
        }
        for username, name, location, role, boiler_count in accounts
    ])
    client.close()
    print(f"Seeded isolated database: {db_name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--drop-only",
        action="store_true",
        help="Drop the isolated test database without seeding it again",
    )
    args = parser.parse_args()
    asyncio.run(main(drop_only=args.drop_only))
