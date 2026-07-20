# Memoria operativa isolata

Ultimo aggiornamento: 2026-07-20

Stato: Fasi 0-6 implementate e collaudate localmente; servizio non installato

Motto vincolante:

> La Memoria puo fallire senza trascinare con se l'applicazione.

Questo documento definisce il perimetro funzionale e il progetto esecutivo della
Memoria operativa. Deve permettere di raccogliere dal momento dell'attivazione il
maggior numero possibile di dati utili per analisi, confronti, previsioni e future
funzioni, senza diventare una dipendenza del lavoro quotidiano dei locali.

## 1. Obiettivi

- Raccogliere nuovi dati dal momento zero, senza backfill dello storico precedente.
- Conservare sempre il dato originale insieme alla sua interpretazione strutturata.
- Rendere i dati futuri rielaborabili con parser, regole e modelli diversi.
- Ricostruire giornate, andamenti, configurazioni e catene logistiche.
- Preparare la base per confronti annuali, giorni omogenei, festivita mobili,
  composizione paste, previsioni e futura Macchina del tempo.
- Raccogliere dati senza modificare il risultato delle operazioni dell'app.
- Rendere espliciti buchi, ritardi e qualita dei dati, senza inventare informazioni.

## 2. Non obiettivi

- La Memoria non e il database operativo e non diventa fonte di verita dell'app.
- La Memoria non corregge automaticamente ordini, Report, stock o configurazioni.
- La Memoria non e necessaria per login, ordini, Report, magazzino o reset notturno.
- La prima versione non espone pagine, grafici, previsioni o assistenti AI.
- La prima versione non converte MongoDB in replica set e non introduce transazioni
  nei flussi operativi.
- Non viene recuperato o reinterpretato alcun dato precedente al momento zero.

## 3. Invarianti architetturali

Queste regole non possono essere violate da implementazioni future:

1. Il backend operativo non attende mai una scrittura della Memoria.
2. Un errore della Memoria non puo diventare una risposta HTTP 5xx operativa.
3. Il processo Memoria non scrive mai nelle collection operative.
4. Ordini, Report e reset non leggono mai dalle collection della Memoria.
5. Le pagine operative non dipendono dalla disponibilita della Memoria.
6. Il processo Memoria usa connessioni, CPU, RAM, I/O e spazio limitati.
7. In caso di carico o lentezza la Memoria si mette in pausa e resta indietro.
8. Nessuna coda puo crescere senza limite in RAM o sul disco operativo.
9. Le analisi future interrogano solo lo storage Memoria, non Mongo operativo.
10. Spegnere o rimuovere la Memoria non cambia il comportamento dell'app.

Un test architetturale deve impedire import della Memoria nei servizi operativi.
Il verso delle dipendenze e sempre questo:

```text
Memoria -> lettura dei dati applicativi
Applicazione -X-> dipendenza dalla Memoria
```

## 4. Perimetro definitivo dei dati

### 4.1 Dati inclusi

- Ordini e paste.
- Modifiche, cancellazioni, stati e tempistiche degli ordini.
- Report, cash, formule, spicci, cassetto e banconote.
- Bevande, ingressi, scarti, magazzino mattina/sera e vendite calcolate.
- Prodotti del magazzino centrale.
- Carichi e righe strutturate dei DDT.
- Richieste dei locali e loro ciclo di vita.
- Movimenti, rettifiche e saldi di magazzino.
- Fornitori collegati a carichi, prodotti e richieste.
- Locali e configurazioni operative.
- Dizionari paste, prezzi e regole di conversione.
- Login, logout, dispositivo, scheda e locale effettivo, quando disponibili.
- Percorsi principali utilizzati nell'app, in forma compatta e best effort.
- Versioni backend/frontend e deploy attivi.
- Export generati, periodo richiesto, avvisi e hash del file.
- Reset, recovery, riporti e automatismi importanti.
- Calendario, giorno della settimana, festivita e contesto configurabile.
- Meteo o altre fonti esterne solo tramite il processo Memoria e in best effort.

### 4.2 Dati esclusi

- Fatture locali.
- Fatture globali.
- Versamenti.
- Chiusure e relative immagini.
- Foto delle fatture.
- Foto dei DDT e dei carichi.
- Password e hash delle password.
- JWT, cookie, codici Report, chiavi e segreti.
- Testo digitato prima del salvataggio.
- Movimenti del mouse, tasti premuti e heartbeat grezzi ogni 30 secondi.

Le funzioni escluse continuano a funzionare nell'app e seguono la retention
operativa esistente. Semplicemente non vengono copiate nella Memoria.

### 4.3 DDT

Dei DDT vengono conservati solo i dati strutturati:

