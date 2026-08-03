import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import AnalisiPage from './AnalisiPage';

const mockNavigate = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);
jest.mock('../components/ZoomableImage', () => () => <div data-testid="image" />);
jest.mock('../components/NavLinkSpa', () => ({ to, children, ...props }) => (
  <a href={to} {...props}>{children}</a>
));

global.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('AnalisiPage campi extra', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({
      token: 'warehouse-token',
      restaurant: { role: 'magazzino', username: 'Magazziniere' },
    });
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/analisi/magazzino')) {
        return Promise.resolve({
          data: { locations: ['Flaminio'], products: [] },
        });
      }
      if (url.includes('/richieste/extra-notes')) {
        return Promise.resolve({
          data: [{
            id: 'extra-1',
            ddt_number: 77,
            restaurant_location: 'Grazie',
            created_at: '2026-07-27T08:30:00+00:00',
            status: 'confermata',
            extra_note: 'Aggiungere due confezioni fuori catalogo',
          }],
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

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('apre la finestra, mostra la richiesta collegata e filtra per data', async () => {
    await act(async () => {
      root.render(<AnalisiPage />);
    });
    await flush();

    act(() => {
      container.querySelector('[data-testid="open-extra-notes"]').click();
    });
    await flush();

    const dialog = container.querySelector('[data-testid="extra-notes-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Aggiungere due confezioni fuori catalogo');
    expect(dialog.textContent).toContain('Grazie');
    expect(dialog.textContent).toContain('Confermata');
    expect(dialog.querySelector('a[href="/ddt/extra-1"]').textContent).toContain('77');

    act(() => {
      setInputValue(
        container.querySelector('[data-testid="extra-date-from"]'),
        '2026-07-01',
      );
      setInputValue(
        container.querySelector('[data-testid="extra-date-to"]'),
        '2026-07-31',
      );
    });
    act(() => {
      container.querySelector('[data-testid="extra-apply"]').click();
    });
    await flush();

    const calls = axios.get.mock.calls.filter(([url]) => (
      url.includes('/richieste/extra-notes')
    ));
    expect(calls).toHaveLength(2);
    expect(calls[1][1].params).toEqual({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
    });
  });
});
