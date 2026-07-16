# TODO / Promemoria

## 🔴 Da testare con testing_agent_v3_fork (P0)
- **Bevande DB Persistence + Report Integration**
  - File: `MagazzinoBevandePage.js`, `ReportBetaPage.js`, `server.py` (endpoints `/api/beverages/daily` e `/api/beverages/daily/{date}`)
  - Verificare:
    1. Salvataggio formule `=12-2` su `beverage_daily_counts`
    2. Carry-over: Sera (ieri) → Mattina (oggi)
    3. Box "Vendite Bevande" nel Report mostra quantità + EUR corretti
    4. Refresh pagina mantiene i dati
  - Credenziali live: fornirle tramite variabili d'ambiente locali o password manager, mai nel repository.

## Idea futura - Macchina del tempo

- Realizzare una vista esclusivamente consultiva che ricostruisca lo stato dell'applicazione per locale, giornata e istante selezionato.
- Usare una linea temporale per mostrare, al momento scelto: paste presenti e cancellate, Report, cash mattina/sera, cassetto spicci, magazzino e movimenti finanziari.
- Aggiungere la funzione "Spiega questo valore", mostrando origine, automatismi, riporti di mezzanotte, correzioni e autore delle modifiche che hanno prodotto il valore selezionato.
- Non consentire ripristini o modifiche dalla vista Macchina del tempo.
- Per lo storico precedente all'introduzione indicare chiaramente i dati o gli autori non ricostruibili; da quel momento in avanti progettare una registrazione completa degli eventi necessari.
- Non realizzare una pagina autonoma "Cronologia generale": al momento interessa soltanto la Macchina del tempo.
- Stato: promemoria progettuale, nessuna implementazione avviata.

## Idea futura - Audit sensibile unico

### Obiettivo

- Creare una vista unica, consultiva e filtrabile delle modifiche importanti dell'applicazione.
- Non deve essere una tabella tecnica gigante e non deve diventare un mappazzone.
- Deve assomigliare a un "estratto conto delle modifiche sensibili": chi ha cambiato cosa, dove, quando, prima com'era e dopo com'e.
- Deve aiutare soprattutto quando qualcosa non torna: totale cambiato, ordine sparito, DDT evaso, stock rettificato, report corretto, utente privilegiato che modifica qualcosa.
- Non deve sostituire i log specifici esistenti; deve dare un linguaggio comune sopra di essi.

### Concetto UI

Esempio mentale della pagina:

```text
AUDIT SENSIBILE

[Locale: Flaminio] [Giorno: oggi] [Area: Tutte] [Utente: Tutti]

16:42  Report / Cassa
       Federico ha modificato Cash Sera
       120,00 EUR -> 150,00 EUR
       [Vedi dettaglio]

16:31  Ordini
       Flaminio ha cancellato ordine #87
       "2 CARB 1 AMA"
       [Vedi dettaglio]

15:58  Magazzino
       Magazziniere ha evaso DDT #124
       6 prodotti, 42 pezzi totali
       [Vedi dettaglio]

14:10  Utenti
       Simone ha creato un nuovo locale
       "Trastevere"
       [Vedi dettaglio]
```

Il dettaglio deve essere umano, non JSON grezzo:

```text
Modifica Cash Sera

Chi: Federico, supervisor
Dove: Flaminio
Quando: 16/07/2026 16:42

Prima:
Cash sera: 120,00 EUR

Dopo:
Cash sera: 150,00 EUR

Origine:
Pagina Report
Dispositivo: iPad Cassa Flaminio
Versione app: 1783208512999
```

Filtri desiderati:

- locale;
- data o intervallo;
- area: Report, Cassa, Ordini, Magazzino, DDT, Utenti, Upload, Auth, Export;
- utente/ruolo;
- tipo evento;
- solo modifiche Admin/Federico/Simone;
- solo modifiche post-chiusura;
- solo eventi anomali o sensibili.

### Principio tecnico

- Non unificare tutti i dati dell'applicazione.
- Unificare solo il modo di raccontare una modifica sensibile.
- Ogni dominio mantiene la sua logica e la sua fonte di verita.
- L'audit sensibile riceve eventi gia riassunti bene dal dominio che li conosce.
- Ogni evento deve rispondere alle domande: chi, ruolo, locale, cosa, prima, dopo, route/pagina, dispositivo/versione, quando.