- identificativo carico;
- numero DDT;
- data del documento e data di registrazione;
- fornitore;
- prodotti, quantita e unita;
- modifiche e cancellazioni;
- utente e locale, quando applicabili;
- movimenti stock generati;
- quantita prima, delta e quantita dopo.

La fotografia del documento non fa parte della Memoria.

## 5. Distinzione tra consumo e movimentazione

Una richiesta evasa verso un locale non dimostra che la merce sia stata consumata.
La Memoria deve usare termini corretti:

- `ricevuto_da_fornitore`: merce entrata nel magazzino centrale;
- `richiesto_dal_locale`: quantita domandata dal locale;
- `evaso_al_locale`: quantita uscita dal magazzino verso il locale;
- `consumo_logistico`: proxy basato sulla merce inviata;
- `consumo_teorico`: stima basata su paste e ricette;
- `consumo_reale`: utilizzabile solo se supportato da inventari locali affidabili.

Non si deve mai presentare `evaso_al_locale` come consumo reale.

In futuro sara possibile confrontare:

```text
merce inviata al locale
vs consumo teorico da ricette
vs scarti registrati
vs variazione inventario locale, se disponibile
```

Una differenza viene indicata come dato da spiegare, non automaticamente come spreco.

## 6. Architettura proposta

```text
Frontend operativo ------------------------> Backend operativo
       |                                          |
       | telemetria best effort                   | scritture normali
       |                                          v
       |                                    Mongo operativo
       |                                          |
       v                                          | sola lettura
Endpoint Memoria opzionale                       v
       |                                  pastasciutta-memory
       |                                          |
       +------------------------------------------+
                                                  |
                                                  v
                                           Storage Memoria
```

### 6.1 Processo separato

La Memoria gira come processo distinto, per esempio:

```text
pastasciutta-backend.service   applicazione operativa
pastasciutta-memory.service    collector e normalizzatore
```

Il backend non dipende dall'avvio del worker. Systemd non deve configurare il
backend con `Requires=pastasciutta-memory.service` o dipendenze equivalenti.

### 6.2 Storage separato

Il worker usa variabili dedicate:

```text
SOURCE_MONGO_URL       accesso in sola lettura al DB operativo
MEMORY_MONGO_URL       storage della Memoria
MEMORY_DB_NAME         database della Memoria
```

In produzione `MEMORY_MONGO_URL` dovrebbe puntare a uno storage separato da
Mongo operativo. Se temporaneamente condivide la VPS, deve avere almeno volume,
quota disco e limiti di processo separati. Il backend operativo non deve conoscere
le credenziali dello storage Memoria.

Lo storage deve poter essere spostato in futuro senza cambiare i flussi operativi.

### 6.3 Credenziali minime

- Il worker ha accesso read-only alle sole collection sorgente necessarie.
- Il worker ha accesso read/write esclusivamente allo storage Memoria.
- Il backend non ha bisogno di accesso read/write alla Memoria.
- L'eventuale endpoint telemetrico ha credenziali e limiti propri.

## 7. Tre canali di acquisizione

### 7.1 Pull autorevole

E il canale principale. Il worker legge periodicamente i dati gia salvati nelle
collection operative. Non modifica endpoint o risultati dell'app.

Fonti principali attuali:

```text
orders / archived_orders
deletion_logs / archived_deletion_logs
modification_logs / archived_modification_logs
cash_daily_counts / cash_audit_log
beverage_daily_counts
archived_beverage_sales (solo vendite definitive; le attive sono stornabili)
products / stock_movements
richieste / carichi_magazzino
pasta_dictionary / restaurants
suppliers / beverage_inventory / beverage_carichi
```

### 7.2 Metadati passivi nelle scritture esistenti

Per massimizzare il contesto senza aggiungere I/O, alcune scritture gia esistenti
possono includere campi opzionali generati localmente:

```text
account_id
role
restaurant_context_id
device_id
tab_id
frontend_version
request_id
app_version
```

La funzione che costruisce questi metadati deve essere pura, senza accesso a rete
o database, catturare ogni errore e restituire campi vuoti in caso di problema.
I campi devono essere opzionali e mai validati come requisito dell'operazione.

### 7.3 Eventi best effort

Per informazioni non recuperabili dal database, come cambio pagina o inizio di
una sessione, il frontend puo inviare eventi a un endpoint non operativo.

- Il browser ignora errori e timeout.
- L'endpoint non viene usato da ordini o Report.
- Gli eventi hanno dimensione e frequenza limitate.
- Non si salvano heartbeat grezzi: si compattano in sessioni e cambi pagina.
- Se il servizio non risponde, l'evento viene perso senza conseguenze.

## 8. Momento zero

La raccolta inizia da un istante esplicito:

```text
epoch_id
activated_at_utc
activated_at_rome
schema_version
backend_version
frontend_version
```

