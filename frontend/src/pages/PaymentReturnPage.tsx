import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';

interface PaymentSession {
  status: string;
  amount_total: number;
  currency: string;
  customer_details?: {
    email?: string;
    name?: string;
  };
  metadata?: {
    store_name?: string;
    product_reference?: string;
  };
}

const PaymentReturnPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<
    'loading' | 'complete' | 'failed' | 'error'
  >('loading');
  const [session, setSession] = useState<PaymentSession | null>(null);

  console.log('🚀 PaymentReturnPage component rendered');
  console.log('  Current status:', status);
  console.log('  Current session:', session);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const storeName = searchParams.get('store_name') || 'default';

    console.log('🔍 PaymentReturnPage - Debug Info:');
    console.log('  sessionId:', sessionId);
    console.log('  storeName:', storeName);
    console.log('  searchParams:', Object.fromEntries(searchParams.entries()));

    if (!sessionId) {
      console.log('❌ No sessionId found, setting status to error');
      setStatus('error');
      const sessionStoreName =
        session?.metadata?.store_name || (session as any)?.storeName;
      const chosenStoreName = sessionStoreName || storeName;
      const storeSlug = (chosenStoreName || 'default')
        .toLowerCase()
        .replace(/\s+/g, '-');
      console.log('↩️ Redirecting due to missing sessionId to:', storeSlug);
      // Rediriger vers la page checkout avec une alerte d'erreur
      setTimeout(() => {
        navigate(`/checkout/${storeSlug}?error=payment_failed`);
      }, 3000);
      return;
    }

    console.log('🔄 Fetching session details from API...');
    // Récupérer les détails de la session
    fetch(`http://localhost:5000/api/stripe/session/${sessionId}`)
      .then(response => {
        console.log('📡 API Response status:', response.status);
        return response.json();
      })
      .then(data => {
        console.log('📦 Session data received:', data);
        console.log('  data.status:', data.status);
        console.log('  data.payment_status:', data.payment_status);
        console.log('  data.metadata:', data.metadata);

        setSession(data);
        // Déterminer le statut basé sur la réponse
        if (data.status === 'complete' || data.status === 'paid') {
          console.log('✅ Payment complete, setting status to complete');
          console.log('  Status received:', data.status);
          setStatus('complete');
        } else {
          console.log('❌ Payment not complete, setting status to failed');
          console.log('  Actual status received:', data.status);
          setStatus('failed');
          const sessionStoreName =
            data?.metadata?.store_name || (data as any)?.storeName;
          const chosenStoreName = sessionStoreName || storeName;
          const storeSlug = (chosenStoreName || 'default')
            .toLowerCase()
            .replace(/\s+/g, '-');
          console.log('↩️ Redirecting after failed status to:', {
            chosenStoreName,
            storeSlug,
          });
          // Rediriger vers la page checkout avec une alerte d'erreur
          setTimeout(() => {
            navigate(`/checkout/${storeSlug}?error=payment_failed`);
          }, 3000);
        }
      })
      .catch(error => {
        console.error('💥 Error fetching session:', error);
        setStatus('error');
        const sessionStoreName =
          session?.metadata?.store_name || (session as any)?.storeName;
        const urlStoreName = searchParams.get('store_name') || 'default';
        const chosenStoreName = sessionStoreName || urlStoreName;
        const storeSlug = (chosenStoreName || 'default')
          .toLowerCase()
          .replace(/\s+/g, '-');
        console.log('↩️ Redirecting after error to:', {
          chosenStoreName,
          storeSlug,
        });
        // Rediriger vers la page checkout avec une alerte d'erreur
        setTimeout(() => {
          navigate(`/checkout/${storeSlug}?error=payment_failed`);
        }, 3000);
      });
  }, [searchParams, navigate]);

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  useEffect(() => {
    console.log('🧭 Status changed:', status);
  }, [status]);

  if (status === 'loading') {
    console.log('🔄 Rendering loading state');
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto'></div>
          <p className='mt-4 text-gray-600'>Vérification du paiement...</p>
        </div>
      </div>
    );
  }

  // @ts-ignore
  if (status === 'complete0000') {
    console.log('✅ Rendering complete state');
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center'>
          <CheckCircleIcon className='h-16 w-16 text-green-500 mx-auto mb-4' />
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Paiement effectué !
          </h1>
          <p className='text-gray-600 mb-6'>
            Merci pour votre paiement. Votre commande a été confirmée.
          </p>
          <div className='bg-green-50 border border-green-200 rounded-lg p-4 mb-6'>
            <p className='text-green-800 text-sm'>
              {formatAmount(
                session?.amount_total || 0,
                session?.currency || 'eur'
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Status failed ou error - Affichage temporaire avant redirection
  return (
    <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center'>
        <XCircleIcon className='h-16 w-16 text-red-500 mx-auto mb-4' />
        <h1 className='text-2xl font-bold text-gray-900 mb-2'>
          {status === 'error' ? 'Erreur' : 'Paiement non complété'}
        </h1>
        <p className='text-gray-600 mb-6'>
          {status === 'error'
            ? 'Une erreur est survenue lors de la vérification du paiement.'
            : "Votre paiement n'a pas été complété. Aucun montant n'a été débité."}
        </p>

        <div className='bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6'>
          <p className='text-yellow-800 text-sm'>
            � Redirection automatique vers la page de commande dans quelques
            secondes...
          </p>
        </div>

        <div className='space-y-3'>
          {/* Bouton unique qui calcule correctement le slug de boutique */}
          <button
            onClick={() => {
              const urlStoreName = searchParams.get('store_name');
              const sessionStoreName =
                session?.metadata?.store_name || (session as any)?.storeName;
              const chosenStoreName =
                sessionStoreName || urlStoreName || 'default';
              const storeSlug = chosenStoreName
                .toLowerCase()
                .replace(/\s+/g, '-');
              console.log('🔁 Retry now: redirecting to store:', {
                chosenStoreName,
                storeSlug,
              });
              navigate(`/checkout/${storeSlug}?error=payment_failed`);
            }}
            className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
          >
            Réessayer maintenant
          </button>
          <button
            onClick={() => navigate('/')}
            className='w-full bg-gray-200 text-gray-800 py-3 px-4 rounded-lg font-medium hover:bg-gray-300 transition-colors'
          >
            Retour à l'accueil
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentReturnPage;
