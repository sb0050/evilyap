import express from "express";
import { XMLParser } from "fast-xml-parser";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  emailService,
  CustomerTrackingEmailData,
} from "../services/emailService";

const router = express.Router();

// Configuration Boxtal
const BOXTAL_API = process.env.BOXTAL_API || "";
const BOXTAL_CONFIG = {
  client_id: process.env.BOXTAL_ACCESS_KEY || "your_client_id",
  client_secret: process.env.BOXTAL_SECRET_KEY || "your_client_secret",
  auth_url: `${BOXTAL_API}/iam/account-app/token`,
};

const BOXTAL_API_V1_CONFIG = {
  client_id: process.env.BOXTAL_API_V1_ACCESS_KEY || "your_client_id",
  client_secret: process.env.BOXTAL_API_V1_SECRET || "your_client_secret",
  api_url: process.env.BOXTAL_API_V1 || "https://www.envoimoinscher.com/api/v1",
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
    `${BOXTAL_CONFIG.client_id}:${BOXTAL_CONFIG.client_secret}`,
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

// Cotation
router.post("/cotation", async (req, res) => {
  const offerDimensions: any = {
    FR: {
      "MONR-CpourToi": { width: 41, length: 64, height: 38 },
      "MONR-DomicileFrance": { width: 41, length: 64, height: 38 },
      "SOGP-RelaisColis": { width: 50, length: 80, height: 40 },
      "CHRP-Chrono2ShopDirect": { width: 30, length: 100, height: 20 },
      "POFR-ColissimoAccess": { width: 24, length: 34, height: 26 },
      "COPR-CoprRelaisDomicileNat": {
        width: 49,
        length: 69,
        height: 29,
      },
      "COPR-CoprRelaisRelaisNat": { width: 49, length: 69, height: 29 },
    },
    BE: {
      "MONR-CpourToiEurope": { width: 41, length: 64, height: 38 },
      "CHRP-Chrono2ShopEurope": { width: 30, length: 100, height: 20 },
      "MONR-DomicileEurope": { width: 41, length: 64, height: 38 },
      "CHRP-ChronoInternationalClassic": { width: 30, length: 100, height: 20 },
      "DLVG-DelivengoEasy": { width: 20, length: 60, height: 10 },
    },
    CH: {
      "DLVG-DelivengoEasy": { width: 20, length: 60, height: 10 },
    },
  };
  const { sender, recipient, weight, network } = req.body || {};
  if (
    !sender ||
    !recipient ||
    !network ||
    weight === undefined ||
    weight === null ||
    !sender?.country ||
    !sender?.postal_code ||
    !sender?.city ||
    !recipient?.country ||
    !recipient?.postal_code ||
    !recipient?.city
  ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const recipientCountry = String(recipient.country || "FR").toUpperCase();
    const countryKey = recipientCountry;
    const countryOffers = offerDimensions[countryKey] || {};
    const networkKey = String(network || "").trim();
    if (!networkKey) {
      return res.status(400).json({ error: "Missing network" });
    }
    const dimForNet = countryOffers[networkKey] || {
      width: 10,
      length: 10,
      height: 5,
    };
    const weightValue = (() => {
      if (typeof weight === "number") return weight;
      const w = String(weight || "")
        .trim()
        .toLowerCase();
      if (!w) return NaN;
      if (w.endsWith("kg")) {
        const parsed = Number(w.replace("kg", "").trim().replace(",", "."));
        return parsed;
      }
      if (w.endsWith("g")) {
        const parsed = Number(w.replace("g", "").trim().replace(",", "."));
        return parsed / 1000;
      }
      const parsed = Number(w.replace(",", "."));
      return parsed;
    })();
    if (!Number.isFinite(weightValue) || weightValue <= 0) {
      return res.status(400).json({ error: "Invalid weight" });
    }

    const credentials = Buffer.from(
      `${BOXTAL_API_V1_CONFIG.client_id}:${BOXTAL_API_V1_CONFIG.client_secret}`,
    ).toString("base64");
    const options = {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/xml",
      },
    } as any;

    const parser = new XMLParser({ ignoreAttributes: true });
    const params = new URLSearchParams();
    params.append("colis_1.poids", String(weightValue));
    params.append("colis_1.longueur", String(dimForNet.length));
    params.append("colis_1.largeur", String(dimForNet.width));
    params.append("colis_1.hauteur", String(dimForNet.height));
    params.append("code_contenu", "40110");
    params.append("expediteur.pays", String(sender.country));
    params.append("expediteur.code_postal", String(sender.postal_code));
    params.append("expediteur.ville", String(sender.city));
    params.append("expediteur.type", "entreprise");
    params.append("destinataire.pays", String(recipient.country));
    params.append("destinataire.code_postal", String(recipient.postal_code));
    params.append("destinataire.ville", String(recipient.city));
    params.append("destinataire.type", "particulier");
    params.append("offers[0]", networkKey.replace(/-/g, ""));

    const url = `${BOXTAL_API_V1_CONFIG.api_url}/cotation?${params.toString()}`;
    const resp = await fetch(url, options);
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text || "Cotation failed" });
    }
    const xml = await resp.text();
    const json = parser.parse(xml);
    const offer: any = (json as any)?.cotation?.shipment?.offer;
    if (!offer) {
      return res.status(404).json({ error: "No offer returned" });
    }
    const singleOffer = Array.isArray(offer) ? offer[0] : offer;
    return res.status(200).json({
      network: networkKey,
      weight,
      price: singleOffer?.price || null,
      characteristics: singleOffer?.characteristics || null,
      delivery: singleOffer?.delivery || null,
      collection: singleOffer?.collection || null,
    });
  } catch (error: any) {
    console.error("Error in /api/boxtal/cotation:", error);
    return res.status(500).json({ error: "Failed to get Boxtal cotation" });
  }
});

