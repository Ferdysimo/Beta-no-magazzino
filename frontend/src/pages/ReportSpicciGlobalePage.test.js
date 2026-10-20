import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import ReportSpicciGlobalePage from './ReportSpicciGlobalePage';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'token-federico', isFederico: true }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const restaurants = [
  { id: 'flaminio', location: 'Flaminio', role: 'restaurant' },
  { id: 'vittorio', location: 'Corso Vittorio', role: 'restaurant' },
];

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('ReportSpicciGlobalePage', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    axios.get.mockReset();
    axios.put.mockReset();
    axios.get.mockImplementation((url, config) => {
      if (url.includes('/admin/restaurants')) {
        return Promise.resolve({ data: restaurants });
      }
      if (url.includes('/cash/daily')) {
        const rid = config.headers['X-Restaurant-Id'];
        return Promise.resolve({
          data: {
            revision: `rev-${rid}`,
            data: rid === 'flaminio'
              ? { sp5: '1', sp2: '2', sp1: '', sp05: '', cd5: '4', cd2: '5' }
              : { sp5: '', sp2: '1', sp1: '2', sp05: '', cd2: '3', cd1: '6' },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    axios.put.mockResolvedValue({ data: { ok: true, revision: 'rev-saved' } });
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
      root.render(<ReportSpicciGlobalePage />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('carica contemporaneamente il cassetto di tutti i locali senza mostrare i rotolini aperti', async () => {
    await renderPage();

    expect(container.querySelector('[data-testid="global-spicci-card-flaminio"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="global-spicci-card-vittorio"]')).not.toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain('Rotolini aperti');
    expect(container.querySelector('[data-testid="global-spicci-flaminio-sp5"]')).toBeNull();
    expect(container.querySelector('[data-testid="global-cassetto-flaminio-cd5"]').value).toBe('3');
  });

  test('non espone i campi aperti e salva soltanto il campo cassetto modificato', async () => {
    await renderPage();

    const field = container.querySelector('[data-testid="global-cassetto-flaminio-cd2"]');
    await act(async () => field.focus());
    await act(async () => setInputValue(field, '8'));
    await act(async () => field.blur());
    const save = container.querySelector('[data-testid="global-spicci-save-flaminio"]');
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axios.put).toHaveBeenCalledTimes(1);
    const [url, payload, config] = axios.put.mock.calls[0];
    expect(url).toContain('/cash/daily');
    expect(payload).toEqual(expect.objectContaining({
      target_restaurant_id: 'flaminio',
      revision: 'rev-flaminio',
      cd2: '10',
    }));
    expect(Object.keys(payload).sort()).toEqual([
      'cd2', 'revision', 'target_restaurant_id',
    ]);
    expect(config.headers['X-Restaurant-Id']).toBe('flaminio');
    expect(config.headers['X-Admin-Restaurant-Id']).toBe('flaminio');
  });

  test('modifica il residuo del cassetto mantenendo la stessa logica del Report', async () => {
    await renderPage();

    const field = container.querySelector('[data-testid="global-cassetto-flaminio-cd5"]');
    expect(field.value).toBe('3'); // stock base 4 - un rotolino aperto
    await act(async () => field.focus());
    await act(async () => setInputValue(field, '6'));
    await act(async () => field.blur());

    const save = container.querySelector('[data-testid="global-spicci-save-flaminio"]');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const payload = axios.put.mock.calls[0][1];
    expect(payload).toEqual({
      target_restaurant_id: 'flaminio',
      revision: 'rev-flaminio',
      cd5: '7', // residuo 6 + un rotolino aperto
    });
  });
});
