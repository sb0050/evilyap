import { useEffect, useState } from 'react';
import {
  RedirectToSignUp,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
  useAuth,
} from '@clerk/clerk-react';
import { LayoutDashboard, Truck } from 'lucide-react';
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
  }, [user, dashboardSlug]);

  return (
    <header className='bg-white shadow-sm border-b'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex justify-end items-center h-16'>
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
