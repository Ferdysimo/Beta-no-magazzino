import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import PasswordGate from '../components/PasswordGate';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Listino paste (prezzi modificabili in un solo punto)
const DEFAULT_PASTA_PRICES = [
  { sigla: 'CARB',    price: 8 },
  { sigla: 'AMAT',    price: 8 },
  { sigla: 'CACIO',   price: 8 },
  { sigla: 'PESTO',   price: 8 },
  { sigla: 'TART',    price: 8 },
  { sigla: 'RAGU',    price: 8 },
  { sigla: 'POM',     price: 7 },
  { sigla: 'CARZUC',  price: 8 },
];

// Banconote / monete
const CASH_DENOMINATIONS = [
  { key: 'big100', label: '100',       mode: 'count',   value: 100        },
  { key: 'big',    label: '50',        mode: 'count',   value: 50         },
  { key: 'd20',    label: '20',        mode: 'count',   value: 20         },
  { key: 'd10',    label: '10',        mode: 'count',   value: 10         },
  { key: 'd5',     label: '5',         mode: 'count',   value: 5          },
  { key: 'c2',     label: '2',         mode: 'count',   value: 2          },
  { key: 'c1',     label: '1',         mode: 'count',   value: 1          },
  { key: 'c50',    label: '0,50',      mode: 'count',   value: 0.5        },
  { key: 'c20',    label: '0,20',      mode: 'count',   value: 0.2        },
  { key: 'c10',    label: '0,10',      mode: 'count',   value: 0.1        },
];

