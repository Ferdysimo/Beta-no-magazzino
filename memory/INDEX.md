# Indice operativo della documentazione

Questo file e il punto di ingresso per lavorare sul progetto. Indica quale
documento fa fede, dove si trovano i dettagli e quali lavori sono davvero
aperti. Non contiene credenziali o istruzioni segrete.

## Ordine di lettura

1. [`INDEX.md`](INDEX.md) per stato e mappa dei documenti.
2. [`PRD.md`](PRD.md) per il comportamento funzionale che non deve regredire.
3. [`TODO.md`](TODO.md) per le priorita ancora aperte.
4. Le voci recenti di
   [`CHANGELOG_MULTI_AGENT.md`](CHANGELOG_MULTI_AGENT.md) per modifiche e test
   eseguiti.
5. Il runbook specifico dell'area da modificare.

## Stato sintetico

- Il refactor di `server.py` e completato e operativo.
- Il contenimento sicurezza P0-A/P0-B e attivo in produzione dal 17 luglio
  2026.
- Il piano P1 e approvato, ma il rollout ordinato delle sue fasi non e ancora
  iniziato. La revoca mirata dell'account Admin applicata il 6 agosto 2026 e
  una misura isolata e non rende completa la Fase 4.
- Le Fasi 0-6 della Memoria operativa sono implementate e testate localmente,
  ma sulla VPS il servizio non e installato, il momento zero non e scelto e la
  raccolta non e attiva.
- Il rollout della Memoria resta bloccato fino al completamento del gate MongoDB
  SCRAM previsto dalla Fase 3 del P1.

## Mappa

### Documenti principali

- [`PRD.md`](PRD.md): contratto funzionale corrente.
- [`TODO.md`](TODO.md): coda breve e ordinata dei lavori aperti.
- [`CHANGELOG_MULTI_AGENT.md`](CHANGELOG_MULTI_AGENT.md): modifiche recenti e
  prove effettuate.
- [`WAREHOUSE_LOAD_RETENTION_WARNING.md`](WAREHOUSE_LOAD_RETENTION_WARNING.md):
  avviso da leggere prima di distribuire la cancellazione completa dei carichi
  verso il magazzino dopo 90 giorni.
- [`CHANGELOG_MULTI_AGENT_ARCHIVE.md`](CHANGELOG_MULTI_AGENT_ARCHIVE.md):
  storico meno recente.

### `security/`

- [`P1_SECURITY_RUNBOOK.md`](security/P1_SECURITY_RUNBOOK.md): fonte operativa
  del prossimo programma sicurezza.
- [`SECURITY_HARDENING_PLAN.md`](security/SECURITY_HARDENING_PLAN.md): quadro
  generale P0-P3.
- [`P0_VPS_RUNBOOK.md`](security/P0_VPS_RUNBOOK.md): stato e riferimento del P0
  concluso.
- [`ADMIN_PASSWORD_ROTATION_RUNBOOK.md`](security/ADMIN_PASSWORD_ROTATION_RUNBOOK.md):
  procedura riutilizzabile per Admin.
- [`test_credentials.md`](security/test_credentials.md): regole per le
  credenziali di test, senza segreti reali.

### `operational-memory/`

- [`OPERATIONAL_MEMORY_DESIGN.md`](operational-memory/OPERATIONAL_MEMORY_DESIGN.md):
  architettura, dati e principio di isolamento.
- [`OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES.md`](operational-memory/OPERATIONAL_MEMORY_ADVANCED_CAPABILITIES.md):
  capacita future gia progettate.
- [`MEMORY_PHASE0_RUNBOOK.md`](operational-memory/MEMORY_PHASE0_RUNBOOK.md) ...
  [`MEMORY_PHASE6_RUNBOOK.md`](operational-memory/MEMORY_PHASE6_RUNBOOK.md):
  implementazione e verifiche locali per fase.
- [`MEMORY_VPS_ROLLOUT_RUNBOOK.md`](operational-memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md):
  unica procedura autorizzata per attivare la Memoria in produzione quando i
  gate saranno soddisfatti.

### `plans/`

- [`FEATURE_BACKLOG_DETAILS.md`](plans/FEATURE_BACKLOG_DETAILS.md): specifiche
  estese delle idee future e dei lavori Report ancora da implementare.
  `TODO.md` ne e il riepilogo operativo.

### `archive/`

- [`refactor_plan_server_py.md`](archive/refactor_plan_server_py.md): piano
  completato del refactor backend.
- [`P0_B_PREFLIGHT_2026-07-17.md`](archive/P0_B_PREFLIGHT_2026-07-17.md):
  fotografia storica precedente al rollout P0-B.

## Precedenza delle fonti

In caso di conflitto:

1. prevale una decisione esplicita e recente del titolare;
2. il PRD definisce il comportamento funzionale atteso;
3. il runbook attivo definisce la procedura della propria area;
4. codice e test mostrano lo stato implementato e ogni divergenza va segnalata;
5. TODO e documenti di progetto descrivono lavoro futuro, non funzioni attive;
6. il changelog conserva la storia e non sostituisce lo stato corrente.

I vecchi percorsi presenti nelle voci storiche del changelog descrivono la
struttura della repository al momento della modifica. Per il percorso corrente
usare sempre questa mappa.
