import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, RefreshCw } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CATEGORY_LABEL = { cash: 'Cassa', beverage: 'Bevande' };

// Etichette user-friendly per i field code (cash + dot-children)
const FIELD_LABEL = {
  mattina: 'Cash mattina', altro: 'Altro', glo: 'GLO', just: 'JUST', delv: 'DEL',
  bp: 'BP', sat: 'SAT', ft: 'FT', pos: 'POS', vers: 'VERS', arr: 'ARR',
  sp5: 'Spicci 5€ aperti', sp2: 'Spicci 2€ aperti', sp1: 'Spicci 1€ aperti', sp05: 'Spicci 0,5€ aperti',
  cd5: 'Cassetto 5€', cd2: 'Cassetto 2€', cd1: 'Cassetto 1€', cd05: 'Cassetto 0,5€',
  vers_color: 'VERS · colore', paste_text: 'Paste incollate (testo)',
};
const prettyField = (f) => {
  if (FIELD_LABEL[f]) return FIELD_LABEL[f];
  if (f.startsWith('cash_banconote.')) return `Banconote · ${f.slice('cash_banconote.'.length)}`;
  if (f.startsWith('manual_prices.')) return `Prezzo manuale paste · riga ${parseInt(f.slice('manual_prices.'.length)) + 1}`;
  if (f.startsWith('comments.')) return `Commento · ${f.slice('comments.'.length).toUpperCase()}`;
  // Beverage: SIGLA.col (es. CZ.sera) o SIGLA.comment.inUsc
  const parts = f.split('.');
  if (parts.length === 2) return `${parts[0]} · ${parts[1]}`;
  if (parts.length === 3 && parts[1] === 'comment') return `${parts[0]} · commento (${parts[2]})`;
  return f;
};

const fmtDateTime = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return iso; }
};

const truncate = (s, n = 60) => {
  if (s === '' || s === null || s === undefined) return '—';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
};

const AuditCassaPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const sevenDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);
  const [dateFrom, setDateFrom] = useState(sevenDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [category, setCategory] = useState('');
  const [fieldQ, setFieldQ] = useState('');
  const [userQ, setUserQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, { headers });
        setRestaurants((res.data || []).filter(r => r.role !== 'admin'));
      } catch (e) { console.error('list restaurants', e); }
    })();
  }, [isAdmin, token, headers]);

  const load = useCallback(async () => {
    if (!isAdmin || !token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (restaurantId) params.set('restaurant_id', restaurantId);
      if (category) params.set('category', category);
      if (fieldQ.trim()) params.set('field_q', fieldQ.trim());
      if (userQ.trim()) params.set('user_q', userQ.trim());
      params.set('limit', '1000');
      const res = await axios.get(`${API}/admin/audit-log?${params.toString()}`, { headers });
      setItems(res.data?.items || []);
    } catch (e) {
      console.error('audit-log', e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, token, headers, dateFrom, dateTo, restaurantId, category, fieldQ, userQ]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

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
      <main className="max-w-7xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">Registro modifiche · Cassa & Bevande</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Controllo Report — Audit log
        </h1>

        {/* Filtri */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Da</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm" data-testid="filter-date-from" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">A</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm" data-testid="filter-date-to" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Locale</label>
            <select value={restaurantId} onChange={e => setRestaurantId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white" data-testid="filter-restaurant">
              <option value="">Tutti</option>
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.location || r.username}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Categoria</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white" data-testid="filter-category">
              <option value="">Tutte</option>
              <option value="cash">Cassa</option>
              <option value="beverage">Bevande</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Campo</label>
            <input type="text" value={fieldQ} onChange={e => setFieldQ(e.target.value)}
              placeholder="es. vers, CZ, paste_text"
              className="border border-gray-300 rounded px-2 py-1 text-sm" data-testid="filter-field" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Utente</label>
            <input type="text" value={userQ} onChange={e => setUserQ(e.target.value)}
              placeholder="username"
              className="border border-gray-300 rounded px-2 py-1 text-sm" data-testid="filter-user" />
          </div>
          <div className="flex flex-col justify-end gap-1">
            <button onClick={load} disabled={loading}
              data-testid="btn-refresh"
              className="bg-[#F5C518] hover:bg-yellow-400 text-gray-900 font-bold px-3 py-1.5 rounded text-sm flex items-center gap-1 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Aggiorna
            </button>
            <label className="text-[10px] text-gray-600 flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
                data-testid="toggle-auto-refresh" />
              auto 10s
            </label>
          </div>
        </div>

        {/* Tabella */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between text-xs text-gray-600">
            <span>{loading ? 'Caricamento…' : `${items.length} ${items.length === 1 ? 'movimento' : 'movimenti'}`}</span>
            <span className="text-[10px] text-gray-400">Coalescing 30s · valori troncati a 60 char</span>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-gray-700">
                  <th className="text-left p-2">Quando</th>
                  <th className="text-left p-2">Locale</th>
                  <th className="text-left p-2">Data report</th>
                  <th className="text-left p-2">Cat.</th>
                  <th className="text-left p-2">Campo</th>
                  <th className="text-left p-2">Da</th>
                  <th className="text-left p-2">A</th>
                  <th className="text-center p-2">#</th>
                  <th className="text-left p-2">Utente</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && !loading && (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-400">Nessun movimento per i filtri selezionati.</td></tr>
                )}
                {items.map(it => (
                  <tr key={it.id} data-testid={`audit-row-${it.id}`} className="border-t border-gray-100 hover:bg-yellow-50">
                    <td className="p-2 whitespace-nowrap font-mono text-[11px]">{fmtDateTime(it.last_at)}</td>
                    <td className="p-2 font-bold">{it.restaurant_label}</td>
                    <td className="p-2 font-mono text-[11px]">{it.date_rome}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        it.category === 'cash' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
                      }`}>{CATEGORY_LABEL[it.category] || it.category}</span>
                    </td>
                    <td className="p-2 font-medium">{prettyField(it.field)}</td>
                    <td className="p-2 text-rose-700 font-mono" title={it.old_value}>{truncate(it.old_value)}</td>
                    <td className="p-2 text-emerald-700 font-mono font-bold" title={it.new_value}>{truncate(it.new_value)}</td>
                    <td className="p-2 text-center">
                      {it.changes_count > 1 ? (
                        <span className="bg-gray-900 text-[#F5C518] px-1.5 py-0.5 rounded font-bold text-[10px]">×{it.changes_count}</span>
                      ) : (
                        <span className="text-gray-400">1</span>
                      )}
                    </td>
                    <td className="p-2">
                      <span className="font-medium">{it.by_user}</span>
                      {it.is_impersonating && (
                        <span className="ml-1 text-[9px] bg-violet-100 text-violet-800 px-1 rounded">Admin→</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuditCassaPage;
