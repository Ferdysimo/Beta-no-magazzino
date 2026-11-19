import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';

import HomePage from './HomePage';


const mockNavigate = jest.fn();
let mockAuth;

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);
jest.mock('../components/SystemAlertsBanner', () => () => <div data-testid="alerts" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const authFor = (username) => ({
  restaurant: { username, role: 'admin', location: 'Amministrazione' },
  token: 'token',
  isAdmin: true,
  isSupervisor: false,
  isFederico: false,
  canImpersonate: true,
  effectiveRestaurant: null,
  selectRestaurant: jest.fn(),
  clearSelectedRestaurant: jest.fn(),
});

describe('HomePage account Simone', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('mostra i tre hub ordinati soltanto a Simone e rimuove i vecchi pulsanti sparsi', async () => {
    mockAuth = authFor('Simone');
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });

    const button = container.querySelector('[data-testid="simone-hub-magazzino"]');
    expect(button).not.toBeNull();
    expect(container.querySelector('[data-testid="simone-hub-audit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="simone-hub-impostazioni"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="simone-fotografie-magazzino"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-richieste-cancellate"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-controlli-trasporti"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-controllo-caricamenti"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-cestino-generale"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-crea-locali"]')).toBeNull();
    expect(container.querySelector('[data-testid="simone-laboratorio"]')).toBeNull();
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/simone/controlli-magazzino');

    await act(async () => root.unmount());
    root = createRoot(container);
    mockAuth = authFor('Admin');
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="simone-hub-magazzino"]')).toBeNull();
  });

  test('mostra a Federico gli accessi ordinati senza Diagnostica live', async () => {
    mockAuth = {
      ...authFor('Federico'),
      restaurant: { username: 'Federico', role: 'supervisor', location: 'Supervisione' },
      isAdmin: false,
      isSupervisor: true,
      isFederico: true,
    };
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });

    const button = container.querySelector('[data-testid="federico-report-spicci-globale"]');
    expect(button).not.toBeNull();
    const controlsHub = container.querySelector('[data-testid="federico-hub-controlli"]');
    expect(controlsHub).not.toBeNull();
    expect(container.querySelector('[data-testid="federico-hub-prezzi"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="admin-chiusure-excel"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-dizionario-paste"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-dizionario-bevande"]')).toBeNull();
    expect(container.querySelector('[data-testid="admin-audit-cassa"]')).toBeNull();
    expect(container.querySelector('[data-testid="federico-controllo-caricamenti"]')).toBeNull();
    expect(container.querySelector('[data-testid="federico-diagnostica"]')).toBeNull();
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/federico/report-spicci-globale');
    await act(async () => controlsHub.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/federico/controlli');

    await act(async () => root.unmount());
    root = createRoot(container);
    mockAuth = authFor('Simone');
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="federico-report-spicci-globale"]')).toBeNull();
  });
});
