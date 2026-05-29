#!/opt/pastasciutta/backend/venv/bin/python
"""
Simula lo scatto di mezzanotte LIMITATO al REPORT.
Sposta le righe di OGGI di:
  - cash_daily_counts      (Report Cassa)
  - beverage_daily_counts  (Magazzino Bevande / Magazzino Sera)
al giorno PRECEDENTE (date_rome = ieri).

In questo modo:
  - le chiusure di oggi diventano "storico" (visibili in /storico-chiusure e /report-ieri)
  - il Report Cassa e il Magazzino Bevande di tutti i locali ripartono da zero
  - la MATTINA del giorno nuovo viene auto-popolata con la SERA appena spostata (carry-over)

NON tocca: ordini attivi/archiviati, deletion_logs, modification_logs, beverage_sales,
            order_counter, audit_log.

Esecuzione (sul VPS):
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/simulate_midnight.py
  /opt/pastasciutta/backend/venv/bin/python /opt/pastasciutta/backend/scripts/simulate_midnight.py --yes

ATTENZIONE: operazione NON reversibile.
"""
import os
import sys
from datetime import datetime, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient


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

    cash_today = db.cash_daily_counts.count_documents({'date_rome': today})
    bev_today = db.beverage_daily_counts.count_documents({'date_rome': today})

    print('=' * 60)
    print(f'SIMULA MEZZANOTTE (solo Report) — {datetime.now().isoformat(timespec="seconds")}')
    print('=' * 60)
    print(f'Database : {db_name}')
    print(f'Oggi     : {today}')
    print(f'Ieri     : {yesterday}')
    print()
    print('Da spostare (oggi → ieri):')
    print(f'  - cash_daily_counts     : {cash_today}')
    print(f'  - beverage_daily_counts : {bev_today}')

    if cash_today == 0 and bev_today == 0:
        print('\n[INFO] Nessuna chiusura di oggi da spostare. Esco.')
        return 0

    if '--yes' not in sys.argv:
        ans = input('\nProcedere? Scrivi SI per confermare: ').strip()
        if ans != 'SI':
            print('Annullato.')
            return 0

    # Sposta cash_daily di oggi → ieri (chiave: restaurant_id + date_rome)
    moved_cash = 0
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

    # Sposta beverage_daily di oggi → ieri (chiave: restaurant_id + date_rome + sigla)
    moved_bev = 0
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
    print(f'  - cash rows oggi → ieri    : {moved_cash}')
    print(f'  - beverage rows oggi → ieri: {moved_bev}')
    print('\nFatto. Le chiusure di oggi sono ora visibili nello Storico Chiusure.')
    print('Il Report e il Magazzino Bevande di domani partiranno da zero (Mattina auto-popolata).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
