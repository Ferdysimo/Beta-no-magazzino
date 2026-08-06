# P0-B preflight VPS - 17 luglio 2026

Stato: verifica completata in sola lettura. Nessuna configurazione, servizio,
file o dato della VPS e stato modificato.

Questo documento fotografa la produzione prima della finestra P0-B e integra
`memory/security/P0_VPS_RUNBOOK.md`. Non contiene password, token, chiavi private o valori
del file `.env`.

## Identita del rilascio

- VPS: `51.91.125.232`, host `vps-ec29b739`.
- Repository produzione: `/opt/pastasciutta`.
- Branch produzione: `main`.
- Commit attualmente live: `0477dc6bab7c0f9dc33a12a6e78b7e65ff7af4f3`.
- Commit P0-A da distribuire: `35955354bc658e7e83ec54a520fb46a0b72f88a9`.
- Servizio backend: `pastasciutta-backend.service`.
- Database: `pastasciutta`.
- Dominio: `pasta-app.it` e `www.pasta-app.it`.

Prima del deploy verificare nuovamente che `origin/main` punti ancora al commit
P0-A atteso. Se e cambiato, fermarsi e rieseguire test e revisione del delta.

## Risultati positivi

- HTTPS risponde correttamente sul dominio.
- HTTP sul dominio reindirizza gia a HTTPS.
- Certificato Let's Encrypt valido fino al 15 ottobre 2026.
- DNS di dominio e `www` puntano alla VPS corretta.
- MongoDB 8.0.20 ascolta soltanto su `127.0.0.1:27017`.
- Disco: circa 78 GB liberi; inode liberi sufficienti.
- Database: circa 68 MB.
- Upload: circa 3.0 GB e 2190 file.
- `mongodump`, `mongorestore` e `rsync` sono installati.
- Backend, MongoDB e Nginx sono attivi; nessun restart anomalo del backend.
- Nessun errore backend o Nginx rilevato nelle ultime 24 ore.
- La CORS corrente rifiuta un Origin esterno non autorizzato.

## Criticita P0 da chiudere nella finestra

1. Uvicorn ascolta su `0.0.0.0:8001`; la porta risponde direttamente da Internet.
2. UFW e inattivo. La chiusura deve essere applicata sia al bind del processo sia
   al firewall.
3. L'IP diretto in HTTP serve il backend tramite il default server Nginx. Deve
   essere rifiutato o reindirizzato al dominio canonico.
4. Il codice P0-A non e ancora live:
   - `/docs` e `/openapi.json` rispondono 200;
   - `/api/restaurants` e accessibile senza login;
   - `/api/ws-ticket` non esiste ancora;
   - il vecchio `/api/ws/{restaurant_id}` accetta una connessione anonima.
5. Gli upload runtime sono ancora dentro `/opt/pastasciutta/uploads`.
6. Il worktree di produzione e sporco e non deve ricevere un pull alla cieca.
7. `/opt/pastasciutta/backend/.env` ha permessi 0644; deve diventare 0600.
8. Mancano nel `.env` le variabili P0 `APP_ENV`, `ENABLE_API_DOCS`,
   `UPLOADS_DIR` e `CORS_ALLOWED_ORIGINS`.
9. Password note e `JWT_SECRET` devono essere ruotati durante la manutenzione,
   causando intenzionalmente il logout di tutte le sessioni.

## Delta locali da preservare

Il worktree live contiene elementi che devono essere salvati prima del pull:

- `backend/requirements.txt` modificato per compatibilita VPS:
  `emergentintegrations` rimosso, `numpy==2.2.6`, `pandas==2.3.3`;
- `frontend/public/version.json` generato dal build;
- `uploads/backup_flaminio.txt` modificato dal vecchio runtime;
- script backend locali non versionati;
- directory `backup/` non versionata;
- migliaia di upload non versionati.

Non usare `git reset --hard`, `git clean -fd` o comandi equivalenti. La modifica
alle dipendenze va esportata come patch e verificata contro il nuovo
`requirements.txt`; gli script e i backup locali vanno copiati nel backup
protetto. `backup_flaminio.txt` puo essere rimosso dalla repo solo dopo arresto
del vecchio backend e backup: il P0-A non lo scrive piu.

## Osservazioni P1, non bloccanti per il P0-B

- Il backend gira come `root` e il servizio systemd non ha ancora hardening.
- MongoDB non usa autenticazione SCRAM, pur essendo confinato a localhost.
- Mancano alcuni header di difesa in profondita, incluso HSTS.

Questi punti restano nel piano P1/P2. Non vanno aggiunti all'ultimo momento alla
finestra P0-B senza test dedicati.

## Sequenza operativa P0-B

Eseguire solo quando nessun locale sta lavorando. Tenere aperta una seconda
sessione SSH fino alla verifica finale.

### 1. Fotografia e backup