// Riconoscimento sigla pasta — REGOLA: tra il numero d'ordine e la sigla
// possono esserci SOLO spazi/whitespace. Qualunque altro carattere (lettere,
// trattini, punteggiatura) tra numero e sigla → NON riconosciuta.
// Esempi:
//   "42 CARB - PIET"   → ✓ riconosciuta (subito CARB dopo 42)
//   "42 CARB asporto"  → ✓ riconosciuta
//   "42 PIETRO CARB"   → ✗ NON riconosciuta (PIETRO tra 42 e CARB)
//   "42 - CARB"        → ✗ NON riconosciuta ('-' tra 42 e CARB)
//   "CARB tavolo 5"    → ✓ riconosciuta (nessun numero, sigla a inizio)
// XL: se presente come parola intera nella riga → NON riconosciuta (manuale)
const findPasta = (line, dict) => {
  if (!line) return null;
  const upper = String(line).toUpperCase();
  if (/\bXL\b/.test(upper)) return null;
  const list = (dict && dict.length) ? dict : DEFAULT_PASTA_PRICES;
  const ordered = [...list].sort((a, b) => b.sigla.length - a.sigla.length);
  for (const p of ordered) {
    // ^\s*(?:\d+\s+)?SIGLA(?:\b|$)
    const escaped = p.sigla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*(?:\\d+\\s+)?${escaped}(?:\\b|$)`, 'i');
    if (re.test(upper)) return p;
  }
  return null;
};

// Valuta un'espressione aritmetica.
// Il "=" iniziale è opzionale: anche scrivendo "10+5" il calcolo viene eseguito.
// Per il campo VERS rich-text, lo storage può contenere HTML (span colorati):
// in quel caso strippiamo tutti i tag prima di valutare.
const evaluateValue = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  let s = String(v);
  // Strip HTML tags (per il VERS rich-text)
  if (s.includes('<')) s = s.replace(/<[^>]*>/g, '');
  // Sostituisco TUTTE le virgole con punti (non solo la prima): scrivere
  // "10,50+3,20" deve funzionare allo stesso modo di "10.50+3.20".
  s = s.trim().replace(/,/g, '.');
  if (s.startsWith('=')) s = s.slice(1).trim();
  if (s === '') return 0;
  // Whitelist: solo cifre, operatori, parentesi, punto e spazio
  if (!/^[\d+\-*/.() \s]*$/.test(s)) return 0;
  try {
    // eslint-disable-next-line no-new-func
    const v2 = Function(`"use strict"; return (${s})`)();
    return Number.isFinite(v2) ? v2 : 0;
  } catch { return 0; }
};

// Considera "formula" qualsiasi stringa che contenga un operatore aritmetico
// (esclude il semplice numero negativo "-5"). Il "=" iniziale è opzionale.
const isFormulaExpr = (v) => {
  if (v === '' || v === null || v === undefined) return false;
  let s = String(v);
  if (s.includes('<')) s = s.replace(/<[^>]*>/g, '');
  s = s.trim();
  if (s.startsWith('=')) return true;
  // operatori binari: +, *, /, ( ) oppure un "-" che non sia il segno iniziale
  if (/[+*/()]/.test(s)) return true;
  // "-" presente in posizione interna (es. "10-5") → formula; "-5" → numero
  if (/[\d.]-/.test(s)) return true;
  return false;
};

// Definizione del riepilogo cassa Flaminio (Report)
// NB: VERS è in fondo perché nel render viene SPOSTATO fuori dal map ed
// emesso dopo CASH SERA come ultimo box bianco a destra.
const CASH_FIELDS = [
  { key: 'mattina', label: 'CASH MATTINA', op: 'base', readonly: true  },
  { key: 'altro',   label: 'ALTRO',        op: 'plus',  readonly: false },
  { key: 'glo',     label: 'GLO',          op: 'minus', readonly: false },
  { key: 'just',    label: 'JUST',         op: 'minus', readonly: false },
  { key: 'delv',    label: 'DEL',          op: 'minus', readonly: false },
  { key: 'bp',      label: 'BP',           op: 'minus', readonly: false },
  { key: 'sat',     label: 'SAT',          op: 'minus', readonly: false },
  { key: 'pos',     label: 'POS',          op: 'minus', readonly: false },
  { key: 'ft',      label: 'FT',           op: 'minus', readonly: false },
  { key: 'arr',     label: 'ARR',          op: 'plus',  readonly: false },
  { key: 'vers',    label: 'VERS',         op: 'minus', readonly: false },
];

// Colore di SFONDO per ogni quadratino del Riepilogo Cassa (label resta nera).
// BP/SAT/POS condividono lo stesso blu chiaro per essere riconosciuti come "trio".
export const CASH_BOX_STYLE = {
  mattina: { bg: '#f3f4f6', text: '#111827' }, // neutro
  altro:   { bg: '#ede9fe', text: '#111827' }, // viola chiaro
  glo:     { bg: '#fef3c7', text: '#111827' }, // giallo chiaro
  just:    { bg: '#ffedd5', text: '#111827' }, // arancio chiaro
  delv:    { bg: '#dcfce7', text: '#111827' }, // verde chiaro
  bp:      { bg: '#dbeafe', text: '#111827' }, // blu chiaro (= POS)
  sat:     { bg: '#dbeafe', text: '#111827' }, // blu chiaro (= POS)
  pos:     { bg: '#dbeafe', text: '#111827' }, // blu chiaro
  ft:      { bg: '#e0f2fe', text: '#111827' }, // azzurro chiaro
  arr:     { bg: '#fee2e2', text: '#111827' }, // rosso chiaro
  vers:    { bg: '#ffffff', text: '#111827' }, // bianco (separato, dopo CASH SERA)
};

// Definizione del box SPICCI (rotolini / mazzette aperte)
const SPICCI_FIELDS = [
  { key: 'sp5',  label: '5€',   mult: 50 },
  { key: 'sp2',  label: '2€',   mult: 50 },
  { key: 'sp1',  label: '1€',   mult: 25 },
  { key: 'sp05', label: '0,5€', mult: 20 },
];

// Cassetto spicci — stock totale disponibile per ciascun taglio.
// Il residuo mostrato = cassetto - "aperti" del taglio corrispondente.
const CASSETTO_FIELDS = [
  { key: 'cd5',  label: '5€',   spicciKey: 'sp5'  },
  { key: 'cd2',  label: '2€',   spicciKey: 'sp2'  },
  { key: 'cd1',  label: '1€',   spicciKey: 'sp1'  },
  { key: 'cd05', label: '0,5€', spicciKey: 'sp05' },
];

// Palette colore per il testo del campo VERS quando NON è una formula
const COLOR_MAP = {
  black:  '#111827',
  red:    '#dc2626',
  green:  '#15803d',
  blue:   '#1d4ed8',
  orange: '#ea580c',
};
const COLOR_PALETTE = [
  { key: 'black',  label: 'Nero',     css: COLOR_MAP.black  },
  { key: 'red',    label: 'Rosso',    css: COLOR_MAP.red    },
  { key: 'green',  label: 'Verde',    css: COLOR_MAP.green  },
  { key: 'blue',   label: 'Blu',      css: COLOR_MAP.blue   },
  { key: 'orange', label: 'Arancio',  css: COLOR_MAP.orange },
];

// Popover commento (right-click su un quadratino)
const CommentPopover = ({ inputRef, value, onChange, onSave, onCancel }) => {
  return (
    <div
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 z-50"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-amber-50 border-2 border-amber-400 rounded-md shadow-2xl p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-amber-800 uppercase">Commento</span>
          <span className="text-[9px] text-amber-600">Enter salva · Esc annulla</span>
        </div>
        <textarea
          ref={inputRef}
          data-testid="comment-popover-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          rows={3}
          placeholder="Aggiungi una nota…"
          className="w-full text-xs border border-amber-300 rounded p-1 focus:outline-none focus:border-amber-500 resize-none bg-white"
        />
        <div className="flex gap-1 mt-1 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100"
          >Annulla</button>
          <button
            type="button"
            onClick={onSave}
            className="text-[10px] px-2 py-0.5 rounded bg-amber-500 text-white font-bold hover:bg-amber-600"
          >Salva</button>
        </div>
      </div>
      {/* triangolino sotto */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-amber-50 border-r-2 border-b-2 border-amber-400 rotate-45"></div>
    </div>
  );
};

const ReportBetaPageInner = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, isAdmin, restaurant, effectiveRestaurant } = useAuth();
  // ───── Modalità storica: ?date=YYYY-MM-DD&rid=<restaurantId> ─────
  // Solo Admin/Supervisor possono usare: carica la chiusura archiviata di
  // quel giorno e permette correzioni. Il backend rifiuta per ruoli normali.
  const urlDate = searchParams.get('date') || '';
  const urlRid = searchParams.get('rid') || '';
  const historicalMode = !!(urlDate && urlRid && isAdmin);
  // Suffisso querystring da appendere alle chiamate fetch in modalità storica
  const histQS = historicalMode ? `?date=${urlDate}&restaurant_id=${urlRid}` : '';
  // Oggetto da fondere nel body PUT (cash/daily, beverages/daily) in modalità storica
  const histBody = useMemo(
    () => (historicalMode ? { date: urlDate, restaurant_id: urlRid } : {}),
    [historicalMode, urlDate, urlRid],
  );
  const [pasteText, setPasteText] = useState('');
  const [cash, setCash] = useState({});
  const [manualPrices, setManualPrices] = useState({});
  // Dizionario paste per il ristorante effettivo (live o storico).
  // Caricato da `/api/pasta-dictionary`; se non c'è override torna il default.
  const [pastaDict, setPastaDict] = useState(DEFAULT_PASTA_PRICES);
  // Vendite bevande: lette dal backend, refresh periodico
  const [beverages, setBeverages] = useState([]);   // {sigla, name, price}
  const [bevCounts, setBevCounts] = useState({});   // {sigla: {mattina, inUsc, scarti, sera}}
  // Riepilogo cassa Flaminio (persistente su DB) + SPICCI + CASSETTO
  const [cashRow, setCashRow] = useState(() => {
    const init = {};
    CASH_FIELDS.forEach(f => { init[f.key] = ''; });
    SPICCI_FIELDS.forEach(f => { init[f.key] = ''; });
    CASSETTO_FIELDS.forEach(f => { init[f.key] = ''; });
    return init;
  });
  const [cashComments, setCashComments] = useState({}); // { key: "testo commento" }
  const [versColor, setVersColor] = useState('');         // '' | 'black' | 'red' | 'green' | 'blue' | 'orange'
  // Forza modifica CASH MATTINA (normalmente è read-only perché auto-popolato
  // dal CASH SERA di ieri). L'utente può sbloccarlo esplicitamente per correzioni.
  const [forceMattina, setForceMattina] = useState(false);
  // Forza modifica MAGAZZINO MATTINA bevande (normalmente è read-only: allo
  // scatto di mezzanotte viene auto-popolato dal MAGAZZINO SERA della sera prima).
  const [forceMagMattina, setForceMagMattina] = useState(false);
  // Toggle collassamento sezioni per ridurre ingombro visivo
  const [showScarti, setShowScarti] = useState(false);
  const [showMagMattina, setShowMagMattina] = useState(false);
  // Auto-popolamento colonna PASTE dalle paste mandate dal Cassa.
  // - manualPasteOverride=false (default): pasteText è sincronizzato con autoPasteText
  // - manualPasteOverride=true: l'utente ha sbloccato la modifica manuale (override)
  const [manualPasteOverride, setManualPasteOverride] = useState(false);
  const [autoPasteText, setAutoPasteText] = useState('');
  const [autoPasteCount, setAutoPasteCount] = useState(0);
  const [focusedField, setFocusedField] = useState(null); // key | null (preview bar)
  const [previewKey, setPreviewKey] = useState(null); // key del campo MOVIMENTAZIONE da mostrare nella barra preview (toggle col pulsantino 🔍)
  // VERS rich-text editor (contentEditable) — supporta colorazione per-selezione.
  const versEditorRef = React.useRef(null);
  const [commentPopover, setCommentPopover] = useState(null); // { key, value }
  const commentInputRef = React.useRef(null);
  const [cashLoaded, setCashLoaded] = useState(false);
  const cashSaveTimer = React.useRef(null);
  // Cassetto spicci — edit mode (click-to-edit, conferma su Enter/blur, annulla su Esc)
  const [editingCassetto, setEditingCassetto] = useState(null); // key | null
  const [editingValue, setEditingValue] = useState('');         // valore digitato durante edit
  const editingInputRef = React.useRef(null);
  // Magazzino Sera editabile (debounce per sigla + protezione anti-override del polling)
  const bevSaveTimers = React.useRef({});            // { sigla: timeout }
  const bevPendingSeraUntil = React.useRef({});      // { sigla: timestamp ms } — finché non scade, il poll non sovrascrive 'sera'
  const [focusedSeraSigla, setFocusedSeraSigla] = useState(null);

  // Carica il dizionario paste del ristorante effettivo (live o storico).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        // In modalità storica usa il rid dall'URL, altrimenti il backend
        // userà l'effective_restaurant_id dell'utente loggato.
        const url = historicalMode
          ? `${API}/pasta-dictionary?restaurant_id=${urlRid}`
          : `${API}/pasta-dictionary`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
        if (cancelled) return;
        const list = (res.data?.siglas || []).map(s => ({
          sigla: String(s.sigla).toUpperCase(),
          price: Number(s.price) || 0,
        }));
        if (list.length > 0) setPastaDict(list);
      } catch (e) {
        // Fallback: resta sul default
      }
    })();
    return () => { cancelled = true; };
  }, [token, historicalMode, urlRid]);

  // Carica catalogo bevande + conteggi giornata. Refresh ogni 15s così se il
  // cassiere aggiorna la pagina magazzino in un'altra tab vede subito qui.
  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    let cancelled = false;
    const load = async () => {
      try {
        const [invRes, dailyRes] = await Promise.all([
          axios.get(`${API}/beverages/inventory${histQS}`, { headers }),
          axios.get(`${API}/beverages/daily${histQS}`, { headers }),
        ]);
        if (cancelled) return;
        setBeverages(invRes.data || []);
        const today = dailyRes.data?.counts || {};
        const prev = dailyRes.data?.prev_sera || {};
        const now = Date.now();
        setBevCounts(prevState => {
          const merged = {};
          (invRes.data || []).forEach(b => {
            const remote = today[b.sigla];
            const local = prevState[b.sigla];
            // Protezione: se l'utente sta editando 'sera' (focus) o ha appena
            // salvato (<3s), mantieni il valore locale di 'sera' per evitare flicker.
            const seraLocked = (
              focusedSeraSigla === b.sigla
              || (bevPendingSeraUntil.current[b.sigla] && bevPendingSeraUntil.current[b.sigla] > now)
            );
            if (remote) {
              merged[b.sigla] = {
                mattina: remote.mattina || '',
                inUsc: remote.inUsc || '',
                scarti: remote.scarti || '',
                sera: seraLocked ? (local?.sera ?? '') : (remote.sera || ''),
                mattina_casse: remote.mattina_casse || '',
                mattina_sfuse: remote.mattina_sfuse || '',
                inUsc_casse: remote.inUsc_casse || '',
                sera_casse: seraLocked ? (local?.sera_casse ?? '') : (remote.sera_casse || ''),
                sera_sfuse: seraLocked ? (local?.sera_sfuse ?? '') : (remote.sera_sfuse || ''),
              };
            } else if (prev[b.sigla] !== undefined && prev[b.sigla] !== '') {
              // Auto-fill mattina dal sera del giorno prima.
              // Decomposizione automatica del totale in casse (×24) + sfuse,
              // così l'utente vede subito un breakdown ragionevole e può rifinirlo.
              const prevTot = Number(prev[b.sigla]) || 0;
              const prevCasse = prevTot > 0 ? Math.floor(prevTot / 24) : 0;
              const prevSfuse = prevTot - prevCasse * 24;
              merged[b.sigla] = {
                mattina: String(prev[b.sigla]),
                inUsc: '',
                scarti: '',
                sera: seraLocked ? (local?.sera ?? '') : '',
                mattina_casse: prevCasse > 0 ? String(prevCasse) : '',
                mattina_sfuse: prevSfuse > 0 ? String(prevSfuse) : '',
                inUsc_casse: '',
                sera_casse: seraLocked ? (local?.sera_casse ?? '') : '',
                sera_sfuse: seraLocked ? (local?.sera_sfuse ?? '') : '',
              };
            } else {
              merged[b.sigla] = {
                mattina: '',
                inUsc: '',
                scarti: '',
                sera: seraLocked ? (local?.sera ?? '') : '',
                mattina_casse: '',
                mattina_sfuse: '',
                inUsc_casse: '',
                sera_casse: seraLocked ? (local?.sera_casse ?? '') : '',
                sera_sfuse: seraLocked ? (local?.sera_sfuse ?? '') : '',
              };
            }
          });
          return merged;
        });
      } catch (e) {
        // 403 se non Flaminio/Admin: ignora silenziosamente
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, focusedSeraSigla, histQS]);

  // Auto-save debounced di una bevanda (intera riga, come MagazzinoBevandePage)
  const scheduleBevSave = React.useCallback((sigla, row) => {
    if (bevSaveTimers.current[sigla]) clearTimeout(bevSaveTimers.current[sigla]);
    bevSaveTimers.current[sigla] = setTimeout(async () => {
      try {
        await axios.put(`${API}/beverages/daily`, {
          sigla,
          mattina: row.mattina ?? '',
          inUsc: row.inUsc ?? '',
          scarti: row.scarti ?? '',
          sera: row.sera ?? '',
          mattina_casse: row.mattina_casse ?? '',
          mattina_sfuse: row.mattina_sfuse ?? '',
          inUsc_casse: row.inUsc_casse ?? '',
          sera_casse: row.sera_casse ?? '',
          sera_sfuse: row.sera_sfuse ?? '',
          comments: row.comments || {},
          ...histBody,
        }, { headers: { Authorization: `Bearer ${token}` } });
        // Mantieni protezione del valore locale per altri 2s dopo il save
        bevPendingSeraUntil.current[sigla] = Date.now() + 2000;
      } catch (e) {
        console.error('save beverage sera (report)', e);
      }
    }, 600);
  }, [token, histBody]);

  // Magazzino (Mattina o Sera): l'utente inserisce CASSE (×24) e SFUSE separatamente.
  // Il totale (mattina o sera) memorizzato a DB è la somma calcolata casse*24 + sfuse.
  const PEZZI_PER_CASSA = 24;
  const handleCasseSfuseChange = (sigla, slot /* 'mattina'|'sera' */, kind /* 'casse'|'sfuse' */, value) => {
    bevPendingSeraUntil.current[sigla] = Date.now() + 4000;
    const fieldKey = `${slot}_${kind}`; // es. 'sera_casse' | 'mattina_sfuse'
    setBevCounts(prev => {
      const current = prev[sigla] || {
        mattina: '', inUsc: '', scarti: '', sera: '',
        mattina_casse: '', mattina_sfuse: '',
        sera_casse: '', sera_sfuse: '',
      };
      const nextRow = { ...current, [fieldKey]: value };
      const casseRaw = kind === 'casse' ? value : (nextRow[`${slot}_casse`] ?? '');
      const sfuseRaw = kind === 'sfuse' ? value : (nextRow[`${slot}_sfuse`] ?? '');
      const casseEmpty = casseRaw === '' || casseRaw === null || casseRaw === undefined;
      const sfuseEmpty = sfuseRaw === '' || sfuseRaw === null || sfuseRaw === undefined;
      if (casseEmpty && sfuseEmpty) {
        nextRow[slot] = '';
      } else {
        const c = evaluateValue(casseRaw);
        const s = evaluateValue(sfuseRaw);
        const total = c * PEZZI_PER_CASSA + s;
        nextRow[slot] = Number.isInteger(total) ? String(total) : String(+total.toFixed(2));
      }
      const next = { ...prev, [sigla]: nextRow };
      scheduleBevSave(sigla, nextRow);
      return next;
    });
  };

  const handleSeraChange = (sigla, value) => {
    // Estendi la finestra di protezione contro il poll-override
    bevPendingSeraUntil.current[sigla] = Date.now() + 4000;
    setBevCounts(prev => {
      const current = prev[sigla] || { mattina: '', inUsc: '', scarti: '', sera: '' };
      const nextRow = { ...current, sera: value };
      const next = { ...prev, [sigla]: nextRow };
      scheduleBevSave(sigla, nextRow);
      return next;
    });
  };

  // Scarti (unità, in sync con MagazzinoBevandePage)
  const handleScartiChange = (sigla, value) => {
    bevPendingSeraUntil.current[sigla] = Date.now() + 4000;
    setBevCounts(prev => {
      const current = prev[sigla] || { mattina: '', inUsc: '', scarti: '', sera: '', sera_casse: '', sera_sfuse: '' };
      const nextRow = { ...current, scarti: value };
      const next = { ...prev, [sigla]: nextRow };
      scheduleBevSave(sigla, nextRow);
      return next;
    });
  };

  // Ingressi (input in CASSE: il valore digitato viene moltiplicato per
  // PEZZI_PER_CASSA prima del salvataggio nel campo unità `inUsc`).
  // Manteniamo `inUsc_casse` separato così a refresh mostriamo il numero di casse digitato (anche con virgola).
  const handleInUscChange = (sigla, value) => {
    bevPendingSeraUntil.current[sigla] = Date.now() + 4000;
    setBevCounts(prev => {
      const current = prev[sigla] || {
        mattina: '', inUsc: '', scarti: '', sera: '',
        mattina_casse: '', mattina_sfuse: '',
        inUsc_casse: '',
        sera_casse: '', sera_sfuse: '',
      };
      const nextRow = { ...current, inUsc_casse: value };
      const empty = value === '' || value === null || value === undefined;
      if (empty) {
        nextRow.inUsc = '';
      } else {
        const c = evaluateValue(value);
        const total = c * PEZZI_PER_CASSA;
        nextRow.inUsc = Number.isInteger(total) ? String(total) : String(+total.toFixed(2));
      }
      const next = { ...prev, [sigla]: nextRow };
      scheduleBevSave(sigla, nextRow);
      return next;
    });
  };

  // Riepilogo cassa: caricamento iniziale (no polling, è la sorgente di verità qui)
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${API}/cash/daily${histQS}`, { headers: { Authorization: `Bearer ${token}` } });
        if (cancelled) return;
        const data = res.data?.data || {};
        const prev = res.data?.prev_cash_sera;
        // Auto-fill MATTINA con CASH SERA del giorno prima se oggi è vuoto
        const initial = {};
        CASH_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        SPICCI_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        CASSETTO_FIELDS.forEach(f => { initial[f.key] = data[f.key] || ''; });
        if (!initial.mattina && prev !== '' && prev !== null && prev !== undefined) {
          initial.mattina = String(prev);
        }
        setCashRow(initial);
        setCashComments(res.data?.comments || {});
        setVersColor(res.data?.vers_color || '');
        // Persistenza paste incollate + banconote + prezzi manuali
        if (typeof res.data?.paste_text === 'string') setPasteText(res.data.paste_text);
        if (res.data?.cash_banconote && typeof res.data.cash_banconote === 'object') {
          setCash(res.data.cash_banconote);
        }
        if (res.data?.manual_prices && typeof res.data.manual_prices === 'object') {
          setManualPrices(res.data.manual_prices);
        }
        setCashLoaded(true);
      } catch (e) {
        // 403 se non Flaminio/Admin
        setCashLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token, histQS]);

  // Debounced save del riepilogo cassa
  useEffect(() => {
    if (!cashLoaded || !token) return;
    if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current);
    cashSaveTimer.current = setTimeout(() => {
      axios.put(`${API}/cash/daily`, {
        ...cashRow,
        comments: cashComments,
        vers_color: versColor,
        paste_text: pasteText,
        cash_banconote: cash,
        manual_prices: manualPrices,
        ...histBody,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => { /* silenzioso */ });
    }, 500);
    return () => { if (cashSaveTimer.current) clearTimeout(cashSaveTimer.current); };
  }, [cashRow, cashComments, versColor, pasteText, cash, manualPrices, cashLoaded, token, histBody]);

  // Auto-popolamento PASTE dalle paste mandate dal Cassa (live, per il locale effettivo).
  // - Fetch iniziale + polling 5s + ascolto eventi WS via OrderContext (refresh immediato).
  // - Include hidden_generale=true (sono state vendute/incassate).
  // - Se l'utente sblocca "Modifica manuale" l'override locale non viene sovrascritto.
  useEffect(() => {
    if (!token) return;
    if (historicalMode) return; // In modalità storica usiamo il paste_text salvato
    let cancelled = false;
    const eid = effectiveRestaurant?.id;
    const headers = { Authorization: `Bearer ${token}` };
    if (isAdmin && eid) {
      // Impersonificazione admin/supervisor → propaga il ristorante target
      headers['X-Restaurant-Id'] = eid;
    }
    const load = async () => {
      try {
        const res = await axios.get(`${API}/orders/today-paste-list`, { headers });
        if (cancelled) return;
        const items = res.data?.items || [];
        // Formato riga: "<order_number>  <description>" — il parser usa \b
        // sulla sigla, quindi il numero d'ordine non rompe il riconoscimento.
        const text = items
          .filter(it => (it.description || '').trim().length > 0)
          .map(it => `${it.order_number}  ${(it.description || '').trim()}`)
          .join('\n');
        setAutoPasteText(text);
        setAutoPasteCount(items.filter(it => (it.description || '').trim().length > 0).length);
      } catch (e) {
        // 401/403 in scenari edge: ignora silenziosamente
      }
    };
    load();
    // Polling come fallback; il WS sotto (OrderContext) farà i refresh "live".
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, isAdmin, effectiveRestaurant?.id, historicalMode]);

  // Sincronizza pasteText con autoPasteText quando NON è in override manuale.
  useEffect(() => {
    if (manualPasteOverride) return;
    if (historicalMode) return; // Storico: usa il paste_text salvato, non sovrascrivere
    if (autoPasteText === pasteText) return;
    setPasteText(autoPasteText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPasteText, manualPasteOverride, historicalMode]);

  // Quando un ordine viene creato/modificato/eliminato dall'OrderContext (WS live)
  // forziamo un refetch immediato così la colonna PASTE è subito aggiornata.
  // Ascoltiamo lo state `orders` esposto dall'OrderContext: cambia → triggera.
  // Nota: l'OrderContext è connesso al ristorante del JWT; in caso di
  // impersonificazione admin il polling 5s farà da safety net.
  const orderCtx = useOrders();
  const orderTrigger = orderCtx?.orders?.length ?? 0;
  useEffect(() => {
    if (!token) return;
    if (historicalMode) return; // In modalità storica nessun refresh live
    let cancelled = false;
    const eid = effectiveRestaurant?.id;
    const headers = { Authorization: `Bearer ${token}` };
    if (isAdmin && eid) headers['X-Restaurant-Id'] = eid;
    (async () => {
      try {
        const res = await axios.get(`${API}/orders/today-paste-list`, { headers });
        if (cancelled) return;
        const items = res.data?.items || [];
        const text = items
          .filter(it => (it.description || '').trim().length > 0)
          .map(it => `${it.order_number}  ${(it.description || '').trim()}`)
          .join('\n');
        setAutoPasteText(text);
        setAutoPasteCount(items.filter(it => (it.description || '').trim().length > 0).length);
      } catch (e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderTrigger, historicalMode]);

  // Info del quadratino MOVIMENTAZIONE FINANZIARIA attualmente selezionato per la preview
  // (si apre solo se l'utente clicca il pulsantino 🔍 sotto la cella).
  const previewInfo = useMemo(() => {
    if (!previewKey) return null;
    const cf = CASH_FIELDS.find(x => x.key === previewKey);
    if (!cf) return null;
    const raw = cashRow[cf.key] || '';
    // Per VERS lo storage è HTML rich-text: strippo i tag per la visualizzazione
    const rawText = typeof raw === 'string' && raw.includes('<')
      ? raw.replace(/<[^>]*>/g, '')
      : raw;
    const computed = evaluateValue(raw);
    const sign = cf.op === 'minus' ? '−' : (cf.op === 'plus' ? '+' : '');
    return {
      label: cf.label,
      raw: rawText,
      rawHtml: typeof raw === 'string' && raw.includes('<') ? raw : null,
      formatted: `${sign}€${computed.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      comment: cashComments[cf.key] || '',
    };
  }, [previewKey, cashRow, cashComments]);

  const setCashRowValue = (key, v) => setCashRow(p => ({ ...p, [key]: v }));

  // Auto-dismiss della preview: si chiude se l'utente clicca QUALSIASI punto
  // fuori dalla cella attualmente in preview (input/label/padding inclusi).
  // Eccezione: i pulsantini lente di altre celle non chiudono — lasciano che
  // il toggle apra direttamente la nuova preview.
  useEffect(() => {
    if (!previewKey) return;
    const onMouseDown = (e) => {
      const t = e.target;
      const cell = t.closest && t.closest('[data-preview-cell]');
      if (cell && cell.getAttribute('data-preview-cell') === previewKey) return;
      if (t.closest && t.closest('[data-testid^="preview-toggle-"]')) return;
      setPreviewKey(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [previewKey]);

  // Tastiera: se l'utente tab-keya su un altro campo MOVIMENTAZIONE, dismiss.
  useEffect(() => {
    if (focusedField && focusedField !== previewKey) {
      setPreviewKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedField]);

  // === VERS rich-text editor: sync con cashRow.vers + helper colore ===
  // Quando lo state esterno cambia (es. caricamento iniziale dal server) e
  // l'editor NON è il focus attivo, allineiamo il suo innerHTML al valore.
  // Non riallineiamo mentre l'utente sta digitando per non perdere il cursore.
  useEffect(() => {
    const el = versEditorRef.current;
    if (!el) return;
    const target = cashRow.vers || '';
    if (el.innerHTML !== target && document.activeElement !== el) {
      el.innerHTML = target;
    }
  }, [cashRow.vers]);

  // Cattura l'HTML corrente dell'editor e lo scrive nello stato.
  const handleVersInput = () => {
    const el = versEditorRef.current;
    if (!el) return;
    setCashRow(p => ({ ...p, vers: el.innerHTML }));
  };

  // Applica un colore alla porzione di testo selezionata dentro l'editor VERS.
  // Implementazione manuale (no execCommand deprecato): wrap della selezione in
  // un <span style="color:hex">…</span> e sposto il cursore SUBITO DOPO lo span,
  // così l'utente può continuare a digitare in colore default ("normale").
  const applyVersColor = (hex) => {
    const el = versEditorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return; // nessuna selezione: ignora
    if (!el.contains(range.commonAncestorContainer)) return; // selezione fuori dall'editor

    // Estraggo il contenuto selezionato e lo avvolgo in uno <span> colorato
    const fragment = range.extractContents();
    const span = document.createElement('span');
    span.style.color = hex;
    span.appendChild(fragment);
    range.insertNode(span);

    // Cursore SUBITO DOPO lo span → il prossimo testo digitato sarà in default
    const afterRange = document.createRange();
    afterRange.setStartAfter(span);
    afterRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(afterRange);

    setCashRow(p => ({ ...p, vers: el.innerHTML }));
  };

  // Autofocus quando si entra in edit mode su un quadratino del cassetto
  useEffect(() => {
    if (editingCassetto && editingInputRef.current) {
      editingInputRef.current.focus();
      editingInputRef.current.select();
    }
  }, [editingCassetto]);

  const startEditCassetto = (f) => {
    // Solo Admin può modificare lo stock "Cassetto Spicci"
    if (!isAdmin) return;
    // Mostra nell'input il valore residuo corrente (stock_base - aperti)
    const raw = cashRow[f.key];
    if (raw === '' || raw === undefined || raw === null) {
      setEditingValue('');
    } else {
      const base = evaluateValue(raw);
      const aperti = evaluateValue(cashRow[f.spicciKey]);
      const residuo = base - aperti;
      // Mostro intero se non ha decimali, altrimenti con max 2 decimali
      setEditingValue(Number.isInteger(residuo) ? String(residuo) : String(+residuo.toFixed(2)));
    }
    setEditingCassetto(f.key);
  };
  const commitEditCassetto = (f) => {
    if (editingValue.trim() === '') {
      // Campo svuotato → resetto stock a stringa vuota
      setCashRow(p => ({ ...p, [f.key]: '' }));
    } else {
      const typed = evaluateValue(editingValue);
      const aperti = evaluateValue(cashRow[f.spicciKey]);
      const newBase = typed + aperti;
      // Salvo come stringa "pulita" (no decimali se intero)
      const baseStr = Number.isInteger(newBase) ? String(newBase) : String(+newBase.toFixed(2));
      setCashRow(p => ({ ...p, [f.key]: baseStr }));
    }
    setEditingCassetto(null);
    setEditingValue('');
  };
  const cancelEditCassetto = () => {
    // Nessuna modifica a cashRow durante l'edit, basta uscire
    setEditingCassetto(null);
    setEditingValue('');
  };

  // Commenti: right-click su una cella → popover.
  // Supporta 2 tipi:
  //   - cash: key = "altro"/"sp5"/... (campo cassa) → cashComments[key]
  //   - bev:  key = "AL"/"AG"/... e subkey = "scarti"/"inUsc" → bevCounts[sigla].comments[subkey]
  const openCommentPopover = (key, kind = 'cash', subkey = null) => {
    let initial = '';
    if (kind === 'cash') {
      initial = cashComments[key] || '';
    } else if (kind === 'bev') {
      const row = bevCounts[key] || {};
      initial = (row.comments || {})[subkey] || '';
    }
    setCommentPopover({ key, kind, subkey, value: initial });
  };
  const closeCommentPopover = () => setCommentPopover(null);
  const saveCommentPopover = () => {
    if (!commentPopover) return;
    const { key, kind, subkey, value } = commentPopover;
    const trimmed = (value || '').trim();
    if (kind === 'bev' && subkey) {
      // Aggiorno bevCounts[sigla].comments[subkey] e salvo subito tramite scheduleBevSave
      setBevCounts(prev => {
        const current = prev[key] || {};
        const oldComments = current.comments || {};
        const newComments = { ...oldComments };
        if (trimmed) newComments[subkey] = trimmed;
        else delete newComments[subkey];
        const nextRow = { ...current, comments: newComments };
        scheduleBevSave(key, nextRow);
        return { ...prev, [key]: nextRow };
      });
    } else {
      setCashComments(prev => {
        const next = { ...prev };
        if (trimmed) next[key] = trimmed;
        else delete next[key];
        return next;
      });
    }
    setCommentPopover(null);
  };

  // Autofocus del popover commento appena si apre (NON ad ogni keystroke,
  // altrimenti select() cancellerebbe il testo digitato)
  useEffect(() => {
    if (commentPopover && commentInputRef.current) {
      commentInputRef.current.focus();
      // posiziono il cursore alla fine senza selezionare il testo
      const len = (commentPopover.value || '').length;
      try { commentInputRef.current.setSelectionRange(len, len); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentPopover?.key]);

  // Calcolo valori SPICCI per ogni taglio + totale euro
  const spicciValues = useMemo(() => {
    const rows = SPICCI_FIELDS.map(f => {
      const aperti = evaluateValue(cashRow[f.key]);
      return { ...f, aperti, value: aperti * f.mult };
    });
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { rows, total };
  }, [cashRow]);

  // Parsing paste — restituisce anche l'elenco delle non-riconosciute con indice stabile
  const pasteAnalysis = useMemo(() => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const breakdown = {};
    const dictList = (pastaDict && pastaDict.length) ? pastaDict : DEFAULT_PASTA_PRICES;
    dictList.forEach(p => { breakdown[p.sigla] = { count: 0, total: 0, price: p.price }; });
    const unrecognized = []; // {idx, text}
    let recognizedCount = 0;
    let recognizedEuro = 0;
    lines.forEach((line, idx) => {
      const match = findPasta(line, dictList);
      if (match) {
        breakdown[match.sigla].count += 1;
        breakdown[match.sigla].total += match.price;
        recognizedCount += 1;
        recognizedEuro += match.price;
      } else {
        unrecognized.push({ idx, text: line });
      }
    });

    // Le non riconosciute contano comunque come paste: count = +1 ciascuna
    // Il prezzo è quello manuale se presente, altrimenti 0
    let manualEuro = 0;
    unrecognized.forEach(u => {
      const raw = (manualPrices[u.idx] ?? '').toString().replace(/,/g, '.').trim();
      const n = parseFloat(raw);
      if (!Number.isNaN(n) && n > 0) manualEuro += n;
    });

    return {
      breakdown,
      unrecognized,
      totalCount: recognizedCount + unrecognized.length,
      totalEuro: recognizedEuro + manualEuro,
      missingPriceCount: unrecognized.filter(u => {
        const raw = (manualPrices[u.idx] ?? '').toString().replace(/,/g, '.').trim();
        const n = parseFloat(raw);
        return Number.isNaN(n) || n <= 0;
      }).length,
    };
  }, [pasteText, manualPrices, pastaDict]);

  const cashTotal = useMemo(() => {
    let sum = 0;
    for (const d of CASH_DENOMINATIONS) {
      const n = evaluateValue(cash[d.key]);
      if (!Number.isFinite(n) || n < 0) continue;
      sum += n * d.value;
    }
    return sum;
  }, [cash]);

  // Aggrego le vendite bevande
  const bevSales = useMemo(() => {
    return beverages.map(b => {
      const c = bevCounts[b.sigla] || {};
      const m = evaluateValue(c.mattina);
      const u = evaluateValue(c.inUsc);
      const sc = evaluateValue(c.scarti);
      const se = evaluateValue(c.sera);
      const qty = se === 0 ? 0 : (m + u - sc - se);
      const inc = Math.max(0, qty) * (b.price || 0);
      return { sigla: b.sigla, name: b.name, qty, inc };
    });
  }, [beverages, bevCounts]);
  const bevTotalQty = bevSales.reduce((s, r) => s + Math.max(0, r.qty), 0);
  const bevTotalInc = bevSales.reduce((s, r) => s + r.inc, 0);

  // Calcolo CASH SERA in tempo reale
  // Include anche: TOT box Paste + TOT box Bevande + TOT SPICCI
  const cashSera = useMemo(() => {
    let total = 0;
    for (const f of CASH_FIELDS) {
      const v = evaluateValue(cashRow[f.key]);
      if (f.op === 'base' || f.op === 'plus') total += v;
      else if (f.op === 'minus') total -= v;
    }
    total += pasteAnalysis.totalEuro;
    total += bevTotalInc;
    total += spicciValues.total;
    return total;
  }, [cashRow, pasteAnalysis.totalEuro, bevTotalInc, spicciValues.total]);

  // Trace dettagliato del calcolo di CASH SERA — usato dalla console di debug.
  // Riproduce ESATTAMENTE la stessa formula del frontend, passo per passo,
  // così l'utente può verificare ogni voce e capire dove un conto non torna.
  const cashSeraTrace = useMemo(() => {
    const fmt = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const steps = [];
    let running = 0;

    // 1. Riga "Riepilogo Cassa" — segni + / − applicati ai campi
    steps.push({ section: 'Riepilogo Cassa', label: '— inizio —', raw: '', value: 0, sign: '', running: 0 });
    for (const f of CASH_FIELDS) {
      const raw = cashRow[f.key] || '';
      const v = evaluateValue(raw);
      let delta = 0;
      let sign = '=';
      if (f.op === 'base' || f.op === 'plus') { delta = v; sign = '+'; }
      else if (f.op === 'minus') { delta = -v; sign = '−'; }
      running += delta;
      steps.push({
        section: 'Riepilogo Cassa',
        label: f.label,
        raw,
        value: v,
        sign,
        delta,
        running,
      });
    }
    const baseSum = running;

    // 2. Paste riconosciute + prezzi manuali
    steps.push({ section: 'Paste', label: 'totale paste (€)', raw: `${pasteAnalysis.totalCount} righe`, value: pasteAnalysis.totalEuro, sign: '+', delta: pasteAnalysis.totalEuro, running: running + pasteAnalysis.totalEuro });
    running += pasteAnalysis.totalEuro;

    // 3. Bevande vendute
    steps.push({ section: 'Bevande', label: 'incasso bevande (€)', raw: `${bevSales.reduce((s, r) => s + Math.max(0, r.qty), 0)} pz`, value: bevTotalInc, sign: '+', delta: bevTotalInc, running: running + bevTotalInc });
    running += bevTotalInc;

    // 4. Spicci aperti (dettaglio per taglio)
    for (const r of spicciValues.rows) {
      steps.push({
        section: 'Spicci aperti',
        label: `${r.label} aperti × ${r.aperti}`,
        raw: String(cashRow[r.key] || ''),
        value: r.value,
        sign: '+',
        delta: r.value,
        running: running + r.value,
      });
      running += r.value;
    }

    return {
      steps,
      base: baseSum,
      paste: pasteAnalysis.totalEuro,
      bev: bevTotalInc,
      spicci: spicciValues.total,
      final: running,
      fmt,
    };
  }, [cashRow, pasteAnalysis.totalEuro, pasteAnalysis.totalCount, bevTotalInc, bevSales, spicciValues.total, spicciValues.rows]);

  const setCashValue = (key, v) => setCash(p => ({ ...p, [key]: v }));
  const setManualPrice = (idx, v) => {
    // Cap manuale: massimo 15€ per una pasta sconosciuta (vale per
    // qualsiasi cifra numerica digitata; le formule "=" non sono ammesse qui).
    const raw = (v ?? '').toString();
    if (raw.trim() === '') {
      setManualPrices(p => ({ ...p, [idx]: '' }));
      return;
    }
    const normalized = raw.replace(/,/g, '.');
    const n = parseFloat(normalized);
    if (!Number.isNaN(n) && n > 15) {
      // Sostituisco con 15 (preserva la virgola italiana nello stato visivo)
      setManualPrices(p => ({ ...p, [idx]: '15' }));
      return;
    }
    setManualPrices(p => ({ ...p, [idx]: raw }));
  };
  const fmtEur = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      className="min-h-screen bg-[#F5F5F5] flex flex-col overflow-hidden"
      style={{ zoom: 0.9 }}
    >
      <Header />
      {historicalMode && (
        <div
          data-testid="historical-banner"
          className="bg-amber-100 border-y-2 border-amber-500 text-amber-900 px-4 py-2 flex items-center justify-between gap-3 flex-wrap"
          style={{ fontSize: 14 }}
        >
          <div className="flex items-center gap-2 font-bold">
            <span style={{ fontSize: 18 }}>📅</span>
            MODALITÀ STORICO — {(() => {
              const [y, m, d] = urlDate.split('-');
              return `${d}/${m}/${y}`;
            })()} — Le modifiche aggiornano la chiusura archiviata
          </div>
          <button
            data-testid="historical-back"
            onClick={() => navigate('/chiusure-excel')}
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1 rounded text-xs"
          >
            ← Torna a Chiusure Excel
          </button>
        </div>
      )}
      {!historicalMode && isAdmin && (
        <div
          data-testid="test-snapshot-banner"
          className="bg-indigo-50 border-y border-indigo-300 text-indigo-900 px-4 py-1.5 flex items-center justify-between gap-3 flex-wrap"
          style={{ fontSize: 12 }}
        >
          <div className="font-semibold">
            🧪 STRUMENTO TEST (solo Admin/Supervisor) — Archivia il report di OGGI come chiusura passata per testare la Vista Excel
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="test-snapshot-button"
              onClick={async () => {
                const todayStr = new Date().toISOString().slice(0, 10);
                const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                const target = window.prompt(
                  `Su che data vuoi archiviare il report di oggi (${todayStr})?\nDeve essere precedente a oggi. Default: ieri (${yest})`,
                  yest,
                );
                if (!target) return;
                try {
                  const eid = effectiveRestaurant?.id || restaurant?.id;
                  const res = await axios.post(`${API}/admin/closures/snapshot-today`, {
                    restaurant_id: eid, target_date: target,
                  }, { headers: { Authorization: `Bearer ${token}` } });
                  alert(`✓ Archiviato come ${res.data.target_date} (cash:${res.data.cash_copied} · bev:${res.data.bev_copied}).\nApro la Vista Excel...`);
                  navigate('/chiusure-excel');
                } catch (e) {
                  alert('Errore: ' + (e.response?.data?.detail || e.message));
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1 rounded text-xs"
            >
              📦 Archivia ora come chiusura passata
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 py-2 flex flex-col min-h-0">
        {/* Titolo compatto */}
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <h1 className="font-heading text-base sm:text-xl font-bold text-gray-900 uppercase tracking-wide">
            Report
          </h1>
          <button
            data-testid="back-home"
            onClick={() => navigate('/home')}
            className="text-xs text-gray-600 hover:text-gray-900 underline"
          >
            ← Home
          </button>
        </div>

        {/* Layout: paste a sinistra (~14%) + tutto il resto a destra (~86%) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[14fr_86fr] gap-2 min-h-0">
          {/* ============== SINISTRA — PASTE ============== */}
          <section className="bg-white rounded border border-gray-200 p-2 flex flex-col min-h-0">
            <div className="flex items-baseline justify-center mb-1 gap-1 flex-wrap">
              <h2 className="text-xs font-bold text-gray-800 uppercase">Paste</h2>
            </div>
            <button
              type="button"
              data-testid="toggle-paste-manual"
              onClick={() => {
                if (manualPasteOverride) {
                  // Torna ad auto: ricarica dal server (azzera modifiche manuali)
                  setManualPasteOverride(false);
                  setPasteText(autoPasteText);
                } else {
                  setManualPasteOverride(true);
                }
              }}
              title={manualPasteOverride
                ? 'Aggiornamenti automatici BLOCCATI — clicca per riattivare'
                : 'Blocca gli aggiornamenti automatici (le paste live dal Cassa non sovrascriveranno più questo box)'}
              className={`text-[11px] font-bold px-2 py-1 rounded mb-1 transition-colors uppercase tracking-wide ${
                manualPasteOverride
                  ? 'bg-red-600 text-white border border-red-700 hover:bg-red-700'
                  : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
              }`}
            >
              {manualPasteOverride ? 'AGGIORNAMENTI BLOCCATI' : 'BLOCCA AGGIORNAMENTI'}
            </button>

            <textarea
              data-testid="paste-textarea"
              value={pasteText}
              onChange={(e) => { if (manualPasteOverride) setPasteText(e.target.value); }}
              readOnly={!manualPasteOverride}
              spellCheck={false}
              title={manualPasteOverride
                ? 'Modifica manuale attiva'
                : 'Auto-popolato dalle paste mandate dal Cassa (live)'}
              className={`w-full flex-1 min-h-[120px] p-2 border rounded text-[13px] leading-snug tracking-wide font-semibold text-gray-800 focus:outline-none resize-none ${
                manualPasteOverride
                  ? 'border-rose-300 focus:border-rose-500 bg-white'
                  : 'border-gray-200 bg-gray-50 cursor-not-allowed'
              }`}
            />

            {/* Non riconosciute con prezzo manuale */}
            {pasteAnalysis.unrecognized.length > 0 && (
              <div className="mt-1 bg-rose-50 border border-rose-200 rounded p-1.5 text-[10px] flex-shrink-0 max-h-32 overflow-y-auto">
                <div className="font-bold text-rose-700 mb-1">
                  Non riconosciute ({pasteAnalysis.unrecognized.length}) — assegna prezzo:
                </div>
                <div className="space-y-1">
                  {pasteAnalysis.unrecognized.map(u => (
                    <div key={u.idx} className="flex items-center gap-1">
                      <span className="font-mono text-rose-900 flex-1 truncate" title={u.text}>{u.text}</span>
                      <input
                        data-testid={`manual-price-${u.idx}`}
                        type="text"
                        inputMode="decimal"
                        value={manualPrices[u.idx] ?? ''}
                        onChange={(e) => setManualPrice(u.idx, e.target.value)}
                        placeholder="€"
                        title="Max 15€"
                        className="w-12 h-6 border border-rose-300 rounded px-1 text-center font-bold text-[11px] focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Totali */}
            <div className="mt-1 grid grid-cols-2 gap-1 flex-shrink-0">
              <div data-testid="total-paste-count" className="bg-gray-900 text-white rounded px-2 py-1 flex flex-col items-center">
                <span className="text-[9px] uppercase opacity-70">Tot paste</span>
                <span className="text-xl font-semibold leading-none">{pasteAnalysis.totalCount}</span>
              </div>
              <div data-testid="total-paste-euro" className="bg-[#F5C518] text-gray-900 rounded px-2 py-1 flex flex-col items-center">
                <span className="text-[9px] uppercase opacity-80">Tot €</span>
                <span className="text-xl font-semibold leading-none">€{fmtEur(pasteAnalysis.totalEuro)}</span>
              </div>
            </div>
            {pasteAnalysis.missingPriceCount > 0 && (
              <div className="mt-1 text-[10px] text-rose-600 text-center flex-shrink-0">
                {pasteAnalysis.missingPriceCount} senza prezzo → conta come 0
              </div>
            )}
          </section>

          {/* ============== DESTRA — CASSA + AREA FUTURA ============== */}
          <section className="flex flex-col gap-1.5 min-h-0">
            {/* Riga banconote */}
            <div>
              <h2 className="text-sm font-bold text-gray-800 uppercase text-center mb-0.5">Cassa</h2>
              <div className="bg-white rounded p-1.5" style={{ border: '2px solid #4ade80' }}>
              <div className="grid grid-cols-11 gap-1.5">
                {CASH_DENOMINATIONS.map(d => {
                  const raw = (cash[d.key] || '').replace(/,/g, '.');
                  const n = parseFloat(raw);
                  const subTot = (!raw || Number.isNaN(n) || n < 0) ? 0 : n * d.value;
                  return (
                    <div key={d.key} className="flex flex-col">
                      <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5">
                        {d.label}
                      </label>
                      <input
                        data-testid={`cash-input-${d.key}`}
                        type="text"
                        inputMode="decimal"
                        value={cash[d.key] || ''}
                        onChange={(e) => setCashValue(d.key, e.target.value)}
                        placeholder="0"
                        className="w-full h-11 border border-gray-200 rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518]"
                      />
                      <span className="text-[10px] font-bold text-gray-700 mt-0.5 text-center leading-none">
                        {subTot > 0 ? `€${fmtEur(subTot)}` : '\u00A0'}
                      </span>
                    </div>
                  );
                })}
                <div className="flex flex-col">
                  <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">Tot</label>
                  <div
                    data-testid="cash-total"
                    className="w-full h-11 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-semibold text-sm"
                  >
                    €{fmtEur(cashTotal)}
                  </div>
                </div>
              </div>
              </div>
            </div>

            {/* ============ RIEPILOGO CASSA ============ */}
            <div>
              <h2 className="text-sm font-bold text-gray-800 uppercase text-center mb-0.5">Movimentazione finanziaria</h2>
              <div className="bg-white rounded p-1.5 relative" style={{ border: '2px solid #9ca3af' }}>
              <div className="absolute right-1.5 top-1.5 flex items-center gap-2 z-10">
                <button
                  type="button"
                  data-testid="toggle-force-mattina"
                  onClick={() => setForceMattina(v => !v)}
                  title={forceMattina ? 'Modifica forzata di CASH MATTINA attiva — clicca per bloccare' : 'Sblocca CASH MATTINA per forzare un valore manuale'}
                  className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase transition-colors ${
                    forceMattina
                      ? 'bg-amber-400 border-amber-500 text-amber-900 hover:bg-amber-500'
                      : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {forceMattina ? '🔓 mattina sbloccato' : '🔒 forza mattina'}
                </button>
              </div>
              <div className="flex items-stretch gap-1.5">
                {/* Tutti i campi tranne VERS: VERS viene renderizzato come ULTIMO box DOPO CASH SERA */}
                {CASH_FIELDS.filter(f => f.key !== 'vers').map(f => {
                  const computed = evaluateValue(cashRow[f.key]);
                  // Sign EFFETTIVO: tiene conto del valore digitato (un negativo su un campo +
                  // diventa "−" e viceversa). 'base' resta '=' per CASH MATTINA.
                  const effective = f.op === 'minus' ? -computed : computed;
                  const sign = f.op === 'base' ? '=' : (effective >= 0 ? '+' : '−');
                  const hasComment = !!cashComments[f.key];
                  const rawVal = cashRow[f.key] || '';
                  const isFormula = isFormulaExpr(rawVal);
                  const boxStyle = CASH_BOX_STYLE[f.key] || { bg: '#ffffff', text: '#111827' };
                  // CASH MATTINA è read-only se non sbloccato esplicitamente
                  const isReadOnly = f.readonly && !(f.key === 'mattina' && forceMattina);
                  return (
                    <div
                      key={f.key}
                      data-preview-cell={f.key}
                      className="flex-1 min-w-[60px] flex flex-col relative rounded p-1"
                      style={{ backgroundColor: boxStyle.bg }}
                    >
                      <label
                        className="text-[10px] font-semibold text-center leading-none mb-0.5 truncate uppercase"
                        title={f.label}
                        style={{ color: boxStyle.text }}
                      >
                        {f.label}
                      </label>
                      <input
                        data-testid={`cash-row-${f.key}`}
                        type="text"
                        inputMode="decimal"
                        value={(() => {
                          const isFocused = focusedField === f.key;
                          // Quando focused → mostro la formula/valore raw così l'utente edita
                          // Quando NON focused → mostro il risultato calcolato (valore assoluto, senza segno)
                          if (isFocused) return rawVal;
                          if (!rawVal) return '';
                          const abs = Math.abs(computed);
                          // Se intero, niente decimali. Altrimenti max 2 decimali stile italiano.
                          return Number.isInteger(abs)
                            ? String(abs)
                            : abs.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        })()}
                        onChange={(e) => { if (!isReadOnly) setCashRowValue(f.key, e.target.value); }}
                        onFocus={() => setFocusedField(f.key)}
                        onBlur={() => setFocusedField(curr => curr === f.key ? null : curr)}
                        onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                        placeholder={f.op === 'base' ? '€' : (f.op === 'minus' ? '−' : '+')}
                        readOnly={isReadOnly}
                        className={`w-full h-11 border rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518] border-gray-200 ${
                          isReadOnly ? 'bg-gray-100 text-gray-700 cursor-not-allowed'
                          : (f.key === 'mattina' && forceMattina ? 'bg-yellow-50 ring-2 ring-amber-400' : 'bg-white')
                        }`}
                        title={
                          isReadOnly
                            ? 'Auto-popolato da CASH SERA del giorno prima (clicca sul lucchetto per forzare)'
                            : isFormula
                              ? `Formula: ${rawVal} = ${computed.toLocaleString('it-IT', { maximumFractionDigits: 2 })}`
                              : (f.key === 'mattina' && forceMattina ? 'Modifica forzata attiva' : 'Clicca per modificare')
                        }
                      />
                      {hasComment && (
                        <span
                          title={cashComments[f.key]}
                          className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                        />
                      )}
                      {/* Riga di chiusura: caption del calcolo + pulsantino lente, entrambi centrati */}
                      <div className="flex items-center justify-center gap-1 mt-0.5 leading-none">
                        <span className="text-[9px] text-gray-500">
                          {computed !== 0 ? `${sign}€${Math.abs(effective).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u00A0'}
                        </span>
                        {f.key !== 'mattina' && (
                          <button
                            type="button"
                            data-testid={`preview-toggle-${f.key}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => setPreviewKey(curr => curr === f.key ? null : f.key)}
                            title="Mostra dettaglio in basso"
                            aria-label="Apri preview"
                            className={`w-3 h-3 flex-none flex items-center justify-center rounded-full transition-colors ${
                              previewKey === f.key
                                ? 'bg-amber-400 text-white ring-1 ring-amber-300'
                                : 'bg-white border border-gray-400 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            <svg width="7" height="7" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <circle cx="7" cy="7" r="4.5"/>
                              <path d="M10.5 10.5l3.5 3.5"/>
                            </svg>
                          </button>
                        )}
                      </div>
                      {commentPopover?.key === f.key && (
                        <CommentPopover
                          inputRef={commentInputRef}
                          value={commentPopover.value}
                          onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                          onSave={saveCommentPopover}
                          onCancel={closeCommentPopover}
                        />
                      )}
                    </div>
                  );
                })}
                {/* CASH SERA — totale */}
                <div className="flex-1 min-w-[70px] flex flex-col">
                  <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">CASH SERA</label>
                  <div
                    data-testid="cash-row-sera"
                    className="w-full h-11 bg-gray-900 text-[#F5C518] rounded flex items-center justify-center font-semibold text-sm"
                  >
                    €{cashSera.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                {/* VERS — ULTIMO box, DOPO CASH SERA (bianco, con palette colori) */}
                {(() => {
                  const f = CASH_FIELDS.find(x => x.key === 'vers');
                  if (!f) return null;
                  const computed = evaluateValue(cashRow[f.key]);
                  // VERS è sempre sottratto: effective = -computed (un negativo digitato diventa "+").
                  const effective = -computed;
                  const sign = effective >= 0 ? '+' : '−';
                  const hasComment = !!cashComments[f.key];
                  const rawVal = cashRow[f.key] || '';
                  // Strippa HTML per check vuoto / formula
                  const plainText = typeof rawVal === 'string' && rawVal.includes('<')
                    ? rawVal.replace(/<[^>]*>/g, '')
                    : rawVal;
                  const isEmpty = !plainText || !plainText.trim();
                  const boxStyle = CASH_BOX_STYLE.vers;
                  return (
                    <div
                      data-preview-cell={f.key}
                      className="flex-1 min-w-[60px] flex flex-col relative rounded p-1"
                      style={{ backgroundColor: boxStyle.bg }}
                    >
                      <label
                        className="text-[10px] font-semibold text-center leading-none mb-0.5 truncate uppercase"
                        title={f.label}
                        style={{ color: boxStyle.text }}
                      >
                        {f.label}
                      </label>
                      <div
                        ref={versEditorRef}
                        data-testid={`cash-row-${f.key}`}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={handleVersInput}
                        onFocus={() => setFocusedField(f.key)}
                        onBlur={() => setFocusedField(curr => curr === f.key ? null : curr)}
                        onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                        className="w-full h-11 border rounded px-1 text-center font-bold text-sm focus:outline-none focus:border-[#F5C518] border-gray-200 bg-white overflow-hidden whitespace-nowrap flex items-center justify-center"
                        title="Evidenzia il testo e clicca un colore della palette qui sotto per colorarlo"
                      />
                      {hasComment && (
                        <span
                          title={cashComments[f.key]}
                          className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                        />
                      )}
                      {/* Riga di chiusura: caption del calcolo + pulsantino lente */}
                      <div className="flex items-center justify-center gap-1 mt-0.5 leading-none">
                        <span className="text-[9px] text-gray-500">
                          {computed !== 0 ? `${sign}€${Math.abs(effective).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u00A0'}
                        </span>
                        <button
                          type="button"
                          data-testid={`preview-toggle-${f.key}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setPreviewKey(curr => curr === f.key ? null : f.key)}
                          title="Mostra dettaglio in basso"
                          aria-label="Apri preview"
                          className={`w-3 h-3 flex-none flex items-center justify-center rounded-full transition-colors ${
                            previewKey === f.key
                              ? 'bg-amber-400 text-white ring-1 ring-amber-300'
                              : 'bg-white border border-gray-400 text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          <svg width="7" height="7" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <circle cx="7" cy="7" r="4.5"/>
                            <path d="M10.5 10.5l3.5 3.5"/>
                          </svg>
                        </button>
                      </div>
                      {/* Palette colori — applica il colore SOLO alla selezione corrente dentro l'editor */}
                      {!isEmpty && (
                        <div className="flex items-center justify-center gap-0.5 mt-0.5">
                          {COLOR_PALETTE.map(c => (
                            <button
                              key={c.key}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyVersColor(c.css)}
                              title={`${c.label} (evidenzia il testo prima di cliccare)`}
                              className="w-3 h-3 rounded-full border hover:scale-110 transition-transform"
                              style={{ backgroundColor: c.css, borderColor: c.css === '#FFFFFF' ? '#9ca3af' : c.css }}
                            />
                          ))}
                        </div>
                      )}
                      {commentPopover?.key === f.key && (
                        <CommentPopover
                          inputRef={commentInputRef}
                          value={commentPopover.value}
                          onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                          onSave={saveCommentPopover}
                          onCancel={closeCommentPopover}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            </div>

            {/* ============ BLOCCO BEVANDE (titolo fuori + bordo arancione a L) ============ */}
            <div className="mt-1.5">
              <h2 className="text-sm font-bold text-gray-800 uppercase text-center mb-1.5">Bevande</h2>

            {/* ============ BLOCCO TOP BEVANDE — bordo arancione SENZA bottom (no linea sopra Vendite Bev), ::after disegna il "tetto" arancione SOLO sopra Spicci ============ */}
            <div
              className="p-2 space-y-2 relative after:content-[''] after:absolute after:bottom-[-2px] after:right-0 after:h-[2px] after:w-[calc(42%+10px)] after:bg-[#F5C518]"
              style={{
                border: '2px solid #F5C518',
                borderBottom: 0,
                borderTopLeftRadius: '0.25rem',
                borderTopRightRadius: '0.25rem',
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
              data-after-style="orange-roof"
            >

            {/* ============ MAGAZZINO MATTINA (casse + sfuse, in sync con Magazzino Bevande) ============ */}
            <div className="bg-white rounded p-1.5">
              <div className="relative flex items-center justify-center mb-1">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Magazzino Mattina</h2>
                <div className="absolute right-0 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="toggle-mag-mattina"
                    onClick={() => setShowMagMattina(v => !v)}
                    title={showMagMattina ? 'Nascondi Magazzino Mattina' : 'Mostra Magazzino Mattina'}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300"
                  >
                    {showMagMattina ? '▼ nascondi' : '▶ mostra'}
                  </button>
                  <button
                    type="button"
                    data-testid="force-mag-mattina-toggle"
                    onClick={() => setForceMagMattina(v => !v)}
                    title={forceMagMattina ? 'Modifica forzata di MAGAZZINO MATTINA attiva — clicca per bloccare' : 'Sblocca MAGAZZINO MATTINA per forzare valori manuali (normalmente auto-popolato dal Magazzino Sera della sera prima)'}
                    className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                      forceMagMattina
                        ? 'bg-rose-100 text-rose-700 border border-rose-300 hover:bg-rose-200'
                        : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                    }`}
                  >
                    {forceMagMattina ? '🔓 mattina sbloccato' : '🔒 forza mattina'}
                  </button>
                </div>
              </div>
              {showMagMattina && (
                beverages.length === 0 ? (
                <div className="h-11 flex items-center justify-center text-xs text-gray-400 italic">
                  Nessuna bevanda configurata.
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  {beverages.map(b => {
                    const row = bevCounts[b.sigla] || {};
                    const casseRaw = row.mattina_casse ?? '';
                    const sfuseRaw = row.mattina_sfuse ?? '';
                    const casseEmpty = casseRaw === '' || casseRaw === null || casseRaw === undefined;
                    const sfuseEmpty = sfuseRaw === '' || sfuseRaw === null || sfuseRaw === undefined;
                    const casseN = evaluateValue(casseRaw);
                    const sfuseN = evaluateValue(sfuseRaw);
                    const total = (casseEmpty && sfuseEmpty) ? null : (casseN * PEZZI_PER_CASSA + sfuseN);
                    const isFormulaCasse = isFormulaExpr(casseRaw);
                    const isFormulaSfuse = isFormulaExpr(sfuseRaw);
                    const locked = !forceMagMattina;
                    return (
                      <div
                        key={b.sigla}
                        data-testid={`mag-mattina-${b.sigla}`}
                        className="flex-1 min-w-[90px] flex flex-col"
                      >
                        <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>
                          {b.sigla}
                        </label>
                        <div className="flex gap-1">
                          {/* CASSE (× PEZZI_PER_CASSA) */}
                          <input
                            data-testid={`bev-mag-mattina-casse-${b.sigla}`}
                            type="text"
                            inputMode="decimal"
                            value={casseRaw}
                            onChange={(e) => handleCasseSfuseChange(b.sigla, 'mattina', 'casse', e.target.value)}
                            readOnly={locked}
                            tabIndex={locked ? -1 : 0}
                            title={isFormulaCasse ? `Formula casse: ${casseRaw} = ${casseN}` : 'Casse da 24'}
                            className={`w-1/2 h-9 rounded text-center font-semibold text-sm border focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                              locked
                                ? 'bg-gray-100 border-gray-200 text-gray-700 cursor-not-allowed'
                                : casseEmpty
                                  ? 'bg-gray-50 border-gray-200 text-gray-700'
                                  : 'bg-emerald-50 border-emerald-200 text-gray-900'
                            }`}
                          />
                          {/* SFUSE (×1) */}
                          <input
                            data-testid={`bev-mag-mattina-sfuse-${b.sigla}`}
                            type="text"
                            inputMode="decimal"
                            value={sfuseRaw}
                            onChange={(e) => handleCasseSfuseChange(b.sigla, 'mattina', 'sfuse', e.target.value)}
                            readOnly={locked}
                            tabIndex={locked ? -1 : 0}
                            title={isFormulaSfuse ? `Formula sfuse: ${sfuseRaw} = ${sfuseN}` : 'Unità sfuse'}
                            className={`w-1/2 h-9 rounded text-center font-semibold text-sm border focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                              locked
                                ? 'bg-gray-100 border-gray-200 text-gray-700 cursor-not-allowed'
                                : sfuseEmpty
                                  ? 'bg-gray-50 border-gray-200 text-gray-700'
                                  : 'bg-teal-50 border-teal-200 text-gray-900'
                            }`}
                          />
                        </div>
                        {/* Etichette sotto i quadratini: sinistra "casse", destra "unità" */}
                        <div className="flex gap-1 -mt-0.5">
                          <span className="w-1/2 text-[9px] text-gray-500 text-center leading-none">casse</span>
                          <span className="w-1/2 text-[9px] text-gray-500 text-center leading-none">unità</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
              )}
            </div>

            {/* ============ INGRESSI / USCITE + SCARTI (stessa riga) ============ */}
            <div className="flex items-stretch gap-2">
              <div className="bg-white rounded p-1 flex-1 min-w-0">
              <div className="flex items-baseline justify-center mb-0.5">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Ingressi / Uscite</h2>
              </div>
              {beverages.length === 0 ? (
                <div className="h-7 flex items-center justify-center text-xs text-gray-400 italic">
                  Nessuna bevanda configurata.
                </div>
              ) : (
                <div className="flex items-stretch gap-1 justify-center">
                  {beverages.map(b => {
                    const row = bevCounts[b.sigla] || {};
                    const casseRaw = row.inUsc_casse ?? '';
                    const casseEmpty = casseRaw === '' || casseRaw === null || casseRaw === undefined;
                    const casseN = evaluateValue(casseRaw);
                    const total = casseEmpty ? null : casseN * PEZZI_PER_CASSA;
                    const isFormulaCasse = isFormulaExpr(casseRaw);
                    const hasComment = !!((row.comments || {}).inUsc);
                    return (
                      <div
                        key={b.sigla}
                        data-testid={`ingressi-${b.sigla}`}
                        className="w-14 flex-none flex flex-col relative"
                      >
                        <label className="text-[9px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>
                          {b.sigla}
                        </label>
                        <input
                          data-testid={`bev-ingressi-${b.sigla}`}
                          type="text"
                          inputMode="decimal"
                          value={casseRaw}
                          onChange={(e) => handleInUscChange(b.sigla, e.target.value)}
                          onContextMenu={(e) => { e.preventDefault(); openCommentPopover(b.sigla, 'bev', 'inUsc'); }}
                          title={(hasComment ? `📝 ${(row.comments || {}).inUsc}\n\n` : '') + (isFormulaCasse ? `Formula casse: ${casseRaw} = ${casseN} casse → ${casseN * PEZZI_PER_CASSA} unità` : `Numero casse · ×${PEZZI_PER_CASSA}\n(destro per commento)`)}
                          className={`w-full h-7 rounded text-center font-semibold text-[11px] border focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                            casseEmpty
                              ? 'bg-gray-50 border-gray-200 text-gray-700'
                              : 'bg-indigo-50 border-indigo-200 text-gray-900'
                          }`}
                        />
                        {hasComment && (
                          <span
                            title={(row.comments || {}).inUsc}
                            className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                          />
                        )}
                        {commentPopover?.kind === 'bev' && commentPopover?.key === b.sigla && commentPopover?.subkey === 'inUsc' && (
                          <CommentPopover
                            inputRef={commentInputRef}
                            value={commentPopover.value}
                            onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                            onSave={saveCommentPopover}
                            onCancel={closeCommentPopover}
                          />
                        )}
                        <span className="text-[8px] text-gray-500 text-center leading-none mt-0.5 italic">casse</span>
                        <span
                          data-testid={`bev-ingressi-total-${b.sigla}`}
                          className="hidden"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              </div>

              {/* --- SCARTI --- */}
              <div className="bg-white rounded p-1 flex-1 min-w-0">
                <div className="relative flex items-center justify-center mb-0.5">
                  <h2 className="text-xs font-bold text-gray-800 uppercase">Scarti</h2>
                </div>
                {beverages.length === 0 ? (
                  <div className="h-7 flex items-center justify-center text-xs text-gray-400 italic">
                    Nessuna bevanda configurata.
                  </div>
                ) : (
                  <div className="flex items-stretch gap-1 justify-center">
                      {beverages.map(b => {
                        const row = bevCounts[b.sigla] || {};
                        const scRaw = row.scarti ?? '';
                        const scEmpty = scRaw === '' || scRaw === null || scRaw === undefined;
                        const scN = evaluateValue(scRaw);
                        const isFormulaSc = isFormulaExpr(scRaw);
                        const hasComment = !!((row.comments || {}).scarti);
                        return (
                          <div
                            key={b.sigla}
                            data-testid={`scarti-${b.sigla}`}
                            className="w-14 flex-none flex flex-col relative"
                          >
                            <label className="text-[9px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>{b.sigla}</label>
                            <input
                              data-testid={`bev-scarti-${b.sigla}`}
                              type="text"
                              inputMode="decimal"
                              value={scRaw}
                              onChange={(e) => handleScartiChange(b.sigla, e.target.value)}
                              onContextMenu={(e) => { e.preventDefault(); openCommentPopover(b.sigla, 'bev', 'scarti'); }}
                              title={(hasComment ? `📝 ${(row.comments || {}).scarti}\n\n` : '') + (isFormulaSc ? `Formula: ${scRaw} = ${scN}` : 'Unità scartate (singole)\n(destro per commento)')}
                              className={`w-full h-7 rounded text-center font-semibold text-[11px] border focus:outline-none focus:ring-2 focus:ring-rose-400 ${
                                scEmpty
                                  ? 'bg-gray-50 border-gray-200 text-gray-700'
                                  : 'bg-rose-50 border-rose-200 text-gray-900'
                              }`}
                            />
                            {hasComment && (
                              <span
                                title={(row.comments || {}).scarti}
                                className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                              />
                            )}
                            {commentPopover?.kind === 'bev' && commentPopover?.key === b.sigla && commentPopover?.subkey === 'scarti' && (
                              <CommentPopover
                                inputRef={commentInputRef}
                                value={commentPopover.value}
                                onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                                onSave={saveCommentPopover}
                                onCancel={closeCommentPopover}
                              />
                            )}
                            <span className="text-[8px] text-gray-500 text-center leading-none mt-0.5 italic">unità</span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>

            {/* ============ MAGAZZINO SERA (editabile, sync live con Magazzino Bevande) ============ */}
            <div
              className="bg-white rounded p-1.5"
            >
              <div className="flex items-baseline justify-center mb-1">
                <h2 className="text-xs font-bold text-gray-800 uppercase">Magazzino Sera</h2>
              </div>
              {beverages.length === 0 ? (
                <div className="h-11 flex items-center justify-center text-xs text-gray-400 italic">
                  Nessuna bevanda configurata.
                </div>
              ) : (
                <div className="flex items-stretch gap-2">
                  {beverages.map(b => {
                    const row = bevCounts[b.sigla] || {};
                    const casseRaw = row.sera_casse ?? '';
                    const sfuseRaw = row.sera_sfuse ?? '';
                    const isFocusedSera = focusedSeraSigla === b.sigla;
                    const casseEmpty = casseRaw === '' || casseRaw === null || casseRaw === undefined;
                    const sfuseEmpty = sfuseRaw === '' || sfuseRaw === null || sfuseRaw === undefined;
                    const casseN = evaluateValue(casseRaw);
                    const sfuseN = evaluateValue(sfuseRaw);
                    const total = (casseEmpty && sfuseEmpty) ? null : (casseN * PEZZI_PER_CASSA + sfuseN);
                    const isFormulaCasse = isFormulaExpr(casseRaw);
                    const isFormulaSfuse = isFormulaExpr(sfuseRaw);
                    return (
                      <div
                        key={b.sigla}
                        data-testid={`mag-sera-${b.sigla}`}
                        className="flex-1 min-w-[90px] flex flex-col"
                      >
                        <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>
                          {b.sigla}
                        </label>
                        <div className="flex gap-1">
                          {/* CASSE (× PEZZI_PER_CASSA) */}
                          <input
                            data-testid={`bev-mag-sera-casse-${b.sigla}`}
                            type="text"
                            inputMode="decimal"
                            value={casseRaw}
                            onChange={(e) => handleCasseSfuseChange(b.sigla, 'sera', 'casse', e.target.value)}
                            onFocus={() => setFocusedSeraSigla(b.sigla)}
                            onBlur={() => setFocusedSeraSigla(s => s === b.sigla ? null : s)}
                            title={isFormulaCasse ? `Formula casse: ${casseRaw} = ${casseN}` : 'Casse da 24'}
                            className={`w-1/2 h-9 rounded text-center font-semibold text-sm border focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                              casseEmpty
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : 'bg-amber-50 border-amber-200 text-gray-900'
                            }`}
                          />
                          {/* SFUSE (×1) */}
                          <input
                            data-testid={`bev-mag-sera-sfuse-${b.sigla}`}
                            type="text"
                            inputMode="decimal"
                            value={sfuseRaw}
                            onChange={(e) => handleCasseSfuseChange(b.sigla, 'sera', 'sfuse', e.target.value)}
                            onFocus={() => setFocusedSeraSigla(b.sigla)}
                            onBlur={() => setFocusedSeraSigla(s => s === b.sigla ? null : s)}
                            title={isFormulaSfuse ? `Formula sfuse: ${sfuseRaw} = ${sfuseN}` : 'Unità sfuse'}
                            className={`w-1/2 h-9 rounded text-center font-semibold text-sm border focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                              sfuseEmpty
                                ? 'bg-gray-50 border-gray-200 text-gray-700'
                                : 'bg-sky-50 border-sky-200 text-gray-900'
                            }`}
                          />
                        </div>
                        {/* Etichette sotto i quadratini: sinistra "casse", destra "unità" */}
                        <div className="flex gap-1 -mt-0.5">
                          <span className="w-1/2 text-[9px] text-gray-500 text-center leading-none">casse</span>
                          <span className="w-1/2 text-[9px] text-gray-500 text-center leading-none">unità</span>
                        </div>
                        <span
                          data-testid={`bev-mag-sera-total-${b.sigla}`}
                          className="hidden"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            </div>
            {/* ============ FINE BLOCCO TOP BEVANDE ============ */}

            {/* ============ VENDITE BEVANDE + SPICCI (stessa riga) — Spicci distanziato 8px sotto, si vede sia il "tetto" arancione che il bordo blu ============ */}
            <div className="flex items-stretch gap-2">
              {/* --- VENDITE BEVANDE (a sinistra, no bordo top, attaccato al top wrapper senza linea) --- */}
              <div
                className="bg-white p-1.5 flex-1 min-w-0"
                style={{
                  border: '2px solid #F5C518',
                  borderTop: 0,
                  borderTopLeftRadius: 0,
                  borderTopRightRadius: 0,
                  borderBottomLeftRadius: '0.25rem',
                  borderBottomRightRadius: '0.25rem',
                }}
              >
                <div className="flex items-baseline justify-center mb-1">
                  <h2 className="text-xs font-bold text-gray-800 uppercase">Vendite Bevande</h2>
                </div>
                {bevSales.length === 0 ? (
                  <div className="h-11 flex items-center justify-center text-xs text-gray-400 italic">
                    Nessuna bevanda configurata.
                  </div>
                ) : (
                  <div className="flex items-stretch gap-1.5">
                    {bevSales.map(b => (
                      <div
                        key={b.sigla}
                        data-testid={`bev-sales-${b.sigla}`}
                        className="flex-1 min-w-[60px] flex flex-col"
                      >
                        <label className="text-[10px] font-semibold text-gray-600 text-center leading-none mb-0.5 truncate" title={b.name}>
                          {b.sigla}
                        </label>
                        <div className="w-full h-11 bg-gray-50 border border-gray-200 rounded flex items-center justify-center font-semibold text-base text-gray-900">
                          {b.qty}
                        </div>
                        <span className="text-[8px] text-gray-500 text-center leading-none mt-0.5 italic">unità</span>
                      </div>
                    ))}
                    {/* Totale — solo importo € */}
                    <div className="flex-1 min-w-[70px] flex flex-col">
                      <label className="text-[10px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">Tot</label>
                      <div
                        data-testid="bev-sales-total-inc"
                        className="w-full h-11 bg-gray-50 border border-gray-200 rounded flex items-center justify-center font-semibold text-base text-gray-900"
                      >
                        €{bevTotalInc.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* --- SPICCI (rettangolo blu, distanziato 8px sotto il "tetto" arancione) --- */}
              <div className="bg-white rounded p-1.5 w-[42%] flex-shrink-0" style={{ border: '2px solid #2563eb', marginTop: '8px' }}>
                <div className="flex items-baseline justify-center mb-1">
                  <h2 className="text-xs font-bold text-gray-800 uppercase">Spicci</h2>
                </div>
                <div className="flex items-stretch gap-2">
                  {/* MOVIMENTI (era "Spicci") */}
                  <div className="flex-[5] min-w-0 rounded border border-gray-200 bg-gray-50 p-1">
                    <div className="flex items-baseline justify-between mb-0.5 px-0.5">
                      <h3 className="text-[10px] font-bold text-gray-700 uppercase">Rotolini aperti</h3>
                    </div>
                    <div className="flex items-stretch gap-1">
                      {spicciValues.rows.map(r => {
                        const hasComment = !!cashComments[r.key];
                        return (
                        <div key={r.key} className="flex-1 min-w-[34px] flex flex-col relative">
                          <label className="text-[9px] font-bold text-gray-800 text-center leading-none mb-0.5">
                            {r.label}
                          </label>
                          <input
                            data-testid={`spicci-aperti-${r.key}`}
                            type="text"
                            inputMode="decimal"
                            value={cashRow[r.key] || ''}
                            onChange={(e) => setCashRowValue(r.key, e.target.value)}
                            onContextMenu={(e) => { e.preventDefault(); openCommentPopover(r.key); }}
                            placeholder=""
                            className="w-full h-7 border border-gray-200 rounded px-0.5 text-center font-bold text-[11px] focus:outline-none focus:border-[#F5C518] bg-white"
                          />
                          {hasComment && (
                            <span
                              title={cashComments[r.key]}
                              className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                            />
                          )}
                          <div
                            data-testid={`spicci-valore-${r.key}`}
                            className="w-full h-7 mt-0.5 bg-yellow-50 border border-yellow-200 rounded flex items-center justify-center font-semibold text-[11px] text-gray-900"
                          >
                            €{r.value.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </div>
                          {commentPopover?.key === r.key && (
                            <CommentPopover
                              inputRef={commentInputRef}
                              value={commentPopover.value}
                              onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                              onSave={saveCommentPopover}
                              onCancel={closeCommentPopover}
                            />
                          )}
                        </div>
                        );
                      })}
                      {/* Totale movimenti */}
                      <div className="flex-1 min-w-[40px] flex flex-col">
                        <label className="text-[9px] font-bold text-gray-800 text-center uppercase leading-none mb-0.5">TOT</label>
                        <div className="w-full h-7 border border-transparent rounded flex items-center justify-center text-[9px] text-gray-400 italic">
                          —
                        </div>
                        <div
                          data-testid="spicci-totale"
                          className="w-full h-7 mt-0.5 bg-white border border-gray-200 rounded flex items-center justify-center font-semibold text-[11px] text-gray-900"
                        >
                          €{spicciValues.total.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CASSETTO (stock totale, click-to-edit) */}
                  <div className="flex-[4] min-w-0 rounded border border-gray-200 bg-gray-50 p-1">
                    <div className="flex items-baseline justify-between mb-0.5 px-0.5">
                      <h3 className="text-[10px] font-bold text-gray-700 uppercase">Rotolini nel cassetto</h3>
                    </div>
                    <div className="flex items-stretch gap-1">
                      {CASSETTO_FIELDS.map(f => {
                        const isEditing = editingCassetto === f.key;
                        const hasComment = !!cashComments[f.key];
                        const raw = cashRow[f.key];
                        let displayValue = '—';
                        let isNegative = false;
                        if (raw !== '' && raw !== undefined && raw !== null) {
                          const base = evaluateValue(raw);
                          const aperti = evaluateValue(cashRow[f.spicciKey]);
                          const residuo = base - aperti;
                          isNegative = residuo < 0;
                          displayValue = Number.isInteger(residuo)
                            ? String(residuo)
                            : residuo.toLocaleString('it-IT', { maximumFractionDigits: 2 });
                        }
                        return (
                          <div key={f.key} className="flex-1 min-w-[34px] flex flex-col relative">
                            <label className="text-[9px] font-bold text-gray-800 text-center leading-none mb-0.5">
                              {f.label}
                            </label>
                            {isEditing ? (
                              <input
                                ref={editingInputRef}
                                data-testid={`cassetto-input-${f.key}`}
                                type="text"
                                inputMode="decimal"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={() => { commitEditCassetto(f); }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); commitEditCassetto(f); }
                                  else if (e.key === 'Escape') { e.preventDefault(); cancelEditCassetto(); }
                                }}
                                onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                                placeholder="stock"
                                className="w-full h-7 border-2 border-[#F5C518] rounded px-0.5 text-center font-bold text-[11px] focus:outline-none bg-yellow-50"
                              />
                            ) : (
                              <button
                                type="button"
                                data-testid={`cassetto-display-${f.key}`}
                                onClick={() => startEditCassetto(f)}
                                onContextMenu={(e) => { e.preventDefault(); openCommentPopover(f.key); }}
                                title={isAdmin ? "Clicca per modificare · destro per commento" : "Solo lettura · destro per commento"}
                                className={`w-full h-7 border rounded px-0.5 text-center font-semibold text-[11px] transition-colors ${
                                  isAdmin ? 'cursor-pointer' : 'cursor-not-allowed'
                                } ${
                                  isNegative
                                    ? 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                                    : isAdmin
                                      ? 'bg-white border-gray-200 text-gray-900 hover:bg-yellow-50 hover:border-yellow-300'
                                      : 'bg-white border-gray-200 text-gray-700'
                                }`}
                              >
                                {displayValue}
                              </button>
                            )}
                            {hasComment && (
                              <span
                                title={cashComments[f.key]}
                                className="absolute top-3 right-0 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-amber-600 z-10"
                              />
                            )}
                            {commentPopover?.key === f.key && (
                              <CommentPopover
                                inputRef={commentInputRef}
                                value={commentPopover.value}
                                onChange={(v) => setCommentPopover(p => ({ ...p, value: v }))}
                                onSave={saveCommentPopover}
                                onCancel={closeCommentPopover}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* ============ FINE BLOCCO BEVANDE (L arancione) ============ */}
            </div>

            {/* Collegamenti rapidi sotto Spicci/Cassetto — discreti, non invadenti */}
            <div className="flex justify-end gap-2 mt-1">
              {((effectiveRestaurant?.location || restaurant?.location) === 'Flaminio') && (
                <button
                  type="button"
                  data-testid="report-quicklink-magazzino-bevande"
                  onClick={() => navigate('/magazzino-bevande')}
                  className="text-[11px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-2.5 py-1 rounded border border-gray-300 bg-white transition-colors"
                  title="Apri Magazzino Bevande"
                >
                  Magazzino Bevande →
                </button>
              )}
              <button
                type="button"
                data-testid="report-quicklink-report-ieri"
                onClick={() => navigate('/report-ieri')}
                className="text-[11px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-2.5 py-1 rounded border border-gray-300 bg-white transition-colors"
                title="Apri Report di ieri"
              >
                Report di ieri →
              </button>
            </div>
          </section>
        </div>

      </main>

      {/* ============ BARRA PREVIEW (in basso, fixed) ============ */}
      <div
        data-testid="preview-bar"
        className={`fixed bottom-0 left-0 right-0 z-40 transition-transform duration-200 ${
          previewInfo ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {previewInfo && (
          <div className="bg-gray-900 text-white border-t-4 border-[#F5C518] shadow-2xl px-4 py-3">
            <div className="max-w-[1600px] mx-auto flex items-center gap-4">
              <div className="flex-shrink-0">
                <div className="text-[10px] uppercase tracking-widest text-gray-400">Selezionato</div>
                <div className="text-base font-bold text-[#F5C518] truncate" style={{ maxWidth: 200 }}>
                  {previewInfo.label}
                </div>
              </div>
              <div className="flex-1 min-w-0 flex items-center justify-center bg-gray-800 rounded px-4 py-2 border border-gray-700">
                <span className="text-3xl font-semibold font-mono text-white tracking-wide truncate">
                  {previewInfo.raw || <em className="text-gray-500 italic text-xl">vuoto</em>}
                </span>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-widest text-gray-400">Risultato</div>
                <div className="text-xl font-semibold text-emerald-400">{previewInfo.formatted}</div>
              </div>
              {previewInfo.comment && (
                <div className="flex-shrink-0 bg-amber-100 text-amber-900 border border-amber-400 rounded px-2 py-1 max-w-xs">
                  <div className="text-[9px] uppercase font-bold text-amber-700">Commento</div>
                  <div className="text-xs">{previewInfo.comment}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Wrapper con password gate "0123" (sblocco condiviso con Magazzino Bevande nella stessa sessione).
// In MODALITÀ STORICA (?date=...&rid=...) l'Admin bypassa la password.
const ReportBetaPage = () => {
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const isHistorical = !!(searchParams.get('date') && searchParams.get('rid') && isAdmin);
  if (isHistorical) return <ReportBetaPageInner />;
  return (
    <PasswordGate
      password="0123"
      storageKey="flaminio-section-unlocked"
      title="Report Cassa"
      subtitle="Inserisci la password per accedere"
    >
      <ReportBetaPageInner />
    </PasswordGate>
  );
};

export default ReportBetaPage;
