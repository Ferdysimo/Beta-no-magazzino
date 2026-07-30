import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
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
  return {
    dateFrom: `${month}-01`,
    dateTo: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
};

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  }).format(new Date(value));
};

const formatTime = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  }).format(new Date(value));
};

const statusDetails = {
  evasa: {
    label: 'Da controllare',
    className: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  confermata: {
    label: 'Confermata',
    className: 'bg-green-100 text-green-800 border-green-300',
  },
  errore: {
    label: 'Errore',
    className: 'bg-red-100 text-red-800 border-red-300',
  },
};

const ControlliTrasportiPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedRestaurant = useMemo(
    () => restaurants.find(item => item.id === restaurantId),
    [restaurants, restaurantId],
  );

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API}/admin/restaurants`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      if (cancelled) return;
      const sorted = [...(response.data || [])].sort((a, b) =>
        (a.location || '').localeCompare(b.location || '', 'it')
      );
      setRestaurants(sorted);
      setRestaurantId(current => current || sorted[0]?.id || '');
    }).catch((requestError) => {
      if (!cancelled) {
        setError(requestError.response?.data?.detail || 'Errore caricamento locali');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [token]);

  const fetchChecks = async () => {
    if (!restaurantId || !month) return;
    setLoading(true);
    setError('');
    const { dateFrom, dateTo } = monthRange(month);
    try {
      const response = await axios.get(`${API}/admin/transport-checks`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          restaurant_id: restaurantId,
          date_from: dateFrom,
          date_to: dateTo,
        },
      });
      setRows(response.data || []);
    } catch (requestError) {
      setRows([]);
      setError(requestError.response?.data?.detail || 'Errore caricamento controlli');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, month]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="font-heading text-3xl font-bold text-gray-900 uppercase">
              Controlli trasporti
            </h1>
            {selectedRestaurant && (
              <p className="text-sm text-gray-500 mt-1">{selectedRestaurant.location}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 rounded text-sm font-semibold"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Home
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(220px,1fr)_200px_44px] gap-3 items-end border-y border-gray-300 py-4 mb-5">
          <label className="text-xs font-bold text-gray-700 uppercase">
            Locale
            <select
              data-testid="transport-restaurant"
              value={restaurantId}
              onChange={event => setRestaurantId(event.target.value)}
              className="mt-1 block w-full h-11 px-3 border border-gray-300 bg-white rounded text-sm font-normal normal-case"
            >
              {restaurants.map(item => (
                <option key={item.id} value={item.id}>{item.location}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-gray-700 uppercase">
            Mese
            <input
              data-testid="transport-month"
              type="month"
              value={month}
              onChange={event => setMonth(event.target.value)}
              className="mt-1 block w-full h-11 px-3 border border-gray-300 bg-white rounded text-sm font-normal"
            />
          </label>
          <button
            type="button"
            onClick={fetchChecks}
            disabled={loading || !restaurantId}
            title="Aggiorna controlli"
            aria-label="Aggiorna controlli"
            className="h-11 w-11 inline-flex items-center justify-center bg-gray-900 hover:bg-black disabled:opacity-50 text-white rounded"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="mb-4 border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="overflow-x-auto border border-gray-300 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left">Data trasporto</th>
                <th className="px-4 py-3 text-left">DDT</th>
                <th className="px-4 py-3 text-left">Esito</th>
                <th className="px-4 py-3 text-left">Controllato da</th>
                <th className="px-4 py-3 text-left">Ora</th>
                <th className="px-4 py-3 text-left">Motivo errore</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Caricamento...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Nessun trasporto nel periodo selezionato.
                  </td>
                </tr>
              ) : rows.map((row) => {
                const status = statusDetails[row.status] || statusDetails.evasa;
                const checkTime = row.transport_checked_at
                  || row.confermata_at
                  || row.error_reported_at;
                const checkerName = row.transport_checked_by
                  || (row.status === 'evasa' ? '-' : 'Nome non registrato');
                return (
                  <tr key={row.id} data-testid={`transport-row-${row.ddt_number}`}>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {formatDate(row.dispatch_date)}
                    </td>
                    <td className="px-4 py-3">{row.ddt_number}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex border px-2 py-1 rounded text-xs font-bold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{checkerName}</div>
                      {row.transport_checked_account && (
                        <div className="text-xs text-gray-500">Account: {row.transport_checked_account}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatTime(checkTime)}</td>
                    <td className="px-4 py-3 text-red-800">{row.error_reason || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

export default ControlliTrasportiPage;
