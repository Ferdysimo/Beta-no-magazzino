# Memoria operativa - Rollout VPS

Data: 2026-07-20

Stato:

```text
procedura preparata
rollout non eseguito
servizio non installato
momento zero non scelto
Memoria non attiva
```

Questo runbook inizia dove termina `MEMORY_PHASE6_RUNBOOK.md`. Serve per
installare la Memoria come processo separato senza renderla necessaria al
backend.

Principio non negoziabile:

> La Memoria puo fallire senza trascinare con se l'applicazione.

## 1. Istruzioni per il Codex che assiste

Prima di eseguire comandi:

1. lavorare sul branch `main` aggiornato;
2. leggere questo file, `MEMORY_PHASE6_RUNBOOK.md`,
   `memory/security/P1_SECURITY_RUNBOOK.md` Fase 3 e il changelog recente;
3. verificare lo stato reale della VPS, senza assumere che coincida col
   preflight del 17 luglio;
4. procedere un blocco alla volta e mostrare l'esito all'utente;
5. non inserire password, URI completi o token in chat, repository, shell
   history o log;
6. non modificare il backend operativo per far funzionare la Memoria;
7. fermarsi a ogni gate `STOP` finche la condizione non e risolta;
8. non usare `git reset --hard`, `git clean`, `dropDatabase` o restore
   automatici.

Messaggio breve da dare al Codex di casa:

```text
Aggiorna main con pull --ff-only e leggi
memory/operational-memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md,
memory/operational-memory/MEMORY_PHASE6_RUNBOOK.md, la Fase 3 di
memory/security/P1_SECURITY_RUNBOOK.md e il changelog recente. Assistimi un checkpoint
alla volta. Non mostrare ne salvare credenziali. Non attivare la Memoria se
Mongo SCRAM, backup, dry-run o controlli ruoli non sono superati. Non rendere
mai il backend dipendente da pastasciutta-memory.
```

## 2. Cosa cambia e cosa non cambia

Vengono aggiunti:

- database Mongo separato `pastasciutta_memory`;
- utente Mongo sorgente con sola lettura su `pastasciutta`;
- utente Mongo con `readWrite` soltanto su `pastasciutta_memory`;
- utente Linux `pastasciutta-memory`;
- env root-only `/etc/pastasciutta/memory.env`;
- servizio separato `pastasciutta-memory.service`.

Non vengono modificati:

- logica ordini, Report, magazzino o reset;
- dati del database `pastasciutta`;
- dipendenze di avvio del backend;
- Nginx o frontend per attivare la Memoria.

Il servizio resta inizialmente disabilitato. Viene avviato manualmente prima in
dry-run e poi in raccolta osservata.

## 3. Condizioni iniziali

Usare una finestra tranquilla e tenere aperte due sessioni SSH. La creazione del
servizio non richiede downtime, ma l'eventuale abilitazione SCRAM comporta
restart di Mongo e backend e va trattata come intervento P1 separato.

Controllare:

```bash
cd /opt/pastasciutta
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
git rev-parse origin/main

sudo systemctl is-active pastasciutta-backend.service
sudo systemctl is-active mongod.service
sudo systemctl is-active nginx.service
df -h /
free -h
sudo ss -lntp
```

Risultato richiesto:

- worktree compreso e senza dati runtime non preservati;
- branch `main`;
- commit locale uguale a `origin/main`;
- backend, Mongo e Nginx attivi;
- Mongo in ascolto soltanto su localhost;
- spazio ampiamente superiore al limite Memoria configurato.

Se il worktree e sporco, il Codex deve classificare ogni file e preservare le
modifiche runtime prima del pull. Non pulire in massa.

## 4. Gate obbligatorio Mongo SCRAM

Il preflight del 17 luglio indicava MongoDB senza autenticazione. Verificare lo
stato corrente:

```bash
sudo grep -n -A3 -B1 'security:' /etc/mongod.conf || true
sudo grep -n 'authorization' /etc/mongod.conf || true
```

Verificare inoltre, senza stampare URI o password, che il backend usi una
connessione autenticata. Il Codex puo leggere come root il nome delle variabili
e redigere i valori, ma non deve mostrarli:

