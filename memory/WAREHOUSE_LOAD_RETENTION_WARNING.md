# Avviso operativo — retention carichi verso il magazzino

Stato rilevato: 2 settembre 2026, tramite verifica SSH in sola lettura sulla
VPS di produzione.

## Comportamento approvato

Dopo 90 giorni la manutenzione deve eliminare dalla collection
`carichi_magazzino` la riga visibile del carico e i relativi file DDT/fattura.
Non deve modificare le quantità correnti dei prodotti, eliminare movimenti da
`stock_movements` o generare movimenti compensativi.

La modifica che applica questo comportamento è stata preparata in locale, ma
al momento di questa nota non è ancora stata distribuita sulla VPS.

## Avviso sui dati legacy

Alla data della verifica risultavano 66 righe già oltre i 90 giorni:

- 46 hanno almeno un movimento ledger collegato tramite `ref_type=carico` e
  `ref_id` uguale all'ID del carico;
- 20, create tra il 28 aprile e il 7 maggio 2026, non hanno mai avuto un
  movimento collegato in `stock_movements`.

La nuova pulizia non cancella movimenti. Tuttavia, per queste 20 righe non
esiste alcun movimento da conservare: eliminarle senza una migrazione farebbe
sparire l'unica registrazione strutturata del relativo carico.

## Effetto sull'Analisi magazzino

L'Analisi magazzino calcola attualmente gli ingressi leggendo
`carichi_magazzino`, non il ledger. Di conseguenza, gli ingressi più vecchi di
90 giorni non saranno più inclusi nell'analisi dopo la cancellazione delle
righe. Non sostituire automaticamente la fonte con `stock_movements`: la
verifica del 2 settembre ha rilevato 20 carichi legacy assenti dal ledger.

## Prima del rollout in produzione

1. Eseguire un backup verificato di MongoDB e della cartella upload.
2. Ripetere il conteggio delle righe scadute e dei relativi riferimenti ledger.
3. Decidere se ricostruire i 20 movimenti legacy senza modificare le quantità
   correnti dei prodotti.
4. Decidere se l'Analisi magazzino debba intenzionalmente fermarsi a 90 giorni
   oppure debba leggere una fonte storica separata e completa.
5. Solo dopo queste verifiche distribuire la nuova manutenzione e controllarne
   i log al primo avvio e alla prima mezzanotte.
