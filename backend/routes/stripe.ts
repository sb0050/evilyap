import express from "express";
import Stripe from "stripe";
import { clerkClient } from "@clerk/clerk-sdk-node";
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

// Endpoint to get customer details
router.get("/get-customer-details", async (req, res) => {
  const { customerEmail } = req.query;

  if (!customerEmail) {
    res.status(400).json({ error: "Customer email is required" });
    return;
  }

  try {
    // Rechercher le client existant par email
    const existingCustomers = await stripe.customers.list({
      email: customerEmail as string,
      limit: 1,
    });

    if (existingCustomers.data.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const customer = existingCustomers.data[0];

    // Extract relevant details
    const customerData = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      shipping: customer.shipping,
      deliveryMethod: customer.metadata.delivery_method,
      parcelPointCode: customer.metadata.parcel_point_code,
      homeDeliveryNetwork: customer.metadata.home_delivery_network,
    };

    res.json({ customer: customerData });
  } catch (error) {
    console.log("Error retrieving customer:", error);
    console.error("Error retrieving customer:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Route pour créer une session de checkout intégrée
router.post("/create-checkout-session", async (req, res): Promise<void> => {
  try {
    const {
      amount,
      currency = "eur",
      customerName,
      customerEmail,
      clerkUserId,
      storeName,
      productReference,
      address,
      deliveryMethod,
      parcelPoint,
      phone,
      deliveryCost,
      homeDeliveryNetwork,
    } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Montant invalide" });
      return;
    }

    if (!customerEmail) {
      res.status(400).json({ error: "Email client requis" });
      return;
    }

    if (!address) {
      res.status(400).json({ error: "Adresse requise" });
      return;
    }

    let customerId: string | undefined;

    try {
      // Vérifier si le client existe déjà
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      let customer: Stripe.Customer;

      if (existingCustomers.data.length > 0) {
        // Mettre à jour le client existant
        customer = await stripe.customers.update(existingCustomers.data[0].id, {
          name: customerName,
          phone: phone,
          address: {
            line1: address.line1,
            line2: address.line2 || "",
            city: address.city,
            state: address.state || "",
            postal_code: address.postal_code,
            country: address.country || "FR",
          },
          shipping:
            deliveryMethod === "pickup_point" && parcelPoint
              ? {
                  name: customerName,
                  phone: phone,
                  address: {
                    line1: parcelPoint.location.street,
                    line2: parcelPoint.location.number || "",
                    city: parcelPoint.location.city,
                    state: parcelPoint.location.state || "",
                    postal_code: parcelPoint.location.postalCode,
                    country: parcelPoint.location.countryIsoCode || "FR",
                  },
                }
              : {
                  name: customerName,
                  phone: phone,
                  address: {
                    line1: address.line1,
                    line2: address.line2 || "",
                    city: address.city,
                    state: address.state || "",
                    postal_code: address.postal_code,
                    country: address.country || "FR",
                  },
                },
          metadata: {
            delivery_method: deliveryMethod,
            clerk_user_id: clerkUserId || "",
            home_delivery_network: homeDeliveryNetwork || "",
            ...(parcelPoint && { parcel_point_code: parcelPoint.code }),
            ...(parcelPoint && { parcel_point_name: parcelPoint.name }),
            ...(parcelPoint && { parcel_point_network: parcelPoint.network }),
          },
        });
      } else {
        // Créer un nouveau client
        const data: any = {
          email: customerEmail,
          name: customerName,
          phone: phone,
          address: {
            line1: address.line1,
            line2: address.line2 || "",
            city: address.city,
            state: address.state || "",
            postal_code: address.postal_code,
            country: address.country || "FR",
          },
          shipping:
            deliveryMethod === "pickup_point" && parcelPoint
              ? {
                  name: customerName,
                  phone: phone,
                  address: {
                    line1: parcelPoint.location.street,
                    line2: parcelPoint.location.number || "",
                    city: parcelPoint.location.city,
                    state: parcelPoint.location.state || "",
                    postal_code: parcelPoint.location.postalCode,
                    country: parcelPoint.location.countryIsoCode || "FR",
                  },
                }
              : {
                  name: customerName,
                  phone: phone,
                  address: {
                    line1: address.line1,
                    line2: address.line2 || "",
                    city: address.city,
                    state: address.state || "",
                    postal_code: address.postal_code,
                    country: address.country || "FR",
                  },
                },
          metadata: {
            delivery_method: deliveryMethod,
            clerk_user_id: clerkUserId || "",
            home_delivery_network: homeDeliveryNetwork || "",
            ...(parcelPoint && { parcel_point_code: parcelPoint.code }),
            ...(parcelPoint && { parcel_point_name: parcelPoint.name }),
            ...(parcelPoint && { parcel_point_network: parcelPoint.network }),
          },
        };

        customer = await stripe.customers.create(data);

        console.log("========= debug", data);
      }

      customerId = customer.id;
    } catch (customerError) {
      console.error("Erreur lors de la gestion du client:", customerError);
      res
        .status(500)
        .json({ error: "Erreur lors de la création/mise à jour du client" });
      return;
    }

    // Créer la session de checkout intégrée
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      payment_method_types: ["card", "paypal"],
      payment_intent_data: {
        description: `store: ${storeName || ""} - reference: ${
          productReference || ""
        }`,
      },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: productReference || "N/A",
              // Vous pouvez ajouter une description et des images optionnellement
              description: `Les frais de port de ${deliveryCost} ont été ajouté au montant associé à la référence`,
              // images: ['https://exemple.com/image.png'],
            },
            unit_amount: amount, // Convertir en centimes (ex: 19.99€ devient 1999)
          },
          quantity: 1,
        },
      ],
      metadata: {
        product_reference: productReference || "N/A",
        store_name: storeName || "",
      },
      mode: "payment",
      return_url: `${
        process.env.FRONTEND_URL
      }/payment/return?session_id={CHECKOUT_SESSION_ID}&store_name=${encodeURIComponent(
        storeName || "default"
      )}`,
      customer: customerId,
    } as any);

    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      customerId: customerId,
    });
  } catch (error) {
    console.error("Erreur lors de la création de la session:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/save-customer-address", async (req, res) => {
  const { customerId, address, shippingAddress } = req.body;

  try {
    let customer;
    // Update existing customer
    customer = await stripe.customers.update(customerId, {
      name: address.name,
      phone: address.phone,
      address: {
        line1: address.address.line1,
        line2: address.address.line2 || "",
        city: address.address.city,
        state: address.address.state,
        postal_code: address.address.postal_code,
        country: address.address.country,
      },
      shipping: {
        name: shippingAddress.name,
        phone: shippingAddress.phone,
        address: {
          line1: shippingAddress.address.line1,
          line2: shippingAddress.address.line2 || "",
          city: shippingAddress.address.city,
          state: shippingAddress.address.state,
          postal_code: shippingAddress.address.postal_code,
          country: shippingAddress.address.country,
        },
      },
    });
    res.json({ success: true, customerId: customer.id });
  } catch (error) {
    console.error("Error saving customer address:", error);
    res.status(500).json({ error: (error as Error).message });
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
    const customer = session.customer as Stripe.Customer;
    // Préférer le store_name au niveau de la session
    const storeNameFromSession = (session as any)?.metadata?.store_name;
    const referenceFromSession = (session as any)?.metadata?.product_reference;
    const deliveryMethodFromSession = (session as any)?.metadata
      ?.delivery_method;
    const parcelPointCodeFromSession = (session as any)?.metadata
      ?.parcel_point_code;
    const parcelPointNameFromSession = (session as any)?.metadata
      ?.parcel_point_name;
    const parcelPointNetworkFromSession = (session as any)?.metadata
      ?.parcel_point_network;
    const paymentDetails = {
      amount: session.amount_total || 0,
      currency: session.currency || "eur",
      reference: referenceFromSession || "N/A",
      storeName: storeNameFromSession || "LIVE SHOPPING APP",
      customerEmail: customer.email || "N/A",
      customerPhone: customer.phone || "N/A",
      status: session.payment_status,
      deliveryMethod: deliveryMethodFromSession || undefined,
      parcelPointCode: parcelPointCodeFromSession || undefined,
      parcelPointName: parcelPointNameFromSession || undefined,
      parcelPointNetwork: parcelPointNetworkFromSession || undefined,
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
      case "payment_intent.created":
        console.log("PaymentIntent created:", (event.data.object as any).id);
        break;
      case "checkout.session.completed":
        // Session checkout complétée

        try {
          const session: any = event.data.object as any;
          console.log("checkout.session.completed received:", session.id);

          // customer peut être un id de customer ou null
          //const stripeCustomerId = (session.customer as string) || null;

          // récupérer email/phone/adresse depuis la session
          const email = session.customer_details?.email || null;
          const phone = session.customer_details?.phone || null;
          const shipping = session.customer_details?.shipping || null;
          const customerEmail = session.customer_details?.email || null;
          const customerName = session.customer_details?.name || "Client";
          const address = session.customer_details.address || null;
          const deliveryMethod =
            session.customer_details.delivery_method || "N/A";
          const parcelPointNetwork =
            session.customer_details.parcel_point_network || undefined;
          const homeDeliveryNetwork =
            session.customer_details.home_delivery_network || undefined;
          const storeName = session.metadata?.store_name || null;
          const productReference = session.metadata?.product_reference || "N/A";

          // Récupérer le payment intent pour les informations de paiement
          let paymentIntent: Stripe.PaymentIntent | null = null;
          try {
            if (session.payment_intent) {
              paymentIntent = await stripe.paymentIntents.retrieve(
                session.payment_intent as string
              );
            }
          } catch (e) {
            console.warn(
              "⚠️ Unable to retrieve PaymentIntent, falling back to session fields:",
              (e as any)?.message || e
            );
          }

          // Récupérer les informations complètes de la boutique depuis Supabase
          let storeOwnerEmail = null;
          let storeDescription = null;
          let storeLogo = null;

          if (storeName) {
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
          if (session.customer_details?.email && customerName) {
            try {
              await emailService.sendCustomerConfirmation({
                customerEmail: paymentIntent?.receipt_email || customerEmail,
                customerName: customerName,
                storeName: storeName,
                storeDescription: storeDescription,
                storeLogo: storeLogo,
                productReference: productReference,
                amount: paymentIntent?.amount ?? session.amount_total ?? 0,
                currency: paymentIntent?.currency ?? session.currency ?? "eur",
                paymentId: paymentIntent?.id ?? session.id,
                deliveryMethod: deliveryMethod,
                parcelPointNetwork: parcelPointNetwork,
                homeDeliveryNetwork: homeDeliveryNetwork,
              });
              console.log(
                "Customer confirmation email sent",
                paymentIntent?.receipt_email || customerEmail
              );
            } catch (emailErr) {
              console.error(
                "Error sending customer confirmation email:",
                emailErr
              );
            }
          }

          // Envoyer l'email de notification au propriétaire de la boutique
          if (
            storeOwnerEmail &&
            session.customer_details?.email &&
            customerName
          ) {
            try {
              await emailService.sendStoreOwnerNotification({
                ownerEmail: storeOwnerEmail,
                storeName: storeName,
                customerEmail: paymentIntent?.receipt_email || customerEmail,
                customerName: customerName,
                customerPhone: phone || undefined,
                deliveryMethod: deliveryMethod,
                parcelPointNetwork: parcelPointNetwork,
                homeDeliveryNetwork: homeDeliveryNetwork,
                shippingAddress: shipping || undefined,
                pickupPoint: address || undefined,
                productReference: productReference,
                amount: paymentIntent?.amount ?? session.amount_total ?? 0,
                currency: paymentIntent?.currency ?? session.currency ?? "eur",
                paymentId: paymentIntent?.id ?? session.id,
              });
              console.log(
                "Store owner notification email sent to",
                storeOwnerEmail
              );
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
