import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Battery,
  BatteryCharging,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Laptop,
  Monitor,
  Pencil,
  Search,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import {
  compactDiagnosticPath,
  diagnosticDeviceLabel,
  diagnosticDeviceModel,
  getDiagnosticDeviceWarnings,
  groupOnlineDiagnosticDevices,
} from '../../utils/diagnosticsDevices';
import { formatItalianDateTime } from '../../utils/formatDate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const formatAgo = (iso) => {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  return `${Math.floor(minutes / 60)}h fa`;
};

const formatDuration = (seconds) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-';
  if (seconds <= 0) return '0 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const valueOrUnavailable = (value, suffix = '') => (
  value === null || value === undefined || value === '' ? 'Non disponibile' : `${value}${suffix}`
);

const DetailRow = ({ label, children, mono = false }) => (
  <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
    <div className="text-gray-500">{label}</div>
    <div className={`text-gray-950 break-words ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{children}</div>
  </div>
);

const WarningLabels = ({ warnings }) => (
  warnings.length > 0 ? (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map(warning => (
        <span key={warning.key} className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">
          <AlertTriangle size={13} aria-hidden="true" />
          {warning.label}
        </span>
      ))}
    </div>
  ) : null
);

const DeviceIcon = ({ device, size = 18 }) => {
  const type = String(device?.device_type || '').toLowerCase();
  if (type.includes('mobile') || type.includes('tablet')) return <Smartphone size={size} />;
  if (type.includes('desktop')) return <Monitor size={size} />;
  return <Laptop size={size} />;
};

const DiagnosticsDevicesView = ({
  devices = [],
  recentErrors = [],
  expectedVersion = '',
  token,
  canEdit = false,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [expandedLocation, setExpandedLocation] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const onlineDevices = useMemo(
    () => devices.filter(device => device.status === 'online'),
    [devices],
  );
  const locations = useMemo(
    () => groupOnlineDiagnosticDevices(onlineDevices, expectedVersion, search, onlyIssues),
    [onlineDevices, expectedVersion, search, onlyIssues],
  );
  const selectedDevice = onlineDevices.find(device => device.device_id === selectedDeviceId) || null;
  const selectedWarnings = selectedDevice
    ? getDiagnosticDeviceWarnings(selectedDevice, expectedVersion)
    : [];
  const selectedErrors = useMemo(() => (
    selectedDeviceId
      ? recentErrors.filter(error => (error.device_id || error.client_id) === selectedDeviceId)
      : []
  ), [recentErrors, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    if (!onlineDevices.some(device => device.device_id === selectedDeviceId)) {
      setSelectedDeviceId('');
    }
  }, [onlineDevices, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDevice) return;
    setDisplayName(selectedDevice.display_name || '');
    setModelOverride(selectedDevice.model_override || '');
    setEditing(false);
    setSaveError('');
  }, [selectedDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedDeviceId) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') setSelectedDeviceId('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDeviceId]);

  const saveRegistry = async () => {
    if (!selectedDevice || !canEdit || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await axios.put(
        `${API}/admin/diagnostics/devices/${encodeURIComponent(selectedDevice.device_id)}`,
        { display_name: displayName, model_override: modelOverride },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await onRefresh?.();
      setEditing(false);
    } catch (error) {
      setSaveError(error?.response?.data?.detail || 'Salvataggio non riuscito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="diagnostics-devices-view">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-950">Locali online</h2>
          <div className="text-sm text-gray-500 mt-1">
            {locations.length} locali · {onlineDevices.length} dispositivi
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:w-80">
            <span className="sr-only">Cerca dispositivo</span>
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cerca locale o dispositivo"
              className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 text-sm focus:border-gray-900 focus:outline-none"
            />
          </label>
          <label className="h-10 inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={event => setOnlyIssues(event.target.checked)}
              className="h-4 w-4"
            />
            Solo problemi
          </label>
        </div>
      </div>

      <div className="border-y border-gray-300 bg-white">
        {locations.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-500">
            {onlineDevices.length === 0 ? 'Nessun dispositivo online' : 'Nessun risultato per questi filtri'}
          </div>
        ) : locations.map(location => {
          const expanded = expandedLocation === location.key;
          return (
            <div key={location.key} className="border-b border-gray-200 last:border-b-0">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedLocation(expanded ? '' : location.key)}
                className="w-full min-h-16 px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
              >
                {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-gray-950 truncate">{location.location}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {location.devices.length} {location.devices.length === 1 ? 'dispositivo' : 'dispositivi'} · ultimo segnale {formatAgo(location.lastSeen)}
                  </div>
                </div>
                {location.warningCount > 0 ? (
                  <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-950">
                    {location.warningCount} {location.warningCount === 1 ? 'avviso' : 'avvisi'}
                  </span>
                ) : null}
              </button>

              {expanded ? (
                <div className="border-t border-gray-200 bg-gray-50" data-testid={`location-${location.key}`}>
                  {location.devices.map(device => {
                    const warnings = getDiagnosticDeviceWarnings(device, expectedVersion);
                    const model = diagnosticDeviceModel(device);
                    return (
                      <button
                        type="button"
                        key={device.device_id}
                        onClick={() => setSelectedDeviceId(device.device_id)}
                        className="w-full px-4 py-3 sm:pl-12 grid grid-cols-1 gap-2 border-b border-gray-200 last:border-b-0 text-left hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900 lg:grid-cols-[minmax(210px,1.2fr)_minmax(150px,0.8fr)_120px_minmax(180px,1fr)] lg:items-center"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-md bg-gray-200 text-gray-800 flex items-center justify-center shrink-0">
                            <DeviceIcon device={device} />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-bold text-gray-950 truncate">{diagnosticDeviceLabel(device)}</span>
                            <span className="block text-xs text-gray-500 truncate">{model || 'Modello non rilevato'}</span>
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs uppercase font-semibold text-gray-500">Pagina</div>
                          <div className="text-sm font-medium text-gray-900 truncate">{compactDiagnosticPath(device.path)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase font-semibold text-gray-500">Segnale</div>
                          <div className="text-sm font-medium text-gray-900">{formatAgo(device.last_seen)}</div>
                        </div>
                        <WarningLabels warnings={warnings} />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {selectedDevice ? (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Dettagli dispositivo">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            onClick={() => setSelectedDeviceId('')}
            aria-label="Chiudi dettagli dispositivo"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[560px] bg-white shadow-2xl flex flex-col">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200 flex items-start gap-3">
              <span className="w-10 h-10 rounded-md bg-gray-900 text-white flex items-center justify-center shrink-0">
                <DeviceIcon device={selectedDevice} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-lg text-gray-950 truncate">{diagnosticDeviceLabel(selectedDevice)}</div>
                <div className="text-sm text-gray-500 truncate">{selectedDevice.restaurant_location || selectedDevice.username || '-'}</div>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(value => !value)}
                  className="w-10 h-10 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                  title="Modifica nome dispositivo"
                  aria-label="Modifica nome dispositivo"
                >
                  <Pencil size={17} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedDeviceId('')}
                className="w-10 h-10 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                title="Chiudi"
                aria-label="Chiudi"
              >
                <X size={19} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
              <WarningLabels warnings={selectedWarnings} />

              {editing ? (
                <div className="mt-5 border-y border-gray-200 py-4">
                  <div className="font-bold text-gray-950 mb-3">Identificazione manuale</div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Nome dispositivo
                    <input
                      value={displayName}
                      onChange={event => setDisplayName(event.target.value)}
                      maxLength={80}
                      className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 font-normal focus:border-gray-900 focus:outline-none"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    Modello
                    <input
                      value={modelOverride}
                      onChange={event => setModelOverride(event.target.value)}
                      maxLength={120}
                      className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 font-normal focus:border-gray-900 focus:outline-none"
                    />
                  </label>
                  {saveError ? <div className="text-sm text-red-700 mt-2">{saveError}</div> : null}
                  <div className="flex justify-end gap-2 mt-4">
                    <button type="button" onClick={() => setEditing(false)} className="h-10 px-4 rounded-md border border-gray-300 font-semibold text-sm">
                      Annulla
                    </button>
                    <button type="button" onClick={saveRegistry} disabled={saving} className="h-10 px-4 rounded-md bg-gray-950 text-white font-semibold text-sm disabled:opacity-50">
                      {saving ? 'Salvataggio...' : 'Salva'}
                    </button>
                  </div>
                </div>
              ) : null}

              <section className="mt-6">
                <h3 className="flex items-center gap-2 font-bold text-gray-950 mb-2"><CircleGauge size={18} /> Attività</h3>
                <DetailRow label="Pagina">{selectedDevice.path || '-'}</DetailRow>
                <DetailRow label="Ultimo segnale">{formatItalianDateTime(selectedDevice.last_seen)}</DetailRow>
                <DetailRow label="Primo segnale">{formatItalianDateTime(selectedDevice.first_seen)}</DetailRow>
                <DetailRow label="Scheda">{selectedDevice.visibility || '-'}</DetailRow>
                <DetailRow label="Latenza app">{valueOrUnavailable(selectedDevice.heartbeat_rtt_ms, ' ms')}</DetailRow>
                <DetailRow label="Fallimenti">{selectedDevice.heartbeat_failures || 0}</DetailRow>
                {selectedDevice.last_heartbeat_failure_at ? (
                  <DetailRow label="Ultimo fallimento">{formatItalianDateTime(selectedDevice.last_heartbeat_failure_at)}</DetailRow>
                ) : null}
              </section>

              <section className="mt-6">
                <h3 className="flex items-center gap-2 font-bold text-gray-950 mb-2"><Monitor size={18} /> Dispositivo</h3>
                <DetailRow label="Nome">{selectedDevice.display_name || 'Non assegnato'}</DetailRow>
                <DetailRow label="Modello">{diagnosticDeviceModel(selectedDevice) || 'Non disponibile'}</DetailRow>
                {selectedDevice.model_override && selectedDevice.device_model ? (
                  <DetailRow label="Rilevato">{selectedDevice.device_model}</DetailRow>
                ) : null}
                <DetailRow label="Tipo">{selectedDevice.device_type || 'Non disponibile'}</DetailRow>
                <DetailRow label="Schermo">{selectedDevice.screen || 'Non disponibile'}</DetailRow>
                <DetailRow label="Viewport">{selectedDevice.viewport || 'Non disponibile'}</DetailRow>
                <DetailRow label="Sistema">{[selectedDevice.os, selectedDevice.platform_version].filter(Boolean).join(' ') || 'Non disponibile'}</DetailRow>
                <DetailRow label="Architettura">{[selectedDevice.architecture, selectedDevice.bitness ? `${selectedDevice.bitness} bit` : ''].filter(Boolean).join(' · ') || 'Non disponibile'}</DetailRow>
                <DetailRow label="Browser">
                  {[selectedDevice.browser, selectedDevice.browser_full_version]
                    .filter(Boolean)
                    .filter((value, index, values) => values.indexOf(value) === index)
                    .join(' ') || 'Non disponibile'}
                </DetailRow>
                <DetailRow label="Build">{selectedDevice.frontend_version || 'Non disponibile'}</DetailRow>
                <DetailRow label="Lingua">{selectedDevice.language || 'Non disponibile'}</DetailRow>
                <DetailRow label="Fuso orario">{selectedDevice.timezone || 'Non disponibile'}</DetailRow>
                <DetailRow label="ID" mono>{selectedDevice.device_id}</DetailRow>
                <DetailRow label="User agent" mono>{selectedDevice.user_agent || 'Non disponibile'}</DetailRow>
              </section>

              <section className="mt-6">
                <h3 className="flex items-center gap-2 font-bold text-gray-950 mb-2"><Wifi size={18} /> Connessione</h3>
                <DetailRow label="Stato">{selectedDevice.online === false ? 'Browser offline' : 'Browser online'}</DetailRow>
                <DetailRow label="Tipo">{selectedDevice.connection_type || 'Non disponibile'}</DetailRow>
                <DetailRow label="Profilo">{selectedDevice.connection_effective_type || 'Non disponibile'}</DetailRow>
                <DetailRow label="Velocità stimata">{valueOrUnavailable(selectedDevice.connection_downlink_mbps, ' Mbps')}</DetailRow>
                <DetailRow label="RTT browser">{valueOrUnavailable(selectedDevice.connection_rtt_ms, ' ms')}</DetailRow>
                <DetailRow label="Risparmio dati">{selectedDevice.connection_save_data === null || selectedDevice.connection_save_data === undefined ? 'Non disponibile' : selectedDevice.connection_save_data ? 'Attivo' : 'Disattivo'}</DetailRow>
                <DetailRow label="IP" mono>{selectedDevice.ip || 'Non disponibile'}</DetailRow>
              </section>

              <section className="mt-6">
                <h3 className="flex items-center gap-2 font-bold text-gray-950 mb-2">
                  {selectedDevice.battery_charging ? <BatteryCharging size={18} /> : <Battery size={18} />} Batteria
                </h3>
                <DetailRow label="Livello">{valueOrUnavailable(selectedDevice.battery_level, '%')}</DetailRow>
                <DetailRow label="In carica">{selectedDevice.battery_charging === null || selectedDevice.battery_charging === undefined ? 'Non disponibile' : selectedDevice.battery_charging ? 'Sì' : 'No'}</DetailRow>
                <DetailRow label="Tempo alla carica">{formatDuration(selectedDevice.battery_charging_time)}</DetailRow>
                <DetailRow label="Autonomia stimata">{formatDuration(selectedDevice.battery_discharging_time)}</DetailRow>
              </section>

              <section className="mt-6">
                <h3 className="font-bold text-gray-950 mb-2">Errori browser recenti</h3>
                {selectedErrors.length === 0 ? (
                  <div className="text-sm text-gray-500 py-2">Nessun errore registrato.</div>
                ) : selectedErrors.map((error, index) => (
                  <div key={`${error.ts || 'error'}-${index}`} className="border-t border-gray-200 py-3 first:border-t-0">
                    <div className="text-xs text-gray-500">{formatItalianDateTime(error.ts)} · {error.kind || 'errore'}</div>
                    <div className="text-sm font-semibold text-red-800 mt-1 break-words">{error.message || '-'}</div>
                    {error.url ? <div className="text-xs font-mono text-gray-600 mt-1 break-all">{error.method || ''} {error.url}</div> : null}
                    {error.stack ? <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-gray-600">{error.stack}</pre> : null}
                  </div>
                ))}
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
};

export default DiagnosticsDevicesView;
