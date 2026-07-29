# PRD - Pastasciutta Roma

Stato: contratto funzionale corrente

Ultimo allineamento: 17 luglio 2026

## 1. Scopo del documento

Questo PRD descrive che cosa deve fare oggi l'applicazione Pastasciutta Roma,
quali comportamenti non devono regredire e quali limiti sono ancora aperti.
Serve come punto di orientamento per il titolare, gli sviluppatori e gli agenti
Codex che lavorano sul repository da postazioni diverse.

Il PRD non e:

- un changelog;
- una raccolta di idee future;
- un runbook di produzione;
- un contenitore di password, token, chiavi, indirizzi IP o credenziali.

In caso di conflitto:

1. una decisione esplicita e recente del titolare ha la precedenza;
2. questo PRD definisce il comportamento atteso;
3. test e codice mostrano il comportamento implementato;
4. una differenza tra PRD e implementazione deve essere trattata come bug o
   decisione da chiarire, non corretta silenziosamente nel documento;
5. il changelog spiega come e perche il sistema e arrivato allo stato corrente.

## 2. Visione del prodotto

Pastasciutta Roma e un'applicazione interna multi-locale che coordina il lavoro
quotidiano dei ristoranti e del magazzino centrale. Deve permettere di:

- creare e seguire gli ordini di pasta in tempo reale;
- coordinare Cassa, Tablet Generale, Bollitori e Monitor Clienti;
- compilare il Report giornaliero di ogni locale;
- conservare uno storico affidabile di paste, cassa e bevande;
- produrre Excel utilizzabili per Numeri e Analisi mensile;
- gestire richieste merce, DDT, carichi, inventario e movimenti di stock;
- gestire documenti operativi e relativi allegati;
- controllare versione, dispositivi online ed errori applicativi;
- aggiungere nuovi locali senza introdurre logica duplicata per ciascuna sede.

L'app non e un servizio pubblico e non prevede registrazione autonoma degli
utenti. E uno strumento operativo: continuita, isolamento dei locali e
correttezza dei dati hanno priorita sulle funzioni decorative.

## 3. Principi vincolanti

1. **Isolamento dei locali**: un locale vede e modifica soltanto i propri dati.
2. **Backend autoritativo**: ruoli, tenant e operazioni sensibili sono validati
   dal backend; nascondere un pulsante nel frontend non e sicurezza.
3. **Continuita operativa**: un aggiornamento del codice non deve azzerare dati
   MongoDB o upload persistenti.
4. **Storico spiegabile**: cancellazione, correzione manuale e riporto automatico
   devono avere semantiche distinguibili.
5. **Giornata italiana**: i confini giornalieri usano sempre `Europe/Rome`,
   inclusi cambio ora, mezzanotte, storico ed export.
6. **Compatibilita dei dati**: le nuove versioni devono continuare a leggere i
   documenti storici supportati o segnalare esplicitamente cio che manca.
7. **Fallimento isolato**: diagnostica, export o future funzioni analitiche non
   devono trascinare con se gli ordini e il lavoro quotidiano.
8. **Nessuna scorciatoia nascosta**: backdoor, kill switch invisibili e bypass
   permanenti non fanno parte del prodotto.

## 4. Architettura corrente

### 4.1 Componenti

- Frontend React, attualmente basato su Create React App/Craco.
- Backend FastAPI in Python.
- MongoDB come database operativo.
- WebSocket come canale real-time principale, con polling di fallback.
- File allegati nel filesystem configurato da `UPLOADS_DIR`, fuori dal
  repository in produzione.
- Nginx davanti all'applicazione sulla VPS.

Il backend e stato separato per dominio:

```text
backend/app/core       configurazione, sicurezza, database, tempo, file
backend/app/schemas    contratti dati
backend/app/services   logica di dominio
backend/app/routers    API HTTP e WebSocket
backend/app/tasks      mezzanotte, recovery e manutenzione
backend/app/bootstrap  composizione FastAPI e lifecycle
backend/server.py      entrypoint e compatibilita con import storici
```

Nuova logica di dominio non deve essere aggiunta a `server.py`.

### 4.2 Ambienti

L'ambiente locale di riferimento usa:

- Python 3.12;
- Node.js 20;
- Yarn 1.22.22;
- MongoDB 8.0.

