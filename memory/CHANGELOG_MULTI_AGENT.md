# 🤖 CHANGELOG MULTI-AGENT — Pastasciutta App

> **Scopo / Purpose**
> Questo file serve a sincronizzare il lavoro di più agenti AI (Emergent E1, Claude, GPT, Cursor, Copilot, agenti esterni, ecc.) che modificano lo stesso codebase in momenti diversi.
> This file synchronizes work across multiple AI agents (Emergent E1, Claude, GPT, Cursor, Copilot, external agents, etc.) modifying the same codebase at different times.

---

## 📜 ISTRUZIONI PER L'AGENTE / INSTRUCTIONS FOR THE AGENT

**🇮🇹 ITALIANO**
Prima di iniziare qualsiasi modifica al codice:
1. **LEGGI** integralmente la sezione "LOG MODIFICHE" sotto, dal più recente al più vecchio.
2. Leggi anche `/app/memory/PRD.md` per il contesto generale del prodotto.
3. Dopo aver completato il tuo lavoro (anche un fix piccolo), **AGGIUNGI** una nuova voce in cima alla sezione "LOG MODIFICHE" seguendo il formato indicato.
4. NON cancellare voci precedenti. Solo aggiungere.
5. Se il file supera le 500 righe, sposta le voci più vecchie di 30 giorni in `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.
6. Lavora anche da **reviewer e architetto**: segnala rischi, regressioni, debiti strutturali, cicli di import e test mancanti; non limitarti a implementare la richiesta minima.

**🇬🇧 ENGLISH**
Before making any code change:
1. **READ** the entire "CHANGE LOG" section below, newest first.
2. Also read `/app/memory/PRD.md` for general product context.
3. After completing your work (even small fixes), **ADD** a new entry on top of the "CHANGE LOG" section using the format below.
4. DO NOT delete previous entries. Only append.
5. If this file grows beyond 500 lines, move entries older than 30 days to `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.
6. Also act as a **reviewer and architect**: call out risks, regressions, structural debt, import cycles, and missing tests; do not only implement the smallest requested change.

---

## 📝 FORMATO VOCE / ENTRY FORMAT

```markdown
### [YYYY-MM-DD HH:MM TZ] — <Nome Agente> (<Modello / Provider>)
**Tipo**: feature | bugfix | refactor | security | docs | config
**File toccati**:
- `/app/path/to/file1.ext`
- `/app/path/to/file2.ext`
**Descrizione**: 1-3 righe in italiano che spiegano COSA è stato fatto e PERCHÉ.
**Testato**: ✅ sì (metodo: curl / testing_agent / screenshot / utente) | ❌ no
**Note per il prossimo agente** (opzionale): eventuali warning, side-effect, follow-up.
```

---

## 🔑 CONTESTO RAPIDO / QUICK CONTEXT

- **Stack**: FastAPI (Python) + React + MongoDB + WebSocket
- **Lingua utente**: 🇮🇹 Italiano — rispondi SEMPRE in italiano
- **File sensibili (toccare con cautela)**:
  - `/app/backend/server.py` — 5500+ righe, monolite
  - `/app/frontend/src/pages/ReportBetaPage.js` — 2100+ righe, math parsing + contentEditable + rich text + XSS sanitization
  - `/app/backend/.env` — `JWT_SECRET` obbligatorio in produzione
- **Credenziali test** → `/app/memory/test_credentials.md`
- **Ruoli**: `admin` (Admin), `supervisor` (Federico), `restaurant`, `magazzino`

---

## 🖥️ AMBIENTE PRODUZIONE — VPS UTENTE / USER'S VPS ENVIRONMENT

> ⚠️ **IMPORTANTE**: L'app gira su una VPS self-hosted dell'utente, NON su Emergent cloud. Lo script `/app/setup.sh` è la fonte di verità per la configurazione.

### 📍 Percorsi sul VPS / VPS paths
| Risorsa | Percorso |
|---|---|
| Root app (su VPS) | `/opt/pastasciutta` |
| Repo git clone alt. | `/root/pasta-app` (path alternativo usato in deploy) |
| Backend code | `/opt/pastasciutta/backend/` |
| Frontend build statico | `/opt/pastasciutta/frontend/build/` |
| Python virtualenv | `/opt/pastasciutta/backend/venv/` |
| Pip eseguibile | `/opt/pastasciutta/backend/venv/bin/pip` |
| Uploads (foto DDT/fatture) | `/opt/pastasciutta/uploads/` |
| Google Sheets creds | `/opt/pastasciutta/backend/google_credentials.json` |
| Backend `.env` | `/opt/pastasciutta/backend/.env` |
| Frontend `.env` | `/opt/pastasciutta/frontend/.env` |

### 🐧 Sistema operativo & stack
- **OS**: Ubuntu (Debian-based)
- **Python**: 3.x in virtualenv
- **Node.js**: v20+ (`yarn` come package manager)
- **MongoDB**: 8.0 (servizio `mongod`, locale su `mongodb://localhost:27017`)
- **Web server**: Nginx (reverse proxy + serve build React statico)
- **Process manager**: systemd (NON supervisor come su Emergent)
- **HTTPS / Cert**: certbot installato (configurabile a parte)

### ⚙️ Servizi systemd / systemd services
| Servizio | Funzione |
|---|---|
| `pastasciutta-backend.service` | FastAPI via uvicorn su `0.0.0.0:8001` |
| `mongod.service` | MongoDB |
| `nginx.service` | Reverse proxy `:80` → frontend + `/api/` → backend |

Definizione service backend (`/etc/systemd/system/pastasciutta-backend.service`):
```ini
[Service]
Type=simple
User=root
WorkingDirectory=/opt/pastasciutta/backend
Environment=PATH=/opt/pastasciutta/backend/venv/bin:/usr/bin
ExecStart=/opt/pastasciutta/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=3
```

