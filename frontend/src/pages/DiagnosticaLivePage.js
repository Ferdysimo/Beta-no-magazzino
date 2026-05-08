import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatItalianDateTime } from '../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const REFRESH_MS = 5000;

const formatTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' });
  } catch {
    return iso;
  }
};

const secondsAgo = (iso) => {
  if (!iso) return null;
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  return Math.max(0, Math.floor(diff));
};

const StatusDot = ({ ok }) => (
  <span
    className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    aria-label={ok ? 'online' : 'offline'}
  />
);

const DiagnosticaLivePage = () => {
  const { token, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterPath, setFilterPath] = useState('');

  const fetchData = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/admin/diagnostics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Errore caricamento diagnostica');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return undefined;
    const iv = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, token]);

  const filteredCalls = useMemo(() => {
    if (!data?.recent_calls) return [];
    const f = filterPath.trim().toLowerCase();
    if (!f) return data.recent_calls;
    return data.recent_calls.filter(c => c.path.toLowerCase().includes(f));
  }, [data, filterPath]);

  const stats = useMemo(() => {
    if (!data?.recent_calls?.length) return { avg: 0, max: 0, errors: 0, total: 0 };
    const calls = data.recent_calls;
    const total = calls.length;
    const ms = calls.map(c => c.ms || 0);
    const avg = Math.round(ms.reduce((a, b) => a + b, 0) / total);
    const max = Math.max(...ms);
    const errors = calls.filter(c => c.status >= 400).length;
    return { avg, max, errors, total };
  }, [data]);

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
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase">
            Diagnostica Live
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="diag-auto-refresh">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-gray-700">Auto-refresh 5s</span>
            </label>
            <button
              onClick={fetchData}
              data-testid="diag-refresh-now"
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1.5 rounded text-sm font-medium"
            >
              Ricarica ora
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : data ? (
          <>
            {/* Stats summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs text-gray-500">Chiamate (buffer)</div>
                <div className="text-2xl font-bold text-gray-900" data-testid="stat-total">{stats.total}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs text-gray-500">Latenza media</div>
                <div className="text-2xl font-bold text-gray-900" data-testid="stat-avg">{stats.avg} ms</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs text-gray-500">Latenza max</div>
                <div className={`text-2xl font-bold ${stats.max > 1000 ? 'text-red-600' : 'text-gray-900'}`} data-testid="stat-max">
                  {stats.max} ms
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs text-gray-500">Errori (≥400)</div>
                <div className={`text-2xl font-bold ${stats.errors > 0 ? 'text-red-600' : 'text-gray-900'}`} data-testid="stat-errors">
                  {stats.errors}
                </div>
              </div>
            </div>

            {/* WebSockets per locale */}
            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-800 mb-3">WebSocket per locale</h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Stato</th>
                      <th className="text-left px-3 py-2 font-semibold">Locale</th>
                      <th className="text-center px-3 py-2 font-semibold">Conn.</th>
                      <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Connesso da</th>
                      <th className="text-left px-3 py-2 font-semibold">Ultimo msg</th>
                      <th className="text-center px-3 py-2 font-semibold">Disc. 1h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.websockets.map(ws => {
                      const online = ws.active_connections > 0;
                      const stale = !online || (ws.last_seen && secondsAgo(ws.last_seen) > 60);
                      return (
                        <tr key={ws.restaurant_id} data-testid={`ws-${ws.location}`} className="border-t border-gray-100">
                          <td className="px-3 py-2"><StatusDot ok={online && !stale} /></td>
                          <td className="px-3 py-2 font-semibold text-gray-900">{ws.location}</td>
                          <td className="px-3 py-2 text-center">{ws.active_connections}</td>
                          <td className="px-3 py-2 hidden sm:table-cell text-gray-600">
                            {ws.connected_since ? formatTime(ws.connected_since) : '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {ws.last_seen ? `${secondsAgo(ws.last_seen)}s fa` : '—'}
                          </td>
                          <td className={`px-3 py-2 text-center font-medium ${ws.disconnects_last_hour > 5 ? 'text-red-600' : 'text-gray-700'}`}>
                            {ws.disconnects_last_hour}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Pallino verde = connessione attiva e recente. Rosso = offline o nessun messaggio da &gt;60s. Disc. 1h alto = rete instabile in quel locale.
              </p>
            </section>

            {/* Errori recenti */}
            {data.recent_errors?.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-bold text-gray-800 mb-3">Errori recenti ({data.recent_errors.length})</h2>
                <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-red-100 text-red-900">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Orario</th>
                        <th className="text-left px-3 py-2 font-semibold">Locale</th>
                        <th className="text-left px-3 py-2 font-semibold">Metodo</th>
                        <th className="text-left px-3 py-2 font-semibold">Path</th>
                        <th className="text-center px-3 py-2 font-semibold">Status</th>
                        <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Errore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_errors.map((e, i) => (
                        <tr key={i} className="border-t border-red-200">
                          <td className="px-3 py-2 text-red-800">{formatTime(e.ts)}</td>
                          <td className="px-3 py-2 text-red-800 font-semibold whitespace-nowrap">{e.location || '—'}</td>
                          <td className="px-3 py-2 font-mono text-red-800">{e.method}</td>
                          <td className="px-3 py-2 font-mono text-red-800 break-all">{e.path}</td>
                          <td className="px-3 py-2 text-center font-bold text-red-800">{e.status}</td>
                          <td className="px-3 py-2 text-red-700 hidden sm:table-cell truncate max-w-xs">{e.error || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Chiamate API recenti */}
            <section>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                <h2 className="text-lg font-bold text-gray-800">Ultime chiamate API ({filteredCalls.length}/{data.buffer_size})</h2>
                <input
                  type="text"
                  value={filterPath}
                  onChange={e => setFilterPath(e.target.value)}
                  placeholder="Filtra per path (es. /orders)"
                  data-testid="diag-filter-path"
                  className="px-3 py-1.5 border border-gray-300 rounded text-sm w-full sm:w-64"
                />
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Orario</th>
                      <th className="text-left px-3 py-2 font-semibold">Locale</th>
                      <th className="text-left px-3 py-2 font-semibold">Metodo</th>
                      <th className="text-left px-3 py-2 font-semibold">Path</th>
                      <th className="text-center px-3 py-2 font-semibold">Status</th>
                      <th className="text-right px-3 py-2 font-semibold">ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCalls.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Nessuna chiamata</td></tr>
                    ) : filteredCalls.map((c, i) => {
                      const isError = c.status >= 400;
                      const isSlow = c.ms > 500;
                      return (
                        <tr key={i} className={`border-t border-gray-100 ${isError ? 'bg-red-50' : isSlow ? 'bg-yellow-50' : ''}`}>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatTime(c.ts)}</td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{c.location || '—'}</td>
                          <td className="px-3 py-2 font-mono text-gray-700">{c.method}</td>
                          <td className="px-3 py-2 font-mono text-gray-800 break-all">{c.path}</td>
                          <td className={`px-3 py-2 text-center font-bold ${isError ? 'text-red-600' : 'text-green-700'}`}>{c.status}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${isSlow ? 'text-orange-600' : 'text-gray-700'}`}>{c.ms}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Righe gialle = oltre 500 ms. Righe rosse = errori 4xx/5xx. Buffer in memoria (ultime 200 chiamate, si svuota al riavvio).
              </p>
            </section>

            <div className="mt-6 text-xs text-gray-400 text-right">
              Server time: {data.server_time ? formatTime(data.server_time) : '—'}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
};

export default DiagnosticaLivePage;