Sono supportati l'avvio Docker descritto in `LOCAL_DOCKER.md` e l'avvio nativo
Windows descritto in `LOCAL_NATIVE.md`. Il database locale deve restare separato
da quello di produzione.

La produzione gira su VPS Ubuntu. HTTPS e attivo; redirect HTTP, firewall,
rotazione completa dei segreti e gli altri controlli infrastrutturali P0 devono
essere verificati durante il rollout P0-B, non dati per acquisiti.

## 5. Identita, ruoli e tenant

### 5.1 Matrice funzionale

| Attore | Ambito | Capacita principali | Esclusioni principali |
|---|---|---|---|
| Anonimo | Nessun tenant | Login, endpoint tecnici pubblici minimi, apertura di un upload solo con URL firmato valido | Tutti i dati operativi |
| Locale (`restaurant`) | Solo il proprio locale | Ordini, tablet, Report del giorno, documenti del locale, richieste merce e conferma ricezione | Impersonazione, configurazioni globali, dati di altri locali |
| Magazziniere (`magazzino`) | Magazzino centrale | Evasione richieste, carichi, DDT, consultazione prodotti, stock e movimenti necessari al flusso operativo | Creazione/modifica/cancellazione catalogo prodotti e fornitori, forzatura quantita |
| Federico (`supervisor`) | Locale selezionato | Selezione locale, Report e storico, Numeri, storico chiusure, audit Cassa, diagnostica e dizionario paste secondo le route abilitate | Magazzino globale, Analisi mensile completa, documenti globali, creazione locali e mutazioni globali |
| Admin (`admin`) | Globale o locale selezionato | Amministrazione operativa, impersonazione, mutazioni globali, export e correzioni autorizzate | Creazione nuovi locali riservata a Simone |
| Simone (`admin`) | Globale o locale selezionato | Tutte le capacita Admin e creazione/configurazione iniziale di nuovi locali | Nessun bypass fuori dalle route autorizzate |

La matrice e un contratto di prodotto, ma ogni route deve applicarlo nel backend.
Ogni nuova route deve dichiarare e testare esplicitamente l'accesso per:
anonimo, locale, magazzino, Federico, Admin e Simone.

### 5.2 Sessione e selezione locale

- L'identita autenticata e trasportata in un JWT firmato.
- Token e locale selezionato sono conservati in `sessionStorage`, quindi sono
  isolati per scheda del browser.
- Admin e Federico mantengono la propria identita privilegiata mentre scelgono
  il tenant effettivo su cui lavorare.
- Il tenant effettivo viene comunicato al backend tramite header dedicati solo
  per ruoli autorizzati; un locale normale non puo sovrascriverlo.
- Aprire due schede su locali diversi non deve causare scritture incrociate.
- Gli account non vengono creati o resettati automaticamente all'avvio.
- Gli account privilegiati si gestiscono con il comando offline
  `backend/scripts/manage_account.py`.
- Il logout generale e la revoca server-side completa delle sessioni restano
  un debito di sicurezza: oggi il logout ordinario rimuove soprattutto lo stato
  client e il JWT resta valido fino a scadenza, salvo revoche specifiche.

## 6. Flussi funzionali

### 6.1 Ordini e tablet

La Cassa crea, modifica, stampa e cancella ordini. Ogni ordine appartiene a un
solo locale.

Contratti:

- il numero ordine automatico e progressivo per locale e giornata;
- l'allocazione automatica e concorrenza-safe;
- un numero manuale puo riposizionare il contatore in avanti o indietro;
- un numero manuale gia presente tra gli ordini attivi viene rifiutato;
- l'indice univoco `(restaurant_id, order_number)` protegge gli ordini attivi;
- una cancellazione non riduce da sola il contatore;
- Tablet Generale nasconde un ordine dalla propria vista senza cancellarlo;
- la cancellazione reale dalla Cassa rimuove l'ordine operativo e crea il log
  necessario all'audit;
- un ordine cancellato non conta in Numeri o Analisi;
- un ordine completato o archiviato continua a far parte dello storico valido;
- Bollitore 1 e 2 gestiscono timer e completamento cucina;
- Monitor Clienti mostra gli ordini pronti soltanto nei locali configurati.

