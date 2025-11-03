import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../components/Header';
import { Toast } from '../components/Toast';
import { useParams } from 'react-router-dom';
import { Package, Truck, Undo2, ArrowUpDown } from 'lucide-react';
import { apiPostForm } from '../utils/api';

type StoreInfo = { name: string; slug: string };

type Shipment = {
  id: number;
  store_id: number | null;
  customer_stripe_id: string | null;
  shipment_id: string | null;
  document_created: boolean;
  delivery_method: string | null;
  delivery_network: string | null;
  dropoff_point: any | null;
  pickup_point: any | null;
  weight: string | null;
  product_reference: string | null;
  value: number | null;
  created_at?: string | null;
  status?: string | null;
  estimated_delivery_date?: string | null;
  cancel_requested?: boolean | null;
  return_requested?: boolean | null;
  delivery_cost?: number | null;
  tracking_url?: string | null;
  store?: StoreInfo | null;
  is_final_destination?: boolean | null;
};

export default function OrdersPage() {
  const { storeSlug } = useParams();
  const { user } = useUser();
  const { getToken } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returnStatus, setReturnStatus] = useState<
    Record<number, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  const [estimatedSortOrder, setEstimatedSortOrder] = useState<
    'asc' | 'desc' | null
  >(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
    visible?: boolean;
  } | null>(null);

  // État pour la popup de contact propriétaire
  const [contactOpen, setContactOpen] = useState<boolean>(false);
  const [contactMessage, setContactMessage] = useState<string>('');
  const [contactFile, setContactFile] = useState<File | null>(null);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [isSendingContact, setIsSendingContact] = useState<boolean>(false);

  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await getToken();
        await (user as any).reload();
        const stripeId = (user?.publicMetadata as any)?.stripe_id as
          | string
          | undefined;
        if (!stripeId) {
          throw new Error('stripe_id manquant dans les metadata du user');
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

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  };

  // Tri par date estimée (prochain colis)
  const sortedShipments = (() => {
    if (!estimatedSortOrder) return shipments || [];
    const toTime = (d?: string | null) => {
      if (!d) return Number.POSITIVE_INFINITY;
      try {
        // Interpréter YYYY-MM-DD en date locale pour éviter les décalages
        const [y, m, day] = (d || '').split('-').map(s => parseInt(s, 10));
        if (!y || !m || !day) return new Date(d as string).getTime();
        return new Date(y, m - 1, day).getTime();
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    };
    const arr = [...(shipments || [])];
    arr.sort((a, b) => {
      const ta = toTime(a.estimated_delivery_date);
      const tb = toTime(b.estimated_delivery_date);
      return estimatedSortOrder === 'asc' ? ta - tb : tb - ta;
    });
    return arr;
  })();

  // Pagination helpers
  const totalPages = Math.max(1, Math.ceil(sortedShipments.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const visibleShipments = sortedShipments.slice(
    startIndex,
    startIndex + pageSize
  );

  useEffect(() => {
    // Clamp page if shipments length or pageSize changes
    const newTotal = Math.max(
      1,
      Math.ceil((shipments || []).length / pageSize)
    );
    if (page > newTotal) setPage(newTotal);
    if (page < 1) setPage(1);
  }, [shipments, pageSize]);

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'success'
  ) => {
    setToast({ message, type, visible: true });
    setTimeout(() => {
      setToast(prev => (prev ? { ...prev, visible: false } : prev));
      setTimeout(() => setToast(null), 300);
    }, 4000);
  };

  const getStatusDescription = (status?: string | null) => {
    switch ((status || '').toUpperCase()) {
      case 'ANNOUNCED':
        return "Le bordereau d'expédition est créé mais le colis n'est pas encore expédié";
      case 'SHIPPED':
        return 'Le colis est soit récupéré par le transporteur, soit déposé dans un point de proximité';
      case 'IN_TRANSIT':
        return 'Le colis a été scanné par le transporteur et est en transit';
      case 'OUT_FOR_DELIVERY':
        return 'Le colis est en cours de livraison';
      case 'FAILED_ATTEMPT':
        return 'Quelque chose a empêché la livraison du colis';
      case 'REACHED_DELIVERY_PICKUP_POINT':
        return 'Le colis est disponible pour être récupéré dans un point de proximité';
      case 'DELIVERED':
        return 'Le colis a été livré au destinataire ou le destinataire a récupéré le colis dans un point de proximité';
      case 'RETURNED':
        return "Le colis est renvoyé à l'expéditeur";
      case 'EXCEPTION':
        return "Un problème est survenu pendant le transit qui nécessite une action de l'expéditeur";
      case 'PENDING':
        return "L'envoi est enregistré auprès de PayLive mais pas encore auprès du transporteur choisi";
      case 'REQUESTED':
        return "L'envoi est enregistré auprès du transporteur choisi";
      case 'CONFIRMED':
        return "L'envoi est confirmé par le transporteur et possède un bordereau d'expédition";
      case 'CANCELLED':
        return "L'envoi est annulé";
      default:
        return '';
    }
  };

  const getNetworkDescription = (code?: string | null) => {
    const c = (code || '').toUpperCase();
    const map: Record<string, string> = {
      'MONR-DOMICILEFRANCE': 'Mondial Relay - Domicile France',
      'COPR-COPRRELAISDOMICILENAT': 'Colis Privé - Domicile Sans Signature',
      'POFR-COLISSIMOACCESS': 'Colissimo - Domicile Sans Signature',
      'CHRP-CHRONO18': 'Chronopost - Chrono 18 (Express)',
      'SOGP-RELAISCOLIS': 'Relais Colis',
      'MONR-CPOURTOI': 'Mondial Relay',
      'CHRP-CHRONO2SHOPDIRECT': 'Chronopost',
      'COPR-COPRRELAISRELAISNAT': 'Colis Privé',
      STORE_PICKUP: 'Retrait en boutique',
    };
    return map[c] || code || '—';
  };

  const handleOpenContact = (s: Shipment) => {
    setSelectedShipment(s);
    setContactMessage('');
    setContactFile(null);
    setContactOpen(true);
  };

  const handleCloseContact = () => {
    setContactOpen(false);
    setSelectedShipment(null);
  };

  const handleSendContact = async () => {
    const msg = (contactMessage || '').trim();
    if (!msg) return;
    if (!selectedShipment?.shipment_id) return;
    try {
      setIsSendingContact(true);
      const token = await getToken();
      const fd = new FormData();
      fd.append('shipmentId', selectedShipment.shipment_id);
      fd.append('message', msg);
      if (contactFile) fd.append('attachment', contactFile);
      await apiPostForm('/api/support/customer-contact', fd, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      showToast('Message envoyé au propriétaire de la boutique', 'success');
      setContactOpen(false);
      setContactMessage('');
      setContactFile(null);
    } catch (e) {
      console.error('Contact propriétaire échoué:', e);
      showToast("Erreur lors de l'envoi du message", 'error');
    } finally {
      setIsSendingContact(false);
    }
  };

  const handleReturn = async (s: Shipment) => {
    if (!s.shipment_id) {
      setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
      return;
    }
    try {
      setReturnStatus(prev => ({ ...prev, [s.id]: 'loading' }));
      const token = await getToken();
      const url = `${apiBase}/api/boxtal/shipping-orders/${encodeURIComponent(
        s.shipment_id
      )}/return`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        setReturnStatus(prev => ({ ...prev, [s.id]: 'success' }));
        // Marquer localement la demande de retour comme envoyée pour désactiver le bouton
        setShipments(prev =>
          (prev || []).map(it =>
            it.id === s.id ? { ...it, return_requested: true } : it
          )
        );
        showToast('Demande de retour envoyée avec succès', 'success');
      } else {
        setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
        const msg =
          json?.error ||
          json?.message ||
          "Erreur lors de l'envoi de la demande";
        showToast(typeof msg === 'string' ? msg : "Erreur d'envoi", 'error');
      }
    } catch (e: any) {
      setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || "Erreur lors de l'envoi de la demande";
      showToast(
        typeof rawMsg === 'string' ? rawMsg : "Erreur d'envoi",
        'error'
      );
    }
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <Header />
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          visible={toast.visible !== false}
        />
      )}
      <div className='max-w-fit mx-auto px-4 py-8'>
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
              <div className='flex items-center justify-between mb-3 mt-1'>
                <div className='text-sm text-gray-600'>
                  Page {page} / {totalPages} — {(shipments || []).length}{' '}
                  commandes
                </div>
                <div className='flex items-center space-x-3'>
                  <label className='text-sm text-gray-700'>
                    Lignes par page
                  </label>
                  <select
                    value={pageSize}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      setPageSize(isNaN(v) ? 10 : v);
                      setPage(1);
                    }}
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                  <div className='flex items-center space-x-2'>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className={`px-3 py-1 text-sm rounded-md border ${
                        page <= 1
                          ? 'bg-gray-100 text-gray-400 border-gray-200'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Précédent
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className={`px-3 py-1 text-sm rounded-md border ${
                        page >= totalPages
                          ? 'bg-gray-100 text-gray-400 border-gray-200'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </div>
              <table className='w-full'>
                <thead>
                  <tr className='border-b border-gray-200'>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Date
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Boutique
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Référence produit
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Payé
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Méthode
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Statut
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      <div className='flex items-center space-x-2'>
                        <span>Estimée</span>
                        <button
                          onClick={() =>
                            setEstimatedSortOrder(o =>
                              o === 'asc' ? 'desc' : 'asc'
                            )
                          }
                          className='p-1 rounded hover:bg-gray-100'
                          title={`Trier ${estimatedSortOrder === 'asc' ? '↓' : '↑'}`}
                        >
                          <ArrowUpDown className='w-4 h-4 text-gray-600' />
                        </button>
                      </div>
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Réseau
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Point retrait
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Retour
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Contacter
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleShipments.map(s => (
                    <tr
                      key={s.id}
                      className='border-b border-gray-100 hover:bg-gray-50'
                    >
                      <td className='py-4 px-4 text-gray-700'>
                        {formatDate(s.created_at)}
                      </td>
                      <td className='py-4 px-4 text-gray-900'>
                        <div className='flex items-center space-x-2'>
                          {(() => {
                            const cloudBase = (
                              import.meta.env.VITE_CLOUDFRONT_URL ||
                              'https://d1tmgyvizond6e.cloudfront.net'
                            ).replace(/\/+$/, '');
                            const logoUrl = s.store_id
                              ? `${cloudBase}/images/${s.store_id}`
                              : null;
                            return logoUrl ? (
                              <img
                                src={logoUrl}
                                alt={s.store?.name || 'Boutique'}
                                className='w-6 h-6 rounded-full object-cover'
                              />
                            ) : (
                              <span className='inline-block w-6 h-6 rounded-full bg-gray-200' />
                            );
                          })()}
                          <span>{s.store?.name || '—'}</span>
                        </div>
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
                        <div className='space-y-1'>
                          <div className='font-medium'>{s.status || '—'}</div>
                          <div className='text-xs text-gray-500'>
                            {getStatusDescription(s.status)}
                          </div>
                          {s.tracking_url ? (
                            <a
                              href={s.tracking_url}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='text-blue-600 hover:underline'
                            >
                              Suivre
                            </a>
                          ) : (
                            <span />
                          )}
                        </div>
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {formatDate(s.estimated_delivery_date)}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {getNetworkDescription(s.delivery_network)}
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {s.pickup_point ? (
                          <div>
                            <strong>{s.pickup_point?.name}</strong>
                            <br />
                            {s.pickup_point?.street}
                            <br />
                            {s.pickup_point?.city} {s.pickup_point?.postal_code}{' '}
                            {s.pickup_point?.country}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className='py-4 px-4'>
                        <button
                          onClick={() => handleReturn(s)}
                          disabled={
                            !s.shipment_id ||
                            returnStatus[s.id] === 'loading' ||
                            !!s.return_requested ||
                            !s.is_final_destination
                          }
                          className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                            s.return_requested ||
                            returnStatus[s.id] === 'success'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : returnStatus[s.id] === 'error'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          title={
                            !s.shipment_id
                              ? 'Retour indisponible'
                              : s.return_requested
                                ? 'Demande déjà envoyée'
                                : 'Envoyer demande de retour'
                          }
                        >
                          <Undo2 className='h-4 w-4 mr-2' />
                          {returnStatus[s.id] === 'loading'
                            ? 'Envoi...'
                            : s.return_requested
                              ? 'Demande envoyée'
                              : returnStatus[s.id] === 'error'
                                ? 'Erreur'
                                : 'Demander le retour'}
                        </button>
                      </td>
                      <td className='py-4 px-4'>
                        <button
                          onClick={() => handleOpenContact(s)}
                          disabled={!s.shipment_id}
                          className={`px-3 py-2 rounded-md text-sm font-medium border ${
                            !s.shipment_id
                              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          title={!s.shipment_id ? 'Contact indisponible' : 'Contacter le propriétaire'}
                        >
                          Contacter
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {contactOpen && (
          <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4' onClick={handleCloseContact}>
            <div className='bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden' onClick={e => e.stopPropagation()}>
              <div className='p-4 border-b border-gray-200'>
                <h3 className='text-lg font-semibold text-gray-900'>Contacter le propriétaire</h3>
                {selectedShipment?.shipment_id && (
                  <p className='text-xs text-gray-600 mt-1'>Shipment: {selectedShipment.shipment_id}</p>
                )}
              </div>
              <div className='p-4 space-y-3'>
                <label className='block text-sm font-medium text-gray-700'>Message</label>
                <textarea
                  value={contactMessage}
                  onChange={e => setContactMessage(e.target.value)}
                  rows={5}
                  className='w-full border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500'
                  placeholder={'Expliquez votre demande concernant cette expédition…'}
                />
                <div className='space-y-2'>
                  <label className='block text-sm font-medium text-gray-700'>Pièce jointe (PDF/JPG/PNG) — optionnel</label>
                  <input
                    type='file'
                    accept='application/pdf,image/png,image/jpeg'
                    onChange={e => {
                      const file = e.target.files?.[0] || null;
                      setContactFile(file);
                    }}
                    className='block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100'
                  />
                  {contactFile && (
                    <p className='text-xs text-gray-500'>Fichier choisi: {contactFile.name}</p>
                  )}
                </div>
              </div>
              <div className='px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-2'>
                <button onClick={handleCloseContact} className='px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100'>Annuler</button>
                <button
                  onClick={handleSendContact}
                  disabled={isSendingContact || !contactMessage.trim()}
                  className={`inline-flex items-center px-4 py-2 rounded-md ${
                    isSendingContact || !contactMessage.trim() ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {isSendingContact && (
                    <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                  )}
                  Envoyer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
