import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const severityMeta = {
  critical: {
    label: 'Critiche',
    icon: XCircle,
    badge: 'bg-red-100 text-red-800 border-red-200',
    tile: 'border-red-200 bg-red-50',
    iconBg: 'bg-red-100 text-red-700',
  },
  warning: {
    label: 'Attenzioni',
    icon: AlertTriangle,
    badge: 'bg-amber-100 text-amber-900 border-amber-200',
    tile: 'border-amber-200 bg-amber-50',
    iconBg: 'bg-amber-100 text-amber-700',
  },
  info: {
    label: 'Info',
    icon: Database,
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    tile: 'border-blue-200 bg-blue-50',
    iconBg: 'bg-blue-100 text-blue-700',
  },
  ok: {
    label: 'Ok',
    icon: CheckCircle2,
    badge: 'bg-green-100 text-green-800 border-green-200',
    tile: 'border-green-200 bg-green-50',
    iconBg: 'bg-green-100 text-green-700',
  },
};

const formatDate = (date) => {
  if (!date) return '-';
  try {
    return new Date(`${date}T12:00:00`).toLocaleDateString('it-IT', {
      timeZone: 'Europe/Rome',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return date;
  }
};

const formatDateTime = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const SeverityBadge = ({ severity }) => {
  const meta = severityMeta[severity] || severityMeta.info;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${meta.badge}`}>
      <Icon size={14} aria-hidden="true" />
      {meta.label}
    </span>
  );
};

const SummaryTile = ({ icon: Icon, label, value, detail, tone = 'ok', testId }) => {
  const meta = severityMeta[tone] || severityMeta.ok;
  return (
    <div className={`rounded-lg border p-4 min-h-[118px] ${meta.tile}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase text-gray-600">{label}</div>
          <div className="mt-1 text-3xl font-black text-gray-950" data-testid={testId}>{value}</div>
        </div>
        <div className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${meta.iconBg}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
      </div>
      {detail && <div className="mt-3 text-xs leading-snug text-gray-600">{detail}</div>}
    </div>
  );
};

const FilterButton = ({ active, children, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
      active
        ? 'border-gray-900 bg-gray-900 text-white'
        : 'border-gray-300 bg-white text-gray-700 hover:border-[#F5C518]'
    }`}
  >
    {children}
  </button>
);

const DataIntegrityPage = () => {
  const { token, isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [days, setDays] = useState(60);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/data-integrity`, {
        params: { days },
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Errore caricamento controllo integrita');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, token]);

  const issues = useMemo(() => data?.issues || [], [data]);
  const summary = data?.summary || {};

  const areas = useMemo(() => {
    const values = new Set(issues.map(i => i.area).filter(Boolean));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const filteredIssues = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return issues.filter(issue => {
      if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
      if (areaFilter !== 'all' && issue.area !== areaFilter) return false;
      if (!needle) return true;
      const haystack = [
        issue.area,
        issue.title,
        issue.message,
        issue.restaurant_label,
        issue.date,
        issue.expected,
        issue.actual,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [issues, severityFilter, areaFilter, search]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <h1 className="text-2xl font-black text-red-900">Accesso negato</h1>
            <p className="mt-2 text-sm text-red-800">Pagina riservata agli account admin.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-bold uppercase text-gray-600">
              <ShieldCheck size={14} aria-hidden="true" />
              Simone
            </div>
            <h1 className="mt-3 text-3xl md:text-4xl font-black text-gray-950">Controllo integrita dati</h1>
            <p className="mt-1 text-sm text-gray-600">
              Ultimo controllo: {formatDateTime(data?.generated_at)}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-gray-300 bg-white p-1">
              {[30, 60, 90, 180].map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDays(value)}
                  className={`rounded-md px-3 py-2 text-sm font-bold ${
                    days === value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {value}g
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              title="Aggiorna controllo"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-800 hover:border-[#F5C518] disabled:opacity-60"
            >
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              Aggiorna
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile
            icon={summary.ok ? CheckCircle2 : XCircle}
            label="Stato"
            value={summary.ok ? 'OK' : 'Da vedere'}
            detail={`${summary.restaurants || 0} locali controllati dal ${data?.cutoff_date || '-'}`}
            tone={summary.ok ? 'ok' : 'critical'}
            testId="integrity-status"
          />
          <SummaryTile
            icon={XCircle}
            label="Critiche"
            value={summary.critical || 0}
            detail="Rischiano di alterare report, ordini o stock"
            tone="critical"
            testId="integrity-critical"
          />
          <SummaryTile
            icon={AlertTriangle}
            label="Attenzioni"
            value={summary.warning || 0}
            detail="Dati da verificare prima di correggere"
            tone="warning"
            testId="integrity-warning"
          />
          <SummaryTile
            icon={Database}
            label="Totale anomalie"
            value={summary.total_issues || 0}
            detail={`${filteredIssues.length} visibili con i filtri attuali`}
            tone={summary.total_issues ? 'warning' : 'ok'}
            testId="integrity-total"
          />
        </div>

        <section className="rounded-lg border border-gray-300 bg-white">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <FilterButton active={severityFilter === 'all'} onClick={() => setSeverityFilter('all')}>
                Tutte
              </FilterButton>
              <FilterButton active={severityFilter === 'critical'} onClick={() => setSeverityFilter('critical')}>
                Critiche
              </FilterButton>
              <FilterButton active={severityFilter === 'warning'} onClick={() => setSeverityFilter('warning')}>
                Attenzioni
              </FilterButton>
              <FilterButton active={severityFilter === 'info'} onClick={() => setSeverityFilter('info')}>
                Info
              </FilterButton>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
                <Filter size={16} className="text-gray-500" aria-hidden="true" />
                <select
                  value={areaFilter}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-gray-700 outline-none"
                >
                  <option value="all">Tutte le aree</option>
                  {areas.map(area => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </label>
              <label className="inline-flex min-w-[240px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
                <Search size={16} className="text-gray-500" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca"
                  className="w-full bg-transparent text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
                />
              </label>
            </div>
          </div>

          {loading && !data ? (
            <div className="flex items-center justify-center p-12 text-gray-600">
              <RefreshCw size={22} className="mr-2 animate-spin" aria-hidden="true" />
              Caricamento
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 size={36} className="mx-auto text-green-600" aria-hidden="true" />
              <div className="mt-3 text-xl font-black text-gray-950">Nessuna anomalia visibile</div>
              <div className="mt-1 text-sm text-gray-500">Modifica i filtri o aggiorna il controllo.</div>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredIssues.map(issue => (
                <article key={issue.id} className="p-4 md:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={issue.severity} />
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold uppercase text-gray-600">
                          {issue.area || 'Sistema'}
                        </span>
                        {issue.restaurant_label && (
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold uppercase text-gray-600">
                            {issue.restaurant_label}
                          </span>
                        )}
                        {issue.date && (
                          <span className="text-xs font-bold uppercase text-gray-500">{formatDate(issue.date)}</span>
                        )}
                      </div>
                      <h2 className="mt-3 text-lg font-black text-gray-950">{issue.title}</h2>
                      <p className="mt-1 text-sm leading-relaxed text-gray-700">{issue.message}</p>
                    </div>

                    {(issue.expected || issue.actual) && (
                      <div className="grid min-w-[260px] grid-cols-2 gap-2">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="text-[11px] font-bold uppercase text-gray-500">Atteso</div>
                          <div className="mt-1 break-words text-lg font-black text-gray-950">{issue.expected || '-'}</div>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="text-[11px] font-bold uppercase text-gray-500">Salvato</div>
                          <div className="mt-1 break-words text-lg font-black text-gray-950">{issue.actual || '-'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default DataIntegrityPage;
