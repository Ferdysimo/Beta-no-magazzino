import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import ChiusureExcelPage, {
  arrCellBackground,
  parseVersDisplay,
  reportExpressionText,
} from './ChiusureExcelPage';

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

describe('ChiusureExcelPage restaurant selection', () => {
  let container;
  let root;
  let selectRestaurant;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('closures_excel_rest_id', flaminio.id);
    mockNavigate.mockReset();
    selectRestaurant = jest.fn();
    mockUseAuth.mockReturnValue({
      token: 'test-token',
      canImpersonate: true,
      restaurant: {
        id: 'federico-id',
        username: 'Federico',
        role: 'supervisor',
      },
      effectiveRestaurant: brazza,
      selectRestaurant,
    });
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/restaurants')) {
        return Promise.resolve({ data: [flaminio, brazza] });
      }
      if (url.includes('/admin/closures/grid')) {
        return Promise.resolve({
          data: {
            items: [{
              date: '2026-07-27',
              cash: {
                arr: 12,
                pos: 6299,
                vers: 80,
                ft: 780,
                sp2: 2,
                sp1: 1,
              },
              cash_raw: {
                arr: '10+2',
                pos: '6200+99',
                vers: '<span style="color: rgb(220, 38, 38)">50</span>+30',
                ft: '500+300-20',
                sp2: '1+1',
                sp1: '1',
              },
              cash_comments: {
                ft: 'Tre fatture controllate',
              },
              vers_raw: '<span style="color: rgb(220, 38, 38)">50</span>+30',
              vers_color: '',
              beverages: {
                AL: {
                  inUsc: 3,
                  scarti: 1,
                  sera: 8,
                  qty: 4,
                  raw: { inUsc: '1+2', scarti: '1', sera: '5+3' },
                  comments: { scarti: 'Bottiglia rotta' },
                },
              },
              paste_count: 10,
              cash_sera: 100,
            }],
            bev_sigle: ['AL'],
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
      root.render(<ChiusureExcelPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  test('ignora il vecchio locale della pagina e apre quello della sessione', async () => {
    await renderPage();

    const gridCall = axios.get.mock.calls.find(([url]) => (
      url.includes('/admin/closures/grid')
    ));
    expect(gridCall[0]).toContain(`restaurant_id=${brazza.id}`);

    const row = container.querySelector(
      '[data-testid="closure-row-2026-07-27"]',
    );
    expect(row).not.toBeNull();
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      `/report-beta?date=2026-07-27&rid=${brazza.id}`,
    );
  });

  test('il selettore aggiorna la selezione condivisa della scheda', async () => {
    await renderPage();

    const select = container.querySelector(
      '[data-testid="closures-excel-restaurant-select"]',
    );
    expect(select.value).toBe(brazza.id);

    act(() => {
      select.value = flaminio.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(selectRestaurant).toHaveBeenCalledWith(flaminio);
  });

  test('evidenzia Arr e POS e conserva i colori misti di Vers', async () => {
    await renderPage();

    const arrCell = container.querySelector(
      '[data-testid="closure-2026-07-27-cash-arr"]',
    );
    const posCell = container.querySelector(
      '[data-testid="closure-2026-07-27-cash-pos"]',
    );
    const versCell = container.querySelector(
      '[data-testid="closure-2026-07-27-cash-vers"]',
    );

    expect(arrCell.style.fontWeight).toBe('700');
    expect(arrCell.style.background).toBe('rgb(254, 226, 226)');
    expect(posCell.style.fontWeight).toBe('700');
    expect(versCell.style.background).toBe('rgb(254, 240, 138)');
    expect(versCell.textContent).toBe('50+30');

    const segments = versCell.querySelectorAll('span');
    expect(segments).toHaveLength(2);
    expect(segments[0].style.color).toBe('rgb(220, 38, 38)');
    expect(segments[1].style.color).toBe('rgb(17, 24, 39)');
  });

  test('mostra operazione e commento con doppio clic senza aprire il Report', async () => {
    await renderPage();

    const ftCell = container.querySelector(
      '[data-testid="closure-2026-07-27-cash-ft"]',
    );
    act(() => {
      ftCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ftCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="closure-cell-detail-dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="closure-cell-detail-expression"]').textContent)
      .toBe('500+300-20');
    expect(container.querySelector('[data-testid="closure-cell-detail-comment"]').textContent)
      .toBe('Tre fatture controllate');

    act(() => {
      container.querySelector('[data-testid="closure-cell-detail-close"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const scartiCell = container.querySelector(
      '[data-testid="closure-2026-07-27-bev-scarti-AL"]',
    );
    act(() => {
      scartiCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="closure-cell-detail-expression"]').textContent)
      .toBe('1');
    expect(container.querySelector('[data-testid="closure-cell-detail-comment"]').textContent)
      .toBe('Bottiglia rotta');
  });

  test('mostra una colonna separata per ogni taglio dei rotolini aperti', async () => {
    await renderPage();

    const twoEuroCell = container.querySelector(
      '[data-testid="closure-2026-07-27-spicci-sp2"]',
    );
    const oneEuroCell = container.querySelector(
      '[data-testid="closure-2026-07-27-spicci-sp1"]',
    );

    expect(twoEuroCell.textContent).toBe('2');
    expect(oneEuroCell.textContent).toBe('1');

    act(() => {
      twoEuroCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="closure-cell-detail-expression"]').textContent)
      .toBe('1+1');
  });

  test('interpreta anche Vers interamente nero, rosso e il colore rosso storico', () => {
    expect(parseVersDisplay('90')).toEqual({
      segments: [{ text: '90', red: false }],
      mixed: false,
    });
    expect(parseVersDisplay(
      '<span style="color: #dc2626">70</span>',
    )).toEqual({
      segments: [{ text: '70', red: true }],
      mixed: false,
    });
    expect(parseVersDisplay('40', 'red')).toEqual({
      segments: [{ text: '40', red: true }],
      mixed: false,
    });
  });

  test('colora Arr in verde tra -5 e +5 inclusi e in rosso fuori intervallo', () => {
    expect(arrCellBackground(-5)).toBe('#dcfce7');
    expect(arrCellBackground(0)).toBe('#dcfce7');
    expect(arrCellBackground(5)).toBe('#dcfce7');
    expect(arrCellBackground(-5.01)).toBe('#fee2e2');
    expect(arrCellBackground(5.01)).toBe('#fee2e2');
    expect(reportExpressionText('<span style="color:red">50</span>+30')).toBe('50+30');
  });
});
