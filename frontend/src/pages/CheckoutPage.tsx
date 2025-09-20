import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  useStripe,
  useElements,
  PaymentElement,
  ExpressCheckoutElement,
  AddressElement,
} from '@stripe/react-stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { useUser } from '@clerk/clerk-react';
import { ShoppingBag, MapPin, User, ExternalLink } from 'lucide-react';
import StripeWrapper from '../components/StripeWrapper';
import ParcelPointMap from '../components/ParcelPointMap';
import { apiPost } from '../utils/api';

interface Store {
  id: number;
  name: string;
  logo: string;
  description: string;
  theme: string;
  owner_email: string;
}

// Composant interne qui utilise les hooks Stripe
interface CheckoutFormProps {
  embeddedClientSecret: string;
  amount: number;
  setAmount: (a: number) => void;
  // now accepts the new payment amount in cents
  onUpdateClick: (paymentAmount: number) => void;
  updating?: boolean;
  store: Store | null;
}

function CheckoutForm({
  embeddedClientSecret,
  amount,
  setAmount,
  onUpdateClick,
  updating,
  store,
}: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { user } = useUser();
  // initialize as integer euros string to match input behavior
  const [amountInput, setAmountInput] = useState(
    String(Math.round(amount / 100))
  );

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    reference: '',
    email: user?.primaryEmailAddress?.emailAddress || '',
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    fullName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
    phone: '',
    acceptTerms: true,
  });
  const [shippingAddress, setShippingAddress] = useState<any>(null);
  const [selectedParcelPoint, setSelectedParcelPoint] = useState<any>(null);
  const [savePaymentMethod, setSavePaymentMethod] = useState(true);

  const getStripePaymentUrl = () => {
    const baseUrl = 'https://buy.stripe.com/14AeVdcc5h1VeUb1n9cIE03';
    const email = user?.primaryEmailAddress?.emailAddress || '';
    return `${baseUrl}?prefilled_email=${encodeURIComponent(email)}`;
  };

  // Configuration pour l'autocomplétion Google Maps
  const getAutocompleteConfig = () => {
    if (import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
      return {
        mode: 'google_maps_api' as const,
        apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      };
    }
    return {
      mode: 'automatic' as const,
    };
  };

  // Express Checkout options
  const expressCheckoutOptions = {
    emailRequired: true,
    phoneNumberRequired: false,
    shippingAddressRequired: false,
    allowedShippingCountries: ['FR', 'BE', 'DE', 'ES', 'IT'],
    amount: 5000, // 50€ pour tester Alma
    currency: 'eur',
    paymentMethodTypes: ['link', 'amazon_pay'],
    lineItems: [
      {
        name: '',
        amount: 5000, // 50€ pour tester Alma
      },
      {
        name: 'Livraison',
        amount: 0, // Gratuit si point relais
      },
    ],
    buttonTheme: {
      applePay: 'white-outline',
      googlePay: 'white',
    },
    buttonHeight: 48,
  };

  // Gestion des événements Express Checkout
  const handleExpressCheckoutConfirm = async (event: any) => {
    const { billingDetails, shippingAddress: expressShipping } = event;

    // Pré-remplir les données avec les informations Express Checkout
    setFormData({
      ...formData,
      email: billingDetails.email,
      firstName: billingDetails.name?.split(' ')[0] || '',
      lastName: billingDetails.name?.split(' ').slice(1).join(' ') || '',
      phone: billingDetails.phone || '',
    });

    if (expressShipping) {
      setShippingAddress(expressShipping);
    }

    // Les données sont maintenant pré-remplies
  };

  // Gestion du changement d'adresse de livraison
  const handleShippingAddressChange = (event: any) => {
    // Ne mettre à jour que si l'adresse est complète (sélectionnée depuis l'autocomplétion)
    if (event.value.address) {
      const address = event.value.address;
      setShippingAddress({
        name: event.value.name,
        address: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
          country: address.country,
        },
      });
    } else {
      // Si l'adresse n'est pas complète, on efface les données
      setShippingAddress(null);
    }
  };

  // Gestion du changement d'adresse de facturation
  const handleBillingAddressChange = (event: any) => {
    if (event.complete) {
      // L'adresse de facturation est gérée automatiquement par Stripe
      console.log('Billing address updated:', event.value);
    }
  };

  // Soumission du formulaire
  const handleSubmit = async (e: any) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setLoading(true);

    try {
      // Valider l'élément d'adresse de livraison
      const shippingAddressElement = elements.getElement('address', {
        mode: 'shipping',
      });
      if (shippingAddressElement) {
        const { complete } = await shippingAddressElement.getValue();
        if (!complete) {
          setMessage("Veuillez compléter l'adresse de livraison");
          setLoading(false);
          return;
        }
      }

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/complete`,
          payment_method_data: {
            billing_details: {
              name: formData.fullName,
              email: formData.email,
              phone: formData.phone,
            },
          },
          shipping: shippingAddress
            ? {
                name: shippingAddress.name,
                address: shippingAddress.address,
              }
            : null,
        },
      });

      if (error) {
        if (error.type === 'card_error' || error.type === 'validation_error') {
          setMessage(
            error.message || "Une erreur de validation s'est produite."
          );
        } else {
          setMessage("Une erreur inattendue s'est produite.");
        }
      }
    } catch (error) {
      console.log(error);
      setMessage('Erreur lors du traitement du paiement');
    }

    setLoading(false);
  };

  return (
    <div 
      className='min-h-screen'
      style={{ background: store?.theme || '#f8fafc' }}
    >
      <div className="bg-black bg-opacity-20 backdrop-blur-sm">
        <div className='max-w-4xl mx-auto px-4 py-8'>
          {/* En-tête avec branding de la boutique */}
          <div className='text-center mb-8'>
            <div className="flex items-center justify-center space-x-6 mb-6">
              {/* Logo de la boutique */}
              {store?.logo ? (
                <img 
                  src={store.logo} 
                  alt={`Logo ${store.name}`}
                  className="w-16 h-16 rounded-full object-cover border-4 border-white shadow-lg"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-white bg-opacity-20 flex items-center justify-center border-4 border-white shadow-lg">
                  <ShoppingBag className="w-8 h-8 text-white" />
                </div>
              )}
              
              <div className="text-left">
                <h1 className='text-3xl font-bold text-white mb-2'>
                  {store?.name || 'Boutique'}
                </h1>
                {store?.description && (
                  <p className='text-white text-opacity-90'>{store.description}</p>
                )}
                <p className='text-white text-opacity-75 text-sm mt-1'>Checkout</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className='max-w-4xl mx-auto px-4 py-8'>

      <form onSubmit={handleSubmit} className='space-y-8'>
        {/* Informations personnelles */}
        <div className='bg-white rounded-lg shadow-md p-6'>
          <h3 className='text-lg font-semibold mb-4 flex items-center'>
            <User className='h-5 w-5 mr-2 text-blue-600' />
            Informations personnelles
          </h3>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Nom complet *
              </label>
              <input
                type='text'
                value={formData.fullName}
                onChange={e =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
                className='w-full border border-gray-300 rounded-md px-4 py-3 focus:ring-2 focus:ring-slate-500 focus:border-transparent'
                required
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Email *
              </label>
              <input
                type='email'
                value={formData.email}
                onChange={e =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className='w-full border border-gray-300 rounded-md px-4 py-3 focus:ring-2 focus:ring-slate-500 focus:border-transparent'
                required
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Référence
              </label>
              <input
                type='text'
                value={formData.reference}
                onChange={e =>
                  setFormData({ ...formData, reference: e.target.value })
                }
                className='w-full border border-gray-300 rounded-md px-4 py-3 focus:ring-2 focus:ring-slate-500 focus:border-transparent'
              />
            </div>
          </div>
        </div>

        {/* Adresse de livraison */}
        <div className='bg-white rounded-lg shadow-md p-6'>
          <h3 className='text-lg font-semibold mb-4 flex items-center'>
            <MapPin className='h-5 w-5 mr-2 text-blue-600' />
            Adresse de livraison
          </h3>
          <AddressElement
            options={{
              mode: 'shipping',
              fields: {
                phone: 'always',
              },
              validation: {
                phone: {
                  required: 'never',
                },
              },
              allowedCountries: ['FR', 'BE', 'DE', 'ES', 'IT'],
              autocomplete: getAutocompleteConfig(),
            }}
            onChange={handleShippingAddressChange}
          />

          {/* Carte des points relais */}
          <div className='mt-6'>
            <ParcelPointMap
              address={shippingAddress?.address}
              onParcelPointSelect={setSelectedParcelPoint}
            />
          </div>
        </div>

        {/* Paiement */}
        <div className='bg-white rounded-lg shadow-md p-6'>
          <h3 className='text-lg font-semibold mb-4'>Paiement</h3>

          {/* Adresse de facturation 
          <div className='mb-6'>
            <h4 className='font-medium text-gray-900 mb-3'>
              Adresse de facturation
            </h4>
            <AddressElement
              options={{
                mode: 'billing',
                ...(shippingAddress && {
                  defaultValues: {
                    name: shippingAddress.name,
                    address: shippingAddress.address,
                  },
                }),
                autocomplete: getAutocompleteConfig(),
              }}
              onChange={handleBillingAddressChange}
            />
          </div>
          */}

          {/* Express Checkout - Quick Payment 
          <div className='mb-6'>
            <h4 className='font-medium text-gray-900 mb-3'>Paiement rapide</h4>
            <ExpressCheckoutElement
              options={{
                ...expressCheckoutOptions,
                buttonHeight: 40,
                buttonTheme: {
                  applePay: 'black',
                  googlePay: 'black',
                },
              }}
              onConfirm={handleExpressCheckoutConfirm}
            />
            <div className='mt-3 text-center'>
              <span className='text-sm text-gray-500'>
                ou utilisez une autre méthode de paiement
              </span>
            </div>
          </div>
          
          */}

          {/* Élément de paiement 
          <div className='mb-6'>
            <h4 className='font-medium text-gray-900 mb-3'>
              Méthode de paiement
            </h4>
            <PaymentElement
              options={{
                layout: 'accordion',
                paymentMethodOrder: ['card', 'paypal', 'alma'],
                defaultValues: {
                  billingDetails: {
                    name: formData.fullName,
                    email: formData.email,
                    phone: formData.phone,
                  },
                },
              }}
            />
          </div>
          
          
          */}

          {/* Option de sauvegarde 
          
          <div className='mb-6'>
            <label className='flex items-center'>
              <input
                type='checkbox'
                checked={savePaymentMethod}
                onChange={e => setSavePaymentMethod(e.target.checked)}
                className='mr-2'
              />
              <span className='text-sm text-gray-700'>
                Sauvegarder cette méthode de paiement pour les futurs achats
              </span>
            </label>
          </div>
          */}

          {/* Embedded Checkout */}
          <div className='mb-6'>
            {/* Champ montant + bouton mise à jour */}
            <div className='mb-6'>
              <label className='block text-sm font-medium text-gray-700 mb-2'>
                Montant (en €)
              </label>
              <div className='flex space-x-2'>
                <input
                  type='number'
                  min='1'
                  step='1'
                  value={amountInput}
                  onChange={e => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, '');
                    setAmountInput(cleaned);
                  }}
                  className='flex-1 border border-gray-300 rounded-md px-4 py-2'
                />
                <button
                  type='button'
                  onClick={() => {
                    const parsedEuros = parseInt(amountInput, 10) || 0;
                    const cents = parsedEuros * 100;
                    if (cents < 100) {
                      alert('Le montant doit être au moins 1€');
                      return;
                    }
                    setAmount(cents);
                    onUpdateClick(cents);
                  }}
                  disabled={Boolean(updating)}
                  className='px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  {updating ? 'Mise à jour...' : 'Mettre à jour'}
                </button>
              </div>
            </div>
            {embeddedClientSecret && (
              <div className='border border-gray-200 rounded-md overflow-hidden'>
                <EmbeddedCheckoutProvider
                  stripe={stripe}
                  options={{ clientSecret: embeddedClientSecret }}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            )}
          </div>

          {/* Ligne de séparation */}
          <div className='mb-6 flex items-center'>
            <hr className='flex-grow border-gray-300' />
            <span className='px-4 text-gray-500 text-sm font-medium'>Ou</span>
            <hr className='flex-grow border-gray-300' />
          </div>

          {/* Payer via Stripe */}
          <div className='mb-6'>
            <h4 className='font-medium text-gray-900 mb-3'>
              Payer via Stripe Checkout
            </h4>
            <button
              type='button'
              onClick={() => window.open(getStripePaymentUrl(), '_blank')}
              className='w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2'
            >
              <ExternalLink className='h-5 w-5' />
              <span>Payer avec Stripe Checkout</span>
            </button>
          </div>

          {/* Conditions générales 
          <div className='mb-6'>
            <label className='flex items-center'>
              <input
                type='checkbox'
                checked={formData.acceptTerms}
                onChange={e =>
                  setFormData({ ...formData, acceptTerms: e.target.checked })
                }
                className='mr-2'
                required
              />
              <span className='text-sm text-gray-600'>
                J'accepte les conditions générales de ventes
              </span>
            </label>
          </div>
          */}

          {/* Bouton de paiement 
          <div className='mt-6'>
            <button
              type='submit'
              disabled={!stripe || loading || !formData.acceptTerms}
              className='w-full bg-slate-700 text-white py-3 rounded-md hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            >
              {loading ? 'Traitement...' : 'Confirmer le paiement'}
            </button>
          </div>
          */}
        </div>

        {/* Messages d'erreur */}
        {message && (
          <div className='bg-red-50 border border-red-200 rounded-md p-4'>
            <p className='text-red-600 text-sm'>{message}</p>
          </div>
        )}
      </form>
      </div>
    </div>
  );
}

// Composant principal qui gère le clientSecret et wrap avec Stripe Elements
export default function CheckoutPage() {
  const { storeName } = useParams<{ storeName: string }>();
  const [clientSecret, setClientSecret] = useState('');
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState('');
  const [updating, setUpdating] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useUser();

  // Créer le Payment Intent au chargement de la page
  const [amount, setAmount] = useState(5000); // 50€ par défaut en centimes

  useEffect(() => {
    const fetchStore = async () => {
      if (!storeName) {
        setError('Nom de boutique manquant');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`http://localhost:5000/api/stores/${encodeURIComponent(storeName)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Erreur lors du chargement de la boutique');
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
    if (user && store) {
      initializePayment();
      initializeEmbeddedCheckout(amount);
    }
  }, [user, store]);

  // Créer le Payment Intent avec support des customers
  const initializePayment = async () => {
    if (!user) return;

    try {
      const response = await apiPost('/api/stripe/create-payment-intent', {
        items: [
          {
            id: 'live-shopping-item',
            amount: 5000, // 50€ en centimes (minimum pour Alma)
          },
        ],
        currency: 'eur',
        customer: {
          email: user.primaryEmailAddress?.emailAddress,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        },
      });

      const data = await response.json();
      setClientSecret(data.clientSecret);
    } catch (error) {
      console.error('Error creating payment intent:', error);
    }
  };

  // Initialiser l'Embedded Checkout
  const initializeEmbeddedCheckout = async (paymentAmount: number) => {
    if (!user) return;

    try {
      const response = await apiPost('/api/stripe/create-checkout-session', {
        amount: paymentAmount,
        currency: 'eur',
        customer: {
          email: user.primaryEmailAddress?.emailAddress,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          userId: user.id,
        },
      });

      const data = await response.json();
      setEmbeddedClientSecret(data.clientSecret);
    } catch (error) {
      console.error('Error creating embedded checkout session:', error);
    }
  };

  // Force reload of embedded checkout with new amount: clear secret, call API, set new secret
  const reloadEmbeddedCheckout = async (paymentAmount: number) => {
    if (!user) return;
    try {
      setUpdating(true);
      // Unmount existing embedded checkout
      setEmbeddedClientSecret('');

      const response = await apiPost('/api/stripe/create-checkout-session', {
        amount: paymentAmount,
        currency: 'eur',
        customer: {
          email: user.primaryEmailAddress?.emailAddress,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          userId: user.id,
        },
      });

      const data = await response.json();
      // Small delay to ensure unmount -> remount behavior in the browser
      await new Promise(r => setTimeout(r, 150));
      setEmbeddedClientSecret(data.clientSecret);
    } catch (error) {
      console.error('Error reloading embedded checkout session:', error);
    } finally {
      setUpdating(false);
    }
  };

  // Afficher un loading si on charge les données de la boutique
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

  // Afficher une erreur si la boutique n'est pas trouvée
  if (error || !store) {
    return (
      <div className='min-h-screen flex items-center justify-center'>
        <div className='text-center'>
          <h1 className='text-2xl font-bold text-gray-900 mb-4'>Boutique non trouvée</h1>
          <p className='text-gray-600'>{error || 'Cette boutique n\'existe pas.'}</p>
        </div>
      </div>
    );
  }

  // Afficher un loading uniquement si on n'a ni clientSecret ni embeddedClientSecret
  if (!clientSecret && !embeddedClientSecret) {
    return (
      <div 
        className='min-h-screen flex items-center justify-center'
        style={{ background: store?.theme || '#f8fafc' }}
      >
        <div className='text-center'>
          <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4'></div>
          <p className='text-white'>Initialisation du paiement...</p>
        </div>
      </div>
    );
  }

  return (
    <StripeWrapper
      clientSecret={clientSecret}
      options={{
        appearance: {
          theme: 'stripe',
          variables: {
            borderRadius: '8px',
            colorPrimary: '#334155',
          },
        },
        // Configuration Google Maps pour l'autocomplétion des adresses
        ...(import.meta.env.VITE_GOOGLE_MAPS_API_KEY && {
          googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
        }),
      }}
    >
      <CheckoutForm
        embeddedClientSecret={embeddedClientSecret}
        amount={amount}
        setAmount={setAmount}
        onUpdateClick={(paymentAmount: number) =>
          reloadEmbeddedCheckout(paymentAmount)
        }
        updating={updating}
        store={store}
      />
    </StripeWrapper>
  );
}
