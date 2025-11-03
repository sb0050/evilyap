import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  emailService,
  CustomerTrackingEmailData,
} from "../services/emailService";
import { url } from "inspector";

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
const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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

    if (!id) {
      return res.status(400).json({ error: "Missing shipping order id" });
    }

    if (!supabase) {
      console.error("Supabase client not configured");
      return res.status(500).json({ error: "Database not configured" });
    }

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
      const docUrl: string | undefined = (response as any)?.content?.[0]?.url;
      // Boxtal renvoie un objet { status, timestamp, content: ShippingDocument[] }
      console.log("DOCUMENT_CREATED: existing document_url:", docUrl);
      if (docUrl) {
        try {
          const { error: updUrlErr } = await supabase
            .from("shipments")
            .update({ document_url: docUrl })
            .eq("id", id);
          if (updUrlErr) {
            console.error(
              "DOCUMENT_CREATED: error updating document_url:",
              updUrlErr
            );
          }
        } catch (updEx) {
          console.error(
            "DOCUMENT_CREATED: exception updating document_url:",
            updEx
          );
        }
      }
      console.log(
        "DOCUMENT_CREATED: document already marked as created, skipping email"
      );

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

// Proxy de téléchargement du bordereau avec Content-Disposition: attachment
router.get(
  "/shipping-orders/:id/shipping-document/download",
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "Missing shipping order id" });
      }

      const token = await verifyAndRefreshBoxtalToken();
      const apiUrl = `https://api.boxtal.com/shipping/v3.1/shipping-order/${encodeURIComponent(
        id
      )}/shipping-document`;

      const options = {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      } as any;

      // 1) Récupérer la liste des documents auprès de Boxtal
      const docApiResp = await fetch(apiUrl, options);
      if (!docApiResp.ok) {
        const contentType = docApiResp.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const errJson = await docApiResp.json();
          return res.status(docApiResp.status).json(errJson);
        } else {
          const errText = await docApiResp.text();
          return res.status(docApiResp.status).json({
            error: "Failed to get shipping documents",
            details: errText,
          });
        }
      }

      const docPayload: any = await docApiResp.json();
      const docs: any[] = Array.isArray(docPayload?.content)
        ? docPayload.content
        : [];
      // Sélectionner le document LABEL si présent, sinon le premier
      const preferredDoc =
        docs.find((d) => String(d?.type || "").toUpperCase() === "LABEL") ||
        docs[0];

      const docUrl: string | undefined = preferredDoc?.url || docs[0]?.url;
      const docType: string = preferredDoc?.type || "LABEL";
      if (!docUrl) {
        return res
          .status(404)
          .json({ error: "No shipping document available" });
      }

      // 2) Télécharger le PDF et le renvoyer avec Content-Disposition: attachment
      const fileResp = await fetch(docUrl);
      if (!fileResp.ok) {
        const errText = await fileResp.text().catch(() => "");
        return res.status(fileResp.status).json({
          error: "Failed to download shipping document",
          details: errText,
        });
      }

      const buf = Buffer.from(await fileResp.arrayBuffer());
      const ct = fileResp.headers.get("content-type") || "application/pdf";
      const safeType = String(docType || "DOCUMENT").toUpperCase();
      const filename = `${safeType}_${id}.pdf`;

      res.setHeader("Content-Type", ct);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.status(200).send(buf);
    } catch (error) {
      console.error(
        "Error in /api/boxtal/shipping-orders/:id/shipping-document/download:",
        error
      );
      return res.status(500).json({
        error: "Failed to download shipping document",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Récupérer le suivi d'une commande d'expédition
router.get("/shipping-orders/:id/tracking", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Fetching tracking for order ID:", id);

    if (!id) {
      return res.status(400).json({ error: "Missing shipping order id" });
    }

    const token = await verifyAndRefreshBoxtalToken();
    const url = `https://api.boxtal.com/shipping/v3.1/shipping-order/${encodeURIComponent(
      id
    )}/tracking`;

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
      // Retourne l'objet tel que renvoyé par Boxtal (status, timestamp, content[])
      return res.status(200).json(data);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const errorJson = await response.json();
      return res.status(response.status).json(errorJson);
    } else {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "Failed to get shipping tracking",
        details: errorText,
      });
    }
  } catch (error) {
    console.error("Error in /api/boxtal/shipping-orders/:id/tracking:", error);
    return res.status(500).json({
      error: "Failed to get shipping tracking",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Déclarer une demande de retour client (envoi d'email au SAV)
router.get("/shipping-orders/:id/return", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing shipping order id" });
    }

    if (!supabase) {
      console.error("Supabase client not configured");
      return res.status(500).json({ error: "Database not configured" });
    }

    // Récupérer les infos du shipment par shipment_id
    const { data: shipment, error: shipmentError } = await supabase
      .from("shipments")
      .select("*, store_id")
      .eq("shipment_id", id)
      .maybeSingle();

    if (shipmentError) {
      console.error("Supabase error fetching shipment:", shipmentError);
      return res.status(500).json({ error: shipmentError.message });
    }

    if (!shipment) {
      return res.status(404).json({ error: "Shipment not found" });
    }

    // Optionnel: récupérer le store pour enrichir le mail
    let store: any = null;
    if (shipment.store_id) {
      const { data: storeData } = await supabase
        .from("stores")
        .select("id,name,owner_email,slug")
        .eq("id", shipment.store_id)
        .maybeSingle();
      store = storeData || null;
    }

    // Envoyer un email au SAV pour signaler la demande de retour
    const subject = "Demande de retour client";
    const message = `Le client souhaite un retour pour la commande d'expédition ${id}.`;
    const context = JSON.stringify(
      {
        storeName: store?.name || "",
        storeSlug: store?.slug || "",
        storeOwnerEmail: store?.owner_email || "",
        shipment,
      },
      null,
      2
    );

    const sent = await emailService.sendAdminError({
      subject,
      message,
      context,
    });

    // Si l'envoi d'email est validé, mettre à jour return_requested = TRUE
    if (sent) {
      try {
        const { error: updErr } = await supabase
          .from("shipments")
          .update({ return_requested: true })
          .eq("shipment_id", id);
        if (updErr) {
          console.error("Supabase update return_requested failed:", updErr);
        }
      } catch (dbEx) {
        console.error("DB update return_requested exception:", dbEx);
      }
    }

    return res.json({ success: true, emailSent: sent });
  } catch (error) {
    console.error("Error in /api/boxtal/shipping-orders/:id/return:", error);
    return res.status(500).json({
      error: "Failed to process return request",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Annuler une commande d'expédition et mettre à jour le statut en base
router.delete("/shipping-orders/:id", async (req, res) => {
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
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    } as any;

    const response = await fetch(url, options);

    const contentType = response.headers.get("content-type") || "";
    let payload: any = null;
    if (response.ok) {
      payload = await response.json();
    } else if (contentType.includes("application/json")) {
      const errJson = await response.json();
      return res.status(response.status).json(errJson);
    } else {
      const errText = await response.text();
      return res.status(response.status).json({
        error: "Failed to cancel shipping order",
        details: errText,
      });
    }

    // Mettre à jour le statut en base de données si possible
    try {
      if (supabase && payload?.content?.status) {
        const newStatus = String(payload.content.status);
        const { error: updError } = await supabase
          .from("shipments")
          .update({ status: newStatus })
          .eq("shipment_id", id);
        if (updError) {
          console.error("Supabase update shipments status failed:", updError);
        }
      }
    } catch (dbErr) {
      console.error("DB update exception:", dbErr);
    }

    // Envoi d'un email à l'admin avec les infos nécessaires pour remboursement
    try {
      if (supabase) {
        const { data: shipment, error: shipErr } = await supabase
          .from("shipments")
          .select(
            "id, store_id, shipment_id, customer_stripe_id, product_reference, value, reference_value, delivery_cost, status, tracking_url, payment_id"
          )
          .eq("shipment_id", id)
          .single();

        if (shipErr) {
          console.warn("Supabase fetch shipment failed:", shipErr);
        }

        let storeName = "Votre Boutique";
        let storeOwnerEmail: string | undefined = undefined;
        let storeSlug: string | undefined = undefined;
        if (shipment?.store_id) {
          const { data: store, error: storeErr } = await supabase
            .from("stores")
            .select("name, owner_email, slug")
            .eq("id", shipment.store_id)
            .single();
          if (storeErr) {
            console.warn("Supabase fetch store failed:", storeErr);
          } else {
            storeName = (store as any)?.name || storeName;
            storeOwnerEmail = (store as any)?.owner_email || undefined;
            storeSlug = (store as any)?.slug || undefined;
          }
        }

        let customerName: string | undefined = undefined;
        let customerEmail: string | undefined = undefined;
        const customerStripeId: string | undefined =
          shipment?.customer_stripe_id || undefined;
        if (stripe && customerStripeId) {
          try {
            const customer = await stripe.customers.retrieve(customerStripeId);
            customerEmail = (customer as any)?.email || undefined;
            customerName = (customer as any)?.name || undefined;
          } catch (cErr) {
            console.warn("Stripe retrieve customer failed:", cErr);
          }
        }

        const amountRaw =
          typeof shipment?.reference_value === "number"
            ? shipment.reference_value
            : typeof shipment?.value === "number"
            ? shipment.value
            : undefined;
        const deliveryCostRaw =
          typeof shipment?.delivery_cost === "number"
            ? shipment.delivery_cost
            : undefined;
        const totalRaw =
          typeof amountRaw === "number" && typeof deliveryCostRaw === "number"
            ? amountRaw + deliveryCostRaw
            : amountRaw;

        await emailService.sendAdminRefundRequest({
          storeName,
          storeOwnerEmail,
          storeSlug,
          shippingOrderId: id,
          boxtalStatus: String(payload?.content?.status || ""),
          shipmentId: shipment ? String(shipment.id) : undefined,
          customerName,
          customerEmail,
          customerStripeId,
          productReference: shipment?.product_reference || undefined,
          amount: amountRaw,
          deliveryCost: deliveryCostRaw,
          total: totalRaw,
          currency: "EUR",
          paymentId: shipment?.payment_id,
        });
      }
    } catch (emailErr) {
      console.error("Failed to send admin refund email:", emailErr);
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error("Error in DELETE /api/boxtal/shipping-orders/:id:", error);
    return res.status(500).json({
      error: "Failed to cancel shipping order",
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
          console.log(
            `DOCUMENT_CREATED at ${new Date().toISOString()}`,
            JSON.stringify(event)
          );
          try {
            const shippingOrderId: string = event?.shippingOrderId;
            const docUrl: string | undefined =
              event?.payload?.documents?.[0]?.url;

            if (!shippingOrderId || !supabase) {
              console.warn(
                "DOCUMENT_CREATED: missing shippingOrderId or supabase not configured"
              );
              break;
            }

            // Récupérer le shipment correspondant
            const { data: shipment, error: shipmentError } = await supabase
              .from("shipments")
              .select(
                "id, shipment_id, document_created, document_url, store_id, customer_stripe_id, product_reference, value, weight, delivery_method, delivery_network, pickup_point, dropoff_point"
              )
              .eq("shipment_id", shippingOrderId)
              .maybeSingle();

            if (shipmentError) {
              console.error(
                "DOCUMENT_CREATED: Supabase error fetching shipment:",
                shipmentError
              );
              break;
            }
            if (!shipment) {
              console.log(
                "DOCUMENT_CREATED: shipment not found for",
                shippingOrderId
              );
              break;
            }

            // Si déjà créé, mettre à jour l'URL si nécessaire et sortir
            if (shipment.document_created === true) {
              console.log("DOCUMENT_CREATED: existing document_url:", docUrl);
              if (docUrl) {
                try {
                  const { error: updUrlErr } = await supabase
                    .from("shipments")
                    .update({ document_url: docUrl })
                    .eq("id", shipment.id);
                  if (updUrlErr) {
                    console.error(
                      "DOCUMENT_CREATED: error updating document_url:",
                      updUrlErr
                    );
                  }
                } catch (updEx) {
                  console.error(
                    "DOCUMENT_CREATED: exception updating document_url:",
                    updEx
                  );
                }
              }
              console.log(
                "DOCUMENT_CREATED: document already marked as created, skipping email"
              );
              break;
            }

            // Récupérer les infos de la boutique (email du propriétaire + nom)
            let storeOwnerEmail: string | undefined;
            let storeName: string = "Votre Boutique";
            if (shipment.store_id) {
              try {
                const { data: store, error: storeErr } = await supabase
                  .from("stores")
                  .select("owner_email,name")
                  .eq("id", shipment.store_id as any)
                  .maybeSingle();
                if (!storeErr) {
                  storeOwnerEmail = (store as any)?.owner_email || undefined;
                  storeName = (store as any)?.name || storeName;
                } else {
                  console.warn(
                    "DOCUMENT_CREATED: error fetching store:",
                    storeErr
                  );
                }
              } catch (storeEx) {
                console.warn(
                  "DOCUMENT_CREATED: exception fetching store:",
                  storeEx
                );
              }
            }

            if (!storeOwnerEmail) {
              console.warn(
                "DOCUMENT_CREATED: no store owner email found, skipping"
              );
              break;
            }

            // Récupérer les infos client via stripe_id
            let customerEmail: string = "";
            let customerName: string = "";
            try {
              if (stripe && shipment.customer_stripe_id) {
                const customer = await stripe.customers.retrieve(
                  shipment.customer_stripe_id as string
                );
                customerEmail = (customer as any)?.email || "";
                customerName =
                  ((customer as any)?.name as string) ||
                  ((customer as any)?.metadata?.name as any as string) ||
                  "";
              }
            } catch (retrieveErr) {
              console.warn(
                "DOCUMENT_CREATED: unable to retrieve Stripe customer:",
                retrieveErr
              );
            }

            // Télécharger le document pour l'attacher au mail
            let attachments: Array<{
              filename: string;
              content: Buffer;
              contentType?: string;
            }> = [];
            if (docUrl) {
              try {
                const resp = await fetch(docUrl);
                if (resp.ok) {
                  const buf = Buffer.from(await resp.arrayBuffer());
                  const ct =
                    resp.headers.get("content-type") || "application/pdf";
                  let filename = "shipping-document.pdf";
                  try {
                    const urlObj = new URL(docUrl);
                    const parts = urlObj.pathname.split("/").filter(Boolean);
                    filename = parts[parts.length - 1] || filename;
                  } catch {}
                  attachments.push({ filename, content: buf, contentType: ct });
                } else {
                  console.warn(
                    "DOCUMENT_CREATED: failed to download document:",
                    resp.status
                  );
                }
              } catch (downloadEx) {
                console.error(
                  "DOCUMENT_CREATED: exception downloading document:",
                  downloadEx
                );
              }
            }

            // Préparer et envoyer l'email au propriétaire
            const amount = Number(shipment.value || 0);
            const pickupCode = (shipment as any)?.pickup_point?.code || "";
            const deliveryMethod =
              (shipment.delivery_method as any) || "pickup_point";
            const deliveryNetwork = (shipment.delivery_network as any) || "";

            const sentOwner = await emailService.sendStoreOwnerNotification({
              ownerEmail: storeOwnerEmail,
              storeName,
              customerEmail,
              customerName,
              customerPhone: "",
              deliveryMethod,
              deliveryNetwork,
              shippingAddress: {},
              customerAddress: {},
              pickupPointCode: pickupCode,
              productReference: String(shipment.product_reference || ""),
              amount,
              weight: shipment.weight,
              currency: "eur",
              paymentId: "",
              boxtalId: shippingOrderId,
              shipmentId: shipment.shipment_id || shippingOrderId,
              attachments,
              documentPendingNote:
                attachments.length === 0
                  ? "Le document n'a pas pu être joint automatiquement; vous pouvez le télécharger depuis le Tabelau de Bord."
                  : undefined,
            });
            console.log(
              `DOCUMENT_CREATED: store owner email sent=${sentOwner} to ${storeOwnerEmail} for ${shippingOrderId}`
            );

            // Mettre à jour les colonnes document_created et document_url
            try {
              const updateData: any = { document_created: true };
              if (docUrl) updateData.document_url = docUrl;
              const { error: updErr } = await supabase
                .from("shipments")
                .update(updateData)
                .eq("id", shipment.id);
              if (updErr) {
                console.error(
                  "DOCUMENT_CREATED: error updating shipments document fields:",
                  updErr
                );
              }
            } catch (updEx) {
              console.error(
                "DOCUMENT_CREATED: exception updating shipments document fields:",
                updEx
              );
            }
          } catch (e) {
            console.error("DOCUMENT_CREATED processing error:", e);
          }
          break;
        case "TRACKING_CHANGED":
          console.log("TRACKING_CHANGED event:", JSON.stringify(event));
          try {
            const shippingOrderId: string = event?.shippingOrderId;
            const tracking = event?.payload?.trackings?.[0];

            if (!shippingOrderId || !stripe || !supabase) {
              console.warn(
                "TRACKING_CHANGED: missing shippingOrderId or stripe/supabase not configured"
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

            // Vérifier via la table shipments si l'ID existe et si le statut a changé
            const { data: shipment, error: shipmentError } = await supabase
              .from("shipments")
              .select("id, shipment_id, status, customer_stripe_id, store_id")
              .eq("shipment_id", shippingOrderId)
              .maybeSingle();

            if (shipmentError) {
              console.error("Supabase error fetching shipment:", shipmentError);
              break;
            }
            if (!shipment) {
              console.log(
                "TRACKING_CHANGED: shipment not found for",
                shippingOrderId
              );
              break;
            }

            const previousStatus: string | undefined =
              shipment.status || undefined;
            if (previousStatus && currentStatus === previousStatus) {
              console.log(
                "TRACKING_CHANGED: status unchanged vs DB, skipping email",
                currentStatus,
                shippingOrderId
              );
              break;
            }

            // Récupérer le store pour le nom à afficher
            let storeName = "Votre Boutique";
            try {
              if (shipment.store_id) {
                const { data: store, error: storeErr } = await supabase
                  .from("stores")
                  .select("name")
                  .eq("id", shipment.store_id as any)
                  .maybeSingle();
                if (!storeErr && (store as any)?.name) {
                  storeName = (store as any).name;
                }
              }
            } catch (storeEx) {
              console.warn(
                "TRACKING_CHANGED: error fetching store name:",
                storeEx
              );
            }

            // Récupérer l'email du client via stripe_id
            let customerEmail: string | undefined;
            let customerName: string = "";
            try {
              const customer = await stripe.customers.retrieve(
                shipment.customer_stripe_id as string
              );
              customerEmail = (customer as any)?.email || undefined;
              customerName =
                ((customer as any)?.name as string) ||
                ((customer as any)?.metadata?.name as any as string) ||
                "";
            } catch (retrieveErr) {
              console.error(
                "TRACKING_CHANGED: unable to retrieve Stripe customer:",
                retrieveErr
              );
            }

            if (!customerEmail) {
              console.log(
                "TRACKING_CHANGED: no email found for Stripe customer",
                shipment.customer_stripe_id
              );
              break;
            }

            // Construire et envoyer l'email au client
            const emailData: CustomerTrackingEmailData = {
              customerEmail,
              customerName,
              storeName,
              shippingOrderId,
              status: currentStatus || "Mise à jour",
              message: tracking?.message || undefined,
              trackingNumber: tracking?.trackingNumber || undefined,
              packageId: tracking?.packageId,
              packageTrackingUrl: tracking?.packageTrackingUrl || undefined,
            };

            const sent = await emailService.sendCustomerTrackingUpdate(
              emailData
            );
            console.log(
              `TRACKING_CHANGED: email sent=${sent} to ${customerEmail} for ${shippingOrderId}`
            );

            // Mettre à jour le statut du shipment dans la base
            try {
              const { error: updErr } = await supabase
                .from("shipments")
                .update({ status: currentStatus })
                .eq("shipment_id", shippingOrderId);
              if (updErr) {
                console.error(
                  "TRACKING_CHANGED: error updating shipments.status:",
                  updErr
                );
              }
            } catch (updEx) {
              console.error(
                "TRACKING_CHANGED: exception updating shipments.status:",
                updEx
              );
            }
            // Mettre à jour la colonne isFinal si le suivi est final
            try {
              if (tracking?.isFinal === true) {
                const { error: finalErr } = await supabase
                  .from("shipments")
                  .update({ is_final_destination: true })
                  .eq("shipment_id", shippingOrderId);
                if (finalErr) {
                  console.error(
                    "TRACKING_CHANGED: error updating shipments.is_final_destination:",
                    finalErr
                  );
                } else {
                  console.log(
                    "TRACKING_CHANGED: shipments.is_final_destination set to TRUE for",
                    shippingOrderId
                  );
                }
              }
            } catch (finalEx) {
              console.error(
                "TRACKING_CHANGED: exception updating shipments.is_final_destination:",
                finalEx
              );
            }
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
