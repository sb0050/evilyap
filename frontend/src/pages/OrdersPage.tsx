import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../components/Header';
import { useParams } from 'react-router-dom';
import { Package, Truck, CheckCircle } from 'lucide-react';

type StoreInfo = { name: string; slug: string };

type Shipment = {
  id: number;
  store_id: number | null;
  customer_stripe_id: string | null;
  shipment_id: string | null;
  document_created: boolean;
  delivery_method: string | null;
  delivery_network: string | null;
  drop_off_point_code: number | null;
  pickup_point_code: number | null;
  weight: string | null;
  product_reference: number | null;
  value: number | null;
  store?: StoreInfo | null;
};

export default function OrdersPage() {
  const { storeSlug } = useParams();
  const { user } = useUser();
  const { getToken } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await getToken();
        const stripeId = (user?.publicMetadata as any)?.stripe_id as string | undefined;
        if (!stripeId) {
          throw new Error("stripe_id manquant dans les metadata du user");
        }
        const url = `${apiBase}/api/shipments/customer?stripeId=${encodeURIComponent(
          stripeId
        )}${storeSlug ? `&storeSlug=${encodeURIComponent(storeSlug)}` : ''}`;
        const resp = await fetch(url, {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        });
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(
            json?.error || 'Erreur lors du chargement des commandes'
          );
        }
        setShipments(Array.isArray(json?.shipments) ? json.shipments : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };
    if (user?.id) run();
  }, [user, storeSlug]);

  const formatMethod = (m?: string | null) => {
    if (!m) return '—';
    switch (m) {
      case 'pickup_point':
        return 'Point relais';
      case 'home_delivery':
        return 'À domicile';
      case 'store_pickup':
        return 'Retrait en boutique';
      default:
        return m;
    }
  };

  const formatValue = (v?: number | null) => {
    if (v == null) return '—';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(v);
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <Header />
      <div className='max-w-6xl mx-auto px-4 py-8'>
        <div className='text-center mb-8'>
          <Package className='h-12 w-12 text-amber-600 mx-auto mb-4' />
          <h1 className='text-3xl font-bold text-gray-900 mb-2'>
            Suivi de mes commandes
          </h1>
        </div>

        <div className='bg-white rounded-lg shadow-md p-6'>
          {loading ? (
            <div className='text-center py-12'>
              <Package className='h-16 w-16 text-gray-300 mx-auto mb-4' />
              <p className='text-gray-500'>Chargement des commandes...</p>
            </div>
          ) : error ? (
            <div className='text-center py-12'>
              <p className='text-red-600'>{error}</p>
            </div>
          ) : shipments.length === 0 ? (
            <div className='text-center py-12'>
              <Package className='h-16 w-16 text-gray-300 mx-auto mb-4' />
              <p className='text-gray-500'>
                Aucune commande trouvée pour ce compte.
              </p>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full'>
                <thead>
                  <tr className='border-b border-gray-200'>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Boutique
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Référence produit
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Valeur
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Méthode
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Réseau
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Point retrait/dépôt
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Poids
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Shipment ID
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Document
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map(s => (
                    <tr
                      key={s.id}
                      className='border-b border-gray-100 hover:bg-gray-50'
                    >
                      <td className='py-4 px-4 text-gray-900'>
                        {s.store?.name || '—'}{' '}
                        {s.store?.slug ? `(${s.store.slug})` : ''}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {s.product_reference ?? '—'}
                      </td>
                      <td className='py-4 px-4 text-gray-900 font-semibold'>
                        {formatValue(s.value)}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        <div className='flex items-center space-x-2'>
                          {s.delivery_method === 'home_delivery' ? (
                            <Truck className='h-5 w-5 text-blue-500' />
                          ) : (
                            <Package className='h-5 w-5 text-gray-500' />
                          )}
                          <span>{formatMethod(s.delivery_method)}</span>
                        </div>
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {s.delivery_network || '—'}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {s.pickup_point_code || s.drop_off_point_code || '—'}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {s.weight ?? '—'}
                      </td>
                      <td className='py-4 px-4'>
                        <span className='text-blue-600'>
                          {s.shipment_id || '—'}
                        </span>
                      </td>
                      <td className='py-4 px-4'>
                        <div className='flex items-center space-x-2'>
                          {s.document_created ? (
                            <CheckCircle className='h-5 w-5 text-green-500' />
                          ) : (
                            <Package className='h-5 w-5 text-gray-400' />
                          )}
                          <span className='text-gray-700'>
                            {s.document_created
                              ? 'Document généré'
                              : 'En préparation'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