### 🌐 Configurazione Nginx (sintesi)
File: `/etc/nginx/sites-available/pastasciutta`
- `listen 80` → root su `/opt/pastasciutta/frontend/build`
- `location /api/` → proxy a `http://127.0.0.1:8001/api/`
- WebSocket upgrade headers attivi (`Upgrade`, `Connection`)
- `client_max_body_size 20M` per upload foto fatture/DDT
- `proxy_read_timeout 86400` (WS long-lived)
- React SPA fallback: `try_files $uri $uri/ /index.html`

### 🔑 Variabili `.env`
**Backend** (`/opt/pastasciutta/backend/.env`):
```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=pastasciutta
JWT_SECRET=<openssl rand -hex 32 — OBBLIGATORIO, no fallback>
```
**Frontend** (`/opt/pastasciutta/frontend/.env`):
```env
REACT_APP_BACKEND_URL=http://<IP_VPS_O_DOMINIO>
```

### 🚀 Comandi utili per il VPS / Useful VPS commands
| Operazione | Comando |
|---|---|
| **Deploy completo** | `cd /root/pasta-app && git pull && cd frontend && npm run build && sudo systemctl restart pastasciutta-backend` |
| Riavvio backend | `sudo systemctl restart pastasciutta-backend` |
| Log backend live | `sudo journalctl -u pastasciutta-backend -f` |
| Stato backend | `sudo systemctl status pastasciutta-backend` |
| Riavvio Nginx | `sudo systemctl restart nginx` |
| Stato MongoDB | `sudo systemctl status mongod` |
| Mongo shell | `mongosh pastasciutta` |
| Installare pacchetto Python sul VPS | `/opt/pastasciutta/backend/venv/bin/pip install <pkg>` |
| Build frontend | `cd /opt/pastasciutta/frontend && yarn build` |
| Re-seed account | `curl -X POST http://localhost:8001/api/seed` |

### 🛡️ Note di sicurezza specifiche VPS
- `JWT_SECRET` **non ha fallback** nel codice → se manca, il backend non parte. Generare con `openssl rand -hex 32`.
- CORS: whitelist esplicita nel `server.py`, deve includere il dominio/IP reale del VPS.
- Rate limiting su `/api/auth/login` (10/min via `slowapi`).
- Path traversal in `/api/uploads/{filename}` mitigato.
- Le foto caricate finiscono in `/opt/pastasciutta/uploads/` → assicurarsi che la cartella sia scrivibile dall'user del service (`root` di default).
- Backup: **manuale al momento** (P2: backup cloud automatico in roadmap). Cose da salvare in backup: dump MongoDB (`mongodump --db pastasciutta`) + intera cartella `/opt/pastasciutta/uploads/` + `google_credentials.json`.

### 🆚 Differenze ambiente Emergent (questo) vs VPS produzione
| Aspetto | Emergent (qui) | VPS utente |
|---|---|---|
| Process manager | `supervisorctl` | `systemctl` |
| Frontend dev | `yarn start` (hot reload) | `yarn build` + Nginx statico |
| Backend reload | hot reload uvicorn | manual `systemctl restart` |
| Mongo | URL da env | `mongodb://localhost:27017` locale |
| `REACT_APP_BACKEND_URL` | preview emergentagent.com | IP/dominio VPS |
| Uploads | `/app/uploads/` | `/opt/pastasciutta/uploads/` |
| Google creds | non presenti / mock | `/opt/pastasciutta/backend/google_credentials.json` |

> **➡️ Quando suggerisci comandi all'utente, usa SEMPRE i path VPS (`/opt/pastasciutta/...`) e `systemctl`, NON i path di Emergent (`/app/...`) né `supervisorctl`.**

---

## 📋 LOG MODIFICHE / CHANGE LOG
> **⬇️ Aggiungere nuove voci QUI SOTTO, in cima alla lista (più recente in alto). ⬇️**

