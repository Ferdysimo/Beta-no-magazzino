import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';

import ControlloCaricamentiPage from './ControlloCaricamentiPage';


jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'privileged-token' }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('ControlloCaricamentiPage', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockReset();
    mockNavigate.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('shows persisted closure attempts with their definitive server stage', async () => {
    axios.get.mockResolvedValue({
      data: {
        generated_at: '2026-09-01T09:00:00+00:00',
        summary: { saved: 1, failed: 0, incomplete: 0, pending: 0 },
        restaurants: [{ id: 'rest-1', location: 'Flaminio' }],
        items: [{
          attempt_id: 'attempt-1',
          first_seen: '2026-09-01T08:59:00+00:00',
          restaurant_location: 'Flaminio',
          username: 'Flaminio',
          device_id: 'device-tablet-1234',
          browser: 'Chrome',
          os: 'Android',
          display_status: 'saved',
          current_stage: 'server_saved',
          upload_kind: 'closure_primary',
          events: [{ stage: 'server_saved', server_at: '2026-09-01T08:59:02+00:00' }],
        }],
      },
    });

    await act(async () => {
      root.render(<ControlloCaricamentiPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Controllo caricamenti chiusure');
    expect(container.textContent).toContain('Flaminio');
    expect(container.textContent).toContain('Chrome · Android');
    expect(container.textContent).toContain('Salvata');
    expect(container.textContent).toContain('Foto scritta e chiusura salvata');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/admin/upload-attempts'),
      expect.objectContaining({ headers: { Authorization: 'Bearer privileged-token' } }),
    );
  });
});
