import {
  diagnosticDeviceLabel,
  getDiagnosticDeviceWarnings,
  groupOnlineDiagnosticDevices,
} from './diagnosticsDevices';

const device = (overrides = {}) => ({
  device_id: 'dev-tablet-ab12',
  status: 'online',
  device_type: 'mobile/tablet',
  restaurant_id: 'flaminio-id',
  restaurant_location: 'Flaminio',
  frontend_version: '200',
  last_seen: '2026-08-06T10:00:00+00:00',
  ...overrides,
});

test('mostra solo dispositivi online raggruppati per locale', () => {
  const groups = groupOnlineDiagnosticDevices([
    device(),
    device({ device_id: 'dev-offline', status: 'offline' }),
    device({
      device_id: 'dev-grazie',
      restaurant_id: 'grazie-id',
      restaurant_location: 'Grazie',
    }),
  ], '200');

  expect(groups).toHaveLength(2);
  expect(groups.find(group => group.key === 'flaminio-id').devices).toHaveLength(1);
  expect(groups.flatMap(group => group.devices).some(item => item.status === 'offline')).toBe(false);
});

test('un dispositivo sano non riceve badge, gli avvisi reali vengono raccolti', () => {
  expect(getDiagnosticDeviceWarnings(device(), '200')).toEqual([]);

  const warnings = getDiagnosticDeviceWarnings(device({
    frontend_version: '100',
    recent_errors_count: 2,
    heartbeat_failures: 1,
    heartbeat_rtt_ms: 1400,
    connection_effective_type: '2g',
    battery_level: 12,
    battery_charging: false,
  }), '200');

  expect(warnings.map(warning => warning.key)).toEqual([
    'errors',
    'heartbeat-failures',
    'build',
    'heartbeat-rtt',
    'network',
    'battery',
  ]);
  expect(warnings[0]).toEqual(expect.objectContaining({
    level: 'critical',
    detail: expect.any(String),
    action: expect.any(String),
  }));
});

test('nome manuale prevale sul nome automatico e la ricerca lo usa', () => {
  const named = device({ display_name: 'Tablet cassa' });
  expect(diagnosticDeviceLabel(named)).toBe('Tablet cassa');
  expect(groupOnlineDiagnosticDevices([named], '200', 'cassa')).toHaveLength(1);
  expect(groupOnlineDiagnosticDevices([named], '200', 'cucina')).toHaveLength(0);
});

test('filtro problemi esclude i dispositivi senza avvisi', () => {
  const groups = groupOnlineDiagnosticDevices([
    device(),
    device({ device_id: 'dev-warning', heartbeat_rtt_ms: 1300 }),
  ], '200', '', true);

  expect(groups).toHaveLength(1);
  expect(groups[0].devices.map(item => item.device_id)).toEqual(['dev-warning']);
  expect(groups[0].devicesWithIssues).toBe(1);
  expect(groups[0].warningCount).toBe(1);
});