Il worker ignora tutto cio che precede `activated_at_utc`.

Al momento zero acquisisce solo una baseline, non uno storico:

- locali e configurazioni attive;
- dizionari e prezzi attivi;
- prodotti e stock corrente;
- eventuali ordini aperti al momento dell'attivazione;
- Report del giorno corrente;
- versione applicativa.

L'attivazione ideale avviene dopo il reset e prima dell'inizio del servizio, ma
la Memoria non richiede una finestra di manutenzione dell'app.

## 9. Modello comune dei record

Ogni record usa un envelope comune:

```json
{
  "memory_id": "uuid",
  "epoch_id": "uuid",
  "fact_type": "order.created",
  "source_collection": "orders",
  "source_id": "uuid",
  "source_version": "sha256",
  "restaurant_id": "uuid",
  "business_date_rome": "2026-09-01",
  "occurred_at_utc": "2026-09-01T10:43:18Z",
  "captured_at_utc": "2026-09-01T10:44:02Z",
  "actor": {},
  "device": {},
  "application_version": {},
  "schema_version": 1,
  "quality": "authoritative_copy",
  "raw": {},
  "normalized": {},
  "relations": []
}
```

Valori ammessi per `quality`:

- `authoritative_copy`: copia di un dato operativo salvato;
- `reconstructed`: ricostruito da piu fonti;
- `derived`: calcolato e rigenerabile;
- `best_effort`: evento che potrebbe mancare;
- `partial`: fonte incompleta o ambigua.

## 10. Collection dello storage Memoria

```text
memory_epochs
memory_raw_versions
memory_order_facts
memory_report_facts
memory_warehouse_facts
memory_configuration_versions
memory_usage_sessions
memory_context_daily
memory_export_facts
memory_daily_snapshots
memory_watermarks
memory_gaps
memory_quarantine
memory_integrity_runs
```

`memory_raw_versions` conserva le versioni sanificate originali. Le collection
specializzate contengono dati normalizzati e possono essere rigenerate.

## 11. Originale e interpretato

### 11.1 Paste

```json
{
  "raw_description": "2 CARB 1 AMA XL",
  "parsed_items": [
    {"canonical_id": "carbonara", "quantity": 2, "size": "standard"},
    {"canonical_id": "amatriciana", "quantity": 1, "size": "xl"}
  ],
  "parser_version": 1,
  "dictionary_version": "flaminio-v7"
}
```

Il dato originale non viene mai sostituito dal parsing.

Le annotazioni successive a una pasta riconosciuta sono un fatto separato:

```json
{
  "pasta_sigla": "CARB",
  "annotation_raw": "No  pepe",
  "annotation_normalized": "NO PEPE",
  "annotation_parser_version": 1
}
```

Il riconoscitore pasta operativo resta autoritativo e volutamente rigido. Una
riga manuale, errata, ambigua o esclusa come `XL` non genera annotazioni. La
normalizzazione corregge soltanto rappresentazione, spazi e maiuscole: non
indovina errori e non unisce automaticamente significati come `NO PEPE` e
`SENZA PEPE`. Il Laboratorio puo calcolare questi fatti in sola lettura; la
Memoria futura li conservera versionati insieme alla descrizione originale.

### 11.2 Denaro e formule

```json
{
  "raw_value": "=150+32",
  "numeric_value_cents": 18200,
  "currency": "EUR",
  "evaluator_version": 1
}
```

Gli importi normalizzati usano centesimi interi o Decimal, mai float binari.

### 11.3 Spicci

Per ogni taglio vengono conservati:

- espressione originale;
- numero rotolini aperti;
- numero rotolini nel cassetto;
- valore monetario calcolato;
- formula e versione delle regole;
- eventuale forzatura o correzione.

Questo permette confronti assoluti, medi giornalieri e rapportati alle paste.

### 11.4 Bevande

- sigla e identificativo canonico;
- casse e sfuse originali;
- unita normalizzate;
- unita per cassa valida in quel momento;
- ingressi, scarti, mattina, sera e vendite;
- prezzo e versione del catalogo.

### 11.5 Magazzino

- prodotto e unita;
- quantita prima;
- delta;
- quantita dopo;
- causale;
- richiesta, carico o DDT correlato;
- locale destinatario;
- utente;
- fornitore;
- stato e timestamp.

## 12. Acquisizione incrementale

Ogni sorgente ha un watermark indipendente:

```json
{
  "source": "archived_orders",
  "last_seen_at": "...",
  "last_seen_id": "...",
  "last_success_at": "...",
  "lag_seconds": 0,
  "status": "ok"
}
```

Regole:

