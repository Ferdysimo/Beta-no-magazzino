import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import AuditCassaPage from './AuditCassaPage';

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

global.IS_REACT_ACT_ENVIRONMENT = true;

const flaminio = {
  id: 'flaminio-id',
  username: 'Flaminio',
  location: 'Flaminio',
  role: 'restaurant',
};

const brazza = {
  id: 'brazza-id',
  username: 'Brazza',
  location: 'Largo di Brazzà',
  role: 'restaurant',
};

describe('AuditCassaPage restaurant selection', () => {
  let container;
  let root;
  let selectRestaurant;

  beforeEach(() => {
    mockNavigate.mockReset();
    selectRestaurant = jest.fn();
    mockUseAuth.mockReturnValue({
      token: 'test-token',
      canImpersonate: true,
      effectiveRestaurant: brazza,
      selectRestaurant,
    });
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/restaurants')) {
        return Promise.resolve({ data: [flaminio, brazza] });
      }
      if (url.includes('/admin/audit-log/groups')) {
        return Promise.resolve({ data: { items: [] } });
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
      root.render(<AuditCassaPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('parte dal locale della scheda e lo applica alla lista movimenti', async () => {
    await renderPage();

    const select = container.querySelector(
      '[data-testid="filter-restaurant"]',
    );
    expect(select.value).toBe(brazza.id);
    const groupsCall = axios.get.mock.calls.find(([url]) => (
      url.includes('/admin/audit-log/groups')
    ));
    expect(groupsCall[0]).toContain(`restaurant_id=${brazza.id}`);
  });

  test('cambiare locale aggiorna anche la selezione condivisa', async () => {
    await renderPage();

    const select = container.querySelector(
      '[data-testid="filter-restaurant"]',
    );
    await act(async () => {
      select.value = flaminio.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(selectRestaurant).toHaveBeenCalledWith(flaminio);
  });
});