WebSocket notifica le variazioni al tenant corretto. Se non e disponibile, il
polling mantiene le pagine aggiornate senza cambiare la fonte di verita.

### 6.2 Chiusura della giornata

Alla mezzanotte di Roma il backend:

1. congela il testo paste e il dizionario/prezzi del giorno appena chiuso quando
   i dati lo consentono;
2. copia ordini e log giornalieri nelle collection di archivio e cancella le
   sorgenti solo dopo aver verificato la copia;
3. azzera i contatori giornalieri dei locali;
4. materializza i valori di apertura del nuovo Report;
5. notifica il reset ai client connessi;
6. esegue la manutenzione degli upload in modalita best effort.

Se il backend era spento a mezzanotte, il recovery di avvio archivia gli ordini
stale prima che contaminino la nuova giornata, ricalcola i contatori e genera un
avviso amministrativo.

### 6.3 Report giornaliero

Il Report combina:

- paste del giorno;
- movimenti di cassa e canali di pagamento;
- spicci, tubetti e cassetto;
- magazzino bevande mattina/sera, ingressi e scarti;
- prezzi automatici da dizionario e prezzi manuali per righe non riconosciute;
- storico e audit delle correzioni.

Contratti:

- il testo paste automatico deriva dagli ordini validi del locale;
- le cancellazioni reali sono escluse;
- una forzatura manuale del testo paste resta protetta dagli aggiornamenti live
  finche un utente autorizzato non la sblocca;
- il salvataggio e parziale: un autosave non deve sovrascrivere campi modificati
  da un'altra scheda;
- il polling aggiorna gli altri client senza cancellare un input in modifica;
- i campi numerici non accettano testo arbitrario; le formule sono ammesse solo
  dove previste;
- il Report storico usa la data e il locale richiesti, non il polling live;
- le correzioni storiche autorizzate devono restare riconoscibili nell'audit.

Riporti automatici:

- `cash mattina` del nuovo giorno deriva dal `cash sera` del giorno precedente;
- il magazzino bevande mattina deriva dal magazzino sera precedente;
- il cassetto spicci del nuovo giorno deriva dal residuo precedente, al netto
  degli spicci aperti/portati;
- una correzione del giorno precedente aggiorna il riporto automatico;
- una forzatura manuale esplicita di `mattina` non deve essere sovrascritta dal
  successivo ricalcolo automatico.

Per ciascuna bevanda, la vendita calcolata usa:

```text
(sera == 0 ? 0 : mattina + ingressi - sera) - scarti
```

Il significato di `sera = 0` resta una limitazione nota: oggi viene interpretato
come dato non chiuso, non come vendita completa di tutto lo stock.

### 6.4 Numeri

La pagina Numeri mostra per giorno le paste prodotte dai locali e le relative
medie. L'Excel Numeri:

- copre dal 1 gennaio al 31 dicembre dell'anno scelto;
- crea una colonna per ogni locale attivo;
- calcola il totale giornaliero;
- scrive le medie del mese soltanto sulla riga dell'ultimo giorno del mese;
- usa gli ordini validi attivi e archiviati, escludendo quelli cancellati;
- deduplica eventuali copie tecniche dello stesso ordine.

Federico, Admin e Simone possono accedere secondo i permessi backend correnti.

### 6.5 Analisi mensile

La pagina Analisi mensile e volutamente essenziale: selezione anno e download
dell'Excel. Il workbook generato contiene:

- un foglio per ogni locale attivo;
- un foglio `Totali` equivalente all'export Numeri;
- una riga per giorno;
- sezioni paste, movimenti finanziari, bevande e cash coerenti con il modello
  approvato;
- righe di totale mensile per separare e sommare i mesi.

Le paste sono classificate tramite il dizionario del locale. Per ogni giorno il
sistema usa, in ordine:

1. snapshot del dizionario/prezzi salvato per quella giornata;
2. dizionario corrente come fallback soltanto per giorni storici senza snapshot.

Le colonne analitiche seguono il modello approvato per il locale: Flaminio usa
il profilo esteso con `Carzuc` e `Amatriciana` separate; Grazie, Brazzà e i nuovi
locali usano il profilo standard e raggruppano queste sigle in `Altro`. Il prezzo
configurato continua comunque a contribuire agli incassi anche quando la pasta
confluisce in `Altro`.