```bash
sudo /opt/pastasciutta/backend/venv/bin/python - <<'PY'
from pathlib import Path
from urllib.parse import urlsplit

path = Path("/opt/pastasciutta/backend/.env")
values = {}
for raw in path.read_text(encoding="utf-8").splitlines():
    if "=" not in raw or raw.lstrip().startswith("#"):
        continue
    key, value = raw.split("=", 1)
    values[key.strip()] = value.strip().strip("\"'")
uri = values.get("MONGO_URL", "")
parts = urlsplit(uri)
print({
    "mongo_url_present": bool(uri),
    "credentials_present": bool(parts.username and parts.password),
    "host": parts.hostname,
    "database": (parts.path or "").lstrip("/"),
    "db_name": values.get("DB_NAME"),
})
PY
```

### Gate SCRAM

Procedere soltanto se:

- `/etc/mongod.conf` contiene `security.authorization: enabled`;
- il backend possiede un utente `readWrite` limitato a `pastasciutta`;
- una connessione anonima viene rifiutata;
- backend e task offline funzionano con l'URI autenticato.

`STOP`: se SCRAM non e attivo, non impostare
`MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=true` come scorciatoia. Eseguire prima la
Fase 3 di `memory/security/P1_SECURITY_RUNBOOK.md` in una finestra di
manutenzione, verificando
backup, utente amministrativo offline, utente backend, utente backup,
riavvio Mongo e smoke test applicativo. Tornare qui solo a P1 Fase 3 conclusa.

## 5. Aggiornamento applicativo classico

Dopo aver verificato e preservato il worktree:

```bash
cd /opt/pastasciutta
sudo git pull --ff-only origin main

cd /opt/pastasciutta/frontend
sudo yarn install --frozen-lockfile
sudo npm run build

cd /opt/pastasciutta/backend
sudo ./venv/bin/python -m compileall -q app memory_worker
sudo systemctl restart pastasciutta-backend.service
sudo systemctl status pastasciutta-backend.service --no-pager
sudo journalctl -u pastasciutta-backend.service -n 100 --no-pager
```

Eseguire gli smoke test applicativi abituali prima di installare il worker:

- login Admin e un locale;
- creazione/lettura ordini senza dati di prova;
- apertura Report, magazzino e Laboratorio;
- nessun nuovo errore backend o browser.

`STOP`: se l'aggiornamento classico non e sano, risolvere o fare rollback
applicativo. Non installare la Memoria per compensare un problema del backend.

## 6. Backup e fotografia pre-Memoria

Creare una directory root-only e salvare stato, configurazioni e dump del
database operativo. Non copiare il backup nella repository.

```bash
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="/var/backups/pastasciutta/memory-${stamp}"
sudo install -d -o root -g root -m 0700 "${backup_root}"

cd /opt/pastasciutta
git rev-parse HEAD | sudo tee "${backup_root}/git-head.txt" >/dev/null
git status --short | sudo tee "${backup_root}/git-status.txt" >/dev/null
sudo cp -a /etc/mongod.conf "${backup_root}/mongod.conf"
sudo cp -a /opt/pastasciutta/backend/.env "${backup_root}/backend.env"
sudo cp -a /etc/systemd/system/pastasciutta-backend.service \
  "${backup_root}/"
```

Se SCRAM e attivo, eseguire `mongodump` con l'utente backup dedicato e password
richiesta interattivamente. Sostituire soltanto il nome utente:

```bash
sudo mongodump \
  --host 127.0.0.1 \
  --port 27017 \
  --username '<MONGO_BACKUP_USER>' \
  --authenticationDatabase admin \
  --password \
  --db pastasciutta \
  --archive="${backup_root}/pastasciutta.archive.gz" \
  --gzip

sudo test -s "${backup_root}/pastasciutta.archive.gz"
sudo sha256sum "${backup_root}/pastasciutta.archive.gz" | \
  sudo tee "${backup_root}/SHA256SUMS" >/dev/null
sudo ls -lah "${backup_root}"
```

La password deve essere inserita nel prompt, non nella riga di comando.

