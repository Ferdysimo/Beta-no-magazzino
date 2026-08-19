import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import DiagnosticsDevicesView from './DiagnosticsDevicesView';

jest.mock('axios', () => ({
  __esModule: true,
  default: { put: jest.fn() },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const device = overrides => ({
  device_id: 'flaminio-cassa-1',
  tab_id: 'tab-1',
  status: 'online',
  online: true,
  device_type: 'desktop',
  device_model: 'Dell OptiPlex 7010',
  restaurant_id: 'flaminio-id',
  restaurant_location: 'Flaminio',
  path: '/report-beta',
  os: 'Windows',
  platform_version: '11',
  architecture: 'x86',
  bitness: '64',
  browser: 'Chrome 128',
  browser_full_version: '128.0.0.0',
  frontend_version: '300',
  connection_effective_type: '4g',
  connection_downlink_mbps: 20,
  connection_rtt_ms: 40,
  heartbeat_rtt_ms: 85,
  heartbeat_failures: 0,
  battery_level: 84,
  battery_charging: false,
  visibility: 'visible',
  screen: '1920x1080',
  viewport: '1536x754',
  language: 'it-IT',
  timezone: 'Europe/Rome',
  ip: '192.0.2.10',
  user_agent: 'Test browser',
  first_seen: '2026-08-19T08:00:00Z',
  last_seen: new Date().toISOString(),
  recent_errors_count: 0,
  ...overrides,
});

describe('DiagnosticsDevicesView control room', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.put.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderView = () => {
    act(() => {
      root.render(
        <DiagnosticsDevicesView
          devices={[
            device(),
            device({
              device_id: 'grazie-tablet-1',
              restaurant_id: 'grazie-id',
              restaurant_location: 'Grazie',
              device_type: 'mobile/tablet',
              device_model: 'Samsung Galaxy Tab A9',
              os: 'Android',
              platform_version: '14',
              path: '/cassa',
              connection_effective_type: '2g',
              connection_downlink_mbps: 0.3,
              heartbeat_rtt_ms: 1450,
              heartbeat_failures: 2,
              battery_level: 9,
            }),
          ]}
          recentErrors={[]}
          operations={[
            { restaurant_id: 'flaminio-id', orders_today: 31 },
            { restaurant_id: 'grazie-id', orders_today: 18 },
          ]}
          websockets={[
            { restaurant_id: 'flaminio-id', active_connections: 2 },
            { restaurant_id: 'grazie-id', active_connections: 1 },
          ]}
          expectedVersion="300"
          token="admin-token"
          canEdit
          onRefresh={jest.fn()}
        />,
      );
    });
  };

  test('mostra tutti i locali e i dati essenziali senza aprire accordion', () => {
    renderView();

    expect(container.querySelector('[data-testid="location-flaminio-id"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="location-grazie-id"]')).not.toBeNull();
    expect(container.textContent).toContain('31 ordini oggi');
    expect(container.textContent).toContain('18 ordini oggi');
    expect(container.textContent).toContain('Windows 11');
    expect(container.textContent).toContain('4g · 20 Mbps');
    expect(container.textContent).toContain('84%');
    expect(container.textContent).toContain('1da verificare');
  });

  test('il dettaglio spiega il problema e conserva tutte le informazioni tecniche', () => {
    renderView();

    act(() => {
      container.querySelector('[data-testid="diagnostic-device-grazie-tablet-1"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Cosa controllare');
    expect(dialog.textContent).toContain('Heartbeat falliti');
    expect(dialog.textContent).toContain('Azione: Verifica prima la connessione');
    expect(dialog.textContent).toContain('Samsung Galaxy Tab A9');
    expect(dialog.textContent).toContain('Android 14');
    expect(dialog.textContent).toContain('Velocità stimata');
    expect(dialog.textContent).toContain('Autonomia stimata');
    expect(dialog.textContent).toContain('Device ID');
    expect(dialog.textContent).toContain('User agent');
  });
});