Il fallback deve produrre avvisi nell'export: cambiare oggi un prezzo o una sigla
non deve modificare i giorni che possiedono gia uno snapshot, ma puo influire sui
giorni vecchi privi di snapshot. Non viene inventato un backfill retroattivo.

Il conteggio usa soltanto ordini attivi e archiviati. I log di cancellazione
servono a escludere correttamente ordini cancellati, non ad aggiungerli.

### 6.6 Magazzino, richieste e DDT

Il magazzino centrale gestisce un catalogo condiviso di prodotti e fornitori.
Catalogo e forzature di quantita sono mutazioni globali riservate ad Admin e
Simone; il Magazziniere esegue i flussi operativi.

Richieste merce:

```text
pending -> evasa -> confermata
```

- il locale crea la richiesta;
- la disponibilita mostrata tiene conto delle richieste pending degli altri
  locali;
- il Magazziniere evade e lo stock viene decrementato;
- il locale conferma la ricezione o segnala un problema;
- il numero DDT e globale e allocato atomicamente.

Carichi:

- registrano merce ricevuta dai fornitori;
- collegano fornitore, numero DDT, righe prodotto e allegato;
- modifica e cancellazione devono applicare il delta inverso corretto allo stock;
- i documenti storici del carico restano utili alle analisi anche dopo la
  scadenza dell'immagine.

Ogni variazione di stock deve produrre un movimento nel ledger
`stock_movements`, con prodotto, delta, saldo, causa, riferimento e autore. La
resistenza completa a crash e retry multi-documento resta un obiettivo P2 e non
deve essere data per garantita senza test specifici.

Il DDT usa i dati anagrafici salvati nel locale; i fallback hardcoded servono
soltanto per sedi storiche che non possiedono ancora quei campi.

### 6.7 Documenti e upload

L'app gestisce fatture, versamenti, chiusure e relativi allegati, oltre alle
fatture globali collegate ai DDT. Gli upload:

- vengono salvati fuori dal repository in produzione;
- sono serviti tramite URL firmati con scadenza;
- devono essere validati per tipo, dimensione e percorso;
- non devono contenere credenziali o essere versionati in Git.

La retention corrente e di 90 giorni:

- fatture, versamenti e chiusure vecchi vengono rimossi con i loro file;
- per carichi di magazzino e bevande vengono rimossi gli allegati vecchi, ma i
  documenti strutturati restano per lo storico.

### 6.8 Diagnostica e aggiornamenti client

La Diagnostica live e una vista operativa, non una fonte contabile. Mostra:

- stato e versione del backend;
- versioni frontend rilevate;
- dispositivi dei locali attualmente online;
- WebSocket, latenze, chiamate ed errori recenti.

I dispositivi offline non devono affollare la vista principale. Heartbeat,
latenze ed errori frontend sono mantenuti prevalentemente in memoria e si
azzerano al riavvio backend.

Il frontend controlla la versione pubblicata e puo ricaricarsi una volta quando
rileva un bundle nuovo. Le pagine ricordano in `sessionStorage` la posizione di
scorrimento e, dopo un refresh, tornano al punto precedente quando il layout lo
consente.

### 6.9 Creazione di un nuovo locale

Solo Simone puo creare un locale dall'interfaccia dedicata. Sono obbligatori:

- username univoco;
- nome locale univoco;
- password iniziale;
- sigla Excel univoca da 1 a 4 caratteri;
- uno o due bollitori;
- indirizzo, CAP e citta;
- scelta opzionale per Monitor Clienti.

Un locale con ruolo `restaurant` entra automaticamente in:

- selettori Admin/Federico;
- isolamento ordini e Report;
- Numeri e relative medie;
- workbook Analisi mensile, con un foglio dedicato e una colonna in `Totali`;
- richieste merce e intestazione DDT;
- configurazione generica di bollitori e Monitor Clienti.

La gestione bevande non fa parte del form di creazione. Le funzioni
specificamente legate al catalogo bevande di Flaminio non vanno considerate
automaticamente abilitate per una nuova sede.

### 6.10 Laboratorio

Il Laboratorio e accessibile esclusivamente all'account Simone ed espone
esperimenti isolati dalla logica operativa. Una prova non puo modificare ordini,
Report, magazzino o documenti reali senza una successiva implementazione
esplicitamente approvata e testata.

