import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, RefreshCw } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Etichette descrittive bevande (per tooltip)
const BEV_NAMES = {
  AL: 'Acqua nat.', AG: 'Acqua friz.', C: 'Coca', CZ: 'Coca Zero',
  F: 'Fanta', S: 'Sprite', B: 'Peroni', VB: 'Vino B.', VR: 'Vino R.',
};

// Gruppi macro per le bevande — TUTTI stesso colore (verde tenue), come da richiesta
const BEV_COLOR_HEADER = '#d1fae5';
const BEV_COLOR_CELL   = '#f0fdf4';
const BEV_GROUPS = [
  { key: 'inUsc',  label: 'INGRESSI / USCITE', headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
  { key: 'scarti', label: 'SCARTI',            headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
  { key: 'sera',   label: 'MAGAZZINO SERA',    headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
  { key: 'qty',    label: 'VENDITE',           headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
];

// Cassa: campi €
const CASH_EUR_FIELDS = [
  { key: 'arr',     label: 'Arr.',  hint: 'Arrotondamento' },
  { key: 'altro',   label: 'Altro', hint: 'Altre entrate' },
  { key: 'vers',    label: 'Vers.', hint: 'Versamento' },
  { key: 'glo',     label: 'Glo',   hint: 'Glovo' },
  { key: 'just',    label: 'Just',  hint: 'JustEat' },
  { key: 'delv',    label: 'Del',   hint: 'Deliveroo' },
  { key: 'bp',      label: 'BP',    hint: 'Banca Popolare' },
  { key: 'sat',     label: 'SAT',   hint: 'Satispay' },
  { key: 'pos',     label: 'POS',   hint: 'Cassa POS' },
  { key: 'ft',      label: 'FT',    hint: 'Fatture' },
];
// Spicci: 2 colonne compatte
// - "Iniziali": numero di mazzette presenti in cassa all'inizio della giornata (NON ancora tracciato dal backend → mostriamo '—')
// - "Aperti":   somma totale delle mazzette aperte durante la giornata (sp5+sp2+sp1+sp05)
const SPICCI_FIELDS = [
  { key: 'sp_init',  label: 'Iniziali' },
  { key: 'sp_open',  label: 'Aperti'   },
];

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

// ─── Cell helpers ──────────────────────────────────────────────────────────
const Th = ({ children, bg, color, sticky, top, left, width, title, colSpan, borderTop, isGroupEnd }) => (
  <th
    title={title || ''}
    colSpan={colSpan}
    style={{
      background: bg || '#1f2937',
      color: color || '#fff',
      position: sticky ? 'sticky' : undefined,
      top: top !== undefined ? top : undefined,
      left: left !== undefined ? left : undefined,
      zIndex: sticky ? (left !== undefined ? 40 : 30) : undefined,
      width: width || undefined,
      minWidth: width || undefined,
      borderRight: isGroupEnd ? '3px solid #334155' : '1px solid #94a3b8',
      borderBottom: '1px solid #94a3b8',
      borderTop: borderTop || undefined,
      padding: '4px 6px',
      fontWeight: 700,
      fontSize: 11,
      textAlign: 'center',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}
  >
    {children}
  </th>
);

const Td = ({ children, bg, sticky, left, mono, align = 'right', bold, color, title, isGroupEnd }) => (
  <td
    title={title || ''}
    style={{
      background: bg || '#fff',
      color: color || '#111827',
      position: sticky ? 'sticky' : undefined,
      left: left !== undefined ? left : undefined,
      zIndex: sticky ? 10 : undefined,
      borderRight: isGroupEnd ? '3px solid #334155' : '1px solid #e5e7eb',
      borderBottom: '1px solid #e5e7eb',
      padding: '3px 6px',
      fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      fontVariantNumeric: 'tabular-nums',
      fontSize: 12,
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
  const { token, canImpersonate, restaurant, effectiveRestaurant } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestId, setSelectedRestId] = useState(() => localStorage.getItem('closures_excel_rest_id') || '');
  const [days, setDays] = useState(() => Number(localStorage.getItem('closures_excel_days')) || 30);
  const [items, setItems] = useState([]);
  const [bevSigle, setBevSigle] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // Utenti non-admin: forzo il rid sul proprio locale, ignoro selector e localStorage
  const ownRid = effectiveRestaurant?.id || restaurant?.id || '';
  const effectiveRestId = canImpersonate ? (selectedRestId || restaurants[0]?.id || '') : ownRid;

  useEffect(() => {
    if (!canImpersonate || !token) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/admin/restaurants`, { headers });
        const list = (res.data || []).filter(r => r.role !== 'admin');
        setRestaurants(list);
      } catch (e) { console.error('list restaurants', e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImpersonate, token]);

  const loadGrid = useCallback(async () => {
    if (!token || !effectiveRestId) {
      setItems([]); setBevSigle([]); return;
    }
    setLoading(true);
    try {
      const res = await axios.get(
        `${API}/admin/closures/grid?days=${days}&restaurant_id=${effectiveRestId}`,
        { headers }
      );
      setItems(res.data?.items || []);
      setBevSigle(res.data?.bev_sigle || []);
    } catch (e) {
      console.error('load grid', e);
      setMsg('Errore caricamento griglia');
    } finally {
      setLoading(false);
    }
  }, [token, effectiveRestId, days, headers]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  useEffect(() => {
    if (selectedRestId) localStorage.setItem('closures_excel_rest_id', selectedRestId);
  }, [selectedRestId]);
  useEffect(() => {
    localStorage.setItem('closures_excel_days', String(days));
  }, [days]);

  const onRowClick = (date) => {
    if (!effectiveRestId || !date) return;
    navigate(`/report-beta?date=${date}&rid=${effectiveRestId}`);
  };

  // Totali colonna
  const totals = useMemo(() => {
    const t = {
      bev: {}, // bev[group][sigla]
      paste_count: 0, cash: {}, spicci: {}, cash_sera: 0,
    };
    BEV_GROUPS.forEach(g => {
      t.bev[g.key] = {};
      bevSigle.forEach(s => { t.bev[g.key][s] = 0; });
    });
    CASH_EUR_FIELDS.forEach(f => { t.cash[f.key] = 0; });
    SPICCI_FIELDS.forEach(f => { t.spicci[f.key] = 0; });

    items.forEach(r => {
      bevSigle.forEach(sigla => {
        const b = r.beverages?.[sigla] || {};
        BEV_GROUPS.forEach(g => {
          t.bev[g.key][sigla] += Number(b[g.key] || 0);
        });
      });
      t.paste_count += Number(r.paste_count || 0);
      CASH_EUR_FIELDS.forEach(f => { t.cash[f.key] += Number(r.cash?.[f.key] || 0); });
      // SPICCI: 2 colonne aggregate
      // sp_init: 0 (placeholder finché non tracciato dal backend)
      // sp_open: somma di sp5+sp2+sp1+sp05 del giorno
      t.spicci.sp_open += (Number(r.cash?.sp5) || 0) + (Number(r.cash?.sp2) || 0) + (Number(r.cash?.sp1) || 0) + (Number(r.cash?.sp05) || 0);
      t.cash_sera += Number(r.cash_sera || 0);
    });
    return t;
  }, [items, bevSigle]);

  // Posizioni sticky a sinistra
  const DATE_W = 82;
  const DAY_W = 42;
  const BEV_W = 30;       // bevande: piccola, numero
  const PASTE_W = 50;
  const EUR_W = 64;       // colonne €
  const SPICCI_W = 46;
  const SERA_W = 76;

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
          <span className="text-[11px] text-gray-500">Vista Excel — una riga per giorno (clicca per aprire il dettaglio)</span>
        </div>

        <h1 className="font-heading text-xl sm:text-2xl font-bold text-gray-900 uppercase mb-3">
          Storico chiusure
        </h1>

        {/* Toolbar */}
        <div className="mb-3 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          {canImpersonate ? (
            <>
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
            </>
          ) : (
            <div className="text-sm font-bold text-gray-700">
              Locale: <span className="text-gray-900">{effectiveRestaurant?.location || restaurant?.location || '—'}</span>
              <span className="ml-2 text-[11px] font-normal text-gray-500">(sola lettura)</span>
            </div>
          )}

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

          <div className="w-full text-[11px] text-gray-500 mt-1" />
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
                {/* Riga 1: gruppi macro */}
                <tr>
                  <Th sticky top={0} left={0} width={DATE_W} bg="#0f172a">Data</Th>
                  <Th sticky top={0} left={DATE_W} width={DAY_W} bg="#0f172a">Giorno</Th>
                  <Th sticky top={0} colSpan={CASH_EUR_FIELDS.length} bg="#bfdbfe" color="#111827">
                    MOVIMENTAZIONE FINANZIARIA
                  </Th>
                  <Th sticky top={0} colSpan={SPICCI_FIELDS.length} bg="#fde68a" color="#111827"
                      title="Spicci: iniziali (a inizio giornata) + aperti (durante la giornata)">
                    SPICCI
                  </Th>
                  <Th sticky top={0} bg="#facc15" color="#111827" title="Numero totale di paste mandate quel giorno">
                    TOT PIATTI
                  </Th>
                  <Th sticky top={0} bg="#facc15" color="#111827" title="Cash in cassa sera (cassa + paste + bevande)">
                    CASH SERA
                  </Th>
                  {BEV_GROUPS.map(g => (
                    <Th key={g.key} sticky top={0} colSpan={bevSigle.length}
                        bg={g.headerBg} color="#111827" title={`${g.label} per sigla bevanda`}
                        isGroupEnd>
                      {g.label}
                    </Th>
                  ))}
                </tr>

                {/* Riga 2: header colonna */}
                <tr>
                  <Th sticky top={28} left={0} width={DATE_W} bg="#334155">YYYY-MM-DD</Th>
                  <Th sticky top={28} left={DATE_W} width={DAY_W} bg="#334155">d.s.</Th>
                  {CASH_EUR_FIELDS.map(f => (
                    <Th key={f.key} sticky top={28} bg="#bfdbfe" color="#111827" width={EUR_W} title={f.hint}>
                      {f.label}
                    </Th>
                  ))}
                  {SPICCI_FIELDS.map(f => (
                    <Th key={f.key} sticky top={28} bg="#fde68a" color="#111827" width={SPICCI_W}>
                      {f.label}
                    </Th>
                  ))}
                  <Th sticky top={28} bg="#facc15" color="#111827" width={PASTE_W}>N°</Th>
                  <Th sticky top={28} bg="#facc15" color="#111827" width={SERA_W}>€</Th>
                  {BEV_GROUPS.map(g => (
                    bevSigle.map((sigla, si) => (
                      <Th key={`${g.key}-${sigla}`} sticky top={28} bg={g.headerBg} color="#111827"
                          width={BEV_W} title={`${BEV_NAMES[sigla] || sigla} — ${g.label}`}
                          isGroupEnd={si === bevSigle.length - 1}>
                        {sigla}
                      </Th>
                    ))
                  ))}
                </tr>
              </thead>

              <tbody>
                {items.map((r, idx) => {
                  const baseBg = r.is_mock ? '#fffbeb' : (idx % 2 === 0 ? '#ffffff' : '#f9fafb');
                  return (
                    <tr
                      key={r.date}
                      data-testid={`closure-row-${r.date}`}
                      onClick={() => onRowClick(r.date)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.outline = '2px solid #F5C518'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.outline = 'none'; }}
                      title={`Clicca per aprire il dettaglio del ${fmtDateIT(r.date)}`}
                    >
                      <Td sticky left={0} bg={baseBg} bold align="center"
                          title={r.is_mock ? 'Riga MOCK (dati di test)' : ''}>
                        {fmtDateIT(r.date)}
                        {r.is_mock && <span style={{ color: '#92400e', marginLeft: 4 }} title="Mock">✱</span>}
                      </Td>
                      <Td sticky left={DATE_W} bg={baseBg} align="center" color="#6b7280">
                        {dayName(r.date)}
                      </Td>

                      {CASH_EUR_FIELDS.map(f => (
                        <Td key={f.key} bg={baseBg} mono>
                          {fmtEur(r.cash?.[f.key] || 0)}
                        </Td>
                      ))}

                      {SPICCI_FIELDS.map(f => {
                        // sp_init: iniziali — non ancora tracciato dal backend, placeholder
                        // sp_open: aperti durante la giornata = sp5+sp2+sp1+sp05 (somma mazzette)
                        let val;
                        if (f.key === 'sp_init') {
                          val = '—';
                        } else {
                          const open = (Number(r.cash?.sp5) || 0) + (Number(r.cash?.sp2) || 0) + (Number(r.cash?.sp1) || 0) + (Number(r.cash?.sp05) || 0);
                          val = open === 0 ? '' : String(open);
                        }
                        return (
                          <Td key={f.key} bg={baseBg} mono align="center">{val}</Td>
                        );
                      })}

                      <Td bg={baseBg} mono align="center" bold>
                        {r.paste_count > 0 ? r.paste_count : ''}
                      </Td>

                      <Td bg={baseBg} mono bold color="#854d0e">
                        {fmtEur(r.cash_sera)}
                      </Td>

                      {BEV_GROUPS.map(g => (
                        bevSigle.map((sigla, si) => {
                          const b = r.beverages?.[sigla] || {};
                          const v = b[g.key];
                          const cellBg = r.is_mock ? baseBg : g.cellBg;
                          const isVendita = g.key === 'qty';
                          return (
                            <Td key={`${g.key}-${sigla}`} bg={cellBg} mono align="center"
                                bold={isVendita}
                                isGroupEnd={si === bevSigle.length - 1}
                                color={isVendita ? (Number(v) > 0 ? '#15803d' : '#cbd5e1') : '#374151'}>
                              {fmtInt(v)}
                            </Td>
                          );
                        })
                      ))}
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr style={{ background: '#0f172a', color: '#fff' }}>
                  <Td sticky left={0} bg="#0f172a" color="#fff" bold align="center">TOTALE</Td>
                  <Td sticky left={DATE_W} bg="#0f172a" color="#cbd5e1" align="center">{items.length}gg</Td>

                  {CASH_EUR_FIELDS.map(f => (
                    <Td key={f.key} bg="#0f172a" color="#fff" mono bold>{fmtEur(totals.cash[f.key])}</Td>
                  ))}

                  {SPICCI_FIELDS.map(f => (
                    <Td key={f.key} bg="#0f172a" color="#fff" mono bold align="center">
                      {f.key === 'sp_init' ? '—' : (totals.spicci.sp_open || '')}
                    </Td>
                  ))}

                  <Td bg="#0f172a" color="#a7f3d0" mono bold align="center">{totals.paste_count}</Td>

                  <Td bg="#0f172a" color="#facc15" mono bold>{fmtEur(totals.cash_sera)}</Td>

                  {BEV_GROUPS.map(g => (
                    bevSigle.map((sigla, si) => (
                      <Td key={`${g.key}-${sigla}`} bg="#0f172a"
                          color={g.key === 'qty' ? '#fde68a' : '#fff'} mono align="center"
                          bold={g.key === 'qty'}
                          isGroupEnd={si === bevSigle.length - 1}>
                        {fmtInt(totals.bev[g.key][sigla])}
                      </Td>
                    ))
                  ))}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </main>
    </div>
  );
};

export default ChiusureExcelPage;
