import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const OrderContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export const OrderProvider = ({ children }) => {
  const { token, restaurant } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef(null);

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

  // WebSocket connection
  useEffect(() => {
    if (!restaurant?.id || !token) return;

    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_URL}/ws/${restaurant.id}`);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WS message:', data);
        
        if (data.type === 'order_created') {
          setOrders(prev => [data.order, ...prev]);
        } else if (data.type === 'order_updated') {
          setOrders(prev => prev.map(o => o.id === data.order.id ? data.order : o));
        } else if (data.type === 'order_deleted') {
          setOrders(prev => prev.filter(o => o.id !== data.order_id));
        }
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 3000);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      wsRef.current = ws;
    };

    connectWebSocket();
    fetchOrders();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [restaurant?.id, token, fetchOrders]);

  const createOrder = async (description) => {
    const response = await axios.post(
      `${API}/orders`,
      { description },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data;
  };

  const updateOrder = async (orderId, data) => {
    const response = await axios.patch(
      `${API}/orders/${orderId}`,
      data,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data;
  };

  const deleteOrder = async (orderId) => {
    await axios.delete(`${API}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const completeOrder = async (orderId) => {
    await axios.post(`${API}/orders/${orderId}/complete`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const startTimer = async (orderId) => {
    await axios.post(`${API}/orders/${orderId}/timer/start`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const pauseTimer = async (orderId, elapsed) => {
    await axios.post(`${API}/orders/${orderId}/timer/pause?elapsed=${elapsed}`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const resetTimer = async (orderId) => {
    await axios.post(`${API}/orders/${orderId}/timer/reset`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
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
