# Pastasciutta Roma - PRD

## Problema Originale
Sistema di gestione ordini pasta per multi-ristorante (Flaminio, Grazie, Largo di Brazzà) con ruoli diversi (Cassa, Bollitore, Generale, Magazziniere, Amministratore).

## Architettura
- **Backend**: FastAPI (Python) su porta 8001
- **Frontend**: React.js su porta 3000
- **Database**: MongoDB
- **Real-time**: WebSocket con fallback polling (15s)
- **File Storage**: Immagini su filesystem `/app/uploads`
- **Integrazione**: Google Sheets API per export automatico ordini

## Account
| Username | Password | Ruolo |
|---|---|---|
| Flaminio | Pastasciutt4! | restaurant |
| Grazie | Pastasciutt4! | restaurant |
| Brazza | Pastasciutt4! | restaurant |
| Magazziniere | Pastasciutt4! | magazzino |
| Admin | Pastasciutt4! | admin |
| Federico | Pastasciutta@32 | supervisor |

## Funzionalità Implementate

### Core
- Autenticazione multi-ristorante con JWT + ruoli
- CRUD ordini con numerazione incrementale
- Timer cottura con colori (verde/rosso/grigio/blu)
- WebSocket real-time + polling fallback 15s
- Reset automatico a mezzanotte (ora italiana) con archiviazione ordini ATOMICA (verifica insert_many prima di delete_many)
- Self-healing al boot: `recover_stale_orders()` archivia automaticamente ordini "stantii" se il midnight_reset non è girato
- `delete_order` calcola counter come MAX storico del giorno (active + archived_today + deletion_logs_today) → counter monotonico, mai indietro
- `create_order` ATOMICO via aggregation pipeline `$max(counter+1, requested)` su find_one_and_update — concorrenza-safe, immune a numeri duplicati anche con N richieste concorrenti
- Endpoint `GET /api/orders/next-number` autoritativo per il frontend (no più calcoli dai soli pending)
- Indice MongoDB UNIQUE su `(restaurant_id, order_number)` su `orders` come rete di sicurezza
- Alert dashboard Admin: banner rosso quando il sistema rileva ordini stantii al boot

### Pagine
- **Cassa**: Creazione ordini, modifica numero+descrizione, stampa selezione multipla, timer, cancellazione reale
- **Tablet Generale**: Lista ordini, soft-hide (non cancella dal DB), toggle monitor clienti, auto-off monitor
- **Tablet Bollitore 1 & 2**: Timer cottura, kitchen complete, cancella >7min, testo nero grassetto compatto
- **Monitor Clienti**: Display numeri pronti per clienti (Flaminio)
- **Report Cassa**: Report giornaliero con ordini attivi + archiviati
- **Report Excel**: Export dati
- **Fatture/Versamenti/Chiusure**: Gestione documenti con immagini su filesystem
- **Magazzino Fase 1**: CRUD prodotti con ruolo Magazziniere (foto, unità, fornitore, quantità stock)
- **Magazzino Fase 2 — Richieste Merce & DDT** (19/04/2026):
  - Ogni locale ha una pagina `/richiesta-merce` con elenco richieste da evadere + evase
  - Pagina `/richiesta-merce/nuova` mobile-first: card prodotto con foto, −/+ grossi, tastierino numerico, filtri per fornitore + search, sticky bottom INVIA
  - `real_quantity` = `quantity` − somma prodotti in richieste pending (multi-locale, così un locale vede cosa è già stato prenotato)
  - Contatore DDT **globale** auto-incrementale atomico (MongoDB `$inc` + upsert)
  - Workflow 3 stati: `pending` (locale crea) → `evasa` (magazziniere evade + decrementa stock) → `confermata` (locale conferma ricezione)
  - Vista DDT stampabile A4 con MITTENTE (Pastasciutta Srl) + DESTINATARIO (indirizzi hardcoded per locale) + tabella articoli
  - Magazziniere ha pagina `/magazzino/richieste-in-arrivo` con sezioni "Da evadere" / "Evase in attesa conferma" / "Storico confermate"
  - Admin può impersonare qualsiasi locale via `X-Admin-Restaurant-Id`
