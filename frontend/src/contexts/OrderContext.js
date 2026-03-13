import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const OrderContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const OrderProvider = ({ children }) => {
  const { token, restaurant } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Polling for real-time updates (more reliable than WebSocket in some environments)
  useEffect(() => {
    if (!restaurant?.id || !token) return;

    // Initial fetch
    fetchOrders();

    // Poll every 2 seconds for updates
    pollingRef.current = setInterval(() => {
      fetchOrders();
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [restaurant?.id, token, fetchOrders]);

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
    // Optimistic update - add to front of list
    setOrders(prev => [response.data, ...prev]);
    return response.data;
  };

  const updateOrder = async (orderId, data) => {
    const response = await axios.patch(
      `${API}/orders/${orderId}`,
      data,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    // Optimistic update
    setOrders(prev => prev.map(o => o.id === orderId ? response.data : o));
    return response.data;
  };

  const deleteOrder = async (orderId) => {
    // Optimistic update - remove immediately from UI
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await axios.delete(`${API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      // Revert on error - refetch orders
      fetchOrders();
      throw error;
    }
  };

  const completeOrder = async (orderId) => {
    // Optimistic update
    setOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, status: 'completed' } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/complete`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders();
      throw error;
    }
  };

  const startTimer = async (orderId) => {
    const now = new Date().toISOString();
    // Optimistic update
    setOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, timer_started: true, timer_start_time: now, timer_paused: false } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/start`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders();
      throw error;
    }
  };

  const pauseTimer = async (orderId, elapsed) => {
    // Optimistic update
    setOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, timer_paused: true, timer_elapsed: elapsed } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/pause?elapsed=${elapsed}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders();
      throw error;
    }
  };

  const resetTimer = async (orderId) => {
    // Optimistic update
    setOrders(prev => prev.map(o => 
      o.id === orderId ? { ...o, timer_started: false, timer_start_time: null, timer_paused: false, timer_elapsed: 0 } : o
    ));
    try {
      await axios.post(`${API}/orders/${orderId}/timer/reset`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      fetchOrders();
      throw error;
    }
  };

  return (
    <OrderContext.Provider value={{
      orders,
      loading,
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