## 7. Utenti Mongo dedicati

Questa fase usa l'account amministrativo Mongo conservato offline. Il Codex deve
far inserire le password tramite prompt o password manager e non deve riceverle
in chat.

Creare:

```text
memory_source_user
  ruolo: read
  database: pastasciutta

memory_store_user
  ruolo: readWrite
  database: pastasciutta_memory
```

Usare `mongosh` autenticato come amministratore. Nel database corretto eseguire
`db.createUser(...)` o, se l'utente esiste, ispezionarlo e usare
`db.updateUser(...)` solo dopo conferma. Le password devono essere richieste con
`passwordPrompt()`.

Esempio sorgente:

```javascript
use pastasciutta
db.createUser({
  user: "memory_source_user",
  pwd: passwordPrompt(),
  roles: [{role: "read", db: "pastasciutta"}]
})
```

Esempio destinazione:

```javascript
use pastasciutta_memory
db.createUser({
  user: "memory_store_user",
  pwd: passwordPrompt(),
  roles: [{role: "readWrite", db: "pastasciutta_memory"}]
})
```

Verificare con `usersInfo` che non esistano ruoli su `admin`, `local`, `config`
o altri database. Non concedere `dbAdmin`, `readWriteAnyDatabase`, `root` o
ruoli cluster al worker.

## 8. Utente Linux, env e unit systemd

Creare l'utente di servizio senza login:

```bash
if ! getent passwd pastasciutta-memory >/dev/null; then
  sudo useradd \
    --system \
    --user-group \
    --home-dir /var/lib/pastasciutta-memory \
    --create-home \
    --shell /usr/sbin/nologin \
    pastasciutta-memory
fi

sudo install -d \
  -o root \
  -g pastasciutta-memory \
  -m 0750 \
  /etc/pastasciutta
```

Installare il template env e modificarlo fuori dalla repository:

```bash
cd /opt/pastasciutta
sudo install \
  -o root \
  -g pastasciutta-memory \
  -m 0640 \
  deploy/memory.env.example \
  /etc/pastasciutta/memory.env

sudoedit /etc/pastasciutta/memory.env
```

Nel file:

- lasciare `MEMORY_ENABLED=true`;
- lasciare `MEMORY_DRY_RUN=true`;
- lasciare `MEMORY_WRITE_ENABLED=false`;
- lasciare vuoto `MEMORY_ACTIVATION_EPOCH_UTC`;
- inserire URI Mongo con password URL-encoded e database esplicito nel path;
- lasciare `MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=false`;
- mantenere inizialmente tutti i limiti del template.

Controllare i permessi senza mostrare il contenuto:

```bash
sudo stat -c '%U %G %a %n' /etc/pastasciutta/memory.env
```

Risultato richiesto:

```text
root pastasciutta-memory 640 /etc/pastasciutta/memory.env
```

Installare l'unit ancora spenta:

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  deploy/pastasciutta-memory.service.example \
  /etc/systemd/system/pastasciutta-memory.service

sudo systemctl daemon-reload
sudo systemctl disable --now pastasciutta-memory.service
sudo systemd-analyze verify \
  /etc/systemd/system/pastasciutta-memory.service
```

Il backend non deve contenere `Requires=` o `Wants=` verso la Memoria:

```bash
sudo systemctl cat pastasciutta-backend.service
sudo systemctl list-dependencies pastasciutta-backend.service
```

## 9. Preflight manuale read-only

Eseguire il comando come utente di servizio, caricando l'env protetto:

```bash
sudo -u pastasciutta-memory bash -c '
  set -a
  source /etc/pastasciutta/memory.env
  set +a
  exec /opt/pastasciutta/backend/venv/bin/python -m memory_worker status
'

sudo -u pastasciutta-memory bash -c '
  set -a
  source /etc/pastasciutta/memory.env
  set +a
  exec /opt/pastasciutta/backend/venv/bin/python -m memory_worker preflight