- **Magazzino Fase 2 — Carico merce dai fornitori** (19/04/2026):
  - Magazziniere → "Carico verso il magazzino" → lista `/magazzino/carichi` con foto DDT miniatura, filtri fornitore + search full-text
  - Nuovo carico `/magazzino/carichi/nuovo`: select fornitore (mostra solo suoi prodotti), numero DDT fornitore, **foto DDT obbligatoria** (con `capture="environment"` per camera mobile), card prodotti con +/- e keypad, preview "Stock attuale → Nuovo stock"
  - Lightbox per zoom foto DDT in lista
  - Edit `/magazzino/carichi/:id/modifica` calcola delta e riapplica allo stock atomicamente
  - Delete con rollback totale delle quantità
- **Fornitori**: lista resettata con 41 nomi ufficiali (19/04/2026)
- **Media Locali** (Admin): Report medie giornaliere per locale (ultimo mese rolling)

### Account Amministratore
- Selettore locale all'accesso
- Accesso completo a tutte le pagine di ogni locale
- Può fare operazioni (creare, cancellare, ecc.)
- Cambio locale dall'header
- Pagina "Media locali" esclusiva

### Integrazioni
- **Google Sheets**: Ogni ordine creato viene aggiunto automaticamente al foglio (colonna A: numero, colonna B: descrizione)
- Credenziali: `/app/backend/google_credentials.json`
- Spreadsheet ID: `1stWnCov8ipM_KzkYJiW2Iq4HmobLBJ19jGXj3oVrdyQ`

### Bug Fix Critici
- Cancellazione dal Tablet Generale non elimina più ordini dal DB (usa hidden_generale)
- Timer si congela blu in Cassa quando ordine nascosto dal Generale
- Monitor clienti auto-off quando ordine nascosto dal Generale
- Fix flickering polling (guardie ottimistiche rispettate)
- Fix numero ordine sovrascitto quando modificato manualmente
- Fix timer perdeva secondi (allineamento con ora server)

### Ottimizzazioni
- Polling da 5s a 15s (WebSocket è primario)
- Polling rispetta guardie ottimistiche (zero flickering)
- Righe compatte nei tablet bollitore (px-2 py-1)
- Testo nero grassetto nei bollitore per leggibilità
- Tabella "Numeri" Admin responsive su mobile (table-fixed, padding e font ridotti, no scroll orizzontale a 375px) — 07/05/2026

## Self-Hosting
- VPS OVHcloud con Ubuntu
- Script `setup.sh` per installazione automatica
- Aggiornamento: `git pull && cd frontend && npm run build && sudo systemctl restart pastasciutta-backend`

## Backlog P0 - Magazzino Fase 2 (rimanenti)
- Scarico merce verso i locali (Stock Dispatch — alternativa alle richieste dal basso)
- Inventario (Inventory Management — forza sistema, conta fisica)
- Analisi/Statistiche magazzino

## Backlog P1 - Performance
- Indici MongoDB
- Pool connessioni MongoDB
- Rate limiting API
- Compressione Gzip
- Filtraggio/paginazione server-side ordini
- Heartbeat WebSocket server-side
- Protezione JWT per `/api/uploads/`
- Archiviazione ordini vecchi
- Timeout operazioni DB
- Logging strutturato con rotazione
- **Ledger `stock_movements`** (BACKEND + UI COMPLETATI 07/05/2026): tracciamento atomico di ogni mutazione di `products.quantity` con timestamp, autore, causale e ref al documento sorgente. Hook su POST/PUT/DELETE /carichi, PATCH /richieste/evade, PATCH /products/quantity, POST/PUT /products. Endpoint API `GET /products/{id}/movements` e `GET /stock-movements` con filtri (date_from/date_to/cause/user_id). Backfill script `backfill_stock_ledger.py` per popolare lo storico. UI Admin/Magazziniere: pagina `/magazzino/cronologia` con filtri (prodotto, date, causale), badge colorati per tipo movimento, totali entrate/uscite, link cronologia da Inventario. Mobile responsive (375px senza scroll orizzontale).

