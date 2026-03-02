import {
  useState,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
  RotateCcw,
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
import { DICTIONARY_ITEMS } from '../types/dictionnary_items';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const getStockItemUnitPrice = (item: any): number | null => {
  const direct = Number((item as any)?.unit_price);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const prices = Array.isArray((item as any)?.prices)
    ? (item as any).prices
    : [];
  const eur = prices.find((p: any) => {
    const currency = String(p?.currency || '').toLowerCase();
    const unitAmount = Number(p?.unit_amount ?? NaN);
    return currency === 'eur' && Number.isFinite(unitAmount) && unitAmount > 0;
  });
  if (eur) {
    const unitAmount = Number((eur as any)?.unit_amount || 0);
    const v = unitAmount / 100;
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  return null;
};

const fetchStockSearchExactMatch = async (
  storeSlug: string,
  ref: string
): Promise<any | null> => {
  const slug = String(storeSlug || '').trim();
  const q = String(ref || '').trim();
  if (!slug || q.length < 2) return null;
  const url = `${API_BASE_URL}/api/stores/${encodeURIComponent(
    slug
  )}/stock/search?q=${encodeURIComponent(q)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (resp.ok) {
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
    }
    if (attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 150));
      continue;
    }
    return null;
  }
  return null;
};

const isDeliveryRegulationText = (text: unknown) => {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return /\b(?:regulation|regularisation)\s+livraison\b/i.test(normalized);
};

const getExpectedPhonePrefixForCountry = (country: unknown) => {
  const c = String(country || '')
    .trim()
    .toUpperCase();
  if (c === 'BE') return { country: 'BE', prefix: '+32', label: 'Belgique' };
  if (c === 'FR') return { country: 'FR', prefix: '+33', label: 'France' };
  if (c === 'CH') return { country: 'CH', prefix: '+41', label: 'Suisse' };
  return null;
};

const validatePhone = (phone: unknown, country: unknown) => {
  const p = String(phone || '').trim();
  const c = String(country || '')
    .trim()
    .toUpperCase();
  if (!p || !c) return false;
  const parsed = parsePhoneNumberFromString(p, c as any);
  if (!parsed) return false;
  return parsed.isValid();
};

const getStockQuantityValue = (stockItem: any) => {
  const stock = stockItem?.stock || stockItem || null;
  const candidates = [
    stock?.quantity,
    stock?.stock_quantity,
    stock?.available_quantity,
    stock?.availableQuantity,
  ];
  for (const v of candidates) {
    const n = Number(v ?? NaN);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
};

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
  promo_code?: string | null;
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
  const [promoCodeId, setPromoCodeId] = useState<string>('');
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null);
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
  const [modifyDeliveryClickCount, setModifyDeliveryClickCount] = useState(0);
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');
  const [cartItemsForStore, setCartItemsForStore] = useState<CartItem[]>([]);
  const [cartTotalForStore, setCartTotalForStore] = useState<number>(0);
  const [cartStockByRefKey, setCartStockByRefKey] = useState<
    Record<string, any>
  >({});
  const [cartStockLoading, setCartStockLoading] = useState(false);
  const [cartQtyInputById, setCartQtyInputById] = useState<
    Record<number, string>
  >({});
<<<<<<< HEAD
  const [returnExcludedCartItemIds, setReturnExcludedCartItemIds] = useState<
    Record<number, boolean>
  >({});
  const [returnQtyInputByCartItemId, setReturnQtyInputByCartItemId] = useState<
    Record<number, string>
  >({});
  const [returnQtyByCartItemId, setReturnQtyByCartItemId] = useState<
    Record<number, number>
  >({});
=======
  const postPaymentStockCheckTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const postPaymentStockCheckInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      if (postPaymentStockCheckTimerRef.current) {
        clearInterval(postPaymentStockCheckTimerRef.current);
      }
      postPaymentStockCheckTimerRef.current = null;
      postPaymentStockCheckInFlightRef.current = false;
    };
  }, []);
>>>>>>> 5bb8d3db53140dd24dfdc88d1e3ddab2bfc8b966

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
  const [openShipmentBlockShipmentRowId, setOpenShipmentBlockShipmentRowId] =
    useState<number | null>(null);
  const [openShipmentBlockPaymentId, setOpenShipmentBlockPaymentId] =
    useState('');
  const [openShipmentAttemptPaymentId, setOpenShipmentAttemptPaymentId] =
    useState('');
  const [openShipmentEditingShipmentId, setOpenShipmentEditingShipmentId] =
    useState('');
  const [
    openShipmentEditingShipmentRowId,
    setOpenShipmentEditingShipmentRowId,
  ] = useState<number | null>(null);
  const [openShipmentActionLoading, setOpenShipmentActionLoading] =
    useState(false);
  const [tempCreditBalanceCents, setTempCreditBalanceCents] = useState(0);
  const [createdCreditCouponId, setCreatedCreditCouponId] = useState('');
  const [createdCreditPromotionCodeId, setCreatedCreditPromotionCodeId] =
    useState('');

  const openShipmentParam =
    String(searchParams.get('open_shipment') || '') === 'true';
  const paymentIdParam = String(searchParams.get('payment_id') || '').trim();
  const isOpenShipmentUrl = openShipmentParam && Boolean(paymentIdParam);

  useEffect(() => {
    if (!isOpenShipmentUrl) {
      if (openShipmentBlockModalOpen) setOpenShipmentBlockModalOpen(false);
      if (openShipmentBlockShipmentId) setOpenShipmentBlockShipmentId('');
      if (openShipmentBlockPaymentId) setOpenShipmentBlockPaymentId('');
      if (openShipmentAttemptPaymentId) setOpenShipmentAttemptPaymentId('');
      return;
    }

    if (
      openShipmentBlockModalOpen &&
      openShipmentAttemptPaymentId &&
      openShipmentAttemptPaymentId !== paymentIdParam
    ) {
      setOpenShipmentBlockModalOpen(false);
      setOpenShipmentBlockShipmentId('');
      setOpenShipmentBlockPaymentId('');
      setOpenShipmentAttemptPaymentId('');
    }
  }, [
    isOpenShipmentUrl,
    paymentIdParam,
    store?.id,
    openShipmentBlockModalOpen,
    openShipmentBlockShipmentId,
    openShipmentBlockPaymentId,
    openShipmentAttemptPaymentId,
  ]);

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

  const refreshStripeProductDetailsForCart = async (
    items: CartItem[],
    productStripeIdByRefKey?: Map<string, string>
  ) => {
    const unitPriceByProductId = new Map<string, number>();
    const productById = new Map<string, any>();
    const apiBase = API_BASE_URL;
    const ids = Array.from(
      new Set(
        (items || [])
          .map(it => {
            const ref = String(it.product_reference || '').trim();
            const pidFromStock = productStripeIdByRefKey?.get(getRefKey(ref));
            const pidFromCart = String(it.product_stripe_id || '').trim();
            return String(pidFromStock || pidFromCart || '').trim();
          })
          .filter(pid => pid.startsWith('prod_'))
      )
    );
    if (ids.length === 0) return { unitPriceByProductId, productById };

    try {
      const token = await getToken();
      const resp = await fetch(`${apiBase}/api/stripe/products/by-ids`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ ids }),
      });
      const json = await resp.json().catch(() => null as any);
      if (!resp.ok) return { unitPriceByProductId, productById };

      const products = Array.isArray(json?.products) ? json.products : [];
      for (const p of products) {
        const id = String((p as any)?.id || '').trim();
        if (id && id.startsWith('prod_')) {
          productById.set(id, p);
          const unitAmountCents = Number((p as any)?.unit_amount_cents ?? NaN);
          const unitPrice =
            Number.isFinite(unitAmountCents) && unitAmountCents > 0
              ? unitAmountCents / 100
              : NaN;
          if (Number.isFinite(unitPrice) && unitPrice > 0) {
            unitPriceByProductId.set(id, unitPrice);
          }
        }
      }
      if (productById.size === 0) return { unitPriceByProductId, productById };

      setCartStockByRefKey(prev => {
        const next = { ...prev };
        for (const it of items || []) {
          const ref = String(it.product_reference || '').trim();
          if (!ref) continue;
          const key = getRefKey(ref);
          const pid = String(
            productStripeIdByRefKey?.get(key) || it.product_stripe_id || ''
          ).trim();
          if (!pid || !pid.startsWith('prod_')) continue;
          const p = productById.get(pid) || null;
          if (!p) continue;

          const existing =
            next[key] && typeof next[key] === 'object' ? next[key] : {};
          const existingProduct =
            existing?.product && typeof existing.product === 'object'
              ? existing.product
              : null;
          const mergedProduct = existingProduct
            ? { ...existingProduct, ...p }
            : p;
          const unitAmountCents = Number((p as any)?.unit_amount_cents ?? NaN);
          const unitPrice =
            Number.isFinite(unitAmountCents) && unitAmountCents > 0
              ? unitAmountCents / 100
              : (existing?.unit_price ?? null);
          next[key] = {
            ...existing,
            product: mergedProduct,
            unit_price: unitPrice,
          };
        }
        return next;
      });
    } catch (_e) {}
    return { unitPriceByProductId, productById };
  };

  const refreshStockDetailsForCart = async (
    items: CartItem[],
    storeSlug: string
  ) => {
    const weightByRefKey = new Map<string, number>();
    const productStripeIdByRefKey = new Map<string, string>();
    const existingRefKeys = new Set<string>();
    const slug = String(storeSlug || '').trim();
    const stockByRefKey: Record<string, any> = {};
    if (!slug)
      return {
        weightByRefKey,
        productStripeIdByRefKey,
        existingRefKeys,
        stockByRefKey,
      };

    const refs = Array.from(
      new Set(
        (items || [])
          .map(it => String(it.product_reference || '').trim())
          .filter(Boolean)
      )
    );
    if (refs.length === 0)
      return {
        weightByRefKey,
        productStripeIdByRefKey,
        existingRefKeys,
        stockByRefKey,
      };

    try {
      const maxConcurrent = 4;
      let idx = 0;
      const results: Array<{ key: string; item: any | null }> = [];
      const workers = new Array(Math.min(maxConcurrent, refs.length))
        .fill(null)
        .map(async () => {
          while (idx < refs.length) {
            const current = idx++;
            const ref = refs[current];
            const key = getRefKey(ref);
            try {
              const item = await fetchStockSearchExactMatch(slug, ref);
              results.push({ key, item });
            } catch {
              results.push({ key, item: null });
            }
          }
        });
      await Promise.all(workers);

      setCartStockByRefKey(prev => {
        const next = { ...prev };
        for (const r of results) {
          next[r.key] = r.item;
          stockByRefKey[r.key] = r.item;
        }
        return next;
      });

      for (const r of results) {
        if (!r.item) continue;
        existingRefKeys.add(r.key);
        const stock = (r.item as any)?.stock || null;
        const pid = String(stock?.product_stripe_id || '').trim();
        if (pid.startsWith('prod_')) {
          productStripeIdByRefKey.set(r.key, pid);
        }
        const wRaw = Number(stock?.weight);
        const w = Number.isFinite(wRaw) && wRaw >= 0 ? wRaw : NaN;
        if (Number.isFinite(w)) {
          weightByRefKey.set(r.key, w);
        }
      }
    } catch (_e) {}

    return {
      weightByRefKey,
      productStripeIdByRefKey,
      existingRefKeys,
      stockByRefKey,
    };
  };

  const refreshCartForStore = async () => {
    const apiBase = API_BASE_URL;
    try {
      setReloadingCart(true);
      const userEmail = user?.primaryEmailAddress?.emailAddress;
      if (!userEmail || !store?.id) {
        return {
          items: [] as CartItem[],
          total: 0,
          missingRefs: [] as string[],
        };
      }

      let stripeId = String(stripeCustomerId || '').trim();
      if (!stripeId) {
        const resp = await fetch(
          `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
            userEmail
          )}`,
          { cache: 'no-store' }
        );
        const json = await resp.json().catch(() => null as any);
        if (!resp.ok) {
          const msg =
            json?.error ||
            `Erreur get-customer-details (${resp.status || 'unknown'})`;
          showToast(String(msg), 'error');
          return {
            items: cartItemsForStore || [],
            total: Number(cartTotalForStore || 0),
            missingRefs: [] as string[],
          };
        }
        stripeId = String(json?.customer?.id || '').trim();
        if (!stripeId) {
          showToast('Stripe customer id introuvable', 'error');
          return {
            items: cartItemsForStore || [],
            total: Number(cartTotalForStore || 0),
            missingRefs: [] as string[],
          };
        }
        setStripeCustomerId(stripeId);
      }

      const paymentId = String(searchParams.get('payment_id') || '').trim();
      const cartResp = await fetch(
        `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(
          stripeId
        )}${paymentId ? `&paymentId=${encodeURIComponent(paymentId)}` : ''}`,
        { cache: 'no-store' }
      );
      const cartJson = await cartResp.json().catch(() => null as any);
      if (!cartResp.ok) {
        const msg =
          cartJson?.error || `Erreur carts/summary (${cartResp.status})`;
        showToast(String(msg), 'error');
        return {
          items: cartItemsForStore || [],
          total: Number(cartTotalForStore || 0),
          missingRefs: [] as string[],
        };
      }

      const groups = Array.isArray(cartJson?.itemsByStore)
        ? cartJson.itemsByStore
        : [];
      const groupForStore = groups.find(
        (g: any) => g?.store?.id && store?.id && g.store.id === store.id
      );
      if (!groupForStore) {
        setCartItemsForStore([]);
        setCartTotalForStore(0);
        return {
          items: [] as CartItem[],
          total: 0,
          missingRefs: [] as string[],
        };
      }

      const storeSlug = String(store?.slug || '').trim();
      const items: CartItem[] = groupForStore.items || [];
      const {
        weightByRefKey,
        productStripeIdByRefKey,
        existingRefKeys,
        stockByRefKey,
      } = await refreshStockDetailsForCart(items, storeSlug);
      const { unitPriceByProductId, productById } =
        await refreshStripeProductDetailsForCart(
          items,
          productStripeIdByRefKey
        );

      const missingRefs = (items || [])
        .filter(it => {
          const ref = String(it.product_reference || '').trim();
          if (!ref) return false;
          const refKey = getRefKey(ref);
          const pidFromStock = String(
            productStripeIdByRefKey.get(refKey) || ''
          ).trim();
          const pidFromCart = String(it.product_stripe_id || '').trim();
          const hasStripeProduct =
            pidFromStock.startsWith('prod_') || pidFromCart.startsWith('prod_');
          if (!hasStripeProduct) return false;
          return !existingRefKeys.has(refKey);
        })
        .map(it => String(it.product_reference || '').trim())
        .filter(Boolean);

      const nextItems = (items || []).map(it => {
        const ref = String(it.product_reference || '').trim();
        const refKey = getRefKey(ref);
        const pid = String(
          productStripeIdByRefKey.get(refKey) || it.product_stripe_id || ''
        ).trim();
        const hasStripe = pid.startsWith('prod_');
        if (!hasStripe) return it;
        if (!ref || !existingRefKeys.has(refKey)) return it;
        const nextValue = unitPriceByProductId.get(pid) ?? it.value;
        const p = productById.get(pid) || null;
        const nextDescription =
          String((p as any)?.description || '').trim() || it.description;
        const nextWeight = weightByRefKey.get(refKey) ?? it.weight;
        if (
          nextValue === it.value &&
          nextDescription === it.description &&
          nextWeight === it.weight
        ) {
          return it;
        }
        return {
          ...it,
          value: nextValue,
          description: nextDescription,
          weight: nextWeight,
        };
      });

      const filteredItems = nextItems.filter(
        it =>
          !isDeliveryRegulationText(it.product_reference) &&
          !isDeliveryRegulationText((it as any)?.description)
      );

      const total = filteredItems.reduce(
        (sum, it) => sum + Number(it.value || 0) * Number(it.quantity || 1),
        0
      );
      setCartItemsForStore(filteredItems);
      setCartTotalForStore(total);
      return { items: filteredItems, total, missingRefs, stockByRefKey };
    } catch (_e) {
      return {
        items: cartItemsForStore || [],
        total: Number(cartTotalForStore || 0),
        missingRefs: [] as string[],
        stockByRefKey: {} as Record<string, any>,
      };
    } finally {
      setReloadingCart(false);
    }
  };

  const handleReloadCartItems = async () => {
    const result = await refreshCartForStore();
    if (result.missingRefs.length > 0) {
      const msg = `Les articles ${result.missingRefs.join(', ')} ne sont plus disponibles. Veuillez les retirer de votre panier.`;
      setPaymentError(msg);
      showToast(msg, 'error');
    }
    return result;
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
      next.delete('return_shipment');
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
          String(searchParams.get('open_shipment') || '') === 'true' ||
          String(searchParams.get('return_shipment') || '') === 'true';
        const paymentId = String(searchParams.get('payment_id') || '').trim();
        const { resp, json } = await getActiveOpenShipment();
        if (!resp.ok) return;
        const os = json?.openShipment || null;
        const openPaymentId = String(os?.payment_id || '').trim();
        const openShipmentId = String(os?.shipment_id || '').trim();
        const openShipmentRowIdRaw = Number(os?.id ?? NaN);
        const openShipmentRowId =
          Number.isFinite(openShipmentRowIdRaw) && openShipmentRowIdRaw > 0
            ? openShipmentRowIdRaw
            : null;
        if (!openPaymentId) return;

        if (openShipment && paymentId && paymentId === openPaymentId) {
          if (!cancelled) {
            setOpenShipmentEditingShipmentId(openShipmentId);
            setOpenShipmentEditingShipmentRowId(openShipmentRowId);
          }
          return;
        }

        if (!cancelled) {
          setOpenShipmentBlockPaymentId(openPaymentId);
          setOpenShipmentBlockShipmentId(openShipmentId);
          setOpenShipmentBlockShipmentRowId(openShipmentRowId);
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
      String(searchParams.get('open_shipment') || '') === 'true' ||
      String(searchParams.get('return_shipment') || '') === 'true';
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
          setOpenShipmentEditingShipmentId(sid);
          const rowIdRaw = Number((json as any)?.shipmentId ?? NaN);
          setOpenShipmentEditingShipmentRowId(
            Number.isFinite(rowIdRaw) && rowIdRaw > 0 ? rowIdRaw : null
          );
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
            const returnFlow =
              String(searchParams.get('return_shipment') || '') === 'true' &&
              Boolean(String(searchParams.get('payment_id') || '').trim());
            setCustomerData(data.customer);
            if (data.customer.name) {
              setFormData(prev => ({ ...prev, name: data.customer.name }));
            }
            if (data.customer.phone) {
              setFormData(prev => ({ ...prev, phone: data.customer.phone }));
            }
            if (returnFlow) {
              if (storePickupAddress) setAddress(storePickupAddress);
              setDeliveryMethod('pickup_point');
            } else {
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

  const validateCartQuantitiesInStock = async (
    items: CartItem[],
    freshStockByRefKey?: Record<string, any>
  ) => {
    const slug = String((store as any)?.slug || storeName || '').trim();
    if (!slug) return;

    const itemsToCheck = (items || []).filter(it => {
      const pid = String(it?.product_stripe_id || '').trim();
      return pid.startsWith('prod_');
    });
    if (itemsToCheck.length === 0) return;

    const refs = Array.from(
      new Set(
        itemsToCheck
          .map(it => String(it.product_reference || '').trim())
          .filter(Boolean)
      )
    );
    if (refs.length === 0) return;

    const resolvedByRefKey = new Map<string, any | null>();
    for (const ref of refs) {
      const key = getRefKey(ref);
      const source = freshStockByRefKey || cartStockByRefKey;
      const cached = Object.prototype.hasOwnProperty.call(source, key)
        ? (source as any)[key]
        : undefined;
      if (cached !== undefined) resolvedByRefKey.set(key, cached);
    }

    const missingRefs = refs.filter(ref => {
      const key = getRefKey(ref);
      return !resolvedByRefKey.has(key);
    });
    if (missingRefs.length > 0) {
      const maxConcurrent = 4;
      let idx = 0;
      const workers = new Array(Math.min(maxConcurrent, missingRefs.length))
        .fill(null)
        .map(async () => {
          while (idx < missingRefs.length) {
            const current = idx++;
            const ref = missingRefs[current];
            const key = getRefKey(ref);
            try {
              const item = await fetchStockSearchExactMatch(slug, ref);
              resolvedByRefKey.set(key, item);
            } catch {
              resolvedByRefKey.set(key, null);
            }
          }
        });
      await Promise.all(workers);
    }

    for (const it of itemsToCheck) {
      const ref = String(it.product_reference || '').trim();
      if (!ref) continue;
      const key = getRefKey(ref);
      const stockItem = resolvedByRefKey.get(key);
      if (!stockItem) {
        throw new Error(
          `Les articles ${ref} ne sont plus disponibles. Veuillez les retirer de votre panier.`
        );
      }
      const qtyAvailable = getStockQuantityValue(stockItem);
      const qtyRequested = Math.max(1, Math.round(Number(it.quantity || 1)));
      if (Number.isFinite(qtyAvailable)) {
        if (qtyAvailable <= 0) {
          throw new Error(`La référence ${ref} n'est plus en stock.`);
        }
        if (qtyRequested > qtyAvailable) {
          throw new Error(
            `Stock insuffisant pour la référence ${ref} (disponible: ${qtyAvailable}, demandé: ${qtyRequested}).`
          );
        }
      }
    }
  };

  const creditBalanceCents = (() => {
    const raw = (customerData as any)?.metadata?.credit_balance;
    const parsed = Number.parseInt(String(raw || '0'), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  })();

  const openShipmentModeForPromo =
    String(searchParams.get('open_shipment') || '') === 'true' &&
    Boolean(String(searchParams.get('payment_id') || '').trim());
  const canEnterPromoCode =
    !openShipmentModeForPromo &&
    customerDetailsLoaded &&
    creditBalanceCents <= 0;

  const handleProceedToPayment = async () => {
    const isReturnFlow =
      String(searchParams.get('return_shipment') || '') === 'true' &&
      Boolean(String(searchParams.get('payment_id') || '').trim());
    if (isReturnFlow) {
      setShowDelivery(true);
      setIsEditingOrder(false);
      setIsEditingDelivery(true);
      setShowPayment(false);
      setOrderAccordionOpen(true);
      setPaymentAccordionOpen(false);
      setPaymentError(null);
      setSelectedParcelPoint(null);
      setDeliveryMethod('pickup_point');
      setFormData((prev: any) => ({ ...prev, shippingOfferCode: '' }));
      if (storePickupAddress) {
        setAddress(storePickupAddress);
      }
      return;
    }

    if (
      (!isFormComplete() && cartItemsForStore.length === 0) ||
      !store ||
      !user?.primaryEmailAddress?.emailAddress
    )
      return;

    setIsProcessingPayment(true);

    try {
      let latestCartItems = [...(cartItemsForStore || [])];
      let latestCartTotal = Number(cartTotalForStore || 0);
      let missingRefs: string[] = [];
      let latestStockByRefKey: Record<string, any> | undefined;

      try {
        const refreshed = await handleReloadCartItems();
        latestCartItems = Array.isArray(refreshed?.items)
          ? refreshed.items
          : latestCartItems;
        latestCartTotal = Number(
          Number.isFinite(Number(refreshed?.total))
            ? Number(refreshed?.total)
            : latestCartTotal
        );
        missingRefs = Array.isArray(refreshed?.missingRefs)
          ? refreshed.missingRefs
          : [];
        latestStockByRefKey = refreshed?.stockByRefKey;
      } catch (e: any) {
        const msg = e?.message || 'Erreur lors du rechargement du panier';
        setPaymentError(msg);
        showToast(msg, 'error');
      }

      if (missingRefs.length > 0) {
        const msg = `Les articles ${missingRefs.join(', ')} ne sont plus disponibles. Veuillez les retirer de votre panier.`;
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      if (latestCartItems.length === 0) {
        const msg = 'Votre panier est vide';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      const blockedDeliveryRegulationItems = latestCartItems.filter(
        it =>
          isDeliveryRegulationText(it.product_reference) ||
          isDeliveryRegulationText((it as any)?.description)
      );
      if (blockedDeliveryRegulationItems.length > 0) {
        const msg =
          "Les articles 'regulation livraison' sont interdits au paiement.";
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      const refs = latestCartItems.map(it =>
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
          "Vous avez la même référence plusieurs fois dans le panier. Supprimez la référence en double et modfiier la quantité de l'autre";
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      const forbiddenItems = (latestCartItems || []).filter(
        it =>
          isDeliveryRegulationText(it.product_reference) ||
          isDeliveryRegulationText((it as any)?.description)
      );
      if (forbiddenItems.length > 0) {
        const msg =
          'Votre panier contient un article interdit (régulation livraison). Veuillez le retirer.';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      await validateCartQuantitiesInStock(latestCartItems, latestStockByRefKey);

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
                const customerMeta = (customerData as any)?.metadata || {};
                const deliveryNetworkFallback = String(
                  (customerData as any)?.deliveryNetwork ||
                    customerMeta?.delivery_network ||
                    ''
                ).trim();
                const parcelPointCodeFallback = String(
                  (customerData as any)?.parcelPointCode ||
                    customerMeta?.parcel_point ||
                    ''
                ).trim();
                const shippingNameRaw = String(
                  (customerData as any)?.shipping?.name || ''
                ).trim();
                const shippingNameParts = shippingNameRaw
                  .split(' - ')
                  .map((s: string) => String(s || '').trim())
                  .filter(Boolean);
                const inferredNetwork =
                  shippingNameParts[1] ||
                  String((deliveryNetworkFallback.split('-')[0] || '').trim());
                return {
                  code: parcelPointCodeFallback || '',
                  name: shippingNameParts[0] || shippingNameRaw || '',
                  network: inferredNetwork || '',
                  shippingOfferCode: deliveryNetworkFallback || '',
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
      if (effectiveDeliveryMethod === 'pickup_point' && !resolvedParcelPoint) {
        const msg =
          'Veuillez sélectionner un point relais avant de procéder au paiement.';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }
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

      const countryForPhoneValidation =
        effectiveDeliveryMethod === 'home_delivery'
          ? ((customerInfo.address as any)?.country ??
            (address as any)?.country ??
            (customerData as any)?.address?.country)
          : effectiveDeliveryMethod === 'pickup_point'
            ? ((resolvedParcelPoint as any)?.location?.countryIsoCode ??
              (resolvedParcelPoint as any)?.location?.country ??
              (customerData as any)?.shipping?.address?.countryIsoCode ??
              (customerData as any)?.shipping?.address?.country)
            : effectiveDeliveryMethod === 'store_pickup'
              ? ((address as any)?.country ??
                (customerData as any)?.address?.country ??
                (customerData as any)?.shipping?.address?.countryIsoCode ??
                (customerData as any)?.shipping?.address?.country ??
                'FR')
              : undefined;
      const expectedPhone = getExpectedPhonePrefixForCountry(
        countryForPhoneValidation
      );
      if (expectedPhone) {
        const ok = validatePhone(customerInfo.phone, expectedPhone.country);
        if (!ok) {
          const msg = `Numéro de téléphone invalide (${expectedPhone.label}).`;
          setPaymentError(msg);
          showToast(msg, 'error');
          return;
        }
      }

      const openShipmentMode =
        String(searchParams.get('open_shipment') || '') === 'true' &&
        Boolean(String(searchParams.get('payment_id') || '').trim());

      const enteredPromoCodeIdRaw = String(promoCodeId || '').trim();
      const enteredPromoCodeId = openShipmentMode ? '' : enteredPromoCodeIdRaw;
      if (enteredPromoCodeId) {
        if (!customerDetailsLoaded) {
          const msg = 'Chargement des informations client…';
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
        if (!canEnterPromoCode) {
          const msg =
            'Vous ne pouvez pas utiliser de code promo avec un solde positif.';
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
        if (promoCodeError) {
          const msg = promoCodeError;
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
        const normalizedPromo = enteredPromoCodeId.toUpperCase();
        if (normalizedPromo.startsWith('CREDIT-')) {
          const msg = 'Ce préfixe est réservé.';
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
        const isPayliveCode = normalizedPromo.startsWith('PAYLIVE-');
        const isValidChars = /^[A-Z0-9_-]+$/.test(normalizedPromo);
        if (!isPayliveCode && !isValidChars) {
          const msg = 'Code promo invalide.';
          setPaymentError(msg);
          showToast(msg, 'error');
          setIsProcessingPayment(false);
          return;
        }
      }

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

      const payloadItems = (latestCartItems || []).map(it => ({
        reference: String(it.product_reference || '').trim(),
        description: String((it as any).description || '').trim(),
        price: Number(it.value || 0),
        quantity: Number(it.quantity || 1),
        weight: Number((it as any).weight),
      }));

      const payloadData = {
        shippingHasBeenModified: shippingHasBeenModified,
        openShipmentPaymentId: openShipmentMode ? currentPaymentId : '',
        amount: latestCartTotal,
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

        cartItemIds: (latestCartItems || []).map(it => it.id),
        deliveryNetwork:
          effectiveDeliveryMethod === 'store_pickup'
            ? 'STORE_PICKUP'
            : (resolvedParcelPoint as any)?.shippingOfferCode ||
              (formData as any)?.shippingOfferCode ||
              (md.deliveryNetwork as any) ||
              ((md.metadata || {})?.delivery_network as any) ||
              '',
        promotionCodeId: enteredPromoCodeId
          ? enteredPromoCodeId.toUpperCase()
          : '',
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
        if (response.status === 409 && data?.blocked) {
          const ref = String(data?.reference || '').trim();
          const reason = String(data?.reason || '').trim();
          if (reason === 'already_bought' && ref) {
            throw new Error(
              `Malheureusement, la référence ${ref} a déjà été achetée.`
            );
          }
          if (reason === 'out_of_stock' && ref) {
            throw new Error(`La référence ${ref} n'est plus en stock.`);
          }
          if (reason === 'insufficient_stock' && ref) {
            const available = Number(data?.available);
            const requested = Number(data?.requested);
            if (Number.isFinite(available) && Number.isFinite(requested)) {
              throw new Error(
                `Stock insuffisant pour la référence ${ref} (disponible: ${available}, demandé: ${requested}).`
              );
            }
            throw new Error(`Stock insuffisant pour la référence ${ref}.`);
          }
          if (ref) {
            throw new Error(
              `Impossible de finaliser l'achat pour la référence ${ref}.`
            );
          }
          if (reason) {
            throw new Error(`Impossible de finaliser l'achat (${reason}).`);
          }
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
      if (effectiveDeliveryMethod === 'home_delivery') {
        const nextAddr =
          (address as any) || (customerData?.address as any) || null;
        setCustomerData(prev => ({
          ...(prev || {}),
          address: nextAddr,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network: String(
              (formData as any)?.shippingOfferCode || ''
            ).trim(),
          },
        }));
      } else if (
        effectiveDeliveryMethod === 'pickup_point' &&
        resolvedParcelPoint
      ) {
        const parcelPointToSave = selectedParcelPoint || resolvedParcelPoint;
        const loc = (parcelPointToSave as any)?.location;
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
              (parcelPointToSave as any)?.name || (prev as any)?.shipping?.name,
            phone: customerInfo.phone,
            address: shipAddr,
          },
          parcel_point: parcelPointToSave,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network: String(
              (parcelPointToSave as any)?.shippingOfferCode ||
                (formData as any)?.shippingOfferCode ||
                ''
            ).trim(),
            parcel_point_code: String(
              (parcelPointToSave as any)?.code || ''
            ).trim(),
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

  useEffect(() => {
    if (!showPayment) return;
    if (!(store as any)?.slug && !storeName) return;

    let cancelled = false;

    const validateOrRollback = async () => {
      if (cancelled) return;
      if (postPaymentStockCheckInFlightRef.current) return;
      postPaymentStockCheckInFlightRef.current = true;
      try {
        const refreshed = await handleReloadCartItems();
        if (cancelled) return;

        const missingRefs = Array.isArray(refreshed?.missingRefs)
          ? refreshed.missingRefs
          : [];
        if (missingRefs.length > 0) {
          throw new Error(
            `Les articles ${missingRefs.join(', ')} ne sont plus disponibles. Veuillez les retirer de votre panier.`
          );
        }

        const latestCartItems = Array.isArray(refreshed?.items)
          ? refreshed.items
          : [];
        if (latestCartItems.length === 0) {
          throw new Error('Votre panier est vide');
        }

        await validateCartQuantitiesInStock(
          latestCartItems,
          refreshed?.stockByRefKey
        );
      } catch (e: any) {
        const msg = e?.message || 'Erreur lors de la vérification du stock';
        setPaymentError(msg);
        showToast(msg, 'error');
        handleModifyOrder();
      } finally {
        postPaymentStockCheckInFlightRef.current = false;
      }
    };

    validateOrRollback();
    postPaymentStockCheckTimerRef.current = setInterval(
      validateOrRollback,
      1000
    );

    return () => {
      cancelled = true;
      if (postPaymentStockCheckTimerRef.current) {
        clearInterval(postPaymentStockCheckTimerRef.current);
      }
      postPaymentStockCheckTimerRef.current = null;
      postPaymentStockCheckInFlightRef.current = false;
    };
  }, [showPayment, store, storeName]);

  const handleModifyDelivery = () => {
    const shouldForceReset = modifyDeliveryClickCount >= 1;
    setModifyDeliveryClickCount(c => c + 1);
    setOrderCompleted(false);
    setOrderAccordionOpen(true);
    setPaymentAccordionOpen(false);
    setShowPayment(false);
    setIsEditingOrder(false);
    setIsEditingDelivery(true);
    setEmbeddedClientSecret('');

    if (shouldForceReset) {
      setDeliveryMethod('pickup_point');
      setSelectedParcelPoint(null);
      setFormData((prev: any) => ({ ...prev, shippingOfferCode: '' }));
      setIsFormValid(false);
      return;
    }

    const md = (customerData as any)?.metadata || {};
    const savedMethod =
      (customerData as any)?.deliveryMethod ||
      (customerData as any)?.delivery_method ||
      md?.delivery_method ||
      null;
    const normalizedMethod =
      savedMethod === 'home_delivery' ||
      savedMethod === 'pickup_point' ||
      savedMethod === 'store_pickup'
        ? savedMethod
        : null;
    setDeliveryMethod(normalizedMethod || 'pickup_point');
    setSelectedParcelPoint(null);
    setFormData((prev: any) => ({ ...prev, shippingOfferCode: '' }));
    if (!address && (customerData as any)?.address) {
      setAddress(((customerData as any)?.address || undefined) as any);
    }
    if (normalizedMethod === 'home_delivery') {
      const net = String(md?.delivery_network || '').trim();
      if (net) {
        setFormData((prev: any) => ({ ...prev, shippingOfferCode: net }));
      }
    } else if (normalizedMethod === 'pickup_point') {
      const net = String(md?.delivery_network || '').trim();
      if (net) {
        setFormData((prev: any) => ({ ...prev, shippingOfferCode: net }));
      }
    }
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
<<<<<<< HEAD
  const isOpenShipmentMode =
    (String(searchParams.get('open_shipment') || '') === 'true' ||
      String(searchParams.get('return_shipment') || '') === 'true') &&
    Boolean(String(searchParams.get('payment_id') || '').trim());
  const isReturnShipmentMode =
    String(searchParams.get('return_shipment') || '') === 'true' &&
    Boolean(String(searchParams.get('payment_id') || '').trim());
  const currentPaymentId = String(searchParams.get('payment_id') || '').trim();
  const returnVisibleCartItems = isReturnShipmentMode
    ? (cartItemsForStore || []).filter(it => !returnExcludedCartItemIds[it.id])
    : cartItemsForStore || [];
  const returnHasInvalidQty = (() => {
    if (!isReturnShipmentMode) return false;
    for (const it of returnVisibleCartItems) {
      const maxQty = Math.max(1, Math.round(Number(it.quantity || 1)));
      const raw = returnQtyInputByCartItemId[it.id];
      if (raw !== undefined) {
        const trimmed = String(raw).trim();
        if (!trimmed) return true;
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return true;
        const rounded = Math.round(n);
        if (rounded < 1 || rounded > maxQty) return true;
      }
      const desired = returnQtyByCartItemId[it.id];
      if (desired === undefined) continue;
      if (!Number.isFinite(desired)) return true;
      const rounded = Math.round(desired);
      if (rounded < 1 || rounded > maxQty) return true;
    }
    return false;
  })();
  const getReturnQtyForItem = (it: CartItem) => {
    const maxQty = Math.max(1, Math.round(Number(it.quantity || 1)));
    const raw = returnQtyInputByCartItemId[it.id];
    if (raw !== undefined) {
      const trimmed = String(raw).trim();
      if (!trimmed) return maxQty;
      const n = Number(trimmed);
      if (Number.isFinite(n)) {
        return Math.min(maxQty, Math.max(1, Math.round(n)));
      }
      return maxQty;
    }
    const desired = returnQtyByCartItemId[it.id];
    if (Number.isFinite(desired)) {
      return Math.min(maxQty, Math.max(1, Math.round(desired)));
    }
    return maxQty;
  };
  const returnSelectedCartItems = returnVisibleCartItems || [];
  const returnSelectedTotal = isReturnShipmentMode
    ? returnSelectedCartItems.reduce(
        (sum, it) => sum + Number(it.value || 0) * getReturnQtyForItem(it),
        0
      )
    : Number(cartTotalForStore || 0);
=======
  const isOpenShipmentMode = isOpenShipmentUrl;
  const currentPaymentId = paymentIdParam;
>>>>>>> 5bb8d3db53140dd24dfdc88d1e3ddab2bfc8b966

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
        <div className='sticky top-0 z-50 bg-blue-50 border-b border-blue-200'>
          <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3'>
            <div className='text-sm text-blue-800 truncate'>
              Modification de la commande{' '}
              <span className='font-semibold'>
                {openShipmentEditingShipmentId ||
                  (openShipmentEditingShipmentRowId != null
                    ? String(openShipmentEditingShipmentRowId)
                    : '')}
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
                  setOpenShipmentEditingShipmentRowId(null);
                  setOpenShipmentBlockShipmentId('');
                  setOpenShipmentBlockShipmentRowId(null);
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
                  const targetSlug = String(
                    store?.slug || storeName || ''
                  ).trim();
                  if (targetSlug && typeof window !== 'undefined') {
                    window.location.href = `/checkout/${encodeURIComponent(
                      targetSlug
                    )}`;
                  }
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
          isOpen={isOpenShipmentMode && openShipmentBlockModalOpen}
          onClose={() => {}}
          title='Modification de commande en cours'
        >
          <div className='space-y-4'>
            <div className='text-sm text-gray-700'>
              Veuillez compléter ou annuler la modification de votre commande :{' '}
              <span className='font-semibold'>
                {openShipmentBlockShipmentId ||
                  (openShipmentBlockShipmentRowId != null
                    ? String(openShipmentBlockShipmentRowId)
                    : '—')}
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
                    setOpenShipmentBlockShipmentRowId(null);
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
                      const targetSlug = String(
                        store?.slug || storeName || ''
                      ).trim();
                      if (targetSlug && typeof window !== 'undefined') {
                        window.location.href = `/checkout/${encodeURIComponent(
                          targetSlug
                        )}`;
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
                  setOpenShipmentEditingShipmentRowId(
                    openShipmentBlockShipmentRowId
                  );
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
              <Link
                to={`/store/${encodeURIComponent(
                  String(store?.slug ?? storeName ?? '').trim()
                )}`}
                className='shrink-0'
                aria-label='Aller à la boutique'
              >
                {storeLogo ? (
                  <img
                    src={storeLogo}
                    alt={store?.name}
                    className='w-16 h-16 rounded-lg object-cover hover:opacity-95'
                  />
                ) : (
                  <div className='w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center hover:bg-gray-300'>
                    <ShoppingBag className='w-8 h-8 text-gray-500' />
                  </div>
                )}
              </Link>
              <div className='min-w-0'>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2 min-w-0'>
                  <Link
                    to={`/store/${encodeURIComponent(
                      String(store?.slug ?? storeName ?? '').trim()
                    )}`}
                    className='text-2xl font-bold text-gray-900 truncate max-w-full hover:underline'
                    title={store?.name ?? storeName}
                  >
                    {store?.name ?? storeName}
                  </Link>
                </div>
                {store?.description || store?.is_verified ? (
                  <div className='mt-1'>
                    {store?.description ? (
                      <p
                        className='text-gray-600'
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
                    ) : null}
                    {store?.is_verified ? (
                      <div
                        title="Le SIRET de la boutique a été vérifié via l'INSEE"
                        className='inline-flex items-center gap-1 mt-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium size-fit'
                      >
                        <BadgeCheck className='w-3 h-3' /> Boutique Vérifiée
                      </div>
                    ) : null}
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
<<<<<<< HEAD
                {returnVisibleCartItems.length > 0 && !showPayment && (
=======
                {!showPayment && (
>>>>>>> 5bb8d3db53140dd24dfdc88d1e3ddab2bfc8b966
                  <div className='mb-6 border border-gray-200 rounded-md p-4 bg-gray-50'>
                    <div className='mb-2'>
                      <div className='flex items-center justify-between gap-3'>
                        <h3 className='text-base font-semibold text-gray-900'>
                          {isReturnShipmentMode
                            ? 'Articles à retourner'
                            : 'Articles du panier'}
                        </h3>
                        <button
                          type='button'
                          onClick={handleReloadCartItems}
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
<<<<<<< HEAD
                    <ul className='mt-1 space-y-1 max-h-40 overflow-auto text-sm text-gray-700'>
                      {returnSelectedCartItems.map(it => (
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
                              const stripePid = String(
                                stock?.product_stripe_id ||
                                  (it as any)?.product_stripe_id ||
                                  ''
                              ).trim();
                              const hasStripeProduct =
                                stripePid.startsWith('prod_');
                              const title = String(
                                product?.name ||
                                  (!hasStripeProduct
                                    ? (it as any)?.description
                                    : null) ||
                                  ref ||
                                  ''
                              ).trim();
                              const stripeDesc = hasStripeProduct
                                ? String(product?.description || '').trim()
                                : '';
                              const cartDesc = String(
                                hasStripeProduct
                                  ? stripeDesc
                                  : (it as any)?.description || ''
                              ).trim();
                              const showDesc = Boolean(cartDesc);
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
                                    {showDesc ? (
                                      <div className='truncate text-xs text-gray-500'>
                                        {cartDesc}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          <div className='flex items-center gap-2'>
                            {(() => {
                              const currentQty = Math.max(
                                1,
                                Math.round(Number(it.quantity || 1))
                              );
                              const purchaseQty = currentQty;
                              const localValue = isReturnShipmentMode
                                ? returnQtyInputByCartItemId[it.id] !== undefined
                                  ? returnQtyInputByCartItemId[it.id]
                                  : String(getReturnQtyForItem(it))
                                : cartQtyInputById[it.id] !== undefined
                                  ? cartQtyInputById[it.id]
                                  : String(currentQty);
=======
                    {cartItemsForStore.length === 0 ? (
                      <div className='text-sm text-gray-600'>
                        Aucun article dans votre panier
                      </div>
                    ) : (
                      <ul className='mt-1 max-h-40 overflow-auto text-sm text-gray-700 divide-y divide-gray-200'>
                        {cartItemsForStore
                          .filter(
                            it =>
                              !isDeliveryRegulationText(it.product_reference) &&
                              !isDeliveryRegulationText(
                                (it as any)?.description
                              )
                          )
                          .map(it => (
                            <li
                              key={it.id}
                              className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3'
                            >
                              <div className='min-w-0 sm:flex-1'>
                                {(() => {
                                  const ref = String(
                                    it.product_reference || ''
                                  ).trim();
                                  const key = getRefKey(ref);
                                  const info = cartStockByRefKey[key] || null;
                                  const stock = info?.stock || null;
                                  const product = info?.product || null;
                                  const stripePid = String(
                                    stock?.product_stripe_id ||
                                      (it as any)?.product_stripe_id ||
                                      ''
                                  ).trim();
                                  const hasStripeProduct =
                                    stripePid.startsWith('prod_');
                                  const title = String(
                                    product?.name ||
                                      (!hasStripeProduct
                                        ? (it as any)?.description
                                        : null) ||
                                      ref ||
                                      ''
                                  ).trim();
                                  const stripeDesc = hasStripeProduct
                                    ? String(product?.description || '').trim()
                                    : '';
                                  const cartDesc = String(
                                    hasStripeProduct
                                      ? stripeDesc
                                      : (it as any)?.description || ''
                                  ).trim();
                                  const showDesc = Boolean(cartDesc);
                                  const imgRaw =
                                    Array.isArray(product?.images) &&
                                    product.images.length > 0
                                      ? String(product.images[0] || '').trim()
                                      : String(stock?.image_url || '')
                                          .split(',')[0]
                                          ?.trim() || '';
                                  return (
                                    <div className='flex items-start justify-between gap-2'>
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
                                          <div className='font-medium text-gray-900 break-words'>
                                            {ref || '—'}
                                          </div>
                                          <div className='text-xs text-gray-600 break-words'>
                                            {title || '—'}
                                          </div>
                                          {showDesc ? (
                                            <div className='text-xs text-gray-500 break-words'>
                                              {cartDesc}
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                      <button
                                        type='button'
                                        onClick={() =>
                                          handleDeleteCartItem(it.id)
                                        }
                                        className='sm:hidden p-1 rounded hover:bg-red-50 text-red-600 shrink-0'
                                        aria-label='Supprimer cet article'
                                      >
                                        <Trash2 className='w-4 h-4' />
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className='w-full sm:w-auto'>
                                <div className='mt-2 flex items-center justify-between gap-2 sm:mt-0 sm:justify-end sm:gap-2'>
                                  {(() => {
                                    const currentQty = Math.max(
                                      1,
                                      Math.round(Number(it.quantity || 1))
                                    );
                                    const localValue =
                                      cartQtyInputById[it.id] !== undefined
                                        ? cartQtyInputById[it.id]
                                        : String(currentQty);
>>>>>>> 5bb8d3db53140dd24dfdc88d1e3ddab2bfc8b966

                                    return (
                                      <div className='flex items-center gap-1'>
                                        <button
                                          type='button'
                                          onClick={() => {
                                            const next = Math.max(
                                              1,
                                              currentQty - 1
                                            );
                                            setCartQtyInputById(prev => {
                                              const out = { ...prev };
                                              delete out[it.id];
                                              return out;
                                            });
                                            handleUpdateCartItemQuantity(
                                              it.id,
                                              next
                                            );
                                          }}
                                          className='h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60'
                                          aria-label='Diminuer la quantité'
                                          disabled={currentQty <= 1}
                                        >
                                          -
                                        </button>
                                        <input
                                          type='number'
                                          inputMode='numeric'
                                          min={1}
                                          step={1}
                                          value={localValue}
                                          onChange={e => {
                                            const next = String(
                                              e.target.value || ''
                                            );
                                            setCartQtyInputById(prev => ({
                                              ...prev,
                                              [it.id]: next,
                                            }));
                                          }}
                                          onKeyDown={e => {
                                            if (e.key !== 'Enter') return;
                                            (e.currentTarget as any)?.blur?.();
                                          }}
                                          onBlur={() => {
                                            const raw = String(
                                              cartQtyInputById[it.id] ??
                                                currentQty
                                            );
                                            const parsed = Math.max(
                                              1,
                                              Math.floor(Number(raw || 1))
                                            );
                                            setCartQtyInputById(prev => {
                                              const next = { ...prev };
                                              delete next[it.id];
                                              return next;
                                            });
                                            handleUpdateCartItemQuantity(
                                              it.id,
                                              parsed
                                            );
                                          }}
                                          className='h-8 w-14 rounded-md border border-gray-200 px-2 text-sm text-gray-900'
                                          aria-label='Quantité'
                                        />
                                        <button
                                          type='button'
                                          onClick={() => {
                                            const next = Math.max(
                                              1,
                                              currentQty + 1
                                            );
                                            setCartQtyInputById(prev => {
                                              const out = { ...prev };
                                              delete out[it.id];
                                              return out;
                                            });
                                            handleUpdateCartItemQuantity(
                                              it.id,
                                              next
                                            );
                                          }}
                                          className='h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60'
                                          aria-label='Augmenter la quantité'
                                        >
                                          +
                                        </button>
                                      </div>
                                    );
                                  })()}
                                  <span className='whitespace-nowrap text-xs text-gray-600'>
                                    {Number(it.value || 0).toFixed(2)} €/u
                                  </span>
<<<<<<< HEAD
                                  <input
                                    type='number'
                                    min='1'
                                    max={isReturnShipmentMode ? purchaseQty : undefined}
                                    step='1'
                                    value={localValue}
                                    onChange={e => {
                                      const next = String(e.target.value || '');
                                      if (isReturnShipmentMode) {
                                        setReturnQtyInputByCartItemId(prev => ({
                                          ...prev,
                                          [it.id]: next,
                                        }));
                                      } else {
                                        setCartQtyInputById(prev => ({
                                          ...prev,
                                          [it.id]: next,
                                        }));
                                      }
                                    }}
                                    onKeyDown={e => {
                                      if (e.key !== 'Enter') return;
                                      (e.currentTarget as any)?.blur?.();
                                    }}
                                    onBlur={() => {
                                      if (isReturnShipmentMode) {
                                        const raw = String(
                                          returnQtyInputByCartItemId[it.id] ??
                                            returnQtyByCartItemId[it.id] ??
                                            purchaseQty
                                        );
                                        const n = Number(String(raw || '').trim());
                                        const parsed = Math.min(
                                          purchaseQty,
                                          Math.max(
                                            1,
                                            Math.round(Number.isFinite(n) ? n : purchaseQty)
                                          )
                                        );
                                        setReturnQtyInputByCartItemId(prev => {
                                          const next = { ...prev };
                                          delete next[it.id];
                                          return next;
                                        });
                                        setReturnQtyByCartItemId(prev => ({
                                          ...prev,
                                          [it.id]: parsed,
                                        }));
                                      } else {
                                        const raw = String(
                                          cartQtyInputById[it.id] ?? currentQty
                                        );
                                        const parsed = Math.max(
                                          1,
                                          Math.round(Number(raw || 1))
                                        );
                                        setCartQtyInputById(prev => {
                                          const next = { ...prev };
                                          delete next[it.id];
                                          return next;
                                        });
                                        handleUpdateCartItemQuantity(
                                          it.id,
                                          parsed
                                        );
                                      }
                                    }}
                                    className='border border-gray-300 rounded px-2 py-0.5 text-sm w-20'
                                    aria-label='Quantité'
                                  />
                                </>
                              );
                            })()}
                            <span className='whitespace-nowrap'>
                              {(
                                Number(it.value || 0) *
                                Number(
                                  isReturnShipmentMode
                                    ? getReturnQtyForItem(it)
                                    : Number(it.quantity || 1)
                                )
                              ).toFixed(2)}{' '}
                              €
                            </span>
                            <button
                              type='button'
                              disabled={
                                isReturnShipmentMode && returnSelectedCartItems.length <= 1
                              }
                              onClick={() => {
                                if (isReturnShipmentMode) {
                                  if (returnSelectedCartItems.length <= 1) return;
                                  setReturnExcludedCartItemIds(prev => ({
                                    ...prev,
                                    [it.id]: true,
                                  }));
                                  return;
                                }
                                handleDeleteCartItem(it.id);
                              }}
                              className={`p-1 rounded text-red-600 ${
                                isReturnShipmentMode && returnSelectedCartItems.length <= 1
                                  ? 'opacity-40 cursor-not-allowed'
                                  : 'hover:bg-red-50'
                              }`}
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
                      <span>{Number(returnSelectedTotal || 0).toFixed(2)} €</span>
                    </div>
                    {canEnterPromoCode ? (
                      <div className='mt-3'>
                        <label
                          htmlFor='cart-promo-code'
                          className='block text-sm font-medium text-gray-700 mb-1'
                        >
                          Code promo
                        </label>
                        <input
                          id='cart-promo-code'
                          value={promoCodeId}
                          onChange={e => {
                            setPromoCodeId(
                              String(e.target.value || '').toUpperCase()
                            );
                            const next = String(
                              e.target.value || ''
                            ).toUpperCase();
                            if (!next) {
                              setPromoCodeError(null);
                              return;
                            }
                            if (next.startsWith('PAYLIVE-')) {
                              setPromoCodeError(null);
                              return;
                            }
                            setPromoCodeError(null);
                          }}
                          placeholder='PAYLIVE-...'
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                        />
                        {promoCodeError ? (
                          <p className='text-xs text-red-600 mt-1'>
                            {promoCodeError}
                          </p>
                        ) : (
                          <p className='text-xs text-gray-500 mt-1'>
                            Un seul code promo (optionnel).
                          </p>
                        )}
                      </div>
=======
                                  <span className='whitespace-nowrap font-semibold text-gray-900'>
                                    {(
                                      Number(it.value || 0) *
                                      Number(it.quantity || 1)
                                    ).toFixed(2)}{' '}
                                    €
                                  </span>
                                  <button
                                    type='button'
                                    onClick={() => handleDeleteCartItem(it.id)}
                                    className='hidden sm:inline-flex p-1 rounded hover:bg-red-50 text-red-600'
                                    aria-label='Supprimer cet article'
                                  >
                                    <Trash2 className='w-4 h-4' />
                                  </button>
                                </div>
                              </div>
                            </li>
                          ))}
                      </ul>
                    )}
                    {cartItemsForStore.length > 0 ? (
                      <>
                        <div className='mt-3 flex items-center justify-between border-t border-gray-200 pt-2 text-sm font-semibold text-gray-900'>
                          <span>Total</span>
                          <span>
                            {Number(cartTotalForStore || 0).toFixed(2)} €
                          </span>
                        </div>
                        {canEnterPromoCode ? (
                          <div className='mt-3'>
                            <input
                              id='cart-promo-code'
                              value={promoCodeId}
                              onChange={e => {
                                const next = String(
                                  e.target.value || ''
                                ).toUpperCase();
                                setPromoCodeId(next);
                                if (!next) {
                                  setPromoCodeError(null);
                                  return;
                                }
                                if (next.startsWith('CREDIT-')) {
                                  setPromoCodeError('Ce préfixe est réservé.');
                                  return;
                                }
                                if (next.startsWith('PAYLIVE-')) {
                                  setPromoCodeError(null);
                                  return;
                                }
                                setPromoCodeError(null);
                              }}
                              placeholder='Entrer un seul code promo (optionnel)'
                              className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                            />
                            {promoCodeError && (
                              <p className='text-xs text-red-600 mt-1'>
                                {promoCodeError}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </>
>>>>>>> 5bb8d3db53140dd24dfdc88d1e3ddab2bfc8b966
                    ) : null}
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
                  isReturnShipmentMode={isReturnShipmentMode}
                  showDelivery={showDelivery}
                  setShowDelivery={setShowDelivery}
                  showToast={showToast}
                  cartItemsForStore={cartItemsForStore}
                  setCartItemsForStore={setCartItemsForStore}
                  setCartTotalForStore={setCartTotalForStore}
                  shippingHasBeenModified={shippingHasBeenModified}
                  setShippingHasBeenModified={setShippingHasBeenModified}
                  isEditingDelivery={isEditingDelivery}
                  isEditingOrder={isEditingOrder}
                  isOpenShipmentMode={isOpenShipmentMode}
                  currentPaymentId={currentPaymentId}
                  cartItemsCount={cartItemsForStore.length}
                  refreshCartForStore={handleReloadCartItems}
                />
                {!orderCompleted &&
                  customerDetailsLoaded &&
                  !isEditingDelivery &&
                  (() => {
                    if (deliveryMethod === 'home_delivery') {
                      const homeAddr =
                        address || (customerData?.address as any);
                      return Boolean(
                        homeAddr?.line1 &&
                          homeAddr?.postal_code &&
                          homeAddr?.city
                      );
                    }
                    if (deliveryMethod === 'pickup_point') {
                      const ship = (customerData as any)?.shipping;
                      const name =
                        ship?.name || selectedParcelPoint?.name || null;
                      const addr =
                        ship?.address || selectedParcelPoint?.location;
                      return Boolean(name || addr);
                    }
                    if (deliveryMethod === 'store_pickup') {
                      return Boolean(storePickupAddress?.line1);
                    }
                    return false;
                  })() && (
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
                                    : ''}, {homeAddr.postal_code}{' '}
                                  {homeAddr.city}
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
                  )}
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
                  const md = (customerData as any)?.metadata || {};
                  const savedMethod =
                    (customerData as any)?.deliveryMethod ||
                    (customerData as any)?.delivery_method ||
                    md?.delivery_method ||
                    null;
                  const hasItems = isReturnShipmentMode
                    ? returnSelectedCartItems.length > 0
                    : cartItemsForStore.length > 0;
                  const deliveryIsValid = isEditingDelivery
                    ? isFormComplete()
                    : savedMethod
                      ? true
                      : isFormComplete();

                  const hasParcelPoint =
                    Boolean(selectedParcelPoint) ||
                    Boolean((customerData as any)?.parcel_point) ||
                    Boolean((customerData as any)?.shipping?.parcel_point) ||
                    Boolean(md?.parcel_point_code) ||
                    Boolean((customerData as any)?.parcelPointCode);
                  const parcelPointOk =
                    deliveryMethod !== 'pickup_point' || hasParcelPoint;

                  const needsAddressElementValidation =
                    deliveryMethod === 'home_delivery' &&
                    (isEditingDelivery || !savedMethod);
                  const addressElementOk =
                    !needsAddressElementValidation || isFormValid;

                  const canProceed =
                    hasItems &&
                    deliveryIsValid &&
                    parcelPointOk &&
                    addressElementOk &&
                    (!isReturnShipmentMode || !returnHasInvalidQty);

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
                          {isReturnShipmentMode ? (
                            <RotateCcw className='w-5 h-5' />
                          ) : (
                            <CreditCard className='w-5 h-5' />
                          )}
                          <span>
                            {isReturnShipmentMode
                              ? 'Procéder au retour'
                              : 'Procéder au paiement'}
                          </span>
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
  isReturnShipmentMode,

  showDelivery,
  setShowDelivery,
  showToast,
  cartItemsForStore,
  setCartItemsForStore,
  setCartTotalForStore,
  isEditingDelivery,
  shippingHasBeenModified,
  setShippingHasBeenModified,
  isEditingOrder,
  isOpenShipmentMode,
  currentPaymentId,
  cartItemsCount,
  refreshCartForStore,
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
  isReturnShipmentMode: boolean;

  showDelivery: boolean;
  setShowDelivery: (val: boolean) => void;
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  cartItemsForStore: CartItem[];
  setCartItemsForStore: Dispatch<SetStateAction<CartItem[]>>;
  setCartTotalForStore: Dispatch<SetStateAction<number>>;
  isEditingDelivery: boolean;
  shippingHasBeenModified: boolean;
  setShippingHasBeenModified: (val: boolean) => void;
  isEditingOrder: boolean;
  isOpenShipmentMode: boolean;
  currentPaymentId: string;
  cartItemsCount: number;
  refreshCartForStore: () => Promise<{
    items: CartItem[];
    total: number;
    missingRefs: string[];
  }>;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const hasDeliveryMethod = (() => {
    const md = (customerData as any)?.metadata || {};
    return Boolean(
      (customerData as any)?.deliveryMethod ||
        (customerData as any)?.delivery_method ||
        md.delivery_method
    );
  })();

  const hasCartItems = cartItemsCount > 0;

  const showOrderFields = !showPayment && !isReturnShipmentMode;

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
  const [isReferenceInputFocused, setIsReferenceInputFocused] = useState(false);

  const storeSlugForStock = String((store as any)?.slug || '').trim();
  const referenceQuery = String((formData as any)?.reference || '').trim();

  const selectedReference = String(
    (selectedStockItem as any)?.stock?.product_reference || ''
  ).trim();
  const mustSelectSuggestionOrChangeReference =
    Boolean(referenceQuery) &&
    Boolean(selectedReference) &&
    selectedReference.toLowerCase() === referenceQuery.toLowerCase();

  const isDeliveryRegulationEntry =
    isDeliveryRegulationText(referenceQuery) ||
    isDeliveryRegulationText(
      String((formData as any)?.description || '').trim()
    );

  const isAddToCartDisabled =
    mustSelectSuggestionOrChangeReference ||
    !Boolean(referenceQuery) ||
    !(amount > 0) ||
    !Boolean(String((formData as any).description || '').trim()) ||
    isDeliveryRegulationEntry;

  const refKey = (ref: string) =>
    String(ref || '')
      .trim()
      .toLowerCase();

  const incrementExistingCartItem = async (
    existing: CartItem,
    deltaQty: number
  ) => {
    const currentQty = Math.max(1, Math.round(Number(existing.quantity || 1)));
    const nextQty = currentQty + Math.max(1, Math.round(Number(deltaQty || 1)));
    try {
      const apiBase = API_BASE_URL;
      const resp = await fetch(`${apiBase}/api/carts/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: nextQty }),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => null as any);
        const msg =
          json?.message ||
          json?.error ||
          'Erreur lors de la mise à jour du panier';
        setPaymentError(msg);
        showToast(msg, 'error');
        return false;
      }

      setPaymentError(null);
      showToast('Quantité mise à jour', 'success');
      setCartItemsForStore(prev =>
        prev.map(it =>
          it.id === existing.id ? { ...it, quantity: nextQty } : it
        )
      );
      const unitValue = Number(existing.value || 0);
      setCartTotalForStore(
        prevTotal => prevTotal + unitValue * (nextQty - currentQty)
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cart:updated'));
      }
      return true;
    } catch (e: any) {
      const msg = e?.message || 'Erreur lors de la mise à jour du panier';
      setPaymentError(msg);
      showToast(msg, 'error');
      return false;
    }
  };

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
      const title = String(product?.name || ref || '').trim() || ref;
      if (isDeliveryRegulationText(ref) || isDeliveryRegulationText(title)) {
        const msg = 'Référence interdite';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      const existing = (cartItemsForStore || []).find(
        it => refKey(it.product_reference) === refKey(ref)
      );
      if (existing) {
        await incrementExistingCartItem(existing, 1);
        await refreshCartForStore().catch(() => {});
        setSelectedStockItem(s);
        setStockSuggestionsOpen(false);
        setFormData((prev: any) => ({ ...prev, reference: '' }));
        return;
      }

      const qtyAvailable = Number(stock?.quantity ?? NaN);
      if (Number.isFinite(qtyAvailable) && qtyAvailable <= 0) return;

      const unitPrice = getStockItemUnitPrice(s);
      const value =
        unitPrice && unitPrice > 0 ? unitPrice : Number(amount || 0);

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
        ...(isOpenShipmentMode && currentPaymentId
          ? { payment_id: currentPaymentId }
          : {}),
        description: title,
        quantity: 1,
        weight: weightForCart === null ? undefined : weightForCart,
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
      await refreshCartForStore().catch(() => {});

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
        const filtered = items.filter((it: any) => {
          const qRaw = (it as any)?.stock?.quantity;
          const q =
            typeof qRaw === 'number'
              ? qRaw
              : typeof qRaw === 'string'
                ? Number(qRaw)
                : qRaw === null || qRaw === undefined
                  ? null
                  : Number(qRaw);
          const stockRef = String(it?.stock?.product_reference || '').trim();
          const title = String(it?.product?.name || '').trim();
          return (
            !(q !== null && Number.isFinite(q) && q <= 0) &&
            !isDeliveryRegulationText(stockRef) &&
            !isDeliveryRegulationText(title)
          );
        });
        setStockSuggestions(filtered);
        setStockSuggestionsOpen(true);
        const qKey = String(q || '')
          .trim()
          .toLowerCase();
        const exact = filtered.find((it: any) => {
          const r = String(it?.stock?.product_reference || '')
            .trim()
            .toLowerCase();
          return r === qKey;
        });
        if (exact) {
          setSelectedStockItem(exact);
          const unitPrice = getStockItemUnitPrice(exact);
          if (unitPrice) {
            setAmount(unitPrice);
            setAmountInput(String(unitPrice));
          }
        }
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
      if (
        isDeliveryRegulationText(product_reference) ||
        isDeliveryRegulationText(descriptionRaw)
      ) {
        const msg = 'Référence interdite';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
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
      const correctTypos = (text: string) => {
        const base = normalizeText(text || '');
        const tokens = base.split(/\s+/).filter(Boolean);
        const corrected = tokens.map(tok => {
          if (tok.length < 3) return tok;
          const res = search(tok, DICTIONARY_ITEMS, {
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

      const resolvedStockItem = selectedMatches
        ? selectedStockItem
        : await fetchStockSearchExactMatch(
            storeSlugForStock,
            product_reference
          );
      const resolvedStock = (resolvedStockItem as any)?.stock || null;
      const resolvedProduct = (resolvedStockItem as any)?.product || null;

      const resolvedRef = String(resolvedStock?.product_reference || '').trim();
      const resolvedMatches =
        resolvedRef &&
        resolvedRef.toLowerCase() === String(product_reference).toLowerCase();

      const qtyAvailable = Number(resolvedStock?.quantity ?? NaN);
      if (Number.isFinite(qtyAvailable) && qtyAvailable <= 0) {
        const msg = 'Produit indisponible (stock épuisé)';
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }

      const productStripeId = resolvedMatches
        ? String(resolvedStock?.product_stripe_id || '').trim()
        : '';

      const resolvedUnitPrice = getStockItemUnitPrice(resolvedStockItem);
      const resolvedValue =
        resolvedUnitPrice && resolvedUnitPrice > 0 ? resolvedUnitPrice : amount;
      if (Number.isFinite(resolvedValue) && resolvedValue > 0) {
        setAmount(resolvedValue);
        setAmountInput(String(resolvedValue));
      }

      const stripeWeightRaw = (resolvedProduct as any)?.metadata?.weight_kg;
      const stripeWeightParsed = stripeWeightRaw
        ? Number(String(stripeWeightRaw).replace(',', '.'))
        : NaN;
      const stockWeightRaw = Number(resolvedStock?.weight);
      const weightForCart =
        Number.isFinite(stripeWeightParsed) && stripeWeightParsed >= 0
          ? stripeWeightParsed
          : Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0
            ? stockWeightRaw
            : null;

      const existing = (cartItemsForStore || []).find(
        it => refKey(it.product_reference) === refKey(product_reference)
      );
      if (existing) {
        await incrementExistingCartItem(existing, 1);
        await refreshCartForStore().catch(() => {});
        return;
      }

      const resp = await apiPost('/api/carts', {
        store_id: store.id,
        product_reference,
        value: resolvedValue,
        customer_stripe_id: customerStripeId,
        ...(isOpenShipmentMode && currentPaymentId
          ? { payment_id: currentPaymentId }
          : {}),
        description: normalizedDescription || null,
        weight: weightForCart === null ? undefined : weightForCart,
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
      await refreshCartForStore().catch(() => {});
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
                  setIsReferenceInputFocused(true);
                  if (stockSuggestions.length > 0)
                    setStockSuggestionsOpen(true);
                }}
                onBlur={() => {
                  setIsReferenceInputFocused(false);
                  setTimeout(() => setStockSuggestionsOpen(false), 150);
                }}
                className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
                style={{ lineHeight: '1.5' }}
                placeholder='Votre référence'
                required
              />
              {stockSuggestionsOpen
                ? (() => {
                    const visibleSuggestions = stockSuggestions.filter(
                      (s: any) => {
                        const qRaw = (s as any)?.stock?.quantity;
                        const q =
                          typeof qRaw === 'number'
                            ? qRaw
                            : typeof qRaw === 'string'
                              ? Number(qRaw)
                              : qRaw === null || qRaw === undefined
                                ? null
                                : Number(qRaw);
                        const ref = String(
                          (s as any)?.stock?.product_reference || ''
                        ).trim();
                        const title = String(
                          (s as any)?.product?.name || ''
                        ).trim();
                        return (
                          !(q !== null && Number.isFinite(q) && q <= 0) &&
                          !isDeliveryRegulationText(ref) &&
                          !isDeliveryRegulationText(title)
                        );
                      }
                    );
                    if (
                      !stockSuggestionsLoading &&
                      visibleSuggestions.length === 0
                    ) {
                      return null;
                    }
                    return (
                      <div className='absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden'>
                        {stockSuggestionsLoading ? (
                          <div className='px-3 py-2 text-sm text-gray-500'>
                            Recherche…
                          </div>
                        ) : null}
                        {visibleSuggestions.map((s: any, idx: number) => {
                          const stock = s?.stock || {};
                          const product = s?.product || null;
                          const ref = String(
                            stock?.product_reference || ''
                          ).trim();
                          const qRaw = stock?.quantity;
                          const qty =
                            typeof qRaw === 'number'
                              ? qRaw
                              : typeof qRaw === 'string'
                                ? Number(qRaw)
                                : qRaw === null || qRaw === undefined
                                  ? null
                                  : Number(qRaw);
                          const disabled =
                            qty !== null && Number.isFinite(qty) && qty <= 0;
                          const title = String(
                            product?.name || ref || ''
                          ).trim();
                          const unitPrice = getStockItemUnitPrice(s);
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
                                  {unitPrice
                                    ? ` • ${unitPrice.toFixed(2)} €`
                                    : ''}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()
                : null}
            </div>
            {selectedStockItem && !isReferenceInputFocused ? (
              <div
                className='mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-100'
                role='button'
                tabIndex={0}
                onClick={() => addSuggestionToCart(selectedStockItem)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  addSuggestionToCart(selectedStockItem);
                }}
              >
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
                  const unitPrice = getStockItemUnitPrice(selectedStockItem);
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
                          {unitPrice
                            ? `Prix: ${unitPrice.toFixed(2)} €`
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
              disabled={mustSelectSuggestionOrChangeReference}
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed`}
              style={{ lineHeight: '1.5' }}
              placeholder='Permet de calculer le poids de votre colis. Soyez le plus précis possible.'
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
              disabled={mustSelectSuggestionOrChangeReference}
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
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed`}
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

      {showDeliveryFields && customerDetailsLoaded && !isReturnShipmentMode && (
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
              const savedMethodNormalized =
                savedMethod === 'home_delivery' ||
                savedMethod === 'pickup_point' ||
                savedMethod === 'store_pickup'
                  ? savedMethod
                  : null;
              const mapDefaultDeliveryMethod = deliveryMethod;
              const mapAddress = isReturnShipmentMode
                ? storePickupAddress
                : address || ((customerData as any)?.address as any) || undefined;

              return (
                showMap && (
                  <ParcelPointMap
                    mode={isReturnShipmentMode ? 'return' : 'delivery'}
                    address={mapAddress}
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
                          shippingOfferCode: '',
                        }));
                      }

                      setDeliveryMethod(method);
                      setIsFormValid(true);
                    }}
                    defaultDeliveryMethod={mapDefaultDeliveryMethod}
                    defaultParcelPoint={selectedParcelPoint}
                    defaultParcelPointCode={
                      (customerData as any)?.parcelPointCode ||
                      (customerData as any)?.metadata?.parcel_point ||
                      (customerData?.parcel_point?.code ?? undefined)
                    }
                    initialDeliveryNetwork={
                      (formData as any)?.shippingOfferCode
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
