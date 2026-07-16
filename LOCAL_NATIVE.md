# Ambiente locale nativo Windows

Questo setup replica il piu possibile la VPS senza Docker:

- Python 3.12 con virtualenv in `backend/.venv`
- Node.js 20
- Yarn 1.22.22 via `npx`
- MongoDB Community Server 8.0 portable su `localhost:27017`
- Backend FastAPI su `http://localhost:8001/api/`
- Frontend React su `http://localhost:3000`

## Avvio

```powershell
.\scripts\start-local-native.ps1
```

Se Windows blocca gli script PowerShell per execution policy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-native.ps1
```

Lo script crea/aggiorna solo file locali ignorati da Git:

- `backend/.env`
- `frontend/.env`
- `logs/`
- `.local-data/`
- `.local-tools/`

## Primo setup gia eseguito su questo PC

MongoDB portable e stato scaricato sotto `.local-tools/`, il database locale usa `.local-data/mongo`.

Le dipendenze backend sono installate in `backend/.venv`. Il file `.local-tools/requirements-local.txt` deriva da `backend/requirements.txt`, escludendo:

- `emergentintegrations`, non disponibile su PyPI pubblico e non importato dal codice
- `uvloop`, non supportato su Windows

Le dipendenze frontend sono installate con:

```powershell
cd frontend
npx --yes yarn@1.22.22 install --frozen-lockfile
```

## Test rapido

```powershell
Invoke-RestMethod http://localhost:8001/api/
```

Gli account non vengono creati o resettati all'avvio. Per creare un account in
un database locale vuoto, usare il comando offline dalla cartella `backend`:

```powershell
.\.venv\Scripts\python.exe scripts\manage_account.py create --username Admin --name Amministratore --location Amministrazione --role admin
```

La password viene richiesta senza essere scritta nel terminale o nel repository.

## Log

```text
logs/mongo.log
logs/backend.out.log
logs/backend.err.log
logs/frontend.out.log
logs/frontend.err.log
```

## Note

Questo ambiente non installa servizi Windows e non richiede privilegi amministrativi. Per chiudere i processi, termina i processi `mongod.exe`, `python.exe`/`uvicorn` e `node.exe` avviati dalla sessione locale.
