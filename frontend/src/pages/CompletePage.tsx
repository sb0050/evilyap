import { useEffect, useState } from 'react';
import { useStripe } from '@stripe/react-stripe-js';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, ShoppingBag } from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';

const STATUS_CONTENT_MAP: any = {
  succeeded: {
    title: 'Paiement réussi !',
    message:
      'Votre commande a été confirmée. Vous recevrez un email de confirmation sous peu.',
    icon: CheckCircle,
    iconColor: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  processing: {
    title: 'Paiement en cours de traitement',
    message:
      "Votre paiement est en cours de traitement. Nous vous tiendrons informé de l'évolution.",
    icon: Clock,
    iconColor: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
  },
  requires_payment_method: {
    title: 'Paiement échoué',
    message:
      "Votre paiement n'a pas pu être traité. Veuillez réessayer avec une autre méthode de paiement.",
    icon: XCircle,
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  default: {
    title: 'Erreur de paiement',
    message:
      "Une erreur s'est produite lors du traitement de votre paiement. Veuillez réessayer.",
    icon: XCircle,
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
};

// Composant interne qui utilise les hooks Stripe
function CompletePageContent() {
  const stripe = useStripe();
  const [status, setStatus] = useState('default');
  const [intentId, setIntentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!stripe) {
      return;
    }

    // Vérifier s'il s'agit d'un retour d'Embedded Checkout
    const sessionId = searchParams.get('session_id');

    if (sessionId) {
      // Traitement pour Embedded Checkout
      // @ts-ignore
      // TO-DO
      stripe.retrieveCheckoutSession(sessionId).then(result => {
        if (result.error) {
          setStatus('default');
          setLoading(false);
          return;
        }

        const session = result.session;
        if (!session) {
          setLoading(false);
          return;
        }

        switch (session.status) {
          case 'complete':
            setStatus('succeeded');
            break;
          case 'expired':
            setStatus('requires_payment_method');
            break;
          default:
            setStatus('default');
            break;
        }

        setIntentId(session.payment_intent);
        setLoading(false);
      });
    } else {
      // Traitement pour PaymentIntent standard
      const clientSecret = searchParams.get('payment_intent_client_secret');

      if (!clientSecret) {
        setLoading(false);
        return;
      }

      stripe
        .retrievePaymentIntent(clientSecret)
        .then(({ paymentIntent }: any) => {
          if (!paymentIntent) {
            setLoading(false);
            return;
          }

          setStatus(paymentIntent.status);
          setIntentId(paymentIntent.id);
          setLoading(false);
        });
    }
  }, [stripe]);

  if (loading) {
    return (
      <div className='max-w-2xl mx-auto px-4 py-8'>
        <div className='bg-white rounded-lg shadow-md p-8'>
          <div className='text-center'>
            <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
            <p className='text-gray-600'>Vérification du paiement...</p>
          </div>
        </div>
      </div>
    );
  }

  const statusContent =
    STATUS_CONTENT_MAP[status] || STATUS_CONTENT_MAP.default;
  const StatusIcon = statusContent.icon;

  return (
    <div className='max-w-2xl mx-auto px-4 py-8'>
      <div className='text-center mb-8'>
        <ShoppingBag className='h-12 w-12 text-amber-600 mx-auto mb-4' />
        <h1 className='text-3xl font-bold text-gray-900 mb-2'>LM OUTLET</h1>
        <p className='text-gray-600'>LIVE SHOP</p>
      </div>

      <div className='bg-white rounded-lg shadow-md p-8'>
        <div
          className={`p-6 rounded-lg ${statusContent.bgColor} ${statusContent.borderColor} border mb-6`}
        >
          <div className='flex items-center'>
            <StatusIcon className={`h-8 w-8 ${statusContent.iconColor} mr-4`} />
            <div>
              <h2 className='text-xl font-semibold text-gray-900 mb-2'>
                {statusContent.title}
              </h2>
              <p className='text-gray-700'>{statusContent.message}</p>
            </div>
          </div>
        </div>

        {intentId && (
          <div className='mb-6'>
            <h3 className='text-lg font-medium text-gray-900 mb-4'>
              Détails de la transaction
            </h3>
            <div className='bg-gray-50 rounded-lg p-4'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div>
                  <p className='text-sm font-medium text-gray-500'>
                    ID de transaction
                  </p>
                  <p className='text-sm text-gray-900 font-mono'>{intentId}</p>
                </div>
                <div>
                  <p className='text-sm font-medium text-gray-500'>Statut</p>
                  <p className='text-sm text-gray-900 capitalize'>{status}</p>
                </div>
              </div>
            </div>

            {status === 'succeeded' && (
              <div className='mt-4'>
                <a
                  href={`https://dashboard.stripe.com/payments/${intentId}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='inline-flex items-center text-sm text-blue-600 hover:text-blue-800'
                >
                  Voir les détails sur Stripe
                  <svg
                    className='ml-1 h-4 w-4'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                    />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}

        <div className='flex flex-col sm:flex-row gap-4 justify-center'>
          {status === 'succeeded' ? (
            <>
              <Link
                to='/'
                className='bg-slate-700 text-white px-6 py-3 rounded-md hover:bg-slate-800 transition-colors text-center'
              >
                Retour à l'accueil
              </Link>
              <Link
                to='/orders'
                className='bg-white text-slate-700 border border-slate-300 px-6 py-3 rounded-md hover:bg-slate-50 transition-colors text-center'
              >
                Voir mes commandes
              </Link>
            </>
          ) : (
            <>
              <Link
                to='/checkout'
                className='bg-slate-700 text-white px-6 py-3 rounded-md hover:bg-slate-800 transition-colors text-center'
              >
                Réessayer le paiement
              </Link>
              <Link
                to='/'
                className='bg-white text-slate-700 border border-slate-300 px-6 py-3 rounded-md hover:bg-slate-50 transition-colors text-center'
              >
                Retour à l'accueil
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Composant principal qui wrap avec Stripe Elements
export default function CompletePage() {
  return (
    <StripeWrapper>
      <CompletePageContent />
    </StripeWrapper>
  );
}
