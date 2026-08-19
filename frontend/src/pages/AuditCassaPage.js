import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, RefreshCw, ChevronRight } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CATEGORY_LABEL = { cash: 'Cassa', beverage: 'Bevande' };

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
  const parts = f.split('.');
  if (parts.length === 2) return `${parts[0]} · ${parts[1]}`;
  if (parts.length === 3 && parts[1] === 'comment') return `${parts[0]} · commento (${parts[2]})`;
  return f;
};

const fmtDate = (s) => {
  if (!s) return '';
  try { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; } catch (e) { return s; }
};
const fmtRomeISODate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const fmtTime = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return iso; }
};
export const auditDisplayValue = (value, field) => {
  if (value === '' || value === null || value === undefined) return value;
  const raw = String(value);
  if (field !== 'vers') return raw;
  return raw
    // VERS conserva span di colore; l'audit puo troncarli a meta a 240 caratteri.
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/[^0-9+\-*/.(),=\s€]/g, '')
    .trim();
};
const truncate = (s, n = 60) => {
  if (s === '' || s === null || s === undefined) return <span className="italic text-gray-400">(vuoto)</span>;
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
};

const isHiddenMovement = (movement) => {
  const field = movement?.field || '';
  return field === 'paste_text' || field.startsWith('manual_prices.');
};

