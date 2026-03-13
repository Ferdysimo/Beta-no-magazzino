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

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <Header />
      
      <main className="max-w-6xl mx-auto p-6">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="font-heading text-4xl font-bold text-gray-900 uppercase">Tablet generale</h1>
          <p className="font-heading text-xl text-gray-600" data-testid="generale-location">
            {restaurant?.location}
          </p>
        </div>

        {/* Orders Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pendingOrders.map((order) => (
            <div
              key={order.id}
              data-testid={`generale-card-${order.order_number}`}
              className="bg-white rounded-lg shadow-sm border-2 border-gray-200 p-4 hover:border-[#F5C518] transition-colors"
            >
              <div className="flex justify-between items-start mb-3">
                <span className="text-3xl font-bold text-gray-800">{order.order_number}</span>
                <span className="text-sm text-gray-500">{formatTime(order.created_at)}</span>
              </div>
              
              <p className="text-xl font-semibold text-gray-800 mb-4">
                {order.description}
              </p>
              
              <div className="flex gap-2">
                <button
                  data-testid={`generale-complete-${order.order_number}`}
                  onClick={() => handleComplete(order.id)}
                  className="flex-1 h-12 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white rounded-md font-bold uppercase transition-colors"
                >
                  <Check size={20} />
                  Fatto
                </button>
                <button
                  data-testid={`generale-delete-${order.order_number}`}
                  onClick={() => handleDelete(order.id)}
                  className="w-12 h-12 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {pendingOrders.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            Nessun ordine in attesa. Gli ordini appariranno qui automaticamente.
          </div>
        )}
      </main>
    </div>
  );
};

export default GeneralePage;
