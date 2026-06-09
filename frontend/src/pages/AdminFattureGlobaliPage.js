import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import PanZoomImage from '../components/PanZoomImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const fmtEur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS = (g) => {
  if (g.paid) return 'paid';
  const importo = Number(g.importo || 0);
  const sum = Number(g.linked_sum || 0);
  if (importo > 0 && Math.abs(importo - sum) < 0.01) return 'ready';
  return 'pending';
};

const AdminFattureGlobaliPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();

  const [globals, setGlobals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [restaurants, setRestaurants] = useState([]);

  // Upload form
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [supplier, setSupplier] = useState('');
  const [importo, setImporto] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Pannello "abbina fatture locali" attivo per quale globale
  const [expandedFor, setExpandedFor] = useState(null);
  const [localInvoicesBySupplier, setLocalInvoicesBySupplier] = useState({}); // supplier -> []
  const [errorByGlobal, setErrorByGlobal] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const authHeaders = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  const fetchAll = async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        axios.get(`${API}/admin/fatture-globali`, authHeaders),
        axios.get(`${API}/suppliers`, authHeaders),
        axios.get(`${API}/admin/restaurants`, authHeaders),
      ]);
      setGlobals(r1.data || []);
      setSuppliers(r2.data || []);
      setRestaurants(r3.data || []);
    } catch (e) { /* ignore */ }
  };
  useEffect(() => {
    if (!token || !isAdmin) return;
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const restaurantNameById = useMemo(() => {
    const map = {};
    (restaurants || []).forEach(r => { map[r.id] = r.location || r.username || r.name || r.id; });
    return map;
  }, [restaurants]);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!file) { setError('Seleziona la foto della fattura'); return; }
    if (!supplier) { setError('Seleziona un fornitore'); return; }
    const imp = parseFloat((importo || '').toString().replace(',', '.'));
    if (Number.isNaN(imp) || imp <= 0) { setError('Importo non valido'); return; }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/admin/fatture-globali`, {
            supplier,
            importo: imp,
            image_data: reader.result,
            invoice_date: new Date(invoiceDate).toISOString(),
          }, authHeaders);
          setFile(null); setPreview(null); setSupplier(''); setImporto('');
          setSuccess('Fattura globale caricata');
          fetchAll();
        } catch (err) {
          setError(err.response?.data?.detail || 'Errore caricamento');
        } finally { setLoading(false); }
      };
      reader.readAsDataURL(file);
    } catch (_) { setLoading(false); }
  };

  const loadLocalInvoices = async (sup) => {
    try {
      const r = await axios.get(`${API}/admin/fatture-locali-by-supplier`, {
        ...authHeaders,
        params: { supplier: sup },
      });
      setLocalInvoicesBySupplier(prev => ({ ...prev, [sup]: r.data || [] }));
    } catch (e) {
      setLocalInvoicesBySupplier(prev => ({ ...prev, [sup]: [] }));
    }
  };

  const toggleExpand = async (g) => {
    if (expandedFor === g.id) { setExpandedFor(null); return; }
    setExpandedFor(g.id);
    if (!localInvoicesBySupplier[g.supplier]) await loadLocalInvoices(g.supplier);
  };

  const link = async (g, inv) => {
    setErrorByGlobal(prev => ({ ...prev, [g.id]: '' }));
    try {
      await axios.post(`${API}/admin/fatture-globali/${g.id}/link/${inv.id}`, {}, authHeaders);
      await fetchAll();
      await loadLocalInvoices(g.supplier);
    } catch (err) {
      setErrorByGlobal(prev => ({ ...prev, [g.id]: err.response?.data?.detail || 'Errore' }));
    }
  };
  const unlink = async (g, inv) => {
    setErrorByGlobal(prev => ({ ...prev, [g.id]: '' }));
    try {
      await axios.delete(`${API}/admin/fatture-globali/${g.id}/link/${inv.id}`, authHeaders);
      await fetchAll();
      await loadLocalInvoices(g.supplier);
    } catch (err) {
      setErrorByGlobal(prev => ({ ...prev, [g.id]: err.response?.data?.detail || 'Errore' }));
    }
  };
  const pay = async (g) => {
    setErrorByGlobal(prev => ({ ...prev, [g.id]: '' }));
    try {
      await axios.post(`${API}/admin/fatture-globali/${g.id}/pay`, {}, authHeaders);
      fetchAll();
    } catch (err) {
      setErrorByGlobal(prev => ({ ...prev, [g.id]: err.response?.data?.detail || 'Errore' }));
    }
  };
  const removeGlobal = async (g) => {
    if (!window.confirm('Eliminare definitivamente questa fattura globale? (le fatture locali NON vengono eliminate)')) return;
    try {
      await axios.delete(`${API}/admin/fatture-globali/${g.id}`, authHeaders);
      fetchAll();
    } catch (e) { /* ignore */ }
  };

  // Ordinamento: pending+ready prima (data desc), paid in fondo
  const orderedGlobals = useMemo(() => {
    const active = globals.filter(g => !g.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const paid = globals.filter(g => g.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
    return [...active, ...paid];
  }, [globals]);

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
            <h1 className="text-2xl font-bold text-gray-900">Fatture Globale</h1>
            <p className="text-sm text-gray-500">Carica una fattura globale (fornitore + importo + foto), poi abbina le fatture caricate dai singoli locali per lo stesso fornitore</p>
          </div>
          <button data-testid="fatture-globale-back-home" onClick={() => navigate('/')} className="text-sm text-gray-700 underline">← Home</button>
        </div>

        {/* Form upload nuova fattura globale */}
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3" data-testid="fg-upload-form">
          <h2 className="text-lg font-bold text-gray-800">Carica nuova fattura globale</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Foto fattura</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleFile(e.target.files[0])}
                data-testid="fg-file-input"
                className="w-full text-sm text-gray-700"
              />
              {preview && <img src={preview} alt="anteprima" className="mt-2 max-h-40 rounded border border-gray-200" />}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fornitore</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                data-testid="fg-supplier-select"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none bg-white"
              >
                <option value="">— scegli —</option>
                {suppliers.map(s => (<option key={s.id || s.name} value={s.name}>{s.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Importo (€)</label>
              <input
                type="text"
                inputMode="decimal"
                value={importo}
                onChange={(e) => setImporto(e.target.value)}
                placeholder="es. 3000,00"
                data-testid="fg-importo-input"
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data fattura</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full h-10 px-3 border border-gray-300 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2 rounded">{success}</div>}
          <button
            type="submit"
            disabled={loading}
            data-testid="fg-submit"
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-md text-sm"
          >{loading ? 'Caricamento…' : 'Carica fattura globale'}</button>
        </form>

        {/* Lista fatture globali */}
        <div className="space-y-3" data-testid="fg-list">
          {orderedGlobals.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
              Nessuna fattura globale caricata.
            </div>
          )}
          {orderedGlobals.map(g => {
            const st = STATUS(g);
            const diff = Number(g.importo || 0) - Number(g.linked_sum || 0);
            const expanded = expandedFor === g.id;
            const localList = (localInvoicesBySupplier[g.supplier] || []);
            return (
              <div key={g.id} data-testid={`fg-row-${g.id}`} className={`rounded-lg border border-gray-200 p-3 ${rowClass(st)}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge(st)}
                      <span className="font-bold text-gray-900">{g.supplier}</span>
                      <span className="text-xs text-gray-500">{(g.invoice_date || g.created_at) ? new Date(g.invoice_date || g.created_at).toLocaleDateString('it-IT') : ''}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 flex items-center gap-3 flex-wrap">
                      <span>Importo: <b>€ {fmtEur(g.importo)}</b></span>
                      <span>Abbinate locali: <b>€ {fmtEur(g.linked_sum)}</b></span>
                      {!g.paid && (
                        <span className={diff > 0.005 ? 'text-blue-700' : (diff < -0.005 ? 'text-rose-700' : 'text-emerald-700 font-bold')}>
                          {diff > 0.005 ? `Mancano € ${fmtEur(diff)}` : diff < -0.005 ? `Eccesso € ${fmtEur(-diff)}` : 'Importi coincidono ✓'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {g.image_url && (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(`${BACKEND_URL}${g.image_url}`)}
                        data-testid={`fg-image-${g.id}`}
                        className="text-blue-700 text-xs underline"
                      >Vedi fattura</button>
                    )}
                    {!g.paid && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(g)}
                        data-testid={`fg-expand-${g.id}`}
                        className="text-xs bg-white hover:bg-gray-50 text-blue-700 border border-blue-300 px-3 py-1 rounded-md font-medium"
                      >{expanded ? 'Chiudi' : '+ Abbina fatture locali'}</button>
                    )}
                    {!g.paid && st === 'ready' && (
                      <button
                        type="button"
                        onClick={() => pay(g)}
                        data-testid={`fg-pay-${g.id}`}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded-md uppercase tracking-wider"
                      >CHECK OK, PAGA</button>
                    )}
                    {!g.paid && (
                      <button
                        type="button"
                        onClick={() => removeGlobal(g)}
                        data-testid={`fg-delete-${g.id}`}
                        className="text-xs text-rose-600 underline"
                      >elimina</button>
                    )}
                  </div>
                </div>

                {/* Linked invoices (sempre visibili se ce ne sono) */}
                {(g.linked_invoices || []).length > 0 && (
                  <div className="mt-2 bg-white/70 rounded border border-gray-200 p-2">
                    <div className="text-[11px] font-bold text-gray-700 uppercase mb-1">Fatture locali abbinate ({g.linked_invoices.length})</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {g.linked_invoices.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 text-xs">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-900">€ {fmtEur(inv.importo)}</span>
                            <span className="text-[10px] text-gray-500">{inv.uploaded_by || restaurantNameById[inv.restaurant_id] || ''}</span>
                            <span className="text-[10px] text-gray-400">{inv.created_at ? new Date(inv.created_at).toLocaleDateString('it-IT') : ''}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {inv.image_url && (
                              <button
                                type="button"
                                onClick={() => setLightboxUrl(`${BACKEND_URL}${inv.image_url}`)}
                                className="text-blue-700 underline"
                              >foto</button>
                            )}
                            {!g.paid && (
                              <button
                                type="button"
                                onClick={() => unlink(g, inv)}
                                data-testid={`fg-unlink-${inv.id}`}
                                className="text-rose-600 underline"
                              >×</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pannello abbinamento espanso: lista delle locali per quel fornitore */}
                {expanded && !g.paid && (
                  <div className="mt-2 bg-white border border-blue-200 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] font-bold text-gray-700 uppercase">Fatture locali del fornitore "{g.supplier}"</div>
                      <button
                        type="button"
                        onClick={() => loadLocalInvoices(g.supplier)}
                        className="text-[11px] text-blue-700 underline"
                      >↻ aggiorna</button>
                    </div>
                    {(localList || []).length === 0 ? (
                      <div className="text-xs text-gray-400 italic py-2">Nessuna fattura locale per questo fornitore.</div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {localList.map(inv => {
                          const isLinkedHere = (g.linked_invoices || []).some(x => x.id === inv.id);
                          const isLinkedElsewhere = inv.already_linked && !isLinkedHere;
                          return (
                            <div key={inv.id} className={`flex items-center justify-between border rounded p-2 text-xs ${isLinkedHere ? 'bg-emerald-50 border-emerald-200' : isLinkedElsewhere ? 'bg-gray-100 border-gray-200 opacity-60' : 'bg-white border-gray-200'}`}>
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="font-bold text-gray-900">€ {fmtEur(inv.importo)}</span>
                                <span className="text-[10px] text-gray-500 truncate">{inv.uploaded_by || restaurantNameById[inv.restaurant_id] || ''}</span>
                                <span className="text-[10px] text-gray-400">{inv.created_at ? new Date(inv.created_at).toLocaleDateString('it-IT') : ''}</span>
                              </div>
                              <div className="flex items-center gap-2 ml-2">
                                {inv.image_url && (
                                  <button
                                    type="button"
                                    onClick={() => setLightboxUrl(`${BACKEND_URL}${inv.image_url}`)}
                                    className="text-blue-700 underline"
                                  >foto</button>
                                )}
                                {isLinkedHere ? (
                                  <span className="text-emerald-700 font-bold">✓ abbinata</span>
                                ) : isLinkedElsewhere ? (
                                  <span className="text-gray-500 italic">già abbinata altrove</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => link(g, inv)}
                                    data-testid={`fg-link-${inv.id}`}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2 py-1 rounded"
                                  >abbina</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {errorByGlobal[g.id] && (
                  <div className="mt-2 bg-red-50 border border-red-200 text-red-700 text-xs px-2 py-1 rounded">{errorByGlobal[g.id]}</div>
                )}
                {g.paid && g.paid_at && (
                  <div className="mt-2 text-[11px] text-amber-800 font-bold">
                    Pagata il {new Date(g.paid_at).toLocaleString('it-IT')}
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
          data-testid="fg-lightbox"
        >
          <PanZoomImage src={lightboxUrl} alt="fattura" />
        </div>
      )}
    </div>
  );
};

export default AdminFattureGlobaliPage;
