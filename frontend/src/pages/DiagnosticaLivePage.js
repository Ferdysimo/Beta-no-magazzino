import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatItalianDateTime } from '../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const REFRESH_MS = 5000;

const formatTime = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome' });
  } catch {
    return iso;
  }
};

const formatDateTime = (iso) => {
  if (!iso) return '-';
  try {
    return formatItalianDateTime(iso);
  } catch {
    return iso;
  }
};

const secondsAgo = (iso) => {
  if (!iso) return null;
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  return Math.max(0, Math.floor(diff));
};

const formatAgo = (iso) => {
  const seconds = secondsAgo(iso);
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h fa`;
};

const formatVersion = (version) => {
  if (!version) return '-';
  return String(version);
};

const formatVersionDate = (version) => {
  if (!version) return '';
  const asNumber = Number(version);
  if (!Number.isFinite(asNumber) || String(version).length < 10) return '';
  try {
    return new Date(asNumber).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const numberOrDash = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : '-'
);

const HealthPill = ({ level, children }) => {
  const styles = {
    ok: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-amber-100 text-amber-900 border-amber-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
    neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${styles[level] || styles.neutral}`}>
      {children}
    </span>
  );
};

const MetricTile = ({ icon: Icon, label, value, detail, level = 'neutral', testId }) => {
  const border = {
    ok: 'border-green-200',
    warning: 'border-amber-200',
    critical: 'border-red-200',
    neutral: 'border-gray-200',
  }[level] || 'border-gray-200';
  const iconBg = {
    ok: 'bg-green-100 text-green-700',
    warning: 'bg-amber-100 text-amber-700',
    critical: 'bg-red-100 text-red-700',
    neutral: 'bg-gray-100 text-gray-700',
  }[level] || 'bg-gray-100 text-gray-700';

  return (
    <div className={`bg-white border ${border} rounded-lg p-4 min-h-[116px]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-500 uppercase">{label}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1" data-testid={testId}>{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={19} aria-hidden="true" />
        </div>
      </div>
      {detail && <div className="text-xs text-gray-500 mt-3 leading-snug">{detail}</div>}
    </div>
  );
};

const SectionTitle = ({ children }) => (
  <h2 className="text-lg font-bold text-gray-900 mb-3">{children}</h2>
);

const levelClasses = {
  ok: 'border-green-200 bg-green-50 text-green-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  critical: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-gray-200 bg-gray-50 text-gray-800',
};

const TabButton = ({ active, children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${
      active
        ? 'border-gray-900 text-gray-900'
        : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
    }`}
  >
    {children}
  </button>
);

const DiagnosticaLivePage = () => {
  const { token, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterPath, setFilterPath] = useState('');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [deviceLocationFilter, setDeviceLocationFilter] = useState('all');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('all');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [activeTab, setActiveTab] = useState('devices');

  const fetchData = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/admin/diagnostics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Errore caricamento diagnostica');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return undefined;
    const iv = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, token]);

  const filteredCalls = useMemo(() => {
    if (!data?.recent_calls) return [];
    const f = filterPath.trim().toLowerCase();
    if (!f) return data.recent_calls;
    return data.recent_calls.filter(c => (c.path || '').toLowerCase().includes(f));
  }, [data, filterPath]);

  const stats = useMemo(() => {
    if (!data?.recent_calls?.length) return { avg: 0, max: 0, errors: 0, serverErrors: 0, total: 0 };
    const calls = data.recent_calls;
    const total = calls.length;
    const ms = calls.map(c => c.ms || 0);
    const avg = Math.round(ms.reduce((a, b) => a + b, 0) / total);
    const max = Math.max(...ms);
    const errors = calls.filter(c => c.status >= 400).length;
    const serverErrors = calls.filter(c => c.status >= 500).length;
    return { avg, max, errors, serverErrors, total };
  }, [data]);

  const endpointStats = useMemo(() => {
    const calls = data?.recent_calls || [];
    const grouped = new Map();

    calls.forEach(call => {
      const path = call.path || '-';
      const key = path
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
        .replace(/\?.*$/, '');
      const current = grouped.get(key) || { path: key, count: 0, errors: 0, totalMs: 0, maxMs: 0 };
      current.count += 1;
      current.errors += call.status >= 400 ? 1 : 0;
      current.totalMs += call.ms || 0;
      current.maxMs = Math.max(current.maxMs, call.ms || 0);
      grouped.set(key, current);
    });

    return Array.from(grouped.values())
      .map(item => ({ ...item, avgMs: Math.round(item.totalMs / item.count) }))
      .sort((a, b) => (b.errors - a.errors) || (b.maxMs - a.maxMs) || (b.avgMs - a.avgMs))
      .slice(0, 8);
  }, [data]);

  const websocketSummary = useMemo(() => {
    const sockets = data?.websockets || [];
    const restaurants = sockets.filter(ws => ws.role === 'restaurant');
    const online = restaurants.filter(ws => ws.active_connections > 0).length;
    const unstable = restaurants.filter(ws => ws.disconnects_last_hour > 5).length;
    return { total: restaurants.length, online, unstable };
  }, [data]);

  const systemHealth = useMemo(() => {
    if (!data) return { level: 'neutral', label: 'Caricamento' };
    const backendReasons = (data.health_reasons || []).filter(reason => (
      !String(reason.title || '').toLowerCase().includes('errori frontend')
    ));
    const diskUsed = data.system?.disk?.used_percent;
    if (backendReasons.some(reason => reason.level === 'critical') || !data.system?.mongo_ok || stats.serverErrors > 0) {
      return { level: 'critical', label: 'Errore critico' };
    }
    if (backendReasons.some(reason => reason.level === 'warning') || stats.errors > 0 || stats.max > 1000 || websocketSummary.unstable > 0 || (diskUsed && diskUsed >= 85)) {
      return { level: 'warning', label: 'Attenzione' };
    }
    return { level: 'ok', label: 'Sistema OK' };
  }, [data, stats, websocketSummary]);

  const healthReasons = useMemo(() => {
    const visibleReasons = (data?.health_reasons || []).filter(reason => (
      !String(reason.title || '').toLowerCase().includes('errori frontend')
    ));
    if (!visibleReasons.length) {
      return [{
        level: systemHealth.level,
        title: systemHealth.level === 'ok' ? 'Nessuna anomalia evidente' : systemHealth.label,
        detail: 'Dati diagnostici in aggiornamento.',
      }];
    }
    return visibleReasons;
  }, [data, systemHealth]);

  const frontendSummary = useMemo(() => {
    const devices = data?.frontend?.devices || [];
    const versions = data?.deployment?.frontend_versions || [];
    const locations = data?.frontend?.locations || [];
    const sortedVersions = versions.slice().sort((a, b) => Number(a) - Number(b));
    const latestVersion = sortedVersions[sortedVersions.length - 1] || '';
    return {
      devices,
      locations,
      online: data?.frontend?.online_count || 0,
      offline: data?.frontend?.offline_count || 0,
      versions,
      latestVersion,
      visible: devices.filter(d => d.visibility === 'visible').length,
    };
  }, [data]);

  useEffect(() => {
    const locations = frontendSummary.locations || [];
    if (deviceLocationFilter !== 'all' && !locations.some(loc => (loc.restaurant_id || loc.location) === deviceLocationFilter)) {
      setDeviceLocationFilter('all');
    }
  }, [frontendSummary.locations, deviceLocationFilter]);

  const filteredDevices = useMemo(() => {
    const search = deviceSearch.trim().toLowerCase();
    return frontendSummary.devices.filter(device => {
      const locationKey = device.restaurant_id || device.restaurant_location || 'unknown';
      if (deviceLocationFilter !== 'all' && locationKey !== deviceLocationFilter) return false;
      if (deviceStatusFilter !== 'all' && device.status !== deviceStatusFilter) return false;
      if (!search) return true;
      const haystack = [
        device.restaurant_location,
        device.username,
        device.path,
        device.browser,
        device.os,
        device.device_type,
        device.ip,
        device.frontend_version,
        device.device_id,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }, [frontendSummary.devices, deviceLocationFilter, deviceStatusFilter, deviceSearch]);

  const deviceStats = useMemo(() => {
    const expectedVersion = frontendSummary.latestVersion;
    const stale = frontendSummary.devices.filter(device => (
      expectedVersion && device.frontend_version && device.frontend_version !== expectedVersion
    )).length;
    const withErrors = frontendSummary.devices.filter(device => (device.recent_errors_count || 0) > 0).length;
    const locationsWithIssues = frontendSummary.locations.filter(loc => (
      loc.offline > 0 || loc.errors > 0 || (loc.versions?.length || 0) > 1
    )).length;
    return {
      expectedVersion,
      stale,
      withErrors,
      locationsWithIssues,
    };
  }, [frontendSummary]);

  const getDeviceAction = (device) => {
    if (device.status !== 'online') return 'Controlla connessione o tablet spento';
    if (deviceStats.expectedVersion && device.frontend_version && device.frontend_version !== deviceStats.expectedVersion) {
      return 'Chiudi e riapri il browser sul dispositivo';
    }
    if ((device.recent_errors_count || 0) > 0) return 'Se ricapita, fai refresh del dispositivo';
    return 'Nessuna azione';
  };

  const getDeviceLevel = (device) => {
    if (device.status !== 'online') return 'warning';
    if (deviceStats.expectedVersion && device.frontend_version && device.frontend_version !== deviceStats.expectedVersion) return 'warning';
    if ((device.recent_errors_count || 0) > 0) return 'warning';
    return 'ok';
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
      <main className="max-w-[1440px] mx-auto px-5 py-4 sm:px-8 sm:py-6 lg:px-10 xl:px-14 2xl:px-16">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase">
              Diagnostica Live
            </h1>
            <div className="text-sm text-gray-500 mt-1">
              Ultimo aggiornamento: {data?.server_time ? formatDateTime(data.server_time) : '-'}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="diag-auto-refresh">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-gray-700">Auto-refresh 5s</span>
            </label>
            <button
              onClick={fetchData}
              data-testid="diag-refresh-now"
              className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-sm font-medium"
            >
              <RefreshCw size={16} aria-hidden="true" />
              Ricarica
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-4 items-start">
              <aside className="xl:sticky xl:top-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex xl:flex-col gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                      systemHealth.level === 'ok' ? 'bg-green-100 text-green-700' :
                      systemHealth.level === 'warning' ? 'bg-amber-100 text-amber-700' :
                      systemHealth.level === 'critical' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {systemHealth.level === 'ok' ? <CheckCircle2 size={25} /> : <AlertTriangle size={25} />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-500 uppercase">Stato generale</div>
                      <div className="text-2xl xl:text-3xl font-bold text-gray-900 mt-1" data-testid="diag-health-label">
                        {systemHealth.label}
                      </div>
                      <div className="mt-3">
                        <HealthPill level={systemHealth.level}>{systemHealth.label}</HealthPill>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                  {healthReasons.slice(0, 4).map((reason, index) => (
                    <div
                      key={`${reason.title}-${index}`}
                      className={`border rounded-md px-3 py-2 ${levelClasses[reason.level] || levelClasses.neutral}`}
                    >
                      <div className="text-sm font-bold">{reason.title}</div>
                      <div className="text-xs mt-0.5 opacity-80">{reason.detail}</div>
                    </div>
                  ))}
                  </div>
                </div>
              </aside>

              <div className="min-w-0">

            <nav className="mb-6 bg-white border border-gray-200 rounded-lg px-2 overflow-x-auto">
              <div className="flex items-center gap-1 min-w-max">
                <TabButton active={activeTab === 'devices'} onClick={() => setActiveTab('devices')}>
                  Dispositivi locali
                </TabButton>
                <TabButton active={activeTab === 'backend'} onClick={() => setActiveTab('backend')}>
                  Backend
                </TabButton>
              </div>
            </nav>

            {activeTab === 'backend' && (
            <>
            <section className="mb-8">
              <SectionTitle>Backend - stato sistema</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricTile
                  icon={Server}
                  label="Backend"
                  value={data.system?.backend_ok ? 'Online' : 'Errore'}
                  detail={`Avvio: ${data.server_started_at ? formatDateTime(data.server_started_at) : '-'}`}
                  level={data.system?.backend_ok ? 'ok' : 'critical'}
                  testId="diag-backend-status"
                />
                <MetricTile
                  icon={Database}
                  label="MongoDB"
                  value={data.system?.mongo_ok ? 'Online' : 'Errore'}
                  detail={data.system?.mongo_ok ? 'Ping database riuscito' : (data.system?.mongo_error || 'Ping database fallito')}
                  level={data.system?.mongo_ok ? 'ok' : 'critical'}
                  testId="diag-mongo-status"
                />
                <MetricTile
                  icon={HardDrive}
                  label="Disco uploads"
                  value={`${numberOrDash(data.system?.disk?.free_gb)} GB liberi`}
                  detail={typeof data.system?.disk?.used_percent === 'number' ? `Uso disco: ${data.system.disk.used_percent}%` : 'Dato non disponibile'}
                  level={data.system?.disk?.used_percent >= 85 ? 'warning' : 'ok'}
                  testId="diag-disk-status"
                />
                <MetricTile
                  icon={Activity}
                  label="API recenti"
                  value={`${stats.errors} errori`}
                  detail={`${stats.total} chiamate, media ${stats.avg} ms, max ${stats.max} ms`}
                  level={stats.serverErrors > 0 ? 'critical' : stats.errors > 0 || stats.max > 1000 ? 'warning' : 'ok'}
                  testId="diag-api-status"
                />
              </div>
            </section>

            <section className="mb-8">
              <SectionTitle>Backend - prestazioni live</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <MetricTile
                  icon={Activity}
                  label="Latenza media"
                  value={`${stats.avg} ms`}
                  detail={`${stats.total} chiamate nel buffer diagnostico`}
                  level={stats.avg > 500 ? 'warning' : 'ok'}
                  testId="diag-api-avg-ms"
                />
                <MetricTile
                  icon={Clock}
                  label="Picco latenza"
                  value={`${stats.max} ms`}
                  detail={stats.max > 1000 ? 'Una chiamata recente e lenta' : 'Nessun picco critico recente'}
                  level={stats.max > 1000 ? 'warning' : 'ok'}
                  testId="diag-api-max-ms"
                />
                <MetricTile
                  icon={AlertCircle}
                  label="Errori server"
                  value={stats.serverErrors}
                  detail={`${stats.errors} errori HTTP totali recenti`}
                  level={stats.serverErrors > 0 ? 'critical' : stats.errors > 0 ? 'warning' : 'ok'}
                  testId="diag-server-errors"
                />
                <MetricTile
                  icon={AlertTriangle}
                  label="Chiamate lente"
                  value={data.slow_calls_count || 0}
                  detail="Richieste sopra la soglia di lentezza"
                  level={(data.slow_calls_count || 0) > 0 ? 'warning' : 'ok'}
                  testId="diag-slow-calls"
                />
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Endpoint</th>
                      <th className="text-right px-3 py-2 font-semibold">Chiamate</th>
                      <th className="text-right px-3 py-2 font-semibold">Errori</th>
                      <th className="text-right px-3 py-2 font-semibold hidden sm:table-cell">Media</th>
                      <th className="text-right px-3 py-2 font-semibold">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpointStats.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nessuna chiamata recente</td></tr>
                    ) : endpointStats.map(item => (
                      <tr key={item.path} className={`border-t border-gray-100 ${item.errors > 0 ? 'bg-red-50' : item.maxMs > 1000 ? 'bg-yellow-50' : ''}`}>
                        <td className="px-3 py-2 font-mono text-xs text-gray-900 break-all">{item.path}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800">{item.count}</td>
                        <td className={`px-3 py-2 text-right font-bold ${item.errors > 0 ? 'text-red-700' : 'text-green-700'}`}>{item.errors}</td>
                        <td className="px-3 py-2 text-right text-gray-700 hidden sm:table-cell">{item.avgMs} ms</td>
                        <td className={`px-3 py-2 text-right font-semibold ${item.maxMs > 1000 ? 'text-orange-700' : 'text-gray-700'}`}>{item.maxMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            </>
            )}

            {activeTab === 'devices' && (
            <section className="mb-8">
              <SectionTitle>Dispositivi locali</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
                <MetricTile
                  icon={CheckCircle2}
                  label="Build webapp attesa"
                  value={deviceStats.expectedVersion || '-'}
                  detail="La versione che devono usare i dispositivi"
                  level={deviceStats.stale > 0 ? 'warning' : 'ok'}
                  testId="diag-expected-webapp-build"
                />
                <MetricTile
                  icon={Activity}
                  label="Dispositivi online"
                  value={`${frontendSummary.online}/${frontendSummary.devices.length}`}
                  detail={frontendSummary.offline > 0 ? `${frontendSummary.offline} dispositivi non rispondono` : 'Tutti i dispositivi stanno inviando heartbeat'}
                  level={frontendSummary.offline > 0 ? 'warning' : 'ok'}
                  testId="diag-devices-online"
                />
                <MetricTile
                  icon={AlertTriangle}
                  label="Build vecchie"
                  value={deviceStats.stale}
                  detail={deviceStats.stale > 0 ? 'Almeno un dispositivo non ha ancora aggiornato' : 'Versione uniforme'}
                  level={deviceStats.stale > 0 ? 'warning' : 'ok'}
                  testId="diag-stale-builds"
                />
                <MetricTile
                  icon={WifiOff}
                  label="Locali da guardare"
                  value={deviceStats.locationsWithIssues}
                  detail="Offline, build diverse o errori ripetuti"
                  level={deviceStats.locationsWithIssues > 0 ? 'warning' : 'ok'}
                  testId="diag-location-issues"
                />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-bold text-gray-800">
                    Locali monitorati
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeviceLocationFilter('all')}
                    className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 ${deviceLocationFilter === 'all' ? 'bg-gray-100' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900">Tutti i locali</span>
                      <span className="text-xs text-gray-500">{frontendSummary.devices.length} dispositivi</span>
                    </div>
                  </button>
                  {frontendSummary.locations.length === 0 ? (
                    <div className="px-3 py-8 text-sm text-center text-gray-400">Nessun locale con heartbeat</div>
                  ) : frontendSummary.locations.map(loc => {
                    const key = loc.restaurant_id || loc.location;
                    const hasIssue = loc.offline > 0 || loc.errors > 0 || loc.versions?.length > 1;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setDeviceLocationFilter(key)}
                        className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                          deviceLocationFilter === key ? 'bg-gray-100' : hasIssue ? 'bg-amber-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-gray-900 truncate">{loc.location}</span>
                          <HealthPill level={hasIssue ? 'warning' : 'ok'}>{loc.online}/{loc.devices_total}</HealthPill>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-600">
                          <span className={loc.offline > 0 ? 'font-bold text-orange-700' : ''}>offline {loc.offline}</span>
                          <span className={(loc.versions?.length || 0) > 1 ? 'font-bold text-orange-700' : ''}>build {loc.versions?.length || 0}</span>
                          <span className={loc.errors > 0 ? 'font-bold text-orange-700' : ''}>segnali {loc.errors}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">Ultimo: {formatAgo(loc.last_seen)}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="p-3 border-b border-gray-200 bg-gray-50">
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-bold text-gray-900">Dispositivi del locale</div>
                        <div className="text-xs text-gray-500">{filteredDevices.length} risultati filtrati</div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={deviceStatusFilter}
                          onChange={e => setDeviceStatusFilter(e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
                        >
                          <option value="all">Tutti gli stati</option>
                          <option value="online">Solo online</option>
                          <option value="offline">Solo offline</option>
                        </select>
                        <input
                          type="text"
                          value={deviceSearch}
                          onChange={e => setDeviceSearch(e.target.value)}
                          placeholder="Cerca locale, IP, versione, pagina"
                          className="px-3 py-1.5 border border-gray-300 rounded text-sm w-full sm:w-64"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {filteredDevices.length === 0 ? (
                      <div className="px-3 py-8 text-center text-gray-400 text-sm">Nessun dispositivo ristorante per questi filtri</div>
                    ) : filteredDevices.map(device => {
                      const versionDate = formatVersionDate(device.frontend_version);
                      const deviceLevel = getDeviceLevel(device);
                      const isStale = deviceStats.expectedVersion && device.frontend_version && device.frontend_version !== deviceStats.expectedVersion;
                      return (
                        <div
                          key={device.device_id}
                          className={`px-3 py-3 ${deviceLevel === 'warning' ? 'bg-amber-50' : 'bg-white'}`}
                        >
                          <div className="grid grid-cols-1 2xl:grid-cols-[120px_minmax(170px,1fr)_minmax(220px,1.2fr)_minmax(150px,0.8fr)_minmax(210px,1fr)_minmax(210px,1fr)_95px] gap-3 items-center text-sm">
                            <div>
                              <HealthPill level={deviceLevel}>
                                {device.status !== 'online' ? 'offline' : isStale ? 'build vecchia' : 'ok'}
                              </HealthPill>
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-gray-900 truncate">
                                {device.restaurant_location || device.username || device.device_id.slice(0, 10)}
                              </div>
                              <div className="text-[11px] text-gray-400 uppercase">{device.role || '-'}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-800 truncate">{device.browser || 'Browser'} / {device.os || 'OS'}</div>
                              <div className="text-xs text-gray-500 truncate">
                                {device.device_type || '-'} · {device.viewport || device.screen || '-'}
                              </div>
                              <div className="text-xs text-gray-700 font-mono truncate">IP {device.ip || '-'}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-gray-500 uppercase xl:hidden">Pagina</div>
                              <div className="font-mono text-xs text-gray-800 truncate">{device.path || '-'}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-gray-500 uppercase">Versione webapp</div>
                              <div className="font-mono text-sm font-bold text-gray-950 truncate">{formatVersion(device.frontend_version)}</div>
                              {versionDate ? <div className="text-[11px] text-gray-400">build {versionDate}</div> : null}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold text-gray-500 uppercase">Cosa fare</div>
                              <div className={`font-semibold truncate ${deviceLevel === 'warning' ? 'text-orange-800' : 'text-green-700'}`}>
                                {getDeviceAction(device)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] font-semibold text-gray-500 uppercase">Ultimo</div>
                              <div className="text-sm font-semibold text-gray-800">{formatAgo(device.last_seen)}</div>
                              <div className="text-xs text-gray-500">{device.visibility || '-'}</div>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
                            <span className="font-mono truncate">ID {(device.device_id || '').slice(0, 24)}</span>
                            {(device.recent_errors_count || 0) > 0 ? (
                              <span className="text-orange-700 font-semibold">{device.recent_errors_count} segnali browser recenti</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            </section>
            )}

            {activeTab === 'backend' && (
            <>
            <section className="mb-8">
              <SectionTitle>WebSocket per locale</SectionTitle>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Stato</th>
                      <th className="text-left px-3 py-2 font-semibold">Locale</th>
                      <th className="text-center px-3 py-2 font-semibold">Conn.</th>
                      <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Connesso da</th>
                      <th className="text-left px-3 py-2 font-semibold">Ultimo msg</th>
                      <th className="text-center px-3 py-2 font-semibold">Disc. 1h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.websockets || []).map(ws => {
                      const online = ws.active_connections > 0;
                      const stale = !online || (ws.last_seen && secondsAgo(ws.last_seen) > 60);
                      return (
                        <tr key={ws.restaurant_id} data-testid={`ws-${ws.location}`} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            {online && !stale ? (
                              <Wifi size={17} className="text-green-600" aria-label="online" />
                            ) : (
                              <WifiOff size={17} className="text-red-600" aria-label="offline" />
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold text-gray-900">{ws.location || ws.username}</td>
                          <td className="px-3 py-2 text-center">{ws.active_connections}</td>
                          <td className="px-3 py-2 hidden sm:table-cell text-gray-600">
                            {ws.connected_since ? formatTime(ws.connected_since) : '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {ws.last_seen ? formatAgo(ws.last_seen) : '-'}
                          </td>
                          <td className={`px-3 py-2 text-center font-medium ${ws.disconnects_last_hour > 5 ? 'text-red-600' : 'text-gray-700'}`}>
                            {ws.disconnects_last_hour}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {data.recent_errors?.length > 0 && (
              <section className="mb-8">
                <SectionTitle>Errori recenti</SectionTitle>
                <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-red-100 text-red-900">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Orario</th>
                        <th className="text-left px-3 py-2 font-semibold">Locale</th>
                        <th className="text-left px-3 py-2 font-semibold">Metodo</th>
                        <th className="text-left px-3 py-2 font-semibold">Path</th>
                        <th className="text-center px-3 py-2 font-semibold">Status</th>
                        <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Errore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_errors.map((e, i) => (
                        <tr key={i} className="border-t border-red-200">
                          <td className="px-3 py-2 text-red-800">{formatTime(e.ts)}</td>
                          <td className="px-3 py-2 text-red-800 font-semibold whitespace-nowrap">{e.location || '-'}</td>
                          <td className="px-3 py-2 font-mono text-red-800">{e.method}</td>
                          <td className="px-3 py-2 font-mono text-red-800 break-all">{e.path}</td>
                          <td className="px-3 py-2 text-center font-bold text-red-800">{e.status}</td>
                          <td className="px-3 py-2 text-red-700 hidden sm:table-cell truncate max-w-xs">{e.error || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="mb-8">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(v => !v)}
                className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 px-3 py-2 rounded-md text-sm font-semibold"
                data-testid="diag-toggle-technical"
              >
                <Clock size={16} aria-hidden="true" />
                {showTechnicalDetails ? 'Nascondi dettagli tecnici' : 'Mostra dettagli tecnici'}
              </button>
            </section>

            {showTechnicalDetails && (
              <section>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                  <SectionTitle>Ultime chiamate API</SectionTitle>
                  <input
                    type="text"
                    value={filterPath}
                    onChange={e => setFilterPath(e.target.value)}
                    placeholder="Filtra path"
                    data-testid="diag-filter-path"
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm w-full sm:w-64"
                  />
                </div>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Orario</th>
                        <th className="text-left px-3 py-2 font-semibold">Locale</th>
                        <th className="text-left px-3 py-2 font-semibold">Metodo</th>
                        <th className="text-left px-3 py-2 font-semibold">Path</th>
                        <th className="text-center px-3 py-2 font-semibold">Status</th>
                        <th className="text-right px-3 py-2 font-semibold">ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCalls.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Nessuna chiamata</td></tr>
                      ) : filteredCalls.map((c, i) => {
                        const isError = c.status >= 400;
                        const isSlow = c.ms > 500;
                        return (
                          <tr key={i} className={`border-t border-gray-100 ${isError ? 'bg-red-50' : isSlow ? 'bg-yellow-50' : ''}`}>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatTime(c.ts)}</td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{c.location || '-'}</td>
                            <td className="px-3 py-2 font-mono text-gray-700">{c.method}</td>
                            <td className="px-3 py-2 font-mono text-gray-800 break-all">{c.path}</td>
                            <td className={`px-3 py-2 text-center font-bold ${isError ? 'text-red-600' : 'text-green-700'}`}>{c.status}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${isSlow ? 'text-orange-600' : 'text-gray-700'}`}>{c.ms}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 text-xs text-gray-400 text-right">
                  Buffer API: {data.buffer_size} | Slow calls: {data.slow_calls_count}
                </div>
              </section>
            )}
            </>
            )}
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
};

export default DiagnosticaLivePage;