## Backlog P2 - Futuro
- Popolare lista fornitori
- Backup automatico (DB + uploads su cloud)
- Stampante termica via LAN (Star TSP100)
- Integrazione Google Sheets automatica a fine giornata (oltre che per singolo ordine)
- Autocompletamento/validazione dizionario paste

## Sessione fork — 28/05/2026
- **FIX CRITICO**: PUT `/api/cash/daily` salvava su una variabile non definita `flaminio_id` (cross-tenant write/NameError). Ora usa `rid` effettivo da `_effective_restaurant_id`.
- **Guard isAdmin** su `startEditCassetto` in `ReportBetaPage.js`: utenti non-Admin non possono più modificare lo stock del Cassetto Spicci (cursor `not-allowed`, label "solo lettura").
- **Coerenza formule**: `cashTotal` ora usa `evaluateValue` invece di `parseFloat` puro → `=10+5` funziona anche sui count delle banconote/monete.
- **Sezione "Magazzino Sera"** aggiunta nel Report (read-only, fonte: Magazzino Bevande): card con il solo valore "sera" per ogni bevanda, evidenziato in `amber-50` quando popolato.
- **Test pytest aggiunto**: `/app/backend/tests/test_multi_tenancy.py` (7/7 PASS) — copre isolamento `/api/cash/daily`, `/api/beverages/daily`, `prev_cash_sera` carry-over, non-admin no-impersonation.


## Sessione fork — 09/06/2026 (ReportBetaPage UI tuning)
Applicate 7 modifiche di layout/logica richieste dall'utente su `/app/frontend/src/pages/ReportBetaPage.js`:
1. **CASH_FIELDS riordinati**: VERS spostato come ultimo box prima di CASH SERA; BP/SAT/POS raggruppati consecutivamente.
2. **Colori box Riepilogo Cassa**: BP/SAT/POS condividono lo stesso azzurro chiaro (`#dbeafe`); VERS = bianco (`#ffffff`).
3. **Riepilogo Cassa = 2ª sezione**: ora subito dopo "Cassa banconote", prima di Vendite Bevande e Magazzino Sera.
4. **Colonna "Paste" ridotta**: layout grid passato da `1fr_3fr` (25%) a `14fr_86fr` (~14%).
5. **Spicci + Cassetto Spicci compatti**: wrapper `max-w-[60%]`, altezze input/display da `h-11` a `h-9`, font `text-sm` → `text-xs`, `min-w` ridotti.
6. **Breakdown costi paste rimosso**: niente più grid per sigla; restano solo TOT PASTE e TOT €.
7. **Cap 15€** su `setManualPrice`: qualsiasi valore numerico > 15 viene troncato a 15 (formule "=..." non ammesse in input manuale comunque).
- Testato via screenshot tool: layout corretto, ordine sezioni corretto, cap 15€ verificato (input 50→15, 20→15, 8→8).

## Sessione fork — 09/06/2026 (Magazzino Sera: casse + sfuse)
- **Sezione "Magazzino Sera" spostata come 3ª sezione** (subito dopo Riepilogo Cassa, prima di Vendite Bevande) in `/app/frontend/src/pages/ReportBetaPage.js`.
- **UI a 2 quadratini per bevanda**: input sinistro = **casse** (moltiplicate × 24), input destro = **sfuse** (×1). Sintesi "tot N" sotto la coppia.
- **Costante `PEZZI_PER_CASSA = 24`** (fissa, uguale per tutte le bevande).
- **Backend**: esteso `BeverageDailyUpsert` e `GET /api/beverages/daily` con campi `sera_casse` e `sera_sfuse`. Il totale `sera` salvato a DB resta la somma `casse*24 + sfuse` (retrocompatibile con tutta la logica downstream — Vendite Bevande, prev_sera, cash_sera_full).
- **Persistenza verificata**: refresh → casse/sfuse ricaricati correttamente, totale ricalcolato.
- Test E2E manuale: AL: 3 casse + 4 sfuse → "tot 76" ✓ (3×24+4=76).

