# Stato e runbook P0

Stato: P0-A completato e testato in locale; P0-B preparato, non ancora eseguito.

Questo runbook completa sulla VPS il contenimento P0 gia implementato nel codice.
Va eseguito in una finestra di manutenzione senza operatori collegati. Non salvare
password o `JWT_SECRET` nel repository, nei messaggi o nella shell history.

## P0-A completato nel codice il 16 luglio 2026

Queste modifiche sono presenti nel commit di rilascio, ma non diventano operative
sulla VPS fino al deploy P0-B:

- autorizzazioni backend centralizzate con controlli espliciti di ruolo, capability
  e locale effettivo;
- Federico resta `supervisor`: puo selezionare un locale e lavorare sui Report,
  ma non puo creare, modificare o cancellare configurazioni globali;
- creazione/modifica/cancellazione di prodotti, fornitori e configurazioni globali,
  oltre alle forzature di quantita, consentite soltanto ad Admin e Simone;
- rimossi dal runtime gli endpoint pubblici di seed e gestione locali, la summary
  Analisi inutilizzata, gli endpoint mock/snapshot distruttivi e le route bevande
  legacy non utilizzate;
- account privilegiati non piu creati, resettati o sovrascritti automaticamente
  all'avvio; aggiunto comando amministrativo offline `scripts/manage_account.py`;
- Swagger, Redoc e OpenAPI disattivati quando `APP_ENV=production`;
- CORS trasformato in allowlist configurabile e validata;
- WebSocket autenticato tramite ticket monouso a breve durata, legato a utente,
  tenant e sessione, con controllo Origin e rifiuto del riuso;
- upload spostabili fuori dalla repository tramite `UPLOADS_DIR`, download protetti
  da URL HMAC temporanee e controlli di autorizzazione;
- rimossi dalla repository 56 upload di test; il vecchio
  `uploads/backup_flaminio.txt` non viene piu scritto durante la creazione ordini;
- credenziali note rimosse dai file correnti e test convertiti a password effimere
  fornite tramite ambiente; la bonifica della cronologia Git resta separata;
- rate limit mantenuto attivo negli ambienti reali e disabilitabile esclusivamente
  con `APP_ENV=test` per eseguire le suite isolate;
- documentazione locale, configurazione Docker/native, setup e frontend aggiornati
  per i nuovi vincoli di sicurezza e per i ruoli effettivi.

### Evidenze di verifica P0-A

- 58 test backend standard superati; i 30 test con gate live restano intenzionalmente
  esclusi quando non viene configurato un ambiente esterno;
- 3 integrazioni MongoDB isolate superate;
- 108 test HTTP live superati su database locale isolato, inclusi autenticazione,
  multi-tenancy, Report/Cassa, magazzino, richieste merce, permessi e concorrenza
  del contatore ordini;
- prova mirata: un nuovo ordine Flaminio non ricrea `backup_flaminio.txt`;
- `compileall`, controllo F821, build React produzione, `git diff --check` e scansione
  delle credenziali note completati senza errori bloccanti;
- database, account, upload e processi usati dai test live eliminati al termine.

Il warning `python_multipart`/Starlette e il warning di compatibilita
Passlib/bcrypt osservati nei test non hanno causato fallimenti; vanno trattati nel
lavoro dipendenze P1 e non richiedono modifiche d'emergenza nel deploy P0.

## P0-B da eseguire sulla VPS

## Condizioni prima di iniziare

- branch `main` aggiornato e testato in locale;
- commit di rilascio identificato;
- accesso SSH funzionante in una seconda sessione;
- password manager pronto per credenziali uniche;
- spazio sufficiente per backup MongoDB e upload;
- percorso reale della repo e nome del servizio systemd verificati;
- Nginx HTTPS gia valido e certificato non in scadenza.

## 1. Finestra e fotografia iniziale

1. Avvisare i locali e terminare le operazioni aperte.
2. Annotare commit attuale, stato dei servizi, porte in ascolto e spazio disco.
3. Verificare che il worktree di produzione sia pulito prima del pull.
4. Salvare fuori dalla repo una copia protetta del file `.env` attuale.

Comandi di sola verifica:

```bash
cd /PERCORSO/REALE/REPO
git rev-parse HEAD
git status --short
sudo systemctl status NOME_SERVIZIO_BACKEND --no-pager
sudo ss -lntp
df -h
```

## 2. Backup prima del deploy

1. Eseguire `mongodump` in una directory datata e non pubblica.
2. Copiare integralmente la cartella upload runtime in una directory di backup.
3. Verificare che dump e copia non siano vuoti.
4. Conservare hash e permessi del backup; non inserirlo nella repo.

Obiettivo rollback dati: poter ripristinare database e allegati indipendentemente
dal codice. Il deploy P0-A non prevede migrazioni distruttive del database.

