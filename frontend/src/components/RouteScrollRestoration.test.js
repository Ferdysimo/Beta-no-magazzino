import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RouteScrollRestoration from './RouteScrollRestoration';
import {
  readRouteScrollPosition,
  writeRouteScrollPosition,
} from '../utils/scrollMemory';

let mockLocation = { pathname: '/', search: '', hash: '' };
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

describe('RouteScrollRestoration', () => {
  let container;
  let root;
  let scrollTop;
  let documentHeight;

  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    scrollTop = 0;
    documentHeight = 3000;

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollTop,
    });
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      get: () => scrollTop,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => documentHeight,
    });
    Object.defineProperty(document.body, 'scrollHeight', {
      configurable: true,
      get: () => documentHeight,
    });
    window.scrollTo = jest.fn(({ top }) => {
      scrollTop = top;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const renderAt = (path) => {
    mockLocation = { pathname: path, search: '', hash: '' };
    act(() => {
      root.render(
        <React.StrictMode>
          <RouteScrollRestoration />
        </React.StrictMode>
      );
    });
  };

  test('ripristina subito lo scroll salvato quando la pagina è abbastanza alta', () => {
    writeRouteScrollPosition('/report-excel', 900);

    renderAt('/report-excel');

    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 900,
      left: 0,
      behavior: 'auto',
    });
  });

  test('attende i contenuti caricati via API prima di ripristinare', () => {
    documentHeight = 900;
    writeRouteScrollPosition('/report-excel', 900);

    renderAt('/report-excel');
    expect(window.scrollTo).not.toHaveBeenCalled();

    documentHeight = 3000;
    act(() => jest.advanceTimersByTime(100));

    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 900,
      left: 0,
      behavior: 'auto',
    });
  });

  test('salva la posizione mentre l utente scorre', () => {
    renderAt('/report-excel');
    scrollTop = 640;

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(20);
    });

    expect(readRouteScrollPosition('/report-excel')).toBe(640);
  });

  test('una route mai visitata parte dall alto', () => {
    scrollTop = 700;

    renderAt('/diagnostica');

    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    });
  });
});
