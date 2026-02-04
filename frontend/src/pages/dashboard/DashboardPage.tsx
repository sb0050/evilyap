import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../../components/Header';
import Spinner from '../../components/Spinner';
import {
  Wallet,
  ShoppingCart,
  ArrowRight,
  Upload,
  Info,
  Users,
  ArrowUpDown,
  RefreshCw,
  LifeBuoy,
  Copy,
  HandCoins,
  Pencil,
  SendHorizontal,
  BadgeCheck,
  Tag,
  Trash2,
  Coins,
  Dice5,
  Check,
} from 'lucide-react';
import {
  FaFacebook,
  FaGoogle,
  FaTiktok,
  FaApple,
  FaShareAlt,
  FaArchive,
} from 'react-icons/fa';
import { Toast } from '../../components/Toast';
import { useToast } from '../../utils/toast';
import {
  apiPut,
  apiPost,
  apiPostForm,
  apiGet,
  apiDelete,
  API_BASE_URL,
} from '../../utils/api';
import SuccessConfetti from '../../components/SuccessConfetti';
import { RiDiscountPercentFill } from 'react-icons/ri';
import { FR, BE } from 'country-flag-icons/react/3x2';
import { AddressElement } from '@stripe/react-stripe-js';
import { Address } from '@stripe/stripe-js';
import StripeWrapper from '../../components/StripeWrapper';

// Vérifications d’accès centralisées dans Header; suppression de Protect ici
// Slugification supprimée côté frontend; on utilise le backend

type Store = {
  id: number;
  name: string;
  slug: string;
  clerk_id?: string | null;
  description?: string | null;
  website?: string | null;
  siret?: string | null;
  iban_bic?: { iban: string; bic: string } | null;
  payout_created_at?: string | null;
  product_value?: number | null;
  is_verified?: boolean;
};

type Shipment = {
  id: number;
  store_id: number | null;
  customer_stripe_id: string | null;
  shipment_id: string | null;
  document_created: boolean;
  document_url?: string | null;
  delivery_method: string | null;
  delivery_network: string | null;
  dropoff_point: any | null;
  pickup_point: object | null;
  weight: number | null;
  product_reference: string | null;
  description?: string | null;
  paid_value: number | null;
  created_at?: string | null;
  status?: string | null;
  estimated_delivery_date?: string | null;
  cancel_requested?: boolean | null;
  is_final_destination?: boolean | null;
  delivery_cost?: number | null;
  tracking_url?: string | null;
  promo_codes?: string | null;
  product_value?: number | null;
  estimated_delivery_cost?: number | null;
  facture_id?: number | string | null;
};

type ProductItem = {
  reference: string;
  quantity: number;
  description?: string | null;
};

type WalletTransactionItem = {
  reference: string;
  description?: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
};

type WalletTransaction = {
  payment_id: string;
  created: number;
  currency: string;
  status?: string;
  customer?: {
    name?: string | null;
    email?: string | null;
    id?: string | null;
  };
  items: WalletTransactionItem[];
  shipping_fee: number;
  delivery_gap?: number;
  total: number;
  refunded_total: number;
  net_total: number;
};

type StockRow = {
  id: number;
  created_at: string;
  store_id: number | null;
  product_reference: string | null;
  quantity: number | null;
  weight: number | null;
  image_url?: string | null;
  bought?: number | null;
  price?: number | null;
  product_stripe_id: any;
};

