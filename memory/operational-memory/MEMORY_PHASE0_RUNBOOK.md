# Memoria operativa - Runbook Fase 0

Data: 2026-07-20

Documento storico della fondazione inerte. Lo stato corrente della Fase 1 e in:

```text
memory/operational-memory/MEMORY_PHASE1_RUNBOOK.md
```

Stato:

```text
fondazione locale implementata
collector non implementato
raccolta non attiva
VPS non modificata
```

Collaudo locale:

```text
90 test backend passati
preflight read-only riuscito
writes_performed: 0
database Memoria non creato
```

Contratto autoritativo:

```text
memory/operational-memory/OPERATIONAL_MEMORY_DESIGN.md
```

## Obiettivo

La Fase 0 rende verificabili configurazione e isolamento prima di raccogliere un
solo dato. Il pacchetto `backend/memory_worker` e autonomo e non viene importato
dal backend FastAPI.

Non sono presenti:

- servizio systemd;
- endpoint;
- epoch di attivazione;
- watermark;
- scritture nello storage Memoria;
- adapter dei domini;
- modifiche al Mongo operativo.

## Comandi disponibili

Stato sicuro, senza connessioni:

```bash
cd /opt/pastasciutta/backend
source venv/bin/activate
python -m memory_worker status
```

Il risultato deve contenere:

```text
phase: 0
collector_implemented: false
collection_active: false
enabled: false
write_enabled: false
```

Preflight esclusivamente in lettura:

```bash
SOURCE_MONGO_URL='mongodb://...' \
SOURCE_DB_NAME='pastasciutta' \
MEMORY_MONGO_URL='mongodb://...' \
MEMORY_DB_NAME='pastasciutta_memory' \
python -m memory_worker preflight
```

Il preflight:

- esegue ping delle due connessioni;
- elenca le collection sorgente previste;
- legge conteggi stimati, senza scansioni complete;
- prova a classificare i ruoli Mongo;
- segnala credenziali sorgente con privilegi di scrittura;
- non crea database, collection o indici;
- dichiara sempre `writes_performed: 0`;
- non stampa username o password delle URI Mongo.

## Interruttori

La configurazione prevede due interruttori separati:

```text
MEMORY_ENABLED
MEMORY_WRITE_ENABLED
```

Le scritture richiederanno entrambi a `true` e un
`MEMORY_ACTIVATION_EPOCH_UTC` esplicito. La Fase 0 non offre comunque alcun
comando di raccolta o metodo di persistenza.

Non impostare questi valori sulla VPS durante la Fase 0.

## Limiti incorporati

```text
poll minimo       30 secondi
batch massimo     100 documenti
overlap massimo   3600 secondi
timeout Mongo     massimo 10 secondi
```

I valori predefiniti sono piu prudenti:

```text
poll              60 secondi
batch             50 documenti
overlap           300 secondi
timeout Mongo     2500 ms
```

## Sanificazione

La sanificazione versione 1 rimuove ricorsivamente almeno:

- password e hash;
- token, cookie e authorization header;
- segreti e credenziali;
- immagini e riferimenti alle fotografie;
- dati binari.

Il documento originale passato al sanificatore non viene modificato. Il
risultato conserva l'elenco dei percorsi rimossi e dei testi eventualmente
troncati.

## Condizione per la Fase 1

Prima di implementare epoch, watermark e primo adapter ordini occorre decidere:

1. storage `pastasciutta_memory`;
2. utente Mongo sorgente con ruolo `read` sul solo DB operativo;
3. utente Mongo Memoria con `readWrite` sul solo DB Memoria;
4. policy di spazio e retention;
5. istante futuro del momento zero.

Nessuna di queste decisioni viene applicata dalla Fase 0.

## Rollback

Non esiste un rollback operativo perche il backend non usa la Fase 0. Per
disattivarla basta non eseguire `python -m memory_worker`. Rimuovere il pacchetto
non richiede migrazioni o modifiche ai dati dell'app.