## Sessione fork — 09/06/2026 (Scarti + Magazzino Mattina porting)
- **Sezione "Scarti"** (rosa) aggiunta sotto Magazzino Sera: 1 quadratino unità per bevanda, sync live con `bevCounts.scarti` (campo esistente).
- **Sezione "Magazzino Mattina"** (verde/turchese) aggiunta sotto Scarti: 2 quadratini per bevanda (Casse ×24 + Sfuse), totale `tot N`.
- **Backend**: estesi `BeverageDailyUpsert` + GET/PUT `/api/beverages/daily` con `mattina_casse` e `mattina_sfuse`.
- **Handler refactor**: `handleCasseSfuseChange(sigla, slot, kind, value)` parametrizzato per slot ∈ {mattina, sera}.
- **Auto-fill prev_sera → mattina**: decomposizione automatica del totale del giorno prima in casse (×24) + sfuse (es. 76 → 3 casse + 4 sfuse).
- **Placeholder trasparenti rimossi** da tutti gli input bevande (Magazzino Sera, Scarti, Magazzino Mattina).
- Test E2E manuale: Mattina AL 5 casse + 12 sfuse → tot 132 ✓.

## Sessione fork — 09/06/2026 (Magazzino Mattina: read-only + forza mattina)
- **Magazzino Mattina ora read-only di default** in ReportBetaPage. Il valore atteso allo scatto di mezzanotte verrà dal Magazzino Sera della sera prima (consistente con la logica di MagazzinoBevandePage).
- **Pulsante "🔒 forza mattina"** accanto al titolo della sezione: cliccandolo sblocca temporaneamente gli input casse/sfuse (label → "🔓 mattina sbloccato" in rosso).
- Stato `forceMagMattina` separato da `forceMattina` (cassa) per evitare collisione.
- Input bloccati hanno: `readOnly`, `tabIndex=-1`, sfondo grigio, cursor `not-allowed`.

## Sessione fork — 09/06/2026 (Sezione "Ingressi" porting)
- **Sezione "Ingressi"** (indigo) aggiunta tra Magazzino Sera e Scarti.
- 1 quadratino unità per bevanda, sync live con `bevCounts.inUsc` (campo esistente, stesso usato da MagazzinoBevandePage).
- Supporta formule "=..." (sfondo rosa quando formula).
- Nessun placeholder trasparente (rispetta richiesta utente).
- Handler `handleInUscChange(sigla, value)` con debounce 600ms.
- Test E2E manuale: AL Ingressi=12 → persistito a reload ✓.

## Sessione fork — 11/06/2026 (Chiusure Excel — Vista Admin a griglia + revisione UX + modalità storica)
- **Nuova pagina Admin `/chiusure-excel`** (`ChiusureExcelPage.js`) — vista in stile foglio Excel, una riga per giorno.
- **Colonne (rev2)**: Data, Giorno + 4 macro-header bevande (INGRESSI/USCITE verde, SCARTI rosso chiaro, MAGAZZINO SERA blu, VENDITE giallo) con 9 sotto-colonne per sigla ciascuna → TOT PIATTI → Arr/Altro/Vers/Glo/Just/Del/BP/SAT/POS/FT (€) → Spicci 5€/2€/1€/0,5€ (numero, SENZA cassetto) → CASH SERA (€ completo).
- **Click su riga** → naviga a `/report-beta?date=YYYY-MM-DD&rid=X` aprendo la PAGINA REPORT vera (`ReportBetaPage`) in **MODALITÀ STORICA** con tutti i dati archiviati di quel giorno, modificabile dall'Admin.
- **Modalità storica** in `ReportBetaPage`:
  - Lettura URL `?date=` + `?rid=` con `useSearchParams`.
  - PasswordGate bypassato per Admin in storico.
  - Tutti i GET (`/cash/daily`, `/beverages/daily`, `/beverages/inventory`) appendono `?date=&restaurant_id=`.
  - Tutti i PUT (cash + bev) propagano `date` + `restaurant_id` nel body.
  - Live paste polling (`/orders/today-paste-list`) **disabilitato** in storico (si usa il `paste_text` archiviato).
  - Sync `pasteText ← autoPasteText` disabilitato in storico per non azzerare i dati salvati.
  - Banner "📅 MODALITÀ STORICO — gg/mm/aaaa" + pulsante "← Torna a Chiusure Excel".
