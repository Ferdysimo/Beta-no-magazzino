import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { ArrowLeft, RefreshCw, X } from 'lucide-react';

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
  { key: 'scarti', label: 'SCARTI',            headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
  { key: 'inUsc',  label: 'INGRESSI / USCITE', headerBg: BEV_COLOR_HEADER, cellBg: BEV_COLOR_CELL },
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
const TOTAL_CASH_FIELDS = new Set(['arr', 'altro']);
const TOTAL_BEV_GROUPS = new Set(['scarti']);
// Rotolini aperti visibili per taglio.
const SPICCI_FIELDS = [
  { key: 'sp5', label: '5 €' },
  { key: 'sp2', label: '2 €' },
  { key: 'sp1', label: '1 €' },
  { key: 'sp05', label: '0,50 €' },
];
const SPICCI_OPEN_SOURCES = [
  { key: 'sp5', label: '5€' },
  { key: 'sp2', label: '2€' },
  { key: 'sp1', label: '1€' },
  { key: 'sp05', label: '0,50€' },
];

const fmtEur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => {
  const v = Number(n) || 0;
  return v === 0 ? '' : String(Math.round(v));
};
const fmtSpicciCount = (value) => {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toLocaleString('it-IT', { maximumFractionDigits: 2 });
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

export const arrCellBackground = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= -5 && numeric <= 5
    ? '#dcfce7'
    : '#fee2e2';
};

export const reportExpressionText = (value) => {
  const raw = String(value ?? '');
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[^0-9+\-*/.(),=\s€]/g, '')
    .trim();
};

// ─── Cell helpers ──────────────────────────────────────────────────────────
const isRedVersColor = (color) => {
  const normalized = String(color || '').toLowerCase().replace(/\s+/g, '');
  return normalized === '#dc2626'
    || normalized === 'rgb(220,38,38)'
    || normalized === 'red';
};

export const parseVersDisplay = (rawValue, legacyColor = '') => {
  const raw = String(rawValue || '');
  const legacyIsRed = String(legacyColor || '').toLowerCase() === 'red';
  if (!raw) return { segments: [], mixed: false };

  const segments = [];
  const append = (text, red) => {
    const safeText = String(text || '').replace(/[^0-9+\-*/.(),=\s€]/g, '');
    if (!safeText) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.red === red) previous.text += safeText;
    else segments.push({ text: safeText, red });
  };

  if (typeof document === 'undefined') {
    append(raw.replace(/<[^>]*>/g, ''), legacyIsRed);
  } else {
    const container = document.createElement('div');
    container.innerHTML = raw;
    const walk = (node, inheritedRed) => {
      if (node.nodeType === 3) {
        append(node.textContent, inheritedRed);
        return;
      }
      if (node.nodeType !== 1) return;
      let currentRed = inheritedRed;
      if (node.tagName === 'SPAN' && node.style?.color) {
        currentRed = isRedVersColor(node.style.color);
      }
      Array.from(node.childNodes).forEach(child => walk(child, currentRed));
    };
    Array.from(container.childNodes).forEach(child => walk(child, legacyIsRed));
  }

  const hasRedNumbers = segments.some(segment => segment.red && /\d/.test(segment.text));
  const hasBlackNumbers = segments.some(segment => !segment.red && /\d/.test(segment.text));
  return {
    segments,
    mixed: hasRedNumbers && hasBlackNumbers,
  };
};

const Th = ({ children, bg, color, sticky, top, left, width, title, colSpan, borderTop, isGroupEnd, emphasis }) => (
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
      fontWeight: emphasis ? 900 : 700,
      fontSize: 11,
      textAlign: 'center',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}
  >
    {children}
  </th>
);

const Td = ({
  children,
  bg,
  sticky,
  left,
  mono,
  align = 'right',
  bold,
  color,
  title,
  isGroupEnd,
  testId,
  interactive,
  onClick,
  onDoubleClick,
  onKeyDown,
}) => (
  <td
    data-testid={testId}
    title={title || ''}
    role={interactive ? 'button' : undefined}
    tabIndex={interactive ? 0 : undefined}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    onKeyDown={onKeyDown}
    style={{
      background: bg || '#fff',
      color: color || '#111827',
      position: sticky ? 'sticky' : (interactive ? 'relative' : undefined),
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
      cursor: interactive ? 'zoom-in' : undefined,
      outlineOffset: interactive ? -2 : undefined,
    }}
  >
    {children}
  </td>
);

