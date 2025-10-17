import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  emailService,
  StoreOwnerShippingDocEmailData,
  CustomerTrackingEmailData,
} from "../services/emailService";

const router = express.Router();

// Configuration Boxtal
const BOXTAL_CONFIG = {
  client_id: process.env.BOXTAL_ACCESS_KEY || "your_client_id",
  client_secret: process.env.BOXTAL_SECRET_KEY || "your_client_secret",
  auth_url: "https://api.boxtal.com/iam/account-app/token",
};

let boxtalToken: string | null = null;
let boxtalTokenExpiry: number = 0;

// Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Stripe Client (pour rechercher le client par metadata)
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecret
  ? new Stripe(stripeSecret, { apiVersion: "2025-06-30.basil" as any })
  : null;

const verifyAndRefreshBoxtalToken = async () => {
  const currentTime = Date.now();

  // Vérifie si le token est encore valide
  if (boxtalToken && boxtalTokenExpiry && currentTime < boxtalTokenExpiry) {
    return boxtalToken; // Retourne le token valide
  }

  // Si le token est invalide ou expiré, appelle l'endpoint pour en générer un nouveau
  const url = `${BOXTAL_CONFIG.auth_url}`;
  const credentials = Buffer.from(
    `${BOXTAL_CONFIG.client_id}:${BOXTAL_CONFIG.client_secret}`
  ).toString("base64");
  const options = {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  };

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response from Boxtal API:", errorText);
      throw new Error(`Failed to refresh Boxtal token: ${errorText}`);
    }

    const data: any = await response.json();
    console.log("New Boxtal Token obtained");

    // Stocke le nouveau token et son expiration
    boxtalToken = data.accessToken;
    boxtalTokenExpiry = Date.now() + data.expiresIn * 1000; // Convertit les secondes en millisecondes

    return boxtalToken;
  } catch (error) {
    console.error("Error refreshing Boxtal token:", error);
    throw new Error("Unable to refresh Boxtal token");
  }
};

// Route pour obtenir le token d'authentification Boxtal
router.post("/auth", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    res.status(200).json({
      access_token: token,
      expires_in: Math.floor((boxtalTokenExpiry - Date.now()) / 1000),
      token_type: "Bearer",
    });
  } catch (error: any) {
    console.error("Error in /api/boxtal/auth:", error);
    res.status(500).json({ error: "Failed to generate Boxtal token" });
  }
});

