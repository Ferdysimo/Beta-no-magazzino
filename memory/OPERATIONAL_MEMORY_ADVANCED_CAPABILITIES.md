# Capacita avanzate della Memoria operativa

Ultimo aggiornamento: 2026-07-20

Stato: progettazione approvata; fondazioni Fasi 0-6 implementate e collaudate
localmente, servizio non installato, capacita avanzate non implementate

Documento base:

```text
memory/OPERATIONAL_MEMORY_DESIGN.md
```

Questo documento definisce che cosa potra diventare la Memoria dopo che il
worker isolato, lo storage separato e la raccolta dal momento zero saranno stati
dimostrati affidabili.

Le capacita avanzate non modificano il principio fondamentale:

> La Memoria puo fallire senza trascinare con se l'applicazione.

## 1. Rapporto con il progetto base

`OPERATIONAL_MEMORY_DESIGN.md` resta il contratto autoritativo per:

- isolamento dal backend operativo;
- fonti incluse ed escluse;
- worker, storage, watermark e snapshot;
- limiti di risorse;
- attivazione, rollback e dismissione;
- matrice dei guasti.

Questo documento aggiunge capacita costruite sopra i dati raccolti. In caso di
conflitto, vince sempre la regola piu prudente del progetto base.

Nessuna funzione avanzata puo:

- scrivere nelle collection operative;
- diventare necessaria per login, ordini, Report, magazzino o mezzanotte;
- eseguire automaticamente correzioni o decisioni operative;
- ripiegare su query pesanti al database operativo;
- nascondere dati mancanti, ambigui o ricostruiti;
- presentare una previsione come fatto certo.

## 2. Capacita approvate

### 2.1 Tempo bitemporale

Ogni fatto deve distinguere almeno:

```text
occurred_at       quando il fatto e avvenuto nel lavoro reale
captured_at       quando la Memoria lo ha acquisito
valid_from        da quando il valore era considerato valido
valid_to          quando e stato sostituito, se applicabile
business_date     giornata operativa Europe/Rome
```

Esempio: una correzione eseguita il 18 luglio sul Report del 17 luglio appartiene
alla giornata del 17, ma la Memoria deve sapere che prima del 18 quel valore non
era ancora conosciuto.

Questo permette di rispondere a due domande diverse:

```text
Qual e oggi il valore corretto del 17 luglio?
Cosa risultava alle 08:00 del 18 luglio?
```

Le versioni precedenti non vengono sovrascritte.

### 2.2 Grafo di provenienza

Ogni valore derivato deve poter indicare le proprie fonti:

```text
valore finale
<- formula e versione
<- record sorgente
<- configurazione applicabile
<- eventuale correzione
<- autore, dispositivo e versione app quando disponibili
```

Le relazioni devono usare identificativi stabili, non copie testuali fragili.
Il grafo puo collegare:

- cash mattina e cash sera precedente;
- paste, ordini, prezzi e totale paste;
- bevande mattina, ingressi, sera, scarti e vendite;
- stock, carichi, richieste, DDT e movimenti;
- snapshot giornalieri e record sorgente;
- risultati di replay, modalita ombra e previsioni.

Il grafo non diventa fonte di verita. E un indice ricostruibile sopra i dati raw.

### 2.3 Spiega questo valore

Sopra il grafo di provenienza viene costruita una funzione consultiva:

```text
Spiega questo valore
```

La risposta deve mostrare:

- valore richiesto e unita;
- formula applicata;
- dati sorgente;
- versione della regola;
- riporti automatici;
- forzature e correzioni;
- buchi o ambiguita;
- collegamenti ai record e alle giornate utilizzate.

Non deve mostrare soltanto JSON tecnico. Deve produrre una spiegazione umana
verificabile e consentire di aprire le fonti.

### 2.4 Motore di replay

Il replay ricalcola una giornata o un intervallo usando una versione scelta
delle regole, senza modificare i risultati originali.

Esempi:

