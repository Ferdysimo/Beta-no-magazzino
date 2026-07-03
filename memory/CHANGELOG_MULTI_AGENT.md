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

**🇬🇧 ENGLISH**
Before making any code change:
1. **READ** the entire "CHANGE LOG" section below, newest first.
2. Also read `/app/memory/PRD.md` for general product context.
3. After completing your work (even small fixes), **ADD** a new entry on top of the "CHANGE LOG" section using the format below.
4. DO NOT delete previous entries. Only append.
5. If this file grows beyond 500 lines, move entries older than 30 days to `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.

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

### [2026-07-03 15:44 CEST] — Codex (GPT-5 / OpenAI)
**Tipo**: feature
**File toccati**:
- `/app/backend/server.py`
- `/app/backend/requirements.txt`
- `/app/frontend/src/pages/MediaLocaliPage.js`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto bottone "SCARICA EXCEL" nella pagina Numeri (`/media-locali`). Il download chiama il nuovo endpoint admin `/api/admin/media-locali/export?year=YYYY`, che genera un file `.xlsx` annuale dal 1 gennaio al 31 dicembre con colonne DATA, locali, TOTALI e medie mensili compilate solo sull'ultimo giorno di ogni mese.
**Testato**: ✅ sì (metodo: build backend Docker con `openpyxl`, `python -m py_compile`, export autenticato Admin su `localhost:8002`, controllo intestazioni workbook, simulazione ordini/log con medie mensili attese per gennaio/febbraio, `yarn build`)
**Note per il prossimo agente**: L'export usa gli stessi criteri della pagina Numeri: per ogni locale prende il massimo `order_number` giornaliero da ordini attivi, archiviati e cancellati. Nel DB locale Docker sono stati inseriti record fittizi dei tre locali solo per verificare le intestazioni complete del file.

### [2026-07-03 14:38 CEST] — Codex (GPT-5 / OpenAI)
**Tipo**: config
**File toccati**:
- `/app/docker-compose.local.yml`
- `/app/docker/local/backend.Dockerfile`
- `/app/docker/local/frontend.Dockerfile`
- `/app/.dockerignore`
- `/app/LOCAL_DOCKER.md`
- `/app/memory/CHANGELOG_MULTI_AGENT.md`
**Descrizione**: Aggiunto ambiente locale Docker per testare l'app con versioni vicine alla VPS: Python 3.12, Node.js 20 e MongoDB 8.0. Documentati avvio standard, fallback porta backend 8002 su Windows, seed account e comandi operativi.
**Testato**: ✅ sì (metodo: `docker compose build`, `docker compose up -d`, health backend `/api/`, frontend `localhost:3000`, seed e login Admin)
**Note per il prossimo agente**: Su questo PC la porta host 8001 risultava bloccata da un socket Windows orfano; lo stack Docker è stato validato con `BACKEND_HOST_PORT=8002` e `REACT_APP_BACKEND_URL=http://localhost:8002`. Dentro Docker il backend resta su 8001.

### [2026-02-XX] — Emergent E1 (Claude Sonnet 4.5)
**Tipo**: docs
**File toccati**:
- `/app/memory/CHANGELOG_MULTI_AGENT.md` (creato)
**Descrizione**: Creato questo file di sincronizzazione multi-agente con istruzioni IT/EN, formato voci e contesto rapido del progetto. Permette ad altri agenti AI esterni di sapere cosa è già stato fatto senza ripetere lavoro o introdurre regressioni.
**Testato**: ✅ sì (creazione file verificata)
**Note per il prossimo agente**: Quando modifichi codice, ricordati di aggiungere la tua voce QUI SOPRA prima di chiudere il task. Se l'utente ti chiede "leggi il changelog", riferisciti a questo file.

---

<!-- Le voci più vecchie vanno archiviate in CHANGELOG_MULTI_AGENT_ARCHIVE.md dopo 30 giorni -->
