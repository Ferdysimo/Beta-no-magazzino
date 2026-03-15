import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const OrderContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace(/^http/, 'ws');

// How long to ignore WebSocket echoes for optimistically updated orders (ms)
const OPTIMISTIC_GUARD_MS = 3000;
// How often to flush buffered WebSocket events (ms)
const WS_BUFFER_FLUSH_MS = 300;

export const OrderProvider = ({ children }) => {
  const { token, restaurant } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newOrdersAvailable, setNewOrdersAvailable] = useState(false);
  const [pauseUpdates, setPauseUpdates] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const pauseUpdatesRef = useRef(pauseUpdates);
  const ordersRef = useRef(orders);

  // Track order IDs that were recently optimistically updated
  // so we can ignore the WebSocket echo for them
  const optimisticGuardRef = useRef(new Map()); // orderId -> expiry timestamp

  // Buffer for incoming WebSocket events
  const wsBufferRef = useRef([]);
  const flushTimerRef = useRef(null);

  useEffect(() => { pauseUpdatesRef.current = pauseUpdates; }, [pauseUpdates]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // Mark an order as "just optimistically updated" — ignore WS echoes for it
  const guardOrder = useCallback((orderId) => {
    optimisticGuardRef.current.set(orderId, Date.now() + OPTIMISTIC_GUARD_MS);
  }, []);

  // Check if an order is currently guarded
  const isGuarded = useCallback((orderId) => {
    const expiry = optimisticGuardRef.current.get(orderId);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      optimisticGuardRef.current.delete(orderId);
      return false;
    }
    return true;
  }, []);

  const fetchOrders = useCallback(async (forceUpdate = false) => {
    if (!token) return;
    try {
      const response = await axios.get(`${API}/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (pauseUpdatesRef.current && !forceUpdate) {
        const currentIds = ordersRef.current.map(o => o.id).sort().join(',');
        const newIds = response.data.map(o => o.id).sort().join(',');
        if (currentIds !== newIds) {
          setNewOrdersAvailable(true);
        }
      } else {
        setOrders(response.data);
        setNewOrdersAvailable(false);
        // Clear all guards on full refresh
        optimisticGuardRef.current.clear();
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Flush buffered WebSocket events in one batch
  const flushWsBuffer = useCallback(() => {
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
          if (!next.some(o => o.id === order.id)) {
            next = [order, ...next];
          }
        } else if (type === 'order_updated') {
          // Skip echo for guarded orders
          if (isGuarded(order.id)) continue;
          next = next.map(o => o.id === order.id ? order : o);
        } else if (type === 'order_deleted') {
          if (isGuarded(order_id)) continue;
          next = next.filter(o => o.id !== order_id);
        }
      }
      return next;
    });
  }, [isGuarded]);

  // Queue a WebSocket event into the buffer
  const enqueueWsEvent = useCallback((event) => {
    wsBufferRef.current.push(event);

    // Schedule a flush if one isn't already pending
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushWsBuffer();
      }, WS_BUFFER_FLUSH_MS);
    }
  }, [flushWsBuffer]);

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (!restaurant?.id) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = `${WS_URL}/api/ws/${restaurant.id}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        enqueueWsEvent(data);
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      wsRef.current = null;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
      reconnectAttemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };

    wsRef.current = ws;
  }, [restaurant?.id, enqueueWsEvent]);

  const refreshOrders = useCallback(() => {
    fetchOrders(true);
  }, [fetchOrders]);

  // Setup: initial fetch + WebSocket
  useEffect(() => {
    if (!restaurant?.id || !token) return;

    fetchOrders(true);
    connectWebSocket();

    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); }
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); }
    };
  }, [restaurant?.id, token, connectWebSocket, fetchOrders]);

  // When pause is lifted, re-fetch
  useEffect(() => {
    if (!pauseUpdates && newOrdersAvailable) {
      fetchOrders(true);
    }
  }, [pauseUpdates, newOrdersAvailable, fetchOrders]);

  const createOrder = async (description, orderNumber = null) => {
    const payload = { description };
    if (orderNumber) payload.order_number = orderNumber;
    const response = await axios.post(`${API}/orders`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    guardOrder(response.data.id);
    setOrders(prev => [response.data, ...prev]);
    return response.data;
  };

  const updateOrder = async (orderId, data) => {
    guardOrder(orderId);
    const response = await axios.patch(`${API}/orders/${orderId}`, data, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setOrders(prev => prev.map(o => o.id === orderId ? response.data : o));
    return response.data;
  };

  const deleteOrder = async (orderId) => {
    guardOrder(orderId);
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await axios.delete(`${API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrders(true);
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
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrders(true);
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
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrders(true);
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
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrders(true);
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
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      optimisticGuardRef.current.delete(orderId);
      fetchOrders(true);
      throw error;
    }
  };

  return (
    <OrderContext.Provider value={{
      orders, loading, newOrdersAvailable, pauseUpdates, setPauseUpdates,
      refreshOrders, fetchOrders, createOrder, updateOrder, deleteOrder,
      completeOrder, startTimer, pauseTimer, resetTimer
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
