import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowDownRight, ArrowUpRight, RefreshCw } from 'lucide-react';
import { compareProductsByCanonicalOrder } from '../utils/productOrder';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CAUSE_LABELS = {
  carico: { label: 'Carico merce', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  carico_modifica: { label: 'Modifica carico', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  carico_cancellato: { label: 'Carico cancellato', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  evasione: { label: 'Evasione richiesta', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  forzatura_admin: { label: 'Forzatura Admin', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  stock_iniziale: { label: 'Stock iniziale', color: 'bg-gray-100 text-gray-700 border-gray-200' },
};

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatTs = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const CronologiaMovimentiPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(today.getDate() - 30);

  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState(searchParams.get('product') || '');
  const [dateFrom, setDateFrom] = useState(toISODate(monthAgo));
  const [dateTo, setDateTo] = useState(toISODate(today));
  const [cause, setCause] = useState('');
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentQuantity, setCurrentQuantity] = useState(null);
  const [productName, setProductName] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Role guard
  useEffect(() => {
    if (restaurant && restaurant.role !== 'magazzino' && restaurant.role !== 'admin') {
      navigate('/home', { replace: true });
    }
  }, [restaurant, navigate]);

  // Load products list (for dropdown)
  useEffect(() => {
    axios.get(`${API}/products`, { headers })
      .then(r => setProducts([...(r.data || [])].sort(compareProductsByCanonicalOrder)))
      .catch(() => {});
  }, [headers]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { date_from: dateFrom, date_to: dateTo, limit: 1000 };
      if (cause) params.cause = cause;
      let url;
      if (productId) {
        url = `${API}/products/${productId}/movements`;
      } else {
        url = `${API}/stock-movements`;
      }
      const res = await axios.get(url, { headers, params });
      const data = res.data;
      setMovements(data.movements || []);
      if (productId) {
        setCurrentQuantity(data.current_quantity ?? null);
        setProductName(data.product_name || '');
      } else {
        setCurrentQuantity(null);
        setProductName('');
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Errore caricamento');
      setMovements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totalIn = movements.filter(m => m.delta > 0).reduce((s, m) => s + m.delta, 0);
  const totalOut = movements.filter(m => m.delta < 0).reduce((s, m) => s + Math.abs(m.delta), 0);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-3 sm:p-6">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <h1 className="font-heading text-xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Cronologia movimenti
          </h1>
          <button
            data-testid="back-magazzino"
            onClick={() => navigate('/magazzino')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna al magazzino
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Prodotto</label>
            <select
              data-testid="filter-product"
              value={productId}
              onChange={e => setProductId(e.target.value)}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">Tutti i prodotti</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Dal</label>
            <input
              data-testid="filter-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Al</label>
            <input
              data-testid="filter-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Causale</label>
            <select
              data-testid="filter-cause"
              value={cause}
              onChange={e => setCause(e.target.value)}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">Tutte</option>
              {Object.entries(CAUSE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4 flex items-center justify-between flex-wrap gap-2">
            <button
              data-testid="apply-filters"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#F5C518] hover:bg-[#E5B418] disabled:opacity-50 text-gray-900 font-semibold rounded-lg text-sm shadow-sm"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Caricamento...' : 'Applica filtri'}
            </button>
            {error && <div className="text-sm text-red-600">{error}</div>}
            {productId && currentQuantity !== null && (
              <div className="text-sm text-gray-700">
                <span className="font-semibold">{productName}</span>
                <span className="ml-2">·  Stock attuale:</span>
                <span className="ml-1 inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 font-bold">
                  {currentQuantity}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide">Movimenti</div>
            <div className="text-lg sm:text-2xl font-bold text-gray-900">{movements.length}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide">Entrate (+)</div>
            <div className="text-lg sm:text-2xl font-bold text-emerald-600">+{totalIn}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-2 sm:p-3">
            <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide">Uscite (−)</div>
            <div className="text-lg sm:text-2xl font-bold text-rose-600">−{totalOut}</div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs whitespace-nowrap">Data</th>
                {!productId && (
                  <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs">Prodotto</th>
                )}
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs text-center whitespace-nowrap">Δ</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs text-center whitespace-nowrap">Saldo</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs">Causale</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs hidden md:table-cell">Utente</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 font-bold text-gray-700 uppercase text-[10px] sm:text-xs hidden md:table-cell">Note</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Caricamento...</td></tr>
              ) : movements.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400 text-sm">
                  Nessun movimento nel periodo selezionato.
                </td></tr>
              ) : (
                movements.map(m => {
                  const meta = CAUSE_LABELS[m.cause] || { label: m.cause, color: 'bg-gray-100 text-gray-700 border-gray-200' };
                  const positive = m.delta > 0;
                  return (
                    <tr
                      key={m.id}
                      data-testid={`mov-row-${m.id}`}
                      className="border-b border-gray-100 hover:bg-gray-50/50"
                    >
                      <td className="px-2 sm:px-3 py-2 text-gray-700 text-[11px] sm:text-sm whitespace-nowrap">
                        {formatTs(m.timestamp)}
                      </td>
                      {!productId && (
                        <td className="px-2 sm:px-3 py-2 text-gray-900 font-medium text-[11px] sm:text-sm">
                          <button
                            onClick={() => { setProductId(m.product_id); setTimeout(load, 0); }}
                            className="text-left hover:underline"
                            title="Filtra per questo prodotto"
                          >
                            {m.product_name || m.product_id?.substring(0, 8)}
                          </button>
                        </td>
                      )}
                      <td className={`px-2 sm:px-3 py-2 text-center font-bold text-[11px] sm:text-sm whitespace-nowrap ${positive ? 'text-emerald-700' : 'text-rose-700'}`}>
                        <span className="inline-flex items-center gap-0.5">
                          {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                          {positive ? '+' : ''}{m.delta}
                        </span>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-center text-gray-800 font-semibold text-[11px] sm:text-sm whitespace-nowrap">
                        {m.balance_after}
                      </td>
                      <td className="px-2 sm:px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold border ${meta.color} whitespace-nowrap`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-gray-600 text-[11px] sm:text-sm hidden md:table-cell">
                        {m.user_name || '—'}
                        {m.user_role && <span className="text-gray-400 text-xs ml-1">({m.user_role})</span>}
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-gray-600 text-[11px] sm:text-sm hidden md:table-cell max-w-xs truncate" title={m.note}>
                        {m.note || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-400">
          • Δ = variazione applicata · Saldo = stock dopo il movimento
          <br />• Tocca il nome prodotto per filtrare la sua sola cronologia
        </p>
      </main>
    </div>
  );
};

export default CronologiaMovimentiPage;
