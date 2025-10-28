import { useEffect, useState, useRef } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import { LayoutDashboard, Truck, ShoppingCart, Trash2 } from 'lucide-react';
import { animate } from 'motion';
import { useNavigate } from 'react-router-dom';

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
  const [isOwner, setIsOwner] = useState(false);
  const [ordersSlug, setOrdersSlug] = useState<string | null>(null);
  const [dashboardSlug, setDashboardSlug] = useState<string | null>(null);
  const [canAccessDashboard, setCanAccessDashboard] = useState<boolean>(false);
  const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  const [cartOpen, setCartOpen] = useState(false);
  const [cartTotal, setCartTotal] = useState<number>(0);
  const [cartGroups, setCartGroups] = useState<
    Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      items: Array<{ id: number; product_reference: string; value: number }>;
    }>
  >([]);
  const cartIconRef = useRef<HTMLSpanElement | null>(null);
  const cartRef = useRef<HTMLDivElement | null>(null);
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');

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
        setIsOwner(Boolean(json?.exists));
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
        if (!user?.id) return;
        const resp = await fetch(
          `${apiBase}/api/shipments/stores-for-customer/${user.id}`,
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

    const checkDashboardAccess = async () => {
      const role = (user?.publicMetadata as any)?.role;
      if (!role || !dashboardSlug) {
        setCanAccessDashboard(false);
        return;
      }
      if (role === 'admin') {
        setCanAccessDashboard(Boolean(dashboardSlug));
        return;
      }
      if (role === 'owner') {
        try {
          const resp = await fetch(
            `${apiBase}/api/stores/${encodeURIComponent(dashboardSlug)}`
          );
          const json = await resp.json();
          if (resp.ok && json?.store?.clerk_id && user?.id) {
            setCanAccessDashboard(json.store.clerk_id === user.id);
          } else {
            setCanAccessDashboard(false);
          }
        } catch (_e) {
          setCanAccessDashboard(false);
        }
        return;
      }
      setCanAccessDashboard(false);
    };

    checkOwner();
    fetchCustomerStores();
    checkDashboardAccess();
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

  const handleDeleteItem = async (cartItemId: number) => {
    try {
      const resp = await fetch(`${apiBase}/api/carts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cartItemId }),
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
            {(user?.publicMetadata as any)?.role === 'owner' && (
              <button
                className={`mr-4 px-3 py-2 rounded-md text-sm font-medium ${canAccessDashboard && dashboardSlug ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                disabled={!canAccessDashboard || !dashboardSlug}
                onClick={() => {
                  if (canAccessDashboard && dashboardSlug) {
                    navigate(`/dashboard/${dashboardSlug}`);
                  }
                }}
              >
                <span className='inline-flex items-center'>
                  <LayoutDashboard className='w-4 h-4 mr-2' />
                  Tableau de bord
                </span>
              </button>
            )}
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
                            {group.items.map((it, i) => (
                              <li
                                key={i}
                                className='flex justify-between items-center text-sm text-gray-700'
                              >
                                <span
                                  className='truncate max-w-[60%]'
                                  title={it.product_reference}
                                >
                                  {it.product_reference}
                                </span>
                                <div className='flex items-center gap-2'>
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
                            ))}
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
  );
}
