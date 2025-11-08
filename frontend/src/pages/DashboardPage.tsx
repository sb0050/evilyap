import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../components/Header';
import Spinner from '../components/Spinner';
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
} from 'lucide-react';
import {
  FaFacebook,
  FaGoogle,
  FaTiktok,
  FaApple,
  FaShareAlt,
} from 'react-icons/fa';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';
import {
  apiPut,
  apiPost,
  apiPostForm,
  apiGet,
  API_BASE_URL,
} from '../utils/api';
import SuccessConfetti from '../components/SuccessConfetti';

// Vérifications d’accès centralisées dans Header; suppression de Protect ici
// Slugification supprimée côté frontend; on utilise le backend

type RIBInfo = {
  type: 'link' | 'database';
  url?: string | null;
  iban?: string;
  bic?: string;
};

type Store = {
  id: number;
  name: string;
  slug: string;
  balance?: number | null;
  clerk_id?: string | null;
  description?: string | null;
  website?: string | null;
  siret?: string | null;
  rib?: RIBInfo | null;
  reference_value?: number | null;
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
  weight: string | null;
  product_reference: string | number | null;
  value: number | null;
  reference_value?: number | null;
  created_at?: string | null;
  status?: string | null;
  estimated_delivery_date?: string | null;
  cancel_requested?: boolean | null;
  is_final_destination?: boolean | null;
  delivery_cost?: number | null;
  tracking_url?: string | null;
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
  const { toast, showToast, hideToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [siret, setSiret] = useState('');
  // Validation du nom (aligné sur Onboarding)
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugExists, setSlugExists] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [wasStoreNameFocused, setWasStoreNameFocused] = useState(false);
  const [isStoreNameDirty, setIsStoreNameDirty] = useState(false);
  const [lastCheckedSlug, setLastCheckedSlug] = useState('');
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const [payoutMethod, setPayoutMethod] = useState<'link' | 'database'>('link');
  const [ibanInput, setIbanInput] = useState('');
  const [bicInput, setBicInput] = useState('');
  // Ajouts pour l'UI de versement
  const [editingRib, setEditingRib] = useState(false);
  const [ribFile, setRibFile] = useState<File | null>(null);
  const [uploadingRib, setUploadingRib] = useState(false);
  const [ribUploadError, setRibUploadError] = useState<string | null>(null);
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
    'infos' | 'wallet' | 'sales' | 'clients' | 'support'
  >('infos');
  // Support: message de contact
  const [supportMessage, setSupportMessage] = useState<string>('');
  const [isSendingSupport, setIsSendingSupport] = useState<boolean>(false);
  const [supportFile, setSupportFile] = useState<File | null>(null);
  // Aide sur une vente (popup similaire à OrdersPage)
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState<string>('');
  const [helpFile, setHelpFile] = useState<File | null>(null);
  const [selectedSale, setSelectedSale] = useState<Shipment | null>(null);
  const [isSendingHelp, setIsSendingHelp] = useState<boolean>(false);
  // Pagination pour la section Ventes
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  // Barre de recherche sur l'ID (contains)
  const [idSearch, setIdSearch] = useState<string>('');
  const [reloadingSales, setReloadingSales] = useState<boolean>(false);
  const [reloadingBalance, setReloadingBalance] = useState<boolean>(false);
  // États Clients (onglet dédié)
  const [clientsPageSize, setClientsPageSize] = useState<number>(10);
  const [clientsPage, setClientsPage] = useState<number>(1);
  const [customersMap, setCustomersMap] = useState<Record<string, any>>({});
  const [customersLoading, setCustomersLoading] = useState<boolean>(false);
  const [clientIdSearch, setClientIdSearch] = useState<string>('');
  const [clientsSortOrder, setClientsSortOrder] = useState<'asc' | 'desc'>(
    'desc'
  );
  const [socialsMap, setSocialsMap] = useState<Record<string, any>>({});

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
  const shareLink = store?.slug ? `paylive.cc/c/${store.slug}` : '';
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
  const isValidSiret = (value: string) => {
    const digits = (value || '').replace(/\s+/g, '');
    return /^\d{14}$/.test(digits);
  };
  const siretInvalid = siret ? !isValidSiret(siret) : false;

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
    const digits = (siret || '').replace(/\s+/g, '');
    if (!/^\d{14}$/.test(digits)) return;
    setIsCheckingSiret(true);
    try {
      const resp = await apiGet(
        `/api/insee/siret/${encodeURIComponent(digits)}`
      );
      const json = await resp.json();
      if (resp.ok && json?.success) {
        setSiretErrorMessage('');
        setLastCheckedSiret(digits);
        setSiretDetails(json?.data || null);
      } else {
        const message = json?.error || 'SIRET invalide ou introuvable';
        setSiretErrorMessage(message);
        setLastCheckedSiret(digits);
        setSiretDetails(null);
      }
    } catch (err) {
      console.error('Vérification SIRET échouée:', err);
      setSiretErrorMessage('Erreur lors de la vérification du SIRET');
      setSiretDetails(null);
    } finally {
      setIsCheckingSiret(false);
    }
  };
  const handleSiretBlur = async () => {
    const value = (siret || '').trim();
    if (!wasSiretFocused) {
      setWasSiretFocused(false);
      return;
    }
    if (!isSiretDirty) {
      setWasSiretFocused(false);
      return;
    }
    if (!value) {
      setSiretErrorMessage('');
      setSiretDetails(null);
      setWasSiretFocused(false);
      setIsSiretDirty(false);
      return;
    }
    if (!/^\d{14}$/.test(value)) {
      setSiretErrorMessage(
        'Erreur de format de siret (Format attendu : 14 chiffres)'
      );
      setSiretDetails(null);
      setWasSiretFocused(false);
      setIsSiretDirty(false);
      return;
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

  // Ouverture du popup "Besoin d'aide" pour une vente
  const handleOpenHelp = (s: Shipment) => {
    setSelectedSale(s);
    setHelpMessage('');
    setHelpFile(null);
    setHelpOpen(true);
  };

  const handleCloseHelp = () => {
    setHelpOpen(false);
    setSelectedSale(null);
  };

  // Envoi du message d'aide au support PayLive avec le contexte de la ligne
  const handleSendHelp = async () => {
    const msg = (helpMessage || '').trim();
    if (!msg) return;
    try {
      setIsSendingHelp(true);
      const token = await getToken();
      const fd = new FormData();
      if (store?.slug) fd.append('storeSlug', store.slug);
      if (selectedSale?.shipment_id)
        fd.append('shipmentId', selectedSale.shipment_id);
      fd.append('message', msg);
      // Contexte détaillé de la vente (pour faciliter le support)
      fd.append(
        'context',
        JSON.stringify({
          source: 'dashboard_sales_help',
          saleId: selectedSale?.id ?? null,
          shipmentId: selectedSale?.shipment_id ?? null,
          productReference: selectedSale?.product_reference ?? null,
          value: selectedSale?.value ?? null,
          customerStripeId: selectedSale?.customer_stripe_id ?? null,
          status: selectedSale?.status ?? null,
          createdAt: selectedSale?.created_at ?? null,
          deliveryMethod: selectedSale?.delivery_method ?? null,
          deliveryNetwork: selectedSale?.delivery_network ?? null,
          tracking_url: selectedSale?.tracking_url ?? null,
          delivery_cost: selectedSale?.delivery_cost ?? null,
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
      setSelectedSale(null);
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

  const handleCancel = async (s: Shipment) => {
    if (!s.shipment_id) {
      setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
      return;
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
        showToast("Demande d'annulation envoyée", 'success');
      } else {
        setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
        const msg =
          json?.error || json?.message || "Erreur lors de l'annulation";
        showToast(
          typeof msg === 'string' ? msg : "Demande d'annulation échouée",
          'error'
        );
      }
    } catch (e: any) {
      setCancelStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || "Erreur lors de l'annulation";
      showToast(
        typeof rawMsg === 'string' ? rawMsg : "Demande d'annulation échouée",
        'error'
      );
    }
  };

  const handleShippingDocument = async (s: Shipment) => {
    try {
      if (!s.shipment_id) return;
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
        showToast('Bordereau créé', 'success');
      } else {
        const data = await resp.json().catch(() => ({}));
        const msg = data?.error || data?.message || 'Erreur bordereau';
        showToast(typeof msg === 'string' ? msg : 'Erreur bordereau', 'error');
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
      }
    } catch (e: any) {
      setDocStatus(prev => ({ ...prev, [s.id]: 'error' }));
      const rawMsg = e?.message || 'Erreur bordereau';
      showToast(
        typeof rawMsg === 'string' ? rawMsg : 'Erreur bordereau',
        'error'
      );
    }
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

  const handleReloadBalance = async () => {
    try {
      const slug = store?.slug;
      if (!slug) return;
      setReloadingBalance(true);
      setError(null);
      const resp = await fetch(
        `${apiBase}/api/stores/${encodeURIComponent(slug)}`
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.store) {
        const msg = json?.error || 'Erreur lors du rechargement du solde';
        throw new Error(typeof msg === 'string' ? msg : 'Rechargement échoué');
      }
      const refreshed = json.store as Store;
      setStore(prev => ({
        ...(prev || refreshed),
        balance: refreshed?.balance ?? 0,
      }));
      showToast('Solde rechargé', 'success');
    } catch (e: any) {
      const rawMsg = e?.message || 'Erreur inconnue';
      showToast(rawMsg, 'error');
    } finally {
      setReloadingBalance(false);
    }
  };

  // Filtre ID (contains) et pagination dérivée
  const filteredShipments = (shipments || []).filter(s => {
    const term = (idSearch || '').trim().toLowerCase();
    if (!term) return true;
    const idStr = (s.shipment_id || '').toLowerCase();
    return idStr.includes(term);
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

  useEffect(() => {
    // Clamp page si longueur filtrée change
    const filteredLength = (shipments || []).filter(s => {
      const term = (idSearch || '').trim().toLowerCase();
      if (!term) return true;
      const idStr = (s.shipment_id || '').toLowerCase();
      return idStr.includes(term);
    }).length;
    const newTotal = Math.max(1, Math.ceil(filteredLength / pageSize));
    if (page > newTotal) setPage(newTotal);
    if (page < 1) setPage(1);
  }, [shipments, pageSize, idSearch]);

  // Chargement des clients Stripe basés sur les customer_stripe_id des shipments
  useEffect(() => {
    if (section !== 'clients') return;
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
            .map(c => c?.clerkUserId || c?.clerk_user_id)
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
        setPayoutMethod(s?.rib?.type === 'link' ? 'link' : 'database');

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
    // SIRET facultatif: si fourni, il doit être valide et connu
    if (siret && (siretInvalid || !!siretErrorMessage)) {
      showToast('Veuillez saisir un SIRET valide (14 chiffres)', 'error');
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
      const payload: any = { name, description, website };
      const isSiretVerified =
        Boolean(siret) &&
        lastCheckedSiret === siret &&
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

  const confirmPayout = async () => {
    if (!store?.slug) return;
    setIbanError(null);
    setBicError(null);
    setRibUploadError(null);
    setIsSubmittingPayout(true);
    try {
      let methodToUse: 'database' | 'link' = payoutMethod;
      let ibanToUse = '';
      let bicToUse = '';

      // Si un RIB existe et pas en mode édition, utiliser les coordonnées enregistrées
      if (store.rib && !editingRib) {
        methodToUse = store.rib.type;
        if (methodToUse === 'database') {
          ibanToUse = store.rib.iban || '';
          bicToUse = store.rib.bic || '';
        }
      } else {
        // Mode édition ou aucun RIB enregistré
        if (payoutMethod === 'database') {
          ibanToUse = ibanInput.trim();
          bicToUse = bicInput.trim();
        } else if (payoutMethod === 'link') {
          // Upload du RIB si un document est sélectionné
          if (ribFile) {
            try {
              const fd = new FormData();
              fd.append('document', ribFile);
              fd.append('slug', store.slug);
              setUploadingRib(true);
              const uploadResp = await apiPostForm('/api/upload/rib', fd);
              const uploadJson = await uploadResp.json();
              if (!uploadJson?.success) {
                setRibUploadError(uploadJson?.error || 'Upload du RIB échoué');
                showToast(uploadJson?.error || 'Upload du RIB échoué', 'error');
                return;
              }
              // Mettre à jour le store local pour refléter le nouveau RIB link
              setStore({
                ...(store as any),
                rib: { type: 'link', url: uploadJson.url, iban: '', bic: '' },
              } as Store);
            } catch (e) {
              const msg =
                e instanceof Error ? e.message : 'Upload du RIB échoué';
              setRibUploadError(msg);
              showToast(msg, 'error');
              return;
            } finally {
              setUploadingRib(false);
            }
          }
          methodToUse = 'link';
        }
      }

      const payload: any = { method: methodToUse };
      if (methodToUse === 'database') {
        payload.iban = ibanToUse;
        payload.bic = bicToUse;
      }

      const resp = await apiPost(
        `/api/stores/${encodeURIComponent(store!.slug)}/confirm-payout`,
        payload
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
      showToast(
        'La demande de versement a été envoyée avec succès.',
        'success'
      );
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
                    <BadgeCheck className='w-3 h-3' /> Boutique vérifiée
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
              onClick={() => setSection('sales')}
              className={`flex items-center  sm:basis-auto min-w-0 px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md border ${
                section === 'sales'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <ShoppingCart className='w-3 h-3 sm:w-4 sm:h-4 mr-2' />
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
                  <div className='flex flex-col sm:flex-row items-center sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 p-3 '>
                    <input
                      type='text'
                      value={shareLink}
                      readOnly
                      className='mr-5 bg-transparent text-xs sm:text-sm text-gray-700 outline-none min-w-0 text-left truncate sm:text-left'
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
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
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
                  {/* SIRET */}
                  <div>
                    <label
                      htmlFor='siret'
                      className='block text-sm font-medium text-gray-700 mb-2'
                    >
                      SIRET (14 chiffres, facultatif mais nécessaire pour
                      obtenir le badge "boutique vérifiée")
                    </label>
                    <div className='relative'>
                      <input
                        id='siret'
                        inputMode='numeric'
                        value={siret}
                        onChange={handleSiretChange}
                        onFocus={handleSiretFocus}
                        onBlur={handleSiretBlur}
                        className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${showValidationErrors && siret && (siretInvalid || !!siretErrorMessage) ? 'border-red-500' : 'border-gray-300'}`}
                        placeholder='12345678901234'
                      />
                      {isCheckingSiret && (
                        <div className='absolute right-3 inset-y-0 flex items-center'>
                          <div className='animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-500'></div>
                        </div>
                      )}
                    </div>
                    {(siret && showValidationErrors && siretInvalid) ||
                    (siret && !!siretErrorMessage) ? (
                      <p className='mt-2 text-sm text-red-600'>
                        {siretErrorMessage ||
                          'SIRET invalide. Entrez exactement 14 chiffres.'}
                      </p>
                    ) : null}

                    {siret &&
                    lastCheckedSiret === siret &&
                    !siretInvalid &&
                    !siretErrorMessage &&
                    siretDetails
                      ? (() => {
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
                                  <span className='text-gray-600'>SIREN: </span>
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
                                    {[line1, city].filter(Boolean).join(' — ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
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
                  <div className='flex items-center space-x-2'>
                    <button
                      onClick={saveStoreInfo}
                      disabled={
                        !name.trim() ||
                        (website && websiteInvalid) ||
                        slugExists ||
                        isCheckingSlug ||
                        (siret ? siretInvalid || !!siretErrorMessage : false) ||
                        isCheckingSiret
                      }
                      className={`inline-flex items-center px-4 py-2 rounded-md text-white ${!name.trim() || (website && websiteInvalid) || slugExists || isCheckingSlug || (siret ? siretInvalid || !!siretErrorMessage : false) || isCheckingSiret ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
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

          {/* Section Porte-monnaie */}
          {section === 'wallet' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-4'>
                <Wallet className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>
                  Porte-monnaie
                </h2>
                <button
                  onClick={handleReloadBalance}
                  disabled={reloadingBalance}
                  className='inline-flex items-center ml-4 px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                  title='Recharger le solde'
                >
                  <RefreshCw
                    className={`w-4 h-4 mr-1 ${reloadingBalance ? 'animate-spin' : ''}`}
                  />
                  <span>Recharger</span>
                </button>
              </div>
              <p className='text-gray-600 mb-2'>
                Montant accumulé suite aux achats des clients.
              </p>
              {store && (
                <div className='flex items-baseline space-x-2 mb-4'>
                  <span className='text-2xl font-bold text-gray-900'>
                    {(store.balance ?? 0).toFixed(2)}
                  </span>
                  <span className='text-gray-700'>€ disponibles</span>
                </div>
              )}
              {/* Bouton qui révèle la section Demande de versement */}
              {store && (
                <div>
                  <div>
                    {store?.rib && !editingRib && (
                      <div className='mb-4'>
                        <p className='text-gray-700'>
                          Les coordonnées bancaires précédemment renseignées
                          pour le dernier versement seront utilisées.
                        </p>
                      </div>
                    )}
                    {!(store?.rib && !editingRib) && (
                      <div>
                        <div className='flex items-center space-x-4 mb-3'>
                          <label className='inline-flex items-center'>
                            <input
                              type='radio'
                              className='mr-2'
                              name='payoutMethod'
                              value='link'
                              checked={payoutMethod === 'link'}
                              onChange={() => setPayoutMethod('link')}
                            />
                            Télécharger l'IBAN/RIB
                          </label>
                          <label className='inline-flex items-center'>
                            <input
                              type='radio'
                              className='mr-2'
                              name='payoutMethod'
                              value='database'
                              checked={payoutMethod === 'database'}
                              onChange={() => setPayoutMethod('database')}
                            />
                            Saisir IBAN/BIC
                          </label>
                        </div>
                        {payoutMethod === 'link' && (
                          <div className='mb-3 space-y-2'>
                            <label className='block text-sm font-medium text-gray-700'>
                              Pièce jointe (PDF/JPG/PNG)
                            </label>
                            <input
                              type='file'
                              accept='application/pdf,image/png,image/jpeg'
                              onChange={e => {
                                const f = e.target.files?.[0] || null;
                                setRibFile(f);
                                setRibUploadError(null);
                              }}
                              className='block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100'
                            />
                            {uploadingRib && (
                              <p className='text-xs text-gray-500 mt-1'>
                                Téléchargement en cours...
                              </p>
                            )}
                            {ribUploadError && (
                              <p className='text-sm text-red-600 mt-1'>
                                {ribUploadError}
                              </p>
                            )}
                          </div>
                        )}
                        {payoutMethod === 'database' && (
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
                                <p className='mt-1 text-xs text-red-600'>
                                  {ibanError}
                                </p>
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
                                <p className='mt-1 text-xs text-red-600'>
                                  {bicError}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className='mt-4 flex items-center space-x-2'>
                    <button
                      onClick={confirmPayout}
                      className={`inline-flex items-center px-4 py-2 rounded-md text-white ${
                        isSubmittingPayout ||
                        ((store?.rib === null || editingRib) &&
                          (payoutMethod === 'link'
                            ? !ribFile
                            : !ibanInput.trim() || !bicInput.trim())) ||
                        (payoutMethod === 'database'
                          ? Boolean(ibanError) || Boolean(bicError)
                          : Boolean(ribUploadError))
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700'
                      }`}
                      disabled={
                        isSubmittingPayout ||
                        ((store?.rib === null || editingRib) &&
                          (payoutMethod === 'link'
                            ? !ribFile
                            : !ibanInput.trim() || !bicInput.trim())) ||
                        (payoutMethod === 'database'
                          ? Boolean(ibanError) || Boolean(bicError)
                          : Boolean(ribUploadError))
                      }
                    >
                      {isSubmittingPayout && (
                        <span className='mr-2 inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent'></span>
                      )}
                      <HandCoins className='w-5 h-5 mr-2' />
                      Retirer mes gains
                    </button>
                    {store?.rib && !editingRib && (
                      <button
                        onClick={() => {
                          setEditingRib(true);
                          setPayoutMethod(
                            store?.rib?.type === 'link' ? 'link' : 'database'
                          );
                        }}
                        className='px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300'
                      >
                        Modifier
                      </button>
                    )}
                    {editingRib && (
                      <button
                        onClick={() => {
                          setEditingRib(false);
                          setRibFile(null);
                          setIbanError(null);
                          setBicError(null);
                          setRibUploadError(null);
                        }}
                        className='px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300'
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section Ventes */}
          {section === 'sales' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center'>
                  <ShoppingCart className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Mes ventes
                  </h2>
                </div>
                <div className='hidden sm:flex items-center space-x-3'>
                  <div className='text-sm text-gray-600'>
                    Page {page} / {totalPages} — {filteredShipments.length}{' '}
                    ventes
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

              {/* Contrôles mobile: filtre ID */}
              <div className='sm:hidden mb-3'>
                <label className='block text-sm text-gray-700 mb-1'>
                  Filtrer par ID
                </label>
                <input
                  type='text'
                  value={idSearch}
                  onChange={e => {
                    setIdSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder='Ex: 123ABC'
                  className='w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>

              {/* Vue mobile: cartes dépliables */}
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
                          <div className='text-sm font-semibold text-gray-900'>
                            Payé: {formatValue(s.value)}
                          </div>
                          <div className='text-xs text-gray-600'>
                            Reçu:{' '}
                            {formatValue(
                              s?.reference_value ??
                                store?.reference_value ??
                                null
                            )}
                          </div>
                        </div>
                      </div>

                      <div className='mt-3 text-sm text-gray-700'>
                        <div>
                          <span className='font-medium'>Référence:</span>{' '}
                          {s.product_reference ?? '—'}
                        </div>
                        <div>
                          <span className='font-medium'>Client ID:</span>{' '}
                          <span
                            className='truncate inline-block max-w-[220px]'
                            title={s.customer_stripe_id || ''}
                          >
                            {s.customer_stripe_id || '—'}
                          </span>
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
                          <span className='font-medium'>Poids:</span>{' '}
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

                        <div className='flex flex-wrap items-center gap-2 pt-2'>
                          <button
                            onClick={() => handleShippingDocument(s)}
                            disabled={
                              !s.document_created ||
                              docStatus[s.id] === 'loading'
                            }
                            className='px-2 py-1 rounded-md text-xs border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                            title={
                              s.document_created
                                ? 'Créer le bordereau'
                                : 'Bordereau indisponible'
                            }
                          >
                            {docStatus[s.id] === 'loading'
                              ? 'Création...'
                              : 'Créer le bordereau'}
                          </button>

                          <button
                            onClick={() => handleCancel(s)}
                            disabled={
                              !s.shipment_id ||
                              s.is_final_destination ||
                              !!s.cancel_requested ||
                              cancelStatus[s.id] === 'loading'
                            }
                            className={`px-2 py-1 rounded-md text-xs border disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 ${
                              s.cancel_requested ||
                              cancelStatus[s.id] === 'success'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : cancelStatus[s.id] === 'error'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                            title={
                              !s.shipment_id
                                ? 'Annulation indisponible'
                                : s.cancel_requested
                                  ? 'Demande déjà envoyée'
                                  : "Demander l'annulation"
                            }
                          >
                            {cancelStatus[s.id] === 'loading'
                              ? 'Envoi...'
                              : s.cancel_requested ||
                                  cancelStatus[s.id] === 'success'
                                ? 'Demande envoyée'
                                : cancelStatus[s.id] === 'error'
                                  ? 'Réessayer'
                                  : "Demander l'annulation"}
                          </button>

                          <button
                            onClick={() => handleOpenHelp(s)}
                            className='px-2 py-1 rounded-md text-xs border bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            title={"Besoin d'aide"}
                          >
                            Besoin d'aide
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Vue bureau: tableau */}
              <table className='w-full hidden sm:table'>
                <thead>
                  <tr className='border-b border-gray-200'>
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
                      Poids
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Bordereau
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Annulation
                    </th>
                    <th className='text-left py-3 px-4 font-semibold text-gray-700'>
                      Aide
                    </th>
                  </tr>
                  <tr className='border-b border-gray-100'>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'>
                      <input
                        type='text'
                        value={idSearch}
                        onChange={e => {
                          setIdSearch(e.target.value);
                          setPage(1);
                        }}
                        placeholder='Filtrer…'
                        className='w-full  max-w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                      />
                    </th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                    <th className='py-2 px-4'></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleShipments.length === 0 ? (
                    <tr>
                      <td
                        className='py-4 px-4 text-gray-600 text-center'
                        colSpan={13}
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
                          <span
                            className='truncate block max-w-[200px]'
                            title={s.customer_stripe_id || ''}
                          >
                            {s.customer_stripe_id || '—'}
                          </span>
                        </td>
                        <td className='py-4 px-4 text-gray-700'>
                          {s.product_reference ?? '—'}
                        </td>
                        <td className='py-4 px-4 text-gray-900 font-semibold'>
                          {formatValue(s.value)}
                        </td>
                        <td className='py-4 px-4 text-gray-900 font-semibold'>
                          {formatValue(
                            s?.reference_value ?? store?.reference_value ?? null
                          )}
                        </td>
                        <td className='py-4 px-4 text-gray-700'>
                          {formatMethod(s.delivery_method)}
                        </td>
                        <td className='py-4 px-4 text-gray-700'>
                          <div className='space-y-1'>
                            <div className='font-medium'>{s.status || '—'}</div>
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
                        <td className='py-4 px-4'>
                          <button
                            onClick={() => handleShippingDocument(s)}
                            disabled={
                              !s.document_created ||
                              docStatus[s.id] === 'loading'
                            }
                            className={
                              'inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                            }
                            title={
                              s.document_created
                                ? 'Créer le bordereau'
                                : 'Bordereau indisponible'
                            }
                          >
                            {docStatus[s.id] === 'loading'
                              ? 'Création...'
                              : 'Créer le bordereau'}
                          </button>
                        </td>
                        <td className='py-4 px-4'>
                          <button
                            onClick={() => handleCancel(s)}
                            disabled={
                              !s.shipment_id ||
                              s.is_final_destination ||
                              !!s.cancel_requested ||
                              cancelStatus[s.id] === 'loading'
                            }
                            className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 ${
                              s.cancel_requested ||
                              cancelStatus[s.id] === 'success'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : cancelStatus[s.id] === 'error'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                            title={
                              !s.shipment_id
                                ? 'Annulation indisponible'
                                : s.cancel_requested
                                  ? 'Demande déjà envoyée'
                                  : "Demander l'annulation"
                            }
                          >
                            {s.cancel_requested}
                            {cancelStatus[s.id] === 'loading'
                              ? 'Envoi...'
                              : s.cancel_requested ||
                                  cancelStatus[s.id] === 'success'
                                ? 'Demande envoyée'
                                : cancelStatus[s.id] === 'error'
                                  ? 'Réessayer'
                                  : "Demander l'annulation"}
                          </button>
                        </td>
                        <td className='py-4 px-4'>
                          <button
                            onClick={() => handleOpenHelp(s)}
                            className={
                              'inline-flex items-center px-3 py-2 rounded-md text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }
                            title={"Besoin d'aide"}
                          >
                            Besoin d'aide
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {section === 'clients' && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center justify-between mb-4'>
                <div className='flex items-center'>
                  <Users className='w-5 h-5 text-indigo-600 mr-2' />
                  <h2 className='text-lg font-semibold text-gray-900'>
                    Clients
                  </h2>
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
                        const term = (clientIdSearch || '')
                          .trim()
                          .toLowerCase();
                        const filteredIds = term
                          ? allIds.filter(id =>
                              (id || '').toLowerCase().includes(term)
                            )
                          : allIds;
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

                  <label className='text-sm text-gray-700'>Lignes</label>
                  <select
                    value={clientsPageSize}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      setClientsPageSize(isNaN(v) ? 10 : v);
                      setClientsPage(1);
                    }}
                    className='border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
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
                </div>
                <div className='sm:hidden'>
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

                // Filtre par Client ID
                const term = (clientIdSearch || '').trim().toLowerCase();
                const filteredIds = term
                  ? allIds.filter(id => (id || '').toLowerCase().includes(term))
                  : allIds;

                // Sommes dépensées par client (somme des shipments.reference_value)
                const spentMap: Record<string, number> = {};
                (shipments || []).forEach(s => {
                  const id = s.customer_stripe_id || '';
                  if (!id) return;
                  const v =
                    typeof s.reference_value === 'number'
                      ? s.reference_value || 0
                      : 0;
                  spentMap[id] = (spentMap[id] || 0) + v;
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
                }));

                return (
                  <>
                    {/* Contrôles mobile: filtre Client ID */}
                    <div className='sm:hidden mb-3'>
                      <label className='block text-sm text-gray-700 mb-1'>
                        Filtrer par Client ID
                      </label>
                      <input
                        type='text'
                        value={clientIdSearch}
                        onChange={e => {
                          setClientIdSearch(e.target.value);
                          setClientsPage(1);
                        }}
                        placeholder='Ex: cus_...'
                        className='w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                      />
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
                          r.data?.clerkUserId || r.data?.clerk_user_id;
                        const u = clerkId ? socialsMap[clerkId] || null : null;
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
                              <div className='text-sm font-semibold text-gray-900'>
                                {formatValue(r.spent)}
                              </div>
                            </div>

                            <div className='mt-3 text-sm text-gray-700'>
                              <div>
                                <span className='font-medium'>Email:</span>{' '}
                                {r.data?.email || '—'}
                              </div>
                              <div>
                                <span className='font-medium'>Téléphone:</span>{' '}
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
                              <div className='font-medium'>Réseaux sociaux</div>
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
                    <table className='w-full hidden sm:table'>
                      <thead>
                        <tr className='border-b border-gray-200'>
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
                            Réseaux Sociaux
                          </th>
                        </tr>
                        <tr className='border-b border-gray-100'>
                          <th className='py-2 px-4'>
                            <input
                              type='text'
                              value={clientIdSearch}
                              onChange={e => {
                                setClientIdSearch(e.target.value);
                                setClientsPage(1);
                              }}
                              placeholder='Filtrer…'
                              className='w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                            />
                          </th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
                          <th className='py-2 px-4'></th>
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
                                    r.data?.clerkUserId ||
                                    r.data?.clerk_user_id;
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
                                  const clerkId =
                                    r.data?.clerkUserId ||
                                    r.data?.clerk_user_id;
                                  const u = clerkId
                                    ? socialsMap[clerkId] || null
                                    : null;
                                  const accounts = u?.externalAccounts || [];
                                  if (!u || !accounts || accounts.length === 0)
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
                                              String(acc.username).trim()) ||
                                            '';
                                          const phone =
                                            (acc?.phoneNumber &&
                                              String(acc.phoneNumber).trim()) ||
                                            '';
                                          const name = [firstName, lastName]
                                            .filter(Boolean)
                                            .join(' ');
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
                                            String(acc.phoneNumber).trim()) ||
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
                  </>
                );
              })()}
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
                  {selectedSale && (
                    <div className='bg-gray-50 rounded-md p-3 border border-gray-200'>
                      <div className='text-sm font-medium text-gray-800 mb-2'>
                        Contexte de la vente
                      </div>
                      <div className='text-xs text-gray-700 space-y-1'>
                        <div>
                          <span className='font-semibold'>ID expédition:</span>{' '}
                          {selectedSale.shipment_id || '—'}
                        </div>
                        <div>
                          <span className='font-semibold'>
                            Référence produit:
                          </span>{' '}
                          {selectedSale.product_reference ?? '—'}
                        </div>
                        <div>
                          <span className='font-semibold'>Client ID:</span>{' '}
                          {selectedSale.customer_stripe_id || '—'}
                        </div>
                        <div>
                          <span className='font-semibold'>Statut:</span>{' '}
                          {selectedSale.status || '—'}
                        </div>
                        <div>
                          <span className='font-semibold'>Date:</span>{' '}
                          {formatDate(selectedSale.created_at)}
                        </div>
                        <div>
                          <span className='font-semibold'>Méthode:</span>{' '}
                          {formatMethod(selectedSale.delivery_method)}
                        </div>
                        <div>
                          <span className='font-semibold'>Réseau:</span>{' '}
                          {getNetworkDescription(selectedSale.delivery_network)}
                        </div>
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
