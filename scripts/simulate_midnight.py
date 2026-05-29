#!/opt/pastasciutta/backend/venv/bin/python
"""
Simula lo scatto di mezzanotte:
  1. Archivia ORDERS attivi → archived_orders (svuotando la collection live)
  2. Archivia deletion_logs, modification_logs, beverage_sales nelle rispettive
     archived_* (replica del job notturno _atomic_archive_and_clear)
  3. Resetta order_counter = 0 per ogni ristorante
  4. Sposta le righe di OGGI di cash_daily_counts e beverage_daily_counts al
     giorno PRECEDENTE (date_rome = ieri): in questo modo le chiusure di oggi
     diventano "storico" e Report/Magazzino Bevande ripartono da zero domani
  5. Tenta un broadcast WebSocket `daily_reset` ai client connessi tramite
     l'endpoint admin `/api/admin/_simulate-midnight-reset` (se backend in
     esecuzione locale).

Esecuzione (sul VPS):
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/simulate_midnight.py
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/simulate_midnight.py --yes
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/simulate_midnight.py --no-shift
      (eseguono archive degli ordini ma NON spostano le righe cash/beverage)

ATTENZIONE: operazione NON reversibile (gli ordini attivi finiscono in archived_orders).
"""
import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient


def _archive_and_clear(db, src_name: str, dst_name: str) -> int:
    """Sposta tutti i documenti da src_name a dst_name; ritorna il count spostato."""
    docs = list(db[src_name].find({}))
    if not docs:
        return 0
    # Strip _id per evitare duplicati nel dest
    for d in docs:
        d.pop('_id', None)
    db[dst_name].insert_many(docs)
    db[src_name].delete_many({})
    return len(docs)


def main() -> int:
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
        print('[ERRORE] MONGO_URL o DB_NAME non trovati.')
        return 1

    client = MongoClient(mongo_url)
    db = client[db_name]

    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    counts = {
        'orders attivi'         : db.orders.count_documents({}),
        'deletion_logs'         : db.deletion_logs.count_documents({}),
        'modification_logs'     : db.modification_logs.count_documents({}),
        'beverage_sales'        : db.beverage_sales.count_documents({}),
        'cash_daily_counts oggi': db.cash_daily_counts.count_documents({'date_rome': today}),
        'beverage_daily_counts oggi': db.beverage_daily_counts.count_documents({'date_rome': today}),
    }

    print('=' * 60)
    print(f'SIMULA MEZZANOTTE — {datetime.now().isoformat(timespec="seconds")}')
    print('=' * 60)
    print(f'Database  : {db_name}')
    print(f'Oggi      : {today}')
    print(f'Ieri      : {yesterday}')
    print('Stato attuale:')
    for k, v in counts.items():
        print(f'  - {k:30s}: {v}')
    no_shift = '--no-shift' in sys.argv
    if no_shift:
        print('\nFlag --no-shift: salterò lo spostamento cash/beverage daily.')

    if '--yes' not in sys.argv:
        ans = input('\nProcedere? Scrivi SI per confermare: ').strip()
        if ans != 'SI':
            print('Annullato.')
            return 0

    # 1. Archive orders & logs (replica _atomic_archive_and_clear)
    moved_orders = _archive_and_clear(db, 'orders', 'archived_orders')
    moved_del    = _archive_and_clear(db, 'deletion_logs', 'archived_deletion_logs')
    moved_mod    = _archive_and_clear(db, 'modification_logs', 'archived_modification_logs')
    moved_bevsl  = _archive_and_clear(db, 'beverage_sales', 'archived_beverage_sales')

    # 2. Reset counter ordini
    res_cnt = db.restaurants.update_many({}, {'$set': {'order_counter': 0}})

    # 3. Sposta cash/beverage daily di oggi → ieri (rollover di giornata)
    moved_cash = 0
    moved_bev = 0
    if not no_shift:
        for d in list(db.cash_daily_counts.find({'date_rome': today}, {'_id': 0})):
            rid = d.get('restaurant_id')
            if not rid:
                continue
            d['date_rome'] = yesterday
            db.cash_daily_counts.update_one(
                {'restaurant_id': rid, 'date_rome': yesterday},
                {'$set': d}, upsert=True,
            )
            db.cash_daily_counts.delete_one({'restaurant_id': rid, 'date_rome': today})
            moved_cash += 1
        for d in list(db.beverage_daily_counts.find({'date_rome': today}, {'_id': 0})):
            rid = d.get('restaurant_id')
            sigla = d.get('sigla')
            if not rid or not sigla:
                continue
            d['date_rome'] = yesterday
            db.beverage_daily_counts.update_one(
                {'restaurant_id': rid, 'date_rome': yesterday, 'sigla': sigla},
                {'$set': d}, upsert=True,
            )
            db.beverage_daily_counts.delete_one(
                {'restaurant_id': rid, 'date_rome': today, 'sigla': sigla}
            )
            moved_bev += 1

    print('\nRisultato:')
    print(f'  - orders archiviati          : {moved_orders}')
    print(f'  - deletion_logs archiviati   : {moved_del}')
    print(f'  - modification_logs archiviati: {moved_mod}')
    print(f'  - beverage_sales archiviati  : {moved_bevsl}')
    print(f'  - restaurants order_counter reset: {res_cnt.modified_count}')
    if not no_shift:
        print(f'  - cash rows oggi→ieri        : {moved_cash}')
        print(f'  - beverage rows oggi→ieri    : {moved_bev}')
    print('\nFatto. Suggerimento: fai un hard refresh nei tablet/monitor connessi.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