'
```

Il risultato richiesto contiene:

- `writes_performed: 0`;
- credenziale sorgente autenticata e non `write_capable`;
- nessun ruolo sorgente non classificato;
- credenziale destinazione autenticata e `write_capable`;
- nessuna password o URI completo;
- eventuali collection mancanti comprese e classificate.

`STOP` in presenza di:

- sorgente con scrittura;
- ruoli non visibili o ambigui;
- sorgente e destinazione con lo stesso database;
- autenticazione fallita;
- latenza o connessione instabile;
- qualsiasi segreto nell'output.

Verificare che il preflight non abbia creato il database Memoria:

```bash
sudo mongosh \
  --host 127.0.0.1 \
  --username '<MONGO_ADMIN_USER>' \
  --authenticationDatabase admin \
  --password \
  --quiet \
  --eval 'db.adminCommand({listDatabases:1,nameOnly:true}).databases.map(x=>x.name)'
```

`pastasciutta_memory` puo comparire perche contiene gia l'utente Mongo, ma non
deve contenere collection o dati del worker.

## 10. Dry-run sotto systemd

Avviare manualmente il servizio, senza abilitarlo al boot:

```bash
sudo systemctl start pastasciutta-memory.service
sleep 70
sudo systemctl status pastasciutta-memory.service --no-pager
sudo journalctl -u pastasciutta-memory.service -n 100 --no-pager
sudo systemctl is-enabled pastasciutta-memory.service
```

Risultato richiesto:

- servizio `active (running)`;
- log `memory_cycle_ok mode=dry_run`;
- nessun `memory_cycle_failed`;
- servizio ancora `disabled`;
- backend, login e flussi operativi invariati.

Osservare almeno alcuni cicli:

```bash
sudo journalctl -u pastasciutta-memory.service -f
```

Interrompere il follow con `Ctrl+C`, poi fermare il servizio:

```bash
sudo systemctl stop pastasciutta-memory.service
```

## 11. Scelta del momento zero

Il momento zero e il primo istante ufficiale della Memoria. Non viene eseguito
backfill precedente.

Sceglierlo:

- dopo dry-run riuscito;
- preferibilmente dopo il reset notturno e prima dell'inizio del servizio;
- quando backend e Mongo sono sani;
- una sola volta.

Ricavare l'istante UTC soltanto al momento dell'attivazione:

```bash
date -u +'%Y-%m-%dT%H:%M:%SZ'
```

Con `sudoedit /etc/pastasciutta/memory.env` impostare:

```text
MEMORY_DRY_RUN=false
MEMORY_WRITE_ENABLED=true
MEMORY_ACTIVATION_EPOCH_UTC=<ISTANTE_UTC_SCELTO>
```

Non cambiare l'epoch dopo la prima scrittura. Il worker rifiuta un epoch diverso
se ne esiste gia uno attivo.

## 12. Prima raccolta osservata

Avviare manualmente, ancora senza `enable`:

```bash
sudo systemctl start pastasciutta-memory.service
sleep 90
sudo systemctl status pastasciutta-memory.service --no-pager
sudo journalctl -u pastasciutta-memory.service -n 200 --no-pager
sudo systemctl is-active pastasciutta-backend.service
```

Verificare lo stato del processo:

```bash
sudo systemctl show pastasciutta-memory.service \
  -p ActiveState \
  -p SubState \
  -p MemoryCurrent \
  -p CPUUsageNSec \
  -p NRestarts
```

Verificare il database con l'utente destinazione, senza stampare l'URI:

```bash
sudo -u pastasciutta-memory bash -c '
  set -a
  source /etc/pastasciutta/memory.env
  set +a
  exec mongosh "$MEMORY_MONGO_URL" --quiet --eval "
    printjson({
      collections: db.getCollectionNames().sort(),
      epochs: db.memory_epochs.countDocuments({}),
      watermarks: db.memory_watermarks.countDocuments({}),
      raw_versions: db.memory_raw_versions.countDocuments({}),
      annotation_rule: db.memory_configuration_versions.countDocuments({
        fact_kind: \"memory_rule_state\",
        rule_kind: \"annotation_semantics\",
        ruleset_version: 2
      }),
      learned_annotation_aliases: db.memory_configuration_versions.countDocuments({
        fact_kind: \"pasta_annotation_alias_state\",
        present: true
      }),
      parsed_annotations: db.memory_order_facts.countDocuments({
        \"pasta_annotation.parser_version\": 3
      }),
      quarantine: db.memory_quarantine.countDocuments({}),
      storage: db.stats().storageSize + db.stats().indexSize
    })
  "