- ricalcolare cash sera con un nuovo valutatore;
- confrontare due formule degli spicci;
- riprovare il riconoscimento delle paste con un parser nuovo;
- verificare un cambiamento nel calcolo bevande;
- controllare una futura correzione dell'Excel.

Ogni esecuzione salva:

```text
replay_id
periodo e locali
regole originali
regole candidate
fonti e relative versioni
risultato originale
risultato ricalcolato
differenze
errori, gap e copertura
```

Il replay legge soltanto lo storage Memoria. Un replay fallito non cambia dati
operativi e puo essere cancellato e rigenerato.

### 2.5 Modalita ombra

Una regola candidata puo essere eseguita in parallelo alla regola corrente:

```text
regola corrente   resta autoritativa nell'app
regola candidata  produce risultati soltanto nella Memoria
```

La modalita ombra misura:

- quante volte i risultati coincidono;
- differenza assoluta e percentuale;
- locali e giornate coinvolti;
- casi limite;
- errori e prestazioni;
- impatto potenziale sugli export.

Non e consentito promuovere automaticamente una regola candidata. La decisione
resta umana e il deploy segue i normali test dell'applicazione.

### 2.6 Gemello digitale consultivo

La Memoria puo costruire un modello osservativo di ogni locale:

- produzione tipica per giorno e fascia oraria;
- composizione delle paste;
- andamento cash e spicci;
- bevande, scarti e stock;
- merce richiesta e ricevuta;
- stagionalita e festivita;
- configurazione e versione applicativa.

Il gemello digitale non controlla il locale. Serve a:

- confrontare giornate omogenee;
- simulare volumi plausibili;
- stimare fabbisogni;
- osservare l'effetto di prezzi e configurazioni gia presenti nei dati;
- alimentare previsioni e scenari.

Le simulazioni devono riportare fonti, periodo usato e livello di incertezza.

### 2.7 Previsioni con confronto tra modelli

La Memoria puo eseguire piu metodi di previsione in parallelo:

```text
media di giornate omogenee
stagionalita settimanale
stagionalita annuale
modello festivita
modello statistico
modello machine learning
```

Ogni previsione conserva:

- versione del modello;
- feature e intervallo storico utilizzati;
- valore previsto;
- intervallo di confidenza;
- risultato effettivo quando disponibile;
- errore assoluto e percentuale;
- condizioni in cui il modello e risultato affidabile.

La scelta del modello migliore puo essere automatica per locale e tipo di
giornata, ma l'output resta consultivo.

La valutazione usa backtesting temporale: un modello non puo essere premiato
usando informazioni che al momento della previsione non erano ancora note.

### 2.8 Incertezza esplicita

Ogni previsione, ricostruzione o dato derivato deve esporre:

```text
valore
intervallo plausibile
confidence
coverage delle fonti
qualita
assunzioni
dati mancanti
```

Un singolo numero senza contesto non e un output accettabile per una funzione
predittiva.

La confidence non deve essere inventata. Deve derivare da copertura dei dati,
errore storico del modello, quantita di giornate confrontabili e stabilita delle
fonti.

### 2.9 Rilevamento anomalie personalizzato

Le anomalie vengono valutate rispetto al comportamento normale del singolo
locale e di giornate comparabili.

Esempi:

- scarti incompatibili con giornate simili;
- cash distante dalle paste e bevande registrate;
- variazione improvvisa della composizione paste;
- merce inviata incoerente con i consumi logistici osservati;
- cassetto spicci con variazione insolita;
- correzioni manuali molto piu frequenti del normale;
- fonte dati improvvisamente silenziosa.

Ogni anomalia deve indicare:

- cosa e insolito;
- baseline usata;
- scostamento;
- affidabilita;
- fonti;
- possibili spiegazioni, dichiarate come ipotesi.

La Memoria non blocca operazioni e non accusa utenti. Segnala un dato da
controllare.

### 2.10 Assistente con fonti verificabili

