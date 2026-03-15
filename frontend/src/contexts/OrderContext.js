import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const OrderContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Convert http(s) to ws(s)
const WS_URL = BACKEND_URL.replace(/^http/, 'ws');

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
  const pendingEventsRef = useRef([]);

  // Keep refs in sync
  useEffect(() => {
    pauseUpdatesRef.current = pauseUpdates;
  }, [pauseUpdates]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

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
          pendingEventsRef.current = [];
        }
      } else {
        setOrders(response.data);
        setNewOrdersAvailable(false);
        pendingEventsRef.current = [];
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Apply a WebSocket event to orders state
  const applyWsEvent = useCallback((event) => {
    if (pauseUpdatesRef.current) {
      setNewOrdersAvailable(true);
      pendingEventsRef.current.push(event);
      return;
    }

    const { type, order, order_id } = event;

    if (type === 'order_created') {
      setOrders(prev => {
        // Avoid duplicates (optimistic update may have already added it)
        if (prev.some(o => o.id === order.id)) return prev;
        return [order, ...prev];
      });
    } else if (type === 'order_updated') {
      setOrders(prev => prev.map(o => o.id === order.id ? order : o));
    } else if (type === 'order_deleted') {
      setOrders(prev => prev.filter(o => o.id !== order_id));
    }
  }, []);

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (!restaurant?.id) return;

    // Close existing connection
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
        applyWsEvent(data);
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      wsRef.current = null;
      // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 15s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
      reconnectAttemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      ws.close();
    };

    wsRef.current = ws;
  }, [restaurant?.id, applyWsEvent]);

  // Manual refresh function
  const refreshOrders = useCallback(() => {
    fetchOrders(true);
  }, [fetchOrders]);

  // Setup: initial fetch + WebSocket connection
  useEffect(() => {
    if (!restaurant?.id || !token) return;

    // Initial HTTP fetch for full state
    fetchOrders(true);

    // Connect WebSocket for real-time updates
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [restaurant?.id, token, connectWebSocket, fetchOrders]);

  // When pause is lifted, apply pending events
  useEffect(() => {
    if (!pauseUpdates && newOrdersAvailable) {
      // Do a full re-fetch to get consistent state
      fetchOrders(true);
    }
  }, [pauseUpdates, newOrdersAvailable, fetchOrders]);

  const createOrder = async (description, orderNumber = null) => {
    const payload = { description };
    if (orderNumber) {
      payload.order_number = orderNumber;
    }
    const response = await axios.post(
      `${API}/orders`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    // Optimistic update
    setOrders(prev => [response.data, ...prev]);
    return response.data;
  };

  const updateOrder = async (orderId, data) => {
    const response = await axios.patch(
      `${API}/orders/${orderId}`,
      data,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    setOrders(prev => prev.map(o => o.id === orderId ? response.data : o));
    return response.data;
  };

  const deleteOrder = async (orderId) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await axios.delete(`${API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders(true);
      throw error;
    }
  };

  const completeOrder = async (orderId) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, status: 'completed' } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/complete`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders(true);
      throw error;
    }
  };

  const startTimer = async (orderId) => {
    const now = new Date().toISOString();
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_started: true, timer_start_time: now, timer_paused: false } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/start`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders(true);
      throw error;
    }
  };

  const pauseTimer = async (orderId, elapsed) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_paused: true, timer_elapsed: elapsed } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/pause?elapsed=${elapsed}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders(true);
      throw error;
    }
  };

  const resetTimer = async (orderId) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, timer_started: false, timer_start_time: null, timer_paused: false, timer_elapsed: 0 } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/reset`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders(true);
      throw error;
    }
  };

  return (
    <OrderContext.Provider value={{
      orders,
      loading,
      newOrdersAvailable,
      pauseUpdates,
      setPauseUpdates,
      refreshOrders,
      fetchOrders,
      createOrder,
      updateOrder,
      deleteOrder,
      completeOrder,
      startTimer,
      pauseTimer,
      resetTimer
    }}>
      {children}
    </OrderContext.Provider>
  );
};

export const useOrders = () => {
  const context = useContext(OrderContext);
  if (!context) {
    throw new Error('useOrders must be used within OrderProvider');
  }
  return context;
};