### [2026-07-14 09:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | security
**File toccati**:
- `/app/frontend/src/utils/authSession.js`
- `/app/frontend/src/utils/authSession.test.js`
- `/app/frontend/src/contexts/AuthContext.js`
- `/app/frontend/src/components/Header.js`
- `/app/frontend/src/pages/GeneralePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Eliminato il rischio di cambio silenzioso del locale dopo un refresh: token JWT, identita attesa e selezione Admin sono ora conservati in `sessionStorage`, isolati per singola scheda. Il vecchio token in `localStorage` viene scartato senza migrarlo, `/auth/me` deve coincidere con il locale atteso, l'header mostra sempre il locale corrente e il Tablet Generale segnala visibilmente gli errori di rimozione.
**Testato**: sì (metodo: 4 test Jest sullo storage; build React produzione; prova E2E con Chrome, due schede nello stesso profilo Flaminio/Grazie e refresh di entrambe: ciascuna mantiene il proprio locale, nessun token condiviso)
**Note per il prossimo agente**: al primo caricamento dopo il deploy tutti gli utenti vengono disconnessi una sola volta per eliminare in sicurezza il vecchio token condiviso. Non migrare nuovamente il token auth in `localStorage`. Il refactor pianificato di `server.py` non e ancora iniziato.

### [2026-07-13 16:08 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | refactor
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/frontend/src/pages/AnalisiAnnualePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Resa affidabile l'analisi mensile includendo ordini attivi, archiviati, eliminati e cancellazioni archiviate secondo la data originale, con deduplica e lettura a cursore senza troncamento a 100.000 documenti. Gli snapshot del dizionario paste sono ora versionati e non vengono più sostituiti da salvataggi storici o dal reset notturno; prima dell'export viene verificata la coerenza tra ordini sorgente e paste, bloccando con HTTP 409 solo le incongruenze automatiche e segnalando gli avvisi storici/manuali. Il foglio `Totali` riusa gli stessi conteggi deduplicati già caricati, eliminando le query giorno per locale durante l'export.
**Testato**: sì (metodo: `py_compile`; 16 test unitari/export + 19 regressioni API Report/multi-tenant; build React produzione; `git diff --check`; export reale 2026 via API aperto con openpyxl: 4 fogli, 365 giorni, HTTP 200)
**Note per il prossimo agente**: nessun backfill prezzi è stato eseguito. Le giornate storiche già prive di `pasta_dict_snapshot` continuano a usare il dizionario corrente, ma ora sono dichiarate negli header dell'export e nella pagina; sui dati locali risultano 2 giornate.

### [2026-07-13 14:44 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | docs
**File toccati**:
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Allineata la descrizione del pulsante Admin "Analisi mensile" alla pagina semplificata: rimossa la promessa del riepilogo paste e indicato soltanto il download del file Excel completo. Verificata inoltre la copertura delle voci recenti del changelog rispetto a tutti i file della nuova funzionalità.
**Testato**: sì (metodo: confronto `git diff`/`git status` con le voci del changelog e `git diff --check`)

### [2026-07-13 14:42 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor
**File toccati**:
- `/app/frontend/src/pages/AnalisiAnnualePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Semplificata la pagina "Analisi mensile" eliminando tabella, riepilogo, caricamento dati e comando di aggiornamento. La pagina ora contiene soltanto la scelta dell'anno e il pulsante per scaricare il file Excel; l'apertura della pagina non esegue più la richiesta di riepilogo al backend.
**Testato**: sì (metodo: `npm run build`, verifica browser locale desktop e mobile; 0 tabelle, 0 pulsanti Aggiorna, 1 pulsante Scarica Excel, nessun overflow orizzontale a 390 px)

### [2026-07-13 14:21 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Riallineato l'export Analisi mensile al modello `2025.xlsx`: testi e palette originali, font Calibri, colonne compatte, blocco prezzi paste separato dagli incassi, sigle bevande formattate e intestazioni finanziarie complete. Rimossi separatori delle migliaia e decimali superflui; `Spicci aperti / portati` ora usa il valore reale delle monete nel cassetto invece di duplicare i tubetti.
**Testato**: si (metodo: `py_compile`, `pytest backend/tests/test_report_backend_totals.py -q` -> 8 passed, generazione demo v6, confronto visuale di tutti i fogli con `2025.xlsx`, scansione errori formula -> 0)
**Note per il prossimo agente**: Demo aggiornata in `C:\Users\pasta\Downloads\analisi_mensile_demo_2_mesi_v6.xlsx`.

### [2026-07-13 13:51 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiornato il formato numerico dell'export "Analisi mensile": i valori interi usano formato intero (`132` invece di `132,00`), mentre i valori con centesimi mantengono due decimali.
**Testato**: si (metodo: `py_compile backend/server.py`, rigenerazione demo v5 e verifica openpyxl dei formati cella)

### [2026-07-13 13:36 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rifinito il formato Excel dell'export "Analisi mensile" per avvicinarlo al modello 2025.xlsx: palette per sezioni paste/bevande/cassa, colori specifici per movimentazione finanziaria, colonna TOTALE incassi e intestazioni spicci/cash sera piu coerenti.
**Testato**: si (metodo: `py_compile`, `pytest backend/tests/test_report_backend_totals.py -q`, verifica openpyxl colori/intestazioni su demo, endpoint reale summary/export)
**Note per il prossimo agente**: Il demo rigenerato e in `C:\Users\pasta\Downloads\analisi_mensile_demo_2_mesi_v2.xlsx`; il vecchio file demo non e stato sovrascritto perche probabilmente aperto in Excel.

### [2026-07-13 12:37 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/frontend/src/App.js`
- `/app/frontend/src/pages/AnalisiAnnualePage.js`
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunta pagina Admin "Analisi mensile" sotto Numeri, con riepilogo paste per locale/tipo e download Excel. Il backend genera un workbook con un foglio per locale, sezioni paste/bevande/cassa, foglio "Totali" coerente con l'export Numeri e snapshot del dizionario paste per non ricalcolare il passato con prezzi futuri.
**Testato**: si (metodo: `py_compile`, `pytest backend/tests/test_report_backend_totals.py -q`, dry-run openpyxl del workbook, endpoint reale summary/export, `yarn build`)
**Note per il prossimo agente**: La parte analitica affidabile e il breakdown paste per sigla/Altro; cassa e bevande sono esportate come storico usando i dati Report esistenti. I dati precedenti allo snapshot prezzi usano il dizionario attuale come fallback.

### [2026-07-13 10:14 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/frontend/src/App.js`
- `/app/frontend/src/pages/DataIntegrityPage.js`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa la pagina "Controllo integrita dati" e relativo endpoint/test/route/pulsante Simone. Rifatta la tab "Dispositivi locali" della Diagnostica Live: mostra solo dispositivi online, elimina sezioni/label non utili e rende piu leggibili locali, build, pagine aperte e heartbeat.
**Testato**: si (metodo: `py_compile` backend/test, `yarn build`)
**Note per il prossimo agente**: La sezione Backend della diagnostica e stata lasciata volutamente quasi invariata.

### [2026-07-10 13:50 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rafforzati i riporti automatici del Report: Cash Mattina usa il dizionario paste del locale, il backend salva lo snapshot paste prima dell'archiviazione ordini, e i riporti automatici di Magazzino Mattina bevande e Cassetto Spicci vengono riconciliati se il giorno precedente viene corretto. Le forzature manuali restano protette tramite metadati/audit.
**Testato**: si (metodo: `py_compile` backend/test, `pytest backend/tests/test_report_backend_totals.py -q`, `pytest backend/tests/test_multi_tenancy.py -q` -> 19 passed)
**Note per il prossimo agente**: Punto escluso su richiesta utente: valutare separatamente il caso bevanda realmente chiusa a 0 pezzi, oggi ambiguo con "non contato".

