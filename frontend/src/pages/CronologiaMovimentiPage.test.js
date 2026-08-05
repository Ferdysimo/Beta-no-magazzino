import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import CronologiaMovimentiPage from './CronologiaMovimentiPage';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams()],
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    restaurant: { id: 'admin-id', username: 'Admin', role: 'admin' },
  }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('CronologiaMovimentiPage', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/products')) return Promise.resolve({ data: [] });
      if (url.endsWith('/stock-movements')) {
        return Promise.resolve({
          data: {
            movements: [{
              id: 'waste-1',
              product_id: 'product-1',
              product_name: 'TEST - Farina',
              delta: -2,
              balance_after: 23,
              cause: 'scarto_admin',
              user_name: 'Admin',
              user_role: 'admin',
              note: 'Confezione rotta',
              timestamp: '2026-08-05T10:00:00Z',
            }],
          },
        });
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

  test('mostra gli scarti nel filtro e li evidenzia in rosso', async () => {
    await act(async () => {
      root.render(<CronologiaMovimentiPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const wasteOption = container.querySelector(
      '[data-testid="filter-cause"] option[value="scarto_admin"]',
    );
    const row = container.querySelector('[data-testid="mov-row-waste-1"]');
    const badge = Array.from(row.querySelectorAll('span')).find(
      element => element.textContent === 'Scarto',
    );

    expect(wasteOption.textContent).toBe('Scarto');
    expect(row.classList.contains('bg-red-50')).toBe(true);
    expect(row.textContent).toContain('Confezione rotta');
    expect(badge.classList.contains('bg-red-100')).toBe(true);
    expect(badge.classList.contains('text-red-800')).toBe(true);
  });
});
