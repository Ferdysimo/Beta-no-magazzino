import React, { useState, useRef, useEffect } from 'react';
import CassaBevandeBox from '../components/CassaBevandeBox';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Edit2, Trash2, Check, Loader2, AlertCircle, Printer, X, Plus } from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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
  const { restaurant, token, isAdmin } = useAuth();
  const showBeverages = restaurant?.username === 'Flaminio' || (isAdmin && restaurant?.location === 'Flaminio');
  const beveragesVisible = showBeverages && !hideBeverages;

  const toggleBeverages = () => {
    setHideBeverages(prev => {
      const next = !prev;
      try { localStorage.setItem('cassa_hide_beverages', next ? '1' : '0'); } catch (e) { /* ignore */ }
      return next;
    });
  };
  const { orders, createOrder, deleteOrder, completeOrder, updateOrder } = useOrders();
  const [orderNumber, setOrderNumber] = useState('');
  const [userEditedNumber, setUserEditedNumber] = useState(false);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [logs, setLogs] = useState({ deletions: { count: 0, logs: [] }, modifications: { count: 0, logs: [] } });
  const [showLogs, setShowLogs] = useState(false);
  const [hideBeverages, setHideBeverages] = useState(() => {
    try { return localStorage.getItem('cassa_hide_beverages') === '1'; } catch { return false; }
  });
  const [selectedForPrint, setSelectedForPrint] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [printData, setPrintData] = useState(null); // {orario, rows: [{number, description}]}
  const inputRef = useRef(null);
  const [tick, setTick] = useState(0);

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
      
      <main className={`max-w-6xl mx-auto p-6 ${beveragesVisible ? 'lg:pr-56' : ''}`}>
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Cassa</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="cassa-location">
            {restaurant?.location}
          </p>
        </div>

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

        {/* Beverages sidebar (right, Flaminio only, hideable) */}
        {beveragesVisible && (
          <aside
            className="hidden lg:flex fixed top-[70px] bottom-0 right-0 w-52 flex-col bg-gray-50 border-l border-gray-200 z-20 overflow-y-auto"
            data-testid="cassa-bev-sidebar"
          >
            <div className="px-2 py-2 bg-[#F5C518] text-gray-900 font-extrabold text-center text-sm uppercase tracking-wide sticky top-0 flex items-center justify-between gap-1">
              <span className="flex-1">Bevande</span>
              <button
                onClick={toggleBeverages}
                data-testid="cassa-bev-hide"
                title="Nascondi bevande"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-yellow-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <CassaBevandeBox />
          </aside>
        )}

        {/* Tab to bring back the beverages sidebar when hidden */}
        {showBeverages && hideBeverages && (
          <button
            onClick={toggleBeverages}
            data-testid="cassa-bev-show"
            title="Mostra bevande"
            className="hidden lg:flex fixed top-1/2 -translate-y-1/2 right-0 z-30 bg-[#F5C518] hover:bg-[#E5A500] text-gray-900 border border-r-0 border-yellow-700 rounded-l-lg shadow-md px-2 py-3 flex-col items-center gap-1 text-xs font-bold"
          >
            <Plus size={14} />
            <span className="[writing-mode:vertical-rl] rotate-180 tracking-wider uppercase">Bevande</span>
          </button>
        )}

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
              className={`flex items-center px-4 py-1.5 border-b border-gray-100 transition-colors cursor-pointer select-none ${
                selectedForPrint.has(order.id)
                  ? 'bg-blue-100 border-l-4 border-l-blue-600'
                  : 'hover:bg-gray-50'
              }`}
              onPointerDown={(e) => {
                if (editingId === order.id || e.target.closest('button') || e.target.closest('input')) return;
                setIsDragging(true);
                setSelectedForPrint(prev => {
                  const next = new Set(prev);
                  if (next.has(order.id)) next.delete(order.id);
                  else next.add(order.id);
                  return next;
                });
              }}
              onPointerEnter={() => {
                if (isDragging && editingId !== order.id) {
                  setSelectedForPrint(prev => {
                    const next = new Set(prev);
                    next.add(order.id);
                    return next;
                  });
                }
              }}
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

      {/* Fixed bottom print bar */}
      {selectedForPrint.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-blue-600 text-white px-6 py-3 flex items-center justify-between shadow-lg z-50">
          <span className="font-medium">{selectedForPrint.size} {selectedForPrint.size === 1 ? 'pasta selezionata' : 'paste selezionate'}</span>
          <div className="flex gap-3">
            <button
              data-testid="clear-selection-btn"
              onClick={() => setSelectedForPrint(new Set())}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-400 rounded transition-colors"
            >
              Annulla
            </button>
            <button
              data-testid="print-selected-btn"
              onClick={handlePrintSelected}
              className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 font-bold rounded hover:bg-blue-50 transition-colors"
            >
              <Printer size={18} />
              Stampa
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CassaPage;
