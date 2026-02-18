import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import slugify from 'slugify';

const toStoreSlug = (value: string) =>
  slugify(String(value || 'default'), { lower: true, strict: true });

type PurchasedLineItem = {
  title: string;
  description?: string;
  reference?: string;
  quantity: number;
  amount_total: number;
  currency: string;
  stripe_product_id?: string;
  is_delivery_regulation?: boolean;
};

interface PaymentSession {
  status: string;
  session_status?: string;
  amount?: number;
  amount_total: number;
  currency: string;
  success?: boolean;
  failed?: boolean;
  credited?: boolean;
  payment_intent_id?: string | null;
  blocked_references?: string[];
  credited_references?: string[];
  purchased_references?: string[];
  credit_amount_cents?: number | null;
  customer_details?: {
    email?: string;
    name?: string;
  };
  metadata?: {
    store_name?: string;
    product_reference?: string;
  };
  reference_with_quantity?: string;
  deliveryMethod?: string;
  deliveryNetwork?: string;
  parcelPointCode?: string;
  parcelPointName?: string;
  parcelPointNetwork?: string;
  pickup_point?: any;
  dropoff_point?: any;
  shipping_details?: any;
  line_items?: PurchasedLineItem[];
  delivery_regulation_items?: PurchasedLineItem[];
  promo_codes?: string[];
  promo_codes_store?: string[];
  promo_codes_platform?: string[];
  promo_codes_credit?: string[];
  promo_code_details?: Array<{ code: string; amount_off_cents?: number }>;
  credit_balance_used_cents?: number;
  credit_discount_total_cents?: number;
}

const PaymentReturnPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<
    'loading' | 'complete' | 'failed' | 'error' | 'credited'
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
      const storeSlug = toStoreSlug(chosenStoreName || 'default');
      // Rediriger vers la page checkout avec une alerte d'erreur
      setTimeout(() => {
        navigate(`/checkout/${storeSlug}?error=payment_failed`);
      }, 3000);
      return;
    }

    const sleep = (ms: number) =>
      new Promise(resolve => setTimeout(resolve, ms));

    const fetchSession = async (): Promise<any> => {
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/session/${sessionId}`
      );
      return await resp.json();
    };

    const run = async () => {
      try {
        let data: any = null;
        for (let attempt = 0; attempt < 12; attempt++) {
          data = await fetchSession();
          setSession(data);

          const piStatus = String(data?.status || '');
          const credited = !!data?.credited;
          const success = !!data?.success;
          const failed =
            typeof data?.failed === 'boolean'
              ? data.failed
              : ['requires_payment_method', 'canceled', 'failed'].includes(
                  piStatus
                ) || String(data?.businessStatus || '') === 'PAYMENT_FAILED';

          if (credited) {
            setStatus('credited');
            return;
          }
          if (success || piStatus === 'succeeded') {
            setStatus('complete');
            return;
          }
          if (failed) {
            setStatus('failed');
            const sessionStoreName =
              data?.metadata?.store_name || (data as any)?.storeName;
            const chosenStoreName = sessionStoreName || storeName;
            const storeSlug = toStoreSlug(chosenStoreName || 'default');
            setTimeout(() => {
              navigate(`/checkout/${storeSlug}?error=payment_failed`);
            }, 3000);
            return;
          }

          const pending = [
            'requires_capture',
            'processing',
            'requires_confirmation',
            'requires_action',
          ].includes(piStatus);
          if (!pending) break;
          await sleep(750);
        }

        setStatus('failed');
        const sessionStoreName =
          data?.metadata?.store_name || (data as any)?.storeName;
        const chosenStoreName = sessionStoreName || storeName;
        const storeSlug = toStoreSlug(chosenStoreName || 'default');
        setTimeout(() => {
          navigate(`/checkout/${storeSlug}?error=payment_failed`);
        }, 3000);
      } catch {
        setStatus('error');
        const sessionStoreName =
          session?.metadata?.store_name || (session as any)?.storeName;
        const urlStoreName = searchParams.get('store_name') || 'default';
        const chosenStoreName = sessionStoreName || urlStoreName;
        const storeSlug = toStoreSlug(chosenStoreName || 'default');
        setTimeout(() => {
          navigate(`/checkout/${storeSlug}?error=payment_failed`);
        }, 3000);
      }
    };

    run();
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
    const pickup = (session as any)?.pickup_point || null;
    const dropoff = (session as any)?.dropoff_point || null;
    const shippingDetails = (session as any)?.shipping_details || null;

    const formatAddress = (a: any): string => {
      const line1 = String(a?.line1 || a?.street || '').trim();
      const line2 = String(a?.line2 || a?.number || '').trim();
      const postal = String(a?.postal_code || a?.postalCode || '').trim();
      const city = String(a?.city || '').trim();
      const state = String(a?.state || '').trim();
      const country = String(a?.country || a?.countryIsoCode || '').trim();
      const lines = [
        [line1, line2].filter(Boolean).join(' ').trim(),
        [postal, city].filter(Boolean).join(' ').trim(),
        state,
        country,
      ]
        .map(s => String(s || '').trim())
        .filter(Boolean);
      return lines.join(', ');
    };

    if (dm === 'pickup_point') {
      const pickupAddress = pickup ? formatAddress(pickup) : '';
      const dropoffAddress =
        dropoff && dropoff !== pickup ? formatAddress(dropoff) : '';
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
          {pickupAddress && (
            <p>
              <strong>Adresse point relais:</strong> {pickupAddress}
            </p>
          )}
        </div>
      );
    }
    if (dm === 'home_delivery') {
      const addr = shippingDetails?.address || null;
      const full = addr ? formatAddress(addr) : '';
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
          {shippingDetails?.name && (
            <p>
              <strong>Destinataire:</strong> {String(shippingDetails.name)}
            </p>
          )}
          {full && (
            <p>
              <strong>Adresse:</strong> {full}
            </p>
          )}
        </div>
      );
    }
    if (dm === 'store_pickup') {
      return (
        <div>
          <p>
            <strong>Méthode de livraison:</strong> Retrait en boutique
          </p>
        </div>
      );
    }
    return null;
  };

  if (status === 'complete') {
    const items: PurchasedLineItem[] = Array.isArray(
      (session as any)?.line_items
    )
      ? ((session as any).line_items as PurchasedLineItem[])
      : [];
    const regulationItems = items.filter(
      it => !!(it as any)?.is_delivery_regulation
    );
    const purchasedItems = items.filter(
      it => !((it as any)?.is_delivery_regulation as any)
    );
    const storeCodes: string[] = Array.isArray(
      (session as any)?.promo_codes_store
    )
      ? ((session as any).promo_codes_store as string[])
      : [];
    const platformCodes: string[] = Array.isArray(
      (session as any)?.promo_codes_platform
    )
      ? ((session as any).promo_codes_platform as string[])
      : [];
    const creditCodes: string[] = Array.isArray(
      (session as any)?.promo_codes_credit
    )
      ? ((session as any).promo_codes_credit as string[])
      : [];
    const creditUsedCents = Math.max(
      0,
      Math.round(Number((session as any)?.credit_balance_used_cents || 0))
    );
    const creditDiscountTotalCents = Math.max(
      0,
      Math.round(Number((session as any)?.credit_discount_total_cents || 0))
    );

    const storeSlugFromUrlRaw = String(
      searchParams.get('store_name') || ''
    ).trim();
    const storeSlugFromUrl = storeSlugFromUrlRaw
      ? toStoreSlug(storeSlugFromUrlRaw)
      : '';
    const storeNameForSlug =
      (session as any)?.storeName || session?.metadata?.store_name || '';
    const storeSlug =
      storeSlugFromUrl || toStoreSlug(storeNameForSlug || 'default');

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

            {creditCodes.length > 0 && (
              <p>
                <strong>Code avoir:</strong> {creditCodes.join(', ')}
              </p>
            )}
            {creditCodes.length > 0 &&
              (creditUsedCents > 0 || creditDiscountTotalCents > 0) && (
                <p>
                  <strong>Solde utilisé:</strong>{' '}
                  {formatAmount(
                    creditUsedCents > 0
                      ? creditUsedCents
                      : creditDiscountTotalCents,
                    (session as any).currency || 'EUR'
                  )}
                </p>
              )}
            {storeCodes.length > 0 && (
              <p>
                <strong>Code promo boutique:</strong> {storeCodes.join(', ')}
              </p>
            )}
            {platformCodes.length > 0 && (
              <p>
                <strong>Code promo PayLive:</strong> {platformCodes.join(', ')}
              </p>
            )}
            <DeliveryInfo />
            {purchasedItems.length > 0 && (
              <div>
                <p className='font-bold text-gray-900'>Articles:</p>
                <ul className='mt-1 space-y-2 text-gray-700'>
                  {purchasedItems.map((it, idx) => (
                    <li
                      key={`${it.title}-${idx}`}
                      className='border rounded p-2'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='font-medium text-gray-900 truncate'>
                            {it.title}
                          </div>
                          {(it.reference || it.description) && (
                            <div className='text-sm text-gray-600'>
                              {it.reference ? `Réf: ${it.reference}` : ''}
                              {it.reference && it.description ? ' — ' : ''}
                              {it.description || ''}
                            </div>
                          )}
                        </div>
                        <div className='text-sm font-medium text-gray-900 whitespace-nowrap'>
                          {(() => {
                            const qty = Math.max(1, Number(it.quantity || 1));
                            const totalCents = Math.max(
                              0,
                              Math.round(Number(it.amount_total || 0))
                            );
                            const unitCents = Math.round(totalCents / qty);
                            return formatAmount(
                              unitCents,
                              it.currency || (session as any).currency || 'EUR'
                            );
                          })()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {regulationItems.length > 0 && (
              <div>
                <p className='font-semibold text-gray-900'>
                  Régulation livraison
                </p>
                <ul className='mt-1 space-y-2 text-gray-700'>
                  {regulationItems.map((it, idx) => (
                    <li
                      key={`${it.title}-${idx}`}
                      className='border rounded p-2'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='font-medium text-gray-900 truncate'>
                            {it.title}
                          </div>
                        </div>
                        <div className='text-sm font-medium text-gray-900 whitespace-nowrap'>
                          {formatAmount(
                            Math.round(
                              Math.max(0, Number(it.amount_total || 0)) /
                                Math.max(1, Number(it.quantity || 1))
                            ),
                            it.currency || (session as any).currency || 'EUR'
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className='mt-6 text-sm text-gray-600'>
            <p>Un email de confirmation vous a été envoyé.</p>
            <p>
              Vous recevrez également des mises à jour régulières par email
              concernant le suivi de votre colis.
            </p>
          </div>
          <div className='mt-6 space-y-3'>
            <button
              onClick={() => {
                navigate(`/orders`);
              }}
              className='w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors'
            >
              Suivre mes commandes
            </button>
            <button
              onClick={() => {
                navigate(`/checkout/${storeSlug}`);
              }}
              className='w-full bg-white text-gray-900 py-3 px-4 rounded-lg font-medium border border-gray-300 hover:bg-gray-50 transition-colors'
            >
              Continuer mes achats
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'credited') {
    const blockedList: string[] = Array.isArray(
      (session as any)?.blocked_references
    )
      ? ((session as any)?.blocked_references as string[])
      : [];
    const creditedRefs: string[] = Array.isArray(
      (session as any)?.credited_references
    )
      ? ((session as any)?.credited_references as string[])
      : Array.isArray((session as any)?.refunded_references)
        ? ((session as any)?.refunded_references as string[])
        : [];
    const purchasedRefs: string[] = Array.isArray(
      (session as any)?.purchased_references
    )
      ? ((session as any)?.purchased_references as string[])
      : [];
    const isPartial = creditedRefs.length > 0 && purchasedRefs.length > 0;
    const amt =
      (session as any)?.credit_amount_cents ??
      (session as any)?.refund_amount ??
      (session as any)?.amount ??
      (session as any)?.amount_total ??
      0;
    return (
      <div className='min-h-screen bg-gray-50 flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center'>
          <XCircleIcon className='h-16 w-16 text-red-500 mx-auto mb-4' />
          <h1 className='text-2xl font-bold text-gray-900 mb-2'>
            Montant ajouté à votre avoir
          </h1>
          <p className='text-gray-600 mb-6'>
            {isPartial
              ? 'Certaines références n’étaient plus disponibles. Le montant correspondant a été ajouté à votre avoir.'
              : blockedList.length > 0
                ? `Certaines références de votre panier ont déjà été achetées. Le montant correspondant a été ajouté à votre avoir.`
                : 'Une ou plusieurs références ont déjà été achetées. Le montant correspondant a été ajouté à votre avoir.'}
          </p>
          <div className='text-left space-y-2'>
            <p>
              <strong>Montant ajouté à votre avoir:</strong>{' '}
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
            {creditedRefs.length > 0 && (
              <div>
                <strong>Références créditées:</strong>
                <ul className='mt-1 list-disc list-inside text-gray-700'>
                  {creditedRefs.map(ref => (
                    <li key={ref}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}
            {blockedList.length > 0 && creditedRefs.length === 0 && (
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
                  `/checkout/${toStoreSlug(String(storeSlug || 'default'))}`
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
              const storeSlug = toStoreSlug(
                String(searchParams.get('store_name') || 'default')
              );
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
