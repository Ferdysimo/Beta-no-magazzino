import {
  ADMIN_SELECTED_RESTAURANT_KEY,
  LEGACY_SHARED_TOKEN_KEY,
  SESSION_RESTAURANT_ID_KEY,
  SESSION_TOKEN_KEY,
  clearSessionAuth,
  loadSessionToken,
  saveSessionAuth,
  sessionIdentityMatches,
} from './authSession';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test('discarda il vecchio token condiviso senza migrarlo', () => {
  const tab = createStorage();
  const shared = createStorage();
  shared.setItem(LEGACY_SHARED_TOKEN_KEY, 'token-grazie-forse-sovrascritto');
  tab.setItem(ADMIN_SELECTED_RESTAURANT_KEY, '{"id":"r1"}');

  expect(loadSessionToken(tab, shared)).toBeNull();
  expect(shared.getItem(LEGACY_SHARED_TOKEN_KEY)).toBeNull();
  expect(tab.getItem(ADMIN_SELECTED_RESTAURANT_KEY)).toBeNull();
});

test('due schede mantengono token e locale indipendenti', () => {
  const shared = createStorage();
  const flaminioTab = createStorage();
  const grazieTab = createStorage();

  saveSessionAuth('token-flaminio', 'flaminio-id', flaminioTab, shared);
  saveSessionAuth('token-grazie', 'grazie-id', grazieTab, shared);

  expect(loadSessionToken(flaminioTab, shared)).toBe('token-flaminio');
  expect(loadSessionToken(grazieTab, shared)).toBe('token-grazie');
  expect(sessionIdentityMatches('flaminio-id', flaminioTab)).toBe(true);
  expect(sessionIdentityMatches('grazie-id', grazieTab)).toBe(true);
  expect(shared.getItem(LEGACY_SHARED_TOKEN_KEY)).toBeNull();
});

test('il controllo identita fallisce se auth me restituisce un altro locale', () => {
  const tab = createStorage();
  const shared = createStorage();
  saveSessionAuth('token-flaminio', 'flaminio-id', tab, shared);

  expect(sessionIdentityMatches('grazie-id', tab)).toBe(false);
  expect(sessionIdentityMatches('', tab)).toBe(false);
});

test('logout elimina token, identita e selezione admin della sola scheda', () => {
  const tab = createStorage();
  const shared = createStorage();
  tab.setItem(SESSION_TOKEN_KEY, 'token-flaminio');
  tab.setItem(SESSION_RESTAURANT_ID_KEY, 'flaminio-id');
  tab.setItem(ADMIN_SELECTED_RESTAURANT_KEY, '{"id":"flaminio-id"}');

  clearSessionAuth(tab, shared);

  expect(tab.getItem(SESSION_TOKEN_KEY)).toBeNull();
  expect(tab.getItem(SESSION_RESTAURANT_ID_KEY)).toBeNull();
  expect(tab.getItem(ADMIN_SELECTED_RESTAURANT_KEY)).toBeNull();
});
