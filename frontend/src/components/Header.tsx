import {
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
  Fragment,
  useMemo,
} from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import { RefreshCw, ShoppingCart, Store } from 'lucide-react';
import Spinner from './Spinner';
import { API_BASE_URL } from '../utils/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { Protect } from '@clerk/clerk-react';
import { Popover, Transition } from '@headlessui/react';

type OwnerStoreInfo = {
  exists: boolean;
  storeName?: string;
  ownerEmail?: string;
  slug?: string;
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
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');
  const hasEnsuredStripeCustomerRef = useRef<boolean>(false);
  const [ownerStoreInfo, setOwnerStoreInfo] = useState<OwnerStoreInfo | null>(
    null
  );
  const [cartSummaryLoading, setCartSummaryLoading] = useState(false);
  const [cartItemsByStore, setCartItemsByStore] = useState<
    Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      suggestedWeight: number;
      items: Array<{
        id: number;
        product_reference: string;
        value: number;
        quantity?: number;
        description?: string;
      }>;
    }>
  >([]);
  const [selectedStoreSlug, setSelectedStoreSlug] = useState<string>('');
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

  useEffect(() => {
    const loadOwnerStoreInfo = async () => {
      try {
        if (!stripeCustomerId) return;
        const resp = await fetch(
          `${apiBase}/api/stores/check-owner-by-stripe/${encodeURIComponent(
            stripeCustomerId
          )}`
        );
        const json = (await resp.json().catch(() => null)) as OwnerStoreInfo;
        if (!resp.ok) return;
        setOwnerStoreInfo(json && typeof json === 'object' ? json : null);
      } catch {
        // ignore
      }
    };
    loadOwnerStoreInfo();
  }, [stripeCustomerId]);

  const formatEur = (value: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);

  const isDeliveryRegulationText = (text: unknown) => {
    const normalized = String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return /\b(?:regulation|regularisation)\s+livraison\b/i.test(normalized);
  };

  const parseActiveStoreSlug = () => {
    const path = String(location.pathname || '');
    const parts = path.split('/').filter(Boolean);
    if (
      parts.length >= 2 &&
      (parts[0] === 'store' || parts[0] === 'checkout')
    ) {
      return decodeURIComponent(parts[1] || '');
    }
    return '';
  };

  const filteredCartItemsByStore = useMemo(() => {
    const out = (cartItemsByStore || [])
      .map(g => {
        const items = Array.isArray(g?.items)
          ? g.items.filter(
              it =>
                (it as any)?.payment_id == null &&
                !isDeliveryRegulationText(it?.product_reference) &&
                !isDeliveryRegulationText((it as any)?.description)
            )
          : [];
        return { ...g, items };
      })
      .filter(g => Array.isArray(g?.items) && g.items.length > 0);
    return out;
  }, [cartItemsByStore]);

  const refreshCartSummary = async () => {
    const sid = String(stripeCustomerId || '').trim();
    if (!sid) {
      setCartItemsByStore([]);
      return;
    }
    try {
      setCartSummaryLoading(true);
      const resp = await fetch(
        `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(sid)}`
      );
      if (!resp.ok) return;
      const json = await resp.json().catch(() => null as any);
      const groups = Array.isArray(json?.itemsByStore) ? json.itemsByStore : [];
      setCartItemsByStore(groups);
    } catch {
    } finally {
      setCartSummaryLoading(false);
    }
  };

  useEffect(() => {
    refreshCartSummary();
  }, [stripeCustomerId]);

  useEffect(() => {
    const onUpdated = () => refreshCartSummary();
    window.addEventListener('cart:updated', onUpdated as any);
    return () => window.removeEventListener('cart:updated', onUpdated as any);
  }, [stripeCustomerId]);

  useEffect(() => {
    const active = String(parseActiveStoreSlug() || '').trim();
    const available = filteredCartItemsByStore
      .map(g => String(g?.store?.slug || '').trim())
      .filter(Boolean);
    const next =
      (active && available.includes(active) && active) ||
      (selectedStoreSlug && available.includes(selectedStoreSlug)
        ? selectedStoreSlug
        : available[0] || '');
    if (next !== selectedStoreSlug) setSelectedStoreSlug(next);
  }, [location.pathname, filteredCartItemsByStore]);

  const currentGroup =
    filteredCartItemsByStore.find(
      g =>
        String(g?.store?.slug || '').trim() ===
        String(selectedStoreSlug || '').trim()
    ) || null;

  const currentItems = Array.isArray(currentGroup?.items)
    ? currentGroup!.items
    : [];
  const currentTotal = currentItems.reduce((sum, it) => {
    const qty = Math.max(1, Number(it?.quantity || 1));
    return sum + Number(it?.value || 0) * qty;
  }, 0);
  const totalItemsCount = filteredCartItemsByStore.reduce(
    (sum, g) =>
      sum +
      (Array.isArray(g?.items)
        ? g.items.reduce(
            (acc: number, it: any) =>
              acc + Math.max(1, Number(it?.quantity || 1)),
            0
          )
        : 0),
    0
  );
  const hideCartPopover =
    String(location.pathname || '').startsWith('/checkout') ||
    String(location.pathname || '').startsWith('/dashboard');

  // Suppression de la déduction d’accès au dashboard basée sur des slugs

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
        try {
          let json: OwnerStoreInfo | null = null;
          if (stripeCustomerId) {
            const resp = await fetch(
              `${apiBase}/api/stores/check-owner-by-stripe/${encodeURIComponent(
                stripeCustomerId
              )}`
            );
            json = (await resp.json().catch(() => null)) as OwnerStoreInfo;
            if (!resp.ok) {
              throw new Error((json as any) || 'Erreur');
            }
          } else {
            const email = user?.primaryEmailAddress?.emailAddress;
            if (!email) {
              return;
            }
            const resp = await fetch(
              `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
            );
            json = (await resp.json().catch(() => null)) as OwnerStoreInfo;
            if (!resp.ok) {
              throw new Error((json as any) || 'Erreur');
            }
          }
          setOwnerStoreInfo(json && typeof json === 'object' ? json : null);
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
  }, [user, stripeCustomerId, location.pathname]); // check si on doit pas mettre: user?.primaryEmailAddress?.emailAddress

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

      try {
        let json: any = null;
        if (stripeCustomerId) {
          const resp = await fetch(
            `${apiBase}/api/stores/check-owner-by-stripe/${encodeURIComponent(
              stripeCustomerId
            )}`
          );
          json = await resp.json().catch(() => null);
          if (!resp.ok) {
            throw new Error(json?.error || 'Vérification propriétaire échouée');
          }
        } else {
          const email = user?.primaryEmailAddress?.emailAddress;
          if (!email) {
            return;
          }
          const resp = await fetch(
            `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
          );
          json = await resp.json().catch(() => null);
          if (!resp.ok) {
            throw new Error(json?.error || 'Vérification propriétaire échouée');
          }
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
  }, [
    user?.primaryEmailAddress?.emailAddress,
    stripeCustomerId,
    location.pathname,
  ]);

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

  const handleDeleteItem = async (cartItemId: number) => {
    try {
      const resp = await fetch(`${apiBase}/api/carts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cartItemId,
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

              {Boolean(ownerStoreInfo?.exists) && (
                <button
                  className='mr-2 sm:mr-4 px-2 py-2 sm:px-3 sm:py-2 rounded-md text-xs sm:text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700'
                  onClick={() => navigate(`/dashboard`)}
                >
                  <span className='inline-flex items-center'>
                    Tableau de bord
                  </span>
                </button>
              )}

              <div className='flex items-center gap-2'>
                {!hideCartPopover ? (
                  <Popover className='relative'>
                    {({ open }) => (
                      <>
                        <Popover.Button
                          onClick={() => {
                            refreshCartSummary();
                          }}
                          className='relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        >
                          <ShoppingCart
                            className='w-5 h-5'
                            aria-hidden='true'
                          />
                          {totalItemsCount > 0 ? (
                            <span className='absolute -top-1 -right-1 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold'>
                              {totalItemsCount}
                            </span>
                          ) : null}
                        </Popover.Button>
                        <Transition
                          as={Fragment}
                          show={open}
                          enter='transition ease-out duration-150'
                          enterFrom='opacity-0 translate-y-1'
                          enterTo='opacity-100 translate-y-0'
                          leave='transition ease-in duration-100'
                          leaveFrom='opacity-100 translate-y-0'
                          leaveTo='opacity-0 translate-y-1'
                        >
                          <Popover.Panel className='absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50'>
                            <div className='p-4 border-b border-gray-100'>
                              <div className='flex items-center justify-between gap-3'>
                                <div className='min-w-0'>
                                  <div className='text-sm font-semibold text-gray-900'>
                                    Panier
                                  </div>
                                  <div className='text-xs text-gray-500 truncate'>
                                    {currentGroup?.store?.name ||
                                      'Sélectionnez une boutique'}
                                  </div>
                                </div>
                                <button
                                  type='button'
                                  onClick={() => refreshCartSummary()}
                                  disabled={cartSummaryLoading}
                                  className='inline-flex items-center px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600'
                                >
                                  <RefreshCw
                                    className={`w-4 h-4 mr-1 ${cartSummaryLoading ? 'animate-spin' : ''}`}
                                  />
                                  <span>Recharger</span>
                                </button>
                              </div>

                              {filteredCartItemsByStore.length > 1 ? (
                                <div className='mt-3'>
                                  <select
                                    value={selectedStoreSlug}
                                    onChange={e => {
                                      setSelectedStoreSlug(e.target.value);
                                    }}
                                    className='w-full h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-900'
                                  >
                                    {filteredCartItemsByStore
                                      .filter(g => Boolean(g?.store?.slug))
                                      .map(g => (
                                        <option
                                          key={String(g.store?.slug || '')}
                                          value={String(g.store?.slug || '')}
                                        >
                                          {g.store?.name || g.store?.slug}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              ) : null}
                            </div>

                            <div className='p-4'>
                              {currentItems.length === 0 ? (
                                <div className='text-sm text-gray-600'>
                                  Votre panier est vide.
                                </div>
                              ) : (
                                <>
                                  <div className='mt-3 max-h-[280px] overflow-auto divide-y divide-gray-100'>
                                    {currentItems.map(it => {
                                      const id = Number(it?.id || 0);
                                      const title =
                                        String(it?.description || '').trim() ||
                                        String(
                                          it?.product_reference || ''
                                        ).trim();
                                      const ref = String(
                                        it?.product_reference || ''
                                      ).trim();
                                      const qty = Math.max(
                                        1,
                                        Number(it?.quantity || 1)
                                      );
                                      const price = Number(it?.value || 0);
                                      return (
                                        <div
                                          key={id || ref}
                                          className='py-3 flex gap-3'
                                        >
                                          <div className='min-w-0 flex-1'>
                                            <div className='text-sm font-medium text-gray-900 truncate'>
                                              {title}
                                            </div>
                                            <div className='text-xs text-gray-500 truncate'>
                                              Réf: {ref} • Qté: {qty}
                                            </div>
                                          </div>
                                          <div className='text-sm font-semibold text-gray-900'>
                                            {price > 0
                                              ? formatEur(price * qty)
                                              : '—'}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  <div className='mt-4 flex items-center justify-between'>
                                    <div className='text-sm text-gray-700'>
                                      Total panier
                                    </div>
                                    <div className='text-sm font-semibold text-gray-900'>
                                      {formatEur(currentTotal)}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>

                            <div className='p-4 border-t border-gray-100'>
                              <button
                                disabled={
                                  !selectedStoreSlug ||
                                  currentItems.length === 0
                                }
                                onClick={() => {
                                  navigate(
                                    `/checkout/${encodeURIComponent(
                                      selectedStoreSlug
                                    )}`
                                  );
                                }}
                                className='w-full inline-flex items-center justify-center px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60'
                              >
                                Procéder au paiement
                              </button>
                            </div>
                          </Popover.Panel>
                        </Transition>
                      </>
                    )}
                  </Popover>
                ) : null}
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
