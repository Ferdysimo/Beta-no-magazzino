import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';

// Listino paste (prezzi modificabili in un solo punto)
const PASTA_PRICES = [
  { sigla: 'CARB',    price: 8 },
  { sigla: 'AMAT',    price: 8 },
  { sigla: 'CACIO',   price: 8 },
  { sigla: 'PESTO',   price: 8 },
  { sigla: 'TART',    price: 8 },
  { sigla: 'RAGU',    price: 8 },
  { sigla: 'POM',     price: 7 },
  { sigla: 'CARZUC',  price: 8 },
];

// Banconote / monete (la prima riga "100 e 50" usa input EUR libero perché
// non si può dedurre il taglio da un solo conteggio combinato).
const CASH_DENOMINATIONS = [
  { key: 'big',    label: '100 e 50',  mode: 'eur',     placeholder: '€'  },
  { key: 'd20',    label: '20',        mode: 'count',   value: 20         },
  { key: 'd10',    label: '10',        mode: 'count',   value: 10         },
  { key: 'd5',     label: '5',         mode: 'count',   value: 5          },
  { key: 'c50',    label: '0,50',      mode: 'count',   value: 0.5        },
  { key: 'c20',    label: '0,20',      mode: 'count',   value: 0.2        },
  { key: 'c10',    label: '0,10',      mode: 'count',   value: 0.1        },
];

// Trova la prima sigla riconosciuta in una riga.
// Match case-insensitive su parola intera (anche dentro frasi).
const findPasta = (line) => {
  const upper = (line || '').toUpperCase();
  // Ordine importante: prima le più specifiche (CARZUC prima di CAR, ecc.)
  const ordered = [...PASTA_PRICES].sort((a, b) => b.sigla.length - a.sigla.length);
  for (const p of ordered) {
    // \b funziona con caratteri ASCII alfanumerici. Sigle solo lettere → ok.
    const re = new RegExp(`\\b${p.sigla}\\b`, 'i');
    if (re.test(upper)) return p;
  }
  return null;
};

