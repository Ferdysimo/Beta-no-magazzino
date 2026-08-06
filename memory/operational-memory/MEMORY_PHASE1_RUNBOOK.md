# Memoria operativa - Runbook Fase 1

Data: 2026-07-20

Documento storico del collector ordini. Lo stato corrente della Fase 2 e in:

```text
memory/operational-memory/MEMORY_PHASE2_RUNBOOK.md
```

Stato:

```text
collector ordini one-shot implementato in locale
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

La Fase 1 dimostra su Mongo isolato che la Memoria puo acquisire il ciclo vita
degli ordini senza scrivere nel database operativo e senza diventare una
dipendenza dell'applicazione.

Il comando disponibile esegue un solo piccolo batch per sorgente e termina. Non
e un daemon, non viene avviato da FastAPI e non e configurato in systemd.

## Sorgenti incluse

```text
orders
archived_orders
deletion_logs
archived_deletion_logs
modification_logs
archived_modification_logs
```

`orders` viene riletto ciclicamente perche i documenti attivi cambiano senza un
`updated_at` affidabile. Anche gli archivi vengono scansionati a rotazione, con
deduplicazione, per non perdere documenti inseriti dopo che il loro timestamp
era gia stato superato. Gli archivi escludono i fatti precedenti al momento zero.

## Dati prodotti

```text
memory_epochs
memory_collector_leases
memory_watermarks
memory_raw_versions
memory_order_facts
memory_quarantine
```

Il raw viene sanificato prima della scrittura. Password, token, immagini,
credenziali e binari non vengono copiati. Un hash canonico evita di salvare due
volte la stessa versione osservata nelle collection attive e archiviate.

Gli stati ordine sono bitemporali. Una sequenza `A -> B -> A` conserva tre fatti:
il secondo stato `A` riusa lo stesso raw del primo, ma apre un nuovo intervallo
temporale. Modifiche e cancellazioni restano eventi immutabili separati.

I record malformati finiscono in quarantena e non bloccano il resto del batch.

## Guardie di attivazione

La raccolta richiede tutte queste condizioni:

```text
MEMORY_ENABLED=true
MEMORY_WRITE_ENABLED=true
MEMORY_ACTIVATION_EPOCH_UTC=<istante ISO esplicito>
SOURCE_DB_NAME diverso da MEMORY_DB_NAME
credenziale sorgente verificata come sola lettura
credenziale destinazione con scrittura sul solo DB Memoria
```

Ruoli Mongo sconosciuti o ambigui vengono rifiutati. La variabile:

```text
MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES=true
```

esiste esclusivamente per Mongo locali di test senza autenticazione. Non deve
essere usata sulla VPS.

Un lease di 15 minuti impedisce due esecuzioni contemporanee del collector
ordini. Il lease viene rimosso a fine comando e scade automaticamente dopo un
crash.

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

Raccolta manuale di un batch, da usare soltanto con database isolati finche non
viene approvato il rollout:

```bash
python -m memory_worker collect-orders-once
```

Le variabili Mongo non vengono mostrate nei log con username o password.

## Limiti noti e dichiarati

- Non esiste ancora una raccolta continua o un recupero automatico.
- Ogni comando processa al massimo 100 documenti per sorgente.
- Report, cash, spicci, bevande, magazzino e configurazioni non sono acquisiti.
- Gli ordini attivi non espongono l'istante esatto di ogni cambio stato: viene
  conservato l'istante di osservazione della Memoria.
- I log modifica non espongono la data originale dell'ordine: la qualita del
  fatto dichiara che la giornata usa l'istante della modifica.
- Un ordine precedente al momento zero viene acquisito solo come baseline se e
  ancora attivo. La Fase 1 non ricostruisce il suo passato.
- Non sono ancora presenti circuit breaker, metriche, snapshot giornalieri,
  report di copertura o limiti systemd.

## Collaudo Fase 1

Il test Mongo isolato verifica:

- doppio interruttore ed epoch;
- sorgente immutata;
- segreti esclusi dal raw;
- dedupe tra attivo e archivio;
- record malformato in quarantena;
- stato `A -> B -> A`;
- ordine arrivato tardi in archivio;
- idempotenza di esecuzioni ripetute;
- rifiuto del secondo collector concorrente;
- rimozione di lease e database temporanei.

## Rollback

Il rollback operativo consiste nel non eseguire il comando. Il backend non
conosce il worker e continua a funzionare anche se configurazione, storage o
collector Memoria sono assenti.

Non installare ancora un servizio systemd e non impostare gli interruttori sulla
VPS. Il rollout verra progettato separatamente e partira con worker installato ma
spento.
