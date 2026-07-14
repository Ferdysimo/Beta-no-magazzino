# Piano di sicurezza applicazione

Ultimo aggiornamento: 2026-07-14
Stato: audit iniziale completato, interventi non ancora applicati
Riferimento: OWASP ASVS 5.0 livello 2, con controlli rafforzati per gli account privilegiati

## Regole operative

- Questo documento e la fonte condivisa del lavoro di sicurezza tra i vari Codex.
- Non inserire mai password, token, chiavi o documenti operativi nel repository.
- Prima di ogni intervento: pull del branch, lettura di questo file e del changelog, verifica del worktree e backup dei dati coinvolti.
- Ogni fase deve avere test isolati, verifica in locale, voce nel changelog e procedura di rollback.
- Gli interventi P0 vanno completati prima di nuove funzionalita non urgenti.

## Fotografia dell'audit del 14 luglio 2026

- Analizzati repository, 118 endpoint applicativi, autenticazione, autorizzazioni, isolamento tra locali, WebSocket, upload, dipendenze, frontend, configurazione VPS, logging e backup.
- Otto route applicative risultano prive di autenticazione, incluso il WebSocket.
- Il repository remoto risulta pubblico e contiene 56 file versionati nella cartella `uploads/`, tra cui documenti operativi.
- La VPS risponde in HTTP; HTTPS non risulta attivo e Uvicorn e raggiungibile direttamente sulla porta 8001.
- L'elenco account, la documentazione OpenAPI e un file di backup ordini risultano accessibili senza login.
- Sono presenti credenziali cablate nel codice e nella cronologia Git. Non riportarle in questo documento: devono essere considerate compromesse e ruotate.
- JWT validi per sette giorni, senza revoca generale dopo logout, cambio password, eliminazione o cambio ruolo.
- WebSocket privo di autenticazione, controllo del tenant, validazione Origin e limiti di connessione/messaggio.
- Operazioni globali su prodotti e fornitori accessibili a qualunque account autenticato; presenti inoltre endpoint legacy bevande non necessari.
- Presenti endpoint di test/mock capaci di generare o sovrascrivere dati storici.
- Upload basati sull'header base64, senza verifica MIME reale, limite decodificato, controllo dimensioni, re-encoding o scansione.
- Backend configurato come root e in ascolto su `0.0.0.0`; MongoDB senza autenticazione applicativa nella configurazione documentata.
- Audit dipendenze grezzo: Yarn 2 critical, 102 high, 94 moderate e 17 low; pip-audit 87 advisory in 20 pacchetti su 141. I risultati richiedono verifica di raggiungibilita e aggiornamenti coordinati.
- Nessuna pipeline CI GitHub, secret scanning, SAST, dependency gate o deploy con rollback automatico.
- Backup manuali e diagnostica volatile in memoria, persa al riavvio.

## P0 - Contenimento immediato

Obiettivo: chiudere le esposizioni gia attive prima di procedere con hardening evoluto.

1. Aprire un registro incidente, conservare log ed evidenze, inventariare i file esposti e calcolarne gli hash senza aprirli inutilmente.
2. Rendere immediatamente privato il repository e disabilitare la funzione template.
3. Chiudere la porta 8001 su Internet, vincolare Uvicorn a `127.0.0.1` e consentire l'accesso al backend solo tramite Nginx.
4. Attivare HTTPS valido, redirect HTTP verso HTTPS e WSS per i WebSocket.
5. Disabilitare gli endpoint pubblici di seed e creazione/elenco locali; trasformare il seed in comando amministrativo offline e una-tantum.
6. Disabilitare Swagger/OpenAPI in produzione o proteggerli con accesso amministrativo.
7. Autenticare il WebSocket prima di `accept`, derivare il locale dalla sessione, rifiutare tenant discordanti e validare `Origin` con allowlist.
8. Rendere privati tutti gli upload, spostarli fuori dal webroot e verificare proprietario/ruolo a ogni download.
9. Eliminare il backup ordini su file pubblico e interrompere la scrittura in `uploads/backup_flaminio.txt`.
10. Rimuovere dal runtime tutti gli endpoint mock, snapshot di test e reset distruttivi non necessari.
11. Bloccare subito le modifiche globali a prodotti, quantita e fornitori per i ruoli non autorizzati; rimuovere gli endpoint legacy bevande non utilizzati.
12. Ruotare tutte le password esposte, assegnare credenziali uniche, cambiare `JWT_SECRET` e invalidare tutte le sessioni correnti.
13. Dopo aver coordinato tutti i PC e conservato le evidenze, eliminare credenziali e documenti da branch, tag e cronologia con `git-filter-repo`; richiedere clone puliti per evitare reintroduzioni.
14. Valutare formalmente con titolare/DPO l'eventuale data breach e documentare motivazione, rischio, misure e decisione sulla notifica.

