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

// Definizione del riepilogo cassa Flaminio (Report)
const CASH_FIELDS = [
  { key: 'mattina', label: 'CASH MATTINA', op: 'base', readonly: false },
  { key: 'altro',   label: 'ALTRO',        op: 'plus',  readonly: false },
  { key: 'glo',     label: 'GLO',          op: 'minus', readonly: false },
  { key: 'just',    label: 'JUST',         op: 'minus', readonly: false },
  { key: 'delv',    label: 'DEL',          op: 'minus', readonly: false },
  { key: 'bp',      label: 'BP',           op: 'minus', readonly: false },
  { key: 'sat',     label: 'SAT',          op: 'minus', readonly: false },
  { key: 'ft',      label: 'FT',           op: 'minus', readonly: false },
  { key: 'pos',     label: 'POS',          op: 'minus', readonly: false },
  { key: 'vers',    label: 'VERS',         op: 'minus', readonly: false },
  { key: 'arr',     label: 'ARR',          op: 'plus',  readonly: false },
];

// Definizione del box SPICCI (rotolini / mazzette aperte)
const SPICCI_FIELDS = [
  { key: 'sp5',  label: '5',   mult: 50 },
  { key: 'sp2',  label: '2',   mult: 50 },
  { key: 'sp1',  label: '1',   mult: 25 },
  { key: 'sp05', label: '0,5', mult: 20 },
];

// Cassetto spicci — stock totale disponibile per ciascun taglio.
// Il residuo mostrato = cassetto - "aperti" del taglio corrispondente.
const CASSETTO_FIELDS = [
  { key: 'cd5',  label: '5€',   spicciKey: 'sp5'  },
  { key: 'cd2',  label: '2€',   spicciKey: 'sp2'  },
  { key: 'cd1',  label: '1€',   spicciKey: 'sp1'  },
  { key: 'cd05', label: '0,5€', spicciKey: 'sp05' },
];

