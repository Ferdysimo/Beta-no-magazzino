# Memoria operativa - Runbook Fase 4

Data: 2026-07-20

Stato:

```text
collector configurazioni one-shot implementato in locale
raccolta continua non implementata
momento zero reale non registrato
VPS non modificata
backend e frontend operativi non dipendono dalla Memoria
```

Contratto autoritativo:

```text
memory/OPERATIONAL_MEMORY_DESIGN.md
```

## Obiettivo

La Fase 4 conserva quali configurazioni e prezzi risultavano applicabili nel
tempo, senza diventare fonte di configurazione dell'app.

## Sorgenti

```text
restaurants
pasta_dictionary
beverages
suppliers
```

Vengono versionati:

- locali, ruolo e configurazione operativa;
- indirizzo DDT, bollitori, sigla Excel e monitor clienti;
- override del dizionario paste con prezzi in centesimi;
- catalogo e prezzi bevande;
- anagrafica fornitori.

Il listino paste di default e duplicato nel worker come regola esplicitamente
versionata e coperto da un test di parita con il backend operativo. Non viene
presentato come copia di un documento Mongo.

## Dati esclusi

La lettura dei locali usa una projection minima. Non vengono neppure richiesti:

```text
password e hash
token e versioni sessione
contatore ordini
altri campi runtime non configurativi
```

Una variazione del contatore ordini non crea quindi una falsa versione della
configurazione.

## Modifiche e reset

Ogni variazione chiude la versione precedente e apre la successiva. La
cancellazione di un override paste rappresenta il ritorno al default: il fatto
override viene chiuso dopo una scansione completa e il listino default
versionato resta disponibile.

Lo stesso meccanismo registra la rimozione di fornitori, bevande o locali senza
creare false sparizioni durante scansioni parziali.

## Comando

```bash
cd backend
python -m memory_worker collect-configuration-once
```

Il comando resta riservato a database isolati finche il rollout non viene
approvato.

## Collaudo

I test verificano:

- prezzi monetari in centesimi interi;
- parita del listino paste default;
- segreti e campi runtime esclusi;
- modifica della configurazione con versioni temporali;
- reset del dizionario e cancellazione fornitore;
- sparizioni idempotenti solo a scansione completa;
- lock, quarantena e sorgente immutata;
- assenza di import dal backend operativo.

## Limiti

- Nessuna attivazione continua o VPS.
- Nessuna UI o query analitica.
- Nessuna configurazione viene riscritta nell'app.
- Una sorgente priva di `updated_at` consente di sapere quando la Memoria ha
  osservato il cambio, non il suo istante operativo esatto.

## Rollback

Non eseguire il comando. La rimozione completa del database Memoria non cambia
login, ordini, Report, magazzino o configurazioni operative.