const AuditCassaPage = () => {
  const navigate = useNavigate();
  const {
    token,
    canImpersonate,
    effectiveRestaurant,
    selectRestaurant,
  } = useAuth();

  const today = useMemo(() => fmtRomeISODate(), []);
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return fmtRomeISODate(d);
  }, []);

  // Filtri principali (per la lista chiusure)
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantFilter, setRestaurantFilter] = useState(
    () => effectiveRestaurant?.id || '',
  );

  // Stato lista + selezione
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selected, setSelected] = useState(null); // { restaurant_id, date_rome, restaurant_label }

  // Filtri DENTRO la chiusura selezionata
  const [innerCategory, setInnerCategory] = useState('');
  const [innerFieldQ, setInnerFieldQ] = useState('');
  const [innerUserQ, setInnerUserQ] = useState('');

  // Movimenti del gruppo selezionato
  const [movements, setMovements] = useState([]);
  const [loadingMov, setLoadingMov] = useState(false);
  const visibleMovements = useMemo(
    () => movements.filter(movement => !isHiddenMovement(movement)),
    [movements],
  );

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    if (!canImpersonate || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, { headers });
        setRestaurants((res.data || []).filter(r => r.role !== 'admin'));
      } catch (e) { console.error(e); }
    })();
  }, [canImpersonate, token, headers]);

  const loadGroups = useCallback(async () => {
    if (!canImpersonate || !token) return;
    setLoadingGroups(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (restaurantFilter) params.set('restaurant_id', restaurantFilter);
      const res = await axios.get(`${API}/admin/audit-log/groups?${params.toString()}`, { headers });
      setGroups(res.data?.items || []);
    } catch (e) { console.error(e); } finally { setLoadingGroups(false); }
  }, [canImpersonate, token, headers, dateFrom, dateTo, restaurantFilter]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadMovements = useCallback(async () => {
    if (!selected) { setMovements([]); return; }
    setLoadingMov(true);
    try {
      const params = new URLSearchParams();
      params.set('date_from', selected.date_rome);
      params.set('date_to', selected.date_rome);
      params.set('restaurant_id', selected.restaurant_id);
      if (innerCategory) params.set('category', innerCategory);
      if (innerFieldQ.trim()) params.set('field_q', innerFieldQ.trim());
      if (innerUserQ.trim()) params.set('user_q', innerUserQ.trim());
      params.set('limit', '2000');
      const res = await axios.get(`${API}/admin/audit-log?${params.toString()}`, { headers });
      setMovements(res.data?.items || []);
    } catch (e) { console.error(e); } finally { setLoadingMov(false); }
  }, [selected, innerCategory, innerFieldQ, innerUserQ, headers]);

  useEffect(() => { loadMovements(); }, [loadMovements]);

  const onRestaurantFilterChange = (restaurantId) => {
    setRestaurantFilter(restaurantId);
    const target = restaurants.find(r => r.id === restaurantId);
    if (target) selectRestaurant(target);
  };

  if (!canImpersonate) {
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
          <button onClick={() => navigate('/home')} data-testid="back-home"
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm">
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">Registro modifiche · Report Cassa & Bevande</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-4">
          Check singoli movimenti
        </h1>

        {/* Filtri principali (lista chiusure) */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Da</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              data-testid="filter-date-from" className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">A</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              data-testid="filter-date-to" className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-gray-600 uppercase">Locale</label>
            <select value={restaurantFilter} onChange={e => onRestaurantFilterChange(e.target.value)}
              data-testid="filter-restaurant" className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
              <option value="">Tutti</option>
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.location || r.username}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end col-span-2 md:col-span-2">
            <button onClick={loadGroups} disabled={loadingGroups} data-testid="btn-refresh-groups"
              className="bg-[#F5C518] hover:bg-yellow-400 text-gray-900 font-bold px-3 py-1.5 rounded text-sm flex items-center justify-center gap-1 disabled:opacity-50">
              <RefreshCw size={14} className={loadingGroups ? 'animate-spin' : ''} /> Aggiorna lista
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* COLONNA SX: lista chiusure */}
          <div className="lg:col-span-4">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-200 text-xs text-gray-700 font-bold uppercase flex items-center justify-between">
                <span>Chiusure</span>
                <span className="font-normal text-gray-500">{groups.length}</span>
              </div>
              <div className="max-h-[75vh] overflow-y-auto">
                {loadingGroups && (
                  <div className="p-6 text-center text-gray-400 text-sm">Caricamento…</div>
                )}
                {!loadingGroups && groups.length === 0 && (
                  <div className="p-6 text-center text-gray-400 text-sm">Nessuna chiusura nel periodo selezionato.</div>
                )}
                {!loadingGroups && groups.map(g => {
                  const isSel = selected && selected.restaurant_id === g.restaurant_id && selected.date_rome === g.date_rome;
                  return (
                    <button
                      key={`${g.restaurant_id}-${g.date_rome}`}
                      data-testid={`closure-${g.restaurant_id}-${g.date_rome}`}
                      onClick={() => setSelected({ restaurant_id: g.restaurant_id, date_rome: g.date_rome, restaurant_label: g.restaurant_label })}
                      className={`w-full text-left p-3 border-b border-gray-100 transition-colors flex items-center justify-between ${
                        isSel ? 'bg-[#F5C518]/20 border-l-4 border-l-[#F5C518]' : 'hover:bg-yellow-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-gray-900">{g.restaurant_label}</span>
                          <span className="text-[11px] text-gray-500 font-mono">{fmtDate(g.date_rome)}</span>
                        </div>
                        <div className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap gap-x-3">
                          <span><b>{g.count}</b> movimenti</span>
                          {g.cash_count > 0 && <span>· cassa <b>{g.cash_count}</b></span>}
                          {g.bev_count > 0 && <span>· bev <b>{g.bev_count}</b></span>}
                          {g.admin_count > 0 && (
                            <span className="text-violet-700">· admin <b>{g.admin_count}</b></span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                          ultimo: {fmtTime(g.last_at)} · utenti: {(g.users || []).join(', ')}
                        </div>
                      </div>
                      <ChevronRight size={16} className={`flex-shrink-0 ml-2 ${isSel ? 'text-[#F5C518]' : 'text-gray-300'}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* COLONNA DX: dettaglio movimenti */}
          <div className="lg:col-span-8">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {!selected ? (
                <div className="p-12 text-center text-gray-400 text-sm">
                  Seleziona una chiusura a sinistra per vedere tutti i movimenti effettuati.
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="text-xs uppercase font-bold text-gray-700">{selected.restaurant_label} · {fmtDate(selected.date_rome)}</div>
                      <div className="text-[11px] text-gray-500">
                        {loadingMov ? 'Caricamento…' : `${visibleMovements.length} ${visibleMovements.length === 1 ? 'modifica' : 'modifiche'}`}
                        <span className="text-gray-400 ml-2">· ogni riga = una modifica distinta (correzioni successive creano righe nuove)</span>
                      </div>
                    </div>
                    <button onClick={loadMovements} disabled={loadingMov} data-testid="btn-refresh-mov"
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1 rounded flex items-center gap-1 disabled:opacity-50">
                      <RefreshCw size={12} className={loadingMov ? 'animate-spin' : ''} /> Aggiorna
                    </button>
                  </div>

                  {/* Filtri inner */}
                  <div className="px-3 py-2 border-b border-gray-200 grid grid-cols-3 gap-2">
                    <select value={innerCategory} onChange={e => setInnerCategory(e.target.value)}
                      data-testid="inner-filter-category"
                      className="border border-gray-300 rounded px-2 py-1 text-xs bg-white">
                      <option value="">Tutte le categorie</option>
                      <option value="cash">Solo Cassa</option>
                      <option value="beverage">Solo Bevande</option>
                    </select>
                    <input type="text" value={innerFieldQ} onChange={e => setInnerFieldQ(e.target.value)}
                      data-testid="inner-filter-field"
                      placeholder="Cerca campo (es. vers, CZ, paste)"
                      className="border border-gray-300 rounded px-2 py-1 text-xs" />
                    <input type="text" value={innerUserQ} onChange={e => setInnerUserQ(e.target.value)}
                      data-testid="inner-filter-user"
                      placeholder="Cerca utente"
                      className="border border-gray-300 rounded px-2 py-1 text-xs" />
                  </div>

                  <div className="overflow-x-auto" style={{ maxHeight: '65vh' }}>
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="text-gray-700">
                          <th className="text-left p-2">Ora</th>
                          <th className="text-left p-2">Sezione</th>
                          <th className="text-left p-2">Campo modificato</th>
                          <th className="text-left p-2">Valore prima</th>
                          <th className="text-left p-2">Valore dopo</th>
                          <th className="text-left p-2">Utente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!loadingMov && visibleMovements.length === 0 && (
                          <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nessun movimento corrispondente ai filtri.</td></tr>
                        )}
                        {visibleMovements.map(it => (
                          <tr key={it.id} data-testid={`audit-row-${it.id}`} className="border-t border-gray-100 hover:bg-yellow-50">
                            <td className="p-2 whitespace-nowrap font-mono text-[11px]">{fmtTime(it.last_at)}</td>
                            <td className="p-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                it.category === 'cash' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
                              }`}>{CATEGORY_LABEL[it.category] || it.category}</span>
                            </td>
                            <td className="p-2 font-medium">{prettyField(it.field)}</td>
                            <td className="p-2 text-rose-700 font-mono" title={auditDisplayValue(it.old_value, it.field)}>{truncate(auditDisplayValue(it.old_value, it.field))}</td>
                            <td className="p-2 text-emerald-700 font-mono font-bold" title={auditDisplayValue(it.new_value, it.field)}>{truncate(auditDisplayValue(it.new_value, it.field))}</td>
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
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AuditCassaPage;