### Uscita P0

- Dall'esterno sono raggiungibili solo HTTPS e gli accessi amministrativi esplicitamente consentiti.
- HTTP reindirizza a HTTPS; 8001 e MongoDB non sono raggiungibili pubblicamente.
- Utente anonimo puo usare soltanto gli endpoint pubblici realmente necessari, tipicamente login e controllo versione minimo.
- WebSocket anonimo o con tenant differente viene rifiutato.
- Nessun upload o documento operativo e presente nel repository o scaricabile senza autorizzazione.
- Tutte le vecchie credenziali e tutti i JWT precedenti sono inutilizzabili.
- Seed, mock e funzioni di test non compaiono nell'OpenAPI di produzione.

## P1 - Identita, autorizzazioni e infrastruttura

1. Centralizzare autorizzazioni e tenant con dipendenze `require_role`, `require_capability` e `resolve_tenant`, applicando deny-by-default.
2. Sostituire i privilegi basati sui nomi utente con capability memorizzate e validate server-side.
3. Creare una matrice automatica per anonimo, locale A, locale B, magazziniere, supervisore, admin e amministratore proprietario su tutti gli endpoint e gli ID.
4. Validare sempre l'esistenza e il ruolo del locale impersonato e registrare ogni inizio/fine impersonazione.
5. Introdurre sessioni server-side revocabili, access token brevi, timeout idle/assoluto, logout reale e revoca dopo cambio password, ruolo o disattivazione account.
6. Introdurre MFA per gli account privilegiati e riautenticazione per operazioni distruttive o molto sensibili.
7. Migrare progressivamente le password ad Argon2id, usare password uniche, controllo password compromesse e protezione contro enumeration e brute force.
8. Correggere il rate limiting dietro proxy fidato, combinando IP reale, account e tipo di operazione; aggiungere limiti a login, export, upload, WebSocket e mutazioni.
9. Definire schemi Pydantic strict con `extra=forbid`, lunghezze, intervalli, enum, limiti a liste/dizionari e messaggi 4xx coerenti.
10. Neutralizzare formula injection negli Excel e sostituire regex controllate dall'utente con ricerche escaped o indicizzate.
11. Implementare upload con magic-byte, MIME allowlist, dimensioni byte/pixel, re-encoding Pillow, quota, antivirus/quarantena e nomi casuali completi.
12. Eseguire FastAPI con utente Linux dedicato e hardening systemd: `NoNewPrivileges`, `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `UMask` e capability minime.
13. Abilitare autenticazione MongoDB/SCRAM, utente applicativo least-privilege, bind locale, permessi file restrittivi e backup cifrati.
14. Ridurre `requirements.txt` al runtime reale, separare test/dev, aggiornare stack Python e migrare il frontend fuori da Create React App.
15. Aggiungere CI con test, secret scanning, CodeQL/SAST, dependency review, audit lockfile, SBOM e blocco merge sulle criticita.
16. Automatizzare backup MongoDB e uploads cifrati e off-site; obiettivo iniziale RPO 1 ora e RTO 4 ore, da confermare con il titolare.

### Uscita P1

- La matrice autorizzativa e i test IDOR passano su tutti gli endpoint e tutte le transizioni di ruolo/tenant.
- Logout, cambio password, cambio ruolo e disattivazione revocano immediatamente sessioni HTTP e WebSocket.
- MFA attiva sugli account privilegiati.
- MongoDB e processo backend operano con least privilege.
- Nessuna criticita runtime critical/high resta senza correzione o accettazione del rischio documentata.
- Un ripristino completo da backup e stato provato su ambiente isolato.

## P2 - Difesa in profondita e integrita operativa

1. Rimuovere `Function()`/`eval` e usare un parser aritmetico; sostituire il sanitizzatore HTML artigianale con dati strutturati o libreria mantenuta.
2. Applicare CSP rigorosa senza `unsafe-eval`, HSTS, `frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy e cache `no-store` per dati sensibili.
3. Self-host di font e immagini operative; eliminare dipendenze esterne non necessarie e definire una CORS allowlist minima.
4. Aggiungere limiti globali di body, timeout, connessioni, concorrenza e memoria; spostare export pesanti su job controllati.
5. Rendere atomiche/idempotenti evasione merce, aggiornamenti stock, reset notturno, archiviazione e scritture file+database.
6. Aggiungere audit append-only per login, logout, sessioni, account, impersonazione, download, prodotti, fornitori, documenti e modifiche admin.
7. Centralizzare log e alert su login falliti, 401/403, errori 5xx, spazio disco, modifiche privilegiate, upload e anomalie WebSocket; non registrare token o password.
8. Definire classificazione dati, proprietario, retention, cifratura, cancellazione e procedura di risposta agli incidenti.
9. Sostituire il deploy `git pull + build` con artefatto CI verificato, backup pre-deploy, health gate e rollback ripetibile.

