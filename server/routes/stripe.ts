import express, { Request, Response } from 'express';
import Stripe from 'stripe';
// Import clerkClient via require to avoid missing type declaration errors in this repo
const { clerkClient } = require('@clerk/express');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil',
});
const router = express.Router();

// URL de base pour les redirections
const BASE_URL =
  process.env.NODE_ENV === 'production'
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
            // Créer un nouveau customer, inclure clerkUserId si fourni
            const newCustomer = await stripe.customers.create({
              email: customer.email,
              name: customer.name,
              metadata: {
                created_via: 'live_shopping_app',
                ...(customer.userId && { clerkUserId: customer.userId }),
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
        amount,
        currency = 'eur',
        customer,
      }: {
        amount: number;
        currency?: string;
        customer?: { email: string; name: string };
      } = req.body;

      if (!amount || amount < 50) {
        res.status(400).json({ error: 'Amount must be at least 0.50€' });
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
        //@ts-ignore
        ui_mode: 'embedded' as any,
        payment_method_types: ['card', 'klarna', 'paypal', 'amazon_pay'],
        line_items: [
          {
            price_data: {
              currency: currency,
              product_data: {
                name: 'LIVE SHOPPING APP',
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
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
  async (req: Request, res: Response): Promise<void> => {
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
        // Paiement réussi (PaymentIntent)
        console.log('PaymentIntent succeeded:', event.data.object.id);
        break;

      case 'checkout.session.completed':
        // Session checkout complétée
        try {
          const session: any = event.data.object as any;

          // customer peut être un id de customer ou null
          const stripeCustomerId = (session.customer as string) || null;

          // récupérer email/phone/adresse depuis la session
          const email = session.customer_details?.email || null;
          const phone = session.customer_details?.phone || null;
          const shipping = session.shipping || null;

          let clerkUserId: string | undefined;

          // Si la session référence un customer Stripe, récupérer ses metadata
          if (stripeCustomerId) {
            try {
              const stripeCustomer = (await stripe.customers.retrieve(
                stripeCustomerId
              )) as Stripe.Customer;
              if (
                (stripeCustomer as any).metadata &&
                (stripeCustomer as any).metadata.clerkUserId
              ) {
                clerkUserId = (stripeCustomer as any).metadata.clerkUserId;
              }
            } catch (custErr) {
              console.error(
                'Error retrieving stripe customer for clerk mapping:',
                custErr
              );
            }
          }

          // Si on n'a pas clerkUserId, on peut essayer de chercher par email via Clerk (limité)
          if (!clerkUserId && email) {
            try {
              // clerkClient doesn't provide a getUserByEmail in some SDKs; we attempt a safe search via listUsers
              const users = await clerkClient.users.getUserList({
                emailAddress: email,
                limit: 1,
              } as any);
              if (users && users.length > 0) {
                clerkUserId = users[0].id;
              }
            } catch (findErr) {
              console.error('Error finding Clerk user by email:', findErr);
            }
          }

          if (clerkUserId) {
            // Construire l'objet d'adresse à stocker
            const address: any = shipping
              ? {
                  name: shipping.name,
                  address: shipping.address,
                }
              : null;

            // Mettre à jour les metadata publiques du user
            try {
              await clerkClient.users.updateUserMetadata(clerkUserId, {
                publicMetadata: {
                  paid_email: email,
                  paid_phone: phone,
                  paid_address: address,
                },
              });
              console.log(`Updated Clerk metadata for user ${clerkUserId}`);
            } catch (clerkErr) {
              console.error('Error updating Clerk user metadata:', clerkErr);
            }
          } else {
            console.log(
              'No Clerk user id found for session, skipping metadata update'
            );
          }
        } catch (sessionErr) {
          console.error(
            'Error handling checkout.session.completed:',
            sessionErr
          );
        }
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
