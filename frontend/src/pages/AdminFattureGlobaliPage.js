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

  const activeGlobals = useMemo(
    () => globals.filter(g => !g.paid).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [globals]
  );
  const archivedGlobals = useMemo(
    () => globals.filter(g => g.paid).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || '')),
    [globals]
  );

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

        {/* === FATTURE CARICATE (NON PAGATE) === */}
        <div className="space-y-3 mb-6" data-testid="fg-list">
          {activeGlobals.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded p-5 text-center text-gray-400 text-sm">
              Nessuna fattura attiva. Compila il form sopra per iniziare.
            </div>
          )}
          {activeGlobals.map(g => {
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

        {/* === SEZIONE 2: TABELLA DDT DEI LOCALI === */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6" data-testid="ddt-table-section">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-800">DDT dei locali</h2>
            <span className="text-[11px] text-gray-500">{ddtList.length} totali · ordinati per fornitore</span>
          </div>
          {ddtList.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-6">Nessun DDT caricato dai locali.</div>
          ) : (
            <div className="overflow-x-auto" data-testid="ddt-by-supplier">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 text-gray-700 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Fornitore</th>
                    <th className="px-3 py-2 text-left font-semibold">Locale</th>
                    <th className="px-3 py-2 text-left font-semibold">Numero DDT</th>
                    <th className="px-3 py-2 text-left font-semibold">Data</th>
                    <th className="px-3 py-2 text-left font-semibold">Foto</th>
                    <th className="px-3 py-2 text-left font-semibold">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {ddtList.map((d, i) => {
                    const prevSupplier = i > 0 ? ddtList[i - 1].supplier : null;
                    const isFirstOfSupplier = d.supplier !== prevSupplier;
                    return (
                      <tr
                        key={d.id}
                        data-testid={`ddt-row-${d.id}`}
                        className={`${isFirstOfSupplier ? 'border-t-2 border-gray-300' : 'border-t border-gray-100'} ${d.already_linked ? 'bg-emerald-50/40' : 'hover:bg-gray-50'}`}
                      >
                        <td className={`px-3 py-1.5 ${isFirstOfSupplier ? 'font-bold text-gray-900' : 'text-gray-400'}`}>
                          {isFirstOfSupplier ? d.supplier : ''}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">
                          {restaurantNameById[d.restaurant_id] || d.uploaded_by || ''}
                        </td>
                        <td className="px-3 py-1.5 font-mono font-bold text-gray-900">{d.ddt_number}</td>
                        <td className="px-3 py-1.5 text-gray-600">
                          {d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : ''}
                        </td>
                        <td className="px-3 py-1.5">
                          {d.image_url ? (
                            <button
                              type="button"
                              onClick={() => setLightboxUrl(`${BACKEND_URL}${d.image_url}`)}
                              title="Apri foto"
                            >
                              <img src={`${BACKEND_URL}${d.image_url}`} alt="" className="h-8 w-8 rounded border border-gray-300 object-cover hover:ring-2 hover:ring-blue-400" />
                            </button>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {d.already_linked ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Abbinato
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-blue-700 font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              In attesa
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* === SEZIONE 3: ARCHIVIO FATTURE PAGATE === */}
        <details className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-testid="fg-archive-section">
          <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 flex items-center justify-between bg-amber-50/50">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Archivio fatture pagate ({archivedGlobals.length})
            </span>
            <span className="text-[10px] text-gray-400 font-normal">clicca per espandere</span>
          </summary>
          <div className="border-t border-gray-200 p-3 space-y-2">
            {archivedGlobals.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-4">Nessuna fattura pagata.</div>
            ) : (
              archivedGlobals.map(g => (
                <details key={g.id} data-testid={`fg-archived-${g.id}`} className="bg-amber-50/40 border border-amber-200 rounded">
                  <summary className="cursor-pointer px-3 py-2 hover:bg-amber-100/50 flex items-center justify-between gap-2 flex-wrap text-xs">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {g.image_url && (
                        <img src={`${BACKEND_URL}${g.image_url}`} alt="" className="h-9 w-9 rounded border border-amber-300 object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 truncate">{g.supplier}</div>
                        <div className="text-[10px] text-gray-600 truncate">
                          DDT: <span className="font-semibold">{(g.declared_ddt || []).join(', ') || '—'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-shrink-0">
                      <span>Pagata il <b className="text-amber-800">{g.paid_at ? new Date(g.paid_at).toLocaleDateString('it-IT') : '—'}</b></span>
                      <span className="text-amber-700 underline">vedi dettagli</span>
                    </div>
                  </summary>
                  <div className="border-t border-amber-200 p-3 bg-white">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="text-[11px] text-gray-700">
                        Fattura: <b>{g.supplier}</b>
                        {' · '}Data: {g.invoice_date ? new Date(g.invoice_date).toLocaleDateString('it-IT') : '—'}
                        {' · '}Pagata: {g.paid_at ? new Date(g.paid_at).toLocaleString('it-IT') : '—'}
                      </div>
                      {g.image_url && (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(`${BACKEND_URL}${g.image_url}`)}
                          className="text-xs text-blue-700 underline"
                        >Apri foto fattura</button>
                      )}
                    </div>
                    <div className="text-[11px] font-bold text-gray-700 uppercase mb-1">DDT abbinati ({(g.linked_invoices || []).length})</div>
                    {(g.linked_invoices || []).length === 0 ? (
                      <div className="text-xs text-gray-400 italic">Nessun DDT.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-100 text-gray-700 uppercase">
                            <tr>
                              <th className="px-2 py-1 text-left font-semibold">Locale</th>
                              <th className="px-2 py-1 text-left font-semibold">Numero DDT</th>
                              <th className="px-2 py-1 text-left font-semibold">Data</th>
                              <th className="px-2 py-1 text-left font-semibold">Foto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.linked_invoices.map(inv => (
                              <tr key={inv.id} className="border-t border-gray-100">
                                <td className="px-2 py-1 text-gray-700">{restaurantNameById[inv.restaurant_id] || inv.uploaded_by || ''}</td>
                                <td className="px-2 py-1 font-mono font-bold text-gray-900">{inv.ddt_number || '—'}</td>
                                <td className="px-2 py-1 text-gray-600">{inv.created_at ? new Date(inv.created_at).toLocaleDateString('it-IT') : ''}</td>
                                <td className="px-2 py-1">
                                  {inv.image_url ? (
                                    <button
                                      type="button"
                                      onClick={() => setLightboxUrl(`${BACKEND_URL}${inv.image_url}`)}
                                      title="Apri foto"
                                    >
                                      <img src={`${BACKEND_URL}${inv.image_url}`} alt="" className="h-7 w-7 rounded border border-gray-300 object-cover hover:ring-2 hover:ring-blue-400" />
                                    </button>
                                  ) : <span className="text-gray-400">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </details>
              ))
            )}
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
