import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import DiagnosticaLivePage from './DiagnosticaLivePage';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'admin-token',
    canImpersonate: true,
    isAdmin: true,
  }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const liveDevice = (id, restaurantId, location, overrides = {}) => ({
  device_id: id,
  status: 'online',
  online: true,
  restaurant_id: restaurantId,
  restaurant_location: location,
  device_type: 'desktop',
  device_model: 'PC cassa',
  frontend_version: '400',
  path: '/cassa',
  os: 'Windows',
  connection_effective_type: '4g',
  battery_level: 90,
  battery_charging: true,
  heartbeat_rtt_ms: 80,
  last_seen: new Date().toISOString(),
  ...overrides,
});

const diagnostics = {
  server_time: '2026-08-19T12:00:00Z',
  server_started_at: '2026-08-19T08:00:00Z',
  deployment: {
    backend_version: '2.0.0',
    backend_git_commit: 'abc123',
    frontend_versions: ['400'],
  },
  system: {
    backend_ok: true,
    mongo_ok: true,
    disk: { free_gb: 80, used_percent: 20 },
  },
  frontend: {
    devices: [
      liveDevice('flaminio-pc', 'flaminio-id', 'Flaminio'),
      liveDevice('grazie-tablet', 'grazie-id', 'Grazie'),
    ],
    recent_errors: [],
  },
  operations: {
    locations: [
      { restaurant_id: 'flaminio-id', orders_today: 20 },
      { restaurant_id: 'grazie-id', orders_today: 15 },
    ],
    pending_ddt_count: 2,
  },
  websockets: [
    { restaurant_id: 'flaminio-id', active_connections: 1, disconnects_last_hour: 0 },
    { restaurant_id: 'grazie-id', active_connections: 1, disconnects_last_hour: 0 },
  ],
  recent_calls: [
    { ts: '2026-08-19T11:59:00Z', location: 'Flaminio', method: 'GET', path: '/api/orders', status: 200, ms: 60 },
  ],
  recent_errors: [],
  health_history: [
    { label: '15 min', calls: 12, errors: 0, avg_ms: 60, max_ms: 90, ws_disconnects: 0 },
  ],
  buffer_size: 12,
};

describe('DiagnosticaLivePage', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: diagnostics });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPage = async () => {
    await act(async () => {
      root.render(<DiagnosticaLivePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('apre sulla mappa completa dei locali senza semaforo generico', async () => {
    await renderPage();

    expect(container.querySelector('[data-testid="diag-online-locations"]').textContent).toBe('2');
    expect(container.querySelector('[data-testid="location-flaminio-id"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="location-grazie-id"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Sistema OK');
    expect(container.textContent).not.toContain('Stato generale');
    expect(container.textContent).toContain('Infrastruttura e log tecnici');
    expect(container.textContent).not.toContain('Andamento per finestra');
  });

  test('espande i dati backend solo quando servono', async () => {
    await renderPage();

    act(() => {
      container.querySelector('[data-testid="diag-toggle-infrastructure"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Andamento per finestra');
    expect(container.textContent).toContain('Endpoint da controllare per primi');
    expect(container.textContent).toContain('WebSocket per locale');
    expect(container.textContent).toContain('Errori backend recenti');
    expect(container.textContent).toContain('/api/orders');
  });
});
