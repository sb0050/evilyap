import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import {
  LayoutDashboard,
  Truck,
  ShoppingCart,
  Trash2,
  CreditCard,
  Store,
} from 'lucide-react';
import Spinner from './Spinner';
import { animate } from 'motion';
import { API_BASE_URL } from '../utils/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { Protect } from '@clerk/clerk-react';

// Variables de configuration du panier (modifiables)
const CART_ITEM_TTL_MINUTES = 15; // durée de vie d’un article dans le panier
const CART_WARN_THRESHOLD_MINUTES = 1; // seuil d’alerte visuelle et animation
const CART_TICK_MS = 1000; // cadence de mise à jour du timer

// Dérivés en millisecondes
const CART_ITEM_TTL_MS = CART_ITEM_TTL_MINUTES * 60 * 1000;
const CART_WARN_THRESHOLD_MS = CART_WARN_THRESHOLD_MINUTES * 60 * 1000;

// Classes CSS pour les états
const CART_WARN_TEXT_CLASS = 'text-red-600';
const CART_NORMAL_TEXT_CLASS = 'text-gray-700';
const CART_WARN_TIMER_CLASS = 'text-red-600';
const CART_NORMAL_TIMER_CLASS = 'text-gray-500';

type OwnerStoreInfo = {
  exists: boolean;
  storeName?: string;
  ownerEmail?: string;
  slug?: string;
  rib?: string | null;
};

