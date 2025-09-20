import { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

interface StoreCheckResponse {
  exists: boolean;
  storeName?: string;
  ownerEmail?: string;
}

interface AuthRedirectProps {
  children: React.ReactNode;
}

export default function AuthRedirect({ children }: AuthRedirectProps) {
  const { user, isLoaded } = useUser();
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
        const userEmail = encodeURIComponent(user.primaryEmailAddress.emailAddress);
        const response = await fetch(`http://localhost:5000/api/stores/check-owner/${userEmail}`);
        
        if (!response.ok) {
          console.error('Erreur lors de la vérification de la boutique');
          setChecking(false);
          return;
        }

        const data: StoreCheckResponse = await response.json();
        
        if (data.exists && data.storeName) {
          // L'utilisateur a déjà une boutique, rediriger vers sa boutique
          const storeSlug = data.storeName.toLowerCase().replace(/\s+/g, '-');
          navigate(`/store/${storeSlug}`);
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
  }, [user, isLoaded, navigate]);

  if (!isLoaded || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Vérification de votre compte...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}