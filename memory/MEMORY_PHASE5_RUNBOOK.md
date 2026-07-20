# Memoria operativa - Runbook Fase 5

Data: 2026-07-20

Stato:

```text
snapshot giornalieri implementati e collaudati in locale
contesto calendario implementato
momento zero reale non registrato
VPS non modificata
backend e frontend operativi non dipendono dalla Memoria
```

Contratto autoritativo:

```text
memory/OPERATIONAL_MEMORY_DESIGN.md
```

## Obiettivo

La Fase 5 trasforma i fatti acquisiti in fotografie giornaliere ricostruibili,
senza usare la Memoria per alimentare Report, ordini o magazzino.

Vengono creati:

- uno snapshot per locale e giornata chiusa;
- uno snapshot globale del magazzino;
- il contesto calendario della giornata;
- un controllo di integrita per ogni esecuzione;
- gap espliciti per fonti mancanti, incomplete o non aggiornate.

## Giornate ammesse

Il comando accetta soltanto giornate chiuse in `Europe/Rome` e mai date
precedenti al momento zero. Lo snapshot automatico usa la giornata precedente.

```bash
cd backend
python -m memory_worker snapshot-day --date YYYY-MM-DD
```

Il comando richiede gli stessi interruttori e le stesse credenziali separate
dei collector. Non va eseguito sul database operativo.

## Contenuto

Lo snapshot locale comprende, quando disponibili:

- paste totali e per tipo;
- ordini, modifiche e cancellazioni;
- cash, spicci e cassetto;
- bevande e relativo incasso;
- richieste, evasione e logistica;
- riferimenti ai fatti e alle versioni raw utilizzate;
- versioni delle regole applicate.

Il contesto giornaliero conserva giorno della settimana, settimana ISO,
stagione, festivita italiane fisse, Pasqua e lunedi di Pasqua.

## Completezza e gap

`complete` significa che tutte le fonti richieste risultano coperte e coerenti.
`partial` e un risultato valido ma dichiara esattamente i dati mancanti.

Il cash sera viene calcolato soltanto se il cash di base e disponibile e, dove
applicabile, tutte le bevande attese hanno un valore interpretabile. Un valore
mancante non viene trasformato in zero.

I gap sono documenti separati e versionati:

- vengono aperti quando una sorgente manca o e incompleta;
- restano visibili finche il problema esiste;
- vengono risolti automaticamente quando la fonte torna disponibile;
- non bloccano mai l'applicazione operativa.

## Correzioni tardive

Ripetere il comando senza modifiche non crea duplicati. Se un fatto cambia, lo
snapshot precedente viene conservato come `superseded` e viene creata una nuova
versione corrente. La provenienza permette di risalire ai fatti utilizzati.

Una cancellazione fisica viene considerata soltanto dopo una scansione completa
del collector relativo. Questo evita falsi gap durante batch parziali.

## Collaudo

I test verificano:

- rifiuto di giornata corrente, futura o precedente al momento zero;
- contesto calendario e festivita mobili;
- idempotenza dello stesso snapshot;
- nuova versione dopo una correzione tardiva;
- snapshot parziale dopo cancellazione fisica completa;
- risoluzione del gap dopo il ripristino della fonte;
- provenienza, stato corrente e versioni precedenti;
- sorgente operativa immutata.

## Rollback

Non eseguire il comando o eliminare il database `pastasciutta_memory`.
L'applicazione continua a funzionare senza alcuna migrazione inversa.
