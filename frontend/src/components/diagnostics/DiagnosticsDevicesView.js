import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Battery,
  BatteryCharging,
  CircleGauge,
  ExternalLink,
  Laptop,
  Monitor,
  Pencil,
  Radio,
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
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'Non disponibile';
  if (seconds <= 0) return '0 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const formatSystem = device => (
  [device?.os, device?.platform_version].filter(Boolean).join(' ') || 'Sistema non rilevato'
);

const formatBrowser = device => {
  const values = [device?.browser, device?.browser_full_version]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  return values.join(' ') || 'Browser non rilevato';
};

const formatNetwork = device => {
  const type = device?.connection_effective_type || device?.connection_type;
  const speed = typeof device?.connection_downlink_mbps === 'number'
    ? `${device.connection_downlink_mbps} Mbps`
    : '';
  return [type, speed].filter(Boolean).join(' · ') || 'Rete non rilevata';
};

const formatBattery = device => {
  if (typeof device?.battery_level !== 'number') return 'Batteria non rilevata';
  return `${device.battery_level}%${device.battery_charging ? ' · in carica' : ''}`;
};

const valueOrUnavailable = (value, suffix = '') => (
  value === null || value === undefined || value === '' ? 'Non disponibile' : `${value}${suffix}`
);

const DeviceIcon = ({ device, size = 18 }) => {
  const type = String(device?.device_type || '').toLowerCase();
  if (type.includes('mobile') || type.includes('tablet')) return <Smartphone size={size} />;
  if (type.includes('desktop')) return <Monitor size={size} />;
  return <Laptop size={size} />;
};

const Fact = ({ label, value, mono = false }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    <div className={`mt-0.5 truncate text-xs font-semibold text-slate-700 ${mono ? 'font-mono' : ''}`} title={String(value)}>
      {value}
    </div>
  </div>
);

const DetailRow = ({ label, children, mono = false }) => (
  <div className="grid grid-cols-[145px_minmax(0,1fr)] gap-4 border-b border-slate-100 py-2.5 text-sm last:border-0">
    <div className="text-slate-500">{label}</div>
    <div className={`break-words font-medium text-slate-950 ${mono ? 'font-mono text-xs' : ''}`}>{children}</div>
  </div>
);