L'Osservatorio annotazioni paste legge ordini validi attivi e archiviati e usa
lo stesso riconoscitore rigido di Report e Analisi. Righe manuali, errate o `XL`
restano escluse come nel comportamento operativo. Il parser semantico v3 separa:

- testo sorgente, sempre conservato;
- testo utile senza numeri;
- pager, quantita e numeri contestuali;
- segnali confermati (`TA`, `C`, `S`, `F`, `CHIUSA` e il codice formato `RIG`);
- richieste letterali come `NO PEPE`, `SENZA GUANCIALE` e `BEN COTTA`;
- bersagli equivalenti confermati tramite allowlist versionata: per esempio
  `NO GUANC`, `NO GUANCIALE` e `SENZA GUANCIALE` alimentano lo stesso concetto
  `Senza guanciale`, mantenendo visibili forme sorgente e conteggi;
- frammenti ancora da interpretare, ai quali non viene assegnato un significato
  inventato. `T`, finche non viene chiarito, resta esplicitamente sconosciuto.

La pagina separa Da confermare, Segnali, Da interpretare, Frasi complete e
Probabili comande. I Segnali espongono le varianti effettivamente scritte sotto
il concetto canonico. La similarita testuale viene usata soltanto per proporre
a Simone coppie osservate nello stesso contesto semantico; non produce mai una
fusione automatica. Simone puo confermare `Uguali`, registrare `Diverse` per non
ricevere nuovamente la proposta, oppure annullare entrambe le decisioni.
Un alias confermato viene applicato retroattivamente alle statistiche del
periodo senza modificare le descrizioni originali.
Per proteggere i flussi operativi senza ridurre il valore statistico, una sola
analisi annotazioni puo essere eseguita per processo e qualunque intervallo
valido fino a 366 giorni viene elaborato in blocchi di 7 giorni. Ogni blocco
deduplica e classifica i propri ordini, poi libera i documenti sorgente; i
conteggi vengono fusi senza approssimazioni e gli esempi restano limitati e
recenti. Non esiste un tetto al numero complessivo di ordini del range. Le
modifiche ai filtri restano in bozza finche Simone non preme Aggiorna.
Espone sia il numero di paste coinvolte sia, quando esiste un pager affidabile,
il numero di comande ricostruite. Una comanda probabile richiede stesso locale,
giornata e pager, massimo 90 secondi tra righe adiacenti e numeri ordine distanti
al massimo 8. La ricostruzione e dichiarata non autoritativa.

Lo storico operativo resta in sola lettura: il Laboratorio non salva o modifica
ordini. Le sole scritture avvengono nelle collection isolate
`lab_pasta_annotation_aliases` e `lab_pasta_annotation_dismissals`, con versione,
autore e data. Le route GET, POST e DELETE restano riservate esclusivamente a
Simone. Quando la Memoria operativa viene attivata, alias confermati e parser
condiviso vengono raccolti come configurazioni versionate; fatti e snapshot
mantengono il raw necessario a ricalcolare regole future.

Lo Scanner documenti esegue OCR italiano nel browser su fotografie di DDT,
fatture e note di credito. La foto non viene inviata al backend e gli asset OCR
sono inclusi nel build, senza dipendenze da servizi cloud. Il testo estratto
viene confrontato in sola lettura con `suppliers` e `products` del Mongo
dell'ambiente corrente; sulla VPS usa quindi automaticamente i cataloghi reali.
Numero, data, quantita, prezzo unitario, totale riga e totale documento derivano
esclusivamente dal testo OCR e i campi incerti restano correggibili.

La conferma di una prova non crea carichi, fatture, richieste o movimenti stock.
Scrive soltanto nelle collection isolate `lab_document_scan_feedback` e
`lab_document_aliases`: conserva hash del testo, metadati strutturati, brevi
righe sorgente e associazioni confermate fornitore/prodotto. Non conserva la
foto ne il testo OCR integrale. Le associazioni confermate vengono riutilizzate
nelle prove successive; l'ultimo prezzo osservato puo essere registrato come
evidenza, ma non deve mai compilare un prezzo assente dal documento.

## 7. Fonti di verita e semantica dei dati

