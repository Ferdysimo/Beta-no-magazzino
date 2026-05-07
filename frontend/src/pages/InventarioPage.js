import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Search, Check, X, Pencil, History } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImage = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

const InventarioPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [savingId, setSavingId] = useState(null);

  const isAdmin = restaurant?.role === 'admin';

  // Role guard: only magazziniere/admin
  useEffect(() => {
    if (restaurant && restaurant.role !== 'magazzino' && restaurant.role !== 'admin') {
      navigate('/home', { replace: true });
    }
  }, [restaurant, navigate]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await axios.get(`${API}/products`, { headers: { Authorization: `Bearer ${token}` } });
        setProducts(res.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [token]);

  const suppliers = useMemo(() => {
    const s = new Set();
    products.forEach(p => p.supplier && s.add(p.supplier));
    return Array.from(s).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (supplierFilter && p.supplier !== supplierFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, supplierFilter]);

  const totalStock = useMemo(
    () => filtered.reduce((s, p) => s + (Number(p.quantity) || 0), 0),
    [filtered]
  );

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditValue(String(p.quantity ?? 0));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };
  const saveEdit = async (p) => {
    const n = parseInt(editValue, 10);
    if (Number.isNaN(n) || n < 0) {
      alert('Inserisci un numero intero >= 0');
      return;
    }
    setSavingId(p.id);
    try {
      const res = await axios.patch(
        `${API}/products/${p.id}/quantity`,
        { quantity: n },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setProducts(list => list.map(x => x.id === p.id ? { ...x, quantity: res.data.quantity } : x));
      cancelEdit();
    } catch (err) {
      alert(err.response?.data?.detail || 'Errore salvataggio');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Inventario / Forza il sistema
          </h1>
          <button
            onClick={() => navigate('/magazzino')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna al magazzino
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="inventario-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca prodotto..."
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#F5C518] focus:border-transparent"
            />
          </div>
          <select
            data-testid="inventario-filter-supplier"
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">Tutti i fornitori</option>
            {suppliers.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>

        {/* Summary */}
        <div className="mb-4 text-sm text-gray-600">
          <strong className="text-gray-900">{filtered.length}</strong> prodott{filtered.length === 1 ? 'o' : 'i'} ·{' '}
          <strong className="text-gray-900">{totalStock}</strong> unità totali a magazzino
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Desktop header */}
          <div className="hidden sm:flex items-center px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-bold uppercase tracking-wide text-gray-600">
            <div className="w-16">Foto</div>
            <div className="flex-1 px-3">Prodotto</div>
            <div className="w-32">Unità</div>
            <div className="w-48">Fornitore</div>
            <div className="w-40 text-right">Quantità</div>
          </div>

          {loading ? (
            <div className="p-6 text-center text-gray-400">Caricamento...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">Nessun prodotto trovato.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(p => (
                <li
                  key={p.id}
                  data-testid={`inventario-row-${p.id}`}
                  className="flex flex-col sm:flex-row sm:items-center px-3 sm:px-4 py-3 gap-2 sm:gap-0"
                >
                  <div className="w-16 h-16 sm:w-12 sm:h-12 rounded-md bg-gray-50 overflow-hidden border border-gray-100 flex-shrink-0">
                    {p.image_url ? (
                      <img src={resolveImage(p.image_url)} alt={p.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-[10px]">No foto</div>
                    )}
                  </div>
                  <div className="flex-1 px-0 sm:px-3 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 sm:hidden">
                      {p.unit || '—'} · {p.supplier || '—'}
                    </div>
                  </div>
                  <div className="w-32 text-sm text-gray-600 hidden sm:block">{p.unit || '—'}</div>
                  <div className="w-48 text-sm text-gray-600 hidden sm:block truncate">{p.supplier || '—'}</div>
                  <div className="w-full sm:w-40 sm:text-right">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-1 sm:justify-end">
                        <input
                          data-testid={`inv-edit-input-${p.id}`}
                          type="number"
                          min="0"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value.replace(/[^0-9]/g, ''))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEdit(p);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                          className="w-20 h-8 px-2 border border-blue-300 rounded-md text-sm text-right focus:ring-2 focus:ring-blue-400 focus:outline-none"
                        />
                        <button
                          data-testid={`inv-save-${p.id}`}
                          onClick={() => saveEdit(p)}
                          disabled={savingId === p.id}
                          className="w-8 h-8 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white rounded-md disabled:opacity-50"
                          title="Salva"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="w-8 h-8 flex items-center justify-center bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-md"
                          title="Annulla"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 sm:justify-end">
                        <span className="inline-flex items-center px-3 py-1 rounded-md text-sm font-bold bg-blue-50 text-blue-700 border border-blue-100">
                          {p.quantity ?? 0}
                        </span>
                        <button
                          data-testid={`inv-history-btn-${p.id}`}
                          onClick={() => navigate(`/magazzino/cronologia?product=${p.id}`)}
                          className="w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 rounded-md"
                          title="Vedi cronologia movimenti"
                        >
                          <History size={14} />
                        </button>
                        {isAdmin && (
                          <button
                            data-testid={`inv-edit-btn-${p.id}`}
                            onClick={() => startEdit(p)}
                            className="w-8 h-8 flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-md"
                            title="Forza quantità (Admin)"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-4 text-xs text-gray-400">
          {isAdmin
            ? 'Modalità Admin: puoi forzare/sovrascrivere le quantità a magazzino (cliccando la matita).'
            : 'Sola visualizzazione — la modifica delle quantità è riservata all\'Admin.'}
        </p>
      </main>
    </div>
  );
};

export default InventarioPage;
