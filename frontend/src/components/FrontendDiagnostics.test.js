import { readBatteryTelemetry, readConnectionTelemetry } from './FrontendDiagnostics';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    interceptors: { response: { use: jest.fn(), eject: jest.fn() } },
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({}),
}));

test('normalizza batteria in percentuale e scarta tempi infiniti', () => {
  expect(readBatteryTelemetry({
    level: 0.734,
    charging: false,
    chargingTime: Infinity,
    dischargingTime: 7200,
  })).toEqual({
    battery_level: 73,
    battery_charging: false,
    battery_charging_time: null,
    battery_discharging_time: 7200,
  });
});

test('legge la stima connessione quando il browser la espone', () => {
  const previous = navigator.connection;
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: {
      type: 'wifi',
      effectiveType: '4g',
      downlink: 22.5,
      rtt: 50,
      saveData: false,
    },
  });

  expect(readConnectionTelemetry()).toEqual({
    connection_type: 'wifi',
    connection_effective_type: '4g',
    connection_downlink_mbps: 22.5,
    connection_rtt_ms: 50,
    connection_save_data: false,
  });

  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: previous,
  });
});