- leggere piccoli batch ordinati;
- processare con upsert idempotenti;
- avanzare il watermark solo dopo il salvataggio del batch;
- rileggere una finestra temporale precedente per catturare modifiche tardive;
- deduplicare copie tra collection attive e archiviate tramite ID stabile;
- creare una nuova versione se cambia l'hash canonico del documento;
- non cancellare una vecchia versione della Memoria;
- mettere i record non interpretabili in quarantena e proseguire;
- applicare backoff progressivo dopo gli errori;
- non eseguire scansioni complete durante il servizio.

Se una fonte non ha timestamp affidabili, il worker usa ID, hash e una finestra
di rilettura controllata. Non vengono creati automaticamente indici sul database
operativo: un indice necessario deve essere valutato e distribuito separatamente.

## 13. Snapshot giornaliero

Per ogni locale e giornata chiusa viene prodotto uno snapshot contenente:

- conteggi ordini validi, modificati e cancellati;
- paste originali e composizione normalizzata;
- Report completo;
- cash e spicci per taglio;
- bevande, scarti e valori di magazzino;
- richieste create, evase, annullate e in errore;
- merce ricevuta e merce inviata al locale;
- movimenti stock correlati;
- configurazione e listino applicabili;
- contesto del calendario;
- fonti, conteggi, hash e watermark utilizzati;
- elenco di dati mancanti o ambigui.

Stati dello snapshot:

- `pending`: la giornata non e ancora consolidata;
- `complete`: tutte le fonti attese risultano disponibili;
- `partial`: una o piu fonti mancano o sono ambigue;
- `superseded`: esiste una versione successiva dopo correzioni tardive.

Lo snapshot e versionato e rigenerabile. Non influenza il reset o il Report.

## 14. Sessioni e utilizzo dell'app

Non vengono conservati heartbeat ogni 30 secondi. Gli heartbeat esistenti possono
essere compattati in segmenti:

```text
device_id
tab_id
account_id e ruolo
locale effettivo
pagina
started_at
last_seen_at
frontend_version
device_type/browser/os normalizzati
```

Un cambio pagina chiude un segmento e ne apre un altro. Una sessione scade dopo
assenza prolungata. Durate e fine sessione sono stime, dichiarate come tali.

IP completi e user-agent grezzi non sono necessari per l'analisi operativa. Se
raccolti per sicurezza restano in un flusso separato con retention ridotta.

## 15. Contesto

La Memoria puo arricchire una giornata senza coinvolgere il backend:

- giorno della settimana;
- settimana, mese, trimestre e stagione;
- festivita nazionali e festivita mobili;
- ponti configurati;
- eventi locali annotati;
- chiusura anticipata o servizio ridotto;
- promozione o cambio menu;
- meteo, se disponibile;
- versione di prezzi e configurazioni.

Le fonti esterne sono sempre best effort. La loro indisponibilita genera un gap
di contesto e non blocca la raccolta dei dati operativi.

## 16. Retention

- Fatti ordini, Report, magazzino e configurazioni: permanenti.
- Snapshot giornalieri e contesto: permanenti.
- Sessioni compatte di utilizzo: permanenti finche il volume resta sostenibile.
- Heartbeat grezzi: non conservati.
- Errori frontend grezzi: retention breve configurabile.
- Aggregati giornalieri degli errori: permanenti.
- Quarantena e gap: mantenuti finche risolti o esplicitamente accettati.
- File e immagini: esclusi dalla Memoria.

Le policy possono cambiare senza influenzare il database operativo.

## 17. Isolamento delle risorse

Il servizio Memoria deve avere configurazioni equivalenti a:

- `CPUQuota`;
- `MemoryMax`;
- priorita CPU e I/O inferiore al backend;
- pool sorgente molto piccolo;
- timeout Mongo brevi;
- dimensione batch massima;
- intervallo minimo tra batch;
- limite giornaliero di storage;
- quota disco o volume separato;
- circuit breaker;
- backoff con limite massimo;
- arresto automatico se la latenza del DB operativo supera la soglia.

Non si usa una coda RAM illimitata. Se lo storage non e disponibile, il worker
mantiene fermo il watermark e riprova piu tardi leggendo nuovamente la sorgente.

## 18. Matrice dei guasti

| Guasto | Comportamento richiesto |
|---|---|
| Worker non avviato | Backend e frontend operativi |
| Storage Memoria non raggiungibile | Watermark fermo, app invariata |
| Mongo operativo lento | Worker in pausa, nessun retry aggressivo |
| Record malformato | Quarantena del record, batch prosegue |
| Parser errato | Raw conservato, derivati rigenerabili |
| Endpoint telemetrico assente | Browser ignora l'errore |
| Fonte meteo assente | Contesto parziale |
| Quota Memoria raggiunta | Raccolta sospesa prima di saturare la VPS |
| Migrazione schema Memoria fallita | Solo worker indisponibile |
| Snapshot fallito | Stato `pending` o `partial`, app invariata |
| Perdita completa della Memoria | Nessun impatto operativo |