### Uscita P2

- CSP applicata senza eccezioni per eval/inline non motivate.
- Test DAST e upload ostili senza finding high/critical.
- Operazioni multi-documento resistono a richieste concorrenti, retry e crash simulati.
- Alert di sicurezza e restore drill verificati e documentati.

## P3 - Verifica continuativa

1. Tracciare i requisiti OWASP ASVS 5.0 livello 2 con evidenza di test per ogni requisito applicabile.
2. Eseguire penetration test esterno dopo P0-P2 e dopo modifiche importanti ad autenticazione o infrastruttura.
3. Programmare patch mensili, rotazione periodica segreti, scansioni dipendenze e revisione trimestrale dei permessi.
4. Eseguire almeno annualmente tabletop incident response e prova completa di disaster recovery.
5. Riesaminare threat model e inventario endpoint a ogni nuova funzione, locale, ruolo o integrazione esterna.

## Ordine di implementazione consigliato

1. Release contenimento P0 con finestra di manutenzione e logout globale.
2. Release autorizzazioni/sessioni P1 con matrice completa dei ruoli.
3. Release upload, infrastruttura, dipendenze, CI e backup.
4. Release CSP, integrita transazionale, logging e deploy controllato.
5. Penetration test indipendente e chiusura dei finding.

## Debiti da non dimenticare

- Il PIN frontend `PasswordGate` e visibile nel bundle e non rappresenta un controllo di sicurezza: sostituirlo con autorizzazione o riautenticazione server-side.
- La diagnostica si fida degli header IP e conserva dati solo in memoria; va collegata al proxy fidato e a log persistenti.
- Il logout frontend cancella soltanto lo storage locale e non revoca il token server-side.
- Gli URL degli upload non devono essere considerati segreti, anche se contengono identificatori casuali.
- I controlli visivi e i pulsanti nascosti nel frontend non sostituiscono mai l'autorizzazione backend.
- Ogni nuovo locale deve ricevere credenziali uniche, capability esplicite e test automatici di isolamento.
