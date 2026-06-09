import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import PanZoomImage from '../components/PanZoomImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUS = (d) => {
  if (d.paid) return 'paid';
  const importo = Number(d.importo || 0);
  const sum = Number(d.invoices_sum || 0);
  if (Math.abs(importo - sum) < 0.01 && importo > 0) return 'ready';
  return 'pending';
};

const AdminFatturePage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();

  const [ddts, setDdts] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantFilter, setRestaurantFilter] = useState('all');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [errorByDdt, setErrorByDdt] = useState({}); // {ddtId: 'msg'}
  const [showAddFor, setShowAddFor] = useState(null); // ddtId
  const [addImporto, setAddImporto] = useState('');
  const [addFile, setAddFile] = useState(null);
  const [addPreview, setAddPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    try {
      const [r1, r2] = await Promise.all([
        axios.get(`${API}/ddts`, { headers: { Authorization: `Bearer ${token}` } }),
        isAdmin ? axios.get(`${API}/admin/restaurants`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve({ data: [] }),
      ]);
      setDdts(r1.data || []);
      setRestaurants(r2.data || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (!token) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Ordinamento: pending+ready prima (per data desc), paid in fondo (per paid_at desc)
  const orderedDdts = useMemo(() => {
    const list = restaurantFilter === 'all' ? ddts : ddts.filter(d => d.restaurant_id === restaurantFilter);
    const active = list.filter(d => !d.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const paid = list.filter(d => d.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
    return [...active, ...paid];
  }, [ddts, restaurantFilter]);

  const restaurantNameById = useMemo(() => {
    const map = {};
    (restaurants || []).forEach(r => { map[r.id] = r.location || r.username || r.name || r.id; });
    return map;
  }, [restaurants]);

  const openAdd = (ddtId) => {
    setShowAddFor(ddtId);
    setAddImporto('');
    setAddFile(null);
    setAddPreview(null);
    setErrorByDdt(prev => ({ ...prev, [ddtId]: '' }));
  };
  const cancelAdd = () => {
    setShowAddFor(null);
    setAddImporto('');
    setAddFile(null);
    setAddPreview(null);
  };
  const onSelectAddFile = (file) => {
    if (!file) return;
    setAddFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setAddPreview(reader.result);
    reader.readAsDataURL(file);
  };
  const submitInvoice = async (ddtId) => {
    setErrorByDdt(prev => ({ ...prev, [ddtId]: '' }));
    if (!addFile) { setErrorByDdt(prev => ({ ...prev, [ddtId]: 'Seleziona la foto della fattura' })); return; }
    const imp = parseFloat((addImporto || '').toString().replace(',', '.'));
    if (Number.isNaN(imp) || imp <= 0) { setErrorByDdt(prev => ({ ...prev, [ddtId]: 'Importo non valido' })); return; }
    setBusy(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/ddts/${ddtId}/invoices`, {
            importo: imp,
            image_data: reader.result,
          }, { headers: { Authorization: `Bearer ${token}` } });
          cancelAdd();
          fetchAll();
        } catch (err) {
          setErrorByDdt(prev => ({ ...prev, [ddtId]: err.response?.data?.detail || 'Errore' }));
        } finally {
          setBusy(false);
        }
      };
      reader.readAsDataURL(addFile);
    } catch (e) { setBusy(false); }
  };
  const removeInvoice = async (ddtId, invId) => {
    if (!window.confirm('Rimuovere questa fattura dal DDT?')) return;
    try {
      await axios.delete(`${API}/ddts/${ddtId}/invoices/${invId}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
    } catch (e) { /* ignore */ }
  };
  const pay = async (ddtId) => {
    try {
      await axios.post(`${API}/ddts/${ddtId}/pay`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
    } catch (err) {
      setErrorByDdt(prev => ({ ...prev, [ddtId]: err.response?.data?.detail || 'Errore' }));
    }
  };

  const rowClass = (st) => {
    if (st === 'paid') return 'bg-amber-50 border-l-4 border-amber-500';
    if (st === 'ready') return 'bg-emerald-50 border-l-4 border-emerald-500';
    return 'bg-blue-50 border-l-4 border-blue-500';
  };
  const badge = (st) => {
    if (st === 'paid') return <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold uppercase">PAGATO</span>;
    if (st === 'ready') return <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-[10px] font-bold uppercase">CHECK OK</span>;
    return <span className="px-2 py-0.5 rounded-full bg-blue-200 text-blue-900 text-[10px] font-bold uppercase">IN ATTESA</span>;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fatture per DDT</h1>
            <p className="text-sm text-gray-500">Allega le fatture relative a ogni DDT · BLU = mancano fatture · VERDE = pronto al pagamento · ORO = pagato</p>
          </div>
          <div className="flex items-center gap-3">
            <button data-testid="fatture-goto-ddt" onClick={() => navigate('/admin/ddt')} className="text-sm text-blue-700 underline">+ Nuovo DDT</button>
            <button data-testid="fatture-back-home" onClick={() => navigate('/')} className="text-sm text-gray-700 underline">← Home</button>
          </div>
        </div>

        {isAdmin && (
          <div className="mb-3 flex items-center gap-2">
            <label className="text-sm text-gray-700 font-medium">Locale:</label>
            <select
              value={restaurantFilter}
              onChange={(e) => setRestaurantFilter(e.target.value)}
              data-testid="fatture-restaurant-filter"
              className="h-9 px-2 border border-gray-300 rounded-md bg-white text-sm"
            >
              <option value="all">Tutti</option>
              {restaurants.map(r => (
                <option key={r.id} value={r.id}>{r.location || r.username}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500">{orderedDdts.length} DDT</span>
          </div>
        )}

        <div className="space-y-3" data-testid="fatture-list">
          {orderedDdts.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
              Nessun DDT da gestire.
            </div>
          )}
          {orderedDdts.map(d => {
            const st = STATUS(d);
            const importo = Number(d.importo || 0);
            const sum = Number(d.invoices_sum || 0);
            const diff = importo - sum;
            return (
              <div
                key={d.id}
                data-testid={`fattura-row-${d.id}`}
                className={`rounded-lg border border-gray-200 p-3 ${rowClass(st)}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge(st)}
                      <span className="font-bold text-gray-900">{d.supplier}</span>
                      <span className="text-xs text-gray-600">N° {d.ddt_number}</span>
                      <span className="text-xs text-gray-500">· {restaurantNameById[d.restaurant_id] || '—'}</span>
                      <span className="text-xs text-gray-500">· {(d.ddt_date || d.created_at) ? new Date(d.ddt_date || d.created_at).toLocaleDateString('it-IT') : ''}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 flex items-center gap-3 flex-wrap">
                      <span>Importo DDT: <b>€ {fmtEur(importo)}</b></span>
                      <span>Allegato: <b>€ {fmtEur(sum)}</b></span>
                      {!d.paid && (
                        <span className={diff > 0.005 ? 'text-blue-700' : (diff < -0.005 ? 'text-rose-700' : 'text-emerald-700 font-bold')}>
                          {diff > 0.005 ? `Mancano € ${fmtEur(diff)}` : diff < -0.005 ? `Eccesso € ${fmtEur(-diff)}` : 'Importi coincidono ✓'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.image_url && (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(`${BACKEND_URL}${d.image_url}`)}
                        data-testid={`ddt-image-${d.id}`}
                        className="text-blue-700 text-xs underline"
                      >Vedi DDT</button>
                    )}
                    {!d.paid && st === 'ready' && (
                      <button
                        type="button"
                        onClick={() => pay(d.id)}
                        data-testid={`pay-${d.id}`}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded-md uppercase tracking-wider"
                      >
                        CHECK OK, PAGA
                      </button>
                    )}
                  </div>
                </div>

                {/* Lista fatture allegate */}
                {(d.invoices || []).length > 0 && (
                  <div className="mt-2 bg-white/70 rounded border border-gray-200 p-2">
                    <div className="text-[11px] font-bold text-gray-700 uppercase mb-1">Fatture allegate ({d.invoices.length})</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {d.invoices.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 text-xs">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-900">€ {fmtEur(inv.importo)}</span>
                            <span className="text-[10px] text-gray-500">
                              {inv.created_at ? new Date(inv.created_at).toLocaleString('it-IT') : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {inv.image_url && (
                              <button
                                type="button"
                                onClick={() => setLightboxUrl(`${BACKEND_URL}${inv.image_url}`)}
                                data-testid={`invoice-image-${inv.id}`}
                                className="text-blue-700 underline"
                              >foto</button>
                            )}
                            {!d.paid && (
                              <button
                                type="button"
                                onClick={() => removeInvoice(d.id, inv.id)}
                                data-testid={`invoice-remove-${inv.id}`}
                                className="text-rose-600 underline"
                              >×</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Form aggiunta fattura */}
                {!d.paid && (
                  showAddFor === d.id ? (
                    <div className="mt-2 bg-white border border-blue-200 rounded p-2 space-y-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => onSelectAddFile(e.target.files[0])}
                          data-testid={`add-invoice-file-${d.id}`}
                          className="text-xs"
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Importo €"
                          value={addImporto}
                          onChange={(e) => setAddImporto(e.target.value)}
                          data-testid={`add-invoice-importo-${d.id}`}
                          className="h-8 px-2 border border-gray-300 rounded text-sm w-32"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => submitInvoice(d.id)}
                          data-testid={`add-invoice-submit-${d.id}`}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs px-3 py-1.5 rounded-md"
                        >
                          {busy ? '...' : 'Allega'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelAdd}
                          className="text-xs text-gray-700 underline"
                        >Annulla</button>
                      </div>
                      {addPreview && <img src={addPreview} alt="anteprima" className="max-h-32 rounded border border-gray-200" />}
                      {errorByDdt[d.id] && (
                        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-2 py-1 rounded">{errorByDdt[d.id]}</div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openAdd(d.id)}
                        data-testid={`open-add-invoice-${d.id}`}
                        className="text-xs bg-white hover:bg-gray-50 text-blue-700 border border-blue-300 px-3 py-1 rounded-md font-medium"
                      >
                        + Allega fattura
                      </button>
                      {errorByDdt[d.id] && (
                        <span className="text-xs text-red-700">{errorByDdt[d.id]}</span>
                      )}
                    </div>
                  )
                )}
                {d.paid && d.paid_at && (
                  <div className="mt-2 text-[11px] text-amber-800 font-bold">
                    Pagato il {new Date(d.paid_at).toLocaleString('it-IT')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
          data-testid="fatture-lightbox"
        >
          <PanZoomImage src={lightboxUrl} alt="documento" />
        </div>
      )}
    </div>
  );
};

export default AdminFatturePage;
