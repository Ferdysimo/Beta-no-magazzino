import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Check, Trash2, Camera, RefreshCw, Lock, Unlock } from 'lucide-react';

const HIGHLIGHT_STORAGE_KEY = 'generale_highlighted_orders';

const loadHighlighted = () => {
  try {
    const raw = sessionStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

const GeneralePage = () => {
  const { restaurant } = useAuth();
  const { orders, hideFromGenerale, toggleMonitor, newOrdersAvailable, pauseUpdates, setPauseUpdates, refreshOrders } = useOrders();

  // Track highlighted orders — persisted in sessionStorage so the selection
  // survives navigation to Home and back. Cleared when the tab is closed.
  const [highlightedOrders, setHighlightedOrders] = useState(loadHighlighted);

  // Filter only pending orders that are NOT hidden from generale, sorted by order_number ascending
  const pendingOrders = orders
    .filter(o => o.status === 'pending' && !o.hidden_generale)
    .sort((a, b) => a.order_number - b.order_number);

  // Check if description is uppercase (for table grouping)
  const isUppercase = (text) => {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return false;
    return letters === letters.toUpperCase();
  };

  // Toggle highlight for an order (also persists in sessionStorage)
  const toggleHighlight = (orderId) => {
    setHighlightedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      try {
        sessionStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify([...newSet]));
      } catch {
        // ignore quota / privacy-mode errors
      }
      return newSet;
    });
  };

  const handleDelete = async (orderId) => {
    try {
      await hideFromGenerale(orderId);
      // Remove from highlighted if it was highlighted
      setHighlightedOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    } catch (error) {
      console.error('Error hiding order from generale:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900">Tablet generale</h1>
          <div className="flex items-center gap-4">
            {/* Lock/Unlock Updates Button */}
            <button
              onClick={() => setPauseUpdates(!pauseUpdates)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                pauseUpdates 
                  ? 'bg-amber-500 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              data-testid="toggle-updates-btn-generale"
            >
              {pauseUpdates ? <Lock size={18} /> : <Unlock size={18} />}
              {pauseUpdates ? 'Aggiornamenti bloccati' : 'Blocca aggiornamenti'}
            </button>
            
            {/* Refresh Button - shows when new orders available */}
            {newOrdersAvailable && (
              <button
                onClick={refreshOrders}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md font-medium animate-pulse"
                data-testid="refresh-orders-btn-generale"
              >
                <RefreshCw size={18} />
                Nuovi ordini!
              </button>
            )}
            
            <p className="font-heading text-xl text-gray-600" data-testid="generale-location">
              {restaurant?.location}
            </p>
          </div>
        </div>

        {/* Info Banner when paused */}
        {pauseUpdates && (
          <div className="bg-amber-100 border border-amber-300 text-amber-800 px-4 py-2 rounded-md mb-4 flex items-center gap-2">
            <Lock size={16} />
            <span>Aggiornamenti bloccati. Puoi cancellare tranquillamente. Clicca "Sblocca" quando hai finito.</span>
          </div>
        )}

        {/* Orders List - Row format */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {pendingOrders.map((order) => {
            const isHighlighted = highlightedOrders.has(order.id);
            
            return (
              <div
                key={order.id}
                data-testid={`generale-row-${order.order_number}`}
                className={`flex items-center px-2 py-1 border-b border-gray-100 transition-colors ${
                  isHighlighted ? 'bg-blue-700' : 'hover:bg-gray-50'
                }`}
              >
                {/* Order Number */}
                <span className={`w-20 font-bold text-xl ${isHighlighted ? 'text-white' : 'text-gray-800'}`}>
                  {order.order_number}
                </span>
                
                {/* Order Description */}
                <span className={`flex-1 text-2xl ${isHighlighted ? 'text-white' : 'text-gray-800'} ${isUppercase(order.description) ? 'font-bold' : 'font-medium'}`}>
                  {order.description}
                </span>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-4">
                  {/* Highlight Button (Check) */}
                  <button
                    data-testid={`generale-highlight-${order.order_number}`}
                    onClick={() => toggleHighlight(order.id)}
                    className={`w-10 h-10 flex items-center justify-center rounded border transition-colors ${
                      isHighlighted
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-300'
                    }`}
                  >
                    <Check size={20} />
                  </button>
                  
                  {/* Spacer */}
                  <div className="w-8" />

                  {/* Monitor Button (Camera) */}
                  <button
                    data-testid={`generale-monitor-${order.order_number}`}
                    onClick={() => toggleMonitor(order.id)}
                    className={`w-10 h-10 flex items-center justify-center rounded border transition-colors ${
                      order.monitor_visible
                        ? 'bg-[#F5C518] text-gray-900 border-[#F5C518]'
                        : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-300'
                    }`}
                  >
                    <Camera size={20} />
                  </button>
                  
                  {/* Delete Button */}
                  <button
                    data-testid={`generale-delete-${order.order_number}`}
                    onClick={() => handleDelete(order.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            );
          })}

          {pendingOrders.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nessun ordine in attesa. Gli ordini appariranno qui automaticamente.
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default GeneralePage;
