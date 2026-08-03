import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { FileText, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import NavLinkSpa from '../components/NavLinkSpa';
import { compareProductsByCanonicalOrder } from '../utils/productOrder';
import { formatItalianDateTime } from '../utils/formatDate';
import ZoomableImage from '../components/ZoomableImage';

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

const REQUEST_STATUS_LABELS = {
  pending: 'Da evadere',
  evasa: 'Evasa',
  confermata: 'Confermata',
  errore: 'Errore',
};
const EMPTY_LOCATIONS = [];

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
  const [extraModalOpen, setExtraModalOpen] = useState(false);
  const [extraDateFrom, setExtraDateFrom] = useState(toISODate(monthAgo));
  const [extraDateTo, setExtraDateTo] = useState(toISODate(today));
  const [extraRequests, setExtraRequests] = useState([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraError, setExtraError] = useState('');

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

  const loadExtraRequests = async (from, to) => {
    setExtraLoading(true);
    setExtraError('');
    try {
      const res = await axios.get(`${API}/richieste/extra-notes`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { date_from: from, date_to: to },
      });
      setExtraRequests(res.data || []);
    } catch (e) {
      setExtraError(e.response?.data?.detail || 'Errore caricamento campi extra');
      setExtraRequests([]);
    } finally {
      setExtraLoading(false);
    }
  };

  const openExtraModal = () => {
    setExtraDateFrom(dateFrom);
    setExtraDateTo(dateTo);
    setExtraModalOpen(true);
    loadExtraRequests(dateFrom, dateTo);
  };

  const applyExtraDates = () => {
    if (new Date(extraDateTo) < new Date(extraDateFrom)) {
      setExtraError('La data finale deve essere uguale o successiva a quella iniziale');
      return;
    }
    loadExtraRequests(extraDateFrom, extraDateTo);
  };

  const locations = data?.locations || EMPTY_LOCATIONS;
  const products = useMemo(
    () => [...(data?.products || [])].sort(compareProductsByCanonicalOrder),
    [data]
  );

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Analisi magazzino
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="open-extra-notes"
              onClick={openExtraModal}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-sm font-semibold text-gray-800 rounded hover:bg-gray-50"
            >
              <FileText size={16} aria-hidden="true" />
              Campi extra
            </button>
            <button
              onClick={() => navigate('/magazzino')}
              className="text-sm text-gray-600 hover:text-gray-900 underline"
            >
              ← Torna al magazzino
            </button>
          </div>
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
                              <ZoomableImage src={resolveImage(p.image_url)} alt={p.name} className="w-full h-full object-contain" />
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

      {extraModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-6"
          onClick={() => setExtraModalOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="extra-notes-title"
            data-testid="extra-notes-dialog"
            className="bg-white w-full max-w-5xl max-h-[90vh] rounded border border-gray-300 shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-gray-200">
              <div>
                <h2 id="extra-notes-title" className="text-lg font-bold text-gray-900">
                  Campi extra
                </h2>
                <div className="text-xs text-gray-500">Richieste con indicazioni aggiuntive</div>
              </div>
              <button
                type="button"
                aria-label="Chiudi campi extra"
                onClick={() => setExtraModalOpen(false)}
                className="w-9 h-9 inline-flex items-center justify-center border border-gray-300 rounded text-gray-600 hover:bg-gray-100"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-end gap-3">
              <label className="text-xs font-semibold text-gray-700">
                <span className="block mb-1">Dal</span>
                <input
                  type="date"
                  data-testid="extra-date-from"
                  value={extraDateFrom}
                  onChange={e => setExtraDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                <span className="block mb-1">Al</span>
                <input
                  type="date"
                  data-testid="extra-date-to"
                  value={extraDateTo}
                  onChange={e => setExtraDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded text-sm font-normal"
                />
              </label>
              <button
                type="button"
                data-testid="extra-apply"
                onClick={applyExtraDates}
                disabled={extraLoading}
                className="px-4 py-2 bg-[#F5C518] hover:bg-[#E5B418] disabled:opacity-50 text-gray-900 text-sm font-bold rounded"
              >
                {extraLoading ? 'Caricamento...' : 'Filtra'}
              </button>
              {extraError && <div className="text-sm text-red-600">{extraError}</div>}
            </div>

            <div className="overflow-auto flex-1">
              {extraLoading ? (
                <div className="p-8 text-center text-gray-400">Caricamento...</div>
              ) : extraRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  Nessun campo extra nel periodo selezionato.
                </div>
              ) : (
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-left">
                    <tr>
                      <th className="px-4 py-3 text-xs uppercase text-gray-600">Richiesta</th>
                      <th className="px-4 py-3 text-xs uppercase text-gray-600">Locale</th>
                      <th className="px-4 py-3 text-xs uppercase text-gray-600">Data</th>
                      <th className="px-4 py-3 text-xs uppercase text-gray-600">Stato</th>
                      <th className="px-4 py-3 text-xs uppercase text-gray-600">Campo extra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraRequests.map(request => (
                      <tr
                        key={request.id}
                        data-testid={`extra-request-${request.id}`}
                        className="border-b border-gray-100 align-top"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <NavLinkSpa
                            to={`/ddt/${request.id}`}
                            className="font-bold text-gray-900 underline"
                          >
                            DDT {request.ddt_number}
                          </NavLinkSpa>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">
                          {request.restaurant_location || 'Locale non indicato'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {formatItalianDateTime(request.created_at)}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {REQUEST_STATUS_LABELS[request.status] || request.status || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-900 whitespace-pre-wrap break-words min-w-[280px]">
                          {request.extra_note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default AnalisiPage;
