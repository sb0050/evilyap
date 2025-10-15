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
} from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';
import ParcelPointMap from '../components/ParcelPointMap';
import { ParcelPointData } from '../components/ParcelPointMap';
import { apiPost } from '../utils/api';
import { Address } from '@stripe/stripe-js';

interface Store {
  id: number;
  name: string;
  logo: string;
  description: string;
  theme: string;
  owner_email: string;
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
    'home_delivery' | 'pickup_point'
  >('home_delivery');
  const [isFormValid, setIsFormValid] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [email, setEmail] = useState('');

  const [deliveryCost, setDeliveryCost] = useState<number>(0);
  const [selectedWeight, setSelectedWeight] = useState<string>('250g');
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'info' | 'success';
  } | null>(null);

  // useEffect de debug pour surveiller selectedParcelPoint
  useEffect(() => {
    // Debug supprimé
  }, [selectedParcelPoint, deliveryMethod, isFormValid]);

  const showToast = (
    message: string,
    type: 'error' | 'info' | 'success' = 'error'
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
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
    const hasReference = Boolean((formData.reference || '').trim());
    const hasEmail = Boolean((email || '').trim());
    const hasAmount = amount > 0;
    const hasDeliveryInfo =
      deliveryMethod === 'home_delivery'
        ? Boolean(address && (address as any)?.line1 && (formData as any).shippingOfferCode)
        : Boolean(selectedParcelPoint);
    const hasContactInfo =
      Boolean((formData.name || '').trim()) &&
      Boolean((formData.phone || '').trim());

    return (
      hasReference && hasEmail && hasAmount && hasDeliveryInfo && hasContactInfo
    );
  };

  const handleProceedToPayment = async () => {
    if (!isFormComplete() || !store || !user?.primaryEmailAddress?.emailAddress)
      return;

    setIsProcessingPayment(true);

    try {
      const customerInfo = {
        email: email || user.primaryEmailAddress.emailAddress,
        name: formData.name,
        phone: formData.phone,
        address: deliveryMethod === 'home_delivery' ? address : null,
        delivery_method: deliveryMethod,
        parcel_point:
          deliveryMethod === 'pickup_point' ? selectedParcelPoint : null,
      };



      const payloadData = {
        amount: amount,
        currency: 'eur',
        customerName: formData.name || user.fullName || 'Client',
        customerEmail: customerInfo.email,
        clerkUserId: user.id,
        storeName: store.name,
        productReference: formData.reference,
        address: address || {
          line1: '',
          line2: '',
          city: '',
          state: '',
          postal_code: '',
          country: 'FR',
        },
        deliveryMethod,
        parcelPoint: selectedParcelPoint || null,
        phone: formData.phone || '',
        deliveryCost,
        selectedWeight,
        deliveryNetwork:
          selectedParcelPoint?.shippingOfferCode ||
          (formData as any).shippingOfferCode,
      };

      console.log('💳 PAYLOAD envoyé au backend:', payloadData);

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
          <p className='text-gray-600'>Chargement...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='text-red-500 text-xl mb-4'>❌</div>
          <h2 className='text-xl font-semibold text-gray-900 mb-2'>Erreur</h2>
          <p className='text-gray-600'>{error}</p>
        </div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <div className='text-gray-400 text-xl mb-4'>🏪</div>
          <h2 className='text-xl font-semibold text-gray-900 mb-2'>
            Boutique non trouvée
          </h2>
          <p className='text-gray-600'>
            La boutique "{storeName}" n'existe pas ou n'est plus disponible.
          </p>
        </div>
      </div>
    );
  }

  const themeColor = store.theme || '#667eea';

  return (
    <StripeWrapper>
      <div className='min-h-screen bg-gray-50 py-8'>
        {toast && (
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded shadow ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : toast.type === 'success'
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        )}
        <div className='max-w-4xl mx-auto px-4 sm:px-6 lg:px-8'>
          {/* En-tête de la boutique */}
          <div className='bg-white rounded-lg shadow-sm p-6 mb-6'>
            <div className='flex items-center space-x-4'>
              {store.logo && (
                <img
                  src={store.logo}
                  alt={store.name}
                  className='w-16 h-16 rounded-lg object-cover'
                />
              )}
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>
                  {store.name}
                </h1>
                {store.description && (
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
                      <strong>Référence:</strong> {formData.reference}
                    </p>
                    <p>
                      <strong>Montant:</strong> {amount.toFixed(2)} €
                    </p>
                    <p>
                      <strong>Livraison:</strong>{' '}
                      {deliveryMethod === 'home_delivery'
                        ? 'À domicile'
                        : 'Point relais'}
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
                  const canProceed = isFormComplete() && !isProcessingPayment;
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
              {!isFormComplete() && (
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
  selectedParcelPoint: any;
  setSelectedParcelPoint: any;
  deliveryMethod: 'home_delivery' | 'pickup_point';
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
  setDeliveryCost: (n: number) => void;
  selectedWeight: string;
  setSelectedWeight: any;
}) {
  const stripe = useStripe();
  const elements = useElements();

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
          className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border ${formData.reference.trim() ? 'border-gray-300' : 'border-red-500'}`}
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
            setAmountInput(e.target.value);
            const value = parseFloat(e.target.value);
            if (!isNaN(value) && value > 0) {
              setAmount(value);
            }
          }}
          className={`w-full px-3 py-3.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 border ${parseFloat(amountInput) > 0 ? 'border-gray-300' : 'border-red-500'}`}
          style={{ lineHeight: '1.5' }}
          placeholder='0.00'
          required
        />
      </div>

      {/* Adresse de livraison (toujours visible, pour piloter la carte et/ou la livraison à domicile) */}
      <div>
        <label className='block text-sm font-medium text-gray-700 mb-2'>
          Adresse de livraison
        </label>
        {(() => {
          const defaultName =
            (customerData?.address as any)?.name || user?.fullName || '';
          const defaultPhone = customerData?.phone || '';
          const defaultAddress =
            (customerData?.address as any) || (address as any) || undefined;
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
                key={`addr-${defaultAddress?.line1 || ''}-${defaultAddress?.postal_code || ''}`}
                options={{
                  mode: 'shipping',
                  allowedCountries: ['FR', 'BE', 'ES', 'DE', 'IT', 'NL'],
                  fields: {
                    phone: 'always',
                  },
                  defaultValues: {
                    name: defaultName,
                    phone: defaultPhone,
                    address: defaultAddress,
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

      {/* ParcelPointMap (gère la méthode de livraison en interne et se met à jour sur changement d’adresse) */}
      <div className='mt-6'>
        {(() => {
          const preferredDeliveryMethod =
            (customerData as any)?.deliveryMethod ||
            (customerData as any)?.metadata?.delivery_method ||
            deliveryMethod;

          return (
            <ParcelPointMap
              address={address}
              onParcelPointSelect={(
                point,
                method,
                cost,
                weight,
                shippingOfferCode
              ) => {
                if (typeof shippingOfferCode === 'string') {
                  // Stocker le shippingOfferCode pour succès page et metadata
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
                  // IMPORTANT: Réinitialiser le shippingOfferCode dans formData quand pas de shippingOfferCode
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