| Dominio | Fonte operativa | Regola |
|---|---|---|
| Identita e locali | `restaurants` | Password solo come hash; ruolo e metadati tenant sono autoritativi |
| Ordini correnti | `orders` | Un solo tenant, numero attivo univoco |
| Ordini chiusi | `archived_orders` | Contano nello storico e nelle analisi |
| Ordini cancellati | log di cancellazione | Audit soltanto; non contano in Numeri/Analisi |
| Report cassa | `cash_daily_counts` | Un documento per locale e data di Roma |
| Report bevande | `beverage_daily_counts` | Una riga per locale, data e sigla |
| Dizionario paste | dizionario per locale + snapshot giornaliero | Lo snapshot congela interpretazione e prezzi dello storico |
| Stock | `products` | Quantita corrente, verificabile tramite ledger |
| Movimenti stock | `stock_movements` | Registro delle variazioni, non sostituisce la quantita corrente |
| Allegati | filesystem `UPLOADS_DIR` + riferimento Mongo | Database e filesystem devono restare coerenti |

Distinzioni obbligatorie:

- `hidden_generale` nasconde una pasta dal Tablet Generale ma non la cancella e
  non la esclude dall'analisi;
- la cancellazione reale la esclude dai conteggi e conserva l'evento di audit;
- una correzione manuale non deve essere presentata come dato automatico;
- un campo assente non deve essere trasformato silenziosamente in un valore
  storico certo;
- valori derivati devono essere ricalcolabili dalle fonti documentate.

## 8. Requisiti non funzionali

### 8.1 Affidabilita

- Un errore WebSocket non blocca il lavoro grazie al polling.
- Un errore di cleanup non blocca il reset notturno.
- Un errore di export non modifica i dati operativi.
- Un deploy non esegue seed o reset automatici degli account.
- Il mancato reset di mezzanotte viene recuperato al boot.
- Le future funzioni di Memoria operativa devono poter fallire senza cambiare
  login, ordini, Report, magazzino o reset.
- Le Fasi 0-6 della Memoria restano un pacchetto autonomo e disabilitato: il
  backend operativo non lo importa. I collector acquisiscono ordini, Report,
  magazzino e configurazioni, protetti da doppio interruttore, epoch, ruoli
  Mongo read-only, lock, batch limitati, raw sanificato, watermark, versioni
  bitemporali e quarantena. Snapshot giornalieri versionati espongono
  provenienza, copertura e gap senza inventare dati mancanti. Il runner separato
  applica dry-run, backoff, circuit breaker e limiti di latenza/storage.
  Cancellazioni fisiche vengono dichiarate soltanto al termine di scansioni
  complete. Il servizio non e ancora installato o attivo sulla VPS.

### 8.2 Sicurezza

La baseline P0-A lato codice comprende:

- `JWT_SECRET` obbligatorio, senza fallback insicuro;
- CORS a allowlist in produzione;
- documentazione FastAPI disabilitata in produzione;
- account privilegiati senza seed/reset HTTP;
- gestione account privilegiati tramite comando offline;
- controlli backend per mutazioni globali;
- WebSocket con ticket monouso e controllo Origin;
- upload con URL firmati e path controllato;
- rate limit sul login;
- rimozione dal runtime delle route di simulazione e dei dati di test versionati.

P0-A non equivale a P0 concluso in produzione. Il rollout P0-B deve seguire
`memory/P0_VPS_RUNBOOK.md` e comprende backup, verifica restore, migrazione
upload, rotazione segreti, logout globale, redirect HTTPS, firewall, smoke test
e rollback.

### 8.3 Prestazioni

- Le query analitiche annuali devono essere aggregate/prefetchate, non eseguite
  una volta per giorno e locale.
- Liste e storico devono avere limiti o filtri coerenti col volume previsto.
- Il workbook Excel viene oggi costruito in memoria: va monitorato con la crescita
  di anni e locali.
- Diagnostica e future analisi non devono saturare MongoDB operativo.

### 8.4 Compatibilita e UX operativa

- Le pagine principali devono restare usabili su tablet e desktop.
- Un nuovo locale non deve richiedere nuove route o copie di pagina.
- Gli aggiornamenti live non devono far scomparire input non salvati.
- Le pagine lunghe devono ripristinare lo scroll dopo refresh.
- Il testo visualizzato deve usare nomi operativi comprensibili, non etichette
  tecniche o celebrative.

