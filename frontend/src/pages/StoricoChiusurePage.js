import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtEur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => {
  if (!s) return '';
  try {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  } catch (e) { return s; }
};

const StoricoChiusurePage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Selettore locale
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(() => localStorage.getItem('closures_rest_id') || '');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Carica elenco ristoranti
  useEffect(() => {
    if (!isAdmin || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, { headers });
        const list = (res.data || []).filter(r => r.role !== 'admin');
        setRestaurants(list);
        if (!selectedRestId && list.length > 0) {
          setSelectedRestId(list[0].id);
          localStorage.setItem('closures_rest_id', list[0].id);
        }
      } catch (e) { console.error('list restaurants', e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token]);

  useEffect(() => {
    if (!isAdmin || !token || !selectedRestId) { setItems([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await axios.get(
          `${API}/admin/closures?days=120&restaurant_id=${selectedRestId}`,
          { headers },
        );
        if (cancelled) return;
        setItems(res.data?.items || []);
      } catch (e) {
        console.error('list closures', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, token, headers, selectedRestId]);

  useEffect(() => {
    if (!selectedDate || !selectedRestId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await axios.get(
          `${API}/admin/closures/${selectedDate}?restaurant_id=${selectedRestId}`,
          { headers },
        );
        if (cancelled) return;
        setDetail(res.data);
      } catch (e) {
        console.error('closure detail', e);
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate, selectedRestId, headers]);

  const changeRestaurant = (id) => {
    setSelectedRestId(id);
    localStorage.setItem('closures_rest_id', id);
    setSelectedDate(null);
    setDetail(null);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Accesso riservato all'Admin.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">Archivio chiusure giornaliere</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Storico Chiusure
        </h1>

        {/* Selettore locale */}
        <div className="mb-4 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-bold text-gray-700">Locale:</label>
          <select
            data-testid="closures-restaurant-select"
            value={selectedRestId}
            onChange={(e) => changeRestaurant(e.target.value)}
            className="flex-1 min-w-[200px] max-w-sm border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F5C518] bg-white"
          >
            {restaurants.length === 0 && <option value="">Caricamento…</option>}
            {restaurants.map(r => (
              <option key={r.id} value={r.id}>{r.location || r.name || r.username}</option>
            ))}
          </select>
          <span className="text-[11px] text-gray-500">
            {items.length} {items.length === 1 ? 'chiusura archiviata' : 'chiusure archiviate'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          {/* Lista date */}
          <aside className="bg-white border border-gray-200 rounded-lg p-2 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            {loading ? (
              <div className="text-center text-gray-400 py-6 text-sm">Caricamento…</div>
            ) : items.length === 0 ? (
              <div className="text-center text-gray-400 py-6 text-sm">Nessuna chiusura archiviata.</div>
            ) : (
              <ul className="space-y-1">
                {items.map(it => (
                  <li key={it.date}>
                    <button
                      data-testid={`closure-${it.date}`}
                      onClick={() => setSelectedDate(it.date)}
                      className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                        selectedDate === it.date
                          ? 'bg-[#F5C518] border-[#F5C518] text-gray-900'
                          : 'bg-gray-50 border-gray-200 hover:bg-yellow-50 hover:border-yellow-300'
                      }`}
                    >
                      <div className="font-bold text-sm">{fmtDate(it.date)}</div>
                      <div className="text-[11px] text-gray-600 mt-0.5 flex gap-2">
                        <span>📦 {it.orders_total}</span>
                        <span>🥤 {it.bev_total_qty}</span>
                        <span>💶 €{fmtEur(it.cash_sera)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Dettaglio */}
          <section className="bg-white border border-gray-200 rounded-lg p-4 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            {!selectedDate ? (
              <div className="text-center text-gray-400 py-10">
                Seleziona una data dall'elenco a sinistra
              </div>
            ) : detailLoading ? (
              <div className="text-center text-gray-400 py-10">Caricamento dettaglio…</div>
            ) : !detail ? (
              <div className="text-rose-600">Errore nel caricamento del dettaglio.</div>
            ) : (
              <ClosureDetail detail={detail} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

// ============== Dettaglio ==============
// Colore label dei box riepilogo cassa (allineato a Report)
const CASH_LABEL_COLOR = {
  mattina: '#374151',
  altro:   '#7c3aed', // viola
  glo:     '#ca8a04', // giallo
  just:    '#ea580c', // arancione
  delv:    '#15803d', // verde
  bp:      '#8b4513', // marrone
  sat:     '#8b4513', // marrone
  ft:      '#0ea5e9', // azzurro
  pos:     '#1d4ed8', // blu
  vers:    '#111827', // nero
  arr:     '#dc2626', // rosso
};

const ClosureDetail = ({ detail }) => {
  const cash = detail.cash || {};
  const bev = detail.beverages || [];
  // cashRows: [label, key, value, sign]
  const cashRows = [
    ['Mattina','mattina', cash.mattina, '+'],
    ['Altro',  'altro',   cash.altro,   '+'],
    ['ARR',    'arr',     cash.arr,     '+'],
    ['GLO',    'glo',     cash.glo,     '−'],
    ['JUST',   'just',    cash.just,    '−'],
    ['DEL',    'delv',    cash.delv,    '−'],
    ['BP',     'bp',      cash.bp,      '−'],
    ['SAT',    'sat',     cash.sat,     '−'],
    ['FT',     'ft',      cash.ft,      '−'],
    ['POS',    'pos',     cash.pos,     '−'],
    ['VERS',   'vers',    cash.vers,    '−'],
  ];
  // Spicci: aperti, cassetto totale, residuo
  const spicciRows = [
    { lbl: '5€',   aperti: cash.sp5,  stock: cash.cd5  },
    { lbl: '2€',   aperti: cash.sp2,  stock: cash.cd2  },
    { lbl: '1€',   aperti: cash.sp1,  stock: cash.cd1  },
    { lbl: '0,5€', aperti: cash.sp05, stock: cash.cd05 },
  ];
  const evalNum = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    const s = String(v).trim().replace(',', '.');
    if (s.startsWith('=')) {
      const expr = s.slice(1).trim();
      if (!expr || !/^[\d+\-*/.() \s]*$/.test(expr)) return 0;
      try {
        // eslint-disable-next-line no-new-func
        const n = Function(`"use strict"; return (${expr})`)();
        return Number.isFinite(n) ? n : 0;
      } catch { return 0; }
    }
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900 uppercase mb-1">{fmtDate(detail.date)}</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="bg-gray-900 text-[#F5C518] rounded px-3 py-1.5 font-black">
            CASH SERA €{fmtEur(detail.cash_sera)}
          </div>
          <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-1.5">
            <span className="text-[10px] uppercase text-yellow-800">Paste tot</span>
            <span className="font-bold ml-2">{detail.paste_count ?? 0}</span>
          </div>
          <div className="bg-yellow-50 border border-yellow-300 rounded px-3 py-1.5">
            <span className="text-[10px] uppercase text-yellow-800">Bevande</span>
            <span className="font-bold ml-2">{detail.bev_total_qty}</span>
            <span className="text-[10px] uppercase text-yellow-800 ml-3">Importo</span>
            <span className="font-bold ml-2">€{fmtEur(detail.bev_total_inc)}</span>
          </div>
        </div>
      </div>

      {/* CASH — Tabella riepilogo cassa con label colorate */}
      <div>
        <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Riepilogo Cassa</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-xs">
          {cashRows.map(([label, key, v, sign]) => (
            <div key={key} className="bg-gray-50 border border-gray-200 rounded p-1.5">
              <div
                className="text-[10px] uppercase font-extrabold"
                style={CASH_LABEL_COLOR[key] ? { color: CASH_LABEL_COLOR[key] } : undefined}
              >
                {sign} {label}
              </div>
              <div className="font-black text-gray-900">{v || '—'}</div>
            </div>
          ))}
        </div>
        {/* Spicci: aperti + cassetto + residuo */}
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs">
          {spicciRows.map(s => {
            const aperti = evalNum(s.aperti);
            const stock = evalNum(s.stock);
            const residuo = stock - aperti;
            const hasStock = s.stock !== undefined && s.stock !== null && s.stock !== '';
            return (
              <div key={s.lbl} className="bg-blue-50 border border-blue-200 rounded p-1.5">
                <div className="text-[10px] uppercase text-blue-800 font-extrabold">Spicci {s.lbl}</div>
                <div className="flex justify-between text-[11px] mt-0.5">
                  <span className="text-gray-700">Aperti: <b className="text-gray-900">{s.aperti || '0'}</b></span>
                  <span className="text-gray-700">Cassetto: <b className="text-gray-900">{hasStock ? s.stock : '—'}</b></span>
                </div>
                <div className="text-[11px] mt-0.5">
                  <span className="text-gray-700">Residuo: </span>
                  <b className={hasStock ? (residuo < 0 ? 'text-rose-700' : 'text-emerald-700') : 'text-gray-400'}>
                    {hasStock ? (Number.isInteger(residuo) ? residuo : residuo.toFixed(2)) : '—'}
                  </b>
                </div>
              </div>
            );
          })}
        </div>
        {cash.paste_text && (
          <details className="mt-2 bg-gray-50 border border-gray-200 rounded p-2">
            <summary className="text-[11px] font-bold cursor-pointer text-gray-700">Paste incollate ({cash.paste_text.split('\n').filter(Boolean).length})</summary>
            <pre className="text-[11px] mt-1 whitespace-pre-wrap font-mono">{cash.paste_text}</pre>
          </details>
        )}
      </div>

      {/* BEVANDE */}
      {bev.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Bevande</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-1">Bevanda</th>
                  <th className="text-center p-1">Mattina</th>
                  <th className="text-center p-1">In/Usc</th>
                  <th className="text-center p-1">Scarti</th>
                  <th className="text-center p-1">Sera</th>
                  <th className="text-center p-1 bg-yellow-50">Vendute</th>
                  <th className="text-center p-1 bg-yellow-50">€</th>
                </tr>
              </thead>
              <tbody>
                {bev.map(b => (
                  <tr key={b.sigla} className="border-t border-gray-100">
                    <td className="p-1">
                      <span className="font-extrabold">{b.sigla}</span>
                      <span className="text-gray-400 text-[10px] ml-1">{b.name}</span>
                    </td>
                    <td className="text-center p-1">{b.mattina || '—'}</td>
                    <td className="text-center p-1">{b.inUsc || '—'}</td>
                    <td className="text-center p-1">{b.scarti || '—'}</td>
                    <td className="text-center p-1">{b.sera || '—'}</td>
                    <td className="text-center p-1 font-black bg-yellow-50">{b.quantita}</td>
                    <td className="text-center p-1 font-bold bg-yellow-50">€{fmtEur(b.incasso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COMMENTI */}
      {cash.comments && Object.keys(cash.comments).length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-gray-700 mb-1">Note Cassa</h3>
          <ul className="text-xs space-y-1">
            {Object.entries(cash.comments).map(([k, v]) => (
              <li key={k} className="bg-amber-50 border border-amber-300 rounded p-2">
                <span className="font-bold uppercase text-amber-900">{k}:</span>
                <span className="ml-2 text-amber-900">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default StoricoChiusurePage;
