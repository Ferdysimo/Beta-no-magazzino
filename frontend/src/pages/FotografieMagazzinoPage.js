import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, Camera, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import { compareProductsByCanonicalOrder } from '../utils/productOrder';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthRange = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
};

const formatDay = (value, options = {}) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: options.short ? 'short' : '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  }).format(new Date(`${value}T12:00:00+02:00`));
};

const formatDateTime = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/Rome',
  }).format(new Date(value));
};

const FotografieMagazzinoPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!month) return;
    setLoading(true);
    setError('');
    try {
      const { dateFrom, dateTo } = monthRange(month);
      const response = await axios.get(`${API}/admin/warehouse-inventory-snapshots`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { date_from: dateFrom, date_to: dateTo },
      });
      const rows = response.data?.snapshots || [];
      setSnapshots(rows);
      setSelectedDate(current => (
        rows.some(snapshot => snapshot.business_date === current)
          ? current
          : rows[0]?.business_date || ''
      ));
    } catch (requestError) {
      setSnapshots([]);
      setSelectedDate('');
      setError(requestError.response?.data?.detail || 'Errore nel caricamento delle fotografie');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const selectedSnapshot = useMemo(
    () => snapshots.find(snapshot => snapshot.business_date === selectedDate) || null,
    [selectedDate, snapshots],
  );
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it');
    return [...(selectedSnapshot?.products || [])]
      .filter(product => !query || [
        product.product_name,
        product.supplier,
        product.unit,
      ].some(value => String(value || '').toLocaleLowerCase('it').includes(query)))
      .sort((a, b) => compareProductsByCanonicalOrder(
        { name: a.product_name, supplier: a.supplier },
        { name: b.product_name, supplier: b.supplier },
      ));
  }, [search, selectedSnapshot]);

  return <div className="min-h-screen bg-[#F5F5F5]">
    <Header />
    <main className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3">
            <Camera size={28} className="text-gray-800" aria-hidden="true" />
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase">Magazzino alle 06:00</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Una fotografia immutabile dell'inventario per ogni giornata.</p>
        </div>
        <button type="button" onClick={() => navigate('/home')} className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 rounded text-sm font-semibold">
          <ArrowLeft size={16} /> Home
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[220px_44px] gap-3 items-end border-y border-gray-300 py-4 mb-5">
        <label className="text-xs font-bold text-gray-700 uppercase">Mese
          <input data-testid="snapshot-month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="mt-1 block w-full h-11 px-3 border border-gray-300 bg-white rounded text-sm font-normal" />
        </label>
        <button type="button" onClick={load} disabled={loading} title="Aggiorna fotografie" aria-label="Aggiorna fotografie" className="h-11 w-11 inline-flex items-center justify-center bg-gray-900 hover:bg-black disabled:opacity-50 text-white rounded">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="mb-4 border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm">{error}</div>}
      {loading ? <EmptyState>Caricamento...</EmptyState> : snapshots.length === 0 ? (
        <EmptyState>Nessuna fotografia disponibile per questo mese. La raccolta inizierà dalla prima giornata successiva al rilascio.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
          <aside className="border border-gray-300 bg-white lg:sticky lg:top-4">
            <div className="px-4 py-3 bg-gray-100 border-b border-gray-300 text-xs font-bold uppercase text-gray-600">Giornate ({snapshots.length})</div>
            <div className="divide-y divide-gray-200 max-h-[70vh] overflow-y-auto">
              {snapshots.map(snapshot => {
                const reconstructed = snapshot.data_quality === 'reconstructed_from_ledger';
                return <button
                  type="button"
                  key={snapshot.business_date}
                  data-testid={`snapshot-day-${snapshot.business_date}`}
                  onClick={() => setSelectedDate(snapshot.business_date)}
                  className={`w-full text-left px-4 py-3 ${selectedDate === snapshot.business_date ? 'bg-yellow-50 border-l-4 border-[#F5C518]' : 'hover:bg-gray-50 border-l-4 border-transparent'}`}
                >
                  <span className="block font-bold text-gray-900">{formatDay(snapshot.business_date, { short: true })}</span>
                  <span className={`block text-xs mt-1 ${reconstructed ? 'text-amber-800' : 'text-emerald-700'}`}>{reconstructed ? 'Ricostruita' : 'Puntuale'}</span>
                </button>;
              })}
            </div>
          </aside>

          {selectedSnapshot && <section data-testid="selected-snapshot" className="border border-gray-300 bg-white min-w-0">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-300 bg-gray-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase text-gray-500">Inventario delle ore 06:00</div>
                  <div className="text-2xl font-bold text-gray-900 mt-1">{formatDay(selectedSnapshot.business_date)}</div>
                </div>
                <QualityBadge snapshot={selectedSnapshot} />
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600">
                <div><b>Prevista:</b> {formatDateTime(selectedSnapshot.scheduled_at)}</div>
                <div><b>Registrata:</b> {formatDateTime(selectedSnapshot.captured_at)}</div>
                <div><b>Prodotti:</b> {selectedSnapshot.product_count ?? selectedSnapshot.products?.length ?? 0}</div>
              </div>
              {selectedSnapshot.data_quality === 'reconstructed_from_ledger' && (
                <div className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Il backend non era disponibile all'orario previsto. Quantità ricostruite dal saldo corrente e da {selectedSnapshot.movement_count_used || 0} movimenti successivi alle 06:00.
                </div>
              )}
            </div>

            <div className="p-4 border-b border-gray-200">
              <label className="relative block">
                <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input data-testid="snapshot-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cerca prodotto o fornitore" className="w-full h-11 pl-10 pr-3 border border-gray-300 rounded text-sm" />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-xs uppercase text-gray-500 border-b border-gray-200 bg-gray-50">
                  <tr><th className="px-4 py-3 text-left">Prodotto</th><th className="px-4 py-3 text-left">Fornitore</th><th className="px-4 py-3 text-left">Unità</th><th className="px-4 py-3 text-right">Quantità alle 06:00</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleProducts.map(product => <tr key={product.product_id} data-testid={`snapshot-product-${product.product_id}`}>
                    <td className="px-4 py-3 font-semibold text-gray-900">{product.product_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{product.supplier || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{product.unit || '—'}</td>
                    <td className="px-4 py-3 text-right text-lg font-bold text-gray-900">{product.quantity}</td>
                  </tr>)}
                  {visibleProducts.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-500">Nessun prodotto corrisponde alla ricerca.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>}
        </div>
      )}
    </main>
  </div>;
};

const QualityBadge = ({ snapshot }) => {
  const reconstructed = snapshot.data_quality === 'reconstructed_from_ledger';
  return <span data-testid="snapshot-quality" className={`inline-flex px-3 py-1 rounded-full border text-xs font-bold ${reconstructed ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
    {reconstructed ? 'Ricostruita dai movimenti' : 'Fotografia puntuale'}
  </span>;
};

const EmptyState = ({ children }) => <div className="border border-gray-300 bg-white px-4 py-14 text-center text-gray-500">{children}</div>;

export default FotografieMagazzinoPage;
