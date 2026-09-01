import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import CassaBevandeBox from './CassaBevandeBox';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'cassa-token' }),
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

const beverages = [
  { sigla: 'AL', name: 'Acqua naturale', price: 1, count: 0, inventory: 20 },
  { sigla: 'AG', name: 'Acqua leggermente frizzante', price: 1, count: 0, inventory: 20 },
  { sigla: 'C', name: 'Coca-Cola', price: 2, count: 0, inventory: 20 },
  { sigla: 'CZ', name: 'Coca-Cola Zero', price: 2, count: 0, inventory: 20 },
  { sigla: 'F', name: 'Fanta', price: 2, count: 0, inventory: 20 },
  { sigla: 'S', name: 'Sprite', price: 2, count: 0, inventory: 20 },
  { sigla: 'B', name: 'Peroni', price: 2.5, count: 0, inventory: 20 },
  { sigla: 'VB', name: 'Vino bianco', price: 2.5, count: 0, inventory: 20 },
  { sigla: 'VR', name: 'Vino rosso', price: 2.5, count: 0, inventory: 20 },
];

describe('CassaBevandeBox', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
    axios.get.mockResolvedValue({ data: beverages });
    axios.post.mockResolvedValue({ data: { ok: true } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderBox = async () => {
    await act(async () => {
      root.render(<CassaBevandeBox />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('mostra tutte le bevande e aggiorna il contatore con meno rosso e più verde', async () => {
    await renderBox();

    expect(container.querySelectorAll('[data-testid^="bev-row-cassa-"]')).toHaveLength(9);
    expect(container.textContent).toContain('Acqua leggermente frizzante');

    const minus = container.querySelector('[data-testid="bev-minus-cassa-C"]');
    const plus = container.querySelector('[data-testid="bev-plus-cassa-C"]');
    const count = container.querySelector('[data-testid="bev-count-cassa-C"]');
    expect(minus.className).toContain('bg-red-600');
    expect(plus.className).toContain('bg-green-600');
    expect(minus.disabled).toBe(true);
    expect(count.textContent).toBe('0');

    await act(async () => {
      plus.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(count.textContent).toBe('1');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/beverages/sales'),
      { sigla: 'C' },
      expect.any(Object),
    );

    await act(async () => {
      minus.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(count.textContent).toBe('0');
    expect(axios.post).toHaveBeenLastCalledWith(
      expect.stringContaining('/beverages/sales/undo'),
      { sigla: 'C' },
      expect.any(Object),
    );
  });
});
