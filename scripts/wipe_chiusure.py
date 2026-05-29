#!/opt/pastasciutta/backend/venv/bin/python
"""
Cancella TUTTE le chiusure (cash_daily_counts + beverage_daily_counts) e tutto
l'audit log (cash_audit_log). Dopo l'esecuzione:
  - /storico-chiusure sarà vuoto
  - /audit-cassa sarà vuoto
  - Report Cassa e Magazzino Bevande di tutti i locali ripartono da zero (anche
    la Mattina perché viene dalla Sera di ieri che non esiste più)

Esecuzione (sul VPS):
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/wipe_chiusure.py

Usa --yes per saltare la conferma interattiva.
ATTENZIONE: l'operazione NON è reversibile.
"""
import os
import sys
from datetime import datetime
from dotenv import load_dotenv
from pymongo import MongoClient


def main() -> int:
    # Carica .env del backend (path tipico VPS)
    env_paths = [
        '/opt/pastasciutta/backend/.env',
        '/app/backend/.env',
        os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'),
    ]
    for p in env_paths:
        if os.path.isfile(p):
            load_dotenv(p)
            break

    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME')
    if not mongo_url or not db_name:
        print('[ERRORE] MONGO_URL o DB_NAME non trovati. Verifica .env del backend.')
        return 1

    client = MongoClient(mongo_url)
    db = client[db_name]

    counts_before = {
        'cash_daily_counts': db.cash_daily_counts.count_documents({}),
        'beverage_daily_counts': db.beverage_daily_counts.count_documents({}),
        'cash_audit_log': db.cash_audit_log.count_documents({}),
    }

    print('=' * 60)
    print('WIPE CHIUSURE — Pastasciutta Roma')
    print('=' * 60)
    print(f'Data ora corrente : {datetime.now().isoformat(timespec="seconds")}')
    print(f'Database          : {db_name}')
    print('Documenti da cancellare:')
    for k, v in counts_before.items():
        print(f'  - {k:25s}: {v}')
    if sum(counts_before.values()) == 0:
        print('\n[INFO] Niente da cancellare. Esco.')
        return 0

    if '--yes' not in sys.argv:
        ans = input('\nProcedere con la cancellazione? Scrivi SI per confermare: ').strip()
        if ans != 'SI':
            print('Annullato.')
            return 0

    r1 = db.cash_daily_counts.delete_many({})
    r2 = db.beverage_daily_counts.delete_many({})
    r3 = db.cash_audit_log.delete_many({})

    print('\nCancellate:')
    print(f'  - cash_daily_counts     : {r1.deleted_count}')
    print(f'  - beverage_daily_counts : {r2.deleted_count}')
    print(f'  - cash_audit_log        : {r3.deleted_count}')
    print('\nFatto. Ricarica le pagine /storico-chiusure e /audit-cassa nel browser.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
