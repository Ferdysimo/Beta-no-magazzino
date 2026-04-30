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

  const fetchSales = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/beverages/sales/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRows(res.data);
    } catch (e) {
      console.error('bev today err', e);
    }
  }, [token]);

  useEffect(() => {
    fetchSales();
    const iv = setInterval(fetchSales, 15000);
    return () => clearInterval(iv);
  }, [fetchSales]);

  const change = async (sigla, delta) => {
    if (busy[sigla]) return;
    // Optimistic update
    setRows(prev => prev.map(r => {
      if (r.sigla !== sigla) return r;
      const newCount = Math.max(0, r.count + delta);
      if (newCount === r.count) return r; // no-op (minus at 0)
      return { ...r, count: newCount, inventory: r.inventory - delta };
    }));
    setBusy(b => ({ ...b, [sigla]: true }));
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
      // Revert optimistic on error and re-fetch truth
      await fetchSales();
    } finally {
      setBusy(b => ({ ...b, [sigla]: false }));
    }
  };

  if (rows.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400 text-center">Caricamento bevande...</div>
    );
  }

  return (
    <div className="p-2" data-testid="cassa-bev-box">
      <div className="space-y-1">
        {rows.map((r) => {
          const isBusy = !!busy[r.sigla];
          const lowStock = r.inventory <= 5;
          return (
            <div
              key={r.sigla}
              data-testid={`bev-row-cassa-${r.sigla}`}
              className="flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1.5"
            >
              <div className="w-9 font-extrabold text-gray-900 text-lg leading-none">{r.sigla}</div>
              <div className={`flex-1 text-center font-bold text-xl tabular-nums ${r.count > 0 ? 'text-[#B8860B]' : 'text-gray-400'}`}>
                {r.count}
              </div>
              <div className={`text-[10px] font-medium tabular-nums hidden sm:block ${lowStock ? 'text-red-600' : 'text-gray-400'}`} title="Giacenza">
                /{r.inventory}
              </div>
              <button
                onClick={() => change(r.sigla, -1)}
                disabled={r.count === 0 || isBusy}
                data-testid={`bev-minus-cassa-${r.sigla}`}
                className="w-8 h-8 flex items-center justify-center bg-gray-200 hover:bg-gray-300 disabled:opacity-30 disabled:cursor-not-allowed rounded text-gray-800"
                aria-label={`Storna ${r.sigla}`}
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => change(r.sigla, 1)}
                disabled={isBusy}
                data-testid={`bev-plus-cassa-${r.sigla}`}
                className="w-8 h-8 flex items-center justify-center bg-[#F5C518] hover:bg-[#E5A500] disabled:opacity-40 text-gray-900 font-bold rounded"
                aria-label={`Aggiungi ${r.sigla}`}
              >
                <Plus size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CassaBevandeBox;
