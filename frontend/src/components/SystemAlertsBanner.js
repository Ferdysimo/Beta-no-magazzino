import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const SystemAlertsBanner = () => {
  const { token, isAdmin } = useAuth();
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    const fetchAlerts = async () => {
      try {
        const res = await axios.get(`${API}/admin/system-alerts`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setAlerts(res.data.alerts || []);
      } catch (e) {
        console.error('Failed to fetch system alerts', e);
      }
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [isAdmin, token]);

  const acknowledge = async (alertId) => {
    try {
      await axios.post(`${API}/admin/system-alerts/${alertId}/acknowledge`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (e) {
      console.error('Failed to acknowledge alert', e);
    }
  };

  if (!isAdmin || alerts.length === 0) return null;

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 pt-4" data-testid="system-alerts-banner">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className="mb-3 bg-red-100 border-2 border-red-500 text-red-900 rounded-lg p-4 flex items-start gap-3"
          data-testid={`alert-${alert.type}`}
        >
          <div className="text-2xl leading-none">⚠️</div>
          <div className="flex-1">
            <div className="font-bold text-base">
              {alert.type === 'stale_orders_recovered'
                ? `Reset di mezzanotte non eseguito — ${alert.stale_count} ordini di ieri archiviati automaticamente all'avvio`
                : 'Avviso di sistema'}
            </div>
            <div className="text-sm mt-1">
              {alert.type === 'stale_orders_recovered' && alert.per_restaurant && Object.keys(alert.per_restaurant).length > 0 && (
                <span>
                  Per locale: {Object.entries(alert.per_restaurant).map(([loc, n]) => `${loc} (${n})`).join(', ')}
                </span>
              )}
            </div>
            <div className="text-xs text-red-700 mt-1">Rilevato: {formatDate(alert.created_at)}</div>
          </div>
          <button
            onClick={() => acknowledge(alert.id)}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded font-semibold text-sm whitespace-nowrap"
            data-testid={`alert-ack-${alert.id}`}
          >
            Ho capito
          </button>
        </div>
      ))}
    </div>
  );
};

export default SystemAlertsBanner;
