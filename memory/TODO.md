# TODO / Promemoria

## 🔴 Da testare con testing_agent_v3_fork (P0)
- **Bevande DB Persistence + Report Integration**
  - File: `MagazzinoBevandePage.js`, `ReportBetaPage.js`, `server.py` (endpoints `/api/beverages/daily` e `/api/beverages/daily/{date}`)
  - Verificare:
    1. Salvataggio formule `=12-2` su `beverage_daily_counts`
    2. Carry-over: Sera (ieri) → Mattina (oggi)
    3. Box "Vendite Bevande" nel Report mostra quantità + EUR corretti
    4. Refresh pagina mantiene i dati
  - Credenziali: Flaminio/Pastasciutt4! oppure Admin/Pastasciutt4!

## Idea futura - Macchina del tempo

- Realizzare una vista esclusivamente consultiva che ricostruisca lo stato dell'applicazione per locale, giornata e istante selezionato.
- Usare una linea temporale per mostrare, al momento scelto: paste presenti e cancellate, Report, cash mattina/sera, cassetto spicci, magazzino e movimenti finanziari.
- Aggiungere la funzione "Spiega questo valore", mostrando origine, automatismi, riporti di mezzanotte, correzioni e autore delle modifiche che hanno prodotto il valore selezionato.
- Non consentire ripristini o modifiche dalla vista Macchina del tempo.
- Per lo storico precedente all'introduzione indicare chiaramente i dati o gli autori non ricostruibili; da quel momento in avanti progettare una registrazione completa degli eventi necessari.
- Non realizzare una pagina autonoma "Cronologia generale": al momento interessa soltanto la Macchina del tempo.
- Stato: promemoria progettuale, nessuna implementazione avviata.

## Idee future - Analisi operative paste

### Confronto giorni omogenei

- Permettere il confronto dello stesso locale su giornate realmente comparabili, per esempio tutti i sabati di un mese o lo stesso giorno della settimana tra periodi diversi.
- Confrontare almeno paste totali, quantita per tipologia, incidenza percentuale, scarti, cash sera e bevande.
- Evitare confronti fuorvianti tra giorni della settimana con comportamenti operativi differenti.

### Composizione delle paste

- Aggiungere una vista mensile pulita per locale con quantita e percentuale di ogni tipologia di pasta sul totale.
- Mostrare la variazione rispetto al mese precedente senza sostituire l'Excel Analisi mensile, che resta il risultato principale.
- Consentire il passaggio dal dato aggregato alle giornate che lo compongono, cosi da rendere verificabile ogni totale.

Stato: promemoria progettuale, nessuna implementazione avviata.

## Idea futura - Confronto per festivita mobili

- Confrontare festivita, ponti ed eventi ricorrenti con l'occasione equivalente degli anni precedenti, non con la stessa data numerica del calendario.
- Gestire almeno Pasqua e i relativi giorni collegati, consentendo in futuro di configurare anche eventi locali o ricorrenze operative.
- Applicare il confronto a paste totali, composizione per tipologia, scarti, cash sera e bevande, mantenendo sempre visibili le giornate sorgente utilizzate.
- Evitare che giornate eccezionali entrino automaticamente nei confronti ordinari senza essere riconoscibili.
- Stato: promemoria progettuale, nessuna implementazione avviata.
