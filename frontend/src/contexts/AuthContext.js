import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  ADMIN_SELECTED_RESTAURANT_KEY,
  clearSessionAuth,
  loadSessionToken,
  saveSessionAuth,
  sessionIdentityMatches,
} from '../utils/authSession';

const AuthContext = createContext(null);

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export const AuthProvider = ({ children }) => {
  const [restaurant, setRestaurant] = useState(null);
  const [token, setToken] = useState(loadSessionToken);
  const [loading, setLoading] = useState(true);
  // Token, identità e locale impersonato vivono tutti nella singola scheda.
  // Un login eseguito in un'altra scheda non può più cambiare account al refresh.
  const [adminSelectedRestaurant, setAdminSelectedRestaurant] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(ADMIN_SELECTED_RESTAURANT_KEY) || 'null');
    } catch {
      sessionStorage.removeItem(ADMIN_SELECTED_RESTAURANT_KEY);
      return null;
    }
  });

  // "Federico" è l'unico supervisore con privilegi pieni tipo admin (vede tutti
  // i locali, pannello admin, dizionario, chiusure excel, ecc.).
  // Altri account "supervisor" (futuri) avranno solo i permessi di base senza
  // i pulsanti admin extra.
  const isSupervisor = restaurant?.role === 'supervisor';
  const isFederico = isSupervisor && restaurant?.username === 'Federico';
  const isAdmin = restaurant?.role === 'admin' || isFederico;
  // Alias storico mantenuto per chiarezza nei call site che vogliono ENTRAMBI.
  const canImpersonate = isAdmin;

  // The effective restaurant: for admin/supervisor it's the selected one, for others it's their own
  const effectiveRestaurant = canImpersonate ? adminSelectedRestaurant : restaurant;

  const selectRestaurant = (rest) => {
    setAdminSelectedRestaurant(rest);
    sessionStorage.setItem(ADMIN_SELECTED_RESTAURANT_KEY, JSON.stringify(rest));
  };

  const clearSelectedRestaurant = () => {
    setAdminSelectedRestaurant(null);
    sessionStorage.removeItem(ADMIN_SELECTED_RESTAURANT_KEY);
  };

  // ===== Axios interceptor: per Admin/Federico invia X-Restaurant-Id del locale impersonato =====
  // Usiamo un ref così l'interceptor è registrato una volta sola ma legge sempre
  // il valore aggiornato di adminSelectedRestaurant.
  const adminRestRef = useRef(adminSelectedRestaurant);
  const isAdminRef = useRef(false);
  useEffect(() => { adminRestRef.current = adminSelectedRestaurant; }, [adminSelectedRestaurant]);
  useEffect(() => {
    const r = restaurant?.role;
    isAdminRef.current = r === 'admin' || (r === 'supervisor' && restaurant?.username === 'Federico');
  }, [restaurant]);
  useEffect(() => {
    const id = axios.interceptors.request.use((config) => {
      try {
        if (isAdminRef.current && adminRestRef.current?.id) {
          config.headers = config.headers || {};
          // X-Restaurant-Id viene letto da `_effective_restaurant_id` (alcuni
          // endpoint specifici come /orders/today-paste-list, /cash/*, ecc.).
          // X-Admin-Restaurant-Id viene letto da `verify_token` per fare
          // l'override del restaurant_id nel JWT (lo usano POST /orders,
          // PATCH /orders, ecc.). DEVONO essere mandati ENTRAMBI per garantire
          // che l'admin lavori sul locale impersonato su tutti gli endpoint.
          //
          // Skip impersonation header on /auth/me so the admin keeps their real
          // identity (role='admin') after a page reload.
          const url = config.url || '';
          const isAuthMe = url.endsWith('/auth/me') || url.includes('/auth/me?');
          if (!isAuthMe) {
            config.headers['X-Restaurant-Id'] = adminRestRef.current.id;
            config.headers['X-Admin-Restaurant-Id'] = adminRestRef.current.id;
          }
        }
      } catch (e) { /* no-op */ }
      return config;
    });
    return () => { axios.interceptors.request.eject(id); };
  }, []);

  const logout = useCallback(() => {
    clearSessionAuth();
    setToken(null);
    setRestaurant(null);
    setAdminSelectedRestaurant(null);
  }, []);

  // Global axios interceptor: auto-logout on 401.
  // NOTA: l'header X-Admin-Restaurant-Id / X-Restaurant-Id viene aggiunto dal
  // primo interceptor (sopra), che usa il ref React isolato per-tab. NON
  // leggere mai più da localStorage qui: era la causa del cross-tenant leak
  // tra tab dell'Admin.
  useEffect(() => {
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
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    const initAuth = async () => {
      if (token) {
        try {
          const response = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (cancelled) return;
          if (!sessionIdentityMatches(response.data?.id)) {
            console.error('Auth identity mismatch: sessione locale non coerente');
            clearSessionAuth();
            setToken(null);
            setRestaurant(null);
            setAdminSelectedRestaurant(null);
            return;
          }
          setRestaurant(response.data);
        } catch (error) {
          if (cancelled) return;
          console.error('Auth error:', error);
          clearSessionAuth();
          setToken(null);
          setRestaurant(null);
          setAdminSelectedRestaurant(null);
        }
      }
      if (!cancelled) setLoading(false);
    };
    initAuth();
    return () => { cancelled = true; };
  }, [token]);

  const login = async (username, password) => {
    const response = await axios.post(`${API}/auth/login`, { username, password });
    const { token: newToken, restaurant: restaurantData } = response.data;
    saveSessionAuth(newToken, restaurantData?.id);
    sessionStorage.removeItem(ADMIN_SELECTED_RESTAURANT_KEY);
    setAdminSelectedRestaurant(null);
    setToken(newToken);
    setRestaurant(restaurantData);
    return restaurantData;
  };

  return (
    <AuthContext.Provider value={{
      restaurant, token, loading, login, logout,
      isAdmin, isSupervisor, isFederico, canImpersonate,
      effectiveRestaurant, adminSelectedRestaurant,
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
