import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const DEVICE_KEY = 'pastasciutta_device_id';
const TAB_KEY = 'pastasciutta_tab_id';
const HEARTBEAT_MS = 30000;

const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${Date.now()}`;
  }
};

const getTabId = () => {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return `tab_${Date.now()}`;
  }
};

const parseClient = () => {
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux'
    : 'OS';
  return {
    browser,
    os,
    device_type: isMobile ? 'mobile/tablet' : 'desktop',
  };
};

const loadFrontendVersion = async () => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return data.version || '';
  } catch {
    return '';
  }
};

const FrontendDiagnostics = () => {
  const { token, restaurant, effectiveRestaurant } = useAuth();
  const [frontendVersion, setFrontendVersion] = useState('');
  const tokenRef = useRef(token);
  const restaurantRef = useRef(restaurant);
  const effectiveRestaurantRef = useRef(effectiveRestaurant);
  const frontendVersionRef = useRef('');
  const deviceIdRef = useRef(getDeviceId());
  const tabIdRef = useRef(getTabId());

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { restaurantRef.current = restaurant; }, [restaurant]);
  useEffect(() => { effectiveRestaurantRef.current = effectiveRestaurant; }, [effectiveRestaurant]);
  useEffect(() => { frontendVersionRef.current = frontendVersion; }, [frontendVersion]);

  const buildPayload = () => {
    const effective = effectiveRestaurantRef.current;
    const currentRestaurant = restaurantRef.current;
    return {
      device_id: deviceIdRef.current,
      tab_id: tabIdRef.current,
      frontend_version: frontendVersionRef.current,
      path: window.location.pathname,
      user_agent: navigator.userAgent,
      ...parseClient(),
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      online: navigator.onLine,
      visibility: document.visibilityState,
      restaurant_id: effective?.id || currentRestaurant?.id || '',
      restaurant_location: effective?.location || currentRestaurant?.location || currentRestaurant?.username || '',
    };
  };

  const postDiagnostics = async (path, payload) => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    try {
      await axios.post(`${API}${path}`, payload, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
    } catch {
      // Diagnostics must never disturb the app workflow.
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadFrontendVersion().then(version => {
      if (!cancelled) setFrontendVersion(version);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!token) return undefined;

    const heartbeat = () => postDiagnostics('/diagnostics/frontend', buildPayload());
    heartbeat();
    const interval = setInterval(heartbeat, HEARTBEAT_MS);
    const onVisibility = () => heartbeat();
    const onOnline = () => heartbeat();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;

    const reportError = (extra) => {
      postDiagnostics('/diagnostics/frontend/error', {
        ...buildPayload(),
        ...extra,
      });
    };

    const onError = (event) => {
      reportError({
        kind: 'window_error',
        message: event.message || 'Errore JavaScript',
        source: event.filename || '',
        stack: event.error?.stack || '',
      });
    };

    const onUnhandledRejection = (event) => {
      const reason = event.reason;
      reportError({
        kind: 'unhandled_rejection',
        message: reason?.message || String(reason || 'Promise rejection'),
        stack: reason?.stack || '',
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      response => response,
      error => {
        const url = error?.config?.url || '';
        if (!url.includes('/diagnostics/frontend') && tokenRef.current) {
          const status = error?.response?.status;
          postDiagnostics('/diagnostics/frontend/error', {
            ...buildPayload(),
            kind: 'api_error_frontend',
            message: error?.message || `HTTP ${status || 'error'}`,
            status,
            method: (error?.config?.method || '').toUpperCase(),
            url,
          });
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

export default FrontendDiagnostics;