const ChiusureExcelPage = () => {
  const navigate = useNavigate();
  const {
    token,
    canImpersonate,
    restaurant,
    effectiveRestaurant,
    selectRestaurant,
  } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [days, setDays] = useState(() => Number(localStorage.getItem('closures_excel_days')) || 30);
  const [items, setItems] = useState([]);
  const [bevSigle, setBevSigle] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [cellDetail, setCellDetail] = useState(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  // Una sola selezione per scheda: Storico chiusure segue lo stesso locale
  // impersonato dalla Home e dalle altre pagine Admin/Federico.
  const ownRid = effectiveRestaurant?.id || restaurant?.id || '';
  const effectiveRestId = canImpersonate
    ? (effectiveRestaurant?.id || restaurants[0]?.id || '')
    : ownRid;

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
    localStorage.setItem('closures_excel_days', String(days));
  }, [days]);

  useEffect(() => {
    if (!cellDetail) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setCellDetail(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cellDetail]);

  const onRestaurantChange = (restaurantId) => {
    const selected = restaurants.find(r => r.id === restaurantId);
    if (selected) selectRestaurant(selected);
  };

  const onRowClick = (date) => {
    if (!effectiveRestId || !date) return;
    navigate(`/report-beta?date=${date}&rid=${effectiveRestId}`);
  };

  const detailCellProps = (detail) => ({
    interactive: true,
    onClick: (event) => event.stopPropagation(),
    onDoubleClick: (event) => {
      event.stopPropagation();
      setCellDetail(detail);
    },
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      setCellDetail(detail);
    },
  });

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
      // Rotolini aperti, conteggiati separatamente per taglio.
      SPICCI_OPEN_SOURCES.forEach(({ key }) => {
        const count = Number(r.cash?.[key]) || 0;
        t.spicci[key] += count;
      });
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
                onChange={(e) => onRestaurantChange(e.target.value)}
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
                      title="Rotolini aperti durante la giornata, separati per taglio">
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
                    <Th
                      key={f.key}
                      sticky
                      top={28}
                      bg="#bfdbfe"
                      color="#111827"
                      width={EUR_W}
                      title={f.hint}
                      emphasis={f.key === 'arr' || f.key === 'pos'}
                    >
                      {f.label}
                    </Th>
                  ))}
                  {SPICCI_FIELDS.map(f => (
                    <Th
                      key={f.key}
                      sticky
                      top={28}
                      bg="#fde68a"
                      color="#111827"
                      width={SPICCI_W}
                    >
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

                      {CASH_EUR_FIELDS.map(f => {
                        const versDisplay = f.key === 'vers'
                          ? parseVersDisplay(r.vers_raw, r.vers_color)
                          : null;
                        const versHasContent = versDisplay?.segments.length > 0;
                        const rawValue = r.cash_raw?.[f.key]
                          ?? (f.key === 'vers' ? r.vers_raw : '');
                        const comment = String(r.cash_comments?.[f.key] || '').trim();
                        const cellBg = f.key === 'arr'
                          ? arrCellBackground(r.cash?.arr)
                          : (versDisplay?.mixed ? '#fef08a' : baseBg);
                        const detail = {
                          date: r.date,
                          label: f.label,
                          title: f.hint,
                          result: `€${fmtEur(r.cash?.[f.key] || 0)}`,
                          expression: reportExpressionText(rawValue),
                          comment,
                        };
                        return (
                          <Td
                            key={f.key}
                            bg={cellBg}
                            mono
                            bold={f.key === 'arr' || f.key === 'pos'}
                            testId={`closure-${r.date}-cash-${f.key}`}
                            title="Doppio clic per vedere operazione e commento"
                            {...detailCellProps(detail)}
                          >
                            {f.key === 'vers' && versHasContent
                              ? versDisplay.segments.map((segment, segmentIndex) => (
                                <span
                                  key={`${segmentIndex}-${segment.text}`}
                                  style={{
                                    color: segment.red ? '#dc2626' : '#111827',
                                    fontWeight: 700,
                                  }}
                                >
                                  {segment.text}
                                </span>
                              ))
                              : fmtEur(r.cash?.[f.key] || 0)}
                            {comment && (
                              <span
                                aria-hidden="true"
                                title={comment}
                                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500"
                              />
                            )}
                          </Td>
                        );
                      })}

                      {SPICCI_FIELDS.map(f => {
                        const comment = String(r.cash_comments?.[f.key] || '').trim();
                        const val = fmtSpicciCount(r.cash?.[f.key]);
                        const detail = {
                          date: r.date,
                          label: f.label,
                          title: 'Rotolini aperti',
                          result: val || '0',
                          expression: reportExpressionText(r.cash_raw?.[f.key]),
                          comment,
                        };
                        return (
                          <Td
                            key={f.key}
                            bg={baseBg}
                            mono
                            align="center"
                            testId={`closure-${r.date}-spicci-${f.key}`}
                            title={detail ? 'Doppio clic per vedere operazioni e commenti' : undefined}
                            {...(detail ? detailCellProps(detail) : {})}
                          >
                            {val}
                            {detail?.comment && (
                              <span
                                aria-hidden="true"
                                title={detail.comment}
                                className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500"
                              />
                            )}
                          </Td>
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
                          const canInspect = !isVendita;
                          const comment = canInspect
                            ? String(b.comments?.[g.key] || '').trim()
                            : '';
                          const detail = canInspect ? {
                            date: r.date,
                            label: `${sigla} · ${g.label}`,
                            title: BEV_NAMES[sigla] || sigla,
                            result: fmtInt(v) || '0',
                            expression: reportExpressionText(b.raw?.[g.key]),
                            comment,
                          } : null;
                          return (
                            <Td key={`${g.key}-${sigla}`} bg={cellBg} mono align="center"
                                bold={isVendita}
                                testId={`closure-${r.date}-bev-${g.key}-${sigla}`}
                                isGroupEnd={si === bevSigle.length - 1}
                                color={isVendita ? (Number(v) > 0 ? '#15803d' : '#cbd5e1') : '#374151'}
                                title={detail ? 'Doppio clic per vedere operazione e commento' : undefined}
                                {...(detail ? detailCellProps(detail) : {})}>
                              {fmtInt(v)}
                              {comment && (
                                <span
                                  aria-hidden="true"
                                  title={comment}
                                  className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500"
                                />
                              )}
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
                  <Td testId="closure-total-label" sticky left={0} bg="#0f172a" color="#fff" bold align="center">TOTALE</Td>
                  <Td testId="closure-total-days" sticky left={DATE_W} bg="#0f172a" color="#cbd5e1" align="center" />

                  {CASH_EUR_FIELDS.map(f => (
                    <Td key={f.key} testId={`closure-total-cash-${f.key}`} bg="#0f172a" color="#fff" mono bold>
                      {TOTAL_CASH_FIELDS.has(f.key) ? fmtEur(totals.cash[f.key]) : ''}
                    </Td>
                  ))}

                  {SPICCI_FIELDS.map(f => (
                    <Td key={f.key} testId={`closure-total-spicci-${f.key}`} bg="#0f172a" color="#fff" mono bold align="center" />
                  ))}

                  <Td testId="closure-total-paste" bg="#0f172a" color="#a7f3d0" mono bold align="center" />

                  <Td testId="closure-total-cash-sera" bg="#0f172a" color="#facc15" mono bold />

                  {BEV_GROUPS.map(g => (
                    bevSigle.map((sigla, si) => (
                      <Td key={`${g.key}-${sigla}`} testId={`closure-total-bev-${g.key}-${sigla}`} bg="#0f172a"
                          color={g.key === 'qty' ? '#fde68a' : '#fff'} mono align="center"
                          bold={g.key === 'qty'}
                          isGroupEnd={si === bevSigle.length - 1}>
                        {TOTAL_BEV_GROUPS.has(g.key) ? fmtInt(totals.bev[g.key][sigla]) : ''}
                      </Td>
                    ))
                  ))}
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {cellDetail && (
          <div
            className="fixed inset-0 z-[100] bg-black/45 flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setCellDetail(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="closure-cell-detail-title"
              data-testid="closure-cell-detail-dialog"
              className="w-full max-w-lg bg-white border border-gray-300 shadow-2xl rounded-lg overflow-hidden"
            >
              <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-200 bg-gray-50">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-500 uppercase">{fmtDateIT(cellDetail.date)}</p>
                  <h2 id="closure-cell-detail-title" className="text-lg font-bold text-gray-900">
                    {cellDetail.label}
                  </h2>
                  <p className="text-sm text-gray-600">{cellDetail.title}</p>
                </div>
                <button
                  type="button"
                  aria-label="Chiudi dettaglio"
                  data-testid="closure-cell-detail-close"
                  onClick={() => setCellDetail(null)}
                  className="w-9 h-9 flex items-center justify-center border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 rounded"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-4 pb-4 border-b border-gray-200">
                  <span className="text-sm font-semibold text-gray-600">Risultato</span>
                  <strong className="font-mono text-xl text-gray-900">{cellDetail.result}</strong>
                </div>

                <div className="py-4 border-b border-gray-200">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-2">Operazione inserita nel Report</p>
                  <div
                    data-testid="closure-cell-detail-expression"
                    className="font-mono text-base font-semibold text-gray-900 whitespace-pre-wrap break-words"
                  >
                    {cellDetail.expression || 'Nessuna operazione salvata'}
                  </div>
                </div>

                <div className="pt-4">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-2">Commento</p>
                  <div
                    data-testid="closure-cell-detail-comment"
                    className={`text-sm whitespace-pre-wrap break-words ${cellDetail.comment ? 'text-gray-900' : 'text-gray-400 italic'}`}
                  >
                    {cellDetail.comment || 'Nessun commento inserito'}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default ChiusureExcelPage;
