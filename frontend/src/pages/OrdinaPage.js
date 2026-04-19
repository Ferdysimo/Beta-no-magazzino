import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Minus, Plus, ShoppingCart, Check } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const OrdinaPage = () => {
  const { location } = useParams();
  const [menu, setMenu] = useState([]);
  const [locationLabel, setLocationLabel] = useState('');
  const [cart, setCart] = useState({});
  const [customerName, setCustomerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API}/public/menu/${location}`);
        setMenu(res.data.menu || []);
        setLocationLabel(res.data.location || '');
      } catch (e) {
        setError(e.response?.data?.detail || 'Locale non trovato');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [location]);

  const total = useMemo(
    () => menu.reduce((s, m) => s + (cart[m.id] || 0) * (m.price || 0), 0),
    [cart, menu]
  );
  const totalItems = useMemo(
    () => Object.values(cart).reduce((s, v) => s + (v || 0), 0),
    [cart]
  );

  const setQty = (id, qty) => {
    const n = Math.max(0, Math.floor(Number(qty) || 0));
    setCart(c => {
      const nc = { ...c };
      if (n <= 0) delete nc[id];
      else nc[id] = n;
      return nc;
    });
  };
  const inc = (id) => setQty(id, (cart[id] || 0) + 1);
  const dec = (id) => setQty(id, (cart[id] || 0) - 1);

  const handleConfirm = async () => {
    if (!customerName.trim()) {
      alert('Inserisci il tuo nome');
      return;
    }
    const items = menu
      .filter(m => cart[m.id] > 0)
      .map(m => ({ id: m.id, name: m.name, quantity: cart[m.id] }));
    if (items.length === 0) {
      alert('Aggiungi almeno una pasta al carrello');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(`${API}/public/order`, {
        location_slug: location,
        customer_name: customerName.trim(),
        items,
      });
      setConfirmation(res.data);
      setCart({});
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore invio ordine');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#F5C518]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5] p-4">
        <div className="bg-white rounded-xl p-8 text-center max-w-sm">
          <div className="text-4xl mb-3">🚫</div>
          <div className="font-bold text-gray-900 text-lg">{error}</div>
          <div className="text-sm text-gray-500 mt-2">Controlla il QR code e riprova.</div>
        </div>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center max-w-sm w-full" data-testid="order-confirmation">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500 flex items-center justify-center mb-4">
            <Check size={36} className="text-white" />
          </div>
          <div className="font-heading text-2xl font-bold text-gray-900 mb-1">Ordine ricevuto!</div>
          <div className="text-sm text-gray-500 mb-4">{confirmation.location}</div>

          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Il tuo numero</div>
            <div className="font-heading text-5xl font-bold text-[#F5C518]">{confirmation.display_code}</div>
          </div>

          <div className="text-sm text-gray-700 mb-4">
            <div className="font-semibold">{confirmation.customer_name}</div>
            <div className="text-gray-500">{confirmation.description.split(' — ')[0]}</div>
          </div>

          <div className="text-xs text-gray-500 mb-6">
            Ti chiameremo per nome o mostreremo il tuo numero sul monitor quando è pronto.
          </div>

          <button
            onClick={() => { setConfirmation(null); setCustomerName(''); }}
            className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-gray-700"
          >
            Fai un altro ordine
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-40">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#F5C518] to-[#F5A518] text-gray-900 px-5 pt-8 pb-12">
        <img src="/logo-icon.png" alt="Pastasciutta" className="h-14 mb-3" />
        <div className="font-heading text-3xl font-bold tracking-tight">— Pastasciutta —</div>
        <div className="text-sm tracking-[0.3em] uppercase opacity-80">Roma · {locationLabel}</div>
        <div className="text-xs mt-3 bg-white/30 rounded-full inline-block px-3 py-1">
          Ordina e ritira al banco
        </div>
      </div>

      <main className="max-w-md mx-auto p-4 -mt-6">
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Il tuo nome</label>
          <input
            data-testid="customer-name"
            type="text"
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            placeholder="es. Marco"
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#F5C518] focus:border-transparent"
          />
        </div>

        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3 px-1">Menu</h2>
        <div className="space-y-3">
          {menu.map(m => {
            const qty = cart[m.id] || 0;
            return (
              <div
                key={m.id}
                data-testid={`menu-${m.id}`}
                className={`bg-white rounded-xl p-4 flex items-center gap-3 shadow-sm border ${qty > 0 ? 'border-[#F5C518] ring-2 ring-[#F5C518]/30' : 'border-gray-200'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900 text-lg leading-tight">{m.name}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{m.price.toFixed(2)} €</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    data-testid={`dec-${m.id}`}
                    onClick={() => dec(m.id)}
                    disabled={qty === 0}
                    className="w-11 h-11 flex items-center justify-center bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-gray-700 active:scale-95 transition-transform"
                  >
                    <Minus size={22} />
                  </button>
                  <div className="w-10 text-center text-xl font-bold text-gray-900">{qty}</div>
                  <button
                    data-testid={`inc-${m.id}`}
                    onClick={() => inc(m.id)}
                    className="w-11 h-11 flex items-center justify-center bg-[#F5C518] hover:bg-[#E5B418] rounded-lg text-gray-900 active:scale-95 transition-transform"
                  >
                    <Plus size={22} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 py-3 shadow-lg">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ShoppingCart size={22} className="text-gray-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-xs text-gray-500">{totalItems} piatt{totalItems === 1 ? 'o' : 'i'}</div>
              <div className="font-bold text-gray-900">{total.toFixed(2)} €</div>
            </div>
          </div>
          <button
            data-testid="btn-conferma-ordine"
            onClick={handleConfirm}
            disabled={totalItems === 0 || submitting || !customerName.trim()}
            className="px-6 py-3 bg-gradient-to-r from-[#F5C518] to-[#F5A518] hover:from-[#F5A518] hover:to-[#E59500] disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 font-bold rounded-lg shadow"
          >
            {submitting ? 'Invio...' : 'Conferma ordine'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrdinaPage;
