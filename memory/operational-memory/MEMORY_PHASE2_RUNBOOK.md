# Memoria operativa - Runbook Fase 2

Data: 2026-07-20

Stato:

```text
collector ordini one-shot implementato in locale
collector Report one-shot implementato in locale
raccolta continua non implementata
momento zero reale non registrato
VPS non modificata
backend e frontend operativi non dipendono dalla Memoria
```

Contratto autoritativo:

```text
memory/operational-memory/OPERATIONAL_MEMORY_DESIGN.md
```

## Obiettivo

La Fase 2 acquisisce e versiona i dati del Report senza eseguire formule,
letture o scritture nel percorso operativo dell'applicazione.

Il nuovo comando processa un piccolo batch per sorgente e termina. Non viene
avviato da FastAPI, non e un daemon e non e configurato in systemd.

## Sorgenti incluse

```text
cash_daily_counts
beverage_daily_counts
cash_audit_log
archived_beverage_sales
```

`beverage_sales` attivo e intenzionalmente escluso. Una vendita attiva puo essere
stornata con cancellazione fisica e senza log dedicato; copiarla prima della
chiusura produrrebbe un falso storico. La vendita diventa un fatto definitivo
solo dopo il passaggio in `archived_beverage_sales` a mezzanotte.

## Cassa giornaliera

Ogni versione conserva e normalizza:

- formule originali di cash mattina, altro, piattaforme, POS, versamenti e arrivi;
- valore di ogni formula e stato `valid`, `missing` o `invalid`;
- spicci aperti per taglio, valore per taglio e totale;
- rotolini nel cassetto, aperti e residui;
- conteggio banconote e monete;
- testo paste originale;
- riconoscimento paste con la stessa regola del Report;
- prezzi manuali e snapshot del dizionario applicabile;
- riporti automatici di cash mattina e cassetto;
- commenti e flag di forzatura.

Gli importi normalizzati sono centesimi interi. Il raw originale resta sempre
disponibile per ricalcoli futuri con una nuova versione delle regole.

La Fase 2 salva `cash_before_beverages_cents`, composto da base cassa, spicci e
paste. Non lo presenta come cash sera completo: il totale finale richiede tutte
le righe bevande della stessa giornata e verra consolidato dagli snapshot
giornalieri di una fase successiva.

## Bevande giornaliere

Per locale, data e sigla vengono conservati:

- magazzino mattina;
- ingressi e uscite;
- scarti;
- magazzino sera;
- casse e unita sfuse;
- confronto tra totale diretto e casse per 24 piu sfuse;
- quantita venduta con la formula operativa;
- prezzo catalogo versionato e incasso in centesimi;
- carry automatico e commenti;
- campi mancanti, invalidi o incoerenti.

La versione 1 incorpora il catalogo attuale:

```text
AL AG C CZ F S B VB VR
```

Una sigla sconosciuta viene conservata, ma il prezzo e l'incasso restano
indisponibili e il fatto viene marcato come parziale.

## Audit e vendite definitive

Ogni evento di audit conserva:

- locale e giornata Report;
- categoria e campo;
- valore precedente e nuovo;
- ruolo, utente e impersonificazione;
- primo e ultimo timestamp;
- conteggio modifiche.

Le vendite bevande archiviate conservano quantita, prezzo unitario, totale,
autore e controllo aritmetico tra quantita per prezzo e totale.

## Tempo, versioni e qualita

Gli stati cassa e bevanda sono bitemporali. Una correzione chiude la versione
precedente e ne apre una nuova; un ritorno a un valore gia visto crea comunque
un nuovo intervallo temporale.

Il collaudo della Fase 2 ha corretto la connessione Mongo impostandola
`tz_aware=True`. Senza questa opzione Mongo restituiva l'epoch senza fuso e il
sistema locale poteva reinterpretarlo con uno scostamento di due ore.

Le righe giornaliere del giorno del momento zero sono una baseline dello stato
corrente e possono contenere lavoro svolto prima dell'istante preciso. Audit e
vendite definitive, invece, sono filtrati dall'istante UTC esatto.

## Comandi

Stato inerte:

```bash
cd backend
python -m memory_worker status
```

Preflight senza scritture:

```bash
python -m memory_worker preflight
```

Un batch ordini:

```bash
python -m memory_worker collect-orders-once
```

Un batch Report:

```bash
python -m memory_worker collect-report-once
```

I comandi di raccolta restano riservati a database isolati finche il rollout non
viene approvato.

## Guardie

Restano obbligatori:

```text
MEMORY_ENABLED=true
MEMORY_WRITE_ENABLED=true
MEMORY_ACTIVATION_EPOCH_UTC=<istante ISO esplicito>
SOURCE_DB_NAME diverso da MEMORY_DB_NAME
credenziale sorgente verificata come sola lettura
credenziale destinazione con scrittura sul solo DB Memoria
```

Ogni collector usa un lease distinto. Due raccolte Report concorrenti vengono
rifiutate. Record malformati vanno in quarantena e non bloccano il batch.

`MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=true` resta consentito soltanto nei test
locali senza autenticazione.

## Collaudo Fase 2

I test verificano:

- parita delle formule realistiche con il Report operativo;
- distinzione tra dato mancante, invalido e zero;
- paste riconosciute, manuali, XL e prezzi mancanti;
- spicci, cassetto e banconote;
- casse, sfuse, scarti, vendite e incasso bevande;
- sigle sconosciute e componenti incoerenti;
- audit e attori;
- esclusione delle vendite provvisorie;
- esclusione di dati precedenti al momento zero;
- correzioni tardive e ritorno a valori precedenti;
- arrivi tardivi nell'archivio vendite;
- idempotenza, lock, quarantena e sorgente immutata;
- assenza di regressioni nel collector ordini.

## Limiti dichiarati

- Nessuna raccolta continua o ripresa automatica.
- Nessuno snapshot giornaliero o cash sera consolidato.
- Nessun adapter magazzino, richieste, DDT o configurazioni.
- Nessun circuit breaker, metrica, quota o limite systemd.
- Il catalogo bevande e versionato nel worker ma non ancora acquisito come
  configurazione osservata.
- Le righe malformate restano in quarantena finche la fonte non viene corretta.

## Rollback

Il rollback operativo consiste nel non eseguire i comandi. Il backend non
conosce il worker e continua a funzionare anche se la Memoria e assente,
irraggiungibile o completamente rimossa.

Non installare ancora un servizio systemd e non attivare gli interruttori sulla
VPS.
