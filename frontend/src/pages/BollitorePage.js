import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Play, Pause, RotateCcw, Check } from 'lucide-react';

const BollitorePage = () => {
  const { restaurant } = useAuth();
  const { orders, startTimer, pauseTimer, resetTimer, completeOrder } = useOrders();
  const [timers, setTimers] = useState({});

  // Filter only pending orders
  const pendingOrders = orders.filter(o => o.status === 'pending');

  // Update timers every second
  useEffect(() => {
    const interval = setInterval(() => {
      const newTimers = {};
      pendingOrders.forEach(order => {
        if (order.timer_started && !order.timer_paused) {
          const start = new Date(order.timer_start_time);
          const now = new Date();
          const elapsed = Math.floor((now - start) / 1000) + (order.timer_elapsed || 0);
          newTimers[order.id] = elapsed;
        } else if (order.timer_started && order.timer_paused) {
          newTimers[order.id] = order.timer_elapsed || 0;
        } else {
          newTimers[order.id] = 0;
        }
      });
      setTimers(newTimers);
    }, 1000);

    return () => clearInterval(interval);
  }, [pendingOrders]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `00:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getRowColor = (order) => {
    if (!order.timer_started) return 'bg-white';
    
    const elapsed = timers[order.id] || 0;
    
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

  const handlePauseTimer = async (orderId) => {
    const elapsed = timers[orderId] || 0;
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
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Tablet bollitore</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="bollitore-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Orders List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {pendingOrders.map((order) => {
            const rowColor = getRowColor(order);
            const elapsed = timers[order.id] || 0;
            const isRunning = order.timer_started && !order.timer_paused;
            
            return (
              <div
                key={order.id}
                data-testid={`bollitore-row-${order.order_number}`}
                className={`flex items-center px-4 py-4 border-b border-gray-100 transition-colors ${rowColor}`}
              >
                <span className="w-16 font-bold text-lg">{order.order_number}</span>
                <span className="flex-1 font-medium text-lg">{order.description}</span>
                
                <span className="w-28 font-mono text-lg font-bold">
                  {order.timer_started ? formatTimer(elapsed) : ''}
                </span>
                
                <div className="flex gap-2 ml-4">
                  {/* Play/Pause Button */}
                  {!order.timer_started || order.timer_paused ? (
                    <button
                      data-testid={`play-btn-${order.order_number}`}
                      onClick={() => handleStartTimer(order.id)}
                      className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors"
                    >
                      <Play size={18} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      data-testid={`pause-btn-${order.order_number}`}
                      onClick={() => handlePauseTimer(order.id)}
                      className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors"
                    >
                      <Pause size={18} />
                    </button>
                  )}
                  
                  {/* Reset Button */}
                  <button
                    data-testid={`reset-btn-${order.order_number}`}
                    onClick={() => handleResetTimer(order.id)}
                    className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-800 rounded border border-gray-300 transition-colors"
                  >
                    <RotateCcw size={18} />
                  </button>
                  
                  {/* Complete Button */}
                  <button
                    data-testid={`complete-btn-${order.order_number}`}
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
              Nessun ordine in attesa.
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default BollitorePage;
