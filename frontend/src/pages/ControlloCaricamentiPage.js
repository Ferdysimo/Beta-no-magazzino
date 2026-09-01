import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';


const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const dateValue = (daysAgo = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

const STATUS = {
  saved: {
    label: 'Salvata',
    detail: 'Il server ha confermato il salvataggio.',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  failed: {
    label: 'Non salvata',
    detail: 'Il tentativo si è fermato con un errore.',
    className: 'bg-red-50 text-red-800 border-red-200',
  },
  incomplete: {
    label: 'Senza conferma',
    detail: 'La traccia si è interrotta prima della conferma del server.',
    className: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  pending: {
    label: 'In corso',
    detail: 'Il tentativo è ancora recente.',
    className: 'bg-blue-50 text-blue-800 border-blue-200',
  },
};

const STAGE_LABELS = {
  file_selected: 'Foto selezionata',
  compression_started: 'Preparazione iniziata',
  compression_succeeded: 'Foto preparata',
  compression_failed: 'Preparazione fallita',
  upload_started: 'Invio iniziato',
  upload_succeeded: 'Risposta positiva ricevuta',
  upload_failed: 'Invio fallito',
  server_received: 'Richiesta arrivata al server',
  server_saved: 'Foto scritta e chiusura salvata',
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

const shortDeviceId = (value) => {
  const id = String(value || '');
  return id ? id.slice(-8).toUpperCase() : 'non identificato';
};

const AttemptRow = ({ attempt }) => {
  const [open, setOpen] = useState(false);
  const status = STATUS[attempt.display_status] || STATUS.incomplete;
  const events = attempt.events || [];
  const latest = events[events.length - 1] || {};
  const originalBytes = events.find(event => event.file_size_bytes)?.file_size_bytes;
  const compressedBytes = events.find(event => event.compressed_size_bytes)?.compressed_size_bytes;

  return (
    <>
      <tr className="border-b border-slate-200 hover:bg-slate-50 align-top">
        <td className="px-4 py-4">
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            className="flex items-center gap-2 text-left font-semibold text-slate-900"
            aria-expanded={open}
          >
            {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            {formatDateTime(attempt.first_seen)}
          </button>
          <div className="ml-6 mt-1 text-xs text-slate-500">
            {attempt.upload_kind === 'closure_secondary' ? 'Seconda foto' : 'Foto chiusura'}
          </div>
        </td>
        <td className="px-4 py-4">
          <div className="font-semibold text-slate-900">{attempt.restaurant_location || 'Locale non identificato'}</div>
          <div className="text-xs text-slate-500 mt-1">Utente: {attempt.username || '—'}</div>
        </td>
        <td className="px-4 py-4">
          <div className="font-medium text-slate-800">{attempt.browser || 'Browser'} · {attempt.os || attempt.platform || 'sistema non rilevato'}</div>
          <div className="text-xs text-slate-500 mt-1 font-mono">Dispositivo {shortDeviceId(attempt.device_id)}</div>
          {attempt.connection_effective_type && (
            <div className="text-xs text-slate-500 mt-1">Rete {attempt.connection_effective_type}</div>
          )}
        </td>
        <td className="px-4 py-4">
          <span className={`inline-flex border rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>
            {status.label}
          </span>
          <div className="text-xs text-slate-600 mt-2 max-w-xs">{status.detail}</div>
        </td>
        <td className="px-4 py-4">
          <div className="font-medium text-slate-800">{STAGE_LABELS[attempt.current_stage] || attempt.current_stage || '—'}</div>
          {(latest.error_message || latest.http_status) && (
            <div className="text-xs text-red-700 mt-1 max-w-sm break-words">
              {latest.error_message || 'Errore'}{latest.http_status ? ` · HTTP ${latest.http_status}` : ''}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-200 bg-slate-50/70">
          <td colSpan="5" className="px-10 py-5">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_240px] gap-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Cronologia del tentativo</h3>
                <ol className="space-y-3">
                  {events.map((event, index) => (
                    <li key={event.event_id || `${event.stage}-${index}`} className="flex gap-3">
                      <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-900">
                          {STAGE_LABELS[event.stage] || event.stage}
                        </div>
                        <div className="text-xs text-slate-500">{formatDateTime(event.client_at || event.server_at)}</div>
                        {(event.error_message || event.error_kind || event.http_status) && (
                          <div className="text-xs text-red-700 mt-1 break-words">
                            {[event.error_kind, event.error_message, event.http_status ? `HTTP ${event.http_status}` : '']
                              .filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="border border-slate-200 bg-white rounded-lg p-4 text-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Dati utili</div>
                <dl className="space-y-2">
                  <div><dt className="text-slate-500">Tentativo</dt><dd className="font-mono text-xs break-all">{attempt.attempt_id}</dd></div>
                  {attempt.target_closure_id && <div><dt className="text-slate-500">Chiusura</dt><dd className="font-mono text-xs break-all">{attempt.target_closure_id}</dd></div>}
                  {originalBytes && <div><dt className="text-slate-500">Foto originale</dt><dd>{formatBytes(originalBytes)}</dd></div>}
                  {compressedBytes && <div><dt className="text-slate-500">Foto inviata</dt><dd>{formatBytes(compressedBytes)}</dd></div>}
                  {attempt.path && <div><dt className="text-slate-500">Pagina</dt><dd>{attempt.path}</dd></div>}
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const ControlloCaricamentiPage = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [dateFrom, setDateFrom] = useState(() => dateValue(7));
  const [dateTo, setDateTo] = useState(() => dateValue(0));
  const [restaurantId, setRestaurantId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState({ items: [], restaurants: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState('');

  const loadAttempts = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API}/admin/upload-attempts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          date_from: new Date(`${dateFrom}T00:00:00`).toISOString(),
          date_to: new Date(`${dateTo}T23:59:59.999`).toISOString(),
          restaurant_id: restaurantId || undefined,
          status: statusFilter,
        },
      });
      setData(response.data);
      setLastRefresh(response.data?.generated_at || new Date().toISOString());
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Impossibile caricare i tentativi.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [dateFrom, dateTo, restaurantId, statusFilter, token]);

  useEffect(() => {
    loadAttempts();
  }, [loadAttempts]);

  useEffect(() => {
    const timer = window.setInterval(() => loadAttempts(true), 30000);
    return () => window.clearInterval(timer);
  }, [loadAttempts]);

  const counts = useMemo(() => ({
    saved: Number(data.summary?.saved || 0),
    failed: Number(data.summary?.failed || 0),
    unconfirmed: Number(data.summary?.incomplete || 0) + Number(data.summary?.pending || 0),
  }), [data.summary]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Header />
      <main className="max-w-[1500px] mx-auto p-5 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/home')}
              className="h-10 w-10 bg-white border border-slate-300 rounded-lg flex items-center justify-center hover:bg-slate-50"
              aria-label="Torna alla Home"
            >
              <ArrowLeft size={19} />
            </button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">Controllo caricamenti chiusure</h1>
              <p className="text-sm text-slate-600 mt-1">Dalla scelta della foto fino alla conferma del salvataggio sul server.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadAttempts()}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg font-semibold disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
            Aggiorna
          </button>
        </div>

        <section className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <label className="text-sm font-medium text-slate-700">
              Dal
              <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="mt-1 block w-full h-10 border border-slate-300 rounded-md px-3" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Al
              <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="mt-1 block w-full h-10 border border-slate-300 rounded-md px-3" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Locale
              <select value={restaurantId} onChange={event => setRestaurantId(event.target.value)} className="mt-1 block w-full h-10 border border-slate-300 rounded-md px-3 bg-white">
                <option value="">Tutti i locali</option>
                {(data.restaurants || []).map(item => <option key={item.id} value={item.id}>{item.location}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Esito
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="mt-1 block w-full h-10 border border-slate-300 rounded-md px-3 bg-white">
                <option value="all">Tutti</option>
                <option value="saved">Salvate</option>
                <option value="failed">Non salvate</option>
                <option value="incomplete">Senza conferma</option>
                <option value="pending">In corso</option>
              </select>
            </label>
            <div className="text-xs text-slate-500 pb-2 lg:text-right">
              Aggiornamento automatico ogni 30 secondi<br />
              {lastRefresh && `Ultimo: ${formatDateTime(lastRefresh)}`}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-sm text-slate-500">Salvate</div><div className="text-3xl font-bold text-slate-950 mt-1">{counts.saved}</div></div>
          <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-sm text-slate-500">Non salvate</div><div className="text-3xl font-bold text-slate-950 mt-1">{counts.failed}</div></div>
          <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-sm text-slate-500">In corso o senza conferma</div><div className="text-3xl font-bold text-slate-950 mt-1">{counts.unconfirmed}</div></div>
        </section>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 mb-5">{error}</div>}

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left">
              <thead className="bg-slate-900 text-white text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Locale</th>
                  <th className="px-4 py-3">Dispositivo</th>
                  <th className="px-4 py-3">Esito</th>
                  <th className="px-4 py-3">Ultima fase</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || []).map(attempt => <AttemptRow key={attempt.attempt_id} attempt={attempt} />)}
              </tbody>
            </table>
          </div>
          {!loading && !data.items?.length && (
            <div className="px-6 py-14 text-center text-slate-500">
              Nessun tentativo registrato nel periodo selezionato.
            </div>
          )}
          {loading && <div className="px-6 py-14 text-center text-slate-500">Caricamento...</div>}
        </section>
      </main>
    </div>
  );
};

export default ControlloCaricamentiPage;