### Log esistenti da riusare

Fonti gia presenti da adattare:

- `cash_audit_log`: modifiche Report/Cassa/Bevande.
- `deletion_logs`: ordini cancellati.
- `modification_logs`: ordini modificati.
- `generale_hide_log`: ordini nascosti dal Tablet Generale.
- `stock_movements`: movimenti e rettifiche magazzino.

Prima fase consigliata: non riscrivere questi log. Creare adapter che li leggono e li traducono nel formato comune della vista.

### Collection futura

Per eventi nuovi o non coperti dai log attuali creare una collection append-only:

```text
sensitive_audit_events
```

Regole:

- append-only: non modificare eventi vecchi;
- non salvare password, token, JWT, cookie, codici Report reali, segreti, immagini o documenti;
- non salvare documenti completi quando basta un diff;
- sanificare e troncare valori lunghi;
- salvare solo campi whitelistati per area;
- ogni evento deve essere tenant-aware;
- ogni evento deve avere `created_at` UTC e, quando rilevante, `date_rome`.

### Schema evento comune

Esempio:

```json
{
  "id": "uuid",
  "event_type": "report.cash.updated",
  "area": "report",
  "severity": "sensitive",
  "actor": {
    "user_id": "...",
    "username": "Federico",
    "role": "supervisor",
    "is_impersonating": false
  },
  "tenant": {
    "restaurant_id": "...",
    "restaurant_name": "Flaminio"
  },
  "target": {
    "type": "cash_daily_count",
    "id": "restaurant_id:2026-07-16",
    "date_rome": "2026-07-16"
  },
  "action": "update",
  "before": {
    "cash_sera": "120"
  },
  "after": {
    "cash_sera": "150"
  },
  "diff": {
    "cash_sera": {
      "from": "120",
      "to": "150"
    }
  },
  "context": {
    "route": "PATCH /api/report/cash/daily",
    "page": "Report",
    "request_id": "...",
    "device_id": "...",
    "frontend_version": "1783208512999"
  },
  "created_at": "2026-07-16T14:42:00Z"
}
```

Event type possibili:

```text
report.cash.updated
report.beverage.updated
report.manual_paste_changed
order.deleted
order.description_changed
order.number_changed
order.hidden_from_generale
warehouse.stock.adjusted
warehouse.ddt.evaded
warehouse.request.cancelled
user.created
user.role_changed
auth.login_failed
auth.privileged_login
upload.created
upload.deleted
export.generated
```

### Struttura codice proposta

Nuovi file:

```text
backend/app/schemas/sensitive_audit.py
backend/app/services/sensitive_audit.py
backend/app/routers/sensitive_audit.py
frontend/src/pages/AuditSensibilePage.js
```

Funzione centrale:

```python
async def emit_sensitive_audit(
    *,
    event_type: str,
    area: str,
    actor: dict,
    tenant: dict,
    target: dict,
    action: str,
    before: dict | None = None,
    after: dict | None = None,
    diff: dict | None = None,
    context: dict | None = None,
    severity: str = "sensitive",
) -> None:
    ...
```

Helper utili:

```python
def actor_from_token(token_data: dict, request=None) -> dict:
    ...

def context_from_request(request) -> dict:
    ...

def sanitize_audit_value(value):
    ...

def build_diff(old_doc: dict, new_payload: dict, allowed_fields: set[str]) -> dict:
    ...
```

### Whitelist per area

Non usare `before = old_doc` e `after = new_doc` in modo indiscriminato.

Esempio Report/Cassa:

```python
REPORT_AUDIT_FIELDS = {
    "cash_mattina",
    "cash_sera",
    "vers",
    "spicci",
    "cash_banconote",
    "paste_text",
    "paste_manual_override",
    "manual_prices",
    "comments",
}
```

Per ogni area va definita una whitelist esplicita, cosi l'audit resta utile e non copia dati inutili o sensibili.

### Adapter prima della scrittura diretta

Prima implementazione consigliata:

