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

  test('mostra il pulsante fotografie magazzino soltanto a Simone', async () => {
    mockAuth = authFor('Simone');
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });

    const button = container.querySelector('[data-testid="simone-fotografie-magazzino"]');
    expect(button).not.toBeNull();
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mockNavigate).toHaveBeenCalledWith('/simone/fotografie-magazzino');

    await act(async () => root.unmount());
    root = createRoot(container);
    mockAuth = authFor('Admin');
    await act(async () => {
      root.render(<HomePage />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="simone-fotografie-magazzino"]')).toBeNull();
  });
});
