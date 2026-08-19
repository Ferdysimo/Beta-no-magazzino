import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  HardDrive,
  RefreshCw,
  Search,
  Server,
  Wifi,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import DiagnosticsDevicesView from '../components/diagnostics/DiagnosticsDevicesView';
import { getDiagnosticDeviceWarnings } from '../utils/diagnosticsDevices';
import { formatItalianDateTime } from '../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const REFRESH_MS = 5000;

const formatTime = iso => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' });
  } catch {
    return iso;
  }
};

const formatDateTime = iso => {
  if (!iso) return '-';
  try {
    return formatItalianDateTime(iso);
  } catch {
    return iso;
  }
};

const numberOrDash = value => (
  typeof value === 'number' && Number.isFinite(value) ? value : '-'
);

const countLabel = (count, singular, plural) => (
  `${count} ${count === 1 ? singular : plural}`
);

const OverviewFact = ({ icon: Icon, label, value, detail, testId }) => (
  <div className="flex min-h-[92px] items-start gap-3 border-r border-slate-200 px-4 py-4 last:border-r-0">
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-700">
      <Icon size={17} aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xl font-black text-slate-950" data-testid={testId}>{value}</div>
      <div className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</div>
    </div>
  </div>
);

const InfrastructureFact = ({ label, value, detail }) => (
  <div className="border-r border-slate-200 px-4 py-3 last:border-r-0">
    <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-1 text-sm font-black text-slate-950">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{detail}</div>
  </div>
);

