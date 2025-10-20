import { useState, useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import { ShoppingBag, Package, Truck, CheckCircle } from 'lucide-react';

interface Order {
  id: string;
  date: string;
  amount: number;
  status: 'delivered' | 'shipped' | 'processing';
  carrier: string;
  trackingNumber: string;
  comment: string;
}

export default function OrdersPage() {
  const { user } = useUser();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    // Fetch orders from your backend
    // This is mock data for demonstration
    setOrders([
      {
        id: '1',
        date: '2024-01-15',
        amount: 500.0,
        status: 'delivered',
        carrier: 'Chronopost',
        trackingNumber: 'CP123456789',
        comment: 'Delivered successfully',
      },
      {
        id: '2',
        date: '2024-01-10',
        amount: 250.0,
        status: 'shipped',
        carrier: 'Relais Standard',
        trackingNumber: 'RS987654321',
        comment: 'In transit',
      },
    ]);
  }, [user]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className='h-5 w-5 text-green-500' />;
      case 'shipped':
        return <Truck className='h-5 w-5 text-blue-500' />;
      case 'processing':
        return <Package className='h-5 w-5 text-yellow-500' />;
      default:
        return <Package className='h-5 w-5 text-gray-500' />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'delivered':
        return 'Delivered';
      case 'shipped':
        return 'Shipped';
      case 'processing':
        return 'Processing';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className='max-w-6xl mx-auto px-4 py-8'>
      <div className='text-center mb-8'>
        <ShoppingBag className='h-12 w-12 text-amber-600 mx-auto mb-4' />
        <h1 className='text-3xl font-bold text-gray-900 mb-2'>PayLive</h1>
      </div>

      <div className='bg-white rounded-lg shadow-md p-8'>
        <h2 className='text-2xl font-bold text-gray-900 mb-6'>
          Votre commandes
        </h2>
        <p className='text-sm text-blue-600 mb-6'>
          * Seules les commandes passées à partir de votre appareil actuel sont
          affichées ici.
        </p>

        {orders.length === 0 ? (
          <div className='text-center py-12'>
            <Package className='h-16 w-16 text-gray-300 mx-auto mb-4' />
            <p className='text-gray-500'>No orders found</p>
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead>
                <tr className='border-b border-gray-200'>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    ID
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Date
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Montant Payé
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    État
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Transporteur
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Numéro suivi
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Commentaire
                  </th>
                  <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                    Facture
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr
                    key={order.id}
                    className='border-b border-gray-100 hover:bg-gray-50'
                  >
                    <td className='py-4 px-4 text-gray-900'>{order.id}</td>
                    <td className='py-4 px-4 text-gray-700'>{order.date}</td>
                    <td className='py-4 px-4 text-gray-900 font-semibold'>
                      €{order.amount.toFixed(2)}
                    </td>
                    <td className='py-4 px-4'>
                      <div className='flex items-center space-x-2'>
                        {getStatusIcon(order.status)}
                        <span className='text-gray-700'>
                          {getStatusText(order.status)}
                        </span>
                      </div>
                    </td>
                    <td className='py-4 px-4 text-gray-700'>{order.carrier}</td>
                    <td className='py-4 px-4'>
                      <span className='text-blue-600 hover:text-blue-800 cursor-pointer'>
                        {order.trackingNumber}
                      </span>
                    </td>
                    <td className='py-4 px-4 text-gray-700'>{order.comment}</td>
                    <td className='py-4 px-4'>
                      <button className='text-blue-600 hover:text-blue-800 underline'>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className='mt-8 text-center'>
          <button className='bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors'>
            Retour
          </button>
        </div>
      </div>
    </div>
  );
}
