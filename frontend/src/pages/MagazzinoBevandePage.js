import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, Plus } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Chiave localStorage per i conteggi giornalieri della pagina (mattina/scarti/sera/in-usc)
// Si resetta giorno per giorno: chiave include la data in fuso Roma.
const todayRomeKey = () => {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const lsKey = (loc) => `bev_counts_${loc || 'flaminio'}_${todayRomeKey()}`;

const MagazzinoBevandePage = () => {
  const { token, isAdmin, restaurant } = useAuth();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  // counts[sigla] = { mattina, inUsc, scarti, sera }   tutti string per input libero
  const [counts, setCounts] = useState({});

  const canAccess = isAdmin || restaurant?.username === 'Flaminio';
  const storageKey = useMemo(() => lsKey(restaurant?.username), [restaurant]);

  useEffect(() => {
    if (!canAccess) return;
    axios.get(`${API}/beverages/inventory`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setInventory(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, canAccess]);

  // Carica conteggi dal localStorage al primo render
  useEffect(() => {
    if (!canAccess) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setCounts(JSON.parse(raw));
    } catch { /* noop */ }
  }, [storageKey, canAccess]);

  // Salva conteggi nel localStorage ogni volta che cambiano
  useEffect(() => {
    if (!canAccess) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(counts));
    } catch { /* noop */ }
  }, [counts, storageKey, canAccess]);

  const setField = (sigla, field, value) => {
    setCounts(prev => ({
      ...prev,
      [sigla]: { ...(prev[sigla] || {}), [field]: value },
    }));
  };

  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return 0;
    const s = String(v).trim().replace(',', '.');
    // Formula mode: se inizia con "=" valuta un'espressione aritmetica.
    // Sicuro: accettiamo solo cifre, +, -, *, /, ., (, ), spazi.
    if (s.startsWith('=')) {
      const expr = s.slice(1).trim();
      if (!expr) return 0;
      if (!/^[\d+\-*/.() \s]*$/.test(expr)) return 0;
      try {
        // eslint-disable-next-line no-new-func
        const v2 = Function(`"use strict"; return (${expr})`)();
        return Number.isFinite(v2) ? v2 : 0;
      } catch { return 0; }
    }
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };

  // Calcoli aggregati
  const rows = useMemo(() => inventory.map(b => {
    const c = counts[b.sigla] || {};
    const mattina = toNum(c.mattina);
    const inUsc = toNum(c.inUsc);
    const scarti = toNum(c.scarti);
    const sera = toNum(c.sera);
    // Se MAGAZZINO SERA è 0 (non ancora contato) la quantità venduta non è calcolabile -> 0
    const quantita = sera === 0 ? 0 : (mattina + inUsc - scarti - sera);
    const incasso = Math.max(0, quantita) * (b.price || 0);
    return { ...b, mattina, inUsc, scarti, sera, quantita, incasso };
  }), [inventory, counts]);

  const totalQuantita = rows.reduce((s, r) => s + Math.max(0, r.quantita), 0);
  const totalIncasso = rows.reduce((s, r) => s + r.incasso, 0);

  const fmtEur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Questa sezione è disponibile solo per Flaminio.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Indietro
          </button>
          <button
            data-testid="btn-new-beverage-carico"
            onClick={() => navigate('/magazzino-bevande/nuovo-carico')}
            className="flex items-center gap-2 bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 font-bold px-4 py-2 rounded-lg shadow text-sm"
          >
            <Plus size={16} /> INGRESSI/USCITE
          </button>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Magazzino Bevande
        </h1>

        {loading ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm" data-testid="beverage-table">
              <thead className="bg-gray-50 text-gray-700 text-[11px] uppercase">
                <tr>
                  <th rowSpan={2} className="text-left px-2 py-2 font-bold border-r border-gray-200">Bevanda</th>
                  <th rowSpan={2} className="text-center px-2 py-2 font-bold border-r border-gray-200">Magazzino<br/>Mattina</th>
                  <th rowSpan={2} className="text-center px-2 py-2 font-bold border-r border-gray-200">Ingressi/<br/>Uscite</th>
                  <th rowSpan={2} className="text-center px-2 py-2 font-bold border-r border-gray-200">Scarti</th>
                  <th rowSpan={2} className="text-center px-2 py-2 font-bold border-r border-gray-200">Magazzino<br/>Sera</th>
                  <th colSpan={2} className="text-center px-2 py-1 font-bold bg-yellow-50 border-l border-yellow-200">Vendite</th>
                </tr>
                <tr>
                  <th className="text-center px-2 py-1 font-bold bg-yellow-50 border-l border-yellow-200">Quantità</th>
                  <th className="text-center px-2 py-1 font-bold bg-yellow-50">Incasso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.sigla} data-testid={`bev-row-${r.sigla}`} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 border-r border-gray-200">
                      <div className="font-extrabold text-gray-900">{r.sigla}</div>
                      <div className="text-[10px] text-gray-500 truncate max-w-[160px]" title={r.name}>{r.name}</div>
                      <div className="text-[10px] text-gray-400">€{r.price?.toFixed(2)}</div>
                    </td>
                    {['mattina', 'inUsc', 'scarti', 'sera'].map(field => {
                      const raw = (counts[r.sigla] || {})[field] ?? '';
                      const isFormula = String(raw).trim().startsWith('=');
                      const evaluated = isFormula ? toNum(raw) : null;
                      return (
                        <td key={field} className="px-1 py-1 border-r border-gray-200">
                          <input
                            data-testid={`bev-${r.sigla}-${field}`}
                            type="text"
                            inputMode="text"
                            value={raw}
                            onChange={(e) => setField(r.sigla, field, e.target.value)}
                            title={(field === 'inUsc' || field === 'sera') ? 'Puoi usare formule: es. =12-2 oppure =5+3' : ''}
                            className={`w-16 h-9 border rounded text-center font-bold text-sm focus:outline-none focus:border-[#F5C518] ${isFormula ? 'bg-blue-50 border-blue-300 text-blue-900' : 'border-gray-200'}`}
                            placeholder={(field === 'inUsc' || field === 'sera') ? '0 o =…' : '0'}
                          />
                          {isFormula && (
                            <div className="text-[9px] text-blue-700 font-bold text-center mt-0.5 leading-none">
                              = {evaluated}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className={`px-2 py-1.5 text-center font-black bg-yellow-50 border-l border-yellow-200 ${r.quantita < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                      {r.quantita}
                    </td>
                    <td className="px-2 py-1.5 text-center font-bold text-gray-900 bg-yellow-50">
                      €{fmtEur(r.incasso)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">
                    Nessuna bevanda nell'inventario.
                  </td></tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-900 text-white">
                    <td colSpan={5} className="px-3 py-2 font-bold text-right uppercase text-xs">
                      Totali giornata
                    </td>
                    <td data-testid="total-vendite-quantita" className="px-2 py-2 text-center font-black text-lg bg-[#F5C518] text-gray-900">
                      {totalQuantita}
                    </td>
                    <td data-testid="total-vendite-incasso" className="px-2 py-2 text-center font-black text-base bg-[#F5C518] text-gray-900">
                      €{fmtEur(totalIncasso)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] text-gray-500">
          • Quantità venduta = Magazzino Mattina + Ingressi/Uscite − Scarti − Magazzino Sera.<br/>
          • Se "Magazzino Sera" è 0 (non ancora contato) la quantità resta a 0.<br/>
          • Nelle caselle "Ingressi/Uscite" e "Magazzino Sera" puoi usare le formule: es. <code className="bg-blue-50 px-1 rounded">=12-2</code> per inserire 10, oppure <code className="bg-blue-50 px-1 rounded">=5+3+1</code> per 9.<br/>
          • I valori si salvano automaticamente in locale e si resettano ad ogni cambio giornata.
        </p>
      </main>
    </div>
  );
};

export default MagazzinoBevandePage;