## 19. Completezza e trasparenza

La Memoria non promette completezza forense. Promette invece:

- copia affidabile dei dati operativi ancora disponibili;
- raccolta best effort delle informazioni effimere;
- riconciliazione periodica;
- tracciamento esplicito dei buchi;
- distinzione tra fatti e calcoli;
- conservazione del dato originale;
- possibilita di rigenerare i derivati.

Ogni giornata espone internamente un report di copertura:

```text
fonti attese
fonti acquisite
ultimo watermark
record in quarantena
eventi best effort persi o non verificabili
snapshot completo/parziale
```

Non si usa mai `0` per rappresentare un dato mancante. Mancante, zero e non
applicabile devono essere tre stati distinti.

## 20. Struttura del codice proposta

Il worker vive in un package separato, non importato dall'app:

```text
backend/
|-- app/                         applicazione esistente
`-- memory_worker/
    |-- main.py                  entrypoint processo
    |-- config.py                variabili dedicate
    |-- contracts.py             envelope e schema versioni
    |-- sanitize.py              esclusione segreti
    |-- watermarks.py
    |-- integrity.py
    |-- snapshots.py
    |-- sources/
    |   |-- orders.py
    |   |-- report.py
    |   |-- warehouse.py
    |   |-- configuration.py
    |   `-- usage.py
    |-- normalizers/
    |   |-- pasta.py
    |   |-- money.py
    |   |-- beverages.py
    |   `-- warehouse.py
    `-- stores/
        `-- mongo.py
