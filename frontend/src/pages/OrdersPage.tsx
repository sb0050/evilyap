import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../components/Header';
import { Toast } from '../components/Toast';
import {
  Package,
  ArrowUpDown,
  SendHorizontal,
  RefreshCw,
  ExternalLink,
  ShoppingCart,
} from 'lucide-react';
import { Popover, Transition } from '@headlessui/react';
import { apiPostForm, API_BASE_URL } from '../utils/api';
import Spinner from '../components/Spinner';

type StoreAddress = {
  line1?: string;
  line2?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
};

type StoreInfo = {
  name: string;
  slug: string;
  address?: StoreAddress | null;
  website?: string | null;
  owner_email?: string | null;
  description?: string | null;
};

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
  weight: number | null;
  product_reference: string | null;
  description?: string | null;
  paid_value: number | null;
  created_at?: string | null;
  status?: string | null;
  estimated_delivery_date?: string | null;
  cancel_requested?: boolean | null;
  return_requested?: boolean | null;
  delivery_cost?: number | null;
  tracking_url?: string | null;
  store?: StoreInfo | null;
  is_final_destination?: boolean | null;
  promo_codes?: string | null;
  product_value?: number | null;
  estimated_delivery_cost?: number | null;
};

export default function OrdersPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadingOrders, setReloadingOrders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnStatus, setReturnStatus] = useState<
    Record<number, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  const [estimatedSortOrder, setEstimatedSortOrder] = useState<
    'asc' | 'desc' | null
  >(null);
  const [expandedCardIds, setExpandedCardIds] = useState<
    Record<number, boolean>
  >({});
  const [ordersFilterField, setOrdersFilterField] = useState<
    'store' | 'reference'
  >('store');
  const [ordersFilterTerm, setOrdersFilterTerm] = useState<string>('');
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
    visible?: boolean;
  } | null>(null);

  // État pour la popup de contact propriétaire
  const [contactOpen, setContactOpen] = useState<boolean>(false);
  const [contactMessage, setContactMessage] = useState<string>('');
  const [contactFile, setContactFile] = useState<File | null>(null);
  const [contactShipments, setContactShipments] = useState<Shipment[]>([]);
  const [isSendingContact, setIsSendingContact] = useState<boolean>(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(
    new Set()
  );

  const apiBase = API_BASE_URL;

  const normalizeWebsite = (url?: string | null) => {
    if (!url) return undefined;
    const trimmed = (url || '').trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const renderAddress = (a?: StoreAddress | null) => {
    if (!a) return '—';
    const parts = [
      a.line1,
      a.line2,
      [a.postal_code, a.city].filter(Boolean).join(' '),
      a.country,
    ]
      .filter(Boolean)
      .map(p => (Array.isArray(p) ? p.filter(Boolean).join(' ') : p));
    return parts.length ? parts.join('\n') : '—';
  };

  // Composant Popover positionné en dehors du tableau via CSS `position: fixed`
  function StoreInfoPopover({
    s,
    preferUpwards = false,
  }: {
    s: Shipment;
    preferUpwards?: boolean;
  }) {
    const [pos, setPos] = useState<{ top: number; left: number }>({
      top: 0,
      left: 0,
    });
    const computePos = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const panelWidth = 320; // ~w-80
      const margin = 8; // espace sous le bouton
      const maxLeft = window.innerWidth - panelWidth - margin;
      const left = Math.max(margin, Math.min(rect.left, maxLeft));
      const guessHeight = 220; // estimation pour affichage vers le haut
      const topDown = rect.bottom + margin;
      const topUp = Math.max(margin, rect.top - guessHeight - margin);
      const top = preferUpwards ? topUp : topDown;
      setPos({ top, left });
    };

    return (
      <Popover className='relative mt-1 inline-block'>
        <Popover.Button
          onClick={e => computePos(e.currentTarget)}
          className='text-xs text-blue-600 hover:underline'
        >
          +infos
        </Popover.Button>
        <Transition
          enter='transition ease-out duration-150'
          enterFrom='opacity-0 translate-y-1'
          enterTo='opacity-100 translate-y-0'
          leave='transition ease-in duration-100'
          leaveFrom='opacity-100 translate-y-0'
          leaveTo='opacity-0 translate-y-1'
        >
          {/* On ne rend le Panel que lorsqu'il est ouvert */}
          <Popover.Panel
            style={{ top: pos.top, left: pos.left, position: 'fixed' }}
            className='mt-0 w-80 rounded-md border border-gray-200 bg-white shadow-lg p-3 z-50'
          >
            <div className='flex items-start gap-2'>
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
                    className='w-10 h-10 rounded object-cover'
                  />
                ) : (
                  <span className='inline-block w-10 h-10 rounded bg-gray-200' />
                );
              })()}
              <div className='flex-1'>
                <div className='font-semibold text-gray-900 truncate'>
                  {s.store?.name || '—'}
                </div>
                <div className='text-xs text-gray-600 mt-1'>
                  {s.store?.description || ''}
                </div>
              </div>
            </div>
            <div className='mt-3 space-y-2 text-sm'>
              <div>
                <div className='text-gray-500'>Adresse</div>
                <div className='whitespace-pre-line text-gray-900'>
                  {renderAddress(s.store?.address ?? null)}
                </div>
              </div>
              <div>
                <div className='text-gray-500'>Site web</div>
                {(() => {
                  const href = normalizeWebsite(s.store?.website ?? undefined);
                  return href ? (
                    <a
                      href={href}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-blue-600 hover:underline'
                    >
                      {s.store?.website}
                    </a>
                  ) : (
                    <span className='text-gray-900'>—</span>
                  );
                })()}
              </div>
              <div>
                <div className='text-gray-500'>Email</div>
                <div className='text-gray-900'>
                  {s.store?.owner_email || '—'}
                </div>
              </div>
              <div>
                <div className='text-gray-500'>Téléphone</div>
                <div className='text-gray-900'>
                  {s.store?.address?.phone || '—'}
                </div>
              </div>
            </div>
            <div className='mt-3'>
              {s.store?.slug ? (
                <a
                  href={`/checkout/${encodeURIComponent(s.store.slug)}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='inline-flex items-center px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-sm'
                >
                  Passer une autre commande
                  <ExternalLink className='w-4 h-4 ml-2' />
                </a>
              ) : (
                <span />
              )}
            </div>
          </Popover.Panel>
        </Transition>
      </Popover>
    );
  }

  // Popover Headless UI gère la fermeture extérieure et via Esc

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
        )}`;
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
  }, [user]);

  const handleRefreshOrders = async () => {
    try {
      setReloadingOrders(true);
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
      )}`;
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
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      setError(msg);
    } finally {
      setReloadingOrders(false);
    }
  };

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

  const parseProductReferenceItems = (raw: string | null | undefined) => {
    const txt = String(raw || '').trim();
    if (!txt)
      return [] as Array<{
        reference: string;
        quantity: number;
        description?: string | null;
      }>;
    const parts = txt
      .split(';')
      .map(s => String(s || '').trim())
      .filter(Boolean);

    const m = new Map<
      string,
      { quantity: number; description?: string | null }
    >();
    for (const p of parts) {
      const seg = String(p || '').trim();
      if (!seg) continue;

      let reference = '';
      let quantity = 1;
      let description: string | null = null;

      if (seg.includes('**')) {
        const [refRaw, restRaw] = seg.split('**');
        reference = String(refRaw || '').trim();
        const rest = String(restRaw || '').trim();
        const match = rest.match(/^(\d+)\s*(?:\((.*)\))?$/);
        if (match) {
          const qNum = Number(match[1]);
          quantity = Number.isFinite(qNum) && qNum > 0 ? Math.round(qNum) : 1;
          const d = String(match[2] || '').trim();
          description = d || null;
        } else {
          const qNum = Number(rest);
          quantity = Number.isFinite(qNum) && qNum > 0 ? Math.round(qNum) : 1;
        }
      } else {
        const match = seg.match(/^(.+?)\s*\((.*)\)\s*$/);
        if (match) {
          reference = String(match[1] || '').trim();
          const d = String(match[2] || '').trim();
          description = d || null;
        } else {
          reference = seg;
        }
      }

      if (!reference) continue;
      const prev = m.get(reference) || { quantity: 0, description: null };
      m.set(reference, {
        quantity: prev.quantity + quantity,
        description: prev.description || description || null,
      });
    }

    return Array.from(m.entries()).map(([reference, info]) => ({
      reference,
      quantity: info.quantity,
      description: info.description || null,
    }));
  };

  type ProductItem = {
    reference: string;
    quantity: number;
    description?: string | null;
  };

  const getShipmentProductItems = (s: Shipment): ProductItem[] =>
    parseProductReferenceItems(s.product_reference).map(it => ({
      reference: it.reference,
      quantity: it.quantity,
      description: it.description || null,
    }));

  const formatShipmentProductReference = (s: Shipment) => {
    const items = getShipmentProductItems(s);
    if (items.length === 0) return '—';
    return items.map(it => `${it.reference}(x${it.quantity})`).join(', ');
  };

  const renderShipmentProductReference = (s: Shipment) => {
    const items = getShipmentProductItems(s);
    if (items.length === 0) return '—';
    return (
      <div className='space-y-2'>
        {items.map((it, idx) => {
          const d = String(it.description || '').trim();
          return (
            <div key={`${s.id}-${idx}`} className='space-y-0.5'>
              <div
                className='font-medium truncate max-w-[280px]'
                title={`${it.reference}(x${it.quantity})`}
              >
                {it.reference}(x{it.quantity})
              </div>
              {d ? (
                <div
                  className='text-xs text-gray-500 truncate max-w-[280px]'
                  title={d}
                >
                  {d}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  // Tri par date estimée (prochain colis)
  const sortedShipments = (() => {
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
    let arr = [...(shipments || [])];
    const term = (ordersFilterTerm || '').trim().toLowerCase();
    if (term) {
      if (ordersFilterField === 'store') {
        arr = arr.filter(s =>
          (s.store?.name || '').toLowerCase().includes(term)
        );
      } else {
        arr = arr.filter(s =>
          (s.product_reference || '').toLowerCase().includes(term)
        );
      }
    }
    if (estimatedSortOrder) {
      arr.sort((a, b) => {
        const ta = toTime(a.estimated_delivery_date);
        const tb = toTime(b.estimated_delivery_date);
        return estimatedSortOrder === 'asc' ? ta - tb : tb - ta;
      });
    }
    return arr;
  })();

  // Pagination helpers
  const totalPages = Math.max(1, Math.ceil(sortedShipments.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const visibleShipments = sortedShipments.slice(
    startIndex,
    startIndex + pageSize
  );
  const selectedOrders = (shipments || []).filter(s =>
    selectedOrderIds.has(s.id)
  );
  const selectedForReturn = selectedOrders.filter(
    s =>
      s.shipment_id &&
      !s.return_requested &&
      !!s.is_final_destination &&
      returnStatus[s.id] !== 'loading'
  );
  const selectedForContact = selectedOrders.filter(s => !!s.shipment_id);
  const visibleOrderIds = visibleShipments.map(s => s.id);
  const allVisibleSelected =
    visibleOrderIds.length > 0 &&
    visibleOrderIds.every(id => selectedOrderIds.has(id));
  const toggleOrderSelection = (id: number) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleOrderIds.forEach(id => next.delete(id));
      } else {
        visibleOrderIds.forEach(id => next.add(id));
      }
      return next;
    });
  };
  const mobileOrderIds = sortedShipments.map(s => s.id);
  const allMobileSelected =
    mobileOrderIds.length > 0 &&
    mobileOrderIds.every(id => selectedOrderIds.has(id));
  const toggleSelectAllMobile = () => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (allMobileSelected) {
        mobileOrderIds.forEach(id => next.delete(id));
      } else {
        mobileOrderIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  useEffect(() => {
    const filteredLength = (() => {
      const term = (ordersFilterTerm || '').trim().toLowerCase();
      if (!term) return (shipments || []).length;
      return (shipments || []).filter(s => {
        if (ordersFilterField === 'store') {
          return (s.store?.name || '').toLowerCase().includes(term);
        }
        return (s.product_reference || '').toLowerCase().includes(term);
      }).length;
    })();
    const newTotal = Math.max(1, Math.ceil(filteredLength / pageSize));
    if (page > newTotal) setPage(newTotal);
    if (page < 1) setPage(1);
  }, [shipments, pageSize, ordersFilterField, ordersFilterTerm]);

  useEffect(() => {
    setSelectedOrderIds(prev => {
      const validIds = new Set((shipments || []).map(s => s.id));
      const next = new Set<number>();
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [shipments]);

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
      //BELGIQUE
      'MONR-DOMICILEEUROPE': 'Mondial Relay - Mondial Domicile Europe',
      'CHRP-CHRONOINTERNATIONALCLASSIC':
        'Chronopost - Chrono International Classic',
      'DLVG-DELIVENGOOEASY': 'Delivengo - Delivengo Easy',
      'MONR-CPOURTOIEUROPE': 'Mondial Relay',
      'CHRP-CHRONO2SHOPEUROPE': 'Chronopost',
      STORE_PICKUP: 'Retrait en boutique',
    };
    return map[c] || code || '—';
  };

  const renderNetwork = (s: Shipment) => {
    const network = getNetworkDescription(s.delivery_network);
    if (String(s.delivery_method || '') !== 'pickup_point') return network;
    const p: any = s.pickup_point || null;
    const name = String(p?.name || '').trim();
    const street = String(p?.street || p?.line1 || '').trim();
    const city = String(p?.city || '').trim();
    const postal = String(p?.postal_code || p?.postalCode || '').trim();
    const country = String(p?.country || p?.countryIsoCode || '').trim();
    const line3 = [city, postal, country].filter(Boolean).join(' ');
    const lines = [name, street, line3].filter(Boolean);
    if (lines.length === 0) return network;
    return (
      <span>
        {network}{' '}
        <span>
          (
          {lines.map((l, i) => (
            <span key={`${s.id}-pp-${i}`}>
              {l}
              {i < lines.length - 1 ? <br /> : null}
            </span>
          ))}
          )
        </span>
      </span>
    );
  };

  const handleOpenContact = (s?: Shipment | Shipment[]) => {
    const list = Array.isArray(s) ? s : s ? [s] : selectedForContact;
    const effective = (list || []).filter(it => !!it?.shipment_id);
    if (effective.length === 0) {
      showToast('Sélectionnez au moins une commande', 'error');
      return;
    }
    setContactShipments(effective);
    setContactMessage('');
    setContactFile(null);
    setContactOpen(true);
  };

  const handleCloseContact = () => {
    setContactOpen(false);
    setContactShipments([]);
  };

  const handleSendContact = async () => {
    const msg = (contactMessage || '').trim();
    if (!msg) return;
    if (contactShipments.length === 0) return;
    try {
      setIsSendingContact(true);
      const token = await getToken();
      const references: string[] = [];
      for (const s of contactShipments) {
        if (!s?.shipment_id) continue;
        const fd = new FormData();
        fd.append('shipmentId', s.shipment_id);
        fd.append('message', msg);
        if (contactFile) fd.append('attachment', contactFile);
        await apiPostForm('/api/support/customer-contact', fd, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        const ref = String(s.product_reference || s.shipment_id || '').trim();
        references.push(ref || String(s.shipment_id));
      }
      if (references.length === 0) {
        showToast("Aucune commande n'a été traitée", 'error');
        return;
      }
      const toastMsg =
        references.length <= 3
          ? `Messages envoyés pour : ${references.join(', ')}`
          : `Messages envoyés pour ${references.length} références (${references
              .slice(0, 3)
              .join(', ')}...)`;
      showToast(toastMsg, 'success');
      setContactOpen(false);
      setContactMessage('');
      setContactFile(null);
      setContactShipments([]);
    } catch (e) {
      console.error('Contact propriétaire échoué:', e);
      showToast("Erreur lors de l'envoi du message", 'error');
    } finally {
      setIsSendingContact(false);
    }
  };

  const handleReturn = async (s: Shipment, options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!s.shipment_id) {
      setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
      return false;
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
        if (!silent) {
          showToast('Demande de retour envoyée avec succès', 'success');
        }
        return true;
      } else {
        setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
        const msg =
          json?.error ||
          json?.message ||
          "Erreur lors de l'envoi de la demande";
        if (!silent) {
          showToast(typeof msg === 'string' ? msg : "Erreur d'envoi", 'error');
        }
        return false;
      }
    } catch (e: any) {
      setReturnStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || "Erreur lors de l'envoi de la demande";
      if (!silent) {
        showToast(
          typeof rawMsg === 'string' ? rawMsg : "Erreur d'envoi",
          'error'
        );
      }
      return false;
    }
  };

  const handleBatchReturn = async () => {
    if (selectedForReturn.length === 0) {
      showToast('Aucune commande sélectionnée pour le retour', 'error');
      return;
    }
    const references: string[] = [];
    for (const s of selectedForReturn) {
      const ok = await handleReturn(s, { silent: true });
      if (ok) {
        const ref = String(s.product_reference || s.shipment_id || '').trim();
        references.push(ref || String(s.shipment_id));
      }
    }
    if (references.length === 0) {
      showToast(
        'Aucune commande traitée pour le retour. Vérifiez l’éligibilité des commandes sélectionnées.',
        'info'
      );
      return;
    }
    const msg =
      references.length <= 3
        ? `Retours demandés pour : ${references.join(', ')}`
        : `Retours demandés pour ${references.length} références (${references
            .slice(0, 3)
            .join(', ')}...)`;
    showToast(msg, 'success');
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
      <div className='max-w-fit mx-auto px-4 py-1'>
        <div className='text-center mb-6 sm:m'>
          <Package className='hidden sm:block h-12 w-12 text-amber-600 mx-auto mb-4' />
          <h1 className='hidden sm:block text-xl sm:text-3xl font-bold text-gray-900 mb-2'>
            Suivi de mes commandes
          </h1>
        </div>

        <div className='bg-white rounded-lg shadow-md p-6'>
          {loading ? (
            <Spinner
              size='lg'
              color='blue'
              variant='bottom'
              className='mx-auto mb-4'
            />
          ) : error ? (
            <div className='text-center py-12'>
              <p className='text-red-600'>{error}</p>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <div className='hidden sm:flex items-center justify-between mb-3 mt-1'>
                <div className='text-sm text-gray-600 flex items-center gap-3'>
                  <span>
                    Page {page} / {totalPages} — {(shipments || []).length}{' '}
                    commandes
                  </span>
                  <span className='text-gray-400'>—</span>
                  <span className='inline-flex items-center gap-2 whitespace-nowrap'>
                    <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-semibold text-gray-700'>
                      {selectedOrders.length}
                    </span>
                    <span>
                      élément{selectedOrders.length > 1 ? 's' : ''} sélectionné
                      {selectedOrders.length > 1 ? 's' : ''}
                    </span>
                  </span>
                </div>
                <div className='flex items-center space-x-3'>
                  <button
                    onClick={handleRefreshOrders}
                    disabled={reloadingOrders}
                    className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-1 ${reloadingOrders ? 'animate-spin' : ''}`}
                    />
                    <span>Recharger</span>
                  </button>
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
                  <div className='flex items-center space-x-2'>
                    <span className='text-sm text-gray-700'>Filtrer par</span>
                    <select
                      value={ordersFilterField}
                      onChange={e => {
                        const v = e.target.value as 'store' | 'reference';
                        setOrdersFilterField(v);
                        setPage(1);
                      }}
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                    >
                      <option value='store'>Boutique</option>
                      <option value='reference'>Référence produit</option>
                    </select>
                    <input
                      type='text'
                      value={ordersFilterTerm}
                      onChange={e => {
                        setOrdersFilterTerm(e.target.value);
                        setPage(1);
                      }}
                      placeholder='Saisir…'
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                  </div>
                </div>
              </div>
              {/* Entête mobile: titre + logo à gauche, bouton Recharger à droite */}
              <div className='flex sm:hidden items-center justify-between mb-3 mt-1'>
                <div className='flex items-center'>
                  <Package className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Mes commandes
                  </h2>
                </div>
                <button
                  onClick={handleRefreshOrders}
                  disabled={reloadingOrders}
                  className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                  title='Recharger les commandes'
                >
                  <RefreshCw
                    className={`w-4 h-4 mr-1 ${reloadingOrders ? 'animate-spin' : ''}`}
                  />
                  <span>Recharger</span>
                </button>
              </div>

              <div className='sm:hidden mb-3'>
                <div className='flex items-center space-x-2 flex-wrap'>
                  <span className='text-sm text-gray-700'>Filtrer par</span>
                  <select
                    value={ordersFilterField}
                    onChange={e => {
                      const v = e.target.value as 'store' | 'reference';
                      setOrdersFilterField(v);
                      setPage(1);
                    }}
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36'
                  >
                    <option value='store'>Boutique</option>
                    <option value='reference'>Référence produit</option>
                  </select>
                  <input
                    type='text'
                    value={ordersFilterTerm}
                    onChange={e => {
                      setOrdersFilterTerm(e.target.value);
                      setPage(1);
                    }}
                    placeholder='Saisir…'
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0 w-full'
                  />
                </div>
              </div>

              <div className='mb-4 flex flex-wrap items-center gap-2'>
                <button
                  onClick={handleBatchReturn}
                  disabled={selectedForReturn.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedForReturn.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title='Demander le retour'
                >
                  Demander le retour
                </button>
                <button
                  onClick={() => handleOpenContact(selectedForContact)}
                  disabled={selectedForContact.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedForContact.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title='Contacter la boutique'
                >
                  Contacter la boutique
                </button>
              </div>

              <div className='sm:hidden mb-2 flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={allMobileSelected}
                  onChange={toggleSelectAllMobile}
                  className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                />
                <span className='text-sm text-gray-700'>Tout sélectionner</span>
              </div>

              {/* Vue mobile: cartes accordéon */}
              <div className='block sm:hidden space-y-3'>
                {sortedShipments.map((s, idx) => (
                  <div
                    key={s.id}
                    className='rounded-lg border border-gray-200 bg-white p-3 shadow-sm'
                  >
                    <div className='flex items-start justify-between'>
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
                        <div>
                          <div className='text-sm font-semibold text-gray-900 truncate'>
                            {s.store?.name || '—'}
                          </div>
                          <div className='text-xs text-gray-600'>
                            {formatDate(s.created_at)}
                          </div>
                          <StoreInfoPopover
                            s={s}
                            preferUpwards={idx >= sortedShipments.length - 3}
                          />
                        </div>
                      </div>
                      <div className='flex items-center gap-2'>
                        <input
                          type='checkbox'
                          checked={selectedOrderIds.has(s.id)}
                          onChange={() => toggleOrderSelection(s.id)}
                          className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                        />
                        <div className='text-sm font-semibold text-gray-900'>
                          {formatValue(s.paid_value)}
                        </div>
                      </div>
                    </div>

                    <div className='mt-3 text-sm text-gray-700'>
                      <div>
                        <span className='font-medium'>Référence:</span>{' '}
                        {renderShipmentProductReference(s)}
                      </div>
                      <div>
                        <span className='font-medium'>Statut:</span>{' '}
                        {s.status || '—'}
                      </div>
                      <div>
                        <span className='font-medium'>Méthode:</span>{' '}
                        {formatMethod(s.delivery_method)}
                      </div>
                    </div>

                    <div className='mt-3 flex items-center justify-between'>
                      <div className='text-xs text-gray-600'>
                        Estimée: {formatDate(s.estimated_delivery_date)}
                      </div>
                      <button
                        onClick={() =>
                          setExpandedCardIds(prev => ({
                            ...prev,
                            [s.id]: !prev[s.id],
                          }))
                        }
                        className='px-2 py-1 rounded-md text-xs border bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        aria-expanded={Boolean(expandedCardIds[s.id])}
                      >
                        {expandedCardIds[s.id] ? 'Voir moins' : 'Voir plus'}
                      </button>
                    </div>

                    {/* Bloc extensible — toujours présent dans le DOM */}
                    <div
                      className={`mt-3 space-y-2 text-sm transition-all duration-300 overflow-hidden ${
                        expandedCardIds[s.id]
                          ? 'max-h-[1000px] opacity-100'
                          : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div>
                        <span className='font-medium'>
                          Explication du statut:
                        </span>{' '}
                        <span className='text-gray-600'>
                          {getStatusDescription(s.status)}
                        </span>
                      </div>

                      <div>
                        <span className='font-medium'>Réseau:</span>{' '}
                        {renderNetwork(s)}
                      </div>

                      <div className='flex items-center gap-2'>
                        {s.tracking_url ? (
                          <a
                            href={s.tracking_url}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-blue-600 hover:underline text-xs'
                          >
                            Suivre la commande
                          </a>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Vue bureau: tableau */}
              <table className='w-full hidden sm:table'>
                <thead>
                  <tr className='border-b border-gray-200'>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      <input
                        type='checkbox'
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                      />
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Date
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Boutique
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Référence Produit
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Payé
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Statut
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      <div className='flex items-center space-x-2'>
                        <span>Livraison</span>
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
                      Méthode
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Réseau
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleShipments.map((s, idx) => (
                    <tr
                      key={s.id}
                      className='border-b border-gray-100 hover:bg-gray-50'
                    >
                      <td className='py-4 px-4 text-gray-700'>
                        <input
                          type='checkbox'
                          checked={selectedOrderIds.has(s.id)}
                          onChange={() => toggleOrderSelection(s.id)}
                          className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                        />
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {formatDate(s.created_at)}
                      </td>
                      <td className='py-4 px-4 text-gray-900 relative'>
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
                        <StoreInfoPopover
                          s={s}
                          preferUpwards={idx >= visibleShipments.length - 3} // Ajuster la position si le popover est en bas pour les deux dernières lignes
                        />
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {renderShipmentProductReference(s)}
                      </td>
                      <td className='py-4 px-4 text-gray-900 font-semibold'>
                        {formatValue(s.paid_value)}
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
                        <div className='flex items-center space-x-2'>
                          <span>{formatMethod(s.delivery_method)}</span>
                        </div>
                      </td>
                      <td className='py-4 px-4 text-gray-700'>
                        {renderNetwork(s)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Popover Headless UI gère son propre backdrop virtuel (clic extérieur) */}
        {contactOpen && (
          <div
            className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'
            onClick={handleCloseContact}
          >
            <div
              className='bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden'
              onClick={e => e.stopPropagation()}
            >
              <div className='p-4 border-b border-gray-200'>
                <h3 className='text-lg font-semibold text-gray-900'>
                  Contacter la boutique
                </h3>
                <p className='text-xs text-gray-600 mt-1'>
                  Commandes sélectionnées: {contactShipments.length}
                </p>
              </div>
              <div className='p-4 space-y-3'>
                <div className='rounded-md border border-gray-200 bg-gray-50 p-3'>
                  <div className='text-sm font-semibold text-gray-900'>
                    Commandes concernées
                  </div>
                  <div className='mt-2 max-h-40 overflow-auto space-y-2'>
                    {contactShipments.map(s => (
                      <div
                        key={s.id}
                        className='rounded-md border border-gray-200 bg-white p-2'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <div className='text-sm font-medium text-gray-900 truncate'>
                              {s.store?.name || '—'}
                            </div>
                            <div className='text-xs text-gray-600'>
                              Réf: {formatShipmentProductReference(s)}
                            </div>
                            <div className='text-xs text-gray-600'>
                              Shipment: {s.shipment_id || '—'}
                            </div>
                          </div>
                          <div className='text-right'>
                            <div className='text-xs font-semibold text-gray-900'>
                              {formatValue(s.paid_value)}
                            </div>
                            <div className='text-xs text-gray-600'>
                              {s.status || '—'}
                            </div>
                            {s.tracking_url ? (
                              <a
                                href={s.tracking_url}
                                target='_blank'
                                rel='noopener noreferrer'
                                className='text-xs text-blue-600 hover:underline'
                              >
                                Suivre
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <div className='mt-2 flex items-center justify-between text-xs text-gray-600'>
                          <span>Créée: {formatDate(s.created_at)}</span>
                          <span>
                            Estimée: {formatDate(s.estimated_delivery_date)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <label className='block text-sm font-medium text-gray-700'>
                  Message
                </label>
                <textarea
                  value={contactMessage}
                  onChange={e => setContactMessage(e.target.value)}
                  rows={5}
                  className='w-full border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500'
                  placeholder={
                    'Expliquez votre demande concernant cette/ces expédition(s)…'
                  }
                />
                <div className='space-y-2'>
                  <label className='block text-sm font-medium text-gray-700'>
                    Pièce jointe (PDF/JPG/PNG) — optionnel
                  </label>
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
                    <p className='text-xs text-gray-500'>
                      Fichier choisi: {contactFile.name}
                    </p>
                  )}
                </div>
              </div>
              <div className='px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-2'>
                <button
                  onClick={handleCloseContact}
                  className='px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100'
                >
                  Annuler
                </button>
                <button
                  onClick={handleSendContact}
                  disabled={isSendingContact || !contactMessage.trim()}
                  className={`inline-flex items-center px-4 py-2 rounded-md ${
                    isSendingContact || !contactMessage.trim()
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {isSendingContact && (
                    <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                  )}
                  Envoyer
                  <SendHorizontal className='w-4 h-4 ml-2' />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
