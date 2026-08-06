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
  if (expectedVersion && device?.frontend_version && device.frontend_version !== expectedVersion) {
    warnings.push({ key: 'build', label: 'Build da aggiornare' });
  }
  if ((device?.recent_errors_count || 0) > 0) {
    warnings.push({ key: 'errors', label: `${device.recent_errors_count} errori browser` });
  }
  if ((device?.heartbeat_failures || 0) > 0) {
    warnings.push({ key: 'heartbeat-failures', label: `${device.heartbeat_failures} heartbeat falliti` });
  }
  if ((device?.heartbeat_rtt_ms || 0) >= 1200) {
    warnings.push({ key: 'heartbeat-rtt', label: 'Risposta app lenta' });
  }
  if (['slow-2g', '2g'].includes(String(device?.connection_effective_type || '').toLowerCase())) {
    warnings.push({ key: 'network', label: 'Connessione debole' });
  }
  if (
    typeof device?.battery_level === 'number'
    && device.battery_level <= 15
    && device.battery_charging === false
  ) {
    warnings.push({ key: 'battery', label: `Batteria ${device.battery_level}%` });
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
        lastSeen: '',
      };
      current.devices.push(device);
      current.warningCount += warnings.length;
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
      (b.warningCount - a.warningCount)
      || a.location.localeCompare(b.location, 'it')
    ));
};
