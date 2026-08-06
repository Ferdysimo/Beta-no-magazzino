import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const DEVICE_KEY = 'pastasciutta_device_id';
const TAB_KEY = 'pastasciutta_tab_id';
const HEARTBEAT_MS = 30000;
const BUNDLE_VERSION = process.env.REACT_APP_BUILD_VERSION || '';

const finiteNumber = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const readConnectionTelemetry = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) {
    return {
      connection_type: '',
      connection_effective_type: '',
      connection_downlink_mbps: null,
      connection_rtt_ms: null,
      connection_save_data: null,
    };
  }
  return {
    connection_type: connection.type || '',
    connection_effective_type: connection.effectiveType || '',
    connection_downlink_mbps: finiteNumber(connection.downlink),
    connection_rtt_ms: finiteNumber(connection.rtt),
    connection_save_data: typeof connection.saveData === 'boolean' ? connection.saveData : null,
  };
};

export const readBatteryTelemetry = (battery) => ({
  battery_level: finiteNumber(battery?.level) === null
    ? null
    : Math.max(0, Math.min(100, Math.round(battery.level * 100))),
  battery_charging: typeof battery?.charging === 'boolean' ? battery.charging : null,
  battery_charging_time: finiteNumber(battery?.chargingTime),
  battery_discharging_time: finiteNumber(battery?.dischargingTime),
});

const emptyTelemetry = () => ({
  device_model: '',
  platform_version: '',
  architecture: '',
  bitness: '',
  browser_full_version: '',
  battery_level: null,
  battery_charging: null,
  battery_charging_time: null,
  battery_discharging_time: null,
  ...readConnectionTelemetry(),
});

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
  const [frontendVersion, setFrontendVersion] = useState(BUNDLE_VERSION);
  const tokenRef = useRef(token);
  const restaurantRef = useRef(restaurant);
  const effectiveRestaurantRef = useRef(effectiveRestaurant);
  const frontendVersionRef = useRef('');
  const deviceIdRef = useRef(getDeviceId());
  const tabIdRef = useRef(getTabId());
  const telemetryRef = useRef(emptyTelemetry());
  const heartbeatRttRef = useRef(null);
  const heartbeatFailuresRef = useRef(0);
  const lastHeartbeatFailureAtRef = useRef('');
  const heartbeatInFlightRef = useRef(false);

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
      ...telemetryRef.current,
      heartbeat_rtt_ms: heartbeatRttRef.current,
      heartbeat_failures: heartbeatFailuresRef.current,
      last_heartbeat_failure_at: lastHeartbeatFailureAtRef.current,
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
    if (BUNDLE_VERSION) {
      setFrontendVersion(BUNDLE_VERSION);
      return undefined;
    }
    let cancelled = false;
    loadFrontendVersion().then(version => {
      if (!cancelled) setFrontendVersion(version);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const userAgentData = navigator.userAgentData;
    if (!userAgentData?.getHighEntropyValues) return undefined;
    userAgentData.getHighEntropyValues([
      'model',
      'platformVersion',
      'architecture',
      'bitness',
      'fullVersionList',
    ]).then(values => {
      if (cancelled) return;
      const fullVersions = (values.fullVersionList || [])
        .filter(item => item?.brand && !/not.?a.?brand/i.test(item.brand))
        .map(item => `${item.brand} ${item.version}`)
        .join(' / ');
      telemetryRef.current = {
        ...telemetryRef.current,
        device_model: values.model || '',
        platform_version: values.platformVersion || '',
        architecture: values.architecture || '',
        bitness: values.bitness || '',
        browser_full_version: fullVersions,
      };
    }).catch(() => {
      // High entropy hints are optional and unavailable on several browsers.
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let battery = null;
    const syncBattery = () => {
      if (!cancelled && battery) {
        telemetryRef.current = { ...telemetryRef.current, ...readBatteryTelemetry(battery) };
      }
    };
    if (typeof navigator.getBattery !== 'function') return undefined;
    navigator.getBattery().then(value => {
      if (cancelled) return;
      battery = value;
      syncBattery();
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']
        .forEach(event => battery.addEventListener?.(event, syncBattery));
    }).catch(() => {
      // Battery telemetry is best-effort and never affects the app.
    });
    return () => {
      cancelled = true;
      if (battery) {
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']
          .forEach(event => battery.removeEventListener?.(event, syncBattery));
      }
    };
  }, []);

  useEffect(() => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return undefined;
    const syncConnection = () => {
      telemetryRef.current = { ...telemetryRef.current, ...readConnectionTelemetry() };
    };
    syncConnection();
    connection.addEventListener?.('change', syncConnection);
    return () => connection.removeEventListener?.('change', syncConnection);
  }, []);

  useEffect(() => {
    if (!token) return undefined;

    const heartbeat = async () => {
      if (heartbeatInFlightRef.current || !tokenRef.current) return;
      heartbeatInFlightRef.current = true;
      const startedAt = performance.now();
      const payload = buildPayload();
      try {
        await axios.post(`${API}/diagnostics/frontend`, payload, {
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        });
        heartbeatRttRef.current = Math.max(0, Math.round(performance.now() - startedAt));
        heartbeatFailuresRef.current = 0;
      } catch {
        heartbeatFailuresRef.current += 1;
        lastHeartbeatFailureAtRef.current = new Date().toISOString();
      } finally {
        heartbeatInFlightRef.current = false;
      }
    };
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