## 3. Separare gli upload dalla repo

Prima del `git pull`, copiare gli upload reali:

```bash
sudo install -d -m 0750 /var/lib/pastasciutta/uploads
sudo rsync -a /PERCORSO/REALE/REPO/uploads/ /var/lib/pastasciutta/uploads/
```

Dopo il pull, configurare nel file `backend/.env`:

```dotenv
APP_ENV=production
ENABLE_API_DOCS=false
UPLOADS_DIR=/var/lib/pastasciutta/uploads
CORS_ALLOWED_ORIGINS=https://pasta-app.it,https://www.pasta-app.it
```

Non cancellare la vecchia cartella finche download e upload non sono stati verificati.

## 4. Aggiornare il codice

1. Fermare il backend.
2. Eseguire il normale pull di `main` e installare dipendenze solo se cambiate.
3. Eseguire la build frontend.
4. Non avviare ancora il backend prima di aver completato configurazione e rotazioni.

Sequenza abituale, adattando servizio e percorsi reali:

```bash
sudo systemctl stop NOME_SERVIZIO_BACKEND
cd /PERCORSO/REALE/REPO
sudo git pull --ff-only origin main
cd frontend
sudo npm run build
```

## 5. Rotare credenziali e sessioni

1. Generare password uniche per Admin, Simone, Federico, Magazziniere e ogni locale.
2. Condividerle esclusivamente tramite password manager o canale concordato.
3. Aggiornarle una alla volta con il comando offline, dalla cartella `backend`:

```bash
source venv/bin/activate
python scripts/manage_account.py set-password --username NOME_ACCOUNT
```

4. Generare un nuovo `JWT_SECRET` robusto e inserirlo in `backend/.env`.
5. Non stampare il valore nei log. La rotazione invalida contemporaneamente tutti i JWT.
6. Conservare il vecchio secret solo nel backup protetto necessario al rollback e poi eliminarlo.

## 6. Chiudere l'esposizione di rete

1. Configurare Uvicorn su `127.0.0.1:8001`, mai `0.0.0.0`.
2. Bloccare la porta 8001 nel firewall/provider; MongoDB deve restare locale.
3. Lasciare esposti solo SSH secondo policy, HTTP 80 per redirect e HTTPS 443.
4. Configurare Nginx affinche HTTP reindirizzi sempre a HTTPS.
5. Conservare nel proxy gli header WebSocket `Upgrade` e `Connection`.
6. Verificare `X-Forwarded-Proto`, `X-Real-IP` e `Host` senza fidarsi di proxy esterni non autorizzati.

## 7. Avvio e controlli obbligatori

Avviare il backend e verificare prima localmente, poi dall'esterno:

```bash
sudo systemctl daemon-reload
sudo systemctl restart NOME_SERVIZIO_BACKEND
sudo systemctl restart nginx
sudo systemctl status NOME_SERVIZIO_BACKEND --no-pager
sudo journalctl -u NOME_SERVIZIO_BACKEND -n 100 --no-pager
```

Checklist:

- login valido per un locale, Federico, Admin e Simone;
- vecchie password rifiutate;
- tutte le sessioni precedenti disconnesse;
- selezione locale e isolamento tra due locali;
- creazione, modifica e cancellazione ordine con aggiornamento live;
- WebSocket anonimo o con ticket riutilizzato rifiutato;
- polling fallback funzionante se il WebSocket viene interrotto;
- Report live e storico Federico funzionanti;
- prodotti/fornitori mutabili solo da Admin e Simone;
- upload nuovo visibile tramite URL firmata;
- URL upload senza firma o scaduta restituisce 403;
- `/api/seed`, `/api/restaurants` e route mock restituiscono 404/405;
- `/docs`, `/redoc` e `/openapi.json` non disponibili in produzione;
- `http://pasta-app.it` reindirizza a HTTPS;
- porta 8001 e MongoDB non raggiungibili da Internet;
- nessun errore nuovo nei log durante lo smoke test.

## 8. Rollback

Usare rollback solo se lo smoke test blocca il lavoro:

1. fermare il backend;
2. ripristinare l'artefatto/commit precedente in un worktree pulito;
3. ricostruire il frontend precedente;
4. mantenere HTTPS, firewall e nuove credenziali anche durante il rollback;
5. ripristinare database o upload soltanto se una verifica dimostra una corruzione;
6. riavviare e ripetere lo smoke test minimo;
7. documentare motivo, orario e stato finale.

La pulizia della cronologia Git con `git-filter-repo` non fa parte della stessa
finestra di deploy: richiede freeze coordinato, backup, comunicazione a tutti i PC
e nuovi clone. Non eseguirla finche ogni agente e postazione non e pronto.
