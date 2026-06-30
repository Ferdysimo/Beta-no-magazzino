# 🤖 CHANGELOG MULTI-AGENT — Pastasciutta App

> **Scopo / Purpose**
> Questo file serve a sincronizzare il lavoro di più agenti AI (Emergent E1, Claude, GPT, Cursor, Copilot, agenti esterni, ecc.) che modificano lo stesso codebase in momenti diversi.
> This file synchronizes work across multiple AI agents (Emergent E1, Claude, GPT, Cursor, Copilot, external agents, etc.) modifying the same codebase at different times.

---

## 📜 ISTRUZIONI PER L'AGENTE / INSTRUCTIONS FOR THE AGENT

**🇮🇹 ITALIANO**
Prima di iniziare qualsiasi modifica al codice:
1. **LEGGI** integralmente la sezione "LOG MODIFICHE" sotto, dal più recente al più vecchio.
2. Leggi anche `/app/memory/PRD.md` per il contesto generale del prodotto.
3. Dopo aver completato il tuo lavoro (anche un fix piccolo), **AGGIUNGI** una nuova voce in cima alla sezione "LOG MODIFICHE" seguendo il formato indicato.
4. NON cancellare voci precedenti. Solo aggiungere.
5. Se il file supera le 500 righe, sposta le voci più vecchie di 30 giorni in `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.

**🇬🇧 ENGLISH**
Before making any code change:
1. **READ** the entire "CHANGE LOG" section below, newest first.
2. Also read `/app/memory/PRD.md` for general product context.
3. After completing your work (even small fixes), **ADD** a new entry on top of the "CHANGE LOG" section using the format below.
4. DO NOT delete previous entries. Only append.
5. If this file grows beyond 500 lines, move entries older than 30 days to `/app/memory/CHANGELOG_MULTI_AGENT_ARCHIVE.md`.

---

## 📝 FORMATO VOCE / ENTRY FORMAT

```markdown
### [YYYY-MM-DD HH:MM TZ] — <Nome Agente> (<Modello / Provider>)
**Tipo**: feature | bugfix | refactor | security | docs | config
**File toccati**:
- `/app/path/to/file1.ext`
- `/app/path/to/file2.ext`
**Descrizione**: 1-3 righe in italiano che spiegano COSA è stato fatto e PERCHÉ.
**Testato**: ✅ sì (metodo: curl / testing_agent / screenshot / utente) | ❌ no
**Note per il prossimo agente** (opzionale): eventuali warning, side-effect, follow-up.
```

---

## 🔑 CONTESTO RAPIDO / QUICK CONTEXT

- **Stack**: FastAPI (Python) + React + MongoDB + WebSocket
- **Lingua utente**: 🇮🇹 Italiano — rispondi SEMPRE in italiano
- **File sensibili (toccare con cautela)**:
  - `/app/backend/server.py` — 5500+ righe, monolite
  - `/app/frontend/src/pages/ReportBetaPage.js` — 2100+ righe, math parsing + contentEditable + rich text + XSS sanitization
  - `/app/backend/.env` — `JWT_SECRET` obbligatorio in produzione
- **Credenziali test** → `/app/memory/test_credentials.md`
- **Ruoli**: `admin` (Admin), `supervisor` (Federico), `restaurant`, `magazzino`
- **Comando deploy VPS utente**:
  `cd /root/pasta-app && git pull && cd frontend && npm run build && sudo systemctl restart pastasciutta-backend`

---

## 📋 LOG MODIFICHE / CHANGE LOG
> **⬇️ Aggiungere nuove voci QUI SOTTO, in cima alla lista (più recente in alto). ⬇️**

### [2026-02-XX] — Emergent E1 (Claude Sonnet 4.5)
**Tipo**: docs
**File toccati**:
- `/app/memory/CHANGELOG_MULTI_AGENT.md` (creato)
**Descrizione**: Creato questo file di sincronizzazione multi-agente con istruzioni IT/EN, formato voci e contesto rapido del progetto. Permette ad altri agenti AI esterni di sapere cosa è già stato fatto senza ripetere lavoro o introdurre regressioni.
**Testato**: ✅ sì (creazione file verificata)
**Note per il prossimo agente**: Quando modifichi codice, ricordati di aggiungere la tua voce QUI SOPRA prima di chiudere il task. Se l'utente ti chiede "leggi il changelog", riferisciti a questo file.

---

<!-- Le voci più vecchie vanno archiviate in CHANGELOG_MULTI_AGENT_ARCHIVE.md dopo 30 giorni -->
