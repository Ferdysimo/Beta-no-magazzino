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
  Monitor,
  RefreshCw,
  Server,
  Smartphone,
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

const riskRank = { critical: 3, warning: 2, ok: 1, neutral: 0 };

const compactPath = (path) => {
  if (!path) return '-';
  const clean = String(path).split('?')[0] || '/';
  if (clean === '/') return 'Home';
  const last = clean.split('/').filter(Boolean).pop();
  return last ? last.replace(/-/g, ' ') : clean;
};

const DiagnosticaLivePage = () => {
  const { token, canImpersonate } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterPath, setFilterPath] = useState('');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [deviceLocationFilter, setDeviceLocationFilter] = useState('all');
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
    const onlineDevices = devices.filter(device => device.status === 'online');
    const versions = data?.deployment?.frontend_versions || [];
    const locations = data?.frontend?.locations || [];
    const sortedVersions = versions.slice().sort((a, b) => Number(a) - Number(b));
    const latestVersion = sortedVersions[sortedVersions.length - 1] || '';
    return {
      devices,
      onlineDevices,
      locations,
      online: onlineDevices.length,
      versions,
      latestVersion,
      visible: onlineDevices.filter(d => d.visibility === 'visible').length,
    };
  }, [data]);

  const filteredDevices = useMemo(() => {
    const search = deviceSearch.trim().toLowerCase();
    return frontendSummary.onlineDevices.filter(device => {
      const locationKey = device.restaurant_id || device.restaurant_location || 'unknown';
      if (deviceLocationFilter !== 'all' && locationKey !== deviceLocationFilter) return false;
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
  }, [frontendSummary.onlineDevices, deviceLocationFilter, deviceSearch]);

  const deviceStats = useMemo(() => {
    const expectedVersion = frontendSummary.latestVersion;
    const stale = frontendSummary.onlineDevices.filter(device => (
      expectedVersion && device.frontend_version && device.frontend_version !== expectedVersion
    )).length;
    const withErrors = frontendSummary.onlineDevices.filter(device => (device.recent_errors_count || 0) > 0).length;
    return {
      expectedVersion,
      stale,
      withErrors,
    };
  }, [frontendSummary]);

  const getDeviceIssue = (device) => {
    const isStale = deviceStats.expectedVersion && device.frontend_version && device.frontend_version !== deviceStats.expectedVersion;
    if (isStale) {
      return {
        level: 'warning',
        label: 'Build vecchia',
        action: 'Aggiorna o riapri il browser.',
      };
    }
    if ((device.recent_errors_count || 0) > 0) {
      return {
        level: 'warning',
        label: 'Errori browser',
        action: 'Aggiorna la pagina.',
      };
    }
    return {
      level: 'ok',
      label: 'Online',
      action: 'Nessun intervento.',
    };
  };

  const locationOperations = useMemo(() => {
    const expectedVersion = deviceStats.expectedVersion;
    const byLocation = new Map();
    frontendSummary.locations.forEach(loc => {
      const key = loc.restaurant_id || loc.location || 'unknown';
      byLocation.set(key, { ...loc, key, devices: [] });
    });
    frontendSummary.onlineDevices.forEach(device => {
      const key = device.restaurant_id || device.restaurant_location || 'unknown';
      const current = byLocation.get(key) || {
        key,
        location: device.restaurant_location || device.username || key,
        role: 'restaurant',
        devices: [],
      };
      current.devices = [...(current.devices || []), device];
      if (!current.location) {
        current.location = device.restaurant_location || device.username || key;
      }
      byLocation.set(key, current);
    });

    return Array.from(byLocation.values()).map(loc => {
      const devices = loc.devices || [];
      const stale = devices.filter(device => (
        expectedVersion && device.frontend_version && device.frontend_version !== expectedVersion
      )).length;
      const errors = devices.reduce((sum, device) => sum + (device.recent_errors_count || 0), 0);
      const online = devices.length;
      const pages = Array.from(new Set(devices.map(device => compactPath(device.path)).filter(Boolean)));
      const versions = Array.from(new Set(devices.map(device => device.frontend_version).filter(Boolean)));
      const lastSeen = devices
        .map(device => device.last_seen || '')
        .filter(Boolean)
        .sort()
        .pop() || '';
      let level = 'ok';
      let action = 'Online';
      if (stale > 0) {
        level = 'warning';
        action = 'Build da aggiornare';
      } else if (errors > 0) {
        level = 'warning';
        action = 'Errori browser recenti';
      }
      return {
        ...loc,
        key: loc.key,
        devices,
        stale,
        online,
        total: online,
        errors,
        lastSeen,
        pages,
        versions,
        level,
        action,
      };
    }).filter(loc => loc.online > 0).sort((a, b) => (
      (riskRank[b.level] - riskRank[a.level])
      || (b.stale - a.stale)
      || (b.errors - a.errors)
      || String(a.location).localeCompare(String(b.location), 'it')
    ));
  }, [frontendSummary, deviceStats.expectedVersion]);

  const onlineLocationIssueCount = useMemo(() => (
    locationOperations.filter(loc => loc.level !== 'ok').length
  ), [locationOperations]);

  useEffect(() => {
    if (deviceLocationFilter !== 'all' && !locationOperations.some(loc => loc.key === deviceLocationFilter)) {
      setDeviceLocationFilter('all');
    }
  }, [locationOperations, deviceLocationFilter]);

  const selectedLocation = useMemo(() => {
    if (deviceLocationFilter === 'all') return null;
    return locationOperations.find(loc => loc.key === deviceLocationFilter) || null;
  }, [locationOperations, deviceLocationFilter]);

  if (!canImpersonate) {
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
      <main className="max-w-[1920px] mx-auto px-3 py-4 sm:px-5 sm:py-6 lg:px-6 xl:px-8 2xl:px-10">
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
            <div className={`grid grid-cols-1 gap-4 items-start ${activeTab === 'backend' ? 'xl:grid-cols-[280px_1fr]' : ''}`}>
              <aside className={activeTab === 'devices' ? 'hidden' : 'xl:sticky xl:top-4'}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
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
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between mb-4">
                <div>
                  <SectionTitle>Dispositivi locali online</SectionTitle>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={deviceLocationFilter}
                    onChange={e => setDeviceLocationFilter(e.target.value)}
                    className="h-10 px-3 border border-gray-300 rounded-md text-sm bg-white"
                    data-testid="diag-device-location-filter"
                  >
                    <option value="all">Tutti i locali online</option>
                    {locationOperations.map(loc => (
                      <option key={loc.key} value={loc.key}>{loc.location}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={deviceSearch}
                    onChange={e => setDeviceSearch(e.target.value)}
                    placeholder="Cerca"
                    className="h-10 px-3 border border-gray-300 rounded-md text-sm w-full sm:w-80 xl:w-96"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
                <MetricTile
                  icon={CheckCircle2}
                  label="Locali online"
                  value={locationOperations.length}
                  detail={`${frontendSummary.online} dispositivi attivi`}
                  level={onlineLocationIssueCount > 0 ? 'warning' : 'ok'}
                  testId="diag-location-issues"
                />
                <MetricTile
                  icon={Activity}
                  label="Dispositivi online"
                  value={frontendSummary.online}
                  detail={`${frontendSummary.visible} schede visibili`}
                  level="ok"
                  testId="diag-devices-online"
                />
                <MetricTile
                  icon={AlertTriangle}
                  label="Build vecchie"
                  value={deviceStats.stale}
                  detail={deviceStats.stale > 0 ? `Attesa ${formatVersion(deviceStats.expectedVersion)}` : 'Versione uniforme'}
                  level={deviceStats.stale > 0 ? 'warning' : 'ok'}
                  testId="diag-stale-builds"
                />
                <MetricTile
                  icon={AlertCircle}
                  label="Errori browser"
                  value={deviceStats.withErrors}
                  detail={deviceStats.withErrors > 0 ? 'Dispositivi con segnali recenti' : 'Nessun errore browser recente'}
                  level={deviceStats.withErrors > 0 ? 'warning' : 'ok'}
                  testId="diag-device-errors"
                />
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-5">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-900 uppercase">Locali online</div>
                    <div className="text-xs text-gray-500">
                      {selectedLocation ? selectedLocation.location : 'Tutti i locali online'}
                    </div>
                  </div>
                  <HealthPill level={onlineLocationIssueCount > 0 ? 'warning' : 'ok'}>
                    {onlineLocationIssueCount > 0 ? `${onlineLocationIssueCount} da controllare` : 'ok'}
                  </HealthPill>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1040px] text-sm">
                    <thead className="bg-white text-gray-600 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold uppercase text-[11px]">Locale</th>
                        <th className="text-center px-4 py-3 font-semibold uppercase text-[11px]">Online</th>
                        <th className="text-left px-4 py-3 font-semibold uppercase text-[11px]">Pagine aperte</th>
                        <th className="text-left px-4 py-3 font-semibold uppercase text-[11px]">Build</th>
                        <th className="text-center px-4 py-3 font-semibold uppercase text-[11px]">Alert</th>
                        <th className="text-left px-4 py-3 font-semibold uppercase text-[11px]">Ultimo segnale</th>
                        <th className="text-left px-4 py-3 font-semibold uppercase text-[11px]">Stato</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {locationOperations.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                            Nessun dispositivo online
                          </td>
                        </tr>
                      ) : locationOperations.map(loc => {
                        const selected = deviceLocationFilter === loc.key;
                        return (
                          <tr
                            key={loc.key}
                            className={`${selected ? 'bg-gray-900 text-white' : loc.level === 'warning' ? 'bg-amber-50' : 'bg-white'} cursor-pointer`}
                            onClick={() => setDeviceLocationFilter(loc.key)}
                          >
                            <td className="px-4 py-3 align-top">
                              <div className={`font-bold truncate ${selected ? 'text-white' : 'text-gray-950'}`}>{loc.location}</div>
                              <div className={`text-xs mt-1 ${selected ? 'text-gray-300' : 'text-gray-500'}`}>{loc.role || 'restaurant'}</div>
                            </td>
                            <td className="px-4 py-3 text-center align-top font-bold">{loc.online}</td>
                            <td className="px-4 py-3 align-top">
                              <div className={`font-mono text-xs leading-relaxed ${selected ? 'text-gray-100' : 'text-gray-800'}`}>
                                {loc.pages.slice(0, 4).join(', ') || '-'}
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className={`font-mono text-xs leading-relaxed ${selected ? 'text-gray-100' : 'text-gray-800'}`}>
                                {loc.versions.slice(0, 3).map(formatVersion).join(', ') || '-'}
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-center align-top font-bold ${loc.stale + loc.errors > 0 && !selected ? 'text-amber-800' : ''}`}>
                              {loc.stale + loc.errors}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-semibold">{formatAgo(loc.lastSeen)}</div>
                              <div className={`text-xs mt-1 ${selected ? 'text-gray-300' : 'text-gray-500'}`}>{loc.lastSeen ? formatTime(loc.lastSeen) : '-'}</div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className={`font-semibold ${selected ? 'text-white' : loc.level === 'warning' ? 'text-amber-900' : 'text-green-700'}`}>{loc.action}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-900 uppercase">Dispositivi online</div>
                    <div className="text-xs text-gray-500">
                      {filteredDevices.length} visibili su {frontendSummary.online}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    Locale: <span className="font-semibold text-gray-800">
                      {deviceLocationFilter === 'all'
                        ? 'tutti online'
                        : (selectedLocation?.location || deviceLocationFilter)}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {filteredDevices.length === 0 ? (
                    <div className="px-4 py-10 text-center text-gray-400">
                      Nessun dispositivo online per questi filtri
                    </div>
                  ) : filteredDevices.map(device => {
                    const versionDate = formatVersionDate(device.frontend_version);
                    const issue = getDeviceIssue(device);
                    const isStale = deviceStats.expectedVersion && device.frontend_version && device.frontend_version !== deviceStats.expectedVersion;
                    const DeviceIcon = (device.device_type || '').toLowerCase().includes('mobile') ? Smartphone : Monitor;
                    return (
                      <div key={device.device_id} className={`px-4 py-3 ${issue.level === 'warning' ? 'bg-amber-50' : 'bg-white'}`}>
                        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_240px_220px] gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${issue.level === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}>
                              <DeviceIcon size={18} />
                            </div>
                            <div className="min-w-0">
                              <HealthPill level={issue.level}>{issue.label}</HealthPill>
                              <div className="text-xs text-gray-500 mt-2">{formatAgo(device.last_seen)} · {device.last_seen ? formatTime(device.last_seen) : '-'}</div>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-gray-950 truncate">{device.restaurant_location || device.username || device.device_id.slice(0, 10)}</div>
                            <div className="text-sm text-gray-700 truncate mt-1">{device.browser || 'Browser'} / {device.os || 'OS'} · {device.viewport || device.screen || '-'}</div>
                            <div className="text-xs text-gray-500 font-mono truncate mt-1">IP {device.ip || '-'} · ID {(device.device_id || '').slice(0, 18)}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-500 uppercase">Pagina</div>
                            <div className="font-mono text-sm text-gray-900 truncate">{compactPath(device.path)}</div>
                            <div className="text-xs text-gray-500 truncate mt-1">{device.visibility || '-'}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-500 uppercase">Build</div>
                            <div className="font-mono text-sm font-bold text-gray-950 truncate">{formatVersion(device.frontend_version)}</div>
                            {versionDate ? <div className="text-xs text-gray-500 mt-1">build {versionDate}</div> : null}
                            {isStale ? <div className="text-xs text-amber-800 font-semibold mt-1">attesa {formatVersion(deviceStats.expectedVersion)}</div> : null}
                            <div className={`text-sm font-semibold mt-2 ${issue.level === 'warning' ? 'text-amber-900' : 'text-green-700'}`}>{issue.action}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
