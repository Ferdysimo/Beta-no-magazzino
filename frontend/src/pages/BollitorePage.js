import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Play, Pause, RotateCcw, Check, RefreshCw, Lock, Unlock } from 'lucide-react';

// Memoized row: only re-renders when its own order data or tick changes
const OrderRow = memo(({ order, tick, onStart, onPause, onReset, onComplete }) => {
  const isUppercase = (text) => {
    const letters = text.replace(/[^a-zA-Z]/g, '');
    return letters.length > 0 && letters === letters.toUpperCase();
  };

  const getElapsedSeconds = () => {
    if (!order.timer_started) return 0;
    if (order.timer_paused) return order.timer_elapsed || 0;
    const start = new Date(order.timer_start_time);
    const now = new Date();
    return Math.floor((now - start) / 1000) + (order.timer_elapsed || 0);
  };

  const elapsed = getElapsedSeconds();
  const isRunning = order.timer_started && !order.timer_paused;

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  let rowColor = 'bg-white';
  if (order.timer_started) {
    if (elapsed > 180) rowColor = 'bg-[#FDA4AF]';
    else if (elapsed > 120) rowColor = 'bg-[#EF4444] text-white';
    else rowColor = 'bg-[#22C55E] text-white';
  }

  return (
    <div
      data-testid={`bollitore-row-${order.order_number}`}
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
        {/* Play/Pause — onPointerDown fires instantly, before any re-render can steal the click */}
        <button
          data-testid={isRunning ? `pause-btn-${order.order_number}` : `play-btn-${order.order_number}`}
          onPointerDown={(e) => {
            e.preventDefault();
            if (isRunning) onPause(order.id, elapsed);
            else onStart(order.id);
          }}
          className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors touch-manipulation"
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>

        {/* Reset */}
        <button
          data-testid={`reset-btn-${order.order_number}`}
          onPointerDown={(e) => { e.preventDefault(); onReset(order.id); }}
          className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors touch-manipulation"
        >
          <RotateCcw size={18} />
        </button>

        {/* Complete */}
        <button
          data-testid={`complete-btn-${order.order_number}`}
          onPointerDown={(e) => { e.preventDefault(); onComplete(order.id); }}
          className="w-10 h-10 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded transition-colors touch-manipulation"
        >
          <Check size={18} />
        </button>
      </div>
    </div>
  );
});

const BollitorePage = () => {
  const { restaurant } = useAuth();
  const { orders, startTimer, pauseTimer, resetTimer, completeOrder, newOrdersAvailable, pauseUpdates, setPauseUpdates, refreshOrders } = useOrders();
  const [tick, setTick] = useState(0);
  const intervalRef = useRef(null);

  const pendingOrders = orders
    .filter(o => o.status === 'pending' && !o.description.trim().endsWith('-'))
    .sort((a, b) => a.order_number - b.order_number);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const handleStart = useCallback(async (id) => {
    try { await startTimer(id); } catch (e) { console.error('Error starting timer:', e); }
  }, [startTimer]);

  const handlePause = useCallback(async (id, elapsed) => {
    try { await pauseTimer(id, elapsed); } catch (e) { console.error('Error pausing timer:', e); }
  }, [pauseTimer]);

  const handleReset = useCallback(async (id) => {
    try { await resetTimer(id); } catch (e) { console.error('Error resetting timer:', e); }
  }, [resetTimer]);

  const handleComplete = useCallback(async (id) => {
    try { await completeOrder(id); } catch (e) { console.error('Error completing order:', e); }
  }, [completeOrder]);

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Tablet bollitore</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPauseUpdates(!pauseUpdates)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                pauseUpdates ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              data-testid="toggle-updates-btn"
            >
              {pauseUpdates ? <Lock size={18} /> : <Unlock size={18} />}
              {pauseUpdates ? 'Aggiornamenti bloccati' : 'Blocca aggiornamenti'}
            </button>
            {newOrdersAvailable && (
              <button onClick={refreshOrders} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md font-medium animate-pulse" data-testid="refresh-orders-btn">
                <RefreshCw size={18} /> Nuovi ordini!
              </button>
            )}
            <p className="font-heading text-xl text-gray-600" data-testid="bollitore-location">{restaurant?.location}</p>
          </div>
        </div>

        {pauseUpdates && (
          <div className="bg-amber-100 border border-amber-300 text-amber-800 px-4 py-2 rounded-md mb-4 flex items-center gap-2">
            <Lock size={16} />
            <span>Aggiornamenti bloccati. Puoi cancellare tranquillamente. Clicca "Sblocca" quando hai finito.</span>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {pendingOrders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              tick={tick}
              onStart={handleStart}
              onPause={handlePause}
              onReset={handleReset}
              onComplete={handleComplete}
            />
          ))}
          {pendingOrders.length === 0 && (
            <div className="p-8 text-center text-gray-500">Nessun ordine in attesa.</div>
          )}
        </div>
      </main>
    </div>
  );
};

export default BollitorePage;