export default function Header() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboardGuardError, setDashboardGuardError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [guardStatus, setGuardStatus] = useState<'ok' | 'pending' | 'error'>(
    () => {
      const path = window.location?.pathname || '';
      const isExempt =
        path === '/' ||
        path.startsWith('/onboarding') ||
        path.startsWith('/payment');
      if (isExempt) return 'ok';
      const segments = path.split('/').filter(Boolean);
      const slugFromPath = decodeURIComponent(segments[1] || '');
      if (slugFromPath) return 'pending';
      return 'ok';
    }
  );
  const [onboardingGuardStatus, setOnboardingGuardStatus] = useState<
    'ok' | 'pending' | 'error'
  >(() => {
    const path = window.location?.pathname || '';
    return path.startsWith('/onboarding') ? 'pending' : 'ok';
  });
  const [onboardingGuardError, setOnboardingGuardError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const apiBase = API_BASE_URL;
  const [cartOpen, setCartOpen] = useState(false);
  const [cartTotal, setCartTotal] = useState<number>(0);
  const [cartGroups, setCartGroups] = useState<
    Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      items: Array<{
        id: number;
        product_reference: string;
        value: number;
        created_at?: string;
      }>;
    }>
  >([]);
  const cartIconRef = useRef<HTMLSpanElement | null>(null);
  const cartRef = useRef<HTMLDivElement | null>(null);
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');
  const [now, setNow] = useState<number>(Date.now());
  // Garde pour éviter les appels multiples en mode Strict et re-renders
  const hasEnsuredStripeCustomerRef = useRef<boolean>(false);
  const deletingIdsRef = useRef<Set<number>>(new Set());

  // Animation d'avertissement d'expiration du panier (< 1 minute)
  const warnCartExpiration = () => {
    if (cartIconRef.current) {
      animate(
        cartIconRef.current,
        {
          color: ['#000', '#ff4d4d', '#000'],
          scale: [1, 1.1, 1],
          x: [0, -2, 2, -2, 2, 0],
        } as any,
        {
          duration: 1.5,
          easing: 'ease-in-out',
          repeat: 2,
        } as any
      );
    }
  };

  const [cartExpiryWarned, setCartExpiryWarned] = useState(false);

  useEffect(() => {
    // Déclenche l'animation si au moins un article est sous le seuil
    const ttlMsDisplay = CART_ITEM_TTL_MS;
    let hasUnderMinute = false;
    for (const group of cartGroups) {
      for (const it of group.items) {
        const created = it.created_at
          ? new Date(it.created_at).getTime()
          : null;
        const leftMs = created
          ? Math.max(0, ttlMsDisplay - (now - created))
          : ttlMsDisplay;
        if (leftMs > 0 && leftMs <= CART_WARN_THRESHOLD_MS) {
          hasUnderMinute = true;
          break;
        }
      }
      if (hasUnderMinute) break;
    }
    if (hasUnderMinute && !cartExpiryWarned) {
      warnCartExpiration();
      setCartExpiryWarned(true);
    } else if (!hasUnderMinute && cartExpiryWarned) {
      setCartExpiryWarned(false);
    }
  }, [cartGroups, now, cartExpiryWarned]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CART_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Suppression automatique des items expirés
  useEffect(() => {
    const ttlMs = CART_ITEM_TTL_MS;
    for (const group of cartGroups) {
      for (const it of group.items) {
        const created = it.created_at
          ? new Date(it.created_at).getTime()
          : null;
        const leftMs = created ? ttlMs - (now - created) : ttlMs;
        if (leftMs <= 0 && !deletingIdsRef.current.has(it.id)) {
          deletingIdsRef.current.add(it.id);
          (async () => {
            try {
              await handleDeleteItem(it.id, true);
            } finally {
              deletingIdsRef.current.delete(it.id);
            }
          })();
        }
      }
    }
  }, [cartGroups, now]);

  // 1) Vérification propriétaire supprimée du Header (slug inutile pour orders/dashboard)
  // Ancienne logique de récupération des slugs retirée pour simplification

  // Charger le panier lorsqu'on connaît stripeCustomerId
  useEffect(() => {
    const fetchCart = async () => {
      try {
        if (!stripeCustomerId) return;
        const cartResp = await fetch(
          `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(stripeCustomerId)}`
        );
        if (!cartResp.ok) return;
        const cartJson = await cartResp.json();
        setCartTotal(Number(cartJson?.grandTotal || 0));
        setCartGroups(
          Array.isArray(cartJson?.itemsByStore) ? cartJson.itemsByStore : []
        );
      } catch (_e) {
        // ignore cart errors in header
      }
    };
    fetchCart();

    const onCartUpdated = () => {
      fetchCart();
      if (cartIconRef.current) {
        animate(cartIconRef.current as any, { scale: [1, 1.2, 1] }, {
          duration: 0.4,
          easing: 'ease-out',
        } as any);
      }
    };
    window.addEventListener('cart:updated', onCartUpdated);
    return () => {
      window.removeEventListener('cart:updated', onCartUpdated);
    };
  }, [stripeCustomerId]);

  // useEffect dédié: assurer l'existence du client Stripe une seule fois
  useEffect(() => {
    const ensureStripeCustomer = async () => {
      try {
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return;

        if (stripeCustomerId) return; // déjà connu
        if (hasEnsuredStripeCustomerRef.current) return; // éviter les doublons
        hasEnsuredStripeCustomerRef.current = true;

        // Essayer de récupérer le client existant
        let stripeId: string | null = null;
        try {
          const resp = await fetch(
            `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(email)}`
          );
          if (resp.ok) {
            const json = await resp.json();
            stripeId = json?.customer?.id || null;
          }
        } catch {
          // ignore
        }

        // S'il n'existe pas, le créer côté backend (idempotent)
        if (!stripeId) {
          try {
            const token = await getToken();
            const createResp = await fetch(
              `${apiBase}/api/stripe/create-customer`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: token ? `Bearer ${token}` : '',
                },
                body: JSON.stringify({
                  name: user?.fullName || email,
                  email,
                  clerkUserId: user?.id,
                }),
              }
            );
            const createJson = await createResp.json().catch(() => ({}));
            stripeId = createJson?.stripeId || createJson?.customer?.id || null;
          } catch {
            // ignore
          }
        }

        if (stripeId) setStripeCustomerId(stripeId);
      } catch {
        // ignore
      }
    };
    ensureStripeCustomer();
  }, [user?.primaryEmailAddress?.emailAddress, stripeCustomerId]);

  // Suppression de la déduction d’accès au dashboard basée sur des slugs

  // Fermer le panier au clic en dehors
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        cartOpen &&
        cartRef.current &&
        !cartRef.current.contains(e.target as Node)
      ) {
        setCartOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [cartOpen]);

  // Garde centralisée: existence de boutique pour checkout/store, et propriété pour dashboard
  useLayoutEffect(() => {
    const checkDashboardGuard = async () => {
      const path = location.pathname || '';
      const segments = path.split('/').filter(Boolean);
      const isLanding = path === '/' || path === '';
      const isExemptRoute =
        isLanding ||
        path.startsWith('/onboarding') ||
        path.startsWith('/payment');
      const slugFromPath = decodeURIComponent(segments[1] || '');

      // Exemption: pas d’overlay ni de vérification
      if (isExemptRoute) {
        setDashboardGuardError(null);
        setGuardStatus('ok');
        return;
      }

      // Avant toute vérification, basculer en pending pour bloquer le contenu
      if (
        path === '/dashboard' ||
        path.startsWith('/dashboard/') ||
        (!path.startsWith('/dashboard/') &&
          segments.length >= 2 &&
          slugFromPath)
      ) {
        setGuardStatus('pending');
      }

      // Vérification existence générique pour toutes pages avec slug (segment 2), sauf dashboard
      if (
        !path.startsWith('/dashboard/') &&
        segments.length >= 2 &&
        slugFromPath
      ) {
        try {
          const resp = await fetch(
            `${apiBase}/api/stores/${encodeURIComponent(slugFromPath)}`
          );
          const json = await resp.json();
          if (!resp.ok || !json?.store) {
            setDashboardGuardError({
              title: 'Boutique non trouvée',
              message: `La boutique "${slugFromPath}" n'existe pas ou n'est plus disponible.`,
            });
            setGuardStatus('error');
            return;
          }
          // Boutique trouvée: pas d’erreur overlay
          setDashboardGuardError(null);
          setGuardStatus('ok');
        } catch (_e) {
          setDashboardGuardError({
            title: 'Erreur',
            message:
              'Impossible de vérifier l’existence de la boutique. Veuillez réessayer.',
          });
          setGuardStatus('error');
        }
        return;
      }

      // Vérification spécifique du dashboard sans slug: s'assurer que l'utilisateur a une boutique
      if (path === '/dashboard') {
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) {
          // Email non prêt: rester en pending jusqu'à Clerk
          return;
        }
        try {
          const resp = await fetch(
            `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
          );
          const json: OwnerStoreInfo = await resp.json();
          if (!resp.ok) {
            throw new Error(json as any);
          }
          if (!json?.exists || !json?.slug) {
            setDashboardGuardError({
              title: 'Aucune boutique',
              message:
                "Vous n'avez pas de boutique. Veuillez en créer une pour accéder au tableau de bord.",
            });
            setGuardStatus('error');
            return;
          }
          // Boutique trouvée
          setDashboardGuardError(null);
          setGuardStatus('ok');
        } catch (_e) {
          setDashboardGuardError({
            title: 'Erreur',
            message:
              'Impossible de vérifier votre boutique. Veuillez réessayer.',
          });
          setGuardStatus('error');
        }
        return;
      }

      // Autres pages: pas d’overlay
      setDashboardGuardError(null);
      setGuardStatus('ok');
    };
    checkDashboardGuard();
  }, [user, location.pathname]); // check si on doit pas mettre: user?.primaryEmailAddress?.emailAddress

  // Garde Onboarding: vérifier si l'utilisateur possède déjà une boutique
  useLayoutEffect(() => {
    const checkOnboardingGuard = async () => {
      const path = location.pathname || '';
      if (!path.startsWith('/onboarding')) {
        setOnboardingGuardStatus('ok');
        setOnboardingGuardError(null);
        return;
      }

      // Basculer en pending pendant la vérification
      setOnboardingGuardStatus('pending');

      const skipAutoRedirect = Boolean(
        (location.state as any)?.skipOnboardingRedirect
      );

      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) {
        // Si l'email n'est pas disponible (chargement Clerk), rester en pending
        return;
      }

      try {
        const resp = await fetch(
          `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
        );
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json?.error || 'Vérification propriétaire échouée');
        }
        if (json?.exists && json?.slug) {
          // Déjà propriétaire
          if (!skipAutoRedirect) {
            // Rediriger vers le dashboard sans recharger la page (chemin simple)
            navigate(`/dashboard`, {
              replace: true,
            });
            return;
          }
          // Si l'onboarding demande explicitement de rester, autoriser l'accès
          setOnboardingGuardStatus('ok');
          setOnboardingGuardError(null);
          return;
        }
        // Pas de boutique: autoriser l'accès à l'onboarding
        setOnboardingGuardStatus('ok');
        setOnboardingGuardError(null);
      } catch (_e) {
        setOnboardingGuardError({
          title: 'Erreur',
          message:
            "Impossible de vérifier votre statut d'onboarding. Veuillez réessayer.",
        });
        setOnboardingGuardStatus('error');
      }
    };
    checkOnboardingGuard();
  }, [user?.primaryEmailAddress?.emailAddress, location.pathname]);

  // Redirections centralisées selon le statut des gardes et les slugs connus
  useEffect(() => {
    const path = location.pathname || '';
    const isDashboardBase = path === '/dashboard';
    const isOrdersBase = path === '/orders';
    const isDashboard = path.startsWith('/dashboard');
    const isOrders = path.startsWith('/orders');
    const isOnboarding = path.startsWith('/onboarding');

    const skipAutoRedirect = Boolean(
      (location.state as any)?.skipOnboardingRedirect
    );

    // Attendre que les gardes aient quitté l'état pending
    if (onboardingGuardStatus === 'pending') return;

    // En cas d'erreur d'accès (boutique inexistante ou accès refusé),
    // ne pas rediriger automatiquement vers l'onboarding.
    // L'overlay d'erreur du Header s'affiche et bloque le contenu.
    if ((isDashboard || isOrders) && guardStatus === 'error') {
      return;
    }

    // Ne plus normaliser '/dashboard' ni '/orders' vers des versions avec slug

    // Redirection Onboarding -> Dashboard gérée par le garde Onboarding ci-dessus.
    // Ici, ne pas forcer de redirection pour éviter de bloquer les nouveaux utilisateurs sans boutique.
  }, [guardStatus, onboardingGuardStatus, location.pathname]);

  const handleDeleteItem = async (
    cartItemId: number,
    requireExpired?: boolean
  ) => {
    try {
      const resp = await fetch(`${apiBase}/api/carts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cartItemId,
          requireExpired: Boolean(requireExpired),
        }),
      });
      if (!resp.ok) {
        // Option: handle error toast/log
        return;
      }
      // Rafraîchir le panier via l’événement global déjà écouté
      window.dispatchEvent(new Event('cart:updated'));
    } catch (_e) {
      // ignore
    }
  };

  // Déterminer le slug de boutique pour le checkout (première boutique du panier)
  const checkoutSlug = cartGroups.find(g => g.store?.slug)?.store?.slug || null;

  return (
    <>
      <header className='bg-white shadow-sm border-b relative'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
          <div className='flex sm:justify-end justify-between items-center h-16 relative'>
            <SignedIn>
              <button
                className='mr-2 sm:mr-4 px-2 py-2 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium bg-amber-600 text-white hover:bg-amber-700'
                onClick={() => navigate('/orders')}
              >
                <span className='inline-flex items-center'>Mes commandes</span>
              </button>

              <Protect
                condition={() => {
                  const role = (user?.publicMetadata as any)?.role;
                  return role === 'owner';
                }}
              >
                <button
                  className='mr-2 sm:mr-4 px-2 py-2 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700'
                  onClick={() => navigate(`/dashboard`)}
                >
                  <span className='inline-flex items-center'>
                    Tableau de bord
                  </span>
                </button>
              </Protect>

              {/* ✅ Nouveau bloc contenant le panier + le bouton utilisateur */}
              <div className='flex items-center gap-2'>
                {/* Panier */}
                <div className='relative' ref={cartRef}>
                  <button
                    className='px-2 py-2 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium bg-slate-100 hover:bg-slate-200 text-gray-700 inline-flex items-center'
                    onClick={() => setCartOpen(prev => !prev)}
                  >
                    <span ref={cartIconRef}>
                      <ShoppingCart className='w-3 h-3 sm:w-4 sm:h-4 mr-1' />
                    </span>
                    <span>{Number(cartTotal || 0).toFixed(2)}€</span>
                  </button>
                  {cartOpen && (
                    <div className='absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-md shadow-lg z-50 p-3'>
                      <h3 className='text-sm font-semibold text-gray-900 mb-2'>
                        Panier
                      </h3>
                      {cartGroups.length === 0 ? (
                        <p className='text-sm text-gray-500'>
                          Votre panier est vide.
                        </p>
                      ) : (
                        <>
                          <div className='space-y-3 max-h-80 overflow-auto'>
                            {cartGroups.map((group, idx) => (
                              <div
                                key={idx}
                                className='border border-gray-100 rounded p-2'
                              >
                                <div className='flex justify-between items-center mb-1'>
                                  <span className='text-sm font-medium text-gray-800 truncate'>
                                    {group.store?.name || 'Boutique inconnue'}
                                  </span>
                                  <span className='text-sm text-gray-600'>
                                    {group.total.toFixed(2)}€
                                  </span>
                                </div>
                                <ul className='space-y-1'>
                                  {group.items.map((it, i) => {
                                    const created = it.created_at
                                      ? new Date(it.created_at).getTime()
                                      : null;
                                    const ttlMs = CART_ITEM_TTL_MS;
                                    const leftMs = created
                                      ? Math.max(0, ttlMs - (now - created))
                                      : ttlMs;
                                    return (
                                      <li
                                        key={i}
                                        className={`flex justify-between items-center text-sm ${leftMs <= CART_WARN_THRESHOLD_MS ? CART_WARN_TEXT_CLASS : CART_NORMAL_TEXT_CLASS}`}
                                      >
                                        <span
                                          className='truncate max-w-[60%]'
                                          title={it.product_reference}
                                        >
                                          {it.product_reference}
                                        </span>
                                        <div className='flex items-center gap-2'>
                                          {(() => {
                                            const minutes = Math.floor(
                                              leftMs / 60000
                                            );
                                            const seconds = Math.floor(
                                              (leftMs % 60000) / 1000
                                            );
                                            const label = `${minutes}:${String(seconds).padStart(2, '0')}`;
                                            return (
                                              <span
                                                className={`font-mono text-xs ${leftMs <= CART_WARN_THRESHOLD_MS ? CART_WARN_TIMER_CLASS : CART_NORMAL_TIMER_CLASS}`}
                                                title='Temps restant'
                                              >
                                                {label}
                                              </span>
                                            );
                                          })()}
                                          <span>
                                            {Number(it.value || 0).toFixed(2)}€
                                          </span>
                                          <button
                                            className='p-1 rounded hover:bg-red-50 text-red-600'
                                            title='Supprimer cette référence'
                                            aria-label='Supprimer'
                                            onClick={() =>
                                              handleDeleteItem(it.id)
                                            }
                                          >
                                            <Trash2 className='w-4 h-4' />
                                          </button>
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))}
                            <div className='flex justify-between items-center pt-2 border-t border-gray-200'>
                              <span className='text-sm font-semibold text-gray-900'>
                                Total
                              </span>
                              <span className='text-sm font-semibold text-gray-900'>
                                {Number(cartTotal || 0).toFixed(2)}€
                              </span>
                            </div>
                          </div>
                          <button
                            className={`flex items-center justify-center gap-1 mt-4 w-full  px-4 py-1.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 ${!checkoutSlug || cartGroups.length === 0 ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                            disabled={!checkoutSlug || cartGroups.length === 0}
                            onClick={() => {
                              if (checkoutSlug) {
                                navigate(`/checkout/${checkoutSlug}`);
                                setCartOpen(false);
                              }
                            }}
                          >
                            <CreditCard className='w-4 h-4 sm:w-5 sm:h-5' />
                            <span>Procéder au paiement</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Bouton utilisateur */}
                <UserButton userProfileMode='modal' />
              </div>
            </SignedIn>

            <SignedOut>
              <RedirectToSignUp />
            </SignedOut>
          </div>
        </div>
      </header>
      {/* Overlay spécifique Onboarding: bloque l'affichage pendant la vérification */}
      {location.pathname.startsWith('/onboarding') &&
        onboardingGuardStatus !== 'ok' && (
          <div className='fixed inset-0 top-16 bg-gray-50 z-40 flex items-center justify-center'>
            <div className='text-center px-4'>
              {onboardingGuardStatus === 'pending' ? (
                <Spinner
                  size='lg'
                  color='blue'
                  variant='bottom'
                  className='mx-auto mb-4'
                />
              ) : (
                <>
                  <div className='text-gray-400 text-xl mb-4'>😢</div>
                  <h2 className='text-xl font-semibold text-gray-900 mb-2'>
                    {onboardingGuardError?.title || 'Erreur'}
                  </h2>
                  <p className='text-gray-600'>
                    {onboardingGuardError?.message ||
                      'Une erreur est survenue pendant la vérification.'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      {guardStatus !== 'ok' &&
        !location.pathname.startsWith('/onboarding') &&
        location.pathname !== '/' &&
        !location.pathname.startsWith('/payment') && (
          <div className='fixed inset-0 top-16 bg-gray-50 z-40 flex items-center justify-center'>
            <div className='text-center px-4'>
              {guardStatus === 'pending' ? (
                <Spinner
                  size='lg'
                  color='blue'
                  variant='bottom'
                  className='mx-auto mb-4'
                />
              ) : (
                <>
                  <div className='text-gray-400 text-xl mb-4'>😢</div>
                  <h2 className='text-xl font-semibold text-gray-900 mb-2'>
                    {dashboardGuardError?.title}
                  </h2>
                  <p className='text-gray-600'>
                    {dashboardGuardError?.message}
                  </p>
                  {location.pathname === '/dashboard' && (
                    <div className='mt-4'>
                      <button
                        onClick={() =>
                          navigate('/onboarding', {
                            state: { skipOnboardingRedirect: true },
                          })
                        }
                        className='inline-flex items-center px-4 py-2 gap-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700'
                      >
                        <Store className='w-5 h-5' aria-hidden='true' />
                        Créer ma boutique
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
    </>
  );
}
