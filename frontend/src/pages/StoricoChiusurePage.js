import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft } from 'lucide-react';
import ClosureDetail from '../components/ClosureDetail';

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
  const [searchParams] = useSearchParams();
  const urlDate = searchParams.get('date');
  const urlRid = searchParams.get('rid');
  const { token, isAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(urlDate || null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Selettore locale
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(
    () => urlRid || localStorage.getItem('closures_rest_id') || ''
  );

  // Sync URL params → state (per supportare navigazione da Chiusure Excel)
  useEffect(() => {
    if (urlDate) setSelectedDate(urlDate);
    if (urlRid) setSelectedRestId(urlRid);
  }, [urlDate, urlRid]);

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
          Gestione report
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
                        <span title="Paste totali (incluse non riconosciute)">🍝 {it.paste_count ?? it.orders_total ?? 0}</span>
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

export default StoricoChiusurePage;
