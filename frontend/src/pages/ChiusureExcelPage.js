import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, Plus, Trash2, RefreshCw } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Etichette campi cassa (allineate a ReportBetaPage)
const CASH_LABELS = {
  mattina: 'Mattina', altro: 'Altro', arr: 'Arr.',
  glo: 'Glo', just: 'Just', delv: 'Delv',
  bp: 'BP', sat: 'Sat', ft: 'Ft', pos: 'POS', vers: 'Vers',
  sp5: 'Sp.5€', sp2: 'Sp.2€', sp1: 'Sp.1€', sp05: 'Sp.0,5€',
  cd5: 'Cd.5€', cd2: 'Cd.2€', cd1: 'Cd.1€', cd05: 'Cd.0,5€',
};

// Colore di sfondo dell'header colonna per gruppo
const groupOf = (f) => {
  if (['mattina', 'altro', 'arr'].includes(f)) return 'entrate';
  if (['glo', 'just', 'delv'].includes(f)) return 'delivery';
  if (['bp', 'sat', 'ft', 'pos', 'vers'].includes(f)) return 'pagamenti';
  if (f.startsWith('sp')) return 'spicci';
  if (f.startsWith('cd')) return 'cassetto';
  return 'altro';
};
const GROUP_BG = {
  entrate: '#dcfce7',     // verde chiaro
  delivery: '#ffedd5',    // arancio chiaro
  pagamenti: '#dbeafe',   // azzurro chiaro
  spicci: '#fef3c7',      // giallo chiaro
  cassetto: '#fde68a',    // giallo più carico
};

const BEV_NAMES = {
  AL: 'Acqua nat.', AG: 'Acqua friz.', C: 'Coca', CZ: 'Coca Zero',
  F: 'Fanta', S: 'Sprite', B: 'Peroni', VB: 'Vino B.', VR: 'Vino R.',
};
const BEV_BG = '#ecfeff'; // ciano leggero

const fmtEur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => {
  const v = Number(n) || 0;
  return v === 0 ? '' : String(Math.round(v));
};
const fmtDateIT = (s) => {
  if (!s) return '';
  try { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; } catch (e) { return s; }
};
const dayName = (s) => {
  try {
    const dt = new Date(`${s}T12:00:00`);
    return dt.toLocaleDateString('it-IT', { weekday: 'short' });
  } catch (e) { return ''; }
};

const Th = ({ children, bg, sticky, left, width, title }) => (
  <th
    title={title || ''}
    style={{
      background: bg || '#374151',
      color: bg ? '#1f2937' : '#fff',
      position: sticky ? 'sticky' : undefined,
      top: 0,
      left: left !== undefined ? left : undefined,
      zIndex: sticky ? (left !== undefined ? 30 : 20) : undefined,
      width: width || undefined,
      minWidth: width || undefined,
      borderRight: '1px solid #d1d5db',
      borderBottom: '1px solid #d1d5db',
      padding: '4px 6px',
      fontWeight: 700,
      fontSize: 11,
      textAlign: 'center',
      whiteSpace: 'nowrap',
    }}
  >
    {children}
  </th>
);

const Td = ({ children, bg, sticky, left, mono, align = 'right', bold, color, title }) => (
  <td
    title={title || ''}
    style={{
      background: bg || '#fff',
      color: color || '#111827',
      position: sticky ? 'sticky' : undefined,
      left: left !== undefined ? left : undefined,
      zIndex: sticky ? 10 : undefined,
      borderRight: '1px solid #e5e7eb',
      borderBottom: '1px solid #e5e7eb',
      padding: '3px 6px',
      fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      fontVariantNumeric: 'tabular-nums',
      fontSize: 11,
      textAlign: align,
      whiteSpace: 'nowrap',
      fontWeight: bold ? 700 : 400,
    }}
  >
    {children}
  </td>
);

