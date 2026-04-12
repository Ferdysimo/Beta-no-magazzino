import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const AuthProvider = ({ children }) => {
  const [restaurant, setRestaurant] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [adminSelectedRestaurant, setAdminSelectedRestaurant] = useState(
    JSON.parse(localStorage.getItem('admin_selected_restaurant') || 'null')
  );

  const isAdmin = restaurant?.role === 'admin';

  // The effective restaurant: for admin it's the selected one, for others it's their own
  const effectiveRestaurant = isAdmin ? adminSelectedRestaurant : restaurant;

  const selectRestaurant = (rest) => {
    setAdminSelectedRestaurant(rest);
    localStorage.setItem('admin_selected_restaurant', JSON.stringify(rest));
  };

  const clearSelectedRestaurant = () => {
    setAdminSelectedRestaurant(null);
    localStorage.removeItem('admin_selected_restaurant');
  };

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('admin_selected_restaurant');
    setToken(null);
    setRestaurant(null);
    setAdminSelectedRestaurant(null);
  }, []);

  // Global axios interceptor: auto-logout on 401, add admin header
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const adminRest = JSON.parse(localStorage.getItem('admin_selected_restaurant') || 'null');
      if (adminRest) {
        config.headers['X-Admin-Restaurant-Id'] = adminRest.id;
      }
      return config;
    });

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          console.warn('Token expired or invalid, logging out');
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [logout]);

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        try {
          const response = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setRestaurant(response.data);
        } catch (error) {
          console.error('Auth error:', error);
          localStorage.removeItem('token');
          setToken(null);
        }
      }
      setLoading(false);
    };
    initAuth();
  }, [token]);

  const login = async (username, password) => {
    const response = await axios.post(`${API}/auth/login`, { username, password });
    const { token: newToken, restaurant: restaurantData } = response.data;
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setRestaurant(restaurantData);
    return restaurantData;
  };

  return (
    <AuthContext.Provider value={{
      restaurant, token, loading, login, logout,
      isAdmin, effectiveRestaurant, adminSelectedRestaurant,
      selectRestaurant, clearSelectedRestaurant
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
