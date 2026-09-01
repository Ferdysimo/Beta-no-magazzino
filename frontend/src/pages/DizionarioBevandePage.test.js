import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import DizionarioBevandePage from './DizionarioBevandePage';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'token-federico', canImpersonate: true }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const beverages = [
  { sigla: 'AL', name: 'Acqua naturale', price: 1 },
  { sigla: 'AG', name: 'Acqua leggermente frizzante', price: 1 },
  { sigla: 'C', name: 'Coca-Cola', price: 2 },
  { sigla: 'CZ', name: 'Coca-Cola Zero', price: 2 },
  { sigla: 'F', name: 'Fanta', price: 2 },
  { sigla: 'S', name: 'Sprite', price: 2 },
  { sigla: 'B', name: 'Peroni', price: 2.5 },
  { sigla: 'VB', name: 'Vino bianco', price: 2.5 },
  { sigla: 'VR', name: 'Vino rosso', price: 2.5 },
];

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('DizionarioBevandePage', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    localStorage.clear();
    axios.get.mockReset();
    axios.put.mockReset();
    axios.delete.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/restaurants')) {
        return Promise.resolve({
          data: [{ id: 'flaminio-id', location: 'Flaminio', role: 'restaurant' }],
        });
      }
      if (url.includes('/beverage-price-dictionary')) {
        return Promise.resolve({
          data: {
            restaurant_id: 'flaminio-id',
            beverages,
            is_default: true,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    axios.put.mockResolvedValue({ data: { ok: true, frozen_rows: 12 } });
    axios.delete.mockResolvedValue({ data: { ok: true } });
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
      root.render(<DizionarioBevandePage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('mostra il listino fisso e salva soltanto i prezzi del locale', async () => {
    await renderPage();

    expect(container.querySelectorAll('[data-testid^="beverage-price-"][type="number"]')).toHaveLength(9);
    const cocaPrice = container.querySelector('[data-testid="beverage-price-C"]');
    await act(async () => setInputValue(cocaPrice, '3.2'));

    const save = container.querySelector('[data-testid="beverage-price-save"]');
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(axios.put).toHaveBeenCalledTimes(1);
    const payload = axios.put.mock.calls[0][1];
    expect(payload.restaurant_id).toBe('flaminio-id');
    expect(payload.prices).toHaveLength(9);
    expect(payload.prices.find(item => item.sigla === 'C').price).toBe(3.2);
    expect(container.textContent).toContain('Protette 12 righe storiche');
  });
});
