import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, FileClock, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const monthRange = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
};

const formatDateTime = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
  }).format(new Date(value));
};

const itemKey = (item) => item.product_id || item.product_name || '';

const changedItems = (entry) => {
  const before = new Map((entry.before_items || []).map(item => [itemKey(item), item]));
  const after = new Map((entry.after_items || []).map(item => [itemKey(item), item]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((key) => {
      const oldItem = before.get(key);
      const newItem = after.get(key);
      return {
        key,
        name: newItem?.product_name || oldItem?.product_name || 'Prodotto',
        unit: newItem?.unit || oldItem?.unit || '',
        before: Number(oldItem?.quantity || 0),
        after: Number(newItem?.quantity || 0),
      };
    })
    .filter(item => item.before !== item.after);
};

const ItemsTable = ({ items = [] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[560px] text-sm">
      <thead className="text-xs uppercase text-gray-500 border-b border-gray-200">
        <tr><th className="px-4 py-2 text-left">Prodotto</th><th className="px-4 py-2 text-left">Unità</th><th className="px-4 py-2 text-right">Quantità</th></tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {items.map((item, index) => (
          <tr key={`${itemKey(item)}-${index}`}>
            <td className="px-4 py-2 font-semibold text-gray-900">{item.product_name || '-'}</td>
            <td className="px-4 py-2 text-gray-600">{item.unit || '-'}</td>
            <td className="px-4 py-2 text-right font-bold">{item.quantity}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EditEvent = ({ entry }) => {
  const changes = changedItems(entry);
  const noteChanged = (entry.before_extra_note || '') !== (entry.after_extra_note || '');
  return (
    <section className="px-4 py-4" data-testid="edit-event">
      <div className="flex flex-wrap justify-between gap-2 mb-3">
        <div className="font-bold text-gray-900">{formatDateTime(entry.changed_at)}</div>
        <div className="text-sm text-gray-500">da {entry.changed_by_username || 'Account non registrato'}</div>
      </div>
      {changes.length > 0 && <div className="grid gap-2">
        {changes.map(change => (
          <div key={change.key} className="grid grid-cols-[1fr_auto] gap-3 border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-gray-900">{change.name} {change.unit ? `(${change.unit})` : ''}</span>
            <span className="font-bold whitespace-nowrap">{change.before} → {change.after}</span>
          </div>
        ))}
      </div>}
      {noteChanged && <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <div className="bg-red-50 px-3 py-2"><b>Extra prima:</b> {entry.before_extra_note || '—'}</div>
        <div className="bg-green-50 px-3 py-2"><b>Extra dopo:</b> {entry.after_extra_note || '—'}</div>
      </div>}
    </section>
  );
};

const RichiesteCancellatePage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [restaurantId, setRestaurantId] = useState('');
  const [restaurants, setRestaurants] = useState([]);
  const [cancelledRows, setCancelledRows] = useState([]);
  const [modifiedRows, setModifiedRows] = useState([]);
  const [activeSection, setActiveSection] = useState('cancelled');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/admin/restaurants`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (!cancelled) setRestaurants([...(response.data || [])].sort((a, b) => (a.location || '').localeCompare(b.location || '', 'it')));
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  const fetchAudit = async () => {
    if (!month) return;
    setLoading(true);
    setError('');
    const { dateFrom, dateTo } = monthRange(month);
    const params = { date_from: dateFrom, date_to: dateTo };
    if (restaurantId) params.restaurant_id = restaurantId;
    try {
      const config = { headers: { Authorization: `Bearer ${token}` }, params };
      const [cancelledResponse, modifiedResponse] = await Promise.all([
        axios.get(`${API}/admin/cancelled-requests`, config),
        axios.get(`${API}/admin/modified-requests`, config),
      ]);
      setCancelledRows(cancelledResponse.data || []);
      setModifiedRows(modifiedResponse.data || []);
    } catch (requestError) {
      setCancelledRows([]);
      setModifiedRows([]);
      setError(requestError.response?.data?.detail || 'Errore caricamento audit richieste merce');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, restaurantId]);

  const selectedLocation = useMemo(
    () => restaurants.find(item => item.id === restaurantId)?.location || 'Tutti i locali',
    [restaurantId, restaurants],
  );
  const visibleRows = activeSection === 'cancelled' ? cancelledRows : modifiedRows;

  return <div className="min-h-screen bg-[#F5F5F5]">
    <Header />
    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3"><FileClock size={28} className="text-gray-800" /><h1 className="font-heading text-3xl font-bold text-gray-900 uppercase">Audit richieste merce</h1></div>
          <p className="text-sm text-gray-500 mt-1">Richieste annullate e cronologia delle modifiche ai DDT.</p>
        </div>
        <button type="button" onClick={() => navigate('/home')} className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 rounded text-sm font-semibold"><ArrowLeft size={16} /> Home</button>
      </div>

      <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 mb-5">
        Le richieste cancellate e le versioni prima/dopo vengono conservate dall'attivazione di questa funzione. I DDT modificati in passato possono comparire solo con il valore finale.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,1fr)_200px_44px] gap-3 items-end border-y border-gray-300 py-4 mb-5">
        <label className="text-xs font-bold text-gray-700 uppercase">Locale
          <select data-testid="audit-restaurant" value={restaurantId} onChange={event => setRestaurantId(event.target.value)} className="mt-1 block w-full h-11 px-3 border border-gray-300 bg-white rounded text-sm font-normal normal-case">
            <option value="">Tutti i locali</option>{restaurants.map(item => <option key={item.id} value={item.id}>{item.location}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-gray-700 uppercase">Mese evento
          <input data-testid="audit-month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="mt-1 block w-full h-11 px-3 border border-gray-300 bg-white rounded text-sm font-normal" />
        </label>
        <button type="button" onClick={fetchAudit} disabled={loading} title="Aggiorna archivio" aria-label="Aggiorna archivio" className="h-11 w-11 inline-flex items-center justify-center bg-gray-900 hover:bg-black disabled:opacity-50 text-white rounded">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-2 border border-gray-300 bg-white mb-5">
        <button type="button" data-testid="cancelled-tab" onClick={() => setActiveSection('cancelled')} className={`px-3 py-3 text-sm font-bold border-r border-gray-300 ${activeSection === 'cancelled' ? 'bg-red-50 text-red-900' : 'text-gray-600 hover:bg-gray-50'}`}>Richieste cancellate ({cancelledRows.length})</button>
        <button type="button" data-testid="modified-tab" onClick={() => setActiveSection('modified')} className={`px-3 py-3 text-sm font-bold ${activeSection === 'modified' ? 'bg-blue-50 text-blue-900' : 'text-gray-600 hover:bg-gray-50'}`}>DDT modificati ({modifiedRows.length})</button>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 text-sm"><span className="font-semibold text-gray-800">{selectedLocation}</span><span data-testid="audit-count" className="text-gray-500">{visibleRows.length} {visibleRows.length === 1 ? 'risultato' : 'risultati'}</span></div>
      {error && <div className="mb-4 border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm">{error}</div>}
      {loading ? <EmptyState>Caricamento...</EmptyState> : visibleRows.length === 0 ? <EmptyState>Nessun evento nel periodo selezionato.</EmptyState> : activeSection === 'cancelled' ? (
        <div className="space-y-4">{cancelledRows.map(row => <article key={row.id} data-testid={`cancelled-request-${row.ddt_number}`} className="border border-gray-300 bg-white">
          <AuditHeader row={row} right={<><div className="text-sm font-bold text-red-800">Cancellata {formatDateTime(row.cancelled_at)}</div><div className="text-xs text-gray-500 mt-1">da {row.cancelled_by_username || 'Account non registrato'}</div></>} />
          <ItemsTable items={row.items} />
          {row.extra_note && <div className="border-t border-gray-200 px-4 py-3 text-sm"><b>Extra: </b>{row.extra_note}</div>}
        </article>)}</div>
      ) : (
        <div className="space-y-4">{modifiedRows.map(row => <article key={row.id} data-testid={`modified-request-${row.ddt_number}`} className="border border-gray-300 bg-white">
          <AuditHeader row={row} right={<div className="text-sm font-bold text-blue-900">Ultima modifica {formatDateTime(row.updated_at)}</div>} status />
          {(row.edit_history || []).length === 0 ? <div className="px-4 py-4 text-sm bg-amber-50 text-amber-950">DDT modificato prima dell'attivazione dello storico versioni. È disponibile solo il valore finale.</div> : <div className="divide-y divide-gray-200">{[...(row.edit_history || [])].reverse().map((entry, index) => <EditEvent key={entry.id || `${entry.changed_at}-${index}`} entry={entry} />)}</div>}
        </article>)}</div>
      )}
    </main>
  </div>;
};

const EmptyState = ({ children }) => <div className="border border-gray-300 bg-white px-4 py-12 text-center text-gray-500">{children}</div>;

const AuditHeader = ({ row, right, status = false }) => <div className="grid grid-cols-1 md:grid-cols-[130px_1fr_auto] gap-3 px-4 py-3 bg-gray-100 border-b border-gray-300">
  <div><div className="text-xs uppercase font-bold text-gray-500">DDT</div><div className="text-xl font-bold text-gray-900">{row.ddt_number || '-'}</div></div>
  <div><div className="font-bold text-gray-900">{row.restaurant_location || 'Locale non indicato'}</div><div className="text-xs text-gray-500 mt-1">{status ? `Stato: ${row.status || '-'}` : `Creata: ${formatDateTime(row.created_at)}`}</div></div>
  <div className="md:text-right">{right}</div>
</div>;

export default RichiesteCancellatePage;