//Point de proximité
router.post("/parcel-points", async (req, res) => {
  try {
    const token = await verifyAndRefreshBoxtalToken();
    const url = `${BOXTAL_API}/shipping/v3.1/parcel-point`;

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
    const url = `${BOXTAL_API}/shipping/v3.1/shipping-order`;
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
    const url = `${BOXTAL_API}/shipping/v3.1/shipping-order/${encodeURIComponent(
      id,
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
    const url = `${BOXTAL_API}/shipping/v3.1/shipping-order/${encodeURIComponent(
      id,
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
              updUrlErr,
            );
          }
        } catch (updEx) {
          console.error(
            "DOCUMENT_CREATED: exception updating document_url:",
            updEx,
          );
        }
      }
      console.log(
        "DOCUMENT_CREATED: document already marked as created, skipping email",
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
      error,
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
      const apiUrl = `${BOXTAL_API}/shipping/v3.1/shipping-order/${encodeURIComponent(
        id,
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
        `attachment; filename="${filename}"`,
      );
      return res.status(200).send(buf);
    } catch (error) {
      console.error(
        "Error in /api/boxtal/shipping-orders/:id/shipping-document/download:",
        error,
      );
      return res.status(500).json({
        error: "Failed to download shipping document",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
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
    const url = `${BOXTAL_API}/shipping/v3.1/shipping-order/${encodeURIComponent(
      id,
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
      2,
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
    const url = `${BOXTAL_API}/shipping/v3.1/shipping-order/${encodeURIComponent(
      id,
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
          .update({ status: newStatus, cancel_requested: true })
          .eq("shipment_id", id);
        if (updError) {
          console.error("Supabase update shipments status failed:", updError);
        }
      }
    } catch (dbErr) {
      console.error("DB update exception:", dbErr);
    }

    const skipAdminRefundEmail =
      String((req.query as any)?.skipAdminRefundEmail || "").toLowerCase() ===
        "true" ||
      String((req.query as any)?.silent || "").toLowerCase() === "true";

    // Envoi d'un email à l'admin avec les infos nécessaires pour remboursement
    try {
      if (!skipAdminRefundEmail && supabase) {
        const { data: shipment, error: shipErr } = await supabase
          .from("shipments")
          .select("*")
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

        const paymentId = String(shipment?.payment_id || "").trim();
        const customerSpentAmountCents = Math.max(
          0,
          Math.round(Number((shipment as any)?.customer_spent_amount || 0)),
        );
        const creditCents = Number.isFinite(customerSpentAmountCents)
          ? customerSpentAmountCents
          : 0;

        if (stripe && customerStripeId && creditCents > 0) {
          let alreadyIssued = false;
          if (paymentId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(paymentId);
              const issuedParsed = Number.parseInt(
                String(
                  (pi.metadata as any)?.boxtal_cancel_credit_cents || "0",
                ),
                10,
              );
              alreadyIssued =
                Number.isFinite(issuedParsed) && issuedParsed === creditCents;
            } catch (_e) {}
          }

          if (!alreadyIssued) {
            const cust = (await stripe.customers.retrieve(
              customerStripeId,
            )) as Stripe.Customer;
            if (cust && !("deleted" in cust)) {
              const meta = (cust as any)?.metadata || {};
              const prevBalanceParsed = Number.parseInt(
                String(meta?.credit_balance || "0"),
                10,
              );
              const prevBalanceCents = Number.isFinite(prevBalanceParsed)
                ? prevBalanceParsed
                : 0;
              const nextBalanceCents = prevBalanceCents + creditCents;
              await stripe.customers.update(
                customerStripeId,
                {
                  metadata: {
                    ...meta,
                    credit_balance: String(nextBalanceCents),
                  },
                } as any,
                { idempotencyKey: `credit-boxtal-cancel-${id}` } as any,
              );
              if (paymentId) {
                try {
                  await stripe.paymentIntents.update(paymentId, {
                    metadata: {
                      boxtal_cancel_credit_cents: String(creditCents),
                      boxtal_cancel_shipping_order_id: String(id),
                    },
                  });
                } catch (_e) {}
              }
            }
          }
        }
      }
    } catch (creditErr) {
      console.error("Failed to issue credit after Boxtal cancel:", creditErr);
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
  secret: string,
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

export default router;
