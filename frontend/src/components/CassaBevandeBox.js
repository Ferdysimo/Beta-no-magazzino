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
  const [selectedIdx, setSelectedIdx] = useState(0);

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

  const change = useCallback(async (sigla, delta) => {
    if (!sigla) return;
    setBusy(b => {
      if (b[sigla]) return b;
      return { ...b, [sigla]: true };
    });
    let proceeded = false;
    setRows(prev => prev.map(r => {
      if (r.sigla !== sigla) return r;
      const newCount = Math.max(0, r.count + delta);
      if (newCount === r.count) return r;
      proceeded = true;
      return { ...r, count: newCount, inventory: r.inventory - delta };
    }));
    if (!proceeded) {
      setBusy(b => ({ ...b, [sigla]: false }));
      return;
    }
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
  }, [token, fetchSales]);

  // Keyboard navigation: Up/Down to move selection, Right/Left to +/- selected.
  // We ignore the event when focus is inside an INPUT/TEXTAREA so that typing
  // an order description on the Cassa is not hijacked.
  useEffect(() => {
    if (rows.length === 0) return undefined;
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (editable) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(rows.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = rows[selectedIdx];
        if (cur) change(cur.sigla, 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const cur = rows[selectedIdx];
        if (cur) change(cur.sigla, -1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rows, selectedIdx, change]);

  // Keep selectedIdx in range if rows shrink (defensive)
  useEffect(() => {
    if (selectedIdx >= rows.length && rows.length > 0) {
      setSelectedIdx(rows.length - 1);
    }
  }, [rows, selectedIdx]);

  if (rows.length === 0) {
    return (
      <div className="p-3 text-xs text-gray-400 text-center">Caricamento bevande...</div>
    );
  }

  return (
    <div className="p-2" data-testid="cassa-bev-box">
      <div className="px-1 pb-1 text-[10px] text-gray-500 leading-tight">
        ↑↓ scegli &nbsp;·&nbsp; ← - &nbsp; → +
      </div>
      <div className="space-y-1">
        {rows.map((r, idx) => {
          const isBusy = !!busy[r.sigla];
          const lowStock = r.inventory <= 5;
          const selected = idx === selectedIdx;
          return (
            <div
              key={r.sigla}
              data-testid={`bev-row-cassa-${r.sigla}`}
              onClick={() => setSelectedIdx(idx)}
              className={`flex items-center gap-2 border rounded px-2 py-1.5 cursor-pointer transition-colors ${
                selected
                  ? 'bg-yellow-50 border-[#F5C518] ring-2 ring-[#F5C518]'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
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
