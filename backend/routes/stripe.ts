import express from "express";
import Stripe from "stripe";
import { emailService } from "../services/emailService";
import { createClient } from "@supabase/supabase-js";

import slugify from "slugify";

import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";

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
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

// Déterminer la base interne pour les appels HTTP côté backend
// Priorité: INTERNAL_API_BASE > VERCEL_URL (https) > localhost
const getInternalBase = (): string => {
  const explicit = (process.env.INTERNAL_API_BASE || "").trim();
  if (explicit) return explicit;
  const vercelUrl = (process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    return /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
};

// Types pour les requêtes
interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
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
      id: customer.id,
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

// Endpoint dédié pour créer un client Stripe (sans adresse/phone/shipping)
router.post("/create-customer", async (req, res) => {
  try {
    const { name, email, clerkUserId } = req.body as {
      name?: string;
      email?: string;
      clerkUserId?: string;
    };

    if (!name || !email) {
      return res.status(400).json({ error: "name et email requis" });
    }

    // Idempotence: si un client existe déjà pour cet email, le réutiliser
    let existingCustomer: Stripe.Customer | null = null;
    try {
      const existing = await stripe.customers.list({
        email: email as string,
        limit: 1,
      });
      console.log("Existing customers:", existing.data);
      if (existing.data.length > 0) {
        existingCustomer = existing.data[0];
      }
    } catch (listErr) {
      console.warn(
        "Erreur lors de la recherche du client Stripe par email:",
        listErr
      );
    }

    let customer: Stripe.Customer;
    if (existingCustomer) {
      // Mettre à jour minimalement le client existant (nom/metadata clerk_id)
      try {
        customer = await stripe.customers.update(existingCustomer.id, {
          name,
          metadata: {
            clerk_id: clerkUserId || existingCustomer.metadata?.clerk_id || "",
          },
        });
      } catch (updErr) {
        console.warn("Impossible de mettre à jour le client existant:", updErr);
        customer = existingCustomer;
      }
    } else {
      // Créer avec Idempotency-Key basée sur l'email pour éviter les doublons en appels concurrents
      customer = await stripe.customers.create({
        name,
        email,
        metadata: {
          clerk_id: clerkUserId || "",
        },
      });
    }

    const stripeId = customer.id;
    console.log("Created/Updated Stripe Customer ID:", stripeId);
    if (stripeId) {
      // Mettre à jour les métadonnées publiques Clerk directement côté serveur
      // en utilisant clerkClient, si l’utilisateur est authentifié
      try {
        const auth = getAuth(req);
        const targetUserId = clerkUserId || auth?.userId;
        if (auth?.isAuthenticated && targetUserId) {
          console.log("Updating Clerk user:", targetUserId);
          await clerkClient.users.updateUser(targetUserId, {
            publicMetadata: { stripe_id: stripeId, role: "customer" },
          } as any);
        }
      } catch (updErr) {
        console.warn(
          "Mise à jour Clerk publicMetadata (stripe_id) échouée:",
          updErr
        );
      }
    }

    return res.json({ success: true, stripeId, customer });
  } catch (error) {
    console.error("Erreur lors de la création du client Stripe:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
  }
});

router.get("/refund/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) {
      return res.status(400).json({ error: "Payment ID is required" });
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      reason: "requested_by_customer",
    });
    // envoyer mail au client pour confirmer le remboursement
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
      let customerEmail: string | undefined =
        paymentIntent?.receipt_email || undefined;
      let customerName: string | undefined = undefined;
      let storeName: string = "PayLive";
      let productReference: string | number | undefined = undefined;
      let shipmentId: string | undefined = undefined;
      const currency: string = (paymentIntent?.currency || "eur").toUpperCase();
      const refundedAmountNumber: number | undefined =
        typeof (refund as any)?.amount === "number"
          ? (refund as any).amount / 100
          : undefined;

      if (paymentIntent?.customer) {
        try {
          const cust = await stripe.customers.retrieve(
            paymentIntent.customer as string
          );
          customerEmail = customerEmail || (cust as any)?.email || undefined;
          customerName = (cust as any)?.name || customerName;
        } catch (cErr) {
          console.warn("refund: unable to retrieve Stripe customer:", cErr);
        }
      }

      try {
        const { data: shipment, error: shipErr } = await supabase
          .from("shipments")
          .select(
            "id, store_id, product_reference, shipment_id, customer_stripe_id, value, delivery_cost"
          )
          .eq("payment_id", paymentId)
          .maybeSingle();
        if (!shipErr && shipment) {
          productReference = (shipment as any)?.product_reference || undefined;
          shipmentId = (shipment as any)?.shipment_id || undefined;
          if ((shipment as any)?.store_id) {
            const { data: store, error: storeErr } = await supabase
              .from("stores")
              .select("name")
              .eq("id", (shipment as any).store_id)
              .maybeSingle();
            if (!storeErr && (store as any)?.name) {
              storeName = (store as any).name as string;
            }
          }
          if (!customerEmail && (shipment as any)?.customer_stripe_id) {
            try {
              const cust2 = await stripe.customers.retrieve(
                (shipment as any).customer_stripe_id as string
              );
              customerEmail = (cust2 as any)?.email || customerEmail;
              customerName = (cust2 as any)?.name || customerName;
            } catch (c2Err) {
              console.warn(
                "refund: fallback retrieve Stripe customer failed:",
                c2Err
              );
            }
          }
        }

        // mettre à jour la balance de la boutique
        const { data: store, error: storeErr } = await supabase
          .from("stores")
          .select("balance")
          .eq("id", (shipment as any).store_id)
          .maybeSingle();
        if (!storeErr && (store as any)?.balance) {
          const newBalance = (store as any).balance + refundedAmountNumber || 0;
          await supabase
            .from("stores")
            .update({
              balance: newBalance,
            })
            .eq("id", (shipment as any).store_id);
        }
      } catch (shipEx) {
        console.warn("refund: error fetching shipment/store:", shipEx);
      }

      if (customerEmail) {
        await emailService.sendCustomerRefundConfirmation({
          customerEmail,
          customerName: customerName || "Client",
          storeName,
          paymentId,
          refundId: refund.id,
          amount: refundedAmountNumber,
          currency,
          productReference,
          shipmentId,
        });
      } else {
        console.log(
          "refund: no customer email available to send refund confirmation",
          paymentId
        );
      }
    } catch (emailEx) {
      console.error(
        "refund: error while preparing/sending customer refund email:",
        emailEx
      );
    }

    //mettre a jour la colonne refund de shipments
    await supabase
      .from("shipments")
      .update({
        refund: refund.id,
      })
      .eq("payment_id", paymentId);

    return res.json({ success: true, refund });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
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
      cartItemIds,
    } = req.body;

    const pickupPointCode = parcelPoint?.code || "";
    const dropOffPointCode = parcelPoint?.code || "";

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
      console.log("Existing customers:", existingCustomers.data);

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
              : ({} as Stripe.CustomerUpdateParams.Shipping),
          metadata: {
            clerk_user_id: clerkUserId || "",
            delivery_method: deliveryMethod || "",
            home_delivery_network: deliveryNetwork || "",
            store_name: storeName || "",
          },
        });
        customerId = customer.id;
      }
    } catch (customerError) {
      console.error("Erreur lors de la gestion du client:", customerError);
      res
        .status(500)
        .json({ error: "Erreur lors de la création/mise à jour du client" });
      return;
    }

    const formatDeliveryMethod = (deliveryMethod: string) => {
      if (deliveryMethod === "pickup_point") return "par point relais";
      if (deliveryMethod === "home_delivery") return "à domicile";
      if (deliveryMethod === "store_pickup") return "retrait en magasin";
      return deliveryMethod || "inconnue";
    };

    // 1. Créer un produit
    const product = await stripe.products.create({
      name: `Référence: ${productReference || "N/A"}`,
      description: `Boutique: ${storeName || ""}`,
      type: "good",
      shippable: true,
    });

    // 2. Créer un prix pour ce produit
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(amount * 100), // Montant en centimes (20€)
      currency: "eur",
    });

    // Créer la session de checkout intégrée
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      payment_method_types: ["card", "paypal"],
      customer: customerId,
      payment_intent_data: {
        description: `store: ${storeName || ""} - reference: ${
          productReference || ""
        }`,
        metadata: {
          store_name: storeName || "PayLive",
          product_reference: productReference || "N/A",
          cart_item_ids: Array.isArray(cartItemIds)
            ? (cartItemIds as any[]).join(",")
            : typeof cartItemIds === "string"
            ? cartItemIds
            : "",
        },
      },
      // Duplicate useful metadata at the session level for easier retrieval
      metadata: {
        store_name: storeName || "PayLive",
        product_reference: productReference || "N/A",
        delivery_method: deliveryMethod || "",
        delivery_network: deliveryNetwork || "",
        weight: String(selectedWeight || ""),
        pickup_point: JSON.stringify({
          street: parcelPoint?.location?.street,
          city: parcelPoint?.location?.city,
          state: parcelPoint?.location?.state || "",
          postal_code: parcelPoint?.location?.postalCode,
          country: parcelPoint?.location?.countryIsoCode || "FR",
          code: parcelPoint?.code || "",
          name: parcelPoint?.name || "",
          network: parcelPoint?.network || "",
          shippingOfferCode: parcelPoint?.shippingOfferCode || "",
        }),
        dropoff_point: JSON.stringify({
          street: parcelPoint?.location?.street,
          city: parcelPoint?.location?.city,
          state: parcelPoint?.location?.state || "",
          postal_code: parcelPoint?.location?.postalCode,
          country: parcelPoint?.location?.countryIsoCode || "FR",
          code: parcelPoint?.code || "",
          name: parcelPoint?.name || "",
          network: parcelPoint?.network || "",
          shippingOfferCode: parcelPoint?.shippingOfferCode || "",
        }),
        cart_item_ids: Array.isArray(cartItemIds)
          ? (cartItemIds as any[]).join(",")
          : typeof cartItemIds === "string"
          ? cartItemIds
          : "",
      },
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Frais asscoiés à votre méthode de livraison",
              description: `Livraison ${formatDeliveryMethod(
                deliveryMethod || ""
              )} (${deliveryNetwork || ""})`,
            },
            unit_amount: Math.round(deliveryCost * 100), // Frais de livraison en centimes (5€)
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      return_url: `${
        process.env.CLIENT_URL
      }/payment/return?session_id={CHECKOUT_SESSION_ID}&store_name=${encodeURIComponent(
        slugify(storeName, { lower: true, strict: true }) || "default"
      )}`,
      allow_promotion_codes: true,
      // Ajouter la collecte de consentement
      consent_collection: {
        terms_of_service: "required", // Rend la case à cocher obligatoire
      },
      // Personnaliser le texte associé (optionnel)
      custom_text: {
        terms_of_service_acceptance: {
          message: `J'accepte les [conditions générales de vente](${CLOUDFRONT_URL}/documents/terms_and_conditions) et la [politique de confidentialité](${CLOUDFRONT_URL}/documents/privacy_policy) de PayLive.`,
        },
      },
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
      storeName: storeNameFromSession || "PayLive",
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

    let paymentIntent: Stripe.PaymentIntent | null = null;

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
          console.log("Session metadata:", session.metadata);
          // Résoudre l'ID client en évitant les erreurs lorsque session.customer est null
          let resolvedCustomerId: string | null =
            typeof session.customer === "string"
              ? (session.customer as string)
              : null;

          // Récupérer le payment intent pour les informations de paiement et fallback customer
          try {
            if (session.payment_intent) {
              paymentIntent = await stripe.paymentIntents.retrieve(
                session.payment_intent as string
              );
              if (!resolvedCustomerId && paymentIntent?.customer) {
                resolvedCustomerId = paymentIntent.customer as string;
              }
            }
          } catch (e) {
            console.warn(
              "⚠️ Unable to retrieve PaymentIntent, falling back to session fields:",
              (e as any)?.message || e
            );
          }

          let customer: Stripe.Customer | null = null;
          if (resolvedCustomerId) {
            customer = (await stripe.customers.retrieve(
              resolvedCustomerId
            )) as Stripe.Customer;
          } else {
            console.warn(
              "checkout.session.completed without a linked customer; using session fallbacks"
            );
          }

          // customer peut être un id de customer ou null
          //const stripeCustomerId = (session.customer as string) || null;

          if (customer && !("deleted" in customer)) {
            // récupérer email/phone/adresse depuis la session
            const customerPhone = customer.phone || null;
            const customerId = customer.id;
            const customerShippingAddress: any = customer.shipping;
            const customerEmail = customer.email || null;
            const customerName = customer.name || "Client";
            const customerBillingAddress: any = customer.address;
            const deliveryMethod =
              (session.metadata?.delivery_method as any) ||
              customer.metadata?.delivery_method ||
              "N/A";
            const deliveryNetwork =
              (session.metadata?.delivery_network as any) ||
              customer.metadata?.delivery_network ||
              "N/A";
            const clerkUserId = customer.metadata.clerk_user_id || null;
            let pickupPoint: any = {};
            let dropOffPoint: any = {};
            try {
              pickupPoint = session.metadata?.pickup_point
                ? JSON.parse(session.metadata.pickup_point as any)
                : {};
            } catch (e) {
              console.warn("Invalid JSON in session.metadata.pickup_point:", e);
              pickupPoint = {};
            }
            try {
              dropOffPoint = session.metadata?.dropoff_point
                ? JSON.parse(session.metadata.dropoff_point as any)
                : {};
            } catch (e) {
              console.warn(
                "Invalid JSON in session.metadata.dropoff_point:",
                e
              );
              dropOffPoint = {};
            }
            const storeName = session.metadata?.store_name || null;
            const productReference =
              session.metadata?.product_reference || "N/A";
            const amount = paymentIntent?.amount ?? session.amount_total ?? 0;
            const currency =
              paymentIntent?.currency ?? session.currency ?? "eur";
            const paymentId = paymentIntent?.id ?? session.id;
            const weight = formatWeight(session.metadata?.weight);
            let estimatedDeliveryDate: string = "";
            let boxtalId = "";
            let trackingUrl = "";
            let shipmentId = "";

            // Supprimer les items du panier si des identifiants ont été passés via la session
            try {
              const cartItemsRaw =
                (session.metadata?.cart_item_ids as any) || "";
              const cartItemIds: number[] = Array.isArray(cartItemsRaw)
                ? (cartItemsRaw as any[])
                    .map((x) => Number(String(x).trim()))
                    .filter((n) => Number.isFinite(n))
                : String(cartItemsRaw)
                    .split(",")
                    .map((s) => Number(s.trim()))
                    .filter((n) => Number.isFinite(n));
              if (cartItemIds.length > 0) {
                const { error: cartDelErr } = await supabase
                  .from("carts")
                  .delete()
                  .in("id", cartItemIds);
                if (cartDelErr) {
                  console.error(
                    "Error deleting cart items after payment:",
                    cartDelErr.message
                  );
                }
              }
            } catch (cartCleanupErr) {
              console.error(
                "Unexpected error during cart cleanup:",
                cartCleanupErr
              );
            }
            // Extraire les produits des line_items

            const sessionId = event.data.object.id;
            const sessionRetrieved = await stripe.checkout.sessions.retrieve(
              sessionId,
              {
                expand: ["line_items.data.price.product"],
              }
            );

            const products = sessionRetrieved.line_items?.data
              .filter(
                (item: any) =>
                  item.price.product.type === "good" &&
                  item.price.product.shippable
              )
              .map((item: any) => ({
                id: item.price.product.id,
                name: item.price.product.name,
                description: item.price.product.description,
                image: item.price.product.images?.[0],
                quantity: item.quantity,
                amount_total: item.amount_total / 100, // Convertir centimes en unités
                currency: item.currency,
                unit_price: item.price.unit_amount / 100,
                price_id: item.price.id,
              }));
            const product_amount = Math.round(products?.[0]?.amount_total || 0);

            // Récupérer les informations complètes de la boutique depuis Supabase
            let storeOwnerEmail = null;
            let storeDescription = null;
            let storeLogo = null;
            let storeId: number | null = null;
            let storeSlug: string | null = null;
            let storeAddress: any = null;

            if (storeName) {
              try {
                const { data: storeData, error: storeError } = await supabase
                  .from("stores")
                  .select("id, slug, owner_email, description, address")
                  .eq("name", storeName)
                  .single();

                if (!storeError && storeData) {
                  storeOwnerEmail = storeData.owner_email;
                  storeDescription = storeData.description;
                  storeId = storeData.id || null;
                  storeSlug = storeData.slug || null;
                  storeAddress = (storeData as any)?.address || null;
                  if (process.env.CLOUDFRONT_URL && storeSlug) {
                    storeLogo = `${process.env.CLOUDFRONT_URL}/images/${storeId}`;
                  }
                }
              } catch (storeErr) {
                console.error("Error fetching store data:", storeErr);
              }
            }

            // Préparer l'adresse d'expéditeur à partir des infos du store si disponibles

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

            // From address: privilégier l'adresse de la boutique si connue, sinon variables d'env / valeurs par défaut
            const fromAddress = {
              type: "BUSINESS",
              contact: {
                email: "no-reply@paylive.cc",
                phone: (storeAddress as any)?.phone || "33666477877",
                lastName: storeName || "PayLive",
                firstName: storeName || "PayLive",
              },
              location: {
                city: (storeAddress?.city as any) || "Paris",
                street: (storeAddress?.line1 as any) || "1 Rue Exemple",
                number: (storeAddress?.line1 as any).split(" ")[0] || "1",
                postalCode: (storeAddress?.postal_code as any) || "75001",
                countryIsoCode: (storeAddress?.country as any) || "FR",
              },
            };

            // Dimensions dynamiques selon l'offre de transport
            const offerDimensions: Record<
              string,
              { width: number; length: number; height: number }
            > = {
              "MONR-CpourToi": { width: 41, length: 64, height: 38 },
              "MONR-DomicileFrance": { width: 41, length: 64, height: 38 },
              "SOGP-RelaisColis": { width: 50, length: 80, height: 40 },
              "CHRP-Chrono2ShopDirect": { width: 30, length: 100, height: 20 },
              "CHRP-Chrono18": { width: 30, length: 100, height: 20 },
              "UPSE-Express": { width: 41, length: 64, height: 38 },
              "POFR-ColissimoAccess": { width: 24, length: 34, height: 26 },
            };
            const dims = offerDimensions[deliveryNetwork] || {
              width: 10,
              length: 10,
              height: 5,
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
                  width: dims.width, // en cm
                  length: dims.length, // en cm
                  height: dims.height, // en cm
                  weight: weight, // poids en Kg
                  content: {
                    id: "content:v1:40110", //40110\tTissus, vêtements neufs
                    description: `${storeName} - ${productReference}`,
                  },
                },
              ],
              toAddress,
              fromAddress,
              pickupPointCode: pickupPoint.code,
              dropOffPointCode: dropOffPoint.code,
            };

            const createOrderPayload: any = {
              insured: false,
              shipment,
              labelType: "PDF_A4",
              shippingOfferCode: deliveryNetwork,
            };
            console.log("createOrderPayload:", createOrderPayload);

            let dataBoxtal: any = {};
            let attachments: Array<{
              filename: string;
              content: Buffer;
              contentType?: string;
            }> = [];

            if (deliveryMethod !== "store_pickup") {
              // Call internal Boxtal shipping-orders endpoint
              const apiBase = getInternalBase();
              const resp = await fetch(
                `${apiBase}/api/boxtal/shipping-orders`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(createOrderPayload),
                }
              );

              if (!resp.ok) {
                const text = await resp.text();
                console.error(
                  "Failed to create Boxtal shipping order:",
                  resp.status,
                  text
                );
                await emailService.sendAdminError({
                  subject: "Boxtal shipping order échec",
                  message: `Echec de création Boxtal pour store ${storeName} / network ${deliveryNetwork}`,
                  context: text,
                });
              } else {
                dataBoxtal = await resp.json();
                estimatedDeliveryDate =
                  dataBoxtal.content.estimatedDeliveryDate;
                boxtalId = dataBoxtal.content.id;
                console.log("Boxtal shipping order created:", dataBoxtal);

                // Attendre, tenter récupération du document 2× avec 2s de délai et notifier le propriétaire
                try {
                  const shippingOrderIdForDoc = boxtalId;
                  const base = getInternalBase();
                  console.log("shippingOrderIdForDoc:", shippingOrderIdForDoc);

                  for (let attempt = 1; attempt <= 2; attempt++) {
                    // Attente 10 s avant chaque tentative pour laisser Boxtal générer le document
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                    console.log(
                      `Attempt ${attempt}: Checking for document at ${new Date().toISOString()}`
                    );

                    const docApiResp = await fetch(
                      `${base}/api/boxtal/shipping-orders/${encodeURIComponent(
                        shippingOrderIdForDoc
                      )}/shipping-document`,
                      { method: "GET" }
                    );

                    if (docApiResp.ok) {
                      const docJson: any = await docApiResp.json();
                      const docs: any[] = docJson?.content || [];
                      const labelDoc =
                        docs.find((d) => d.type === "LABEL") || docs[0];

                      if (labelDoc?.url) {
                        const docResp = await fetch(labelDoc.url);
                        if (docResp.ok) {
                          const buf = Buffer.from(await docResp.arrayBuffer());
                          attachments = [
                            {
                              filename: `${
                                labelDoc.type || "LABEL"
                              }_${shippingOrderIdForDoc}.pdf`,
                              content: buf,
                              contentType: "application/pdf",
                            },
                          ];
                          break; // pièce jointe prête, on sort
                        } else {
                          console.warn(
                            "Failed to download shipping document PDF:",
                            labelDoc.url,
                            docResp.status
                          );
                        }
                      } else {
                        console.warn(
                          "No shipping document available in Boxtal response"
                        );
                      }
                    } else {
                      const errText = await docApiResp.text();
                      console.log(
                        "Failed to fetch shipping document from Boxtal:",
                        docApiResp.status,
                        errText
                      );

                      console.warn(
                        "Failed to get shipping documents via internal route:",
                        docApiResp.status,
                        errText
                      );
                      // autres erreurs : on log et on sort de la boucle
                      break;
                    }
                  }

                  // Marquer document_created = true si une pièce jointe PDF a été récupérée
                  if (attachments && attachments.length > 0) {
                    try {
                      const { error: updateErr } = await supabase
                        .from("shipments")
                        .update({ document_created: true })
                        .eq("shipment_id", shippingOrderIdForDoc);
                      if (updateErr) {
                        console.error(
                          "Error updating shipments.document_created:",
                          updateErr
                        );
                        await emailService.sendAdminError({
                          subject: "Erreur update document_created",
                          message: `Mise à jour échouée pour boxtalId ${shippingOrderIdForDoc}`,
                          context: JSON.stringify(updateErr),
                        });
                      }
                    } catch (updEx) {
                      console.error(
                        "Exception updating shipments.document_created:",
                        updEx
                      );
                    }
                  }
                } catch (e) {
                  console.error(
                    "Error sending store owner notification with document:",
                    e
                  );
                }
              }
            } // end if deliveryMethod === "pickup_point"

            // Enregistrer l'expédition dans la table shipments (plus de metadata Stripe)
            try {
              const { data: shipmentInsert, error: shipmentInsertError } =
                await supabase
                  .from("shipments")
                  .insert({
                    store_id: storeId,
                    customer_stripe_id: customerId || null,
                    shipment_id: boxtalId,
                    status: (dataBoxtal?.content?.status as any) || null,
                    estimated_delivery_date: estimatedDeliveryDate || null,
                    created_at: dataBoxtal?.timestamp
                      ? new Date(dataBoxtal.timestamp).toISOString()
                      : new Date().toISOString(),
                    document_created: attachments && attachments.length > 0,
                    delivery_method: deliveryMethod,
                    delivery_network: deliveryNetwork,
                    dropoff_point: dropOffPoint,
                    pickup_point: pickupPoint,
                    weight: session.metadata?.weight || null,
                    product_reference: productReference || null,
                    value: (amount || 0) / 100,
                    delivery_cost:
                      dataBoxtal?.content?.deliveryPriceExclTax?.value || 0,
                    reference_value: product_amount || 0,
                    payment_id: paymentIntent?.id || null,
                  })
                  .select("id")
                  .single();
              shipmentId = shipmentInsert?.id || "";

              if (shipmentInsertError) {
                console.error(
                  "Error inserting shipment row:",
                  shipmentInsertError
                );
                await emailService.sendAdminError({
                  subject: "Erreur insertion shipments",
                  message: `Insertion échouée pour boxtalId ${boxtalId} (store ${storeName}).`,
                  context: JSON.stringify(shipmentInsertError),
                });
              } else {
                console.log("Shipments row inserted:", shipmentInsert);
              }
            } catch (dbErr) {
              console.error("DB insert shipments exception:", dbErr);
              await emailService.sendAdminError({
                subject: "Erreur insertion shipments",
                message: `Insertion échouée pour boxtalId ${boxtalId} (store ${storeName}).`,
                context: JSON.stringify(dbErr),
              });
            }

            // Recuperer le lien de suivi de la livraison depuis l'appel à boxtal et l'enregistrer dans la table shipments
            if (deliveryMethod !== "store_pickup") {
              console.log("Fetching tracking for boxtalId:", boxtalId);
              try {
                if (boxtalId) {
                  console.log("boxtalId:", boxtalId);
                  const base = getInternalBase();

                  const trackingResp = await fetch(
                    `${base}/api/boxtal/shipping-orders/${encodeURIComponent(
                      boxtalId
                    )}/tracking`,
                    { method: "GET" }
                  );

                  if (trackingResp.ok) {
                    const trackingJson: any = await trackingResp.json();
                    console.log(
                      "Boxtal tracking response:",
                      JSON.stringify(trackingJson)
                    );
                    let packageTrackingUrl: string | undefined = undefined;

                    // Boxtal peut renvoyer content comme objet ou tableau d'événements
                    if (Array.isArray(trackingJson?.content)) {
                      const firstWithUrl = (trackingJson.content || []).find(
                        (ev: any) => ev && ev.packageTrackingUrl
                      );
                      packageTrackingUrl =
                        firstWithUrl?.packageTrackingUrl ||
                        (trackingJson.content[0]?.packageTrackingUrl as any);
                    } else {
                      packageTrackingUrl =
                        trackingJson?.content?.packageTrackingUrl;
                    }

                    if (packageTrackingUrl) {
                      // Mettre à jour la variable utilisée pour les emails
                      trackingUrl = packageTrackingUrl;

                      // Mettre à jour la colonne tracking_url dans la table shipments
                      try {
                        const { error: updError } = await supabase
                          .from("shipments")
                          .update({ tracking_url: packageTrackingUrl })
                          .eq("shipment_id", boxtalId);
                        if (updError) {
                          console.error(
                            "Error updating shipments.tracking_url:",
                            updError
                          );
                        }
                      } catch (updEx) {
                        console.error(
                          "Exception updating shipments.tracking_url:",
                          updEx
                        );
                      }
                    }
                  } else {
                    const errText = await trackingResp.text();
                    console.warn(
                      "Boxtal tracking API non-OK:",
                      trackingResp.status,
                      errText
                    );
                  }
                }
              } catch (trackErr) {
                console.error(
                  "Error retrieving tracking URL from internal Boxtal API:",
                  trackErr
                );
              }
            }

            // Envoyer l'email de confirmation au client
            try {
              await emailService.sendCustomerConfirmation({
                customerEmail:
                  paymentIntent?.receipt_email || customerEmail || "",
                customerName: customerName,
                storeName: storeName,
                storeDescription: storeDescription,
                storeLogo: `${process.env.CLOUDFRONT_URL}/images/${storeId}`,
                storeAddress: storeAddress,
                productReference: productReference,
                amount: amount / 100,
                currency: currency,
                paymentId: paymentId,
                boxtalId: boxtalId,
                shipmentId: shipmentId,
                deliveryMethod: deliveryMethod,
                deliveryNetwork: deliveryNetwork,
                pickupPointCode: pickupPoint.code || "",
                estimatedDeliveryDate: estimatedDeliveryDate,
                trackingUrl: trackingUrl,
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

            try {
              // Envoyer l'email au propriétaire (avec ou sans pièce jointe)
              if (storeOwnerEmail) {
                console.log("product_amount:", product_amount);
                const sentOwner = await emailService.sendStoreOwnerNotification(
                  {
                    ownerEmail: storeOwnerEmail,
                    storeName: storeName || "Votre Boutique",
                    customerEmail: customerEmail || "",
                    customerName: customerName || "",
                    customerPhone: customerPhone || "",
                    deliveryMethod,
                    deliveryNetwork,
                    shippingAddress: {
                      name: (customerShippingAddress as any)?.name,
                      address: {
                        line1: (customerShippingAddress as any)?.address?.line1,
                        line2:
                          (customerShippingAddress as any)?.address?.line2 ||
                          "",
                        city: (customerShippingAddress as any)?.address?.city,
                        state: (customerShippingAddress as any)?.address?.state,
                        postal_code: (customerShippingAddress as any)?.address
                          ?.postal_code,
                        country: (customerShippingAddress as any)?.address
                          ?.country,
                      },
                    },
                    customerAddress: {},
                    pickupPointCode: pickupPoint.code || "",
                    productReference,
                    amount: product_amount || amount,
                    weight,
                    currency,
                    paymentId,
                    boxtalId,
                    shipmentId,
                    attachments,
                    documentPendingNote:
                      attachments?.length === 0
                        ? "Vous pourrez télécharger votre bordereau d'envoi depuis votre tableau de bord dans quelques minutes."
                        : undefined,
                  }
                );
                console.log(
                  "Store owner notification sent",
                  sentOwner,
                  storeOwnerEmail
                );
                // Mettre à jour le solde de la boutique après envoi de l'email au propriétaire
                try {
                  if (sentOwner && storeId) {
                    const { data: storeBalanceRow, error: storeBalanceErr } =
                      await supabase
                        .from("stores")
                        .select("balance")
                        .eq("id", storeId)
                        .single();
                    if (storeBalanceErr) {
                      console.error(
                        "Error fetching current store balance:",
                        storeBalanceErr
                      );
                    } else {
                      const currentBalance = Number(
                        (storeBalanceRow as any)?.balance || 0
                      );
                      const increment = Number(product_amount || 0);
                      const newBalance = currentBalance + increment;
                      const { error: balanceUpdateErr } = await supabase
                        .from("stores")
                        .update({ balance: newBalance })
                        .eq("id", storeId);
                      if (balanceUpdateErr) {
                        console.error(
                          "Error updating stores.balance:",
                          balanceUpdateErr
                        );
                      } else {
                        console.log(
                          `stores.balance updated for store ${storeId}: +${increment} => ${newBalance}`
                        );
                      }
                    }
                  }
                } catch (balanceEx) {
                  console.error(
                    "Exception updating stores.balance:",
                    balanceEx
                  );
                }
              } else {
                console.warn(
                  "No storeOwnerEmail found, skipping owner notification"
                );
              }
            } catch (ownerEmailErr) {
              console.error(
                "Error sending store owner notification:",
                ownerEmailErr
              );
            }

            // Notification storeowner supprimée: l’envoi des documents se fait via webhook Boxtal
          }
        } catch (sessionErr) {
          // envoyer l'erreur à l'admin
          await emailService.sendAdminError({
            subject: "Erreur lors de la création de la session de paiement",
            message: `Une erreur est survenue lors de la création de la session de paiement pour l'email ${
              paymentIntent?.receipt_email
            }: ${JSON.stringify(sessionErr)}`,
          });
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

// Nouveau endpoint: récupérer un client Stripe par son ID
router.get("/get-customer-by-id", async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) {
    res.status(400).json({ error: "Customer ID is required" });
    return;
  }
  try {
    const customer = await stripe.customers.retrieve(customerId as string);
    if (!customer || (customer as any).deleted) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const c = customer as Stripe.Customer;
    const customerData = {
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      shipping: c.shipping,
      deliveryMethod: c.metadata?.delivery_method,
      parcelPointCode: c.metadata?.parcel_point_code,
      homeDeliveryNetwork: c.metadata?.home_delivery_network,
      shippingOrderIds: c.metadata?.shipping_order_ids,
      clerkUserId: (c.metadata as any)?.clerk_user_id,
    } as any;
    res.json({ customer: customerData });
  } catch (error) {
    console.error("Error retrieving customer by ID:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Nouveau endpoint: récupérer les comptes externes Clerk d’un utilisateur via clerk_user_id
router.get("/get-clerk-user-by-id", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const clerkUserId = (req.query.clerkUserId as string) || "";
    if (!clerkUserId) {
      return res.status(400).json({ error: "Missing clerkUserId" });
    }

    const user = await clerkClient.users.getUser(clerkUserId);

    const externalAccounts = (user?.externalAccounts || []).map((acc: any) => ({
      id: acc.id,
      provider: acc.provider,
      username: acc.username || null,
      emailAddress: acc.emailAddress || null,
      firstName: acc.firstName || null,
      lastName: acc.lastName || null,
      phoneNumber: acc.phoneNumber || null,
      providerUserId: acc.providerUserId || null,
      verified:
        acc.verification && acc.verification.status
          ? acc.verification.status === "verified"
          : null,
    }));
    const primaryEmail =
      (user?.emailAddresses || []).find(
        (e: any) => e.id === user?.primaryEmailAddressId
      )?.emailAddress ||
      (user?.emailAddresses || [])[0]?.emailAddress ||
      null;
    const primaryPhone =
      (user?.phoneNumbers || []).find(
        (p: any) => p.id === user?.primaryPhoneNumberId
      )?.phoneNumber ||
      (user?.phoneNumbers || [])[0]?.phoneNumber ||
      null;
    return res.json({
      user: {
        id: user.id,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        imageUrl: user.imageUrl || null,
        hasImage: !!user.imageUrl,
        emailAddress: primaryEmail,
        phoneNumber: primaryPhone,
        externalAccounts,
      },
    });
  } catch (error) {
    console.error("Error retrieving Clerk user:", error);
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
