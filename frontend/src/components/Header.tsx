import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import { LayoutDashboard, Truck, ShoppingCart, Trash2 } from 'lucide-react';
import Spinner from './Spinner';
import { animate } from 'motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { Protect } from '@clerk/clerk-react';

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
  const [ordersSlug, setOrdersSlug] = useState<string | null>(null);
  const [dashboardSlug, setDashboardSlug] = useState<string | null>(null);
  const [canAccessDashboard, setCanAccessDashboard] = useState<boolean>(false);
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
      if (path.startsWith('/dashboard/') || slugFromPath) return 'pending';
      return 'ok';
    }
  );
  const apiBase =
    (import.meta as any).env.VITE_API_URL || 'http://localhost:5000';
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
  const deletingIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Suppression automatique des items expirés (TTL 5 minutes)
  useEffect(() => {
    const ttlMs = 5 * 60 * 1000;
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

  // Check if user is owner of any store
  useEffect(() => {
    const checkOwner = async () => {
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) return;
      try {
        const resp = await fetch(
          `${apiBase}/api/stores/check-owner/${encodeURIComponent(email)}`
        );
        if (!resp.ok) return;
        const json = await resp.json();
        if (json?.slug) {
          setOrdersSlug(json.slug);
          setDashboardSlug(json.slug);
        }
      } catch (err) {
        // Silent failure; header remains minimal
      }
    };

    const fetchCustomerStores = async () => {
      try {
        const token = await getToken();
        if (!stripeCustomerId) return;
        const resp = await fetch(
          `${apiBase}/api/shipments/stores-for-customer/${encodeURIComponent(stripeCustomerId)}`,
          {
            headers: {
              Authorization: token ? `Bearer ${token}` : '',
            },
          }
        );
        if (!resp.ok) return;
        const json = await resp.json();
        if (Array.isArray(json?.slugs) && json.slugs.length > 0) {
          setOrdersSlug(prev => prev ?? json.slugs[0]);
        }
      } catch (err) {
        // ignore
      }
    };

    checkOwner();
    fetchCustomerStores();

    const fetchCart = async () => {
      try {
        const email = user?.primaryEmailAddress?.emailAddress;
        if (!email) return;
        const resp = await fetch(
          `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(email)}`
        );
        if (!resp.ok) return;
        const json = await resp.json();
        const stripeId = json?.customer?.id;
        if (!stripeId) return;
        setStripeCustomerId(stripeId);
        const cartResp = await fetch(
          `${apiBase}/api/carts/summary?stripeId=${encodeURIComponent(stripeId)}`
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
  }, [user, dashboardSlug]);

  // Déduire l’accès au dashboard à partir du rôle + présence de slug (évite fetch redondant)
  useEffect(() => {
    const role = (user?.publicMetadata as any)?.role;
    setCanAccessDashboard(
      Boolean(dashboardSlug) && (role === 'admin' || role === 'owner')
    );
  }, [user, dashboardSlug]);

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

      // Vérification existence + propriété pour dashboard
      if (path.startsWith('/dashboard/')) {
        if (!slugFromPath) {
          setDashboardGuardError({
            title: 'Boutique non trouvée',
            message: 'Le slug de boutique est manquant dans l’URL.',
          });
          setGuardStatus('error');
          return;
        }
        const role = (user?.publicMetadata as any)?.role;
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

          const store = json.store;
          if (role === 'admin') {
            setDashboardGuardError(null);
            setGuardStatus('ok');
            return;
          }

          const ownsStore = Boolean(
            store?.clerk_id && user?.id && store.clerk_id === user.id
          );
          if (role === 'owner' && ownsStore) {
            setDashboardGuardError(null);
            setGuardStatus('ok');
            return;
          }

          setDashboardGuardError({
            title: 'Accès refusé',
            message:
              "Vous n'avez pas les droits pour accéder au tableau de bord de cette boutique.",
          });
          setGuardStatus('error');
        } catch (_e) {
          setDashboardGuardError({
            title: 'Erreur',
            message:
              'Impossible de vérifier l’accès au tableau de bord. Veuillez réessayer.',
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
  }, [user, location.pathname]);

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

  return (
    <>
      <header className='bg-white shadow-sm border-b relative'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative'>
          <div className='flex justify-end items-center h-16 relative'>
            <SignedIn>
              <button
                className={`mr-4 px-3 py-2 rounded-md text-sm font-medium ${ordersSlug ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                disabled={!ordersSlug}
                onClick={() => {
                  if (ordersSlug) navigate(`/orders/${ordersSlug}`);
                }}
              >
                <span className='inline-flex items-center'>
                  <Truck className='w-4 h-4 mr-2' />
                  Suivre mes commandes
                </span>
              </button>
              <Protect
                condition={() => {
                  // Utiliser le rôle depuis les métadonnées publiques et l’accès calculé
                  const role = (user?.publicMetadata as any)?.role;
                  return role === 'admin' || role === 'owner';
                }}
              >
                <button
                  className={`mr-4 px-3 py-2 rounded-md text-sm font-medium ${canAccessDashboard && dashboardSlug ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                  onClick={() => {
                    navigate(`/dashboard/${dashboardSlug}`);
                  }}
                >
                  <span className='inline-flex items-center'>
                    <LayoutDashboard className='w-4 h-4 mr-2' />
                    Tableau de bord
                  </span>
                </button>
              </Protect>
              {/* Panier */}
              <div className='mr-4 relative' ref={cartRef}>
                <button
                  className='px-3 py-2 rounded-md text-sm font-medium bg-slate-100 hover:bg-slate-200 text-gray-700 inline-flex items-center'
                  onClick={() => setCartOpen(prev => !prev)}
                >
                  <span ref={cartIconRef}>
                    <ShoppingCart className='w-4 h-4 mr-2' />
                  </span>
                  <span>{Number(cartTotal || 0).toFixed(2)} €</span>
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
                      <div className='space-y-3 max-h-80 overflow-auto'>
                        {cartGroups.map((group, idx) => (
                          <div
                            key={idx}
                            className='border border-gray-100 rounded p-2'
                          >
                            <div className='flex justify-between items-center mb-1'>
                              <span className='text-sm font-medium text-gray-800'>
                                {group.store?.name || 'Boutique inconnue'}
                              </span>
                              <span className='text-sm text-gray-600'>
                                {group.total.toFixed(2)} €
                              </span>
                            </div>
                            <ul className='space-y-1'>
                              {group.items.map((it, i) => {
                                const created = it.created_at
                                  ? new Date(it.created_at).getTime()
                                  : null;
                                const ttlMs = 15 * 60 * 1000; // 15 minutes
                                const leftMs = created
                                  ? Math.max(0, ttlMs - (now - created))
                                  : ttlMs;
                                return (
                                  <li
                                    key={i}
                                    className={`flex justify-between items-center text-sm ${leftMs === 10000 ? 'text-red-600' : 'text-gray-700'}`}
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
                                            className={`font-mono text-xs ${leftMs === 10000 ? 'text-red-600' : 'text-gray-500'}`}
                                            title='Temps restant'
                                          >
                                            {label}
                                          </span>
                                        );
                                      })()}
                                      <span>
                                        {Number(it.value || 0).toFixed(2)} €
                                      </span>
                                      <button
                                        className='p-1 rounded hover:bg-red-50 text-red-600'
                                        title='Supprimer cette référence'
                                        aria-label='Supprimer'
                                        onClick={() => handleDeleteItem(it.id)}
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
                            {Number(cartTotal || 0).toFixed(2)} €
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <UserButton userProfileMode='modal' />
            </SignedIn>
            <SignedOut>
              <RedirectToSignUp />
            </SignedOut>
          </div>
        </div>
      </header>
      {guardStatus !== 'ok' &&
        !location.pathname.startsWith('/onboarding') &&
        location.pathname !== '/' &&
        !location.pathname.startsWith('/payment') && (
          <div className='fixed inset-0 top-16 bg-gray-50 z-40 flex items-center justify-center'>
            <div className='text-center px-4'>
              {guardStatus === 'pending' ? (
                <Spinner size='lg' color='blue' variant='bottom' className='mx-auto mb-4' />
              ) : (
                <>
                  <div className='text-gray-400 text-xl mb-4'>😢</div>
                  <h2 className='text-xl font-semibold text-gray-900 mb-2'>
                    {dashboardGuardError?.title}
                  </h2>
                  <p className='text-gray-600'>
                    {dashboardGuardError?.message}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
    </>
  );
}