- **Backend nuovi/modificati endpoint**:
  - `GET /api/cash/daily?date=&restaurant_id=` — accetta opzionali (Admin/Supervisor only).
  - `GET /api/beverages/daily?date=&restaurant_id=` — accetta opzionali (Admin/Supervisor only).
  - `PUT /api/cash/daily` — body accetta opzionali `date` + `restaurant_id`.
  - `PUT /api/beverages/daily` — body accetta opzionali `date` + `restaurant_id`.
  - Helper `_resolve_historical_mode()` valida formato data + ruolo + non-futuro.
  - Audit-log loggato con `mode: "historical"` per tracciare correzioni postume.
  - `GET /api/admin/closures/grid` / `POST /api/admin/closures/generate-mock` / `DELETE /api/admin/closures/mock` (già aggiunti).
- **Pulsante "Chiusure Excel"** nel pannello selettore Admin in `HomePage.js`.
- **Test E2E**:
  - curl backend: GET storico (cash + bev) OK ✓, PUT storico salva e ricarica OK ✓, non-admin → 403 ✓.
  - screenshot E2E: navigazione Home → Chiusure Excel → click riga 10/06/2026 → ReportBetaPage si apre con banner + dati completi (44 paste €347, CASSA mattina 173/glo 34/just 62/del 90/bp 175/sat 144/pos 307/ft 67, SPICCI 1/1/3/5, VENDITE bev €395, CASH SERA €-214) ✓.

## Sessione fork — 15/06/2026 (BUG CRITICO: cross-tenant leak tra tab Admin)
- **Sintomo**: l'Admin apre due tab del browser, uno con Flaminio selezionato e uno con Grazie selezionato. Quando manda una pasta dal tab "Flaminio" l'ordine finiva nel locale "Grazie" (o viceversa).
- **Root cause**: `admin_selected_restaurant` era salvato in `localStorage` (condiviso tra tutti i tab dello stesso browser). Il secondo tab sovrascriveva la scelta del primo. Un secondo axios interceptor leggeva `localStorage` al volo a ogni richiesta HTTP, mandando il `X-Admin-Restaurant-Id` del locale sbagliato.
- **Fix** (`/app/frontend/src/contexts/AuthContext.js`):
  - `admin_selected_restaurant` spostato da `localStorage` a `sessionStorage` (isolato per-tab).
  - Rimosso il secondo axios interceptor che leggeva `localStorage` ad ogni request.
  - L'unico interceptor rimasto usa `adminRestRef` (React ref, isolato per-tab) e manda sia `X-Restaurant-Id` sia `X-Admin-Restaurant-Id` per coprire entrambi i path backend (`verify_token` + `_effective_restaurant_id`).
- **Test E2E**: aperti 2 tab nello stesso contesto browser come Admin → tab1 seleziona Flaminio, tab2 seleziona Grazie → tab1 manda "TAB1_FLAMINIO_CARB" → tab1 mostra l'ordine, tab2 mostra "Nessun ordine" ✓.
- **Side-effect atteso**: aprendo un nuovo tab come Admin si dovrà ri-selezionare il locale (il vecchio comportamento "ricorda l'ultimo" era esattamente la fonte del bug). Comportamento corretto e sicuro.