type StockApiItem = {
  stock: StockRow;
  product: any | null;
  prices: any[];
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [store, setStore] = useState<Store | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(null);
  const [noStore, setNoStore] = useState<boolean>(false);
  // Vérification d’existence et d’accès au dashboard gérées par Header
  const { toast, showToast, hideToast, setToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [siret, setSiret] = useState('');
  const [tvaApplicable, setTvaApplicable] = useState(false);
  // Validation du nom (aligné sur Onboarding)
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [wasStoreNameFocused, setWasStoreNameFocused] = useState(false);
  const [isStoreNameDirty, setIsStoreNameDirty] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState('');
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const [ibanInput, setIbanInput] = useState('');
  const [bicInput, setBicInput] = useState('');
  const [ibanError, setIbanError] = useState<string | null>(null);
  const [bicError, setBicError] = useState<string | null>(null);
  const [isSubmittingPayout, setIsSubmittingPayout] = useState(false);
  const [isSubmittingModifications, setIsSubmittingModifications] =
    useState(false);
  // Édition infos boutique
  const [editingInfo, setEditingInfo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  // Toggle de la demande de versement
  const [showPayout, setShowPayout] = useState(false);
  // Navigation des sections du dashboard
  const [section, setSection] = useState<
    | 'infos'
    | 'wallet'
    | 'stock'
    | 'sales'
    | 'clients'
    | 'promo'
    | 'support'
    | 'carts'
  >('infos');
  // Support: message de contact
  const [supportMessage, setSupportMessage] = useState<string>('');
  const [isSendingSupport, setIsSendingSupport] = useState<boolean>(false);
  const [supportFile, setSupportFile] = useState<File | null>(null);
  // Aide sur une vente (popup similaire à OrdersPage)
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState<string>('');
  const [helpFile, setHelpFile] = useState<File | null>(null);
  const [helpSales, setHelpSales] = useState<Shipment[]>([]);
  const [isSendingHelp, setIsSendingHelp] = useState<boolean>(false);
  const [selectedSaleIds, setSelectedSaleIds] = useState<Set<number>>(
    new Set()
  );
  // Pagination pour la section Ventes
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  // Barre de recherche sur l'ID (contains)
  const [idSearch, setIdSearch] = useState<string>('');
  const [salesFilterField, setSalesFilterField] = useState<
    'id' | 'client' | 'reference'
  >('id');
  const [salesFilterTerm, setSalesFilterTerm] = useState<string>('');
  const [reloadingSales, setReloadingSales] = useState<boolean>(false);
  const [walletTransactions, setWalletTransactions] = useState<
    WalletTransaction[]
  >([]);
  const [walletTransactionsLoading, setWalletTransactionsLoading] =
    useState<boolean>(false);
  const [walletTransactionsSlug, setWalletTransactionsSlug] = useState<
    string | null
  >(null);
  const [walletTransactionsTotalNet, setWalletTransactionsTotalNet] =
    useState<number>(0);
  const [walletTransactionsTotalCount, setWalletTransactionsTotalCount] =
    useState<number>(0);
  const [walletTablePageSize, setWalletTablePageSize] = useState<number>(10);
  const [walletTablePage, setWalletTablePage] = useState<number>(1);

  const [stockTitle, setStockTitle] = useState<string>('');
  const [stockReference, setStockReference] = useState<string>('');
  const [stockDescription, setStockDescription] = useState<string>('');
  const [stockQuantity, setStockQuantity] = useState<string>('1');
  const [stockWeight, setStockWeight] = useState<string>('');
  const [stockPrice, setStockPrice] = useState<string>('');
  const [stockImageFile, setStockImageFile] = useState<File | null>(null);
  const [stockImagePreview, setStockImagePreview] = useState<string | null>(
    null
  );
  const [stockImageUrlInput, setStockImageUrlInput] = useState<string>('');
  const [stockImageUrls, setStockImageUrls] = useState<string[]>([]);
  const [stockCreating, setStockCreating] = useState<boolean>(false);
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [stockItems, setStockItems] = useState<StockApiItem[]>([]);
  const [stockLoading, setStockLoading] = useState<boolean>(false);
  const [stockReloading, setStockReloading] = useState<boolean>(false);
  const [stockLoadedSlug, setStockLoadedSlug] = useState<string | null>(null);
  const [stockPageSize, setStockPageSize] = useState<number>(12);
  const [stockPage, setStockPage] = useState<number>(1);
  const [stockFilterField, setStockFilterField] = useState<
    'reference' | 'titre' | 'description'
  >('reference');
  const [stockFilterTerm, setStockFilterTerm] = useState<string>('');
  const [selectedStockIds, setSelectedStockIds] = useState<Set<number>>(
    new Set()
  );
  const [stockCardImageIndex, setStockCardImageIndex] = useState<
    Record<string, number>
  >({});
  // États Clients (onglet dédié)
  const [clientsPageSize, setClientsPageSize] = useState<number>(10);
  const [clientsPage, setClientsPage] = useState<number>(1);
  const [customersMap, setCustomersMap] = useState<Record<string, any>>({});
  const [customersLoading, setCustomersLoading] = useState<boolean>(false);
  const [clientsSortOrder, setClientsSortOrder] = useState<'asc' | 'desc'>(
    'desc'
  );
  const [clientsFilterField, setClientsFilterField] = useState<
    'id' | 'name' | 'email'
  >('id');
  const [clientsFilterTerm, setClientsFilterTerm] = useState<string>('');
  const [socialsMap, setSocialsMap] = useState<Record<string, any>>({});
  const [billingAddress, setBillingAddress] = useState<Address | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawLoading, setDrawLoading] = useState<boolean>(false);
  const [winner, setWinner] = useState<any | null>(null);
  const [showWinnerModal, setShowWinnerModal] = useState<boolean>(false);
  const [sendingCongrats, setSendingCongrats] = useState<boolean>(false);
  const drawButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isAddressComplete, setIsAddressComplete] = useState(false);
  const [formPhone, setFormPhone] = useState<string>('');

  // Paniers (création par le vendeur)
  const [cartCustomerInput, setCartCustomerInput] = useState<string>('');
  const [cartCustomerResults, setCartCustomerResults] = useState<
    Array<{
      id: string;
      fullName: string;
      email?: string | null;
      stripeId?: string | null;
    }>
  >([]);
  const [cartUsersLoading, setCartUsersLoading] = useState<boolean>(false);
  const [cartSelectedUser, setCartSelectedUser] = useState<{
    id: string;
    fullName: string;
    email?: string | null;
    stripeId?: string | null;
  } | null>(null);
  const [cartReference, setCartReference] = useState<string>('');
  const [cartDescription, setCartDescription] = useState<string>('');
  const [cartWeightKg, setCartWeightKg] = useState<string>('');
  const [cartAmountEuro, setCartAmountEuro] = useState<string>('');
  const [cartQuantity, setCartQuantity] = useState<string>('1');
  const [cartStockSuggestions, setCartStockSuggestions] = useState<any[]>([]);
  const [cartStockSuggestionsOpen, setCartStockSuggestionsOpen] =
    useState<boolean>(false);
  const [cartStockSuggestionsLoading, setCartStockSuggestionsLoading] =
    useState<boolean>(false);
  const [cartSelectedStockItem, setCartSelectedStockItem] = useState<
    any | null
  >(null);
  const [cartCreating, setCartCreating] = useState<boolean>(false);
  const [storeCarts, setStoreCarts] = useState<any[]>([]);
  const [cartDeletingIds, setCartDeletingIds] = useState<
    Record<number, boolean>
  >({});
  const [cartReloading, setCartReloading] = useState<boolean>(false);
  const [cartsFilterField, setCartsFilterField] = useState<
    'reference' | 'client' | 'description'
  >('client');
  const [cartSearchTerm, setCartSearchTerm] = useState<string>('');
  const [cartPageSize, setCartPageSize] = useState<number>(10);
  const [cartPage, setCartPage] = useState<number>(1);
  const [clerkUsersByStripeId, setClerkUsersByStripeId] = useState<
    Record<
      string,
      {
        id: string;
        fullName: string;
        email?: string | null;
        imageUrl?: string | null;
        hasImage?: boolean;
      }
    >
  >({});
  const [cartGroupPageSize, setCartGroupPageSize] = useState<
    Record<string, number>
  >({});
  const [cartGroupPage, setCartGroupPage] = useState<Record<string, number>>(
    {}
  );
  const [selectedCartGroupIds, setSelectedCartGroupIds] = useState<Set<string>>(
    new Set()
  );
  const [sendingRecap, setSendingRecap] = useState<boolean>(false);
  const [recapSentByGroup, setRecapSentByGroup] = useState<
    Record<string, boolean>
  >({});
  const [recapSentAtByGroup, setRecapSentAtByGroup] = useState<
    Record<string, string | null>
  >({});
  useEffect(() => {
    setSelectedCartGroupIds(prev => {
      const next = new Set<string>();
      const ids = new Set(
        (storeCarts || []).map(c => String(c.customer_stripe_id || ''))
      );
      prev.forEach(id => {
        if (ids.has(id)) next.add(id);
      });
      return next;
    });
  }, [storeCarts]);
  useEffect(() => {
    const groupsMap: Record<string, any[]> = {};
    (storeCarts || []).forEach((c: any) => {
      const key = String(c.customer_stripe_id || '');
      if (!groupsMap[key]) groupsMap[key] = [];
      groupsMap[key].push(c);
    });
    setRecapSentByGroup(() => {
      const next: Record<string, boolean> = {};
      Object.entries(groupsMap).forEach(([sid, items]) => {
        next[sid] = (items as any[]).some((it: any) => !!it.recap_sent_at);
      });
      return next;
    });
    setRecapSentAtByGroup(() => {
      const next: Record<string, string | null> = {};
      Object.entries(groupsMap).forEach(([sid, items]) => {
        const times = (items as any[])
          .map((it: any) => String(it.recap_sent_at || '').trim())
          .filter(Boolean)
          .map(t => Date.parse(t))
          .filter(n => Number.isFinite(n));
        if (times.length > 0) {
          const max = Math.max(...times);
          next[sid] = new Date(max).toISOString();
        } else {
          next[sid] = null;
        }
      });
      return next;
    });
  }, [storeCarts]);
  const formatRelativeSent = (iso?: string | null) => {
    if (!iso) return '';
    const t = Date.parse(String(iso));
    if (!Number.isFinite(t)) return '';
    const diffMs = Date.now() - t;
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return 'il y a 1min';
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `il y a ${d}j`;
    const w = Math.floor(d / 7);
    return `il y a ${w}sem`;
  };
  const handleSendRecap = async () => {
    try {
      if (selectedCartGroupIds.size === 0) return;
      setSendingRecap(true);
      const token = await getToken();
      const payload = {
        stripeIds: Array.from(selectedCartGroupIds),
        storeSlug: store?.slug,
      };
      const resp = await apiPost('/api/carts/recap', payload, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      await resp.json().catch(() => ({}));
      await handleReloadCarts();
      showToast('Récapitulatif envoyé', 'success');
    } catch (e: any) {
      const raw = e?.message || 'Erreur lors de l’envoi du récapitulatif';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed, 'error');
    } finally {
      setSendingRecap(false);
    }
  };

  const [promoLoadedOnce, setPromoLoadedOnce] = useState<boolean>(false);
  useEffect(() => {
    if (section === 'promo' && !promoLoadedOnce) {
      Promise.all([
        fetchPromotionCodes().catch(() => {}),
        fetchCoupons().catch(() => {}),
      ]).finally(() => setPromoLoadedOnce(true));
    }
  }, [section, promoLoadedOnce]);

  const [promoSelectedCouponId, setPromoSelectedCouponId] =
    useState<string>('');
  const [promoCodeName, setPromoCodeName] = useState<string>('');
  const [promoMinAmountEuro, setPromoMinAmountEuro] = useState<string>('');
  const [promoFirstTime, setPromoFirstTime] = useState<boolean>(true);
  const [promoExpiresDate, setPromoExpiresDate] = useState<string>('');
  const [promoExpiresTime, setPromoExpiresTime] = useState<string>('');
  const [promoActive, setPromoActive] = useState<boolean>(true);
  const [promoMaxRedemptions, setPromoMaxRedemptions] = useState<string>('');
  const [promoCreating, setPromoCreating] = useState<boolean>(false);
  const [promoCodes, setPromoCodes] = useState<any[]>([]);
  const [promoListLoading, setPromoListLoading] = useState<boolean>(false);
  const [promoSearchTerm, setPromoSearchTerm] = useState<string>('');
  const [promoDeletingIds, setPromoDeletingIds] = useState<
    Record<string, boolean>
  >({});

  const [couponOptions, setCouponOptions] = useState<
    { id: string; name?: string | null }[]
  >([]);
  const [promoCouponsLoading, setPromoCouponsLoading] =
    useState<boolean>(false);

  const fetchCoupons = async () => {
    try {
      setPromoCouponsLoading(true);
      const token = await getToken();
      const resp = await apiGet(`/api/stripe/coupons`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const json = await resp.json().catch(() => ({}));
      const list = Array.isArray(json?.data) ? json.data : [];
      setCouponOptions(list);
      if (!promoSelectedCouponId && list.length > 0) {
        setPromoSelectedCouponId(list[0].id);
      }
    } catch (e: any) {
      const raw = e?.message || 'Erreur lors du chargement des coupons';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed, 'error');
    } finally {
      setPromoCouponsLoading(false);
    }
  };

  const fetchPromotionCodes = async () => {
    try {
      setPromoListLoading(true);
      const token = await getToken();
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (store?.slug) params.set('storeSlug', store.slug);
      const resp = await apiGet(
        `/api/stripe/promotion-codes?${params.toString()}`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      setPromoCodes(Array.isArray(json?.data) ? json.data : []);
    } catch (e: any) {
      const raw = e?.message || 'Erreur lors du chargement des codes promo';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed, 'error');
    } finally {
      setPromoListLoading(false);
    }
  };

  const handleDeletePromotionCode = async (id: string) => {
    try {
      if (!id) return;
      setPromoDeletingIds(prev => ({ ...prev, [id]: true }));
      const token = await getToken();
      const resp = await apiDelete(
        `/api/stripe/promotion-codes/${encodeURIComponent(id)}`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || 'Suppression du code promo échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Erreur');
      }
      showToast('Code promo archivé', 'success');
      await fetchPromotionCodes();
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      showToast(raw, 'error');
    } finally {
      setPromoDeletingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleCreatePromotionCode = async () => {
    try {
      const code = (promoCodeName || '').trim();
      if (!promoSelectedCouponId || !code) {
        showToast('Veuillez choisir un coupon et saisir un code', 'error');
        return;
      }
      // Validation date d'expiration
      const todayStr = new Date().toISOString().slice(0, 10);
      // Empêcher heure seule sans date
      if (!(promoExpiresDate || '').trim() && (promoExpiresTime || '').trim()) {
        showToast('Veuillez renseigner la date d’expiration', 'error');
        return;
      }
      if ((promoExpiresDate || '').trim()) {
        const d = (promoExpiresDate || '').trim();
        if (d < todayStr) {
          showToast(
            'La date d’expiration doit être aujourd’hui ou plus tard',
            'error'
          );
          return;
        }
        // Heure obligatoire si une date est saisie
        if (!(promoExpiresTime || '').trim()) {
          showToast('Veuillez renseigner l’heure d’expiration', 'error');
          return;
        }
        // Si la date est aujourd'hui et qu'une heure est fournie, vérifier qu'elle n'est pas passée
        const timeStr = (promoExpiresTime || '').trim();
        if (d === todayStr && timeStr) {
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          const nowHM = `${hh}:${mm}`;
          if (timeStr < nowHM) {
            showToast(
              'L’heure d’expiration pour aujourd’hui doit être ultérieure à maintenant',
              'error'
            );
            return;
          }
        }
      }
      setPromoCreating(true);
      const token = await getToken();
      const minimum_amount = (() => {
        const val = parseFloat((promoMinAmountEuro || '').replace(',', '.'));
        if (Number.isFinite(val) && val > 0) return Math.round(val * 100);
        return undefined;
      })();
      const expires_at = (() => {
        const dateStr = (promoExpiresDate || '').trim();
        if (!dateStr) return undefined;
        const timeStr = (promoExpiresTime || '').trim();
        if (!timeStr) return undefined; // heure obligatoire si date renseignée
        const isoLocal = `${dateStr}T${timeStr}`;
        const ms = Date.parse(isoLocal);
        if (Number.isFinite(ms)) return Math.floor(ms / 1000);
        return undefined;
      })();
      const max_redemptions = (() => {
        const val = parseInt((promoMaxRedemptions || '').trim(), 10);
        if (Number.isFinite(val) && val > 0) return val;
        return undefined;
      })();

      const body: any = {
        couponId: promoSelectedCouponId,
        code,
        active: !!promoActive,
        storeSlug: store?.slug,
      };
      if (
        typeof minimum_amount === 'number' ||
        typeof promoFirstTime === 'boolean'
      ) {
        body.minimum_amount = minimum_amount;
        body.first_time_transaction = !!promoFirstTime;
      }
      if (typeof expires_at === 'number') body.expires_at = expires_at;
      if (typeof max_redemptions === 'number')
        body.max_redemptions = max_redemptions;

      const resp = await apiPost('/api/stripe/promotion-codes', body, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || 'Création du code promo échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Erreur');
      }
      showToast('Code promo créé', 'success');
      // Rafraîchir la liste
      await fetchPromotionCodes();
      // Reset partiel
      setPromoCodeName('');
      setPromoMinAmountEuro('');
      setPromoFirstTime(false);
      setPromoExpiresDate('');
      setPromoActive(true);
      setPromoMaxRedemptions('');
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      showToast(raw, 'error');
    } finally {
      setPromoCreating(false);
    }
  };

  // Pas de reload automatique à l’ouverture de l’onglet 'promo'
  // Le rechargement est désormais manuel via le bouton

  // États d’expansion pour les cartes mobiles
  const [expandedSalesCardIds, setExpandedSalesCardIds] = useState<
    Record<number, boolean>
  >({});
  const [expandedClientCardIds, setExpandedClientCardIds] = useState<
    Record<string, boolean>
  >({});

  // Popup de bienvenue après création de boutique
  const [showWelcome, setShowWelcome] = useState<boolean>(false);
  const location = useLocation();
  const normalizeBaseUrl = (raw?: string) => {
    const val = String(raw || '').trim();
    if (!val) return 'http://localhost:3000';
    if (/^https?:\/\//i.test(val)) return val.replace(/\/+$/, '');
    const isLocal = /^(localhost|127\.0\.0\.1)/i.test(val);
    const defaultScheme = isLocal ? 'http' : 'https';
    return `${defaultScheme}://${val}`.replace(/\/+$/, '');
  };

  const getClientBaseUrl = () => {
    const env = (import.meta as any)?.env || {};
    const vercelEnv = String(env.VERCEL_ENV || env.VITE_VERCEL_ENV || '')
      .toLowerCase()
      .trim();
    if (vercelEnv === 'prod') return 'https://paylive.cc';
    if (vercelEnv === 'preview') return 'https://preview-paylive.vercel.app';
    const fromEnv = String(env.VITE_CLIENT_URL || '').trim();
    if (fromEnv) return normalizeBaseUrl(fromEnv);
    if (typeof window !== 'undefined' && window.location?.origin) {
      return normalizeBaseUrl(window.location.origin);
    }
    return 'http://localhost:3000';
  };

  const shareLink = store?.slug ? `${getClientBaseUrl()}/c/${store.slug}` : '';
  const [aliasCopied, setAliasCopied] = useState(false);

  const handleCopyAlias = async () => {
    try {
      if (!shareLink) return;
      await navigator.clipboard.writeText(shareLink);
      setAliasCopied(true);
      setTimeout(() => setAliasCopied(false), 2000);
    } catch (err) {
      console.error('Erreur lors de la copie du lien alias:', err);
    }
  };

  useEffect(() => {
    const created = (location.state as any)?.isStorecreated === true;

    if (created) {
      setShowWelcome(true);
      // Nettoyer l'état d'historique pour éviter réaffichage en navigations suivantes
      navigate(location.pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerIconMap: Record<string, any> = {
    google: FaGoogle,
    facebook: FaFacebook,
    tiktok: FaTiktok,
    apple: FaApple,
  };
  const getProviderIcon = (provider?: string) => {
    if (!provider) return null;
    const key = provider.toLowerCase();
    const found = Object.keys(providerIconMap).find(k => key.includes(k));
    return found ? providerIconMap[found] : null;
  };
  // Validation du site web (mêmes règles que onboarding)
  const isValidWebsite = (url: string) => {
    const value = (url || '').trim();
    if (!value) return true;
    const domainOnlyRegex = /^(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;
    if (domainOnlyRegex.test(value)) return true;
    try {
      const parsed = new URL(value);
      const host = parsed.hostname || '';
      const hasTld = /\.[a-zA-Z]{2,}$/.test(host);
      return hasTld;
    } catch {
      return false;
    }
  };
  const websiteInvalid = !!(website && !isValidWebsite(website));
  // États et logique de vérification SIRET (alignés sur Onboarding)
  const [isCheckingSiret, setIsCheckingSiret] = useState(false);
  const [siretErrorMessage, setSiretErrorMessage] = useState('');
  const [wasSiretFocused, setWasSiretFocused] = useState(false);
  const [isSiretDirty, setIsSiretDirty] = useState(false);
  const [lastCheckedSiret, setLastCheckedSiret] = useState('');
  const [siretDetails, setSiretDetails] = useState<any | null>(null);
  const [companyCountry, setCompanyCountry] = useState<'FR' | 'BE'>('FR');
  const isValidSiret = (value: string) => {
    const digits = (value || '').replace(/\s+/g, '');
    return /^\d{14}$/.test(digits);
  };
  const isValidBce = (value: string) => {
    const digits = (value || '')
      .replace(/\s+/g, '')
      .replace(/^BE/i, '')
      .replace(/\./g, '');
    return /^\d{10}$/.test(digits);
  };
  const normalizeCompanyId = (value: string) => {
    const v = (value || '').trim();
    if (companyCountry === 'FR') return v.replace(/\s+/g, '');
    return v.replace(/\s+/g, '').replace(/^BE/i, '').replace(/\./g, '');
  };
  const siretInvalid = siret
    ? companyCountry === 'FR'
      ? !isValidSiret(siret)
      : !isValidBce(siret)
    : false;

  const handleSiretFocus = () => {
    setWasSiretFocused(true);
  };
  const handleSiretChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = (e.target.value || '').replace(/\s+/g, '');
    setSiret(value);
    setIsSiretDirty(true);
    setSiretDetails(null);
    if (!value) {
      setSiretErrorMessage('');
      setLastCheckedSiret('');
      setSiretDetails(null);
    } else if (siretErrorMessage) {
      setSiretErrorMessage('');
    }
  };
  const checkSiretValidity = async () => {
    const normalized = normalizeCompanyId(siret || '');
    if (!normalized) return;
    if (companyCountry === 'FR' && !/^\d{14}$/.test(normalized)) return;
    if (companyCountry === 'BE' && !/^\d{10}$/.test(normalized)) return;
    setIsCheckingSiret(true);
    try {
      const endpoint = companyCountry === 'FR' ? 'siret' : 'bce';
      const resp = await apiGet(
        `/api/insee-bce/${endpoint}/${encodeURIComponent(normalized)}`
      );
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json?.success) {
        setSiretErrorMessage('');
        setLastCheckedSiret(normalized);
        setSiretDetails(json?.data || null);
      } else {
        const message =
          json?.header?.message ||
          json?.error ||
          (companyCountry === 'FR'
            ? 'SIRET invalide ou introuvable'
            : 'BCE invalide ou introuvable');
        setSiretErrorMessage(message);
        setLastCheckedSiret(normalized);
        setSiretDetails(null);
      }
    } catch (err) {
      console.error('Vérification SIRET/BCE échouée:', err);
      setSiretErrorMessage(
        companyCountry === 'FR'
          ? 'Erreur lors de la vérification du SIRET'
          : 'Erreur lors de la vérification du BCE'
      );
      setSiretDetails(null);
    } finally {
      setIsCheckingSiret(false);
    }
  };
  const handleSiretBlur = async () => {
    const raw = (siret || '').trim();
    if (!wasSiretFocused) {
      setWasSiretFocused(false);
      return;
    }
    if (!isSiretDirty) {
      setWasSiretFocused(false);
      return;
    }
    if (!raw) {
      setSiretErrorMessage('');
      setSiretDetails(null);
      setWasSiretFocused(false);
      setIsSiretDirty(false);
      return;
    }
    if (companyCountry === 'FR') {
      const s = raw.replace(/\s+/g, '');
      if (!/^\d{14}$/.test(s)) {
        setSiretErrorMessage(
          'Erreur de format de siret (Format attendu : 14 chiffres)'
        );
        setSiretDetails(null);
        setWasSiretFocused(false);
        setIsSiretDirty(false);
        return;
      }
    } else {
      const bce = raw
        .replace(/\s+/g, '')
        .replace(/^BE/i, '')
        .replace(/\./g, '');
      if (!/^\d{10}$/.test(bce)) {
        setSiretErrorMessage(
          'Erreur de format de BCE (Format attendu : 10 chiffres)'
        );
        setSiretDetails(null);
        setWasSiretFocused(false);
        setIsSiretDirty(false);
        return;
      }
    }
    await checkSiretValidity();
    setWasSiretFocused(false);
    setIsSiretDirty(false);
  };
  // Upload logo (mêmes vérifications que onboarding)
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedMimes = ['image/png', 'image/jpeg'];
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowedExts = ['png', 'jpg', 'jpeg'];
    const isMimeOk = allowedMimes.includes(file.type);
    const isExtOk = !!ext && allowedExts.includes(ext);
    if (!isMimeOk && !isExtOk) {
      showToast('Format de logo invalide. Utilisez PNG ou JPG/JPEG.', 'error');
      return;
    }
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };
  const apiBase = API_BASE_URL;

  // Helpers d'affichage inspirés de OrdersPage
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

  const handleSendSupport = async () => {
    const msg = (supportMessage || '').trim();
    if (!msg) {
      showToast('Veuillez saisir un message', 'error');
      return;
    }
    try {
      setIsSendingSupport(true);
      const token = await getToken();
      const fd = new FormData();
      if (store?.slug) fd.append('storeSlug', store.slug);
      fd.append('message', msg);
      if (supportFile) fd.append('attachment', supportFile);
      await apiPostForm('/api/support/contact', fd, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      showToast('Message envoyé à PayLive.', 'success');
      setSupportMessage('');
      setSupportFile(null);
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed || "Erreur lors de l'envoi", 'error');
    } finally {
      setIsSendingSupport(false);
    }
  };

  const handleOpenHelp = (sales?: Shipment | Shipment[]) => {
    const list = Array.isArray(sales) ? sales : sales ? [sales] : selectedSales;
    if (list.length === 0) {
      showToast('Sélectionnez au moins une vente', 'error');
      return;
    }
    setHelpSales(list);
    setHelpMessage('');
    setHelpFile(null);
    setHelpOpen(true);
  };

  const handleCloseHelp = () => {
    setHelpOpen(false);
    setHelpSales([]);
  };

  // Envoi du message d'aide au support PayLive avec le contexte de la ligne
  const handleSendHelp = async () => {
    const msg = (helpMessage || '').trim();
    if (!msg) return;
    if (helpSales.length === 0) {
      showToast('Sélectionnez au moins une vente', 'error');
      return;
    }
    try {
      setIsSendingHelp(true);
      const token = await getToken();
      const fd = new FormData();
      if (store?.slug) fd.append('storeSlug', store.slug);
      if (helpSales.length === 1 && helpSales[0]?.shipment_id) {
        fd.append('shipmentId', helpSales[0].shipment_id);
      }
      fd.append(
        'shipmentIds',
        JSON.stringify(helpSales.map(s => s.shipment_id).filter(Boolean))
      );
      fd.append('message', msg);
      fd.append(
        'context',
        JSON.stringify({
          source: 'dashboard_sales_help',
          sales: helpSales.map(s => ({
            id: s.id ?? null,
            shipmentId: s.shipment_id ?? null,
            productReference: s.product_reference ?? null,
            value: s.paid_value ?? null,
            customerStripeId: s.customer_stripe_id ?? null,
            status: s.status ?? null,
            createdAt: s.created_at ?? null,
            deliveryMethod: s.delivery_method ?? null,
            deliveryNetwork: s.delivery_network ?? null,
          })),
        })
      );
      if (helpFile) fd.append('attachment', helpFile);
      await apiPostForm('/api/support/contact', fd, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      showToast('Message envoyé à PayLive.', 'success');
      setHelpOpen(false);
      setHelpMessage('');
      setHelpFile(null);
      setHelpSales([]);
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed || "Erreur lors de l'envoi", 'error');
    } finally {
      setIsSendingHelp(false);
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
      return d as string;
    }
  };

  const formatDateEpoch = (sec?: number | null) => {
    if (!sec) return '—';
    try {
      return new Date(Number(sec) * 1000).toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(sec);
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

  // États de suivi pour les actions
  const [cancelStatus, setCancelStatus] = useState<
    Record<number, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [docStatus, setDocStatus] = useState<
    Record<number, 'idle' | 'loading' | 'success' | 'error'>
  >({});
  const [invoiceStatus, setInvoiceStatus] = useState<
    Record<number, 'idle' | 'loading' | 'success' | 'error'>
  >({});

  const handleCancel = async (s: Shipment, options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!s.shipment_id) {
      setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
      return false;
    }
    try {
      setCancelStatus(prev => ({ ...prev, [s.id]: 'loading' }));
      const token = await getToken();
      const url = `${apiBase}/api/boxtal/shipping-orders/${encodeURIComponent(
        s.shipment_id
      )}`;
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setCancelStatus(prev => ({ ...prev, [s.id]: 'success' }));
        setShipments(prev =>
          (prev || []).map(it =>
            it.id === s.id ? { ...it, cancel_requested: true } : it
          )
        );
        if (!silent) {
          showToast("Demande d'annulation envoyée", 'success');
        }
        return true;
      } else {
        setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
        const msg =
          json?.error || json?.message || "Erreur lors de l'annulation";
        if (!silent) {
          showToast(
            typeof msg === 'string' ? msg : "Demande d'annulation échouée",
            'error'
          );
        }
        return false;
      }
    } catch (e: any) {
      setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || "Erreur lors de l'annulation";
      if (!silent) {
        showToast(
          typeof rawMsg === 'string' ? rawMsg : "Demande d'annulation échouée",
          'error'
        );
      }
      return false;
    }
  };

  const handleInvoice = async (s: Shipment, options?: { silent?: boolean }) => {
    const silent = options?.silent;
    try {
      setInvoiceStatus(prev => ({ ...prev, [s.id]: 'loading' }));
      if (!silent) {
        setToast({
          message: 'Génération de la facture…',
          type: 'info',
          visible: true,
        });
      }
      const token = await getToken();
      const url = `${apiBase}/api/shipments/${encodeURIComponent(String(s.id))}/invoice`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || 'Erreur facture');
      }
      const blob = await resp.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      const dispo = resp.headers.get('Content-Disposition') || '';
      const m = dispo.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
      const filename = (m?.[1] || '').trim();
      const sanitizeFilenamePart = (raw: string) =>
        String(raw || '')
          .trim()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/[^\dA-Za-z _-]+/g, '')
          .replace(/\s+/g, '_')
          .slice(0, 60) || 'client';
      const stripeId = s.customer_stripe_id || '';
      const customer = stripeId ? customersMap[stripeId] || null : null;
      const customerName = String(customer?.name || '').trim();
      const customerEmail = String(customer?.email || '').trim();
      const customerForFile = sanitizeFilenamePart(
        customerName || customerEmail || stripeId || 'client'
      );
      const factureIdForFile = String(s.facture_id ?? s.id).replace(
        /[^\dA-Za-z_-]+/g,
        '_'
      );
      a.download =
        filename || `facture_${factureIdForFile}_${customerForFile}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objectUrl);
      setInvoiceStatus(prev => ({ ...prev, [s.id]: 'success' }));
      if (!silent) {
        showToast('Facture téléchargée', 'success');
      }
      return true;
    } catch (e: any) {
      setInvoiceStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || 'Erreur facture';
      if (!silent) {
        showToast(
          typeof rawMsg === 'string'
            ? rawMsg.replace(/^Error:\s*/, '')
            : 'Erreur facture',
          'error'
        );
      }
      return false;
    }
  };

  const handleShippingDocument = async (
    s: Shipment,
    options?: { silent?: boolean }
  ) => {
    const silent = options?.silent;
    try {
      if (!s.shipment_id) return false;
      setDocStatus(prev => ({ ...prev, [s.id]: 'loading' }));
      const token = await getToken();
      const url = `${apiBase}/api/boxtal/shipping-orders/${encodeURIComponent(
        s.shipment_id
      )}/shipping-document/download`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `LABEL_${s.shipment_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(objectUrl);
        setDocStatus(prev => ({ ...prev, [s.id]: 'success' }));
        if (!silent) {
          showToast('Bordereau créé', 'success');
        }
        return true;
      } else {
        const data = await resp.json().catch(() => ({}));
        const msg = data?.error || data?.message || 'Erreur bordereau';
        if (!silent) {
          showToast(
            typeof msg === 'string' ? msg : 'Erreur bordereau',
            'error'
          );
        }
        // Fallback: ouvrir l'URL existante si disponible (peut s'afficher inline selon headers)
        if (s.document_url) {
          const a = document.createElement('a');
          a.href = s.document_url;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        setDocStatus(prev => ({ ...prev, [s.id]: 'error' }));
        return false;
      }
    } catch (e: any) {
      setDocStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || 'Erreur bordereau';
      if (!silent) {
        showToast(
          typeof rawMsg === 'string' ? rawMsg : 'Erreur bordereau',
          'error'
        );
      }
      return false;
    }
  };

  const handleBatchShippingDocuments = async () => {
    const targets = selectedSales.filter(
      s => s.document_created && s.shipment_id
    );
    if (targets.length === 0) {
      showToast('Aucune vente sélectionnée pour le bordereau', 'error');
      return;
    }
    const references: string[] = [];
    for (const s of targets) {
      const ok = await handleShippingDocument(s, { silent: true });
      if (ok) {
        const ref = String(s.product_reference || s.shipment_id || '').trim();
        references.push(ref || String(s.shipment_id));
      }
    }
    if (references.length === 0) {
      showToast('Aucune vente traitée pour le bordereau', 'error');
      return;
    }
    const msg =
      references.length <= 3
        ? `Bordereaux créés pour : ${references.join(', ')}`
        : `Bordereaux créés pour ${references.length} références (${references
            .slice(0, 3)
            .join(', ')}...)`;
    showToast(msg, 'success');
  };

  const handleBatchCancel = async () => {
    const targets = selectedSales.filter(
      s => s.shipment_id && !s.is_final_destination && !s.cancel_requested
    );
    if (targets.length === 0) {
      showToast("Aucune vente sélectionnée pour l'annulation", 'error');
      return;
    }
    const references: string[] = [];
    for (const s of targets) {
      const ok = await handleCancel(s, { silent: true });
      if (ok) {
        const ref = String(s.product_reference || s.shipment_id || '').trim();
        references.push(ref || String(s.shipment_id));
      }
    }
    if (references.length === 0) {
      showToast("Aucune vente traitée pour l'annulation", 'error');
      return;
    }
    const msg =
      references.length <= 3
        ? `Annulations envoyées pour : ${references.join(', ')}`
        : `Annulations envoyées pour ${references.length} références (${references
            .slice(0, 3)
            .join(', ')}...)`;
    showToast(msg, 'success');
  };

  const handleBatchInvoice = async () => {
    const targets = selectedSales;
    if (targets.length === 0) {
      showToast('Aucune vente sélectionnée pour la facture', 'error');
      return;
    }
    setToast({
      message: 'Génération des factures…',
      type: 'info',
      visible: true,
    });
    const references: string[] = [];
    for (const s of targets) {
      const ok = await handleInvoice(s, { silent: true });
      if (ok) {
        const formatted = formatProductReferenceForToast(s.product_reference);
        const fallback = String(s.shipment_id || s.id).trim();
        references.push(formatted || fallback);
      }
    }
    if (references.length === 0) {
      showToast('Aucune facture téléchargée', 'error');
      return;
    }
    const msg =
      references.length <= 3
        ? `Factures téléchargées pour : ${references.join(', ')}`
        : `Factures téléchargées pour ${references.length} références (${references
            .slice(0, 3)
            .join(', ')}...)`;
    showToast(msg, 'success');
  };

  const handleReloadSales = async () => {
    try {
      const slug = store?.slug;
      if (!slug) return;
      setReloadingSales(true);
      setError(null);
      const token = await getToken();
      const shipResp = await fetch(
        `${apiBase}/api/shipments/store/${encodeURIComponent(slug)}`,
        {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        }
      );
      const shipJson = await shipResp.json().catch(() => ({}));
      if (!shipResp.ok) {
        const msg =
          shipJson?.error || 'Erreur lors du rechargement des ventes/clients';
        throw new Error(typeof msg === 'string' ? msg : 'Rechargement échoué');
      }
      setShipments(
        Array.isArray(shipJson?.shipments) ? shipJson.shipments : []
      );
      showToast('Ventes et Clients rechargés', 'success');
      // Réinitialiser la pagination si la page dépasse le total
      setPage(1);
    } catch (e: any) {
      const rawMsg = e?.message || 'Erreur inconnue';
      showToast(rawMsg, 'error');
    } finally {
      setReloadingSales(false);
    }
  };

  const fetchWalletTransactions = async (options?: { silent?: boolean }) => {
    const slug = store?.slug;
    if (!slug) return;

    const silent = options?.silent;
    try {
      setWalletTransactionsLoading(true);
      const token = await getToken();
      const qs = new URLSearchParams();
      qs.set('limit', 'all');
      const payoutRaw = String(store?.payout_created_at || '').trim();
      if (payoutRaw) {
        const ms = new Date(payoutRaw).getTime();
        if (Number.isFinite(ms)) {
          qs.set('startTimestamp', String(Math.floor(ms / 1000)));
        }
      }
      const resp = await fetch(
        `${apiBase}/api/stores/${encodeURIComponent(slug)}/transactions?${qs.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || json?.message || 'Erreur transactions';
        throw new Error(typeof msg === 'string' ? msg : 'Erreur transactions');
      }
      setWalletTransactions(
        Array.isArray(json?.transactions) ? json.transactions : []
      );
      setWalletTransactionsTotalNet(Number(json?.total_net || 0));
      setWalletTransactionsTotalCount(Number(json?.total_count || 0));
      setWalletTransactionsSlug(slug);
      setWalletTablePage(1);
    } catch (e: any) {
      const rawMsg = e?.message || 'Erreur transactions';
      if (!silent) {
        showToast(
          typeof rawMsg === 'string'
            ? rawMsg.replace(/^Error:\s*/, '')
            : 'Erreur transactions',
          'error'
        );
      }
      setWalletTransactions([]);
      setWalletTransactionsTotalNet(0);
      setWalletTransactionsTotalCount(0);
      setWalletTransactionsSlug(slug);
    } finally {
      setWalletTransactionsLoading(false);
    }
  };

  const fetchStockProducts = async (options?: {
    silent?: boolean;
    background?: boolean;
  }) => {
    const slug = store?.slug;
    if (!slug) return;

    const silent = options?.silent;
    const background = Boolean(options?.background);
    try {
      if (background) setStockReloading(true);
      else setStockLoading(true);
      const token = await getToken();
      const resp = await apiGet(
        `/api/stores/${encodeURIComponent(slug)}/stock/products`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg =
          json?.error || json?.message || 'Erreur chargement des stocks';
        throw new Error(
          typeof msg === 'string' ? msg : 'Erreur chargement des stocks'
        );
      }
      setStockItems(Array.isArray(json?.items) ? json.items : []);
      setStockLoadedSlug(slug);
    } catch (e: any) {
      const rawMsg = e?.message || 'Erreur chargement des stocks';
      if (!silent) {
        showToast(
          typeof rawMsg === 'string'
            ? rawMsg.replace(/^Error:\s*/, '')
            : 'Erreur chargement des stocks',
          'error'
        );
      }
      setStockItems([]);
      setStockLoadedSlug(slug);
    } finally {
      if (background) setStockReloading(false);
      else setStockLoading(false);
    }
  };

  const resetStockForm = () => {
    setStockTitle('');
    setStockReference('');
    setStockDescription('');
    setStockQuantity('1');
    setStockWeight('');
    setStockPrice('');
    setStockImageFile(null);
    setStockImagePreview(null);
    setStockImageUrlInput('');
    setStockImageUrls([]);
  };

  const handleCreateStockProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = store?.slug;
    if (!slug) return;

    if (!stockImageFile) {
      showToast('Veuillez uploader une image', 'error');
      return;
    }

    const titleTrim = stockTitle.trim();
    const referenceTrim = stockReference.trim();
    const descTrim = stockDescription.trim();
    const priceTxt = String(stockPrice || '').trim();

    if (!titleTrim || !referenceTrim || !descTrim) {
      showToast(
        'Veuillez renseigner le titre, la référence et la description',
        'error'
      );
      return;
    }

    const qtyRaw = parseInt(String(stockQuantity || '').trim(), 10);
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : NaN;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Quantité invalide (>= 1)', 'error');
      return;
    }

    const weightTxt = String(stockWeight || '').trim();
    if (!weightTxt) {
      showToast('Veuillez renseigner le poids', 'error');
      return;
    }
    const weight = parseFloat(weightTxt.replace(',', '.'));
    if (!(Number.isFinite(weight) && weight >= 0)) {
      showToast('Poids invalide (>= 0)', 'error');
      return;
    }

    if (!priceTxt) {
      showToast('Veuillez renseigner le prix', 'error');
      return;
    }
    const priceEur = parseFloat(priceTxt.replace(',', '.'));
    if (!(Number.isFinite(priceEur) && priceEur > 0)) {
      showToast('Prix invalide (> 0)', 'error');
      return;
    }

    try {
      setStockCreating(true);
      const token = await getToken();

      const normalizedUrls = Array.from(
        new Set(
          (stockImageUrls || [])
            .map(u => String(u || '').trim())
            .filter(Boolean)
        )
      );

      let uploadedUrl: string | null = null;
      if (stockImageFile) {
        const fd = new FormData();
        fd.append('slug', slug);
        fd.append('image', stockImageFile);
        const upResp = await apiPostForm('/api/upload/stock-product', fd, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        const upJson = await upResp.json().catch(() => ({}));
        if (!upResp.ok) {
          const msg = upJson?.error || upJson?.message || 'Upload échoué';
          throw new Error(typeof msg === 'string' ? msg : 'Upload échoué');
        }
        uploadedUrl = String(upJson?.url || '').trim() || null;
      }

      const allImageUrls = Array.from(
        new Set([uploadedUrl, ...normalizedUrls].filter(Boolean) as string[])
      );
      const imageUrlJoined =
        allImageUrls.length > 0 ? allImageUrls.join(',') : null;

      const resp = await apiPost(
        `/api/stores/${encodeURIComponent(slug)}/stock/products`,
        {
          title: titleTrim,
          reference: referenceTrim,
          description: descTrim,
          quantity,
          weight,
          price: priceEur,
          image_url: imageUrlJoined,
        },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || json?.message || 'Création échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Création échouée');
      }

      showToast('Produit créé', 'success');
      setEditingStockId(null);
      resetStockForm();
      await fetchStockProducts({ silent: true, background: true });
    } catch (e: any) {
      const rawMsg = e?.message || 'Création échouée';
      showToast(
        typeof rawMsg === 'string'
          ? rawMsg.replace(/^Error:\s*/, '')
          : 'Erreur',
        'error'
      );
    } finally {
      setStockCreating(false);
    }
  };

  const handleUpdateStockProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = store?.slug;
    if (!slug) return;

    const stockId = Number(editingStockId);
    if (!Number.isFinite(stockId) || stockId <= 0) return;

    if (!stockImageFile && !stockImagePreview) {
      showToast('Veuillez uploader une image', 'error');
      return;
    }

    const titleTrim = stockTitle.trim();
    const referenceTrim = stockReference.trim();
    const descTrim = stockDescription.trim();
    const priceTxt = String(stockPrice || '').trim();

    if (!titleTrim || !referenceTrim || !descTrim) {
      showToast(
        'Veuillez renseigner le titre, la référence et la description',
        'error'
      );
      return;
    }

    const qtyRaw = parseInt(String(stockQuantity || '').trim(), 10);
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : NaN;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Quantité invalide (>= 1)', 'error');
      return;
    }

    const weightTxt = String(stockWeight || '').trim();
    if (!weightTxt) {
      showToast('Veuillez renseigner le poids', 'error');
      return;
    }
    const weight = parseFloat(weightTxt.replace(',', '.'));
    if (!(Number.isFinite(weight) && weight >= 0)) {
      showToast('Poids invalide (>= 0)', 'error');
      return;
    }

    if (!priceTxt) {
      showToast('Veuillez renseigner le prix', 'error');
      return;
    }
    const priceEur = parseFloat(priceTxt.replace(',', '.'));
    if (!(Number.isFinite(priceEur) && priceEur > 0)) {
      showToast('Prix invalide (> 0)', 'error');
      return;
    }

    try {
      setStockCreating(true);
      const token = await getToken();

      const normalizedUrls = Array.from(
        new Set(
          (stockImageUrls || [])
            .map(u => String(u || '').trim())
            .filter(Boolean)
        )
      );

      const existingPreviewUrl =
        !stockImageFile && /^https?:\/\//.test(String(stockImagePreview || ''))
          ? String(stockImagePreview || '').trim()
          : null;

      let uploadedUrl: string | null = null;
      if (stockImageFile) {
        const fd = new FormData();
        fd.append('slug', slug);
        fd.append('image', stockImageFile);
        const upResp = await apiPostForm('/api/upload/stock-product', fd, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        const upJson = await upResp.json().catch(() => ({}));
        if (!upResp.ok) {
          const msg = upJson?.error || upJson?.message || 'Upload échoué';
          throw new Error(typeof msg === 'string' ? msg : 'Upload échoué');
        }
        uploadedUrl = String(upJson?.url || '').trim() || null;
      }

      const allImageUrls = Array.from(
        new Set(
          [uploadedUrl, existingPreviewUrl, ...normalizedUrls].filter(
            Boolean
          ) as string[]
        )
      );
      const imageUrlJoined =
        allImageUrls.length > 0 ? allImageUrls.join(',') : null;

      const resp = await apiPut(
        `/api/stores/${encodeURIComponent(slug)}/stock/products/${stockId}`,
        {
          title: titleTrim,
          reference: referenceTrim,
          description: descTrim,
          quantity,
          weight,
          price: priceEur,
          image_url: imageUrlJoined,
        },
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || json?.message || 'Modification échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Modification échouée');
      }

      showToast('Produit modifié', 'success');
      setEditingStockId(null);
      resetStockForm();
      await fetchStockProducts({ silent: true, background: true });
    } catch (e: any) {
      const rawMsg = e?.message || 'Modification échouée';
      showToast(
        typeof rawMsg === 'string'
          ? rawMsg.replace(/^Error:\s*/, '')
          : 'Erreur',
        'error'
      );
    } finally {
      setStockCreating(false);
    }
  };

  const handleSubmitStockProduct = async (e: React.FormEvent) => {
    if (editingStockId) return handleUpdateStockProduct(e);
    return handleCreateStockProduct(e);
  };

  const startEditStockProduct = (it: StockApiItem, idx: number) => {
    const d = getStockDisplay(it, idx);
    const stock = it?.stock as any;
    const stockId = Number(d.stockId);
    if (!Number.isFinite(stockId) || stockId <= 0) return;

    setEditingStockId(stockId);
    setStockTitle(d.title === '—' ? '' : d.title);
    setStockReference(d.ref === '—' ? '' : d.ref);
    setStockDescription(d.description || '');

    const qty = Number(stock?.quantity);
    setStockQuantity(
      Number.isFinite(qty) && qty > 0 ? String(Math.floor(qty)) : '1'
    );

    const w = stock?.weight;
    setStockWeight(w == null ? '' : String(w));

    setStockPrice(d.priceEur == null ? '' : String(d.priceEur));

    setStockImageFile(null);
    setStockImageUrlInput('');
    const urls = Array.from(new Set(d.imageUrls));
    setStockImagePreview(urls[0] || null);
    setStockImageUrls(urls.slice(1));
  };

  const handleStockImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setStockImageFile(null);
      setStockImagePreview(null);
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showToast('Image invalide. Formats: JPEG, PNG ou WEBP.', 'error');
      e.target.value = '';
      return;
    }
    const max = 2 * 1024 * 1024;
    if (file.size > max) {
      showToast('Image trop lourde (max 2 Mo).', 'error');
      e.target.value = '';
      return;
    }
    setStockImageFile(file);
    const url = URL.createObjectURL(file);
    setStockImagePreview(url);
  };

  useEffect(() => {
    return () => {
      if (stockImagePreview) {
        try {
          URL.revokeObjectURL(stockImagePreview);
        } catch {}
      }
    };
  }, [stockImagePreview]);

  const addStockImageUrl = () => {
    const raw = String(stockImageUrlInput || '').trim();
    if (!raw) return;
    let normalized = '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) {
        showToast('URL invalide (http/https uniquement)', 'error');
        return;
      }
      normalized = url.toString();
    } catch {
      showToast('URL invalide', 'error');
      return;
    }

    setStockImageUrls(prev => {
      const next = new Set(
        (prev || []).map(u => String(u || '').trim()).filter(Boolean)
      );
      next.add(normalized);
      return Array.from(next);
    });
    setStockImageUrlInput('');
  };

  const removeStockImageUrl = (url: string) => {
    const target = String(url || '').trim();
    setStockImageUrls(prev =>
      (prev || []).filter(u => String(u || '').trim() !== target)
    );
  };

  useEffect(() => {
    const slug = store?.slug;
    if (section !== 'wallet') return;
    if (!slug) return;
    if (walletTransactionsLoading) return;
    if (walletTransactionsSlug === slug) return;
    fetchWalletTransactions({ silent: true }).catch(() => {});
  }, [section, store?.slug, walletTransactionsLoading, walletTransactionsSlug]);

  useEffect(() => {
    const slug = store?.slug;
    if (section !== 'stock') return;
    if (!slug) return;
    if (stockLoading) return;
    if (stockLoadedSlug === slug) return;
    fetchStockProducts({ silent: true }).catch(() => {});
  }, [section, store?.slug, stockLoading, stockLoadedSlug]);

  const walletTableTotalPages = Math.max(
    1,
    Math.ceil(walletTransactions.length / walletTablePageSize)
  );
  const walletTableStartIndex = (walletTablePage - 1) * walletTablePageSize;
  const visibleWalletTransactions = walletTransactions.slice(
    walletTableStartIndex,
    walletTableStartIndex + walletTablePageSize
  );

  useEffect(() => {
    const newTotal = Math.max(
      1,
      Math.ceil(walletTransactions.length / walletTablePageSize)
    );
    if (walletTablePage > newTotal) setWalletTablePage(newTotal);
    if (walletTablePage < 1) setWalletTablePage(1);
  }, [walletTransactions, walletTablePageSize]);

  const getStockDisplay = (it: StockApiItem, idx: number) => {
    const stock = it?.stock;
    const product = it?.product;
    const prices = Array.isArray(it?.prices) ? it.prices : [];
    const firstPrice = prices[0] || null;
    const unitAmount = Number(firstPrice?.unit_amount || 0);
    const priceEur = unitAmount > 0 ? unitAmount / 100 : null;

    const ref =
      String(stock?.product_reference || '').trim() ||
      String(product?.metadata?.product_reference || '').trim() ||
      '—';
    const title =
      String(product?.name || '').trim() ||
      String(product?.metadata?.title || '').trim() ||
      '—';
    const description = String(product?.description || '').trim();

    const qty = Number(stock?.quantity || 0);
    const qtyLabel = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const w = stock?.weight;
    const weightLabel =
      w == null
        ? ''
        : `${Number(w)
            .toFixed(3)
            .replace(/\.?0+$/, '')} kg`;

    const boughtCount = Math.max(
      0,
      Math.floor(Number((stock as any)?.bought || 0))
    );
    const stockId = Number(stock?.id);
    const idKey = `${Number.isFinite(stockId) ? stockId : idx}`;

    const rawStockImages = String((stock as any)?.image_url || '').trim();
    const stockImageUrls = rawStockImages
      ? rawStockImages
          .split(',')
          .map(s => String(s || '').trim())
          .filter(Boolean)
      : [];
    const productImages = Array.isArray(product?.images)
      ? (product.images as any[])
          .map(u => String(u || '').trim())
          .filter(Boolean)
      : [];
    const imageUrls =
      stockImageUrls.length > 0
        ? Array.from(new Set(stockImageUrls))
        : Array.from(new Set(productImages));

    return {
      stockId,
      idKey,
      title,
      ref,
      description,
      qtyLabel,
      weightLabel,
      priceEur,
      boughtCount,
      imageUrls,
      hasStockImages: stockImageUrls.length > 0,
      createdAt: stock?.created_at,
    };
  };

  const stockFilterTermTrim = stockFilterTerm.trim().toLowerCase();
  const filteredStockItems = (stockItems || []).filter((it, idx) => {
    if (!stockFilterTermTrim) return true;
    const d = getStockDisplay(it, idx);
    const hay =
      stockFilterField === 'reference'
        ? d.ref
        : stockFilterField === 'titre'
          ? d.title
          : d.description;
    return String(hay || '')
      .toLowerCase()
      .includes(stockFilterTermTrim);
  });

  const stockTotalPages = Math.max(
    1,
    Math.ceil(filteredStockItems.length / stockPageSize)
  );
  const stockStartIndex = (stockPage - 1) * stockPageSize;
  const visibleStockItems = filteredStockItems.slice(
    stockStartIndex,
    stockStartIndex + stockPageSize
  );

  useEffect(() => {
    setSelectedStockIds(prev => {
      const next = new Set<number>();
      const ids = new Set((stockItems || []).map(it => Number(it?.stock?.id)));
      prev.forEach(id => {
        if (ids.has(id)) next.add(id);
      });
      return next;
    });
  }, [stockItems]);

  useEffect(() => {
    if (stockPage > stockTotalPages) setStockPage(stockTotalPages);
    if (stockPage < 1) setStockPage(1);
  }, [stockTotalPages]);

  const visibleStockIds = visibleStockItems
    .map(it => Number(it?.stock?.id))
    .filter(n => Number.isFinite(n));
  const allVisibleStockSelected =
    visibleStockIds.length > 0 &&
    visibleStockIds.every(id => selectedStockIds.has(id));

  const toggleSelectAllVisibleStock = () => {
    setSelectedStockIds(prev => {
      const next = new Set(prev);
      if (allVisibleStockSelected) {
        visibleStockIds.forEach(id => next.delete(id));
      } else {
        visibleStockIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const toggleStockSelected = (id: number) => {
    const n = Number(id);
    if (!Number.isFinite(n)) return;
    setSelectedStockIds(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const handleBulkDeleteSelectedStock = async () => {
    const slug = store?.slug;
    if (!slug) return;
    if (selectedStockIds.size === 0) return;

    const ids = Array.from(selectedStockIds).filter(id => Number.isFinite(id));

    setStockItems(prev =>
      (prev || []).filter(it => {
        const id = Number(it?.stock?.id);
        return !Number.isFinite(id) || !selectedStockIds.has(id);
      })
    );
    setSelectedStockIds(new Set());

    try {
      const token = await getToken();
      const resp = await fetch(
        `${API_BASE_URL}/api/stores/${encodeURIComponent(slug)}/stock/products`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
          },
          body: JSON.stringify({ ids }),
        }
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || json?.message || 'Suppression échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Suppression échouée');
      }

      const results = Array.isArray(json?.results) ? json.results : [];
      const failed = results.filter((r: any) => r && r.ok === false);
      if (failed.length > 0) {
        showToast(
          `${failed.length} suppression${failed.length > 1 ? 's' : ''} échouée${
            failed.length > 1 ? 's' : ''
          }`,
          'error'
        );
      } else {
        showToast('Suppression effectuée', 'success');
      }
    } catch (e: any) {
      const rawMsg = e?.message || 'Suppression échouée';
      showToast(
        typeof rawMsg === 'string'
          ? rawMsg.replace(/^Error:\s*/, '')
          : 'Suppression échouée',
        'error'
      );
    } finally {
      fetchStockProducts({ silent: true, background: true }).catch(() => {});
    }
  };

  const parseProductReferenceItems = (
    raw: string | null | undefined
  ): ProductItem[] => {
    const txt = String(raw || '').trim();
    if (!txt) return [];

    const parts = txt
      .split(';')
      .map(s => String(s || '').trim())
      .filter(Boolean);

    const m = new Map<string, { quantity: number; description?: string }>();
    for (const p of parts) {
      const seg = String(p || '').trim();
      if (!seg) continue;

      const idx = seg.indexOf('**');
      const refRaw = idx >= 0 ? seg.slice(0, idx) : seg;
      const tailRaw = idx >= 0 ? seg.slice(idx + 2) : '';

      let reference = String(refRaw || '').trim();
      let tail = String(tailRaw || '').trim();

      let quantity = 1;
      let description = '';

      if (tail) {
        const mm = tail.match(/^(\d+)?\s*(?:\((.*)\))?$/);
        if (mm?.[1]) {
          const q = Number(mm[1]);
          if (Number.isFinite(q) && q > 0) quantity = Math.floor(q);
        }
        if (typeof mm?.[2] === 'string') description = mm[2];
      } else {
        const mm = reference.match(/^(.*?)(?:\((.*)\))?$/);
        if (mm?.[2]) description = mm[2];
      }

      reference = reference.replace(/\((.*)\)$/, '').trim();
      description = String(description || '').trim();
      if (!reference) continue;

      const prev = m.get(reference);
      const nextQty =
        (prev?.quantity || 0) + (Number.isFinite(quantity) ? quantity : 1);
      const nextDesc = description || prev?.description || '';
      m.set(reference, {
        quantity: nextQty,
        description: nextDesc || undefined,
      });
    }

    return Array.from(m.entries()).map(([reference, v]) => ({
      reference,
      quantity: v.quantity,
      description: v.description || null,
    }));
  };

  const formatProductReferenceForToast = (raw: string | null | undefined) => {
    const items = parseProductReferenceItems(raw);
    if (items.length === 0) return '';
    return items
      .map(
        it => `${it.reference} Qté: ${Math.max(1, Number(it.quantity || 1))}`
      )
      .join('; ');
  };

  const getShipmentProductItems = (s: Shipment): ProductItem[] =>
    parseProductReferenceItems(s.product_reference);

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

  // Filtre Mes ventes: champ sélectionné + terme de recherche
  const filteredShipments = (shipments || []).filter(s => {
    const term = (salesFilterTerm || idSearch || '').trim().toLowerCase();
    if (!term) return true;
    const field = salesFilterField;
    if (field === 'id') {
      const idStr = (s.shipment_id || '').toLowerCase();
      return idStr.includes(term);
    }
    if (field === 'client') {
      const stripeId = (s.customer_stripe_id || '').toLowerCase();
      const customer = s.customer_stripe_id
        ? customersMap[s.customer_stripe_id] || null
        : null;
      const clerkId = customer?.clerkUserId || customer?.clerk_id;
      const user = clerkId ? socialsMap[clerkId] || null : null;
      const nameParts = [user?.firstName || '', user?.lastName || '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const customerName = (customer?.name || '').toLowerCase();
      const email = (customer?.email || '' || user?.emailAddress || '')
        .toLowerCase()
        .trim();
      return (
        stripeId.includes(term) ||
        customerName.includes(term) ||
        nameParts.includes(term) ||
        email.includes(term)
      );
    }
    const refStr = (s.product_reference || '').toLowerCase();
    return refStr.includes(term);
  });
  const totalPages = Math.max(
    1,
    Math.ceil(filteredShipments.length / pageSize)
  );
  const startIndex = (page - 1) * pageSize;
  const visibleShipments = filteredShipments.slice(
    startIndex,
    startIndex + pageSize
  );
  const selectedSales = (shipments || []).filter(s =>
    selectedSaleIds.has(s.id)
  );
  const selectedForDoc = selectedSales.filter(
    s => s.document_created && s.shipment_id
  );
  const selectedForCancel = selectedSales.filter(
    s => s.shipment_id && !s.is_final_destination && !s.cancel_requested
  );
  const visibleSaleIds = visibleShipments.map(s => s.id);
  const allVisibleSelected =
    visibleSaleIds.length > 0 &&
    visibleSaleIds.every(id => selectedSaleIds.has(id));
  const toggleSaleSelection = (id: number) => {
    setSelectedSaleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedSaleIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleSaleIds.forEach(id => next.delete(id));
      } else {
        visibleSaleIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  useEffect(() => {
    setSelectedSaleIds(prev => {
      const validIds = new Set((shipments || []).map(s => s.id));
      const next = new Set<number>();
      prev.forEach(id => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [shipments]);

  useEffect(() => {
    const filteredLength = (shipments || []).filter(s => {
      const term = (salesFilterTerm || idSearch || '').trim().toLowerCase();
      if (!term) return true;
      const field = salesFilterField;
      if (field === 'id') {
        const idStr = (s.shipment_id || '').toLowerCase();
        return idStr.includes(term);
      }
      if (field === 'client') {
        const stripeId = (s.customer_stripe_id || '').toLowerCase();
        const customer = s.customer_stripe_id
          ? customersMap[s.customer_stripe_id] || null
          : null;
        const clerkId = customer?.clerkUserId || customer?.clerk_id;
        const user = clerkId ? socialsMap[clerkId] || null : null;
        const nameParts = [user?.firstName || '', user?.lastName || '']
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const customerName = (customer?.name || '').toLowerCase();
        const email = (customer?.email || '' || user?.emailAddress || '')
          .toLowerCase()
          .trim();
        return (
          stripeId.includes(term) ||
          customerName.includes(term) ||
          nameParts.includes(term) ||
          email.includes(term)
        );
      }
      const refStr = (s.product_reference || '').toLowerCase();
      return refStr.includes(term);
    }).length;
    const newTotal = Math.max(1, Math.ceil(filteredLength / pageSize));
    if (page > newTotal) setPage(newTotal);
    if (page < 1) setPage(1);
  }, [shipments, pageSize, salesFilterTerm, salesFilterField, idSearch]);

  // Chargement des clients Stripe basés sur les customer_stripe_id des shipments
  useEffect(() => {
    if (section !== 'clients' && section !== 'sales') return;
    const ids = Array.from(
      new Set((shipments || []).map(s => s.customer_stripe_id).filter(Boolean))
    ) as string[];
    const idsToFetch = ids.filter(id => !(id in customersMap));
    if (idsToFetch.length === 0) return;
    setCustomersLoading(true);
    Promise.all(
      idsToFetch.map(async id => {
        try {
          const resp = await fetch(
            `${apiBase}/api/stripe/get-customer-by-id?customerId=${encodeURIComponent(id)}`
          );
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            console.warn(
              'Erreur récupération client Stripe',
              json?.error || json?.message
            );
            return { id, customer: null };
          }
          return { id, customer: json?.customer || null };
        } catch (e) {
          console.warn('Exception récupération client Stripe', e);
          return { id, customer: null };
        }
      })
    )
      .then(results => {
        setCustomersMap(prev => {
          const next = { ...prev };
          results.forEach(({ id, customer }) => {
            if (customer) next[id] = customer;
          });
          return next;
        });
      })
      .finally(() => setCustomersLoading(false));
  }, [section, shipments]);

  // Charger les réseaux sociaux (comptes externes) Clerk pour les clients Stripe qui exposent clerkUserId
  useEffect(() => {
    const run = async () => {
      const entries = Object.values(customersMap || {}) as any[];
      const ids = Array.from(
        new Set(
          entries
            .map(c => c?.clerkUserId || c?.clerk_id)
            .filter((v: any) => !!v)
        )
      ) as string[];
      // Recharger si l'utilisateur n'est pas encore en cache
      // ou si les comptes externes en cache manquent les champs firstName/lastName
      const toFetch = ids.filter(id => {
        const cached = socialsMap[id];
        if (!cached) return true;
        const accs = Array.isArray(cached?.externalAccounts)
          ? cached.externalAccounts
          : [];
        const missingNames = accs.some(
          (a: any) => !a?.firstName && !a?.lastName
        );
        return missingNames;
      });
      if (toFetch.length === 0) return;
      try {
        const token = await getToken();
        const results = await Promise.all(
          toFetch.map(async clerkId => {
            try {
              const resp = await fetch(
                `${apiBase}/api/stripe/get-clerk-user-by-id?clerkUserId=${encodeURIComponent(
                  clerkId
                )}`,
                {
                  headers: {
                    Authorization: token ? `Bearer ${token}` : '',
                  },
                }
              );
              const json = await resp.json().catch(() => ({}));
              if (!resp.ok) {
                console.warn(
                  'Erreur récupération comptes externes',
                  json?.error || json?.message
                );
                return { clerkId, user: null };
              }
              const user = json?.user || null;
              return { clerkId, user };
            } catch (e) {
              console.warn('Exception récupération comptes externes', e);
              return { clerkId, accounts: [] };
            }
          })
        );
        setSocialsMap(prev => {
          const next = { ...prev };
          results.forEach(r => {
            next[r.clerkId] = r.user || null;
          });
          return next;
        });
      } catch (e) {
        console.warn('Erreur globale récupération comptes externes', e);
      }
    };
    run();
  }, [customersMap]);

  // Charger les paniers du store quand on ouvre l’onglet Panier
  useEffect(() => {
    if (section !== 'carts') return;
    if (!store?.slug) return;
    const run = async () => {
      try {
        const resp = await apiGet(
          `/api/carts/store/${encodeURIComponent(store.slug)}`
        );
        const json = await resp.json().catch(() => ({}));
        setStoreCarts(Array.isArray(json?.carts) ? json.carts : []);
      } catch (e: any) {
        const raw =
          e?.message || 'Erreur lors du chargement des paniers du store';
        showToast(raw, 'error');
      }
    };
    run();
  }, [section, store?.slug]);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        if (section !== 'carts') return;
        const token = await getToken();
        const resp = await apiGet(`/api/clerk/users`, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        const json = await resp.json().catch(() => ({}));
        const arr = Array.isArray(json?.users) ? json.users : [];
        const map: Record<string, any> = {};
        arr.forEach((u: any) => {
          if (u?.stripeId) {
            map[String(u.stripeId)] = u;
          }
        });
        setClerkUsersByStripeId(map);
      } catch (e) {}
    };
    loadUsers();
  }, [section]);

  const searchClerkUsers = async (query: string) => {
    try {
      if (!query.trim()) {
        setCartCustomerResults([]);
        return;
      }
      setCartUsersLoading(true);
      const token = await getToken();
      const resp = await apiGet(
        `/api/clerk/users?search=${encodeURIComponent(query)}`,
        {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        }
      );
      const json = await resp.json().catch(() => ({}));
      setCartCustomerResults(Array.isArray(json?.users) ? json.users : []);
    } catch (e: any) {
      const raw = e?.message || 'Erreur recherche utilisateurs';
      showToast(raw, 'error');
    } finally {
      setCartUsersLoading(false);
    }
  };

  useEffect(() => {
    if (section !== 'carts') return;
    const storeSlug = String(store?.slug || '').trim();
    const q = String(cartReference || '').trim();
    const selectedRef = String(
      (cartSelectedStockItem as any)?.stock?.product_reference || ''
    )
      .trim()
      .toLowerCase();
    if (selectedRef && selectedRef === q.toLowerCase()) {
      setCartStockSuggestions([]);
      setCartStockSuggestionsOpen(false);
      return;
    }
    if (!storeSlug || q.length < 2) {
      setCartStockSuggestions([]);
      setCartStockSuggestionsOpen(false);
      if (!q) setCartSelectedStockItem(null);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      setCartStockSuggestionsLoading(true);
      try {
        const resp = await fetch(
          `${API_BASE_URL}/api/stores/${encodeURIComponent(
            storeSlug
          )}/stock/search?q=${encodeURIComponent(q)}`
        );
        const json = await resp.json().catch(() => null as any);
        if (cancelled) return;
        if (!resp.ok) {
          setCartStockSuggestions([]);
          setCartStockSuggestionsOpen(false);
          return;
        }
        const items = Array.isArray(json?.items) ? json.items : [];
        setCartStockSuggestions(items);
        setCartStockSuggestionsOpen(true);
      } finally {
        if (!cancelled) setCartStockSuggestionsLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [section, store?.slug, cartReference, cartSelectedStockItem]);

  const applyCartSuggestion = (s: any) => {
    const stock = s?.stock || {};
    const product = s?.product || null;

    const ref = String(stock?.product_reference || '').trim();
    const qtyRaw = Number(stock?.quantity ?? 0);
    const qtyAvailable =
      Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 0;
    if (!ref || qtyAvailable <= 0) return;

    const title = String(product?.name || ref || '').trim() || ref;
    const priceRaw = Number(stock?.price);
    const price = Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;

    const stripeWeightRaw = (product as any)?.metadata?.weight_kg;
    const stripeWeightParsed = stripeWeightRaw
      ? Number(String(stripeWeightRaw).replace(',', '.'))
      : NaN;
    const stockWeightRaw = Number(stock?.weight);
    const weight =
      Number.isFinite(stripeWeightParsed) && stripeWeightParsed >= 0
        ? stripeWeightParsed
        : Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0
          ? stockWeightRaw
          : null;

    setCartSelectedStockItem(s);
    setCartReference(ref);
    setCartDescription(title);
    setCartAmountEuro(prev =>
      price !== null
        ? String(price.toFixed(2))
        : String(prev || '').trim()
          ? prev
          : ''
    );
    setCartWeightKg(prev =>
      weight !== null ? String(weight) : String(prev || '').trim() ? prev : ''
    );
    setCartQuantity(String(qtyAvailable));
    setCartStockSuggestionsOpen(false);
  };

  const handleCreateCart = async () => {
    try {
      const ref = (cartReference || '').trim();
      const desc = (cartDescription || '').trim();
      const amt = parseFloat((cartAmountEuro || '').trim().replace(',', '.'));
      const qtyParsed = parseInt((cartQuantity || '').trim(), 10);
      const qty =
        Number.isFinite(qtyParsed) && qtyParsed > 0 ? Math.floor(qtyParsed) : 0;
      const weightParsed = parseFloat(
        (cartWeightKg || '').trim().replace(',', '.')
      );
      const weight =
        Number.isFinite(weightParsed) && weightParsed >= 0
          ? weightParsed
          : null;
      if (!(amt > 0)) {
        showToast('Veuillez saisir un montant supérieur à 0', 'error');
        return;
      }
      if (!store?.id) {
        showToast('Boutique introuvable', 'error');
        return;
      }
      if (!cartSelectedUser) {
        showToast('Veuillez sélectionner un client', 'error');
        return;
      }
      if (!ref) {
        showToast('Veuillez saisir la référence', 'error');
        return;
      }
      if (!desc) {
        showToast('Veuillez saisir la description', 'error');
        return;
      }
      if (!(qty > 0)) {
        showToast('Veuillez saisir une quantité valide (>= 1)', 'error');
        return;
      }
      if (weight === null) {
        showToast('Veuillez saisir un poids valide (>= 0)', 'error');
        return;
      }
      setCartCreating(true);
      let stripeId = cartSelectedUser.stripeId || '';
      if (!stripeId) {
        try {
          const body: any = {
            name: cartSelectedUser.fullName || '',
            email: cartSelectedUser.email || '',
            clerkUserId: cartSelectedUser.id,
          };
          const token = await getToken();
          const resp = await apiPost('/api/stripe/create-customer', body, {
            headers: { Authorization: token ? `Bearer ${token}` : '' },
          });
          const json = await resp.json().catch(() => ({}));
          stripeId = json?.stripeId || json?.customer?.id || '';
        } catch (e) {}
      }
      if (!stripeId) {
        showToast(
          "Impossible de déterminer l'identifiant Stripe du client",
          'error'
        );
        return;
      }
      const payload: any = {
        store_id: store.id,
        product_reference: ref,
        value: amt,
        customer_stripe_id: stripeId,
        description: desc,
        weight,
        quantity: qty,
      };
      const resp = await apiPost('/api/carts', payload);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || 'Création du panier échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Erreur');
      }
      showToast('Panier créé', 'success');
      setCartReference('');
      setCartDescription('');
      setCartWeightKg('');
      setCartAmountEuro('');
      setCartQuantity('1');
      if (store?.slug) {
        const r = await apiGet(
          `/api/carts/store/${encodeURIComponent(store.slug)}`
        );
        const j = await r.json().catch(() => ({}));
        setStoreCarts(Array.isArray(j?.carts) ? j.carts : []);
      }
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      showToast(raw, 'error');
    } finally {
      setCartCreating(false);
    }
  };

  const handleDeleteCart = async (id: number) => {
    try {
      if (!id) return;
      setCartDeletingIds(prev => ({ ...prev, [id]: true }));
      const resp = await apiDelete('/api/carts', {
        body: JSON.stringify({ id }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = json?.error || 'Suppression du panier échouée';
        throw new Error(typeof msg === 'string' ? msg : 'Erreur');
      }
      showToast('Panier supprimé', 'success');
      setStoreCarts(prev => (prev || []).filter((c: any) => c.id !== id));
    } catch (e: any) {
      const raw = e?.message || 'Erreur inconnue';
      showToast(raw, 'error');
    } finally {
      setCartDeletingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleReloadCarts = async () => {
    try {
      if (!store?.slug) return;
      setCartReloading(true);
      const resp = await apiGet(
        `/api/carts/store/${encodeURIComponent(store.slug)}`
      );
      const json = await resp.json().catch(() => ({}));
      setStoreCarts(Array.isArray(json?.carts) ? json.carts : []);
    } catch (e: any) {
      showToast(e?.message || 'Erreur inconnue', 'error');
    } finally {
      setCartReloading(false);
    }
  };

  // Handlers de validation du nom (adaptés depuis Onboarding)
  const handleStoreNameFocus = () => {
    setWasStoreNameFocused(true);
  };
  const handleStoreNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    setIsStoreNameDirty(true);
    if (slugExists) setSlugExists(false);
  };
  const checkSlugUniqueness = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Ne pas déclencher la vérification si le nom n'a pas changé
    if (store?.name && store.name.trim() === trimmed) {
      setGeneratedSlug(store.slug || '');
      setSlugExists(false);
      return;
    }
    setIsCheckingSlug(true);
    try {
      const resp = await apiGet(
        `/api/stores/exists?name=${encodeURIComponent(trimmed)}`
      );
      if (!resp.ok) throw new Error('Erreur lors de la vérification du slug');
      const json = await resp.json();
      const exists = Boolean(json?.exists);
      setSlugExists(exists);
      if (!exists) {
        setGeneratedSlug(json?.slug || '');
        setLastCheckedSlug(json?.slug || '');
      } else {
        setLastCheckedSlug('');
      }
    } catch (err) {
      console.error('Vérification du slug échouée:', err);
      setSlugExists(false);
    } finally {
      setIsCheckingSlug(false);
    }
  };
  const handleStoreNameBlur = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setShowValidationErrors(true);
      setWasStoreNameFocused(false);
      return;
    }
    if (!wasStoreNameFocused) {
      setWasStoreNameFocused(false);
      return;
    }
    if (!isStoreNameDirty) {
      setWasStoreNameFocused(false);
      return;
    }
    // Si le nom est inchangé, ne pas vérifier le slug
    if (store?.name && store.name.trim() === trimmed) {
      setGeneratedSlug(store.slug || '');
      setSlugExists(false);
      setWasStoreNameFocused(false);
      setIsStoreNameDirty(false);
      return;
    }
    await checkSlugUniqueness();
    setWasStoreNameFocused(false);
    setIsStoreNameDirty(false);
  };

  useEffect(() => {
    const resolveStoreAndLoad = async () => {
      try {
        // 1) Résoudre le slug si absent via check-owner
        let slugToUse = resolvedSlug;
        if (!slugToUse) {
          const email = user?.primaryEmailAddress?.emailAddress || '';
          if (!email) {
            // Attendre que Clerk charge l'email
            return;
          }
          const resp = await fetch(
            `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
          );
          const json = await resp.json();
          if (resp.ok && json?.exists && json?.slug) {
            slugToUse = json.slug as string;
            setResolvedSlug(slugToUse);
          } else {
            setNoStore(true);
            setLoading(false);
            return;
          }
        }

        // 2) Charger la boutique
        const storeResp = await fetch(
          `${apiBase}/api/stores/${encodeURIComponent(slugToUse)}`
        );
        const storeJson = await storeResp.json();
        if (!storeResp.ok) {
          setError(storeJson?.error || 'Boutique non trouvée');
          setLoading(false);
          return;
        }
        const s: Store = storeJson.store;
        setStore(s);
        setName(s?.name || '');
        setDescription(s?.description || '');
        setWebsite(s?.website || '');
        setSiret((s as any)?.siret || '');
        setTvaApplicable(Boolean((s as any)?.tva_applicable));
        const iban = String((s as any)?.iban_bic?.iban || '').trim();
        const bic = String((s as any)?.iban_bic?.bic || '').trim();
        if (!ibanInput.trim() && iban) {
          setIbanInput(iban);
        }
        if (!bicInput.trim() && bic) {
          setBicInput(bic);
        }
        const addr = (s as any)?.address || null;
        if (addr) {
          setFormPhone(String(addr?.phone || ''));
          const preset: Address = {
            line1: addr?.line1 || '',
            line2: '',
            city: addr?.city || '',
            state: '',
            postal_code: addr?.postal_code || '',
            country: addr?.country || 'FR',
          } as any;
          setBillingAddress(preset);
          const complete = Boolean(
            (preset.line1 || '').trim() &&
              (preset.city || '').trim() &&
              (preset.postal_code || '').trim() &&
              (preset.country || '').trim()
          );
          setIsAddressComplete(complete);
        } else {
          setBillingAddress(null);
          setIsAddressComplete(false);
        }

        // 3) Charger les ventes de la boutique
        const token = await getToken();
        const shipResp = await fetch(
          `${apiBase}/api/shipments/store/${encodeURIComponent(slugToUse)}`,
          {
            headers: {
              Authorization: token ? `Bearer ${token}` : '',
            },
          }
        );
        const shipJson = await shipResp.json();
        if (!shipResp.ok) {
          const msg = shipJson?.error || 'Erreur lors du chargement des ventes';
          if (shipResp.status === 403 || shipResp.status === 404) {
            setError(msg);
            setLoading(false);
            return;
          }
          throw new Error(msg);
        }
        setShipments(shipJson?.shipments || []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erreur inconnue';
        setError(msg);
        showToast(msg, 'error');
      } finally {
        setLoading(false);
      }
    };
    resolveStoreAndLoad();
  }, [resolvedSlug, user?.primaryEmailAddress?.emailAddress, user?.id]);

  const saveStoreInfo = async () => {
    setIsSubmittingModifications(true);
    if (!store?.slug) return;
    setShowValidationErrors(true);
    // Vérifications similaires à onboarding
    if (!name.trim()) {
      setIsSubmittingModifications(false);
      return;
    }
    if (websiteInvalid) {
      setIsSubmittingModifications(false);
      return;
    }
    if (!isAddressComplete || !formPhone.trim()) {
      setIsSubmittingModifications(false);
      return;
    }
    // Identifiant entreprise facultatif: doit être valide et vérifiable
    if (siret && (siretInvalid || !!siretErrorMessage)) {
      showToast(
        companyCountry === 'FR'
          ? 'Veuillez saisir un SIRET valide (14 chiffres)'
          : 'Veuillez saisir un BCE valide (10 chiffres)',
        'error'
      );
      setIsSubmittingModifications(false);
      return;
    }
    // La vérification d'unicité est effectuée côté backend; ne bloque pas côté frontend
    try {
      // Uploader le logo si un nouveau fichier est sélectionné
      if (logoFile && store?.slug) {
        try {
          const fd = new FormData();
          fd.append('image', logoFile);
          fd.append('slug', store.slug);
          const uploadResp = await apiPostForm('/api/upload', fd);
          const uploadJson = await uploadResp.json();
          if (!uploadJson?.success) {
            console.warn('Upload du logo échoué:', uploadJson?.error);
          }
        } catch (e) {
          console.warn("Erreur l'upload du logo:", e);
        }
      }
      const payload: any = {
        name,
        description,
        website,
        phone: formPhone,
        address: billingAddress,
        tva_applicable: tvaApplicable,
      };
      const isSiretVerified =
        Boolean(siret) &&
        lastCheckedSiret === normalizeCompanyId(siret) &&
        !siretInvalid &&
        !siretErrorMessage &&
        !!siretDetails;
      // Inclure SIRET si fourni et le flag is_verified si vérifié
      if (siret) {
        payload.siret = siret;
      }
      if (isSiretVerified) {
        payload.is_verified = true;
      }
      const resp = await apiPut(
        `/api/stores/${encodeURIComponent(store.slug)}`,
        payload
      );
      const json = await resp.json();
      if (!json?.success) {
        throw new Error(
          json?.error || 'Échec de la mise à jour de la boutique'
        );
      }
      const updated: Store = json.store;
      setStore(updated);
      setEditingInfo(false);
      showToast('Informations de la boutique mises à jour.', 'success');
      // Plus de navigation liée au slug: rester sur `/dashboard` sans redirection
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Erreur inconnue',
        'error'
      );
    } finally {
      setIsSubmittingModifications(false);
    }
  };

  const handleDraw = async () => {
    try {
      if (selectedIds.size < 2) {
        showToast('Sélectionnez au moins deux clients', 'error');
        return;
      }
      setDrawLoading(true);
      const token = await getToken();
      const resp = await apiPost(
        '/api/raffle/draw',
        { participantIds: Array.from(selectedIds) },
        {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        }
      );
      const json = await resp.json().catch(() => ({}));
      const w = json?.winner || null;
      if (!w) {
        throw new Error('Erreur lors du tirage');
      }
      setWinner(w);
      setShowWinnerModal(true);
      showToast('Tirage effectué', 'success');
    } catch (e: any) {
      const raw = e?.message || 'Erreur lors du tirage';
      const trimmed = (raw || '').replace(/^Error:\s*/, '');
      showToast(trimmed, 'error');
    } finally {
      setDrawLoading(false);
    }
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showWinnerModal) {
        setShowWinnerModal(false);
        if (drawButtonRef.current) {
          try {
            drawButtonRef.current.focus();
          } catch {}
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [showWinnerModal]);

  const confirmPayout = async () => {
    if (!store?.slug) return;
    setIbanError(null);
    setBicError(null);
    setIsSubmittingPayout(true);
    try {
      const ibanToUse = ibanInput.trim();
      const bicToUse = bicInput.trim();
      if (!ibanToUse) {
        setIbanError('IBAN requis');
        return;
      }
      if (!bicToUse) {
        setBicError('BIC requis');
        return;
      }

      const payload: any = { iban: ibanToUse, bic: bicToUse };
      const token = await getToken();
      const resp = await apiPost(
        `/api/stores/${encodeURIComponent(store!.slug)}/confirm-payout`,
        payload,
        {
          headers: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        }
      );
      const json = await resp.json();
      if (!json?.success) {
        const errMsg = json?.error || 'Échec de la demande de versement';
        if (errMsg === 'IBAN invalide') {
          setIbanError('IBAN invalide');
          return;
        }
        if (errMsg === 'BIC invalide') {
          setBicError('BIC invalide');
          return;
        }
        showToast(errMsg, 'error');
        return;
      }
      const updated: Store = json.store;
      // Préserver les champs non renvoyés (ex: clerk_id) pour ne pas casser Protect
      setStore(prev => ({ ...(prev as Store), ...updated }));

      const pdfBase64 =
        json?.pdf && typeof json.pdf?.base64 === 'string'
          ? (json.pdf.base64 as string)
          : '';
      const pdfFileName =
        json?.pdf && typeof json.pdf?.fileName === 'string'
          ? (json.pdf.fileName as string)
          : 'transactions.pdf';
      if (pdfBase64) {
        try {
          const binary = atob(pdfBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = pdfFileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } catch {}
      }
      showToast('Versement effectué avec succès.', 'success');
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Erreur inconnue';
      let parsed: any = null;
      try {
        const trimmed = (rawMsg || '').replace(/^Error:\s*/, '');
        parsed = JSON.parse(trimmed);
      } catch (_) {
        parsed = null;
      }
      const apiError =
        parsed && typeof parsed === 'object' ? parsed.error : null;
      if (apiError === 'IBAN invalide') {
        setIbanError('IBAN invalide');
      } else if (apiError === 'BIC invalide') {
        setBicError('BIC invalide');
      } else {
        const displayMsg =
          (rawMsg || '').replace(/^Error:\s*/, '') || 'Erreur inconnue';
        showToast(displayMsg, 'error');
      }
    } finally {
      setIsSubmittingPayout(false);
    }
  };

  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50'>
        <Header />
        <div className='min-h-screen flex items-center justify-center'>
          <div className='text-center'>
            <Spinner
              size='lg'
              color='blue'
              variant='bottom'
              className='mx-auto mb-4'
            />
            <p className='text-gray-600'>Chargement du tableau de bord...</p>
          </div>
        </div>
      </div>
    );
  }
  // Les erreurs d’accès/absence de boutique sont gérées par l’overlay du Header
  return (
    <div className='min-h-screen bg-gray-50'>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          visible={(toast as any).visible !== false}
        />
      )}
      <Header />
      {showWelcome && (
        <SuccessConfetti
          onClose={() => setShowWelcome(false)}
          shareLink={shareLink}
          isStorecreated={showWelcome}
        />
      )}
      {/* Accès contrôlé par Header; contenu rendu directement ici */}
      <div className='w-full mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {/* Errors are now surfaced via Toasts */}
        {/* Les erreurs sont gérées via des toasts, pas de bandeau inline */}

        <div className='flex items-center justify-between mb-6'>
          <div>
            <h1 className='text-2xl font-bold text-gray-900'>
              Tableau de bord
            </h1>
            {store && (
              <div className='flex flex-col sm:flex-row sm:items-center gap-2  min-w-0'>
                <p
                  className='text-gray-600 truncate flex-1 min-w-0'
                  title={store.name}
                >
                  {store.name}
                </p>
                {store.is_verified ? (
                  <div className='inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium size-fit shrink-0'>
                    <BadgeCheck className='w-3 h-3' /> Boutique Vérifiée
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {store && (
            <button
              onClick={() =>
                navigate(`/checkout/${encodeURIComponent(store.slug)}`)
              }
              className='inline-flex items-center px-2 py-2 sm:px-4 sm:py-2 text-xs sm:text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700'
            >
              Formulaire de paiement
              <ArrowRight className='w-3 h-3 sm:w-4 sm:h-4 ml-2' />
            </button>
          )}
        </div>
        {/* Onglets horizontaux au-dessus du contenu */}
        <div className='mb-6'>
          <nav className='flex flex-wrap items-center gap-1'>
            <button
              onClick={() => setSection('infos')}
              className={`flex items-center sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'infos'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Info className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Informations</span>
            </button>
            <button
              onClick={() => setSection('wallet')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'wallet'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Wallet className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Porte-monnaie</span>
            </button>
            <button
              onClick={() => setSection('stock')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'stock'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <FaArchive className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Stock</span>
            </button>
            <button
              onClick={() => setSection('sales')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'sales'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Coins className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Ventes</span>
            </button>

            <button
              onClick={() => setSection('clients')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'clients'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Users className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Clients</span>
            </button>
            <button
              onClick={() => setSection('carts')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'carts'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <ShoppingCart className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Panier</span>
            </button>
            <button
              onClick={() => setSection('promo')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'promo'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Tag className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Code Promo</span>
            </button>
            <button
              onClick={() => setSection('support')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'support'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <LifeBuoy className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
              <span className='truncate'>Support</span>
            </button>
          </nav>
        </div>

        {/* Contenu principal en pleine largeur */}
        <div className='space-y-8'>
          {/* Section Infos boutique */}
          {store && section === 'infos' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div>
                <div className='flex items-center mb-4'>
                  <Info className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Informations de la boutique
                  </h2>
                </div>
                {/* Alias court vers la page de paiement */}
                <div className='space-y-2'>
                  <p className='text-xs text-gray-500'>
                    Collez ce lien dans la bio de vos réseaux sociaux.
                  </p>
                  <div className='flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 p-3'>
                    <input
                      type='text'
                      value={shareLink}
                      readOnly
                      className='w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-xs sm:text-sm text-gray-700 outline-none'
                    />
                    <button
                      onClick={handleCopyAlias}
                      className={`flex items-center justify-center space-x-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors w-full sm:w-auto flex-shrink-0 ${
                        aliasCopied
                          ? 'bg-green-100 text-green-700'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {!aliasCopied && (
                        <Copy size={12} className='sm:w-3.5 sm:h-3.5' />
                      )}
                      <span>{aliasCopied ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                </div>
              </div>
              {/* Affichage (non édité) */}
              {!editingInfo && (
                <div className='space-y-4 mt-6'>
                  <div className='flex items-center space-x-4'>
                    {(() => {
                      const cloudBase = (
                        import.meta.env.VITE_CLOUDFRONT_URL ||
                        'https://d1tmgyvizond6e.cloudfront.net'
                      ).replace(/\/+$/, '');
                      const storeLogo = store?.id
                        ? `${cloudBase}/images/${store.id}`
                        : undefined;
                      return storeLogo ? (
                        <img
                          src={storeLogo}
                          alt={store.name}
                          className='w-16 h-16 rounded-lg object-cover'
                        />
                      ) : (
                        <div className='w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center'>
                          <Upload className='w-8 h-8 text-gray-500' />
                        </div>
                      );
                    })()}
                    <div className='min-w-0'>
                      <p className='text-sm text-gray-700 min-w-0'>
                        <span className='font-medium mr-1'>Nom:</span>
                        <span
                          className='truncate inline-block align-bottom max-w-full'
                          title={store.name}
                        >
                          {store.name}
                        </span>
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium mr-1'>Description:</span>
                        <span
                          title={store.description || '-'}
                          className='truncate inline-block align-bottom max-w-full'
                        >
                          {store.description || '-'}
                        </span>
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium'>Site web:</span>{' '}
                        {store.website ? (
                          <a
                            href={
                              /^https?:\/\//.test(store.website)
                                ? store.website
                                : `http://${store.website}`
                            }
                            target='_blank'
                            rel='noreferrer'
                            className='text-indigo-600 hover:underline'
                          >
                            {store.website}
                          </a>
                        ) : (
                          '-'
                        )}
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium mr-1'>SIRET:</span>
                        <span>{(store as any)?.siret || '-'}</span>
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span>
                          {(store as any)?.tva_applicable
                            ? 'TVA applicable'
                            : 'TVA non applicable'}
                        </span>
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium mr-1'>Adresse:</span>
                        <span>
                          {(() => {
                            const addr = (store as any)?.address || null;
                            if (!addr) return '-';
                            const seg1 = addr?.line1 || '';
                            const seg2 = [addr?.postal_code, addr?.city]
                              .filter(Boolean)
                              .join(' ');
                            const seg3 = addr?.country || '';
                            const parts = [seg1, seg2, seg3].filter(Boolean);
                            return parts.length ? parts.join(', ') : '-';
                          })()}
                        </span>
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium mr-1'>Téléphone:</span>
                        <span>{(store as any)?.address?.phone || '-'}</span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={() => setEditingInfo(true)}
                      className='inline-flex items-center px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700'
                    >
                      <Pencil className='w-5 h-5 mr-2' />
                      Modifier vos informations
                    </button>
                  </div>
                </div>
              )}
              {/* Édition */}
              {editingInfo && (
                <div className='space-y-4 mt-6'>
                  <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                    <div>
                      <label
                        htmlFor='storeName'
                        className='block text-sm font-medium text-gray-700 mb-2'
                      >
                        Nom de votre boutique *
                      </label>
                      <div className='relative'>
                        <input
                          type='text'
                          id='storeName'
                          required
                          value={name}
                          onChange={handleStoreNameChange}
                          onFocus={handleStoreNameFocus}
                          onBlur={handleStoreNameBlur}
                          className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${slugExists || !name.trim() ? 'border-red-500' : 'border-gray-300'}`}
                          placeholder='Ma Super Boutique'
                        />
                        {isCheckingSlug && (
                          <div className='absolute right-3 inset-y-0 flex items-center'>
                            <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                          </div>
                        )}
                      </div>
                      {showValidationErrors && !name.trim() && (
                        <p className='mt-2 text-sm text-red-600'>
                          Veuillez renseigner le nom de la boutique
                        </p>
                      )}
                      {slugExists && (
                        <p className='mt-2 text-sm text-red-600'>
                          Ce nom existe déjà.
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor='description'
                        className='block text-sm font-medium text-gray-700 mb-2'
                      >
                        Description
                      </label>
                      <input
                        className='w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor='website'
                        className='block text-sm font-medium text-gray-700 mb-2'
                      >
                        Site web
                      </label>

                      <input
                        className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${website && websiteInvalid ? 'border-red-500' : 'border-gray-300'}`}
                        value={website}
                        onChange={e => setWebsite(e.target.value)}
                      />
                      {website && websiteInvalid && (
                        <p className='mt-1 text-xs text-red-600'>
                          Veuillez saisir un nom de domaine valide (ex:
                          votre-site.co) ou une URL complète
                        </p>
                      )}
                    </div>
                  </div>
                  {/* SIRET/BCE */}
                  <div>
                    <label
                      htmlFor='siret'
                      className='block text-sm font-medium text-gray-700 mb-2'
                    >
                      {companyCountry === 'FR'
                        ? 'SIRET (14 chiffres, facultatif mais nécessaire pour obtenir le badge "Boutique Vérifiée")'
                        : 'BCE (10 chiffres, facultatif mais nécessaire pour obtenir le badge "Boutique Vérifiée")'}
                    </label>
                    <div className='flex items-center gap-2'>
                      <div className='relative flex-1'>
                        <input
                          id='siret'
                          inputMode='numeric'
                          value={siret}
                          onChange={handleSiretChange}
                          onFocus={handleSiretFocus}
                          onBlur={handleSiretBlur}
                          className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${showValidationErrors && siret && (siretInvalid || !!siretErrorMessage) ? 'border-red-500' : 'border-gray-300'}`}
                          placeholder={
                            companyCountry === 'FR'
                              ? '12345678901234'
                              : '0123.456.789 ou BE0123456789'
                          }
                        />
                        {isCheckingSiret && (
                          <div className='absolute right-3 inset-y-0 flex items-center'>
                            <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                          </div>
                        )}
                      </div>
                    </div>
                    {(siret && showValidationErrors && siretInvalid) ||
                    (siret && !!siretErrorMessage) ? (
                      <p className='mt-2 text-sm text-red-600'>
                        {siretErrorMessage ||
                          (companyCountry === 'FR'
                            ? 'SIRET invalide. Entrez exactement 14 chiffres.'
                            : 'BCE invalide. Entrez exactement 10 chiffres.')}
                      </p>
                    ) : null}
                    <div className='mt-3'>
                      <label className='flex items-center space-x-2'>
                        <input
                          type='checkbox'
                          checked={tvaApplicable}
                          onChange={e => setTvaApplicable(e.target.checked)}
                          className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer'
                        />
                        <span className='text-sm text-gray-700'>
                          TVA applicable
                        </span>
                      </label>
                    </div>

                    {siret &&
                    normalizeCompanyId(siret) === lastCheckedSiret &&
                    !siretInvalid &&
                    !siretErrorMessage &&
                    siretDetails
                      ? (() => {
                          if (companyCountry === 'FR') {
                            const pick = (v: any) => {
                              if (v === null || v === undefined) return null;
                              const s = String(v).trim();
                              if (!s || s === '[ND]') return null;
                              return s;
                            };
                            const formatInseeDate = (iso: any) => {
                              const s = pick(iso);
                              if (!s) return null;
                              const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
                              if (!m) return null;
                              const months = [
                                'Janvier',
                                'Février',
                                'Mars',
                                'Avril',
                                'Mai',
                                'Juin',
                                'Juillet',
                                'Août',
                                'Septembre',
                                'Octobre',
                                'Novembre',
                                'Décembre',
                              ];
                              const year = m[1];
                              const monthIndex = parseInt(m[2], 10) - 1;
                              const day = m[3];
                              const monthName = months[monthIndex] || '';
                              if (!monthName) return null;
                              return `${day} ${monthName} ${year}`;
                            };
                            const d = siretDetails;
                            const e =
                              d?.etablissement || d?.etablissements?.[0] || d;
                            const ul = d?.uniteLegale || e?.uniteLegale || null;
                            const denomination =
                              pick(ul?.denominationUniteLegale) ||
                              pick(ul?.denominationUsuelle1UniteLegale) ||
                              pick(ul?.denominationUsuelle2UniteLegale) ||
                              pick(ul?.denominationUsuelle3UniteLegale) ||
                              pick(e?.enseigne1Etablissement) ||
                              (pick(ul?.prenomUsuelUniteLegale) &&
                              pick(ul?.nomUniteLegale)
                                ? `${pick(ul?.prenomUsuelUniteLegale)} ${pick(ul?.nomUniteLegale)}`
                                : null);
                            const adr =
                              e?.adresseEtablissement ||
                              e?.adressePrincipaleEtablissement ||
                              null;
                            const line1 = [
                              pick(adr?.numeroVoieEtablissement),
                              pick(adr?.typeVoieEtablissement),
                              pick(adr?.libelleVoieEtablissement),
                              pick(adr?.complementAdresseEtablissement),
                            ]
                              .filter(Boolean)
                              .join(' ');
                            const city = [
                              pick(adr?.codePostalEtablissement),
                              pick(adr?.libelleCommuneEtablissement),
                            ]
                              .filter(Boolean)
                              .join(' ');
                            const hasName = !!denomination;
                            const hasAddress = !!line1 || !!city;
                            const hasSiren = !!pick(e?.siren);
                            const creationDateDisplay =
                              formatInseeDate(e?.dateCreationEtablissement) ||
                              formatInseeDate(ul?.dateCreationUniteLegale);
                            const hasDate = !!creationDateDisplay;
                            if (!hasName && !hasAddress) return null;
                            return (
                              <div className='mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700'>
                                <div className='flex items-center gap-2 mb-1 text-gray-800 font-medium'>
                                  <BadgeCheck className='w-4 h-4 text-green-600' />
                                  Données INSEE vérifiées
                                </div>
                                {hasName && (
                                  <div>
                                    <span className='text-gray-600'>
                                      Raison sociale:{' '}
                                    </span>
                                    <span className='font-medium'>
                                      {denomination}
                                    </span>
                                  </div>
                                )}
                                {hasSiren && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      SIREN:{' '}
                                    </span>
                                    <span className='font-medium'>
                                      {e?.siren}
                                    </span>
                                  </div>
                                )}
                                {hasDate && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      Date de création:{' '}
                                    </span>
                                    <span className='font-medium'>
                                      {creationDateDisplay}
                                    </span>
                                  </div>
                                )}
                                {hasAddress && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      Adresse:{' '}
                                    </span>
                                    <span className='font-medium'>
                                      {[line1, city]
                                        .filter(Boolean)
                                        .join(' — ')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          } else {
                            const data =
                              (siretDetails as any)?.data || siretDetails;
                            const name =
                              (data?.denomination as any) ||
                              (data?.abbreviation as any) ||
                              (data?.commercial_name as any) ||
                              (data?.branch_name as any) ||
                              '';
                            const address =
                              (data?.address?.full_address as any) || '';
                            const cbe =
                              (data?.cbe_number_formatted as any) ||
                              (data?.cbe_number as any) ||
                              '';
                            const start = (data?.start_date as any) || '';
                            const hasName = !!String(name).trim();
                            const hasAddress = !!String(address).trim();
                            const hasCbe = !!String(cbe).trim();
                            const hasStart = !!String(start).trim();
                            if (!hasName && !hasAddress) return null;
                            return (
                              <div className='mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700'>
                                <div className='flex items-center gap-2 mb-1 text-gray-800 font-medium'>
                                  <BadgeCheck className='w-4 h-4 text-green-600' />
                                  Données BCE vérifiées
                                </div>
                                {hasName && (
                                  <div>
                                    <span className='text-gray-600'>
                                      Raison sociale:{' '}
                                    </span>
                                    <span className='font-medium'>{name}</span>
                                  </div>
                                )}
                                {hasCbe && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      Numéro BCE:{' '}
                                    </span>
                                    <span className='font-medium'>{cbe}</span>
                                  </div>
                                )}
                                {hasStart && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      Date de début:{' '}
                                    </span>
                                    <span className='font-medium'>{start}</span>
                                  </div>
                                )}
                                {hasAddress && (
                                  <div className='mt-1'>
                                    <span className='text-gray-600'>
                                      Adresse:{' '}
                                    </span>
                                    <span className='font-medium'>
                                      {address}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          }
                        })()
                      : null}
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-2'>
                      Logo *
                    </label>
                    <div className='flex items-center space-x-4'>
                      <label
                        className={` border-gray-300 flex flex-col items-center justify-center w-40 h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100`}
                      >
                        <div className='flex flex-col items-center justify-center pt-5 pb-6'>
                          <Upload className='w-8 h-8 mb-2 text-gray-400' />
                          <p className='text-xs text-gray-500'>
                            Cliquez pour télécharger
                          </p>
                        </div>
                        <input
                          type='file'
                          className='hidden'
                          accept='image/png, image/jpeg'
                          onChange={handleLogoChange}
                        />
                      </label>
                      {(logoPreview ||
                        (() => {
                          const cloudBase = (
                            import.meta.env.VITE_CLOUDFRONT_URL ||
                            'https://d1tmgyvizond6e.cloudfront.net'
                          ).replace(/\/+$/, '');
                          return store?.id
                            ? `${cloudBase}/images/${store.id}`
                            : null;
                        })()) && (
                        <div className='w-32 h-32 border rounded-lg overflow-hidden'>
                          <img
                            src={
                              logoPreview ||
                              (() => {
                                const cloudBase = (
                                  import.meta.env.VITE_CLOUDFRONT_URL ||
                                  'https://d1tmgyvizond6e.cloudfront.net'
                                ).replace(/\/+$/, '');
                                return store?.id
                                  ? `${cloudBase}/images/${store.id}`
                                  : '';
                              })()
                            }
                            alt='Aperçu du logo'
                            className='w-full h-full object-cover'
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Adresse avec Stripe AddressElement */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-2'>
                      Adresse de la boutique *
                    </label>
                    <StripeWrapper>
                      <div
                        className={`rounded-md border ${!isAddressComplete ? 'border-red-500' : 'border-gray-300'} p-2`}
                      >
                        <AddressElement
                          key={store?.id || 'nostore'}
                          options={{
                            mode: 'billing',
                            allowedCountries: ['FR'],
                            fields: {
                              phone: 'always',
                            },
                            validation: {
                              phone: {
                                required: 'always',
                              },
                            },
                            defaultValues: {
                              name: name || '',
                              phone: formPhone || '',
                              address: {
                                line1:
                                  (billingAddress as any)?.line1 ||
                                  (store as any)?.address?.line1 ||
                                  '',
                                city:
                                  (billingAddress as any)?.city ||
                                  (store as any)?.address?.city ||
                                  '',
                                postal_code:
                                  (billingAddress as any)?.postal_code ||
                                  (store as any)?.address?.postal_code ||
                                  '',
                                country:
                                  (billingAddress as any)?.country ||
                                  (store as any)?.address?.country ||
                                  'FR',
                              },
                            },
                          }}
                          onChange={event => {
                            setIsAddressComplete(event.complete);
                            if (event.value.address) {
                              setBillingAddress(event.value.address as any);
                            }
                            if (event.value.phone) {
                              setFormPhone(event.value.phone as string);
                            }
                          }}
                        />
                      </div>
                      {!isAddressComplete && (
                        <p className='mt-2 text-sm text-red-600'>
                          Veuillez compléter votre adresse
                        </p>
                      )}
                    </StripeWrapper>
                  </div>

                  <div className='flex items-center space-x-2 flex-wrap'>
                    <button
                      onClick={saveStoreInfo}
                      disabled={
                        !name.trim() ||
                        !isAddressComplete ||
                        !formPhone.trim() ||
                        (website && websiteInvalid) ||
                        slugExists ||
                        isCheckingSlug ||
                        (siret ? siretInvalid || !!siretErrorMessage : false) ||
                        isCheckingSiret
                      }
                      className={`inline-flex items-center px-4 py-2 rounded-md text-white ${!name.trim() || !isAddressComplete || !formPhone.trim() || (website && websiteInvalid) || slugExists || isCheckingSlug || (siret ? siretInvalid || !!siretErrorMessage : false) || isCheckingSiret ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                      {isSubmittingModifications && (
                        <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                      )}
                      Enregistrer vos modifications
                    </button>
                    <button
                      onClick={() => {
                        setEditingInfo(false);
                        setLogoFile(null);
                        setLogoPreview(null);
                      }}
                      className='px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300'
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'carts' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-4'>
                <ShoppingCart className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>Panier</h2>
              </div>

              <p className='text-sm text-gray-600 mb-4'>
                Créez des paniers prêts à payer pour vos clients. Ils n'ont plus
                qu'à régler en un clic, sans saisir la référence ni le montant.
              </p>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Client
                  </label>
                  <input
                    type='text'
                    value={cartCustomerInput}
                    onChange={e => {
                      const v = e.target.value;
                      setCartCustomerInput(v);
                      searchClerkUsers(v);
                    }}
                    placeholder='Nom du client ou e-mail'
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                  {cartUsersLoading ? (
                    <div className='text-xs text-gray-600 mt-2'>Recherche…</div>
                  ) : cartCustomerResults.length > 0 ? (
                    <div className='mt-2 border border-gray-200 rounded-md max-h-48 overflow-auto bg-white'>
                      {cartCustomerResults.map(u => (
                        <button
                          key={u.id}
                          type='button'
                          onClick={() => {
                            setCartSelectedUser(u);
                            setCartCustomerInput(u.fullName);
                            setCartCustomerResults([]);
                          }}
                          className='w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between'
                        >
                          <span className='text-sm text-gray-800'>
                            {u.fullName}
                          </span>
                          <span className='text-xs text-gray-600'>
                            {u.email || ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {cartSelectedUser ? (
                    <div className='mt-2 text-xs text-gray-600'>
                      Sélectionné: {cartSelectedUser.fullName}{' '}
                      {cartSelectedUser.email
                        ? `(${cartSelectedUser.email})`
                        : ''}
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Référence
                  </label>
                  <div className='relative'>
                    <input
                      type='text'
                      value={cartReference}
                      onChange={e => {
                        const v = e.target.value;
                        setCartSelectedStockItem(null);
                        setCartReference(v);
                        setCartDescription('');
                        setCartWeightKg('');
                        setCartAmountEuro('');
                        setCartQuantity('1');
                        setCartStockSuggestionsOpen(
                          Boolean(String(v || '').trim())
                        );
                      }}
                      onFocus={() => {
                        if (cartStockSuggestions.length > 0)
                          setCartStockSuggestionsOpen(true);
                      }}
                      onBlur={() => {
                        setTimeout(
                          () => setCartStockSuggestionsOpen(false),
                          150
                        );
                      }}
                      placeholder='Ex: REF-001'
                      className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                    />
                    {cartStockSuggestionsOpen &&
                    (cartStockSuggestionsLoading ||
                      cartStockSuggestions.length > 0) ? (
                      <div className='absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden'>
                        {cartStockSuggestionsLoading ? (
                          <div className='px-3 py-2 text-sm text-gray-500'>
                            Recherche…
                          </div>
                        ) : null}
                        {cartStockSuggestions.map((s: any, idx: number) => {
                          const stock = s?.stock || {};
                          const product = s?.product || null;
                          const ref = String(
                            stock?.product_reference || ''
                          ).trim();
                          const qty = Number(stock?.quantity ?? 0);
                          const disabled = Number.isFinite(qty) && qty <= 0;
                          const title = String(
                            product?.name || ref || ''
                          ).trim();
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
                                applyCartSuggestion(s);
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
                                  {price !== null
                                    ? ` • ${price.toFixed(2)} €`
                                    : ''}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className='space-y-2'>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-1'>
                      Description
                    </label>
                    <input
                      type='text'
                      value={cartDescription}
                      onChange={e => setCartDescription(e.target.value)}
                      placeholder='Ex: Robe Noire'
                      required
                      disabled={Boolean(cartSelectedStockItem)}
                      className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-600'
                    />
                  </div>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-1'>
                      Poids (kg)
                    </label>
                    <input
                      type='number'
                      min='0'
                      step='0.01'
                      value={cartWeightKg}
                      onChange={e => setCartWeightKg(e.target.value)}
                      placeholder='0.5'
                      required
                      disabled={Boolean(cartSelectedStockItem)}
                      className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-600'
                    />
                  </div>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Prix unitaire (€)
                  </label>
                  <div className='space-y-2'>
                    <input
                      type='number'
                      min='0.01'
                      step='0.01'
                      value={cartAmountEuro}
                      onChange={e => setCartAmountEuro(e.target.value)}
                      placeholder='Ex: 49.90'
                      disabled={Boolean(cartSelectedStockItem)}
                      className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-600'
                    />
                    <div>
                      <label className='block text-sm font-medium text-gray-700 mb-1'>
                        Quantité
                      </label>
                      <input
                        type='number'
                        min='1'
                        step='1'
                        value={cartQuantity}
                        onChange={e => setCartQuantity(e.target.value)}
                        placeholder='1'
                        disabled={Boolean(cartSelectedStockItem)}
                        className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-600'
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className='flex items-center gap-3 mb-6'>
                <button
                  onClick={handleCreateCart}
                  disabled={
                    cartCreating ||
                    !cartSelectedUser ||
                    !(cartReference || '').trim() ||
                    !(cartDescription || '').trim() ||
                    !(
                      parseFloat((cartAmountEuro || '').replace(',', '.')) > 0
                    ) ||
                    (() => {
                      const q = parseInt((cartQuantity || '').trim(), 10);
                      return !(Number.isFinite(q) && q > 0);
                    })() ||
                    (() => {
                      const w = parseFloat(
                        (cartWeightKg || '').trim().replace(',', '.')
                      );
                      return !(Number.isFinite(w) && w >= 0);
                    })()
                  }
                  className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                >
                  {cartCreating && (
                    <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                  )}
                  <span>Ajouter au panier</span>
                </button>
              </div>

              <div className='mb-3'></div>

              {(() => {
                const groupsMap: Record<string, any[]> = {};
                (storeCarts || []).forEach((c: any) => {
                  const key = String(c.customer_stripe_id || '');
                  if (!groupsMap[key]) groupsMap[key] = [];
                  groupsMap[key].push(c);
                });
                const groups = Object.entries(groupsMap).map(
                  ([stripeId, items]) => {
                    const user = clerkUsersByStripeId[stripeId] || null;
                    return { stripeId, user, items };
                  }
                );
                const filtered = groups.filter(g => {
                  const term = (cartSearchTerm || '').trim().toLowerCase();
                  if (!term) return true;
                  if (cartsFilterField === 'reference') {
                    return (g.items || []).some((it: any) =>
                      String(it?.product_reference || '')
                        .toLowerCase()
                        .includes(term)
                    );
                  }
                  if (cartsFilterField === 'description') {
                    return (g.items || []).some((it: any) =>
                      String(it?.description || '')
                        .toLowerCase()
                        .includes(term)
                    );
                  }
                  const name = String(g.user?.fullName || '').toLowerCase();
                  const email = String(g.user?.email || '').toLowerCase();
                  return name.includes(term) || email.includes(term);
                });
                const totalGroups = filtered.length;
                const totalPages = Math.max(
                  1,
                  Math.ceil(totalGroups / cartPageSize)
                );
                const page = Math.min(cartPage, totalPages);
                const start = (page - 1) * cartPageSize;
                const pageGroups = filtered.slice(start, start + cartPageSize);
                const allSelected =
                  selectedCartGroupIds.size > 0 &&
                  filtered.every(g => selectedCartGroupIds.has(g.stripeId));

                return (
                  <div className='space-y-6'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <div>
                        <div className='inline-flex items-center gap-2 text-sm text-gray-700'>
                          <input
                            type='checkbox'
                            className='w-4 h-4 accent-blue-600'
                            checked={allSelected}
                            onChange={() => {
                              if (allSelected) {
                                setSelectedCartGroupIds(new Set());
                              } else {
                                setSelectedCartGroupIds(
                                  new Set(filtered.map(g => g.stripeId))
                                );
                              }
                            }}
                          />
                          <span>Sélectionner tout</span>
                        </div>
                        <div className='text-xs text-gray-600 mt-1'>
                          {selectedCartGroupIds.size}{' '}
                          {selectedCartGroupIds.size > 1
                            ? 'paniers sélectionnés'
                            : 'panier sélectionné'}
                        </div>
                      </div>

                      <button
                        onClick={handleSendRecap}
                        disabled={
                          selectedCartGroupIds.size === 0 || sendingRecap
                        }
                        className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                          selectedCartGroupIds.size === 0 || sendingRecap
                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                        title='Envoyer le récapitulatif'
                      >
                        {sendingRecap ? (
                          <span className='inline-flex items-center'>
                            <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent'></span>
                            Envoi…
                          </span>
                        ) : (
                          <span>Envoyer le récapitulatif</span>
                        )}
                      </button>

                      <span className='text-sm text-gray-700'>Filtrer par</span>
                      <select
                        value={cartsFilterField}
                        onChange={e => {
                          const v = e.target.value as
                            | 'reference'
                            | 'client'
                            | 'description';
                          setCartsFilterField(v);
                          setCartPage(1);
                        }}
                        className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                      >
                        <option value='reference'>Référence</option>
                        <option value='client'>Client</option>
                        <option value='description'>Description</option>
                      </select>
                      <input
                        type='text'
                        value={cartSearchTerm}
                        onChange={e => {
                          setCartSearchTerm(e.target.value);
                          setCartPage(1);
                        }}
                        placeholder='Saisir…'
                        className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 sm:w-56'
                      />
                      <button
                        onClick={handleReloadCarts}
                        disabled={cartReloading}
                        className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                        title='Recharger'
                      >
                        <RefreshCw
                          className={`w-4 h-4 mr-1 ${cartReloading ? 'animate-spin' : ''}`}
                        />
                        <span>Recharger</span>
                      </button>
                    </div>
                    {pageGroups.length === 0 ? (
                      <div className='text-sm text-gray-600'>Aucun panier</div>
                    ) : (
                      pageGroups.map(g => (
                        <div
                          key={g.stripeId}
                          className='border border-gray-200 rounded-md'
                        >
                          <div className='flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200'>
                            <div className='flex items-center gap-3'>
                              <input
                                type='checkbox'
                                className='w-4 h-4 accent-blue-600'
                                checked={selectedCartGroupIds.has(g.stripeId)}
                                onChange={() => {
                                  setSelectedCartGroupIds(prev => {
                                    const next = new Set([...prev]);
                                    if (next.has(g.stripeId)) {
                                      next.delete(g.stripeId);
                                    } else {
                                      next.add(g.stripeId);
                                    }
                                    return next;
                                  });
                                }}
                                aria-label='Sélectionner ce panier'
                              />
                              {g.user?.hasImage && g.user?.imageUrl ? (
                                <img
                                  src={g.user.imageUrl}
                                  alt={g.user.fullName || 'Client'}
                                  className='w-8 h-8 rounded-full object-cover'
                                />
                              ) : (
                                <div className='w-8 h-8 rounded-full bg-gray-300'></div>
                              )}
                              <div>
                                <div className='flex items-center gap-2 text-gray-900 font-semibold text-sm'>
                                  <span>
                                    {g.user?.fullName || g.stripeId || 'Client'}
                                  </span>
                                  {recapSentByGroup[g.stripeId] && (
                                    <span className='inline-flex items-center text-green-600 text-xs font-medium'>
                                      <Check className='w-4 h-4 mr-1' />
                                      {(() => {
                                        const rel = formatRelativeSent(
                                          recapSentAtByGroup[g.stripeId]
                                        );
                                        return rel
                                          ? `recap envoyé · ${rel}`
                                          : 'recap envoyé';
                                      })()}
                                    </span>
                                  )}
                                </div>
                                <div className='text-xs text-gray-600'>
                                  {g.user?.email || ''}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className='overflow-x-auto'>
                            <table className='min-w-full divide-y divide-gray-200 text-sm'>
                              <thead className='bg-white'>
                                <tr>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Référence
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Description
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Prix unitaire (€)
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Quantité
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Total (€)
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Poids (kg)
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Créé
                                  </th>
                                  <th className='px-4 py-2 text-left font-medium text-gray-700'>
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className='bg-white divide-y divide-gray-200'>
                                {(() => {
                                  const gid = g.stripeId;
                                  const size = cartGroupPageSize[gid] ?? 10;
                                  const page = cartGroupPage[gid] ?? 1;
                                  const start = (page - 1) * size;
                                  const items = g.items.slice(
                                    start,
                                    start + size
                                  );
                                  return items.map((c: any) => (
                                    <tr key={c.id}>
                                      <td className='px-4 py-3 text-gray-900 font-medium'>
                                        {c.product_reference || '—'}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {c.description || '—'}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {typeof c.value === 'number'
                                          ? c.value.toLocaleString('fr-FR', {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                            })
                                          : '—'}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {Number.isFinite(Number(c.quantity))
                                          ? Number(c.quantity)
                                          : 1}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {(() => {
                                          const unit = Number(c.value);
                                          const qty = Number(c.quantity);
                                          if (
                                            !Number.isFinite(unit) ||
                                            !Number.isFinite(qty)
                                          ) {
                                            return '—';
                                          }
                                          const total = unit * qty;
                                          return total.toLocaleString('fr-FR', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          });
                                        })()}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {Number.isFinite(Number(c.weight))
                                          ? Number(c.weight).toLocaleString(
                                              'fr-FR',
                                              {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              }
                                            )
                                          : '—'}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        {c.created_at
                                          ? new Date(
                                              c.created_at
                                            ).toLocaleString('fr-FR', {
                                              dateStyle: 'short',
                                              timeStyle: 'short',
                                            })
                                          : '—'}
                                      </td>
                                      <td className='px-4 py-3 text-gray-700'>
                                        <button
                                          onClick={() => handleDeleteCart(c.id)}
                                          disabled={!!cartDeletingIds[c.id]}
                                          className={`inline-flex items-center p-2 rounded-md border ${cartDeletingIds[c.id] ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-700 border-gray-300'}`}
                                          title={'Supprimer'}
                                        >
                                          <Trash2
                                            className={`w-4 h-4 ${cartDeletingIds[c.id] ? 'opacity-60' : ''}`}
                                          />
                                          <span className='ml-1'>
                                            Supprimer
                                          </span>
                                        </button>
                                      </td>
                                    </tr>
                                  ));
                                })()}
                              </tbody>
                            </table>
                            {(() => {
                              const gid = g.stripeId;
                              const size = cartGroupPageSize[gid] ?? 10;
                              const page = cartGroupPage[gid] ?? 1;
                              const totalPages = Math.max(
                                1,
                                Math.ceil(g.items.length / size)
                              );
                              return (
                                <div className='flex items-center justify-end gap-2 p-3'>
                                  <div className='hidden sm:flex items-center space-x-3'>
                                    <div className='text-sm text-gray-600'>
                                      Page {page} / {totalPages} —{' '}
                                      {g.items.length}
                                    </div>
                                    <label className='text-sm text-gray-700'>
                                      Lignes
                                    </label>
                                    <select
                                      value={size}
                                      onChange={e => {
                                        const v = parseInt(e.target.value, 10);
                                        setCartGroupPageSize(prev => ({
                                          ...prev,
                                          [gid]: isNaN(v) ? 10 : v,
                                        }));
                                        setCartGroupPage(prev => ({
                                          ...prev,
                                          [gid]: 1,
                                        }));
                                      }}
                                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                                    >
                                      <option value={5}>5</option>
                                      <option value={10}>10</option>
                                      <option value={20}>20</option>
                                    </select>
                                    <div className='flex items-center space-x-2'>
                                      <button
                                        onClick={() =>
                                          setCartGroupPage(prev => ({
                                            ...prev,
                                            [gid]: Math.max(1, page - 1),
                                          }))
                                        }
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
                                        onClick={() =>
                                          setCartGroupPage(prev => ({
                                            ...prev,
                                            [gid]: Math.min(
                                              totalPages,
                                              page + 1
                                            ),
                                          }))
                                        }
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
                              );
                            })()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {/* Section Porte-monnaie */}
          {section === 'wallet' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-4'>
                <Wallet className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>
                  Porte-monnaie
                </h2>
              </div>
              <p className='text-gray-600 mb-2'>
                Montant accumulé suite aux achats des clients.
              </p>
              <div className='flex items-baseline space-x-2 mb-4'>
                <span className='text-2xl font-bold text-gray-900'>
                  {Number(walletTransactionsTotalNet || 0).toFixed(2)}
                </span>
                <span className='text-gray-700'>€ total net</span>
              </div>
              {/* Bouton qui révèle la section Demande de versement */}
              {store && (
                <div>
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3'>
                    <div>
                      <label className='block text-sm text-gray-700 mb-1'>
                        IBAN
                      </label>
                      <input
                        className={`w-full border rounded px-3 py-2 text-sm ${ibanError ? 'border-red-500' : 'border-gray-300'}`}
                        value={ibanInput}
                        onChange={e => {
                          setIbanInput(e.target.value);
                          if (ibanError) setIbanError(null);
                        }}
                        placeholder='FR76 3000 6000 0112 3456 7890 189'
                      />
                      {ibanError && (
                        <p className='mt-1 text-xs text-red-600'>{ibanError}</p>
                      )}
                    </div>
                    <div>
                      <label className='block text-sm text-gray-700 mb-1'>
                        BIC
                      </label>
                      <input
                        className={`w-full border rounded px-3 py-2 text-sm ${bicError ? 'border-red-500' : 'border-gray-300'}`}
                        value={bicInput}
                        onChange={e => {
                          setBicInput(e.target.value);
                          if (bicError) setBicError(null);
                        }}
                        placeholder='AGRIFRPPXXX'
                      />
                      {bicError && (
                        <p className='mt-1 text-xs text-red-600'>{bicError}</p>
                      )}
                    </div>
                  </div>
                  <div className='mt-4 flex items-center space-x-2'>
                    <button
                      onClick={confirmPayout}
                      className={`inline-flex items-center px-4 py-2 rounded-md text-white ${
                        isSubmittingPayout ||
                        !ibanInput.trim() ||
                        !bicInput.trim() ||
                        Boolean(ibanError) ||
                        Boolean(bicError)
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700'
                      }`}
                      disabled={
                        isSubmittingPayout ||
                        !ibanInput.trim() ||
                        !bicInput.trim() ||
                        Boolean(ibanError) ||
                        Boolean(bicError)
                      }
                    >
                      {isSubmittingPayout && (
                        <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                      )}
                      <HandCoins className='w-5 h-5 mr-2' />
                      Retirer mes gains
                    </button>
                  </div>
                </div>
              )}

              <div className='mt-8'>
                <div className='flex items-center justify-between mb-3'>
                  <h3 className='text-base font-semibold text-gray-900'>
                    Transactions
                  </h3>
                </div>

                <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3'>
                  <div className='flex items-center gap-2'>
                    <label className='text-sm text-gray-700'>
                      Lignes / page
                    </label>
                    <select
                      value={walletTablePageSize}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setWalletTablePageSize(Number.isFinite(v) ? v : 10);
                        setWalletTablePage(1);
                      }}
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm'
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <button
                      onClick={() => fetchWalletTransactions().catch(() => {})}
                      disabled={walletTransactionsLoading}
                      className='inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400'
                    >
                      <RefreshCw
                        className={`w-4 h-4 mr-1 ${walletTransactionsLoading ? 'animate-spin' : ''}`}
                      />
                      <span>Recharger</span>
                    </button>
                  </div>
                </div>

                {walletTransactionsTotalCount > 0 ? (
                  <div className='text-xs text-gray-500 mb-2'>
                    Affichage de {walletTransactions.length} sur{' '}
                    {walletTransactionsTotalCount} transactions
                  </div>
                ) : null}

                {walletTransactionsLoading ? (
                  <div className='flex items-center justify-center py-10'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600'></div>
                  </div>
                ) : walletTransactions.length === 0 ? (
                  <div className='text-sm text-gray-600'>
                    Aucune transaction trouvée.
                  </div>
                ) : (
                  <>
                    <div className='overflow-x-auto border border-gray-200 rounded-lg'>
                      <table className='min-w-full text-sm'>
                        <thead className='bg-gray-50'>
                          <tr className='border-b border-gray-200'>
                            <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                              Date
                            </th>
                            <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                              Client
                            </th>
                            <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                              Articles
                            </th>
                            <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                              Livraison
                            </th>
                            <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                              Total
                            </th>
                            <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                              Remboursé
                            </th>
                            <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                              Écart livraison
                            </th>
                            <th className='text-right py-3 px-4 font-semibold text-gray-700'>
                              Net
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleWalletTransactions.map(tx => {
                            const customerName = String(
                              tx?.customer?.name || ''
                            ).trim();
                            const customerEmail = String(
                              tx?.customer?.email || ''
                            ).trim();
                            const customerLabel =
                              customerName || customerEmail || '—';

                            return (
                              <tr
                                key={tx.payment_id}
                                className='border-b border-gray-100 hover:bg-gray-50'
                              >
                                <td className='py-3 px-4 text-gray-700 whitespace-nowrap'>
                                  <div>{formatDateEpoch(tx.created)}</div>
                                  {tx.status &&
                                  String(tx.status || '').toLowerCase() !==
                                    'paid' ? (
                                    <div className='text-xs text-gray-500'>
                                      {tx.status}
                                    </div>
                                  ) : null}
                                </td>
                                <td className='py-3 px-4 text-gray-700'>
                                  <div className='font-medium text-gray-900'>
                                    {customerLabel}
                                  </div>
                                  {customerName && customerEmail ? (
                                    <div className='text-xs text-gray-500'>
                                      {customerEmail}
                                    </div>
                                  ) : null}
                                </td>
                                <td className='py-3 px-4 text-gray-700'>
                                  <div className='space-y-1'>
                                    {(tx.items || []).map((it, idx) => (
                                      <div key={`${tx.payment_id}-it-${idx}`}>
                                        <span className='font-medium text-gray-900'>
                                          {it.reference}
                                        </span>{' '}
                                        <span className='text-gray-600'>
                                          ×{Number(it.quantity || 1)}
                                        </span>{' '}
                                        <span className='text-gray-600'>
                                          ({formatValue(it.unit_price)})
                                        </span>{' '}
                                        <span className='text-gray-900'>
                                          {formatValue(it.line_total)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className='py-3 px-4 text-right text-gray-900 whitespace-nowrap'>
                                  {formatValue(tx.shipping_fee)}
                                </td>
                                <td className='py-3 px-4 text-right text-gray-900 font-semibold whitespace-nowrap'>
                                  {formatValue(tx.total)}
                                </td>
                                <td className='py-3 px-4 text-right whitespace-nowrap'>
                                  <span
                                    className={
                                      (tx.refunded_total || 0) > 0
                                        ? 'text-red-600 font-semibold'
                                        : 'text-gray-900'
                                    }
                                  >
                                    {formatValue(tx.refunded_total)}
                                  </span>
                                </td>
                                <td className='py-3 px-4 text-right text-red-600 font-semibold whitespace-nowrap'>
                                  {Number(tx.delivery_gap || 0) < 0
                                    ? formatValue(Number(tx.delivery_gap || 0))
                                    : '0'}
                                </td>
                                <td className='py-3 px-4 text-right text-gray-900 font-semibold whitespace-nowrap'>
                                  {formatValue(tx.net_total)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className='flex items-center justify-between mt-3'>
                      <div className='text-xs text-gray-600'>
                        Page {walletTablePage} / {walletTableTotalPages}
                      </div>
                      <div className='flex items-center gap-2'>
                        <button
                          onClick={() =>
                            setWalletTablePage(p => Math.max(1, p - 1))
                          }
                          disabled={walletTablePage <= 1}
                          className={`px-3 py-1 text-sm rounded-md border ${
                            walletTablePage <= 1
                              ? 'bg-gray-100 text-gray-400 border-gray-200'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          Précédent
                        </button>
                        <button
                          onClick={() =>
                            setWalletTablePage(p =>
                              Math.min(walletTableTotalPages, p + 1)
                            )
                          }
                          disabled={walletTablePage >= walletTableTotalPages}
                          className={`px-3 py-1 text-sm rounded-md border ${
                            walletTablePage >= walletTableTotalPages
                              ? 'bg-gray-100 text-gray-400 border-gray-200'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          Suivant
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {section === 'stock' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-4'>
                <FaArchive className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>Stock</h2>
              </div>

              <form onSubmit={handleSubmitStockProduct} className='space-y-4'>
                <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
                  <div className='space-y-3'>
                    <div>
                      <label className='block text-sm font-medium text-gray-700 mb-1'>
                        Titre
                      </label>
                      <input
                        type='text'
                        value={stockTitle}
                        onChange={e => setStockTitle(e.target.value)}
                        className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                        required
                      />
                    </div>

                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                      <div>
                        <label className='block text-xs font-medium text-gray-700 mb-1'>
                          Référence
                        </label>
                        <input
                          type='text'
                          value={stockReference}
                          onChange={e => setStockReference(e.target.value)}
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                          required
                        />
                      </div>
                      <div>
                        <label className='block text-xs font-medium text-gray-700 mb-1'>
                          Quantité
                        </label>
                        <input
                          type='number'
                          min={1}
                          step={1}
                          value={stockQuantity}
                          onChange={e => setStockQuantity(e.target.value)}
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                          required
                        />
                      </div>
                    </div>

                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                      <div>
                        <label className='block text-xs font-medium text-gray-700 mb-1'>
                          Poids (kg)
                        </label>
                        <input
                          type='number'
                          step='0.001'
                          min='0'
                          value={stockWeight}
                          onChange={e => setStockWeight(e.target.value)}
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                          placeholder='0,5'
                          required
                        />
                      </div>
                      <div>
                        <label className='block text-xs font-medium text-gray-700 mb-1'>
                          Prix (€)
                        </label>
                        <input
                          type='number'
                          value={stockPrice}
                          onChange={e => setStockPrice(e.target.value)}
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                          placeholder='12,90'
                          step='0.01'
                          min='0.01'
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className='block text-sm font-medium text-gray-700 mb-1'>
                        Description
                      </label>
                      <textarea
                        value={stockDescription}
                        onChange={e => setStockDescription(e.target.value)}
                        className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                        rows={2}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-1'>
                      Image
                    </label>
                    <div className='flex items-center space-x-4'>
                      <div className='flex-1'>
                        <label className='flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100'>
                          <div className='flex flex-col items-center justify-center pt-5 pb-6'>
                            <Upload className='w-8 h-8 mb-2 text-gray-400' />
                            <p className='text-sm text-gray-500'>
                              Cliquez pour télécharger une image
                            </p>
                            <p className='text-xs text-gray-400 mt-1'>
                              JPEG, PNG ou WEBP — 2 Mo max
                            </p>
                          </div>
                          <input
                            type='file'
                            className='hidden'
                            accept='image/jpeg,image/png,image/webp'
                            onChange={handleStockImageChange}
                          />
                        </label>
                      </div>
                      {stockImagePreview ? (
                        <div className='w-32 h-32 border rounded-lg overflow-hidden relative'>
                          <img
                            src={stockImagePreview}
                            alt='Aperçu'
                            className='w-full h-full object-cover'
                          />
                          <button
                            type='button'
                            onClick={() => {
                              setStockImageFile(null);
                              setStockImagePreview(null);
                            }}
                            className='absolute top-2 right-2 inline-flex items-center px-2 py-1 text-xs rounded-md border border-gray-200 bg-white/90 text-gray-700 hover:bg-white'
                          >
                            Retirer
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className='mt-3'>
                      <label className='block text-sm font-medium text-gray-700 mb-1'>
                        Images (URL)
                      </label>
                      <div className='flex items-center gap-2'>
                        <input
                          type='url'
                          value={stockImageUrlInput}
                          onChange={e => setStockImageUrlInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addStockImageUrl();
                            }
                          }}
                          className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                          placeholder='https://...'
                        />
                        <button
                          type='button'
                          onClick={addStockImageUrl}
                          className='inline-flex items-center px-3 py-2 rounded-md text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        >
                          Ajouter
                        </button>
                      </div>
                      {stockImageUrls.length > 0 ? (
                        <div className='mt-2 flex flex-wrap gap-2'>
                          {stockImageUrls.map(url => (
                            <div
                              key={url}
                              className='relative w-14 h-14 rounded-md border border-gray-200 bg-gray-50 overflow-hidden'
                              title={url}
                            >
                              <img
                                src={url}
                                alt='Aperçu'
                                className='w-full h-full object-cover'
                              />
                              <button
                                type='button'
                                onClick={() => removeStockImageUrl(url)}
                                className='absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 border border-gray-200 text-gray-700 text-xs flex items-center justify-center hover:bg-white'
                                aria-label='Retirer'
                                title='Retirer'
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className='flex items-center gap-2'>
                  <button
                    type='submit'
                    className='inline-flex items-center px-4 py-2 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
                    disabled={
                      stockCreating ||
                      (!editingStockId
                        ? !stockImageFile
                        : !stockImagePreview) ||
                      !stockTitle.trim() ||
                      !stockReference.trim() ||
                      !stockDescription.trim() ||
                      !String(stockQuantity || '').trim() ||
                      !String(stockWeight || '').trim() ||
                      !String(stockPrice || '').trim()
                    }
                  >
                    {stockCreating && (
                      <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                    )}
                    {editingStockId
                      ? 'Modifier le produit'
                      : 'Créer le produit'}
                  </button>
                  {editingStockId ? (
                    <button
                      type='button'
                      onClick={() => {
                        setEditingStockId(null);
                        resetStockForm();
                      }}
                      className='inline-flex items-center px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      disabled={stockCreating}
                    >
                      Annuler
                    </button>
                  ) : null}
                </div>
              </form>

              <div className='mt-8'>
                <h3 className='text-base font-semibold text-gray-900 mb-3'>
                  Produits en stock
                </h3>

                {stockLoading ? (
                  <div className='flex items-center justify-center py-10'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600'></div>
                  </div>
                ) : stockItems.length === 0 ? (
                  <div className='text-sm text-gray-600'>
                    Aucun produit en stock.
                  </div>
                ) : (
                  <>
                    <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                      <div className='flex items-center gap-3'>
                        <input
                          type='checkbox'
                          checked={allVisibleStockSelected}
                          onChange={toggleSelectAllVisibleStock}
                          className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer'
                        />
                        <div className='text-sm text-gray-700'>
                          Tout sélectionner
                        </div>
                        <div className='text-sm text-gray-600'>
                          — {selectedStockIds.size} sélectionné
                          {selectedStockIds.size > 1 ? 's' : ''}
                        </div>
                        <button
                          type='button'
                          onClick={handleBulkDeleteSelectedStock}
                          disabled={selectedStockIds.size === 0}
                          className='inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400'
                        >
                          <span>Supprimer</span>
                        </button>
                      </div>
                    </div>

                    <div className='mb-4 flex flex-wrap items-center gap-2'>
                      <button
                        type='button'
                        onClick={() =>
                          fetchStockProducts({
                            silent: true,
                            background: true,
                          }).catch(() => {})
                        }
                        disabled={stockLoading || stockReloading}
                        className='inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400'
                      >
                        <RefreshCw
                          className={`w-4 h-4 mr-1 ${
                            stockReloading ? 'animate-spin' : ''
                          }`}
                        />
                        <span>Recharger</span>
                      </button>
                      <div className='flex items-center space-x-2 flex-wrap'>
                        <span className='text-sm text-gray-700'>
                          Filtrer par
                        </span>
                        <select
                          value={stockFilterField}
                          onChange={e => {
                            const v = e.target.value as
                              | 'reference'
                              | 'titre'
                              | 'description';
                            setStockFilterField(v);
                            setStockPage(1);
                          }}
                          className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                        >
                          <option value='reference'>Référence</option>
                          <option value='titre'>Titre</option>
                          <option value='description'>Description</option>
                        </select>
                        <input
                          type='text'
                          value={stockFilterTerm}
                          onChange={e => {
                            setStockFilterTerm(e.target.value);
                            setStockPage(1);
                          }}
                          placeholder='Saisir…'
                          className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                        />
                      </div>
                    </div>

                    {filteredStockItems.length === 0 ? (
                      <div className='text-sm text-gray-600'>
                        Aucun résultat.
                      </div>
                    ) : (
                      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
                        {visibleStockItems.map((it, idx) => {
                          const stock = it?.stock;
                          const d = getStockDisplay(it, idx);

                          const activeIndex = Math.max(
                            0,
                            stockCardImageIndex[d.idKey] || 0
                          );
                          const hasImages = d.imageUrls.length > 0;
                          const currentImage = hasImages
                            ? d.imageUrls[activeIndex % d.imageUrls.length]
                            : '';

                          const isSelected = selectedStockIds.has(
                            Number(d.stockId)
                          );

                          return (
                            <div
                              key={d.idKey}
                              className='rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden'
                            >
                              <div className='p-4 flex gap-4'>
                                <div className='w-28 shrink-0'>
                                  <div className='relative w-full aspect-[3/4] rounded-md bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center'>
                                    {currentImage ? (
                                      <img
                                        src={currentImage}
                                        alt={d.title}
                                        className='w-full h-full object-cover'
                                      />
                                    ) : (
                                      <FaArchive className='w-10 h-10 text-gray-300' />
                                    )}

                                    {d.hasStockImages &&
                                    d.imageUrls.length > 1 ? (
                                      <>
                                        <button
                                          type='button'
                                          onClick={() => {
                                            const total = d.imageUrls.length;
                                            setStockCardImageIndex(prev => ({
                                              ...prev,
                                              [d.idKey]:
                                                (activeIndex - 1 + total) %
                                                total,
                                            }));
                                          }}
                                          className='absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center hover:bg-white'
                                          title='Précédent'
                                        >
                                          <ArrowRight className='w-4 h-4 text-gray-700 rotate-180' />
                                        </button>
                                        <button
                                          type='button'
                                          onClick={() => {
                                            const total = d.imageUrls.length;
                                            setStockCardImageIndex(prev => ({
                                              ...prev,
                                              [d.idKey]:
                                                (activeIndex + 1) % total,
                                            }));
                                          }}
                                          className='absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/90 border border-gray-200 flex items-center justify-center hover:bg-white'
                                          title='Suivant'
                                        >
                                          <ArrowRight className='w-4 h-4 text-gray-700' />
                                        </button>
                                        <div className='absolute bottom-1 left-0 right-0 flex items-center justify-center gap-1'>
                                          {d.imageUrls.map((_, i) => (
                                            <div
                                              key={`${d.idKey}-dot-${i}`}
                                              className={`h-1.5 w-1.5 rounded-full ${
                                                i ===
                                                activeIndex % d.imageUrls.length
                                                  ? 'bg-indigo-600'
                                                  : 'bg-white/70 border border-gray-200'
                                              }`}
                                            />
                                          ))}
                                        </div>
                                      </>
                                    ) : null}
                                  </div>
                                </div>

                                <div className='min-w-0 flex-1'>
                                  <div className='flex items-start justify-between gap-3'>
                                    <div className='min-w-0'>
                                      <div className='flex items-start gap-3'>
                                        <input
                                          type='checkbox'
                                          checked={isSelected}
                                          onChange={() =>
                                            toggleStockSelected(
                                              Number(d.stockId)
                                            )
                                          }
                                          className='mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer'
                                        />
                                        <div className='min-w-0'>
                                          <div className='text-sm font-semibold text-gray-900 truncate'>
                                            {d.title}
                                          </div>
                                          <div className='mt-1 text-xs text-gray-500 truncate'>
                                            Réf:{' '}
                                            <span className='text-gray-700'>
                                              {d.ref}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    <div className='text-right shrink-0'>
                                      <div className='text-xs text-gray-500'>
                                        Qté
                                      </div>
                                      <div className='text-sm font-semibold text-gray-900'>
                                        {d.qtyLabel}
                                      </div>
                                      {Number(d.qtyLabel || 0) <= 0 ? (
                                        <div className='mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200'>
                                          Épuisé
                                        </div>
                                      ) : (
                                        <div className='mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200'>
                                          Disponible
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {d.description ? (
                                    <div className='mt-3 text-xs text-gray-600 line-clamp-3'>
                                      {d.description}
                                    </div>
                                  ) : null}

                                  <div className='mt-3 grid grid-cols-3 gap-2 text-xs'>
                                    <div className='rounded-md bg-gray-50 border border-gray-100 p-2'>
                                      <div className='text-gray-500'>Poids</div>
                                      <div className='text-gray-900 font-medium'>
                                        {d.weightLabel || '—'}
                                      </div>
                                    </div>
                                    <div className='rounded-md bg-gray-50 border border-gray-100 p-2'>
                                      <div className='text-gray-500'>Prix</div>
                                      <div className='text-gray-900 font-medium'>
                                        {d.priceEur == null
                                          ? '—'
                                          : formatValue(d.priceEur)}
                                      </div>
                                    </div>
                                    <div className='rounded-md bg-gray-50 border border-gray-100 p-2'>
                                      <div className='text-gray-500'>
                                        Acheté
                                      </div>
                                      <div className='text-gray-900 font-medium'>
                                        {d.boughtCount}
                                      </div>
                                    </div>
                                  </div>

                                  <div className='mt-3 flex items-center justify-between gap-2'>
                                    <div className='text-xs text-gray-500'>
                                      Créé: {formatDate(stock?.created_at)}
                                    </div>
                                    <div className='flex items-center gap-2'>
                                      <button
                                        type='button'
                                        onClick={() =>
                                          startEditStockProduct(it, idx)
                                        }
                                        className='inline-flex items-center px-3 py-1.5 rounded-md text-xs border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                      >
                                        <Pencil className='w-3.5 h-3.5 mr-1' />
                                        Modifier
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className='mt-4 flex flex-wrap items-center justify-between gap-2'>
                      <div className='flex items-center gap-2'>
                        <label className='text-sm text-gray-700'>Cartes</label>
                        <select
                          value={stockPageSize}
                          onChange={e => {
                            const v = parseInt(e.target.value, 10);
                            setStockPageSize(Number.isFinite(v) ? v : 12);
                            setStockPage(1);
                          }}
                          className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-28'
                        >
                          <option value={6}>6</option>
                          <option value={12}>12</option>
                          <option value={24}>24</option>
                          <option value={48}>48</option>
                        </select>
                      </div>

                      <div className='flex flex-wrap items-center gap-2'>
                        <div className='text-sm text-gray-600'>
                          Page {stockPage} / {stockTotalPages} —{' '}
                          {filteredStockItems.length} produit
                          {filteredStockItems.length > 1 ? 's' : ''}
                        </div>
                        <div className='flex items-center space-x-2'>
                          <button
                            onClick={() =>
                              setStockPage(p => Math.max(1, p - 1))
                            }
                            disabled={stockPage <= 1}
                            className={`px-3 py-1 text-sm rounded-md border ${
                              stockPage <= 1
                                ? 'bg-gray-100 text-gray-400 border-gray-200'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Précédent
                          </button>
                          <button
                            onClick={() =>
                              setStockPage(p =>
                                Math.min(stockTotalPages, p + 1)
                              )
                            }
                            disabled={stockPage >= stockTotalPages}
                            className={`px-3 py-1 text-sm rounded-md border ${
                              stockPage >= stockTotalPages
                                ? 'bg-gray-100 text-gray-400 border-gray-200'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Suivant
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Section Ventes */}
          {section === 'sales' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center'>
                  <Coins className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Ventes
                  </h2>
                </div>
                <div className='hidden sm:flex items-center space-x-3'>
                  <div className='text-sm text-gray-600 flex items-center gap-3'>
                    <span className='inline-flex items-center gap-2 whitespace-nowrap'>
                      <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-semibold text-gray-700'>
                        {selectedSales.length}
                      </span>
                      <span>
                        élément{selectedSales.length > 1 ? 's' : ''} sélectionné
                        {selectedSales.length > 1 ? 's' : ''}
                      </span>
                    </span>
                    <span>—</span>
                    <span>
                      Page {page} / {totalPages} — {filteredShipments.length}{' '}
                      ventes
                    </span>
                  </div>
                  <button
                    onClick={handleReloadSales}
                    disabled={reloadingSales}
                    className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                    title='Recharger les ventes'
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-1 ${reloadingSales ? 'animate-spin' : ''}`}
                    />
                    <span>Recharger</span>
                  </button>

                  <label className='text-sm text-gray-700'>Lignes</label>
                  <select
                    value={pageSize}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      setPageSize(isNaN(v) ? 10 : v);
                      setPage(1);
                    }}
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36'
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
                      value={salesFilterField}
                      onChange={e => {
                        const v = e.target.value as
                          | 'id'
                          | 'client'
                          | 'reference';
                        setSalesFilterField(v);
                        setPage(1);
                      }}
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                    >
                      <option value='id'>ID</option>
                      <option value='client'>Client</option>
                      <option value='reference'>Référence produit</option>
                    </select>
                    <input
                      type='text'
                      value={salesFilterTerm}
                      onChange={e => {
                        setSalesFilterTerm(e.target.value);
                        setPage(1);
                      }}
                      placeholder='Saisir…'
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                  </div>
                </div>
                <div className='sm:hidden'>
                  <button
                    onClick={handleReloadSales}
                    disabled={reloadingSales}
                    className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                    title='Recharger les ventes'
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-1 ${reloadingSales ? 'animate-spin' : ''}`}
                    />
                    <span>Recharger</span>
                  </button>
                </div>
              </div>

              <div className='sm:hidden mb-3'>
                <div className='flex items-center space-x-2 flex-wrap'>
                  <span className='text-sm text-gray-700'>Filtrer par</span>
                  <select
                    value={salesFilterField}
                    onChange={e => {
                      const v = e.target.value as 'id' | 'client' | 'reference';
                      setSalesFilterField(v);
                      setPage(1);
                    }}
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-36'
                  >
                    <option value='id'>ID</option>
                    <option value='client'>Client</option>
                    <option value='reference'>Référence produit</option>
                  </select>
                  <input
                    type='text'
                    value={salesFilterTerm}
                    onChange={e => {
                      setSalesFilterTerm(e.target.value);
                      setPage(1);
                    }}
                    placeholder='Saisir…'
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0 w-full'
                  />
                </div>
              </div>

              <div className='mb-4 flex flex-wrap items-center gap-2'>
                <button
                  onClick={handleBatchShippingDocuments}
                  disabled={selectedForDoc.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedForDoc.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title='Créer le bordereau'
                >
                  Créer le bordereau
                </button>
                <button
                  onClick={handleBatchCancel}
                  disabled={selectedForCancel.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedForCancel.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title="Demander l'annulation"
                >
                  Demander l'annulation
                </button>
                <button
                  onClick={handleBatchInvoice}
                  disabled={selectedSales.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedSales.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title='Envoyer la facture'
                >
                  Envoyer la facture
                </button>
                <button
                  onClick={() => handleOpenHelp(selectedSales)}
                  disabled={selectedSales.length === 0}
                  className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border ${
                    selectedSales.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  title="Besoin d'aide"
                >
                  Besoin d'aide
                </button>
              </div>

              {/* Vue mobile: cartes dépliables */}
              <div className='sm:hidden mb-2 flex items-center gap-2'>
                <input
                  type='checkbox'
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                />
                <span className='text-sm text-gray-700'>Tout sélectionner</span>
              </div>
              <div className='block sm:hidden space-y-3'>
                {visibleShipments.length === 0 ? (
                  <div className='text-gray-600 text-center py-4'>
                    Aucune vente pour le filtre courant.
                  </div>
                ) : (
                  visibleShipments.map(s => (
                    <div
                      key={s.id}
                      className='rounded-lg border border-gray-200 bg-white p-3 shadow-sm'
                    >
                      <div className='flex items-start justify-between'>
                        <div>
                          <div className='text-sm font-semibold text-gray-900'>
                            ID: {s.shipment_id || '—'}
                          </div>
                          <div className='text-xs text-gray-600'>
                            {formatDate(s.created_at)}
                          </div>
                        </div>
                        <div className='text-right'>
                          <div className='flex items-center justify-end'>
                            <input
                              type='checkbox'
                              checked={selectedSaleIds.has(s.id)}
                              onChange={() => toggleSaleSelection(s.id)}
                              className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                            />
                          </div>
                          <div className='text-sm font-semibold text-gray-900'>
                            Payé: {formatValue(s.paid_value)}
                          </div>
                          <div className='text-xs text-gray-600'>
                            Reçu:{' '}
                            {formatValue(
                              (s.paid_value ?? 0) -
                                (s.estimated_delivery_cost ?? 0)
                            )}
                          </div>
                          {s.promo_codes && (
                            <div className='text-xs text-gray-500'>
                              <span className='line-through'>
                                {formatValue(s.product_value)}
                              </span>{' '}
                              (
                              {formatValue(
                                Math.max(
                                  0,
                                  (s.product_value ?? 0) -
                                    ((s.paid_value ?? 0) -
                                      (s.estimated_delivery_cost ?? 0))
                                )
                              )}{' '}
                              de remise avec le code :
                              {s.promo_codes?.replace(/;/g, ', ')})
                            </div>
                          )}
                        </div>
                      </div>

                      <div className='mt-3 text-sm text-gray-700'>
                        <div>
                          <span className='font-medium'>Référence:</span>{' '}
                          {renderShipmentProductReference(s)}
                        </div>
                        <div>
                          {(() => {
                            const stripeId = s.customer_stripe_id || '';
                            const customer = stripeId
                              ? customersMap[stripeId] || null
                              : null;
                            const clerkId =
                              customer?.clerkUserId || customer?.clerk_id;
                            const u = clerkId
                              ? socialsMap[clerkId] || null
                              : null;
                            const name =
                              customer?.name ||
                              [u?.firstName, u?.lastName]
                                .filter(Boolean)
                                .join(' ') ||
                              stripeId ||
                              '—';
                            const email = (
                              u?.emailAddress ||
                              customer?.email ||
                              ''
                            ).trim();
                            return (
                              <div className='flex items-center space-x-2'>
                                {u?.hasImage && u?.imageUrl ? (
                                  <img
                                    src={u.imageUrl}
                                    alt='avatar'
                                    className='w-5 h-5 rounded-full object-cover'
                                  />
                                ) : (
                                  <span className='inline-block w-5 h-5 rounded-full bg-gray-200' />
                                )}
                                <div>
                                  <span className='font-medium'>Client:</span>{' '}
                                  <span className='truncate inline-block max-w-[160px]'>
                                    {name}
                                  </span>
                                  <div className='text-xs text-gray-600'>
                                    <span className='font-medium'>Email:</span>{' '}
                                    {email || '—'}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                        <div>
                          <span className='font-medium'>Méthode:</span>{' '}
                          {formatMethod(s.delivery_method)}
                        </div>
                        <div>
                          <span className='font-medium'>Statut:</span>{' '}
                          {s.status || '—'}
                        </div>
                      </div>

                      <div className='mt-3 flex items-center justify-between'>
                        <div className='text-xs text-gray-600'>
                          Réseau: {getNetworkDescription(s.delivery_network)}
                        </div>
                        <button
                          onClick={() =>
                            setExpandedSalesCardIds(prev => ({
                              ...prev,
                              [s.id]: !prev[s.id],
                            }))
                          }
                          className='px-2 py-1 rounded-md text-xs border bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          aria-expanded={Boolean(expandedSalesCardIds[s.id])}
                        >
                          {expandedSalesCardIds[s.id]
                            ? 'Voir moins'
                            : 'Voir plus'}
                        </button>
                      </div>

                      {/* Bloc extensible */}
                      <div
                        className={`mt-3 space-y-2 text-sm transition-all duration-300 overflow-hidden ${
                          expandedSalesCardIds[s.id]
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
                          <span className='font-medium'>Poids(kg):</span>{' '}
                          {s.weight || '—'}
                        </div>

                        <div>
                          <span className='font-medium'>Suivi:</span>{' '}
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
                            '—'
                          )}
                        </div>

                        <div />
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Vue bureau: tableau */}
              <div className='hidden sm:block overflow-x-auto'>
                <table className='w-full'>
                  <thead>
                    <tr className='border-b border-gray-200'>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        <label className='inline-flex items-center gap-2'>
                          <input
                            type='checkbox'
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                          />
                        </label>
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Date
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        ID
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Client
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Référence produit
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Payé
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Reçu
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Méthode
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Statut
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Réseau
                      </th>
                      <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                        Poids(kg)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShipments.length === 0 ? (
                      <tr>
                        <td
                          className='py-4 px-4 text-gray-600 text-center'
                          colSpan={11}
                        >
                          Aucune vente pour le filtre courant.
                        </td>
                      </tr>
                    ) : (
                      visibleShipments.map(s => (
                        <tr
                          key={s.id}
                          className='border-b border-gray-100 hover:bg-gray-50'
                        >
                          <td className='py-4 px-4 text-gray-700'>
                            <input
                              type='checkbox'
                              checked={selectedSaleIds.has(s.id)}
                              onChange={() => toggleSaleSelection(s.id)}
                              className='h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500'
                            />
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            {formatDate(s.created_at)}
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            <div className='space-y-1'>
                              <div className='font-medium'>
                                {s.shipment_id || '—'}
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
                            {(() => {
                              const stripeId = s.customer_stripe_id || '';
                              const customer = stripeId
                                ? customersMap[stripeId] || null
                                : null;
                              const clerkId =
                                customer?.clerkUserId || customer?.clerk_id;
                              const u = clerkId
                                ? socialsMap[clerkId] || null
                                : null;
                              const name =
                                customer?.name ||
                                [u?.firstName, u?.lastName]
                                  .filter(Boolean)
                                  .join(' ') ||
                                stripeId ||
                                '—';
                              const email = (
                                u?.emailAddress ||
                                customer?.email ||
                                ''
                              ).trim();
                              return (
                                <div className='flex items-center space-x-2'>
                                  {u?.hasImage && u?.imageUrl ? (
                                    <img
                                      src={u.imageUrl}
                                      alt='avatar'
                                      className='w-6 h-6 rounded-full object-cover'
                                    />
                                  ) : (
                                    <span className='inline-block w-6 h-6 rounded-full bg-gray-200' />
                                  )}
                                  <div className='space-y-0.5'>
                                    <div
                                      className='font-medium truncate max-w-[180px]'
                                      title={name}
                                    >
                                      {name}
                                    </div>
                                    <div className='text-xs text-gray-500 truncate max-w-[180px]'>
                                      {email || '—'}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            {renderShipmentProductReference(s)}
                          </td>
                          <td className='py-4 px-4 text-gray-900 font-semibold'>
                            {formatValue(s.paid_value)}
                          </td>
                          <td className='py-4 px-4 text-gray-900 font-semibold'>
                            {(() => {
                              const hasPromo = !!s.promo_codes;
                              const finalValue =
                                (s.paid_value ?? 0) -
                                (s.estimated_delivery_cost ?? 0);
                              return (
                                <>
                                  {formatValue(finalValue)}
                                  {hasPromo && (
                                    <div className='text-xs text-gray-500 mt-1'>
                                      <span className='line-through'>
                                        {formatValue(s.product_value)}
                                      </span>{' '}
                                      (
                                      {formatValue(
                                        Math.max(
                                          0,
                                          (s.product_value ?? 0) -
                                            (finalValue ?? 0)
                                        )
                                      )}{' '}
                                      de remise avec le code:{' '}
                                      {s.promo_codes!.replace(';', ', ')})
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            {formatMethod(s.delivery_method)}
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            <div className='space-y-1'>
                              <div className='font-medium'>
                                {s.status || '—'}
                              </div>
                              <div className='text-xs text-gray-500'>
                                {getStatusDescription(s.status)}
                              </div>
                            </div>
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            {getNetworkDescription(s.delivery_network)}
                          </td>
                          <td className='py-4 px-4 text-gray-700'>
                            {s.weight || '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'clients' && (
            <>
              <div className='bg-white rounded-lg shadow p-6'>
                <div className='flex items-start justify-between mb-4'>
                  <div className='flex flex-col items-start'>
                    <div className='flex items-center'>
                      <Users className='w-5 h-5 text-indigo-600 mr-2' />
                      <h2 className='text-lg font-semibold text-gray-900'>
                        Clients
                      </h2>
                    </div>
                    <div className='mt-2'>
                      <button
                        ref={drawButtonRef}
                        onClick={handleDraw}
                        disabled={selectedIds.size < 2 || drawLoading}
                        className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                        title='Lancer le tirage'
                      >
                        {drawLoading ? (
                          <span className='inline-flex items-center'>
                            <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                            Tirage…
                          </span>
                        ) : (
                          <span>Lancer le tirage</span>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className='hidden sm:flex items-center space-x-3'>
                    <div className='text-sm text-gray-600'>
                      {customersLoading ? (
                        <span>Chargement...</span>
                      ) : (
                        (() => {
                          const allIds = Array.from(
                            new Set(
                              (shipments || [])
                                .map(s => s.customer_stripe_id)
                                .filter(Boolean)
                            )
                          ) as string[];
                          const term = (clientsFilterTerm || '')
                            .trim()
                            .toLowerCase();
                          const filteredIds = allIds.filter(id => {
                            if (!term) return true;
                            const idLower = (id || '').toLowerCase();
                            if (clientsFilterField === 'id') {
                              return idLower.includes(term);
                            }
                            const customer = customersMap[id] || null;
                            const clerkId =
                              customer?.clerkUserId || customer?.clerk_id;
                            const user = clerkId
                              ? socialsMap[clerkId] || null
                              : null;
                            if (clientsFilterField === 'name') {
                              const name1 = (
                                customer?.name || ''
                              ).toLowerCase();
                              const name2 = [
                                user?.firstName || '',
                                user?.lastName || '',
                              ]
                                .filter(Boolean)
                                .join(' ')
                                .toLowerCase();
                              return (
                                name1.includes(term) || name2.includes(term)
                              );
                            }
                            const email = (
                              customer?.email ||
                              '' ||
                              user?.emailAddress ||
                              ''
                            )
                              .toLowerCase()
                              .trim();
                            return email.includes(term);
                          });
                          const totalClients = filteredIds.length;
                          const totalPagesClients = Math.max(
                            1,
                            Math.ceil(totalClients / clientsPageSize)
                          );
                          return (
                            <>
                              Page {clientsPage} / {totalPagesClients} —{' '}
                              {totalClients} clients
                            </>
                          );
                        })()
                      )}
                    </div>

                    <button
                      onClick={handleReloadSales}
                      disabled={reloadingSales}
                      className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                    >
                      <RefreshCw
                        className={`w-4 h-4 mr-1 ${reloadingSales ? 'animate-spin' : ''}`}
                      />
                      <span>Recharger</span>
                    </button>
                    <div className='text-xs text-gray-600 mt-1'>
                      {selectedIds.size} sélectionné(s)
                    </div>

                    <label className='text-sm text-gray-700'>Lignes</label>
                    <select
                      value={clientsPageSize}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setClientsPageSize(isNaN(v) ? 10 : v);
                        setClientsPage(1);
                      }}
                      className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-0 w-full'
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                    <div className='flex items-center space-x-2'>
                      {(() => {
                        const uniqueIds = Array.from(
                          new Set(
                            (shipments || [])
                              .map(s => s.customer_stripe_id)
                              .filter(Boolean)
                          )
                        ) as string[];
                        const totalClients = uniqueIds.length;
                        const totalPagesClients = Math.max(
                          1,
                          Math.ceil(totalClients / clientsPageSize)
                        );
                        return (
                          <>
                            <button
                              onClick={() =>
                                setClientsPage(p => Math.max(1, p - 1))
                              }
                              disabled={clientsPage <= 1}
                              className={`px-3 py-1 text-sm rounded-md border ${
                                clientsPage <= 1
                                  ? 'bg-gray-100 text-gray-400 border-gray-200'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              Précédent
                            </button>
                            <button
                              onClick={() =>
                                setClientsPage(p =>
                                  Math.min(totalPagesClients, p + 1)
                                )
                              }
                              disabled={clientsPage >= totalPagesClients}
                              className={`px-3 py-1 text-sm rounded-md border ${
                                clientsPage >= totalPagesClients
                                  ? 'bg-gray-100 text-gray-400 border-gray-200'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              Suivant
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-gray-700'>Filtrer par</span>
                      <select
                        value={clientsFilterField}
                        onChange={e => {
                          const v = e.target.value as 'id' | 'name' | 'email';
                          setClientsFilterField(v);
                          setClientsPage(1);
                        }}
                        className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                      >
                        <option value='id'>Client ID</option>
                        <option value='name'>Nom</option>
                        <option value='email'>Email</option>
                      </select>
                      <input
                        type='text'
                        value={clientsFilterTerm}
                        onChange={e => {
                          setClientsFilterTerm(e.target.value);
                          setClientsPage(1);
                        }}
                        placeholder='Saisir…'
                        className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                      />
                    </div>
                  </div>
                  <div className='sm:hidden flex items-center flex-wrap gap-2 mt-2 ml-2'>
                    <button
                      onClick={handleReloadSales}
                      disabled={reloadingSales}
                      className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                    >
                      <RefreshCw
                        className={`w-4 h-4 mr-1 ${reloadingSales ? 'animate-spin' : ''}`}
                      />
                      <span>Recharger</span>
                    </button>
                    <div className='text-xs text-gray-600 mt-1'>
                      {selectedIds.size} sélectionné(s)
                    </div>
                  </div>
                </div>

                {(() => {
                  const allIds = Array.from(
                    new Set(
                      (shipments || [])
                        .map(s => s.customer_stripe_id)
                        .filter(Boolean)
                    )
                  ) as string[];
                  if (allIds.length === 0)
                    return (
                      <p className='text-gray-600'>
                        Aucun client pour le moment.
                      </p>
                    );

                  const term = (clientsFilterTerm || '').trim().toLowerCase();
                  const filteredIds = allIds.filter(id => {
                    if (!term) return true;
                    const idLower = (id || '').toLowerCase();
                    if (clientsFilterField === 'id') {
                      return idLower.includes(term);
                    }
                    const customer = customersMap[id] || null;
                    const clerkId = customer?.clerkUserId || customer?.clerk_id;
                    const user = clerkId ? socialsMap[clerkId] || null : null;
                    if (clientsFilterField === 'name') {
                      const name1 = (customer?.name || '').toLowerCase();
                      const name2 = [
                        user?.firstName || '',
                        user?.lastName || '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                      return name1.includes(term) || name2.includes(term);
                    }
                    const email = (
                      customer?.email ||
                      '' ||
                      user?.emailAddress ||
                      ''
                    )
                      .toLowerCase()
                      .trim();
                    return email.includes(term);
                  });

                  const spentMap: Record<string, number> = {};
                  const deliveryDiffMap: Record<string, number> = {};
                  (shipments || []).forEach(s => {
                    const id = s.customer_stripe_id || '';
                    if (!id) return;
                    const v =
                      (s.paid_value ?? 0) - (s.estimated_delivery_cost ?? 0);
                    spentMap[id] = (spentMap[id] || 0) + v;
                    const diff =
                      (s.estimated_delivery_cost ?? 0) - (s.delivery_cost ?? 0);
                    deliveryDiffMap[id] = (deliveryDiffMap[id] || 0) + diff;
                  });

                  // Tri par "Dépensé"
                  const sortedIds = [...filteredIds].sort((a, b) => {
                    const sa = spentMap[a] || 0;
                    const sb = spentMap[b] || 0;
                    return clientsSortOrder === 'asc' ? sa - sb : sb - sa;
                  });

                  // Pagination
                  const startIdx = (clientsPage - 1) * clientsPageSize;
                  const pageIds = sortedIds.slice(
                    startIdx,
                    startIdx + clientsPageSize
                  );

                  const rows = pageIds.map(id => ({
                    id,
                    data: customersMap[id] || null,
                    spent: spentMap[id] || 0,
                    deliveryDiff: deliveryDiffMap[id] || 0,
                  }));

                  return (
                    <>
                      <div className='sm:hidden mb-3'>
                        <div className='flex items-center space-x-2'>
                          <span className='text-sm text-gray-700'>
                            Filtrer par
                          </span>
                          <select
                            value={clientsFilterField}
                            onChange={e => {
                              const v = e.target.value as
                                | 'id'
                                | 'name'
                                | 'email';
                              setClientsFilterField(v);
                              setClientsPage(1);
                            }}
                            className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          >
                            <option value='id'>Client ID</option>
                            <option value='name'>Nom</option>
                            <option value='email'>Email</option>
                          </select>
                          <input
                            type='text'
                            value={clientsFilterTerm}
                            onChange={e => {
                              setClientsFilterTerm(e.target.value);
                              setClientsPage(1);
                            }}
                            placeholder='Saisir…'
                            className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          />
                        </div>
                      </div>

                      {/* Vue mobile: cartes dépliables */}
                      <div className='block sm:hidden space-y-3'>
                        {rows.map(r => {
                          const a = r.data?.address || {};
                          const addr = [
                            a?.line1,
                            `${a?.postal_code || ''} ${a?.city || ''}`.trim(),
                            a?.country,
                          ]
                            .filter(Boolean)
                            .join(', ');
                          const clerkId =
                            r.data?.clerkUserId || r.data?.clerk_id;
                          const u = clerkId
                            ? socialsMap[clerkId] || null
                            : null;
                          const name =
                            r.data?.name ||
                            [u?.firstName, u?.lastName]
                              .filter(Boolean)
                              .join(' ') ||
                            '—';
                          return (
                            <div
                              key={r.id}
                              className='rounded-lg border border-gray-200 bg-white p-3 shadow-sm'
                            >
                              <div className='flex items-start justify-between'>
                                <div className='flex items-center space-x-2'>
                                  <input
                                    type='checkbox'
                                    checked={selectedIds.has(r.id)}
                                    onChange={() => toggleSelectId(r.id)}
                                    aria-label='Sélectionner'
                                    className='h-4 w-4'
                                  />
                                  {u?.hasImage && u?.imageUrl ? (
                                    <img
                                      src={u.imageUrl}
                                      alt='avatar'
                                      className='w-6 h-6 rounded-full object-cover'
                                    />
                                  ) : (
                                    <span className='inline-block w-6 h-6 rounded-full bg-gray-200' />
                                  )}
                                  <div>
                                    <div className='text-sm font-semibold text-gray-900'>
                                      {name}
                                    </div>
                                    <div
                                      className='text-xs text-gray-600 truncate max-w-[220px]'
                                      title={r.id}
                                    >
                                      {r.id}
                                    </div>
                                  </div>
                                </div>
                                <div className='text-right'>
                                  <div className='text-sm font-semibold text-gray-900'>
                                    {formatValue(r.spent)}
                                  </div>
                                  {(() => {
                                    const diff = Number(r.deliveryDiff || 0);
                                    const color =
                                      diff > 0
                                        ? 'text-green-600'
                                        : diff < 0
                                          ? 'text-red-600'
                                          : 'text-gray-900';
                                    return (
                                      <div
                                        className={`text-xs font-semibold ${color}`}
                                      >
                                        {formatValue(diff)}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>

                              <div className='mt-3 text-sm text-gray-700'>
                                <div>
                                  <span className='font-medium'>Email:</span>{' '}
                                  {r.data?.email || '—'}
                                </div>
                                <div>
                                  <span className='font-medium'>
                                    Téléphone:
                                  </span>{' '}
                                  {r.data?.phone || '—'}
                                </div>
                                <div>
                                  <span className='font-medium'>Adresse:</span>{' '}
                                  {addr || '—'}
                                </div>
                              </div>

                              <div className='mt-3 flex items-center justify-end'>
                                <button
                                  onClick={() =>
                                    setExpandedClientCardIds(prev => ({
                                      ...prev,
                                      [r.id]: !prev[r.id],
                                    }))
                                  }
                                  className='px-2 py-1 rounded-md text-xs border bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  aria-expanded={Boolean(
                                    expandedClientCardIds[r.id]
                                  )}
                                >
                                  {expandedClientCardIds[r.id]
                                    ? 'Voir moins'
                                    : 'Voir plus'}
                                </button>
                              </div>

                              <div
                                className={`mt-3 space-y-2 text-sm transition-all duration-300 overflow-hidden ${
                                  expandedClientCardIds[r.id]
                                    ? 'max-h-[1000px] opacity-100'
                                    : 'max-h-0 opacity-0'
                                }`}
                              >
                                <div className='font-medium'>
                                  Réseaux sociaux
                                </div>
                                {(() => {
                                  const accounts = u?.externalAccounts || [];
                                  if (!u || !accounts || accounts.length === 0)
                                    return <div>—</div>;
                                  return (
                                    <div className='space-y-1'>
                                      {accounts.map((acc: any) => {
                                        const providerKey = (
                                          acc?.provider || ''
                                        ).toLowerCase();
                                        const Icon = getProviderIcon(
                                          acc?.provider
                                        );
                                        const isAppleOrTikTok =
                                          providerKey.includes('apple') ||
                                          providerKey.includes('tiktok');

                                        if (isAppleOrTikTok) {
                                          const email =
                                            (acc?.emailAddress &&
                                              acc.emailAddress.trim()) ||
                                            '';
                                          const firstName =
                                            (acc?.firstName &&
                                              acc.firstName.trim()) ||
                                            '';
                                          const lastName =
                                            (acc?.lastName &&
                                              acc.lastName.trim()) ||
                                            '';
                                          const username =
                                            (acc?.username &&
                                              String(acc.username).trim()) ||
                                            '';
                                          const phone =
                                            (acc?.phoneNumber &&
                                              String(acc.phoneNumber).trim()) ||
                                            '';
                                          const name2 = [firstName, lastName]
                                            .filter(Boolean)
                                            .join(' ');
                                          const hasAny = Boolean(
                                            email || name2 || phone || username
                                          );
                                          if (!hasAny) {
                                            return (
                                              <div
                                                key={acc?.id || acc?.provider}
                                                className='flex items-center space-x-2'
                                              >
                                                {Icon ? (
                                                  <Icon
                                                    size={14}
                                                    className='text-gray-600'
                                                  />
                                                ) : (
                                                  <FaShareAlt
                                                    size={14}
                                                    className='text-gray-600'
                                                  />
                                                )}
                                              </div>
                                            );
                                          }
                                          return (
                                            <div
                                              key={acc?.id || acc?.provider}
                                              className='flex items-center space-x-2'
                                            >
                                              {Icon ? (
                                                <Icon
                                                  size={14}
                                                  className='text-gray-600'
                                                />
                                              ) : (
                                                <FaShareAlt
                                                  size={14}
                                                  className='text-gray-600'
                                                />
                                              )}
                                              {email ? (
                                                <span className='text-xs text-gray-700'>
                                                  {email}
                                                </span>
                                              ) : null}
                                              {name2 ? (
                                                <span className='text-xs text-gray-700'>
                                                  {name2}
                                                </span>
                                              ) : null}
                                              {phone ? (
                                                <span className='text-xs text-gray-700'>
                                                  {phone}
                                                </span>
                                              ) : null}
                                              {username ? (
                                                <span className='text-xs text-gray-700'>
                                                  @{username}
                                                </span>
                                              ) : null}
                                            </div>
                                          );
                                        }

                                        const email2 =
                                          (acc?.emailAddress &&
                                            acc.emailAddress.trim()) ||
                                          (u?.emailAddress || '').trim() ||
                                          '';
                                        const username2 =
                                          (acc?.username &&
                                            String(acc.username).trim()) ||
                                          '';
                                        const firstName2 =
                                          (acc?.firstName || '').trim() ||
                                          (u?.firstName || '').trim();
                                        const lastName2 =
                                          (acc?.lastName || '').trim() ||
                                          (u?.lastName || '').trim();
                                        const name3 = [firstName2, lastName2]
                                          .filter(Boolean)
                                          .join(' ');
                                        const phone2 =
                                          (acc?.phoneNumber &&
                                            String(acc.phoneNumber).trim()) ||
                                          (u?.phoneNumber || '').trim();
                                        const hasAny2 = Boolean(
                                          email2 || name3 || phone2 || username2
                                        );
                                        if (!hasAny2) {
                                          return (
                                            <div
                                              key={acc?.id || acc?.provider}
                                              className='flex items-center space-x-2'
                                            >
                                              {Icon ? (
                                                <Icon
                                                  size={14}
                                                  className='text-gray-600'
                                                />
                                              ) : (
                                                <FaShareAlt
                                                  size={14}
                                                  className='text-gray-600'
                                                />
                                              )}
                                            </div>
                                          );
                                        }
                                        return (
                                          <div
                                            key={acc?.id || acc?.provider}
                                            className='flex items-center space-x-2'
                                          >
                                            {Icon ? (
                                              <Icon
                                                size={14}
                                                className='text-gray-600'
                                              />
                                            ) : (
                                              <FaShareAlt
                                                size={14}
                                                className='text-gray-600'
                                              />
                                            )}
                                            {email2 ? (
                                              <span className='text-xs text-gray-700'>
                                                {email2}
                                              </span>
                                            ) : null}
                                            {name3 ? (
                                              <span className='text-xs text-gray-700'>
                                                {name3}
                                              </span>
                                            ) : null}
                                            {phone2 ? (
                                              <span className='text-xs text-gray-700'>
                                                {phone2}
                                              </span>
                                            ) : null}
                                            {username2 ? (
                                              <span className='text-xs text-gray-700'>
                                                @{username2}
                                              </span>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Vue bureau: tableau */}
                      <div className='hidden sm:block overflow-x-auto'>
                        <table className='w-full'>
                          <thead>
                            <tr className='border-b border-gray-200'>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                {(() => {
                                  const allIds = Array.from(
                                    new Set(
                                      (shipments || [])
                                        .map(s => s.customer_stripe_id)
                                        .filter(Boolean)
                                    )
                                  ) as string[];
                                  const term = (clientsFilterTerm || '')
                                    .trim()
                                    .toLowerCase();
                                  const filteredIds = allIds.filter(id => {
                                    if (!term) return true;
                                    const idLower = (id || '').toLowerCase();
                                    if (clientsFilterField === 'id') {
                                      return idLower.includes(term);
                                    }
                                    const customer = customersMap[id] || null;
                                    const clerkId =
                                      customer?.clerkUserId ||
                                      customer?.clerk_id;
                                    const user = clerkId
                                      ? socialsMap[clerkId] || null
                                      : null;
                                    if (clientsFilterField === 'name') {
                                      const name1 = (
                                        customer?.name || ''
                                      ).toLowerCase();
                                      const name2 = [
                                        user?.firstName || '',
                                        user?.lastName || '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ')
                                        .toLowerCase();
                                      return (
                                        name1.includes(term) ||
                                        name2.includes(term)
                                      );
                                    }
                                    const email = (
                                      customer?.email ||
                                      '' ||
                                      user?.emailAddress ||
                                      ''
                                    )
                                      .toLowerCase()
                                      .trim();
                                    return email.includes(term);
                                  });
                                  const spentMap: Record<string, number> = {};
                                  (shipments || []).forEach(s => {
                                    const id = s.customer_stripe_id || '';
                                    if (!id) return;
                                    const v =
                                      (s.paid_value ?? 0) -
                                      (s.estimated_delivery_cost ?? 0);
                                    spentMap[id] = (spentMap[id] || 0) + v;
                                  });
                                  const sortedIds = [...filteredIds].sort(
                                    (a, b) => {
                                      const sa = spentMap[a] || 0;
                                      const sb = spentMap[b] || 0;
                                      return clientsSortOrder === 'asc'
                                        ? sa - sb
                                        : sb - sa;
                                    }
                                  );
                                  const startIdx =
                                    (clientsPage - 1) * clientsPageSize;
                                  const pageIds = sortedIds.slice(
                                    startIdx,
                                    startIdx + clientsPageSize
                                  );
                                  const allSelected = pageIds.every(id =>
                                    selectedIds.has(id)
                                  );
                                  return (
                                    <div className='flex flex-col items-start'>
                                      <div className='inline-flex items-center gap-2 text-sm text-gray-700'>
                                        <input
                                          type='checkbox'
                                          checked={allSelected}
                                          onChange={e => {
                                            const checked = e.target.checked;
                                            setSelectedIds(prev => {
                                              const next = new Set(prev);
                                              if (checked) {
                                                pageIds.forEach(id =>
                                                  next.add(id)
                                                );
                                              } else {
                                                pageIds.forEach(id =>
                                                  next.delete(id)
                                                );
                                              }
                                              return next;
                                            });
                                          }}
                                          aria-label='Sélectionner tout'
                                        />
                                        <span>Sélectionner tout</span>
                                      </div>
                                      <div className='text-xs text-gray-600 mt-1 font-normal'>
                                        {selectedIds.size}{' '}
                                        {selectedIds.size > 1
                                          ? 'clients sélectionnés'
                                          : 'client sélectionné'}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Client ID
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Nom
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Email
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Téléphone
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Adresse
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                <div className='flex items-center space-x-2'>
                                  <span>Dépensé</span>
                                  <button
                                    onClick={() =>
                                      setClientsSortOrder(o =>
                                        o === 'asc' ? 'desc' : 'asc'
                                      )
                                    }
                                    className='p-1 rounded hover:bg-gray-100'
                                    title={`Trier ${clientsSortOrder === 'asc' ? '↓' : '↑'}`}
                                  >
                                    <ArrowUpDown className='w-4 h-4 text-gray-600' />
                                  </button>
                                </div>
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Écart Livraison
                              </th>
                              <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                                Réseaux Sociaux
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(r => {
                              const a = r.data?.address || {};
                              const addr = [
                                a?.line1,
                                `${a?.postal_code || ''} ${a?.city || ''}`.trim(),
                                a?.country,
                              ]
                                .filter(Boolean)
                                .join(', ');
                              return (
                                <tr
                                  key={r.id}
                                  className='border-b border-gray-100 hover:bg-gray-50'
                                >
                                  <td className='py-4 px-4'>
                                    <input
                                      type='checkbox'
                                      checked={selectedIds.has(r.id)}
                                      onChange={() => toggleSelectId(r.id)}
                                      aria-label='Sélectionner'
                                    />
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    <span
                                      className='truncate block max-w-[240px]'
                                      title={r.id}
                                    >
                                      {r.id}
                                    </span>
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {(() => {
                                      const clerkId =
                                        r.data?.clerkUserId || r.data?.clerk_id;
                                      const u = clerkId
                                        ? socialsMap[clerkId] || null
                                        : null;
                                      const name =
                                        r.data?.name ||
                                        [u?.firstName, u?.lastName]
                                          .filter(Boolean)
                                          .join(' ') ||
                                        '—';
                                      return (
                                        <div className='flex items-center space-x-2'>
                                          {u?.hasImage && u?.imageUrl ? (
                                            <img
                                              src={u.imageUrl}
                                              alt='avatar'
                                              className='w-8 h-8 rounded-full object-cover'
                                            />
                                          ) : null}
                                          <span>{name}</span>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {r.data?.email || '—'}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {r.data?.phone || '—'}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {addr || '—'}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {formatValue(r.spent)}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {(() => {
                                      const diff = Number(r.deliveryDiff || 0);
                                      const color =
                                        diff > 0
                                          ? 'text-green-600'
                                          : diff < 0
                                            ? 'text-red-600'
                                            : 'text-gray-900';
                                      return (
                                        <span className={color}>
                                          {formatValue(diff)}
                                        </span>
                                      );
                                    })()}
                                  </td>
                                  <td className='py-4 px-4 text-gray-700'>
                                    {(() => {
                                      const clerkId =
                                        r.data?.clerkUserId || r.data?.clerk_id;
                                      const u = clerkId
                                        ? socialsMap[clerkId] || null
                                        : null;
                                      const accounts =
                                        u?.externalAccounts || [];
                                      if (
                                        !u ||
                                        !accounts ||
                                        accounts.length === 0
                                      )
                                        return '—';
                                      return (
                                        <div className='space-y-1'>
                                          {accounts.map((acc: any) => {
                                            const providerKey = (
                                              acc?.provider || ''
                                            ).toLowerCase();
                                            const Icon = getProviderIcon(
                                              acc?.provider
                                            );

                                            const isAppleOrTikTok =
                                              providerKey.includes('apple') ||
                                              providerKey.includes('tiktok');

                                            if (isAppleOrTikTok) {
                                              // Pour Apple/TikTok: n'afficher que le logo si tous les champs sont vides
                                              const email =
                                                (acc?.emailAddress &&
                                                  acc.emailAddress.trim()) ||
                                                '';
                                              const firstName =
                                                (acc?.firstName &&
                                                  acc.firstName.trim()) ||
                                                '';
                                              const lastName =
                                                (acc?.lastName &&
                                                  acc.lastName.trim()) ||
                                                '';
                                              const username =
                                                (acc?.username &&
                                                  String(
                                                    acc.username
                                                  ).trim()) ||
                                                '';
                                              const phone =
                                                (acc?.phoneNumber &&
                                                  String(
                                                    acc.phoneNumber
                                                  ).trim()) ||
                                                '';
                                              const name = [firstName, lastName]
                                                .filter(Boolean)
                                                .join(' ');
                                              const hasAny = Boolean(
                                                email ||
                                                  name ||
                                                  phone ||
                                                  username
                                              );

                                              if (!hasAny) {
                                                return (
                                                  <div
                                                    key={
                                                      acc?.id || acc?.provider
                                                    }
                                                    className='flex items-center space-x-2'
                                                  >
                                                    {Icon ? (
                                                      <Icon
                                                        size={14}
                                                        className='text-gray-600'
                                                      />
                                                    ) : (
                                                      <FaShareAlt
                                                        size={14}
                                                        className='text-gray-600'
                                                      />
                                                    )}
                                                  </div>
                                                );
                                              }

                                              return (
                                                <div
                                                  key={acc?.id || acc?.provider}
                                                  className='flex items-center space-x-2'
                                                >
                                                  {Icon ? (
                                                    <Icon
                                                      size={14}
                                                      className='text-gray-600'
                                                    />
                                                  ) : (
                                                    <FaShareAlt
                                                      size={14}
                                                      className='text-gray-600'
                                                    />
                                                  )}
                                                  {email ? (
                                                    <span className='text-xs text-gray-700'>
                                                      {email}
                                                    </span>
                                                  ) : null}
                                                  {name ? (
                                                    <span className='text-xs text-gray-700'>
                                                      {name}
                                                    </span>
                                                  ) : null}
                                                  {phone ? (
                                                    <span className='text-xs text-gray-700'>
                                                      {phone}
                                                    </span>
                                                  ) : null}
                                                  {username ? (
                                                    <span className='text-xs text-gray-700'>
                                                      @{username}
                                                    </span>
                                                  ) : null}
                                                </div>
                                              );
                                            }

                                            // Autres providers : afficher les champs si disponibles, prioriser les infos du compte externe, fallback user
                                            const email =
                                              (acc?.emailAddress &&
                                                acc.emailAddress.trim()) ||
                                              (u?.emailAddress || '').trim() ||
                                              '';
                                            const username =
                                              (acc?.username &&
                                                String(acc.username).trim()) ||
                                              '';
                                            const firstName =
                                              (acc?.firstName || '').trim() ||
                                              (u?.firstName || '').trim();
                                            const lastName =
                                              (acc?.lastName || '').trim() ||
                                              (u?.lastName || '').trim();
                                            const name = [firstName, lastName]
                                              .filter(Boolean)
                                              .join(' ');
                                            const phone =
                                              (acc?.phoneNumber &&
                                                String(
                                                  acc.phoneNumber
                                                ).trim()) ||
                                              (u?.phoneNumber || '').trim();
                                            const hasAny = Boolean(
                                              email || name || phone || username
                                            );

                                            if (!hasAny) {
                                              return (
                                                <div
                                                  key={acc?.id || acc?.provider}
                                                  className='flex items-center space-x-2'
                                                >
                                                  {Icon ? (
                                                    <Icon
                                                      size={14}
                                                      className='text-gray-600'
                                                    />
                                                  ) : (
                                                    <FaShareAlt
                                                      size={14}
                                                      className='text-gray-600'
                                                    />
                                                  )}
                                                </div>
                                              );
                                            }

                                            return (
                                              <div
                                                key={acc?.id || acc?.provider}
                                                className='flex items-center space-x-2'
                                              >
                                                {Icon ? (
                                                  <Icon
                                                    size={14}
                                                    className='text-gray-600'
                                                  />
                                                ) : (
                                                  <FaShareAlt
                                                    size={14}
                                                    className='text-gray-600'
                                                  />
                                                )}
                                                {email ? (
                                                  <span className='text-xs text-gray-700'>
                                                    {email}
                                                  </span>
                                                ) : null}
                                                {name ? (
                                                  <span className='text-xs text-gray-700'>
                                                    {name}
                                                  </span>
                                                ) : null}
                                                {phone ? (
                                                  <span className='text-xs text-gray-700'>
                                                    {phone}
                                                  </span>
                                                ) : null}
                                                {username ? (
                                                  <span className='text-xs text-gray-700'>
                                                    @{username}
                                                  </span>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}
              </div>
              {showWinnerModal && (
                <div
                  className='fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4'
                  onClick={() => {
                    setShowWinnerModal(false);
                    if (drawButtonRef.current) {
                      try {
                        drawButtonRef.current.focus();
                      } catch {}
                    }
                  }}
                >
                  <div
                    className='bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden'
                    role='dialog'
                    aria-modal='true'
                    aria-label='Résultat du tirage'
                    onClick={e => e.stopPropagation()}
                  >
                    <div className='p-4 border-b border-gray-200 flex items-center justify-between'>
                      <h3 className='text-lg font-semibold text-gray-900'>
                        Gagnant du tirage
                      </h3>
                      <span className='inline-flex items-center px-2 py-1 text-xs rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200'>
                        Winner
                      </span>
                    </div>
                    <div className='p-6'>
                      {winner ? (
                        <div className='flex items-start space-x-4'>
                          <div className='w-14 h-14 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center'>
                            <span className='text-gray-500'>👤</span>
                          </div>
                          <div className='flex-1 space-y-1'>
                            <div className='text-lg font-semibold text-gray-900'>
                              {winner.name || '—'}
                            </div>
                            <div className='text-sm text-gray-700'>
                              {winner.email || '—'}
                            </div>
                            <div className='text-sm text-gray-700'>
                              {winner.phone || '—'}
                            </div>
                            <div className='text-sm text-gray-700'>
                              {(() => {
                                const a = winner.address || {};
                                const addr = [
                                  a?.line1,
                                  `${a?.postal_code || ''} ${a?.city || ''}`.trim(),
                                  a?.country,
                                ]
                                  .filter(Boolean)
                                  .join(', ');
                                return addr || '—';
                              })()}
                            </div>
                            <div className='text-sm text-gray-700'>
                              {winner.deliveryNetwork ||
                                winner.deliveryMethod ||
                                '—'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className='text-center text-gray-600'>—</div>
                      )}
                    </div>
                    <div className='p-4 border-t border-gray-200 flex items-center justify-end gap-2'>
                      <button
                        onClick={async () => {
                          const email = winner?.email || '';
                          if (!email) {
                            showToast('Email indisponible', 'error');
                            return;
                          }
                          try {
                            setSendingCongrats(true);
                            const token = await getToken();
                            const resp = await apiPost(
                              '/api/raffle/notify',
                              {
                                email,
                                name: winner?.name || '',
                                storeSlug: store?.slug || undefined,
                                storeName: store?.name || undefined,
                              },
                              {
                                headers: {
                                  Authorization: token ? `Bearer ${token}` : '',
                                },
                              }
                            );
                            const json = await resp.json().catch(() => ({}));
                            if (!resp.ok || !json?.success) {
                              throw new Error(
                                json?.error || "Échec de l'envoi"
                              );
                            }
                            showToast('Email envoyé', 'success');
                          } catch (e: any) {
                            const msg = (
                              e?.message || "Erreur lors de l'envoi"
                            ).replace(/^Error:\s*/, '');
                            showToast(msg, 'error');
                          } finally {
                            setSendingCongrats(false);
                          }
                        }}
                        disabled={!winner?.email || sendingCongrats}
                        className='px-3 py-2 text-sm rounded-md border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400'
                      >
                        {sendingCongrats ? 'Envoi…' : 'Envoyer email'}
                      </button>
                      <button
                        onClick={() => {
                          setShowWinnerModal(false);
                          if (drawButtonRef.current) {
                            try {
                              drawButtonRef.current.focus();
                            } catch {}
                          }
                        }}
                        className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700'
                      >
                        Fermer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {section === 'promo' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center'>
                  <Tag className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Code Promo
                  </h2>
                </div>
              </div>

              <p className='text-sm text-gray-600 mb-4'>
                Créez un code promo lié à un coupon existant et visualisez les
                codes de votre boutique.
              </p>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Coupon
                  </label>
                  <div className='space-y-2'>
                    {couponOptions.map(opt => (
                      <label key={opt.id} className='flex items-center gap-2'>
                        <input
                          type='radio'
                          name='promo-coupon'
                          value={opt.id}
                          checked={promoSelectedCouponId === opt.id}
                          onChange={e =>
                            setPromoSelectedCouponId(e.target.value)
                          }
                          className='h-4 w-4'
                        />
                        <span className='text-sm text-gray-700'>
                          {opt.name || opt.id}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Nom du code
                  </label>
                  <input
                    type='text'
                    value={promoCodeName}
                    onChange={e => setPromoCodeName(e.target.value)}
                    placeholder='Ex: SUMMER20'
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Montant minimum d’achat (€)
                  </label>
                  <input
                    type='number'
                    min='0'
                    step='0.01'
                    value={promoMinAmountEuro}
                    onChange={e => setPromoMinAmountEuro(e.target.value)}
                    placeholder='Ex: 50'
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Restriction premiers achats
                  </label>
                  <div className='flex items-center gap-3'>
                    <input
                      id='promo-first-time'
                      type='checkbox'
                      checked={promoFirstTime}
                      onChange={e => setPromoFirstTime(e.target.checked)}
                      className='h-4 w-4'
                      disabled
                    />
                    <label
                      htmlFor='promo-first-time'
                      className='text-sm text-gray-700'
                    >
                      Ce code ne sera valable que pour les clients qui n’ont
                      jamais effectué d’achat auparavant.
                    </label>
                  </div>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Date d’expiration
                  </label>
                  <input
                    type='date'
                    min={new Date().toISOString().slice(0, 10)}
                    value={promoExpiresDate}
                    onChange={e => setPromoExpiresDate(e.target.value)}
                    required={!!promoExpiresTime}
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Heure d’expiration
                  </label>
                  <input
                    type='time'
                    step='60'
                    value={promoExpiresTime}
                    onChange={e => setPromoExpiresTime(e.target.value)}
                    required={!!promoExpiresDate}
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                  <p className='text-xs text-gray-500 mt-1'>
                    L’heure est obligatoire si une date est renseignée.
                  </p>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>
                    Nombre maximum d’utilisations
                  </label>
                  <input
                    type='number'
                    min='0'
                    step='1'
                    value={promoMaxRedemptions}
                    onChange={e => setPromoMaxRedemptions(e.target.value)}
                    placeholder='Ex: 10'
                    className='w-full border border-gray-300 rounded-md px-3 py-2 text-sm'
                  />
                </div>
              </div>

              <div className='flex items-center gap-3 mb-6'>
                <button
                  onClick={handleCreatePromotionCode}
                  disabled={promoCreating}
                  className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                >
                  {promoCreating && (
                    <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                  )}
                  <RiDiscountPercentFill className='w-4 h-4 mr-1' />
                  <span>Créer le code promo</span>
                </button>
              </div>

              {/* Barre de recherche par libellé du code */}
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center'>
                  <RiDiscountPercentFill className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Mes Code Promo
                  </h2>
                </div>
              </div>
              <div className='flex items-center mb-3 gap-2'>
                <input
                  type='text'
                  value={promoSearchTerm}
                  onChange={e => setPromoSearchTerm(e.target.value)}
                  placeholder={'Rechercher par code…'}
                  className='w-full md:w-64 border border-gray-300 rounded-md px-3 py-2 text-sm'
                />
                {/* Bouton reload desktop à droite */}
                <div className='sm:flex flex-end items-center space-x-3'>
                  <button
                    onClick={fetchPromotionCodes}
                    disabled={promoListLoading}
                    className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                  >
                    <RefreshCw
                      className={`w-4 h-4 mr-1 ${promoListLoading ? 'animate-spin' : ''}`}
                    />
                    <span>Recharger</span>
                  </button>
                </div>
              </div>

              <div className='md:hidden space-y-3'>
                {promoListLoading ? (
                  <div className='text-sm text-gray-600'>Chargement...</div>
                ) : promoCodes.length === 0 ? (
                  <div className='text-sm text-gray-600'>Aucun code promo</div>
                ) : (
                  promoCodes
                    .filter((p: any) => {
                      const term = (promoSearchTerm || '').toLowerCase();
                      if (!term) return true;
                      return String(p?.code || '')
                        .toLowerCase()
                        .includes(term);
                    })
                    .map((p: any) => (
                      <div
                        key={p.id}
                        className={`border border-gray-200 rounded-md p-3 ${p?.active === false ? 'opacity-60' : ''}`}
                      >
                        <div className='flex items-center justify-between'>
                          <div className='text-base font-semibold text-gray-900'>
                            {p.code}
                          </div>
                          <button
                            onClick={() => handleDeletePromotionCode(p.id)}
                            disabled={!!promoDeletingIds[p.id]}
                            className='inline-flex items-center px-2 py-1 text-xs rounded-md bg-gray-600 text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                          >
                            <FaArchive className='w-3 h-3 mr-1' />
                            Archiver
                          </button>
                        </div>
                        <div className='mt-2 text-sm text-gray-700 space-y-1'>
                          <div>
                            <span className='font-medium'>Coupon:</span>{' '}
                            {(() => {
                              const match = couponOptions.find(
                                c => c.id === (p?.coupon?.id || '')
                              );
                              return (
                                match?.name ||
                                p?.coupon?.name ||
                                p?.coupon?.id ||
                                '—'
                              );
                            })()}
                          </div>
                          <div>
                            <span className='font-medium'>Expiration:</span>{' '}
                            {p.expires_at
                              ? new Date(p.expires_at * 1000).toLocaleString(
                                  'fr-FR',
                                  {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  }
                                )
                              : '—'}
                          </div>
                          <div>
                            <span className='font-medium'>Utilisations:</span>{' '}
                            {p.times_redeemed ?? 0}
                            {p.max_redemptions ? ` / ${p.max_redemptions}` : ''}
                          </div>
                          <div>
                            <span className='font-medium'>Restrictions:</span>{' '}
                            {(() => {
                              const r = p.restrictions || {};
                              const parts: string[] = [];
                              if (
                                typeof r.minimum_amount === 'number' &&
                                r.minimum_amount > 0
                              ) {
                                parts.push(
                                  `${(r.minimum_amount / 100).toFixed(2)}€ min.`
                                );
                              }
                              if (r.first_time_transaction) {
                                parts.push('premier achat');
                              }
                              return parts.length ? parts.join(' • ') : '—';
                            })()}
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>

              <div className='hidden md:block overflow-x-auto border border-gray-200 rounded-md'>
                <table className='min-w-full divide-y divide-gray-200 text-sm'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Code
                      </th>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Coupon
                      </th>

                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Expiration
                      </th>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Utilisations
                      </th>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Max
                      </th>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Restrictions
                      </th>
                      <th className='px-4 py-2 text-left font-medium text-gray-700'>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className='bg-white divide-y divide-gray-200'>
                    {promoListLoading ? (
                      <tr>
                        <td
                          colSpan={8}
                          className='px-4 py-6 text-center text-gray-600'
                        >
                          Chargement...
                        </td>
                      </tr>
                    ) : promoCodes.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className='px-4 py-6 text-center text-gray-600'
                        >
                          Aucun code promo
                        </td>
                      </tr>
                    ) : (
                      promoCodes
                        .filter((p: any) => {
                          const term = (promoSearchTerm || '').toLowerCase();
                          if (!term) return true;
                          return String(p?.code || '')
                            .toLowerCase()
                            .includes(term);
                        })
                        .map((p: any) => (
                          <tr
                            key={p.id}
                            className={p?.active === false ? 'opacity-60' : ''}
                          >
                            <td className='px-4 py-3 text-gray-900 font-medium'>
                              {p.code}
                            </td>
                            <td
                              className='px-4 py-3 text-gray-700 truncate max-w-[12rem]'
                              title={(() => {
                                const match = couponOptions.find(
                                  c => c.id === (p?.coupon?.id || '')
                                );
                                return (
                                  match?.name ||
                                  p?.coupon?.name ||
                                  p?.coupon?.id ||
                                  ''
                                );
                              })()}
                            >
                              {(() => {
                                const match = couponOptions.find(
                                  c => c.id === (p?.coupon?.id || '')
                                );
                                return (
                                  match?.name ||
                                  p?.coupon?.name ||
                                  p?.coupon?.id ||
                                  '—'
                                );
                              })()}
                            </td>

                            <td className='px-4 py-3 text-gray-700'>
                              {p.expires_at
                                ? new Date(p.expires_at * 1000).toLocaleString(
                                    'fr-FR',
                                    {
                                      dateStyle: 'short',
                                      timeStyle: 'short',
                                    }
                                  )
                                : '—'}
                            </td>
                            <td className='px-4 py-3 text-gray-700'>
                              {p.times_redeemed ?? 0}
                            </td>
                            <td className='px-4 py-3 text-gray-700'>
                              {p.max_redemptions ?? '—'}
                            </td>
                            <td className='px-4 py-3 text-gray-700'>
                              {(() => {
                                const r = p?.restrictions || {};
                                const parts: string[] = [];
                                if (typeof r.minimum_amount === 'number') {
                                  const eur = (
                                    r.minimum_amount / 100
                                  ).toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  });
                                  parts.push(`Min: ${eur} €`);
                                }
                                if (
                                  typeof r.first_time_transaction === 'boolean'
                                ) {
                                  parts.push(
                                    r.first_time_transaction
                                      ? 'Premiers achats uniquement'
                                      : 'Tous achats'
                                  );
                                }
                                return parts.length ? parts.join(' • ') : '—';
                              })()}
                            </td>
                            <td className='px-4 py-3 text-gray-700'>
                              <button
                                onClick={() => handleDeletePromotionCode(p.id)}
                                disabled={!!promoDeletingIds[p.id]}
                                className={`inline-flex items-center p-2 rounded-md border ${promoDeletingIds[p.id] ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-700 border-gray-300'}`}
                                title={'Archiver'}
                              >
                                <FaArchive
                                  className={`w-4 h-4 ${promoDeletingIds[p.id] ? 'opacity-60' : ''}`}
                                />
                                <span className='ml-1'>Archiver</span>
                              </button>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'support' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-4'>
                <LifeBuoy className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>Support</h2>
              </div>
              <p className='text-gray-600 mb-4'>
                Envoyez un message de contact à PayLive.
              </p>
              <div className='space-y-3'>
                <label className='block text-sm font-medium text-gray-700'>
                  Message
                </label>
                <textarea
                  value={supportMessage}
                  onChange={e => setSupportMessage(e.target.value)}
                  rows={5}
                  className='w-full border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500'
                  placeholder={'Décrivez votre question ou votre problème…'}
                />
                <div className='space-y-2'>
                  <label className='block text-sm font-medium text-gray-700'>
                    Pièce jointe (PDF/JPG/PNG) — facultatif
                  </label>
                  <input
                    type='file'
                    accept='application/pdf,image/png,image/jpeg'
                    onChange={e => {
                      const file = e.target.files?.[0] || null;
                      setSupportFile(file);
                    }}
                    className='block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100'
                  />
                  {supportFile && (
                    <p className='text-xs text-gray-500'>
                      Fichier choisi: {supportFile.name}
                    </p>
                  )}
                </div>
                <div className='flex items-center justify-end'>
                  <button
                    onClick={handleSendSupport}
                    disabled={isSendingSupport || !supportMessage.trim()}
                    className={`inline-flex items-center px-4 py-2 rounded-md ${
                      isSendingSupport || !supportMessage.trim()
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isSendingSupport && (
                      <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                    )}
                    Envoyer
                    <SendHorizontal className='w-5 h-5 ml-2' />
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Modal Besoin d'aide (affiché par-dessus toutes les sections) */}
          {helpOpen && (
            <div
              className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'
              onClick={handleCloseHelp}
            >
              <div
                className='bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden'
                onClick={e => e.stopPropagation()}
              >
                <div className='px-4 py-3 border-b border-gray-200'>
                  <h3 className='text-lg font-semibold text-gray-900'>
                    Besoin d'aide
                  </h3>
                  <p className='text-sm text-gray-600 mt-1'>
                    Ce message sera envoyé à PayLive.
                  </p>
                </div>
                <div className='p-4 space-y-3'>
                  {helpSales.length > 0 && (
                    <div className='bg-gray-50 rounded-md p-3 border border-gray-200'>
                      <div className='text-sm font-medium text-gray-800 mb-2'>
                        Ventes sélectionnées ({helpSales.length})
                      </div>
                      <div className='text-xs text-gray-700 space-y-2 max-h-40 overflow-auto'>
                        {helpSales.map(s => (
                          <div key={s.id} className='space-y-1'>
                            <div className='flex items-center justify-between gap-2'>
                              <span className='truncate'>
                                ID: {s.shipment_id || s.id}
                              </span>
                              <span className='text-gray-500'>
                                {s.status || '—'}
                              </span>
                            </div>
                            <div className='text-gray-600 truncate'>
                              Réf: {formatShipmentProductReference(s)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className='block text-sm font-medium text-gray-700'>
                      Message
                    </label>
                    <textarea
                      value={helpMessage}
                      onChange={e => setHelpMessage(e.target.value)}
                      rows={5}
                      className='w-full border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500'
                      placeholder={'Décrivez votre question ou votre problème…'}
                    />
                  </div>
                  <div className='space-y-2'>
                    <label className='block text-sm font-medium text-gray-700'>
                      Pièce jointe (PDF/JPG/PNG) — facultatif
                    </label>
                    <input
                      type='file'
                      accept='application/pdf,image/png,image/jpeg'
                      onChange={e => {
                        const file = e.target.files?.[0] || null;
                        setHelpFile(file);
                      }}
                      className='block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100'
                    />
                    {helpFile && (
                      <p className='text-xs text-gray-500'>
                        Fichier choisi: {helpFile.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className='px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-2'>
                  <button
                    onClick={handleCloseHelp}
                    className='px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100'
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSendHelp}
                    disabled={isSendingHelp || !helpMessage.trim()}
                    className={`inline-flex items-center px-4 py-2 rounded-md ${
                      isSendingHelp || !helpMessage.trim()
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isSendingHelp && (
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
    </div>
  );
}
