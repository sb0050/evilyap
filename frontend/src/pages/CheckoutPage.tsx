import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  useStripe,
  useElements,
  AddressElement,
} from '@stripe/react-stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { useAuth, useUser } from '@clerk/clerk-react';
import {
  ShoppingBag,
  MapPin,
  User,
  ExternalLink,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Edit,
  ShoppingCart,
  BadgeCheck,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';
import ParcelPointMap from '../components/ParcelPointMap';
import { ParcelPointData } from '../components/ParcelPointMap';
import { apiPost, API_BASE_URL } from '../utils/api';
import { Address } from '@stripe/stripe-js';
import Header from '../components/Header';
import { Toast } from '../components/Toast';
import Modal from '../components/Modal';
import { search } from 'fast-fuzzy';

interface Store {
  id: number;
  name: string;
  slug: string;
  description: string;
  theme: string;
  owner_email: string;
  stripe_id?: string;
  website?: string;
  is_verified?: boolean;
  address?: {
    city?: string;
    line1?: string;
    line2?: string;
    country?: string;
    postal_code?: string;
    phone?: string;
  } | null;
}

interface CustomerData {
  id?: string;
  name?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  shipping?: any;
  delivery_method?: 'home_delivery' | 'pickup_point' | 'store_pickup';
  parcel_point?: any;
  metadata?: any;
}

type CartItem = {
  id: number;
  product_reference: string;
  value: number;
  quantity?: number;
  weight?: number;
  product_stripe_id?: string;
  created_at?: string;
  description?: string;
  payment_id?: string | null;
};

export default function CheckoutPage() {
  const { storeName } = useParams<{ storeName: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useUser();
  const { getToken } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [customerDetailsLoaded, setCustomerDetailsLoaded] = useState(false);
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState('');
  const [amount, setAmount] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    reference: '',
    description: '',
  });
  const [address, setAddress] = useState<Address>();
  const [selectedParcelPoint, setSelectedParcelPoint] =
    useState<ParcelPointData | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<
    'home_delivery' | 'pickup_point' | 'store_pickup'
  >('pickup_point');
  const [isFormValid, setIsFormValid] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [email, setEmail] = useState('');
  const [showDelivery, setShowDelivery] = useState(false);
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');
  const [cartItemsForStore, setCartItemsForStore] = useState<CartItem[]>([]);
  const [cartTotalForStore, setCartTotalForStore] = useState<number>(0);
  const [cartStockByRefKey, setCartStockByRefKey] = useState<
    Record<string, any>
  >({});
  const [cartStockLoading, setCartStockLoading] = useState(false);

  const [storePickupAddress, setStorePickupAddress] = useState<
    Address | undefined
  >();
  const [storePickupPhone, setStorePickupPhone] = useState<
    string | undefined
  >();

  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
    visible?: boolean;
  } | null>(null);
  const [shipmentCartRebuilt, setShipmentCartRebuilt] = useState(false);
  const [reloadingCart, setReloadingCart] = useState(false);
  const [openShipmentInitHandled, setOpenShipmentInitHandled] = useState(false);
  const [openShipmentBlockModalOpen, setOpenShipmentBlockModalOpen] =
    useState(false);
  const [openShipmentBlockShipmentId, setOpenShipmentBlockShipmentId] =
    useState('');
  const [openShipmentBlockPaymentId, setOpenShipmentBlockPaymentId] =
    useState('');
  const [openShipmentAttemptPaymentId, setOpenShipmentAttemptPaymentId] =
    useState('');
  const [openShipmentEditingShipmentId, setOpenShipmentEditingShipmentId] =
    useState('');
  const [openShipmentActionLoading, setOpenShipmentActionLoading] =
    useState(false);
  const [tempCreditBalanceCents, setTempCreditBalanceCents] = useState(0);
  const [createdCreditCouponId, setCreatedCreditCouponId] = useState('');
  const [createdCreditPromotionCodeId, setCreatedCreditPromotionCodeId] =
    useState('');

  // useEffect de debug pour surveiller selectedParcelPoint
  useEffect(() => {
    // Debug supprimé
  }, [selectedParcelPoint, deliveryMethod, isFormValid]);

  // Alimente automatiquement la référence avec les références agrégées du panier
  // Désactivé: ne pas écraser la saisie manuelle de la référence
  // Les valeurs agrégées seront affichées uniquement dans le récapitulatif

  // Alimente automatiquement le montant avec le total du panier
  // Désactivé: ne pas écraser la saisie manuelle du montant
  // Le total agrégé du panier sera affiché uniquement dans le récapitulatif

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'error'
  ) => {
    setToast({ message, type, visible: true });
    setTimeout(() => {
      setToast(prev => (prev ? { ...prev, visible: false } : prev));
      setTimeout(() => setToast(null), 300);
    }, 4000);
  };

  const getRefKey = (ref: string) =>
    String(ref || '')
      .trim()
      .toLowerCase();

  const fetchStockSearchExactMatch = async (
    storeSlug: string,
    ref: string
  ): Promise<any | null> => {
    const slug = String(storeSlug || '').trim();
    const q = String(ref || '').trim();
    if (!slug || q.length < 2) return null;
    const resp = await fetch(
      `${API_BASE_URL}/api/stores/${encodeURIComponent(
        slug
      )}/stock/search?q=${encodeURIComponent(q)}`
    );
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null as any);
    const items = Array.isArray(json?.items) ? json.items : [];
    const qKey = q.toLowerCase();
    const exact = items.find((it: any) => {
      const r = String(it?.stock?.product_reference || '')
        .trim()
        .toLowerCase();
      return r === qKey;
    });
    return exact || null;
  };

  const refreshCartForStore = async () => {
    const apiBase = API_BASE_URL;
    try {
      setReloadingCart(true);
      const userEmail = user?.primaryEmailAddress?.emailAddress;
      if (!userEmail || !store?.id) return;
      const resp = await fetch(
        `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(userEmail)}`
      );
      if (!resp.ok) return;
      const json = await resp.json();
      const stripeId = json?.customer?.id;
      if (!stripeId) return;
      setStripeCustomerId(stripeId);
      const paymentId = String(searchParams.get('payment_id') || '').trim();
      const cartResp = await fetch(
        `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(
          stripeId
        )}${paymentId ? `&paymentId=${encodeURIComponent(paymentId)}` : ''}`
      );
      if (!cartResp.ok) return;
      const cartJson = await cartResp.json();
      const groups = Array.isArray(cartJson?.itemsByStore)
        ? cartJson.itemsByStore
        : [];
      const groupForStore = groups.find(
        (g: any) => g?.store?.id && store?.id && g.store.id === store.id
      );
      if (groupForStore) {
        setCartItemsForStore(groupForStore.items || []);
        setCartTotalForStore(Number(groupForStore.total || 0));
      } else {
        setCartItemsForStore([]);
        setCartTotalForStore(0);
      }
    } catch (_e) {
    } finally {
      setReloadingCart(false);
    }
  };

  useEffect(() => {
    const storeSlug = String(store?.slug || '').trim();
    if (!storeSlug) return;
    const refs = Array.from(
      new Set(
        (cartItemsForStore || [])
          .map(it => String(it.product_reference || '').trim())
          .filter(Boolean)
      )
    );
    if (refs.length === 0) return;

    const missing = refs.filter(ref => {
      const key = getRefKey(ref);
      return !Object.prototype.hasOwnProperty.call(cartStockByRefKey, key);
    });
    if (missing.length === 0) return;

    let cancelled = false;
    const run = async () => {
      setCartStockLoading(true);
      try {
        const maxConcurrent = 4;
        let idx = 0;
        const results: Array<{ key: string; item: any | null }> = [];

        const workers = new Array(Math.min(maxConcurrent, missing.length))
          .fill(null)
          .map(async () => {
            while (idx < missing.length) {
              const current = idx++;
              const ref = missing[current];
              const key = getRefKey(ref);
              try {
                const item = await fetchStockSearchExactMatch(storeSlug, ref);
                results.push({ key, item });
              } catch {
                results.push({ key, item: null });
              }
            }
          });

        await Promise.all(workers);
        if (cancelled) return;

        setCartStockByRefKey(prev => {
          const next = { ...prev };
          for (const r of results) {
            next[r.key] = r.item;
          }
          return next;
        });
      } finally {
        if (!cancelled) setCartStockLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [store?.slug, cartItemsForStore, cartStockByRefKey]);

  const clearOpenShipmentParams = () => {
    try {
      const next = new URLSearchParams(searchParams);
      next.delete('open_shipment');
      next.delete('payment_id');
      setSearchParams(next, { replace: true });
    } catch {}
  };

  const openShipmentByPayment = async (paymentId: string, force: boolean) => {
    const apiBase = API_BASE_URL;
    const token = await getToken();
    const resp = await fetch(
      `${apiBase}/api/shipments/open-shipment-by-payment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ paymentId, storeId: store?.id, force }),
      }
    );
    const json = await resp.json().catch(() => null as any);
    return { resp, json };
  };

  const deleteCreditCoupon = async (couponId: string) => {
    const cid = String(couponId || '').trim();
    if (!cid) return { resp: null as any, json: null as any };
    const apiBase = API_BASE_URL;
    const token = await getToken();
    const resp = await fetch(`${apiBase}/api/stripe/delete-coupon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ couponId: cid }),
    });
    const json = await resp.json().catch(() => null as any);
    return { resp, json };
  };

  const rebuildCartFromPayment = async (paymentId: string) => {
    const apiBase = API_BASE_URL;
    const token = await getToken();

    const computeTotal = (items: any[]) =>
      (items || []).reduce(
        (sum: number, it: any) =>
          sum + Number(it?.value || 0) * Math.max(1, Number(it?.quantity || 1)),
        0
      );

    const resolveStripeId = async (): Promise<string> => {
      const existing = String(stripeCustomerId || '').trim();
      if (existing) return existing;
      const userEmail = user?.primaryEmailAddress?.emailAddress;
      if (!userEmail) return '';
      try {
        const resp = await fetch(
          `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
            userEmail
          )}`
        );
        if (!resp.ok) return '';
        const json = await resp.json().catch(() => null as any);
        const sid = String(json?.customer?.id || '').trim();
        if (sid) setStripeCustomerId(sid);
        return sid;
      } catch (_e) {
        return '';
      }
    };

    const stripeId = await resolveStripeId();
    if (stripeId && store?.id) {
      try {
        const existingResp = await fetch(
          `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(
            stripeId
          )}&paymentId=${encodeURIComponent(String(paymentId || '').trim())}`
        );
        if (existingResp.ok) {
          const existingJson = await existingResp
            .json()
            .catch(() => null as any);
          const groups = Array.isArray(existingJson?.itemsByStore)
            ? existingJson.itemsByStore
            : [];
          const groupForStore = groups.find(
            (g: any) => g?.store?.id && store?.id && g.store.id === store.id
          );
          const rawItems = Array.isArray(groupForStore?.items)
            ? groupForStore.items
            : [];
          const hasExistingPaymentItems = rawItems.some(
            (it: any) =>
              String(it?.payment_id || '').trim() === String(paymentId).trim()
          );
          if (hasExistingPaymentItems) {
            setCartItemsForStore(rawItems);
            setCartTotalForStore(
              Number(groupForStore?.total || 0) || computeTotal(rawItems)
            );
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('cart:updated'));
            }
            return true;
          }
        }
      } catch (_e) {}
    }

    const resp = await fetch(
      `${apiBase}/api/shipments/rebuild-carts-from-payment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ paymentId, storeId: store?.id }),
      }
    );
    const json = await resp.json().catch(() => null as any);
    if (!resp.ok) {
      const msg =
        json?.error ||
        'Erreur lors du chargement de la commande depuis le paiement';
      showToast(msg, 'error');
      return false;
    }
    await refreshCartForStore();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('cart:updated'));
    }
    return true;
  };

  const setOpenShipmentParams = (paymentId: string) => {
    try {
      setShipmentCartRebuilt(false);
      setOpenShipmentInitHandled(false);
      const next = new URLSearchParams(searchParams);
      next.set('open_shipment', 'true');
      next.set('payment_id', paymentId);
      setSearchParams(next, { replace: true });
    } catch {}
  };

  const getActiveOpenShipment = async () => {
    const apiBase = API_BASE_URL;
    const token = await getToken();
    const resp = await fetch(
      `${apiBase}/api/shipments/active-open-shipment?storeId=${encodeURIComponent(
        String(store?.id || '')
      )}`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      }
    );
    const json = await resp.json().catch(() => null as any);
    return { resp, json };
  };

  const cancelOpenShipment = async (paymentId: string) => {
    const apiBase = API_BASE_URL;
    const token = await getToken();
    const resp = await fetch(`${apiBase}/api/shipments/cancel-open-shipment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ paymentId, storeId: store?.id }),
    });
    const json = await resp.json().catch(() => null as any);
    return { resp, json };
  };

  useEffect(() => {
    refreshCartForStore();
  }, [user, store]);

  useEffect(() => {
    if (!email && user?.primaryEmailAddress?.emailAddress) {
      setEmail(user.primaryEmailAddress.emailAddress);
    }
  }, [user]);

  useEffect(() => {
    if (!store?.id || !user) return;
    let cancelled = false;
    const run = async () => {
      try {
        const openShipment =
          String(searchParams.get('open_shipment') || '') === 'true';
        const paymentId = String(searchParams.get('payment_id') || '').trim();
        const { resp, json } = await getActiveOpenShipment();
        if (!resp.ok) return;
        const os = json?.openShipment || null;
        const openPaymentId = String(os?.payment_id || '').trim();
        const openShipmentId = String(os?.shipment_id || '').trim();
        if (!openPaymentId) return;

        if (openShipment && paymentId && paymentId === openPaymentId) {
          if (!cancelled) setOpenShipmentEditingShipmentId(openShipmentId);
          return;
        }

        if (!cancelled) {
          setOpenShipmentBlockPaymentId(openPaymentId);
          setOpenShipmentBlockShipmentId(openShipmentId);
          setOpenShipmentAttemptPaymentId(openShipment ? paymentId : '');
          setOpenShipmentBlockModalOpen(true);
        }
      } catch (_e) {}
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [store?.id, user, searchParams, getToken]);

  useEffect(() => {
    const openShipment =
      String(searchParams.get('open_shipment') || '') === 'true';
    const paymentId = String(searchParams.get('payment_id') || '').trim();
    if (openShipmentInitHandled || shipmentCartRebuilt) return;
    if (openShipmentBlockModalOpen) return;
    if (!openShipment || !paymentId || !store?.id || !user) return;

    let cancelled = false;
    const run = async () => {
      try {
        const { resp, json } = await openShipmentByPayment(paymentId, false);
        if (!resp.ok && resp.status === 409) {
          if (cancelled) return;
          const os = json?.openShipment || null;
          const openPaymentId = String(os?.payment_id || '').trim();
          const openShipmentId = String(os?.shipment_id || '').trim();
          if (openPaymentId) {
            setOpenShipmentBlockPaymentId(openPaymentId);
            setOpenShipmentBlockShipmentId(openShipmentId);
            setOpenShipmentAttemptPaymentId(paymentId);
            setOpenShipmentBlockModalOpen(true);
          } else {
            try {
              const { resp: r2, json: j2 } = await getActiveOpenShipment();
              if (r2.ok) {
                const os2 = j2?.openShipment || null;
                const op2 = String(os2?.payment_id || '').trim();
                const sid2 = String(os2?.shipment_id || '').trim();
                if (op2) {
                  setOpenShipmentBlockPaymentId(op2);
                  setOpenShipmentBlockShipmentId(sid2);
                  setOpenShipmentAttemptPaymentId(paymentId);
                  setOpenShipmentBlockModalOpen(true);
                }
              }
            } catch (_e) {}
          }
          return;
        }
        if (!resp.ok) {
          const msg =
            json?.error ||
            'Erreur lors de la préparation de la modification de commande';
          if (!cancelled) showToast(msg, 'error');
          return;
        }
        if (!cancelled) {
          const sid = String(json?.shipmentDisplayId || '').trim();
          if (sid) setOpenShipmentEditingShipmentId(sid);
          const paidValue = Number(json?.paidValue || 0);
          setTempCreditBalanceCents(Math.max(0, Math.round(paidValue * 100)));
        }
        if (cancelled) return;
        const ok = await rebuildCartFromPayment(paymentId);
        if (!cancelled && ok) setShipmentCartRebuilt(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        if (!cancelled) showToast(msg, 'error');
      } finally {
        if (!cancelled) setOpenShipmentInitHandled(true);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    store?.id,
    user,
    getToken,
    shipmentCartRebuilt,
    openShipmentInitHandled,
    openShipmentBlockModalOpen,
  ]);

  // États pour les accordéons
  const [orderAccordionOpen, setOrderAccordionOpen] = useState(true);
  const [paymentAccordionOpen, setPaymentAccordionOpen] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isEditingDelivery, setIsEditingDelivery] = useState(false);
  const [shippingHasBeenModified, setShippingHasBeenModified] = useState(false);

  useEffect(() => {
    const fetchStore = async () => {
      if (!storeName) {
        setError('Nom de boutique manquant');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/${encodeURIComponent(storeName)}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Erreur lors du chargement de la boutique'
          );
        }

        setStore(data.store);
        const addr = data.store?.address;
        if (addr && typeof addr === 'object') {
          const mapped: Address = {
            city: addr.city || undefined,
            country: addr.country || undefined,
            line1: addr.line1 || undefined,
            line2: addr.line2 || undefined,
            postal_code: addr.postal_code || undefined,
            state: addr.state || undefined,
          };
          setStorePickupAddress(
            mapped.line1 && mapped.postal_code && mapped.city
              ? mapped
              : undefined
          );
          setStorePickupPhone(addr.phone || undefined);
        } else {
          setStorePickupAddress(undefined);
          setStorePickupPhone(undefined);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchStore();
  }, [storeName]);

  useEffect(() => {
    const amountParam = searchParams.get('amount');
    if (amountParam) {
      const parsedAmount = parseFloat(amountParam);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        setAmount(parsedAmount);
        setAmountInput(parsedAmount.toString());
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const checkExistingCustomer = async () => {
      if (!user?.primaryEmailAddress?.emailAddress || !store) {
        setCustomerDetailsLoaded(true);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
            user.primaryEmailAddress.emailAddress
          )}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.customer) {
            setCustomerData(data.customer);
            if (data.customer.name) {
              setFormData(prev => ({ ...prev, name: data.customer.name }));
            }
            if (data.customer.phone) {
              setFormData(prev => ({ ...prev, phone: data.customer.phone }));
            }
            if (data.customer.address) {
              setAddress(data.customer.address);
            } else if (data.customer?.metadata?.delivery_method) {
              setDeliveryMethod(
                data.customer.metadata.delivery_method as
                  | 'home_delivery'
                  | 'pickup_point'
              );
            }
            if ((data.customer as any)?.deliveryMethod) {
              setDeliveryMethod((data.customer as any).deliveryMethod);
            }
            setSelectedParcelPoint(null);
            // Préselection via metadata
            const md = (data.customer as any)?.metadata || {};
            if (md.delivery_method === 'pickup_point' && md.parcel_point) {
              // sera appliqué après fetch des parcel points via ParcelPointMap
            }
            if (md.delivery_method === 'home_delivery' && md.delivery_network) {
              // Option: on peut préafficher une suggestion; le coût se recalculera lors du choix explicite.
            }
            if (
              (md.delivery_method === 'home_delivery' ||
                data.customer.delivery_method === 'home_delivery') &&
              md.delivery_network &&
              !(formData as any).shippingOfferCode
            ) {
              setFormData(prev => ({
                ...prev,
                shippingOfferCode: md.delivery_network,
              }));
            }
          }
        } else {
          const errText = await response.text();
          // Optionally handle non-OK statuses silently
        }
      } catch (error) {
        console.error('Erreur lors de la vérification du client:', error);
      } finally {
        setCustomerDetailsLoaded(true);
      }
    };

    setCustomerDetailsLoaded(false);
    checkExistingCustomer();
  }, [user, store]);

  const isFormComplete = () => {
    const hasEmail = Boolean((email || '').trim());
    const hasDeliveryInfo =
      deliveryMethod === 'home_delivery'
        ? Boolean(
            address &&
              (address as any)?.line1 &&
              (formData as any).shippingOfferCode
          )
        : deliveryMethod === 'pickup_point'
          ? Boolean(selectedParcelPoint)
          : deliveryMethod === 'store_pickup'
            ? Boolean(storePickupAddress?.line1)
            : false;
    const hasContactInfo =
      Boolean((formData.name || '').trim()) &&
      Boolean((formData.phone || '').trim());

    return hasEmail && hasDeliveryInfo && hasContactInfo;
  };

  const validateCartQuantitiesInStock = async () => {
    const storeSlug = String(store?.slug || '').trim();
    if (!storeSlug) return;
    const refs = Array.from(
      new Set(
        (cartItemsForStore || [])
          .map(it => String(it.product_reference || '').trim())
          .filter(Boolean)
      )
    );
    if (refs.length === 0) return;

    const snapshot = new Map<string, number>();
    const maxConcurrent = 4;
    let idx = 0;
    const workers = new Array(Math.min(maxConcurrent, refs.length))
      .fill(null)
      .map(async () => {
        while (idx < refs.length) {
          const current = idx++;
          const ref = refs[current];
          try {
            const item = await fetchStockSearchExactMatch(storeSlug, ref);
            const qRaw = Number(item?.stock?.quantity);
            if (Number.isFinite(qRaw)) {
              snapshot.set(getRefKey(ref), qRaw);
            }
          } catch {}
        }
      });
    await Promise.all(workers);

    for (const it of cartItemsForStore || []) {
      const ref = String(it.product_reference || '').trim();
      if (!ref) continue;
      const key = getRefKey(ref);
      if (!snapshot.has(key)) continue;
      const available = Number(snapshot.get(key) ?? NaN);
      if (!Number.isFinite(available)) continue;
      const chosen = Math.max(1, Math.round(Number(it.quantity || 1)));
      if (available <= 0) {
        throw new Error(`Article épuisé: ${ref}`);
      }
      if (chosen > available) {
        throw new Error(
          `Stock insuffisant pour ${ref} (demandé ${chosen}, disponible ${available})`
        );
      }
    }
  };

  const handleProceedToPayment = async () => {
    if (
      (!isFormComplete() && cartItemsForStore.length === 0) ||
      !store ||
      !user?.primaryEmailAddress?.emailAddress
    )
      return;

    setIsProcessingPayment(true);

    try {
      // Vérifier la cohérence du panier en base avant de payer
      try {
        const apiBase = API_BASE_URL;
        const refreshResp = await fetch(
          `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(stripeCustomerId)}`
        );
        if (refreshResp.ok) {
          const json = await refreshResp.json();
          const groups = Array.isArray(json?.itemsByStore)
            ? json.itemsByStore
            : [];
          const groupForStore = groups.find(
            (g: any) => g?.store?.id && store?.id && g.store.id === store.id
          );
          const items = groupForStore?.items || [];
          if (cartItemsForStore.length > 0) {
            const freshRefs = new Set(
              items.map((it: any) => String(it.product_reference || '').trim())
            );
            const currentRefs = cartItemsForStore.map(it =>
              String(it.product_reference || '').trim()
            );
            const missingRefs = currentRefs.filter(r => !freshRefs.has(r));
            if (missingRefs.length > 0) {
              const msg = 'Certains articles ne sont plus dans votre panier';
              setPaymentError(msg);
              showToast(msg, 'error');
              setCartItemsForStore(items);
              setCartTotalForStore(Number(groupForStore?.total || 0));
              setIsProcessingPayment(false);
              return;
            }
          }
          const refs = items.map((it: any) =>
            String(it.product_reference || '').trim()
          );
          const seen = new Set<string>();
          let hasDuplicate = false;
          for (const r of refs) {
            if (seen.has(r)) {
              hasDuplicate = true;
              break;
            }
            seen.add(r);
          }
          if (hasDuplicate) {
            const msg =
              'Vous avez la même référence plusieurs fois dans le panier';
            setPaymentError(msg);
            showToast(msg, 'error');
            setCartItemsForStore(items);
            setCartTotalForStore(Number(groupForStore?.total || 0));
            setIsProcessingPayment(false);
            return;
          }
        }
      } catch (_e) {}

      await validateCartQuantitiesInStock();

      // Ajout automatique au panier si référence et montant renseignés

      const effectiveDeliveryMethod:
        | 'home_delivery'
        | 'pickup_point'
        | 'store_pickup' = deliveryMethod;

      const md = (customerData as any) || {};
      const resolvedParcelPoint =
        effectiveDeliveryMethod === 'pickup_point'
          ? (() => {
              if (selectedParcelPoint) return selectedParcelPoint;
              const fromCustomer = (customerData as any)?.parcel_point;
              if (fromCustomer && typeof fromCustomer === 'object') {
                if ((fromCustomer as any)?.location) return fromCustomer;
              }
              const fromShipping = (customerData as any)?.shipping?.address;
              if (fromShipping && typeof fromShipping === 'object') {
                return {
                  name: (customerData as any)?.shipping?.name || '',
                  location: {
                    street: fromShipping?.street || fromShipping?.line1 || '',
                    number: fromShipping?.number || fromShipping?.line2 || '',
                    postalCode:
                      fromShipping?.postalCode ||
                      fromShipping?.postal_code ||
                      '',
                    city: fromShipping?.city || '',
                    countryIsoCode:
                      fromShipping?.countryIsoCode ||
                      fromShipping?.country ||
                      'FR',
                  },
                };
              }
              return null;
            })()
          : null;
      const customerInfo = {
        email: email || user.primaryEmailAddress.emailAddress,
        name: (formData.name || md.name || user.fullName || 'Client') as string,
        phone: (formData.phone || md.phone || '') as string,
        address:
          effectiveDeliveryMethod === 'home_delivery'
            ? address || (customerData?.address as any) || null
            : effectiveDeliveryMethod === 'store_pickup'
              ? storePickupAddress
              : null,
        delivery_method: effectiveDeliveryMethod,
        parcel_point:
          effectiveDeliveryMethod === 'pickup_point'
            ? resolvedParcelPoint
            : null,
      };

      const openShipmentMode =
        String(searchParams.get('open_shipment') || '') === 'true' &&
        Boolean(String(searchParams.get('payment_id') || '').trim());

      if (openShipmentMode && createdCreditCouponId) {
        const { resp } = await deleteCreditCoupon(createdCreditCouponId);
        if (!resp?.ok) {
          const msg =
            'Erreur lors de la suppression du coupon de crédit précédent';
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
        setCreatedCreditCouponId('');
        setCreatedCreditPromotionCodeId('');
      }

      const payloadItems = (cartItemsForStore || []).map(it => ({
        reference: String(it.product_reference || '').trim(),
        description: String((it as any).description || '').trim(),
        price: Number(it.value || 0),
        quantity: Number(it.quantity || 1),
        product_stripe_id: String((it as any).product_stripe_id || '').trim(),
        weight: Number((it as any).weight),
      }));

      const payloadData = {
        shippingHasBeenModified: shippingHasBeenModified,
        openShipmentPaymentId: openShipmentMode ? currentPaymentId : '',
        amount: cartTotalForStore,
        currency: 'eur',
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        clerkUserId: user.id,
        storeName: store?.name ?? storeName,
        items: payloadItems,
        tempCreditBalanceCents: openShipmentMode ? tempCreditBalanceCents : 0,
        address: address ||
          customerInfo.address ||
          (customerData?.address as any) || {
            line1: '',
            line2: '',
            city: '',
            state: '',
            postal_code: '',
            country: 'FR',
          },
        deliveryMethod: effectiveDeliveryMethod,
        parcelPoint:
          effectiveDeliveryMethod === 'pickup_point'
            ? resolvedParcelPoint || null
            : null,
        phone: customerInfo.phone,

        cartItemIds: (cartItemsForStore || []).map(it => it.id),
        deliveryNetwork:
          effectiveDeliveryMethod === 'store_pickup'
            ? 'STORE_PICKUP'
            : (resolvedParcelPoint as any)?.shippingOfferCode ||
              (formData as any)?.shippingOfferCode ||
              (md.deliveryNetwork as any) ||
              ((md.metadata || {})?.delivery_network as any) ||
              '',
      };

      const response = await fetch(
        `${
          import.meta.env.VITE_API_URL || 'http://localhost:5000'
        }/api/stripe/create-checkout-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadData),
        }
      );

      const data = await response.json().catch(() => null as any);

      if (!response.ok) {
        if (
          response.status === 409 &&
          data?.blocked &&
          data?.reason === 'already_bought' &&
          data?.reference
        ) {
          throw new Error(
            `Malheureusement, la référence ${String(data.reference)} a déjà été achetée.`
          );
        }
        throw new Error(
          data?.error || 'Erreur lors de la création de la session'
        );
      }

      setDeliveryMethod(effectiveDeliveryMethod);
      setCreatedCreditCouponId(String(data?.creditCouponId || '').trim());
      setCreatedCreditPromotionCodeId(
        String(data?.creditPromotionCodeId || '').trim()
      );
      if (effectiveDeliveryMethod === 'home_delivery' && address) {
        setCustomerData(prev => ({
          ...(prev || {}),
          address: address as any,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network:
              (formData as any)?.shippingOfferCode ||
              (prev as any)?.metadata?.delivery_network ||
              '',
          },
        }));
      } else if (
        effectiveDeliveryMethod === 'pickup_point' &&
        selectedParcelPoint
      ) {
        const loc = (selectedParcelPoint as any)?.location;
        const fallbackShipAddr =
          ((customerData as any)?.shipping?.address as any) || {};
        const shipAddr = {
          line1:
            loc?.street ||
            fallbackShipAddr?.street ||
            fallbackShipAddr?.line1 ||
            '',
          line2:
            loc?.number ||
            fallbackShipAddr?.number ||
            fallbackShipAddr?.line2 ||
            '',
          city: loc?.city || fallbackShipAddr?.city || '',
          state: loc?.state || fallbackShipAddr?.state || '',
          postal_code:
            loc?.postalCode ||
            fallbackShipAddr?.postalCode ||
            fallbackShipAddr?.postal_code ||
            '',
          country:
            loc?.countryIsoCode ||
            fallbackShipAddr?.countryIsoCode ||
            fallbackShipAddr?.country ||
            'FR',
        };
        setCustomerData(prev => ({
          ...(prev || {}),
          shipping: {
            name:
              (selectedParcelPoint as any)?.name ||
              (prev as any)?.shipping?.name,
            phone: customerInfo.phone,
            address: shipAddr,
          },
          parcel_point: selectedParcelPoint,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network:
              selectedParcelPoint.shippingOfferCode ||
              (formData as any)?.shippingOfferCode ||
              (prev as any)?.metadata?.delivery_network ||
              '',
            parcel_point_code:
              selectedParcelPoint.code ||
              (prev as any)?.metadata?.parcel_point_code ||
              '',
          },
        }));
      } else if (effectiveDeliveryMethod === 'store_pickup') {
        setCustomerData(prev => ({
          ...(prev || {}),
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network: 'STORE_PICKUP',
          },
        }));
      }

      setEmbeddedClientSecret(data.clientSecret);
      setOrderCompleted(true);
      setOrderAccordionOpen(false);
      setPaymentAccordionOpen(true);
      setShowPayment(true);
      setIsEditingDelivery(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      setPaymentError(msg);
      showToast(msg, 'error');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleDeleteCartItem = async (id: number) => {
    if (!id) return;

    setCartItemsForStore(prev => {
      const next = prev.filter(it => it.id !== id);
      const newTotal = next.reduce(
        (sum, it) => sum + Number(it.value || 0) * Number(it.quantity || 1),
        0
      );
      setCartTotalForStore(newTotal);
      return next;
    });

    try {
      const apiBase = API_BASE_URL;
      const resp = await fetch(`${apiBase}/api/carts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!resp.ok) {
        return;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('cart:updated'));
      }
    } catch (_e) {}
  };
  const handleUpdateCartItemQuantity = async (id: number, quantity: number) => {
    if (!id || !Number.isFinite(quantity) || quantity <= 0) return;
    // Update UI immediately
    setCartItemsForStore(prev => {
      const next = prev.map(it => (it.id === id ? { ...it, quantity } : it));
      const newTotal = next.reduce(
        (sum, it) => sum + Number(it.value || 0) * Number(it.quantity || 1),
        0
      );
      setCartTotalForStore(newTotal);
      return next;
    });
    // Persist to backend
    try {
      const apiBase = API_BASE_URL;
      const resp = await fetch(`${apiBase}/api/carts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      });
      if (!resp.ok) {
        // silently ignore
      } else {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('cart:updated'));
        }
      }
    } catch (_e) {}
  };

  const handleModifyOrder = () => {
    setOrderCompleted(false);
    setOrderAccordionOpen(true);
    setPaymentAccordionOpen(false);
    setShowPayment(false);
    setIsEditingOrder(true);
    setIsEditingDelivery(false);
    setFormData(prev => ({
      ...prev,
      reference: '',
      description: '',
    }));
    setAmount(0);
    setAmountInput('');
    setEmbeddedClientSecret('');
  };

  const handleModifyDelivery = () => {
    setOrderCompleted(false);
    setOrderAccordionOpen(true);
    setPaymentAccordionOpen(false);
    setShowPayment(false);
    setIsEditingOrder(false);
    setIsEditingDelivery(true);
    setEmbeddedClientSecret('');
  };

  if (loading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <p className='text-gray-600'>Chargement de la boutique...</p>
        </div>
      </div>
    );
  }

  // Les erreurs d’existence de boutique sont désormais gérées par l’overlay du Header

  const themeColor = '#667eea';

  const cloudBase = (
    import.meta.env.VITE_CLOUDFRONT_URL ||
    'https://d1tmgyvizond6e.cloudfront.net'
  ).replace(/\/+$/, '');
  const storeLogo = store?.id ? `${cloudBase}/images/${store.id}` : undefined;
  const isOpenShipmentMode =
    String(searchParams.get('open_shipment') || '') === 'true' &&
    Boolean(String(searchParams.get('payment_id') || '').trim());
  const currentPaymentId = String(searchParams.get('payment_id') || '').trim();

  const cancelOpenShipmentAndVerify = async (preferredPaymentId?: string) => {
    if (!store?.id) return false;

    let pidToCancel = String(preferredPaymentId || '').trim();
    try {
      const { resp: osResp, json: osJson } = await getActiveOpenShipment();
      if (osResp.ok) {
        const os = osJson?.openShipment || null;
        const openPid = String(os?.payment_id || '').trim();
        if (openPid) pidToCancel = openPid;
      }
    } catch (_e) {}

    if (!pidToCancel) return false;

    const { resp, json } = await cancelOpenShipment(pidToCancel);
    if (!resp.ok) {
      const msg =
        json?.error || 'Erreur lors de l’annulation de la modification';
      showToast(msg, 'error');
      return false;
    }

    try {
      const { resp: vResp, json: vJson } = await getActiveOpenShipment();
      if (!vResp.ok) {
        showToast('Erreur lors de la vérification de l’annulation', 'error');
        return false;
      }
      const os = vJson?.openShipment || null;
      const stillOpenPid = String(os?.payment_id || '').trim();
      if (!stillOpenPid) return true;

      if (stillOpenPid !== pidToCancel) {
        const { resp: r2, json: j2 } = await cancelOpenShipment(stillOpenPid);
        if (!r2.ok) {
          const msg =
            j2?.error || 'Erreur lors de l’annulation de la modification';
          showToast(msg, 'error');
          return false;
        }

        const { resp: v2Resp, json: v2Json } = await getActiveOpenShipment();
        if (!v2Resp.ok) {
          showToast('Erreur lors de la vérification de l’annulation', 'error');
          return false;
        }
        const os2 = v2Json?.openShipment || null;
        const stillOpenPid2 = String(os2?.payment_id || '').trim();
        if (stillOpenPid2) {
          showToast('Impossible de fermer la commande', 'error');
          return false;
        }
        return true;
      }

      showToast('Impossible de fermer la commande', 'error');
      return false;
    } catch (_e) {
      showToast('Erreur lors de la vérification de l’annulation', 'error');
      return false;
    }
  };

  return (
    <StripeWrapper>
      {isOpenShipmentMode ? (
        <div className='bg-blue-50 border-b border-blue-200'>
          <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3'>
            <div className='text-sm text-blue-800 truncate'>
              Modification de la commande{' '}
              <span className='font-semibold'>
                {openShipmentEditingShipmentId}
              </span>
              .
            </div>
            <button
              type='button'
              onClick={async () => {
                if (!store?.id) return;
                try {
                  setOpenShipmentActionLoading(true);
                  if (createdCreditCouponId) {
                    const { resp } = await deleteCreditCoupon(
                      createdCreditCouponId
                    );
                    if (!resp?.ok) {
                      showToast(
                        'Erreur lors de la suppression du coupon de crédit',
                        'error'
                      );
                      return;
                    }
                  }
                  const ok =
                    await cancelOpenShipmentAndVerify(currentPaymentId);
                  if (!ok) return;
                  setOpenShipmentEditingShipmentId('');
                  setOpenShipmentBlockShipmentId('');
                  setOpenShipmentBlockPaymentId('');
                  setOpenShipmentAttemptPaymentId('');
                  setOpenShipmentBlockModalOpen(false);
                  clearOpenShipmentParams();
                  setShipmentCartRebuilt(false);
                  setOpenShipmentInitHandled(true);
                  setTempCreditBalanceCents(0);
                  setCreatedCreditCouponId('');
                  setCreatedCreditPromotionCodeId('');
                  await refreshCartForStore();
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('cart:updated'));
                  }
                  showToast('Modifications annulées', 'success');
                } finally {
                  setOpenShipmentActionLoading(false);
                }
              }}
              disabled={openShipmentActionLoading}
              className='px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 shrink-0'
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
      <Header />
      <div className='min-h-screen bg-gray-50 py-8'>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            visible={toast.visible !== false}
          />
        )}
        <Modal
          isOpen={openShipmentBlockModalOpen}
          onClose={() => {}}
          title='Modification de commande en cours'
        >
          <div className='space-y-4'>
            <div className='text-sm text-gray-700'>
              Veuillez compléter ou annuler la modification de votre commande :{' '}
              <span className='font-semibold'>
                {openShipmentBlockShipmentId || '—'}
              </span>
            </div>
            <div className='flex items-center justify-end gap-2'>
              <button
                type='button'
                onClick={async () => {
                  const pid = String(openShipmentBlockPaymentId || '').trim();
                  if (!pid || !store?.id) return;
                  try {
                    setOpenShipmentActionLoading(true);
                    if (createdCreditCouponId) {
                      const { resp } = await deleteCreditCoupon(
                        createdCreditCouponId
                      );
                      if (!resp?.ok) {
                        showToast(
                          'Erreur lors de la suppression du coupon de crédit',
                          'error'
                        );
                        return;
                      }
                    }
                    const ok = await cancelOpenShipmentAndVerify(pid);
                    if (!ok) return;
                    setOpenShipmentBlockModalOpen(false);
                    setOpenShipmentBlockShipmentId('');
                    setOpenShipmentBlockPaymentId('');
                    const attempted = String(
                      openShipmentAttemptPaymentId || ''
                    ).trim();
                    setOpenShipmentAttemptPaymentId('');
                    setShipmentCartRebuilt(false);
                    setOpenShipmentInitHandled(false);
                    if (attempted) {
                      setOpenShipmentParams(attempted);
                    } else {
                      clearOpenShipmentParams();
                      await refreshCartForStore();
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('cart:updated'));
                      }
                    }
                    setTempCreditBalanceCents(0);
                    setCreatedCreditCouponId('');
                    setCreatedCreditPromotionCodeId('');
                    showToast('Modifications annulées', 'success');
                  } finally {
                    setOpenShipmentActionLoading(false);
                  }
                }}
                disabled={openShipmentActionLoading}
                className='px-3 py-2 rounded-md text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
              >
                Annuler les modifications
              </button>
              <button
                type='button'
                onClick={async () => {
                  const pid = String(openShipmentBlockPaymentId || '').trim();
                  if (!pid) return;
                  setOpenShipmentBlockModalOpen(false);
                  setOpenShipmentAttemptPaymentId('');
                  setShipmentCartRebuilt(false);
                  setOpenShipmentInitHandled(false);
                  setOpenShipmentEditingShipmentId(openShipmentBlockShipmentId);
                  setOpenShipmentParams(pid);
                }}
                disabled={openShipmentActionLoading}
                className='px-3 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
              >
                Poursuivre les modifications
              </button>
            </div>
          </div>
        </Modal>
        <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8'>
          {/* En-tête de la boutique */}
          <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
            <div className='flex items-center space-x-4'>
              {storeLogo ? (
                <img
                  src={storeLogo}
                  alt={store?.name}
                  className='w-16 h-16 rounded-lg object-cover'
                />
              ) : (
                <div className='w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center'>
                  <ShoppingBag className='w-8 h-8 text-gray-500' />
                </div>
              )}
              <div className='min-w-0'>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2 min-w-0'>
                  <h1
                    className='text-2xl font-bold text-gray-900 truncate max-w-full'
                    title={store?.name ?? storeName}
                  >
                    {store?.name ?? storeName}
                  </h1>
                </div>
                {store?.description && (
                  <p
                    className='text-gray-600 mt-1'
                    title={store.description}
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {store.description}
                  </p>
                )}
                {store?.is_verified ? (
                  <div
                    title="Le SIRET de la boutique a été vérifié via l'INSEE"
                    className='inline-flex items-center gap-1 mt-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium size-fit'
                  >
                    <BadgeCheck className='w-3 h-3' /> Boutique Vérifiée
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-8'>
            {/* Accordéon Votre Commande */}
            <div className=' rounded-lg shadow-sm'>
              {!orderCompleted && (
                <div className='p-6 border-b flex items-center justify-between'>
                  <div className='flex items-center space-x-3'>
                    <ShoppingBag
                      className='w-6 h-6'
                      style={{ color: themeColor }}
                    />
                    <h2 className='text-xl font-semibold text-gray-900'>
                      Votre Commande
                    </h2>
                  </div>
                </div>
              )}

              <div className='p-6'>
                {cartItemsForStore.length > 0 && !showPayment && (
                  <div className='mb-6 border border-gray-200 rounded-md p-4 bg-gray-50'>
                    <div className='mb-2'>
                      <div className='flex items-center justify-between gap-3'>
                        <h3 className='text-base font-semibold text-gray-900'>
                          Articles du panier
                        </h3>
                        <button
                          type='button'
                          onClick={refreshCartForStore}
                          disabled={reloadingCart}
                          className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                        >
                          <RefreshCw
                            className={`w-4 h-4 mr-1 ${reloadingCart ? 'animate-spin' : ''}`}
                          />
                          <span>Recharger</span>
                        </button>
                      </div>
                    </div>
                    <ul className='mt-1 space-y-1 max-h-40 overflow-auto text-sm text-gray-700'>
                      {cartItemsForStore.map(it => (
                        <li
                          key={it.id}
                          className='flex items-center justify-between gap-3'
                        >
                          <div className='min-w-0 flex-1'>
                            {(() => {
                              const ref = String(
                                it.product_reference || ''
                              ).trim();
                              const key = getRefKey(ref);
                              const info = cartStockByRefKey[key] || null;
                              const stock = info?.stock || null;
                              const product = info?.product || null;
                              const title = String(
                                product?.name ||
                                  (it as any)?.description ||
                                  ref ||
                                  ''
                              ).trim();
                              const imgRaw =
                                Array.isArray(product?.images) &&
                                product.images.length > 0
                                  ? String(product.images[0] || '').trim()
                                  : String(stock?.image_url || '')
                                      .split(',')[0]
                                      ?.trim() || '';
                              return (
                                <div className='flex items-center gap-2 min-w-0'>
                                  {imgRaw ? (
                                    <img
                                      src={imgRaw}
                                      alt={title || ref}
                                      className='w-8 h-8 rounded object-cover bg-gray-100 shrink-0'
                                    />
                                  ) : (
                                    <div className='w-8 h-8 rounded bg-gray-100 shrink-0' />
                                  )}
                                  <div className='min-w-0'>
                                    <div className='truncate font-medium'>
                                      {ref || '—'}
                                    </div>
                                    <div className='truncate text-xs text-gray-600'>
                                      {title || '—'}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          <div className='flex items-center gap-2'>
                            {(() => {
                              const ref = String(
                                it.product_reference || ''
                              ).trim();
                              const key = getRefKey(ref);
                              const info = cartStockByRefKey[key] || null;
                              const stockQtyRaw = Number(info?.stock?.quantity);
                              const stockQtyKnown =
                                Number.isFinite(stockQtyRaw);
                              const stockQty = stockQtyKnown
                                ? stockQtyRaw
                                : null;
                              const currentQty = Math.max(
                                1,
                                Math.round(Number(it.quantity || 1))
                              );
                              const maxSelectable =
                                stockQtyKnown &&
                                stockQty !== null &&
                                stockQty > 0
                                  ? Math.min(
                                      10,
                                      Math.max(1, Math.floor(stockQty))
                                    )
                                  : 10;
                              const options = Array.from(
                                { length: maxSelectable },
                                (_, idx) => idx + 1
                              );
                              const showOutOfStock =
                                stockQtyKnown &&
                                stockQty !== null &&
                                stockQty <= 0;

                              if (showOutOfStock) {
                                return (
                                  <span className='text-xs text-gray-500 whitespace-nowrap'>
                                    Épuisé
                                  </span>
                                );
                              }

                              return (
                                <select
                                  value={currentQty}
                                  onChange={e =>
                                    handleUpdateCartItemQuantity(
                                      it.id,
                                      Math.max(1, Number(e.target.value || 1))
                                    )
                                  }
                                  className='border border-gray-300 rounded px-1 py-0.5 text-sm'
                                  aria-label='Quantité'
                                >
                                  {stockQtyKnown &&
                                  stockQty !== null &&
                                  stockQty > 0 &&
                                  currentQty > stockQty ? (
                                    <option value={currentQty} disabled>
                                      {currentQty} (indispo)
                                    </option>
                                  ) : null}
                                  {options.map(q => (
                                    <option key={q} value={q}>
                                      {q}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                            <span className='whitespace-nowrap'>
                              {(
                                Number(it.value || 0) * Number(it.quantity || 1)
                              ).toFixed(2)}{' '}
                              €
                            </span>
                            <button
                              type='button'
                              onClick={() => handleDeleteCartItem(it.id)}
                              className='p-1 rounded hover:bg-red-50 text-red-600'
                              aria-label='Supprimer cet article'
                            >
                              <Trash2 className='w-4 h-4' />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className='mt-3 flex items-center justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900'>
                      <span>Total</span>
                      <span>{Number(cartTotalForStore || 0).toFixed(2)} €</span>
                    </div>
                  </div>
                )}

                <CheckoutForm
                  store={store}
                  amount={amount}
                  setAmount={setAmount}
                  embeddedClientSecret={embeddedClientSecret}
                  customerData={customerData}
                  customerDetailsLoaded={customerDetailsLoaded}
                  formData={formData}
                  setFormData={setFormData}
                  address={address}
                  setAddress={setAddress}
                  storePickupAddress={storePickupAddress}
                  storePickupPhone={storePickupPhone}
                  selectedParcelPoint={selectedParcelPoint}
                  setSelectedParcelPoint={setSelectedParcelPoint}
                  deliveryMethod={deliveryMethod}
                  setDeliveryMethod={setDeliveryMethod}
                  isFormValid={isFormValid}
                  setIsFormValid={setIsFormValid}
                  isProcessingPayment={isProcessingPayment}
                  setIsProcessingPayment={setIsProcessingPayment}
                  amountInput={amountInput}
                  setAmountInput={setAmountInput}
                  user={user}
                  paymentError={paymentError}
                  setPaymentError={setPaymentError}
                  showPayment={showPayment}
                  setShowPayment={setShowPayment}
                  isFormComplete={isFormComplete}
                  handleProceedToPayment={handleProceedToPayment}
                  email={email}
                  setEmail={setEmail}
                  themeColor={themeColor}
                  showDelivery={showDelivery}
                  setShowDelivery={setShowDelivery}
                  showToast={showToast}
                  setCartItemsForStore={setCartItemsForStore}
                  setCartTotalForStore={setCartTotalForStore}
                  shippingHasBeenModified={shippingHasBeenModified}
                  setShippingHasBeenModified={setShippingHasBeenModified}
                  isEditingDelivery={isEditingDelivery}
                  isEditingOrder={isEditingOrder}
                  cartItemsCount={cartItemsForStore.length}
                />
              </div>

              {orderCompleted && (
                <>
                  <div className='p-6 bg-gray-50'>
                    <div className='flex items-center justify-between mb-2'>
                      <h3 className='text-base font-semibold text-gray-900'>
                        Votre commande
                      </h3>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleModifyOrder();
                        }}
                        className='px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center space-x-1'
                      >
                        <Edit className='w-4 h-4' />
                        <span>Modifier</span>
                      </button>
                    </div>
                    <div className='text-sm text-gray-600 space-y-2'>
                      <p>
                        <strong>Nom:</strong> {formData.name}
                      </p>
                      <p>
                        <strong>Téléphone:</strong> {formData.phone}
                      </p>
                      <p>
                        <strong>Email:</strong> {email}
                      </p>
                      <div className='mt-2'>
                        <strong>Articles:</strong>
                        <ul className='mt-1 space-y-1'>
                          {(cartItemsForStore || []).map(it => (
                            <li key={it.id} className='flex justify-between'>
                              <span>
                                {(() => {
                                  const ref = String(
                                    it.product_reference || ''
                                  ).trim();
                                  const desc = String(
                                    (it as any).description || ''
                                  ).trim();
                                  const qty = Number(it.quantity || 1);
                                  const qtyLabel = qty > 1 ? ` × ${qty}` : '';
                                  return desc
                                    ? `${ref} — ${desc}${qtyLabel}`
                                    : `${ref}${qtyLabel}`;
                                })()}
                              </span>
                              <span>
                                {(
                                  Number(it.value || 0) *
                                  Number(it.quantity || 1)
                                ).toFixed(2)}{' '}
                                €
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className='p-6 bg-gray-50 mt-4'>
                    <div className='flex items-center justify-between mb-2'>
                      <h3 className='text-base font-semibold text-gray-900'>
                        Méthode de livraison
                      </h3>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleModifyDelivery();
                        }}
                        className='px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center space-x-1'
                      >
                        <Edit className='w-4 h-4' />
                        <span>Modifier</span>
                      </button>
                    </div>
                    <div className='text-sm text-gray-600 space-y-2'>
                      <p>
                        <strong>Type:</strong>{' '}
                        {deliveryMethod === 'home_delivery'
                          ? 'À domicile'
                          : deliveryMethod === 'pickup_point'
                            ? 'Point relais'
                            : 'Retrait en magasin'}
                      </p>
                      {deliveryMethod === 'home_delivery' && (
                        <>
                          {(() => {
                            const homeAddr =
                              address || (customerData?.address as any);
                            return homeAddr ? (
                              <p>
                                <strong>Adresse:</strong> {homeAddr.line1}
                                {homeAddr.line2
                                  ? `, ${homeAddr.line2}`
                                  : ''}, {homeAddr.postal_code} {homeAddr.city}
                              </p>
                            ) : null;
                          })()}
                          {(() => {
                            const mdNet = (customerData as any)?.metadata
                              ?.delivery_network;
                            const offer =
                              (formData as any)?.shippingOfferCode || '';
                            const code = mdNet || offer;
                            return code ? (
                              <p>
                                <strong>Réseau domicile:</strong> {code}
                              </p>
                            ) : null;
                          })()}
                        </>
                      )}
                      {deliveryMethod === 'pickup_point' && (
                        <>
                          {(() => {
                            const ship = (customerData as any)?.shipping;
                            const name =
                              ship?.name || selectedParcelPoint?.name || null;
                            const addr =
                              ship?.address || selectedParcelPoint?.location;
                            return name || addr ? (
                              <>
                                {name && (
                                  <p>
                                    <strong>Point relais:</strong> {name}
                                  </p>
                                )}
                                {addr && (
                                  <p className='text-xs'>
                                    {addr.number ? `${addr.number} ` : ''}
                                    {addr?.street || addr.line1}
                                    {addr.line2 ? `, ${addr.line2}` : ''}
                                    {addr.postalCode || addr.postal_code
                                      ? `, ${
                                          addr.postalCode || addr.postal_code
                                        }`
                                      : ''}
                                    {addr.city ? ` ${addr.city}` : ''}
                                  </p>
                                )}
                              </>
                            ) : null;
                          })()}
                        </>
                      )}
                      {deliveryMethod === 'store_pickup' &&
                        storePickupAddress && (
                          <p>
                            <strong>Adresse magasin:</strong>{' '}
                            {storePickupAddress.line1}
                            {storePickupAddress.line2
                              ? `, ${storePickupAddress.line2}`
                              : ''}
                            , {storePickupAddress.postal_code}{' '}
                            {storePickupAddress.city}
                          </p>
                        )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bouton Procéder au paiement sous l'accordéon */}
            <div className='mt-4'>
              {(!showPayment || !embeddedClientSecret) &&
                (() => {
                  const savedMethod =
                    (customerData as any)?.deliveryMethod ||
                    (customerData as any)?.delivery_method ||
                    (customerData as any)?.metadata?.delivery_method ||
                    null;
                  const hasItems = cartItemsForStore.length > 0;
                  const deliveryIsValid =
                    isEditingDelivery || savedMethod ? true : isFormComplete();

                  const canProceed = hasItems && deliveryIsValid;

                  const btnColor = canProceed ? '#0074D4' : '#6B7280';
                  return (
                    <button
                      onClick={handleProceedToPayment}
                      disabled={!canProceed}
                      className='w-full py-3.5 px-4 rounded-md font-medium text-white transition-all duration-200 flex items-center justify-center space-x-2 shadow-md focus:ring-2 focus:ring-offset-2'
                      style={{ backgroundColor: btnColor, lineHeight: '1.5' }}
                    >
                      {isProcessingPayment ? (
                        <>
                          <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-white'></div>
                          <span>Traitement...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className='w-5 h-5' />
                          <span>Procéder au paiement</span>
                        </>
                      )}
                    </button>
                  );
                })()}
              {!isFormComplete() && cartItemsForStore.length === 0 && (
                <p className='text-sm text-gray-500 text-center mt-2'>
                  Veuillez compléter tous les champs pour continuer
                </p>
              )}
            </div>

            {/* Carte de paiement (EmbeddedCheckout) */}
            {showPayment && embeddedClientSecret && (
              <div className='bg-white rounded-lg shadow-sm p-6'>
                <div className='flex items-center space-x-3 mb-4'>
                  <CreditCard
                    className='w-6 h-6'
                    style={{ color: themeColor }}
                  />
                  <h2 className='text-xl font-semibold text-gray-900'>
                    Paiement
                  </h2>
                </div>
                <PaymentAccordionContent clientSecret={embeddedClientSecret} />
              </div>
            )}
          </div>
        </div>
      </div>
    </StripeWrapper>
  );
}

function PaymentAccordionContent({ clientSecret }: { clientSecret: string }) {
  const stripe = useStripe();
  return (
    <EmbeddedCheckoutProvider stripe={stripe} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

function CheckoutForm({
  store,
  amount,
  setAmount,
  embeddedClientSecret,
  customerData,
  customerDetailsLoaded,
  formData,
  setFormData,
  address,
  setAddress,
  storePickupAddress,
  storePickupPhone,
  selectedParcelPoint,
  setSelectedParcelPoint,
  deliveryMethod,
  setDeliveryMethod,
  isFormValid,
  setIsFormValid,
  isProcessingPayment,
  setIsProcessingPayment,
  amountInput,
  setAmountInput,
  user,
  paymentError,
  setPaymentError,
  showPayment,
  setShowPayment,
  isFormComplete,
  handleProceedToPayment,
  email,
  setEmail,
  themeColor,

  showDelivery,
  setShowDelivery,
  showToast,
  setCartItemsForStore,
  setCartTotalForStore,
  isEditingDelivery,
  shippingHasBeenModified,
  setShippingHasBeenModified,
  isEditingOrder,
  cartItemsCount,
}: {
  store: Store | null;
  amount: number;
  setAmount: (amount: number) => void;
  embeddedClientSecret: string;
  customerData: CustomerData | null;
  customerDetailsLoaded: boolean;
  formData: any;
  setFormData: any;
  address: any;
  setAddress: any;
  storePickupAddress: any;
  storePickupPhone: string | undefined;
  selectedParcelPoint: any;
  setSelectedParcelPoint: any;
  deliveryMethod: 'home_delivery' | 'pickup_point' | 'store_pickup';
  setDeliveryMethod: any;
  isFormValid: boolean;
  setIsFormValid: any;
  isProcessingPayment: boolean;
  setIsProcessingPayment: any;
  amountInput: string;
  setAmountInput: any;
  user: any;
  paymentError: string | null;
  setPaymentError: any;
  showPayment: boolean;
  setShowPayment: any;
  isFormComplete: () => boolean;
  handleProceedToPayment: () => void;
  email: string;
  setEmail: any;
  themeColor: string;

  showDelivery: boolean;
  setShowDelivery: (val: boolean) => void;
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  setCartItemsForStore: Dispatch<SetStateAction<CartItem[]>>;
  setCartTotalForStore: Dispatch<SetStateAction<number>>;
  isEditingDelivery: boolean;
  shippingHasBeenModified: boolean;
  setShippingHasBeenModified: (val: boolean) => void;
  isEditingOrder: boolean;
  cartItemsCount: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const isAddToCartDisabled =
    !Boolean((formData.reference || '').trim()) ||
    !(amount > 0) ||
    !Boolean(String((formData as any).description || '').trim());

  const hasDeliveryMethod = (() => {
    const md = (customerData as any)?.metadata || {};
    return Boolean(
      (customerData as any)?.deliveryMethod ||
        (customerData as any)?.delivery_method ||
        md.delivery_method
    );
  })();

  const hasCartItems = cartItemsCount > 0;

  const showOrderFields = !showPayment;

  const showDeliveryFields = (() => {
    if (isEditingOrder) return false;
    if (isEditingDelivery) return true;
    if (hasDeliveryMethod && !hasCartItems) return false;
    if (!hasDeliveryMethod && hasCartItems) return true;
    if (hasDeliveryMethod && hasCartItems) return false;
    return true;
  })();

  const [stockSuggestions, setStockSuggestions] = useState<any[]>([]);
  const [stockSuggestionsOpen, setStockSuggestionsOpen] = useState(false);
  const [stockSuggestionsLoading, setStockSuggestionsLoading] = useState(false);
  const [selectedStockItem, setSelectedStockItem] = useState<any | null>(null);

  const storeSlugForStock = String((store as any)?.slug || '').trim();
  const referenceQuery = String((formData as any)?.reference || '').trim();

  const addSuggestionToCart = async (s: any) => {
    try {
      if (!store?.id) {
        setPaymentError('Boutique invalide');
        showToast('Boutique invalide', 'error');
        return;
      }
      const customerStripeId = customerData?.id;
      if (!customerStripeId) {
        setPaymentError('Client Stripe introuvable');
        showToast('Client Stripe introuvable', 'error');
        return;
      }

      const stock = s?.stock || {};
      const product = s?.product || null;
      const ref = String(stock?.product_reference || '').trim();
      if (!ref) return;

      const qtyAvailable = Number(stock?.quantity ?? 0);
      if (Number.isFinite(qtyAvailable) && qtyAvailable <= 0) return;

      const title = String(product?.name || ref || '').trim() || ref;
      const priceRaw = Number(stock?.price);
      const value =
        Number.isFinite(priceRaw) && priceRaw > 0
          ? priceRaw
          : Number(amount || 0);

      const stripeWeightRaw = (product as any)?.metadata?.weight_kg;
      const stripeWeightParsed = stripeWeightRaw
        ? Number(String(stripeWeightRaw).replace(',', '.'))
        : NaN;
      const stockWeightRaw = Number(stock?.weight);
      const weightForCart =
        Number.isFinite(stripeWeightParsed) && stripeWeightParsed >= 0
          ? stripeWeightParsed
          : Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0
            ? stockWeightRaw
            : null;

      const productStripeId = String(stock?.product_stripe_id || '').trim();

      const resp = await apiPost('/api/carts', {
        store_id: store.id,
        product_reference: ref,
        value: value,
        customer_stripe_id: customerStripeId,
        description: title,
        quantity: 1,
        weight: weightForCart === null ? undefined : weightForCart,
        product_stripe_id: productStripeId || undefined,
      });
      const json = await resp.json().catch(() => null as any);
      if (resp.status === 409) {
        const msg =
          json?.message || 'Cette reference existe déjà dans un autre panier';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }
      if (!resp.ok) {
        const msg =
          json?.message || json?.error || "Erreur lors de l'ajout au panier";
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      setPaymentError(null);
      showToast('Ajouté au panier', 'success');
      const created = (json as any)?.item || null;
      if (created && Number(created?.store_id || 0) === store.id) {
        const createdItem: CartItem = {
          id: Number(created?.id || 0),
          product_reference: String(created?.product_reference || '').trim(),
          value: Number(created?.value || value || 0),
          quantity: Math.max(1, Number(created?.quantity || 1)),
          weight:
            typeof (created as any)?.weight === 'number'
              ? Number((created as any).weight)
              : weightForCart === null
                ? undefined
                : weightForCart,
          product_stripe_id: String(
            (created as any)?.product_stripe_id || productStripeId || ''
          ).trim(),
          created_at: String(created?.created_at || '').trim() || undefined,
          description: String(created?.description || '').trim() || title,
          payment_id:
            created?.payment_id === null || created?.payment_id === undefined
              ? null
              : String(created?.payment_id),
        };
        if (createdItem.id && createdItem.product_reference) {
          setCartItemsForStore(prev => [createdItem, ...prev]);
          setCartTotalForStore(prevTotal => {
            const qty = Math.max(1, Number(createdItem.quantity ?? 1));
            return prevTotal + createdItem.value * qty;
          });
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cart:updated'));
      }
      setSelectedStockItem(s);
      setStockSuggestionsOpen(false);
      setFormData((prev: any) => ({ ...prev, reference: '' }));
    } catch (e: any) {
      const msg = e?.message || "Erreur lors de l'ajout au panier";
      setPaymentError(msg);
      showToast(msg, 'error');
    }
  };

  useEffect(() => {
    const storeSlug = storeSlugForStock;
    const q = referenceQuery;
    if (!storeSlug || q.length < 2) {
      setStockSuggestions([]);
      setStockSuggestionsOpen(false);
      if (!q) setSelectedStockItem(null);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setStockSuggestionsLoading(true);
      try {
        const resp = await fetch(
          `${API_BASE_URL}/api/stores/${encodeURIComponent(
            storeSlug
          )}/stock/search?q=${encodeURIComponent(q)}`
        );
        const json = await resp.json().catch(() => null as any);
        if (cancelled) return;
        if (!resp.ok) {
          setStockSuggestions([]);
          setStockSuggestionsOpen(false);
          return;
        }
        const items = Array.isArray(json?.items) ? json.items : [];
        setStockSuggestions(items);
        setStockSuggestionsOpen(true);
      } finally {
        if (!cancelled) setStockSuggestionsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [storeSlugForStock, referenceQuery]);

  if (!store) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <p className='text-gray-600'>Chargement de la boutique...</p>
        </div>
      </div>
    );
  }

  const addToCart = async () => {
    try {
      if (!store?.id) {
        return setPaymentError('Boutique invalide');
      }
      const product_reference = (formData.reference || '').trim();
      if (!product_reference) {
        return setPaymentError('Référence requise');
      }
      const descriptionRaw = String((formData as any).description || '').trim();
      if (!descriptionRaw) {
        return setPaymentError('Description requise');
      }
      if (!(amount > 0)) {
        return setPaymentError('Montant invalide');
      }
      const customerStripeId = customerData?.id;
      if (!customerStripeId) {
        return setPaymentError('Client Stripe introuvable');
      }
      const normalizeText = (text: string) =>
        text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      const DICT = [
        'robe',
        'jupe',
        'pantalon',
        'jean',
        'tailleur',
        'chemise',
        'chemisier',
        'blouse',
        'top',
        'tshirt',
        'tee',
        'shirt',
        'debardeur',
        'gilet',
        'cardigan',
        'pull',
        'sweat',
        'sweatshirt',
        'veste',
        'manteau',
        'trench',
        'doudoune',
        'parka',
        'short',
        'combinaison',
        'ensemble',
        'long',
        'epais',
        'hiver',
        'manches',
        'longues',
        'courtes',
        'manche',
        'coton',
        'lin',
        'laine',
        'soie',
        'satin',
        'velours',
        'dentelle',
        'double',
        'col',
        'v',
        'roule',
      ];
      const correctTypos = (text: string) => {
        const base = normalizeText(text || '');
        const tokens = base.split(/\s+/).filter(Boolean);
        const corrected = tokens.map(tok => {
          if (tok.length < 3) return tok;
          const res = search(tok, DICT, {
            threshold: 0.7,
            returnMatchData: true,
          } as any) as any[];
          if (Array.isArray(res) && res.length > 0) {
            const best = res[0];
            return String(best.item || tok);
          }
          return tok;
        });
        for (let i = 0; i < corrected.length - 1; i++) {
          const a = corrected[i];
          const b = corrected[i + 1];
          if (a === 'manche' && b === 'longue') {
            corrected[i] = 'manche longue';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'manches' && b === 'longues') {
            corrected[i] = 'manches longues';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'manches' && b === 'courtes') {
            corrected[i] = 'manches courtes';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'tee' && b === 'shirt') {
            corrected[i] = 'tshirt';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 't' && b === 'shirt') {
            corrected[i] = 'tshirt';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'col' && b === 'v') {
            corrected[i] = 'col v';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'col' && b === 'roule') {
            corrected[i] = 'col roule';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
        }
        return corrected.join(' ');
      };
      const normalizedDescription = correctTypos(
        (formData as any).description || ''
      );

      const selectedStock = (selectedStockItem as any)?.stock || null;
      const selectedProduct = (selectedStockItem as any)?.product || null;
      const selectedRef = String(selectedStock?.product_reference || '').trim();
      const selectedMatches =
        selectedRef &&
        selectedRef.toLowerCase() === String(product_reference).toLowerCase();
      const productStripeId = selectedMatches
        ? String(selectedStock?.product_stripe_id || '').trim()
        : '';
      const stripeWeightRaw = (selectedProduct as any)?.metadata?.weight_kg;
      const stripeWeightParsed = stripeWeightRaw
        ? Number(String(stripeWeightRaw).replace(',', '.'))
        : NaN;
      const stockWeightRaw = Number(selectedStock?.weight);
      const weightForCart =
        Number.isFinite(stripeWeightParsed) && stripeWeightParsed >= 0
          ? stripeWeightParsed
          : Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0
            ? stockWeightRaw
            : null;

      const resp = await apiPost('/api/carts', {
        store_id: store.id,
        product_reference,
        value: amount,
        customer_stripe_id: customerStripeId,
        description: normalizedDescription || null,
        weight: weightForCart === null ? undefined : weightForCart,
        product_stripe_id: productStripeId || undefined,
      });
      const json = await resp.json();

      if (resp.status === 409) {
        const msg =
          json?.message || 'Cette reference existe déjà dans un autre panier';
        setPaymentError(msg);
        showToast('Cette reference existe déjà dans un autre panier', 'error');
        return;
      }
      if (!resp.ok) {
        const msg =
          json?.message || json?.error || "Erreur lors de l'ajout au panier";
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }
      setPaymentError(null);
      showToast('Ajouté au panier', 'success');
      const created = (json as any)?.item || null;
      if (created && Number(created?.store_id || 0) === store.id) {
        const createdItem: CartItem = {
          id: Number(created?.id || 0),
          product_reference: String(created?.product_reference || '').trim(),
          value: Number(created?.value || 0),
          quantity: Math.max(1, Number(created?.quantity || 1)),
          weight:
            typeof (created as any)?.weight === 'number'
              ? Number((created as any).weight)
              : weightForCart === null
                ? undefined
                : weightForCart,
          product_stripe_id: String(
            (created as any)?.product_stripe_id || productStripeId || ''
          ).trim(),
          created_at: String(created?.created_at || '').trim() || undefined,
          description:
            String(created?.description || '').trim() || normalizedDescription,
          payment_id:
            created?.payment_id === null || created?.payment_id === undefined
              ? null
              : String(created?.payment_id),
        };
        if (createdItem.id && createdItem.product_reference) {
          setCartItemsForStore(prev => [createdItem, ...prev]);
          setCartTotalForStore(prevTotal => {
            const qty = Math.max(1, Number(createdItem.quantity ?? 1));
            return prevTotal + createdItem.value * qty;
          });
        }
      }
      // Notifier le header de rafraîchir le panier
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cart:updated'));
      }
    } catch (e: any) {
      const rawMsg = e?.message || "Erreur lors de l'ajout au panier";
      setPaymentError(rawMsg);
      if (typeof rawMsg === 'string' && rawMsg.includes('reference_exists')) {
        showToast('Cette reference existe déjà dans un autre panier', 'error');
      } else {
        try {
          const match =
            typeof rawMsg === 'string' ? rawMsg.match(/\{.*\}/) : null;
          const parsed = match ? JSON.parse(match[0]) : null;
          const finalMsg = parsed?.message || rawMsg;
          showToast(finalMsg, 'error');
        } catch {
          showToast(rawMsg, 'error');
        }
      }
    }
  };

  return (
    <div className='space-y-6'>
      {showOrderFields && (
        <>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Référence de commande
            </label>
            <div className='relative'>
              <input
                type='text'
                value={formData.reference}
                onChange={e => {
                  setSelectedStockItem(null);
                  setFormData({ ...formData, reference: e.target.value });
                  setStockSuggestionsOpen(true);
                }}
                onFocus={() => {
                  if (stockSuggestions.length > 0)
                    setStockSuggestionsOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => setStockSuggestionsOpen(false), 150);
                }}
                className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
                style={{ lineHeight: '1.5' }}
                placeholder='Votre référence'
                required
              />
              {stockSuggestionsOpen &&
              (stockSuggestionsLoading || stockSuggestions.length > 0) ? (
                <div className='absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden'>
                  {stockSuggestionsLoading ? (
                    <div className='px-3 py-2 text-sm text-gray-500'>
                      Recherche…
                    </div>
                  ) : null}
                  {stockSuggestions.map((s: any, idx: number) => {
                    const stock = s?.stock || {};
                    const product = s?.product || null;
                    const ref = String(stock?.product_reference || '').trim();
                    const qty = Number(stock?.quantity ?? 0);
                    const disabled = Number.isFinite(qty) && qty <= 0;
                    const title = String(product?.name || ref || '').trim();
                    const priceRaw = Number(stock?.price);
                    const price =
                      Number.isFinite(priceRaw) && priceRaw > 0
                        ? priceRaw
                        : null;
                    const imgRaw =
                      Array.isArray(product?.images) &&
                      product.images.length > 0
                        ? String(product.images[0] || '').trim()
                        : String(stock?.image_url || '')
                            .split(',')[0]
                            ?.trim() || '';
                    return (
                      <button
                        key={String(stock?.id || ref || idx)}
                        type='button'
                        disabled={disabled}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          if (disabled) return;
                          void addSuggestionToCart(s);
                        }}
                        className={`w-full px-3 py-2 text-left flex items-center gap-3 ${
                          disabled
                            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        {imgRaw ? (
                          <img
                            src={imgRaw}
                            alt={title || ref}
                            className='w-10 h-10 rounded object-cover bg-gray-100 shrink-0'
                          />
                        ) : (
                          <div className='w-10 h-10 rounded bg-gray-100 shrink-0' />
                        )}
                        <div className='min-w-0 flex-1'>
                          <div className='text-sm font-medium truncate'>
                            {ref || '—'}
                          </div>
                          <div className='text-xs text-gray-600 truncate'>
                            {title || '—'}
                            {price !== null ? ` • ${price.toFixed(2)} €` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {selectedStockItem ? (
              <div className='mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 flex items-start gap-3'>
                {(() => {
                  const stock = (selectedStockItem as any)?.stock || {};
                  const product = (selectedStockItem as any)?.product || null;
                  const ref = String(stock?.product_reference || '').trim();
                  const title = String(product?.name || ref || '').trim();
                  const imgRaw =
                    Array.isArray(product?.images) && product.images.length > 0
                      ? String(product.images[0] || '').trim()
                      : String(stock?.image_url || '')
                          .split(',')[0]
                          ?.trim() || '';
                  const priceRaw = Number(stock?.price);
                  const price =
                    Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;
                  const stripeWeightRaw = product?.metadata?.weight_kg;
                  const stripeWeightParsed = stripeWeightRaw
                    ? Number(String(stripeWeightRaw).replace(',', '.'))
                    : NaN;
                  const stockWeightRaw = Number(stock?.weight);
                  const weight =
                    Number.isFinite(stripeWeightParsed) &&
                    stripeWeightParsed >= 0
                      ? stripeWeightParsed
                      : Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0
                        ? stockWeightRaw
                        : null;
                  return (
                    <>
                      {imgRaw ? (
                        <img
                          src={imgRaw}
                          alt={title || ref}
                          className='w-14 h-14 rounded object-cover bg-gray-100 shrink-0'
                        />
                      ) : (
                        <div className='w-14 h-14 rounded bg-gray-100 shrink-0' />
                      )}
                      <div className='min-w-0'>
                        <div className='text-sm font-semibold truncate'>
                          {title || ref || '—'}
                        </div>
                        <div className='text-xs text-gray-600 truncate'>
                          {ref || '—'}
                        </div>
                        <div className='text-xs text-gray-600'>
                          {price !== null
                            ? `Prix: ${price.toFixed(2)} €`
                            : 'Prix: —'}
                          {weight !== null ? ` • Poids: ${weight} kg` : ''}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Description
            </label>
            <textarea
              value={(formData as any).description}
              onChange={e =>
                setFormData({ ...formData, description: e.target.value })
              }
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
              style={{ lineHeight: '1.5' }}
              placeholder='Détails (taille, couleur, etc.)'
              rows={3}
              required
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Montant à payer (€)
            </label>
            <input
              type='number'
              step='0.01'
              min='0.01'
              value={amountInput}
              onChange={e => {
                let raw = e.target.value.replace(',', '.');
                const parts = raw.split('.');
                if (parts.length === 2) {
                  parts[1] = parts[1].slice(0, 2);
                  raw = `${parts[0]}.${parts[1]}`;
                }
                setAmountInput(raw);
                const value = parseFloat(raw);
                if (!isNaN(value) && value > 0) {
                  setAmount(value);
                } else {
                  setAmount(0);
                }
              }}
              onBlur={() => {
                if (amount > 0) {
                  setAmountInput(amount.toFixed(2));
                }
              }}
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
              style={{ lineHeight: '1.5' }}
              placeholder='0.00'
              required
            />

            <div className='mt-3 flex flex-col sm:flex-row gap-3'>
              <button
                type='button'
                disabled={isAddToCartDisabled}
                onClick={addToCart}
                className='flex items-center justify-center gap-1 mt-4 w-full sm:w-auto px-4 py-2.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600'
              >
                <ShoppingCart className='w-4 h-4 mr-1' />
                <span>Ajouter au panier</span>
              </button>
            </div>
          </div>
        </>
      )}

      {showDeliveryFields && customerDetailsLoaded && (
        <div className='bg-white rounded-lg shadow-sm'>
          <div className='pb-6 pt-6 border-b flex items-center space-x-3'>
            <MapPin className='w-6 h-6' style={{ color: themeColor }} />
            <h2 className='text-xl font-semibold text-gray-900'>
              Votre adresse de livraison
            </h2>
          </div>
          <div className='pt-6'>
            {(() => {
              const defaultName = user?.fullName || '';
              const defaultPhone = customerData?.phone || '';
              const currentAddress =
                address || (customerData?.address as any) || undefined;
              const addressKey = (customerData as any)?.id
                ? `addr-${String((customerData as any).id)}`
                : user?.id
                  ? `addr-${String(user.id)}`
                  : 'addr-default';
              const addressIncomplete = !(
                (formData.name || '').trim() &&
                (formData.phone || '').trim() &&
                (address as any)?.line1 &&
                (address as any)?.postal_code
              );

              return (
                <div
                  className={`rounded-md border ${
                    addressIncomplete ? 'border-red-500' : 'border-gray-300'
                  } p-2`}
                >
                  <AddressElement
                    key={addressKey}
                    options={{
                      mode: 'shipping',
                      allowedCountries: ['FR', 'BE', 'CH'],
                      fields: {
                        phone: 'always',
                      },
                      validation: {
                        phone: {
                          required: 'always',
                        },
                      },
                      defaultValues: {
                        name: defaultName,
                        phone: defaultPhone,
                        address: currentAddress,
                      },
                    }}
                    onChange={(event: any) => {
                      const { name, phone, address: addr } = event.value || {};
                      if (typeof name === 'string') {
                        setFormData((prev: any) => ({ ...prev, name }));
                      }
                      if (typeof phone === 'string') {
                        setFormData((prev: any) => ({ ...prev, phone }));
                      }

                      setAddress(addr || undefined);

                      setIsFormValid(!!event.complete);
                    }}
                  />
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ParcelPointMap (gère la méthode de livraison en interne et se met à jour sur changement d’adresse) */}
      <div className='mt-6'>
        {showDeliveryFields && customerDetailsLoaded
          ? (() => {
              const md = (customerData as any)?.metadata || {};
              const savedMethod =
                (customerData as any)?.deliveryMethod ||
                (customerData as any)?.delivery_method ||
                md.delivery_method ||
                null;
              const preferredDeliveryMethodRaw =
                (customerData as any)?.deliveryMethod ||
                (customerData as any)?.metadata?.delivery_method ||
                deliveryMethod;
              const preferredDeliveryMethod = preferredDeliveryMethodRaw;

              const hasParcelPoint =
                Boolean(selectedParcelPoint) ||
                Boolean((customerData as any)?.parcel_point) ||
                Boolean((customerData as any)?.shipping?.parcel_point) ||
                Boolean(md.parcel_point_code) ||
                Boolean((customerData as any)?.parcelPointCode);

              const showMap = isEditingDelivery || !Boolean(savedMethod);

              return (
                showMap && (
                  <ParcelPointMap
                    address={address}
                    storePickupAddress={storePickupAddress}
                    storePickupPhone={storePickupPhone}
                    storeWebsite={store?.website}
                    onParcelPointSelect={(point, method, shippingOfferCode) => {
                      setShippingHasBeenModified(true);
                      if (typeof shippingOfferCode === 'string') {
                        setFormData((prev: any) => ({
                          ...prev,
                          shippingOfferCode,
                        }));

                        if (point) {
                          setSelectedParcelPoint({
                            ...point,
                            shippingOfferCode,
                          });
                        } else {
                          setSelectedParcelPoint(null);
                        }
                      } else {
                        setSelectedParcelPoint(point);
                        setFormData((prev: any) => ({
                          ...prev,
                          shippingOfferCode: null,
                        }));
                      }

                      setDeliveryMethod(method);
                      setIsFormValid(true);
                    }}
                    defaultDeliveryMethod={deliveryMethod}
                    defaultParcelPoint={selectedParcelPoint}
                    defaultParcelPointCode={
                      (customerData as any)?.parcelPointCode ||
                      (customerData as any)?.metadata?.parcel_point ||
                      (customerData?.parcel_point?.code ?? undefined)
                    }
                    initialDeliveryNetwork={
                      (customerData as any)?.metadata?.delivery_network
                    }
                    disablePopupsOnMobile={true}
                  />
                )
              );
            })()
          : null}
      </div>

      {/* Bouton déplacé sous l'accordéon, pas ici */}
    </div>
  );
}
