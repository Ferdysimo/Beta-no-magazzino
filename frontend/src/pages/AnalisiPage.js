import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImage = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

// Build YYYY-MM-DD from a local Date
const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const AnalisiPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();

  // Default: last 30 days
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(toISODate(monthAgo));
  const [dateTo, setDateTo] = useState(toISODate(today));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Role guard
  useEffect(() => {
    if (restaurant && restaurant.role !== 'magazzino' && restaurant.role !== 'admin') {
      navigate('/home', { replace: true });
    }
  }, [restaurant, navigate]);

  const load = async (from, to) => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API}/analisi/magazzino`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { date_from: from, date_to: to },
      });
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Errore caricamento');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = () => {
    if (new Date(dateTo) < new Date(dateFrom)) {
      setError('La data finale deve essere uguale o successiva a quella iniziale');
      return;
    }
    load(dateFrom, dateTo);
  };

  const locations = data?.locations || [];
  const products = data?.products || [];

  // Column totals
  const totals = useMemo(() => {
    const t = { incoming: 0, outgoing: {} };
    locations.forEach(l => { t.outgoing[l] = 0; });
    products.forEach(p => {
      t.incoming += p.incoming || 0;
      locations.forEach(l => { t.outgoing[l] += (p.outgoing?.[l] || 0); });
    });
    return t;
  }, [products, locations]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Analisi magazzino
          </h1>
          <button
            onClick={() => navigate('/magazzino')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna al magazzino
          </button>
        </div>

        {/* Date range */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-5 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 w-10">Dal</label>
            <input
              data-testid="analisi-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 w-10">Al</label>
            <input
              data-testid="analisi-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <button
            data-testid="analisi-apply"
            onClick={handleApply}
            disabled={loading}
            className="px-5 py-2 bg-[#F5A518] hover:bg-[#E59500] disabled:opacity-50 text-gray-900 font-semibold rounded-lg shadow-sm"
          >
            {loading ? 'Caricamento...' : 'Cambia date'}
          </button>
          {error && (
            <div className="text-sm text-red-600 sm:ml-4">{error}</div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-3 py-3 font-bold text-gray-700 uppercase text-xs tracking-wide">Prodotto</th>
                <th className="px-3 py-3 font-bold text-gray-700 uppercase text-xs tracking-wide">Fornitore</th>
                <th className="px-3 py-3 font-bold text-gray-700 uppercase text-xs tracking-wide text-center">
                  Quantità entrate nel magazzino
                </th>
                {locations.map(loc => (
                  <th key={loc} className="px-3 py-3 font-bold text-gray-700 uppercase text-xs tracking-wide text-center">
                    Trasporti a {loc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3 + locations.length} className="p-8 text-center text-gray-400">Caricamento dati...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={3 + locations.length} className="p-8 text-center text-gray-400 text-sm">
                  Nessun movimento di magazzino nel periodo selezionato.
                </td></tr>
              ) : (
                <>
                  {products.map(p => (
                    <tr key={p.product_id} data-testid={`analisi-row-${p.product_id}`} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-16 h-16 rounded bg-gray-50 overflow-hidden border border-gray-100 flex-shrink-0">
                            {p.image_url ? (
                              <img src={resolveImage(p.image_url)} alt={p.name} className="w-full h-full object-contain" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-300 text-[10px]">No foto</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate">{p.name}</div>
                            {p.unit && <div className="text-xs text-gray-500 italic">({p.unit})</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{p.supplier || '—'}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block min-w-[52px] px-2 py-1 rounded font-bold ${p.incoming > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'text-gray-400'}`}>
                          {p.incoming}
                        </span>
                      </td>
                      {locations.map(loc => {
                        const v = p.outgoing?.[loc] || 0;
                        return (
                          <td key={loc} className="px-3 py-3 text-center">
                            <span className={`inline-block min-w-[52px] px-2 py-1 rounded font-bold ${v > 0 ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'text-gray-400'}`}>
                              {v}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-gray-900">
                    <td className="px-3 py-3" colSpan={2}>Totali periodo</td>
                    <td className="px-3 py-3 text-center">{totals.incoming}</td>
                    {locations.map(loc => (
                      <td key={loc} className="px-3 py-3 text-center">{totals.outgoing[loc] || 0}</td>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-400">
          • Quantità entrate = somma dai carichi effettuati nel periodo<br />
          • Trasporti a [locale] = somma delle richieste <strong>evase</strong> nel periodo (la merce è fisicamente uscita dal magazzino)
        </p>
      </main>
    </div>
  );
};

export default AnalisiPage;
