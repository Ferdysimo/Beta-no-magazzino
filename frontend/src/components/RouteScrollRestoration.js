import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getRouteScrollKey,
  readRouteScrollPosition,
  writeRouteScrollPosition,
} from '../utils/scrollMemory';

const RESTORE_TIMEOUT_MS = 15000;
const RESTORE_INTERVAL_MS = 100;
const RESTORE_TOLERANCE_PX = 4;
const USER_INTERRUPT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

const getScrollTop = () => window.scrollY || window.pageYOffset || 0;

const getMaxScrollTop = () => {
  const documentHeight = Math.max(
    document.documentElement?.scrollHeight || 0,
    document.body?.scrollHeight || 0
  );
  return Math.max(0, documentHeight - window.innerHeight);
};

const RouteScrollRestoration = () => {
  const location = useLocation();
  const routeKey = getRouteScrollKey(location);
  const activeRouteRef = useRef(routeKey);
  const restorationRef = useRef(null);
  const scheduledSaveRef = useRef(null);

  useEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousMode;
    };
  }, []);

  useEffect(() => {
    const flushScheduledSave = () => {
      const pending = scheduledSaveRef.current;
      if (!pending) return;
      window.cancelAnimationFrame(pending.frameId);
      scheduledSaveRef.current = null;
      writeRouteScrollPosition(pending.routeKey, pending.top);
    };

    const persistCurrentRoute = () => {
      if (restorationRef.current) return;
      flushScheduledSave();
      writeRouteScrollPosition(activeRouteRef.current, getScrollTop());
    };

    const handleScroll = () => {
      if (restorationRef.current) return;

      const snapshot = {
        routeKey: activeRouteRef.current,
        top: getScrollTop(),
      };
      const pending = scheduledSaveRef.current;
      if (pending) {
        pending.routeKey = snapshot.routeKey;
        pending.top = snapshot.top;
        return;
      }

      snapshot.frameId = window.requestAnimationFrame(() => {
        writeRouteScrollPosition(snapshot.routeKey, snapshot.top);
        scheduledSaveRef.current = null;
      });
      scheduledSaveRef.current = snapshot;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistCurrentRoute();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', persistCurrentRoute);
    window.addEventListener('beforeunload', persistCurrentRoute);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pagehide', persistCurrentRoute);
      window.removeEventListener('beforeunload', persistCurrentRoute);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushScheduledSave();
    };
  }, []);

  useLayoutEffect(() => {
    if (restorationRef.current?.cleanup) {
      restorationRef.current.cleanup();
    }
    activeRouteRef.current = routeKey;

    const savedPosition = readRouteScrollPosition(routeKey) ?? 0;
    if (savedPosition <= 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return undefined;
    }

    const state = {
      cleanup: null,
      intervalId: null,
      observer: null,
      timeoutId: null,
    };
    restorationRef.current = state;

    const cleanup = () => {
      if (state.intervalId !== null) window.clearInterval(state.intervalId);
      if (state.timeoutId !== null) window.clearTimeout(state.timeoutId);
      state.observer?.disconnect();
      USER_INTERRUPT_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, cancelForUser);
      });
      if (restorationRef.current === state) restorationRef.current = null;
    };

    const restoreIfReady = () => {
      if (activeRouteRef.current !== routeKey) {
        cleanup();
        return true;
      }
      if (getMaxScrollTop() + RESTORE_TOLERANCE_PX < savedPosition) return false;

      cleanup();
      window.scrollTo({ top: savedPosition, left: 0, behavior: 'auto' });
      return true;
    };

    function cancelForUser() {
      cleanup();
      writeRouteScrollPosition(routeKey, getScrollTop());
    }

    state.cleanup = cleanup;
    USER_INTERRUPT_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, cancelForUser, { passive: true, once: true });
    });

    if (!restoreIfReady()) {
      state.intervalId = window.setInterval(restoreIfReady, RESTORE_INTERVAL_MS);
      state.timeoutId = window.setTimeout(() => {
        const closestAvailablePosition = Math.min(savedPosition, getMaxScrollTop());
        cleanup();
        window.scrollTo({ top: closestAvailablePosition, left: 0, behavior: 'auto' });
      }, RESTORE_TIMEOUT_MS);

      if (typeof ResizeObserver === 'function') {
        state.observer = new ResizeObserver(restoreIfReady);
        if (document.documentElement) state.observer.observe(document.documentElement);
        if (document.body) state.observer.observe(document.body);
      }
    }

    return cleanup;
  }, [routeKey]);

  return null;
};

export default RouteScrollRestoration;
