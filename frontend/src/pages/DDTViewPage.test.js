import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import DDTViewPage, { sortedDdtHistory } from './DDTViewPage';

const mockNavigate = jest.fn();
let mockSearchParams = new URLSearchParams('history=warehouse');

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: 'ddt-20' }),
  useSearchParams: () => [mockSearchParams],
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'test-token',
    restaurant: { id: 'warehouse-id', role: 'magazzino' },
    effectiveRestaurant: null,
    canImpersonate: false,
    isAdmin: false,
  }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const currentDdt = {
  id: 'ddt-20',
  ddt_number: 20,
  restaurant_id: 'restaurant-id',
  restaurant_location: 'Flaminio',
  status: 'confermata',
  created_at: '2026-09-20T10:00:00+00:00',
  dispatch_date: '2026-09-21T10:00:00+00:00',
  confermata_at: '2026-09-21T12:00:00+00:00',
  items: [],
  mittente: {},
  destinatario: {},
};

describe('sortedDdtHistory', () => {
  test('ordina i DDT dal numero piu basso al piu alto', () => {
    expect(sortedDdtHistory([
      { id: 'c', ddt_number: 30 },
      { id: 'a', ddt_number: 10 },
      { id: 'b', ddt_number: 20 },
    ]).map(row => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('DDTViewPage navigation', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockSearchParams = new URLSearchParams('history=warehouse');
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/richieste/history-all')) {
        return Promise.resolve({ data: [
          { id: 'ddt-30', ddt_number: 30, status: 'confermata' },
          { id: 'ddt-20', ddt_number: 20, status: 'confermata' },
          { id: 'ddt-10', ddt_number: 10, status: 'confermata' },
        ] });
      }
      if (url.includes('/richieste/ddt-20')) {
        return Promise.resolve({ data: currentDdt });
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

  const renderPage = async () => {
    await act(async () => {
      root.render(<DDTViewPage />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('mostra precedente e successivo e li apre mantenendo lo storico', async () => {
    await renderPage();

    const previous = container.querySelector('[data-testid="ddt-history-previous"]');
    const next = container.querySelector('[data-testid="ddt-history-next"]');
    expect(previous.textContent).toContain('DDT 10');
    expect(next.textContent).toContain('DDT 30');
    expect(container.querySelector('[data-testid="ddt-history-navigation"]').textContent).toContain('2 di 3');

    act(() => previous.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/ddt/ddt-10?history=warehouse', { replace: true });

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(mockNavigate).toHaveBeenCalledWith('/ddt/ddt-30?history=warehouse', { replace: true });
  });

  test('fuori dallo storico non carica la sequenza e non mostra le frecce', async () => {
    mockSearchParams = new URLSearchParams();
    await renderPage();

    expect(container.querySelector('[data-testid="ddt-history-navigation"]')).toBeNull();
    expect(axios.get.mock.calls.some(([url]) => url.includes('/richieste/history-all'))).toBe(false);
  });
});
