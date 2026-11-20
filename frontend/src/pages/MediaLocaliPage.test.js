import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import MediaLocaliPage from './MediaLocaliPage';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

jest.mock('../components/Header', () => () => <div data-testid="header" />);

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('MediaLocaliPage mobile table', () => {
  let container;
  let root;

  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: {
        locations: ['Flaminio', 'Grazie', 'Largo di Brazzà', 'Corso Vittorio'],
        averages: {
          Flaminio: 535,
          Grazie: 862,
          'Largo di Brazzà': 1073,
          'Corso Vittorio': 421,
        },
        revenue_averages: {
          Flaminio: 1234.5,
          Grazie: 2000,
          'Largo di Brazzà': 3100.25,
          'Corso Vittorio': 400.75,
        },
        days: [{
          date: '20/09/2026',
          locations: {
            Flaminio: 711,
            Grazie: 766,
            'Largo di Brazzà': 1109,
            'Corso Vittorio': 400,
          },
          revenues: {
            Flaminio: 1100.5,
            Grazie: 2200,
            'Largo di Brazzà': 3300.25,
            'Corso Vittorio': null,
          },
        }],
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  test('riserva spazio alla data e mostra quattro locali senza tabella scorrevole', async () => {
    await act(async () => {
      root.render(<MediaLocaliPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const table = container.querySelector('[data-testid="media-locali-table"]');
    const columns = table.querySelectorAll('col');
    const headerText = Array.from(table.querySelectorAll('thead th'))
      .map(cell => cell.textContent.trim());

    expect(table.className).toContain('table-fixed');
    expect(columns).toHaveLength(6);
    expect(columns[0].className).toContain('w-[23%]');
    expect(columns[5].className).toContain('w-[15%]');
    expect(headerText).toEqual([
      'Giorno', 'Flaminio', 'Grazie', 'Brazzà', 'Corso Vittorio', 'Tot.Totale',
    ]);
    expect(table.textContent).toContain('20/09/2026');
    expect(table.textContent).toContain('2986');
  });

  test('passa a Fatturato mostrando vendita piatti più bevande e la relativa media', async () => {
    await act(async () => {
      root.render(<MediaLocaliPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const revenueButton = container.querySelector('[data-testid="media-mode-revenue"]');
    expect(revenueButton.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      revenueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(revenueButton.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('Fatturato - vendita piatti e bevande');
    expect(container.textContent).toContain('1234,50');
    expect(container.textContent).toContain('1100,50');
    expect(container.textContent).toContain('6600,75');
    expect(container.textContent).not.toContain('SCARICA EXCEL');
  });
});