```python
async def report_audit_adapter(query) -> list[dict]:
    rows = await db.cash_audit_log.find(query).to_list(500)
    return [cash_log_to_sensitive_event(row) for row in rows]

async def order_deletion_adapter(query) -> list[dict]:
    rows = await db.deletion_logs.find(query).to_list(500)
    return [deletion_log_to_sensitive_event(row) for row in rows]

async def stock_movement_adapter(query) -> list[dict]:
    rows = await db.stock_movements.find(query).to_list(500)
    return [stock_movement_to_sensitive_event(row) for row in rows]
```

Route admin:

```text
GET /api/admin/sensitive-audit
```

La route deve essere Admin/Simone/Federico secondo regole da decidere esplicitamente. Non deve essere disponibile ai locali normali.

### Emissione diretta futura

Dopo la vista sopra i log esistenti, agganciare gradualmente `emit_sensitive_audit` nei punti sensibili.

Esempio cancellazione ordine:

```python
await emit_sensitive_audit(
    event_type="order.deleted",
    area="orders",
    actor=actor_from_token(token_data, request),
    tenant={"restaurant_id": restaurant_id},
    target={
        "type": "order",
        "id": order_id,
        "order_number": order["order_number"],
    },
    action="delete",
    before={
        "order_number": order["order_number"],
        "description": order["description"],
        "created_at": order["created_at"],
    },
    after=None,
    context=context_from_request(request),
)
```

Esempio Report:

```python
diff = build_diff(old_doc, set_payload, REPORT_AUDIT_FIELDS)

if diff:
    await emit_sensitive_audit(
        event_type="report.cash.updated",
        area="report",
        actor=actor_from_token(token_data, request),
        tenant={"restaurant_id": rid},
        target={"type": "cash_daily_count", "date_rome": date_rome},
        action="update",
        diff=diff,
        before={k: v["from"] for k, v in diff.items()},
        after={k: v["to"] for k, v in diff.items()},
        context=context_from_request(request),
    )
```

### Indici Mongo consigliati

```python
await db.sensitive_audit_events.create_index([("created_at", -1)])
await db.sensitive_audit_events.create_index([("tenant.restaurant_id", 1), ("created_at", -1)])
await db.sensitive_audit_events.create_index([("area", 1), ("created_at", -1)])
await db.sensitive_audit_events.create_index([("actor.user_id", 1), ("created_at", -1)])
await db.sensitive_audit_events.create_index([("event_type", 1), ("created_at", -1)])
```

### Fasi consigliate

1. Definire schema comune, helper di sanitizzazione e test unitari.
2. Creare endpoint admin read-only che aggrega/adatta i log esistenti.
3. Creare pagina `AuditSensibilePage.js` con filtri e dettaglio umano.
4. Aggiungere `sensitive_audit_events` append-only per eventi nuovi.
5. Agganciare emissione diretta prima a Report/Cassa, poi Ordini, poi Magazzino/DDT, poi Auth/Utenti/Upload/Export.
6. Solo dopo valutare alert o viste "anomalie"; non partire dagli alert.

### Test obbligatori

- La route admin rifiuta utenti non autorizzati.
- Un locale non puo vedere audit di altri locali.
- I log esistenti vengono adattati senza alterare le collection originali.
- I diff non salvano documenti completi o segreti.
- Valori lunghi vengono sanificati/troncati.
- Modifiche senza cambio reale non producono rumore.
- Report/Cassa mostra prima/dopo corretto.
- Ordine cancellato mostra numero, descrizione, locale e ora.
- Movimento stock mostra prodotto, delta e saldo dopo.
- Filtri per locale/data/area/utente funzionano.
- La pagina non mostra JSON grezzo come esperienza principale.

### Non obiettivi

- Non creare una cronologia generale di ogni click.
- Non salvare heartbeat grezzi o movimenti mouse/tastiera.
- Non sostituire la Memoria operativa.
- Non rendere l'audit fonte di verita per Report, ordini o magazzino.
- Non bloccare operazioni operative se la scrittura audit futura fallisce, salvo decisione esplicita per eventi critici.

### Stato

- Stato: promemoria progettuale, nessuna implementazione avviata.
- Priorita suggerita: dopo hardening minimo auth/ruoli e prima di funzioni predittive avanzate.
- Collegabile in futuro alla Macchina del tempo e alla Memoria operativa, ma deve restare utile anche da solo come scatola nera delle modifiche sensibili.

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