### [2026-07-10 10:27 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il disallineamento tra Cash Sera storico e Cash Mattina del giorno dopo quando il Cash Sera viene ricalcolato con logiche aggiornate. I riporti automatici gia salvati vengono riconciliati se riconoscibili come legacy, mentre le forzature manuali Admin restano protette.
**Testato**: parziale (metodo: `py_compile` su backend e test OK; pytest locale bloccato da virtualenv Python rotta/mismatch `pydantic_core`)
**Note per il prossimo agente**: I campi `mattina_auto_carry`, `mattina_carry_from_date`, `mattina_carry_value` servono a distinguere riporto automatico da forzatura manuale.

### [2026-07-10 08:51 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Allineato il calcolo backend dello storico chiusure ai prezzi manuali paste del Report: ora i prezzi delle paste non riconosciute vengono letti anche dalla chiave testuale normalizzata della riga, non solo dal vecchio indice numerico. Questo evita cash sera diversi tra griglia storico e dettaglio cliccato.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `pytest backend/tests/test_beverage_signed_totals.py backend/tests/test_report_backend_totals.py -q`)
**Note per il prossimo agente**: Mantenere il fallback a indice per compatibilita con chiusure vecchie, ma preferire la chiave testuale normalizzata come nel frontend `ReportBetaPage`.

### [2026-07-09 13:22 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_beverage_signed_totals.py`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/frontend/src/pages/MagazzinoBevandePage.js`
- `/app/frontend/src/pages/StoricoBevandePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Estesa la logica delle bevande firmate: gli scarti ora sottraggono sempre dal totale vendite bevande, anche quando `Magazzino Sera` e ancora 0/non contato. Le vendite da giacenza restano sospese fino al conteggio sera, ma gli scarti incidono subito in negativo.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `pytest backend/tests/test_beverage_signed_totals.py -q`, `npm run build`, backend locale riavviato)
**Note per il prossimo agente**: Formula coerente tra frontend e backend: `(sera == 0 ? 0 : mattina + ingressi - sera) - scarti`.

### [2026-07-09 13:14 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/frontend/src/pages/AuditCassaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Nella pagina "Check singoli movimenti" nascosti i movimenti tecnici legati a `paste_text` ("Paste incollate (testo)") e `manual_prices.*` ("Prezzo manuale paste"), mantenendoli comunque registrati nell'audit-log backend.
**Testato**: si (metodo: `npm run build`)
**Note per il prossimo agente**: Il filtro e solo di presentazione: non rimuovere la registrazione backend di questi campi senza una richiesta esplicita.

### [2026-07-09 12:26 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_beverage_signed_totals.py`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/frontend/src/pages/MagazzinoBevandePage.js`
- `/app/frontend/src/pages/StoricoBevandePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il calcolo economico delle vendite bevande: le quantita negative ora rettificano il totale con il loro prezzo invece di essere ignorate. Esempio: `10 C` a 2 euro e `-10 CZ` a 2 euro danno totale bevande 0 euro.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `pytest backend/tests/test_beverage_signed_totals.py -q` -> 2 passed, `npm run build`, backend locale riavviato)
**Note per il prossimo agente**: Mantenere il caso `sera == 0` come "giornata non contata": in quel caso la quantita resta 0. Le quantita negative contano solo quando la riga ha un conteggio sera.

### [2026-07-09 10:05 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Ripensata la sezione "Dispositivi locali" come vista operativa "Controllo locali": prima KPI e priorita di intervento per locale, poi matrice locali, infine evidenza tecnica per dispositivo. L'obiettivo e mostrare cosa fare prima, non solo una tabella di device.
**Testato**: si (metodo: `npm run build`, frontend locale su `http://localhost:3000`)
**Note per il prossimo agente**: La diagnostica dispositivi deve restare orientata alle decisioni operative: locale a rischio, motivo, azione consigliata, dettagli tecnici solo come supporto.

### [2026-07-08 23:39 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa la logica di conflitto/stale revision dal Report: niente piu banner "aggiornato da un altro dispositivo". Il Report mantiene autosave patch-safe ma accetta salvataggi parziali da tab vecchie; il frontend rilegge periodicamente il cash report per riallineare piu pagine aperte sullo stesso giorno senza sovrascrivere il campo in editing.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `npm run build`, backend locale riavviato, `pytest backend/tests/test_multi_tenancy.py -q` -> 13 passed)
**Note per il prossimo agente**: Non reintrodurre blocchi 409 su `cash/daily` o `beverages/daily` per revision stale: l'utente preferisce aggiornamento automatico tra schede e nessun banner di conflitto.

### [2026-07-08 23:29 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Reso persistente il blocco manuale paste del Report (`paste_manual_override`) senza fermare il polling live: mentre il blocco e attivo le paste automatiche continuano ad aggiornarsi in background e, quando il blocco viene tolto, il testo viene sostituito con l'ultimo live comprensivo delle paste mandate nel frattempo.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `npm run build`, backend locale riavviato, `pytest backend/tests/test_multi_tenancy.py -q` -> 13 passed)
**Note per il prossimo agente**: Non spegnere il fetch `/orders/today-paste-list` quando `manualPasteOverride=true`; serve proprio a recuperare le paste entrate durante il blocco.

