export const compactDiagnosticPath = (path) => {
  if (!path) return '-';
  const clean = String(path).split('?')[0] || '/';
  if (clean === '/') return 'Home';
  const last = clean.split('/').filter(Boolean).pop();
  return last ? last.replace(/-/g, ' ') : clean;
};

export const diagnosticDeviceLabel = (device) => {
  if (device?.display_name) return device.display_name;
  const type = String(device?.device_type || '').toLowerCase();
  const base = type.includes('mobile') || type.includes('tablet') ? 'Tablet' : 'PC';
  const suffix = String(device?.device_id || '').slice(-4).toUpperCase();
  return suffix ? `${base} ${suffix}` : base;
};

export const diagnosticDeviceModel = (device) => (
  device?.model_override || device?.device_model || ''
);

export const getDiagnosticDeviceWarnings = (device, expectedVersion = '') => {
  const warnings = [];
  if ((device?.recent_errors_count || 0) > 0) {
    warnings.push({
      key: 'errors',
      level: 'critical',
      label: `${device.recent_errors_count} errori browser`,
      detail: 'Il browser ha registrato errori recenti.',
      action: 'Apri il dispositivo e controlla messaggio, pagina e stack degli errori.',
    });
  }
  if ((device?.heartbeat_failures || 0) > 0) {
    warnings.push({
      key: 'heartbeat-failures',
      level: 'critical',
      label: `${device.heartbeat_failures} heartbeat falliti`,
      detail: 'Le ultime richieste diagnostiche non sono arrivate al backend.',
      action: 'Verifica prima la connessione del dispositivo, poi lo stato del backend.',
    });
  }
  if (expectedVersion && device?.frontend_version && device.frontend_version !== expectedVersion) {
    warnings.push({
      key: 'build',
      level: 'warning',
      label: 'Versione app diversa',
      detail: `Build dispositivo ${device.frontend_version}; attesa ${expectedVersion}.`,
      action: 'Ricarica completamente la pagina sul dispositivo e verifica che la build cambi.',
    });
  }
  if ((device?.heartbeat_rtt_ms || 0) >= 1200) {
    warnings.push({
      key: 'heartbeat-rtt',
      level: 'warning',
      label: `App lenta · ${device.heartbeat_rtt_ms} ms`,
      detail: 'Il giro completo dispositivo-backend supera 1,2 secondi.',
      action: 'Confronta RTT della rete e latenza API per distinguere Wi-Fi lento da backend lento.',
    });
  }
  if (['slow-2g', '2g'].includes(String(device?.connection_effective_type || '').toLowerCase())) {
    warnings.push({
      key: 'network',
      level: 'warning',
      label: `Rete ${device.connection_effective_type}`,
      detail: 'Il browser rileva un profilo di connessione molto lento.',
      action: 'Controlla copertura Wi-Fi, distanza dall’access point o rete mobile.',
    });
  }
  if (
    typeof device?.battery_level === 'number'
    && device.battery_level <= 15
    && device.battery_charging === false
  ) {
    warnings.push({
      key: 'battery',
      level: 'warning',
      label: `Batteria ${device.battery_level}%`,
      detail: 'Il dispositivo non è in carica e potrebbe spegnersi durante il servizio.',
      action: 'Collega il dispositivo all’alimentazione.',
    });
  }
  return warnings;
};

export const groupOnlineDiagnosticDevices = (
  devices,
  expectedVersion = '',
  search = '',
  onlyIssues = false,
) => {
  const normalizedSearch = search.trim().toLowerCase();
  const grouped = new Map();

  (devices || [])
    .filter(device => device.status === 'online')
    .forEach(device => {
      const warnings = getDiagnosticDeviceWarnings(device, expectedVersion);
      if (onlyIssues && warnings.length === 0) return;
      const haystack = [
        diagnosticDeviceLabel(device),
        diagnosticDeviceModel(device),
        device.restaurant_location,
        device.username,
        device.path,
        device.browser,
        device.os,
        device.ip,
        device.device_id,
      ].filter(Boolean).join(' ').toLowerCase();
      if (normalizedSearch && !haystack.includes(normalizedSearch)) return;

      const key = device.restaurant_id || device.restaurant_location || device.username || 'unknown';
      const current = grouped.get(key) || {
        key,
        location: device.restaurant_location || device.username || 'Locale non identificato',
        devices: [],
        warningCount: 0,
        devicesWithIssues: 0,
        criticalCount: 0,
        lastSeen: '',
      };
      current.devices.push(device);
      current.warningCount += warnings.length;
      current.devicesWithIssues += warnings.length > 0 ? 1 : 0;
      current.criticalCount += warnings.filter(warning => warning.level === 'critical').length;
      if (!current.lastSeen || String(device.last_seen || '') > current.lastSeen) {
        current.lastSeen = device.last_seen || '';
      }
      grouped.set(key, current);
    });

  return Array.from(grouped.values())
    .map(location => ({
      ...location,
      devices: location.devices.slice().sort((a, b) => (
        getDiagnosticDeviceWarnings(b, expectedVersion).length
        - getDiagnosticDeviceWarnings(a, expectedVersion).length
        || diagnosticDeviceLabel(a).localeCompare(diagnosticDeviceLabel(b), 'it')
      )),
    }))
    .sort((a, b) => (
      (b.criticalCount - a.criticalCount)
      || (b.devicesWithIssues - a.devicesWithIssues)
      || a.location.localeCompare(b.location, 'it')
    ));
};