'
```

Risultato minimo:

- un epoch attivo;
- watermark presenti;
- collezioni Memoria create;
- una regola `annotation_semantics` con `ruleset_version: 2`;
- `learned_annotation_aliases` coerente con gli alias confermati presenti
  nell'applicazione, anche zero se Simone non ha ancora registrato decisioni;
- `parsed_annotations` maggiore di zero appena viene acquisita almeno una pasta
  riconosciuta dopo il momento zero;
- `quarantine` compresa e senza crescita anomala;
- nessun errore ripetuto nei log;
- backend e Mongo senza rallentamenti percepibili.

Il primo giorno puo non avere ancora snapshot: finche non esiste una giornata
chiusa successiva all'epoch, il runner registra uno skip innocuo.

## 13. Osservazione per 24-48 ore

Lasciare il servizio avviato ma disabilitato al boot. Controllare almeno mattina
e sera:

```bash
sudo systemctl status pastasciutta-memory.service --no-pager
sudo journalctl -u pastasciutta-memory.service --since '12 hours ago' \
  --no-pager
sudo journalctl -u pastasciutta-backend.service --since '12 hours ago' \
  --no-pager
sudo systemctl show pastasciutta-memory.service \
  -p MemoryCurrent \
  -p CPUUsageNSec \
  -p NRestarts
df -h /
```

Controllare:

- cicli riusciti e backoff assente o spiegato;
- watermark in avanzamento;
- primo snapshot `complete` oppure gap `partial` spiegati;
- quarantena stabile;
- storage ben sotto `MEMORY_MAX_STORAGE_MB`;
- nessun aumento anomalo di latenza o errori del backend;
- nessun dato modificato nel database sorgente.

Se il worker viene fermato, alla ripresa recupera dai watermark e completa una
giornata snapshot mancante per intervallo.

## 14. Abilitazione definitiva

Soltanto dopo 24-48 ore sane:

```bash
sudo systemctl enable pastasciutta-memory.service
sudo systemctl is-enabled pastasciutta-memory.service
sudo systemctl is-active pastasciutta-memory.service
```

Aggiornare changelog e runbook con:

- data e ora dell'epoch;
- commit distribuito;
- esito dry-run;
- metriche osservate;
- eventuali gap iniziali;
- stato finale del servizio.

Non inserire credenziali o URI.

## 15. Arresto, rollback e incidenti

Arresto immediato:

```bash
sudo systemctl stop pastasciutta-memory.service
sudo systemctl disable pastasciutta-memory.service
```

Poi verificare:

```bash
sudo systemctl is-active pastasciutta-backend.service
sudo journalctl -u pastasciutta-backend.service -n 100 --no-pager
```

Il backend non deve essere riavviato per fermare la Memoria.

In caso di errore:

1. fermare e disabilitare soltanto `pastasciutta-memory`;
2. conservare env, log e database Memoria per diagnosi;
3. non fare restore di `pastasciutta` senza corruzione dimostrata;
4. non cambiare epoch per nascondere un errore;
5. correggere il worker offline e riprendere dallo stesso epoch;
6. rimuovere unit/env/database soltanto con decisione esplicita del titolare.

Se la Memoria rallenta l'app, si spegne la Memoria. Non si alzano i limiti per
farla continuare.

## 16. Criteri di completamento

Il rollout e concluso solo quando:

- SCRAM e least privilege sono verificati;
- backup e checksum esistono;
- dry-run ha eseguito piu cicli senza scritture;
- epoch e stato scelto una volta;
- prima raccolta, watermark e quarantena sono verificati;
- almeno una giornata chiusa ha snapshot o gap spiegati;
- 24-48 ore non mostrano impatto sul backend;
- servizio e abilitato soltanto dopo l'osservazione;
- changelog non contiene segreti e riporta l'esito reale.
