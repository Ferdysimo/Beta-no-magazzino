# Piano P1 sicurezza - versione approvata

Data approvazione: 2026-07-19
Stato: approvato; rollout ordinato delle fasi non avviato. La revoca mirata
dell'account Admin applicata il 6 agosto 2026 e una misura isolata e non
equivale al completamento della Fase 4 generale.

Questo documento e la fonte operativa per il P1 di sicurezza. Se entra in
conflitto con il perimetro P1 storico in `SECURITY_HARDENING_PLAN.md`, prevale
questo runbook. La Fase 0 deve riallineare il documento generale prima di
qualsiasi modifica applicativa o alla produzione.

## Obiettivo

Rendere l'applicazione piu sicura senza modificarne la logica operativa o
l'esperienza normale degli utenti.

## Decisioni vincolanti

- Gli account dei ristoranti restano separati.
- I ristoranti possono continuare a condividere la stessa password.
- Per cambiare locale un utente esegue logout e accede con l'altro account.
- Gli account `restaurant` non ricevono un selettore dei locali.
- MFA non fa parte del P1.
- Il logout ordinario resta locale alla singola scheda.
- `token_version` serve esclusivamente alla revoca globale dell'account.
- La durata JWT resta sette giorni; il rischio residuo e documentato.
- Un WebSocket gia aperto non viene chiuso in P1; i nuovi ticket sono revocabili.
- Uvicorn resta a un solo worker finche ticket e manager WS sono in memoria.
- Nessun upgrade Python o aggiornamento generale delle dipendenze entra nel P1.
- In produzione si applica una sola fase alla volta, seguita da almeno 48 ore
  di osservazione prima della fase successiva.

## Fase 0 - Contratto, documentazione e clone

Deliverable:

- aggiornare `SECURITY_HARDENING_PLAN.md` rimuovendo dal perimetro P1
  auth sessions complete, MFA obbligatoria, password uniche per i ristoranti e
  revoca immediata dei WebSocket gia aperti;
- creare `ROLE_MATRIX.md` per tutti gli account, ruoli e capability;
- creare `ENDPOINT_TENANT_AUDIT.md` con ogni ID o `restaurant_id` ricevuto da
  body, query e path;
- verificare autorizzazioni backend deny-by-default e isolamento tenant;
- documentare no MFA, password condivise e rischio JWT di sette giorni;
- documentare il vincolo del singolo worker Uvicorn;
- ampliare i test multi-tenancy e aggiungere un E2E browser multi-tab con
  backend e Mongo isolati;
- preparare un clone con secret, database, upload e path separati dalla
  produzione.

La Fase 0 non modifica la VPS di produzione.

## Fase 1 - Backup off-site e restore

- Eseguire backup cifrati di MongoDB, upload e configurazioni indispensabili.
- Conservare i backup fuori dalla VPS.
- Conservare separatamente una chiave di recupero verificata.
- Inviare un alert reale in caso di fallimento.
- Definire la retention dopo aver misurato dimensioni e tempi.
- Usare come obiettivo iniziale RPO massimo di un'ora e RTO massimo di
  quattro ore.
- Eseguire e documentare un restore completo sul clone.

Non procedere alla Fase 2 finche il restore non e riuscito.

## Fase 2 - Release atomiche e backend non-root

Layout:

```text
/opt/pastasciutta/
  releases/<release>/
    backend/
    frontend/build/
    venv/
  current -> releases/<release>

/etc/pastasciutta/
  backend.env
  google_credentials.json

/var/lib/pastasciutta/
  uploads/
  runtime/
  quarantine/
```

Regole:

- ogni release possiede il proprio virtualenv;
- codice, build e virtualenv sono `root:root` e non scrivibili dal backend;
- configurazioni sensibili sono `root:pastasciutta` con permessi `0640`;
- solo runtime, upload e quarantena sono scrivibili dal servizio;
- systemd usa `current/backend` e `current/venv`;
- Nginx usa `current/frontend/build`;
- lo switch crea `current.next` e lo sostituisce con `mv -Tf`;
- non si avvia una seconda istanza completa contro Mongo produzione, per non
  duplicare scheduler, startup task o reset;
- il servizio usa `NoNewPrivileges=yes`, `ProtectSystem=strict`,
  `ProtectHome=yes`, `PrivateTmp=yes`, `UMask=0027` e `ReadWritePaths`
  limitati alle directory runtime;
- il rollback ripristina insieme codice, frontend e dipendenze.

Prima della migrazione vanno inventariati gli script che oggi caricano
`backend/.env`, affinche continuino a ricevere l'environment esterno senza
reintrodurre copie di segreti dentro le release.

## Fase 3 - MongoDB SCRAM

- Creare un utente amministrativo conservato offline.
- Creare un utente applicativo con `readWrite` solo sul database
  `pastasciutta`.
