import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatItalianDateTime } from '../utils/formatDate';
import { Plus, Search, X, Edit2, Trash2, Receipt, Upload } from 'lucide-react';
import { compressImage, friendlyUploadError } from '../utils/compressImage';
import PhotoLightbox from '../components/PhotoLightbox';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const resolveImage = (url) => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${BACKEND_URL}${url}`;
};

const CarichiMagazzinoPage = () => {
  const { token, restaurant } = useAuth();
  const navigate = useNavigate();
  const [carichi, setCarichi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [search, setSearch] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [fatturaUploadId, setFatturaUploadId] = useState(null); // id of carico currently uploading

  // Hidden file input for fattura uploads
  const fatturaFileInputRef = React.useRef(null);
  const [fatturaTargetId, setFatturaTargetId] = useState(null);

  // Role guard: only magazziniere/admin
  useEffect(() => {
    if (restaurant && restaurant.role !== 'magazzino' && restaurant.role !== 'admin') {
      navigate('/home', { replace: true });
    }
  }, [restaurant, navigate]);

  const headers = { Authorization: `Bearer ${token}` };

  const fetch = async () => {
    try {
      const res = await axios.get(`${API}/carichi`, { headers });
      setCarichi(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suppliers = useMemo(() => {
    const s = new Set();
    carichi.forEach(c => c.supplier_name && s.add(c.supplier_name));
    return Array.from(s).sort();
  }, [carichi]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = carichi.filter(c => {
      if (supplierFilter && c.supplier_name !== supplierFilter) return false;
      if (q) {
        const hay = `${c.supplier_name} ${c.ddt_number_fornitore} ${(c.items || []).map(i => i.product_name).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // DDT without fattura on top (as reminder), then by created_at desc
    return list.sort((a, b) => {
      const aMissing = !a.fattura_url ? 0 : 1;
      const bMissing = !b.fattura_url ? 0 : 1;
      if (aMissing !== bMissing) return aMissing - bMissing;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [carichi, supplierFilter, search]);

  const missingFatturaCount = useMemo(
    () => filtered.filter(c => !c.fattura_url).length,
    [filtered]
  );

  // Flat list of photos for the lightbox (DDT + Fattura for each carico in order)
  const lightboxPhotos = useMemo(() => {
    const arr = [];
    filtered.forEach((c) => {
      const label = `${c.supplier_name}${c.ddt_number_fornitore ? ' · DDT ' + c.ddt_number_fornitore : ''}`;
      if (c.photo_url) arr.push({ url: c.photo_url, label: `DDT · ${label}` });
      if (c.fattura_url) arr.push({ url: c.fattura_url, label: `Fattura · ${label}` });
    });
    return arr;
  }, [filtered]);

  const openLightboxFor = (url) => {
    const i = lightboxPhotos.findIndex((p) => p.url === url);
    if (i >= 0) setLightboxIndex(i);
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Cancellare il carico di ${c.supplier_name}? Le quantità verranno sottratte dal magazzino.`)) return;
    try {
      await axios.delete(`${API}/carichi/${c.id}`, { headers });
      fetch();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore cancellazione');
    }
  };

  const handleFatturaBtnClick = (caricoId) => {
    setFatturaTargetId(caricoId);
    // Reset value so selecting the same file again re-triggers onChange
    if (fatturaFileInputRef.current) fatturaFileInputRef.current.value = '';
    fatturaFileInputRef.current?.click();
  };

  const handleFatturaFileChange = async (e) => {
    const file = e.target.files?.[0];
    const caricoId = fatturaTargetId;
    if (!file || !caricoId) return;
    setFatturaUploadId(caricoId);
    try {
      const { dataUrl } = await compressImage(file);
      await axios.put(
        `${API}/carichi/${caricoId}/fattura`,
        { fattura_data: dataUrl },
        { headers, timeout: 120000 }
      );
      await fetch();
    } catch (err) {
      alert(friendlyUploadError(err));
    } finally {
      setFatturaUploadId(null);
      setFatturaTargetId(null);
    }
  };

  const handleFatturaDelete = async (c) => {
    if (!window.confirm(`Rimuovere la fattura associata al carico di ${c.supplier_name}?`)) return;
    try {
      await axios.delete(`${API}/carichi/${c.id}/fattura`, { headers });
      fetch();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore rimozione fattura');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      {/* Hidden file input for fattura upload */}
      <input
        ref={fatturaFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFatturaFileChange}
        data-testid="fattura-file-input"
      />
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase tracking-wide">
            Carico verso il magazzino
          </h1>
          <button
            onClick={() => navigate('/magazzino')}
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            ← Torna al magazzino
          </button>
        </div>

        {/* CTA Nuovo carico */}
        <button
          data-testid="btn-nuovo-carico"
          onClick={() => navigate('/magazzino/carichi/nuovo')}
          className="w-full mb-6 py-4 px-6 bg-gradient-to-r from-[#F5C518] to-[#F5A518] hover:from-[#F5A518] hover:to-[#E59500] text-gray-900 text-lg font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
        >
          <Plus size={22} /> Nuovo carico merce
        </button>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca fornitore, DDT, prodotto..."
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#F5C518] focus:border-transparent"
            />
          </div>
          <select
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">Tutti i fornitori</option>
            {suppliers.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>

        {/* List */}
        <div className="space-y-3">
          {!loading && missingFatturaCount > 0 && (
            <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-900 px-4 py-2.5 rounded-md text-sm font-semibold" data-testid="missing-fattura-banner">
              {missingFatturaCount} DDT senza fattura
            </div>
          )}
          {loading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400">
              Caricamento...
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
              Nessun carico trovato.
            </div>
          ) : filtered.map(c => {
            const missingFattura = !c.fattura_url;
            return (
            <div
              key={c.id}
              data-testid={`carico-${c.id}`}
              className={`rounded-lg border p-3 flex gap-3 transition-colors ${
                missingFattura
                  ? 'bg-amber-50 border-amber-300 border-l-4 border-l-amber-500'
                  : 'bg-white border-gray-200'
              }`}
            >
              {/* DDT photo */}
              {c.photo_url ? (
                <button
                  onClick={() => openLightboxFor(c.photo_url)}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-200 hover:ring-2 hover:ring-[#F5C518] transition-all relative group"
                  title="Foto DDT"
                >
                  <img src={resolveImage(c.photo_url)} alt="DDT" className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] py-0.5 text-center">DDT</span>
                </button>
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs flex-shrink-0 border border-gray-200">
                  No foto
                </div>
              )}

              {/* Fattura photo / upload */}
              {c.fattura_url ? (
                <div className="relative flex-shrink-0 group">
                  <button
                    onClick={() => openLightboxFor(c.fattura_url)}
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 hover:ring-2 hover:ring-[#F5C518] transition-all relative block"
                    data-testid={`fattura-view-${c.id}`}
                    title="Foto fattura"
                  >
                    <img src={resolveImage(c.fattura_url)} alt="Fattura" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 bg-emerald-700/80 text-white text-[10px] py-0.5 text-center flex items-center justify-center gap-1">
                      <Receipt size={10} /> Fattura
                    </span>
                  </button>
                  <button
                    onClick={() => handleFatturaDelete(c)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rimuovi fattura"
                    data-testid={`fattura-remove-${c.id}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleFatturaBtnClick(c.id)}
                  disabled={fatturaUploadId === c.id}
                  data-testid={`fattura-upload-${c.id}`}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-emerald-50 hover:bg-emerald-100 border-2 border-dashed border-emerald-300 hover:border-emerald-500 flex flex-col items-center justify-center text-emerald-700 text-[10px] flex-shrink-0 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  title="Aggiungi foto fattura"
                >
                  {fatturaUploadId === c.id ? (
                    <span className="text-[10px]">Carico...</span>
                  ) : (
                    <>
                      <Upload size={18} className="mb-1" />
                      <span className="font-semibold leading-tight text-center">Aggiungi<br/>Fattura</span>
                    </>
                  )}
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-gray-900 leading-tight">{c.supplier_name}</div>
                    {c.ddt_number_fornitore && (
                      <div className="text-xs text-gray-500">DDT n° <strong className="text-gray-700">{c.ddt_number_fornitore}</strong></div>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5">{formatItalianDateTime(c.created_at)}</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/magazzino/carichi/${c.id}/modifica`)}
                      data-testid={`btn-edit-carico-${c.id}`}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                      title="Modifica"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      data-testid={`btn-delete-carico-${c.id}`}
                      className="w-8 h-8 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-md transition-colors"
                      title="Cancella"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <ul className="mt-2 text-xs text-gray-700 space-y-0.5">
                  {(c.items || []).map((it, i) => (
                    <li key={i}>
                      <span className="inline-block bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1.5 py-0.5 mr-1 font-semibold">+{it.quantity_added}</span>
                      {it.product_name}
                      {it.unit && <span className="text-gray-400"> ({it.unit})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            );
          })}
        </div>
      </main>

      {/* Photo lightbox with navigation */}
      <PhotoLightbox
        photos={lightboxPhotos}
        index={lightboxIndex}
        onChangeIndex={setLightboxIndex}
        onClose={() => setLightboxIndex(-1)}
        resolve={resolveImage}
      />
    </div>
  );
};

export default CarichiMagazzinoPage;