```

Il worker puo duplicare o versionare i parser necessari invece di importare
servizi che hanno side effect applicativi. La priorita e l'isolamento, non evitare
ogni piccola duplicazione.

## 21. Implementazione pratica prevista

L'implementazione futura, pur consegnata come una sola feature completa, segue
questo ordine interno:

1. Congelare questo contratto e creare schemi/versioni.
2. Creare storage Memoria isolato e credenziali dedicate.
3. Implementare worker, watermark, backoff e circuit breaker.
4. Implementare copia raw sanificata e idempotenza.
5. Aggiungere adapter ordini e cancellazioni.
6. Aggiungere adapter Report, cash, spicci e bevande.
7. Aggiungere adapter magazzino, richieste, carichi e DDT strutturati.
8. Aggiungere versioni di configurazioni, prezzi e dizionari.
9. Aggiungere normalizzatori versionati.
10. Valutare sessioni compatte e telemetria best effort dopo il periodo di
    osservazione.
11. Aggiungere contesto calendario; lasciare opzionali le fonti esterne.
12. Implementare snapshot giornalieri e report di copertura.
13. Applicare limiti di processo, connessioni e storage.
14. Eseguire la suite completa su database isolati.
15. Distribuire il worker disattivato.
16. Registrare il momento zero e attivare la raccolta.

Non vengono pubblicate versioni parziali che dichiarano la Memoria completa.

### Stato esecutivo delle Fasi 0-6

Dal 20 luglio 2026 esiste il pacchetto autonomo `backend/memory_worker`.
La Fase 0 ha introdotto contratti versionati, configurazione protetta,
sanificazione, connessioni Mongo ristrette e preflight read-only.

La Fase 1 aggiunge un collector manuale one-shot per il ciclo vita ordini:

- epoch esplicito e immutabile;
- watermark indipendenti per sei sorgenti;
- scansione ciclica di ordini attivi e archivi per intercettare arrivi tardivi;
- raw sanificato e deduplicato tra collection attive e archiviate;
- fatti di stato bitemporali, modifiche e cancellazioni;
- quarantena idempotente dei record malformati;
- lease a scadenza contro due collector ordini concorrenti;
- rifiuto delle credenziali sorgente con scrittura o ruoli ambigui.

Il collector non e un servizio continuo, non e installato sulla VPS e non e
attivo.

La Fase 2 aggiunge un collector manuale one-shot per:

- stato giornaliero della cassa;
- formule monetarie, paste, prezzi manuali e snapshot del dizionario;
- spicci aperti, cassetto e conteggio banconote;
- stato giornaliero e vendite calcolate delle bevande;
- audit delle correzioni Report;
- vendite bevande definitive nell'archivio notturno.

Valori mancanti, invalidi e zero restano distinti. Le formule originali sono
conservate nel raw e l'interpretazione usa regole versionate. Le vendite bevande
ancora attive non vengono acquisite come fatti definitivi perche possono essere
stornate senza un evento di cancellazione.

La Fase 3 aggiunge il collector one-shot del magazzino:

- baseline di prodotti, stock e inventario bevande;
- movimenti stock con prima, delta, dopo e semantica logistica;
- richieste e relativo ciclo di vita;
- carichi e DDT strutturati, con immagini escluse;
- carichi bevande in casse e unita;
- rilevazione delle cancellazioni fisiche soltanto dopo scansioni complete.

La Fase 4 aggiunge il collector one-shot delle configurazioni:

- locali e parametri operativi, senza credenziali o contatori runtime;
- override dei dizionari paste e prezzi in centesimi;
- listino paste default duplicato come regola versionata e testata in parita;
- catalogo bevande e fornitori;
- versioni temporali e reset/cancellazioni rilevati a scansione completa.

La Fase 5 aggiunge gli snapshot giornalieri:

- contesto calendario per ogni giornata chiusa;
- snapshot per locale e snapshot globale del magazzino;
- stato `complete` o `partial` senza inventare valori mancanti;
- gap persistenti che vengono risolti quando la fonte torna disponibile;
- versioni immutabili e provenienza verso fatti, raw e regole;
- controlli di integrita registrati a ogni costruzione.

La Fase 6 aggiunge il runner continuo isolato:

- modalita dry-run esclusivamente read-only;
- collector sequenziali a batch limitati;
- backoff esponenziale e circuit breaker;
- soglie sulla latenza del DB sorgente e sullo storage Memoria;
- snapshot periodici senza code illimitate;
- arresto ordinato;
- template systemd con limiti CPU, RAM e I/O.

Il runner e i template esistono soltanto nel repository. Il servizio non e
installato o attivo sulla VPS e il momento zero reale non e stato scelto.

La configurazione predefinita dichiara sempre:

```text
MEMORY_ENABLED=false
MEMORY_WRITE_ENABLED=false
```

Il backend operativo non importa il pacchetto e non conosce le variabili della
Memoria. I runbook delle fondazioni sono in:

```text
memory/MEMORY_PHASE0_RUNBOOK.md
memory/MEMORY_PHASE1_RUNBOOK.md
memory/MEMORY_PHASE2_RUNBOOK.md
memory/MEMORY_PHASE3_RUNBOOK.md
memory/MEMORY_PHASE4_RUNBOOK.md
memory/MEMORY_PHASE5_RUNBOOK.md
memory/MEMORY_PHASE6_RUNBOOK.md
```

## 22. Test obbligatori

### 22.1 Isolamento

- Backend avviabile e completamente utilizzabile senza worker.
- Backend avviabile con `MEMORY_MONGO_URL` assente o errato.
- Ordini e Report invariati con worker spento.
- Errore storage Memoria non propagato al backend.
- Nessun write del worker sulle collection operative.
- Test statico: nessun servizio operativo importa `memory_worker`.

### 22.2 Acquisizione

- Stop del worker per molte ore e recupero dal watermark.
- Ripetizione dello stesso batch senza duplicati.
- Modifica tardiva rilevata dalla finestra di overlap.
- Dedupe tra ordini attivi e archiviati.
- Record malformato in quarantena senza bloccare il batch.
- Nessun dato precedente al momento zero.
- Nessun segreto nel raw sanificato.

### 22.3 Domini

- Ordine creato, modificato, cancellato e numero riutilizzato.
- Parsing paste con sigle, XL, Altro e parser versionato.
- Report con formule, importi tondi, commenti e forzature Admin.
- Spicci per taglio e confronto in valore monetario.
- Carry-over cash, cassetto e bevande riconoscibile.
- Richiesta creata, modificata, evasa, cancellata e in errore.
- Carico con DDT strutturato e foto esclusa.
- Movimento stock con prima/delta/dopo e causale.
- Configurazione e dizionario cambiati durante un periodo.
- Fatture, versamenti e chiusure assenti dalla Memoria.

### 22.4 Guasti e risorse

- Storage Memoria indisponibile.
- Timeout lettura sorgente.
- Quota disco raggiunta.
- Parser che solleva eccezione.
- Snapshot incompleto.
- Circuit breaker e ripresa successiva.
- Carico elevato: il worker rallenta senza aumentare la latenza operativa.

### 22.5 Utilizzabilita futura

Dimostrare con query isolate che i dati raccolti permettono almeno:

- spicci anno su anno, assoluti e per 1.000 paste;
- composizione paste per locale e periodo;
- confronto tra giorni della settimana omogenei;
- confronto di festivita mobili;
- merce ricevuta da fornitore;
- merce richiesta ed evasa per locale;
- consumo logistico per 1.000 paste;
- tempi medi di evasione richieste;
- ricostruzione di una giornata dallo snapshot e dalle fonti.

## 23. Attivazione

L'attivazione non richiede conversione di Mongo operativo o modifica del reset.

Procedura futura:

1. Verificare prima la stabilita del refactor sulla VPS.
2. Installare storage e worker senza renderli dipendenze del backend.
3. Verificare limiti di CPU, RAM, I/O e disco.
4. Eseguire il test di sola lettura sul DB operativo.
5. Scegliere l'istante ufficiale di attivazione.
6. Creare `memory_epoch` e baseline.
7. Avviare il worker.
8. Verificare watermark e primo snapshot.

La procedura esecutiva, da seguire senza saltare gate o controlli, e in:

```text
memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md
```

Se l'attivazione fallisce, si spegne il worker. L'app non richiede rollback.

## 24. Rollback e dismissione

Rollback immediato:

```text
stop pastasciutta-memory
```

Il backend continua a funzionare. Le eventuali intestazioni frontend opzionali
restano innocue e vengono ignorate.

La Memoria puo essere dismessa eliminando worker e storage senza migrare ordini,
Report o magazzino. Nessun dato operativo deve essere recuperato dalla Memoria.

## 25. Criteri di accettazione finali

La feature e pronta solo se:

- il motto e verificato da test di guasto reali;
- tutti i domini inclusi hanno un adapter e test dedicati;
- tutti i domini esclusi risultano effettivamente assenti;
- originali e normalizzati sono distinguibili e versionati;
- nessun segreto viene copiato;
- il worker recupera dopo downtime senza duplicare;
- snapshot e report di copertura distinguono completo e parziale;
- le query campione producono risultati ricostruibili alle fonti;
- le risorse del worker sono limitate;
- il database operativo non riceve scritture dal worker;
- fermare la Memoria non modifica alcun workflow dell'app.

## 26. Evoluzioni future consentite

Quando saranno disponibili dati sufficienti, senza cambiare le invarianti:

- pagina Memoria con Esplora, Confronta e Chiedi;
- confronti giorni omogenei;
- composizione paste;
- festivita mobili;
- previsioni di paste e fabbisogno;
- suggerimenti riordino;
- Macchina del tempo consultiva;
- funzione `Spiega questo valore`;
- analisi del consumo logistico e teorico;
- assistente in linguaggio naturale con fonti verificabili.

Se la Memoria non e disponibile, queste funzioni possono mostrare `dati analitici
temporaneamente non disponibili`. Non devono mai ripiegare su query pesanti al
database operativo e non devono impedire il lavoro dei locali.

## 27. Piano pratico di implementazione prudente

Questa sezione traduce il progetto in un percorso operativo concreto. La regola
resta: prima raccolta silenziosa e misurata, poi viste e funzioni.

### 27.1 Prima il worker, non la UI

La prima implementazione non deve partire da dashboard, previsioni o pagine
utente. Deve partire da un worker spento e innocuo:

```text
backend/memory_worker/
|-- __main__.py
|-- collector.py
|-- config.py
|-- context.py
|-- contracts.py
|-- preflight.py
|-- runner.py
|-- sanitize.py
|-- snapshots.py
|-- sources/
|   |-- orders.py
|   |-- report.py
|   |-- warehouse.py
|   `-- configuration.py
`-- stores/
    `-- mongo.py
```

