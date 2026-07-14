export const SESSION_TOKEN_KEY = 'pastasciutta_auth_token';
export const SESSION_RESTAURANT_ID_KEY = 'pastasciutta_auth_restaurant_id';
export const LEGACY_SHARED_TOKEN_KEY = 'token';
export const ADMIN_SELECTED_RESTAURANT_KEY = 'admin_selected_restaurant';

export const loadSessionToken = (
  sessionStore = window.sessionStorage,
  sharedStore = window.localStorage
) => {
  const sessionToken = sessionStore.getItem(SESSION_TOKEN_KEY);
  const legacySharedToken = sharedStore.getItem(LEGACY_SHARED_TOKEN_KEY);

  // La vecchia chiave era condivisa fra tutte le schede. Non la migriamo:
  // potrebbe essere già stata sovrascritta da un altro locale.
  if (legacySharedToken) {
    sharedStore.removeItem(LEGACY_SHARED_TOKEN_KEY);
    if (!sessionToken) {
      sessionStore.removeItem(SESSION_RESTAURANT_ID_KEY);
      sessionStore.removeItem(ADMIN_SELECTED_RESTAURANT_KEY);
    }
  }

  return sessionToken || null;
};

export const saveSessionAuth = (
  token,
  restaurantId,
  sessionStore = window.sessionStorage,
  sharedStore = window.localStorage
) => {
  if (!token || !restaurantId) {
    throw new Error('Token e locale sono obbligatori per creare la sessione');
  }
  sessionStore.setItem(SESSION_TOKEN_KEY, token);
  sessionStore.setItem(SESSION_RESTAURANT_ID_KEY, restaurantId);
  sharedStore.removeItem(LEGACY_SHARED_TOKEN_KEY);
};

export const clearSessionAuth = (
  sessionStore = window.sessionStorage,
  sharedStore = window.localStorage
) => {
  sessionStore.removeItem(SESSION_TOKEN_KEY);
  sessionStore.removeItem(SESSION_RESTAURANT_ID_KEY);
  sessionStore.removeItem(ADMIN_SELECTED_RESTAURANT_KEY);
  sharedStore.removeItem(LEGACY_SHARED_TOKEN_KEY);
};

export const sessionIdentityMatches = (
  restaurantId,
  sessionStore = window.sessionStorage
) => {
  const expectedRestaurantId = sessionStore.getItem(SESSION_RESTAURANT_ID_KEY);
  return Boolean(
    expectedRestaurantId
    && restaurantId
    && expectedRestaurantId === restaurantId
  );
};
