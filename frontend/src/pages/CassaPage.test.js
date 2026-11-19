import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';

import CassaPage from './CassaPage';


jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

let mockAuthState;

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('../contexts/OrderContext', () => ({
  useOrders: () => ({
    orders: [],
    createOrder: jest.fn(),
    deleteOrder: jest.fn(),
    completeOrder: jest.fn(),
    updateOrder: jest.fn(),
  }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const disabledConfig = {
  restaurant_id: 'flaminio',
  boiler_count: 2,
  enabled: false,
  boiler2_siglas: ['CARB', 'PESTO', 'POM', 'AMAT'],
  standard_siglas: [],
  standard_siglas_configured: false,
};

const addTag = async (element, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await Promise.resolve();
  });
};

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('CassaPage divisioni bollitori', () => {
  let container;
  let root;

  beforeEach(() => {
    mockAuthState = {
      token: 'token-flaminio',
      restaurant: { id: 'flaminio', location: 'Flaminio', boiler_count: 2 },
      effectiveRestaurant: null,
      canImpersonate: false,
    };
    axios.get.mockReset();
    axios.put.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/logs/today')) {
        return Promise.resolve({ data: { deletions: { count: 0, logs: [] }, modifications: { count: 0, logs: [] } } });
      }
      if (url.includes('/orders/next-number')) {
        return Promise.resolve({ data: { next_number: 1 } });
      }
      if (url.includes('/kitchen-routing')) {
        return Promise.resolve({ data: disabledConfig });
      }
      if (url.includes('/pasta-dictionary')) {
        return Promise.resolve({
          data: { siglas: ['CARB', 'PESTO', 'POM', 'AMAT', 'CACIO'].map(sigla => ({ sigla, price: 8 })) },
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    axios.put.mockImplementation((_url, payload) => Promise.resolve({
      data: {
        ...disabledConfig,
        enabled: payload.enabled ?? false,
        boiler2_siglas: payload.boiler2_siglas || disabledConfig.boiler2_siglas,
        standard_siglas: payload.standard_siglas ?? disabledConfig.standard_siglas,
        standard_siglas_configured: payload.standard_siglas !== undefined,
      },
    }));
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
      root.render(<CassaPage />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('attiva le divisioni dalla Cassa', async () => {
    await renderPage();

    const toggle = container.querySelector('[data-testid="divisioni-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await click(toggle);

    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining('/kitchen-routing'),
      { enabled: true },
      expect.objectContaining({ headers: { Authorization: 'Bearer token-flaminio' } }),
    );
    expect(container.querySelector('[data-testid="divisioni-toggle"]').textContent).toContain('ATTIVE');
  });

  test('aggiunge ed elimina sigle nei due box e salva entrambe le liste', async () => {
    await renderPage();
    await click(container.querySelector('[data-testid="divisioni-configura"]'));

    expect(container.querySelector('[data-testid="divisioni-modal"]')).not.toBeNull();
    await click(container.querySelector('[data-testid="divisioni-bollitore2-remove-POM"]'));
    await addTag(container.querySelector('[data-testid="divisioni-bollitore2-input"]'), 'alici');
    await click(container.querySelector('[data-testid="divisioni-salva"]'));

    const saveCall = axios.put.mock.calls.find(([, payload]) => payload.boiler2_siglas);
    expect(saveCall).toBeDefined();
    expect(saveCall[1].boiler2_siglas).toEqual(['CARB', 'PESTO', 'AMAT', 'ALICI']);
    expect(saveCall[1].standard_siglas).toEqual(['CACIO']);
  });

  test('impedisce di salvare la stessa sigla in entrambi i box', async () => {
    await renderPage();
    await click(container.querySelector('[data-testid="divisioni-configura"]'));
    axios.put.mockClear();

    await addTag(container.querySelector('[data-testid="divisioni-standard-input"]'), 'CARB');
    await click(container.querySelector('[data-testid="divisioni-salva"]'));

    expect(axios.put).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="divisioni-modal"]').textContent).toContain('CARB');
    expect(container.querySelector('[data-testid="divisioni-modal"]').textContent).toContain('entrambi');
  });

  test('non mostra ne interroga le divisioni negli altri locali', async () => {
    mockAuthState = {
      ...mockAuthState,
      token: 'token-corso',
      restaurant: { id: 'corso', location: 'Corso Vittorio', boiler_count: 2 },
    };

    await renderPage();

    expect(container.querySelector('[data-testid="divisioni-panel"]')).toBeNull();
    expect(axios.get.mock.calls.some(([url]) => url.includes('/kitchen-routing'))).toBe(false);
  });
});
