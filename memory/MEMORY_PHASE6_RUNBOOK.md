# Memoria operativa - Runbook Fase 6

Data: 2026-07-20

Stato:

```text
runner continuo implementato e collaudato in locale
template systemd ed env preparati ma non installati
servizio disabilitato
momento zero reale non registrato
VPS non modificata
backend e frontend operativi non dipendono dalla Memoria
```

Contratto autoritativo:

```text
memory/OPERATIONAL_MEMORY_DESIGN.md
```

Procedura esecutiva VPS:

```text
memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md
```

## Obiettivo

La Fase 6 esegue in sequenza i collector e gli snapshot con protezioni che
privilegiano sempre l'applicazione operativa.

```bash
cd backend
python -m memory_worker run
```

## Modalita

`dry-run` esegue soltanto il preflight read-only. Richiede:

```text
MEMORY_ENABLED=true
MEMORY_DRY_RUN=true
MEMORY_WRITE_ENABLED=false
```

La modalita attiva richiede inoltre momento zero esplicito e doppio consenso:

```text
MEMORY_ENABLED=true
MEMORY_DRY_RUN=false
MEMORY_WRITE_ENABLED=true
MEMORY_ACTIVATION_EPOCH_UTC=...
```

`MEMORY_DRY_RUN=true` e scritture attive sono incompatibili per costruzione.

## Protezioni runtime

Prima di ogni ciclo il runner verifica:

- latenza del Mongo sorgente;
- raggiungibilita del Mongo Memoria;
- spazio usato dal database Memoria;
- configurazione e ruoli delle connessioni.

Se un controllo o un collector fallisce:

- l'errore resta confinato nel processo Memoria;
- il ciclo termina senza chiamare il backend operativo;
- il ritardo cresce con backoff esponenziale limitato;
- dopo la soglia configurata il circuit breaker applica la pausa massima;
- un ciclo successivo puo recuperare normalmente.

Non esistono code illimitate o accumuli di batch in RAM. I collector vengono
eseguiti in sequenza per mantenere basso il carico.

Dopo un fermo di piu giorni, gli snapshot recuperano prima la giornata mancante
piu vecchia dal momento zero, una per intervallo. Terminato il recupero, il
runner torna a ricontrollare l'ultima giornata chiusa per eventuali correzioni.

## Limiti configurabili

```text
MEMORY_POLL_SECONDS=60
MEMORY_BATCH_SIZE=50
MEMORY_MAX_BACKOFF_SECONDS=900
MEMORY_CIRCUIT_BREAKER_FAILURES=5
MEMORY_MAX_SOURCE_LATENCY_MS=500
MEMORY_MAX_STORAGE_MB=1024
MEMORY_SNAPSHOT_INTERVAL_SECONDS=900
```

I limiti accettati dal codice sono deliberatamente contenuti e i timeout Mongo
sono brevi.

## Template VPS

Sono disponibili, ma non applicati:

```text
deploy/memory.env.example
deploy/pastasciutta-memory.service.example
```

Il template systemd:

- non e una dipendenza di `pastasciutta-backend.service`;
- usa `CPUQuota=10%`, `MemoryMax=256M`, `Nice=10`;
- assegna priorita I/O idle;
- riparte soltanto in caso di errore;
- parte con configurazione dry-run e scritture disabilitate.

Le credenziali vere non devono essere inserite nel repository.

## Collaudo

I test verificano:

- dry-run privo di scritture;
- rifiuto delle combinazioni di switch pericolose;
- arresto dopo segnale;
- backoff progressivo e tetto massimo;
- apertura del circuit breaker;
- recupero dopo indisponibilita temporanea;
- blocco per latenza o storage oltre soglia;
- ciclo reale isolato con collector e snapshot;
- database sorgente immutato.

## Confine delle operazioni manuali

Il codice locale termina qui. La sequenza completa, i comandi, i gate SCRAM,
le verifiche e il rollback sono nel runbook VPS dedicato. In sintesi servono:

1. backup e verifica dello spazio;
2. utente Mongo read-only per `pastasciutta`;
3. utente Mongo read-write limitato a `pastasciutta_memory`;
4. utente Linux dedicato;
5. file env root-only fuori dal repository;
6. installazione del servizio ancora disabilitato;
7. scelta del momento zero;
8. dry-run osservato e successiva attivazione deliberata;
9. osservazione per 24-48 ore di lag, errori, quarantena e impatto.

Queste operazioni non sono state eseguite.

## Arresto e rollback

```bash
sudo systemctl stop pastasciutta-memory
sudo systemctl disable pastasciutta-memory
```

Il backend non va riavviato e non richiede rollback. La Memoria puo essere
spenta o eliminata senza modificare i workflow operativi.
