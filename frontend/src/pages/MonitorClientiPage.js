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

      <div className="flex flex-wrap justify-center gap-10">
        {monitorOrders.map((order) => (
          <div
            key={order.id}
            data-testid={`monitor-order-${order.order_number}`}
            className="bg-[#F5C518] rounded-3xl w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center shadow-2xl animate-pulse-slow"
          >
            <span className="text-gray-900 font-black leading-none text-[10rem] sm:text-[12rem]">
              {order.order_number > 99 ? String(order.order_number).slice(1) : order.order_number}
            </span>
          </div>
        ))}
      </div>

      <p className="text-white text-3xl sm:text-4xl font-bold mt-16 uppercase tracking-wider">
        Il tuo piatto è pronto!
      </p>
    </div>
  );
};

export default MonitorClientiPage;
