import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Edit2, Trash2, Check, Loader2, AlertCircle } from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const CassaPage = () => {
  const { restaurant, token } = useAuth();
  const { orders, createOrder, deleteOrder, completeOrder, updateOrder } = useOrders();
  const [orderNumber, setOrderNumber] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [logs, setLogs] = useState({ deletions: { count: 0, logs: [] }, modifications: { count: 0, logs: [] } });
  const [showLogs, setShowLogs] = useState(false);
  const inputRef = useRef(null);

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

  // Calculate next order number based on existing orders
  const getNextOrderNumber = () => {
    if (orders.length === 0) return 1;
    const maxNumber = Math.max(...orders.map(o => o.order_number));
    return maxNumber + 1;
  };

  // Update order number when orders change
  useEffect(() => {
    setOrderNumber(String(getNextOrderNumber()));
  }, [orders]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    
    setLoading(true);
    try {
      await createOrder(description.trim(), parseInt(orderNumber) || getNextOrderNumber());
      setDescription('');
      setOrderNumber(String(getNextOrderNumber() + 1));
      // Focus input after a short delay to ensure DOM is updated
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error('Error creating order:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (orderId) => {
    try {
      await deleteOrder(orderId);
      // Refresh logs after deletion
      setTimeout(fetchLogs, 500);
    } catch (error) {
      console.error('Error deleting order:', error);
    }
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
    setEditValue(order.description);
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
      await updateOrder(orderId, { description: editValue });
      setEditingId(null);
      setEditValue('');
      // Refresh logs after modification
      setTimeout(fetchLogs, 500);
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

  // Filter pending orders
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const completedOrders = orders.filter(o => o.status === 'completed');

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Cassa</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="cassa-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Logs Counter Bar */}
        <div 
          className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
          onClick={() => setShowLogs(!showLogs)}
          data-testid="logs-counter-bar"
        >
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Trash2 size={18} className="text-red-500" />
              <span className="font-medium">
                Cancellate oggi: <strong className="text-red-600">{logs.deletions.count}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Edit2 size={18} className="text-amber-500" />
              <span className="font-medium">
                Modificate oggi: <strong className="text-amber-600">{logs.modifications.count}</strong>
              </span>
            </div>
          </div>
          <span className="text-gray-500 text-sm">{showLogs ? '▲ Chiudi' : '▼ Dettagli'}</span>
        </div>

        {/* Logs Detail Panel */}
        {showLogs && (
          <div className="mb-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4 max-h-64 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Deletions */}
              <div>
                <h3 className="font-bold text-red-600 mb-2 flex items-center gap-2">
                  <Trash2 size={16} /> Cancellazioni
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
                  <Edit2 size={16} /> Modifiche
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
          </div>
        )}

        {/* Input Section */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex items-center gap-2 bg-white p-2 rounded-lg shadow-sm border border-gray-200">
            {/* Editable Order Number */}
            <input
              data-testid="order-number-input"
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value.replace(/\D/g, ''))}
              className="w-20 h-12 text-lg font-bold text-center px-2 border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
              placeholder="N°"
            />
            
            {/* Description Input */}
            <input
              ref={inputRef}
              data-testid="order-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex-1 h-12 text-lg px-4 border-0 focus:ring-0 focus:outline-none"
              placeholder="es. carb ta 20 oppure CARB TA 20"
              disabled={loading}
            />
            <button
              data-testid="order-submit"
              type="submit"
              disabled={loading || !description.trim()}
              className="action-button h-12 px-6 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : 'Invia'}
            </button>
          </div>
        </form>

        {/* Orders List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden select-none">
          {/* Pending Orders */}
          {pendingOrders.map((order) => (
            <div
              key={order.id}
              data-testid={`order-row-${order.order_number}`}
              className="flex items-center px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
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
                    className="flex-1 h-10 px-3 border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    data-testid={`save-edit-${order.order_number}`}
                    onClick={() => handleSaveEdit(order.id)}
                    className="w-10 h-10 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    data-testid={`cancel-edit-${order.order_number}`}
                    onClick={handleCancelEdit}
                    className="w-10 h-10 flex items-center justify-center bg-gray-400 hover:bg-gray-500 text-white rounded transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <span className="flex-1 font-medium text-gray-800">{order.description}</span>
              )}
              
              <span className="w-24 text-gray-600 text-sm">{formatTime(order.created_at)}</span>
              
              <span 
                className={`w-24 text-sm font-mono ${
                  order.timer_started ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                {getTimerDisplay(order)}
              </span>
              
              <div className="flex gap-2 ml-4">
                <button
                  data-testid={`complete-btn-${order.order_number}`}
                  onClick={() => handleComplete(order.id)}
                  className="w-10 h-10 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                >
                  <Check size={18} />
                </button>
                <button
                  data-testid={`edit-btn-${order.order_number}`}
                  onClick={() => handleEdit(order)}
                  className="w-10 h-10 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                >
                  <Edit2 size={18} />
                </button>
                <button
                  data-testid={`delete-btn-${order.order_number}`}
                  onClick={() => handleDelete(order.id)}
                  className="w-10 h-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}

          {/* Completed Orders (shown in different color) */}
          {completedOrders.slice(0, 5).map((order) => (
            <div
              key={order.id}
              data-testid={`order-row-completed-${order.order_number}`}
              className="flex items-center px-4 py-3 border-b border-gray-100 bg-green-50"
            >
              <span className="w-16 font-bold text-green-700 text-lg">{order.order_number}</span>
              <span className="flex-1 font-medium text-green-700">{order.description}</span>
              <span className="w-24 text-green-600 text-sm">{formatTime(order.created_at)}</span>
              <span className="w-24 text-green-600 text-sm">--:--:--</span>
              <div className="flex gap-2 ml-4">
                <div className="w-10 h-10 flex items-center justify-center bg-green-600 text-white rounded">
                  <Check size={18} />
                </div>
                <button
                  data-testid={`edit-btn-completed-${order.order_number}`}
                  onClick={() => handleEdit(order)}
                  className="w-10 h-10 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                >
                  <Edit2 size={18} />
                </button>
                <button
                  data-testid={`delete-btn-completed-${order.order_number}`}
                  onClick={() => handleDelete(order.id)}
                  className="w-10 h-10 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
                >
                  <Trash2 size={18} />
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