Il worker viene installato come servizio separato:

```text
pastasciutta-memory.service
```

Il servizio non deve essere richiesto da `pastasciutta-backend.service`. Se il
worker e spento, l'app continua a funzionare.

### 27.2 Storage separato fin dal nome

Anche se nella prima fase lo storage resta sulla stessa VPS/Mongo, deve usare un
database separato:

```text
pastasciutta          database operativo
pastasciutta_memory   database Memoria
```

Collection minime iniziali:

```text
memory_epochs
memory_watermarks
memory_raw_versions
memory_order_facts
memory_report_facts
memory_warehouse_facts
memory_configuration_versions
memory_context_daily
memory_daily_snapshots
memory_gaps
memory_integrity_runs
memory_quarantine
```

Lo storage separato serve a rendere chiaro che la Memoria puo essere spenta,
spostata o cancellata senza migrare dati operativi.

### 27.3 Attivazione da momento zero

Non fare backfill storico nella prima versione. Si sceglie un istante esplicito,
idealmente dopo il reset notturno e prima del servizio:

```text
activated_at_rome = 2026-xx-xx 06:00 Europe/Rome
```

Da quel momento il worker registra un `memory_epoch` e acquisisce solo una
baseline:

- locali e configurazioni attive;
- dizionari paste e prezzi attivi;
- prodotti e stock corrente;
- eventuali ordini aperti;
- Report del giorno corrente;
- versione backend/frontend.

Tutto cio che precede il momento zero resta fuori dalla Memoria iniziale.

### 27.4 Lettura incrementale a piccoli batch

