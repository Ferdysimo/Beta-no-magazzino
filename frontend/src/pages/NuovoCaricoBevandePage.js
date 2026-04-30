import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, Camera, X, Minus, Plus } from 'lucide-react';
import { compressImage } from '../utils/compressImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const NuovoCaricoBevandePage = () => {
  const { token, isAdmin, restaurant } = useAuth();
  const navigate = useNavigate();
  const [beverages, setBeverages] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [supplier, setSupplier] = useState('Gioia');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoicePreview, setInvoicePreview] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canAccess = isAdmin || restaurant?.username === 'Flaminio';

  useEffect(() => {
    if (!canAccess) return;
    axios.get(`${API}/beverages`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        setBeverages(res.data);
        setQuantities(Object.fromEntries(res.data.map(b => [b.sigla, 0])));
      })
      .catch(console.error);
  }, [token, canAccess]);

  const change = (sigla, delta) => {
    setQuantities(prev => ({
      ...prev,
      [sigla]: Math.max(0, (prev[sigla] || 0) + delta),
    }));
  };

  const setDirect = (sigla, value) => {
    const n = parseInt(value) || 0;
    setQuantities(prev => ({ ...prev, [sigla]: Math.max(0, n) }));
  };

  const onPhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, { maxWidth: 1600, quality: 0.8 });
      setInvoiceData(compressed);
      setInvoicePreview(compressed);
    } catch (err) {
      console.error(err);
      alert('Errore elaborazione immagine');
    }
  };

  const removePhoto = () => {
    setInvoiceData(null);
    setInvoicePreview(null);
  };

  const handleSubmit = async () => {
    const items = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([sigla, quantity]) => ({ sigla, quantity }));
    if (items.length === 0) {
      alert('Inserisci almeno una quantità.');
      return;
    }
    if (!supplier.trim()) {
      alert('Indica il fornitore.');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${API}/beverages/carichi`, {
        supplier: supplier.trim(),
        invoice_image_data: invoiceData,
        invoice_date: invoiceDate,
        items,
        notes: notes.trim() || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      navigate('/magazzino-bevande');
    } catch (e) {
      alert(e?.response?.data?.detail || 'Errore invio carico');
    } finally {
      setSubmitting(false);
    }
  };

  const totalUnits = Object.values(quantities).reduce((a, b) => a + b, 0);

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Disponibile solo per Flaminio.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-24">
      <Header />
      <main className="max-w-3xl mx-auto p-4 sm:p-6">
        <button
          onClick={() => navigate('/magazzino-bevande')}
          className="flex items-center gap-2 text-gray-700 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={18} /> Indietro
        </button>

        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase mb-2">
          Nuovo Carico Bevande
        </h1>
        <p className="text-sm text-gray-600 mb-4">
          Inserisci il numero di <strong>casse</strong> ricevute. Una cassa = 24 unità.
        </p>

        {/* Supplier + date */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Fornitore</label>
            <input
              type="text"
              value={supplier}
              onChange={e => setSupplier(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-base"
              data-testid="bev-carico-supplier"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Data fattura</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-base"
              data-testid="bev-carico-date"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Foto fattura (opzionale)</label>
            {invoicePreview ? (
              <div className="relative inline-block">
                <img src={invoicePreview} alt="fattura" className="max-h-40 rounded border border-gray-300" />
                <button
                  onClick={removePhoto}
                  className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 hover:border-[#F5C518] rounded-lg p-4 cursor-pointer text-gray-600">
                <Camera size={20} />
                <span className="text-sm font-medium">Scatta o carica</span>
                <input type="file" accept="image/*" capture="environment" onChange={onPhotoSelect} className="hidden" data-testid="bev-carico-photo" />
              </label>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Note (opzionale)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-y"
            />
          </div>
        </div>

        {/* Beverages */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center justify-between">
            <span>Bevanda</span>
            <span>Casse (1 cassa = 24 u.)</span>
          </div>
          {beverages.map(b => {
            const q = quantities[b.sigla] || 0;
            const units = q * 24;
            return (
              <div key={b.sigla} data-testid={`bev-row-${b.sigla}`} className="flex items-center gap-3 px-3 py-3 border-b border-gray-100 last:border-b-0">
                <div className="w-12 font-extrabold text-lg text-gray-900">{b.sigla}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{b.name}</div>
                  <div className="text-xs text-gray-500">
                    € {b.price.toFixed(2)}
                    {q > 0 && <span className="ml-2 text-emerald-700 font-semibold">→ {units} unità</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => change(b.sigla, -1)}
                    disabled={q === 0}
                    data-testid={`bev-minus-${b.sigla}`}
                    className="w-9 h-9 flex items-center justify-center bg-gray-200 hover:bg-gray-300 disabled:opacity-40 rounded"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={q}
                    onChange={e => setDirect(b.sigla, e.target.value)}
                    className="w-16 text-center font-bold text-gray-900 border border-gray-300 rounded py-1"
                    data-testid={`bev-qty-${b.sigla}`}
                  />
                  <button
                    onClick={() => change(b.sigla, 1)}
                    data-testid={`bev-plus-${b.sigla}`}
                    className="w-9 h-9 flex items-center justify-center bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 rounded"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-3 py-3 shadow-lg z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-500">Casse totali / unità</div>
            <div className="font-bold text-gray-900">
              {totalUnits}{' '}<span className="text-[#B8860B]">({totalUnits * 24} u.)</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/magazzino-bevande')}
            className="px-4 py-3 text-sm text-gray-600 hover:text-gray-900"
          >
            Annulla
          </button>
          <button
            data-testid="btn-submit-bev-carico"
            onClick={handleSubmit}
            disabled={totalUnits === 0 || submitting}
            className="flex-1 px-5 py-3 bg-gradient-to-r from-[#F5C518] to-[#F5A518] hover:from-[#F5A518] hover:to-[#E59500] disabled:opacity-40 text-gray-900 font-bold rounded-lg shadow"
          >
            {submitting ? 'Invio...' : 'CONFERMA CARICO'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NuovoCaricoBevandePage;