```bash
set -euo pipefail
cd /opt/pastasciutta

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="/var/backups/pastasciutta/${stamp}"
sudo install -d -m 0700 \
  "${backup_root}/mongo" \
  "${backup_root}/uploads" \
  "${backup_root}/config" \
  "${backup_root}/local-deltas"

git rev-parse HEAD | sudo tee "${backup_root}/config/git-head.txt" >/dev/null
git status --short | sudo tee "${backup_root}/config/git-status.txt" >/dev/null
git diff -- backend/requirements.txt | \
  sudo tee "${backup_root}/local-deltas/requirements.patch" >/dev/null

sudo mongodump --db pastasciutta --out "${backup_root}/mongo"
sudo rsync -a /opt/pastasciutta/uploads/ "${backup_root}/uploads/"
sudo cp -a /opt/pastasciutta/backend/.env "${backup_root}/config/backend.env"
sudo cp -a /etc/systemd/system/pastasciutta-backend.service \
  "${backup_root}/config/"
sudo cp -a /etc/nginx/sites-available/pastasciutta "${backup_root}/config/"

sudo du -sh "${backup_root}/mongo" "${backup_root}/uploads"
sudo find "${backup_root}/mongo" -type f | wc -l
sudo find "${backup_root}/uploads" -type f | wc -l
```

Copiare inoltre in `local-deltas` gli script backend e la directory `backup/`
non versionati, dopo averne verificato i nomi con `git status --short`.

### 2. Arresto e separazione upload

```bash
sudo systemctl stop pastasciutta-backend.service
sudo install -d -o root -g root -m 0750 /var/lib/pastasciutta/uploads
sudo rsync -a --checksum /opt/pastasciutta/uploads/ \
  /var/lib/pastasciutta/uploads/

sudo find /opt/pastasciutta/uploads -type f | wc -l
sudo find /var/lib/pastasciutta/uploads -type f | wc -l
```

I due conteggi devono coincidere. Non cancellare ancora la vecchia directory.

### 3. Rendere aggiornabile il worktree

Con il backend fermo e il backup verificato:

1. spostare fuori dalla repo gli script e `backup/` non versionati gia copiati;
2. conservare `requirements.patch` e riconciliare manualmente le tre dipendenze;
3. ripristinare il solo `frontend/public/version.json`, che verra rigenerato;
4. rimuovere dalla vecchia directory runtime soltanto i file gia verificati nella
   nuova directory e nel backup;
5. controllare che `git status --short` non contenga dati non preservati.

Non sono forniti comandi distruttivi automatici per questa fase: ogni percorso
deve essere verificato a video prima di spostarlo o rimuoverlo.

### 4. Pull e configurazione

```bash
cd /opt/pastasciutta
sudo git pull --ff-only origin main
git rev-parse HEAD
```

Il commit deve coincidere con quello di rilascio approvato.

Aggiornare `/opt/pastasciutta/backend/.env` senza stampare i valori sensibili:

```dotenv
APP_ENV=production
ENABLE_API_DOCS=false
UPLOADS_DIR=/var/lib/pastasciutta/uploads
CORS_ALLOWED_ORIGINS=https://pasta-app.it,https://www.pasta-app.it
```

Ruotare `JWT_SECRET`, impostare password uniche con
`backend/scripts/manage_account.py`, poi:

```bash
sudo chown root:root /opt/pastasciutta/backend/.env
sudo chmod 0600 /opt/pastasciutta/backend/.env
```

Riconciliare e installare le dipendenze solo dopo aver confrontato la patch VPS
con il file del nuovo commit.

### 5. Build, bind locale, Nginx e firewall

```bash
cd /opt/pastasciutta/frontend
sudo npm run build
```

Nel servizio systemd impostare:

```ini
ExecStart=/opt/pastasciutta/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
```

Nel default server HTTP Nginx non fare proxy al backend: restituire `444` oppure
reindirizzare al dominio canonico. Conservare nel virtual host HTTPS gli header
WebSocket esistenti. Verificare prima di applicare:

```bash
sudo nginx -t
```

Firewall, mantenendo SSH prima dell'abilitazione:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw deny 8001/tcp
sudo ufw enable
sudo ufw status verbose
```

### 6. Avvio e verifica

```bash
sudo systemctl daemon-reload
sudo systemctl start pastasciutta-backend.service
sudo systemctl reload nginx
sudo systemctl status pastasciutta-backend.service --no-pager
sudo journalctl -u pastasciutta-backend.service -n 100 --no-pager
sudo ss -lntp
```

Da questo PC eseguire:

```powershell
python scripts/p0b_external_smoke.py `
  --expected-commit 35955354bc658e7e83ec54a520fb46a0b72f88a9
```

Completare poi gli smoke test autenticati del runbook: login dei ruoli, isolamento
tra locali, ordine e aggiornamento live, Report, permessi globali e upload firmati.

## Rollback

Se il backend non supera gli smoke test:

1. fermare il backend;
2. ripristinare codice, unit systemd e Nginx dal backup;
3. ricostruire il frontend precedente;
4. mantenere HTTPS, bind locale/firewall e nuove credenziali;
5. ripristinare MongoDB o upload soltanto in presenza di corruzione dimostrata;
6. riavviare, verificare e annotare esito e orario.

Il P0-A non prevede migrazioni distruttive del database. Un semplice errore
applicativo non giustifica un `mongorestore`, che potrebbe eliminare lavoro
prodotto dopo il backup.

## Esito atteso

- porte pubbliche: 22, 80 e 443 soltanto;
- Uvicorn su `127.0.0.1:8001`;
- IP diretto non espone l'app;
- docs, OpenAPI, seed e gestione pubblica locali non disponibili;
- WebSocket anonimo rifiutato e ticket monouso funzionante;
- upload fuori dalla repo e accessibili soltanto tramite autorizzazione;
- vecchie password e vecchi JWT inutilizzabili;
- applicazione e dati operativi invariati dopo gli smoke test.
