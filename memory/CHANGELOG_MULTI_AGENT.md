# 🤖 CHANGELOG MULTI-AGENT — Pastasciutta App

> **Scopo / Purpose**
> Questo file serve a sincronizzare il lavoro di più agenti AI (Emergent E1, Claude, GPT, Cursor, Copilot, agenti esterni, ecc.) che modificano lo stesso codebase in momenti diversi.
> This file synchronizes work across multiple AI agents (Emergent E1, Claude, GPT, Cursor, Copilot, external agents, etc.) modifying the same codebase at different times.

---

## 📜 ISTRUZIONI PER L'AGENTE / INSTRUCTIONS FOR THE AGENT

**🇮🇹 ITALIANO**
Prima di iniziare qualsiasi modifica al codice:
1. **LEGGI** prima `/app/memory/INDEX.md`, poi integralmente la sezione "LOG MODIFICHE" sotto, dal più recente al più vecchio.
2. Leggi anche `/app/memory/PRD.md` per il contratto del prodotto e `/app/memory/TODO.md` per i lavori aperti.
3. Dopo aver completato il tuo lavoro (anche un fix piccolo), **AGGIUNGI** una nuova voce in cima alla sezione "LOG MODIFICHE" seguendo il formato indicato.
4. NON cancellare voci precedenti. Solo aggiungere.
5. Se il file supera le 500 righe, sposta le voci più vecchie di 30 giorni in `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.
6. Lavora anche da **reviewer e architetto**: segnala rischi, regressioni, debiti strutturali, cicli di import e test mancanti; non limitarti a implementare la richiesta minima.
7. **Frontend = pubblico**: considera sempre `frontend/src`, `frontend/public`, `frontend/build`, sourcemap e variabili `REACT_APP_*` come leggibili dall'utente finale. Non inserire mai segreti, password, PIN di sicurezza reale, token permanenti, chiavi API non pubbliche, credenziali o documenti operativi nel frontend. Ogni autorizzazione, ruolo e tenant deve essere verificato dal backend; i controlli frontend sono solo UX.
8. Ogni nuova route backend deve dichiarare e testare chi puo usarla: anonimo, locale, magazzino, Federico, Admin e Simone. Se manca una scelta esplicita, la route va considerata non pronta.
9. Chi tocca login, auth, ruoli, upload, WebSocket o Report deve fare anche revisione sicurezza: tenant isolation, privilegi, dati esposti, logging, rollback e regressioni. Non basta verificare che "funzioni".
10. Questo file deve restare in UTF-8 con BOM per compatibilita con PowerShell/Windows. Se compaiono caratteri strani nelle intestazioni, fermati e riapri/salva in UTF-8; non copiare testo mojibake nel file.
11. **Aree analitiche/contabili sensibili**: Report, Cassa, Audit, Analisi, export Excel, chiusure, diagnostica su dati reali e qualunque calcolo economico/operativo vanno trattati come zone sensibili. Ogni modifica deve verificare dati vecchi e nuovi, mese aperto/chiuso quando rilevante, filtri, totali, duplicati, tenant/ruoli e aggiornamenti live.
12. Se una richiesta tocca produzione, Nginx/SSL/cache, auth/ruoli, dati reali, cancellazioni, import/export o refactor strutturali, l'agente deve esplicitare il rischio prima di agire, indicare test e rollback, e fermarsi se manca una condizione di sicurezza essenziale.

**🇬🇧 ENGLISH**
Before making any code change:
1. **READ** `/app/memory/INDEX.md` first, then the entire "CHANGE LOG" section below, newest first.
2. Also read `/app/memory/PRD.md` for the product contract and `/app/memory/TODO.md` for open work.
3. After completing your work (even small fixes), **ADD** a new entry on top of the "CHANGE LOG" section using the format below.
4. DO NOT delete previous entries. Only append.
5. If this file grows beyond 500 lines, move entries older than 30 days to `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.
6. Also act as a **reviewer and architect**: call out risks, regressions, structural debt, import cycles, and missing tests; do not only implement the smallest requested change.
7. **Frontend = public**: always treat `frontend/src`, `frontend/public`, `frontend/build`, sourcemaps, and `REACT_APP_*` variables as readable by end users. Never put secrets, passwords, real security PINs, long-lived tokens, non-public API keys, credentials, or operational documents in the frontend. Every authorization, role, and tenant check must be enforced by the backend; frontend checks are UX only.
8. Every new backend route must declare and test who may use it: anonymous, restaurant, warehouse, Federico, Admin, and Simone. If this is not explicit, the route is not ready.
9. Any change touching login, auth, roles, uploads, WebSocket, or Report must include a security review: tenant isolation, privileges, exposed data, logging, rollback, and regressions. Checking that it "works" is not enough.
10. Keep this file encoded as UTF-8 with BOM for PowerShell/Windows compatibility. If headings show mojibake or broken characters, stop and reopen/save as UTF-8; do not paste mojibake back into the file.
11. **Sensitive analytics/accounting areas**: Report, Cash Register, Audit, Analytics, Excel exports, closures, diagnostics over real data, and any economic/operational calculation must be treated as sensitive areas. Every change must verify old and new data, open/closed month behavior when relevant, filters, totals, duplicates, tenant/roles, and live updates.
12. If a request touches production, Nginx/SSL/cache, auth/roles, real data, deletions, import/export, or structural refactors, the agent must explicitly call out the risk before acting, state tests and rollback, and stop if an essential safety condition is missing.

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
- **Credenziali test** → mai nel repository; il file dedicato descrive solo la procedura
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
| Uploads (foto DDT/fatture) | `/var/lib/pastasciutta/uploads/` dopo P0-B |
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
- **HTTPS / Cert**: HTTPS attivo; HTTP e accesso via IP reindirizzano a `https://pasta-app.it`

### ⚙️ Servizi systemd / systemd services
| Servizio | Funzione |
|---|---|
| `pastasciutta-backend.service` | FastAPI via uvicorn su `127.0.0.1:8001` |
| `mongod.service` | MongoDB |
| `nginx.service` | Reverse proxy `:80` → frontend + `/api/` → backend |

Definizione service backend (`/etc/systemd/system/pastasciutta-backend.service`):
```ini
[Service]
Type=simple
User=root
WorkingDirectory=/opt/pastasciutta/backend
Environment=PATH=/opt/pastasciutta/backend/venv/bin:/usr/bin
ExecStart=/opt/pastasciutta/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=3
```

### 🌐 Configurazione Nginx (sintesi)
File: `/etc/nginx/sites-available/pastasciutta`
- `listen 80` → redirect a HTTPS; anche l'accesso via IP reindirizza al dominio canonico
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
APP_ENV=production
ENABLE_API_DOCS=false
UPLOADS_DIR=/var/lib/pastasciutta/uploads
```
**Frontend** (`/opt/pastasciutta/frontend/.env`):
```env
REACT_APP_BACKEND_URL=https://pasta-app.it
```

### 🚀 Comandi utili per il VPS / Useful VPS commands
| Operazione | Comando |
|---|---|
| **Deploy completo** | `cd /opt/pastasciutta && sudo git pull --ff-only origin main && cd frontend && sudo yarn build && sudo systemctl restart pastasciutta-backend` |
| Riavvio backend | `sudo systemctl restart pastasciutta-backend` |
| Log backend live | `sudo journalctl -u pastasciutta-backend -f` |
| Stato backend | `sudo systemctl status pastasciutta-backend` |
| Riavvio Nginx | `sudo systemctl restart nginx` |
| Stato MongoDB | `sudo systemctl status mongod` |
| Mongo shell | `mongosh pastasciutta` |
| Installare pacchetto Python sul VPS | `/opt/pastasciutta/backend/venv/bin/pip install <pkg>` |
| Build frontend | `cd /opt/pastasciutta/frontend && yarn build` |
| Gestione account offline | `cd /opt/pastasciutta/backend && sudo venv/bin/python scripts/manage_account.py --help` |

### 🛡️ Note di sicurezza specifiche VPS
- `JWT_SECRET` **non ha fallback** nel codice → se manca, il backend non parte. Generare con `openssl rand -hex 32`.
- CORS: allowlist di produzione limitata a `https://pasta-app.it` e `https://www.pasta-app.it`.
- Rate limiting su `/api/auth/login` (10/min via `slowapi`).
- Path traversal in `/api/uploads/{filename}` mitigato.
- Le foto caricate finiscono in `/var/lib/pastasciutta/uploads/`; non riportarle nella repository.
- Backup: **manuale al momento** (P2: backup cloud automatico in roadmap). Salvare dump MongoDB, `/var/lib/pastasciutta/uploads/`, file `.env` e credenziali di integrazione in una destinazione root-only/off-site.

### 🆚 Differenze ambiente Emergent (questo) vs VPS produzione
| Aspetto | Emergent (qui) | VPS utente |
|---|---|---|
| Process manager | `supervisorctl` | `systemctl` |
| Frontend dev | `yarn start` (hot reload) | `yarn build` + Nginx statico |
| Backend reload | hot reload uvicorn | manual `systemctl restart` |
| Mongo | URL da env | `mongodb://localhost:27017` locale |
| `REACT_APP_BACKEND_URL` | preview emergentagent.com | IP/dominio VPS |
| Uploads | `/app/uploads/` | `/var/lib/pastasciutta/uploads/` |
| Google creds | non presenti / mock | `/opt/pastasciutta/backend/google_credentials.json` |

> **➡️ Quando suggerisci comandi all'utente, usa SEMPRE i path VPS (`/opt/pastasciutta/...`) e `systemctl`, NON i path di Emergent (`/app/...`) né `supervisorctl`.**

---

## 📋 LOG MODIFICHE / CHANGE LOG
> **⬇️ Aggiungere nuove voci QUI SOTTO, in cima alla lista (più recente in alto). ⬇️**

