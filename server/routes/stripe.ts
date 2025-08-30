import express, { Request, Response } from 'express';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil',
});
const router = express.Router();

// URL de base pour les redirections
const BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://votre-domaine-production.com' 
  : 'http://localhost:5173';

// Types
interface OrderItem {
  id: string;
  amount: number;
}

interface CreatePaymentIntentRequest {
  items: OrderItem[];
  currency?: string;
}

// Fonction pour calculer le montant total de la commande
const calculateOrderAmount = (items: OrderItem[]): number => {
  // Calculer le total de la commande côté serveur pour éviter
  // que les utilisateurs manipulent directement le montant côté client
  let total = 0;
  items.forEach(item => {
    total += item.amount;
  });
  return total;
};

// Créer un Payment Intent simple (sans Stripe Connect)
router.post(
  '/create-payment-intent',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        items,
        currency = 'eur',
        customer,
      }: CreatePaymentIntentRequest & {
        currency?: string;
        customer?: any;
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Items are required' });
        return;
      }

      let customerId = '';

      // Créer ou récupérer le customer si fourni
      if (customer && customer.email) {
        try {
          // Chercher un customer existant par email
          const existingCustomers = await stripe.customers.list({
            email: customer.email,
            limit: 1,
          });

          if (existingCustomers.data.length > 0) {
            customerId = existingCustomers.data[0].id;
          } else {
            // Créer un nouveau customer
            const newCustomer = await stripe.customers.create({
              email: customer.email,
              name: customer.name,
              metadata: {
                created_via: 'live_shopping_app',
              },
            });
            customerId = newCustomer.id;
          }
        } catch (customerError) {
          console.error('Error handling customer:', customerError);
          // Continuer sans customer si erreur
        }
      }

      // Créer le Payment Intent
      const paymentIntentParams: any = {
        amount: calculateOrderAmount(items),
        currency: currency,
        // Utiliser les méthodes automatiques qui incluent Klarna
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'always', // Klarna nécessite des redirections
        },
        // Activer la sauvegarde des méthodes de paiement
        setup_future_usage: 'on_session',
      };

      // Ajouter le customer si disponible
      if (customerId) {
        paymentIntentParams.customer = customerId;
      }

      const paymentIntent =
        await stripe.paymentIntents.create(paymentIntentParams);

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        customerId: customerId,
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(500).json({ error: 'Failed to create payment intent' });
    }
  }
);

// Récupérer les méthodes de paiement sauvegardées d'un customer
router.get('/customer/:customerId/payment-methods', async (req, res) => {
  try {
    const { customerId } = req.params;

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    // Filtrer seulement les méthodes avec allow_redisplay = 'always'
    const availablePaymentMethods = paymentMethods.data.filter(
      (pm: any) => pm.allow_redisplay === 'always'
    );

    res.json({
      paymentMethods: availablePaymentMethods,
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

// Créer une session de checkout intégrée (embedded)
router.post(
  '/create-checkout-session',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        items,
        currency = 'eur',
        customer,
      }: CreatePaymentIntentRequest & {
        currency?: string;
        customer?: any;
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Items are required' });
        return;
      }

      let customerId = '';

      // Créer ou récupérer le customer si fourni
      if (customer && customer.email) {
        try {
          // Chercher un customer existant par email
          const existingCustomers = await stripe.customers.list({
            email: customer.email,
            limit: 1,
          });

          if (existingCustomers.data.length > 0) {
            customerId = existingCustomers.data[0].id;
          } else {
            // Créer un nouveau customer
            const newCustomer = await stripe.customers.create({
              email: customer.email,
              name: customer.name,
              metadata: {
                created_via: 'live_shopping_app',
              },
            });
            customerId = newCustomer.id;
          }
        } catch (customerError) {
          console.error('Error handling customer:', customerError);
          // Continuer sans customer si erreur
        }
      }

      // Créer la session de checkout intégrée
      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded',
        line_items: items.map(item => ({
          price_data: {
            currency: currency,
            product_data: {
              name: 'Article Live Shopping',
              description: 'Paiement via formulaire intégré',
            },
            unit_amount: item.amount,
          },
          quantity: 1,
        })),
        mode: 'payment',
        return_url: `${BASE_URL}/complete?session_id={CHECKOUT_SESSION_ID}`,
        ...(customerId && { customer: customerId }),
      });

      res.json({
        clientSecret: session.client_secret,
        sessionId: session.id,
      });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
);

// Webhook pour gérer les événements Stripe
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req: Request, res: Response): void => {
    const sig: any = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      console.log(`Webhook signature verification failed.`, err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    // Gérer les événements
    switch (event.type) {
      case 'payment_intent.succeeded':
        // Paiement réussi
        console.log('Payment succeeded:', event.data.object.id);
        // Ici tu peux ajouter la logique pour traiter la commande
        // Par exemple : mettre à jour le statut de la commande en base de données
        break;
      case 'payment_intent.payment_failed':
        // Paiement échoué
        console.log('Payment failed:', event.data.object.id);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  }
);

export default router;
