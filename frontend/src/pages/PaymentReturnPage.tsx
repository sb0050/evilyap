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

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    const storeName = searchParams.get('store_name') || 'default';

    if (!sessionId) {
      setStatus('error');
      const sessionStoreName =
        session?.metadata?.store_name || (session as any)?.storeName;
      const chosenStoreName = sessionStoreName || storeName;
      const storeSlug = (chosenStoreName || 'default')
        .toLowerCase()
        .replace(/\s+/g, '-');
      // Rediriger vers la page checkout avec une alerte d'erreur
      setTimeout(() => {
        navigate(`/checkout/${storeSlug}?error=payment_failed`);
      }, 3000);
      return;
    }

    // Récupérer les détails de la session
    fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/session/${sessionId}`
    )
      .then(response => {
        return response.json();
      })
      .then(data => {
        setSession(data);
        // Déterminer le statut basé sur la réponse
        if (data.status === 'complete' || data.status === 'paid') {
          setStatus('complete');
        } else {
          setStatus('failed');
          const sessionStoreName =
            data?.metadata?.store_name || (data as any)?.storeName;
          const chosenStoreName = sessionStoreName || storeName;
          const storeSlug = (chosenStoreName || 'default')
            .toLowerCase()
            .replace(/\s+/g, '-');
          // Rediriger vers la page checkout avec une alerte d'erreur
          setTimeout(() => {
            navigate(`/checkout/${storeSlug}?error=payment_failed`);
          }, 3000);
        }
      })
      .catch(() => {
        setStatus('error');
        const sessionStoreName =
          session?.metadata?.store_name || (session as any)?.storeName;
        const urlStoreName = searchParams.get('store_name') || 'default';
        const chosenStoreName = sessionStoreName || urlStoreName;
        const storeSlug = (chosenStoreName || 'default')
          .toLowerCase()
          .replace(/\s+/g, '-');
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

  if (status === 'loading') {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto'></div>
          <p className='mt-4 text-gray-600'>Vérification du paiement...</p>
        </div>
      </div>
    );
  }

  const DeliveryInfo: React.FC = () => {
    if (!session) return null;
    const dm = (session as any).deliveryMethod;
    const code = (session as any).parcelPointCode;
    const name = (session as any).parcelPointName;
    const network = (session as any).parcelPointNetwork;
    if (dm === 'pickup_point') {
      return (
        <div className='mt-4 text-sm text-gray-700'>
          <p>
            <strong>Méthode de livraison:</strong> Point relais
          </p>
          {name && (
            <p>
              <strong>Point relais:</strong> {name}
              {code ? ` (code ${code})` : ''}
              {network ? ` - réseau ${network}` : ''}
            </p>
          )}
          <p className='text-gray-600'>
            Vous recevrez régulièrement des emails de suivi du colis.
          </p>
          <p className='text-gray-600'>
            Délai indicatif: 3 à 5 jours selon le réseau sélectionné.
          </p>
        </div>
      );
    }
    if (dm === 'home_delivery') {
      return (
        <div className='mt-4 text-sm text-gray-700'>
          <p>
            <strong>Méthode de livraison:</strong> À domicile
          </p>
          {network && (
            <p>
              <strong>Réseau de livraison:</strong> {network}
            </p>
          )}
          <p className='text-gray-600'>
            Vous recevrez régulièrement des emails de suivi du colis.
          </p>
          <p className='text-gray-600'>
            Délai indicatif: 48h à 6 jours selon le réseau choisi.
          </p>
        </div>
      );
    }
    return null;
  };

  if (status === 'complete') {
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center'>
          <CheckCircleIcon className='h-16 w-16 text-green-500 mx-auto mb-4' />
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Paiement réussi
          </h1>
          <p className='text-gray-600 mb-6'>Merci pour votre commande.</p>
          <div className='text-left space-y-2'>
            <p>
              <strong>Montant payé:</strong>{' '}
              {formatAmount(
                (session as any).amount || (session as any).amount_total || 0,
                (session as any).currency || 'EUR'
              )}
            </p>
            <p>
              <strong>Boutique:</strong>{' '}
              {(session as any).storeName ||
                session?.metadata?.store_name ||
                '—'}
            </p>
            <p>
              <strong>Référence:</strong>{' '}
              {(session as any).reference ||
                session?.metadata?.product_reference ||
                '—'}
            </p>
          </div>
          <DeliveryInfo />
          <div className='mt-6 text-sm text-gray-600'>
            <p>Un email de confirmation vous a été envoyé.</p>
            <p>
              Vous recevrez également des mises à jour régulières par email
              concernant le suivi de votre colis.
            </p>
          </div>
          <div className='mt-6'>
            <button
              onClick={() => navigate('/')}
              className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
            >
              Retour à l’accueil
            </button>
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
