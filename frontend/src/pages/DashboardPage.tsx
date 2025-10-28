import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import Header from '../components/Header';
import { Wallet, ShoppingCart, ArrowRight, Upload, Info } from 'lucide-react';
import { Toast } from '../components/Toast';
import { useToast } from '../utils/toast';
import { apiPut, apiPost, apiPostForm, apiGet } from '../utils/api';
import { Protect } from '@clerk/clerk-react';
import slugify from 'slugify';

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
  rib?: RIBInfo | null;
};

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
  customer_clerk_id: string | null;
};

export default function DashboardPage() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [store, setStore] = useState<Store | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeNotFound, setStoreNotFound] = useState(false);
  const { toast, showToast, hideToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
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
  // Édition infos boutique
  const [editingInfo, setEditingInfo] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  // Toggle de la demande de versement
  const [showPayout, setShowPayout] = useState(false);
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
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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
    const slug = slugify(trimmed, { lower: true, strict: true });
    setGeneratedSlug(slug);
    setIsCheckingSlug(true);
    try {
      const resp = await apiGet(
        `/api/stores/exists?slug=${encodeURIComponent(slug)}`
      );
      if (!resp.ok) throw new Error('Erreur lors de la vérification du slug');
      const json = await resp.json();
      setSlugExists(Boolean(json?.exists));
      setLastCheckedSlug(slug);
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
    const slug = slugify(trimmed, { lower: true, strict: true });
    if (lastCheckedSlug === slug) {
      setWasStoreNameFocused(false);
      setIsStoreNameDirty(false);
      return;
    }
    await checkSlugUniqueness();
    setWasStoreNameFocused(false);
    setIsStoreNameDirty(false);
  };

  useEffect(() => {
    const load = async () => {
      if (!storeSlug) {
        setError('Nom de boutique manquant');
        setLoading(false);
        return;
      }

      try {
        // Fetch store info (includes balance and clerk_id)
        const storeResp = await fetch(
          `${apiBase}/api/stores/${encodeURIComponent(storeSlug)}`
        );
        const storeJson = await storeResp.json();
        if (!storeResp.ok) {
          if (storeResp.status === 404) {
            setStoreNotFound(true);
            setError(storeJson?.error || 'Boutique non trouvée');
            setLoading(false);
            return;
          }
          throw new Error(
            storeJson?.error || 'Erreur lors de la récupération de la boutique'
          );
        }
        const s: Store = storeJson.store;

        // Accès contrôlé via <Protect> de Clerk (fallback affichera un message si non autorisé)

        setStore(s);
        setName(s?.name || '');
        setDescription(s?.description || '');
        setWebsite(s?.website || '');
        setPayoutMethod(s?.rib?.type === 'link' ? 'link' : 'database');

        // Fetch shipments for this store
        const token = await getToken();
        const shipResp = await fetch(
          `${apiBase}/api/shipments/store/${encodeURIComponent(storeSlug)}`,
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
            showToast(msg, 'error');
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
    load();
  }, [storeSlug, user?.id]);

  const saveStoreInfo = async () => {
    if (!storeSlug) return;
    setShowValidationErrors(true);
    // Vérifications similaires à onboarding
    if (!name.trim()) {
      return;
    }
    if (websiteInvalid) {
      return;
    }
    if (slugExists || isCheckingSlug) {
      return;
    }
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
      const resp: any = await apiPut(
        `/api/stores/${encodeURIComponent(storeSlug)}`,
        { name, description, website }
      );
      if (!resp?.success) {
        throw new Error(
          resp?.error || 'Échec de la mise à jour de la boutique'
        );
      }
      const updated: Store = resp.store;
      setStore(updated);
      setEditingInfo(false);
      showToast('Informations de la boutique mises à jour.', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Erreur inconnue',
        'error'
      );
    }
  };

  const confirmPayout = async () => {
    if (!storeSlug || !store) return;
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
        `/api/stores/${encodeURIComponent(storeSlug)}/confirm-payout`,
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
            <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
            <p className='text-gray-600'>Chargement du tableau de bord...</p>
          </div>
        </div>
      </div>
    );
  }
  // Boutique inexistante: afficher un message centré (style CheckoutPage)
  const storeNameToShow = store?.name || storeSlug || '';
  if (storeNotFound) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='text-gray-400 text-xl mb-4'>🏪</div>
          <h2 className='text-xl font-semibold text-gray-900 mb-2'>
            Boutique non trouvée
          </h2>
          <p className='text-gray-600'>
            La boutique "{storeNameToShow}" n'existe pas ou n'est plus
            disponible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      {toast && <Toast message={toast.message} type={toast.type} />}
      <Header />
      <Protect
        condition={() => {
          const role = (user?.publicMetadata as any)?.role;
          const isAdmin = role === 'admin';
          const isOwnerOfStore =
            role === 'owner' && store?.clerk_id === user?.id;
          return isAdmin || isOwnerOfStore;
        }}
        fallback={
          <div className='min-h-screen flex items-center justify-center'>
            <div className='text-center'>
              <div className='text-gray-400 text-xl mb-4'>🔐</div>
              <h2 className='text-xl font-semibold text-gray-900 mb-2'>
                Accès refusé
              </h2>
              <p className='text-gray-600'>
                Vous n’avez pas les droits pour accéder au tableau de bord de
                cette boutique.
              </p>
            </div>
          </div>
        }
      >
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
          {/* Errors are now surfaced via Toasts */}
          {/* Les erreurs sont gérées via des toasts, pas de bandeau inline */}

          <div className='flex items-center justify-between mb-6'>
            <div>
              <h1 className='text-2xl font-bold text-gray-900'>
                Tableau de bord
              </h1>
              {store && <p className='text-gray-600'>Boutique: {store.name}</p>}
            </div>
            {store && (
              <button
                onClick={() =>
                  navigate(`/checkout/${encodeURIComponent(store.slug)}`)
                }
                className='inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700'
              >
                Aller au formulaire de paiement
                <ArrowRight className='w-4 h-4 ml-2' />
              </button>
            )}
          </div>

          {/* Infos boutique */}
          {store && (
            <div className='bg-white rounded-lg shadow p-6 mb-8'>
              <div className='flex items-center mb-4'>
                <Info className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>
                  Informations de la boutique
                </h2>
              </div>
              {/* Affichage (non édité) */}
              {!editingInfo && (
                <div className='space-y-4'>
                  <div className='flex items-center space-x-4'>
                    {(() => {
                      const cloudBase = (
                        import.meta.env.VITE_CLOUDFRONT_URL ||
                        'https://d1tmgyvizond6e.cloudfront.net'
                      ).replace(/\/+$/, '');
                      const storeLogo = store?.slug
                        ? `${cloudBase}/images/${store.slug}`
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
                    <div>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium'>Nom:</span> {store.name}
                      </p>
                      <p className='text-sm text-gray-700'>
                        <span className='font-medium'>Description:</span>{' '}
                        {store.description || '-'}
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
                      className='px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700'
                    >
                      Modifier
                    </button>
                  </div>
                </div>
              )}
              {/* Édition */}
              {editingInfo && (
                <div className='space-y-4'>
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
                        placeholder='ex: exemple.com ou https://exemple.com'
                      />
                      {website && websiteInvalid && (
                        <p className='mt-1 text-xs text-red-600'>
                          Veuillez saisir un nom de domaine valide (ex:
                          votre-site.co) ou une URL complète
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 mb-2'>
                      Logo *
                    </label>
                    <div className='flex items-center space-x-4'>
                      <label
                        className={` ${logoFile ? 'border-red-500' : 'border-gray-300'} flex flex-col items-center justify-center w-40 h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100`}
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
                          return store?.slug
                            ? `${cloudBase}/images/${store.slug}`
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
                                return store?.slug
                                  ? `${cloudBase}/images/${store.slug}`
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
                        isCheckingSlug
                      }
                      className={`px-4 py-2 rounded text-white ${!name.trim() || (website && websiteInvalid) || slugExists || isCheckingSlug ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                      Enregistrer
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

          {/* Porte-monnaie */}
          <div className='bg-white rounded-lg shadow p-6 mb-8'>
            <div className='flex items-center mb-4'>
              <Wallet className='w-5 h-5 text-indigo-600 mr-2' />
              <h2 className='text-lg font-semibold text-gray-900'>
                Porte-monnaie
              </h2>
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
            {store && !showPayout && (
              <button
                onClick={() => setShowPayout(true)}
                className='px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700'
              >
                Retirer mes gains
              </button>
            )}
            {store && showPayout && (
              <div>
                <button
                  onClick={() => setShowPayout(false)}
                  className='px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300'
                >
                  Annuler
                </button>
                <div className='mt-4 border-t pt-4'>
                  <h3 className='text-md font-semibold text-gray-900 mb-2'>
                    Demande de versement
                  </h3>
                  {store.rib && !editingRib && (
                    <div className='mb-4'>
                      <p className='text-gray-700'>
                        Les coordonnées bancaires précédemment renseignées pour
                        le dernier versement seront utilisées.
                      </p>
                    </div>
                  )}
                  {!(store.rib && !editingRib) && (
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
                          Télécharger le RIB
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
                        <div className='mb-3'>
                          <label className='block text-sm text-gray-700 mb-1'>
                            RIB (PDF, PNG, JPG/JPEG)
                          </label>
                          <input
                            type='file'
                            accept='application/pdf,image/png,image/jpeg'
                            onChange={e => {
                              const f = e.target.files?.[0] || null;
                              setRibFile(f);
                              setRibUploadError(null);
                            }}
                            className='w-full text-sm'
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
                      ((store.rib === null || editingRib) &&
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
                      ((store.rib === null || editingRib) &&
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
                    Demander un versement
                  </button>
                  {store.rib && !editingRib && (
                    <button
                      onClick={() => {
                        setEditingRib(true);
                        setPayoutMethod(
                          store.rib?.type === 'link' ? 'link' : 'database'
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
          {shipments.length === 0 && (
            <div className='bg-white rounded-lg shadow p-6'>
              <div className='flex items-center mb-2'>
                <ShoppingCart className='w-5 h-5 text-indigo-600 mr-2' />
                <h2 className='text-lg font-semibold text-gray-900'>
                  Mes ventes
                </h2>
              </div>
              <p className='text-gray-600'>Aucune vente pour le moment.</p>
            </div>
          )}
        </div>
      </Protect>
    </div>
  );
}
