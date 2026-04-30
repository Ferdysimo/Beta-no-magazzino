import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import PhotoLightbox from '../components/PhotoLightbox';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const MagazzinoBevandePage = () => {
  const { token, isAdmin, restaurant } = useAuth();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState([]);
  const [carichi, setCarichi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState({ open: false, index: 0, urls: [] });

  const canAccess = isAdmin || restaurant?.username === 'Flaminio';

  useEffect(() => {
    if (!canAccess) return;
    Promise.all([
      axios.get(`${API}/beverages/inventory`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API}/beverages/carichi`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([inv, ca]) => {
        setInventory(inv.data);
        setCarichi(ca.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, canAccess]);

  const handleDeleteCarico = async (id) => {
    if (!window.confirm('Eliminare questo carico? L\'inventario verrà ripristinato.')) return;
    try {
      await axios.delete(`${API}/beverages/carichi/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Refresh
      const [inv, ca] = await Promise.all([
        axios.get(`${API}/beverages/inventory`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/beverages/carichi`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setInventory(inv.data);
      setCarichi(ca.data);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Errore eliminazione');
    }
  };

  const openLightbox = (url) => {
    setLightbox({ open: true, index: 0, urls: [`${BACKEND_URL}${url}`] });
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    } catch {
      return iso;
    }
  };

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Questa sezione è disponibile solo per Flaminio.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900"
          >
            <ArrowLeft size={18} /> Indietro
          </button>
          <button
            data-testid="btn-new-beverage-carico"
            onClick={() => navigate('/magazzino-bevande/nuovo-carico')}
            className="flex items-center gap-2 bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 font-bold px-4 py-2 rounded-lg shadow"
          >
            <Plus size={18} /> Nuovo Carico
          </button>
        </div>

        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-gray-900 uppercase mb-4">
          Magazzino Bevande
        </h1>

        {loading ? (
          <div className="text-center text-gray-400 py-10">Caricamento...</div>
        ) : (
          <>
            {/* Inventory */}
            <section className="mb-8">
              <h2 className="text-lg font-bold text-gray-800 mb-3">Inventario attuale</h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Sigla</th>
                      <th className="text-left px-3 py-2 font-semibold">Bevanda</th>
                      <th className="text-right px-3 py-2 font-semibold">Prezzo</th>
                      <th className="text-right px-3 py-2 font-semibold">Giacenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((b) => (
                      <tr key={b.sigla} data-testid={`inv-${b.sigla}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-bold text-gray-900">{b.sigla}</td>
                        <td className="px-3 py-2 text-gray-800">{b.name}</td>
                        <td className="px-3 py-2 text-right text-gray-700">€ {b.price.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-bold ${b.quantity <= 0 ? 'text-red-600' : b.quantity < 5 ? 'text-orange-600' : 'text-gray-900'}`}>
                          {b.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Carichi history */}
            <section>
              <h2 className="text-lg font-bold text-gray-800 mb-3">Storico carichi ({carichi.length})</h2>
              {carichi.length === 0 ? (
                <div className="text-center text-gray-400 py-8 bg-white border border-gray-200 rounded-lg">
                  Nessun carico ancora. Clicca "Nuovo Carico" per aggiungere.
                </div>
              ) : (
                <div className="space-y-3">
                  {carichi.map((c) => (
                    <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-bold text-gray-900">{c.supplier || 'Gioia'}</div>
                          <div className="text-xs text-gray-500">
                            {formatDate(c.created_at)}
                            {c.invoice_date ? ` • fattura del ${c.invoice_date}` : ''}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(c.items || []).map((it, i) => (
                              <span key={i} className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 rounded px-2 py-0.5 text-xs font-medium">
                                <span className="font-bold">{it.sigla}</span> ×{it.quantity}
                              </span>
                            ))}
                          </div>
                          {c.notes && <div className="mt-2 text-xs text-gray-600 italic">{c.notes}</div>}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {c.invoice_url && (
                            <button
                              onClick={() => openLightbox(c.invoice_url)}
                              data-testid={`view-invoice-${c.id}`}
                              className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                            >
                              <ImageIcon size={14} /> Fattura
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteCarico(c.id)}
                            data-testid={`delete-carico-${c.id}`}
                            className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs"
                          >
                            <Trash2 size={14} /> Elimina
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <PhotoLightbox
        open={lightbox.open}
        urls={lightbox.urls}
        index={lightbox.index}
        onClose={() => setLightbox({ ...lightbox, open: false })}
        onIndexChange={(i) => setLightbox({ ...lightbox, index: i })}
      />
    </div>
  );
};

export default MagazzinoBevandePage;
