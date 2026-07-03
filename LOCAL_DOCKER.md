# Ambiente locale Docker

Questo ambiente serve a testare l'app in locale con versioni vicine alla VPS, senza dipendere dalle versioni installate su Windows.

## Versioni fissate

- Backend: Python 3.12
- Frontend: Node.js 20
- MongoDB: 8.0
- Yarn: 1.22.22, dal `packageManager` del frontend

## Avvio standard

Se le porte `3000` e `8001` sono libere:

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

Apri:

```text
http://localhost:3000
```

Backend:

```text
http://localhost:8001/api/
```

## Fallback se la porta 8001 e occupata

Su questo PC Windows puo restare occupata la porta `8001` dopo un run nativo di uvicorn. In quel caso usa il backend su `8002`:

```powershell
$env:BACKEND_HOST_PORT="8002"
$env:REACT_APP_BACKEND_URL="http://localhost:8002"
docker compose -f docker-compose.local.yml up -d --build
```

Apri sempre:

```text
http://localhost:3000
```

Backend:

```text
http://localhost:8002/api/
```

Dentro Docker il backend resta comunque sulla porta `8001`, come sulla VPS; cambia solo la porta esposta su Windows.

## Seed account

Dopo il primo avvio:

```powershell
Invoke-RestMethod -Method Post http://localhost:8002/api/seed
```

Se stai usando la porta standard:

```powershell
Invoke-RestMethod -Method Post http://localhost:8001/api/seed
```

Credenziali principali:

```text
Admin / Pastasciutt4!
Flaminio / Pastasciutt4!
Grazie / Pastasciutt4!
Brazza / Pastasciutt4!
Magazziniere / Pastasciutt4!
```

## Comandi utili

Stato:

```powershell
docker compose -f docker-compose.local.yml ps
```

Log backend:

```powershell
docker compose -f docker-compose.local.yml logs -f backend
```

Log frontend:

```powershell
docker compose -f docker-compose.local.yml logs -f frontend
```

Stop:

```powershell
docker compose -f docker-compose.local.yml down
```

Reset completo del DB locale Docker:

```powershell
docker compose -f docker-compose.local.yml down -v
```

Attenzione: `down -v` cancella il database Mongo locale Docker.

## Note

- Il DB Docker usa il volume `mongo-local-data` ed e separato dal MongoDB installato su Windows.
- Il Dockerfile backend parte da `backend/requirements.txt` ed esclude solo `emergentintegrations`, che non e importato dal codice e non e disponibile su PyPI pubblico.
- Non usare il Python globale di Windows per validare il backend: il container usa Python 3.12.
- Non usare Node 24 per validare il frontend: il container usa Node 20.