const IssueLabels = ({ warnings, compact = false }) => {
  if (!warnings.length) return compact ? <span className="text-xs text-slate-400">Nessun problema rilevato</span> : null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map(warning => (
        <span
          key={warning.key}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold ${
            warning.level === 'critical'
              ? 'bg-rose-100 text-rose-900'
              : 'bg-amber-100 text-amber-950'
          }`}
        >
          <AlertTriangle size={12} aria-hidden="true" />
          {warning.label}
        </span>
      ))}
    </div>
  );
};

const DiagnosticsDevicesView = ({
  devices = [],
  recentErrors = [],
  operations = [],
  websockets = [],
  expectedVersion = '',
  token,
  canEdit = false,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
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
  const operationsByLocation = useMemo(
    () => new Map(operations.map(item => [item.restaurant_id, item])),
    [operations],
  );
  const socketsByLocation = useMemo(
    () => new Map(websockets.map(item => [item.restaurant_id, item])),
    [websockets],
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
    if (selectedDeviceId && !onlineDevices.some(device => device.device_id === selectedDeviceId)) {
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
    const closeOnEscape = event => {
      if (event.key === 'Escape') setSelectedDeviceId('');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
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
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">Mappa operativa</h2>
          <p className="mt-1 text-sm text-slate-500">
            Ogni scheda è un locale; i dispositivi con problemi vengono mostrati per primi.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:w-80">
            <span className="sr-only">Cerca locale o dispositivo</span>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cerca locale, dispositivo, IP..."
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none"
            />
          </label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={event => setOnlyIssues(event.target.checked)}
              className="h-4 w-4"
            />
            Solo da verificare
          </label>
        </div>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-500">
          {onlineDevices.length === 0 ? 'Nessun dispositivo online' : 'Nessun risultato per questi filtri'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {locations.map(location => {
            const operation = operationsByLocation.get(location.key) || {};
            const socket = socketsByLocation.get(location.key) || {};
            return (
              <article
                key={location.key}
                data-testid={`location-${location.key}`}
                className={`overflow-hidden rounded-lg border bg-white ${
                  location.criticalCount > 0 ? 'border-rose-300' : location.warningCount > 0 ? 'border-amber-300' : 'border-slate-200'
                }`}
              >
                <header className="flex min-h-[74px] items-center gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-black text-slate-950">{location.location}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{location.devices.length} {location.devices.length === 1 ? 'dispositivo' : 'dispositivi'}</span>
                      <span>{operation.orders_today ?? 0} ordini oggi</span>
                      <span>{socket.active_connections ?? 0} connessioni live</span>
                    </div>
                  </div>
                  {location.devicesWithIssues > 0 ? (
                    <div className={`rounded-md px-2.5 py-1.5 text-right ${location.criticalCount > 0 ? 'bg-rose-100 text-rose-950' : 'bg-amber-100 text-amber-950'}`}>
                      <div className="text-sm font-black">{location.devicesWithIssues}</div>
                      <div className="text-[10px] font-bold uppercase">da verificare</div>
                    </div>
                  ) : (
                    <div className="text-right text-xs text-slate-400">
                      ultimo segnale<br /><span className="font-semibold text-slate-600">{formatAgo(location.lastSeen)}</span>
                    </div>
                  )}
                </header>

                <div className="divide-y divide-slate-100">
                  {location.devices.map(device => {
                    const warnings = getDiagnosticDeviceWarnings(device, expectedVersion);
                    return (
                      <button
                        type="button"
                        key={device.device_id}
                        data-testid={`diagnostic-device-${device.device_id}`}
                        onClick={() => setSelectedDeviceId(device.device_id)}
                        className="block w-full px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-700">
                            <DeviceIcon device={device} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-950">{diagnosticDeviceLabel(device)}</div>
                                <div className="truncate text-xs text-slate-500">{diagnosticDeviceModel(device) || device.device_type || 'Modello non rilevato'}</div>
                              </div>
                              <div className="shrink-0 text-right text-xs text-slate-400">
                                <div>{formatAgo(device.last_seen)}</div>
                                <div className="mt-0.5 font-semibold text-slate-700">{valueOrUnavailable(device.heartbeat_rtt_ms, ' ms')}</div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                              <Fact label="Pagina" value={compactDiagnosticPath(device.path)} />
                              <Fact label="Sistema" value={formatSystem(device)} />
                              <Fact label="Connessione" value={formatNetwork(device)} />
                              <Fact label="Batteria" value={formatBattery(device)} />
                            </div>
                            <div className="mt-3"><IssueLabels warnings={warnings} compact /></div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedDevice ? (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Dettagli dispositivo">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setSelectedDeviceId('')}
            aria-label="Chiudi dettagli dispositivo"
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col bg-white shadow-2xl">
            <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 sm:px-7">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
                <DeviceIcon device={selectedDevice} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-black text-slate-950">{diagnosticDeviceLabel(selectedDevice)}</div>
                <div className="truncate text-sm text-slate-500">{selectedDevice.restaurant_location || selectedDevice.username || '-'}</div>
              </div>
              {canEdit ? (
                <button type="button" onClick={() => setEditing(value => !value)} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50" aria-label="Modifica nome dispositivo">
                  <Pencil size={17} />
                </button>
              ) : null}
              <button type="button" onClick={() => setSelectedDeviceId('')} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50" aria-label="Chiudi">
                <X size={19} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
              <section aria-label="Azioni suggerite" className={`rounded-lg border p-4 ${selectedWarnings.length ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                <h3 className="font-black text-slate-950">Cosa controllare</h3>
                {selectedWarnings.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">Nessun intervento suggerito dai dati raccolti.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {selectedWarnings.map(warning => (
                      <div key={warning.key} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2">
                        <AlertTriangle size={16} className={warning.level === 'critical' ? 'text-rose-700' : 'text-amber-700'} />
                        <div>
                          <div className="text-sm font-black text-slate-950">{warning.label}</div>
                          <div className="mt-0.5 text-sm text-slate-600">{warning.detail}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">Azione: {warning.action}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {editing ? (
                <section className="mt-5 rounded-lg border border-slate-200 p-4">
                  <h3 className="mb-3 font-black text-slate-950">Identificazione manuale</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-bold text-slate-700">Nome dispositivo
                      <input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 font-normal focus:border-slate-900 focus:outline-none" />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">Modello
                      <input value={modelOverride} onChange={event => setModelOverride(event.target.value)} maxLength={120} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 font-normal focus:border-slate-900 focus:outline-none" />
                    </label>
                  </div>
                  {saveError ? <div className="mt-2 text-sm text-rose-700">{saveError}</div> : null}
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-bold">Annulla</button>
                    <button type="button" onClick={saveRegistry} disabled={saving} className="h-10 rounded-md bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Salvataggio...' : 'Salva'}</button>
                  </div>
                </section>
              ) : null}

              <div className="mt-6 grid gap-x-8 xl:grid-cols-2">
                <section>
                  <h3 className="mb-2 flex items-center gap-2 font-black text-slate-950"><CircleGauge size={17} /> Attività</h3>
                  <DetailRow label="Pagina">{selectedDevice.path || '-'}</DetailRow>
                  <DetailRow label="Ultimo segnale">{formatItalianDateTime(selectedDevice.last_seen)}</DetailRow>
                  <DetailRow label="Primo segnale">{formatItalianDateTime(selectedDevice.first_seen)}</DetailRow>
                  <DetailRow label="Scheda browser">{selectedDevice.visibility || '-'}</DetailRow>
                  <DetailRow label="Latenza app">{valueOrUnavailable(selectedDevice.heartbeat_rtt_ms, ' ms')}</DetailRow>
                  <DetailRow label="Heartbeat falliti">{selectedDevice.heartbeat_failures || 0}</DetailRow>
                  <DetailRow label="Build app">{selectedDevice.frontend_version || 'Non disponibile'}</DetailRow>
                </section>

                <section className="mt-6 xl:mt-0">
                  <h3 className="mb-2 flex items-center gap-2 font-black text-slate-950"><Monitor size={17} /> Dispositivo</h3>
                  <DetailRow label="Modello">{diagnosticDeviceModel(selectedDevice) || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Tipo">{selectedDevice.device_type || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Sistema">{formatSystem(selectedDevice)}</DetailRow>
                  <DetailRow label="Architettura">{[selectedDevice.architecture, selectedDevice.bitness ? `${selectedDevice.bitness} bit` : ''].filter(Boolean).join(' · ') || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Browser">{formatBrowser(selectedDevice)}</DetailRow>
                  <DetailRow label="Schermo">{selectedDevice.screen || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Viewport">{selectedDevice.viewport || 'Non disponibile'}</DetailRow>
                </section>

                <section className="mt-6">
                  <h3 className="mb-2 flex items-center gap-2 font-black text-slate-950"><Wifi size={17} /> Connessione</h3>
                  <DetailRow label="Browser online">{selectedDevice.online === false ? 'No' : 'Sì'}</DetailRow>
                  <DetailRow label="Tipo">{selectedDevice.connection_type || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Profilo">{selectedDevice.connection_effective_type || 'Non disponibile'}</DetailRow>
                  <DetailRow label="Velocità stimata">{valueOrUnavailable(selectedDevice.connection_downlink_mbps, ' Mbps')}</DetailRow>
                  <DetailRow label="RTT browser">{valueOrUnavailable(selectedDevice.connection_rtt_ms, ' ms')}</DetailRow>
                  <DetailRow label="Risparmio dati">{selectedDevice.connection_save_data === null || selectedDevice.connection_save_data === undefined ? 'Non disponibile' : selectedDevice.connection_save_data ? 'Attivo' : 'Disattivo'}</DetailRow>
                  <DetailRow label="IP" mono>{selectedDevice.ip || 'Non disponibile'}</DetailRow>
                </section>

                <section className="mt-6">
                  <h3 className="mb-2 flex items-center gap-2 font-black text-slate-950">
                    {selectedDevice.battery_charging ? <BatteryCharging size={17} /> : <Battery size={17} />} Batteria
                  </h3>
                  <DetailRow label="Livello">{valueOrUnavailable(selectedDevice.battery_level, '%')}</DetailRow>
                  <DetailRow label="In carica">{selectedDevice.battery_charging === null || selectedDevice.battery_charging === undefined ? 'Non disponibile' : selectedDevice.battery_charging ? 'Sì' : 'No'}</DetailRow>
                  <DetailRow label="Tempo alla carica">{formatDuration(selectedDevice.battery_charging_time)}</DetailRow>
                  <DetailRow label="Autonomia stimata">{formatDuration(selectedDevice.battery_discharging_time)}</DetailRow>
                </section>
              </div>

              <section className="mt-6">
                <h3 className="mb-2 flex items-center gap-2 font-black text-slate-950"><Radio size={17} /> Ambiente e identificativi</h3>
                <DetailRow label="Locale">{selectedDevice.restaurant_location || selectedDevice.username || '-'}</DetailRow>
                <DetailRow label="Lingua">{selectedDevice.language || 'Non disponibile'}</DetailRow>
                <DetailRow label="Fuso orario">{selectedDevice.timezone || 'Non disponibile'}</DetailRow>
                <DetailRow label="Device ID" mono>{selectedDevice.device_id}</DetailRow>
                <DetailRow label="Tab ID" mono>{selectedDevice.tab_id || 'Non disponibile'}</DetailRow>
                <DetailRow label="User agent" mono>{selectedDevice.user_agent || 'Non disponibile'}</DetailRow>
              </section>

              <section className="mt-6">
                <h3 className="font-black text-slate-950">Errori browser recenti</h3>
                {selectedErrors.length === 0 ? (
                  <div className="py-3 text-sm text-slate-500">Nessun errore registrato per questo dispositivo.</div>
                ) : selectedErrors.map((error, index) => (
                  <div key={`${error.ts || 'error'}-${index}`} className="border-b border-slate-200 py-3 last:border-0">
                    <div className="text-xs text-slate-500">{formatItalianDateTime(error.ts)} · {error.kind || 'errore'}</div>
                    <div className="mt-1 break-words text-sm font-bold text-rose-800">{error.message || '-'}</div>
                    {error.url ? <div className="mt-1 break-all font-mono text-xs text-slate-600">{error.method || ''} {error.url}</div> : null}
                    {error.stack ? <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600">{error.stack}</pre> : null}
                  </div>
                ))}
              </section>
            </div>

            <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:px-7">
              <span>Dati aggiornati {formatAgo(selectedDevice.last_seen)}</span>
              {selectedDevice.path ? (
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700"><ExternalLink size={13} /> {compactDiagnosticPath(selectedDevice.path)}</span>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}
    </section>
  );
};

export default DiagnosticsDevicesView;
