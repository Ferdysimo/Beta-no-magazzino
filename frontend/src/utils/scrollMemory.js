export const ROUTE_SCROLL_STORAGE_PREFIX = 'pastasciutta:route-scroll:v1:';

export const getRouteScrollKey = ({ pathname = '/', search = '', hash = '' } = {}) =>
  `${pathname || '/'}${search || ''}${hash || ''}`;

const getStorage = (storage) => {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
};

export const readRouteScrollPosition = (routeKey, storage = null) => {
  try {
    const value = getStorage(storage)?.getItem(`${ROUTE_SCROLL_STORAGE_PREFIX}${routeKey}`);
    if (value === null || value === '') return null;

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  } catch {
    return null;
  }
};

export const writeRouteScrollPosition = (routeKey, position, storage = null) => {
  const normalized = Number(position);
  if (!routeKey || !Number.isFinite(normalized) || normalized < 0) return false;

  try {
    getStorage(storage)?.setItem(
      `${ROUTE_SCROLL_STORAGE_PREFIX}${routeKey}`,
      String(Math.round(normalized))
    );
    return true;
  } catch {
    return false;
  }
};