// Popover commento (right-click su un quadratino)
const CommentPopover = ({ inputRef, value, onChange, onSave, onCancel }) => {
  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 z-50"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-amber-50 border-2 border-amber-400 rounded-md shadow-2xl p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-amber-800 uppercase">Commento</span>
          <span className="text-[9px] text-amber-600">Enter salva · Esc annulla</span>
        </div>
        <textarea
          ref={inputRef}
          data-testid="comment-popover-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          rows={3}
          placeholder="Aggiungi una nota…"
          className="w-full text-xs border border-amber-300 rounded p-1 focus:outline-none focus:border-amber-500 resize-none bg-white"
        />
        <div className="flex gap-1 mt-1 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
          >Annulla</button>
          <button
            type="button"
            onClick={onSave}
            className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-white font-bold hover:bg-amber-600"
          >Salva</button>
        </div>
      </div>
      {/* triangolino sotto */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-amber-50 border-r-2 border-b-2 border-amber-400 rotate-45"></div>
    </div>
  );
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
  // Riepilogo cassa Flaminio (persistente su DB) + SPICCI + CASSETTO
  const [cashRow, setCashRow] = useState(() => {
    const init = {};
    CASH_FIELDS.forEach(f => { init[f.key] = ''; });
    SPICCI_FIELDS.forEach(f => { init[f.key] = ''; });
    CASSETTO_FIELDS.forEach(f => { init[f.key] = ''; });
    return init;
  });
  const [cashComments, setCashComments] = useState({}); // { key: "testo commento" }
  const [focusedField, setFocusedField] = useState(null); // key | null (zoom-on-focus)
  const [commentPopover, setCommentPopover] = useState(null); // { key, value }
  const commentInputRef = React.useRef(null);
  const [cashLoaded, setCashLoaded] = useState(false);
  const cashSaveTimer = React.useRef(null);
  // Cassetto spicci — edit mode (click-to-edit, conferma su Enter/blur, annulla su Esc)
  const [editingCassetto, setEditingCassetto] = useState(null); // key | null
  const [editingValue, setEditingValue] = useState('');         // valore digitato durante edit
  const editingInputRef = React.useRef(null);

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

  // Riepilogo cassa: caricamento iniziale (no polling, è la sorgente di verità qui)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/cash/daily`, { headers: { Authorization: `Bearer ${token}` } });
        if (cancelled) return;
        const data = res.data?.data || {};
        const prev = res.data?.prev_cash_sera;
        // Auto-fill MATTINA con CASH SERA del giorno prima se oggi è vuoto
        const initial = {};
        CASH_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        SPICCI_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        CASSETTO_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        if (!initial.mattina && prev !== '' && prev !== null && prev !== undefined) {
          initial.mattina = String(prev);
        }
        setCashRow(initial);
        setCashComments(res.data?.comments || {});
        setCashLoaded(true);
      } catch (e) {
        // 403 se non Flaminio/Admin
        setCashLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Debounced save del riepilogo cassa
  useEffect(() => {
    if (!cashLoaded || !token) return;
    if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current);
    cashSaveTimer.current = setTimeout(() => {
      axios.put(`${API}/cash/daily`, { ...cashRow, comments: cashComments }, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* silenzioso */ });
    }, 500);
    return () => { if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current); };
  }, [cashRow, cashComments, cashLoaded, token]);

  const setCashRowValue = (key, v) => setCashRow(p => ({ ...p, [key]: v }));

  // Autofocus quando si entra in edit mode su un quadratino del cassetto
  useEffect(() => {
    if (editingCassetto && editingInputRef.current) {
      editingInputRef.current.focus();
      editingInputRef.current.select();
    }
  }, [editingCassetto]);

  const startEditCassetto = (f) => {
    // Mostra nell'input il valore residuo corrente (stock_base - aperti)
    const raw = cashRow[f.key];
    if (raw === '' || raw === undefined || raw === null) {
      setEditingValue('');
    } else {
      const base = evaluateValue(raw);
      const aperti = evaluateValue(cashRow[f.spicciKey]);
      const residuo = base - aperti;
      // Mostro intero se non ha decimali, altrimenti con max 2 decimali
      setEditingValue(Number.isInteger(residuo) ? String(residuo) : String(+residuo.toFixed(2)));
    }
    setEditingCassetto(f.key);
  };
  const commitEditCassetto = (f) => {
    if (editingValue.trim() === '') {
      // Campo svuotato → resetto stock a stringa vuota
      setCashRow(p => ({ ...p, [f.key]: '' }));
    } else {
      const typed = evaluateValue(editingValue);
      const aperti = evaluateValue(cashRow[f.spicciKey]);
      const newBase = typed + aperti;
      // Salvo come stringa "pulita" (no decimali se intero)
      const baseStr = Number.isInteger(newBase) ? String(newBase) : String(+newBase.toFixed(2));
      setCashRow(p => ({ ...p, [f.key]: baseStr }));
    }
    setEditingCassetto(null);
    setEditingValue('');
  };
  const cancelEditCassetto = () => {
    // Nessuna modifica a cashRow durante l'edit, basta uscire
    setEditingCassetto(null);
    setEditingValue('');
  };

  // Commenti: right-click su una cella → popover
  const openCommentPopover = (key) => {
    setCommentPopover({ key, value: cashComments[key] || '' });
  };
  const closeCommentPopover = () => setCommentPopover(null);
  const saveCommentPopover = () => {
    if (!commentPopover) return;
    const { key, value } = commentPopover;
    const trimmed = (value || '').trim();
    setCashComments(prev => {
      const next = { ...prev };
      if (trimmed) next[key] = trimmed;
      else delete next[key];
      return next;
    });
    setCommentPopover(null);
  };

  // Autofocus del popover commento appena si apre
  useEffect(() => {
    if (commentPopover && commentInputRef.current) {
      commentInputRef.current.focus();
      commentInputRef.current.select();
    }
  }, [commentPopover]);

  // Calcolo valori SPICCI per ogni taglio + totale euro
  const spicciValues = useMemo(() => {
    const rows = SPICCI_FIELDS.map(f => {
      const aperti = evaluateValue(cashRow[f.key]);
      return { ...f, aperti, value: aperti * f.mult };
    });
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [cashRow]);

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

  // Calcolo CASH SERA in tempo reale
  // Include anche: TOT box Paste (incasso paste) + TOT box Bevande (incasso bev)
  const cashSera = useMemo(() => {
    let total = 0;
    for (const f of CASH_FIELDS) {
      const v = evaluateValue(cashRow[f.key]);
      if (f.op === 'base' || f.op === 'plus') total += v;
      else if (f.op === 'minus') total -= v;
    }
    total += pasteAnalysis.totalEuro;
    total += bevTotalInc;
    return total;
  }, [cashRow, pasteAnalysis.totalEuro, bevTotalInc]);

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
            <div className="bg-white rounded border border-gray-200 p-2">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Vendite Bevande</h2>
                <span className="text-[10px] text-gray-400">Q.tà · Incasso — in sync con Magazzino Bevande</span>
              </div>
              {bevSales.length === 0 ? (
                <div className="h-11 flex items-center justify-center text-xs text-gray-400 italic">
                  Nessuna bevanda configurata.
                </div>
              ) : (
                <div className="flex items-stretch gap-1.5">
                  {bevSales.map(b => (
                    <div
                      key={b.sigla}
                      data-testid={`bev-sales-${b.sigla}`}
                      className="flex-1 min-w-[60px] flex flex-col"
                    >
                      <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>
                        {b.sigla}
                      </label>
                      <div className="w-full h-11 bg-gray-50 border border-gray-200 rounded flex items-center justify-center font-black text-base text-gray-900">
                        {b.qty}
                      </div>
                      <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-none">
                        €{b.inc.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  {/* Totale */}
                  <div className="flex-1 min-w-[70px] flex flex-col">
                    <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">Tot</label>
                    <div
                      data-testid="bev-sales-total-qty"
                      className="w-full h-11 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-black text-base"
                    >
                      {bevTotalQty}
                    </div>
                    <span data-testid="bev-sales-total-inc" className="text-[9px] text-gray-700 mt-0.5 text-center leading-none font-bold">
                      €{bevTotalInc.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ============ RIEPILOGO CASSA ============ */}
            <div className="bg-white rounded border border-gray-200 p-2">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Riepilogo Cassa</h2>
                <span className="text-[10px] text-gray-400">
                  Mattina = Sera del giorno prima · supporta formule "=..."
                </span>
              </div>
              <div className="flex items-stretch gap-1.5">
                {CASH_FIELDS.map(f => {
                  const computed = evaluateValue(cashRow[f.key]);
                  const sign = f.op === 'minus' ? '−' : (f.op === 'plus' ? '+' : '=');
                  const isFocused = focusedField === f.key;
                  const hasComment = !!cashComments[f.key];
                  return (
                    <div key={f.key} className="flex-1 min-w-[60px] flex flex-col relative">
                      <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={f.label}>
                        {f.label}
                      </label>
                      <input
                        data-testid={`cash-row-${f.key}`}
                        type="text"
                        inputMode="decimal"
                        value={cashRow[f.key] || ''}
                        onChange={(e) => setCashRowValue(f.key, e.target.value)}
                        onFocus={() => setFocusedField(f.key)}
                        onBlur={() => setFocusedField(curr => curr === f.key ? null : curr)}
                        onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                        placeholder={f.op === 'base' ? '€' : (f.op === 'minus' ? '−' : '+')}
                        className={`w-full h-11 border rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518] transition-transform duration-150 origin-center ${
                          isFocused ? 'scale-[1.7] z-50 relative shadow-2xl' : ''
                        } ${
                          f.op === 'minus' ? 'border-rose-200 bg-rose-50' :
                          f.op === 'plus'  ? 'border-emerald-200 bg-emerald-50' :
                                             'border-gray-200'
                        }`}
                      />
                      {hasComment && (
                        <span
                          title={cashComments[f.key]}
                          className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                        />
                      )}
                      <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-none">
                        {computed !== 0 ? `${sign}€${computed.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u00A0'}
                      </span>
                      {commentPopover?.key === f.key && (
                        <CommentPopover
                          inputRef={commentInputRef}
                          value={commentPopover.value}
                          onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                          onSave={saveCommentPopover}
                          onCancel={closeCommentPopover}
                        />
                      )}
                    </div>
                  );
                })}
                {/* CASH SERA — totale */}
                <div className="flex-1 min-w-[70px] flex flex-col">
                  <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">CASH SERA</label>
                  <div
                    data-testid="cash-row-sera"
                    className="w-full h-11 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-black text-sm"
                  >
                    €{cashSera.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <span className="text-[9px] text-gray-700 mt-0.5 text-center leading-none font-bold">totale</span>
                </div>
              </div>
            </div>

            {/* ============ SPICCI + CASSETTO SPICCI (stessa riga) ============ */}
            <div className="flex items-stretch gap-2">
              {/* --- SPICCI (rotolini aperti) --- */}
              <div className="bg-white rounded border border-gray-200 p-2 flex-[5] min-w-0">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Spicci</h2>
                <span className="text-[10px] text-gray-400">
                  Aperti × valore rotolino/mazzetta
                </span>
              </div>
              <div className="flex items-stretch gap-1.5">
                {spicciValues.rows.map(r => {
                  const isFocused = focusedField === r.key;
                  const hasComment = !!cashComments[r.key];
                  return (
                  <div key={r.key} className="flex-1 min-w-[50px] flex flex-col relative">
                    <label className="text-[10px] font-bold text-gray-800 text-center leading-none mb-0.5">
                      {r.label}
                    </label>
                    <input
                      data-testid={`spicci-aperti-${r.key}`}
                      type="text"
                      inputMode="decimal"
                      value={cashRow[r.key] || ''}
                      onChange={(e) => setCashRowValue(r.key, e.target.value)}
                      onFocus={() => setFocusedField(r.key)}
                      onBlur={() => setFocusedField(curr => curr === r.key ? null : curr)}
                      onContextMenu={(e) => { e.preventDefault(); openCommentPopover(r.key); }}
                      placeholder="aperti"
                      className={`w-full h-11 border border-gray-200 rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518] transition-transform duration-150 origin-center ${
                        isFocused ? 'scale-[1.7] z-50 relative shadow-2xl' : ''
                      }`}
                    />
                    {hasComment && (
                      <span
                        title={cashComments[r.key]}
                        className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                      />
                    )}
                    <div
                      data-testid={`spicci-valore-${r.key}`}
                      className="w-full h-11 mt-1 bg-yellow-50 border border-yellow-200 rounded flex items-center justify-center font-black text-sm text-gray-900"
                    >
                      €{r.value.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-[9px] text-gray-500 mt-0.5 text-center leading-none">×{r.mult}</span>
                    {commentPopover?.key === r.key && (
                      <CommentPopover
                        inputRef={commentInputRef}
                        value={commentPopover.value}
                        onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                        onSave={saveCommentPopover}
                        onCancel={closeCommentPopover}
                      />
                    )}
                  </div>
                  );
                })}
                {/* Totale spicci */}
                <div className="flex-1 min-w-[60px] flex flex-col">
                  <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">TOT</label>
                  <div className="w-full h-11 border border-transparent rounded flex items-center justify-center text-[10px] text-gray-400 italic">
                    {/* nessun input sul totale */}
                    —
                  </div>
                  <div
                    data-testid="spicci-totale"
                    className="w-full h-11 mt-1 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-black text-sm"
                  >
                    €{spicciValues.total.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </div>
                  <span className="text-[9px] text-gray-700 mt-0.5 text-center leading-none font-bold">totale</span>
                </div>
              </div>
              </div>

              {/* --- CASSETTO SPICCI (stock totale, click-to-edit) --- */}
              <div className="bg-white rounded border border-gray-200 p-2 flex-[4] min-w-0">
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-xs font-bold text-gray-800 uppercase">Cassetto Spicci</h2>
                  <span className="text-[10px] text-gray-400">click per modificare</span>
                </div>
                <div className="flex items-stretch gap-1.5">
                  {CASSETTO_FIELDS.map(f => {
                    const isEditing = editingCassetto === f.key;
                    const isFocused = focusedField === f.key;
                    const hasComment = !!cashComments[f.key];
                    const raw = cashRow[f.key];
                    let displayValue = '—';
                    let isNegative = false;
                    if (raw !== '' && raw !== undefined && raw !== null) {
                      const base = evaluateValue(raw);
                      const aperti = evaluateValue(cashRow[f.spicciKey]);
                      const residuo = base - aperti;
                      isNegative = residuo < 0;
                      displayValue = Number.isInteger(residuo)
                        ? String(residuo)
                        : residuo.toLocaleString('it-IT', { maximumFractionDigits: 2 });
                    }
                    return (
                      <div key={f.key} className="flex-1 min-w-[50px] flex flex-col relative">
                        <label className="text-[10px] font-bold text-gray-800 text-center leading-none mb-0.5">
                          {f.label}
                        </label>
                        {isEditing ? (
                          <input
                            ref={editingInputRef}
                            data-testid={`cassetto-input-${f.key}`}
                            type="text"
                            inputMode="decimal"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onFocus={() => setFocusedField(f.key)}
                            onBlur={() => { setFocusedField(curr => curr === f.key ? null : curr); commitEditCassetto(f); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitEditCassetto(f); }
                              else if (e.key === 'Escape') { e.preventDefault(); cancelEditCassetto(); }
                            }}
                            onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                            placeholder="stock"
                            className={`w-full h-11 border-2 border-[#F5C518] rounded px-1 text-center font-bold text-sm focus:outline-none bg-yellow-50 transition-transform duration-150 origin-center ${
                              isFocused ? 'scale-[1.7] z-50 relative shadow-2xl' : ''
                            }`}
                          />
                        ) : (
                          <button
                            type="button"
                            data-testid={`cassetto-display-${f.key}`}
                            onClick={() => startEditCassetto(f)}
                            onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                            title="Clicca per modificare · destro per commento"
                            className={`w-full h-11 border rounded px-1 text-center font-black text-sm transition-colors cursor-pointer ${
                              isNegative
                                ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                                : 'bg-gray-50 border-gray-200 text-gray-900 hover:bg-yellow-50 hover:border-yellow-300'
                            }`}
                          >
                            {displayValue}
                          </button>
                        )}
                        {hasComment && (
                          <span
                            title={cashComments[f.key]}
                            className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                          />
                        )}
                        {commentPopover?.key === f.key && (
                          <CommentPopover
                            inputRef={commentInputRef}
                            value={commentPopover.value}
                            onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                            onSave={saveCommentPopover}
                            onCancel={closeCommentPopover}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ReportBetaPage;
