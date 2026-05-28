import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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

  // ===== Axios interceptor: per Admin invia X-Restaurant-Id del locale impersonato =====
  // Usiamo un ref così l'interceptor è registrato una volta sola ma legge sempre
  // il valore aggiornato di adminSelectedRestaurant.
  const adminRestRef = useRef(adminSelectedRestaurant);
  const isAdminRef = useRef(false);
  useEffect(() => { adminRestRef.current = adminSelectedRestaurant; }, [adminSelectedRestaurant]);
  useEffect(() => { isAdminRef.current = restaurant?.role === 'admin'; }, [restaurant]);
  useEffect(() => {
    const id = axios.interceptors.request.use((config) => {
      try {
        if (isAdminRef.current && adminRestRef.current?.id) {
          config.headers = config.headers || {};
          config.headers['X-Restaurant-Id'] = adminRestRef.current.id;
        }
      } catch (e) { /* no-op */ }
      return config;
    });
    return () => { axios.interceptors.request.eject(id); };
  }, []);

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
      // Skip impersonation header on /auth/me so the admin keeps their real
      // identity (role='admin') after a page reload.
      const url = config.url || '';
      const isAuthMe = url.endsWith('/auth/me') || url.includes('/auth/me?');
      if (adminRest && !isAuthMe) {
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
