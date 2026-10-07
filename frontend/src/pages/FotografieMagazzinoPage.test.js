import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';

import FotografieMagazzinoPage from './FotografieMagazzinoPage';


jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'simone-token' }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('Fotografie magazzino', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockReset();
    mockNavigate.mockReset();
    axios.get.mockResolvedValue({
      data: {
        count: 2,
        snapshots: [
          {
            id: 'warehouse-inventory-2026-10-07',
            business_date: '2026-10-07',
            scheduled_at: '2026-10-07T06:00:00+02:00',
            captured_at: '2026-10-07T04:00:12+00:00',
            data_quality: 'point_in_time',
            product_count: 2,
            products: [
              { product_id: 'pecorino', product_name: 'Pecorino', supplier: 'Test', unit: 'buste', quantity: 80 },
              { product_id: 'grana', product_name: 'Grana', supplier: 'Test', unit: 'buste', quantity: 45 },
            ],
          },
          {
            id: 'warehouse-inventory-2026-10-06',
            business_date: '2026-10-06',
            scheduled_at: '2026-10-06T06:00:00+02:00',
            captured_at: '2026-10-06T07:00:00+00:00',
            data_quality: 'reconstructed_from_ledger',
            movement_count_used: 3,
            product_count: 1,
            products: [
              { product_id: 'pecorino', product_name: 'Pecorino', supplier: 'Test', unit: 'buste', quantity: 100 },
            ],
          },
        ],
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('mostra la fotografia puntuale e consente di aprire una giornata ricostruita', async () => {
    await act(async () => {
      root.render(<FotografieMagazzinoPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/admin/warehouse-inventory-snapshots'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer simone-token' },
        params: expect.objectContaining({ date_from: expect.stringMatching(/-01$/) }),
      }),
    );
    expect(container.querySelector('[data-testid="snapshot-quality"]').textContent).toContain('Fotografia puntuale');
    expect(container.querySelector('[data-testid="snapshot-product-pecorino"]').textContent).toContain('80');

    await act(async () => {
      container.querySelector('[data-testid="snapshot-day-2026-10-06"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="snapshot-quality"]').textContent).toContain('Ricostruita dai movimenti');
    expect(container.querySelector('[data-testid="selected-snapshot"]').textContent).toContain('3 movimenti');
    expect(container.querySelector('[data-testid="snapshot-product-pecorino"]').textContent).toContain('100');
  });

  test('filtra i prodotti senza alterare la fotografia salvata', async () => {
    await act(async () => {
      root.render(<FotografieMagazzinoPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const search = container.querySelector('[data-testid="snapshot-search"]');
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setValue.call(search, 'grana');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="snapshot-product-grana"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="snapshot-product-pecorino"]')).toBeNull();
  });
});
