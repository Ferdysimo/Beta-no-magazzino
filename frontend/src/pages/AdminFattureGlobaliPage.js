import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import PanZoomImage from '../components/PanZoomImage';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const normalizeDdt = (s) => (s || '').toString().replace(/\s+/g, '').toLowerCase();

const STATUS = (g) => {
  if (g.paid) return 'paid';
  const linkedCount = (g.linked_invoices || []).length;
  const missing = (g.missing_ddt || []).length;
  const extra = Number(g.extra_ddt_count || 0);
  if (linkedCount === 0) return 'pending';      // BLU
  if (missing === 0 && extra === 0) return 'ready'; // VERDE
  return 'mismatch';                                 // ROSSO
};

const AdminFattureGlobaliPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();

  const [globals, setGlobals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [ddtList, setDdtList] = useState([]); // tutti i DDT dei locali

  // Upload form
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [supplier, setSupplier] = useState('');
  const [ddtNumbers, setDdtNumbers] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Espansione abbina per ID fattura globale
  const [expandedFor, setExpandedFor] = useState(null);
  const [errorByGlobal, setErrorByGlobal] = useState({});
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const authHeaders = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const fetchAll = async () => {
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        axios.get(`${API}/admin/fatture-globali`, authHeaders),
        axios.get(`${API}/suppliers`, authHeaders),
        axios.get(`${API}/admin/restaurants`, authHeaders),
        axios.get(`${API}/admin/ddt-list`, authHeaders),
      ]);
      setGlobals(r1.data || []);
      setSuppliers(r2.data || []);
      setRestaurants(r3.data || []);
      setDdtList(r4.data || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (!token || !isAdmin) return;
    fetchAll();
  }, [token, isAdmin]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightboxUrl(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  const restaurantNameById = useMemo(() => {
    const map = {};
    (restaurants || []).forEach(r => {
      map[r.id] = r.location || r.username || r.name || r.id;
    });
    return map;
  }, [restaurants]);

  // DDT raggruppati per fornitore (sezione 2)
  const ddtBySupplier = useMemo(() => {
    const groups = {};
    (ddtList || []).forEach(d => {
      const key = d.supplier || '— sconosciuto —';
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    });
    // ordine alfabetico per fornitore
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map(k => ({ supplier: k, items: groups[k] }));
  }, [ddtList]);

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
    if (!ddtNumbers.trim()) { setError('Inserisci almeno un numero DDT'); return; }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          await axios.post(`${API}/admin/fatture-globali`, {
            supplier,
            ddt_numbers: ddtNumbers.trim(),
            image_data: reader.result,
            invoice_date: new Date(invoiceDate).toISOString(),
          }, authHeaders);
          setFile(null); setPreview(null); setSupplier(''); setDdtNumbers('');
          setSuccess('Fattura caricata: DDT corrispondenti abbinati automaticamente');
          setTimeout(() => setSuccess(''), 4000);
          fetchAll();
        } catch (err) {
          setError(err.response?.data?.detail || 'Errore caricamento');
        } finally { setLoading(false); }
      };
      reader.readAsDataURL(file);
    } catch (_) { setLoading(false); }
  };

  const toggleExpand = (g) => {
    setExpandedFor(prev => (prev === g.id ? null : g.id));
  };

  const linkDdt = async (g, ddt) => {
    setErrorByGlobal(prev => ({ ...prev, [g.id]: '' }));
    try {
      await axios.post(`${API}/admin/fatture-globali/${g.id}/link/${ddt.id}`, {}, authHeaders);
      await fetchAll();
    } catch (err) {
      setErrorByGlobal(prev => ({ ...prev, [g.id]: err.response?.data?.detail || 'Errore' }));
    }
  };

  const unlinkDdt = async (g, ddt) => {
    setErrorByGlobal(prev => ({ ...prev, [g.id]: '' }));
    try {
      await axios.delete(`${API}/admin/fatture-globali/${g.id}/link/${ddt.id}`, authHeaders);
      await fetchAll();
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
    if (!window.confirm('Eliminare definitivamente questa fattura? (i DDT dei locali NON vengono eliminati)')) return;
    try {
      await axios.delete(`${API}/admin/fatture-globali/${g.id}`, authHeaders);
      fetchAll();
    } catch (e) { /* ignore */ }
  };

  // Ordinamento: pending/ready/mismatch prima (data desc), paid in fondo
  const orderedGlobals = useMemo(() => {
    const active = globals.filter(g => !g.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const paid = globals.filter(g => g.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
    return [...active, ...paid];
  }, [globals]);

  const rowClass = (st) => {
    if (st === 'paid') return 'bg-amber-50 border-l-4 border-amber-500';
    if (st === 'ready') return 'bg-emerald-50 border-l-4 border-emerald-500';
    if (st === 'mismatch') return 'bg-rose-50 border-l-4 border-rose-500';
    return 'bg-blue-50 border-l-4 border-blue-500';
  };

  const badge = (st) => {
    if (st === 'paid') return <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold uppercase">PAGATO</span>;
    if (st === 'ready') return <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 text-[10px] font-bold uppercase">CHECK OK</span>;
    if (st === 'mismatch') return <span className="px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 text-[10px] font-bold uppercase">DDT NON COINCIDONO</span>;
    return <span className="px-2 py-0.5 rounded-full bg-blue-200 text-blue-900 text-[10px] font-bold uppercase">IN ATTESA</span>;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fatture Globale</h1>
            <p className="text-sm text-gray-500">Carica una fattura (fornitore + numeri DDT + foto). I DDT corrispondenti caricati dai locali vengono abbinati automaticamente.</p>
          </div>
          <button
            data-testid="fatture-globale-back-home"
            onClick={() => navigate('/')}
            className="text-sm text-gray-700 underline"
          >← Home</button>
        </div>

        {/* === FORM UPLOAD FATTURA === */}
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3" data-testid="fg-upload-form">
          <h2 className="text-lg font-bold text-gray-800">Carica nuova fattura</h2>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Numeri DDT (separati da virgola)</label>
              <input
                type="text"
                value={ddtNumbers}
                onChange={(e) => setDdtNumbers(e.target.value)}
                placeholder="es. 12345, 67890, 99000"
                data-testid="fg-ddt-numbers-input"
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
          >{loading ? 'Caricamento…' : 'Carica fattura'}</button>
        </form>

        {/* === SEZIONE 1: FATTURE CARICATE === */}
        <div className="mb-2">
          <h2 className="text-lg font-bold text-gray-900">Fatture caricate</h2>
        </div>
        <div className="space-y-3 mb-8" data-testid="fg-list">
          {orderedGlobals.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
              Nessuna fattura caricata.
            </div>
          )}
          {orderedGlobals.map(g => {
            const st = STATUS(g);
            const expanded = expandedFor === g.id;
            const declared = g.declared_ddt || [];
            const linked = g.linked_invoices || [];
            const linkedNormSet = new Set(linked.map(l => normalizeDdt(l.ddt_number)));
            // DDT disponibili per quel fornitore (esclusi quelli già linkati a OGNI fattura globale - già_linked oppure linkati a questa stessa)
            const supplierDdts = (ddtList || []).filter(d => d.supplier === g.supplier);

            return (
              <div key={g.id} data-testid={`fg-row-${g.id}`} className={`rounded-lg border border-gray-200 p-3 ${rowClass(st)}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge(st)}
                      <span className="font-bold text-gray-900">{g.supplier}</span>
                      <span className="text-xs text-gray-500">
                        {(g.invoice_date || g.created_at) ? new Date(g.invoice_date || g.created_at).toLocaleDateString('it-IT') : ''}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 flex items-center gap-3 flex-wrap">
                      <span>DDT dichiarati: <b>{declared.length ? declared.join(', ') : '—'}</b></span>
                      <span>Abbinati: <b>{linked.length}/{declared.length}</b></span>
                    </div>
                    {!g.paid && (g.missing_ddt || []).length > 0 && (
                      <div className="text-xs text-rose-700 font-bold mt-1">
                        DDT mancanti: {g.missing_ddt.join(', ')}
                      </div>
                    )}
                    {!g.paid && Number(g.extra_ddt_count || 0) > 0 && (
                      <div className="text-xs text-rose-700 font-bold mt-1">
                        Ci sono {g.extra_ddt_count} DDT abbinati non presenti tra quelli dichiarati
                      </div>
                    )}
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
                      >{expanded ? 'Chiudi' : '+ Modifica abbinamenti'}</button>
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
                {linked.length > 0 && (
                  <div className="mt-2 bg-white/70 rounded border border-gray-200 p-2">
                    <div className="text-[11px] font-bold text-gray-700 uppercase mb-1">DDT abbinati ({linked.length})</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {linked.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 text-xs">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-900">DDT n. {inv.ddt_number || '—'}</span>
                            <span className="text-[10px] text-gray-500">{restaurantNameById[inv.restaurant_id] || inv.uploaded_by || ''}</span>
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
                                onClick={() => unlinkDdt(g, inv)}
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

                {/* Pannello abbinamento espanso: checkbox sui DDT del fornitore */}
                {expanded && !g.paid && (
                  <div className="mt-2 bg-white border border-blue-200 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] font-bold text-gray-700 uppercase">
                        DDT del fornitore «{g.supplier}» — seleziona con il check quelli da abbinare
                      </div>
                      <button
                        type="button"
                        onClick={fetchAll}
                        className="text-[11px] text-blue-700 underline"
                      >↻ aggiorna</button>
                    </div>
                    {supplierDdts.length === 0 ? (
                      <div className="text-xs text-gray-400 italic py-2">
                        Nessun DDT per questo fornitore. I locali devono prima caricarne uno con il «Numero DDT».
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {supplierDdts.map(d => {
                          const isLinkedHere = linkedNormSet.has(normalizeDdt(d.ddt_number));
                          const isLinkedElsewhere = d.already_linked && !isLinkedHere;
                          return (
                            <label
                              key={d.id}
                              className={`flex items-center justify-between border rounded p-2 text-xs cursor-pointer ${
                                isLinkedHere ? 'bg-emerald-50 border-emerald-200' :
                                isLinkedElsewhere ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' :
                                'bg-white border-gray-200 hover:bg-blue-50'
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isLinkedHere}
                                  disabled={isLinkedElsewhere}
                                  onChange={() => {
                                    if (isLinkedElsewhere) return;
                                    if (isLinkedHere) unlinkDdt(g, d);
                                    else linkDdt(g, d);
                                  }}
                                  data-testid={`fg-check-${g.id}-${d.id}`}
                                />
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="font-bold text-gray-900">DDT n. {d.ddt_number}</span>
                                  <span className="text-[10px] text-gray-500 truncate">
                                    {restaurantNameById[d.restaurant_id] || d.uploaded_by || ''}
                                  </span>
                                  <span className="text-[10px] text-gray-400">
                                    {d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 ml-2">
                                {d.image_url && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); setLightboxUrl(`${BACKEND_URL}${d.image_url}`); }}
                                    className="text-blue-700 underline"
                                  >foto</button>
                                )}
                                {isLinkedElsewhere && (
                                  <span className="text-gray-500 italic">già altrove</span>
                                )}
                              </div>
                            </label>
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

        {/* === SEZIONE 2: DDT IN ATTESA DI ABBINAMENTO === */}
        <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold text-gray-900">DDT dei locali — raggruppati per fornitore</h2>
          <span className="text-xs text-gray-500">Totale: {ddtList.length} DDT</span>
        </div>
        <div className="space-y-4" data-testid="ddt-by-supplier">
          {ddtBySupplier.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-400">
              Nessun DDT caricato dai locali con numero DDT compilato.
            </div>
          )}
          {ddtBySupplier.map(group => {
            const pending = group.items.filter(d => !d.already_linked);
            const linked = group.items.filter(d => d.already_linked);
            return (
              <div key={group.supplier} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div className="font-bold text-gray-800">{group.supplier}</div>
                  <div className="text-xs text-gray-600">
                    <span className="font-bold text-blue-700">{pending.length} in attesa</span>
                    {' · '}
                    <span className="text-emerald-700">{linked.length} abbinati</span>
                  </div>
                </div>
                <div className="p-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {group.items.map(d => (
                    <div
                      key={d.id}
                      data-testid={`ddt-card-${d.id}`}
                      className={`border rounded p-2 text-xs flex items-center justify-between ${
                        d.already_linked ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'
                      }`}
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-bold text-gray-900">DDT n. {d.ddt_number}</span>
                        <span className="text-[10px] text-gray-500 truncate">
                          {restaurantNameById[d.restaurant_id] || d.uploaded_by || ''}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        {d.image_url && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(`${BACKEND_URL}${d.image_url}`)}
                            className="text-blue-700 underline"
                          >foto</button>
                        )}
                        {d.already_linked ? (
                          <span className="text-emerald-700 font-bold">✓ abbinato</span>
                        ) : (
                          <span className="text-blue-700 font-bold">in attesa</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          data-testid="fg-lightbox"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            data-testid="fg-lightbox-close"
            title="Chiudi"
            className="fixed top-4 right-4 z-[60] w-12 h-12 rounded-full bg-white text-gray-900 text-2xl font-bold shadow-lg hover:bg-gray-100 flex items-center justify-center"
          >×</button>
          <div className="max-w-[95vw] max-h-[95vh] w-full h-full flex items-center justify-center">
            <PanZoomImage src={lightboxUrl} alt="fattura" />
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminFattureGlobaliPage;
