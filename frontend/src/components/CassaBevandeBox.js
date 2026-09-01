import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Plus, Minus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CassaBevandeBox = () => {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState({});
  const [loaded, setLoaded] = useState(false);

  const fetchSales = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/beverages/sales/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRows(res.data || []);
    } catch (e) {
      console.error('bev today err', e);
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    fetchSales();
    const iv = setInterval(fetchSales, 15000);
    return () => clearInterval(iv);
  }, [fetchSales]);

  const change = useCallback(async (sigla, delta) => {
    const current = rows.find(row => row.sigla === sigla);
    if (!current || busy[sigla] || (delta < 0 && current.count <= 0)) return;
    setBusy(b => ({ ...b, [sigla]: true }));
    setRows(prev => prev.map(r => {
      if (r.sigla !== sigla) return r;
      const newCount = Math.max(0, r.count + delta);
      return {
        ...r,
        count: newCount,
        inventory: Number(r.inventory || 0) - delta,
      };
    }));
    try {
      if (delta > 0) {
        await axios.post(`${API}/beverages/sales`, { sigla }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await axios.post(`${API}/beverages/sales/undo`, { sigla }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (e) {
      await fetchSales();
    } finally {
      setBusy(b => ({ ...b, [sigla]: false }));
    }
  }, [token, fetchSales, rows, busy]);

  if (!loaded) {
    return (
      <div className="p-3 text-xs text-gray-400 text-center">Caricamento bevande...</div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 text-center">Nessuna bevanda nel dizionario.</div>
    );
  }

  return (
    <div className="p-2.5" data-testid="cassa-bev-box">
      <div className="space-y-2">
        {rows.map((r) => {
          const isBusy = !!busy[r.sigla];
          return (
            <div
              key={r.sigla}
              data-testid={`bev-row-cassa-${r.sigla}`}
              className="grid grid-cols-[minmax(0,1fr)_36px_42px_36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-sm"
            >
              <div className="min-w-0 pr-1">
                <div className="truncate text-sm font-bold leading-tight text-gray-900" title={r.name}>{r.name}</div>
                <div className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-gray-500">{r.sigla}</div>
              </div>
              <button
                onClick={() => change(r.sigla, -1)}
                disabled={r.count === 0 || isBusy}
                data-testid={`bev-minus-cassa-${r.sigla}`}
                className="flex h-9 w-9 items-center justify-center rounded-md bg-red-600 text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Storna ${r.sigla}`}
              >
                <Minus size={18} strokeWidth={3} />
              </button>
              <div
                data-testid={`bev-count-cassa-${r.sigla}`}
                aria-live="polite"
                className={`flex h-9 items-center justify-center rounded-md border text-xl font-black tabular-nums ${r.count > 0 ? 'border-gray-400 bg-gray-900 text-white' : 'border-gray-300 bg-gray-50 text-gray-500'}`}
              >
                {r.count}
              </div>
              <button
                onClick={() => change(r.sigla, 1)}
                disabled={isBusy}
                data-testid={`bev-plus-cassa-${r.sigla}`}
                className="flex h-9 w-9 items-center justify-center rounded-md bg-green-600 text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`Aggiungi ${r.sigla}`}
              >
                <Plus size={18} strokeWidth={3} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CassaBevandeBox;
