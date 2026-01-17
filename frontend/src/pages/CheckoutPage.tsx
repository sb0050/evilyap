import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  useStripe,
  useElements,
  AddressElement,
} from '@stripe/react-stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { useUser } from '@clerk/clerk-react';
import {
  ShoppingBag,
  MapPin,
  User,
  ExternalLink,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Edit,
  ShoppingCart,
  BadgeCheck,
} from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';
import ParcelPointMap from '../components/ParcelPointMap';
import { ParcelPointData } from '../components/ParcelPointMap';
import { apiPost, API_BASE_URL } from '../utils/api';
import { Address } from '@stripe/stripe-js';
import Header from '../components/Header';
import { Toast } from '../components/Toast';
import { search } from 'fast-fuzzy';

interface Store {
  id: number;
  name: string;
  slug: string;
  description: string;
  theme: string;
  owner_email: string;
  stripe_id?: string;
  website?: string;
  is_verified?: boolean;
  address?: {
    city?: string;
    line1?: string;
    line2?: string;
    country?: string;
    postal_code?: string;
    phone?: string;
  } | null;
}

interface CustomerData {
  id?: string;
  name?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  shipping?: any;
  delivery_method?: 'home_delivery' | 'pickup_point' | 'store_pickup';
  parcel_point?: any;
  metadata?: any;
}

