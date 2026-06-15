import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, Plus, Trash2, Save, RotateCcw } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const DEFAULT_DICT = [
  { sigla: 'CARB', price: 8 },
  { sigla: 'AMAT', price: 8 },
  { sigla: 'CACIO', price: 8 },
  { sigla: 'PESTO', price: 8 },
  { sigla: 'TART', price: 8 },
  { sigla: 'RAGU', price: 8 },
  { sigla: 'POM', price: 7 },
  { sigla: 'CARZUC', price: 8 },
];

const DizionarioPastePage = () => {
  const navigate = useNavigate();
  const { token, isAdmin, restaurant } = useAuth();
  // Admin + Supervisor (Federico) hanno accesso. Restaurant base no.
  const role = restaurant?.role;
  const canAccess = role === 'admin' || role === 'supervisor';

  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(
    () => localStorage.getItem('pasta_dict_rest_id') || ''
  );
  const [rows, setRows] = useState([]);     // [{sigla, price}]
  const [isDefault, setIsDefault] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  const effectiveRestId = selectedRestId || restaurants[0]?.id || '';

  // Carica lista locali
  useEffect(() => {
    if (!canAccess || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const list = (res.data || []).filter(r => r.role !== 'admin' && r.role !== 'supervisor');
        setRestaurants(list);
      } catch (e) { console.error('list restaurants', e); }
    })();
  }, [canAccess, token]);

  // Carica dizionario per il locale selezionato
  useEffect(() => {
    if (!canAccess || !token || !effectiveRestId) {
      setRows([]); return;
    }
    setLoading(true);
    (async () => {
      try {
        const res = await axios.get(
          `${API}/pasta-dictionary?restaurant_id=${effectiveRestId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const list = (res.data?.siglas || []).map(s => ({
          sigla: String(s.sigla).toUpperCase(),
          price: Number(s.price) || 0,
        }));
        setRows(list.length > 0 ? list : DEFAULT_DICT);
        setIsDefault(!!res.data?.is_default);
        setUpdatedAt(res.data?.updated_at || null);
        setUpdatedBy(res.data?.updated_by || null);
        setDirty(false);
        setMsg('');
      } catch (e) {
        console.error(e);
        setMsg('Errore caricamento dizionario');
        setRows(DEFAULT_DICT);
      } finally {
        setLoading(false);
      }
    })();
  }, [canAccess, token, effectiveRestId]);

  useEffect(() => {
    if (selectedRestId) localStorage.setItem('pasta_dict_rest_id', selectedRestId);
  }, [selectedRestId]);

  const validation = useMemo(() => {
    const errors = {};
    const seen = new Set();
    rows.forEach((r, idx) => {
      const sigla = String(r.sigla || '').toUpperCase().trim();
      if (!sigla) errors[idx] = 'Sigla vuota';
      else if (!/^[A-Z0-9_-]{1,20}$/.test(sigla)) errors[idx] = 'Solo A-Z, 0-9 (max 20)';
      else if (seen.has(sigla)) errors[idx] = 'Sigla duplicata';
      const price = Number(r.price);
      if (Number.isNaN(price) || price < 0 || price > 1000) {
        errors[idx] = (errors[idx] ? errors[idx] + ' · ' : '') + 'Prezzo non valido';
      }
      seen.add(sigla);
    });
    return errors;
  }, [rows]);

  const hasErrors = Object.keys(validation).length > 0;

  const updateRow = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const addRow = () => {
    setRows(prev => [...prev, { sigla: '', price: 8 }]);
    setDirty(true);
  };
  const removeRow = (idx) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const onSave = async () => {
    if (!effectiveRestId) return;
    if (hasErrors) { setMsg('Correggi gli errori prima di salvare'); return; }
    setSaving(true); setMsg('');
    try {
      const payload = {
        restaurant_id: effectiveRestId,
        siglas: rows.map(r => ({
          sigla: String(r.sigla).toUpperCase().trim(),
          price: Number(r.price),
        })),
      };
      await axios.put(`${API}/pasta-dictionary`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsDefault(false);
      setUpdatedAt(new Date().toISOString());
      setDirty(false);
      setMsg(`✓ Dizionario salvato (${rows.length} sigle)`);
    } catch (e) {
      console.error(e);
      setMsg('Errore salvataggio: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const onResetDefault = async () => {
    if (!effectiveRestId) return;
    if (!window.confirm('Ripristinare il dizionario di DEFAULT per questo locale? Le tue modifiche andranno perse.')) return;
    setSaving(true); setMsg('');
    try {
      await axios.delete(`${API}/pasta-dictionary?restaurant_id=${effectiveRestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(DEFAULT_DICT);
      setIsDefault(true);
      setUpdatedAt(null);
      setUpdatedBy(null);
      setDirty(false);
      setMsg('✓ Ripristinato al default');
    } catch (e) {
      console.error(e);
      setMsg('Errore ripristino: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Accesso riservato a Admin / Supervisor.
          </div>
        </main>
      </div>
    );
  }

  const selectedRestName = restaurants.find(r => r.id === effectiveRestId)?.location
    || restaurants.find(r => r.id === effectiveRestId)?.username
    || '';

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">
            Dizionario paste per locale — modifica solo Admin/Supervisor
          </span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-3">
          Dizionario Paste
        </h1>

        {/* Selettore locale */}
        <div className="mb-3 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-bold text-gray-700">Locale:</label>
          <select
            data-testid="dict-restaurant-select"
            value={effectiveRestId}
            onChange={(e) => setSelectedRestId(e.target.value)}
            className="min-w-[200px] border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5C518] bg-white"
          >
            {restaurants.length === 0 && <option value="">Caricamento…</option>}
            {restaurants.map(r => (
              <option key={r.id} value={r.id}>{r.location || r.username}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-600">
            {isDefault ? (
              <span className="px-2 py-0.5 bg-gray-100 border border-gray-300 rounded font-semibold">DEFAULT</span>
            ) : (
              <span className="px-2 py-0.5 bg-yellow-100 border border-yellow-400 rounded font-semibold text-yellow-800">
                PERSONALIZZATO
              </span>
            )}
            {updatedAt && (
              <span title={`Ultima modifica: ${updatedAt} da ${updatedBy || 'n/d'}`}>
                · {new Date(updatedAt).toLocaleString('it-IT')}
              </span>
            )}
          </div>
        </div>

        {/* Tabella sigle */}
        <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 border-b border-gray-300 px-3 py-2 flex items-center gap-3 font-semibold text-xs text-gray-700 uppercase">
            <div className="w-16 text-center">#</div>
            <div className="flex-1">Sigla (es. CARB, POM, CARZUC)</div>
            <div className="w-40 text-center">Prezzo (€)</div>
            <div className="w-16"></div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-gray-400">Caricamento…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              Nessuna sigla. Clicca "Aggiungi" per iniziare.
            </div>
          ) : (
            rows.map((r, idx) => {
              const err = validation[idx];
              return (
                <div
                  key={idx}
                  className={`px-3 py-2 border-b border-gray-200 flex items-center gap-3 ${err ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}`}
                >
                  <div className="w-16 text-center text-sm text-gray-400 font-mono">{idx + 1}</div>
                  <input
                    data-testid={`dict-sigla-${idx}`}
                    type="text"
                    value={r.sigla}
                    onChange={(e) => updateRow(idx, 'sigla', e.target.value.toUpperCase())}
                    placeholder="CARB"
                    maxLength={20}
                    className="flex-1 h-10 px-3 border border-gray-300 rounded font-mono font-bold uppercase focus:outline-none focus:border-[#F5C518]"
                  />
                  <div className="w-40 flex items-center gap-1">
                    <span className="text-sm font-semibold text-gray-700">€</span>
                    <input
                      data-testid={`dict-price-${idx}`}
                      type="number"
                      step="0.5"
                      min="0"
                      max="1000"
                      value={r.price}
                      onChange={(e) => updateRow(idx, 'price', e.target.value)}
                      className="flex-1 h-10 px-3 border border-gray-300 rounded text-right font-bold focus:outline-none focus:border-[#F5C518]"
                    />
                  </div>
                  <button
                    data-testid={`dict-remove-${idx}`}
                    onClick={() => removeRow(idx)}
                    title="Rimuovi sigla"
                    className="w-10 h-10 flex items-center justify-center text-red-600 hover:bg-red-100 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                  {err && (
                    <div className="absolute right-3 text-xs text-red-700 font-semibold">{err}</div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Validation summary */}
        {hasErrors && (
          <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            Ci sono errori di validazione. Correggili prima di salvare.
            <ul className="list-disc ml-5 mt-1">
              {Object.entries(validation).map(([i, msg2]) => (
                <li key={i}>Riga {Number(i) + 1}: {msg2}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Toolbar */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            data-testid="dict-add-row"
            onClick={addRow}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-800 font-semibold px-4 py-2 rounded"
          >
            <Plus size={16} /> Aggiungi sigla
          </button>
          <button
            data-testid="dict-reset"
            onClick={onResetDefault}
            disabled={saving || isDefault}
            className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 font-semibold px-4 py-2 rounded disabled:opacity-50"
            title={isDefault ? 'Già al default' : 'Ripristina il dizionario di default'}
          >
            <RotateCcw size={16} /> Ripristina default
          </button>
          <div className="ml-auto flex items-center gap-2">
            {msg && (
              <span className={`text-xs font-semibold ${msg.startsWith('✓') ? 'text-green-700' : 'text-red-700'}`}>
                {msg}
              </span>
            )}
            <button
              data-testid="dict-save"
              onClick={onSave}
              disabled={saving || !dirty || hasErrors}
              className="flex items-center gap-2 bg-[#F5C518] hover:bg-yellow-500 border border-yellow-600 text-gray-900 font-bold px-5 py-2 rounded disabled:opacity-50"
            >
              <Save size={16} /> {saving ? 'Salvataggio…' : 'Salva dizionario'}
            </button>
          </div>
        </div>

      </main>
    </div>
  );
};

export default DizionarioPastePage;