- Creare un utente backup dedicato con ruolo MongoDB `backup`.
- Mantenere MongoDB vincolato a localhost.
- Usare un solo `EnvironmentFile` esterno alle release.
- Provare l'URI autenticato mentre l'autorizzazione Mongo e ancora spenta.
- Riavviare e verificare il backend con quell'URI.
- Solo dopo abilitare l'autorizzazione MongoDB e riavviare `mongod`.
- Verificare che le connessioni anonime siano rifiutate.
- Il rollback ordinario non deve disabilitare MongoDB auth.

## Fase 4 - Revoca account e WebSocket

- Eseguire un backfill idempotente di `token_version`.
- Usare versione `1` se assente, preservando Simone almeno alla versione `2`.
- Rendere asincrona `verify_token` e leggere l'account da `db.restaurants`.
- Accettare il token solo se la versione JWT e uguale alla versione account.
- Verificare che l'account esista e non sia disabilitato.
- Non introdurre inizialmente una cache: MongoDB e locale e la revoca deve
  essere deterministica. Misurare prima di ottimizzare.
- Incrementare `token_version` su cambio password, cambio ruolo,
  disattivazione e `logout-all`.
- Lasciare invariato il logout ordinario della singola scheda.
- Aggiungere `POST /api/auth/logout-all` per la revoca globale dell'account.
- Inserire nel ticket WS account autenticato, tenant effettivo e versione.
- Al consumo del ticket ricontrollare account e versione su MongoDB.
- Accettare e documentare che un WS gia connesso resta aperto fino alla
  disconnessione naturale.

## Fase 5 - Audit sicurezza minimo

Registrare, senza password, JWT, cookie o payload sensibili:

- login riusciti e falliti;
- cambio password, ruolo e stato account;
- `logout-all`;
- uso dell'impersonazione;
- rifiuti rilevanti per tenant o ruolo.

Il log deve essere append-only e minimale. L'audit operativo generale e la sua
interfaccia restano fuori da questo P1.

## Fase 6 - Input, Excel e upload

Procedere per dominio e con release indipendenti:

- introdurre schemi Pydantic strict, `extra=forbid`, enum, lunghezze e
  intervalli;
- eseguire smoke frontend completo dopo ogni gruppo;
- neutralizzare negli Excel solo il testo non fidato;
- non modificare le formule generate internamente;
- verificare magic byte, MIME, byte e pixel degli upload;
- consentire solo formati gia realmente usati dall'app;
- rifiutare immagini estreme prima della decodifica completa;
- provare il re-encoding su DDT reali senza ridurne la leggibilita;
- introdurre quote e quarantena solo dopo aver definito errori, retention e
  procedura di pulizia.

## Fase 7 - Nginx e CI

- Aggiungere `nosniff`, Referrer-Policy, protezione frame e una
  Permissions-Policy minima.
- Introdurre HSTS inizialmente con durata breve e senza preload o
  `includeSubDomains`.
- Separare timeout HTTP e WebSocket solo dopo benchmark degli export.
- Eseguire automaticamente test backend e frontend.
- Attivare secret scanning e push protection per i nuovi segreti.
- Creare una baseline delle vulnerabilita esistenti.
- Bloccare nuove vulnerabilita critical/high, non l'intera baseline storica.
- Mantenere CodeQL informativo in P1 e renderlo bloccante solo dopo la
  riduzione dei finding.

## P0-C - Cronologia Git

La bonifica della cronologia e un progetto separato. Richiede inventario dei
segreti, backup mirror, freeze di tutti i clone, `git-filter-repo`, force-push
controllato e nuovi clone. Non va mescolata con MongoDB, systemd o auth.

## Condizioni di uscita P1

P1 e concluso solo quando:

- matrice ruoli/tenant e test IDOR passano;
- un restore completo da backup e riuscito;
- il backend non gira come root e non puo modificare il proprio codice;
- il rollback ripristina insieme backend, frontend e dipendenze;
- MongoDB rifiuta connessioni anonime;
- password, ruolo, disattivazione e `logout-all` revocano i JWT;
- un ticket WS emesso prima della revoca non puo essere consumato dopo;
- input e upload ostili vengono rifiutati;
- la CI impedisce nuove regressioni gravi;
- i flussi operativi e l'esperienza utente normale sono invariati.

## Test minimi comuni alle release

- servizi e porte nello stato previsto;
- login per tutti i sette account noti;
- matrice ruoli, capability e tenant;
- flusso Cassa -> Bollitore -> Generale -> Report;
- Cassa, Bevande, Magazzino, DDT e upload reali;
- export Excel mensile e annuale;
- WebSocket, ticket monouso, polling fallback e riconnessione;
- reset notturno e recovery;
- nessun nuovo errore 5xx nei log;
- rollback provato, non soltanto documentato.