### [2026-07-08 23:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Revisione chirurgica del flow Report: gli autosave cash/bevande ora usano patch parziali invece di riscrivere interi documenti, backend espone/controlla una `revision` per bloccare salvataggi stale da altre tab/dispositivi e i prezzi manuali delle paste non riconosciute sono agganciati al testo normalizzato della riga, non piu all'indice.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `npm run build`, backend/frontend/Mongo locali avviati con `scripts/start-local-native.ps1`, `pytest backend/tests/test_multi_tenancy.py -q` -> 12 passed)
**Note per il prossimo agente**: Non reintrodurre autosave globali su `ReportBetaPage.js`: ogni handler deve salvare solo i campi modificati. Il blocco "BLOCCA AGGIORNAMENTI" paste resta volutamente non persistente su richiesta utente.

### [2026-07-08 11:10 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/AuditCassaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa la simulazione manuale del reset mezzanotte e corretto il Check singoli movimenti: il filtro utente ora cerca sul nome normalizzato mostrato in tabella e i filtri data usano Europe/Rome invece della data UTC del browser.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `npm run build`)
**Note per il prossimo agente**: Non reintrodurre endpoint manuali che spostano righe Report tra giorni; il rollover deve restare automatico/server-side.

### [2026-07-08 10:30 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/tests/test_multi_tenancy.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il riporto giornaliero del Report: il reset notturno e il backend materializzano il nuovo giorno con magazzino mattina bevande = sera del giorno precedente e cassa mattina = cash sera precedente. Il cassetto spicci ora riparte dal residuo reale, cioe rotolini nel cassetto meno rotolini aperti il giorno prima.
**Testato**: si (metodo: `python -m py_compile backend/server.py`; test mirati multi-tenancy/carry-over backend)
**Note per il prossimo agente**: La regola di apertura giornata deve restare server-side; non affidarla solo all'autofill del frontend.

### [2026-07-07 16:05 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: ux
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimosso il banner/health reason "Locali senza WebSocket attivo" dalla Diagnostica Live. I locali offline restano visibili nella tabella WebSocket, ma non alzano piu un avviso nel semaforo principale.
**Testato**: si (metodo: `python -m py_compile backend/server.py`)
**Note per il prossimo agente**: Non reintrodurre l'offline WebSocket come banner principale: l'utente lo considera rumore operativo.

### [2026-07-07 15:55 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: ux
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimosso il quadrato "Chiamate lente" dalla sezione Backend - prestazioni live della Diagnostica. La griglia ora usa tre metriche principali: latenza media, picco latenza ed errori server.
**Testato**: si (metodo: `npm run build`, riuscito con warning ESLint preesistenti)
**Note per il prossimo agente**: Il conteggio slow calls resta disponibile nel footer dei dettagli tecnici API, ma non deve tornare come tile principale.

### [2026-07-07 15:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il nome mostrato nella colonna "Utente" del Check singoli movimenti: i nuovi audit-log salvano `Admin` per modifiche admin e lo username reale del locale (`Flaminio`, `Grazie`, `Brazza`, ecc.) per modifiche dei locali. Le API normalizzano anche i vecchi log che mostravano `Pastasciutta Roma`, `Simone` o `Amministratore`.
**Testato**: si (metodo: `python -m py_compile backend/server.py`)
**Note per il prossimo agente**: Non usare `restaurant_name` per la colonna utente: per i locali e spesso il nome generico "Pastasciutta Roma"; usare `username` o normalizzazione API.

### [2026-07-07 15:25 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunta revoca mirata dei token gia emessi per l'account `Simone`: i vecchi token senza `token_version >= 2` vengono rifiutati con 401 al prossimo deploy/restart, mentre i nuovi login Simone ricevono token validi con `token_version=2`.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, compile nel container Docker, test API locale: token vecchio Simone -> 401 `Token revoked`, login nuovo Simone -> 200 e `/auth/me` -> 200)
**Note per il prossimo agente**: Meccanismo intenzionalmente limitato a Simone; non invalida Admin, Federico, locali o Magazziniere.

### [2026-07-07 09:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: ux
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Ridisegnata la tab "Dispositivi locali" della Diagnostica Live per usare tutta la larghezza disponibile: rimossa la sidebar in questa tab, portato il contenitore a 1920px, trasformati i locali in griglia larga cliccabile e sostituita la lista dispositivi con una tabella operativa a colonne stabili.
**Testato**: si (metodo: `npm run build`, riuscito con warning ESLint preesistenti; server locale non raggiungibile per screenshot live)
**Note per il prossimo agente**: Su Diagnostica > Dispositivi locali privilegiare scansione di molti locali/dispositivi su schermi grandi; la sidebar stato generale resta solo nella tab Backend.

### [2026-07-07 09:20 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto errore della Diagnostica Live dopo la rimozione degli health snapshot: ripristinata la variabile `cutoff_24h_dt`, ancora necessaria per calcolare lo storico salute "24 ore" live.
**Testato**: si (metodo: `python -m py_compile backend/server.py`)
**Note per il prossimo agente**: La rimozione degli snapshot Mongo resta valida; `cutoff_24h_dt` serve solo per aggregare il buffer diagnostico in memoria.

