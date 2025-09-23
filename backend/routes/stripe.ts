import express from "express";
import Stripe from "stripe";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { Request, Response } from "express";
import { emailService } from "../services/emailService";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

const BASE_URL = process.env.FRONTEND_URL || "http://localhost:3001";

// Types pour les requêtes
interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CreatePaymentIntentRequest {
  amount: number;
  currency: string;
  orderItems: OrderItem[];
  customerEmail?: string;
  customerName?: string;
}

// Fonction pour calculer le montant total
const calculateOrderAmount = (items: OrderItem[]): number => {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
};

// Route pour créer un Payment Intent
router.post("/create-payment-intent", async (req, res): Promise<void> => {
  try {
    const {
      amount,
      currency = "eur",
      orderItems,
      customerEmail,
      customerName,
    }: CreatePaymentIntentRequest = req.body;

    // Validation des données
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Montant invalide" });
      return;
    }

    // Créer ou récupérer le client Stripe
    let customerId: string | undefined;
    if (customerEmail) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
        });
        customerId = customer.id;
      }
    }

    // Créer le Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convertir en centimes
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata: {
        order_items: JSON.stringify(orderItems),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Erreur lors de la création du Payment Intent:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Route pour récupérer les méthodes de paiement d'un client
router.get("/customer/:customerId/payment-methods", async (req, res) => {
  try {
    const { customerId } = req.params;

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    res.json({ paymentMethods: paymentMethods.data });
  } catch (error) {
    console.error("Erreur lors de la récupération des méthodes:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Route pour créer une session de checkout intégrée
router.post("/create-checkout-session", async (req, res): Promise<void> => {
  try {
    const {
      amount,
      currency = "eur",
      customerEmail,
      storeName,
      productReference,
    } = req.body;

    console.log("🔧 [create-checkout-session] received body:", {
      amount,
      currency,
      customerEmail,
      storeName,
      productReference,
    });

    // Validation
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Montant invalide" });
      return;
    }

    // Créer ou récupérer le client Stripe
    let customerId: string | undefined;
    if (customerEmail) {
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: customerEmail,
        });
        customerId = customer.id;
      }
    }

    // Créer la session de checkout intégrée
    const session = await stripe.checkout.sessions.create({
      //@ts-ignore
      ui_mode: "embedded" as any,
      payment_method_types: ["card", "klarna", "paypal", "amazon_pay"],
      payment_intent_data: {
        description: storeName
          ? `Commande ${productReference || "sans référence"} - ${storeName}`
          : `Commande ${
              productReference || "sans référence"
            } - LIVE SHOPPING APP`,
        // Add metadata to the payment intent
        metadata: {
          store_name: storeName || "LIVE SHOPPING APP",
          product_reference: productReference || "N/A",
          order_source: "live_shopping_checkout",
        },
      },
      // Duplicate useful metadata at the session level for easier retrieval
      metadata: {
        store_name: storeName || "LIVE SHOPPING APP",
        product_reference: productReference || "N/A",
        order_source: "live_shopping_checkout",
      },
      line_items: [
        {
          price_data: {
            currency: currency,
            product_data: {
              name: productReference || "Produit Live Shopping",
              description: `Achat depuis ${storeName || "LIVE SHOPPING APP"}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      return_url: `${
        process.env.FRONTEND_URL
      }/payment/return?session_id={CHECKOUT_SESSION_ID}&store_name=${encodeURIComponent(
        storeName || "default"
      )}`,
      ...(customerId && { customer: customerId }),
    });

    console.log("✅ [create-checkout-session] session created:", {
      id: session.id,
      customer: session.customer,
      return_url: session.return_url,
      metadata: (session as any).metadata,
    });

    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Erreur lors de la création de la session:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Route pour récupérer les détails d'une session
router.get("/session/:sessionId", async (req, res): Promise<void> => {
  try {
    const { sessionId } = req.params;

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "customer"],
    });

    if (!session) {
      res.status(404).json({ error: "Session non trouvée" });
      return;
    }

    // Extraire les informations nécessaires
    const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
    const customer = session.customer as Stripe.Customer;

    // Logs pour diagnostique
    console.log("🔍 [get session] retrieved:", {
      id: session.id,
      status: session.payment_status,
      sessionMetadata: (session as any)?.metadata,
      paymentIntentMetadata: paymentIntent?.metadata,
    });

    // Préférer le store_name au niveau de la session
    const storeNameFromSession = (session as any)?.metadata?.store_name;
    const storeNameFromPI = paymentIntent?.metadata?.store_name;

    const paymentDetails = {
      amount: session.amount_total || 0,
      currency: session.currency || "eur",
      reference: paymentIntent?.metadata?.product_reference || "N/A",
      storeName: storeNameFromSession || storeNameFromPI || "LIVE SHOPPING APP",
      customerEmail:
        session.customer_details?.email || customer?.email || "N/A",
      status: session.payment_status,
    };

    res.json(paymentDetails);
  } catch (error) {
    console.error("Erreur lors de la récupération de la session:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Webhook pour gérer les événements Stripe
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig: any = req.headers["stripe-signature"];
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
      case "payment_intent.succeeded":
        // Paiement réussi (PaymentIntent)
        console.log("PaymentIntent succeeded:", event.data.object.id);
        break;

      case "checkout.session.completed":
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
                "Error retrieving stripe customer for clerk mapping:",
                custErr
              );
            }
          }

          // Si on n'a pas clerkUserId, on peut essayer de chercher par email via Clerk (limité)
          if (!clerkUserId && email) {
            try {
              // clerkClient doesn't provide a getUserByEmail in some SDKs; we attempt a safe search via listUsers
              const users = await clerkClient.users.getUserList({
                emailAddress: [email],
                limit: 1,
              });
              if (users && users.data && users.data.length > 0) {
                clerkUserId = users.data[0].id;
              }
            } catch (findErr) {
              console.error("Error finding Clerk user by email:", findErr);
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

            // Mettre à jour les metadata publiques du user et le numéro de téléphone principal
            try {
              // Mettre à jour les métadonnées publiques
              await clerkClient.users.updateUserMetadata(clerkUserId, {
                publicMetadata: {
                  paid_email: email,
                  paid_phone: phone,
                  paid_address: address,
                },
              });

              // Mettre à jour le numéro de téléphone principal si disponible
              if (phone) {
                try {
                  // Essayer d'ajouter le numéro de téléphone comme nouveau numéro
                  await clerkClient.phoneNumbers.createPhoneNumber({
                    userId: clerkUserId,
                    phoneNumber: phone,
                    verified: true,
                    primary: true,
                  });
                  console.log(
                    `Added new primary phone number for user ${clerkUserId}`
                  );
                } catch (addPhoneErr) {
                  console.error("Error adding phone number:", addPhoneErr);
                }
              }

              console.log(`Updated Clerk metadata for user ${clerkUserId}`);
            } catch (clerkErr) {
              console.error("Error updating Clerk user metadata:", clerkErr);
            }
          } else {
            console.log(
              "No Clerk user id found for session, skipping metadata update"
            );
          }

          // Récupérer le payment intent pour les informations de paiement
          const paymentIntent = await stripe.paymentIntents.retrieve(
            session.payment_intent as string
          );

          // Récupérer les informations client depuis la session
          const customerName = session.customer_details?.name || "Client";
          const address = session.customer_details?.address
            ? `${session.customer_details.address.line1 || ""} ${
                session.customer_details.address.line2 || ""
              }, ${session.customer_details.address.city || ""} ${
                session.customer_details.address.postal_code || ""
              }, ${session.customer_details.address.country || ""}`.trim()
            : "Adresse non fournie";

          // Récupérer les informations de la boutique depuis les métadonnées
          const storeName =
            paymentIntent.metadata?.store_name || "LIVE SHOPPING APP";
          const productReference =
            paymentIntent.metadata?.product_reference || "N/A";

          // Récupérer les informations complètes de la boutique depuis Supabase
          let storeOwnerEmail = null;
          let storeDescription = null;
          let storeLogo = null;

          if (storeName && storeName !== "LIVE SHOPPING APP") {
            try {
              const { data: storeData, error: storeError } = await supabase
                .from("stores")
                .select("owner_email, description, logo")
                .eq("name", storeName)
                .single();

              if (!storeError && storeData) {
                storeOwnerEmail = storeData.owner_email;
                storeDescription = storeData.description;
                storeLogo = storeData.logo;
              }
            } catch (storeErr) {
              console.error("Error fetching store data:", storeErr);
            }
          }

          // Envoyer l'email de confirmation au client
          if (email && customerName) {
            try {
              await emailService.sendCustomerConfirmation({
                customerEmail: email,
                customerName: customerName,
                storeName: storeName,
                storeDescription: storeDescription,
                storeLogo: storeLogo,
                productReference: productReference,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                paymentId: paymentIntent.id,
              });
            } catch (emailErr) {
              console.error(
                "Error sending customer confirmation email:",
                emailErr
              );
            }
          }

          // Envoyer l'email de notification au propriétaire de la boutique
          if (storeOwnerEmail && email && customerName) {
            try {
              await emailService.sendStoreOwnerNotification({
                ownerEmail: storeOwnerEmail,
                storeName: storeName,
                customerEmail: email,
                customerName: customerName,
                customerPhone: phone,
                customerAddress: address,
                productReference: productReference,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                paymentId: paymentIntent.id,
              });
            } catch (emailErr) {
              console.error(
                "Error sending store owner notification email:",
                emailErr
              );
            }
          }
        } catch (sessionErr) {
          console.error(
            "Error handling checkout.session.completed:",
            sessionErr
          );
        }
        break;
      case "payment_intent.payment_failed":
        // Paiement échoué - rediriger vers la page d'échec
        const failedPaymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log("Payment failed:", failedPaymentIntent.id);

        // Récupérer la session associée pour obtenir les détails
        try {
          const sessions = await stripe.checkout.sessions.list({
            payment_intent: failedPaymentIntent.id,
            limit: 1,
          });

          if (sessions.data.length > 0) {
            const failedSession = sessions.data[0];
            console.log(`Payment failed for session: ${failedSession.id}`);
            // La redirection vers la page d'échec sera gérée côté frontend
            // via les paramètres de l'URL de retour de Stripe
          }
        } catch (sessionErr) {
          console.error("Error handling payment failure:", sessionErr);
        }
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  }
);

export default router;
