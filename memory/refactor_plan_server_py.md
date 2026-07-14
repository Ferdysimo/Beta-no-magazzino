# Piano refactor `server.py` in 3 fasi

Aggiornato il 2026-07-14 dopo l'allineamento a `e6ac426`.

## Fotografia iniziale

- `backend/server.py`: 8004 righe.
- Contratto pubblico: 89 path, 117 operazioni HTTP, 32 schemi OpenAPI.
- 239 funzioni e 35 classi top-level, inclusa una doppia definizione di `OrderCreate`.
- Import di `server` usati da test e script: devono continuare a funzionare durante il refactor.
- Side effect all'import: caricamento ambiente, client Mongo, creazione app e singleton condivisi.

## Garanzie trasversali

- Nessun cambio di path, payload, status code o schema OpenAPI durante gli spostamenti.
- Nessun cambio di collezioni, documenti o indici Mongo.
- `server:app` resta l'entrypoint per VPS e sviluppo locale.
- `server.py` riesporta temporaneamente i simboli usati da test e script.
- I nuovi moduli non importano mai `server.py`.
- Un solo `db`, un solo client Mongo e, quando verrà estratto, un solo WebSocket manager.
- Invarianti auth: token coerente con l'account autenticato, revoca Simone, privilegi Federico e impersonificazione admin invariati.
- Ogni fase è deployabile autonomamente e chiude con test di contratto e regressione.
- Non eseguire contro il DB operativo le vecchie suite che cancellano indiscriminatamente dati giornalieri.

## Fase 1 - Fondamenta e schemi

**Stato: completata il 2026-07-14.**

- Creati `backend/app/core/config.py`, `database.py`, `security.py`, `time.py` e `files.py`.
- Estratti tutti i modelli Pydantic in `backend/app/schemas/`, divisi per dominio.
- Rimossa la doppia definizione di `OrderCreate`; lo schema canonico mantiene `description` e `order_number`.
- Conservati i re-export da `server.py`.
- Aggiunto hash di caratterizzazione OpenAPI e test puri per auth, fuso di Roma e upload.
- Nessun endpoint spostato; WebSocket manager, audit e task notturni restano nel monolite fino alle fasi dedicate.

Risultato: `server.py` da 8004 a 7629 righe, contratto OpenAPI invariato.

## Fase 2 - Domini critici

**Stato: completata il 2026-07-14.**

- Estratte 18 rotte Ordini, log movimenti e report giornaliero in `app/routers/orders.py`.
- Estratte 18 rotte Report/chiusure/audit in `app/routers/report.py`.
- Estratti i 4 endpoint Analisi/Numeri in `app/routers/analysis.py`.
- Separati calcoli e accesso dati in `app/services/orders.py`, `report.py`, `analysis.py` e `report_snapshots.py`.
- Spostati reset notturno, recupero ordini stale e retention upload in `app/tasks/`.
- Spostati catalogo bevande, cache locali, dipendenze e WebSocket manager in singleton condivisi sotto `app/core/`.
- Conservati tutti i re-export da `server.py`; nessun nuovo modulo importa il monolite.
- Aggiunta protezione sul numero ordine manuale: una collisione attiva restituisce `409` senza abbassare il contatore; ripartire da un numero più basso resta possibile quando quel numero non è attivo.

Struttura ottenuta:

```text
backend/app/
|-- routers/
|   |-- orders.py
|   |-- report.py
|   `-- analysis.py
|-- services/
|   |-- orders.py
|   |-- report.py
|   |-- analysis.py
|   `-- report_snapshots.py
`-- tasks/
    |-- maintenance.py
    |-- midnight.py
    `-- stale_orders.py
```

Risultato: `server.py` da 7629 a 3677 righe. Contratto OpenAPI invariato; 34 test unitari/contratto superati, smoke ASGI completo superato e gate Mongo isolato superato con 20 ordini concorrenti, reset reale e carry-over cash/cassetto/bevande.

## Fase 3 - Domini rimanenti e bootstrap

**Stato: completata il 2026-07-14.**