Un assistente futuro puo rispondere in linguaggio naturale a domande sui dati
della Memoria.

Esempi:

```text
Perche Flaminio ha prodotto meno paste questo mese?
Quanto sono aumentati gli spicci rispetto all'anno scorso?
Quali sabati sono realmente confrontabili?
Da dove proviene questo cash mattina?
Quanta merce e stata inviata a ogni locale?
```

Ogni risposta deve:

- interrogare soltanto lo storage Memoria;
- citare snapshot, giornate e record utilizzati;
- distinguere fatti, calcoli e ipotesi;
- dichiarare dati mancanti;
- permettere di aprire il dettaglio;
- rifiutare una conclusione quando la copertura non basta.

L'assistente non riceve credenziali operative e non puo eseguire comandi
sull'applicazione.

### 2.11 Consapevolezza della qualita

La Memoria deve sapere che cosa non sa.

Per ogni locale, giorno e dominio mantiene:

- fonti attese e fonti ricevute;
- watermark e ritardo;
- record in quarantena;
- versioni mancanti;
- parser incerti;
- correzioni tardive;
- snapshot parziali;
- periodi non confrontabili;
- motivi per cui una previsione e debole.

Le funzioni avanzate devono poter rispondere:

```text
Dato completo
Dato parziale
Dato ricostruito
Dato non disponibile
Confronto non affidabile
```

Non devono colmare un buco con un valore plausibile presentandolo come reale.

## 3. Requisiti da predisporre dal momento zero

Le capacita avanzate verranno implementate piu avanti, ma il primo worker deve
gia raccogliere i mattoni necessari.

Ogni record utile deve prevedere:

```text
epoch_id
source_collection
source_id
source_hash
occurred_at_utc
captured_at_utc
business_date_rome
valid_from_utc
valid_to_utc
schema_version
parser_version
evaluator_version
rule_version
quality
confidence, se calcolabile
raw
normalized
relations
```

Regole:

- raw immutabile e sempre conservato;
- nuove interpretazioni creano nuove versioni;
- importi normalizzati in centesimi o Decimal;
- timestamp UTC con giornata di business Roma separata;
- relazioni ricostruibili e versionate;
- nessun campo avanzato e obbligatorio per il backend operativo;
- record incompleti vanno in quarantena o restano `partial`, non bloccano batch.

## 4. Componenti futuri separati

Struttura orientativa:

