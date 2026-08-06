# TODO operativo

Questa e la coda sintetica dei lavori ancora aperti. Le analisi estese restano
nei documenti collegati, cosi la lista non torna a diventare dispersiva.

Stati: `NEXT` prossimo programma, `PLANNED` approvato ma non avviato, `VERIFY`
da collaudare, `BLOCKED` richiede un prerequisito, `FUTURE` idea conservata.

| Priorita | Stato | Lavoro | Fonte dei dettagli |
| --- | --- | --- | --- |
| 1 | `NEXT` | Eseguire il P1 sicurezza una fase alla volta, con test e osservazione previsti dal runbook. | [Runbook P1](security/P1_SECURITY_RUNBOOK.md) |
| 2 | `PLANNED` | Affidabilita Report e mezzanotte: R1 archivio prima del reset, R2 valutatore numerico condiviso, R3 lock Mongo del reset. | [Backlog esteso](plans/FEATURE_BACKLOG_DETAILS.md) |
| 3 | `VERIFY` | Collaudo completo persistenza bevande e integrazione Report su ambiente isolato con dati realistici. | [Backlog esteso](plans/FEATURE_BACKLOG_DETAILS.md) |
| 4 | `BLOCKED` | Rollout VPS della Memoria operativa. Attendere il gate MongoDB SCRAM della Fase 3 P1; nessuna attivazione anticipata. | [Runbook rollout](operational-memory/MEMORY_VPS_ROLLOUT_RUNBOOK.md) |
| 5 | `FUTURE` | Macchina del tempo consultiva con origine e spiegazione dei valori. | [Backlog esteso](plans/FEATURE_BACKLOG_DETAILS.md) |
| 6 | `FUTURE` | Audit sensibile unico, append-only e filtrabile, dopo l'hardening minimo richiesto. | [Backlog esteso](plans/FEATURE_BACKLOG_DETAILS.md) |
| 7 | `FUTURE` | Analisi operative: giorni omogenei, composizione paste e festivita mobili. | [Backlog esteso](plans/FEATURE_BACKLOG_DETAILS.md) |

## Completati e archiviati

- Refactor backend di `server.py`: completato; documento in `archive/`.
- Sicurezza P0-A/P0-B: completata e verificata in produzione; runbook in
  `security/`.
- Rotazione e revoca mirata Admin del 6 agosto 2026: completata; procedura
  riutilizzabile in `security/ADMIN_PASSWORD_ROTATION_RUNBOOK.md`.

## Regola di manutenzione

- Aggiungere qui soltanto lavori realmente aperti e una sola riga per tema.
- Mettere analisi, schema dati, fasi e test nel documento di dettaglio.
- Quando un lavoro termina, rimuoverlo dalla tabella e conservarne l'esito nel
  changelog o in `archive/` se il documento ha valore storico.