### [2026-07-06 12:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/test_credentials.md`
- `/app/memory/PRD.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Ripristinata la password dedicata di Federico a `Pastasciutta@32`. Il seed/startup non forza piu Federico a `Pastasciutt4!`; aggiornata anche la documentazione credenziali.
**Testato**: si (metodo: aggiornato DB locale Docker, restart backend, login Federico OK con `Pastasciutta@32`, KO con `Pastasciutt4!`)
**Note per il prossimo agente**: Federico e l'unica eccezione alla password comune dei locali/test account.

### [2026-07-06 12:00 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: cleanup
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa la persistenza degli `health_snapshot` dalla Diagnostica Live: il backend non scrive/legge piu `diagnostics_health_snapshots` e il frontend non mostra piu il box/tabella Snapshot salute. La diagnostica live corrente resta invariata.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `yarn build`, riuscito con warning ESLint preesistenti)
**Note per il prossimo agente**: La collection storica eventualmente gia presente in Mongo non viene cancellata da questa modifica; semplicemente non viene piu alimentata ne mostrata.

### [2026-07-05 01:22 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aumentato il respiro laterale della Diagnostica Live: contenitore leggermente piu stretto e padding orizzontale maggiore su desktop, per evitare che la pagina sembri appiccicata ai bordi.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Mantenere margini laterali generosi nelle viste admin dense; non allargare tutto fino ai bordi viewport.

### [2026-07-05 01:16 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Spostato il semaforo "Stato generale" in una colonna verticale a sinistra della Diagnostica Live, sticky su desktop. La colonna principale resta dedicata a tab e contenuti, migliorando la scansione della pagina.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il semaforo laterale deve restare sintetico; non trasformarlo in un secondo pannello tecnico.

### [2026-07-05 00:54 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Sgravata la Diagnostica Live: rimossi dalla vista principale errori frontend grezzi, commit backend, snapshot/campioni Mongo e storico salute. La pagina ora apre sui dispositivi locali, mostra build attesa, dispositivi online/offline, build vecchie e locali da guardare; ogni dispositivo ha stato leggibile e azione consigliata. Rollback applicato alla potatura successiva di Mongo/disco/endpoint, quindi il tab Backend mantiene stato sistema e prestazioni live.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: La diagnostica deve restare operativa per l'utente: priorita a locali/dispositivi/build, dettagli tecnici solo se servono davvero.

### [2026-07-05 00:18 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/frontend/craco.config.js`
- `/app/frontend/src/components/UpdateBanner.js`
- `/app/frontend/src/components/FrontendDiagnostics.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Fix anti-cache definitivo: il bundle React ora incorpora la versione di build via Webpack, confronta periodicamente quella versione con `/version.json` e forza un reload quando la tab sta eseguendo codice vecchio. La diagnostica frontend ora invia la versione reale del bundle in memoria, non la versione letta dal server.
**Testato**: ✅ sì (metodo: `npm run build`, verifica che la build version venga incorporata nel bundle compilato; soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il fix Nginx da solo non aggiorna tab gia aperte con vecchio JS in memoria; questo controllo lato app serve proprio a intercettare quei casi.

### [2026-07-04 18:42 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Ripensata l'impaginazione di "Dispositivi locali": piu larghezza utile su desktop, eliminato lo scroll orizzontale della tabella e sostituita con righe responsive compatte. La versione webapp ora e il valore primario in grande/monospace, con la data build solo come dettaglio secondario.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: La vista dispositivi deve privilegiare scansione rapida: locale, IP, versione webapp, errori e ultimo heartbeat senza obbligare scroll laterale.

### [2026-07-04 18:32 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: La diagnostica dispositivi frontend ora espone solo client con ruolo `restaurant`, escludendo admin/amministrazione/Federico/Simone e altri ruoli interni. Ogni heartbeat salva anche l'IP client e la tabella "Dispositivi locali" mostra IP e versione webapp in modo esplicito.
**Testato**: ✅ sì (metodo: `python -m py_compile backend/server.py`, `npm run build`, restart backend locale, heartbeat Admin + Flaminio -> `/api/admin/diagnostics` mostra solo device `restaurant` con `ip` e `frontend_version`)
**Note per il prossimo agente**: Mantenere il filtro restaurant lato backend; non affidarsi solo al frontend per nascondere dispositivi admin.

### [2026-07-04 18:18 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa dalla Diagnostica Live la sezione `Timeline ultimi eventi`, non utile per l'uso operativo richiesto. Restano storico salute, tab Backend/Frontend/Dispositivi locali, errori e dettagli tecnici.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Non reintrodurre la timeline senza richiesta esplicita: l'utente l'ha rimossa per ridurre rumore.

### [2026-07-04 18:16 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Separata la Diagnostica Live in tab dedicate: `Backend`, `Frontend` e `Dispositivi locali`. Il semaforo generale resta in alto, mentre stato server/API/WebSocket resta nel tab Backend, errori browser nel tab Frontend e la vista per locale/dispositivo nel tab Dispositivi locali, per evitare confusione con molti locali.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il build rigenera `frontend/public/version.json`; e stato ripristinato.

### [2026-07-04 17:29 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/setup.sh`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiornato il template Nginx di setup con cache policy corretta per React SPA: `index.html` e `version.json` no-cache/no-store, asset `/static/` cachati forte con `immutable`. Serve a evitare che i tablet ricarichino una shell React vecchia dopo deploy.
**Testato**: ✅ sì (metodo: verifica configurazione template)
**Note per il prossimo agente**: La modifica al repo non aggiorna automaticamente il VPS gia installato; applicare la stessa policy in `/etc/nginx/sites-available/pastasciutta` e fare `nginx -t && systemctl reload nginx`.

### [2026-07-04 17:24 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: La diagnostica frontend ora mostra un solo record per dispositivo, non uno per scheda browser. Il backend collassa gli heartbeat su `device_id`; la UI usa `device_id` come chiave e rimuove riferimenti visibili alle tab.
**Testato**: ✅ sì (metodo: `python -m py_compile backend/server.py`, `npm run build`, restart backend locale, doppio heartbeat stesso `device_id` con due `tab_id` diverse -> un solo dispositivo in `/api/admin/diagnostics`)
**Note per il prossimo agente**: `tab_id` resta accettato nel payload per compatibilita, ma non deve essere usato per mostrare righe separate nella diagnostica.

