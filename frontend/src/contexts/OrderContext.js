import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const OrderContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace(/^http/, 'ws');

const OPTIMISTIC_GUARD_MS = 3000;
const WS_BUFFER_FLUSH_MS = 300;
const WS_PING_INTERVAL_MS = 25000;     // keepalive ping every 25s
const POLLING_FALLBACK_MS = 15000;      // safety-net poll every 15s

export const OrderProvider = ({ children }) => {
  const { token, restaurant, effectiveRestaurant, isAdmin } = useAuth();
  const activeRestaurant = isAdmin ? effectiveRestaurant : restaurant;
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newOrdersAvailable, setNewOrdersAvailable] = useState(false);
  const [pauseUpdates, setPauseUpdates] = useState(false);

  // All mutable state in refs to avoid useEffect dependency churn
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const pauseUpdatesRef = useRef(pauseUpdates);
  const ordersRef = useRef(orders);
  const tokenRef = useRef(token);
  const restaurantIdRef = useRef(activeRestaurant?.id);
  const optimisticGuardRef = useRef(new Map());
  const wsBufferRef = useRef([]);
  const flushTimerRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const mountedRef = useRef(true);
  const wsClosedIntentionallyRef = useRef(false);
  const wsConnectedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { pauseUpdatesRef.current = pauseUpdates; }, [pauseUpdates]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { restaurantIdRef.current = activeRestaurant?.id; }, [activeRestaurant?.id]);

  const guardOrder = useCallback((orderId) => {
    optimisticGuardRef.current.set(orderId, Date.now() + OPTIMISTIC_GUARD_MS);
  }, []);

  const isGuarded = (orderId) => {
    const expiry = optimisticGuardRef.current.get(orderId);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      optimisticGuardRef.current.delete(orderId);
      return false;
    }
    return true;
  };

  // Fetch orders via HTTP
  const fetchOrdersImpl = async (forceUpdate = false) => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const response = await axios.get(`${API}/orders`, {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (!mountedRef.current) return;

      if (pauseUpdatesRef.current && !forceUpdate) {
        const currentIds = ordersRef.current.map(o => o.id).sort().join(',');
        const newIds = response.data.map(o => o.id).sort().join(',');
        if (currentIds !== newIds) setNewOrdersAvailable(true);
      } else {
        // Skip update if data hasn't changed (prevents unnecessary re-renders)
        const prev = ordersRef.current;
        const next = response.data;
        const hasGuards = optimisticGuardRef.current.size > 0;
        
        if (!hasGuards && !forceUpdate) {
          // Quick comparison: same length, same ids, same key fields
          if (prev.length === next.length) {
            const changed = next.some((o, i) => 
              o.id !== prev[i]?.id || 
              o.order_number !== prev[i]?.order_number ||
              o.description !== prev[i]?.description ||
              o.status !== prev[i]?.status ||
              o.hidden_generale !== prev[i]?.hidden_generale ||
              o.kitchen_completed !== prev[i]?.kitchen_completed ||
              o.monitor_visible !== prev[i]?.monitor_visible ||
              o.timer_started !== prev[i]?.timer_started ||
              o.timer_paused !== prev[i]?.timer_paused
            );
            if (!changed) return; // Nothing changed, skip re-render
          }
          setOrders(next);
          optimisticGuardRef.current.clear();
        } else if (hasGuards && !forceUpdate) {
          setOrders(prevOrders => {
            const guardedIds = new Set();
            optimisticGuardRef.current.forEach((expiry, id) => {
              if (Date.now() <= expiry) guardedIds.add(id);
            });
            const serverMap = new Map(next.map(o => [o.id, o]));
            const localGuarded = prevOrders.filter(o => guardedIds.has(o.id) && !serverMap.has(o.id));
            const merged = next.map(o => guardedIds.has(o.id) ? (prevOrders.find(p => p.id === o.id) || o) : o);
            return [...merged, ...localGuarded];
          });
        } else {
          setOrders(next);
          optimisticGuardRef.current.clear();
        }
        setNewOrdersAvailable(false);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  // Stable reference wrapper
  const fetchOrders = useCallback((forceUpdate = false) => {
    return fetchOrdersImpl(forceUpdate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush buffered WS events
  const flushWsBuffer = () => {
    const events = wsBufferRef.current;
    if (events.length === 0) return;
    wsBufferRef.current = [];

    if (pauseUpdatesRef.current) {
      setNewOrdersAvailable(true);
      return;
    }

    setOrders(prev => {
      let next = [...prev];
      for (const event of events) {
        const { type, order, order_id } = event;
        if (type === 'order_created') {
          if (!next.some(o => o.id === order.id)) next = [order, ...next];
        } else if (type === 'order_updated') {
          // Note: do NOT skip on guard. The server's order_updated payload is
          // authoritative and contains the full latest document. Skipping it
          // caused stale state on other tablets when actions overlapped (e.g.
          // Flaminio with 2 bollitori), making old kitchen_completed orders
          // appear to "reappear" until the page was reloaded.
          next = next.map(o => o.id === order.id ? order : o);
        } else if (type === 'order_deleted') {
          if (isGuarded(order_id)) continue;
          next = next.filter(o => o.id !== order_id);
        } else if (type === 'daily_reset') {
          next = [];
        }
      }
      return next;
    });
  };

  const enqueueWsEvent = (event) => {
    wsBufferRef.current.push(event);
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushWsBuffer();
      }, WS_BUFFER_FLUSH_MS);
    }
  };

  // WebSocket connect — uses only refs, no hook dependencies
  const connectWebSocket = () => {
    const rid = restaurantIdRef.current;
    if (!rid || !mountedRef.current) return;

    // Clean up existing
    if (wsRef.current) {
      wsClosedIntentionallyRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    wsClosedIntentionallyRef.current = false;
    const wsUrl = `${WS_URL}/api/ws/${rid}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      const wasReconnect = reconnectAttemptsRef.current > 0;
      reconnectAttemptsRef.current = 0;
      wsConnectedRef.current = true;

      // Stop polling when WebSocket is connected
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      // CRITICAL: after a reconnect (network drop, server restart, midnight reset
      // broadcast missed, device wake-up, ...), re-sync state from the backend.
      // Without this, stale orders from previous days could remain in the local
      // state and appear mixed with today's new ones until the user manually
      // refreshes the page. Trigger an authoritative HTTP fetch.
      if (wasReconnect) {
        fetchOrdersImpl(true);
      }

      // Start keepalive ping
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, WS_PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pong') return; // ignore keepalive replies
        enqueueWsEvent(data);
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      wsRef.current = null;
      wsConnectedRef.current = false;

      // Start polling as fallback when WebSocket disconnects
      if (!pollingIntervalRef.current && mountedRef.current) {
        pollingIntervalRef.current = setInterval(() => {
          fetchOrdersImpl(false);
        }, POLLING_FALLBACK_MS);
      }

      // Don't reconnect if closed intentionally or component unmounted
      if (wsClosedIntentionallyRef.current || !mountedRef.current) return;

      console.log('WebSocket disconnected, reconnecting...');
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
      reconnectAttemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  };

  const refreshOrders = useCallback(() => {
    fetchOrdersImpl(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // MAIN EFFECT — runs only when active restaurant or token changes
  useEffect(() => {
    if (!activeRestaurant?.id || !token) return;
    mountedRef.current = true;

    // Initial HTTP fetch
    fetchOrdersImpl(true);

    // Connect WebSocket with slight delay to avoid race with React mount/unmount
    const wsDelay = setTimeout(() => connectWebSocket(), 500);

    // Safety-net polling fallback
    pollingIntervalRef.current = setInterval(() => {
      fetchOrdersImpl(false);
    }, POLLING_FALLBACK_MS);

    // CRITICAL safety net: every minute, sniff for "ghost orders" — i.e. orders
    // in local state whose `created_at` falls on a different Rome day than the
    // current Rome day. This catches the case where the tablet was open across
    // midnight and missed the `daily_reset` WebSocket broadcast (server restart,
    // network blip, device asleep). Without this, yesterday's orders (which can
    // have numbers like #600+) would remain mixed with today's #1, #2, …
    const staleGuardInterval = setInterval(() => {
      try {
        const list = ordersRef.current || [];
        if (list.length === 0) return;
        const todayRome = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
        const hasStale = list.some(o => {
          if (!o?.created_at) return false;
          const createdRome = new Date(o.created_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
          return createdRome !== todayRome;
        });
        if (hasStale) {
          console.warn('[STALE-GUARD] Detected orders from a different Rome day in local state — forcing refetch');
          fetchOrdersImpl(true);
        }
      } catch (e) { /* no-op */ }
    }, 60 * 1000);

    return () => {
      mountedRef.current = false;
      wsClosedIntentionallyRef.current = true;
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
      if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
      clearInterval(staleGuardInterval);
      clearTimeout(wsDelay);
    };
  }, [activeRestaurant?.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // When pause is lifted, re-fetch
  useEffect(() => {
    if (!pauseUpdates && newOrdersAvailable) {
      fetchOrdersImpl(true);
    }
  }, [pauseUpdates, newOrdersAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const createOrder = async (description, orderNumber = null) => {
    const payload = { description };
    if (orderNumber) payload.order_number = orderNumber;
    const response = await axios.post(`${API}/orders`, payload, {
      headers: { Authorization: `Bearer ${tokenRef.current}` }
    });
    guardOrder(response.data.id);
    // Dedup-by-id: if the WebSocket broadcast arrived BEFORE this HTTP response
    // and already added the order to local state, do not prepend again.
    setOrders(prev => prev.some(o => o.id === response.data.id)
      ? prev.map(o => o.id === response.data.id ? response.data : o)
      : [response.data, ...prev]);
    return response.data;
  };

  const updateOrder = async (orderId, data) => {
    guardOrder(orderId);
    const response = await axios.patch(`${API}/orders/${orderId}`, data, {
      headers: { Authorization: `Bearer ${tokenRef.current}` }
    });
    setOrders(prev => prev.map(o => o.id === orderId ? response.data : o));
    return response.data;
  };

  const deleteOrder = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await axios.delete(`${API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const completeOrder = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, status: 'completed' } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/complete`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const kitchenComplete = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, kitchen_completed: true } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/kitchen-complete`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const toggleMonitor = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, monitor_visible: !o.monitor_visible } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/monitor-toggle`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const hideFromGenerale = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, hidden_generale: true, hidden_generale_timer: 0 } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/hide-generale`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const startTimer = async (orderId) => {
    guardOrder(orderId);
    const now = new Date().toISOString();
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_started: true, timer_start_time: now, timer_paused: false } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/start`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const pauseTimer = async (orderId, elapsed) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_paused: true, timer_elapsed: elapsed } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/pause?elapsed=${elapsed}`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  const resetTimer = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_started: false, timer_start_time: null, timer_paused: false, timer_elapsed: 0 } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/reset`, {}, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrdersImpl(true);
      throw error;
    }
  };

  return (
    <OrderContext.Provider value={{
      orders, loading, newOrdersAvailable, pauseUpdates, setPauseUpdates,
      refreshOrders, fetchOrders, createOrder, updateOrder, deleteOrder,
      completeOrder, kitchenComplete, toggleMonitor, hideFromGenerale, startTimer, pauseTimer, resetTimer
    }}>
      {children}
    </OrderContext.Provider>
  );
};

export const useOrders = () => {
  const context = useContext(OrderContext);
  if (!context) throw new Error('useOrders must be used within OrderProvider');
  return context;
};
