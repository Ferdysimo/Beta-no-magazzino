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
  if (linkedCount === 0) return 'pending';
  if (missing === 0 && extra === 0) return 'ready';
  return 'mismatch';
};

const AdminFattureGlobaliPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();

  const [globals, setGlobals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [ddtList, setDdtList] = useState([]);

  // Form
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [supplier, setSupplier] = useState('');
  const [ddtNumbers, setDdtNumbers] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
    (restaurants || []).forEach(r => { map[r.id] = r.location || r.username || r.name || r.id; });
    return map;
  }, [restaurants]);

  // Tutti i fornitori per cui esiste almeno un DDT
  const ddtBySupplier = useMemo(() => {
    const g = {};
    (ddtList || []).forEach(d => {
      const k = d.supplier || '— sconosciuto —';
      (g[k] = g[k] || []).push(d);
    });
    return Object.keys(g).sort((a, b) => a.localeCompare(b)).map(k => ({ supplier: k, items: g[k] }));
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
    setError('');
    if (!file) { setError('Foto obbligatoria'); return; }
    if (!supplier) { setError('Fornitore obbligatorio'); return; }
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
          fetchAll();
        } catch (err) {
          setError(err.response?.data?.detail || 'Errore caricamento');
        } finally { setLoading(false); }
      };
      reader.readAsDataURL(file);
    } catch (_) { setLoading(false); }
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
    if (!window.confirm('Eliminare questa fattura? (i DDT dei locali NON vengono toccati)')) return;
    try {
      await axios.delete(`${API}/admin/fatture-globali/${g.id}`, authHeaders);
      fetchAll();
    } catch (e) { /* ignore */ }
  };

  const orderedGlobals = useMemo(() => {
    const active = globals.filter(g => !g.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const paid = globals.filter(g => g.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
    return [...active, ...paid];
  }, [globals]);

  const accent = (st) => {
    if (st === 'paid') return 'border-amber-400 bg-amber-50';
    if (st === 'ready') return 'border-emerald-400 bg-emerald-50';
    if (st === 'mismatch') return 'border-rose-400 bg-rose-50';
    return 'border-blue-400 bg-blue-50';
  };

  const dot = (st) => {
    const cls = {
      paid: 'bg-amber-500',
      ready: 'bg-emerald-500',
      mismatch: 'bg-rose-500',
      pending: 'bg-blue-500',
    }[st];
    const label = { paid: 'PAGATA', ready: 'CHECK OK', mismatch: 'MISMATCH', pending: 'IN ATTESA' }[st];
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-700">
        <span className={`w-2 h-2 rounded-full ${cls}`} />
        {label}
      </span>
    );
  };

  // Fatture senza DDT loro (nessun fornitore) — sezione 2 mostra solo fornitori che non hanno una fattura attiva con TUTTI i DDT abbinati
  const suppliersWithActiveFG = useMemo(() => {
    const s = new Set();
    globals.forEach(g => { if (!g.paid) s.add(g.supplier); });
    return s;
  }, [globals]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* HEADER */}
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fatture Globale</h1>
            <p className="text-xs text-gray-500">Carica la fattura con i numeri DDT, i DDT dei locali vengono abbinati automaticamente.</p>
          </div>
          <button
            data-testid="fatture-globale-back-home"
            onClick={() => navigate('/')}
            className="text-sm text-gray-700 underline"
          >← Home</button>
        </div>

        {/* === FORM COMPATTO IN LINEA === */}
        <form onSubmit={submit} data-testid="fg-upload-form" className="bg-white border border-gray-200 rounded-lg p-3 mb-5">
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-12 md:col-span-3">
              <label className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">Foto</label>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleFile(e.target.files[0])}
                  data-testid="fg-file-input"
                  className="text-xs flex-1"
                />
                {preview && <img src={preview} alt="" className="h-9 w-9 rounded border border-gray-300 object-cover" />}
              </div>
            </div>
            <div className="col-span-12 md:col-span-3">
              <label className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">Fornitore</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                data-testid="fg-supplier-select"
                className="w-full h-9 px-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none bg-white"
              >
                <option value="">— scegli —</option>
                {suppliers.map(s => (<option key={s.id || s.name} value={s.name}>{s.name}</option>))}
              </select>
            </div>
            <div className="col-span-12 md:col-span-3">
              <label className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">Numeri DDT (virgola)</label>
              <input
                type="text"
                value={ddtNumbers}
                onChange={(e) => setDdtNumbers(e.target.value)}
                placeholder="12345, 67890"
                data-testid="fg-ddt-numbers-input"
                className="w-full h-9 px-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="col-span-6 md:col-span-2">
              <label className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">Data</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full h-9 px-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="col-span-6 md:col-span-1">
              <button
                type="submit"
                disabled={loading}
                data-testid="fg-submit"
                className="w-full h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded uppercase"
              >{loading ? '…' : 'Carica'}</button>
            </div>
          </div>
          {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
        </form>

        {/* === FATTURE CARICATE === */}
        <div className="space-y-3 mb-6" data-testid="fg-list">
          {orderedGlobals.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded p-5 text-center text-gray-400 text-sm">
              Nessuna fattura caricata. Compila il form sopra per iniziare.
            </div>
          )}
          {orderedGlobals.map(g => {
            const st = STATUS(g);
            const linked = g.linked_invoices || [];
            const linkedNormSet = new Set(linked.map(l => normalizeDdt(l.ddt_number)));
            const supplierDdts = (ddtList || []).filter(d => d.supplier === g.supplier);
            // Ordine: prima i linkati (in alto), poi gli altri DDT del fornitore disponibili
            const orderedSupplierDdts = [...supplierDdts].sort((a, b) => {
              const aL = linkedNormSet.has(normalizeDdt(a.ddt_number)) ? 0 : 1;
              const bL = linkedNormSet.has(normalizeDdt(b.ddt_number)) ? 0 : 1;
              if (aL !== bL) return aL - bL;
              return (b.created_at || '').localeCompare(a.created_at || '');
            });

            return (
              <div key={g.id} data-testid={`fg-row-${g.id}`} className={`rounded-lg border-l-4 ${accent(st)} border border-gray-200 overflow-hidden`}>
                {/* HEADER FATTURA */}
                <div className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap bg-white/60">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {g.image_url && (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(`${BACKEND_URL}${g.image_url}`)}
                        data-testid={`fg-image-${g.id}`}
                        title="Apri fattura"
                        className="flex-shrink-0"
                      >
                        <img src={`${BACKEND_URL}${g.image_url}`} alt="" className="h-10 w-10 rounded border border-gray-300 object-cover hover:ring-2 hover:ring-blue-400" />
                      </button>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 truncate">{g.supplier}</span>
                        {dot(st)}
                        <span className="text-[11px] text-gray-500">
                          {(g.invoice_date || g.created_at) ? new Date(g.invoice_date || g.created_at).toLocaleDateString('it-IT') : ''}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-600 mt-0.5">
                        DDT dichiarati: <b className="text-gray-800">{(g.declared_ddt || []).join(', ') || '—'}</b>
                        <span className="mx-2 text-gray-300">·</span>
                        <span>Abbinati <b className="text-gray-800">{linked.length}/{(g.declared_ddt || []).length}</b></span>
                        {!g.paid && (g.missing_ddt || []).length > 0 && (
                          <span className="ml-2 text-rose-700 font-semibold">manca: {g.missing_ddt.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!g.paid && st === 'ready' && (
                      <button
                        type="button"
                        onClick={() => pay(g)}
                        data-testid={`fg-pay-${g.id}`}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded uppercase tracking-wide"
                      >Paga</button>
                    )}
                    {!g.paid && (
                      <button
                        type="button"
                        onClick={() => removeGlobal(g)}
                        data-testid={`fg-delete-${g.id}`}
                        title="Elimina fattura"
                        className="text-xs text-rose-600 hover:text-rose-800 px-1"
                      >×</button>
                    )}
                    {g.paid && g.paid_at && (
                      <span className="text-[10px] text-amber-800 font-bold">
                        {new Date(g.paid_at).toLocaleDateString('it-IT')}
                      </span>
                    )}
                  </div>
                </div>

                {/* CHECKBOX DDT SEMPRE VISIBILI (solo se non pagata) */}
                {!g.paid && (
                  <div className="px-3 pb-3 pt-1 bg-white/40">
                    {orderedSupplierDdts.length === 0 ? (
                      <div className="text-[11px] text-gray-400 italic py-1">Nessun DDT caricato dai locali per «{g.supplier}».</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                        {orderedSupplierDdts.map(d => {
                          const isLinkedHere = linkedNormSet.has(normalizeDdt(d.ddt_number));
                          const isLinkedElsewhere = d.already_linked && !isLinkedHere;
                          return (
                            <label
                              key={d.id}
                              className={`flex items-center gap-2 border rounded px-2 py-1 text-[11px] ${
                                isLinkedHere ? 'bg-emerald-100 border-emerald-300' :
                                isLinkedElsewhere ? 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed' :
                                'bg-white border-gray-200 hover:border-blue-400 cursor-pointer'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isLinkedHere}
                                disabled={isLinkedElsewhere}
                                onChange={() => { if (isLinkedElsewhere) return; if (isLinkedHere) unlinkDdt(g, d); else linkDdt(g, d); }}
                                data-testid={`fg-check-${g.id}-${d.id}`}
                                className="flex-shrink-0"
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="font-bold text-gray-900 truncate">DDT {d.ddt_number}</span>
                                <span className="text-[10px] text-gray-500 truncate">
                                  {restaurantNameById[d.restaurant_id] || d.uploaded_by || ''}
                                  {d.created_at && ' · ' + new Date(d.created_at).toLocaleDateString('it-IT')}
                                </span>
                              </div>
                              {d.image_url && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); setLightboxUrl(`${BACKEND_URL}${d.image_url}`); }}
                                  title="foto"
                                  className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-[10px] underline"
                                >foto</button>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Per fatture pagate, mostro compatto i DDT abbinati */}
                {g.paid && linked.length > 0 && (
                  <div className="px-3 pb-2 pt-1 bg-white/40 text-[11px] text-gray-700">
                    Abbinati: {linked.map(l => `DDT ${l.ddt_number}`).join(' · ')}
                  </div>
                )}

                {errorByGlobal[g.id] && (
                  <div className="px-3 pb-2 text-[11px] text-rose-700 font-semibold">{errorByGlobal[g.id]}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* === SEZIONE 2: DDT raggruppati per fornitore (compatta, solo fornitori senza fattura attiva in alto) === */}
        <details className="bg-white border border-gray-200 rounded" data-testid="ddt-by-supplier-section">
          <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 flex items-center justify-between">
            <span>Tutti i DDT dei locali ({ddtList.length}) — raggruppati per fornitore</span>
            <span className="text-[10px] text-gray-400 font-normal">clicca per espandere</span>
          </summary>
          <div className="p-3 border-t border-gray-200 space-y-3" data-testid="ddt-by-supplier">
            {ddtBySupplier.length === 0 && (
              <div className="text-center text-gray-400 text-sm py-4">Nessun DDT caricato.</div>
            )}
            {ddtBySupplier.map(group => {
              const pending = group.items.filter(d => !d.already_linked).length;
              const matched = group.items.filter(d => d.already_linked).length;
              const hasActiveFG = suppliersWithActiveFG.has(group.supplier);
              return (
                <div key={group.supplier} className="border border-gray-200 rounded overflow-hidden">
                  <div className="px-2 py-1 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-800">{group.supplier}</span>
                    <span className="text-gray-600">
                      <span className="text-blue-700 font-bold">{pending}</span> in attesa
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-emerald-700">{matched}</span> abbinati
                      {hasActiveFG && <span className="ml-2 text-amber-700">⚠ fattura aperta sopra</span>}
                    </span>
                  </div>
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {group.items.map(d => (
                      <div
                        key={d.id}
                        data-testid={`ddt-card-${d.id}`}
                        className={`border rounded px-2 py-1 text-[11px] flex items-center justify-between gap-1 ${
                          d.already_linked ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'
                        }`}
                      >
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-bold text-gray-900 truncate">DDT {d.ddt_number}</span>
                          <span className="text-[10px] text-gray-500 truncate">
                            {restaurantNameById[d.restaurant_id] || d.uploaded_by || ''}
                            {d.created_at && ' · ' + new Date(d.created_at).toLocaleDateString('it-IT')}
                          </span>
                        </div>
                        {d.image_url && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(`${BACKEND_URL}${d.image_url}`)}
                            className="text-blue-700 hover:text-blue-900 text-[10px] underline flex-shrink-0"
                          >foto</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </main>

      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" data-testid="fg-lightbox">
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