Ogni sorgente usa un watermark indipendente:

```json
{
  "source": "orders",
  "last_seen_at": "...",
  "last_success_at": "...",
  "status": "ok",
  "lag_seconds": 12
}
```

Regole pratiche:

- poll ogni 30-60 secondi nella fase iniziale;
- batch piccoli, per esempio 50-100 record;
- timeout Mongo brevi;
- nessuna scansione completa durante il servizio;
- finestra di rilettura limitata per modifiche tardive;
- upsert idempotenti;
- backoff progressivo sugli errori;
- stop o pausa automatica se il DB operativo rallenta.

### 27.5 Prime fonti da raccogliere

La prima versione deve raccogliere poche fonti ma buone:

```text
orders
archived_orders
deletion_logs
modification_logs
cash_daily_counts
beverage_daily_counts
cash_audit_log
products
stock_movements
richieste
carichi_magazzino
restaurants
pasta_dictionary
```

Da lasciare fuori all'inizio:

- immagini;
- fatture;
- chiusure fotografate;
- meteo;
- AI o previsioni;
- errori frontend grezzi lunghi;
- heartbeat grezzi.

### 27.6 Raw e normalizzato

Ogni dato utile deve conservare sia originale sia interpretazione:

```json
{
  "raw": {
    "description": "2 CARB 1 AMA XL"
  },
  "normalized": {
    "items": [
      {"type": "carbonara", "qty": 2},
      {"type": "amatriciana", "qty": 1, "size": "xl"}
    ]
  }
}
```

Il raw non viene mai sostituito dal parsing. Se in futuro cambia il parser, i
derivati possono essere rigenerati.

### 27.7 Limiti duri di servizio

Il servizio systemd dovrebbe avere limiti prudenti:

```text
CPUQuota=10%
MemoryMax=256M
Nice=10
IOSchedulingClass=idle
Restart=on-failure
```

Nel codice:

- nessuna coda infinita;
- nessun accumulo RAM illimitato;
- circuit breaker;
- batch massimo configurabile;
- quota giornaliera storage;
- log chiari su lag, errori e quarantena.

Se la Memoria appesantisce l'app operativa, si ferma la Memoria. Non si rallenta
il lavoro dei locali.

### 27.8 Snapshot giornaliero

Dopo il reset notturno, o quando la giornata risulta consolidata, il worker crea
uno snapshot per locale:

```text
Flaminio - 2026-07-16
paste totali
paste per tipo
cash
bevande
scarti
ordini cancellati/modificati
stock mosso
richieste/DDT
dati mancanti o ambigui
```

Lo snapshot serve alle analisi future. Non serve al backend operativo per
rispondere a ordini, Report o magazzino.

### 27.9 Rollout consigliato

Ordine pratico:

1. Implementare worker in locale.
2. Testarlo su Mongo locale copiato o isolato.
3. Installarlo sulla VPS spento.
4. Avviarlo in dry-run/log only.
5. Attivare scrittura su `pastasciutta_memory`.
6. Controllare per 24-48 ore peso, lag, errori, quarantena e impatto Mongo.
7. Solo dopo valutare una pagina tecnica minima.

La prima pagina non deve essere una dashboard analitica, ma solo uno stato
tecnico:

```text
Memoria: attiva
Ultimo batch: ok
Lag: 12s
Record quarantena: 0
Ultimo snapshot: completo
Peso DB memoria: 84 MB
```

Le funzioni visibili all'utente arrivano solo quando raccolta, limiti e rollback
sono dimostrati.

## 28. Decisione architetturale finale

La Memoria viene progettata come osservatore isolato e ricostruibile, non come
event store autorevole dell'applicazione.

Si privilegiano:

- disponibilita dell'app rispetto alla completezza forense;
- raw data rispetto ad aggregati irreversibili;
- trasparenza dei gap rispetto a dati inventati;
- processi separati rispetto a dipendenze sincrone;
- raccolta recuperabile rispetto a code fragili;
- dati strutturati rispetto a immagini e documenti pesanti;
- compatibilita futura rispetto a previsioni premature.

La regola di arresto resta sempre la stessa:

> Raccogliere piu dati possibile, fino al punto immediatamente precedente a quello
> in cui un guasto della Memoria potrebbe danneggiare o bloccare l'applicazione.

## 29. Capacita avanzate approvate

Replay, modalita ombra, grafo di provenienza, tempo bitemporale, gemello digitale,
previsioni, anomalie e assistente con fonti sono progettati separatamente in:

```text
memory/OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES.md
```

Il primo worker deve predisporre tempi, versioni, qualita e relazioni necessari
a queste evoluzioni, ma nessuna capacita avanzata puo indebolire gli invarianti
di isolamento definiti in questo documento.
