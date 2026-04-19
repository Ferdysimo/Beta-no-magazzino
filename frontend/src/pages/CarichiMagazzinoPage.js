import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatItalianDateTime } from '../utils/formatDate';
import { Plus, Search, X, Edit2, Trash2 } from 'lucide-react';

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
  const [photoLightbox, setPhotoLightbox] = useState(null);

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
    return carichi.filter(c => {
      if (supplierFilter && c.supplier_name !== supplierFilter) return false;
      if (q) {
        const hay = `${c.supplier_name} ${c.ddt_number_fornitore} ${(c.items || []).map(i => i.product_name).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [carichi, supplierFilter, search]);

  const handleDelete = async (c) => {
    if (!window.confirm(`Cancellare il carico di ${c.supplier_name}? Le quantità verranno sottratte dal magazzino.`)) return;
    try {
      await axios.delete(`${API}/carichi/${c.id}`, { headers });
      fetch();
    } catch (e) {
      alert(e.response?.data?.detail || 'Errore cancellazione');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
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
          {loading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400">
              Caricamento...
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
              Nessun carico trovato.
            </div>
          ) : filtered.map(c => (
            <div key={c.id} data-testid={`carico-${c.id}`} className="bg-white rounded-lg border border-gray-200 p-3 flex gap-3">
              {c.photo_url ? (
                <button
                  onClick={() => setPhotoLightbox(c.photo_url)}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-200 hover:ring-2 hover:ring-[#F5C518] transition-all"
                >
                  <img src={resolveImage(c.photo_url)} alt="DDT" className="w-full h-full object-cover" />
                </button>
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs flex-shrink-0 border border-gray-200">
                  No foto
                </div>
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
          ))}
        </div>
      </main>

      {/* Photo lightbox */}
      {photoLightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPhotoLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full"
            onClick={() => setPhotoLightbox(null)}
          >
            <X size={24} />
          </button>
          <img
            src={resolveImage(photoLightbox)}
            alt="DDT"
            className="max-w-full max-h-full object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default CarichiMagazzinoPage;
