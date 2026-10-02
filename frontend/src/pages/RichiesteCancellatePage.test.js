import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';

import RichiesteCancellatePage from './RichiesteCancellatePage';


jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'simone-token' }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('Audit richieste merce', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockReset();
    mockNavigate.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/restaurants')) {
        return Promise.resolve({ data: [{ id: 'rest-1', location: 'Flaminio' }] });
      }
      if (url.includes('/admin/cancelled-requests')) {
        return Promise.resolve({ data: [{
          id: 'cancelled-1',
          ddt_number: 942,
          restaurant_location: 'Flaminio',
          created_at: '2026-09-22T10:16:00+00:00',
          cancelled_at: '2026-09-22T10:33:00+00:00',
          cancelled_by_username: 'Flaminio',
          items: [{ product_id: 'pecorino', product_name: 'Pecorino', unit: 'buste', quantity: 7 }],
        }] });
      }
      if (url.includes('/admin/modified-requests')) {
        return Promise.resolve({ data: [{
          id: 'modified-1',
          ddt_number: 948,
          restaurant_location: 'Largo di Brazzà',
          status: 'confermata',
          updated_at: '2026-09-23T09:00:00+00:00',
          edit_history: [{
            id: 'edit-1',
            changed_at: '2026-09-23T09:00:00+00:00',
            changed_by_username: 'Brazza',
            before_items: [{ product_id: 'pecorino', product_name: 'Pecorino', unit: 'buste', quantity: 31 }],
            after_items: [{ product_id: 'pecorino', product_name: 'Pecorino', unit: 'buste', quantity: 24 }],
          }],
        }] });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('mostra cancellazioni e confronto prima/dopo dei DDT modificati', async () => {
    await act(async () => {
      root.render(<RichiesteCancellatePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="cancelled-request-942"]')).not.toBeNull();
    expect(container.textContent).toContain('Pecorino');
    expect(container.textContent).toContain('7');

    await act(async () => {
      container.querySelector('[data-testid="modified-tab"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="modified-request-948"]')).not.toBeNull();
    expect(container.textContent).toContain('31 → 24');
    expect(container.textContent).toContain('da Brazza');
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/admin/modified-requests'),
      expect.objectContaining({ headers: { Authorization: 'Bearer simone-token' } }),
    );
  });

  test('segnala i DDT storici privi della versione precedente', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/restaurants')) return Promise.resolve({ data: [] });
      if (url.includes('/admin/cancelled-requests')) return Promise.resolve({ data: [] });
      if (url.includes('/admin/modified-requests')) return Promise.resolve({ data: [{
        id: 'legacy-1', ddt_number: 868, restaurant_location: 'Grazie', status: 'confermata',
        updated_at: '2026-08-20T09:00:00+00:00',
      }] });
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    await act(async () => {
      root.render(<RichiesteCancellatePage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('[data-testid="modified-tab"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('disponibile solo il valore finale');
  });
});