### [2026-09-02 13:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | manutenzione upload | magazzino
**File toccati**:
- `/app/backend/app/tasks/maintenance.py`
- `/app/backend/tests/test_upload_maintenance.py`
- `/app/memory/INDEX.md`
- `/app/memory/PRD.md`
- `/app/memory/WAREHOUSE_LOAD_RETENTION_WARNING.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Dopo 90 giorni la manutenzione elimina ora anche il documento visibile del carico verso il magazzino, oltre alle foto DDT/fattura. I movimenti di stock già prodotti dal carico restano intenzionalmente invariati; il comportamento dei carichi bevande non cambia.
**Testato**: ✅ sì (metodo: test unitario dedicato su cancellazione riga/file e conservazione del movimento; suite backend completa).
**Note per il prossimo agente**: leggere `/app/memory/WAREHOUSE_LOAD_RETENTION_WARNING.md` prima del rollout. In produzione esistono 20 carichi legacy del 28 aprile-7 maggio privi di qualunque movimento ledger associato; non usare automaticamente il ledger come unica fonte dell'Analisi magazzino senza una migrazione verificata.

### [2026-09-02 12:11 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: rimozione feature | Cassa Flaminio | frontend | test
**File toccati**:
- `/app/frontend/src/pages/CassaPage.js`
- `/app/frontend/src/components/{CassaBevandeBox,CassaBevandeBox.test}.js` (rimossi)
- `/app/frontend/public/version.json`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa completamente dalla pagina Cassa di Flaminio la finestra laterale per incrementare o diminuire le bevande, inclusi il richiamo per riaprirla e lo spazio desktop riservato sulla destra. Il dizionario prezzi, il Report, i conteggi storici e le API bevande non sono stati modificati.
**Testato**: sì (metodo: suite frontend completa `60 passed`; build React produzione riuscita con soli warning Hook preesistenti; `git diff --check`).
**Note per il prossimo agente**: il componente dedicato e il relativo test sono stati eliminati perché non avevano altri utilizzatori. I dati di vendita bevande eventualmente già registrati restano invariati nel database.

### [2026-09-02 11:53 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | Analisi mensile | export Excel | test
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Ripristinato l'export Excel dell'Analisi mensile dopo l'introduzione dei listini bevande per locale. Il payload mantiene il metadato compatibile dei prezzi predefiniti, mentre i calcoli giornalieri continuano a usare il listino del singolo locale o lo snapshot storico; eliminato il `NameError` sulla vecchia variabile globale `bev_prices` che causava una risposta HTTP 500 a ogni download.
**Testato**: sì (metodo: test mirati analisi/report `36 passed`; suite backend completa `244 passed, 36 skipped`; integrazione isolata con generazione e salvataggio reale del workbook `1 passed`; `git diff --check`).
**Note per il prossimo agente**: nessuna modifica a dati, formule contabili, ruoli o API. La chiave top-level `bev_prices` resta disponibile come catalogo predefinito per compatibilità; i prezzi effettivi sono già salvati nelle righe per locale.

### [2026-09-01 11:59 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | Storico chiusure | controllo operativo | test
**File toccati**:
- `/app/frontend/src/pages/{ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: La cella `Altro` dello Storico chiusure diventa rossa quando il numero dei valori numerici presenti nell'espressione non coincide con il numero dei commenti separati da virgola. Segmenti commento vuoti sono invalidi; campo e commento entrambi vuoti restano validi. Il conteggio riconosce correttamente le virgole decimali, quindi `10,50+3,20` vale come due valori e non come quattro.
**Testato**: sì (metodo: test mirati Storico chiusure `11 passed`, inclusi mismatch visivo, decimali italiani, formule, commenti vuoti e stato vuoto; suite frontend completa `61 passed`; build React produzione riuscita con soli warning Hook preesistenti; `git diff --check`).
**Note per il prossimo agente**: controllo esclusivamente visivo nella griglia Federico; non blocca l'inserimento del cassiere, non riscrive commenti o valori, non cambia formule, totali, API, ruoli o documenti Mongo. Il doppio clic continua a mostrare espressione e commento originali per correggere il dato dal Report storico.

### [2026-09-01 11:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | upload | diagnostica operativa | sicurezza | test
**File toccati**:
- `/app/backend/app/{bootstrap.py,routers/{documents,upload_attempts}.py,schemas/{__init__,documents,upload_attempts}.py,services/upload_attempts.py,tasks/maintenance.py}`
- `/app/backend/server.py`
- `/app/backend/tests/{test_upload_attempts,test_phase1_foundations_contract,test_phase3_module_contract}.py`
- `/app/frontend/src/{App.js,pages/{HomePage,ChiusurePage,ControlloCaricamentiPage,ControlloCaricamentiPage.test}.js,utils/{uploadAttemptTracking,uploadAttemptTracking.test}.js}`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Aggiunta fuori dalla Diagnostica live la pagina desktop `Controllo caricamenti`, raggiungibile dai pulsanti degli account Federico e Simone. Ogni foto di chiusura primaria o secondaria produce una cronologia persistente di soli metadati (selezione, compressione, invio, arrivo al backend, salvataggio o errore), con locale e dispositivo; gli eventi non consegnati restano in coda locale e vengono ritentati al ritorno online. Il cassiere continua a vedere soltanto messaggi brevi e può riprovare con la foto ancora pronta, mentre la pagina privilegiata offre filtri, riepilogo, ultima fase e timeline espandibile. I metadati vengono rimossi dopo 90 giorni insieme alla finestra di retention delle chiusure.
**Testato**: sì (metodo: backend completo `243 passed, 36 skipped`; frontend completo `59 passed`; test HTTP della matrice ruoli per entrambe le nuove route; build React produzione riuscita con soli warning Hook preesistenti; OpenAPI aggiornato a 94 path/38 schema; `git diff --check`).
**Note per il prossimo agente**: matrice backend esplicita: `POST /api/upload-attempts/events` richiede autenticazione ed è ammesso per locale, Admin, Simone e Federico, ma non per Magazziniere o altri supervisor; il tenant è sempre derivato dal token. `GET /api/admin/upload-attempts` è leggibile esclusivamente da Federico e Simone: anonimo, locale, Magazziniere, altri supervisor e Admin generico ricevono 401/403. Il registro nasce con questo rilascio e non può ricostruire retroattivamente tentativi client precedenti; il tracking server è best effort e ha timeout isolato, quindi non può bloccare il salvataggio della chiusura.

### [2026-08-25 15:20 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | Cassa | UX | bugfix | test
**File toccati**:
- `/app/frontend/src/pages/CassaPage.js`
- `/app/frontend/src/components/CassaBevandeBox.js`
- `/app/frontend/src/components/CassaBevandeBox.test.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Ripristinata nella Cassa desktop di Flaminio la colonna verticale Bevande, alimentata dalle nove voci del catalogo effettivo: ogni riga mostra nome, sigla, contatore, pulsante `-` rosso e pulsante `+` verde. Rimossi i vecchi comandi da tastiera globali che interferivano con la scrittura degli ordini. Corretto inoltre il flusso ottimistico che poteva cambiare il contatore senza inviare la registrazione backend; incremento e storno usano ora coerentemente le API giornaliere esistenti.
**Testato**: sì (metodo: suite frontend completa `55 passed`; nuovo test con tutte le 9 bevande, colori, incremento, decremento e chiamate POST; build React produzione riuscita con soli warning Hook preesistenti; endpoint locale reale verificato con sigle `AL, AG, C, CZ, F, S, B, VB, VR`; frontend locale compilato e senza errori browser alla schermata di accesso; `git diff --check`).
**Note per il prossimo agente**: la colonna resta intenzionalmente legata a Flaminio, come le API `beverage_sales` e la giacenza bevande preesistenti; non è ancora collegata automaticamente alle righe `beverage_daily_counts` del Report. Il backend non è stato modificato e nulla è stato distribuito sulla VPS.

### [2026-08-25 14:57 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX
**File toccati**:
- `/app/frontend/src/pages/DizionarioBevandePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa dalla pagina Prezzi delle bevande la riga riepilogativa con numero di bevande collegate e somma dei prezzi unitari.
**Testato**: sì (metodo: controllo testuale del sorgente e compilazione automatica del frontend locale).

### [2026-08-25 14:55 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX
**File toccati**:
- `/app/frontend/src/pages/DizionarioBevandePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa su richiesta la descrizione introduttiva sotto il titolo della pagina Prezzi delle bevande, senza modificare listino, calcoli o protezione dello storico.
**Testato**: sì (metodo: controllo testuale del sorgente e compilazione automatica del frontend locale).

### [2026-08-25 14:50 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | Report | sicurezza dati | UX | test
**File toccati**:
- `/app/backend/app/{bootstrap.py,routers/{beverages,report}.py,schemas/{__init__,report}.py,services/{beverage_prices,analysis,report}.py}`
- `/app/backend/{server.py,memory_worker/{contracts.py,sources/configuration.py,stores/mongo.py}}`
- `/app/backend/tests/{test_beverage_price_dictionary,test_beverage_signed_totals,test_memory_worker_configuration,test_phase1_foundations_contract,test_phase2_module_contract,test_phase3_module_contract}.py`
- `/app/frontend/src/{App.js,pages/{HomePage,DizionarioBevandePage,DizionarioBevandePage.test}.js}`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Aggiunto nell'area Federico un listino bevande per locale, simile al Dizionario Paste ma limitato ai prezzi: nomi, sigle e ordinamento restano fissi per non rompere magazzino e Report. Il listino effettivo alimenta Report live/storico, Cash Sera, riporto Mattina, Storico chiusure, Analisi Excel e vendite bevande. Ogni riga giornaliera acquisisce uno snapshot del prezzo; prima di una modifica o di un reset vengono inoltre congelate le righe legacy ancora prive di snapshot, così un nuovo prezzo non ricalcola chiusure già registrate. Aggiunta la collection tenant-specific `beverage_price_dictionary`, indice univoco, API GET/PUT/DELETE e raccolta futura nella Memoria operativa.
**Testato**: sì (metodo: backend completo `218 passed, 36 skipped`; frontend completo `54 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; API locale reale caricata con 9 bevande e prezzi default; OpenAPI e route ownership aggiornati; `git diff --check`; backend e frontend locali attivi su `127.0.0.1:8001` e `localhost:3000`).
**Note per il prossimo agente**: nessuna modifica è stata inviata alla VPS. Matrice route: anonimo rifiutato dalla dipendenza Bearer; locale e magazzino possono leggere soltanto il listino del proprio tenant ma non modificarlo né indicare altri locali; Federico, Admin e Simone possono leggere/scrivere/reset per locale; ogni mutazione è nuovamente validata nel backend e accetta soltanto le nove sigle tecniche complete. I dati storici già presenti vengono materializzati soltanto alla prima modifica del listino, usando il prezzo che era effettivo prima del cambio.