//Point de proximité
router.post("/parcel-points", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/parcel-point`;

    // Construire les paramètres URL correctement
    const params = new URLSearchParams();
    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined && req.body[key] !== null) {
        params.append(key, req.body[key].toString());
      }
    });
    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    const response = await fetch(`${url}?${params.toString()}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erreur API Boxtal:", response.status, errorText);
      throw new Error(`API Boxtal error: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error in /api/boxtal/parcel-points:", error);
    res.status(500).json({
      error: "Failed to get parcel points",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

//Passer commande
router.post("/shipping-orders", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/shipping-order`;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    };

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Boxtal shipping order error:", errorData);
      return res.status(response.status).json({
        error: "Failed to create shipping order",
        details: errorData,
      });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Error in /api/boxtal/shipping-orders:", error);
    return res.status(500).json({
      error: "Failed to create shipping order",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Récupérer une commande d'expédition par ID
router.get("/shipping-orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Missing shipping order id" });
    }

    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/shipping-order/${encodeURIComponent(
      id
    )}`;

    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    const response = await fetch(url, options);

    if (response.ok) {
      const data = await response.json();
      // Boxtal renvoie un objet avec status/timestamp/content
      return res.status(200).json(data);
    }

    // Gestion des erreurs (y compris 422 ShippingOrderNotFoundException)
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const errorJson = await response.json();
      return res.status(response.status).json(errorJson);
    } else {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "Failed to get shipping order",
        details: errorText,
      });
    }
  } catch (error) {
    console.error("Error in /api/boxtal/shipping-orders/:id:", error);
    return res.status(500).json({
      error: "Failed to get shipping order",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Récupérer les documents d'expédition pour une commande donnée
router.get("/shipping-orders/:id/shipping-document", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Missing shipping order id" });
    }

    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/shipping-order/${encodeURIComponent(
      id
    )}/shipping-document`;

    console.log("Fetching shipping documents for order ID:", id);

    const options = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    } as any;

    const response = await fetch(url, options);

    if (response.ok) {
      const data = await response.json();
      // Boxtal renvoie un objet { status, timestamp, content: ShippingDocument[] }
      return res.status(200).json(data);
    }

    // Gestion des erreurs (y compris 422: documents non disponibles ou commande introuvable)
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const errorJson = await response.json();
      return res.status(response.status).json(errorJson);
    } else {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "Failed to get shipping documents",
        details: errorText,
      });
    }
  } catch (error) {
    console.error(
      "Error in /api/boxtal/shipping-orders/:id/shipping-document:",
      error
    );
    return res.status(500).json({
      error: "Failed to get shipping documents",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Fonction pour vérifier la signature du webhook Boxtal
const verifyWebhookSignature = (
  payload: string,
  signature: string,
  secret: string
): boolean => {
  if (!signature || !payload || !secret) {
    return false;
  }

  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  return computedSignature === signature;
};

// Route webhook pour recevoir les événements Boxtal
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-bxt-signature"] as string;
      const webhookSecret = process.env.BOXTAL_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("BOXTAL_WEBHOOK_SECRET environment variable is not set");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }

      // Convertir le buffer en string pour la vérification
      const payload = req.body.toString("utf8");

      // Vérifier la signature
      if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
        console.error("Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Parser le JSON
      const event = JSON.parse(payload);

      // Gérer les différents types d'événements
      switch (event.type) {
        case "DOCUMENT_CREATED":
          // Désactivé: les emails avec documents sont envoyés depuis stripe.ts après création
          break;

        case "TRACKING_CHANGED":
          try {
            const shippingOrderId: string = event?.shippingOrderId;
            const tracking = event?.payload?.trackings?.[0];

            if (!shippingOrderId || !stripe) {
              console.warn(
                "TRACKING_CHANGED: missing shippingOrderId or stripe not configured"
              );
              break;
            }

            // N'envoyer l'email que si le statut a changé par rapport au dernier de l'historique
            const currentStatus: string | undefined = tracking?.status;
            const historyArray: any[] = Array.isArray(tracking?.history)
              ? tracking.history
              : [];
            const lastHistoryStatus: string | undefined = historyArray.length
              ? historyArray[historyArray.length - 1]?.status
              : undefined;

            if (lastHistoryStatus && currentStatus === lastHistoryStatus) {
              console.log(
                "TRACKING_CHANGED: status unchanged, skipping email",
                currentStatus,
                shippingOrderId
              );
              break;
            }

              // Rechercher le client Stripe dont la metadata shipping_order_ids contient l'ID
            let customer: Stripe.Customer | null = null;
            try {
              const searchRes = await stripe.customers.search({
              query: `metadata['shipping_order_ids']:'${shippingOrderId}'`,
                limit: 1,
              });
              if (searchRes?.data?.length) {
                customer = searchRes.data[0] as any;
              }
            } catch (searchErr) {
              console.warn("Stripe search failed, fallback to list:", searchErr);
            }

            if (!customer) {
              // Fallback: lister quelques clients et filtrer
              const list = await stripe.customers.list({ limit: 100 });
              customer = (list.data as any[]).find((c) => {
              const ids = ((c.metadata?.shipping_order_ids as any) || "")
                .split(";")
                .map((x: string) => x.trim())
                .filter(Boolean);
                return ids.includes(shippingOrderId);
              }) as any;
            }

            if (!customer || !customer.email) {
              console.log(
                "TRACKING_CHANGED: no matching Stripe customer found for",
                shippingOrderId
              );
              break;
            }

            // Construire et envoyer l'email au client
            const emailData: CustomerTrackingEmailData = {
              customerEmail: customer.email,
              customerName:
                (customer.name as any) || (customer.metadata?.name as any) || "",
              storeName: customer.metadata?.storeName || "Votre Boutique",
              shippingOrderId,
              status: tracking?.status || "Mise à jour",
              message: tracking?.message || undefined,
              trackingNumber: tracking?.trackingNumber || undefined,
              packageId: tracking?.packageId,
              packageTrackingUrl: tracking?.packageTrackingUrl || undefined,
            };

            const sent = await emailService.sendCustomerTrackingUpdate(
              emailData
            );
            console.log(
              `TRACKING_CHANGED: email sent=${sent} to ${customer.email} for ${shippingOrderId}`
            );
          } catch (e) {
            console.error("TRACKING_CHANGED processing error:", e);
          }
          break;

        default:
          console.log("Unhandled event type:", event.type);
      }

      // Répondre avec succès (obligatoire selon la doc Boxtal)
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Error processing Boxtal webhook:", error);
      return res.status(400).json({
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
