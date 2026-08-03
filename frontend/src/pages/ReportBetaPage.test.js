import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import ReportBetaPage from './ReportBetaPage';

const mockNavigate = jest.fn();
const mockUseAuth = jest.fn();
const mockSearchParams = new URLSearchParams(
  'date=2026-07-27&rid=flaminio-id',
);

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams],
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../contexts/OrderContext', () => ({
  useOrders: () => ({ orders: [] }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('ReportBetaPage storico in sola lettura', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({
      token: 'test-token',
      canImpersonate: false,
      restaurant: {
        id: 'flaminio-id',
        username: 'Flaminio',
        location: 'Flaminio',
        role: 'restaurant',
      },
      effectiveRestaurant: {
        id: 'flaminio-id',
        username: 'Flaminio',
        location: 'Flaminio',
        role: 'restaurant',
      },
      selectRestaurant: jest.fn(),
    });
    axios.get.mockReset();
    axios.put.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/pasta-dictionary')) {
        return Promise.resolve({
          data: { siglas: [{ sigla: 'CARB', price: 8 }] },
        });
      }
      if (url.includes('/beverages/inventory')) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes('/beverages/daily')) {
        return Promise.resolve({ data: { counts: {}, prev_sera: {} } });
      }
      if (url.includes('/cash/daily')) {
        return Promise.resolve({
          data: {
            data: {},
            paste_text: [
              '1 CARB',
              '2 PASTA STRANA',
              '3 ALTRA PASTA FUORI DIZIONARIO',
            ].join('\n'),
            paste_manual_override: true,
            manual_prices: {
              '2 PASTA STRANA': '9',
              '3 ALTRA PASTA FUORI DIZIONARIO': '7',
            },
            cash_banconote: {},
            comments: {},
            revision: 'revision-1',
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

  const renderPage = async () => {
    await act(async () => {
      root.render(<ReportBetaPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('consente scroll e vista ingrandita delle paste senza renderle modificabili', async () => {
    await renderPage();

    const main = container.querySelector('main');
    const pastePanel = container.querySelector(
      '[data-testid="report-paste-panel"]',
    );
    const pasteTextarea = container.querySelector(
      '[data-testid="paste-textarea"]',
    );
    const pricesArea = container.querySelector(
      '[data-testid="manual-prices-scroll-area"]',
    );
    const toggle = container.querySelector(
      '[data-testid="toggle-paste-manual"]',
    );
    const compactPrices = Array.from(container.querySelectorAll(
      '[data-testid^="manual-price-"]:not([data-testid^="manual-price-expanded-"])',
    ));

    expect(main.classList.contains('pointer-events-none')).toBe(true);
    expect(pastePanel.classList.contains('pointer-events-auto')).toBe(true);
    expect(pricesArea.classList.contains('overflow-y-auto')).toBe(true);
    expect(pricesArea.classList.contains('pointer-events-auto')).toBe(true);
    expect(pasteTextarea.readOnly).toBe(true);
    expect(toggle.disabled).toBe(true);
    expect(compactPrices).toHaveLength(2);
    compactPrices.forEach(input => expect(input.readOnly).toBe(true));

    act(() => {
      compactPrices[0].value = '12';
      compactPrices[0].dispatchEvent(new Event('input', { bubbles: true }));
      compactPrices[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    const expand = container.querySelector(
      '[aria-label="Ingrandisci paste non riconosciute"]',
    );
    act(() => {
      expand.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector('[role="dialog"]');
    const expandedPrices = Array.from(container.querySelectorAll(
      '[data-testid^="manual-price-expanded-"]',
    ));
    expect(dialog).not.toBeNull();
    expect(expandedPrices).toHaveLength(2);
    expandedPrices.forEach(input => expect(input.readOnly).toBe(true));
    expect(expandedPrices[0].value).toBe('9');
    expect(axios.put).not.toHaveBeenCalled();
  });
});
