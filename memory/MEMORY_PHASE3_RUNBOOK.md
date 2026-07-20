# Memoria operativa - Runbook Fase 3

Data: 2026-07-20

Stato:

```text
collector magazzino one-shot implementato in locale
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

La Fase 3 acquisisce il dominio logistico senza modificare prodotti, stock,
richieste o carichi operativi. Il collector legge piccoli batch e termina.

## Sorgenti

```text
products
stock_movements
richieste
carichi_magazzino
beverage_inventory
beverage_carichi
```

Al momento zero vengono acquisite le baseline correnti di prodotti, stock e
inventario bevande. Movimenti, richieste e carichi precedenti all'epoch restano
esclusi: non viene eseguito un backfill storico.

## Verita e stati

`stock_movements` e il registro autorevole degli eventi. Ogni movimento conserva:

- prodotto;
- quantita prima, delta e quantita dopo;
- causale e riferimento;
- utente e ruolo disponibili;
- timestamp e giornata Europe/Rome.

Prodotti, richieste e carichi sono stati versionati, perche possono cambiare o
essere cancellati fisicamente. La sparizione viene dichiarata soltanto dopo una
scansione completa. Un batch interrotto non genera false cancellazioni.

Le causali usano termini espliciti:

```text
stock_iniziale
ricevuto_da_fornitore
rettifica_carico
annullamento_carico
evaso_al_locale
rettifica_amministrativa
```

`evaso_al_locale` non viene mai presentato come consumo reale. Puo diventare in
futuro un proxy di consumo logistico, dichiarandone il limite.

## DDT e documenti

Di carichi e DDT vengono conservati solo numero, date, fornitore, righe,
quantita, unita e collegamenti ai movimenti. Foto, fatture, file e URL degli
upload vengono esclusi dal raw sanificato.

## Comando

```bash
cd backend
python -m memory_worker collect-warehouse-once
```

Il comando resta riservato a database isolati finche il rollout non viene
approvato. Richiede i due interruttori, l'epoch e credenziali Mongo separate
descritte nel runbook Fase 2.

## Collaudo

I test verificano:

- baseline senza storico precedente;
- movimento prima/delta/dopo;
- ciclo richiesta e DDT strutturato;
- carichi ordinari e bevande in casse/unita;
- immagini escluse;
- modifiche bitemporali;
- cancellazioni fisiche rilevate una sola volta;
- nessuna cancellazione durante scansioni incomplete;
- record malformati in quarantena;
- idempotenza e sorgente immutata.

## Limiti

- Nessun servizio continuo, snapshot giornaliero o aggregato di consumo.
- Nessuna foto o fattura copiata.
- Nessuna ricostruzione precedente al momento zero.
- La sparizione segnala che il documento non e piu presente; non inventa autore
  o motivo quando la sorgente non li registra.

## Rollback

Non eseguire il comando. Il backend non importa il worker e non cambia
comportamento se lo storage Memoria viene rimosso.