```text
backend/memory_worker/
|-- sources/
|-- stores/
|-- normalization/
|-- snapshots/
|-- quality/
|-- provenance/
|-- replay/
|-- shadow/
|-- forecasting/
|-- anomalies/
`-- assistant/
```

I moduli avanzati dipendono dal nucleo Memoria. Il nucleo di raccolta non
dipende da replay, previsioni, anomalie o assistente.

Quindi:

```text
collector -> storage -> funzioni avanzate
collector -X-> dipendenza da funzioni avanzate
applicazione -X-> dipendenza dalla Memoria
```

## 5. Ordine di realizzazione

### Fase A - Fondazioni

- Worker isolato e storage `pastasciutta_memory`.
- Momento zero, raw, normalizzato, versioni e watermarks.
- Campi bitemporali e relazioni sorgente.
- Snapshot giornalieri, gap, quarantena e report di copertura.
- Dry-run e osservazione per 24-48 ore.

Il codice locale delle fondazioni e completo. Storage e credenziali reali,
momento zero, dry-run VPS e osservazione richiedono il rollout manuale e non
sono ancora stati eseguiti. Le Fasi B-E non iniziano prima di tale osservazione.

### Fase B - Verificabilita

- Grafo di provenienza.
- `Spiega questo valore`.
- Motore di replay.
- Modalita ombra per formule e parser.

Questa fase viene prima delle previsioni: il sistema deve saper spiegare e
ricalcolare i dati prima di tentare di prevederli.

### Fase C - Intelligenza descrittiva

- Confronti tra giornate omogenee.
- Consapevolezza della qualita.
- Rilevamento anomalie personalizzato.
- Gemello digitale consultivo.

### Fase D - Intelligenza predittiva

- Pipeline di feature versionate.
- Modelli concorrenti.
- Backtesting temporale.
- Intervalli di incertezza.
- Monitoraggio dell'errore dopo il risultato reale.

### Fase E - Interfaccia intelligente

- Assistente in linguaggio naturale.
- Risposte con fonti e livello di affidabilita.
- Navigazione verso Macchina del tempo e `Spiega questo valore`.

Nessuna fase richiede l'attivazione automatica della successiva.

## 6. Limiti di sicurezza e autonomia

Le capacita avanzate sono esclusivamente consultive.

Non possono:

- cambiare prezzi;
- correggere Report;
- creare o cancellare ordini;
- rettificare stock;
- inviare richieste merce;
- modificare account o ruoli;
- eseguire deploy;
- nascondere dati originali;
- promuovere una formula in produzione;
- prendere decisioni economiche senza conferma umana.

Il controllo operativo piu forte resta:

```text
systemctl stop pastasciutta-memory
```

Dopo lo stop:

- l'app continua a funzionare;
- il backend non cambia comportamento;
- i dati operativi non richiedono migrazioni;
- le pagine avanzate mostrano indisponibilita;
- al riavvio il worker recupera dal watermark, nei limiti delle fonti disponibili.

## 7. Esclusioni approvate

Non viene aggiunto un dizionario semantico esteso con ricette, ingredienti o
nuove tassonomie gestite manualmente.

E ammessa una grammatica compatta, tecnica e versionata per le annotazioni paste:
interpreta soltanto codici confermati e costruzioni letterali, conserva i
frammenti sconosciuti e puo essere ricalcolata dal raw. Non diventa un vocabolario
gestionale da mantenere a mano e non trasforma ipotesi in fatti.

I dizionari paste e prezzi gia presenti nell'app restano fonti necessarie e
vengono versionati come configurazione osservata, senza trasformarli in un nuovo
sistema gestionale.

Non viene creato un registro manuale di esperimenti aziendali, promozioni, cambi
responsabile o annotazioni simili.

Calendario, festivita e contesto esterno best effort gia previsti dal progetto
base possono restare, perche non richiedono una gestione manuale continua.

## 8. Test obbligatori

- Una correzione tardiva mantiene sia il valore precedente sia quello nuovo.
- Una query temporale ricostruisce correttamente cosa era noto a un istante.
- Ogni valore spiegato elenca fonti e regole reali.
- Il replay non scrive mai nelle collection operative.
- La modalita ombra non modifica il risultato mostrato dall'app.
- Un parser nuovo puo rigenerare derivati partendo dal raw.
- Backtesting e previsioni non usano informazioni future.
- Ogni previsione espone intervallo, copertura e dati mancanti.
- Un'anomalia indica baseline e scostamento, non soltanto un allarme.
- L'assistente cita fonti e rifiuta risposte senza copertura sufficiente.
- Spegnere worker, replay, modelli o assistente non cambia l'app.
- Saturazione, crash o storage pieno fermano la Memoria prima di impattare Mongo.

## 9. Criteri di accettazione

Il progetto avanzato e accettabile soltanto se:

1. la raccolta base e stabile e misurata;
2. i dati raw sono conservati e versionati;
3. tempi, fonti e qualita sono ricostruibili;
4. replay e modalita ombra sono completamente isolati;
5. previsioni e anomalie sono verificabili;
6. nessuna funzione avanzata scrive nell'app;
7. ogni output distingue fatto, calcolo, previsione e ipotesi;
8. ogni componente puo essere spento separatamente;
9. la perdita totale della Memoria non richiede recovery dell'app operativa.

La Memoria diventa potente perche puo rileggere, spiegare, confrontare e
simulare. Non diventa potente acquisendo controllo sull'applicazione.
