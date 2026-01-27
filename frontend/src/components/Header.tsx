import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import { Store } from 'lucide-react';
import Spinner from './Spinner';
import { API_BASE_URL } from '../utils/api';
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

              <div className='flex items-center gap-2'>
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
