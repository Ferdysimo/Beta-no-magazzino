import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Play, Pause, RotateCcw, Check, RefreshCw, Lock, Unlock } from 'lucide-react';

const BollitorePage2 = () => {
  const { restaurant } = useAuth();
  const { orders, startTimer, pauseTimer, resetTimer, completeOrder, newOrdersAvailable, pauseUpdates, setPauseUpdates, refreshOrders } = useOrders();
  const [tick, setTick] = useState(0);
  const intervalRef = useRef(null);

  // Filter only pending orders that END WITH "-", sorted by order_number ascending
  const pendingOrders = orders
    .filter(o => o.status === 'pending' && o.description.trim().endsWith('-'))
    .sort((a, b) => a.order_number - b.order_number);

  // Check if description is uppercase (for table grouping)
  const isUppercase = (text) => {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) return false;
    return letters === letters.toUpperCase();
  };

  // Tick every second to force re-render for timer updates
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Calculate elapsed time for an order
  const getElapsedSeconds = useCallback((order) => {
    if (!order.timer_started) return 0;
    
    if (order.timer_paused) {
      return order.timer_elapsed || 0;
    }
    
    const start = new Date(order.timer_start_time);
    const now = new Date();
    const elapsed = Math.floor((now - start) / 1000) + (order.timer_elapsed || 0);
    return elapsed;
  }, [tick]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getRowColor = (order) => {
    if (!order.timer_started) return 'bg-white';
    
    const elapsed = getElapsedSeconds(order);
    
    if (elapsed > 180) return 'bg-[#FDA4AF]'; // Pink for > 3 mins
    if (elapsed > 120) return 'bg-[#EF4444] text-white'; // Red for > 2 mins
    return 'bg-[#22C55E] text-white'; // Green for < 2 mins
  };

  const handleStartTimer = async (orderId) => {
    try {
      await startTimer(orderId);
    } catch (error) {
      console.error('Error starting timer:', error);
    }
  };

  const handlePauseTimer = async (orderId, elapsed) => {
    try {
      await pauseTimer(orderId, elapsed);
    } catch (error) {
      console.error('Error pausing timer:', error);
    }
  };

  const handleResetTimer = async (orderId) => {
    try {
      await resetTimer(orderId);
    } catch (error) {
      console.error('Error resetting timer:', error);
    }
  };

  const handleComplete = async (orderId) => {
    try {
      await completeOrder(orderId);
    } catch (error) {
      console.error('Error completing order:', error);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Tablet bollitore 2</h1>
            <p className="text-gray-500">Solo ordini con simbolo: -</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Lock/Unlock Updates Button */}
            <button
              onClick={() => setPauseUpdates(!pauseUpdates)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                pauseUpdates 
                  ? 'bg-amber-500 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              data-testid="toggle-updates-btn-2"
            >
              {pauseUpdates ? <Lock size={18} /> : <Unlock size={18} />}
              {pauseUpdates ? 'Aggiornamenti bloccati' : 'Blocca aggiornamenti'}
            </button>
            
            {/* Refresh Button - shows when new orders available */}
            {newOrdersAvailable && (
              <button
                onClick={refreshOrders}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md font-medium animate-pulse"
                data-testid="refresh-orders-btn-2"
              >
                <RefreshCw size={18} />
                Nuovi ordini!
              </button>
            )}
            
            <p className="font-heading text-xl text-gray-600" data-testid="bollitore2-location">
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

        {/* Orders List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {pendingOrders.map((order) => {
            const elapsed = getElapsedSeconds(order);
            const rowColor = getRowColor(order);
            const isRunning = order.timer_started && !order.timer_paused;
            
            return (
              <div
                key={order.id}
                data-testid={`bollitore2-row-${order.order_number}`}
                className={`flex items-center px-4 py-4 border-b border-gray-100 transition-colors ${rowColor}`}
              >
                <span className="w-16 font-bold text-lg">{order.order_number}</span>
                <span className={`flex-1 text-lg ${isUppercase(order.description) ? 'font-bold' : 'font-medium'}`}>
                  {order.description}
                </span>
                
                <span className="w-28 font-mono text-lg font-bold tabular-nums">
                  {order.timer_started ? formatTimer(elapsed) : ''}
                </span>
                
                <div className="flex gap-2 ml-4">
                  {/* Single Play/Pause Button — same DOM node, avoids missed clicks */}
                  <button
                    data-testid={isRunning ? `pause-btn-2-${order.order_number}` : `play-btn-2-${order.order_number}`}
                    onClick={isRunning
                      ? () => handlePauseTimer(order.id, elapsed)
                      : () => handleStartTimer(order.id)
                    }
                    className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors"
                  >
                    {isRunning ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
                  </button>
                  
                  {/* Reset Button */}
                  <button
                    data-testid={`reset-btn-2-${order.order_number}`}
                    onClick={() => handleResetTimer(order.id)}
                    className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors"
                  >
                    <RotateCcw size={18} />
                  </button>
                  
                  {/* Complete Button */}
                  <button
                    data-testid={`complete-btn-2-${order.order_number}`}
                    onClick={() => handleComplete(order.id)}
                    className="w-10 h-10 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    <Check size={18} />
                  </button>
                </div>
              </div>
            );
          })}

          {pendingOrders.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              Nessun ordine con simbolo "-" in attesa.
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default BollitorePage2;
