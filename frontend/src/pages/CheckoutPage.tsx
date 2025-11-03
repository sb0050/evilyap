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
} from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';
import ParcelPointMap from '../components/ParcelPointMap';
import { ParcelPointData } from '../components/ParcelPointMap';
import { apiPost } from '../utils/api';
import { Address } from '@stripe/stripe-js';
import Header from '../components/Header';
import { Toast } from '../components/Toast';

interface Store {
  id: number;
  name: string;
  slug: string;
  description: string;
  theme: string;
  owner_email: string;
  stripe_id?: string;
  website?: string;
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
  id: string;
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
  delivery_method?: 'home_delivery' | 'pickup_point';
  parcel_point?: any;
}

export default function CheckoutPage() {
  const { storeName } = useParams<{ storeName: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useUser();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState('');
  const [amount, setAmount] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    reference: '',
  });
  const [address, setAddress] = useState<Address>();
  const [selectedParcelPoint, setSelectedParcelPoint] =
    useState<ParcelPointData>();
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
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
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
      if (!user?.primaryEmailAddress?.emailAddress || !store) return;

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/get-customer-details?customerEmail=${encodeURIComponent(
            user.primaryEmailAddress.emailAddress
          )}`
        );

        if (response.ok) {
          const data = await response.json();
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
            if (data.customer.delivery_method) {
              setDeliveryMethod(data.customer.delivery_method);
            }
            if (data.customer.parcel_point) {
              setSelectedParcelPoint(data.customer.parcel_point);
            }
            // Préselection via metadata
            const md = (data.customer as any)?.metadata || {};
            if (md.delivery_method === 'pickup_point' && md.parcel_point_code) {
              // sera appliqué après fetch des parcel points via ParcelPointMap
            }
            if (
              md.delivery_method === 'home_delivery' &&
              md.home_delivery_network
            ) {
              // Option: on peut préafficher une suggestion; le coût se recalculera lors du choix explicite.
            }
          }
        } else {
          const errText = await response.text();
          // Optionally handle non-OK statuses silently
        }
      } catch (error) {
        console.error('Erreur lors de la vérification du client:', error);
      }
    };

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
      const customerInfo = {
        email: email || user.primaryEmailAddress.emailAddress,
        name: formData.name || user.fullName || 'Client',
        phone: formData.phone || '',
        address:
          effectiveDeliveryMethod === 'home_delivery'
            ? address
            : effectiveDeliveryMethod === 'store_pickup'
              ? storePickupAddress
              : null,
        delivery_method: effectiveDeliveryMethod,
        parcel_point:
          effectiveDeliveryMethod === 'pickup_point'
            ? selectedParcelPoint
            : null,
      };

      const blankAddr = {
        line1: '',
        line2: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'FR',
      };

      // Construire la chaîne des références du panier: ref1;ref2;ref3
      const productReferencesString = (cartItemsForStore || [])
        .map(it => String(it.product_reference || '').trim())
        .filter(s => s.length > 0)
        .join(';');

      const payloadData = {
        amount: cartTotalForStore,
        currency: 'eur',
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        clerkUserId: user.id,
        storeName: store?.name ?? storeName,
        productReference: productReferencesString,
        address: address || {
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
              (formData as any).shippingOfferCode,
      };

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/stripe/create-checkout-session`,
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

      setEmbeddedClientSecret(data.clientSecret);
      setOrderCompleted(true);
      setOrderAccordionOpen(false);
      setPaymentAccordionOpen(true);
      setShowPayment(true);
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
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>
                  {store?.name ?? storeName}
                </h1>
                {store?.description && (
                  <p className='text-gray-600 mt-1'>{store.description}</p>
                )}
              </div>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-8'>
            {/* Accordéon Votre Commande */}
            <div className='bg-white rounded-lg shadow-sm'>
              <div
                className={`p-6 border-b cursor-pointer flex items-center justify-between ${
                  orderCompleted ? 'bg-gray-50' : ''
                }`}
              >
                <div className='flex items-center space-x-3'>
                  <ShoppingBag
                    className='w-6 h-6'
                    style={{ color: themeColor }}
                  />
                  <h2 className='text-xl font-semibold text-gray-900'>
                    Votre Commande
                  </h2>
                  {orderCompleted && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleModifyOrder();
                      }}
                      className='ml-4 px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 flex items-center space-x-1'
                    >
                      <Edit className='w-4 h-4' />
                      <span>Modifier</span>
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`p-6 ${orderAccordionOpen && !orderCompleted ? '' : 'hidden'}`}
              >
                <CheckoutForm
                  store={store}
                  amount={amount}
                  setAmount={setAmount}
                  embeddedClientSecret={embeddedClientSecret}
                  customerData={customerData}
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
                />
              </div>

              {orderCompleted && (
                <div className='p-6 bg-gray-50'>
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
                    <p>
                      <strong>Référence:</strong>{' '}
                      {(cartItemsForStore || [])
                        .map(it => String(it.product_reference || '').trim())
                        .filter(s => s.length > 0)
                        .join(';')}
                    </p>
                    <p>
                      <strong>Montant:</strong>{' '}
                      {Number(cartTotalForStore || 0).toFixed(2)} €
                    </p>
                    <p>
                      <strong>Livraison:</strong>{' '}
                      {deliveryMethod === 'home_delivery'
                        ? 'À domicile'
                        : deliveryMethod === 'pickup_point'
                          ? 'Point relais'
                          : 'Retrait en magasin'}
                    </p>
                    {deliveryMethod === 'home_delivery' && address && (
                      <p>
                        <strong>Adresse:</strong> {address.line1},{' '}
                        {address.city} {address.postal_code}
                      </p>
                    )}
                    {deliveryMethod === 'pickup_point' &&
                      selectedParcelPoint && (
                        <p>
                          <strong>Point relais:</strong>{' '}
                          {selectedParcelPoint.name}
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* Bouton Procéder au paiement sous l'accordéon */}
            <div className='mt-4'>
              {(!showPayment || !embeddedClientSecret) &&
                (() => {
                  const canProceed =
                    !isProcessingPayment &&
                    isFormComplete() &&
                    cartItemsForStore.length > 0;
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
}: {
  store: Store | null;
  amount: number;
  setAmount: (amount: number) => void;
  embeddedClientSecret: string;
  customerData: CustomerData | null;
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
}) {
  const stripe = useStripe();
  const elements = useElements();
  const isAddToCartDisabled =
    !Boolean((formData.reference || '').trim()) || !(amount > 0);

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
      if (!(amount > 0)) {
        return setPaymentError('Montant invalide');
      }
      const customerStripeId = customerData?.id;
      if (!customerStripeId) {
        return setPaymentError('Client Stripe introuvable');
      }
      const resp = await apiPost('/api/carts', {
        store_id: store.id,
        product_reference,
        value: amount,
        customer_stripe_id: customerStripeId,
      });
      const json = await resp.json();
      console.log('addtocart: ', json);
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
      {/* Référence de commande (obligatoire) */}
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

      {/* Montant */}
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
            // Empêcher plus de 2 décimales
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

        {/* Actions: Ajouter au panier */}
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

      {/* Adresse de livraison: carte style "Votre Commande" */}
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
            const addressKey = presetAddress ? 'addr-preset' : 'addr-empty';
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
                    allowedCountries: ['FR', 'BE', 'ES', 'DE', 'IT', 'NL'],
                    fields: {
                      phone: 'always',
                    },
                    validation: {
                      phone: {
                        required: 'always', // Rend le champ téléphone obligatoire
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

                    // Calcul du coût de livraison à domicile si la méthode active est home_delivery
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

      {/* ParcelPointMap (gère la méthode de livraison en interne et se met à jour sur changement d’adresse) */}
      <div className='mt-6'>
        {(() => {
          const preferredDeliveryMethodRaw =
            (customerData as any)?.deliveryMethod ||
            (customerData as any)?.metadata?.delivery_method ||
            deliveryMethod;
          const preferredDeliveryMethod = preferredDeliveryMethodRaw;

          return (
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
              defaultDeliveryMethod={preferredDeliveryMethod}
              defaultParcelPoint={selectedParcelPoint}
              defaultParcelPointCode={
                (customerData as any)?.parcelPointCode ||
                (customerData as any)?.metadata?.parcel_point_code ||
                (customerData?.parcel_point?.code ?? undefined)
              }
              initialDeliveryNetwork={
                (customerData as any)?.metadata?.delivery_network
              }
              disablePopupsOnMobile={true}
            />
          );
        })()}
      </div>

      {/* Bouton déplacé sous l'accordéon, pas ici */}
    </div>
  );
}
