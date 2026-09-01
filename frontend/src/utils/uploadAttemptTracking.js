import axios from 'axios';


const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const DEVICE_KEY = 'pastasciutta_device_id';
const QUEUE_KEY = 'pastasciutta_upload_attempt_queue_v1';
const MAX_QUEUED_EVENTS = 150;

const createId = (prefix) => {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const createUploadAttemptId = () => createId('upload');

export const getUploadDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = createId('dev');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return createId('dev');
  }
};

const parseClient = () => {
  const ua = navigator.userAgent || '';
  return {
    browser: /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'Safari'
      : /Firefox\//.test(ua) ? 'Firefox'
      : 'Browser',
    os: /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
      : /Windows/i.test(ua) ? 'Windows'
      : /Mac OS/i.test(ua) ? 'macOS'
      : /Linux/i.test(ua) ? 'Linux'
      : 'OS',
  };
};

const buildClientContext = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    device_id: getUploadDeviceId(),
    path: window.location.pathname,
    online: navigator.onLine,
    platform: navigator.platform || '',
    connection_effective_type: connection?.effectiveType || '',
    ...parseClient(),
  };
};

const readQueue = () => {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeQueue = (items) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUED_EVENTS)));
  } catch {
    // The upload itself must not depend on telemetry storage.
  }
};

const enqueue = (event, scopeId) => {
  if (!scopeId) return;
  const queue = readQueue();
  queue.push({ event, scope_id: String(scopeId || '') });
  writeQueue(queue);
};

const postEvent = (token, event) => axios.post(
  `${API}/upload-attempts/events`,
  event,
  {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000,
  },
);

export const uploadErrorDetails = (error) => {
  const status = error?.response?.status;
  if (!navigator.onLine) {
    return { error_kind: 'offline', error_message: 'Dispositivo offline' };
  }
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return { error_kind: 'timeout', error_message: 'Timeout della richiesta' };
  }
  if (status) {
    const detail = error?.response?.data?.detail;
    return {
      error_kind: 'http_error',
      error_message: String(detail || error?.message || `HTTP ${status}`).slice(0, 500),
      http_status: status,
    };
  }
  return {
    error_kind: 'network_error',
    error_message: String(error?.message || 'Errore di rete').slice(0, 500),
  };
};

export const recordUploadAttemptEvent = async (token, event, scopeId = '') => {
  if (!token || !event?.attempt_id || !event?.stage) return false;
  const normalized = {
    ...buildClientContext(),
    ...event,
    event_id: event.event_id || createId('event'),
    client_at: event.client_at || new Date().toISOString(),
  };
  try {
    await postEvent(token, normalized);
    return true;
  } catch {
    enqueue(normalized, scopeId);
    return false;
  }
};

let flushPromise = null;

export const flushUploadAttemptEvents = async (token, scopeId = '') => {
  if (!token || flushPromise) return flushPromise || false;
  flushPromise = (async () => {
    const queue = readQueue();
    if (!queue.length) return true;
    writeQueue([]);
    const keep = [];
    for (const item of queue) {
      if (item.scope_id && (!scopeId || item.scope_id !== String(scopeId))) {
        keep.push(item);
        continue;
      }
      try {
        await postEvent(token, item.event);
      } catch {
        keep.push(item);
      }
    }
    writeQueue([...keep, ...readQueue()]);
    return keep.length === 0;
  })();
  try {
    return await flushPromise;
  } finally {
    flushPromise = null;
  }
};