export default function CheckoutPage() {
  const { storeName } = useParams<{ storeName: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useUser();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [customerDetailsLoaded, setCustomerDetailsLoaded] = useState(false);
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState('');
  const [amount, setAmount] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    reference: '',
    description: '',
  });
  const [address, setAddress] = useState<Address>();
  const [selectedParcelPoint, setSelectedParcelPoint] =
    useState<ParcelPointData | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<
    'home_delivery' | 'pickup_point' | 'store_pickup'
  >('pickup_point');
  const [isFormValid, setIsFormValid] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [email, setEmail] = useState('');
  const [showDelivery, setShowDelivery] = useState(false);
  const [stripeCustomerId, setStripeCustomerId] = useState<string>('');
  const [cartItemsForStore, setCartItemsForStore] = useState<
    Array<{
      id: number;
      product_reference: string;
      value: number;
      created_at?: string;
    }>
  >([]);
  const [cartTotalForStore, setCartTotalForStore] = useState<number>(0);

  const [storePickupAddress, setStorePickupAddress] = useState<
    Address | undefined
  >();
  const [storePickupPhone, setStorePickupPhone] = useState<
    string | undefined
  >();
  const [deliveryCost, setDeliveryCost] = useState<number>(0);
  const [selectedWeight, setSelectedWeight] = useState<string>('250g');
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
    visible?: boolean;
  } | null>(null);

  // useEffect de debug pour surveiller selectedParcelPoint
  useEffect(() => {
    // Debug supprimé
  }, [selectedParcelPoint, deliveryMethod, isFormValid]);

  // Charger le panier pour ce store
  useEffect(() => {
    const apiBase = API_BASE_URL;
    const fetchCartForStore = async () => {
      try {
        const userEmail = user?.primaryEmailAddress?.emailAddress;
        if (!userEmail || !store?.id) return;
        const resp = await fetch(
          `${apiBase}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(userEmail)}`
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
        const groups = Array.isArray(cartJson?.itemsByStore)
          ? cartJson.itemsByStore
          : [];
        const groupForStore = groups.find(
          (g: any) => g?.store?.id && store?.id && g.store.id === store.id
        );
        if (groupForStore) {
          setCartItemsForStore(groupForStore.items || []);
          setCartTotalForStore(Number(groupForStore.total || 0));
          const suggested = String(groupForStore?.suggestedWeight || '').trim();
          if (suggested && ['500g', '1kg', '2kg'].includes(suggested) && true) {
            setSelectedWeight(prev => {
              if (
                !prev ||
                prev === '250g' ||
                !['500g', '1kg', '2kg'].includes(prev)
              ) {
                return suggested;
              }
              return prev;
            });
          }
        } else {
          setCartItemsForStore([]);
          setCartTotalForStore(0);
        }
      } catch (_e) {
        // ignore
      }
    };
    fetchCartForStore();
    const onCartUpdated = () => fetchCartForStore();
    if (typeof window !== 'undefined') {
      window.addEventListener('cart:updated', onCartUpdated);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('cart:updated', onCartUpdated);
      }
    };
  }, [user, store]);

  // Alimente automatiquement la référence avec les références agrégées du panier
  // Désactivé: ne pas écraser la saisie manuelle de la référence
  // Les valeurs agrégées seront affichées uniquement dans le récapitulatif

  // Alimente automatiquement le montant avec le total du panier
  // Désactivé: ne pas écraser la saisie manuelle du montant
  // Le total agrégé du panier sera affiché uniquement dans le récapitulatif

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'error'
  ) => {
    setToast({ message, type, visible: true });
    setTimeout(() => {
      setToast(prev => (prev ? { ...prev, visible: false } : prev));
      setTimeout(() => setToast(null), 300);
    }, 4000);
  };

  useEffect(() => {
    if (!email && user?.primaryEmailAddress?.emailAddress) {
      setEmail(user.primaryEmailAddress.emailAddress);
    }
  }, [user]);

  // États pour les accordéons
  const [orderAccordionOpen, setOrderAccordionOpen] = useState(true);
  const [paymentAccordionOpen, setPaymentAccordionOpen] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isEditingDelivery, setIsEditingDelivery] = useState(false);
  const [shippingHasBeenModified, setShippingHasBeenModified] = useState(false);

  useEffect(() => {
    const fetchStore = async () => {
      if (!storeName) {
        setError('Nom de boutique manquant');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stores/${encodeURIComponent(storeName)}`
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Erreur lors du chargement de la boutique'
          );
        }

        setStore(data.store);
        const addr = data.store?.address;
        if (addr && typeof addr === 'object') {
          const mapped: Address = {
            city: addr.city || undefined,
            country: addr.country || undefined,
            line1: addr.line1 || undefined,
            line2: addr.line2 || undefined,
            postal_code: addr.postal_code || undefined,
            state: addr.state || undefined,
          };
          setStorePickupAddress(
            mapped.line1 && mapped.postal_code && mapped.city
              ? mapped
              : undefined
          );
          setStorePickupPhone(addr.phone || undefined);
        } else {
          setStorePickupAddress(undefined);
          setStorePickupPhone(undefined);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchStore();
  }, [storeName]);

  useEffect(() => {
    const amountParam = searchParams.get('amount');
    if (amountParam) {
      const parsedAmount = parseFloat(amountParam);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        setAmount(parsedAmount);
        setAmountInput(parsedAmount.toString());
      }
    }
  }, [searchParams]);

  useEffect(() => {
    const checkExistingCustomer = async () => {
      if (!user?.primaryEmailAddress?.emailAddress || !store) {
        setCustomerDetailsLoaded(true);
        return;
      }

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
            user.primaryEmailAddress.emailAddress
          )}`
        );

        if (response.ok) {
          const data = await response.json();
          console.log('Customer data:', data.customer);
          if (data.customer) {
            setCustomerData(data.customer);
            if (data.customer.name) {
              setFormData(prev => ({ ...prev, name: data.customer.name }));
            }
            if (data.customer.phone) {
              setFormData(prev => ({ ...prev, phone: data.customer.phone }));
            }
            if (data.customer.address) {
              setAddress(data.customer.address);
            } else if (data.customer?.metadata?.delivery_method) {
              setDeliveryMethod(
                data.customer.metadata.delivery_method as
                  | 'home_delivery'
                  | 'pickup_point'
              );
            }
            if ((data.customer as any)?.deliveryMethod) {
              setDeliveryMethod((data.customer as any).deliveryMethod);
            }
            setSelectedParcelPoint(null);
            // Préselection via metadata
            const md = (data.customer as any)?.metadata || {};
            if (md.delivery_method === 'pickup_point' && md.parcel_point) {
              // sera appliqué après fetch des parcel points via ParcelPointMap
            }
            if (md.delivery_method === 'home_delivery' && md.delivery_network) {
              // Option: on peut préafficher une suggestion; le coût se recalculera lors du choix explicite.
            }
            if (
              (md.delivery_method === 'home_delivery' ||
                data.customer.delivery_method === 'home_delivery') &&
              md.delivery_network &&
              !(formData as any).shippingOfferCode
            ) {
              setFormData(prev => ({
                ...prev,
                shippingOfferCode: md.delivery_network,
              }));
            }
          }
        } else {
          const errText = await response.text();
          // Optionally handle non-OK statuses silently
        }
      } catch (error) {
        console.error('Erreur lors de la vérification du client:', error);
      } finally {
        setCustomerDetailsLoaded(true);
      }
    };

    setCustomerDetailsLoaded(false);
    checkExistingCustomer();
  }, [user, store]);

  const isFormComplete = () => {
    const hasEmail = Boolean((email || '').trim());
    const hasDeliveryInfo =
      deliveryMethod === 'home_delivery'
        ? Boolean(
            address &&
              (address as any)?.line1 &&
              (formData as any).shippingOfferCode
          )
        : deliveryMethod === 'pickup_point'
          ? Boolean(selectedParcelPoint)
          : deliveryMethod === 'store_pickup'
            ? Boolean(storePickupAddress?.line1)
            : false;
    const hasContactInfo =
      Boolean((formData.name || '').trim()) &&
      Boolean((formData.phone || '').trim());

    return hasEmail && hasDeliveryInfo && hasContactInfo;
  };

  const handleProceedToPayment = async () => {
    if (
      (!isFormComplete() && cartItemsForStore.length === 0) ||
      !store ||
      !user?.primaryEmailAddress?.emailAddress
    )
      return;

    setIsProcessingPayment(true);

    try {
      // Ajout automatique au panier si référence et montant renseignés

      const effectiveDeliveryMethod:
        | 'home_delivery'
        | 'pickup_point'
        | 'store_pickup' = deliveryMethod;

      const md = (customerData as any) || {};
      const customerInfo = {
        email: email || user.primaryEmailAddress.emailAddress,
        name: (formData.name || md.name || user.fullName || 'Client') as string,
        phone: (formData.phone || md.phone || '') as string,
        address:
          effectiveDeliveryMethod === 'home_delivery'
            ? address || (customerData?.address as any) || null
            : effectiveDeliveryMethod === 'store_pickup'
              ? storePickupAddress
              : null,
        delivery_method: effectiveDeliveryMethod,
        parcel_point:
          effectiveDeliveryMethod === 'pickup_point'
            ? selectedParcelPoint
            : null,
      };

      const payloadItems = (cartItemsForStore || []).map(it => ({
        reference: String(it.product_reference || '').trim(),
        description: String((it as any).description || '').trim(),
        price: Number(it.value || 0),
      }));

      const payloadData = {
        shippingHasBeenModified: shippingHasBeenModified,
        amount: cartTotalForStore,
        currency: 'eur',
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        clerkUserId: user.id,
        storeName: store?.name ?? storeName,
        items: payloadItems,
        address: address ||
          customerInfo.address ||
          (customerData?.address as any) || {
            line1: '',
            line2: '',
            city: '',
            state: '',
            postal_code: '',
            country: 'FR',
          },
        deliveryMethod: effectiveDeliveryMethod,
        parcelPoint:
          effectiveDeliveryMethod === 'pickup_point'
            ? selectedParcelPoint || null
            : null,
        phone: customerInfo.phone,
        deliveryCost,
        cartItemIds: (cartItemsForStore || []).map(it => it.id),
        selectedWeight,
        deliveryNetwork:
          effectiveDeliveryMethod === 'store_pickup'
            ? 'STORE_PICKUP'
            : selectedParcelPoint?.shippingOfferCode ||
              (formData as any)?.shippingOfferCode ||
              (md.deliveryNetwork as any) ||
              ((md.metadata || {})?.delivery_network as any) ||
              '',
      };

      console.log('payloadData', payloadData);

      const response = await fetch(
        `${
          import.meta.env.VITE_API_URL || 'http://localhost:5000'
        }/api/stripe/create-checkout-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadData),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'Erreur lors de la création de la session'
        );
      }

      setDeliveryMethod(effectiveDeliveryMethod);
      if (effectiveDeliveryMethod === 'home_delivery' && address) {
        setCustomerData(prev => ({
          ...(prev || {}),
          address: address as any,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network:
              (formData as any)?.shippingOfferCode ||
              (prev as any)?.metadata?.delivery_network ||
              '',
          },
        }));
      } else if (
        effectiveDeliveryMethod === 'pickup_point' &&
        selectedParcelPoint
      ) {
        const loc = (selectedParcelPoint as any)?.location;
        const fallbackShipAddr =
          ((customerData as any)?.shipping?.address as any) || {};
        const shipAddr = {
          line1:
            loc?.street ||
            fallbackShipAddr?.street ||
            fallbackShipAddr?.line1 ||
            '',
          line2:
            loc?.number ||
            fallbackShipAddr?.number ||
            fallbackShipAddr?.line2 ||
            '',
          city: loc?.city || fallbackShipAddr?.city || '',
          state: loc?.state || fallbackShipAddr?.state || '',
          postal_code:
            loc?.postalCode ||
            fallbackShipAddr?.postalCode ||
            fallbackShipAddr?.postal_code ||
            '',
          country:
            loc?.countryIsoCode ||
            fallbackShipAddr?.countryIsoCode ||
            fallbackShipAddr?.country ||
            'FR',
        };
        setCustomerData(prev => ({
          ...(prev || {}),
          shipping: {
            name:
              (selectedParcelPoint as any)?.name ||
              (prev as any)?.shipping?.name,
            phone: customerInfo.phone,
            address: shipAddr,
          },
          parcel_point: selectedParcelPoint,
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network:
              selectedParcelPoint.shippingOfferCode ||
              (formData as any)?.shippingOfferCode ||
              (prev as any)?.metadata?.delivery_network ||
              '',
            parcel_point_code:
              selectedParcelPoint.code ||
              (prev as any)?.metadata?.parcel_point_code ||
              '',
          },
        }));
      } else if (effectiveDeliveryMethod === 'store_pickup') {
        setCustomerData(prev => ({
          ...(prev || {}),
          name: customerInfo.name,
          phone: customerInfo.phone,
          delivery_method: effectiveDeliveryMethod,
          metadata: {
            ...((prev as any)?.metadata || {}),
            delivery_method: effectiveDeliveryMethod,
            delivery_network: 'STORE_PICKUP',
          },
        }));
      }

      setEmbeddedClientSecret(data.clientSecret);
      setOrderCompleted(true);
      setOrderAccordionOpen(false);
      setPaymentAccordionOpen(true);
      setShowPayment(true);
      setIsEditingDelivery(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      setPaymentError(msg);
      showToast(msg, 'error');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleModifyOrder = () => {
    setOrderCompleted(false);
    setOrderAccordionOpen(true);
    setPaymentAccordionOpen(false);
    setShowPayment(false);
    setIsEditingOrder(true);
    setIsEditingDelivery(false);
    setFormData(prev => ({
      ...prev,
      reference: '',
      description: '',
    }));
    setAmount(0);
    setAmountInput('');
    setEmbeddedClientSecret('');
  };

  const handleModifyDelivery = () => {
    setOrderCompleted(false);
    setOrderAccordionOpen(true);
    setPaymentAccordionOpen(false);
    setShowPayment(false);
    setIsEditingOrder(false);
    setIsEditingDelivery(true);
    setEmbeddedClientSecret('');
  };

  if (loading) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <p className='text-gray-600'>Chargement de la boutique...</p>
        </div>
      </div>
    );
  }

  // Les erreurs d’existence de boutique sont désormais gérées par l’overlay du Header

  const themeColor = '#667eea';

  const cloudBase = (
    import.meta.env.VITE_CLOUDFRONT_URL ||
    'https://d1tmgyvizond6e.cloudfront.net'
  ).replace(/\/+$/, '');
  const storeLogo = store?.id ? `${cloudBase}/images/${store.id}` : undefined;

  return (
    <StripeWrapper>
      <Header />
      <div className='min-h-screen bg-gray-50 py-8'>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            visible={toast.visible !== false}
          />
        )}
        <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8'>
          {/* En-tête de la boutique */}
          <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
            <div className='flex items-center space-x-4'>
              {storeLogo ? (
                <img
                  src={storeLogo}
                  alt={store?.name}
                  className='w-16 h-16 rounded-lg object-cover'
                />
              ) : (
                <div className='w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center'>
                  <ShoppingBag className='w-8 h-8 text-gray-500' />
                </div>
              )}
              <div className='min-w-0'>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2 min-w-0'>
                  <h1
                    className='text-2xl font-bold text-gray-900 truncate max-w-full'
                    title={store?.name ?? storeName}
                  >
                    {store?.name ?? storeName}
                  </h1>
                </div>
                {store?.description && (
                  <p
                    className='text-gray-600 mt-1'
                    title={store.description}
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {store.description}
                  </p>
                )}
                {store?.is_verified ? (
                  <div
                    title="Le SIRET de la boutique a été vérifié via l'INSEE"
                    className='inline-flex items-center gap-1 mt-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium size-fit'
                  >
                    <BadgeCheck className='w-3 h-3' /> Boutique Vérifiée
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-8'>
            {/* Accordéon Votre Commande */}
            <div className=' rounded-lg shadow-sm'>
              {!orderCompleted && (
                <div className='p-6 border-b flex items-center justify-between'>
                  <div className='flex items-center space-x-3'>
                    <ShoppingBag
                      className='w-6 h-6'
                      style={{ color: themeColor }}
                    />
                    <h2 className='text-xl font-semibold text-gray-900'>
                      Votre Commande
                    </h2>
                  </div>
                </div>
              )}

              <div className='p-6'>
                <CheckoutForm
                  store={store}
                  amount={amount}
                  setAmount={setAmount}
                  embeddedClientSecret={embeddedClientSecret}
                  customerData={customerData}
                  customerDetailsLoaded={customerDetailsLoaded}
                  formData={formData}
                  setFormData={setFormData}
                  address={address}
                  setAddress={setAddress}
                  storePickupAddress={storePickupAddress}
                  storePickupPhone={storePickupPhone}
                  selectedParcelPoint={selectedParcelPoint}
                  setSelectedParcelPoint={setSelectedParcelPoint}
                  deliveryMethod={deliveryMethod}
                  setDeliveryMethod={setDeliveryMethod}
                  isFormValid={isFormValid}
                  setIsFormValid={setIsFormValid}
                  isProcessingPayment={isProcessingPayment}
                  setIsProcessingPayment={setIsProcessingPayment}
                  amountInput={amountInput}
                  setAmountInput={setAmountInput}
                  user={user}
                  paymentError={paymentError}
                  setPaymentError={setPaymentError}
                  showPayment={showPayment}
                  setShowPayment={setShowPayment}
                  isFormComplete={isFormComplete}
                  handleProceedToPayment={handleProceedToPayment}
                  email={email}
                  setEmail={setEmail}
                  themeColor={themeColor}
                  deliveryCost={deliveryCost}
                  setDeliveryCost={setDeliveryCost}
                  selectedWeight={selectedWeight}
                  setSelectedWeight={setSelectedWeight}
                  showDelivery={showDelivery}
                  setShowDelivery={setShowDelivery}
                  showToast={showToast}
                  shippingHasBeenModified={shippingHasBeenModified}
                  setShippingHasBeenModified={setShippingHasBeenModified}
                  isEditingDelivery={isEditingDelivery}
                  isEditingOrder={isEditingOrder}
                  cartItemsCount={cartItemsForStore.length}
                />
              </div>

              {orderCompleted && (
                <>
                  <div className='p-6 bg-gray-50'>
                    <div className='flex items-center justify-between mb-2'>
                      <h3 className='text-base font-semibold text-gray-900'>
                        Votre commande
                      </h3>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleModifyOrder();
                        }}
                        className='px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center space-x-1'
                      >
                        <Edit className='w-4 h-4' />
                        <span>Modifier</span>
                      </button>
                    </div>
                    <div className='text-sm text-gray-600 space-y-2'>
                      <p>
                        <strong>Nom:</strong> {formData.name}
                      </p>
                      <p>
                        <strong>Téléphone:</strong> {formData.phone}
                      </p>
                      <p>
                        <strong>Email:</strong> {email}
                      </p>
                      <div className='mt-2'>
                        <strong>Articles:</strong>
                        <ul className='mt-1 space-y-1'>
                          {(cartItemsForStore || []).map(it => (
                            <li key={it.id} className='flex justify-between'>
                              <span>
                                {(() => {
                                  const ref = String(
                                    it.product_reference || ''
                                  ).trim();
                                  const desc = String(
                                    (it as any).description || ''
                                  ).trim();
                                  return desc ? `${ref} — ${desc}` : ref;
                                })()}
                              </span>
                              <span>{Number(it.value || 0).toFixed(2)} €</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className='p-6 bg-gray-50 mt-4'>
                    <div className='flex items-center justify-between mb-2'>
                      <h3 className='text-base font-semibold text-gray-900'>
                        Méthode de livraison
                      </h3>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleModifyDelivery();
                        }}
                        className='px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center space-x-1'
                      >
                        <Edit className='w-4 h-4' />
                        <span>Modifier</span>
                      </button>
                    </div>
                    <div className='text-sm text-gray-600 space-y-2'>
                      <p>
                        <strong>Type:</strong>{' '}
                        {deliveryMethod === 'home_delivery'
                          ? 'À domicile'
                          : deliveryMethod === 'pickup_point'
                            ? 'Point relais'
                            : 'Retrait en magasin'}
                      </p>
                      {deliveryMethod === 'home_delivery' && (
                        <>
                          {(() => {
                            const homeAddr =
                              address || (customerData?.address as any);
                            return homeAddr ? (
                              <p>
                                <strong>Adresse:</strong> {homeAddr.line1}
                                {homeAddr.line2
                                  ? `, ${homeAddr.line2}`
                                  : ''}, {homeAddr.postal_code} {homeAddr.city}
                              </p>
                            ) : null;
                          })()}
                          {(() => {
                            const mdNet = (customerData as any)?.metadata
                              ?.delivery_network;
                            const offer =
                              (formData as any)?.shippingOfferCode || '';
                            const code = mdNet || offer;
                            return code ? (
                              <p>
                                <strong>Réseau domicile:</strong> {code}
                              </p>
                            ) : null;
                          })()}
                        </>
                      )}
                      {deliveryMethod === 'pickup_point' && (
                        <>
                          {(() => {
                            const ship = (customerData as any)?.shipping;
                            const name =
                              ship?.name || selectedParcelPoint?.name || null;
                            const addr =
                              ship?.address || selectedParcelPoint?.location;
                            return name || addr ? (
                              <>
                                {name && (
                                  <p>
                                    <strong>Point relais:</strong> {name}
                                  </p>
                                )}
                                {addr && (
                                  <p className='text-xs'>
                                    {addr.number ? `${addr.number} ` : ''}
                                    {addr?.street || addr.line1}
                                    {addr.line2 ? `, ${addr.line2}` : ''}
                                    {addr.postalCode || addr.postal_code
                                      ? `, ${
                                          addr.postalCode || addr.postal_code
                                        }`
                                      : ''}
                                    {addr.city ? ` ${addr.city}` : ''}
                                  </p>
                                )}
                              </>
                            ) : null;
                          })()}
                        </>
                      )}
                      {deliveryMethod === 'store_pickup' &&
                        storePickupAddress && (
                          <p>
                            <strong>Adresse magasin:</strong>{' '}
                            {storePickupAddress.line1}
                            {storePickupAddress.line2
                              ? `, ${storePickupAddress.line2}`
                              : ''}
                            , {storePickupAddress.postal_code}{' '}
                            {storePickupAddress.city}
                          </p>
                        )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bouton Procéder au paiement sous l'accordéon */}
            <div className='mt-4'>
              {(!showPayment || !embeddedClientSecret) &&
                (() => {
                  const savedMethod =
                    (customerData as any)?.deliveryMethod ||
                    (customerData as any)?.delivery_method ||
                    (customerData as any)?.metadata?.delivery_method ||
                    null;
                  const hasItems = cartItemsForStore.length > 0;
                  const deliveryIsValid =
                    isEditingDelivery || savedMethod ? true : isFormComplete();

                  const canProceed = hasItems && deliveryIsValid;

                  
                  const btnColor = canProceed ? '#0074D4' : '#6B7280';
                  return (
                    <button
                      onClick={handleProceedToPayment}
                      disabled={!canProceed}
                      className='w-full py-3.5 px-4 rounded-md font-medium text-white transition-all duration-200 flex items-center justify-center space-x-2 shadow-md focus:ring-2 focus:ring-offset-2'
                      style={{ backgroundColor: btnColor, lineHeight: '1.5' }}
                    >
                      {isProcessingPayment ? (
                        <>
                          <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-white'></div>
                          <span>Traitement...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className='w-5 h-5' />
                          <span>Procéder au paiement</span>
                        </>
                      )}
                    </button>
                  );
                })()}
              {!isFormComplete() && cartItemsForStore.length === 0 && (
                <p className='text-sm text-gray-500 text-center mt-2'>
                  Veuillez compléter tous les champs pour continuer
                </p>
              )}
            </div>

            {/* Carte de paiement (EmbeddedCheckout) */}
            {showPayment && embeddedClientSecret && (
              <div className='bg-white rounded-lg shadow-sm p-6'>
                <div className='flex items-center space-x-3 mb-4'>
                  <CreditCard
                    className='w-6 h-6'
                    style={{ color: themeColor }}
                  />
                  <h2 className='text-xl font-semibold text-gray-900'>
                    Paiement
                  </h2>
                </div>
                <PaymentAccordionContent clientSecret={embeddedClientSecret} />
              </div>
            )}
          </div>
        </div>
      </div>
    </StripeWrapper>
  );
}

function PaymentAccordionContent({ clientSecret }: { clientSecret: string }) {
  const stripe = useStripe();
  return (
    <EmbeddedCheckoutProvider stripe={stripe} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

function CheckoutForm({
  store,
  amount,
  setAmount,
  embeddedClientSecret,
  customerData,
  customerDetailsLoaded,
  formData,
  setFormData,
  address,
  setAddress,
  storePickupAddress,
  storePickupPhone,
  selectedParcelPoint,
  setSelectedParcelPoint,
  deliveryMethod,
  setDeliveryMethod,
  isFormValid,
  setIsFormValid,
  isProcessingPayment,
  setIsProcessingPayment,
  amountInput,
  setAmountInput,
  user,
  paymentError,
  setPaymentError,
  showPayment,
  setShowPayment,
  isFormComplete,
  handleProceedToPayment,
  email,
  setEmail,
  themeColor,
  deliveryCost,
  setDeliveryCost,
  selectedWeight,
  setSelectedWeight,
  showDelivery,
  setShowDelivery,
  showToast,
  isEditingDelivery,
  shippingHasBeenModified,
  setShippingHasBeenModified,
  isEditingOrder,
  cartItemsCount,
}: {
  store: Store | null;
  amount: number;
  setAmount: (amount: number) => void;
  embeddedClientSecret: string;
  customerData: CustomerData | null;
  customerDetailsLoaded: boolean;
  formData: any;
  setFormData: any;
  address: any;
  setAddress: any;
  storePickupAddress: any;
  storePickupPhone: string | undefined;
  selectedParcelPoint: any;
  setSelectedParcelPoint: any;
  deliveryMethod: 'home_delivery' | 'pickup_point' | 'store_pickup';
  setDeliveryMethod: any;
  isFormValid: boolean;
  setIsFormValid: any;
  isProcessingPayment: boolean;
  setIsProcessingPayment: any;
  amountInput: string;
  setAmountInput: any;
  user: any;
  paymentError: string | null;
  setPaymentError: any;
  showPayment: boolean;
  setShowPayment: any;
  isFormComplete: () => boolean;
  handleProceedToPayment: () => void;
  email: string;
  setEmail: any;
  themeColor: string;
  deliveryCost: number;
  setDeliveryCost: any;
  selectedWeight: string;
  setSelectedWeight: any;
  showDelivery: boolean;
  setShowDelivery: (val: boolean) => void;
  showToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  isEditingDelivery: boolean;
  shippingHasBeenModified: boolean;
  setShippingHasBeenModified: (val: boolean) => void;
  isEditingOrder: boolean;
  cartItemsCount: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const isAddToCartDisabled =
    !Boolean((formData.reference || '').trim()) ||
    !(amount > 0) ||
    !Boolean(String((formData as any).description || '').trim());

  const hasDeliveryMethod = (() => {
    const md = (customerData as any)?.metadata || {};
    return Boolean(
      (customerData as any)?.deliveryMethod ||
        (customerData as any)?.delivery_method ||
        md.delivery_method
    );
  })();

  const hasCartItems = cartItemsCount > 0;

  const showOrderFields = !showPayment;

  const showDeliveryFields = (() => {
    if (isEditingOrder) return false;
    if (isEditingDelivery) return true;
    if (hasDeliveryMethod && !hasCartItems) return false;
    if (!hasDeliveryMethod && hasCartItems) return true;
    if (hasDeliveryMethod && hasCartItems) return false;
    return true;
  })();

  if (!store) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <p className='text-gray-600'>Chargement de la boutique...</p>
        </div>
      </div>
    );
  }

  const computeHomeDeliveryCost = (
    addr: Address | undefined,
    weight: string
  ) => {
    const country = addr?.country || 'FR';
    const base = country === 'FR' ? 4 : 6;
    let extra = 0;
    if (weight === '500g') extra = 1.5;
    else if (weight === '1000g') extra = 4;
    return base + extra;
  };

  const addToCart = async () => {
    try {
      if (!store?.id) {
        return setPaymentError('Boutique invalide');
      }
      const product_reference = (formData.reference || '').trim();
      if (!product_reference) {
        return setPaymentError('Référence requise');
      }
      const descriptionRaw = String((formData as any).description || '').trim();
      if (!descriptionRaw) {
        return setPaymentError('Description requise');
      }
      if (!(amount > 0)) {
        return setPaymentError('Montant invalide');
      }
      const customerStripeId = customerData?.id;
      if (!customerStripeId) {
        return setPaymentError('Client Stripe introuvable');
      }
      const normalizeText = (text: string) =>
        text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();
      const DICT = [
        'robe',
        'jupe',
        'pantalon',
        'jean',
        'tailleur',
        'chemise',
        'chemisier',
        'blouse',
        'top',
        'tshirt',
        'tee',
        'shirt',
        'debardeur',
        'gilet',
        'cardigan',
        'pull',
        'sweat',
        'sweatshirt',
        'veste',
        'manteau',
        'trench',
        'doudoune',
        'parka',
        'short',
        'combinaison',
        'ensemble',
        'long',
        'epais',
        'hiver',
        'manches',
        'longues',
        'courtes',
        'manche',
        'coton',
        'lin',
        'laine',
        'soie',
        'satin',
        'velours',
        'dentelle',
        'double',
        'col',
        'v',
        'roule',
      ];
      const correctTypos = (text: string) => {
        const base = normalizeText(text || '');
        const tokens = base.split(/\s+/).filter(Boolean);
        const corrected = tokens.map(tok => {
          if (tok.length < 3) return tok;
          const res = search(tok, DICT, {
            threshold: 0.7,
            returnMatchData: true,
          } as any) as any[];
          if (Array.isArray(res) && res.length > 0) {
            const best = res[0];
            return String(best.item || tok);
          }
          return tok;
        });
        for (let i = 0; i < corrected.length - 1; i++) {
          const a = corrected[i];
          const b = corrected[i + 1];
          if (a === 'manche' && b === 'longue') {
            corrected[i] = 'manche longue';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'manches' && b === 'longues') {
            corrected[i] = 'manches longues';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'manches' && b === 'courtes') {
            corrected[i] = 'manches courtes';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'tee' && b === 'shirt') {
            corrected[i] = 'tshirt';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 't' && b === 'shirt') {
            corrected[i] = 'tshirt';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'col' && b === 'v') {
            corrected[i] = 'col v';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
          if (a === 'col' && b === 'roule') {
            corrected[i] = 'col roule';
            corrected.splice(i + 1, 1);
            i--;
            continue;
          }
        }
        return corrected.join(' ');
      };
      const normalizedDescription = correctTypos(
        (formData as any).description || ''
      );
      const resp = await apiPost('/api/carts', {
        store_id: store.id,
        product_reference,
        value: amount,
        customer_stripe_id: customerStripeId,
        description: normalizedDescription || null,
      });
      const json = await resp.json();

      if (resp.status === 409) {
        const msg =
          json?.message || 'Cette reference existe déjà dans un autre panier';
        setPaymentError(msg);
        showToast('Cette reference existe déjà dans un autre panier', 'error');
        return;
      }
      if (!resp.ok) {
        const msg =
          json?.message || json?.error || "Erreur lors de l'ajout au panier";
        setPaymentError(msg);
        showToast(msg, 'error');
        return;
      }
      setPaymentError(null);
      showToast('Ajouté au panier pour une durée de 15 minutes', 'success');
      // Notifier le header de rafraîchir le panier
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cart:updated'));
      }
    } catch (e: any) {
      const rawMsg = e?.message || "Erreur lors de l'ajout au panier";
      setPaymentError(rawMsg);
      if (typeof rawMsg === 'string' && rawMsg.includes('reference_exists')) {
        showToast('Cette reference existe déjà dans un autre panier', 'error');
      } else {
        try {
          const match =
            typeof rawMsg === 'string' ? rawMsg.match(/\{.*\}/) : null;
          const parsed = match ? JSON.parse(match[0]) : null;
          const finalMsg = parsed?.message || rawMsg;
          showToast(finalMsg, 'error');
        } catch {
          showToast(rawMsg, 'error');
        }
      }
    }
  };

  return (
    <div className='space-y-6'>
      {showOrderFields && (
        <>
          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Référence de commande
            </label>
            <input
              type='text'
              value={formData.reference}
              onChange={e =>
                setFormData({ ...formData, reference: e.target.value })
              }
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
              style={{ lineHeight: '1.5' }}
              placeholder='Votre référence'
              required
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Description
            </label>
            <textarea
              value={(formData as any).description}
              onChange={e =>
                setFormData({ ...formData, description: e.target.value })
              }
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
              style={{ lineHeight: '1.5' }}
              placeholder='Détails (taille, couleur, etc.)'
              rows={3}
              required
            />
          </div>

          <div>
            <label className='block text-sm font-medium text-gray-700 mb-2'>
              Montant à payer (€)
            </label>
            <input
              type='number'
              step='0.01'
              min='0.01'
              value={amountInput}
              onChange={e => {
                let raw = e.target.value.replace(',', '.');
                const parts = raw.split('.');
                if (parts.length === 2) {
                  parts[1] = parts[1].slice(0, 2);
                  raw = `${parts[0]}.${parts[1]}`;
                }
                setAmountInput(raw);
                const value = parseFloat(raw);
                if (!isNaN(value) && value > 0) {
                  setAmount(value);
                } else {
                  setAmount(0);
                }
              }}
              onBlur={() => {
                if (amount > 0) {
                  setAmountInput(amount.toFixed(2));
                }
              }}
              className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300`}
              style={{ lineHeight: '1.5' }}
              placeholder='0.00'
              required
            />

            <div className='mt-3 flex flex-col sm:flex-row gap-3'>
              <button
                type='button'
                disabled={isAddToCartDisabled}
                onClick={addToCart}
                className='flex items-center justify-center gap-1 mt-4 w-full sm:w-auto px-4 py-2.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600'
              >
                <ShoppingCart className='w-4 h-4 mr-1' />
                <span>Ajouter au panier</span>
              </button>
            </div>
          </div>
        </>
      )}

      {showDeliveryFields && customerDetailsLoaded && (
        <div className='bg-white rounded-lg shadow-sm'>
          <div className='pb-6 pt-6 border-b flex items-center space-x-3'>
            <MapPin className='w-6 h-6' style={{ color: themeColor }} />
            <h2 className='text-xl font-semibold text-gray-900'>
              Votre adresse de livraison
            </h2>
          </div>
          <div className='pt-6'>
            {(() => {
              const defaultName = user?.fullName || '';
              const defaultPhone = customerData?.phone || '';
              const presetAddress = (customerData?.address as any) || undefined;
              const addressKey = presetAddress
                ? `addr-${[
                    presetAddress.line1,
                    presetAddress.postal_code,
                    presetAddress.city,
                    presetAddress.country,
                  ]
                    .map(v => String(v || ''))
                    .join('|')}`
                : 'addr-empty';
              const addressIncomplete = !(
                (formData.name || '').trim() &&
                (formData.phone || '').trim() &&
                (address as any)?.line1 &&
                (address as any)?.postal_code
              );

              return (
                <div
                  className={`rounded-md border ${
                    addressIncomplete ? 'border-red-500' : 'border-gray-300'
                  } p-2`}
                >
                  <AddressElement
                    key={addressKey}
                    options={{
                      mode: 'shipping',
                      allowedCountries: ['FR', 'BE', 'CH'],
                      fields: {
                        phone: 'always',
                      },
                      validation: {
                        phone: {
                          required: 'always',
                        },
                      },
                      defaultValues: {
                        name: defaultName,
                        phone: defaultPhone,
                        address: presetAddress,
                      },
                    }}
                    onChange={(event: any) => {
                      const { name, phone, address: addr } = event.value || {};
                      if (typeof name === 'string') {
                        setFormData((prev: any) => ({ ...prev, name }));
                      }
                      if (typeof phone === 'string') {
                        setFormData((prev: any) => ({ ...prev, phone }));
                      }

                      setAddress(addr || undefined);
                      setIsFormValid(!!event.complete);

                      if (deliveryMethod === 'home_delivery') {
                        const cost = computeHomeDeliveryCost(
                          addr as Address | undefined,
                          selectedWeight
                        );
                        setDeliveryCost(cost);
                      }
                    }}
                  />
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ParcelPointMap (gère la méthode de livraison en interne et se met à jour sur changement d’adresse) */}
      <div className='mt-6'>
        {showDeliveryFields && customerDetailsLoaded
          ? (() => {
              const md = (customerData as any)?.metadata || {};
              const savedMethod =
                (customerData as any)?.deliveryMethod ||
                (customerData as any)?.delivery_method ||
                md.delivery_method ||
                null;
              const preferredDeliveryMethodRaw =
                (customerData as any)?.deliveryMethod ||
                (customerData as any)?.metadata?.delivery_method ||
                deliveryMethod;
              const preferredDeliveryMethod = preferredDeliveryMethodRaw;

              const hasParcelPoint =
                Boolean(selectedParcelPoint) ||
                Boolean((customerData as any)?.parcel_point) ||
                Boolean((customerData as any)?.shipping?.parcel_point) ||
                Boolean(md.parcel_point_code) ||
                Boolean((customerData as any)?.parcelPointCode);

              const showMap = isEditingDelivery || !Boolean(savedMethod);

              return (
                showMap && (
                  <ParcelPointMap
                    address={address}
                    storePickupAddress={storePickupAddress}
                    storePickupPhone={storePickupPhone}
                    storeWebsite={store?.website}
                    onParcelPointSelect={(
                      point,
                      method,
                      cost,
                      weight,
                      shippingOfferCode
                    ) => {
                      setShippingHasBeenModified(true);
                      if (typeof shippingOfferCode === 'string') {
                        
                        setFormData((prev: any) => ({
                          ...prev,
                          shippingOfferCode,
                        }));

                        if (point) {
                          setSelectedParcelPoint({
                            ...point,
                            shippingOfferCode,
                          });
                        } else {
                          setSelectedParcelPoint(null);
                        }
                      } else {
                        setSelectedParcelPoint(point);
                        setFormData((prev: any) => ({
                          ...prev,
                          shippingOfferCode: null,
                        }));
                      }

                      setDeliveryMethod(method);
                      if (typeof cost === 'number') setDeliveryCost(cost);
                      if (typeof weight === 'string') setSelectedWeight(weight);
                      setIsFormValid(true);
                    }}
                    defaultDeliveryMethod={deliveryMethod}
                    defaultParcelPoint={selectedParcelPoint}
                    defaultParcelPointCode={
                      (customerData as any)?.parcelPointCode ||
                      (customerData as any)?.metadata?.parcel_point ||
                      (customerData?.parcel_point?.code ?? undefined)
                    }
                    initialDeliveryNetwork={
                      (customerData as any)?.metadata?.delivery_network
                    }
                    disablePopupsOnMobile={true}
                  />
                )
              );
            })()
          : null}
      </div>

      {/* Bouton déplacé sous l'accordéon, pas ici */}
    </div>
  );
}
