import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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

// Banconote / monete
const CASH_DENOMINATIONS = [
  { key: 'big',    label: '100 e 50',  mode: 'eur',     placeholder: '€'  },
  { key: 'd20',    label: '20',        mode: 'count',   value: 20         },
  { key: 'd10',    label: '10',        mode: 'count',   value: 10         },
  { key: 'd5',     label: '5',         mode: 'count',   value: 5          },
  { key: 'c50',    label: '0,50',      mode: 'count',   value: 0.5        },
  { key: 'c20',    label: '0,20',      mode: 'count',   value: 0.2        },
  { key: 'c10',    label: '0,10',      mode: 'count',   value: 0.1        },
];

const findPasta = (line) => {
  const upper = (line || '').toUpperCase();
  const ordered = [...PASTA_PRICES].sort((a, b) => b.sigla.length - a.sigla.length);
  for (const p of ordered) {
    const re = new RegExp(`\\b${p.sigla}\\b`, 'i');
    if (re.test(upper)) return p;
  }
  return null;
};

// Valuta una formula "=…" (stessa logica della pagina Magazzino Bevande)
const evaluateValue = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const s = String(v).trim().replace(',', '.');
  if (s.startsWith('=')) {
    const expr = s.slice(1).trim();
    if (!expr || !/^[\d+\-*/.() \s]*$/.test(expr)) return 0;
    try {
      // eslint-disable-next-line no-new-func
      const v2 = Function(`"use strict"; return (${expr})`)();
      return Number.isFinite(v2) ? v2 : 0;
    } catch { return 0; }
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
};

const ReportBetaPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [pasteText, setPasteText] = useState('');
  const [cash, setCash] = useState({});
  const [manualPrices, setManualPrices] = useState({});
  // Vendite bevande: lette dal backend, refresh periodico
  const [beverages, setBeverages] = useState([]);   // {sigla, name, price}
  const [bevCounts, setBevCounts] = useState({});   // {sigla: {mattina, inUsc, scarti, sera}}

  // Carica catalogo bevande + conteggi giornata. Refresh ogni 15s così se il
  // cassiere aggiorna la pagina magazzino in un'altra tab vede subito qui.
  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    let cancelled = false;
    const load = async () => {
      try {
        const [invRes, dailyRes] = await Promise.all([
          axios.get(`${API}/beverages/inventory`, { headers }),
          axios.get(`${API}/beverages/daily`, { headers }),
        ]);
        if (cancelled) return;
        setBeverages(invRes.data || []);
        const merged = {};
        const today = dailyRes.data?.counts || {};
        const prev = dailyRes.data?.prev_sera || {};
        (invRes.data || []).forEach(b => {
          if (today[b.sigla]) merged[b.sigla] = today[b.sigla];
          else if (prev[b.sigla] !== undefined && prev[b.sigla] !== '') {
            merged[b.sigla] = { mattina: String(prev[b.sigla]), inUsc: '', scarti: '', sera: '' };
          } else {
            merged[b.sigla] = { mattina: '', inUsc: '', scarti: '', sera: '' };
          }
        });
        setBevCounts(merged);
      } catch (e) {
        // 403 se non Flaminio/Admin: ignora silenziosamente
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);

  // Parsing paste — restituisce anche l'elenco delle non-riconosciute con indice stabile
  const pasteAnalysis = useMemo(() => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const breakdown = {};
    PASTA_PRICES.forEach(p => { breakdown[p.sigla] = { count: 0, total: 0, price: p.price }; });
    const unrecognized = []; // {idx, text}
    let recognizedCount = 0;
    let recognizedEuro = 0;
    lines.forEach((line, idx) => {
      const match = findPasta(line);
      if (match) {
        breakdown[match.sigla].count += 1;
        breakdown[match.sigla].total += match.price;
        recognizedCount += 1;
        recognizedEuro += match.price;
      } else {
        unrecognized.push({ idx, text: line });
      }
    });

    // Le non riconosciute contano comunque come paste: count = +1 ciascuna
    // Il prezzo è quello manuale se presente, altrimenti 0
    let manualEuro = 0;
    unrecognized.forEach(u => {
      const raw = (manualPrices[u.idx] ?? '').toString().replace(',', '.').trim();
      const n = parseFloat(raw);
      if (!Number.isNaN(n) && n > 0) manualEuro += n;
    });

    return {
      breakdown,
      unrecognized,
      totalCount: recognizedCount + unrecognized.length,
      totalEuro: recognizedEuro + manualEuro,
      missingPriceCount: unrecognized.filter(u => {
        const raw = (manualPrices[u.idx] ?? '').toString().replace(',', '.').trim();
        const n = parseFloat(raw);
        return Number.isNaN(n) || n <= 0;
      }).length,
    };
  }, [pasteText, manualPrices]);

  const cashTotal = useMemo(() => {
    let sum = 0;
    for (const d of CASH_DENOMINATIONS) {
      const raw = (cash[d.key] || '').replace(',', '.').trim();
      if (!raw) continue;
      const n = parseFloat(raw);
      if (Number.isNaN(n) || n < 0) continue;
      sum += d.mode === 'eur' ? n : n * d.value;
    }
    return sum;
  }, [cash]);

  // Aggrego le vendite bevande
  const bevSales = useMemo(() => {
    return beverages.map(b => {
      const c = bevCounts[b.sigla] || {};
      const m = evaluateValue(c.mattina);
      const u = evaluateValue(c.inUsc);
      const sc = evaluateValue(c.scarti);
      const se = evaluateValue(c.sera);
      const qty = se === 0 ? 0 : (m + u - sc - se);
      const inc = Math.max(0, qty) * (b.price || 0);
      return { sigla: b.sigla, name: b.name, qty, inc };
    });
  }, [beverages, bevCounts]);
  const bevTotalQty = bevSales.reduce((s, r) => s + Math.max(0, r.qty), 0);
  const bevTotalInc = bevSales.reduce((s, r) => s + r.inc, 0);

  const setCashValue = (key, v) => setCash(p => ({ ...p, [key]: v }));
  const setManualPrice = (idx, v) => setManualPrices(p => ({ ...p, [idx]: v }));
  const fmtEur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col overflow-hidden">
      <Header />
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 py-2 flex flex-col min-h-0">
        {/* Titolo compatto */}
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <h1 className="font-heading text-base sm:text-xl font-bold text-gray-900 uppercase tracking-wide">
            Report
          </h1>
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="text-xs text-gray-600 hover:text-gray-900 underline"
          >
            ← Home
          </button>
        </div>

        {/* Layout: paste a sinistra (1/4) + tutto il resto a destra (3/4) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_3fr] gap-2 min-h-0">
          {/* ============== SINISTRA — PASTE ============== */}
          <section className="bg-white rounded border border-gray-200 p-2 flex flex-col min-h-0">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-xs font-bold text-gray-800 uppercase">Paste</h2>
              <span className="text-[10px] text-gray-400">1 per riga</span>
            </div>

            <textarea
              data-testid="paste-textarea"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Incolla qui le paste\n1 AMAT\n2 CARB\n3 mezza ROM\n...'}
              spellCheck={false}
              className="w-full flex-1 min-h-[120px] p-2 border border-gray-200 rounded font-mono text-xs focus:outline-none focus:border-[#F5C518] resize-none"
            />

            {/* Non riconosciute con prezzo manuale */}
            {pasteAnalysis.unrecognized.length > 0 && (
              <div className="mt-1 bg-rose-50 border border-rose-200 rounded p-1.5 text-[10px] flex-shrink-0 max-h-32 overflow-y-auto">
                <div className="font-bold text-rose-700 mb-1">
                  Non riconosciute ({pasteAnalysis.unrecognized.length}) — assegna prezzo:
                </div>
                <div className="space-y-1">
                  {pasteAnalysis.unrecognized.map(u => (
                    <div key={u.idx} className="flex items-center gap-1">
                      <span className="font-mono text-rose-900 flex-1 truncate" title={u.text}>{u.text}</span>
                      <input
                        data-testid={`manual-price-${u.idx}`}
                        type="text"
                        inputMode="decimal"
                        value={manualPrices[u.idx] ?? ''}
                        onChange={(e) => setManualPrice(u.idx, e.target.value)}
                        placeholder="€"
                        className="w-12 h-6 border border-rose-300 rounded px-1 text-center font-bold text-[11px] focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Breakdown compatto */}
            <div className="mt-1 grid grid-cols-4 gap-1 flex-shrink-0">
              {PASTA_PRICES.map(p => {
                const b = pasteAnalysis.breakdown[p.sigla];
                const active = b.count > 0;
                return (
                  <div
                    key={p.sigla}
                    data-testid={`breakdown-${p.sigla}`}
                    className={`rounded border px-1 py-0.5 text-center ${active ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <div className="font-bold text-gray-800 text-[10px] leading-tight">{p.sigla}</div>
                    <div className="text-[10px] text-gray-700 leading-tight">
                      <span className="font-bold">{b.count}</span>·€{b.total}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totali */}
            <div className="mt-1 grid grid-cols-2 gap-1 flex-shrink-0">
              <div data-testid="total-paste-count" className="bg-gray-900 text-white rounded px-2 py-1 flex flex-col items-center">
                <span className="text-[9px] uppercase opacity-70">Tot paste</span>
                <span className="text-xl font-black leading-none">{pasteAnalysis.totalCount}</span>
              </div>
              <div data-testid="total-paste-euro" className="bg-[#F5C518] text-gray-900 rounded px-2 py-1 flex flex-col items-center">
                <span className="text-[9px] uppercase opacity-80">Tot €</span>
                <span className="text-xl font-black leading-none">€{fmtEur(pasteAnalysis.totalEuro)}</span>
              </div>
            </div>
            {pasteAnalysis.missingPriceCount > 0 && (
              <div className="mt-1 text-[10px] text-rose-600 text-center flex-shrink-0">
                {pasteAnalysis.missingPriceCount} senza prezzo → conta come 0
              </div>
            )}
          </section>

          {/* ============== DESTRA — CASSA + AREA FUTURA ============== */}
          <section className="flex flex-col gap-2 min-h-0">
            {/* Riga banconote */}
            <div className="bg-white rounded border border-gray-200 p-2">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Cassa</h2>
                <span className="text-[10px] text-gray-400">pezzi (eccetto "100 e 50" che è €)</span>
              </div>
              <div className="grid grid-cols-8 gap-1.5">
                {CASH_DENOMINATIONS.map(d => {
                  const raw = (cash[d.key] || '').replace(',', '.');
                  const n = parseFloat(raw);
                  const subTot = (!raw || Number.isNaN(n) || n < 0) ? 0
                    : d.mode === 'eur' ? n : n * d.value;
                  return (
                    <div key={d.key} className="flex flex-col">
                      <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5">
                        {d.label}
                      </label>
                      <input
                        data-testid={`cash-input-${d.key}`}
                        type="text"
                        inputMode="decimal"
                        value={cash[d.key] || ''}
                        onChange={(e) => setCashValue(d.key, e.target.value)}
                        placeholder={d.mode === 'eur' ? '€' : '0'}
                        className="w-full h-11 border border-gray-200 rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518]"
                      />
                      <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-none">
                        {subTot > 0 ? `€${fmtEur(subTot)}` : '\u00A0'}
                      </span>
                    </div>
                  );
                })}
                <div className="flex flex-col">
                  <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">Tot</label>
                  <div
                    data-testid="cash-total"
                    className="w-full h-11 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-black text-sm"
                  >
                    €{fmtEur(cashTotal)}
                  </div>
                  <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-none">in €</span>
                </div>
              </div>
            </div>

            {/* ============ VENDITE BEVANDE ============ */}
            <div className="bg-white rounded border border-gray-200 p-2 flex-1 min-h-0 flex flex-col">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Vendite Bevande</h2>
                <span className="text-[10px] text-gray-400">in sync con Magazzino Bevande</span>
              </div>
              {bevSales.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-xs text-gray-400 italic">
                  Nessuna bevanda configurata.
                </div>
              ) : (
                <div className="flex-1 flex items-stretch gap-1 overflow-x-auto">
                  {bevSales.map(b => (
                    <div
                      key={b.sigla}
                      data-testid={`bev-sales-${b.sigla}`}
                      className="flex-1 min-w-[60px] flex flex-col items-stretch gap-1"
                    >
                      <div className="text-[10px] font-bold text-center text-gray-700 truncate" title={b.name}>
                        {b.sigla}
                      </div>
                      <div className="flex-1 bg-gray-50 border border-gray-200 rounded flex items-center justify-center font-black text-lg text-gray-900">
                        {b.qty}
                      </div>
                      <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded flex items-center justify-center font-bold text-xs text-gray-900">
                        €{b.inc.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))}
                  {/* Totale */}
                  <div className="flex-1 min-w-[70px] flex flex-col items-stretch gap-1 border-l-2 border-gray-300 pl-1">
                    <div className="text-[10px] font-bold text-center text-gray-800 uppercase">Tot</div>
                    <div data-testid="bev-sales-total-qty" className="flex-1 bg-gray-900 text-white border border-gray-900 rounded flex items-center justify-center font-black text-lg">
                      {bevTotalQty}
                    </div>
                    <div data-testid="bev-sales-total-inc" className="flex-1 bg-[#F5C518] border border-yellow-600 rounded flex items-center justify-center font-black text-xs text-gray-900">
                      €{bevTotalInc.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              )}
              <p className="mt-1 text-[10px] text-gray-400 text-center">
                Riquadro superiore = Quantità · Riquadro inferiore = Incasso
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ReportBetaPage;