const DiagnosticaLivePage = () => {
  const { token, canImpersonate, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const [filterPath, setFilterPath] = useState('');

  const fetchData = async () => {
    if (!token) return;
    try {
      const response = await axios.get(`${API}/admin/diagnostics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(response.data);
      setError(null);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Errore caricamento diagnostica');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return undefined;
    const interval = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, token]);

  const expectedFrontendVersion = useMemo(() => {
    const versions = data?.deployment?.frontend_versions || [];
    const sorted = versions.slice().sort((a, b) => Number(a) - Number(b));
    return sorted[sorted.length - 1] || '';
  }, [data]);

  const onlineDevices = useMemo(
    () => (data?.frontend?.devices || []).filter(device => device.status === 'online'),
    [data],
  );

  const deviceIssueCount = useMemo(
    () => onlineDevices.filter(device => getDiagnosticDeviceWarnings(device, expectedFrontendVersion).length > 0).length,
    [onlineDevices, expectedFrontendVersion],
  );

  const onlineLocationCount = useMemo(
    () => new Set(onlineDevices.map(device => device.restaurant_id || device.restaurant_location).filter(Boolean)).size,
    [onlineDevices],
  );

  const stats = useMemo(() => {
    const calls = data?.recent_calls || [];
    if (!calls.length) return { avg: 0, max: 0, errors: 0, serverErrors: 0, total: 0 };
    const durations = calls.map(call => call.ms || 0);
    return {
      avg: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / calls.length),
      max: Math.max(...durations),
      errors: calls.filter(call => call.status >= 400).length,
      serverErrors: calls.filter(call => call.status >= 500).length,
      total: calls.length,
    };
  }, [data]);

  const endpointStats = useMemo(() => {
    const grouped = new Map();
    (data?.recent_calls || []).forEach(call => {
      const path = (call.path || '-')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
        .replace(/\?.*$/, '');
      const current = grouped.get(path) || { path, count: 0, errors: 0, totalMs: 0, maxMs: 0 };
      current.count += 1;
      current.errors += call.status >= 400 ? 1 : 0;
      current.totalMs += call.ms || 0;
      current.maxMs = Math.max(current.maxMs, call.ms || 0);
      grouped.set(path, current);
    });
    return Array.from(grouped.values())
      .map(item => ({ ...item, avgMs: Math.round(item.totalMs / item.count) }))
      .sort((a, b) => (b.errors - a.errors) || (b.maxMs - a.maxMs))
      .slice(0, 10);
  }, [data]);

  const infrastructureFindings = useMemo(() => {
    if (!data) return [];
    const findings = [];
    if (!data.system?.mongo_ok) {
      findings.push({
        key: 'mongo',
        level: 'critical',
        title: 'MongoDB non risponde',
        detail: data.system?.mongo_error || 'Il ping al database è fallito.',
        action: 'Controlla il servizio MongoDB e la raggiungibilità della porta configurata.',
      });
    }
    if (stats.serverErrors > 0) {
      findings.push({
        key: 'server-errors',
        level: 'critical',
        title: `${stats.serverErrors} errori server nel buffer`,
        detail: 'Sono presenti risposte HTTP 5xx nelle chiamate più recenti.',
        action: 'Apri i dettagli infrastruttura e parti dall’endpoint con errore più recente.',
      });
    }
    if (typeof data.system?.disk?.used_percent === 'number' && data.system.disk.used_percent >= 85) {
      findings.push({
        key: 'disk',
        level: 'warning',
        title: `Disco uploads al ${data.system.disk.used_percent}%`,
        detail: `${numberOrDash(data.system.disk.free_gb)} GB ancora disponibili.`,
        action: 'Verifica i file più pesanti e pianifica spazio aggiuntivo prima di raggiungere il limite.',
      });
    }
    if (stats.max >= 1200) {
      findings.push({
        key: 'api-latency',
        level: 'warning',
        title: `Picco API di ${stats.max} ms`,
        detail: 'Almeno una chiamata recente ha superato 1,2 secondi.',
        action: 'Ordina mentalmente gli endpoint per picco nella tabella e verifica quello più lento.',
      });
    }
    const unstableSockets = (data.websockets || []).filter(socket => socket.disconnects_last_hour > 5);
    if (unstableSockets.length) {
      findings.push({
        key: 'websocket',
        level: 'warning',
        title: `WebSocket instabile in ${unstableSockets.length} locali`,
        detail: unstableSockets.map(socket => socket.location || socket.username).filter(Boolean).join(', '),
        action: 'Confronta le disconnessioni con rete e RTT dei dispositivi di quei locali.',
      });
    }
    return findings;
  }, [data, stats]);

  const filteredCalls = useMemo(() => {
    const query = filterPath.trim().toLowerCase();
    if (!query) return data?.recent_calls || [];
    return (data?.recent_calls || []).filter(call => (call.path || '').toLowerCase().includes(query));
  }, [data, filterPath]);

  if (!canImpersonate) {
    return (
      <div className="min-h-screen bg-slate-100">
        <Header />
        <main className="mx-auto max-w-3xl p-6">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">Accesso riservato all'Admin.</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Header />
      <main className="mx-auto max-w-[1920px] px-3 py-4 sm:px-5 lg:px-6 xl:px-8 2xl:px-10">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Console operativa</div>
            <h1 className="mt-1 font-heading text-2xl font-black uppercase text-slate-950 sm:text-3xl">Diagnostica live</h1>
            <div className="mt-1 text-xs text-slate-500">Ultimo aggiornamento: {data?.server_time ? formatDateTime(data.server_time) : '-'}</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-700" data-testid="diag-auto-refresh">
              <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} className="h-4 w-4" />
              Aggiorna ogni 5s
            </label>
            <button type="button" onClick={fetchData} data-testid="diag-refresh-now" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-3 font-bold text-white hover:bg-slate-800">
              <RefreshCw size={16} aria-hidden="true" /> Ricarica
            </button>
          </div>
        </header>

        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}

        {loading && !data ? (
          <div className="py-16 text-center text-slate-400">Caricamento diagnostica...</div>
        ) : data ? (
          <>
            <section className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <div className="grid min-w-[760px] grid-cols-4">
                <OverviewFact icon={Wifi} label="Locali collegati" value={onlineLocationCount} detail={`${onlineDevices.length} dispositivi online`} testId="diag-online-locations" />
                <OverviewFact
                  icon={Activity}
                  label="Da verificare"
                  value={deviceIssueCount + infrastructureFindings.length}
                  detail={`${countLabel(deviceIssueCount, 'dispositivo', 'dispositivi')} · ${countLabel(infrastructureFindings.length, 'problema infrastruttura', 'problemi infrastruttura')}`}
                  testId="diag-issues-count"
                />
                <OverviewFact icon={Clock} label="Risposta API" value={`${stats.avg} ms`} detail={`${stats.total} chiamate · picco ${stats.max} ms`} testId="diag-api-avg-ms" />
                <OverviewFact icon={Server} label="Servizio" value={data.deployment?.backend_version || 'Backend'} detail={`Avviato ${formatDateTime(data.server_started_at)}`} testId="diag-backend-version" />
              </div>
            </section>

            {infrastructureFindings.length > 0 ? (
              <section className="mb-4 rounded-lg border border-amber-300 bg-white" data-testid="diag-infrastructure-findings">
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
                  <h2 className="font-black text-slate-950">Interventi infrastruttura</h2>
                  <p className="mt-0.5 text-xs text-slate-600">Solo condizioni che richiedono una verifica concreta.</p>
                </div>
                <div className="grid gap-0 divide-y divide-slate-100 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                  {infrastructureFindings.map(finding => (
                    <div key={finding.key} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 p-4">
                      <AlertTriangle size={17} className={finding.level === 'critical' ? 'text-rose-700' : 'text-amber-700'} />
                      <div>
                        <div className="text-sm font-black text-slate-950">{finding.title}</div>
                        <div className="mt-1 text-sm text-slate-600">{finding.detail}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">Azione: {finding.action}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <DiagnosticsDevicesView
              devices={data.frontend?.devices || []}
              recentErrors={data.frontend?.recent_errors || []}
              operations={data.operations?.locations || []}
              websockets={data.websockets || []}
              expectedVersion={expectedFrontendVersion}
              token={token}
              canEdit={isAdmin}
              onRefresh={fetchData}
            />

            <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setShowInfrastructure(value => !value)}
                data-testid="diag-toggle-infrastructure"
                className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50"
              >
                <Server size={18} className="text-slate-600" />
                <div className="min-w-0 flex-1">
                  <div className="font-black text-slate-950">Infrastruttura e log tecnici</div>
                  <div className="mt-0.5 text-xs text-slate-500">Database, disco, WebSocket, prestazioni ed errori API</div>
                </div>
                {showInfrastructure ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              <div className="grid grid-cols-2 border-t border-slate-200 lg:grid-cols-5">
                <InfrastructureFact label="Backend" value={data.system?.backend_ok ? 'Processo attivo' : 'Non raggiungibile'} detail={data.deployment?.backend_git_commit || 'Commit non disponibile'} />
                <InfrastructureFact label="MongoDB" value={data.system?.mongo_ok ? 'Ping riuscito' : 'Ping fallito'} detail={data.system?.mongo_error || 'Connessione disponibile'} />
                <InfrastructureFact label="Disco uploads" value={`${numberOrDash(data.system?.disk?.free_gb)} GB liberi`} detail={`${numberOrDash(data.system?.disk?.used_percent)}% utilizzato`} />
                <InfrastructureFact label="Errori API" value={`${stats.serverErrors} server · ${stats.errors} totali`} detail={`Buffer: ${data.buffer_size || 0} richieste`} />
                <InfrastructureFact label="Lavoro odierno" value={`${(data.operations?.locations || []).reduce((sum, location) => sum + (location.orders_today || 0), 0)} ordini`} detail={`${data.operations?.pending_ddt_count || 0} DDT da gestire`} />
              </div>

              {showInfrastructure ? (
                <div className="border-t border-slate-200 bg-slate-50 p-4 lg:p-5">
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3 font-black text-slate-950">Andamento per finestra</div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">Periodo</th><th className="px-3 py-2 text-right">Chiamate</th><th className="px-3 py-2 text-right">Errori</th><th className="px-3 py-2 text-right">Media</th><th className="px-3 py-2 text-right">Picco</th><th className="px-3 py-2 text-right">Disc. WS</th></tr></thead>
                          <tbody>{(data.health_history || []).map(window => <tr key={window.label} className="border-t border-slate-100"><td className="px-3 py-2 font-bold">{window.label}</td><td className="px-3 py-2 text-right">{window.calls}</td><td className={`px-3 py-2 text-right font-bold ${window.errors ? 'text-rose-700' : 'text-slate-700'}`}>{window.errors}</td><td className="px-3 py-2 text-right">{window.avg_ms} ms</td><td className="px-3 py-2 text-right">{window.max_ms} ms</td><td className="px-3 py-2 text-right">{window.ws_disconnects}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </section>

                    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3 font-black text-slate-950">Endpoint da controllare per primi</div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">Endpoint</th><th className="px-3 py-2 text-right">Chiamate</th><th className="px-3 py-2 text-right">Errori</th><th className="px-3 py-2 text-right">Media</th><th className="px-3 py-2 text-right">Picco</th></tr></thead>
                          <tbody>{endpointStats.length ? endpointStats.map(item => <tr key={item.path} className="border-t border-slate-100"><td className="max-w-xs break-all px-3 py-2 font-mono text-xs">{item.path}</td><td className="px-3 py-2 text-right">{item.count}</td><td className={`px-3 py-2 text-right font-bold ${item.errors ? 'text-rose-700' : 'text-slate-700'}`}>{item.errors}</td><td className="px-3 py-2 text-right">{item.avgMs} ms</td><td className={`px-3 py-2 text-right font-semibold ${item.maxMs >= 1200 ? 'text-amber-800' : ''}`}>{item.maxMs} ms</td></tr>) : <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Nessuna chiamata recente</td></tr>}</tbody>
                        </table>
                      </div>
                    </section>
                  </div>

                  <div className="mt-4 grid gap-4 2xl:grid-cols-2">
                    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3 font-black text-slate-950">WebSocket per locale</div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">Locale</th><th className="px-3 py-2 text-right">Connessioni</th><th className="px-3 py-2 text-right">Ultimo messaggio</th><th className="px-3 py-2 text-right">Disconnessioni 1h</th></tr></thead>
                          <tbody>{(data.websockets || []).filter(socket => socket.role === 'restaurant').map(socket => <tr key={socket.restaurant_id} className="border-t border-slate-100"><td className="px-3 py-2 font-bold">{socket.location || socket.username || '-'}</td><td className="px-3 py-2 text-right">{socket.active_connections || 0}</td><td className="px-3 py-2 text-right">{formatTime(socket.last_seen)}</td><td className={`px-3 py-2 text-right font-bold ${socket.disconnects_last_hour > 5 ? 'text-amber-800' : 'text-slate-700'}`}>{socket.disconnects_last_hour || 0}</td></tr>)}</tbody>
                        </table>
                      </div>
                    </section>

                    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-4 py-3 font-black text-slate-950">Errori backend recenti</div>
                      <div className="max-h-[260px] overflow-auto">
                        {(data.recent_errors || []).length ? (data.recent_errors || []).map((backendError, index) => (
                          <div key={`${backendError.ts}-${index}`} className="border-b border-slate-100 px-4 py-3 last:border-0">
                            <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                              <span>{formatTime(backendError.ts)}</span>
                              <span>{backendError.location || 'Senza locale'}</span>
                              <span className="font-bold text-rose-700">HTTP {backendError.status}</span>
                            </div>
                            <div className="mt-1 break-all font-mono text-xs font-bold text-slate-900">{backendError.method} {backendError.path}</div>
                            <div className="mt-1 break-words text-xs text-slate-600">{backendError.error || 'Nessun dettaglio disponibile'}</div>
                          </div>
                        )) : <div className="px-4 py-8 text-center text-sm text-slate-400">Nessun errore backend nel buffer corrente</div>}
                      </div>
                    </section>
                  </div>

                  <section className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
                      <div className="min-w-0 flex-1 font-black text-slate-950">Ultime chiamate API</div>
                      <label className="relative block w-full sm:w-72">
                        <span className="sr-only">Filtra percorso API</span>
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={filterPath} onChange={event => setFilterPath(event.target.value)} placeholder="Filtra endpoint" data-testid="diag-filter-path" className="h-9 w-full rounded border border-slate-300 pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none" />
                      </label>
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <table className="w-full min-w-[760px] text-xs">
                        <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left">Ora</th><th className="px-3 py-2 text-left">Locale</th><th className="px-3 py-2 text-left">Metodo</th><th className="px-3 py-2 text-left">Endpoint</th><th className="px-3 py-2 text-right">Status</th><th className="px-3 py-2 text-right">Tempo</th></tr></thead>
                        <tbody>{filteredCalls.length ? filteredCalls.map((call, index) => <tr key={`${call.ts}-${index}`} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-2">{formatTime(call.ts)}</td><td className="whitespace-nowrap px-3 py-2">{call.location || '-'}</td><td className="px-3 py-2 font-mono">{call.method}</td><td className="break-all px-3 py-2 font-mono">{call.path}</td><td className={`px-3 py-2 text-right font-bold ${call.status >= 400 ? 'text-rose-700' : 'text-slate-700'}`}>{call.status}</td><td className={`px-3 py-2 text-right font-semibold ${call.ms >= 1200 ? 'text-amber-800' : ''}`}>{call.ms} ms</td></tr>) : <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Nessuna chiamata</td></tr>}</tbody>
                      </table>
                    </div>
                  </section>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
};

export default DiagnosticaLivePage;