### [2026-08-19 12:20 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | diagnostica | UX | bugfix | test
**File toccati**:
- `/app/frontend/src/components/diagnostics/DiagnosticsDevicesView.js`
- `/app/frontend/src/components/diagnostics/DiagnosticsDevicesView.test.js`
- `/app/frontend/src/pages/DiagnosticaLivePage.js`
- `/app/frontend/src/pages/DiagnosticaLivePage.test.js`
- `/app/frontend/src/utils/diagnosticsDevices.js`
- `/app/frontend/src/utils/diagnosticsDevices.test.js`
- `/app/backend/app/routers/system.py`
- `/app/backend/tests/test_diagnostics_devices.py`
- `/app/scripts/start-local-native.ps1`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rifatta da zero Diagnostica Live come control room desktop: tre locali affiancati gia a larghezza PC, tutti i dispositivi online visibili senza accordion, ricerca e filtro problemi, dati immediati su pagina/sistema/rete/batteria/RTT e pannello completo con spiegazione e azione concreta per ogni anomalia. Rimossi tab e semaforo generico; backend, MongoDB, disco, WebSocket, finestre temporali ed endpoint restano disponibili in una sezione tecnica subordinata. Il collaudo reale ha inoltre corretto un `NameError` nell'acquisizione degli errori frontend, che trasformava ogni segnalazione browser in un falso `500`, e lo script locale ora accetta correttamente un MongoDB gia attivo anche senza eseguibile portatile nel repository.
**Testato**: si (metodo: backend completo `208 passed, 36 skipped`, incluso nuovo test sull'identita tenant autorevole dell'errore frontend; frontend completo `53 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; collaudo browser locale con 3 locali, 4 dispositivi Windows/Android/iPadOS simulati, griglia desktop, filtro problemi, dettaglio tecnico, azioni suggerite, auto-refresh e sezione infrastruttura; dopo il fix nessun errore API `5xx`; `git diff --check`).
**Note per il prossimo agente**: nessuna route o regola di accesso e stata ampliata: la lettura resta Admin/Federico, la rinomina resta Admin e Simone, identita e sede continuano a essere determinate dal backend. Batteria, modello e Network Information possono risultare non disponibili per limiti del browser e vengono mostrati come dato assente, non come guasto. Il simulatore usato per il collaudo vive fuori dal repository e alimenta solo buffer diagnostici volatili locali.

### [2026-08-19 11:30 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix
**File toccati**:
- `/app/frontend/src/pages/AuditCassaPage.js`
- `/app/frontend/src/pages/AuditCassaPage.test.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: La cronologia `Check singoli movimenti` mostra ora i valori prima/dopo di `VERS` come espressioni numeriche pulite, senza esporre gli `<span>` usati dal Report per i colori. La pulizia gestisce anche i tag troncati a metà dal limite storico dell'audit, lasciando invariati i raw salvati e tutti gli altri campi.
**Testato**: si (metodo: test mirati Audit Cassa `4 passed`, inclusi span completo, span troncato e campo non-VERS; suite frontend completa `49 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; `git diff --check`).
**Note per il prossimo agente**: modifica esclusivamente di presentazione frontend; API, ruoli, tenant, filtri, totali e documenti Mongo non cambiano. React continua a rendere testo escapato e non viene usato `dangerouslySetInnerHTML`; nessuna migrazione o bonifica dei log storici è necessaria.

### [2026-08-06 14:08 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | diagnostica | UX | sicurezza | test
**File toccati**:
- `/app/backend/app/{bootstrap.py,routers/system.py,schemas/{__init__,diagnostics}.py}`
- `/app/backend/tests/{test_diagnostics_devices,test_phase1_foundations_contract,test_phase3_module_contract}.py`
- `/app/frontend/src/components/{FrontendDiagnostics.js,FrontendDiagnostics.test.js,diagnostics/DiagnosticsDevicesView.js}`
- `/app/frontend/src/{pages/DiagnosticaLivePage.js,utils/diagnosticsDevices.js,utils/diagnosticsDevices.test.js}`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Rifatta la sezione dispositivi di Diagnostica Live come elenco a tutta larghezza dei soli locali online, con un solo locale espanso, ricerca, filtro problemi e pannello laterale per i dettagli. I dispositivi sani non mostrano badge; quelli problematici espongono soltanto avvisi concreti. Aggiunta raccolta best-effort e non bloccante di modello/browser, batteria, rete e latenza heartbeat, oltre a nomi/modelli manuali persistenti modificabili da Admin e Simone; Federico resta in sola lettura. L'identita del locale e ora ricavata lato backend dall'ID autenticato e dalla cache delle sedi, non dall'etichetta dichiarata dal client. I dispositivi offline restano fuori dalla vista e non alterano piu lo stato generale.
**Testato**: si (metodo: backend completo `207 passed, 36 skipped`; matrice HTTP anonimo/locale/magazzino/Federico/Admin/Simone; frontend completo `47 passed`; build produzione riuscita con soli warning Hook preesistenti; collaudo browser locale con due tablet simulati, avvisi, dettagli, separazione sedi e rinomina persistente; `git diff --check`).
**Note per il prossimo agente**: batteria, modello e Network Information dipendono dalle API supportate dal browser e possono risultare non disponibili senza indicare un guasto. Il registry Mongo contiene solo etichette manuali; heartbeat ed errori restano intenzionalmente volatili e falliscono senza influire sui flussi operativi.

### [2026-08-06 10:08 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | organizzazione | stato progetto
**File toccati**:
- `/app/memory/{INDEX,TODO,PRD,CHANGELOG_MULTI_AGENT}.md`
- `/app/memory/{security,operational-memory,plans,archive}/`
**Descrizione**: Riorganizzata la documentazione senza eliminare contenuti: aggiunto un indice centrale con ordine di lettura, stato reale e precedenza delle fonti; sostituita la vecchia TODO dispersiva con una coda sintetica; conservati integralmente i dettagli nel backlog esteso; separati sicurezza, Memoria operativa, piani futuri e documenti conclusi/storici. Corretti i riferimenti operativi e riallineati PRD e P1 allo stato reale di P0, Memoria e revoca mirata Admin. Riposizionata nella corretta data una voce del 30 luglio rimasta fuori sequenza e trasferite nell'archivio, senza riscriverle, le voci piu vecchie di 30 giorni.
**Testato**: si (metodo: scansione completa dei Markdown, verifica dei riferimenti ai percorsi correnti, controllo file obbligatori, BOM del changelog e `git diff --check`; nessuna modifica applicativa eseguita per questa riorganizzazione).
**Note per il prossimo agente**: partire sempre da `/app/memory/INDEX.md`. I percorsi precedenti conservati nelle vecchie voci del changelog sono storia e non vanno riscritti; per i file correnti usare la mappa dell'indice.

### [2026-08-06 09:51 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | operazione VPS | credenziali | revoca sessioni | docs
**File toccati**:
- `/app/memory/security/ADMIN_PASSWORD_ROTATION_RUNBOOK.md`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Applicata sulla VPS, durante finestra autorizzata, la rotazione della password dell'account `Admin` e la revoca mirata delle sessioni precedenti. Dopo backup Mongo e configurazione root-only verificati, account e `ADMIN_MIN_TOKEN_VERSION` sono stati allineati alla versione `6` e il solo backend e stato riavviato. Nessuna password e stata salvata nel repository.
**Testato**: si (metodo: backup Mongo compresso da circa 30 MB con SHA-256 verificato; servizio backend attivo e senza warning/errori successivi al riavvio; token Admin versione `5` rifiutato con `401`; nuova autenticazione Admin e `/api/auth/me` con `200`; vecchia password rifiutata con `401`; token locale con `200`; `.env` `root:root 0600`).
**Note per il prossimo agente**: non abbassare `ADMIN_MIN_TOKEN_VERSION=6`. Una futura rotazione deve produrre una versione superiore e aggiornare account, soglia e servizio nello stesso intervento. La prima automazione via pseudo-terminale e stata scartata dal collaudo perche il valore ricevuto non coincideva; la rotazione definitiva e stata ripetuta correttamente alla versione `6` prima della verifica finale.

### [2026-08-05 14:05 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | Storico chiusure | test
**File toccati**:
- `/app/frontend/src/pages/{ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Nello Storico chiusure e stato scambiato esclusivamente l'ordine visivo dei primi due gruppi bevande: `SCARTI` compare ora prima di `INGRESSI / USCITE`. Celle giornaliere, formule, commenti, totali e dati salvati restano invariati.
**Testato**: si (metodo: test frontend dedicato `9 passed`, inclusa verifica esplicita dell'ordine dei gruppi; build React produzione riuscita con soli warning Hook preesistenti; `git diff --check`).

### [2026-08-05 14:01 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | Storico chiusure | totali | test
**File toccati**:
- `/app/frontend/src/pages/{ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: La barra nera `TOTALE` dello Storico chiusure mostra ora valori esclusivamente sotto `Arr.`, `Altro` e le colonne bevande `SCARTI`. Le celle di giorni, altri movimenti finanziari, spicci, paste, cash sera, ingressi/uscite, magazzino sera e vendite restano presenti ma vuote, preservando perfettamente l'allineamento della griglia e senza cambiare righe o dati giornalieri.
**Testato**: si (metodo: test frontend dedicato `8 passed`, compresa verifica dei tre gruppi valorizzati e di tutte le celle da lasciare vuote; build React produzione riuscita con soli warning Hook preesistenti; `git diff --check`).

### [2026-08-05 13:01 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | Report storico | magazzino | UX | test
**File toccati**:
- `/app/frontend/src/pages/{ReportBetaPage,ReportBetaPage.test,CronologiaMovimentiPage,CronologiaMovimentiPage.test}.js`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Nei Report storici in sola lettura, i cassieri possono ora usare le lenti di `GLO`, `JUST` e `DEL` per consultare tutti i valori dell'espressione originale e il risultato, mentre input e autosalvataggi restano bloccati. La Cronologia movimenti include `Scarto` tra i filtri e rende in rosso l'intera riga `scarto_admin`, conservando motivo, autore, delta e saldo gia registrati dal ledger.
**Testato**: si (metodo: suite frontend completa `39 passed`; test dedicati su tre lenti in sola lettura senza richieste `PUT` e su filtro/riga rossa degli scarti; build React produzione riuscita con soli warning Hook preesistenti; `git diff --check`).
**Note per il prossimo agente**: nessuna API o autorizzazione backend e stata ampliata. La lente legge il raw gia presente nel Report del solo locale autorizzato; gli scarti erano gia restituiti dalla cronologia globale e questa modifica ne aggiunge soltanto classificazione e resa visiva.

### [2026-08-05 12:52 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | magazzino | storico chiusure | Analisi | Excel | sicurezza | test
**File toccati**:
- `/app/backend/app/routers/{warehouse,beverages}.py`
- `/app/backend/app/schemas/{__init__,warehouse}.py`
- `/app/backend/app/services/analysis.py`
- `/app/backend/memory_worker/sources/warehouse.py`
- `/app/backend/tests/{test_warehouse_waste,test_memory_worker_warehouse,test_report_backend_totals,test_phase1_foundations_contract,test_phase3_module_contract}.py`
- `/app/frontend/src/pages/{InventarioPage,InventarioPage.test,AnalisiPage,AnalisiPage.test,ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: In `Inventario / Forza il sistema` e stato aggiunto il comando Admin `Scarti`: richiede prodotto, quantita intera e motivo, impedisce saldi negativi, decrementa la giacenza e registra nel ledger autore, causale `scarto_admin`, motivo e saldo risultante. `Analisi magazzino` mostra gli scarti come ultima colonna, aggregati per prodotto e intervallo di date; la memoria operativa li classifica come consumo reale. Nello Storico chiusure il gruppo Spicci mostra direttamente quattro colonne per i rotolini da `5 €`, `2 €`, `1 €` e `0,50 €`, conservando il dettaglio formula/commento sul singolo taglio. Dall'Excel Analisi mensile e stata eliminata soltanto la colonna `Spicci aperti / portati`.
**Testato**: si (metodo: suite backend completa `197 passed, 36 skipped`; matrice nuova route con anonimo, locale, Magazziniere e Federico rifiutati, Admin e Simone ammessi; suite frontend completa `37 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; prova browser e Mongo locale con `TEST - Farina` da 25 a 23, motivo `Prova locale Codex`, movimento ledger e valore `Scarti = 2` verificato in Analisi; intestazioni dei quattro tagli verificate nello Storico chiusure; `git diff --check`).
**Note per il prossimo agente**: i tre prodotti `TEST - Farina`, `TEST - Olio` e `TEST - Pomodori` e il movimento di prova esistono soltanto nel DB locale `pastasciutta_local`; l'account Admin temporaneo usato per il collaudo e stato eliminato. In produzione non servono backfill o comandi manuali: gli scarti iniziano a essere raccolti dal deploy. Il decremento e condizionato atomicamente alla giacenza disponibile; come per il ledger magazzino esistente, stock e inserimento del movimento restano due scritture Mongo separate e condividono il limite P2 gia documentato sulla resistenza a crash fra scritture.

### [2026-08-03 16:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | auth | revoca mirata | config | docs | test
**File toccati**:
- `/app/backend/app/core/{config,security}.py`
- `/app/backend/scripts/manage_account.py`
- `/app/backend/tests/test_phase1_foundations_contract.py`
- `/app/memory/{ADMIN_PASSWORD_ROTATION_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Preparata nel repository, ma non applicata sulla VPS, la revoca mirata dei JWT dell'account `Admin`. La nuova variabile `ADMIN_MIN_TOKEN_VERSION`, inattiva con default `0`, permette di rifiutare esclusivamente i token Admin precedenti alla versione scelta senza disconnettere Simone, Federico, Magazziniere o i locali. Il comando offline di cambio password continua a incrementare `token_version` e ora stampa la nuova versione necessaria alla revoca, senza esporre la password. Aggiunto un runbook operativo separato per il futuro aggiornamento autorizzato.
**Testato**: si (metodo: test mirato auth `14 passed`, compresi vecchio Admin rifiutato, nuovo Admin accettato e locale non coinvolto; compilazione Python dei tre moduli modificati; suite backend completa `191 passed, 36 skipped`).
**Note per il prossimo agente**: al 03/08/2026 non sono stati cambiati password, `.env`, account o servizi sulla VPS. Non inserire mai la password in Git o nei comandi salvati. Durante la futura finestra seguire `/app/memory/ADMIN_PASSWORD_ROTATION_RUNBOOK.md` e non abbassare la soglia dopo la revoca.

### [2026-08-03 14:57 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | magazzino | richieste merce | UX | sicurezza | test
**File toccati**:
- `/app/backend/app/routers/warehouse.py`
- `/app/backend/tests/{test_warehouse_extra_notes,test_phase1_foundations_contract,test_phase3_isolated_integration,test_phase3_module_contract}.py`
- `/app/frontend/src/pages/{AnalisiPage,AnalisiPage.test}.js`
- `/app/frontend/src/utils/{productOrder,productOrder.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: L'ordine canonico condiviso colloca ora `Cinghiale`, `Ragu di cinghiale` e `Ragù di cinghiale` tra pomodori secchi e pesto di pistacchi in tutti gli elenchi prodotti che usano il catalogo comune: inventario, prodotti, richieste, carichi, DDT, cronologia e Analisi magazzino. In Analisi magazzino e stato aggiunto il pulsante `Campi extra`: apre una finestra sola lettura, filtrabile per data di creazione, con testo extra, locale, data, stato e collegamento al DDT originale. La nuova API restituisce solo i campi necessari e non modifica o duplica le richieste esistenti.
**Testato**: si (metodo: test unitari backend mirati `5 passed`; contratti modulari `6 passed`; integrazione Mongo isolata `1 passed` con matrice ruoli completa; suite backend completa `190 passed, 36 skipped`; suite frontend completa `35 passed`, inclusi ordine prodotti, apertura finestra, collegamento DDT e filtro date; build React produzione riuscita; endpoint presente e server locale attivo su porta 8001).
**Note per il prossimo agente**: `/api/richieste/extra-notes` e intenzionalmente sola lettura e globale soltanto per ruoli `magazzino` e `admin`; anonimo, locali e Federico devono restare esclusi. Il filtro usa il giorno locale di Roma sulla data `created_at` della richiesta e il dettaglio completo continua a vivere nel DDT originale.

### [2026-08-03 11:14 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | Report storico | sola lettura | UX | test
**File toccati**:
- `/app/frontend/src/pages/{ReportBetaPage,ReportBetaPage.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Nei Report aperti dallo Storico chiusure in modalita sola lettura, il pannello sinistro delle paste resta ora utilizzabile per consultazione: si possono scorrere il testo incollato e l'elenco dei prezzi delle righe non riconosciute, oltre ad aprire e scorrere la vista ingrandita. Testo paste, prezzi manuali e comando di blocco aggiornamenti rimangono esplicitamente non modificabili; una guardia aggiuntiva impedisce aggiornamenti dei prezzi anche in caso di evento imprevisto. Nessun flusso backend, dato o permesso e stato modificato.
**Testato**: si (metodo: test frontend dedicato su Report storico in sola lettura, inclusa assenza di richieste `PUT`; suite frontend completa `29 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; prova browser locale autenticata sulla chiusura del 14/07/2026 con 11 paste e 2 righe non riconosciute, pannelli compatti e ingranditi scorrevoli, input `readOnly`, toggle disabilitato e nessun errore console).
**Note per il prossimo agente**: il contenitore generale del Report storico resta non interattivo; soltanto il pannello paste viene riattivato e ogni controllo che potrebbe scrivere deve continuare ad avere un blocco esplicito.

### [2026-08-02 02:02 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | storico chiusure | tracciabilita | test
**File toccati**:
- `/app/frontend/src/pages/{ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: La colonna `Spicci / Aperti` dello Storico chiusure mostra ora, senza richiedere il doppio clic, sia il totale dei rotolini aperti sia la ripartizione per taglio, per esempio `2€×2 · 1€×1`. La stessa ripartizione e disponibile nel totale del periodo; il dettaglio esistente continua a mostrare formule originali e commenti senza nuove API o modifiche ai dati.
**Testato**: si (metodo: test frontend mirato `7 passed`, inclusi riepilogo visibile e dettaglio formule per taglio; suite frontend completa `29 passed`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti).
**Note per il prossimo agente**: I valori derivano esclusivamente dai campi gia presenti `sp5`, `sp2`, `sp1` e `sp05`. `Spicci / Iniziali` resta intenzionalmente `-` perche quel dato non e ancora tracciato dal backend.

### [2026-07-31 13:31 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | storico chiusure | Report | tracciabilita | UX
**File toccati**:
- `/app/backend/app/routers/report.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/frontend/src/pages/{ChiusureExcelPage,ChiusureExcelPage.test}.js`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Lo Storico chiusure espone ora, con doppio clic sulla cella, il risultato, l'espressione aritmetica originale e il commento finale salvati dal Report. Sono coperti i campi finanziari, il dettaglio degli spicci aperti e gli input delle bevande; i riepiloghi puramente calcolati restano invariati. I commenti sono segnalati da un piccolo indicatore e il dettaglio si puo chiudere con il pulsante, cliccando fuori o con `Esc`. La cella `Arr.` ha sfondo verde chiaro nell'intervallo inclusivo `-5..+5` e rosso in tutti gli altri casi, senza cambiare numero, calcoli o posizione della colonna. L'endpoint esistente aggiunge soltanto raw e commenti gia presenti nei documenti autorizzati, senza nuove query, scritture o ampliamento del tenant visibile.
**Testato**: si (metodo: test helper backend sui soli campi consentiti; suite backend completa `185 passed, 36 skipped`; suite frontend completa `28 passed`, inclusi doppio clic finanziario/bevande, commenti, mancata navigazione della riga e limiti ARR `-5/+5`; build React produzione riuscita con soli warning Hook preesistenti in file non coinvolti; prova browser locale autenticata su `/chiusure-excel`, modalita dettaglio verificata e `ARR = 0` osservato con sfondo `rgb(220, 252, 231)`).
**Note per il prossimo agente**: Non ricostruire formule mancanti dall'audit: il dettaglio deve mostrare esclusivamente il raw finale conservato nel documento Report. Le celle calcolate senza un input diretto restano non interattive; la selezione del locale continua a essere imposta e validata dal backend secondo ruolo e tenant.

### [2026-07-31 12:22 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | Analisi mensile | Excel | compatibilita
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/tests/{test_report_backend_totals,test_analysis_excel_isolated_integration}.py`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Corretto il caso in cui Excel segnalava un errore di compatibilita e rimuoveva tutte le note del workbook Analisi mensile. Il testo finale del commento Report viene ora associato alla stessa cella come messaggio contestuale mostrato alla selezione e conservato per intero anche nella formula tramite `N(...)`, senza modificare il risultato numerico. Il file non dipende piu dalle parti XML dei commenti classici che Excel aveva riparato eliminandole.
**Testato**: si (metodo: riproduzione del file scaricato e lettura del log di riparazione Excel; `34 passed` sui test export, inclusi commento massimo con virgolette e casella zero; integrazione Mongo isolata `1 passed`; suite backend completa `184 passed, 36 skipped`; apertura automatizzata con Microsoft Excel 16, risultato formula `780`, nota contestuale presente, zero commenti XML e nessun nuovo log di riparazione; una cella zero con nota resta vuota a video ma vale `0` nei calcoli dipendenti).
**Note per il prossimo agente**: il messaggio visuale di Excel ha un limite di 255 caratteri; l'eventuale testo eccedente resta comunque completo nella barra della formula, suddiviso in piu termini `N(...)` senza effetto sul calcolo.

### [2026-07-31 11:44 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | Analisi mensile | Excel | tracciabilita | test
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/app/routers/analysis.py`
- `/app/backend/tests/{test_report_backend_totals,test_analysis_excel_isolated_integration}.py`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: L'Excel Analisi mensile conserva ora nei fogli locale le espressioni aritmetiche originali inserite nel Report come formule Excel e trasferisce i commenti del tasto destro come note sulla cella corrispondente. Sono coperte movimentazione finanziaria, valori spicci/cassetto e campi bevande; i totali derivati espongono formule coerenti con i calcoli correnti. Le giornate vuote restano vuote, `VERS` viene ripulito dai soli tag di colore e ogni formula grezza passa la stessa whitelist numerica del Report. La modifica e retroattiva sui valori grezzi e sui commenti gia presenti, senza backfill e senza ricostruzioni inventate quando storicamente e stato salvato soltanto un totale.
**Testato**: si (metodo: audit VPS esclusivamente read-only su 117 Report e 679 righe bevande; confermati 139 commenti cassa, commenti su 118 righe bevande e 66 espressioni FT storiche su 76 valori; test unitari export `33 passed`, compresi salvataggio/riapertura reale `.xlsx`, formule, note e blocco contenuti non aritmetici; integrazione Mongo isolata del workbook `1 passed` con formula/commento FT e bevande caricati dal database; suite backend completa `183 passed, 36 skipped`)
**Note per il prossimo agente**: le formule provengono esclusivamente dai raw gia salvati in `cash_daily_counts` e `beverage_daily_counts`; non usare `cash_audit_log` per ricostruire formule, perche contiene anche i singoli autosalvataggi durante la digitazione. Le note Excel devono riportare il commento finale corrente del Report.

### [2026-07-30 13:25 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | DDT | controllo operativo | test
**File toccati**:
- `/app/backend/app/routers/warehouse.py`
- `/app/backend/app/schemas/{__init__,warehouse}.py`
- `/app/backend/tests/{test_phase1_foundations_contract,test_phase3_isolated_integration,test_phase3_module_contract,test_richieste_merce}.py`
- `/app/frontend/src/App.js`
- `/app/frontend/src/pages/{ControlliTrasportiPage,HomePage,RichiestaMercePage}.js`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Aggiunto un controllo nominativo senza cambiare il flusso richieste merce: `pending -> evasa -> confermata/errore` resta invariato. Conferma ricezione richiede ora il nome di chi ha verificato la merce; la segnalazione errore richiede sia nome sia motivo. I dati vengono salvati sul DDT esistente con orario, esito e account autenticato. La nuova pagina essenziale `Controlli trasporti` permette ad Admin e Simone di filtrare per locale e mese; anonimo, locali, Magazziniere e Federico sono rifiutati dal backend. I documenti storici privi del nuovo campo restano compatibili.
**Testato**: sì (metodo: contratto API `6 passed`; integrazione Mongo isolata completa su conferma, errore e matrice ruoli `1 passed`; suite backend `181 passed, 36 skipped`; suite frontend `26 passed`; build React produzione riuscita senza nuovi warning; prova browser locale con due DDT temporanei, pulsanti disabilitati senza nome, conferma `Mario Prova`, errore `Anna Prova`, verifica pagina Admin e rimozione integrale dei dati simulati; `git diff --check`)
**Note per il prossimo agente**: non separare questi controlli in una nuova collezione: i campi `transport_checked_*` appartengono alla richiesta/DDT. La nuova route `/api/admin/transport-checks` è intenzionalmente admin-only; il frontend `AdminOnlyRoute` è soltanto UX e non sostituisce il controllo backend.

### [2026-07-30 10:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | UX | Report desktop
**File toccati**:
- `/app/frontend/src/index.css`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il contenitore della pagina Report che, alle risoluzioni desktop con altezza utile ridotta da scala Windows o barre del browser, nascondeva la parte inferiore destra. L'altezza desktop compensa lo zoom della pagina, mantenendo visibili `Spicci` e il collegamento `Storico chiusure` senza scorrimento. Sotto i 700 px di altezza utile si applica una compattezza desktop leggermente maggiore; la visualizzazione mobile resta verticale e scorrevole. Modifica esclusivamente grafica, senza variazioni a salvataggi, calcoli o logica del Report.
**Testato**: non documentato nella voce originale; commit applicativo `11ac380` presente nella cronologia Git.
**Note per il prossimo agente**: questa voce era stata originariamente appesa fuori dalla sezione cronologica ed e stata ricollocata il 6 agosto 2026 senza modificare il codice descritto.

### [2026-07-29 12:07 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | analisi dati | Excel | test
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/backend/tests/test_analysis_excel_isolated_integration.py`
- `/app/memory/PRD.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Sostituita la tassonomia universale dell'Excel Analisi mensile con i profili del modello ufficiale `2025.xlsx`: Flaminio conserva `Carzuc` e `Amatriciana` come colonne separate, mentre Grazie, Brazzà e i nuovi locali le raggruppano in `Altro`. La classificazione visuale e il calcolo economico sono ora separati, quindi una sigla raggruppata in `Altro` continua a contribuire agli incassi con il prezzo configurato. L'audit read-only VPS sul 27/07 di Brazzà ha inoltre confermato 989 ordini validi, sei descrizioni realmente iniziate con `TONNO`, nessuna modifica/cancellazione per quelle righe e cinque `AMAT`: dopo il fix AMAT confluisce in Altro, mentre la discordanza `TONNO 6/CARB 285` contro `TONNO 5/CARB 286` appartiene al vecchio foglio ufficiale e non alla fonte Mongo.
**Testato**: sì (metodo: modello originale `2025.xlsx` ispezionato per intestazioni per-locale; audit VPS esclusivamente read-only su ordini, snapshot Report e log del 20/07 e 27/07; test unitari export `31 passed`; integrazione Mongo isolata completa del workbook `1 passed`; suite backend completa `181 passed, 36 skipped`; `git diff --check`)
**Note per il prossimo agente**: Non rendere di nuovo universali `AMAT` e `CARZUC`. `_analysis_pasta_types_for_restaurant` accetta un eventuale `analysis_pasta_types` esplicito nel documento locale, usa il profilo esteso per il legacy Flaminio e quello standard come default. Per dimostrare quale formula del vecchio Google Sheet riclassifica `TONNO SPAG 25` servirebbe il workbook ufficiale esportato o una sessione Google autenticata; non alterare i dati nuovi per imitare quella singola anomalia.

### [2026-07-28 15:27 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | storico chiusure | test
**File toccati**:
- `/app/backend/app/routers/report.py`
- `/app/frontend/src/pages/ChiusureExcelPage.js`
- `/app/frontend/src/pages/ChiusureExcelPage.test.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Migliorata la leggibilita immediata delle colonne finanziarie nello Storico chiusure senza modificarne ordine o posizione. Le intestazioni e tutti i valori di `Arr.` e `POS` sono ora in grassetto. La griglia riceve inoltre il valore originale di `Vers.` e ne ricostruisce in modo sicuro i segmenti neri e rossi salvati dal Report: un valore interamente rosso resta rosso, uno nero resta nero e una formula mista conserva entrambi i colori anche sullo sfondo giallo. Supportato anche il vecchio campo globale `vers_color`.
**Testato**: si (metodo: simulazione locale con locale temporaneo e tre chiusure nero/rosso/misto, verifica visuale browser desktop e audit stili DOM: `Arr.`/`POS` peso 700, `Vers.` misto su `rgb(254, 240, 138)` con segmenti `rgb(220, 38, 38)` e `rgb(17, 24, 39)`; dati simulati rimossi integralmente; suite frontend `26 passed`; suite backend `179 passed, 36 skipped`; build React produzione riuscito con soli warning Hook preesistenti in file non coinvolti; `git diff --check`)
**Note per il prossimo agente**: `vers_raw` e di sola lettura e serve esclusivamente alla rappresentazione dello storico; i calcoli continuano a usare il valore numerico appiattito in `cash.vers`. Il frontend non inietta l'HTML ricevuto: estrae soltanto caratteri numerici/operatori e genera `<span>` React con i due colori consentiti.

### [2026-07-28 15:08 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | analisi dati | Excel | test
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/backend/tests/test_analysis_excel_isolated_integration.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretta la colonna `Altro` dell'Excel Analisi mensile separando le categorie analitiche delle paste dal listino prezzi del locale. `TONNO`, previsto nel report ufficiale ma assente dal dizionario prezzi di Flaminio, veniva sommato ad `Altro`: per questo il 20/07 il generatore mostrava 27 invece di 19 (19 Altro + 8 Tonno) e il 25/07 mostrava 34 invece di 26 (26 Altro + 8 Tonno). Ora Tonno ha sempre la propria colonna; se non ha un prezzo configurato, l'incasso continua a usare il prezzo manuale gia assegnato alla riga, senza cambiare i totali economici o la logica della pagina Report. Canonizzati anche gli alias `TARTUFO -> TART` e `AMATRICIANA -> AMAT`, e allineate al modello ufficiale le intestazioni `Carzuc`, `Tonno`, `Tart`, `Amat`.
**Testato**: si (metodo: suite backend completa `179 passed, 36 skipped`; integrazione Mongo isolata aggiuntiva `1 passed` sull'intero export annuale con Tonno assente dallo snapshot prezzi e verifica dei fogli locale/Totali; test mirati su classificazione, prezzi manuali, alias e workbook finale; audit read-only VPS sui dati reali di Flaminio. Il 21/07 il database contiene 471 comande valide mentre il file ufficiale e fermo alla 468: le ultime tre, tutte non riconosciute, spiegano 28 contro 25 in Altro. L'11/07 il database contiene 144 CARB e 77 CACIO: il generatore e coerente con la fonte, mentre il file ufficiale ne sposta manualmente una da Carb a Cacio.)
**Note per il prossimo agente**: la tassonomia analitica e intenzionalmente distinta dal listino operativo. Non aggiungere Tonno al calcolo automatico del Report senza una decisione sui prezzi: in Analisi viene contato come tipo noto e, se privo di prezzo configurato, conserva l'eventuale prezzo manuale. Le sigle personalizzate presenti nei dizionari dei locali continuano ad aggiungersi automaticamente dopo le categorie standard.

### [2026-07-28 14:30 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | refactor | test
**File toccati**:
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Reso il Report utilizzabile su telefoni in verticale con un intervento esclusivamente grafico e responsive. Lo scroll mobile non viene piu bloccato; paste, banconote, movimentazione, magazzino bevande, ingressi/uscite, scarti, vendite e spicci si dispongono in griglie leggibili da 2-3 colonne e tornano al layout compatto originale da desktop. Aumentate inoltre altezza e dimensione del testo dei controlli touch e adattata la barra di anteprima.
**Testato**: sì (metodo: verifica visuale nel browser locale a 390x844, viewport verticale stretto e desktop 1440x900; audit DOM di 80 controlli senza elementi fuori larghezza né overflow orizzontale; suite frontend completa `24 passed`; build React produzione riuscito con soli warning Hook preesistenti in file non coinvolti; `git diff --check`)
**Note per il prossimo agente**: nessuna logica, API, formula, persistenza, autorizzazione o isolamento tenant del Report e stata modificata. Conservare le classi `lg:*` che ripristinano il layout desktop; eventuali variazioni future vanno ricontrollate sia sotto sia sopra il breakpoint `lg`.

### [2026-07-28 14:04 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | UX | test
**File toccati**:
- `/app/frontend/src/pages/AuditCassaPage.js`
- `/app/frontend/src/pages/AuditCassaPage.test.js`
- `/app/frontend/src/pages/ChiusureExcelPage.js`
- `/app/frontend/src/pages/ChiusureExcelPage.test.js`
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretta una discordanza di contesto tra Check singoli movimenti e Storico chiusure. Entrambe le pagine potevano mantenere un locale separato da quello impersonato nella scheda e la griglia chiusure conservava inoltre una vecchia scelta in `localStorage`: Federico poteva quindi filtrare l'audit su un locale e aprire inconsapevolmente il Report storico di un altro. I menu ora aggiornano la selezione condivisa della sessione, Storico chiusure non usa piu una persistenza autonoma e un link storico riallinea la scheda al proprio `rid`. Il banner storico mostra anche il nome del locale.
**Testato**: sì (metodo: diagnosi VPS esclusivamente read-only: il documento e l'endpoint storico di Brazzà restituivano correttamente `S.scarti=3`, mentre gli access log dello screenshot mostravano richieste della griglia e del Report rivolte a Flaminio; test regressivi sui due selettori con sessione Brazzà + vecchio localStorage Flaminio; suite frontend completa `24 passed`; build React produzione riuscito con soli warning Hook preesistenti)
**Note per il prossimo agente**: nessun dato di produzione e stato modificato. `frontend/public/version.json` e stato ripristinato dopo il build. Non reintrodurre selettori locale persistenti separati dall'impersonificazione per-tab dell'AuthContext.

### [2026-07-27 22:59 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | performance | architecture | test
**File toccati**:
- `/app/backend/annotation_semantics.py`
- `/app/backend/app/routers/laboratory.py`
- `/app/backend/app/services/pasta_annotations.py`
- `/app/backend/tests/test_pasta_annotations_lab.py`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Sostituito il limite di 50.000 documenti dell'hotfix `89411cf` con elaborazione esatta a blocchi di 7 giorni. Il range fino a 366 giorni resta sempre disponibile: ogni blocco carica, deduplica e classifica gli ordini, poi i risultati vengono fusi e i documenti sorgente liberati. Conteggi, segnali, varianti, locali e ricostruzioni pager non vengono campionati; gli esempi delle comande sono ora realmente i 30 piu recenti.
**Testato**: si (metodo: suite backend completa `176 passed, 36 skipped`; equivalenza numerica monolitico/chunked su 10.800 ordini, 60 giorni e 3 locali; benchmark con 50.000 ordini: stessi summary e segnali, picco calcolo da 136,1 MB a 3,1 MB, riduzione 97,7%)
**Note per il prossimo agente**: Conservare il vincolo di una sola analisi per processo e l'applicazione esplicita dei filtri. Il merger e verificato per equivalenza numerica contro il calcolo monolitico; non reintrodurre una materializzazione annuale di `canonical_orders` o `semantic_observations`.

### [2026-07-27 22:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | performance | UX | test
**File toccati**:
- `/app/backend/app/routers/laboratory.py`
- `/app/backend/tests/test_pasta_annotations_lab.py`
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Protetta la pagina Annotazioni paste dai crash con intervalli estesi. Prima di materializzare gli ordini il backend conta i documenti tramite indici e rifiuta volumi superiori a 50.000 con un errore leggibile; inoltre consente una sola analisi per processo. Date e locale non lanciano piu richieste a ogni modifica ma vengono applicati soltanto premendo Aggiorna.
**Testato**: si (metodo: suite backend completa `178 passed, 36 skipped`; suite frontend completa `20 passed`; build React produzione completata con soli warning Hook preesistenti; test dedicati su limite volume e analisi concorrente)
**Note per il prossimo agente**: Il limite riguarda i documenti sorgente in `orders` + `archived_orders`, non il numero deduplicato finale. Non alzarlo senza una versione streaming/aggregata del calcolo: `canonical_orders`, ordinamento e osservazioni semantiche sono ancora materializzati in RAM.

### [2026-07-27 22:32 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: UX | cleanup | test
**File toccati**:
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/frontend/src/utils/reportArrowNavigation.js` (rimosso)
- `/app/frontend/src/utils/reportArrowNavigation.test.js` (rimosso)
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimossa integralmente la navigazione spaziale tra gli input numerici del Report tramite le quattro frecce. Gli input mantengono ora il comportamento nativo del browser; restano invariati gli handler `Invio`/`Esc` necessari per commenti, dialog e modifica del cassetto.
**Testato**: si (metodo: suite frontend completa `20 passed`; build React produzione completata con soli warning Hook preesistenti; bundle principale ridotto di 745 B)
**Note per il prossimo agente**: Non reintrodurre un gestore `onKeyDown` globale sul contenitore del Report senza una richiesta esplicita; le frecce devono restare disponibili per il comportamento nativo dei singoli campi.

### [2026-07-25 05:29 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | performance | test
**File toccati**:
- `/app/backend/app/services/pasta_annotation_learning.py`
- `/app/backend/tests/test_pasta_annotation_learning.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretto il filtro veloce introdotto nell'hotfix prestazionale: alcune proposte valide potevano sparire anche senza una decisione quando refusi simili erano distanti nell'ordinamento alfabetico. Aggiunto un indice limitato per frammenti interni di tre caratteri, mantenendo il costo sotto controllo senza cambiare le soglie semantiche.
**Testato**: si (metodo: suite backend completa `175 passed, 36 skipped`; confronto differenziale su 273 abbreviazioni e refusi realistici con 1.178 corrispondenze del vecchio algoritmo e zero corrispondenze perse; stress test da 1.000 profili in circa 0,6 s)
**Note per il prossimo agente**: Fix verificato solo localmente e non pubblicato/deployato durante il servizio dei locali. Conservare sia il test sul limite dei confronti sia quello sui refusi multi-edit distanti lessicalmente.

### [2026-07-25 05:17 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | performance | test
**File toccati**:
- `/app/backend/app/routers/laboratory.py`
- `/app/backend/app/services/pasta_annotation_learning.py`
- `/app/backend/tests/test_pasta_annotation_learning.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Eliminato il blocco del backend osservato dopo una decisione sulle annotazioni (`/api/lab/pasta-annotations` fino a 126 secondi). Il generatore non confronta piu ogni termine con tutti gli altri: seleziona candidati per contesto, vicinanza lessicale, vocabolario fisso e firme di modifica a un carattere, mantenendo la decisione umana e le stesse soglie conservative. Statistiche e suggerimenti vengono inoltre calcolati nel thread pool, cosi il lavoro del Laboratorio non blocca ordini, Cassa, API e WebSocket serviti dall'event loop.
**Testato**: si (metodo: `58 passed` sui test annotazioni/Laboratorio; benchmark sintetico con 1.000 profili sceso da 26,6 s e circa 500.000 confronti a 0,56 s e 12.117 confronti; coperti limite computazionale, abbreviazione e refuso sulla prima lettera)
**Note per il prossimo agente**: Il limite e intenzionale per proteggere l'unico worker Uvicorn da calcoli CPU quadratici. Non reintrodurre scansioni all-pairs senza esecuzione fuori processo o indice dedicato.

### [2026-07-25 04:38 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | security | test | docs
**File toccati**:
- `/app/backend/annotation_semantics.py`
- `/app/backend/app/{bootstrap.py,routers/laboratory.py,schemas/{__init__,laboratory}.py}`
- `/app/backend/app/services/{pasta_annotations,pasta_annotation_learning}.py`
- `/app/backend/memory_worker/{collector,contracts,snapshots}.py`
- `/app/backend/memory_worker/sources/{__init__,configuration,orders}.py`
- `/app/backend/memory_worker/stores/mongo.py`
- `/app/backend/tests/test_{annotation_semantics,pasta_annotations_lab,pasta_annotation_learning,memory_worker_configuration,memory_worker_foundations,memory_worker_snapshots,phase1_foundations_contract,phase3_module_contract}.py`
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/frontend/src/components/laboratory/{PastaAnnotationLearningPanel,PastaAnnotationLearningPanel.test}.js`
- `/app/frontend/src/utils/{laboratory,laboratory.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,OPERATIONAL_MEMORY_DESIGN,MEMORY_VPS_ROLLOUT_RUNBOOK,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Completato il ciclo di apprendimento assistito delle annotazioni paste. Il sistema propone soltanto bersagli simili osservati nello stesso contesto, mostrando conteggi, locali e forme sorgente; Simone decide `Uguali` o `Diverse`, puo annullare la scelta e nessuna fusione avviene autonomamente. Gli alias confermati vengono applicati retroattivamente alle statistiche senza modificare gli ordini e sono conservati con versione, autore e data in collection Laboratorio isolate. La futura Memoria li acquisisce in sola lettura come configurazioni versionate e usa la versione valida nei fatti e negli snapshot.
**Testato**: si (metodo: suite backend completa `172 passed, 36 skipped`; suite frontend completa `24 passed`; build React produzione completata con i soli warning Hook preesistenti; contratto OpenAPI aggiornato e verificato a 87 path/33 schemi; test di conferma, esclusione, annullamento, protezione delle regole fisse, ricalcolo retroattivo e integrazione worker/snapshot)
**Note per il prossimo agente**: GET/POST/DELETE delle annotazioni restano riservate esclusivamente a Simone. Le scritture riguardano solo `lab_pasta_annotation_aliases` e `lab_pasta_annotation_dismissals`; descrizioni, ordini e dati operativi restano immutati. Il codice e pronto localmente ma non e stato deployato e il worker Memoria resta inattivo.

### [2026-07-25 03:30 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | refactor | test | docs
**File toccati**:
- `/app/backend/annotation_semantics.py`
- `/app/backend/tests/test_{annotation_semantics,pasta_annotations_lab}.py`
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/frontend/src/utils/{laboratory,laboratory.test}.js`
- `/app/frontend/public/version.json`
- `/app/memory/{PRD,OPERATIONAL_MEMORY_DESIGN,MEMORY_VPS_ROLLOUT_RUNBOOK,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Introdotto il ruleset annotazioni v2 con una canonicalizzazione esatta, conservativa e versionata dei bersagli confermati dallo storico: forme come `NO GUANC`, `NO GUANCIALE` e `SENZA GUANCIALE` confluiscono nello stesso segnale senza alterare il testo originale. Il Laboratorio mostra sotto ogni segnale raggruppato le forme effettivamente usate e i relativi conteggi; abbreviazioni non confermate e termini ambigui restano distinti, senza fuzzy matching.
**Testato**: sì (metodo: suite backend completa `160 passed, 36 skipped`; suite frontend completa `21 passed`; build React produzione completata con i soli warning Hook preesistenti; simulazione retroattiva in sola lettura su export minimizzato e sanitizzato di `262.500` ordini archiviati, con verifica dei raggruppamenti e delle forme sorgente)
**Note per il prossimo agente**: nessuna migrazione Mongo e nessuna scrittura in produzione. Il Laboratorio ricalcola lo storico in sola lettura, mentre i futuri fatti della Memoria registreranno `ruleset_version: 2`. Aggiungere nuovi alias solo dopo conferma semantica dell'utente e con test; non introdurre distanza testuale o completamenti automatici generici.

### [2026-07-22 16:11 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | refactor | test | docs
**File toccati**:
- `/app/backend/annotation_semantics.py`
- `/app/backend/app/services/pasta_annotations.py`
- `/app/backend/memory_worker/{collector,snapshots}.py`
- `/app/backend/memory_worker/sources/{__init__,configuration,orders}.py`
- `/app/backend/tests/test_{annotation_semantics,pasta_annotations_lab,memory_worker_*}.py`
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/frontend/src/utils/{laboratory,laboratory.test}.js`
- `/app/memory/{PRD,OPERATIONAL_MEMORY_DESIGN,OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES,MEMORY_VPS_ROLLOUT_RUNBOOK,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Introdotto il parser semantico condiviso v3 per le annotazioni paste. Separa testo, pager, quantita, segnali confermati (`TA`, `C`, `S`, `F`, `CHIUSA`, `RIG`), richieste letterali e frammenti sconosciuti senza inventarne il significato; `T` resta sconosciuto. Il Laboratorio ora distingue Segnali, Da interpretare, Frasi complete e Probabili comande, ricostruite in modo non autoritativo per locale/giorno/pager con gap massimo 90 secondi e distanza ordine 8. La Memoria conserva il derivato negli order fact, registra le regole come configurazione versionata e aggiunge agli snapshot v2 aggregati semantici calcolati sullo stato finale non cancellato con il dizionario storico del locale. Corretto anche il percorso automatico degli snapshot che validava la data prima di selezionarla.
**Testato**: si (metodo: suite backend completa `154 passed, 36 skipped`; 6 test Mongo reali su database sorgente/destinazione isolati; suite frontend `20 passed`; build React produzione completata con i soli warning Hook preesistenti; simulazione deterministica di 10.800 paste, 3 locali, 60 giorni e 3.600 gruppi pager con conteggi attesi)
**Note per il prossimo agente**: deployare questo codice prima di scegliere il momento zero della Memoria e proseguire `memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md`, che ora verifica anche regola semantica e fatti parsati. Nessuna migrazione del Mongo operativo e nessun backfill pre-attivazione. Il Laboratorio resta in sola lettura e riservato a Simone; il worker resta separato, arrestabile e non richiesto dall'app.

### [2026-07-22 10:02 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | refactor | test | docs
**File toccati**:
- `/app/backend/app/services/pasta_annotations.py`
- `/app/backend/tests/test_pasta_annotations_lab.py`
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/memory/{PRD,OPERATIONAL_MEMORY_DESIGN,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Portato il parser Annotazioni paste alla versione 2: i numeri ordine/pager/dischetto/disco non vengono piu conteggiati come annotazioni. Nelle comande miste viene conservato solo il testo utile (`CARB 12 NO PEPE` diventa `NO PEPE`), mentre la coda sorgente resta disponibile per tracciabilita futura senza modificare gli ordini originali. Aggiornate le etichette della pagina e il contratto della futura Memoria operativa.
**Testato**: si (metodo: 29 test mirati del parser; simulazione con 20 pager numerici e 2 annotazioni testuali; suite backend completa `139 passed, 36 skipped`; suite frontend `18 passed`; build React produzione completata)
**Note per il prossimo agente**: il calcolo del Laboratorio e in sola lettura e avviene a ogni richiesta, quindi il filtro si applica retroattivamente anche allo storico gia presente. Accesso e route restano invariati e riservati a Simone; nessuna migrazione dati necessaria.

### [2026-07-21 11:55 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: frontend | ux | test
**File toccati**:
- `/app/frontend/src/pages/ReportBetaPage.js`
- `/app/frontend/src/utils/reportArrowNavigation.js`
- `/app/frontend/src/utils/reportArrowNavigation.test.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Reso piu leggibile ma compatto il blocco prezzi delle paste non riconosciute nel Report e aggiunto un pulsante di espansione che apre un elenco ampio, scorrevole e a colonna singola senza comprimere le sezioni contabili. Aggiunta navigazione spaziale con le quattro frecce tra tutti gli input numerici modificabili visibili, con selezione automatica del valore e salto dei campi bloccati, disabilitati o nascosti.
**Testato**: si (metodo: 18 test frontend passati, inclusi 4 nuovi test di navigazione; build React produzione; prova browser reale a 1600/1280/1024 px e prova compatta/espansa con tre paste locali simulate; navigazione orizzontale e verticale anche nel dialog; fixture, contatore, documenti Report e audit locali ripristinati)
**Note per il prossimo agente**: parsing, calcoli, autosalvataggio, ruoli e isolamento tenant non sono stati modificati. Il dialog si chiude con X, clic sullo sfondo o Escape. Textarea paste e campo VERS mantengono le frecce per spostare il cursore; la navigazione riguarda gli input numerici `inputMode=decimal`.

### [2026-07-20 16:26 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | operations | resilience | security
**File toccati**:
- `/app/memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md`
- `/app/memory/{MEMORY_PHASE6_RUNBOOK,OPERATIONAL_MEMORY_DESIGN,CHANGELOG_MULTI_AGENT}.md`
- `/app/backend/memory_worker/__main__.py`
- `/app/deploy/memory.env.example`
**Descrizione**: Preparato il runbook esecutivo completo per il rollout VPS della Memoria, destinato anche al passaggio di consegne con il Codex dell'altro PC. La procedura separa aggiornamento classico, gate SCRAM/P1, backup, utenti Mongo least-privilege, utente Linux, env root-only, unit systemd disabilitata, preflight read-only, dry-run, momento zero, prima raccolta, osservazione 24-48 ore, abilitazione e rollback. Vietata esplicitamente la scorciatoia dei ruoli Mongo non verificati. Aggiunto logging INFO al runner per rendere verificabili i cicli dry-run/attivi nel journal systemd e resi espliciti i database negli URI di esempio.
**Testato**: si (metodo: suite backend completa `133 passed, 30 skipped`; status Fase 6 con raccolta inattiva; controllo igiene su 310 file; riferimenti runbook tutti esistenti; BOM changelog preservato; `git diff --check` senza errori)
**Note per il prossimo agente**: nessuna operazione VPS e stata eseguita. Prima azione sulla VPS: verificare lo stato SCRAM reale. Se `security.authorization` non e attivo, fermare il rollout Memoria e completare prima la Fase 3 P1 in finestra di manutenzione; non usare `MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=true`.

### [2026-07-20 16:03 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | resilience | security | test | docs
**File toccati**:
- `/app/backend/memory_worker/{__main__,config,context,contracts,runner,snapshots}.py`
- `/app/backend/memory_worker/sources/report.py`
- `/app/backend/memory_worker/stores/mongo.py`
- `/app/backend/tests/test_memory_worker_{foundations,isolated_integration,report_isolated_integration,runner,runner_isolated_integration,snapshots,snapshot_isolated_integration}.py`
- `/app/deploy/{memory.env.example,pastasciutta-memory.service.example}`
- `/app/memory/{OPERATIONAL_MEMORY_DESIGN,OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES,MEMORY_PHASE5_RUNBOOK,MEMORY_PHASE6_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Completate localmente le Fasi 5 e 6 della Memoria. Aggiunti contesto calendario, snapshot giornalieri versionati per locale e magazzino globale, provenienza, controlli di integrita e gap apribili/risolvibili senza inventare dati mancanti. Configurazioni e cataloghi vengono letti nella versione valida per la giornata, senza cambiare retroattivamente lo storico; dopo un fermo vengono recuperate prima le giornate mancanti. Il runner continuo separato esegue collector sequenziali e snapshot periodici con dry-run read-only, limiti di latenza/storage comprensivi degli indici, backoff, circuit breaker e arresto ordinato. Preparati template env/systemd limitati in CPU, RAM e I/O, senza installarli o attivarli.
**Testato**: si (metodo: suite backend completa `133 passed, 30 skipped`, con tutte le integrazioni Mongo Memoria abilitate; correzioni `A-B-A` con versioni distinte, configurazione storica invariata dopo nuovi locali/cataloghi, cancellazione fisica e risoluzione gap, recupero date mancanti, idempotenza, provenienza, dry-run senza scritture, primo giorno senza falso errore, backoff, circuit breaker, stop e recovery; `compileall`; 14 test frontend passati; build React produzione completata con soli warning Hooks preesistenti; repository hygiene su 309 file; comando `status` Fase 6 con raccolta inattiva)
**Note per il prossimo agente**: codice e template sono pronti soltanto in locale. Non esistono servizio VPS, credenziali Mongo dedicate, database Memoria ufficiale, momento zero o raccolta attiva. Il prossimo confine richiede backup/spazio, utenti Mongo separati, utente Linux, env root-only, installazione disabilitata, dry-run e osservazione 24-48 ore. Le capacita avanzate B-E restano successive ai dati reali stabili.

### [2026-07-20 15:42 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | security | test | docs
**File toccati**:
- `/app/backend/memory_worker/{__main__,collector,contracts,sanitize}.py`
- `/app/backend/memory_worker/sources/{__init__,warehouse,configuration}.py`
- `/app/backend/memory_worker/stores/mongo.py`
- `/app/backend/tests/test_memory_worker_{foundations,warehouse,configuration,isolated_integration,report_isolated_integration,phase34_isolated_integration}.py`
- `/app/memory/{OPERATIONAL_MEMORY_DESIGN,OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES,MEMORY_PHASE3_RUNBOOK,MEMORY_PHASE4_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Completate localmente le Fasi 3 e 4 della Memoria con collector one-shot per prodotti, stock, movimenti, richieste, carichi/DDT strutturati, inventario/carichi bevande, locali, dizionari paste, catalogo bevande e fornitori. Aggiunte versioni bitemporali e rilevazione idempotente delle cancellazioni fisiche solo dopo scansioni complete; immagini, credenziali e contatori runtime restano esclusi. I movimenti verso i locali sono classificati come logistica e mai come consumo reale.
**Testato**: si (metodo: suite backend completa 117 test passati e 30 live gated saltati; integrazioni Mongo isolate di ordini, Report e Fasi 3-4 eseguite realmente; test dedicato con batch da un documento che impedisce false cancellazioni durante scansioni incomplete; modifiche, reset, sparizioni, quarantena, idempotenza, lock, listino default in parita e sorgente immutata; compileall, `git diff --check`, stato Fase 4 inerte e BOM changelog verificato)
**Note per il prossimo agente**: collector ancora manuali, disabilitati e non installati sulla VPS. Nessun momento zero reale e nessun backfill. Restano snapshot giornalieri, raccolta continua, circuit breaker, limiti di processo/storage e rollout.

### [2026-07-20 15:24 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | security | bugfix | test | docs
**File toccati**:
- `/app/backend/memory_worker/{__main__,collector,contracts}.py`
- `/app/backend/memory_worker/sources/{__init__,report}.py`
- `/app/backend/memory_worker/stores/mongo.py`
- `/app/backend/tests/{test_memory_worker_foundations,test_memory_worker_isolated_integration,test_memory_worker_report,test_memory_worker_report_isolated_integration}.py`
- `/app/memory/{OPERATIONAL_MEMORY_DESIGN,MEMORY_PHASE1_RUNBOOK,MEMORY_PHASE2_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Completata localmente la Fase 2 della Memoria con collector Report one-shot per cassa, formule, paste, spicci, cassetto, banconote, bevande giornaliere, audit e vendite bevande definitive. Aggiunti fatti bitemporali, normalizzazione versionata con distinzione missing/invalid/zero, quarantena robusta e scansioni cicliche; escluse intenzionalmente le vendite attive stornabili. Corretto inoltre il caricamento Mongo dell'epoch con `tz_aware=True`, evitando uno spostamento locale di due ore del momento zero.
**Testato**: si (metodo: 103 test backend passati con 32 live gated; 23 test fondazioni/formule; due integrazioni Mongo isolate passate insieme per ordini e Report con epoch, correzioni tardive, ritorno a valori precedenti, audit, arrivi tardivi, dedupe, idempotenza, quarantena, lock e sorgente immutata; compileall; `git diff --check`; comando `status` Fase 2 inerte; database temporanei eliminati)
**Note per il prossimo agente**: nessun collector e continuo o installato sulla VPS. Il cash sera consolidato richiede il futuro snapshot giornaliero; magazzino, richieste, DDT e configurazioni sono ancora esclusi. Non attivare gli switch in produzione.

### [2026-07-20 15:02 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | security | test | docs
**File toccati**:
- `/app/backend/memory_worker/{__main__,collector,config,contracts,preflight,sanitize}.py`
- `/app/backend/memory_worker/sources/{__init__,orders}.py`
- `/app/backend/memory_worker/stores/{__init__,mongo}.py`
- `/app/backend/tests/{test_memory_worker_foundations,test_memory_worker_isolated_integration}.py`
- `/app/memory/{OPERATIONAL_MEMORY_DESIGN,MEMORY_PHASE0_RUNBOOK,MEMORY_PHASE1_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Implementata localmente la Fase 1 della Memoria operativa con collector manuale one-shot del ciclo vita ordini. Sono presenti epoch, watermark separati, raw sanificato e deduplicato, fatti bitemporali, quarantena, scansione ciclica degli archivi, lock anti-concorrenza e rifiuto di credenziali sorgente scrivibili o ambigue; il backend operativo non importa il worker.
**Testato**: si (metodo: 95 test backend passati con 31 live gated; 15 test fondazioni; integrazione Mongo isolata passata con stato A-B-A, arrivo tardivo in archivio, dedupe, idempotenza, quarantena, lock e sorgente immutata; compileall; `git diff --check`; comando `status` inerte; database temporanei eliminati)
**Note per il prossimo agente**: la Fase 1 non e in esecuzione continua, non e installata sulla VPS e non ha un momento zero reale. Non attivare gli switch in produzione; Report, magazzino, configurazioni, snapshot, circuit breaker e limiti systemd restano fasi successive.

### [2026-07-20 14:41 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | architecture | security | test | docs
**File toccati**:
- `/app/backend/memory_worker/{__init__,__main__,config,contracts,preflight,sanitize}.py`
- `/app/backend/memory_worker/stores/{__init__,mongo}.py`
- `/app/backend/tests/test_memory_worker_foundations.py`
- `/app/memory/{OPERATIONAL_MEMORY_DESIGN,MEMORY_PHASE0_RUNBOOK,PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Implementata la Fase 0 inerte della Memoria operativa: pacchetto autonomo non importato dal backend, raccolta e scritture disabilitate, database sorgente/destinazione obbligatoriamente separati, URI redatte, limiti duri, sanificazione ricorsiva e preflight Mongo esclusivamente read-only. Non sono stati creati collector, epoch, watermark, servizi systemd, endpoint o modifiche VPS.
**Testato**: si (metodo: 90 test backend passati con 30 live gated; compileall; `git diff --check`; comando `status`; preflight locale su Mongo con `writes_performed: 0`; verificato che il database Memoria indicato non sia stato creato)
**Note per il prossimo agente**: non aggiungere import di `memory_worker` sotto `backend/app` o `server.py`. La Fase 1 richiede decisione esplicita su credenziali Mongo separate, quota/retention e momento zero; non impostare `MEMORY_ENABLED` o `MEMORY_WRITE_ENABLED` sulla VPS.

### [2026-07-20 14:10 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | security | test | docs
**File toccati**:
- `/app/backend/app/{bootstrap.py,routers/laboratory.py,schemas/laboratory.py,services/document_scanner.py}`
- `/app/backend/tests/{test_document_scanner_lab.py,test_pasta_annotations_lab.py,test_phase1_foundations_contract.py,test_phase3_module_contract.py}`
- `/app/frontend/{package.json,yarn.lock,scripts/sync-tesseract-assets.js,src/pages/ScannerDocumentiLabPage.js}`
- `/app/.gitignore`
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Reso operativo lo Scanner documenti del Laboratorio di Simone. L'OCR italiano gira nel browser con asset locali; il backend confronta il testo con fornitori e prodotti del Mongo corrente, estrae dal solo documento numero, data, quantita e prezzi e salva dopo conferma associazioni minimali in collection Lab isolate. Foto e testo OCR integrale non vengono conservati e nessuna prova crea fatture, carichi o movimenti.
**Testato**: si (metodo: parser e feedback simulati, idempotenza e matrice ruoli; suite backend e frontend passate; build React produzione completata; fixture Mongo temporanee eliminate)
**Note per il prossimo agente**: questa release aggiunge dipendenze frontend (`tesseract.js` e lingua italiana); al primo deploy eseguire l'installazione dipendenze prima di `npm run build`. Il prezzo osservato puo essere registrato come evidenza ma non deve mai compilare un prezzo che l'OCR non ha letto.

### [2026-07-20 13:27 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: config | frontend
**File toccati**:
- `/app/frontend/src/pages/PastaAnnotationsLabPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rimosso il placeholder `NO PEPE` dal campo Cerca annotazione del Laboratorio, lasciando invariati filtro, accessibilita e logica dei dati.
**Testato**: si (metodo: verifica statica del controllo e build React della modifica principale gia completata)

### [2026-07-20 13:15 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | security | test | docs
**File toccati**:
- `/app/backend/app/services/pasta_annotations.py`
- `/app/backend/app/routers/laboratory.py`
- `/app/backend/app/bootstrap.py`
- `/app/backend/tests/test_pasta_annotations_lab.py`
- `/app/frontend/src/{App.js,pages/LaboratorioPage.js,pages/PastaAnnotationsLabPage.js,utils/laboratory.js,utils/laboratory.test.js}`
- `/app/memory/{PRD,OPERATIONAL_MEMORY_DESIGN,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Aggiunto al Laboratorio di Simone l'Osservatorio annotazioni paste. Il riconoscitore operativo resta invariato e volutamente rigido; soltanto le paste gia riconosciute producono un'annotazione raw e normalizzata, mentre errori intenzionali, prefissi non validi e `XL` restano esclusi. Il nuovo endpoint read-only aggrega ordini validi attivi/archiviati per periodo, locale e dizionario storico, restituendo frequenze, incidenza, paste, locali, varianti ed esempi con contratto versionato predisposto per la futura Memoria.
**Testato**: si (metodo: 72 test backend passati con 30 live gated; 14 test frontend passati; compileall e build React produzione completati; simulazione HTTP/Mongo con 6 ordini e cleanup; browser desktop/mobile con 9 ordini temporanei, filtri pasta/locale, layout e console senza errori; hash Simone ripristinato e fixture eliminate)
**Note per il prossimo agente**: l'endpoint `/api/lab/pasta-annotations` e accessibile solo a Simone admin, limita l'intervallo a 366 giorni e non scrive dati. Non rendere tollerante `_pasta_recognized_sigla`: le righe volutamente non riconosciute servono per il prezzo manuale. La futura Memoria dovra conservare raw, normalizzato, versione parser e relazione con ordine/dizionario.

### [2026-07-19 17:04 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | frontend | test
**File toccati**:
- `/app/frontend/src/App.js`
- `/app/frontend/src/pages/HomePage.js`
- `/app/frontend/src/pages/LaboratorioPage.js`
- `/app/frontend/src/pages/ScannerDocumentiLabPage.js`
- `/app/frontend/src/utils/laboratory.js`
- `/app/frontend/src/utils/laboratory.test.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Creato il Laboratorio frontend riservato all'account Simone admin, raggiungibile dal suo pannello e protetto da route dedicata. Aggiunto il primo banco prova Scanner documenti con acquisizione fotocamera/upload, anteprima, bozza modificabile di fattura/DDT e righe documento; la prova resta esclusivamente nello stato della pagina e non legge o scrive dati operativi.
**Testato**: si (metodo: test Jest accesso Simone 1/1, build React produzione completata, verifica browser desktop e mobile 390x844, upload immagine e completamento prova, console senza errori)
**Note per il prossimo agente**: OCR, persistenza lab e backend `/api/lab/*` non sono ancora implementati. Non collegare la pagina alle collection reali; il prossimo passo corretto e progettare storage/processo OCR isolati.

### [2026-07-19 16:36 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | docs | architecture
**File toccati**:
- `/app/memory/P1_SECURITY_RUNBOOK.md`
- `/app/memory/SECURITY_HARDENING_PLAN.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Registrato il piano P1 di sicurezza approvato dopo revisione incrociata, preservando UX e modello account attuali. Il runbook separa backup, release atomiche con dipendenze versionate, backend non-root, Mongo SCRAM, revoca globale tramite `token_version`, audit minimo, input/upload e CI; documenta inoltre no MFA, password ristoranti condivise e rischio residuo dei WebSocket gia aperti.
**Testato**: si (metodo: revisione contro codice auth/WebSocket/config corrente, PRD, piano sicurezza e changelog; verifica Markdown e `git diff --check`)
**Note per il prossimo agente**: nessuna implementazione P1 e iniziata. Partire esclusivamente dalla Fase 0; non applicare Fase 2+ in produzione prima di clone isolato e restore drill riuscito.

### [2026-07-19 00:13 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | config
**File toccati**:
- configurazione account protetta su MongoDB in produzione
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Corretta su richiesta dell'utente la credenziale dell'account Admin, senza inserirne il valore nel repository, nei log o sulla VPS. Il CSV locale protetto e stato aggiornato insieme alla configurazione live.
**Testato**: si (metodo: backup root-only della collezione account; login HTTPS e `/api/auth/me` riusciti con la credenziale corretta; variante precedente rifiutata)
**Note per il prossimo agente**: non riportare mai il valore della password nel codice o nella documentazione. Il cambio password non revoca ancora i JWT gia emessi: la revoca per-account resta lavoro P1.

### [2026-07-17 22:57 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | config
**File toccati**:
- configurazione account protetta su MongoDB in produzione
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Applicate agli altri quattro account le credenziali scelte esplicitamente dall'utente, senza inserirne i valori nel repository, nei log o sulla VPS. Una scelta e una deroga deliberata al minimo di 12 caratteri del comando amministrativo P0; la regola generale nel codice non e stata abbassata.
**Testato**: si (metodo: backup root-only della collezione account; login HTTPS e `/api/auth/me` riusciti separatamente per i quattro account; credenziali precedenti rifiutate; helper amministrativo temporaneo eliminato)
**Note per il prossimo agente**: non modificare automaticamente le credenziali scelte dall'utente e non riportarne mai i valori nel codice o nella documentazione. La revoca JWT per-account resta lavoro P1.

### [2026-07-17 22:53 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | config
**File toccati**:
- configurazione account protetta su MongoDB in produzione
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Impostata su tre account locali la credenziale scelta esplicitamente dall'utente, senza inserirne il valore nel repository, nei log o sulla VPS. La scelta di condividere una password tra piu locali e un compromesso operativo consapevole rispetto alle credenziali uniche previste dal piano di sicurezza.
**Testato**: si (metodo: backup root-only della collezione account; login HTTPS e `/api/auth/me` riusciti separatamente per tutti e tre gli account; vecchie credenziali rifiutate)
**Note per il prossimo agente**: un cambio password locale non revoca ancora i JWT gia emessi per quell'account; la revoca per-account tramite `token_version` resta lavoro P1. Non riportare mai la password nel codice, nella documentazione o nei messaggi.

### [2026-07-17 22:43 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | config | deploy | docs
**File toccati**:
- `/app/memory/SECURITY_HARDENING_PLAN.md`
- `/app/memory/P0_VPS_RUNBOOK.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
- configurazione protetta VPS: systemd, Nginx, UFW, `.env`, deploy key e runtime upload
**Descrizione**: Completato P0-B in produzione con release pulita `ee33a98`, backup verificato, upload fuori repo, rotazione password/JWT, backend solo locale, firewall attivo, redirect HTTPS/IP, WSS autenticato e deploy key GitHub read-only. Aggiornata la memoria operativa per impedire che futuri agenti trattino ancora P0-B come pendente.
**Testato**: si (metodo: preflight Python 3.10 e build React senza sourcemap; login e `/auth/me` per 7 account; matrice ruoli e tenant; impersonazione Federico/Admin; Report/Cassa/Bevande; upload firmato/negato; WSS ticket monouso/Origin; CORS; route rimosse; cache; servizi, firewall, porte e nuova sessione SSH)
**Note per il prossimo agente**: non rimettere Uvicorn su `0.0.0.0`, non riaprire la 8001 e non riportare upload o segreti nella repo. Il backend gira ancora come root e backup off-site/automatici, hardening systemd, Mongo least-privilege e bonifica coordinata della cronologia Git restano P1/P0 separato.

### [2026-07-17 22:25 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | config | docs
**File toccati**:
- `/app/backend/requirements.txt`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Allineate al repository le correzioni di compatibilita Python 3.10 gia necessarie sulla VPS: rimossa la dipendenza non pubblicata `emergentintegrations` e fissate NumPy 2.2.6 e Pandas 2.3.3. La modifica evita che un'installazione pulita del P0-B riproponga gli errori di risoluzione osservati in produzione.
**Testato**: si (metodo: confronto con l'ambiente VPS Python 3.10 e risoluzione pip senza installazione)
**Note per il prossimo agente**: non ripristinare NumPy 2.4.x o Pandas 3.x finche la produzione resta su Python 3.10; l'upgrade Python va eseguito come intervento separato.
### [2026-07-17 11:50 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | docs | test
**File toccati**:
- `/app/memory/P0_B_PREFLIGHT_2026-07-17.md`
- `/app/scripts/p0b_external_smoke.py`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Completato in sola lettura il preflight reale della VPS per P0-B: commit live, worktree, servizi, Nginx/TLS, porte, CORS, WebSocket anonimo, MongoDB, storage, upload, permessi e strumenti di backup. Documentati criticita e delta locali da preservare, sequenza operativa concreta e rollback; aggiunto smoke test esterno anonimo e non distruttivo per verificare il contenimento dopo il deploy.
**Testato**: si (metodo: controlli SSH read-only sulla VPS, verifiche HTTP/HTTPS/TLS/CORS/porte/WSS dall'esterno, compilazione e prova baseline dello smoke script, `git diff --check`)
**Note per il prossimo agente**: nessuna modifica e stata applicata alla VPS. Il P0-B resta da eseguire solo a locali fermi. Non fare un pull live finche upload, patch VPS di `requirements.txt`, script locali, backup e worktree sporco non sono stati preservati come descritto nel preflight.

### [2026-07-17 11:11 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | architecture | planning
**File toccati**:
- `/app/memory/OPERATIONAL_MEMORY_{DESIGN,ADVANCED_CAPABILITIES}.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Esteso il progetto approvato della Memoria operativa con un documento separato per le capacita avanzate: tempo bitemporale, grafo di provenienza e Spiega questo valore, replay, formule/parser in modalita ombra, gemello digitale consultivo, confronto tra modelli predittivi, incertezza esplicita, anomalie personalizzate, assistente con fonti e consapevolezza dei dati mancanti. Formalizzati campi da raccogliere dal momento zero, dipendenze unidirezionali, ordine di realizzazione, limiti di autonomia, test e criteri di accettazione. Esclusi esplicitamente dizionario semantico esteso e registro manuale degli esperimenti.
**Testato**: si (metodo: revisione incrociata con il progetto base, verifica dei riferimenti, controllo delle esclusioni richieste, repository hygiene e `git diff --check`)
**Note per il prossimo agente**: il documento avanzato non autorizza alcuna implementazione. Il worker e lo storage isolato del progetto base vengono prima; bitemporalita, provenienza, versioni e qualita devono pero essere previste fin dal primo schema per non rendere inutilizzabile lo storico futuro.

### [2026-07-17 10:52 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | reliability | planning
**File toccati**:
- `/app/memory/{TODO,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Inserito nella TODO un blocco compatto e ordinato per l'affidabilita di Report e mezzanotte: R1 distingue giornata vuota da archiviazione fallita e impedisce l'azzeramento dei contatori in errore; R2 uniforma e testa la valutazione delle formule tra tutte le viste e il backend; R3 introduce un lock MongoDB con scadenza contro reset concorrenti. Definiti ordine e test minimi senza duplicare l'analisi estesa.
**Testato**: si (metodo: revisione statica della sezione, verifica assenza di duplicati equivalenti nella TODO e `git diff --check`)
**Note per il prossimo agente**: ordine consigliato R1, R2, R3. R1 corregge un'ambiguita concreta del risultato di archiviazione; R2 deve mantenere lettura tollerante dello storico; R3 ha priorita inferiore finche la VPS usa un solo processo Uvicorn.

### [2026-07-17 10:39 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | product | architecture
**File toccati**:
- `/app/memory/{PRD,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Riscritto integralmente il PRD come contratto funzionale corrente dell'applicazione. Rimossi diario delle vecchie sessioni, backlog duplicati, integrazione Google Sheets non piu presente e riferimenti a credenziali/ID esterni. Formalizzati visione, principi, architettura post-refactor, matrice ruoli, isolamento tenant per scheda, ordini, mezzanotte/recovery, Report e riporti, Numeri, Analisi mensile, magazzino/DDT, documenti, diagnostica, creazione locali, fonti di verita, requisiti non funzionali, stato P0-A/P0-B, criteri di rilascio e limiti noti. I piani futuri restano nei documenti dedicati.
**Testato**: si (metodo: verifica incrociata con router, servizi, task, controlli ruolo e documentazione corrente; riferimenti locali tutti esistenti; documento ASCII senza mojibake o riferimenti sensibili obsoleti; repository hygiene check passato su 256 file; `git diff --check` passato)
**Note per il prossimo agente**: il PRD descrive il comportamento atteso, non sostituisce il changelog. Se codice/test e PRD divergono, segnalare la differenza come bug o decisione da chiarire; non riscrivere silenziosamente il requisito per farlo coincidere con il codice.

### [2026-07-17 10:22 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | test | config | docs
**File toccati**:
- `/app/.github/workflows/lightweight-ci.yml`
- `/app/backend/requirements-ci.txt`
- `/app/scripts/check_repository_hygiene.py`
- `/app/memory/{SECURITY_HARDENING_PLAN,CHANGELOG_MULTI_AGENT}.md`
**Descrizione**: Aggiunta una pipeline GitHub Actions a basso consumo sul push finale a `main`, sulle pull request e su avvio manuale. Un solo runner esegue in sequenza controllo repository, compileall/F821, suite backend standard, test frontend e build senza sourcemap; cache, timeout di 15 minuti e cancellazione delle esecuzioni superate limitano tempi e risorse. Il controllo locale blocca file runtime/credenziali e token ad alta confidenza senza dipendenze esterne.
**Testato**: sì (metodo: controllo igiene su 256 file; virtualenv Python 3.12 pulito con dipendenze CI minime; compileall e F821; 58 test backend passati con 30 live gated; 12 test frontend passati; build React produzione completata con i soli warning Hook preesistenti)
**Note per il prossimo agente**: la baseline non esegue Mongo live, browser E2E, CodeQL, dependency audit o SBOM. Non trasformarla in una matrice di runner senza un beneficio concreto. La build usa `CI=false` soltanto per mantenere gli warning ESLint preesistenti non bloccanti, come sulla VPS; i test frontend restano in `CI=true`.
### [2026-07-16 15:31 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | refactor | config | test | docs
**File toccati**:
- `/app/backend/app/core/{config,security,files,deps,diagnostics,rate_limit}.py`
- `/app/backend/app/routers/{system,websocket,analysis,report,documents,invoices,warehouse,beverages,orders}.py`
- `/app/backend/app/bootstrap.py`, `/app/backend/app/services/{seeding,report}.py`, `/app/backend/server.py`
- `/app/backend/scripts/{manage_account,seed_test_environment}.py`, `/app/backend/tests/`
- `/app/frontend/src/contexts/{AuthContext,OrderContext}.js` e pagine con controlli ruolo
- `/app/.gitignore`, `/app/uploads/`, `/app/setup.sh`, configurazione e documentazione locale
- `/app/memory/{SECURITY_HARDENING_PLAN,P0_VPS_RUNBOOK,PRD,TODO,test_credentials}.md`
**Descrizione**: Implementato il P0-A lato codice. Federico mantiene il ruolo `supervisor` e capability esplicite per locale/Report senza diventare admin; prodotti, quantità, fornitori e fatture globali richiedono ora un admin reale. Rimossi dal runtime seed pubblico, elenco/creazione locali pubblici, summary morto, route mock/snapshot e route bevande legacy. Gli upload usano URL HMAC temporanee, il WebSocket usa ticket monouso autenticati con Origin allowlist, Swagger è disattivato in produzione, CORS è configurabile e gli account privilegiati non vengono più creati o resettati all'avvio. Rimossi 56 upload di test dal repository e bonificate le credenziali note nei file correnti. Rimossa anche la scrittura runtime del vecchio `backup_flaminio.txt`, rilevata durante i test live. Preparato il runbook P0-B senza eseguire modifiche sulla VPS.
**Testato**: sì (metodo: `compileall`, flake8 F821, suite backend standard, 3 integrazioni Mongo isolate passate, 108 test HTTP live passati su database isolato, prova mirata ordine Flaminio senza ricreazione del backup, build React produzione completata, `git diff --check`, scansione delle credenziali note senza corrispondenze)
**Note per il prossimo agente**: non fare un deploy P0 come aggiornamento ordinario. Eseguire `/app/memory/P0_VPS_RUNBOOK.md` in finestra di manutenzione: backup, migrazione upload fuori repo, HTTPS redirect, bind locale/chiusura 8001, rotazione password e `JWT_SECRET`, smoke test e rollback. La riscrittura della cronologia Git resta separata e richiede freeze coordinato di tutti i clone.

### [2026-07-16 02:38 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | architecture
**File toccati**:
- `/app/memory/OPERATIONAL_MEMORY_DESIGN.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Salvato nel piano Memoria il percorso pratico di implementazione prudente: worker separato prima della UI, storage `pastasciutta_memory`, momento zero senza backfill, batch piccoli con watermark, prime fonti da raccogliere, raw+normalizzato, limiti systemd, snapshot giornalieri e rollout dry-run prima dell'attivazione.
**Testato**: si (metodo: revisione manuale del documento)
**Note per il prossimo agente**: la Memoria va implementata prima come raccolta silenziosa e spegnibile. Non partire da dashboard o previsioni; dimostrare per 24-48 ore impatto, lag, errori e rollback prima di esporre viste utente.

### [2026-07-16 02:26 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | architecture
**File toccati**:
- `/app/memory/TODO.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Salvata nel TODO l'idea completa dell'Audit sensibile unico: vista consultiva tipo estratto conto delle modifiche importanti, schema evento comune, riuso dei log esistenti tramite adapter, futura collection append-only `sensitive_audit_events`, whitelist per area, fasi di rollout, test obbligatori e non-obiettivi.
**Testato**: si (metodo: revisione manuale dei documenti)
**Note per il prossimo agente**: non implementare l'audit come tabella gigante o cronologia di ogni click. Prima creare standard comune e adapter sopra `cash_audit_log`, `deletion_logs`, `modification_logs`, `generale_hide_log` e `stock_movements`; poi introdurre emissione diretta graduale.

### [2026-07-15 23:52 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | security
**File toccati**:
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunte regole multi-agente per trattare Report, Cassa, Audit, Analisi, export e calcoli operativi come aree sensibili; aggiunto obbligo di esplicitare rischi, test e rollback prima di agire su produzione, SSL/cache, auth, dati reali, cancellazioni, import/export o refactor strutturali.
**Testato**: si (metodo: revisione manuale del vademecum multi-agente)
**Note per il prossimo agente**: per aree analitiche/contabili non basta verificare la UI: controllare dati vecchi/nuovi, filtri, totali, ruoli, tenant e aggiornamenti live. Se il cambio e' rischioso, dirlo prima e preparare rollback.

### [2026-07-15 23:45 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | security
**File toccati**:
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunte regole vincolanti per tutti gli agenti: frontend/build/sourcemap/`REACT_APP_*` sono pubblici; ogni nuova route backend deve dichiarare e testare i ruoli ammessi; modifiche a login/auth/ruoli/upload/WebSocket/Report richiedono revisione sicurezza, non solo verifica funzionale; il file va mantenuto in UTF-8 con BOM per evitare mojibake/patch fragili su Windows.
**Testato**: si (metodo: revisione manuale del vademecum multi-agente)
**Note per il prossimo agente**: quando tocchi frontend o deploy, controlla che non finiscano segreti nel bundle pubblico e valuta sourcemap produzione come superficie informativa da disabilitare/rimuovere. Quando tocchi route o aree sensibili, documenta i ruoli ammessi e i rischi verificati. Se questo file mostra caratteri strani, correggi l'encoding prima di modificare contenuto.

### [2026-07-15 09:31 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | ux | test
**File toccati**:
- `/app/frontend/src/App.js`
- `/app/frontend/src/components/RouteScrollRestoration.js`
- `/app/frontend/src/components/RouteScrollRestoration.test.js`
- `/app/frontend/src/utils/scrollMemory.js`
- `/app/frontend/src/utils/scrollMemory.test.js`
- `/app/frontend/src/pages/MagazzinoRichiestePage.js`
- `/app/frontend/src/pages/RichiestaMercePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunta memoria globale dello scroll per tutte le route frontend. Ogni URL conserva in `sessionStorage` la propria posizione nella singola scheda: refresh e ritorno alla pagina riprendono dal punto precedente, mentre una pagina mai visitata parte dall'alto. Il ripristino attende fino a 15 secondi i contenuti caricati via API, non compete con l'interazione dell'utente e lascia indipendenti gli scroll interni esplicitamente gestiti. Rimossi gli agganci window duplicati dalle due pagine che usavano già il vecchio hook locale.
**Testato**: si (metodo: 12 test frontend passati, inclusi salvataggio durante lo scroll, ripristino immediato, caricamento asincrono e React StrictMode; build produzione completata; dev server compilato senza nuovi warning; avvio browser locale senza errori console)
**Note per il prossimo agente**: il comportamento globale riguarda lo scroll della finestra e usa chiavi per pathname, query string e hash. Per riquadri con `overflow:auto` continuare a usare `useScrollMemory` con una ref. `frontend/public/version.json` è generato da `npm run build` e non fa parte della modifica sorgente.

### [2026-07-14 16:58 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: docs | architecture
**File toccati**:
- `/app/memory/TODO.md`
- `/app/memory/OPERATIONAL_MEMORY_DESIGN.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Registrate nella TODO le funzionalita future approvate (Macchina del tempo, confronti tra giorni omogenei e festivita mobili, composizione delle paste). Progettata separatamente la futura Memoria operativa: acquisizione isolata e idempotente dei dati utili di ordini, report, magazzino, DDT e richieste locali, con storage dedicato, watermark, limiti di risorse, osservabilita, test, attivazione e rollback. Il principio vincolante e che la Memoria possa fallire senza trascinare con se l'applicazione; non e stata implementata alcuna modifica applicativa o infrastrutturale.
**Testato**: si (metodo: inventario statico delle fonti dati e dei flussi applicativi; verifica del documento, delle esclusioni richieste, dell'assenza di credenziali e di whitespace errato)
**Note per il prossimo agente**: usare `memory/OPERATIONAL_MEMORY_DESIGN.md` come specifica prima dell'implementazione. Fatture, versamenti, chiusure, immagini e segreti restano esclusi. `uploads/backup_flaminio.txt` e intenzionalmente escluso dal commit.

### [2026-07-14 12:40 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: security | audit | docs
**File toccati**:
- `/app/memory/SECURITY_HARDENING_PLAN.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Completato audit di sicurezza iniziale sull'intera applicazione e sulla configurazione pubblica della VPS. Salvato un piano operativo condiviso P0-P3 con contenimento immediato, identita e autorizzazioni, hardening VPS/Mongo/upload, supply-chain, backup, logging, integrita transazionale, CI, ASVS e penetration test. Il documento registra anche criteri di uscita verificabili e l'ordine consigliato delle release, senza riportare credenziali sensibili.
**Testato**: si (metodo: analisi statica di 118 endpoint; verifica ruoli, tenant, JWT, WebSocket, upload e configurazione; audit `yarn audit` e `pip-audit`; verifica passiva HTTP/HTTPS, porta backend, route pubbliche e OpenAPI sulla VPS, senza login o operazioni distruttive)
**Note per il prossimo agente**: leggere `memory/SECURITY_HARDENING_PLAN.md` prima di qualsiasi intervento di sicurezza. Le criticita P0 rappresentano esposizioni attive e precedono nuove funzionalita non urgenti. Non inserire password, token o copie di documenti nel changelog o nel piano.

### [2026-07-14 12:05 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: feature | config | test
**File toccati**:
- `/app/backend/app/schemas/auth.py`
- `/app/backend/app/routers/system.py`
- `/app/backend/app/routers/warehouse.py`
- `/app/backend/app/routers/analysis.py`
- `/app/backend/app/services/analysis.py`
- `/app/backend/tests/test_new_restaurant_configuration.py`
- `/app/backend/tests/test_phase1_foundations_contract.py`
- `/app/backend/tests/test_phase3_module_contract.py`
- `/app/frontend/src/pages/CreaLocaliPage.js`
- `/app/frontend/src/pages/HomePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Rifatto il flusso Simone per creare un locale con configurazione completa: nome, username, password, sigla Excel univoca, bollitori, indirizzo/CAP/citta per i DDT e abilitazione opzionale del Monitor clienti. Il backend valida obbligatorieta, formato e duplicati senza distinzione maiuscole/minuscole, aggiorna subito la cache diagnostica e usa i dati del locale nei DDT e nelle intestazioni MEDIA degli Excel; i locali esistenti mantengono i fallback storici. La gestione bevande e stata intenzionalmente esclusa su richiesta.
**Testato**: si (metodo: 51 test unitari/contratto; integrazione Mongo isolata Excel; build React produzione; controllo visuale desktop e mobile; prova interattiva di tutti i campi senza invio; login/API locale e rifiuto HTTP 400 di un CAP non valido senza scritture DB)
**Note per il prossimo agente**: non rendere nuovamente opzionali indirizzo, CAP, citta o sigla Excel nella creazione Simone. `LOCATION_ADDRESSES` resta solo come fallback retrocompatibile per i locali storici non ancora migrati.

### [2026-07-14 11:30 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: bugfix | test | performance | trasparenza dati
**File toccati**:
- `/app/backend/app/services/analysis.py`
- `/app/backend/app/routers/analysis.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/backend/tests/test_analysis_excel_isolated_integration.py`
- `/app/frontend/src/pages/AnalisiAnnualePage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Verificata end-to-end la provenienza delle paste nell'Excel Analisi mensile e separata la statistica dall'audit. Pagina Numeri, Excel Numeri, snapshot automatico Report, fogli locali e Totali contano ora esclusivamente `orders` e `archived_orders`; `deletion_logs` e `archived_deletion_logs` restano disponibili per audit e continuita della numerazione ma non rappresentano paste uscite. Una giornata storica con sole cancellazioni non recupera piu un vecchio snapshot automatico contenente quelle paste. L'identita di deduplicazione usa anche l'istante originale di creazione, conservando eventuali numeri validi realmente riutilizzati e rimuovendo soltanto copie dello stesso ordine. Pagina Numeri ed export Numeri prelevano l'intero intervallo con due query invece delle query giorno per giorno. L'Analisi segnala inoltre ogni override manuale e le giornate prive di ordini sorgente dopo il download.
**Testato**: si (metodo: 47 test unitari/contratto; 3 integrazioni Mongo isolate; workbook reale verificato cella per cella su due locali, giornata mista, giornata con sole cancellazioni, copie archiviate, numero riutilizzato, sigle, XL/Altro, snapshot e override manuale; build React produzione; audit read-only DB locale ed export HTTP reale: Flaminio 2026-07-03 contiene 21 ordini validi e 5 cancellazioni, entrambi i fogli riportano correttamente 21)
**Note per il prossimo agente**: i database temporanei sono stati eliminati. Non reinserire le collection delle cancellazioni in `ANALYSIS_ORDER_SOURCES`; servono soltanto a distinguere i vecchi snapshot automatici nei giorni senza ordini validi. `uploads/backup_flaminio.txt` resta intenzionalmente escluso.

### [2026-07-14 11:00 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: test | docs
**File toccati**:
- `/app/memory/refactor_plan_server_py.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Eseguita una verifica differenziale completa tra il monolite `e6ac426` e il refactor su due processi Uvicorn e database Mongo gemelli. Nessuna regressione rilevata: equivalenti corpi funzione, HTTP, Excel, stato Mongo, indici, WebSocket e reset notturno; confermata soltanto la protezione intenzionale del contatore su collisione manuale. Riavviati backend e frontend locali con il codice attuale.
**Testato**: si (metodo: 95 corpi AST; 102 checkpoint HTTP; 2 workbook; 23 collezioni e indici Mongo; 10 collezioni post-reset; WebSocket reconnect; build React; 4/4 test frontend; smoke locale read-only con quattro ruoli)
**Note per il prossimo agente**: backend locale attivo su `http://localhost:8001`, frontend su `http://localhost:3000/`. Aprire il dev server dalla radice `/`; il 404 su accesso diretto a `/home` e preesistente e legato al wrapper Visual Edits, mentre Nginx in produzione ha il fallback SPA.

### [2026-07-14 10:36 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | test | docs
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/app/bootstrap.py`
- `/app/backend/app/core/diagnostics.py`
- `/app/backend/app/core/rate_limit.py`
- `/app/backend/app/core/runtime.py`
- `/app/backend/app/routers/system.py`
- `/app/backend/app/routers/websocket.py`
- `/app/backend/app/routers/invoices.py`
- `/app/backend/app/routers/warehouse.py`
- `/app/backend/app/routers/beverages.py`
- `/app/backend/app/routers/documents.py`
- `/app/backend/app/services/seeding.py`
- `/app/backend/tests/conftest.py`
- `/app/backend/tests/test_phase3_module_contract.py`
- `/app/backend/tests/test_phase3_isolated_integration.py`
- `/app/memory/refactor_plan_server_py.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Completata la fase 3 e chiuso il refactor del monolite. Estratti tutti i domini residui e centralizzato il bootstrap FastAPI in un lifespan unico con startup, indici, seed, scheduler e shutdown. `server.py` passa da 3677 a 269 righe e resta compatibile con `uvicorn server:app` e con gli import storici; contratto OpenAPI invariato.
**Testato**: si (metodo: 40 test unitari/contratto; 2 gate Mongo isolati per concorrenza, reset/carry-over, auth, flusso Ordini/Report/Audit, magazzino, richieste e documenti; processo Uvicorn reale con login Admin e 2 round-trip WebSocket; database e upload temporanei eliminati)
**Note per il prossimo agente**: nessun modulo `app/` importa `server.py`; non usare le vecchie suite distruttive sul DB operativo. Debiti non bloccanti: warning Passlib/bcrypt, `BaseModel.dict()` deprecato e import Starlette `multipart` legacy.

### [2026-07-14 10:21 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | bugfix | docs
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/app/core/catalogs.py`
- `/app/backend/app/core/deps.py`
- `/app/backend/app/core/state.py`
- `/app/backend/app/core/ws_manager.py`
- `/app/backend/app/routers/*.py`
- `/app/backend/app/services/*.py`
- `/app/backend/app/tasks/*.py`
- `/app/backend/tests/test_report_backend_totals.py`
- `/app/backend/tests/test_phase2_module_contract.py`
- `/app/backend/tests/test_phase2_isolated_integration.py`
- `/app/memory/refactor_plan_server_py.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Completata la fase 2 del refactor: estratti router e servizi per Ordini, Report e Analisi, più singleton WebSocket/cache e task di reset, recovery e retention. `server.py` conserva tutti i re-export e passa da 7629 a 3677 righe; contratto OpenAPI, query e formati export restano invariati. Aggiunta inoltre una protezione al numero ordine manuale: una collisione attiva restituisce 409 senza abbassare il contatore, mentre il riavvio manuale resta consentito quando il numero non è attivo.
**Testato**: si (metodo: compileall; 34 test unitari/contratto; smoke ASGI di sola lettura su login, auth/me, Ordini, Report, Analisi, Numeri e autorizzazioni; test Mongo isolato con 20 POST concorrenti, collisione manuale, archiviazione reale a mezzanotte e carry-over cash/cassetto/bevande; database temporaneo eliminato)
**Note per il prossimo agente**: i nuovi moduli non importano `server.py` e condividono lo stesso `db` e lo stesso `manager`. Non rilanciare le vecchie suite con cleanup sul DB operativo; usare il gate isolato con `PASTA_RUN_ISOLATED_INTEGRATION=1` e un `DB_NAME` che inizi per `pastasciutta_refactor_test_`. Restano warning non bloccanti per FastAPI `on_event` e Passlib/bcrypt, da affrontare nella fase 3.

### [2026-07-14 09:59 CEST] - Codex (GPT-5 / OpenAI)
**Tipo**: refactor | docs
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/app/__init__.py`
- `/app/backend/app/core/*.py`
- `/app/backend/app/schemas/*.py`
- `/app/backend/tests/test_phase1_foundations_contract.py`
- `/app/memory/refactor_plan_server_py.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Completata la fase 1 del refactor di `server.py` senza spostare endpoint: configurazione, client Mongo, sicurezza JWT, calendario di Roma e upload sono ora in `app/core`; tutti gli schemi Pydantic sono divisi per dominio in `app/schemas`. Rimossa la doppia definizione di `OrderCreate`, mantenendo i re-export da `server.py` e il contratto OpenAPI esattamente invariato.
**Testato**: si (metodo: compileall; 28 test pytest su contratto OpenAPI, auth, timezone, upload e calcoli Report; smoke ASGI di sola lettura: versione 200, login Flaminio 200, auth/me 200, endpoint diagnostica con token locale 403)
**Note per il prossimo agente**: `server.py` e sceso da 8004 a 7629 righe. Non spostare ancora manager WebSocket, reset notturno o audit senza i gate della fase 2. Restano warning non bloccanti gia esistenti per FastAPI `on_event` e Passlib/bcrypt; le vecchie suite con cleanup Mongo aggressivo non vanno lanciate sul DB operativo.

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

<!-- Le voci più vecchie vanno archiviate in CHANGELOG_MULTI_AGENT_ARCHIVE.md dopo 30 giorni -->
