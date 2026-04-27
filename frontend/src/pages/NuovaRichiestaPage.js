import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Search, Minus, Plus, X } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImageSrc = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

const NuovaRichiestaPage = () => {
  const { token, restaurant, effectiveRestaurant, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [cart, setCart] = useState({}); // product_id -> qty
  const [submitting, setSubmitting] = useState(false);
  const [keypadProductId, setKeypadProductId] = useState(null);
  const [keypadValue, setKeypadValue] = useState('');
  const [extraNote, setExtraNote] = useState('');

  const headers = () => {
    const h = { Authorization: `Bearer ${token}` };
    if (isAdmin && effectiveRestaurant?.id) {
      h['X-Admin-Restaurant-Id'] = effectiveRestaurant.id;
    }
    return h;
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API}/warehouse/products`, { headers: headers() });
      setProducts(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suppliers = useMemo(() => {
    const set = new Set();
    products.forEach(p => p.supplier && set.add(p.supplier));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter(p => {
      if (supplierFilter && p.supplier !== supplierFilter) return false;
      if (s && !p.name.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [products, search, supplierFilter]);

  const totalItems = useMemo(
    () => Object.values(cart).filter(v => v > 0).length,
    [cart]
  );

  const hasExtra = extraNote.trim().length > 0;

  const setQty = (productId, qty) => {
    const n = Math.max(0, Math.floor(Number(qty) || 0));
    setCart(c => {
      const next = { ...c };
      if (n <= 0) delete next[productId];
      else next[productId] = n;
      return next;
    });
  };

  const increment = (p) => setQty(p.id, (cart[p.id] || 0) + 1);
  const decrement = (p) => setQty(p.id, (cart[p.id] || 0) - 1);

  const openKeypad = (p) => {
    setKeypadProductId(p.id);
    setKeypadValue(String(cart[p.id] || ''));
  };

  const closeKeypad = () => {
    setKeypadProductId(null);
    setKeypadValue('');
  };

  const confirmKeypad = () => {
    if (keypadProductId) setQty(keypadProductId, keypadValue);
    closeKeypad();
  };

  const handleSubmit = async () => {
    const items = products
      .filter(p => cart[p.id] > 0)
      .map(p => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit || '',
        supplier: p.supplier || '',
        quantity: cart[p.id],
      }));

    if (items.length === 0 && !extraNote.trim()) {
      alert('Seleziona almeno un prodotto o scrivi qualcosa nel campo Extra.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API}/richieste`,
        { items, extra_note: extraNote.trim() || null },
        { headers: headers() }
      );
      navigate(`/ddt/${res.data.id}`);
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore invio richiesta');
    } finally {
      setSubmitting(false);
    }
  };

  const showLocation = effectiveRestaurant?.location || restaurant?.location;

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-28">
      <Header />
      <main className="max-w-3xl mx-auto p-3 sm:p-6">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 mb-4 uppercase">
          Nuova richiesta · {showLocation}
        </h1>

        {/* Sticky filters */}
        <div className="sticky top-0 z-10 bg-[#F5F5F5] pt-1 pb-3 space-y-2">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              data-testid="richiesta-search"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca prodotto..."
              className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#F5C518] focus:border-transparent"
            />
          </div>
          <select
            data-testid="richiesta-filter-supplier"
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">Tutti i fornitori</option>
            {suppliers.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>

        {/* Product cards */}
        {loading ? (
          <div className="text-center text-gray-400 py-10">Caricamento prodotti...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-10 text-sm">Nessun prodotto trovato.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(p => {
              const qty = cart[p.id] || 0;
              return (
                <div
                  key={p.id}
                  data-testid={`prod-card-${p.id}`}
                  className={`bg-white border rounded-xl p-3 flex items-start gap-3 shadow-sm transition-all ${qty > 0 ? 'border-[#F5C518] ring-2 ring-[#F5C518]/30' : 'border-gray-200'}`}
                >
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-100">
                    {p.image_url ? (
                      <img src={resolveImageSrc(p.image_url)} alt={p.name} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No foto</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 leading-tight">
                      {p.name}
                      {p.unit && <span className="text-gray-500 font-normal ml-1">({p.unit})</span>}
                    </div>
                    {p.supplier && <div className="text-xs text-gray-500 mt-0.5">{p.supplier}</div>}
                    <div className="flex gap-2 mt-1.5 text-[11px]">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                        Magazzino: <strong className="ml-1">{p.quantity ?? 0}</strong>
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                        Reali: <strong className="ml-1">{p.real_quantity ?? 0}</strong>
                      </span>
                    </div>

                    {/* Quantity picker */}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`dec-${p.id}`}
                        onClick={() => decrement(p)}
                        className="w-11 h-11 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 border border-gray-200 active:scale-95 transition-transform"
                      >
                        <Minus size={22} />
                      </button>
                      <button
                        type="button"
                        data-testid={`qty-${p.id}`}
                        onClick={() => openKeypad(p)}
                        className={`w-16 h-11 flex items-center justify-center rounded-lg border text-lg font-bold transition-colors ${qty > 0 ? 'bg-[#F5C518] border-[#F5C518] text-gray-900' : 'bg-white border-gray-300 text-gray-600'}`}
                      >
                        {qty}
                      </button>
                      <button
                        type="button"
                        data-testid={`inc-${p.id}`}
                        onClick={() => increment(p)}
                        className="w-11 h-11 flex items-center justify-center bg-[#F5C518] hover:bg-[#E5B418] rounded-lg text-gray-900 border border-[#E5B418] active:scale-95 transition-transform"
                      >
                        <Plus size={22} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Extra free-text card — sits at the very bottom of the product list */}
        <div className="mt-4 bg-white border-2 border-dashed border-[#F5C518] rounded-xl p-4 shadow-sm">
          <label htmlFor="extra-note-input" className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F5C518] text-gray-900 font-bold text-sm">+</span>
            <span className="font-bold text-gray-900">Extra</span>
            <span className="text-xs text-gray-500">(qualsiasi cosa non in lista — verrà aggiunto in fondo alla bolla)</span>
          </label>
          <textarea
            id="extra-note-input"
            data-testid="richiesta-extra-note"
            value={extraNote}
            onChange={e => setExtraNote(e.target.value)}
            placeholder="Es. 2 cassette pomodoro Pachino, 1 pacco di sale grosso..."
            rows={3}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base resize-y focus:ring-2 focus:ring-[#F5C518] focus:border-transparent"
          />
          {hasExtra && (
            <div className="mt-2 text-xs text-emerald-700 font-medium">
              ✓ Aggiunto come nota libera
            </div>
          )}
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 py-3 shadow-lg z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-500">Prodotti / extra</div>
            <div className="font-bold text-gray-900">
              {totalItems}
              {hasExtra && <span className="ml-1 text-[#F5C518]">+ extra</span>}
            </div>
          </div>
          <button
            onClick={() => navigate('/richiesta-merce')}
            className="px-4 py-3 text-sm text-gray-600 hover:text-gray-900"
          >
            Annulla
          </button>
          <button
            data-testid="btn-invia-richiesta"
            onClick={handleSubmit}
            disabled={(totalItems === 0 && !hasExtra) || submitting}
            className="flex-1 px-5 py-3 bg-gradient-to-r from-[#F5C518] to-[#F5A518] hover:from-[#F5A518] hover:to-[#E59500] disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-bold rounded-lg shadow"
          >
            {submitting ? 'Invio...' : 'INVIA RICHIESTA'}
          </button>
        </div>
      </div>

      {/* Numeric keypad modal */}
      {keypadProductId && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={closeKeypad}>
          <div className="bg-white rounded-xl w-full max-w-xs p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-gray-800">Quantità</div>
              <button onClick={closeKeypad} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <input
              data-testid="keypad-input"
              type="number"
              inputMode="numeric"
              autoFocus
              value={keypadValue}
              onChange={e => setKeypadValue(e.target.value)}
              className="w-full text-3xl text-center font-bold border-2 border-[#F5C518] rounded-lg py-3 mb-3"
            />
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9'].map(k => (
                <button key={k} onClick={() => setKeypadValue(v => v + k)}
                  className="py-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-xl font-bold">{k}</button>
              ))}
              <button onClick={() => setKeypadValue('')} className="py-4 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold">C</button>
              <button onClick={() => setKeypadValue(v => v + '0')} className="py-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-xl font-bold">0</button>
              <button onClick={() => setKeypadValue(v => v.slice(0, -1))} className="py-4 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold">⌫</button>
            </div>
            <button
              data-testid="keypad-confirm"
              onClick={confirmKeypad}
              className="w-full mt-3 py-3 bg-[#F5C518] hover:bg-[#E5B418] rounded-lg font-bold text-gray-900"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NuovaRichiestaPage;