## 9. Test e criteri di rilascio

Ogni modifica deve partire dalla lettura di questo PRD e del changelog recente.
Il livello di test cresce col rischio.

Baseline automatica:

- controllo igiene repository e segreti ad alta confidenza;
- compilazione backend e controllo errori Python evidenti;
- suite backend isolata;
- test frontend;
- build frontend di produzione.

Per aree sensibili servono inoltre test mirati:

- auth/ruoli: matrice ruoli e isolamento tenant;
- ordini: concorrenza, numeri manuali, cancellazioni e mezzanotte;
- Report: giorno corrente/storico, riporti, override e piu schede;
- Numeri/Analisi: ordini cancellati, deduplica, snapshot, mesi e nuovi locali;
- magazzino: delta stock, retry, modifica/cancellazione e ledger;
- upload: tipo, dimensione, firma, scadenza e path traversal;
- deploy: backup, smoke test multi-ruolo e rollback.

I dettagli dell'ultima esecuzione dei test appartengono al changelog, non a
questo PRD.

## 10. Stato sicurezza e rilascio

Al 17 luglio 2026:

- il refactor backend e operativo e `server.py` resta compatibile con l'entrypoint
  esistente;
- P0-A e implementato e testato nel codice;
- P0-B sulla VPS non e ancora considerato completato;
- HTTPS e attivo, ma il redirect HTTP e gli altri controlli VPS vanno verificati;
- una release ordinaria mantiene MongoDB e upload, ma la prima release P0 non
  deve essere trattata come un semplice `git pull + build + restart`.

Nessuna modifica alla produzione deve essere eseguita mentre i locali lavorano
se richiede logout globale, rotazione segreti, migrazione file o possibile
interruzione.

## 11. Limiti e debiti noti

- P0-B infrastrutturale e ancora da eseguire.
- Il logout JWT non offre ancora revoca server-side generale.
- Il `PasswordGate` frontend non e un controllo di sicurezza reale.
- Diagnostica e heartbeat non sono log persistenti.
- Giorni storici senza snapshot del dizionario possono usare il listino corrente
  come fallback e devono essere segnalati.
- `sera = 0` nelle bevande e semanticamente ambiguo.
- L'Excel annuale e costruito interamente in RAM.
- Alcuni warning React Hook preesistenti indicano debito di manutenzione; non
  sono stati classificati come blocchi operativi, ma vanno corretti con test
  mirati.
- Integrita crash-safe/idempotente delle operazioni multi-documento di stock e
  file resta parte dell'hardening P2.
- Create React App e dipendenze backend sovradimensionate restano debito tecnico,
  non requisito funzionale.

Questa sezione deve contenere limiti reali del prodotto corrente. Idee non
implementate e lavori futuri vanno nei documenti dedicati.

## 12. Documenti collegati

- `memory/CHANGELOG_MULTI_AGENT.md`: modifiche recenti e test eseguiti.
- `memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`: storico meno recente.
- `memory/SECURITY_HARDENING_PLAN.md`: piano sicurezza P0-P3.
- `memory/P0_VPS_RUNBOOK.md`: procedura esecutiva del rollout P0-B.
- `memory/TODO.md`: idee e funzioni future.
- `memory/OPERATIONAL_MEMORY_DESIGN.md`: contratto e stato esecutivo della
  Memoria operativa isolata; Fasi 0-4 implementate localmente ma non attive.
- `memory/MEMORY_PHASE0_RUNBOOK.md` ... `MEMORY_PHASE4_RUNBOOK.md`: perimetro,
  guardie, test e limiti delle fasi gia implementate.
- `memory/refactor_plan_server_py.md`: piano e stato del refactor backend.
- `LOCAL_DOCKER.md` e `LOCAL_NATIVE.md`: ambienti locali.

## 13. Regola di manutenzione

Aggiornare questo PRD quando cambia un contratto del prodotto, un ruolo, una
fonte di verita, un flusso operativo o un limite noto. Non aggiungere qui il
diario di ogni fix.

Ogni modifica al codice o ai documenti operativi deve comunque ricevere una voce
nel changelog. Nessun documento del repository deve contenere credenziali reali.
