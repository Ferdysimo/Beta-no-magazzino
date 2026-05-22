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
