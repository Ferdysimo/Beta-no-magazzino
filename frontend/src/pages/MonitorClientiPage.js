import React from 'react';
import { useOrders } from '../contexts/OrderContext';

const BACKGROUND_IMAGE = 'https://customer-assets.emergentagent.com/job_0180d0f0-c7fa-4463-a43a-ab97d28ecc52/artifacts/2g29cupn_monitor%20clienti.jpg';

const MonitorClientiPage = () => {
  const { orders } = useOrders();

  const monitorOrders = orders
    .filter(o => o.monitor_visible)
    .sort((a, b) => a.order_number - b.order_number);

  // No orders → full background image
  if (monitorOrders.length === 0) {
    return (
      <div
        className="min-h-screen bg-cover bg-center flex items-center justify-center"
        style={{ backgroundImage: `url('${BACKGROUND_IMAGE}')` }}
        data-testid="monitor-empty"
      />
    );
  }

  // Orders visible → dark background with big numbers
  return (
    <div
      className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-8"
      data-testid="monitor-active"
    >
      <h1 className="text-white text-3xl font-bold uppercase tracking-widest mb-12 opacity-60">
        Pastasciutta Roma
      </h1>

      <div className="flex flex-wrap justify-center gap-8">
        {monitorOrders.map((order) => (
          <div
            key={order.id}
            data-testid={`monitor-order-${order.order_number}`}
            className="bg-[#F5C518] rounded-2xl w-40 h-40 flex items-center justify-center shadow-2xl animate-pulse-slow"
          >
            <span className="text-gray-900 text-7xl font-black">
              {order.order_number}
            </span>
          </div>
        ))}
      </div>

      <p className="text-white/40 text-lg mt-16 uppercase tracking-wider">
        Il tuo ordine è pronto!
      </p>
    </div>
  );
};

export default MonitorClientiPage;