- Estratte 15 rotte di sistema, autenticazione, locali e diagnostica in `app/routers/system.py`.
- Estratte 9 rotte fatture locali/fornitori in `app/routers/invoices.py`.
- Estratte 25 rotte prodotti, ledger, richieste e carichi in `app/routers/warehouse.py`.
- Estratte 12 rotte bevande e analisi magazzino in `app/routers/beverages.py`.
- Estratte 16 rotte versamenti, chiusure e fatture globali in `app/routers/documents.py`.
- Spostato l'endpoint WebSocket in `app/routers/websocket.py` mantenendo il manager singleton della fase 2.
- Spostati buffer e middleware diagnostici in `app/core/diagnostics.py`; runtime e limiter hanno singleton dedicati.
- Spostati seed account e catalogo bevande in `app/services/seeding.py`.
- Centralizzati composizione app, CORS/GZip, indici Mongo, seed, recovery, retention, scheduler e shutdown in `app/bootstrap.py`.
- Sostituiti entrambi gli handler `on_event` con un solo lifespan; il task notturno viene cancellato e atteso allo shutdown.
- `server.py` resta l'entrypoint VPS `server:app` e una facciata temporanea di compatibilita per test/script.

Risultato: `server.py` da 3677 a 269 righe, e da 8004 a 269 nell'intero refactor. Contratto OpenAPI invariato: 89 path, 117 operazioni e SHA-256 `feddac10addca6258b7522ae12eb10bce78cf9817472d22d99eba6ad3f6052b4`.

### Verifica differenziale post-refactor (2026-07-14)

- Confrontati direttamente il monolite `e6ac426` e il refactor, avviati insieme su due database Mongo gemelli.
- I corpi AST di 95 funzioni della fase 3 sono identici; inizializzazione e shutdown sono equivalenti dopo la separazione del lifespan.
- Identiche 102 risposte HTTP normalizzate su auth, ordini, report/audit, magazzino, richieste, documenti, bevande, analisi e diagnostica.
- Identici i 2 workbook Excel, confrontati per fogli, celle, valori, formati, colori, dimensioni e merge.
- Identico lo stato di 23 collezioni Mongo e le firme degli indici principali dopo gli stessi flussi.
- Identico lo stato di 10 collezioni dopo un reset notturno controllato.
- Verificate due connessioni WebSocket consecutive, upload/download file e autorizzazioni 401/403.
- Unica differenza ammessa: dopo una collisione su un numero manuale gia attivo, il refactor lascia invariato il contatore invece di abbassarlo. Status HTTP `409` invariato.
- Build React completata e 4/4 test frontend superati; sorgenti frontend identiche a `e6ac426`.
- Smoke test di sola lettura superato sul database locale con Admin, Federico, Grazie e Magazziniere.

Gate finali:

- [x] Grafo import senza cicli; nessun modulo sotto `app/` importa `server.py`.
- [x] Avvio reale `uvicorn server:app` con configurazione equivalente alla VPS.
- [x] Login Admin, Federico, Magazziniere e locale; password errata 401 e diagnostica locale 403.
- [x] Flusso Cassa -> Bollitore -> Generale -> Report -> Audit.
- [x] WebSocket live con due connessioni consecutive e round-trip ping/pong.
- [x] Magazzino, richieste con scarico stock, fatture, versamenti, chiusure e diagnostica.
- [x] Reset notturno, archiviazione, ordini concorrenti e carry-over su database isolato.
- [x] 40 test unitari/contratto e 2 test Mongo isolati superati; database e upload temporanei rimossi.

## Debiti dopo il refactor

- `services/analysis.py` (1071 righe), `routers/report.py` (1097), `routers/warehouse.py` (962) e `routers/system.py` (823) sono ancora grandi. Dividerli ulteriormente resta un miglioramento successivo, non necessario per chiudere il monolite.
- Passlib 1.7.4 emette un warning con le versioni moderne di bcrypt; hashing e login funzionano, ma la coppia di dipendenze va allineata separatamente.
- Due punti usano ancora `BaseModel.dict()` e Pydantic 2 segnala la futura rimozione; migrare a `model_dump()` in un intervento dedicato.
- Starlette segnala l'import legacy `multipart`; dipende dalla versione installata e non cambia il comportamento degli upload.
- Il dev server locale risponde su `/`, ma l'apertura diretta di `/home` restituisce 404 per il wrapper Visual Edits preesistente; la produzione Nginx mantiene il fallback SPA configurato.
- Le suite storiche con cleanup Mongo aggressivi non vanno eseguite sul DB operativo. I gate nuovi richiedono `PASTA_RUN_ISOLATED_INTEGRATION=1` e un `DB_NAME` con prefisso `pastasciutta_refactor_test_`.
