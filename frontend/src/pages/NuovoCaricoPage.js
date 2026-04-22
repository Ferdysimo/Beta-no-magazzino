import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { Camera, Minus, Plus, X } from 'lucide-react';
import { compressImage, friendlyUploadError } from '../utils/compressImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImage = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

const NuovoCaricoPage = () => {
  const { id } = useParams(); // edit mode if id present
  const isEdit = Boolean(id);
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();

  // Role guard: only magazziniere/admin
  useEffect(() => {
    if (restaurant && restaurant.role !== 'magazzino' && restaurant.role !== 'admin') {
      navigate('/home', { replace: true });
    }
  }, [restaurant, navigate]);

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [ddtNumber, setDdtNumber] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoData, setPhotoData] = useState(''); // base64 for upload
  const [existingPhotoUrl, setExistingPhotoUrl] = useState('');
  const [cart, setCart] = useState({}); // product_id -> qty to add
  const [originalCart, setOriginalCart] = useState({}); // edit mode: snapshot of saved qtys
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [keypadProductId, setKeypadProductId] = useState(null);
  const [keypadValue, setKeypadValue] = useState('');
  const fileRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const load = async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          axios.get(`${API}/suppliers`, { headers }),
          axios.get(`${API}/products`, { headers }),
        ]);
        setSuppliers(sRes.data || []);
        setProducts(pRes.data || []);
        if (isEdit) {
          const cRes = await axios.get(`${API}/carichi/${id}`, { headers });
          const c = cRes.data;
          setSelectedSupplier(c.supplier_name || '');
          setDdtNumber(c.ddt_number_fornitore || '');
          setExistingPhotoUrl(c.photo_url || '');
          const map = {};
          (c.items || []).forEach(it => { map[it.product_id] = it.quantity_added; });
          setCart(map);
          setOriginalCart(map);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const supplierProducts = useMemo(() => {
    if (!selectedSupplier) return [];
    return products.filter(p => p.supplier === selectedSupplier).sort((a, b) => a.name.localeCompare(b.name));
  }, [products, selectedSupplier]);

  const totalUnits = useMemo(() => Object.values(cart).reduce((s, v) => s + (Number(v) || 0), 0), [cart]);
  const totalItems = useMemo(() => Object.values(cart).filter(v => v > 0).length, [cart]);

  const setQty = (pid, qty) => {
    const n = Math.max(0, Math.floor(Number(qty) || 0));
    setCart(c => {
      const nc = { ...c };
      if (n <= 0) delete nc[pid];
      else nc[pid] = n;
      return nc;
    });
  };
  const inc = (p) => setQty(p.id, (cart[p.id] || 0) + 1);
  const dec = (p) => setQty(p.id, (cart[p.id] || 0) - 1);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoProcessing(true);
    try {
      const { dataUrl } = await compressImage(f);
      setPhotoPreview(dataUrl);
      setPhotoData(dataUrl);
    } catch (err) {
      alert('Errore elaborazione foto: ' + (err.message || 'riprova'));
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSupplier) { alert('Seleziona un fornitore'); return; }
    if (!isEdit && !photoData) { alert('Carica la foto del DDT (obbligatoria)'); return; }
    const items = supplierProducts
      .filter(p => cart[p.id] > 0)
      .map(p => ({
        product_id: p.id,
        product_name: p.name,
        unit: p.unit || '',
        quantity_added: cart[p.id],
      }));
    if (items.length === 0) { alert('Inserisci almeno un prodotto con quantità > 0'); return; }

    setSubmitting(true);
    setUploadProgress(0);
    try {
      const body = {
        supplier_name: selectedSupplier,
        ddt_number_fornitore: ddtNumber.trim(),
        items,
      };
      if (photoData) body.photo_data = photoData;

      const axiosConfig = {
        headers,
        timeout: 120000,
        onUploadProgress: (evt) => {
          if (evt.total) setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
        },
      };

      if (isEdit) {
        await axios.put(`${API}/carichi/${id}`, body, axiosConfig);
      } else {
        await axios.post(`${API}/carichi`, { ...body, photo_data: photoData }, axiosConfig);
      }
      navigate('/magazzino/carichi');
    } catch (e) {
      alert(friendlyUploadError(e));
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  };

  const openKeypad = (p) => {
    setKeypadProductId(p.id);
    setKeypadValue(String(cart[p.id] || ''));
  };
  const closeKeypad = () => { setKeypadProductId(null); setKeypadValue(''); };
  const confirmKeypad = () => { if (keypadProductId) setQty(keypadProductId, keypadValue); closeKeypad(); };

  if (loading) return <div className="min-h-screen bg-[#F5F5F5]"><Header /><div className="p-8 text-center text-gray-400">Caricamento...</div></div>;

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-32">
      <Header />
      <main className="max-w-3xl mx-auto p-3 sm:p-6">
        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 mb-4 uppercase">
          {isEdit ? 'Modifica carico' : 'Nuovo carico verso il magazzino'}
        </h1>

        {/* Supplier + DDT number + Photo */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fornitore</label>
            <select
              data-testid="carico-supplier"
              value={selectedSupplier}
              onChange={e => setSelectedSupplier(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
              disabled={isEdit}
            >
              <option value="">— Seleziona fornitore —</option>
              {suppliers.map(s => (<option key={s.id} value={s.name}>{s.name}</option>))}
            </select>
            {selectedSupplier && supplierProducts.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">Nessun prodotto censito per questo fornitore. Aggiungili da "Modifica prodotti magazzino".</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Numero DDT fornitore</label>
            <input
              data-testid="carico-ddt-number"
              type="text"
              value={ddtNumber}
              onChange={e => setDdtNumber(e.target.value)}
              placeholder="es: 4454 / R15 / F22"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Foto DDT {isEdit ? '(opzionale, sostituisce la precedente)' : <span className="text-red-600">*obbligatoria</span>}
            </label>
            <div className="flex items-start gap-3">
              {(photoPreview || existingPhotoUrl) && (
                <img
                  src={photoPreview || resolveImage(existingPhotoUrl)}
                  alt="DDT"
                  className="w-24 h-24 object-cover rounded-lg border border-gray-200"
                />
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoProcessing}
                data-testid="carico-photo-btn"
                className="flex items-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 disabled:opacity-60 disabled:cursor-wait"
              >
                <Camera size={18} /> {photoProcessing ? 'Elaboro foto...' : (photoPreview || existingPhotoUrl ? 'Cambia foto' : 'Scatta / Carica foto')}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFile}
              />
            </div>
          </div>
        </div>

        {/* Product cards */}
        {selectedSupplier && supplierProducts.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
              Prodotti di {selectedSupplier} ({supplierProducts.length})
            </h2>
            <div className="space-y-3">
              {supplierProducts.map(p => {
                const qty = cart[p.id] || 0;
                const oldQty = originalCart[p.id] || 0;
                const currentStock = p.quantity ?? 0;
                // In edit mode stock already includes oldQty → preview = stock - oldQty + newQty
                // In create mode preview = stock + newQty
                const newStock = isEdit ? (currentStock - oldQty + qty) : (currentStock + qty);
                const delta = qty - oldQty;
                return (
                  <div
                    key={p.id}
                    data-testid={`carico-prod-${p.id}`}
                    className={`bg-white border rounded-xl p-3 flex items-start gap-3 shadow-sm transition-all ${qty > 0 ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-gray-200'}`}
                  >
                    <div className="w-24 h-24 rounded-lg bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-100">
                      {p.image_url ? (
                        <img src={resolveImage(p.image_url)} alt={p.name} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No foto</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 leading-tight">
                        {p.name}
                        {p.unit && <span className="text-gray-500 font-normal ml-1">({p.unit})</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Stock attuale: <strong className="text-gray-700">{currentStock}</strong>
                        {(qty > 0 || (isEdit && oldQty > 0)) && (
                          <span className={delta === 0 ? 'text-gray-500' : delta > 0 ? 'text-emerald-700' : 'text-amber-700'}>
                            {' '}→ Nuovo: <strong>{newStock}</strong>
                            {isEdit && delta !== 0 && (
                              <span className="ml-1">({delta > 0 ? '+' : ''}{delta})</span>
                            )}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          data-testid={`carico-dec-${p.id}`}
                          onClick={() => dec(p)}
                          className="w-11 h-11 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 border border-gray-200 active:scale-95 transition-transform"
                        >
                          <Minus size={22} />
                        </button>
                        <button
                          type="button"
                          data-testid={`carico-qty-${p.id}`}
                          onClick={() => openKeypad(p)}
                          className={`w-16 h-11 flex items-center justify-center rounded-lg border text-lg font-bold transition-colors ${qty > 0 ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-gray-300 text-gray-600'}`}
                        >
                          {qty}
                        </button>
                        <button
                          type="button"
                          data-testid={`carico-inc-${p.id}`}
                          onClick={() => inc(p)}
                          className="w-11 h-11 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 rounded-lg text-white active:scale-95 transition-transform"
                        >
                          <Plus size={22} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      {/* Sticky bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 py-3 shadow-lg z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500">Prodotti / Unità totali</div>
            <div className="font-bold text-gray-900 truncate">
              <span className="text-emerald-700">+{totalUnits}</span> su {totalItems} prodotti
            </div>
          </div>
          <button
            onClick={() => navigate('/magazzino/carichi')}
            className="px-4 py-3 text-sm text-gray-600 hover:text-gray-900"
          >
            Annulla
          </button>
          <button
            data-testid="btn-conferma-carico"
            onClick={handleSubmit}
            disabled={totalItems === 0 || submitting || !selectedSupplier || (!isEdit && !photoData)}
            className="flex-1 px-5 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow"
          >
            {submitting
              ? (uploadProgress > 0 && uploadProgress < 100
                  ? `Caricamento... ${uploadProgress}%`
                  : 'Salvataggio...')
              : (isEdit ? 'SALVA MODIFICHE' : 'CARICA NEL MAGAZZINO')}
          </button>
        </div>
      </div>

      {/* Keypad */}
      {keypadProductId && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={closeKeypad}>
          <div className="bg-white rounded-xl w-full max-w-xs p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-gray-800">Quantità da aggiungere</div>
              <button onClick={closeKeypad} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <input
              data-testid="carico-keypad-input"
              type="number"
              inputMode="numeric"
              autoFocus
              value={keypadValue}
              onChange={e => setKeypadValue(e.target.value)}
              className="w-full text-3xl text-center font-bold border-2 border-emerald-500 rounded-lg py-3 mb-3"
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
              data-testid="carico-keypad-confirm"
              onClick={confirmKeypad}
              className="w-full mt-3 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-lg font-bold text-white"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NuovoCaricoPage;
