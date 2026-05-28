#====================================================================================================
# Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================
(intentionally trimmed for handoff continuation — see iteration_*.json under /app/test_reports)
#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

user_problem_statement: |
  Sistema multi-ristorante pasta (Cassa, Generale, Bollitore, Monitor, Magazzino, Admin).
  Verifica isolata multi-tenancy su /report-beta e /magazzino-bevande dopo recenti modifiche
  (split 50/100, monete 1/2, "XL" → manuali, Cassetto Spicci solo Admin, Magazzino Sera read-only).

backend:
  - task: "Multi-tenancy Cash Daily (GET/PUT /api/cash/daily)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Fix critico: PUT usava una variabile 'flaminio_id' non definita nello scope, ora usa rid effettivo. Smoke test con curl OK (Flaminio=111, Grazie=222 isolati)."

  - task: "Multi-tenancy Beverages Daily (GET/PUT /api/beverages/daily)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Endpoint usa _effective_restaurant_id che onora X-Restaurant-Id per Admin. Da validare end-to-end."

  - task: "Storico Chiusure Admin (/api/admin/closures)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Endpoint creato in sessione precedente. Verificare aggregazione storica + isolamento per locale."

frontend:
  - task: "ReportBetaPage — split 50/100 + monete 1€/2€ + XL → manuali"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/pages/ReportBetaPage.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Box 50/100/1/2 in CASH_DENOMINATIONS. findPasta restituisce null se la riga contiene 'XL' come parola intera."

  - task: "Cassetto Spicci editabile SOLO da Admin"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/pages/ReportBetaPage.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Aggiunto guard !isAdmin all'inizio di startEditCassetto. Cursor 'not-allowed' e label 'solo lettura' per non-Admin."

  - task: "Math formulas + carry-over + commenti DB su Report"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/pages/ReportBetaPage.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "evaluateValue (=10+5), cash_sera auto-sum, prev_cash_sera nel GET, comments su cells (right-click)."

  - task: "Magazzino Bevande — persistenza DB + carry-over"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/pages/MagazzinoBevandePage.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Auto-save su /api/beverages/daily, prev_sera popola mattina del giorno successivo."

  - task: "PasswordGate (PIN 0123) su /report-beta e /magazzino-bevande"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/components/PasswordGate.js"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "PIN client-side 0123."

  - task: "Admin Header location switcher invia X-Restaurant-Id"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/contexts/AuthContext.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Interceptor axios invia X-Restaurant-Id quando isAdmin && adminSelectedRestaurant."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 7
  run_ui: true

test_plan:
  current_focus:
    - "Multi-tenancy Cash Daily (GET/PUT /api/cash/daily)"
    - "Multi-tenancy Beverages Daily (GET/PUT /api/beverages/daily)"
    - "ReportBetaPage — split 50/100 + monete 1€/2€ + XL → manuali"
    - "Cassetto Spicci editabile SOLO da Admin"
    - "Magazzino Bevande — persistenza DB + carry-over"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Sessione di fork. Bug critico trovato e fixato: PUT /api/cash/daily usava una variabile non definita 'flaminio_id' causando NameError oppure (se per caso definita globalmente) cross-tenant write. Ora usa rid effettivo. Aggiunto guard isAdmin su Cassetto Spicci edit. Smoke test multi-tenancy con curl OK. Procedere con test E2E completo su backend (cash+beverages multi-tenant) e frontend (Report, Bevande, PIN, Admin switching)."
