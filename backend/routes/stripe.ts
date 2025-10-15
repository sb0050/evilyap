import express from "express";
import Stripe from "stripe";
import { emailService } from "../services/emailService";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Fonction pour formater les montants en devise
const formatToCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Fonction pour convertir le poids en string vers un nombre en kg
const formatWeight = (weight?: string): number => {
  if (!weight) return 0;

  // Nettoyer la chaîne et la convertir en minuscules
  const cleanWeight = weight.toString().toLowerCase().trim();

  // Extraire le nombre et l'unité
  const match = cleanWeight.match(/^(\d+(?:\.\d+)?)\s*(g|kg)?$/);

  if (!match) {
    console.warn(`Format de poids non reconnu: ${weight}`);
    return 0;
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || "g"; // Par défaut en grammes si pas d'unité

  // Convertir en kg
  if (unit === "kg") {
    return value;
  } else if (unit === "g") {
    return value / 1000;
  }

  return 0;
};

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
      selectedWeight = 0.25,
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
      deliveryNetwork,
    } = req.body;

    console.log("Creating checkout session with data:", req.body);

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
            clerk_user_id: clerkUserId || "",
            delivery_method: deliveryMethod,
            delivery_network: deliveryNetwork || "",
            ...(parcelPoint && { parcel_point_code: parcelPoint.code }),
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
            clerk_user_id: clerkUserId || "",
            delivery_method: deliveryMethod,
            delivery_network: deliveryNetwork || "",
            ...(parcelPoint && { parcel_point_code: parcelPoint.code }),
          },
        };

        customer = await stripe.customers.create(data);
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
      // Duplicate useful metadata at the session level for easier retrieval
      metadata: {
        store_name: storeName || "LIVE SHOPPING APP",
        product_reference: productReference || "N/A",
        delivery_method: deliveryMethod || "",
        delivery_network: deliveryNetwork || "",
        weight: selectedWeight || "",
      },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Référence: ${productReference || "N/A"}`,
              // Vous pouvez ajouter une description et des images optionnellement
              description: `Les frais de port de ${formatToCurrency(
                deliveryCost
              )} ont été ajouté au montant associé à la référence`,
              // images: ['https://exemple.com/image.png'],
            },
            unit_amount: (amount + deliveryCost) * 100, // Convertir en centimes (ex: 19.99€ devient 1999)
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

    const customer = session.customer as Stripe.Customer;
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
      customerEmail: customer?.email || "N/A",
      customerPhone: customer?.phone || "N/A",
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
          const customer = await stripe.customers.retrieve(session.customer);

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

          // customer peut être un id de customer ou null
          //const stripeCustomerId = (session.customer as string) || null;

          if (customer && !("deleted" in customer)) {
            // récupérer email/phone/adresse depuis la session
            const customerPhone = customer.phone || null;
            const customerId = customer.id;
            const customerShippingAddress: any = customer.shipping?.address;
            const customerEmail = customer.email || null;
            const customerName = customer.name || "Client";
            const customerBillingAddress: any = customer.address;
            const deliveryMethod = customer.metadata.delivery_method || "N/A";
            const deliveryNetwork = customer.metadata.delivery_network || "N/A";
            const clerkUserId = customer.metadata.clerk_user_id || null;
            const pickupPointCode = session.metadata.parcel_point_code || "N/A";
            const dropOffPointCode =
              session.metadata.parcel_point_code || "N/A"; // todo: a modifier
            const storeName = session.metadata?.store_name || null;
            const productReference =
              session.metadata?.product_reference || "N/A";
            const amount = paymentIntent?.amount ?? session.amount_total ?? 0;
            const currency =
              paymentIntent?.currency ?? session.currency ?? "eur";
            const paymentId = paymentIntent?.id ?? session.id;
            const weight = formatWeight(session.metadata?.weight);

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

            const toAddress = {
              type: "RESIDENTIAL",
              contact: {
                email: customerEmail,
                phone: customerPhone?.split("+")[1],
                lastName: (customerName || "").split(" ").slice(-1)[0] || "",
                firstName:
                  (customerName || "").split(" ").slice(0, -1).join(" ") ||
                  customerName ||
                  "",
              },
              location: {
                city: customerBillingAddress?.city,
                street: customerBillingAddress?.line1,
                postalCode: customerBillingAddress?.postal_code,
                countryIsoCode: customerBillingAddress?.country || "FR",
              },
            };

            // From address - prefer env variables if set, otherwise use a generic placeholder
            const fromAddress = {
              type: "BUSINESS",
              contact: {
                email:
                  process.env.BOXTAL_SENDER_EMAIL || "no-reply@example.com",
                phone: process.env.BOXTAL_SENDER_PHONE || "33666366588",
                lastName: process.env.BOXTAL_SENDER_NAME || "LM Outlet",
                firstName: process.env.BOXTAL_SENDER_NAME || "LM Outlet",
              },
              location: {
                city: process.env.BOXTAL_SENDER_CITY || "Paris",
                street: process.env.BOXTAL_SENDER_STREET || "1 Rue Exemple",
                number: process.env.BOXTAL_SENDER_NUMBER || "1",
                postalCode: process.env.BOXTAL_SENDER_POSTAL || "75001",
                countryIsoCode: process.env.BOXTAL_SENDER_COUNTRY || "FR",
              },
            };

            // Compose shipment
            const shipment = {
              packages: [
                {
                  type: "PARCEL",
                  value: {
                    value: (amount || 0) / 100,
                    currency: "EUR",
                  },
                  width: 10, //en cm
                  length: 10, //en cm
                  height: 5, // en cm
                  weight: weight, // poids en Kg
                  content: {
                    id: "content:v1:40110", //40110	Tissus, vêtements neufs
                    description: `${storeName} - ${productReference}`,
                  },
                },
              ],
              toAddress,
              fromAddress,
              pickupPointCode: pickupPointCode,
              dropOffPointCode: dropOffPointCode,
            };

            const createOrderPayload: any = {
              insured: false,
              shipment,
              labelType: "PDF_A4",
              shippingOfferCode: deliveryNetwork,
            };

            console.log(
              "createOrderPayload:",
              JSON.stringify(createOrderPayload)
            );

            // Call internal Boxtal shipping-orders endpoint
            const apiBase =
              process.env.INTERNAL_API_BASE ||
              `http://localhost:${process.env.PORT || 5000}`;
            const resp = await fetch(`${apiBase}/api/boxtal/shipping-orders`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(createOrderPayload),
            });

            if (!resp.ok) {
              const text = await resp.text();
              console.error(
                "Failed to create Boxtal shipping order:",
                resp.status,
                text
              );
            } else {
              const data = await resp.json();
              console.log("Boxtal shipping order created:", data);
            }

            // Envoyer l'email de confirmation au client
            try {
              await emailService.sendCustomerConfirmation({
                customerEmail:
                  paymentIntent?.receipt_email || customerEmail || "",
                customerName: customerName,
                storeName: storeName,
                storeDescription: storeDescription,
                storeLogo: storeLogo,
                productReference: productReference,
                amount: amount,
                currency: currency,
                paymentId: paymentId,
                deliveryMethod: deliveryMethod,
                deliveryNetwork: deliveryNetwork,
                pickupPointCode: pickupPointCode
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

            // Envoyer l'email de notification au propriétaire de la boutique
            if (storeOwnerEmail && customerEmail && customerName) {
              try {
                await emailService.sendStoreOwnerNotification({
                  ownerEmail: storeOwnerEmail,
                  storeName: storeName,
                  customerEmail: paymentIntent?.receipt_email || customerEmail,
                  customerName: customerName,
                  customerPhone: customerPhone || undefined,
                  deliveryMethod: deliveryMethod,
                  deliveryNetwork: deliveryNetwork,
                  shippingAddress: customerShippingAddress,
                  customerAddress: customerBillingAddress,
                  pickupPointCode: pickupPointCode,
                  productReference: productReference,
                  amount: amount,
                  currency: currency,
                  paymentId: paymentId,
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
