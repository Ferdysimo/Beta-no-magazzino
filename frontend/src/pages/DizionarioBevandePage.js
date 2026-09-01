import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, RotateCcw, Save } from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DEFAULT_BEVERAGES = [
  { sigla: 'AL', name: 'Acqua naturale', price: 1 },
  { sigla: 'AG', name: 'Acqua leggermente frizzante', price: 1 },
  { sigla: 'C', name: 'Coca-Cola', price: 2 },
  { sigla: 'CZ', name: 'Coca-Cola Zero', price: 2 },
  { sigla: 'F', name: 'Fanta', price: 2 },
  { sigla: 'S', name: 'Sprite', price: 2 },
  { sigla: 'B', name: 'Peroni', price: 2.5 },
  { sigla: 'VB', name: 'Vino bianco', price: 2.5 },
  { sigla: 'VR', name: 'Vino rosso', price: 2.5 },
];

const money = value => Number(value || 0).toLocaleString('it-IT', {
  style: 'currency',
  currency: 'EUR',
});

const DizionarioBevandePage = () => {
  const navigate = useNavigate();
  const { token, canImpersonate } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(
    () => localStorage.getItem('beverage_price_rest_id') || ''
  );
  const [rows, setRows] = useState([]);
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');

  const effectiveRestId = selectedRestId || restaurants[0]?.id || '';
  const selectedRestaurant = restaurants.find(item => item.id === effectiveRestId);

  useEffect(() => {
    if (!canImpersonate || !token) return;
    axios.get(`${API}/admin/restaurants`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      setRestaurants((response.data || []).filter(item => (
        item.role !== 'admin' && item.role !== 'supervisor'
      )));
    }).catch((error) => {
      console.error('list restaurants', error);
      setMessage('Impossibile caricare i locali.');
    });
  }, [canImpersonate, token]);

  useEffect(() => {
    if (!canImpersonate || !token || !effectiveRestId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessage('');
    axios.get(`${API}/beverage-price-dictionary?restaurant_id=${effectiveRestId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => {
      if (cancelled) return;
      const list = (response.data?.beverages || []).map(item => ({
        sigla: String(item.sigla || '').toUpperCase(),
        name: item.name || item.sigla,
        price: Number(item.price) || 0,
      }));
      setRows(list.length ? list : DEFAULT_BEVERAGES);
      setIsDefault(!!response.data?.is_default);
      setUpdatedAt(response.data?.updated_at || null);
      setUpdatedBy(response.data?.updated_by || null);
      setDirty(false);
    }).catch((error) => {
      if (cancelled) return;
      console.error('load beverage price dictionary', error);
      setRows(DEFAULT_BEVERAGES);
      setMessage('Impossibile caricare il listino bevande.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [canImpersonate, token, effectiveRestId]);

  useEffect(() => {
    if (selectedRestId) localStorage.setItem('beverage_price_rest_id', selectedRestId);
  }, [selectedRestId]);

  const invalidRows = useMemo(() => rows.reduce((errors, row, index) => {
    const price = Number(row.price);
    if (row.price === '' || Number.isNaN(price) || price < 0 || price > 1000) {
      errors[index] = 'Inserisci un prezzo tra 0 e 1.000 euro';
    }
    return errors;
  }, {}), [rows]);
  const hasErrors = Object.keys(invalidRows).length > 0;

  const updatePrice = (index, value) => {
    setRows(current => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, price: value } : row
    )));
    setDirty(true);
    setMessage('');
  };

  const save = async () => {
    if (!effectiveRestId || hasErrors) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await axios.put(`${API}/beverage-price-dictionary`, {
        restaurant_id: effectiveRestId,
        prices: rows.map(row => ({ sigla: row.sigla, price: Number(row.price) })),
      }, { headers: { Authorization: `Bearer ${token}` } });
      setIsDefault(false);
      setUpdatedAt(new Date().toISOString());
      setDirty(false);
      const frozenRows = Number(response.data?.frozen_rows || 0);
      setMessage(frozenRows > 0
        ? `Listino salvato. Protette ${frozenRows} righe storiche.`
        : 'Listino salvato.');
    } catch (error) {
      console.error('save beverage price dictionary', error);
      setMessage(`Errore: ${error.response?.data?.detail || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!effectiveRestId || isDefault) return;
    if (!window.confirm('Ripristinare i prezzi predefiniti per questo locale? Le giornate già registrate non cambieranno.')) return;
    setSaving(true);
    setMessage('');
    try {
      await axios.delete(`${API}/beverage-price-dictionary?restaurant_id=${effectiveRestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(DEFAULT_BEVERAGES);
      setIsDefault(true);
      setUpdatedAt(null);
      setUpdatedBy(null);
      setDirty(false);
      setMessage('Prezzi predefiniti ripristinati.');
    } catch (error) {
      console.error('reset beverage price dictionary', error);
      setMessage(`Errore: ${error.response?.data?.detail || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!canImpersonate) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-4xl mx-auto p-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            Accesso riservato a Federico e agli amministratori.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <button
          data-testid="beverage-prices-back-home"
          onClick={() => navigate('/home')}
          className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950"
        >
          <ArrowLeft size={16} /> Home
        </button>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-gray-500">Configurazione Report</p>
            <h1 className="font-heading text-2xl font-bold uppercase text-gray-950">Prezzi delle bevande</h1>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs font-bold ${
            isDefault
              ? 'border-gray-300 bg-white text-gray-600'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}>
            {isDefault ? 'LISTINO PREDEFINITO' : 'LISTINO PERSONALIZZATO'}
          </div>
        </div>

        <section className="mb-4 rounded-xl border border-gray-300 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="beverage-price-restaurant" className="text-sm font-bold text-gray-700">Locale</label>
            <select
              id="beverage-price-restaurant"
              data-testid="beverage-price-restaurant"
              value={effectiveRestId}
              onChange={event => setSelectedRestId(event.target.value)}
              className="min-w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold focus:border-[#F5C518] focus:outline-none"
            >
              {!restaurants.length && <option value="">Caricamento…</option>}
              {restaurants.map(item => (
                <option key={item.id} value={item.id}>{item.location || item.username}</option>
              ))}
            </select>
            <div className="ml-auto text-right text-xs text-gray-500">
              <div className="font-bold text-gray-800">{selectedRestaurant?.location || selectedRestaurant?.username || '—'}</div>
              {updatedAt
                ? <div>Modificato {new Date(updatedAt).toLocaleString('it-IT')}{updatedBy ? ` da ${updatedBy}` : ''}</div>
                : <div>Nessuna personalizzazione salvata</div>}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm">
          <div className="grid grid-cols-[70px_minmax(220px,1fr)_170px_150px] items-center gap-3 border-b border-gray-300 bg-gray-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-600">
            <div>Sigla</div>
            <div>Bevanda</div>
            <div className="text-right">Prezzo Report</div>
            <div className="text-right">Anteprima</div>
          </div>
          {loading ? (
            <div className="p-12 text-center text-sm text-gray-400">Caricamento listino…</div>
          ) : rows.map((row, index) => (
            <div
              key={row.sigla}
              className={`grid grid-cols-[70px_minmax(220px,1fr)_170px_150px] items-center gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 ${invalidRows[index] ? 'bg-red-50' : 'hover:bg-amber-50/40'}`}
            >
              <span className="w-fit rounded bg-gray-900 px-2 py-1 font-mono text-xs font-bold text-white">{row.sigla}</span>
              <div>
                <div className="font-semibold text-gray-900">{row.name}</div>
                {invalidRows[index] && <div className="mt-0.5 text-xs font-semibold text-red-700">{invalidRows[index]}</div>}
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-gray-500">€</span>
                <input
                  data-testid={`beverage-price-${row.sigla}`}
                  aria-label={`Prezzo ${row.name}`}
                  type="number"
                  min="0"
                  max="1000"
                  step="0.10"
                  value={row.price}
                  onChange={event => updatePrice(index, event.target.value)}
                  className={`h-10 w-full rounded-md border pl-8 pr-3 text-right text-base font-bold tabular-nums focus:outline-none ${invalidRows[index] ? 'border-red-400 focus:border-red-600' : 'border-gray-300 focus:border-[#F5C518]'}`}
                />
              </div>
              <div className="text-right text-base font-bold tabular-nums text-gray-800">{money(row.price)}</div>
            </div>
          ))}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            data-testid="beverage-price-reset"
            onClick={reset}
            disabled={saving || isDefault}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={16} /> Ripristina predefiniti
          </button>
          {message && (
            <span className={`text-sm font-semibold ${message.startsWith('Errore') || message.startsWith('Impossibile') ? 'text-red-700' : 'text-emerald-700'}`}>
              {message}
            </span>
          )}
          <button
            data-testid="beverage-price-save"
            onClick={save}
            disabled={saving || !dirty || hasErrors}
            className="ml-auto flex items-center gap-2 rounded-md border border-yellow-600 bg-[#F5C518] px-5 py-2 text-sm font-bold text-gray-950 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={16} /> {saving ? 'Salvataggio…' : 'Salva listino'}
          </button>
        </div>
      </main>
    </div>
  );
};

export default DizionarioBevandePage;
