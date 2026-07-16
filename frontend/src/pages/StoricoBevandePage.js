import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const evaluateValue = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/,/g, '.');
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

const StoricoBevandePage = () => {
  const { token, canImpersonate, restaurant } = useAuth();
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  const canAccess = canImpersonate || restaurant?.username === 'Flaminio';
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([
      axios.get(`${API}/beverages/inventory`, { headers }),
      axios.get(`${API}/beverages/daily/history?days=60`, { headers }),
    ])
      .then(([invRes, hRes]) => {
        setInventory(invRes.data || []);
        setHistory(hRes.data?.days || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [headers, canAccess]);

  const priceMap = useMemo(
    () => Object.fromEntries((inventory || []).map(b => [b.sigla, b.price || 0])),
    [inventory]
  );

  const fmtEur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso) => {
    try {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    } catch { return iso; }
  };

  const dayTotal = (rows) => {
    let q = 0, e = 0;
    for (const r of rows || []) {
      const m = evaluateValue(r.mattina);
      const u = evaluateValue(r.inUsc);
      const sc = evaluateValue(r.scarti);
      const se = evaluateValue(r.sera);
      const qty = (se === 0 ? 0 : (m + u - se)) - sc;
      q += qty;
      e += qty * (priceMap[r.sigla] || 0);
    }
    return { quantita: q, incasso: e };
  };

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
            onClick={() => navigate('/magazzino-bevande')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Indietro
          </button>
        </div>
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Storico Bevande
        </h1>

        {loading ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : history.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-400">
            Nessuna chiusura registrata negli ultimi 60 giorni.
          </div>
        ) : (
          <div className="space-y-4">
            {history.map(day => {
              const tot = dayTotal(day.rows);
              return (
                <div
                  key={day.date}
                  data-testid={`history-day-${day.date}`}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                >
                  <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h2 className="font-bold text-gray-900">{fmtDate(day.date)}</h2>
                    <div className="flex gap-4 text-sm">
                      <span><b>{tot.quantita}</b> pezzi venduti</span>
                      <span className="text-[#9a8420] font-bold">€{fmtEur(tot.incasso)}</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="text-left px-2 py-1">Bevanda</th>
                          <th className="text-center px-2 py-1">Mattina</th>
                          <th className="text-center px-2 py-1">In/Usc</th>
                          <th className="text-center px-2 py-1">Scarti</th>
                          <th className="text-center px-2 py-1">Sera</th>
                          <th className="text-center px-2 py-1 bg-yellow-50">Vendute</th>
                          <th className="text-center px-2 py-1 bg-yellow-50">Incasso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(day.rows || []).map(r => {
                          const m = evaluateValue(r.mattina);
                          const u = evaluateValue(r.inUsc);
                          const sc = evaluateValue(r.scarti);
                          const se = evaluateValue(r.sera);
                          const qty = (se === 0 ? 0 : (m + u - se)) - sc;
                          const inc = qty * (priceMap[r.sigla] || 0);
                          return (
                            <tr key={r.sigla} className="border-t border-gray-100">
                              <td className="px-2 py-1 font-bold">{r.sigla}</td>
                              <td className="px-2 py-1 text-center">{r.mattina || '—'}</td>
                              <td className="px-2 py-1 text-center">{r.inUsc || '—'}</td>
                              <td className="px-2 py-1 text-center">{r.scarti || '—'}</td>
                              <td className="px-2 py-1 text-center">{r.sera || '—'}</td>
                              <td className={`px-2 py-1 text-center font-bold bg-yellow-50 ${qty < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{qty}</td>
                              <td className="px-2 py-1 text-center font-bold bg-yellow-50">€{fmtEur(inc)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default StoricoBevandePage;