const ReportBetaPage = () => {
  const navigate = useNavigate();
  const [pasteText, setPasteText] = useState('');
  const [cash, setCash] = useState({}); // key -> string (input value)

  // ----- Calcolo paste -----
  const pasteAnalysis = useMemo(() => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const breakdown = {};      // sigla -> {count, total}
    PASTA_PRICES.forEach(p => { breakdown[p.sigla] = { count: 0, total: 0, price: p.price }; });
    const unrecognized = [];
    let totalCount = 0;
    let totalEuro = 0;
    for (const line of lines) {
      const match = findPasta(line);
      if (match) {
        breakdown[match.sigla].count += 1;
        breakdown[match.sigla].total += match.price;
        totalCount += 1;
        totalEuro += match.price;
      } else {
        unrecognized.push(line);
      }
    }
    return { breakdown, unrecognized, totalCount, totalEuro };
  }, [pasteText]);

  // ----- Calcolo cassa -----
  const cashTotal = useMemo(() => {
    let sum = 0;
    for (const d of CASH_DENOMINATIONS) {
      const raw = (cash[d.key] || '').replace(',', '.').trim();
      if (!raw) continue;
      const n = parseFloat(raw);
      if (Number.isNaN(n) || n < 0) continue;
      if (d.mode === 'eur') sum += n;
      else sum += n * d.value;
    }
    return sum;
  }, [cash]);

  const setCashValue = (key, v) => setCash(prev => ({ ...prev, [key]: v }));

  const fmtEur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h1 className="font-heading text-xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Report — <span className="text-[#F5C518]">Beta</span>
          </h1>
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna alla home
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ============== LATO SINISTRO — PASTE ============== */}
          <section className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">Paste della giornata</h2>
              <span className="text-xs text-gray-500">Incolla l'elenco, una pasta per riga</span>
            </div>

            <textarea
              data-testid="paste-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Incolla qui le paste della giornata, ad esempio:\n1 AMAT\n2 CARB\n3 mezza ROM\n4 CACIO\n5 TART\nXL PESTO\n...'}
              spellCheck={false}
              className="w-full flex-1 min-h-[280px] sm:min-h-[420px] p-3 border-2 border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:border-[#F5C518] resize-vertical"
            />

            {/* Breakdown per sigla */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PASTA_PRICES.map(p => {
                const b = pasteAnalysis.breakdown[p.sigla];
                const active = b.count > 0;
                return (
                  <div
                    key={p.sigla}
                    data-testid={`breakdown-${p.sigla}`}
                    className={`rounded-md border px-2 py-1.5 ${active ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="font-bold text-gray-800 text-sm">{p.sigla}</span>
                      <span className="text-[10px] text-gray-500">€{p.price}</span>
                    </div>
                    <div className="text-xs text-gray-700">
                      <span className="font-bold">{b.count}</span> × = €{fmtEur(b.total)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Non riconosciute */}
            {pasteAnalysis.unrecognized.length > 0 && (
              <div className="mt-3 bg-rose-50 border border-rose-200 rounded-md p-2 text-xs">
                <div className="font-bold text-rose-700 mb-1">
                  Righe non riconosciute ({pasteAnalysis.unrecognized.length}):
                </div>
                <ul className="space-y-0.5 max-h-32 overflow-y-auto text-rose-900">
                  {pasteAnalysis.unrecognized.map((l, i) => (
                    <li key={i} className="font-mono">• {l}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Totali */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div data-testid="total-paste-count" className="bg-gray-900 text-white rounded-lg px-3 py-3 flex flex-col items-center">
                <span className="text-[10px] uppercase tracking-wide opacity-70">Totale paste</span>
                <span className="text-3xl font-black">{pasteAnalysis.totalCount}</span>
              </div>
              <div data-testid="total-paste-euro" className="bg-[#F5C518] text-gray-900 rounded-lg px-3 py-3 flex flex-col items-center">
                <span className="text-[10px] uppercase tracking-wide opacity-80">Totale incasso paste</span>
                <span className="text-3xl font-black">€{fmtEur(pasteAnalysis.totalEuro)}</span>
              </div>
            </div>
          </section>

          {/* ============== LATO DESTRO — CASSA (banconote/monete) ============== */}
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">Cassa</h2>
              <span className="text-xs text-gray-500">Inserisci i pezzi per ogni taglio</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {CASH_DENOMINATIONS.map(d => {
                const raw = (cash[d.key] || '').replace(',', '.');
                const n = parseFloat(raw);
                const subTot = (!raw || Number.isNaN(n) || n < 0)
                  ? 0
                  : d.mode === 'eur' ? n : n * d.value;
                return (
                  <div key={d.key} className="flex flex-col">
                    <label className="text-[10px] sm:text-xs font-semibold text-gray-600 mb-1 text-center">
                      {d.label}
                    </label>
                    <input
                      data-testid={`cash-input-${d.key}`}
                      type="text"
                      inputMode="decimal"
                      value={cash[d.key] || ''}
                      onChange={(e) => setCashValue(d.key, e.target.value)}
                      placeholder={d.mode === 'eur' ? '€' : '0'}
                      className="w-full h-14 sm:h-16 border-2 border-gray-200 rounded-lg px-1 text-center font-bold text-base focus:outline-none focus:border-[#F5C518]"
                    />
                    <span className="text-[10px] text-gray-500 mt-0.5 text-center">
                      {subTot > 0 ? `€${fmtEur(subTot)}` : '\u00A0'}
                    </span>
                  </div>
                );
              })}

              {/* Totale cassa */}
              <div className="flex flex-col">
                <label className="text-[10px] sm:text-xs font-bold text-gray-800 mb-1 text-center uppercase">
                  Totale
                </label>
                <div
                  data-testid="cash-total"
                  className="w-full h-14 sm:h-16 bg-gray-900 text-[#F5C518] rounded-lg flex items-center justify-center font-black text-base sm:text-lg"
                  title="Somma calcolata in euro"
                >
                  €{fmtEur(cashTotal)}
                </div>
                <span className="text-[10px] text-gray-500 mt-0.5 text-center">in euro</span>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
              • Per "100 e 50" inserisci direttamente l'importo in euro (es. 350)<br/>
              • Per gli altri tagli inserisci il numero di pezzi: il sistema moltiplica per il valore
            </p>

            {/* Placeholder per le sezioni successive (Vendite Bevande, Altro, Spicci…) */}
            <div className="mt-6 border-t border-dashed border-gray-300 pt-4 text-xs text-gray-400 italic">
              Le sezioni "Vendite Bevande", "Altro / Versamenti / POS" e "Spicci aperti" verranno aggiunte nei prossimi step.
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ReportBetaPage;
