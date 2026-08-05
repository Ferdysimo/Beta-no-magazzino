import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import InventarioPage from './InventarioPage';


const mockNavigate = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);
jest.mock('../components/ZoomableImage', () => () => <div data-testid="image" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input, value) => {
  const prototype = input.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('InventarioPage scarti', () => {
  let container;
  let root;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({
      token: 'admin-token',
      restaurant: { role: 'admin', username: 'Admin' },
    });
    axios.get.mockReset();
    axios.post.mockReset();
    axios.get.mockResolvedValue({
      data: [{
        id: 'product-1',
        name: 'Farina test',
        unit: 'pz',
        supplier: 'Test',
        quantity: 10,
      }],
    });
    axios.post.mockResolvedValue({
      data: {
        product_id: 'product-1',
        product_name: 'Farina test',
        quantity: 3,
        reason: 'Confezione rotta',
        balance_after: 7,
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

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('l Admin registra uno scarto e vede subito la nuova giacenza', async () => {
    await act(async () => {
      root.render(<InventarioPage />);
    });
    await flush();

    act(() => {
      container.querySelector('[data-testid="open-waste-dialog"]').click();
    });
    expect(container.querySelector('[data-testid="waste-dialog"]')).not.toBeNull();

    act(() => {
      setInputValue(container.querySelector('[data-testid="waste-quantity"]'), '3');
      setInputValue(container.querySelector('[data-testid="waste-reason"]'), 'Confezione rotta');
    });
    await act(async () => {
      container.querySelector('[data-testid="waste-dialog"]')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/products/product-1/waste'),
      { quantity: 3, reason: 'Confezione rotta' },
      { headers: { Authorization: 'Bearer admin-token' } },
    );
    expect(container.querySelector('[data-testid="waste-dialog"]')).toBeNull();
    expect(container.querySelector('[data-testid="inventario-row-product-1"]').textContent)
      .toContain('7');
    expect(container.textContent).toContain('registrato scarto di 3');
  });
});
