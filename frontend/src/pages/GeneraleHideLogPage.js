import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { RefreshCw } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmtRome = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
};

const GeneraleHideLogPage = () => {
  const { token, isAdmin } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [filterRid, setFilterRid] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !isAdmin) return;
    axios.get(`${API}/admin/restaurants`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => setRestaurants(res.data || [])).catch(() => {});
  }, [token, isAdmin]);

  const fetchLog = useMemo(() => async () => {
    if (!token || !isAdmin) return;
    setLoading(true);
    try {
      const params = filterRid !== 'all' ? `?restaurant_id=${filterRid}&limit=500` : '?limit=500';
      const res = await axios.get(`${API}/admin/generale-hide-log${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(res.data?.items || []);
    } catch (e) {
      console.error('hide-log fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [token, isAdmin, filterRid]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded">
            Accesso riservato all'Admin.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-800 uppercase">
              Cestino Generale — Audit
            </h1>
            <p className="text-xs sm:text-sm text-gray-600 mt-1">
              Registro silenzioso di ogni ordine nascosto dal Tablet Generale (cestino rosso).
            </p>
          </div>
          <button
            onClick={fetchLog}
            data-testid="hide-log-refresh"
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 px-3 py-1.5 rounded-md text-sm font-semibold"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Aggiorna
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-gray-600 uppercase">Locale:</label>
          <select
            data-testid="hide-log-filter-restaurant"
            value={filterRid}
            onChange={(e) => setFilterRid(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
          >
            <option value="all">Tutti i locali</option>
            {restaurants.map(r => (
              <option key={r.id} value={r.id}>{r.location}</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-gray-500">
            {items.length} evento{items.length === 1 ? '' : 'i'}
          </span>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {items.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              {loading ? 'Caricamento…' : 'Nessun evento registrato.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-left">
                  <tr className="text-xs uppercase text-gray-600">
                    <th className="px-3 py-2">Quando</th>
                    <th className="px-3 py-2">Locale</th>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Descrizione</th>
                    <th className="px-3 py-2">Chi ha cliccato</th>
                    <th className="px-3 py-2 text-right">Timer (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr
                      key={it.id}
                      data-testid={`hide-log-row-${it.id}`}
                      className="border-b border-gray-100 hover:bg-yellow-50"
                    >
                      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">{fmtRome(it.hidden_at)}</td>
                      <td className="px-3 py-2 text-xs">{it.restaurant_location || '—'}</td>
                      <td className="px-3 py-2 font-bold tabular-nums">{it.order_number ?? '—'}</td>
                      <td className="px-3 py-2 max-w-md truncate" title={it.order_description}>{it.order_description || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-semibold">{it.by_username || '—'}</span>
                        {it.by_role && (
                          <span className="ml-1.5 text-[10px] text-gray-500 uppercase">({it.by_role})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {typeof it.frozen_timer === 'number' ? it.frozen_timer : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default GeneraleHideLogPage;
