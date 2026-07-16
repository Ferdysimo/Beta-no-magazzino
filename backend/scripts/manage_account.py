"""Offline account management CLI.

Run from the backend directory on a trusted shell, never through HTTP:
    python scripts/manage_account.py set-password --username Simone
"""

import argparse
import asyncio
import getpass
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import client, db  # noqa: E402
from app.core.config import SIMONE_MIN_TOKEN_VERSION  # noqa: E402
from app.core.security import pwd_context  # noqa: E402


ROLES = ("restaurant", "magazzino", "supervisor", "admin")


def _read_password() -> str:
    password = getpass.getpass("Nuova password (minimo 12 caratteri): ")
    confirmation = getpass.getpass("Ripeti la password: ")
    if password != confirmation:
        raise SystemExit("Le password non coincidono")
    if len(password) < 12:
        raise SystemExit("La password deve contenere almeno 12 caratteri")
    return password


async def _set_password(username: str) -> None:
    account = await db.restaurants.find_one({"username": username})
    if not account:
        raise SystemExit(f"Account non trovato: {username}")
    password = _read_password()
    next_version = int(account.get("token_version") or 1) + 1
    await db.restaurants.update_one(
        {"id": account["id"]},
        {
            "$set": {
                "password": pwd_context.hash(password),
                "token_version": next_version,
                "credentials_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    print(
        f"Password aggiornata per {username}. I JWT gia emessi restano validi "
        "fino a scadenza o alla rotazione di JWT_SECRET."
    )


async def _create_account(args: argparse.Namespace) -> None:
    if await db.restaurants.find_one({"username": args.username}):
        raise SystemExit(f"Username gia esistente: {args.username}")
    password = _read_password()
    now = datetime.now(timezone.utc).isoformat()
    await db.restaurants.insert_one(
        {
            "id": str(uuid.uuid4()),
            "name": args.name,
            "username": args.username,
            "password": pwd_context.hash(password),
            "location": args.location,
            "role": args.role,
            "token_version": SIMONE_MIN_TOKEN_VERSION if args.username == "Simone" else 1,
            "boiler_count": 1,
            "created_at": now,
            "credentials_updated_at": now,
            "order_counter": 0,
        }
    )
    print(f"Account creato: {args.username} ({args.role})")


async def _run(args: argparse.Namespace) -> None:
    try:
        if args.command == "set-password":
            await _set_password(args.username)
        elif args.command == "create":
            await _create_account(args)
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Gestione account offline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    password_parser = subparsers.add_parser("set-password")
    password_parser.add_argument("--username", required=True)

    create_parser = subparsers.add_parser("create")
    create_parser.add_argument("--username", required=True)
    create_parser.add_argument("--name", required=True)
    create_parser.add_argument("--location", required=True)
    create_parser.add_argument("--role", choices=ROLES, required=True)

    asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    main()
