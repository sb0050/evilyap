import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';

interface PaymentSession {
  status: string;
  session_status?: string;
  amount?: number;
  amount_total: number;
  currency: string;
  success?: boolean;
  failed?: boolean;
  refunded?: boolean;
  refund_details?: {
    refunded: boolean;
    amount_refunded: number;
    is_partial: boolean;
    refunds: any[];
  } | null;
  payment_intent_id?: string | null;
  blocked_references?: string[];
  refunded_references?: string[];
  purchased_references?: string[];
  refund_amount?: number | null;
  customer_details?: {
    email?: string;
    name?: string;
  };
  metadata?: {
    store_name?: string;
    product_reference?: string;
  };
  reference_with_quantity?: string;
}

const PaymentReturnPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<
    'loading' | 'complete' | 'failed' | 'error' | 'refunded'
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
        const piStatus = String(data?.status || '');
        const refunded = !!data?.refunded;
        const success = !!data?.success;
        const failed =
          typeof data?.failed === 'boolean'
            ? data.failed
            : ['requires_payment_method', 'canceled', 'failed'].includes(
                piStatus
              );

        if (refunded) {
          setStatus('refunded');
          return;
        }
        if (
          success ||
          piStatus === 'succeeded' ||
          data?.session_status === 'paid'
        ) {
          setStatus('complete');
          return;
        }
        // failed: rediriger
        setStatus('failed');
        const sessionStoreName =
          data?.metadata?.store_name || (data as any)?.storeName;
        const chosenStoreName = sessionStoreName || storeName;
        const storeSlug = (chosenStoreName || 'default')
          .toLowerCase()
          .replace(/\s+/g, '-');
        setTimeout(() => {
          navigate(`/checkout/${storeSlug}?error=payment_failed`);
        }, 3000);
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
        <div>
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
        </div>
      );
    }
    if (dm === 'home_delivery') {
      return (
        <div>
          <p>
            <strong>Méthode de livraison:</strong> À domicile
          </p>
          {network && (
            <p>
              <strong>Réseau de livraison:</strong> {network}
            </p>
          )}
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
              {(() => {
                const raw =
                  (session as any)?.reference_with_quantity ||
                  session?.metadata?.product_reference ||
                  '';
                const parts = String(raw || '')
                  .split(';')
                  .map(s => String(s || '').trim())
                  .filter(s => s.length > 0);
                const formatted = parts
                  .map(p => {
                    const [ref, qty] = p.split('**');
                    const q = Number(qty || '');
                    return q > 0 ? `${ref}  (x${q})` : ref;
                  })
                  .join(' ; ');
                return formatted || '—';
              })()}
            </p>
            <DeliveryInfo />
          </div>

          <div className='mt-6 text-sm text-gray-600'>
            <p>Un email de confirmation vous a été envoyé.</p>
            <p>
              Vous recevrez également des mises à jour régulières par email
              concernant le suivi de votre colis.
            </p>
          </div>
          <div className='mt-6'>
            <button
              onClick={() => {
                navigate(`/orders`);
              }}
              className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
            >
              Suivre mes commandes
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'refunded') {
    const blockedList: string[] = Array.isArray(
      (session as any)?.blocked_references
    )
      ? ((session as any)?.blocked_references as string[])
      : [];
    const refundedRefs: string[] = Array.isArray(
      (session as any)?.refunded_references
    )
      ? ((session as any)?.refunded_references as string[])
      : [];
    const purchasedRefs: string[] = Array.isArray(
      (session as any)?.purchased_references
    )
      ? ((session as any)?.purchased_references as string[])
      : [];
    const refundDetails = (session as any)?.refund_details || null;
    const isPartial = !!refundDetails?.is_partial;
    const amt =
      refundDetails?.amount_refunded ??
      (session as any)?.refund_amount ??
      (session as any)?.amount ??
      (session as any)?.amount_total ??
      0;
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center'>
          <XCircleIcon className='h-16 w-16 text-red-500 mx-auto mb-4' />
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Paiement remboursé
          </h1>
          <p className='text-gray-600 mb-6'>
            {isPartial
              ? 'Certaines références n’étaient plus disponibles. Vous avez été partiellement remboursé.'
              : blockedList.length > 0
                ? `Certaines références de votre panier ont déjà été achetées. Vous avez été remboursé.`
                : 'Une ou plusieurs références ont déjà été achetées. Vous avez été remboursé.'}
          </p>
          <div className='text-left space-y-2'>
            <p>
              <strong>Montant remboursé:</strong>{' '}
              {formatAmount(
                Number(amt || 0),
                (session as any)?.currency || 'EUR'
              )}
            </p>
            {purchasedRefs.length > 0 && (
              <div>
                <strong>Références achetées:</strong>
                <ul className='mt-1 list-disc list-inside text-gray-700'>
                  {purchasedRefs.map(ref => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
            {refundedRefs.length > 0 && (
              <div>
                <strong>Références remboursées:</strong>
                <ul className='mt-1 list-disc list-inside text-gray-700'>
                  {refundedRefs.map(ref => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
            {blockedList.length > 0 && refundedRefs.length === 0 && (
              <div>
                <strong>Références déjà achetées:</strong>
                <ul className='mt-1 list-disc list-inside text-gray-700'>
                  {blockedList.map(ref => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              <strong>Boutique:</strong>{' '}
              {(session as any).storeName ||
                session?.metadata?.store_name ||
                '—'}
            </p>
            <p>
              <strong>Référence:</strong>{' '}
              {(() => {
                const raw =
                  (session as any)?.reference_with_quantity ||
                  session?.metadata?.product_reference ||
                  '';
                const parts = String(raw || '')
                  .split(';')
                  .map(s => String(s || '').trim())
                  .filter(s => s.length > 0);
                const formatted = parts
                  .map(p => {
                    const [ref, qty] = p.split('**');
                    const q = Number(qty || '');
                    return q > 0 ? `${ref}  (x${q})` : ref;
                  })
                  .join(' ; ');
                return formatted || '—';
              })()}
            </p>
          </div>
          <div className='mt-6'>
            <button
              onClick={() => {
                const storeSlug =
                  (session as any)?.storeName ||
                  session?.metadata?.store_name ||
                  'default';
                navigate(
                  `/checkout/${String(storeSlug || 'default')
                    .toLowerCase()
                    .replace(/\s+/g, '-')}`
                );
              }}
              className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
            >
              Retourner à la boutique
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

        <div className='space-y-3'>
          {/* Bouton unique qui calcule correctement le slug de boutique */}
          <button
            onClick={() => {
              const storeSlug = searchParams.get('store_name');
              navigate(`/checkout/${storeSlug}?error=payment_failed`);
            }}
            className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
          >
            Réessayer maintenant
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentReturnPage;