### [2026-07-04 17:22 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/components/FrontendDiagnostics.js`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rafforzata la diagnostica dispositivi per tanti locali: heartbeat frontend ora distingue device/tab e invia browser, OS, tipo dispositivo, viewport e versione; `/admin/diagnostics` aggrega i dispositivi per locale con online/offline, errori e versioni; la UI mostra una vista scalabile con lista locali e dettaglio dispositivi filtrabile.
**Testato**: ✅ sì (metodo: `python -m py_compile backend/server.py`, `npm run build`, restart backend locale, POST heartbeat arricchito, GET `/api/admin/diagnostics` con verifica `frontend.locations`, device browser e conteggio errori)
**Note per il prossimo agente**: La tabella ora rappresenta sessioni browser/device (`device_id` + `tab_id`), utile quando uno stesso tablet apre piu schede. Il build rigenera `frontend/public/version.json`; e stato ripristinato.

### [2026-07-04 17:17 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/App.js`
- `/app/frontend/src/components/FrontendDiagnostics.js`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Estesa Diagnostica Live senza renderla un mapazzone: aggiunte sezioni compatte per versioni/deploy, frontend/tablet, errori JS/API lato browser e snapshot salute persistiti su Mongo. Ogni browser loggato invia heartbeat tecnico e segnala errori frontend; `/admin/diagnostics` espone ora deployment, device frontend, errori recenti e storico persistito.
**Testato**: ✅ sì (metodo: `python -m py_compile backend/server.py`, `npm run build`, restart backend locale, login Admin, POST `/api/diagnostics/frontend`, GET `/api/admin/diagnostics` con verifica `deployment`, `frontend.devices`, `persisted_health`)
**Note per il prossimo agente**: Lo snapshot Mongo viene scritto al massimo una volta al minuto quando si apre/aggiorna la Diagnostica Live. Il build rigenera `frontend/public/version.json`; e stato ripristinato.

### [2026-07-04 17:08 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Riordinata la Diagnostica Live: `Timeline ultimi eventi` e `Storico salute` ora sono sotto `Stato sistema` e `Prestazioni live`, cosi la pagina mostra prima lo stato attuale e poi il contesto storico.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il build rigenera `frontend/public/version.json`; e stato ripristinato.

### [2026-07-04 17:05 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Evoluta la Diagnostica Live in una vista decisionale: il backend ora espone motivi del semaforo, timeline eventi e storico salute 15 min/1 ora/24 ore; il frontend mostra subito perche il sistema e OK/Attenzione/Critico, gli ultimi eventi tecnici e se errori/lentezza/disconnessioni sono episodici o ricorrenti.
**Testato**: ✅ sì (metodo: `python -m py_compile backend/server.py`, `npm run build`, login Admin + GET `/api/admin/diagnostics` con verifica `health_reasons`, `timeline_events`, `health_history`)
**Note per il prossimo agente**: Lo storico e in memoria come il buffer diagnostico: si svuota al riavvio backend. Il build rigenera `frontend/public/version.json`; e stato ripristinato.

