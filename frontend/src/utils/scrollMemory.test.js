import {
  ROUTE_SCROLL_STORAGE_PREFIX,
  getRouteScrollKey,
  readRouteScrollPosition,
  writeRouteScrollPosition,
} from './scrollMemory';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

test('crea una chiave distinta per percorso, filtri e hash', () => {
  expect(getRouteScrollKey({
    pathname: '/report-excel',
    search: '?date=2026-07-15',
    hash: '#totali',
  })).toBe('/report-excel?date=2026-07-15#totali');
});

test('salva e legge una posizione arrotondata per la singola route', () => {
  const storage = createStorage();
  const routeKey = '/report-excel';

  expect(writeRouteScrollPosition(routeKey, 842.6, storage)).toBe(true);
  expect(storage.getItem(`${ROUTE_SCROLL_STORAGE_PREFIX}${routeKey}`)).toBe('843');
  expect(readRouteScrollPosition(routeKey, storage)).toBe(843);
  expect(readRouteScrollPosition('/report', storage)).toBeNull();
});

test('ignora valori mancanti, negativi o corrotti', () => {
  const storage = createStorage();
  storage.setItem(`${ROUTE_SCROLL_STORAGE_PREFIX}/report`, 'non-un-numero');

  expect(readRouteScrollPosition('/report', storage)).toBeNull();
  expect(writeRouteScrollPosition('/report', -1, storage)).toBe(false);
  expect(writeRouteScrollPosition('/report', Number.NaN, storage)).toBe(false);
});

test('un errore dello storage non interrompe la navigazione', () => {
  const brokenStorage = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
  };

  expect(readRouteScrollPosition('/report', brokenStorage)).toBeNull();
  expect(writeRouteScrollPosition('/report', 100, brokenStorage)).toBe(false);
});
