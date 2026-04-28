import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import slugify from 'slugify';

interface StoreCheckResponse {
  exists: boolean;
  storeName?: string;
  ownerEmail?: string;
  slug?: string;
}

interface AuthRedirectProps {
  children: React.ReactNode;
}

export default function AuthRedirect({ children }: AuthRedirectProps) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkUserStore = async () => {
      if (!isLoaded) return;

      if (!user?.primaryEmailAddress?.emailAddress) {
        setChecking(false);
        return;
      }

      try {
        const token = await getToken();
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/me`,
          {
            headers: {
              Authorization: token ? `Bearer ${token}` : '',
            },
          }
        );

        if (!response.ok) {
          console.error('Erreur lors de la vérification de la boutique');
          setChecking(false);
          return;
        }

        const data = await response.json();
        const store = data?.store || null;

        if (data.hasStore && (store?.slug || store?.name)) {
          // L'utilisateur a déjà une boutique, rediriger vers checkout/<slug>
          const storeSlug =
            store.slug ||
            slugify(String(store.name || 'default'), {
              lower: true,
              strict: true,
            });
          navigate(`/checkout/${storeSlug}`);
        } else {
          // L'utilisateur n'a pas de boutique, rediriger vers onboarding
          navigate('/onboarding');
        }
      } catch (error) {
        console.error('Erreur lors de la vérification de la boutique:', error);
        setChecking(false);
      }
    };

    checkUserStore();
  }, [user, isLoaded, navigate, getToken]);

  if (!isLoaded || checking) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto'></div>
          <p className='mt-4 text-gray-600'>Vérification de votre compte...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
