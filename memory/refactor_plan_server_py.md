# Piano refactor `server.py` (4483 → ~250 righe in `server.py` + 12-13 router)

**Stato attuale**: 95 endpoint, 29 modelli Pydantic, 4483 righe in unico file.

**Garanzie trasversali**:
- Nessun cambio di path API (`/api/...` invariati) → tablet già connessi continuano a funzionare.
- Nessun cambio di schema DB.
- Backup `server.py.backup-pre-split` salvato in sessione 1.
- `testing_agent_v3_fork` obbligatorio prima del finish di ogni sessione.
- Ogni sessione è deployabile da sola.

---

## Sessione 1 — Fondamenta (`core/` + `models/`)

Solo spostamento moduli condivisi, niente endpoint si muove.

```
backend/core/
├── auth.py       # verify_token, SECRET_KEY, ALGORITHM, pwd_context, security
├── db.py         # client Motor, db, indici, RESTAURANT_LOCATION_CACHE
├── timezones.py  # ROME_TZ, _today_rome_str, _today_rome_bounds_utc, _now_rome_iso
├── deps.py       # _effective_restaurant_id, helper condivisi
├── ws_manager.py # ConnectionManager + istanza `manager` (singolo punto)
└── audit.py      # _audit_diff_cash, _audit_diff_beverages

backend/models/   # un file per dominio
├── auth.py       # LoginRequest, RestaurantResponse, ...
├── orders.py
├── beverages.py
├── cash.py
├── carichi.py
├── richieste.py
├── products.py
├── invoices.py
├── chiusure.py
├── suppliers.py
└── versamenti.py
```

**Effetto**: `server.py` 4483 → ~3700 righe.
**Rischio principale**: circular imports. Mitigazione: `core/` strict-layered, non importa router.
**Test**: smoke auth + ordini + cash report.

---

## Sessione 2 — Router core business (~50 endpoint)

```
backend/routers/
├── orders.py     # 13 endpoint /orders/*
├── beverages.py  # 12 endpoint /beverages/*
├── cash.py       # 2 endpoint /cash/* + audit hooks
└── admin.py      # 12 endpoint /admin/* (diagnostics, closures, audit-log, cleanup, simulate-midnight)
```

Wire-up in `server.py`:
```python
from routers import orders, beverages, cash, admin
api_router.include_router(orders.router)
api_router.include_router(beverages.router)
api_router.include_router(cash.router)
api_router.include_router(admin.router)
```

**Effetto**: `server.py` ~3700 → ~1700 righe.
**Rischio principale**: doppia istanza `manager` WebSocket → broadcast vuoti. Mitigazione: importare SEMPRE da `core/ws_manager.py`.
**Test**: full flow Cassa → Bollitore → Generale → Report → Audit + `/admin/_simulate-midnight-reset`.

---

## Sessione 3 — Magazzino + tasks + finitura (resto ~45 endpoint)

```
backend/routers/
├── carichi.py
├── richieste.py
├── products.py
├── invoices.py
├── chiusure.py
├── suppliers.py
├── versamenti.py
├── logs.py             # modification_logs, deletion_logs
├── analisi.py
├── restaurants.py
├── closures_yesterday.py
└── ws.py               # opzionale: /ws/{restaurant_id}

backend/tasks/
├── midnight.py         # midnight_reset, cleanup_old_uploads, _atomic_archive_and_clear
├── stale_orders.py     # recover_stale_orders
└── scheduler.py        # bootstrap APScheduler + startup events
```

**Resta in `server.py`** (~250 righe finali):
- Creazione `FastAPI` app
- CORS / Gzip / static `/uploads`
- Middleware logging diagnostico
- `@app.on_event("startup")` → `tasks.scheduler.start()` + `recover_stale_orders()` + seed Federico
- `app.include_router(api_router)` con tutti i router
- Endpoint `/` e `/api/version`

**Effetto finale**:
```
server.py     ~250 righe
core/*.py     ~600 righe totali
models/*.py   ~400 righe totali
routers/*.py  ~3000 righe (12-13 file da 100-300 righe)
tasks/*.py    ~250 righe totali
```

**Rischio principale**: middleware logging usa `RESTAURANT_LOCATION_CACHE` ora in `core/db.py`. Errore solo cosmetico se sbagliato.
**Test**: full regression magazzino + verifica log scheduler `Next midnight reset in N seconds`.

---

## Tabella di marcia

| Tappa | server.py | Endpoint spostati | Deployabile |
|---|---|---|---|
| Pre | 4483 | 0 | — |
| Dopo S1 | ~3700 | 0 | ✅ |
| Dopo S2 | ~1700 | 50 | ✅ |
| Dopo S3 | ~250 | 95 | ✅ |