const ChiusureExcelPage = () => {
  const navigate = useNavigate();
  const { token, isAdmin } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(() => localStorage.getItem('closures_excel_rest_id') || '');
  const [days, setDays] = useState(() => Number(localStorage.getItem('closures_excel_days')) || 30);
  const [items, setItems] = useState([]);
  const [cashFields, setCashFields] = useState([]);
  const [bevSigle, setBevSigle] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Restaurant effettivo: o quello scelto, o il primo della lista
  const effectiveRestId = selectedRestId || restaurants[0]?.id || '';

  // Carico lista ristoranti
  useEffect(() => {
    if (!isAdmin || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, { headers });
        const list = (res.data || []).filter(r => r.role !== 'admin');
        setRestaurants(list);
      } catch (e) { console.error('list restaurants', e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token]);

  const loadGrid = useCallback(async () => {
    if (!isAdmin || !token || !effectiveRestId) {
      setItems([]); setCashFields([]); setBevSigle([]); return;
    }
    setLoading(true);
    try {
      const res = await axios.get(
        `${API}/admin/closures/grid?days=${days}&restaurant_id=${effectiveRestId}`,
        { headers }
      );
      setItems(res.data?.items || []);
      setCashFields(res.data?.cash_fields || []);
      setBevSigle(res.data?.bev_sigle || []);
    } catch (e) {
      console.error('load grid', e);
      setMsg('Errore caricamento griglia');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, token, effectiveRestId, days, headers]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  // Sync localStorage quando cambia selectedRestId/days
  useEffect(() => {
    if (selectedRestId) localStorage.setItem('closures_excel_rest_id', selectedRestId);
  }, [selectedRestId]);
  useEffect(() => {
    localStorage.setItem('closures_excel_days', String(days));
  }, [days]);

  const onGenerateMock = async () => {
    if (!effectiveRestId) return;
    const ok = window.confirm('Genero 7 chiusure mock per il locale selezionato? (Le righe mock esistenti vengono sovrascritte; le chiusure reali NON vengono toccate.)');
    if (!ok) return;
    setBusy(true); setMsg('');
    try {
      const res = await axios.post(`${API}/admin/closures/generate-mock`, {
        restaurant_id: effectiveRestId, days: 7, overwrite: true,
      }, { headers });
      setMsg(`Generate ${res.data.cash_rows_written} chiusure mock (${res.data.bev_rows_written} righe bevande)`);
      await loadGrid();
    } catch (e) {
      console.error(e); setMsg('Errore generazione mock');
    } finally {
      setBusy(false);
    }
  };

  const onDeleteMock = async () => {
    if (!effectiveRestId) return;
    const ok = window.confirm('Cancellare TUTTE le chiusure mock per il locale selezionato? (Solo le righe con flag mock:true.)');
    if (!ok) return;
    setBusy(true); setMsg('');
    try {
      const res = await axios.delete(`${API}/admin/closures/mock?restaurant_id=${effectiveRestId}`, { headers });
      setMsg(`Cancellate ${res.data.cash_deleted} chiusure mock (${res.data.bev_deleted} righe bevande)`);
      await loadGrid();
    } catch (e) {
      console.error(e); setMsg('Errore cancellazione mock');
    } finally {
      setBusy(false);
    }
  };

  // Totali colonna (footer)
  const totals = useMemo(() => {
    const t = { cash: {}, bev: {}, paste_count: 0, paste_total_eur: 0, cash_sera: 0, bev_total_qty: 0, bev_total_inc: 0, orders_total: 0 };
    cashFields.forEach(f => { t.cash[f] = 0; });
    bevSigle.forEach(sigla => {
      t.bev[sigla] = { mattina: 0, inUsc: 0, scarti: 0, sera: 0, qty: 0, incasso: 0 };
    });
    items.forEach(r => {
      cashFields.forEach(f => { t.cash[f] += Number(r.cash?.[f] || 0); });
      bevSigle.forEach(sigla => {
        const b = r.beverages?.[sigla] || {};
        t.bev[sigla].mattina += Number(b.mattina || 0);
        t.bev[sigla].inUsc += Number(b.inUsc || 0);
        t.bev[sigla].scarti += Number(b.scarti || 0);
        t.bev[sigla].sera += Number(b.sera || 0);
        t.bev[sigla].qty += Number(b.qty || 0);
        t.bev[sigla].incasso += Number(b.incasso || 0);
      });
      t.paste_count += Number(r.paste_count || 0);
      t.paste_total_eur += Number(r.paste_total_eur || 0);
      t.cash_sera += Number(r.cash_sera || 0);
      t.bev_total_qty += Number(r.bev_total_qty || 0);
      t.bev_total_inc += Number(r.bev_total_inc || 0);
      t.orders_total += Number(r.orders_total || 0);
    });
    return t;
  }, [items, cashFields, bevSigle]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F5F5]">
        <Header />
        <main className="max-w-3xl mx-auto p-6">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
            Accesso riservato all&apos;Admin.
          </div>
        </main>
      </div>
    );
  }

  // Posizioni colonne sticky a sinistra
  const DATE_W = 110;
  const DAY_W = 50;

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-[1920px] mx-auto p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm"
          >
            <ArrowLeft size={16} /> Home
          </button>
          <span className="text-[11px] text-gray-500">Vista Excel — una riga per giorno</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-3">
          Chiusure Excel
        </h1>

        {/* Toolbar */}
        <div className="mb-3 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <label className="text-sm font-bold text-gray-700">Locale:</label>
          <select
            data-testid="closures-excel-restaurant-select"
            value={effectiveRestId}
            onChange={(e) => setSelectedRestId(e.target.value)}
            className="min-w-[180px] border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5C518] bg-white"
          >
            {restaurants.length === 0 && <option value="">Caricamento…</option>}
            {restaurants.map(r => (
              <option key={r.id} value={r.id}>{r.location || r.username}</option>
            ))}
          </select>

          <label className="text-sm font-bold text-gray-700 ml-2">Periodo:</label>
          <select
            data-testid="closures-excel-days-select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5C518] bg-white"
          >
            <option value={7}>Ultimi 7 giorni</option>
            <option value={14}>Ultimi 14 giorni</option>
            <option value={30}>Ultimi 30 giorni</option>
            <option value={60}>Ultimi 60 giorni</option>
            <option value={90}>Ultimi 90 giorni</option>
            <option value={180}>Ultimi 6 mesi</option>
            <option value={365}>Ultimo anno</option>
          </select>

          <button
            data-testid="closures-excel-refresh"
            onClick={loadGrid}
            disabled={loading}
            className="ml-2 flex items-center gap-1 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Aggiorna
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              data-testid="closures-excel-generate-mock"
              onClick={onGenerateMock}
              disabled={busy || !effectiveRestId}
              className="flex items-center gap-1 bg-yellow-100 hover:bg-yellow-200 border border-yellow-400 text-yellow-900 px-3 py-1.5 rounded text-sm font-bold disabled:opacity-50"
              title="Genera 7 chiusure fittizie per testare la vista"
            >
              <Plus size={14} /> Genera 7 mock
            </button>
            <button
              data-testid="closures-excel-delete-mock"
              onClick={onDeleteMock}
              disabled={busy || !effectiveRestId}
              className="flex items-center gap-1 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
              title="Cancella tutte le chiusure mock di questo locale"
            >
              <Trash2 size={14} /> Cancella mock
            </button>
          </div>

          <div className="w-full text-[11px] text-gray-500 mt-1">
            {items.length} {items.length === 1 ? 'riga' : 'righe'} • somma in fondo
            {msg && <span className="ml-3 text-blue-700 font-medium">• {msg}</span>}
          </div>
        </div>

        {/* Grid */}
        <div
          className="bg-white border border-gray-300 rounded-lg overflow-auto"
          style={{ maxHeight: 'calc(100vh - 220px)' }}
        >
          {loading ? (
            <div className="p-10 text-center text-gray-400">Caricamento griglia…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              Nessuna chiusura archiviata per questo locale nel periodo selezionato.
              <br />
              <span className="text-xs">Usa &quot;Genera 7 mock&quot; qui sopra per popolare dati di test.</span>
            </div>
          ) : (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
              <thead>
                {/* Riga 1: gruppi */}
                <tr>
                  <Th sticky left={0} width={DATE_W} bg="#374151">Data</Th>
                  <Th sticky left={DATE_W} width={DAY_W} bg="#374151">Giorno</Th>
                  <Th sticky bg="#bbf7d0">CASSA — Entrate</Th>
                  <Th sticky bg="#fed7aa">Delivery</Th>
                  <Th sticky bg="#bfdbfe">Pagamenti / Vers.</Th>
                  <Th sticky bg="#fde68a">Spicci (mazzette)</Th>
                  <Th sticky bg="#fcd34d">Cassetto (stock)</Th>
                  <Th sticky bg="#a7f3d0">Paste</Th>
                  <Th sticky bg={BEV_BG} title="Per ogni sigla: Mattina | Ingressi | Scarti | Sera | Vendute (qty) | €">
                    Bevande (per sigla)
                  </Th>
                  <Th sticky bg="#fef9c3">Tot. Bev.</Th>
                  <Th sticky bg="#facc15">CASH SERA</Th>
                </tr>
                {/* Riga 2: campi */}
                <tr>
                  <Th sticky left={0} width={DATE_W} bg="#1f2937">YYYY-MM-DD</Th>
                  <Th sticky left={DATE_W} width={DAY_W} bg="#1f2937">d.s.</Th>
                  {/* Campi cash espansi sotto i loro gruppi */}
                  {['mattina','altro','arr'].map(f => (
                    <Th key={f} bg={GROUP_BG.entrate}>{CASH_LABELS[f]}</Th>
                  ))}
                  {['glo','just','delv'].map(f => (
                    <Th key={f} bg={GROUP_BG.delivery}>{CASH_LABELS[f]}</Th>
                  ))}
                  {['bp','sat','ft','pos','vers'].map(f => (
                    <Th key={f} bg={GROUP_BG.pagamenti}>{CASH_LABELS[f]}</Th>
                  ))}
                  {['sp5','sp2','sp1','sp05'].map(f => (
                    <Th key={f} bg={GROUP_BG.spicci}>{CASH_LABELS[f]}</Th>
                  ))}
                  {['cd5','cd2','cd1','cd05'].map(f => (
                    <Th key={f} bg={GROUP_BG.cassetto}>{CASH_LABELS[f]}</Th>
                  ))}
                  {/* Paste */}
                  <Th bg="#a7f3d0">N°</Th>
                  <Th bg="#a7f3d0">€</Th>
                  {/* Bevande: per ogni sigla 6 colonne (Mat, In, Sc, Sera, Qty, €) */}
                  {bevSigle.map(sigla => (
                    <React.Fragment key={sigla}>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Mattina`}>{sigla} Mat</Th>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Ingressi`}>{sigla} In</Th>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Scarti`}>{sigla} Sc</Th>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Sera`}>{sigla} Ser</Th>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Vendute`}>{sigla} Qty</Th>
                      <Th bg={BEV_BG} title={`${BEV_NAMES[sigla] || sigla} — Incasso €`}>{sigla} €</Th>
                    </React.Fragment>
                  ))}
                  {/* Tot bev */}
                  <Th bg="#fef9c3">Qty</Th>
                  <Th bg="#fef9c3">€</Th>
                  {/* Cash sera */}
                  <Th bg="#facc15">€</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, idx) => {
                  const rowBg = r.is_mock ? '#fffbeb' : (idx % 2 === 0 ? '#fff' : '#f9fafb');
                  return (
                    <tr
                      key={r.date}
                      data-testid={`closure-row-${r.date}`}
                      style={{ background: rowBg }}
                    >
                      <Td sticky left={0} bg={rowBg} bold align="center"
                          title={r.is_mock ? 'Riga MOCK (dati di test)' : ''}>
                        {fmtDateIT(r.date)}{r.is_mock && <span title="Mock" style={{color:'#92400e', marginLeft:4}}>✱</span>}
                      </Td>
                      <Td sticky left={DATE_W} bg={rowBg} align="center" color="#6b7280">{dayName(r.date)}</Td>
                      {cashFields.map(f => (
                        <Td key={f} bg={rowBg} mono>{fmtEur(r.cash?.[f] || 0)}</Td>
                      ))}
                      <Td bg={rowBg} mono align="center" bold>{r.paste_count || ''}</Td>
                      <Td bg={rowBg} mono>{fmtEur(r.paste_total_eur)}</Td>
                      {bevSigle.map(sigla => {
                        const b = r.beverages?.[sigla] || {};
                        return (
                          <React.Fragment key={sigla}>
                            <Td bg={rowBg} mono>{fmtInt(b.mattina)}</Td>
                            <Td bg={rowBg} mono>{fmtInt(b.inUsc)}</Td>
                            <Td bg={rowBg} mono>{fmtInt(b.scarti)}</Td>
                            <Td bg={rowBg} mono>{fmtInt(b.sera)}</Td>
                            <Td bg={rowBg} mono bold color={b.qty > 0 ? '#15803d' : '#9ca3af'}>{fmtInt(b.qty)}</Td>
                            <Td bg={rowBg} mono>{fmtEur(b.incasso)}</Td>
                          </React.Fragment>
                        );
                      })}
                      <Td bg={rowBg} mono bold>{r.bev_total_qty || ''}</Td>
                      <Td bg={rowBg} mono>{fmtEur(r.bev_total_inc)}</Td>
                      <Td bg={rowBg} mono bold color="#854d0e">{fmtEur(r.cash_sera)}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#1f2937', color: '#fff', position: 'sticky', bottom: 0 }}>
                  <Td sticky left={0} bg="#1f2937" color="#fff" bold align="center">TOTALE</Td>
                  <Td sticky left={DATE_W} bg="#1f2937" color="#fff" align="center">{items.length}gg</Td>
                  {cashFields.map(f => (
                    <Td key={f} bg="#1f2937" color="#fde68a" mono bold>{fmtEur(totals.cash[f])}</Td>
                  ))}
                  <Td bg="#1f2937" color="#fff" mono bold align="center">{totals.paste_count}</Td>
                  <Td bg="#1f2937" color="#fde68a" mono bold>{fmtEur(totals.paste_total_eur)}</Td>
                  {bevSigle.map(sigla => {
                    const t = totals.bev[sigla];
                    return (
                      <React.Fragment key={sigla}>
                        <Td bg="#1f2937" color="#fff" mono>{fmtInt(t.mattina)}</Td>
                        <Td bg="#1f2937" color="#fff" mono>{fmtInt(t.inUsc)}</Td>
                        <Td bg="#1f2937" color="#fff" mono>{fmtInt(t.scarti)}</Td>
                        <Td bg="#1f2937" color="#fff" mono>{fmtInt(t.sera)}</Td>
                        <Td bg="#1f2937" color="#a7f3d0" mono bold>{fmtInt(t.qty)}</Td>
                        <Td bg="#1f2937" color="#fde68a" mono bold>{fmtEur(t.incasso)}</Td>
                      </React.Fragment>
                    );
                  })}
                  <Td bg="#1f2937" color="#a7f3d0" mono bold>{totals.bev_total_qty}</Td>
                  <Td bg="#1f2937" color="#fde68a" mono bold>{fmtEur(totals.bev_total_inc)}</Td>
                  <Td bg="#1f2937" color="#facc15" mono bold>{fmtEur(totals.cash_sera)}</Td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Legenda */}
        <div className="mt-3 text-[11px] text-gray-500 flex flex-wrap gap-3">
          <span>✱ riga mock (dati di test)</span>
          <span>Colonne fisse: data + giorno della settimana</span>
          <span>Scroll orizzontale per scorrere tutte le colonne</span>
        </div>
      </main>
    </div>
  );
};

export default ChiusureExcelPage;
