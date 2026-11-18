import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Edit2, Trash2, Check, Loader2, AlertCircle, Printer, Settings2, X } from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const parseRoutingSiglas = (value) => Array.from(new Set(
  String(value || '')
    .split(/[\s,;]+/)
    .map(sigla => sigla.trim().toUpperCase())
    .filter(Boolean)
));

const RoutingTagEditor = ({ testId, tags, setTags, placeholder, tone = 'gray' }) => {
  const [draft, setDraft] = useState('');
  const isBlue = tone === 'blue';

  const addDraft = () => {
    const newTags = parseRoutingSiglas(draft);
    if (newTags.length === 0) return;
    setTags(current => Array.from(new Set([...current, ...newTags])));
    setDraft('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      setTags(current => current.slice(0, -1));
    }
  };

  return (
    <div
      className={`min-h-44 rounded-md border bg-white p-2 focus-within:ring-2 ${isBlue ? 'border-blue-300 focus-within:border-blue-600 focus-within:ring-blue-200' : 'border-gray-300 focus-within:border-gray-600 focus-within:ring-gray-200'}`}
      onClick={event => event.currentTarget.querySelector('input')?.focus()}
    >
      <div className="flex flex-wrap items-center gap-2">
        {tags.map(sigla => (
          <span
            key={sigla}
            className={`inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1 text-sm font-bold ${isBlue ? 'bg-blue-700 text-white' : 'border border-gray-300 bg-gray-100 text-gray-900'}`}
          >
            {sigla}
            <button
              type="button"
              data-testid={`${testId}-remove-${sigla}`}
              aria-label={`Elimina ${sigla}`}
              onClick={event => {
                event.stopPropagation();
                setTags(current => current.filter(item => item !== sigla));
              }}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${isBlue ? 'hover:bg-blue-900' : 'hover:bg-gray-300'}`}
            >
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          data-testid={`${testId}-input`}
          value={draft}
          onChange={event => setDraft(event.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          onBlur={addDraft}
          placeholder={tags.length === 0 ? placeholder : 'Aggiungi…'}
          autoComplete="off"
          spellCheck="false"
          className="min-w-32 flex-1 border-0 bg-transparent px-2 py-2 font-mono text-base font-bold uppercase text-gray-900 outline-none"
        />
      </div>
    </div>
  );
};

const getTimerSeconds = (order) => {
  if (!order.timer_started) return -1;
  if (order.timer_paused) return order.timer_elapsed || 0;
  const start = new Date(order.timer_start_time);
  const now = new Date();
  return Math.floor((now - start) / 1000) + (order.timer_elapsed || 0);
};

const getTimerColor = (order) => {
  if (order.hidden_generale) return 'text-blue-600';
  const secs = getTimerSeconds(order);
  if (secs < 0) return 'text-gray-400';
  if (secs >= 240) return 'text-gray-400';
  if (secs >= 180) return 'text-red-600';
  return 'text-green-600';
};

const CassaPage = () => {
  const { restaurant, effectiveRestaurant, canImpersonate, token } = useAuth();
  const { orders, createOrder, deleteOrder, completeOrder, updateOrder } = useOrders();
  const [orderNumber, setOrderNumber] = useState('');
  const [userEditedNumber, setUserEditedNumber] = useState(false);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [logs, setLogs] = useState({ deletions: { count: 0, logs: [] }, modifications: { count: 0, logs: [] } });
  const [showLogs, setShowLogs] = useState(false);
  const [selectedForPrint, setSelectedForPrint] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [printData, setPrintData] = useState(null); // {orario, rows: [{number, description}]}
  const inputRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [routingConfig, setRoutingConfig] = useState({ enabled: false, boiler2_siglas: [], standard_siglas: [] });
  const [boiler2RoutingSiglas, setBoiler2RoutingSiglas] = useState([]);
  const [standardRoutingSiglas, setStandardRoutingSiglas] = useState([]);
  const [showRoutingSettings, setShowRoutingSettings] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingError, setRoutingError] = useState('');
  const activeRestaurant = canImpersonate ? effectiveRestaurant : restaurant;
  const hasTwoBoilers = Number(activeRestaurant?.boiler_count ?? 1) >= 2;

  // Tick every second for live timer colors
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Stop drag selection on pointer up
  useEffect(() => {
    const stopDrag = () => setIsDragging(false);
    window.addEventListener('pointerup', stopDrag);
    return () => window.removeEventListener('pointerup', stopDrag);
  }, []);

  // Fetch today's logs
  const fetchLogs = async () => {
    if (!token) return;
    try {
      const response = await axios.get(`${API}/logs/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLogs(response.data);
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  // Fetch logs on mount and after operations
  useEffect(() => {
    fetchLogs();
  }, [token]);

  const fetchRoutingConfig = async () => {
    if (!token || !hasTwoBoilers) return null;
    try {
      const response = await axios.get(`${API}/kitchen-routing`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRoutingConfig(response.data);
      setRoutingError('');
      return response.data;
    } catch (error) {
      console.error('Error fetching kitchen routing:', error);
      setRoutingError('Impossibile leggere le divisioni');
      return null;
    }
  };

  // Keep the status aligned across multiple Cassa devices. Routing itself is
  // applied by the backend, so even an UI that has not polled yet still sends
  // every new order to the correct bollitore.
  useEffect(() => {
    if (!token || !hasTwoBoilers) return undefined;
    fetchRoutingConfig();
    const interval = setInterval(fetchRoutingConfig, 10000);
    return () => clearInterval(interval);
  }, [token, hasTwoBoilers]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDivisions = async () => {
    if (routingBusy) return;
    setRoutingBusy(true);
    setRoutingError('');
    try {
      const response = await axios.put(`${API}/kitchen-routing`, {
        enabled: !routingConfig.enabled,
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRoutingConfig(response.data);
    } catch (error) {
      console.error('Error toggling kitchen routing:', error);
      setRoutingError('Divisioni non aggiornate. Riprova.');
    } finally {
      setRoutingBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const openRoutingSettings = async () => {
    setShowRoutingSettings(true);
    setRoutingBusy(true);
    setRoutingError('');
    try {
      const [configResponse, dictionaryResponse] = await Promise.all([
        axios.get(`${API}/kitchen-routing`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/pasta-dictionary`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
      ]);
      const config = configResponse.data;
      const dictionarySiglas = (dictionaryResponse.data?.siglas || [])
        .map(item => String(item.sigla || '').trim().toUpperCase())
        .filter(Boolean);
      const selected = config.boiler2_siglas || [];
      const standard = config.standard_siglas_configured
        ? (config.standard_siglas || [])
        : dictionarySiglas.filter(sigla => !selected.includes(sigla));
      setRoutingConfig(config);
      setBoiler2RoutingSiglas(selected);
      setStandardRoutingSiglas(standard);
    } catch (error) {
      console.error('Error opening kitchen routing settings:', error);
      setRoutingError('Impossibile caricare le paste. Riprova.');
    } finally {
      setRoutingBusy(false);
    }
  };

  const saveRoutingSiglas = async () => {
    if (routingBusy) return;
    setRoutingError('');
    const boiler2Siglas = boiler2RoutingSiglas;
    const standardSiglas = standardRoutingSiglas;
    const standardSet = new Set(standardSiglas);
    const duplicates = boiler2Siglas.filter(sigla => standardSet.has(sigla));
    if (duplicates.length > 0) {
      setRoutingError(`Queste paste sono presenti in entrambi i bollitori: ${duplicates.join(', ')}`);
      return;
    }
    setRoutingBusy(true);
    try {
      const response = await axios.put(`${API}/kitchen-routing`, {
        boiler2_siglas: boiler2Siglas,
        standard_siglas: standardSiglas,
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRoutingConfig(response.data);
      setShowRoutingSettings(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (error) {
      console.error('Error saving kitchen routing settings:', error);
      setRoutingError(error.response?.data?.detail || 'Divisioni non salvate. Riprova.');
    } finally {
      setRoutingBusy(false);
    }
  };

  // Calculate next order number based on existing orders.
  // Pending list can shrink (orders move to completed/archived), so it's only
  // a fallback. Authoritative value is fetched from /api/orders/next-number.
  const getNextOrderNumber = () => {
    if (orders.length === 0) return 1;
    const maxNumber = Math.max(...orders.map(o => o.order_number));
    return maxNumber + 1;
  };

  // Fetch authoritative next number from server (counter-based)
  const fetchNextOrderNumber = async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/orders/next-number`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const serverNext = res.data?.next_number;
      if (typeof serverNext === 'number' && !userEditedNumber) {
        setOrderNumber(String(serverNext));
      }
    } catch (e) {
      console.error('Error fetching next number:', e);
    }
  };

  // When the orders list changes (create/delete/complete), reconcile the
  // input with the server's authoritative counter. We do NOT update from the
  // local `pending` list because it can shrink (e.g. on delete) and would
  // briefly show a stale lower number, causing a visual flicker.
  useEffect(() => {
    if (!userEditedNumber) {
      fetchNextOrderNumber();
    }
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    
    setLoading(true);
    try {
      const created = await createOrder(description.trim(), parseInt(orderNumber) || getNextOrderNumber());
      setDescription('');
      setUserEditedNumber(false);
      // Use the actual assigned number from the server response (it may differ
      // from the requested one if the cashier left auto and counter advanced).
      if (created?.order_number) {
        setOrderNumber(String(created.order_number + 1));
      }
      // Focus input after a short delay to ensure DOM is updated
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error('Error creating order:', error);
      if (error?.response?.status === 409) {
        const detail = error?.response?.data?.detail || `Numero #${orderNumber} già in uso`;
        // Use native alert: minimal, blocking, works on any tablet without a toast lib
        window.alert(`${detail}.\nScegli un numero diverso o lascia vuoto per usare il prossimo automatico.`);
      } else {
        window.alert('Errore nel creare la pasta. Riprova.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (orderId) => {
    try {
      await deleteOrder(orderId);
      setTimeout(fetchLogs, 500);
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  };

  const handlePrint = (order) => {
    setSelectedForPrint(prev => {
      const next = new Set(prev);
      if (next.has(order.id)) {
        next.delete(order.id);
      } else {
        next.add(order.id);
      }
      return next;
    });
  };

  const handlePrintSelected = () => {
    const toPrint = pendingOrders.filter(o => selectedForPrint.has(o.id));
    if (toPrint.length === 0) return;

    const now = new Date();
    const orario = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const rows = toPrint.map(o => ({
      number: String(o.order_number).slice(-2).padStart(2, '0'),
      description: o.description,
    }));

    // Render the print-only area inside the main document, then call window.print()
    // from the top-level — this is required for Chrome's --kiosk-printing flag to
    // suppress the print dialog (it does NOT apply to iframe.contentWindow.print()).
    setPrintData({ orario, rows });
    setSelectedForPrint(new Set());

    // Wait for React to paint the print area, then trigger top-level print
    setTimeout(() => {
      window.focus();
      window.print();
      // Clean up after print dialog closes (or immediately in kiosk mode)
      setTimeout(() => setPrintData(null), 500);
    }, 50);
  };

  const handleComplete = async (orderId) => {
    try {
      await completeOrder(orderId);
    } catch (error) {
      console.error('Error completing order:', error);
    }
  };

  const handleEdit = (order) => {
    setEditingId(order.id);
    setEditValue(`${order.order_number} ${order.description}`);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const handleSaveEdit = async (orderId) => {
    if (!editValue.trim()) {
      handleCancelEdit();
      return;
    }
    try {
      const trimmed = editValue.trim();
      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (match) {
        const newNumber = parseInt(match[1]);
        const newDescription = match[2];
        await updateOrder(orderId, { order_number: newNumber, description: newDescription });
      } else {
        await updateOrder(orderId, { description: trimmed });
      }
      setEditingId(null);
      setEditValue('');
      // Refresh logs after modification
      setTimeout(fetchLogs, 500);
      // Return focus to the "send next pasta" input so cashier can keep typing
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (error) {
      console.error('Error updating order:', error);
      const detail = error.response?.data?.detail;
      if (error.response?.status === 400 && detail) {
        // Surface the conflict (e.g. duplicate order_number) clearly
        // and KEEP edit mode active so cashier can fix the number.
        window.alert(detail);
      } else {
        window.alert('Errore nel modificare la pasta. Riprova.');
      }
    }
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getTimerDisplay = (order) => {
    if (!order.timer_started) return '--:--:--';
    
    // Frozen timer when hidden from generale
    if (order.hidden_generale) {
      const seconds = order.hidden_generale_timer || 0;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    
    if (order.timer_paused) {
      const seconds = order.timer_elapsed || 0;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    
    const start = new Date(order.timer_start_time);
    const now = new Date();
    const diff = Math.floor((now - start) / 1000) + (order.timer_elapsed || 0);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Check if description is uppercase (for table grouping)
  const isUppercase = (text) => {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return false;
    return letters === letters.toUpperCase();
  };

  // Filter pending orders
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const completedOrders = orders.filter(o => o.status === 'completed');

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Print-only styles: hide the entire React app during print; the print-area
          is rendered as a direct child of <body> via a React portal so that
          `body > *` selector can hide everything except the print area. */}
      <style>{`
        @media print {
          @page { margin: 5mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body > *:not(#cassa-print-area) { display: none !important; }
          #cassa-print-area { display: block !important; }
        }
        #cassa-print-area { display: none; }
        @media print { #cassa-print-area { display: block; } }
      `}</style>

      {/* Portal: render print area directly under <body> to avoid the React app layout
          affecting the print scale */}
      {printData && createPortal(
        <div id="cassa-print-area">
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '14px', marginBottom: '4px' }}>
            {printData.orario}
          </div>
          <table style={{ borderCollapse: 'collapse', fontFamily: 'Arial, sans-serif' }}>
            <tbody>
              {printData.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontSize: '18px', fontWeight: 'bold', padding: '2px 12px 2px 0' }}>{r.number}</td>
                  <td style={{ fontSize: '18px', fontWeight: 'bold', padding: '2px 0' }}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
        document.body,
      )}

      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Cassa</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="cassa-location">
            {restaurant?.location}
          </p>
        </div>

        {hasTwoBoilers && (
          <aside
            className={`fixed top-1/2 -translate-y-1/2 right-0 z-30 overflow-hidden rounded-l-lg border border-r-0 shadow-lg ${routingConfig.enabled ? 'border-green-700 bg-green-600' : 'border-gray-700 bg-gray-700'}`}
            data-testid="divisioni-panel"
          >
            <button
              type="button"
              data-testid="divisioni-toggle"
              aria-pressed={routingConfig.enabled}
              disabled={routingBusy}
              onClick={toggleDivisions}
              title={routingConfig.enabled
                ? `Divisioni attive · Bollitore 2: ${(routingConfig.boiler2_siglas || []).join(', ') || 'nessuna pasta'}`
                : 'Divisioni spente · tutte le paste al bollitore standard'}
              className={`w-11 py-3 flex flex-col items-center gap-2 text-white transition-colors disabled:opacity-50 ${routingConfig.enabled ? 'hover:bg-green-700' : 'hover:bg-gray-800'}`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${routingConfig.enabled ? 'bg-white' : 'bg-gray-400'}`} />
              <span className="text-[11px] font-bold uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">
                Divisioni
              </span>
              <span className="text-[9px] font-bold uppercase [writing-mode:vertical-rl] rotate-180 opacity-90">
                {routingConfig.enabled ? 'ATTIVE' : 'SPENTE'}
              </span>
            </button>
            <button
              type="button"
              data-testid="divisioni-configura"
              onClick={openRoutingSettings}
              disabled={routingBusy}
              title="Imposta quali paste vanno nei due bollitori"
              aria-label="Imposta paste delle divisioni"
              className="w-11 h-11 inline-flex items-center justify-center border-t border-white/25 bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
            >
              <Settings2 size={18} />
            </button>
          </aside>
        )}

        {routingError && !showRoutingSettings && (
          <div className="fixed top-20 right-4 z-50 max-w-xs rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-lg">
            {routingError}
          </div>
        )}

        {showRoutingSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" data-testid="divisioni-modal">
            <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl border border-gray-200">
              <div className="sticky top-0 bg-white px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-2xl font-bold text-gray-900 uppercase">Divisioni bollitori</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Scrivi, aggiungi o elimina liberamente le sigle. La modifica vale per le prossime paste inviate.
                  </p>
                </div>
                <button
                  type="button"
                  title="Chiudi"
                  onClick={() => setShowRoutingSettings(false)}
                  className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-md border border-gray-300 hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                <div className="rounded-lg border-2 border-gray-300 bg-gray-50 p-4">
                  <h3 className="font-bold text-gray-900">Bollitore standard</h3>
                  <p className="text-xs text-gray-600 mt-1 mb-3">Puoi tenere qui l'elenco di riferimento delle paste standard.</p>
                  <RoutingTagEditor
                    testId="divisioni-standard"
                    tags={standardRoutingSiglas}
                    setTags={setStandardRoutingSiglas}
                    placeholder="CACIO, RAGU, ..."
                  />
                  <p className="mt-2 text-xs text-gray-600">
                    {standardRoutingSiglas.length} sigle · quelle non presenti in nessun box vanno comunque qui.
                  </p>
                </div>

                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                  <h3 className="font-bold text-blue-900">Bollitore 2 · sinistra</h3>
                  <p className="text-xs text-blue-700 mt-1 mb-3">Ricevono automaticamente il trattino finale.</p>
                  <RoutingTagEditor
                    testId="divisioni-bollitore2"
                    tags={boiler2RoutingSiglas}
                    setTags={setBoiler2RoutingSiglas}
                    placeholder="CARB, PESTO, POM, AMAT"
                    tone="blue"
                  />
                  <p className="mt-2 text-xs text-blue-700">
                    {boiler2RoutingSiglas.length} sigle · scrivi una sigla e premi Invio. Premi × per eliminarla.
                  </p>
                </div>
              </div>

              {routingError && <p className="px-5 pb-2 text-sm font-semibold text-red-600">{routingError}</p>}
              <div className="px-5 py-4 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500">La modalità si spegne automaticamente al cambio del giorno.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRoutingSettings(false)}
                    className="h-10 px-4 rounded-md border border-gray-300 bg-white hover:bg-gray-50 font-semibold"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    data-testid="divisioni-salva"
                    onClick={saveRoutingSiglas}
                    disabled={routingBusy}
                    className="h-10 px-5 rounded-md bg-blue-700 hover:bg-blue-800 text-white font-bold disabled:opacity-50"
                  >
                    {routingBusy ? 'Salvataggio…' : 'Salva divisioni'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating side-tab trigger for LOGS (fixed on LEFT edge, always visible) */}
        <button
          onClick={() => setShowLogs(!showLogs)}
          data-testid="logs-counter-bar"
          title="Dettagli log giornata"
          className="fixed top-1/2 -translate-y-1/2 left-0 z-30 bg-white hover:bg-gray-50 border border-l-0 border-gray-300 rounded-r-lg shadow-md px-2 py-3 flex flex-col items-center gap-2 text-xs"
        >
          <div className="flex items-center gap-1 text-red-600 font-bold">
            <Trash2 size={14} />
            <span>{logs.deletions.count}</span>
          </div>
          <div className="h-px w-5 bg-gray-200" />
          <div className="flex items-center gap-1 text-amber-600 font-bold">
            <Edit2 size={14} />
            <span>{logs.modifications.count}</span>
          </div>
          <div className="text-[9px] text-gray-500 mt-1 [writing-mode:vertical-rl] rotate-180 tracking-wide">LOG</div>
        </button>

        {/* Logs Detail Drawer (side panel, doesn't shift pasta list) */}
        {showLogs && (
          <>
            {/* Backdrop (click to close) */}
            <div
              className="fixed inset-0 bg-black/30 z-40"
              onClick={() => setShowLogs(false)}
              data-testid="logs-backdrop"
            />
            {/* Side drawer */}
            <aside
              className="fixed top-0 left-0 h-full w-full max-w-md bg-white shadow-2xl border-r border-gray-200 z-50 flex flex-col"
              data-testid="logs-side-drawer"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h2 className="font-heading text-lg font-bold text-gray-900 uppercase">Dettagli log</h2>
                <button
                  onClick={() => setShowLogs(false)}
                  className="w-8 h-8 flex items-center justify-center bg-white hover:bg-gray-100 border border-gray-300 rounded-md text-gray-700"
                  title="Chiudi"
                  data-testid="logs-close-btn"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Deletions */}
                <div>
                  <h3 className="font-bold text-red-600 mb-2 flex items-center gap-2">
                    <Trash2 size={16} /> Cancellazioni ({logs.deletions.count})
                  </h3>
                  {logs.deletions.logs.length === 0 ? (
                    <p className="text-gray-500 text-sm">Nessuna cancellazione oggi</p>
                  ) : (
                    <ul className="space-y-1">
                      {logs.deletions.logs.map((log) => (
                        <li key={log.id} className="text-sm bg-red-50 p-2 rounded">
                          <span className="font-bold">#{log.order_number}</span> - {log.description}
                          <br />
                          <span className="text-gray-500">Cancellato: {formatTime(log.deleted_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Modifications */}
                <div>
                  <h3 className="font-bold text-amber-600 mb-2 flex items-center gap-2">
                    <Edit2 size={16} /> Modifiche ({logs.modifications.count})
                  </h3>
                  {logs.modifications.logs.length === 0 ? (
                    <p className="text-gray-500 text-sm">Nessuna modifica oggi</p>
                  ) : (
                    <ul className="space-y-1">
                      {logs.modifications.logs.map((log) => (
                        <li key={log.id} className="text-sm bg-amber-50 p-2 rounded">
                          <span className="font-bold">#{log.order_number}</span>: {log.old_description} → {log.new_description}
                          <br />
                          <span className="text-gray-500">Modificato: {formatTime(log.modified_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </aside>
          </>
        )}

        {/* Input Section */}
        <form onSubmit={handleSubmit} className="mb-4">
          <div className="flex items-center gap-2 bg-white p-1.5 rounded-lg shadow-sm border border-gray-200">
            {/* Editable Order Number */}
            <input
              data-testid="order-number-input"
              type="text"
              value={orderNumber}
              onChange={(e) => {
                setOrderNumber(e.target.value.replace(/\D/g, ''));
                setUserEditedNumber(true);
              }}
              className="w-20 h-10 text-lg font-bold text-center px-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              placeholder="N°"
            />
            
            {/* Description Input */}
            <input
              ref={inputRef}
              data-testid="order-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex-1 h-10 text-lg px-4 border-0 focus:ring-0 focus:outline-none"
              placeholder=""
              disabled={loading}
            />
            <button
              data-testid="order-submit"
              type="submit"
              disabled={loading || !description.trim()}
              className="action-button h-10 px-6 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : 'Invia'}
            </button>
          </div>
        </form>

        {/* Orders List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Pending Orders */}
          {pendingOrders.map((order) => (
            <div
              key={order.id}
              data-testid={`order-row-${order.order_number}`}
              className="flex items-center px-4 py-1.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <span className="w-16 font-bold text-gray-800 text-lg">{order.order_number}</span>
              
              {editingId === order.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    data-testid={`edit-input-${order.order_number}`}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(order.id);
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className="flex-1 h-8 px-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    data-testid={`save-edit-${order.order_number}`}
                    onClick={() => handleSaveEdit(order.id)}
                    className="w-8 h-8 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    data-testid={`cancel-edit-${order.order_number}`}
                    onClick={handleCancelEdit}
                    className="w-8 h-8 flex items-center justify-center bg-gray-400 hover:bg-gray-500 text-white rounded transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <span className={`flex-1 text-lg text-gray-800 ${isUppercase(order.description) ? 'font-bold' : 'font-medium'}`}>
                  {order.description}
                </span>
              )}
              
              <span className="w-24 text-gray-600 text-lg">{formatTime(order.created_at)}</span>
              
              <span 
                className={`w-24 text-lg font-mono font-bold ${getTimerColor(order)}`}
              >
                {getTimerDisplay(order)}
              </span>
              
              <div className="flex gap-2 ml-4">
                <button
                  data-testid={`edit-btn-${order.order_number}`}
                  onClick={(e) => { e.stopPropagation(); handleEdit(order); }}
                  className="w-8 h-8 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  data-testid={`delete-btn-${order.order_number}`}
                  onClick={(e) => { e.stopPropagation(); handleDelete(order.id); }}
                  className="w-8 h-8 flex items-center justify-center text-white rounded transition-colors bg-red-500 hover:bg-red-600"
                  title="Cancella"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {/* Completed Orders (shown in different color) */}
          {completedOrders.slice(0, 5).map((order) => (
            <div
              key={order.id}
              data-testid={`order-row-completed-${order.order_number}`}
              className="flex items-center px-4 py-1.5 border-b border-gray-100 bg-green-50"
            >
              <span className="w-16 font-bold text-green-700 text-lg">{order.order_number}</span>
              <span className="flex-1 text-lg font-medium text-green-700">{order.description}</span>
              <span className="w-24 text-green-600 text-lg">{formatTime(order.created_at)}</span>
              <span className="w-24 text-green-600 text-lg">--:--:--</span>
              <div className="flex gap-2 ml-4">
                <div className="w-8 h-8 flex items-center justify-center bg-green-600 text-white rounded">
                  <Check size={16} />
                </div>
                <button
                  data-testid={`edit-btn-completed-${order.order_number}`}
                  onClick={() => handleEdit(order)}
                  className="w-8 h-8 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  data-testid={`delete-btn-completed-${order.order_number}`}
                  onClick={() => handleDelete(order.id)}
                  className="w-8 h-8 flex items-center justify-center text-white rounded transition-colors bg-red-500 hover:bg-red-600"
                  title="Cancella"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {orders.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nessun ordine. Inserisci un nuovo ordine sopra.
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default CassaPage;
