import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOrders } from '../contexts/OrderContext';
import Header from '../components/Header';
import { Check, Trash2 } from 'lucide-react';

const GeneralePage = () => {
  const { restaurant } = useAuth();
  const { orders, deleteOrder, completeOrder } = useOrders();

  // Filter only pending orders
  const pendingOrders = orders.filter(o => o.status === 'pending');

  const handleDelete = async (orderId) => {
    try {
      await deleteOrder(orderId);
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

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900">Tablet generale</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="generale-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Orders List - Row format */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {pendingOrders.map((order) => (
            <div
              key={order.id}
              data-testid={`generale-row-${order.order_number}`}
              className="flex items-center px-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
            >
              {/* Order Number */}
              <span className="w-20 font-bold text-xl text-gray-800">
                {order.order_number}
              </span>
              
              {/* Order Description */}
              <span className="flex-1 font-medium text-lg text-gray-800">
                {order.description}
              </span>
              
              {/* Action Buttons */}
              <div className="flex items-center gap-4">
                {/* Complete Button */}
                <button
                  data-testid={`generale-complete-${order.order_number}`}
                  onClick={() => handleComplete(order.id)}
                  className="w-10 h-10 flex items-center justify-center bg-white hover:bg-gray-100 text-gray-700 rounded border border-gray-300 transition-colors"
                >
                  <Check size={20} />
                </button>
                
                {/* Spacer */}
                <div className="w-8" />
                
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
          ))}

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
