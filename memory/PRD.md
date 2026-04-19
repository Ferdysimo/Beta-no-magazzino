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

## Funzionalità Implementate

### Core
- Autenticazione multi-ristorante con JWT + ruoli
- CRUD ordini con numerazione incrementale
- Timer cottura con colori (verde/rosso/grigio/blu)
- WebSocket real-time + polling fallback 15s
- Reset automatico a mezzanotte (ora italiana) con archiviazione ordini

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

## Self-Hosting
- VPS OVHcloud con Ubuntu
- Script `setup.sh` per installazione automatica
- Aggiornamento: `git pull && cd frontend && npm run build && sudo systemctl restart pastasciutta-backend`

## Backlog P0 - Magazzino Fase 2 (rimanenti)
- Carico merce (Stock Loading)
- Scarico merce verso i locali (Stock Dispatch)
- Inventario (Inventory Management)
- Analisi/Statistiche (Analytics)

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

## Backlog P2 - Futuro
- Popolare lista fornitori
- Backup automatico (DB + uploads su cloud)
- Stampante termica via LAN (Star TSP100)
- Integrazione Google Sheets automatica a fine giornata (oltre che per singolo ordine)
- Autocompletamento/validazione dizionario paste
