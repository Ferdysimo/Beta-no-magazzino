import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import PanZoomImage from '../components/PanZoomImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AdminDDTPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin, effectiveRestaurant } = useAuth();

  const [ddts, setDdts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form upload nuovo DDT
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [supplier, setSupplier] = useState('');
  const [ddtNumber, setDdtNumber] = useState('');
  const [importo, setImporto] = useState('');
  const [ddtDate, setDdtDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [restaurantFilter, setRestaurantFilter] = useState('all');
  const [restaurants, setRestaurants] = useState([]);
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const headers = useMemo(() => {
    const h = { Authorization: `Bearer ${token}` };
    if (effectiveRestaurant?.id) h['X-Restaurant-Id'] = effectiveRestaurant.id;
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, effectiveRestaurant?.id]);

  const fetchAll = async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        axios.get(`${API}/ddts`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/suppliers`, { headers: { Authorization: `Bearer ${token}` } }),
        isAdmin ? axios.get(`${API}/admin/restaurants`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve({ data: [] }),
      ]);
      setDdts(r1.data || []);
      setSuppliers(r2.data || []);
      setRestaurants(r3.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!selectedFile) { setError('Seleziona una foto del DDT'); return; }
    if (!supplier) { setError('Seleziona un fornitore'); return; }
    if (!ddtNumber.trim()) { setError('Inserisci il numero DDT'); return; }
    const parsed = parseFloat((importo || '').toString().replace(',', '.'));
    if (Number.isNaN(parsed) || parsed <= 0) { setError('Inserisci un importo valido'); return; }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/ddts`, {
            supplier,
            ddt_number: ddtNumber.trim(),
            importo: parsed,
            image_data: reader.result,
            ddt_date: new Date(ddtDate).toISOString(),
          }, { headers });
          setSelectedFile(null);
          setPreview(null);
          setSupplier('');
          setDdtNumber('');
          setImporto('');
          setSuccess('DDT caricato con successo');
          fetchAll();
        } catch (err) {
          setError(err.response?.data?.detail || 'Errore caricamento');
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(selectedFile);
    } catch (e) {
      setError('Errore lettura file');
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Eliminare definitivamente questo DDT e tutte le fatture allegate?')) return;
    try {
      await axios.delete(`${API}/ddts/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
    } catch (e) {
      setError('Errore eliminazione');
    }
  };

  const filteredDdts = useMemo(() => {
    if (restaurantFilter === 'all') return ddts;
    return ddts.filter(d => d.restaurant_id === restaurantFilter);
  }, [ddts, restaurantFilter]);

  const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const restaurantNameById = useMemo(() => {
    const map = {};
    (restaurants || []).forEach(r => { map[r.id] = r.location || r.username || r.name || r.id; });
    return map;
  }, [restaurants]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">DDT — Documenti di Trasporto</h1>
            <p className="text-sm text-gray-500">Caricamento DDT per locale · ogni DDT può essere abbinato alle relative fatture nella pagina "Fatture"</p>
          </div>
          <button
            data-testid="ddt-back-home"
            onClick={() => navigate('/')}
            className="text-sm text-gray-700 hover:text-gray-900 underline"
          >← Home</button>
        </div>

        {/* Form upload */}
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3" data-testid="ddt-upload-form">
          <h2 className="text-lg font-bold text-gray-800">Carica nuovo DDT</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* File */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Foto DDT</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleFile(e.target.files[0])}
                data-testid="ddt-file-input"
                className="w-full text-sm text-gray-700"
              />
              {preview && (
                <img src={preview} alt="anteprima" className="mt-2 max-h-40 rounded border border-gray-200" />
              )}
            </div>

            {/* Fornitore */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fornitore</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                data-testid="ddt-supplier-select"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none bg-white"
              >
                <option value="">— scegli —</option>
                {suppliers.map(s => (
                  <option key={s.id || s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Numero DDT */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Numero DDT</label>
              <input
                type="text"
                value={ddtNumber}
                onChange={(e) => setDdtNumber(e.target.value)}
                placeholder="es. 12345/2026"
                data-testid="ddt-number-input"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Importo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Importo DDT (€)</label>
              <input
                type="text"
                inputMode="decimal"
                value={importo}
                onChange={(e) => setImporto(e.target.value)}
                placeholder="es. 3000,00"
                data-testid="ddt-importo-input"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Data DDT */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data DDT</label>
              <input
                type="date"
                value={ddtDate}
                onChange={(e) => setDdtDate(e.target.value)}
                data-testid="ddt-date-input"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-md text-sm">{success}</div>}

          <button
            type="submit"
            disabled={loading}
            data-testid="ddt-submit-button"
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-md text-sm"
          >
            {loading ? 'Caricamento…' : 'Carica DDT'}
          </button>
        </form>

        {/* Filtro locale */}
        {isAdmin && (
          <div className="mb-3 flex items-center gap-2">
            <label className="text-sm text-gray-700 font-medium">Locale:</label>
            <select
              value={restaurantFilter}
              onChange={(e) => setRestaurantFilter(e.target.value)}
              data-testid="ddt-restaurant-filter"
              className="h-9 px-2 border border-gray-300 rounded-md bg-white text-sm"
            >
              <option value="all">Tutti</option>
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.location || r.username}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500">{filteredDdts.length} DDT</span>
          </div>
        )}

        {/* Lista DDT */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm" data-testid="ddt-table">
            <thead className="bg-gray-50 text-gray-700 text-[11px] uppercase">
              <tr>
                <th className="text-left px-2 py-2 font-bold">Data</th>
                <th className="text-left px-2 py-2 font-bold">Locale</th>
                <th className="text-left px-2 py-2 font-bold">Fornitore</th>
                <th className="text-left px-2 py-2 font-bold">N° DDT</th>
                <th className="text-right px-2 py-2 font-bold">Importo</th>
                <th className="text-center px-2 py-2 font-bold">Foto</th>
                <th className="text-center px-2 py-2 font-bold">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredDdts.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-6">Nessun DDT caricato.</td></tr>
              )}
              {filteredDdts.map(d => {
                const date = d.ddt_date || d.created_at;
                const dateStr = date ? new Date(date).toLocaleDateString('it-IT') : '';
                return (
                  <tr key={d.id} data-testid={`ddt-row-${d.id}`} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-2 py-2">{dateStr}</td>
                    <td className="px-2 py-2 text-gray-700">{restaurantNameById[d.restaurant_id] || '—'}</td>
                    <td className="px-2 py-2 font-medium">{d.supplier}</td>
                    <td className="px-2 py-2 font-mono">{d.ddt_number}</td>
                    <td className="px-2 py-2 text-right font-bold">€ {fmtEur(d.importo)}</td>
                    <td className="px-2 py-2 text-center">
                      {d.image_url ? (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(`${BACKEND_URL}${d.image_url}`)}
                          data-testid={`ddt-photo-${d.id}`}
                          className="text-blue-600 underline text-xs"
                        >
                          vedi foto
                        </button>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => remove(d.id)}
                        data-testid={`ddt-delete-${d.id}`}
                        className="text-rose-600 hover:text-rose-800 text-xs underline"
                      >
                        elimina
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
          data-testid="ddt-lightbox"
        >
          <PanZoomImage src={lightboxUrl} alt="DDT" />
        </div>
      )}
    </div>
  );
};

export default AdminDDTPage;