### [2026-07-04 16:59 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa dalla Diagnostica Live la lettura operativa "quanto stiamo lavorando" (ordini oggi, DDT pendenti, fatture operative) e sostituita con una sezione tecnica "Prestazioni live": latenza media, picco latenza, errori server, chiamate lente e tabella degli endpoint piu critici per errori/latenza.
**Testato**: ✅ sì (metodo: `npm run build`, riuscito con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il build rigenera `frontend/public/version.json`; e stato ripristinato e non fa parte della modifica.

### [2026-07-04 16:51 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs
**File toccati**:
- `/app/memory/refactor_plan_server_py.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunta regola esplicita per tutti gli agenti: lavorare anche da reviewer e architetti, non solo da implementatori. Aggiornato il piano split `server.py` con gate anti-regressione obbligatori su JWT, WebSocket manager singleton, import graph e assenza di import da `server.py` nei router.
**Testato**: ✅ sì (metodo: verifica documento e `git diff`)
**Note per il prossimo agente**: Prima di iniziare lo split, leggere questo piano e trasformare ogni rischio architetturale in un gate verificabile.

### [2026-07-04 00:25 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Trasformata la pagina Diagnostica Live in una vista Stato Sistema piu operativa: stato backend/Mongo/disco/API, salute operativa per locale, DDT/fatture da controllare, WebSocket e dettagli tecnici collassabili. L'endpoint `/api/admin/diagnostics` ora restituisce anche metriche sintetiche di sistema e operativita giornaliera.
**Testato**: si (metodo: `python -m py_compile backend/server.py`, `npm run build` con soli warning ESLint preesistenti)
**Note per il prossimo agente**: Il build rigenera `frontend/public/version.json`; e stato ripristinato e non fa parte di questa modifica.

### [2026-07-03 23:55 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiornato l export Excel Numeri per compilare le colonne MEDIA solo sui mesi conclusi. Per l'anno corrente il mese in corso resta senza media sulla riga di fine mese futura, evitando medie parziali come luglio calcolato sui primi giorni del mese.
**Testato**: si (metodo: `python -m py_compile backend/server.py`)
**Note per il prossimo agente**: Il foglio continua a generare tutte le date dell'anno; cambia solo la compilazione delle colonne MEDIA per mesi non ancora conclusi.

### [2026-07-03 23:35 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/backend/server.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il calcolo della pagina Numeri e dell export Excel annuale: ora usa il conteggio reale degli ordini del giorno sommando `orders`, `archived_orders` e `deletion_logs`, invece del massimo `order_number` giornaliero. Questo evita numeri storici gonfiati quando i vecchi progressivi non erano giornalieri o erano sporchi.
**Testato**: si (metodo: `python -m py_compile Beta-no-magazzino/backend/server.py`)
**Note per il prossimo agente**: La voce del 2026-07-03 15:44 descriveva il vecchio criterio basato sul massimo `order_number`; da questa modifica in poi il criterio corretto e il conteggio documentale reale.

### [2026-07-03 20:55 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossi dalla Home operativa del locale Flaminio i collegamenti in basso "Magazzino Bevande" e "Report Ieri". Restano invariati gli altri pulsanti della Home locale.
**Testato**: si (metodo: controllo sorgente e `yarn build`)
**Note per il prossimo agente**: Non fare commit/push senza conferma esplicita dell'utente.

### [2026-07-03 20:24 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Cambiata l'intestazione della dashboard dell'account Federico da "Supervisione" a "Federico", lasciando invariato il fallback "Supervisione" per eventuali altri supervisor. Allineata anche la password seed di Federico alla credenziale documentata `Pastasciutt4!`.
**Testato**: si (metodo: login Federico API, `python -m py_compile`, `yarn build`)
**Note per il prossimo agente**: Non fare commit/push senza conferma esplicita dell'utente.

### [2026-07-03 20:02 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/backend/server.py`
- `/app/frontend/src/App.js`
- `/app/frontend/src/pages/CreaLocaliPage.js`
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto l'account privilegiato `Simone` con ruolo `admin`, password dedicata e creazione automatica sia da `/api/seed` sia allo startup backend. La dashboard iniziale di Simone mostra selettore locali e solo i pulsanti richiesti: Diagnostica live, Cestino Generale - Audit, Fatture Globale e Crea nuovi locali; quando Simone seleziona un locale entra nella normale Home ristorante, come Admin quando clicca Flaminio. La nuova pagina crea locali `restaurant` con username, nome locale, password e numero bollitori; la Home mostra il secondo bollitore quando `boiler_count >= 2`. Gli stessi pulsanti riservati a Simone sono stati rimossi dalla Home Admin.
**Testato**: si (metodo: login API Simone, `/api/admin/restaurants`, `/api/admin/diagnostics`, `/api/admin/generale-hide-log`, `/api/admin/fatture-globali`, creazione locale API, login nuovo locale, `python -m py_compile`, `yarn build`)
**Note per il prossimo agente**: Account creato anche nel DB locale `pastasciutta_local` per test immediato. Non fare commit/push senza conferma esplicita dell'utente.

### [2026-07-03 19:48 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/.gitignore`
- `/app/LOCAL_NATIVE.md`
- `/app/scripts/start-local-native.ps1`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto ambiente locale nativo Windows senza Docker, il piu fedele possibile alla VPS: MongoDB 8 portable, backend FastAPI su 8001, frontend React su 3000, Python 3.12 e Yarn 1.22.22. Lo script avvia i servizi e mantiene file locali, log e database fuori da Git.
**Testato**: si (metodo: MongoDB 8.0.26 portable, backend `/api/`, frontend `localhost:3000`, seed, login Admin, `python -m py_compile`, `yarn build`)
**Note per il prossimo agente**: Docker non e disponibile su questo PC. Usare `.\scripts\start-local-native.ps1`; le cartelle `.local-tools/`, `.local-data/`, `logs/`, `backend/.venv`, `frontend/node_modules` e i `.env` locali restano ignorati.

### [2026-07-03 17:36 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: fix
**File toccati**:
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Esteso anche alla riga "Cassa" della pagina Report il filtro che rimuove lettere e caratteri non numerici dagli input. Ora i campi banconote usano lo stesso `sanitizeNum` gia adottato da movimentazione, spicci e cassetto.
**Testato**: si (metodo: `yarn build`, riuscito con warning ESLint preesistenti)
**Note per il prossimo agente**: Il build rigenera `frontend/public/version.json`; non includerlo nel commit se non richiesto.

### [2026-07-03 15:44 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/requirements.txt`
- `/app/frontend/src/pages/MediaLocaliPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto bottone "SCARICA EXCEL" nella pagina Numeri (`/media-locali`). Il download chiama il nuovo endpoint admin `/api/admin/media-locali/export?year=YYYY`, che genera un file `.xlsx` annuale dal 1 gennaio al 31 dicembre con colonne DATA, locali, TOTALI e medie mensili compilate solo sull ultimo giorno di ogni mese.
**Testato**: si (metodo: build backend Docker con `openpyxl`, `python -m py_compile`, export autenticato Admin su `localhost:8002`, controllo intestazioni workbook, simulazione ordini/log con medie mensili attese per gennaio/febbraio, `yarn build`)
**Note per il prossimo agente**: L export usa gli stessi criteri della pagina Numeri: per ogni locale prende il massimo `order_number` giornaliero da ordini attivi, archiviati e cancellati. Nel DB locale Docker sono stati inseriti record fittizi dei tre locali solo per verificare le intestazioni complete del file.

### [2026-07-03 14:38 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/docker-compose.local.yml`
- `/app/docker/local/backend.Dockerfile`
- `/app/docker/local/frontend.Dockerfile`
- `/app/.dockerignore`
- `/app/LOCAL_DOCKER.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto ambiente locale Docker per testare l app con versioni vicine alla VPS: Python 3.12, Node.js 20 e MongoDB 8.0. Documentati avvio standard, fallback porta backend 8002 su Windows, seed account e comandi operativi.
**Testato**: si (metodo: `docker compose build`, `docker compose up -d`, health backend `/api/`, frontend `localhost:3000`, seed e login Admin)
**Note per il prossimo agente**: Su questo PC la porta host 8001 risultava bloccata da un socket Windows orfano; lo stack Docker e stato validato con `BACKEND_HOST_PORT=8002` e `REACT_APP_BACKEND_URL=http://localhost:8002`. Dentro Docker il backend resta su 8001.


<!-- Le voci più vecchie vanno archiviate in CHANGELOG_MULTI_AGENT_ARCHIVE.md dopo 30 giorni -->
