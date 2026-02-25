import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

import slugify from "slugify";
import { CATEGORY_BASE_WEIGHT } from "../CATEGORY_BASE_WEIGHT";

import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";

const router = express.Router();

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const extractFirstWord = (text: unknown): string => {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const word = raw.split(/\s+/)[0] || "";
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
};

const buildProductReferenceOrFilter = (ref: string): string => {
  const safeRef = String(ref || "").trim();
  if (!safeRef) return "";
  return [
    `product_reference.eq.${safeRef}`,
    `product_reference.ilike.${safeRef};%`,
    `product_reference.ilike.%;${safeRef}`,
    `product_reference.ilike.%;${safeRef};%`,
  ].join(",");
};

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

type FallbackCotationBoxtalTable = Record<
  string,
  Record<string, Record<string, number>>
>;
let fallbackCotationBoxtalCache: FallbackCotationBoxtalTable | null = null;

const loadFallbackCotationBoxtal =
  async (): Promise<FallbackCotationBoxtalTable | null> => {
    if (fallbackCotationBoxtalCache) return fallbackCotationBoxtalCache;
    const candidatePaths = [
      path.resolve(process.cwd(), "FALLBACK_COTATION_BOXTAL.json"),
      path.resolve(__dirname, "..", "FALLBACK_COTATION_BOXTAL.json"),
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "FALLBACK_COTATION_BOXTAL.json",
      ),
    ];
    for (const p of candidatePaths) {
      try {
        const raw = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(raw) as FallbackCotationBoxtalTable;
        if (parsed && typeof parsed === "object") {
          fallbackCotationBoxtalCache = parsed;
          return parsed;
        }
      } catch (_e) {}
    }
    return null;
  };

const pickFallbackCotationBoxtal = (
  table: FallbackCotationBoxtalTable,
  recipientCountryRaw: string,
  deliveryNetworkRaw: string,
  weightKg: number,
): number | null => {
  const recipientCountry = (() => {
    const c = String(recipientCountryRaw || "")
      .trim()
      .toUpperCase();
    return c || "FR";
  })();
  const deliveryNetwork = String(deliveryNetworkRaw || "").trim();
  if (!deliveryNetwork) return null;
  const byCountry = table?.[recipientCountry];
  if (!byCountry || typeof byCountry !== "object") return null;

  const byCarrier =
    (byCountry as any)?.[deliveryNetwork] ||
    (() => {
      const target = deliveryNetwork.toUpperCase();
      const matchKey = Object.keys(byCountry).find(
        (k) =>
          String(k || "")
            .trim()
            .toUpperCase() === target,
      );
      return matchKey ? (byCountry as any)?.[matchKey] : null;
    })();
  if (!byCarrier || typeof byCarrier !== "object") return null;

  const weightKeys = Object.keys(byCarrier)
    .map((k) => ({ raw: k, n: Number(String(k).replace(",", ".")) }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n);
  if (weightKeys.length === 0) return null;

  const w = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 0;
  const picked =
    weightKeys.find((x) => x.n >= w) || weightKeys[weightKeys.length - 1];
  const price = Number((byCarrier as any)?.[picked.raw]);
  return Number.isFinite(price) ? Math.max(0, price) : null;
};

const DEFAULT_WEIGHT = 0.5;
const PACKAGING_WEIGHT = 0.4;
const CATEGORIES = Object.keys(CATEGORY_BASE_WEIGHT);
const normalizeText = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
const detectCategory = (description: string) => {
  const normalized = normalizeText(description);

  for (const cat of CATEGORIES) {
    if (normalized.includes(cat)) {
      return { category: cat, confidence: 0.8 };
    }
  }
  return { category: "unknown", confidence: 0 };
};
const computeUnitWeight = (description: string) => {
  const { category, confidence } = detectCategory(description);
  if (category === "unknown" || confidence < 0.6) {
    return { category: "unknown", unitWeight: DEFAULT_WEIGHT, confidence };
  }
  let weight = CATEGORY_BASE_WEIGHT[category] || DEFAULT_WEIGHT;
  const text = normalizeText(description);
  if (text.includes("long")) weight += 0.2;
  if (text.includes("epais") || text.includes("hiver")) weight += 0.3;
  if (text.includes("manche longue")) weight += 0.1;
  if (text.includes("coton")) weight += 0.05;
  if (text.includes("double")) weight += 0.25;

  return { category, unitWeight: weight, confidence };
};
const calculateParcelWeight = (
  items: Array<{ description: string; quantity: number }>,
) => {
  let total = 0;
  const breakdown: Array<{
    description: string;
    category: string;
    unitWeight: number;
    quantity: number;
    subtotal: number;
    confidence: number;
  }> = [];
  for (const item of items) {
    const { category, unitWeight, confidence } = computeUnitWeight(
      item.description || "",
    );
    const qty = Number(item.quantity || 1);
    const subtotal = unitWeight * qty;
    total += subtotal;
    breakdown.push({
      description: item.description || "",
      category,
      unitWeight,
      quantity: qty,
      subtotal,
      confidence,
    });
  }
  console.log("calculateParcelWeight breakdown", breakdown);
  const finalWeightKg = Math.round(total * 100) / 100;
  return { totalWeightKg: finalWeightKg, rawTotalKg: total, breakdown };
};

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

    const metadata = (customer.metadata || {}) as Record<string, string>;
    const shippingAny: any = customer.shipping || null;
    const shippingName = String(shippingAny?.name || "").trim();
    const shippingNameParts = shippingName
      .split(" - ")
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    const deliveryNetwork = String(metadata.delivery_network || "").trim();
    const deliveryNetworkPrefix = String(
      (deliveryNetwork.split("-")[0] || "").trim(),
    );
    const parcelPointCode = String(metadata.parcel_point || "").trim();
    const derivedParcelPoint =
      parcelPointCode ||
      shippingName ||
      shippingAny?.address?.line1 ||
      shippingAny?.address?.city
        ? {
            code: parcelPointCode || undefined,
            name: shippingNameParts[0] || undefined,
            network: shippingNameParts[1] || deliveryNetworkPrefix || undefined,
            location: {
              street: shippingAny?.address?.line1 || "",
              number: shippingAny?.address?.line2 || "",
              city: shippingAny?.address?.city || "",
              state: shippingAny?.address?.state || "",
              postalCode: shippingAny?.address?.postal_code || "",
              countryIsoCode: shippingAny?.address?.country || "FR",
            },
            shippingOfferCode: deliveryNetwork || undefined,
          }
        : null;

    // Extract relevant details
    const customerData = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      shipping: customer.shipping,
      metadata,
      deliveryMethod: metadata.delivery_method,
      parcelPointCode: metadata.parcel_point,
      deliveryNetwork: metadata.delivery_network,
      parcel_point: derivedParcelPoint,
    };
    res.json({ customer: customerData });
  } catch (error) {
    console.log("Error retrieving customer:", error);
    console.error("Error retrieving customer:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/products/by-ids", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const idsRaw = (req.body as any)?.ids;
    const ids = Array.isArray(idsRaw)
      ? idsRaw
          .map((v: any) => String(v || "").trim())
          .filter((s: string) => s.startsWith("prod_"))
      : [];

    const uniqueIds = Array.from(new Set(ids)).slice(0, 200);
    if (uniqueIds.length === 0) {
      return res.json({ success: true, products: [] });
    }

    const results: any[] = [];
    let idx = 0;
    const maxConcurrent = 10;
    const workers = new Array(maxConcurrent).fill(null).map(async () => {
      while (idx < uniqueIds.length) {
        const i = idx++;
        const pid = uniqueIds[i];
        try {
          const p = (await stripe.products.retrieve(pid, {
            expand: ["default_price"],
          } as any)) as any;
          if (!p || p.deleted) continue;
          const dp: any = p.default_price;
          const unitAmount =
            dp && typeof dp === "object" ? Number(dp.unit_amount || 0) : null;
          results.push({
            id: String(p.id || pid),
            name: String(p.name || "").trim() || null,
            description: String(p.description || "").trim() || null,
            images: Array.isArray((p as any)?.images) ? (p as any).images : [],
            metadata:
              (p as any)?.metadata && typeof (p as any).metadata === "object"
                ? (p as any).metadata
                : {},
            unit_amount_cents:
              typeof unitAmount === "number" && Number.isFinite(unitAmount)
                ? unitAmount
                : null,
          });
        } catch (_e) {}
      }
    });
    await Promise.all(workers);

    return res.json({ success: true, products: results });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
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
        listErr,
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
            publicMetadata: { stripe_id: stripeId },
          } as any);
        }
      } catch (updErr) {
        console.warn(
          "Mise à jour Clerk publicMetadata (stripe_id) échouée:",
          updErr,
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

router.post("/delete-coupon", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { couponId } = req.body as { couponId?: string };
    const cid = String(couponId || "").trim();
    if (!cid) {
      return res.status(400).json({ error: "couponId requis" });
    }

    try {
      const coupon = await stripe.coupons.retrieve(cid);
      const promotionCodes = await stripe.promotionCodes.list({
        coupon: cid,
        limit: 100,
      });

      const deactivatedPromotionCodes: string[] = [];
      for (const pc of promotionCodes.data) {
        try {
          if (pc.active) {
            await stripe.promotionCodes.update(pc.id, { active: false });
          }
          deactivatedPromotionCodes.push(pc.id);
        } catch (_e) {}
      }

      const existingMetadata =
        coupon && !("deleted" in coupon)
          ? ((coupon as any)?.metadata as Record<string, string>) || {}
          : {};
      await stripe.coupons.update(cid, {
        metadata: {
          ...existingMetadata,
          archived: "true",
          archived_at: String(Date.now()),
        },
      } as any);

      return res.json({
        success: true,
        action: "archive",
        couponId: cid,
        couponName: (coupon as any)?.name || null,
        associatedCodes: promotionCodes.data.map((pc) => pc.code),
        deactivatedPromotionCodeIds: deactivatedPromotionCodes,
      });
    } catch (error: any) {
      if (error?.code === "resource_missing") {
        return res.status(404).json({
          success: false,
          error: `Le coupon ${cid} n'existe pas ou a déjà été supprimé`,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("Erreur lors de la suppression du coupon:", error);
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
      customerName,
      customerEmail,
      clerkUserId,
      storeName,
      items,
      address,
      deliveryMethod,
      parcelPoint,
      phone,
      deliveryNetwork,
      cartItemIds,
      shippingHasBeenModified,
      tempCreditBalanceCents,
      openShipmentPaymentId,
      promotionCodeId,
    } = req.body;

    const toCleanString = (v: unknown) => String(v || "").trim();
    const parseNetworkFromOffer = (offer: string) => {
      const raw = toCleanString(offer);
      if (!raw) return "";
      const token = raw.split("-")[0] || "";
      return toCleanString(token);
    };
    const shippingAddressFromParcelPoint = (
      point: any,
      fallbackAddr?: any,
    ) => ({
      line1:
        toCleanString(point?.location?.street) ||
        toCleanString(fallbackAddr?.line1) ||
        "",
      line2:
        toCleanString(point?.location?.number) ||
        toCleanString(fallbackAddr?.line2) ||
        "",
      city:
        toCleanString(point?.location?.city) ||
        toCleanString(fallbackAddr?.city) ||
        "",
      state:
        toCleanString(point?.location?.state) ||
        toCleanString(fallbackAddr?.state) ||
        "",
      postal_code:
        toCleanString(point?.location?.postalCode) ||
        toCleanString(fallbackAddr?.postal_code) ||
        "",
      country:
        toCleanString(point?.location?.countryIsoCode) ||
        toCleanString(fallbackAddr?.country) ||
        "FR",
    });

    const deliveryNetworkRaw = toCleanString(deliveryNetwork);
    const deliveryNetworkPrefix = parseNetworkFromOffer(deliveryNetworkRaw);

    let pickupPointCode = toCleanString(parcelPoint?.code);
    let dropOffPointCode = toCleanString(parcelPoint?.code);
    let pickupPointName = toCleanString(parcelPoint?.name);
    let pickupPointNetwork =
      toCleanString(parcelPoint?.network) || deliveryNetworkPrefix;

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
    let customer: Stripe.Customer | null = null;

    try {
      // Vérifier si le client existe déjà
      const existingCustomers = await stripe.customers.list({
        email: customerEmail,
        limit: 1,
      });

      console.log("Existing customers:", existingCustomers.data);

      if (existingCustomers.data.length > 0) {
        // Mettre à jour le client existant
        const existingCustomer = existingCustomers.data[0];
        const existingMetadata =
          existingCustomer && !("deleted" in existingCustomer)
            ? (existingCustomer.metadata as Record<string, string>)
            : {};
        const existingShipping: any = (existingCustomer as any)?.shipping || {};
        const existingShippingName = toCleanString(existingShipping?.name);
        const existingShippingNameParts = existingShippingName
          .split(" - ")
          .map((s) => toCleanString(s))
          .filter(Boolean);
        const existingPickupName = existingShippingNameParts[0] || "";
        const existingPickupNetwork = existingShippingNameParts[1] || "";
        const metadataPickupCode = toCleanString(existingMetadata.parcel_point);
        const metadataDeliveryNetwork = toCleanString(
          existingMetadata.delivery_network,
        );
        if (!pickupPointCode && metadataPickupCode) {
          pickupPointCode = metadataPickupCode;
          dropOffPointCode = metadataPickupCode;
        }
        if (!pickupPointName && existingPickupName) {
          pickupPointName = existingPickupName;
        }
        if (!pickupPointNetwork) {
          pickupPointNetwork =
            existingPickupNetwork ||
            parseNetworkFromOffer(metadataDeliveryNetwork);
        }
        const shippingName = [pickupPointName, pickupPointNetwork]
          .map((s) => toCleanString(s))
          .filter(Boolean)
          .join(" - ");

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
            deliveryMethod === "pickup_point" &&
            (parcelPoint || pickupPointCode || existingShipping?.address)
              ? {
                  name: shippingName || existingShippingName || pickupPointName,
                  phone: phone,
                  address: shippingAddressFromParcelPoint(
                    parcelPoint,
                    existingShipping?.address,
                  ),
                }
              : ({} as Stripe.CustomerUpdateParams.Shipping),
          metadata: {
            ...existingMetadata,
            clerk_id: clerkUserId || "",
            delivery_method: deliveryMethod || "",
            delivery_network:
              deliveryNetworkRaw ||
              toCleanString(existingMetadata.delivery_network) ||
              "",
            store_name: storeName || "",
            parcel_point: pickupPointCode || "",
          },
        });
        customerId = customer.id;
      } else {
        const shippingName = [pickupPointName, pickupPointNetwork]
          .map((s) => toCleanString(s))
          .filter(Boolean)
          .join(" - ");
        customer = await stripe.customers.create({
          name: customerName,
          email: customerEmail,
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
            deliveryMethod === "pickup_point" &&
            (parcelPoint || pickupPointCode)
              ? {
                  name: shippingName || pickupPointName,
                  phone: phone,
                  address: shippingAddressFromParcelPoint(parcelPoint),
                }
              : undefined,
          metadata: {
            clerk_id: clerkUserId || "",
            delivery_method: deliveryMethod || "",
            delivery_network: deliveryNetworkRaw || "",
            store_name: storeName || "",
            parcel_point: pickupPointCode || "",
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

    const customerMetadata =
      customer && !("deleted" in customer)
        ? (customer.metadata as Record<string, string>) || {}
        : {};
    const customerShipping: any =
      customer && !("deleted" in customer)
        ? (customer as any)?.shipping || {}
        : {};
    const customerShippingName = toCleanString(customerShipping?.name);
    const customerShippingNameParts = customerShippingName
      .split(" - ")
      .map((s) => toCleanString(s))
      .filter(Boolean);
    if (!pickupPointCode) {
      pickupPointCode = toCleanString(customerMetadata?.parcel_point);
      if (!dropOffPointCode) dropOffPointCode = pickupPointCode;
    }
    if (!pickupPointName) {
      pickupPointName = customerShippingNameParts[0] || "";
    }
    if (!pickupPointNetwork) {
      pickupPointNetwork =
        customerShippingNameParts[1] ||
        parseNetworkFromOffer(deliveryNetworkRaw) ||
        parseNetworkFromOffer(
          toCleanString(customerMetadata?.delivery_network),
        );
    }
    const effectivePickupAddress = shippingAddressFromParcelPoint(
      parcelPoint,
      customerShipping?.address,
    );

    const formatDeliveryMethod = (deliveryMethod: string) => {
      if (deliveryMethod === "pickup_point") return "par point relais";
      if (deliveryMethod === "home_delivery") return "à domicile";
      if (deliveryMethod === "store_pickup") return "retrait en magasin";
      return deliveryMethod || "inconnue";
    };

    const offerDelivery: Record<string, { min: number; max: number }> = {
      "MONR-CpourToi": { min: 3, max: 4 },
      "MONR-DomicileFrance": { min: 5, max: 6 },
      "SOGP-RelaisColis": { min: 3, max: 5 },
      "CHRP-Chrono2ShopDirect": { min: 2, max: 4 },
      "CHRP-Chrono18": { min: 1, max: 2 },
      "UPSE-Express": { min: 1, max: 2 },
      "POFR-ColissimoAccess": { min: 2, max: 3 },
      "COPR-CoprRelaisDomicileNat": { min: 6, max: 7 },
      "COPR-CoprRelaisRelaisNat": { min: 6, max: 7 },
      // BELGIQUE
      "MONR-CpourToiEurope": { min: 1, max: 3 },
      "CHRP-Chrono2ShopEurope": { min: 2, max: 5 },
      "MONR-DomicileEurope": { min: 3, max: 6 },
      "CHRP-ChronoInternationalClassic": { min: 1, max: 2 },
      "DLVG-DelivengoEasy": { min: 3, max: 5 },
      "FEDX-FedexRegionalEconomy": { min: 1, max: 4 },
    };
    const deliveryEstimate = offerDelivery[deliveryNetwork];
    console.log("deliveryEstimate:", deliveryNetwork);

    const incomingItems: Array<{
      reference: string;
      description: string;
      price: number;
      quantity: number;
      product_stripe_id?: string;
      weight?: number;
    }> = Array.isArray(items) ? items : [];
    const deliveryRegulationRegex = /r[ée]gularisation\s+livraison/i;
    const forbiddenItem = incomingItems.find((it) => {
      const ref = String(it?.reference || "").trim();
      const desc = String(it?.description || "").trim();
      return (
        deliveryRegulationRegex.test(ref) || deliveryRegulationRegex.test(desc)
      );
    });
    if (forbiddenItem) {
      res.status(400).json({ error: "Référence interdite" });
      return;
    }
    const refToStripeProductId = new Map<string, string>();
    for (const it of incomingItems) {
      const ref = String(it.reference || "").trim();
      const pid = String((it as any)?.product_stripe_id || "").trim();
      if (ref && pid && pid.startsWith("prod_")) {
        if (!refToStripeProductId.has(ref)) refToStripeProductId.set(ref, pid);
      }
    }
    const refsForCheck = incomingItems
      .map((it) => String(it.reference || "").trim())
      .filter((s) => s.length > 0);
    const uniqueRefsForCheck = Array.from(new Set(refsForCheck));

    const promotionInputTrim = String(promotionCodeId || "").trim();
    const promotionInputUpper = promotionInputTrim.toUpperCase();
    const openShipmentPaymentIdTrimForPromo = String(
      openShipmentPaymentId || "",
    ).trim();
    let promotionCodeIdTrim = "";
    let storeIdForCheck: number | null = null;
    let storePromoCodesUpper: string[] = [];
    if (storeName) {
      const { data: storeRowForCheck, error: storeRowForCheckErr } =
        await supabase
          .from("stores")
          .select("id,promo_code")
          .eq("name", storeName)
          .maybeSingle();
      if (storeRowForCheckErr) {
        res.status(500).json({ error: storeRowForCheckErr.message });
        return;
      }
      storeIdForCheck = (storeRowForCheck as any)?.id ?? null;
      const rawPromoCodes = String((storeRowForCheck as any)?.promo_code || "")
        .trim()
        .split(";;")
        .map((s: any) => String(s || "").trim())
        .filter(Boolean);
      storePromoCodesUpper = Array.from(
        new Set(
          rawPromoCodes
            .map((c: string) => c.trim().toUpperCase())
            .filter(Boolean)
            .filter((c: string) => !c.startsWith("CREDIT-")),
        ),
      );
    }
    if (!storeIdForCheck) {
      res.status(400).json({ error: "Boutique introuvable" });
      return;
    }
    if (
      promotionInputTrim &&
      !(
        openShipmentPaymentIdTrimForPromo &&
        !promotionInputUpper.startsWith("PAYLIVE-")
      )
    ) {
      try {
        let resolvedPromo: any = null;
        if (promotionInputTrim.startsWith("promo_")) {
          resolvedPromo =
            await stripe.promotionCodes.retrieve(promotionInputTrim);
        } else {
          const promoList = await stripe.promotionCodes.list({
            code: promotionInputUpper,
            active: true,
            limit: 1,
          } as any);
          resolvedPromo = Array.isArray((promoList as any)?.data)
            ? (promoList as any).data[0]
            : null;
        }

        const resolvedId = String(resolvedPromo?.id || "").trim();
        const resolvedCodeUpper = String(resolvedPromo?.code || "")
          .trim()
          .toUpperCase();
        if (!resolvedId || !resolvedCodeUpper) {
          res.status(400).json({ error: "Code promo invalide" });
          return;
        }

        const resolvedIsPaylive = resolvedCodeUpper.startsWith("PAYLIVE-");
        if (
          !resolvedIsPaylive &&
          !storePromoCodesUpper.includes(resolvedCodeUpper)
        ) {
          res.status(400).json({ error: "Code promo non autorisé" });
          return;
        }

        promotionCodeIdTrim = resolvedId;
      } catch (_e) {
        res.status(400).json({ error: "Code promo invalide" });
        return;
      }

      const rawCredit = (customer as any)?.metadata?.credit_balance;
      const parsedCredit = Number.parseInt(String(rawCredit || "0"), 10);
      const creditBalanceCents = Number.isFinite(parsedCredit)
        ? parsedCredit
        : 0;
      if (creditBalanceCents > 0) {
        res
          .status(400)
          .json({ error: "Code promo interdit avec un solde positif" });
        return;
      }
    }

    const stockByRef = new Map<
      string,
      {
        product_stripe_id?: string;
        weight?: number | null;
        quantity?: number | null;
      }
    >();
    if (uniqueRefsForCheck.length > 0) {
      try {
        const { data: stockRows, error: stockErr } = await supabase
          .from("stock")
          .select("product_reference, product_stripe_id, weight, quantity")
          .eq("store_id", storeIdForCheck as number)
          .in("product_reference", uniqueRefsForCheck as any);
        if (!stockErr && Array.isArray(stockRows)) {
          for (const r of stockRows as any[]) {
            const ref = String(r?.product_reference || "").trim();
            if (!ref) continue;
            const rawWeightField = (r as any)?.weight;
            const parsedWeight =
              rawWeightField === null || rawWeightField === undefined
                ? null
                : typeof rawWeightField === "number"
                  ? rawWeightField
                  : Number(rawWeightField);
            const normalizedWeight =
              parsedWeight === null ||
              (Number.isFinite(parsedWeight) && parsedWeight >= 0)
                ? parsedWeight
                : null;
            const rawQtyField = (r as any)?.quantity;
            const parsedQty =
              rawQtyField === null || rawQtyField === undefined
                ? null
                : typeof rawQtyField === "number"
                  ? rawQtyField
                  : Number(rawQtyField);
            const normalizedQty =
              parsedQty === null ||
              (Number.isFinite(parsedQty) && parsedQty >= 0)
                ? parsedQty
                : null;
            stockByRef.set(ref, {
              product_stripe_id: String(r?.product_stripe_id || "").trim(),
              weight: normalizedWeight,
              quantity: normalizedQty,
            });
          }
        }
      } catch (_e) {}
    }

    let itemsValidationError = "";
    const resolvedItems = incomingItems.map((it) => {
      const ref = String(it.reference || "").trim();
      const fromBody = String((it as any)?.product_stripe_id || "").trim();
      const fromProductId = String(
        (it as any)?.product_id || (it as any)?.productId || "",
      ).trim();
      const stockRow = ref ? stockByRef.get(ref) : undefined;
      const fromStock = String(stockRow?.product_stripe_id || "").trim();

      if (
        fromBody &&
        fromBody.startsWith("prod_") &&
        fromProductId &&
        fromProductId.startsWith("prod_") &&
        fromBody !== fromProductId
      ) {
        if (!itemsValidationError) {
          itemsValidationError = `product_stripe_id et product_id différents pour la référence ${ref || "N/A"}`;
        }
      }

      const productStripeId = (
        fromStock && fromStock.startsWith("prod_")
          ? fromStock
          : fromBody && fromBody.startsWith("prod_")
            ? fromBody
            : fromProductId && fromProductId.startsWith("prod_")
              ? fromProductId
              : ""
      ).trim();

      const wStockRaw = Number(stockRow?.weight);
      const stockWeightKg = (() => {
        const raw = (stockRow as any)?.weight;
        if (raw === null || raw === undefined) return null;
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      })();

      const weightFromItemRaw = Number((it as any)?.weight);
      const weightFromItemKg =
        Number.isFinite(weightFromItemRaw) && weightFromItemRaw > 0
          ? weightFromItemRaw
          : null;

      return {
        ...it,
        reference: ref,
        product_stripe_id: productStripeId,
        _stock_weight_kg: stockWeightKg,
        _item_weight_kg: weightFromItemKg,
      };
    });
    if (itemsValidationError) {
      res.status(400).json({ error: itemsValidationError });
      return;
    }

    const uniqueStripeProductIds = Array.from(
      new Set(
        resolvedItems
          .map((it: any) => String(it.product_stripe_id || "").trim())
          .filter((id) => id.startsWith("prod_")),
      ),
    );
    const stripeProductsById = new Map<string, Stripe.Product>();
    await Promise.all(
      uniqueStripeProductIds.map(async (pid) => {
        try {
          const p = (await stripe.products.retrieve(pid)) as Stripe.Product;
          if (p && !(p as any)?.deleted) {
            stripeProductsById.set(pid, p);
          }
        } catch (_e) {}
      }),
    );

    let weightKg = 0;
    if (deliveryMethod !== "store_pickup") {
      let itemsWeightKg = 0;

      for (const it of resolvedItems as any[]) {
        const qty = Math.max(1, Math.round(Number(it.quantity || 1)));
        const itemUnitKg =
          Number.isFinite(it._item_weight_kg) && it._item_weight_kg > 0
            ? Number(it._item_weight_kg)
            : null;
        const stockUnitKg =
          Number.isFinite(it._stock_weight_kg) && it._stock_weight_kg > 0
            ? Number(it._stock_weight_kg)
            : null;
        const desc = String(it.description || "");
        const shouldComputeFromDesc =
          stockUnitKg === null &&
          (itemUnitKg === null || itemUnitKg === DEFAULT_WEIGHT);
        const computedFromDesc = shouldComputeFromDesc
          ? computeUnitWeight(desc)
          : null;
        const computedUnitKg = (() => {
          if (computedFromDesc) {
            return Number.isFinite(computedFromDesc.unitWeight) &&
              computedFromDesc.unitWeight >= 0
              ? computedFromDesc.unitWeight
              : DEFAULT_WEIGHT;
          }
          if (itemUnitKg !== null) return itemUnitKg;
          if (stockUnitKg !== null) return stockUnitKg;
          return DEFAULT_WEIGHT;
        })();

        if (Number.isFinite(computedUnitKg) && computedUnitKg > 0) {
          itemsWeightKg += computedUnitKg * qty;
        }

        if (
          stockUnitKg === null &&
          storeIdForCheck &&
          Number.isFinite(storeIdForCheck) &&
          storeIdForCheck > 0
        ) {
          const ref = String(it.reference || "").trim();
          if (ref) {
            try {
              if (computedFromDesc && computedFromDesc.category !== "unknown") {
                await supabase
                  .from("stock")
                  .update({ weight: computedUnitKg })
                  .eq("store_id", storeIdForCheck)
                  .eq("product_reference", ref)
                  .is("weight", null);
              }
            } catch (_e) {}
          }
        }
      }

      weightKg =
        Math.round(Math.max(0, itemsWeightKg + PACKAGING_WEIGHT) * 100) / 100;
    }
    let computedDeliveryCost: number | null = null;
    if (deliveryMethod !== "store_pickup") {
      try {
        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        let senderCity = "Paris";
        let senderPostal = "75001";
        let senderCountry = "FR";
        try {
          const { data: storeData, error: storeError } = await supabase
            .from("stores")
            .select("address")
            .eq("name", storeName)
            .single();
          if (!storeError && storeData && (storeData as any)?.address) {
            const a = (storeData as any).address;
            senderCity = String(a?.city || senderCity);
            senderPostal = String(a?.postal_code || senderPostal);
            senderCountry = String(a?.country || senderCountry);
          }
        } catch (_e) {}
        const recipientCity =
          deliveryMethod === "pickup_point"
            ? String(parcelPoint?.location?.city || "")
            : String(address?.city || "");
        const recipientPostal =
          deliveryMethod === "pickup_point"
            ? String(parcelPoint?.location?.postalCode || "")
            : String(address?.postal_code || "");
        const recipientCountry =
          deliveryMethod === "pickup_point"
            ? String(parcelPoint?.location?.countryIsoCode || "FR")
            : String(address?.country || "FR");
        const apiBase = getInternalBase();
        const cotationBody = {
          sender: {
            country: senderCountry,
            postal_code: senderPostal,
            city: senderCity,
          },
          recipient: {
            country: recipientCountry,
            postal_code: recipientPostal,
            city: recipientCity,
          },
          weight: weightKg,
          network: deliveryNetwork,
        };
        console.log(
          "body api/boxtal/cotation",
          JSON.stringify({
            sender: {
              country: senderCountry,
              postal_code: senderPostal,
              city: senderCity,
            },
            recipient: {
              country: recipientCountry,
              postal_code: recipientPostal,
              city: recipientCity,
            },
            weight: weightKg,
            network: deliveryNetwork,
          }),
        );

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const cotResp = await fetch(`${apiBase}/api/boxtal/cotation`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cotationBody),
            });
            if (cotResp.ok) {
              const cotJson: any = await cotResp.json();
              const priceRaw =
                cotJson?.price?.["tax-inclusive"] ??
                cotJson?.price?.taxInclusive ??
                cotJson?.price;
              const parsed = priceRaw
                ? Number(String(priceRaw).replace(",", "."))
                : NaN;
              if (Number.isFinite(parsed)) {
                computedDeliveryCost = Math.max(0, parsed);
                break;
              }
            }
          } catch (_e) {}

          if (attempt < 2) {
            await sleep(250 * (attempt + 1));
          }
        }

        if (
          computedDeliveryCost === null ||
          !Number.isFinite(computedDeliveryCost)
        ) {
          const table = await loadFallbackCotationBoxtal();
          if (table) {
            const fallback = pickFallbackCotationBoxtal(
              table,
              recipientCountry,
              deliveryNetwork,
              weightKg,
            );
            if (fallback !== null && Number.isFinite(fallback)) {
              computedDeliveryCost = fallback;
            }
          }
        }
      } catch (_e) {}
    } else {
      computedDeliveryCost = 0;
    }

    if (
      deliveryMethod !== "store_pickup" &&
      (computedDeliveryCost === null || !Number.isFinite(computedDeliveryCost))
    ) {
      res.status(502).json({
        error:
          "Impossible de calculer les frais de livraison. Veuillez réessayer.",
      });
      return;
    }

    const qtyByRef = new Map<string, number>();
    for (const it of resolvedItems as any[]) {
      const ref = String(it.reference || "").trim();
      if (!ref) continue;
      const qty = Math.max(1, Math.round(Number(it.quantity || 1)));
      qtyByRef.set(ref, (qtyByRef.get(ref) || 0) + qty);
    }
    for (const [ref, qty] of qtyByRef.entries()) {
      const stockRow = stockByRef.get(ref);
      if (!stockRow) continue;
      const rawQtyField = (stockRow as any)?.quantity;
      if (rawQtyField === null || rawQtyField === undefined) continue;
      const qRaw = Number(rawQtyField);
      const available = Number.isFinite(qRaw) ? Math.floor(qRaw) : 0;
      if (available <= 0) {
        res.status(409).json({
          blocked: true,
          reason: "out_of_stock",
          reference: ref,
          available: 0,
        });
        return;
      }
      if (qty > available) {
        res.status(409).json({
          blocked: true,
          reason: "insufficient_stock",
          reference: ref,
          available,
          requested: qty,
        });
        return;
      }
    }

    const orderLineItems: any[] = [];
    const stripeProductIdsForShipment: string[] = [];
    const defaultPriceByStripeProductId = new Map<
      string,
      { priceId: string; unitAmountCents: number }
    >();
    let subtotalExclShippingCents = 0;
    for (const it of resolvedItems as any[]) {
      const pid = String(it.product_stripe_id || "").trim();
      const qty = Math.max(1, Math.round(Number(it.quantity || 1)));
      if (pid && pid.startsWith("prod_")) {
        const cached = defaultPriceByStripeProductId.get(pid) || null;
        let priceId = String(cached?.priceId || "").trim();
        let unitAmountCents = Number(cached?.unitAmountCents || 0);
        if (!priceId) {
          const p = stripeProductsById.get(pid);
          const candidate =
            typeof (p as any)?.default_price === "string"
              ? String((p as any).default_price)
              : String(((p as any)?.default_price as any)?.id || "").trim();
          if (candidate) {
            try {
              const pr = (await stripe.prices.retrieve(candidate)) as any;
              const prId = String(pr?.id || "").trim();
              const prUnit = Number(pr?.unit_amount || 0);
              if (prId && Number.isFinite(prUnit) && prUnit > 0) {
                priceId = prId;
                unitAmountCents = prUnit;
              }
            } catch (_e) {}
          }
          if (!priceId) {
            try {
              const list = await stripe.prices.list({
                product: pid,
                active: true,
                limit: 100,
              });
              const prices = Array.isArray((list as any)?.data)
                ? (list as any).data
                : [];
              const eur = prices.find(
                (pr: any) =>
                  String(pr?.currency || "").toLowerCase() === "eur" &&
                  Number(pr?.unit_amount || 0) > 0,
              );
              const anyActive = prices.find(
                (pr: any) => Number(pr?.unit_amount || 0) > 0,
              );
              const picked = eur || anyActive || null;
              priceId = String((picked as any)?.id || "").trim();
              unitAmountCents = Number((picked as any)?.unit_amount || 0);
            } catch (_e) {}
          }
          if (priceId) {
            defaultPriceByStripeProductId.set(pid, {
              priceId,
              unitAmountCents:
                Number.isFinite(unitAmountCents) && unitAmountCents > 0
                  ? unitAmountCents
                  : 0,
            });
          }
        }
        if (priceId) {
          orderLineItems.push({ price: priceId, quantity: qty });
          for (let i = 0; i < qty; i++) stripeProductIdsForShipment.push(pid);
          if (
            Number.isFinite(unitAmountCents) &&
            unitAmountCents > 0 &&
            qty > 0
          ) {
            subtotalExclShippingCents += unitAmountCents * qty;
          }
          continue;
        }
      }

      const itemUnitKg =
        Number.isFinite(it._item_weight_kg) && it._item_weight_kg > 0
          ? Number(it._item_weight_kg)
          : null;
      const stockUnitKg =
        Number.isFinite(it._stock_weight_kg) && it._stock_weight_kg > 0
          ? Number(it._stock_weight_kg)
          : null;
      const desc = String(it.description || "");
      const shouldComputeFromDesc =
        stockUnitKg === null &&
        (itemUnitKg === null || itemUnitKg === DEFAULT_WEIGHT);
      const computedFromDesc = shouldComputeFromDesc
        ? computeUnitWeight(desc)
        : null;
      const computedUnitKg = (() => {
        if (computedFromDesc) {
          return Number.isFinite(computedFromDesc.unitWeight) &&
            computedFromDesc.unitWeight >= 0
            ? computedFromDesc.unitWeight
            : DEFAULT_WEIGHT;
        }
        if (itemUnitKg !== null) return itemUnitKg;
        if (stockUnitKg !== null) return stockUnitKg;
        return DEFAULT_WEIGHT;
      })();

      const ref = String(it.reference || "").trim();

      let existingProductId = "";
      if (storeIdForCheck && ref) {
        try {
          const existingStockResp = await supabase
            .from("stock")
            .select("product_stripe_id")
            .eq("store_id", storeIdForCheck)
            .eq("product_reference", ref)
            .maybeSingle();
          const pid = String(
            (existingStockResp as any)?.data?.product_stripe_id || "",
          ).trim();
          if (!(existingStockResp as any)?.error && pid.startsWith("prod_")) {
            try {
              await stripe.products.retrieve(pid);
              existingProductId = pid;
            } catch {}
          }
        } catch {}
      }

      if (existingProductId) {
        for (let i = 0; i < qty; i++)
          stripeProductIdsForShipment.push(existingProductId);
        const unitCents = Math.max(0, Math.round(Number(it.price || 0) * 100));
        subtotalExclShippingCents += unitCents * qty;
        const pr = await stripe.prices.create({
          product: existingProductId,
          unit_amount: unitCents,
          currency: "eur",
        });
        orderLineItems.push({ price: pr.id, quantity: qty });
        continue;
      }

      const descriptionTrim = String(it.description || "").trim();
      const dynamicName = extractFirstWord(descriptionTrim) || ref || "N/A";
      const p = await stripe.products.create({
        name: `${dynamicName}`,
        description: descriptionTrim || undefined,
        type: "good",
        shippable: true,
      });
      {
        const pid = String((p as any)?.id || "").trim();
        if (pid && pid.startsWith("prod_")) {
          for (let i = 0; i < qty; i++) stripeProductIdsForShipment.push(pid);
        }
      }
      try {
        if (storeIdForCheck && ref) {
          const unitWeight =
            Number.isFinite(computedUnitKg) &&
            computedUnitKg > 0 &&
            computedFromDesc &&
            computedFromDesc.category !== "unknown"
              ? computedUnitKg
              : null;
          const payload: any = {
            store_id: storeIdForCheck,
            product_reference: ref,
            product_stripe_id: p.id,
          };

          let insertErr: any = null;
          {
            const resp = await supabase.from("stock").insert([payload]);
            insertErr = resp.error as any;
          }
          if (insertErr && String(insertErr?.code || "") === "23505") {
            const updatePayload: any = {
              product_stripe_id: p.id,
            };
            await supabase
              .from("stock")
              .update(updatePayload)
              .eq("store_id", storeIdForCheck)
              .eq("product_reference", ref);
          }
            if (unitWeight !== null) {
              await supabase
                .from("stock")
                .update({ weight: unitWeight })
                .eq("store_id", storeIdForCheck)
                .eq("product_reference", ref)
                .is("weight", null);
          }
        }
      } catch (e) {
        console.error("Erreur insertion stock (produit Stripe dynamique):", e);
      }
      {
        const unitCents = Math.max(0, Math.round(Number(it.price || 0) * 100));
        subtotalExclShippingCents += unitCents * qty;
      }
      const pr = await stripe.prices.create({
        product: p.id,
        unit_amount: Math.round(Number(it.price || 0) * 100),
        currency: "eur",
      });
      try {
        await stripe.products.update(p.id, {
          default_price: String((pr as any)?.id || ""),
        } as any);
      } catch {}
      orderLineItems.push({ price: pr.id, quantity: qty });
    }
    const currencyLower = String(currency || "eur").toLowerCase();

    let deliveryDebtPaidCents = 0;
    if (customerId && customer) {
      const rawCredit = (customer.metadata as any)?.credit_balance;
      const parsedCredit = Number.parseInt(String(rawCredit || "0"), 10);
      if (Number.isFinite(parsedCredit) && parsedCredit < 0) {
        deliveryDebtPaidCents = Math.abs(parsedCredit);
      }
    }

    if (deliveryDebtPaidCents > 0) {
      orderLineItems.push({
        price_data: {
          currency: currencyLower,
          product_data: {
            name: "Régularisation livraison",
          },
          unit_amount: deliveryDebtPaidCents,
        },
        quantity: 1,
      });
    }

    const finalLineItems =
      orderLineItems.length > 0 ? orderLineItems : undefined;
    const joinedRefs = (resolvedItems || [])
      .map((it: any) => String(it?.reference || "").trim())
      .filter((s: string) => s.length > 0)
      .join(";");

    const stripeProductIdsJoined =
      stripeProductIdsForShipment
        .map((s) => String(s || "").trim())
        .filter((s) => s.startsWith("prod_"))
        .join(";") || "";
    const tempCentsParsed = Number.parseInt(
      String(tempCreditBalanceCents ?? "0"),
      10,
    );
    const tempBalanceCents =
      Number.isFinite(tempCentsParsed) && tempCentsParsed > 0
        ? tempCentsParsed
        : 0;
    const tempEligibleSubtotalCents =
      subtotalExclShippingCents +
      Math.max(0, Math.round(deliveryDebtPaidCents));
    const tempAppliedCents = Math.min(
      tempEligibleSubtotalCents,
      tempBalanceCents,
    );
    const tempTopupCents = Math.max(
      0,
      tempBalanceCents - tempEligibleSubtotalCents,
    );
    const openShipmentPaymentIdTrim = String(
      openShipmentPaymentId || "",
    ).trim();

    let creditAppliedCents = 0;
    let creditBalanceBeforeCents: number | null = null;
    let creditBalanceAfterCents: number | null = null;
    let creditCouponId: string | null = null;
    let creditPromotionCodeId: string | null = null;

    if (customerId && customer && !openShipmentPaymentIdTrim) {
      const rawCredit = (customer.metadata as any)?.credit_balance;
      const parsedCredit = Number.parseInt(String(rawCredit || "0"), 10);
      const creditBalanceCents =
        Number.isFinite(parsedCredit) && parsedCredit > 0 ? parsedCredit : 0;

      const remainingAfterTemp = Math.max(
        0,
        subtotalExclShippingCents - tempAppliedCents,
      );

      if (creditBalanceCents > 0 && remainingAfterTemp > 0) {
        creditBalanceBeforeCents = creditBalanceCents;
        creditAppliedCents = Math.min(creditBalanceCents, remainingAfterTemp);
        creditBalanceAfterCents = Math.max(
          0,
          creditBalanceCents - creditAppliedCents,
        );
      }
    }

    const totalDiscountCents = tempAppliedCents + creditAppliedCents;
    const couponDiscountCents = openShipmentPaymentIdTrim
      ? tempBalanceCents
      : totalDiscountCents;
    const totalDiscount = Math.ceil(couponDiscountCents / 100);
    const discountProductIds = Array.from(
      new Set(
        stripeProductIdsForShipment
          .map((s) => String(s || "").trim())
          .filter((s) => s.startsWith("prod_")),
      ),
    );
    const shouldRestrictCreditCouponToProducts =
      deliveryDebtPaidCents <= 0 && discountProductIds.length > 0;

    if (customerId && couponDiscountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: couponDiscountCents,
        currency: currencyLower,
        name: `CREDIT-${totalDiscount}`,
        duration: "once",
        ...(shouldRestrictCreditCouponToProducts
          ? { applies_to: { products: discountProductIds } }
          : {}),
      });
      creditCouponId = coupon.id;

      const codeSeed = customerId.substring(4, 12).toUpperCase();
      const codeSuffix = Date.now().toString(36).toUpperCase();
      const promotionCode = await stripe.promotionCodes.create({
        coupon: coupon.id,
        customer: customerId,
        max_redemptions: 1,
        code: `CREDIT-${codeSeed}-${codeSuffix}`,
        metadata: {
          modified_order_items_amount_cents: String(tempAppliedCents || 0),
          customer_credit_balance_amount_cents: String(creditAppliedCents || 0),
        },
      });
      creditPromotionCodeId = promotionCode.id;
    }

    let nonCreditPromotionCodeIdForSession = promotionCodeIdTrim;
    if (
      !creditPromotionCodeId &&
      nonCreditPromotionCodeIdForSession &&
      deliveryDebtPaidCents > 0 &&
      discountProductIds.length > 0
    ) {
      try {
        const promo: any = await stripe.promotionCodes.retrieve(
          nonCreditPromotionCodeIdForSession,
          { expand: ["coupon"] } as any,
        );
        const coupon: any = promo?.coupon || null;
        const appliesProducts: any[] = Array.isArray(
          coupon?.applies_to?.products,
        )
          ? coupon.applies_to.products
          : [];
        const isRestrictedToProducts = appliesProducts.length > 0;
        const hasAmountOff =
          typeof coupon?.amount_off === "number" &&
          Number.isFinite(coupon.amount_off) &&
          coupon.amount_off > 0;
        const hasPercentOff =
          typeof coupon?.percent_off === "number" &&
          Number.isFinite(coupon.percent_off) &&
          coupon.percent_off > 0;

        if (!isRestrictedToProducts && (hasAmountOff || hasPercentOff)) {
          const duration = String(coupon?.duration || "once");
          const durationInMonthsRaw = Number(coupon?.duration_in_months || 0);
          const duration_in_months =
            Number.isFinite(durationInMonthsRaw) && durationInMonthsRaw > 0
              ? Math.floor(durationInMonthsRaw)
              : undefined;
          const baseName = String(
            coupon?.name || promo?.code || "PROMO",
          ).trim();
          const name =
            baseName.length > 0
              ? baseName.length > 80
                ? baseName.slice(0, 80)
                : baseName
              : undefined;

          const newCoupon = await stripe.coupons.create({
            ...(hasAmountOff
              ? {
                  amount_off: Math.round(Number(coupon.amount_off)),
                  currency: String(coupon?.currency || currencyLower),
                }
              : {}),
            ...(hasPercentOff
              ? { percent_off: Number(coupon.percent_off) }
              : {}),
            duration: duration as any,
            ...(duration === "repeating" && duration_in_months
              ? { duration_in_months }
              : {}),
            ...(name ? { name } : {}),
            applies_to: { products: discountProductIds },
            metadata: {
              ...(typeof coupon?.metadata === "object" && coupon.metadata
                ? coupon.metadata
                : {}),
              original_promotion_code_id: String(promo?.id || ""),
              original_coupon_id: String(coupon?.id || ""),
              excludes_delivery_regulation: "1",
            },
          } as any);

          const codeSeed =
            (String(promo?.code || "")
              .trim()
              .toUpperCase() || "PROMO") +
            "-" +
            Date.now().toString(36).toUpperCase();
          const newPromo = await stripe.promotionCodes.create({
            coupon: newCoupon.id,
            max_redemptions: 1,
            code: `AUTO-${codeSeed}`,
            metadata: {
              original_promotion_code_id: String(promo?.id || ""),
              original_coupon_id: String(coupon?.id || ""),
              excludes_delivery_regulation: "1",
            },
          } as any);

          nonCreditPromotionCodeIdForSession = newPromo.id;
        }
      } catch (_e) {}
    }

    // Créer la session de checkout intégrée
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      payment_method_types: ["card", "paypal"],
      customer: customerId,
      payment_intent_data: {
        capture_method: "manual",
        description: `store: ${storeName || ""} - reference: ${
          joinedRefs || ""
        }`,
        metadata: {
          store_name: storeName || "PayLive",
          product_reference: joinedRefs || "N/A",
          stripe_product_ids: stripeProductIdsJoined,
          cart_item_ids: Array.isArray(cartItemIds)
            ? (cartItemIds as any[]).join(",")
            : typeof cartItemIds === "string"
              ? cartItemIds
              : "",
          temp_credit_balance_cents: String(tempBalanceCents || 0),
          temp_credit_applied_cents: String(tempAppliedCents || 0),
          temp_credit_topup_cents: String(tempTopupCents || 0),
          delivery_debt_paid_cents: String(deliveryDebtPaidCents || 0),
          credit_applied_cents: String(creditAppliedCents || 0),
          credit_balance_before_cents:
            creditBalanceBeforeCents === null
              ? ""
              : String(creditBalanceBeforeCents),
          credit_balance_after_cents:
            creditBalanceAfterCents === null
              ? ""
              : String(creditBalanceAfterCents),
          credit_coupon_id: creditCouponId || "",
          credit_promo_code_id: creditPromotionCodeId || "",
          open_shipment_payment_id: openShipmentPaymentIdTrim,
        },
      },
      // Duplicate useful metadata at the session level for easier retrieval
      metadata: {
        store_name: storeName || "PayLive",
        product_reference: joinedRefs || "N/A",
        stripe_product_ids: stripeProductIdsJoined,
        delivery_method: deliveryMethod || "",
        delivery_network: deliveryNetwork || "",
        parcel_point: pickupPointCode || "",
        parcel_point_name: pickupPointName || "",
        parcel_point_network: pickupPointNetwork || "",
        weight: String(weightKg || 0),
        pickup_point: JSON.stringify({
          street: effectivePickupAddress?.line1 || "",
          city: effectivePickupAddress?.city || "",
          state: effectivePickupAddress?.state || "",
          postal_code: effectivePickupAddress?.postal_code || "",
          country: effectivePickupAddress?.country || "FR",
          code: pickupPointCode || "",
          name: pickupPointName || "",
          network: pickupPointNetwork || "",
          shippingOfferCode:
            toCleanString(parcelPoint?.shippingOfferCode) || deliveryNetworkRaw,
        }),
        dropoff_point: JSON.stringify({
          street: effectivePickupAddress?.line1 || "",
          city: effectivePickupAddress?.city || "",
          state: effectivePickupAddress?.state || "",
          postal_code: effectivePickupAddress?.postal_code || "",
          country: effectivePickupAddress?.country || "FR",
          code: dropOffPointCode || pickupPointCode || "",
          name: pickupPointName || "",
          network: pickupPointNetwork || "",
          shippingOfferCode:
            toCleanString(parcelPoint?.shippingOfferCode) || deliveryNetworkRaw,
        }),
        cart_item_ids: Array.isArray(cartItemIds)
          ? (cartItemIds as any[]).join(",")
          : typeof cartItemIds === "string"
            ? cartItemIds
            : "",
        temp_credit_balance_cents: String(tempBalanceCents || 0),
        temp_credit_applied_cents: String(tempAppliedCents || 0),
        temp_credit_topup_cents: String(tempTopupCents || 0),
        delivery_debt_paid_cents: String(deliveryDebtPaidCents || 0),
        credit_applied_cents: String(creditAppliedCents || 0),
        credit_balance_before_cents:
          creditBalanceBeforeCents === null
            ? ""
            : String(creditBalanceBeforeCents),
        credit_balance_after_cents:
          creditBalanceAfterCents === null
            ? ""
            : String(creditBalanceAfterCents),
        credit_coupon_id: creditCouponId || "",
        credit_promo_code_id: creditPromotionCodeId || "",
        open_shipment_payment_id: openShipmentPaymentIdTrim,
      },
      line_items: finalLineItems as any,
      mode: "payment",
      return_url: `${
        process.env.CLIENT_URL
      }/payment/return?session_id={CHECKOUT_SESSION_ID}&store_name=${encodeURIComponent(
        slugify(storeName, { lower: true, strict: true }) || "default",
      )}`,
      discounts:
        creditPromotionCodeId || nonCreditPromotionCodeIdForSession
          ? ([
              {
                promotion_code:
                  creditPromotionCodeId || nonCreditPromotionCodeIdForSession,
              },
            ] as any)
          : undefined,
      // Ajouter la collecte de consentement
      consent_collection: {
        terms_of_service: "required", // Rend la case à cocher obligatoire
      },
      // Personnaliser le texte associé (optionnel)
      custom_text: {
        terms_of_service_acceptance: {
          message: `J'accepte les conditions générales de vente et la politique de confidentialité de ${
            storeName || "PayLive"
          }.`,
        },
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: {
              amount: Math.round(Number(computedDeliveryCost || 0) * 100),
              currency: "eur",
            },
            display_name: `Livraison ${formatDeliveryMethod(
              deliveryMethod || "",
            )}${
              deliveryMethod !== "store_pickup" && weightKg > 0
                ? ` (${Number(weightKg.toFixed(2))} kg)`
                : ""
            }`,
            delivery_estimate:
              deliveryMethod !== "store_pickup"
                ? {
                    minimum: {
                      unit: "business_day",
                      value: deliveryEstimate.min,
                    },
                    maximum: {
                      unit: "business_day",
                      value: deliveryEstimate.max,
                    },
                  }
                : {},
          },
        },
      ],
    } as any);

    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      customerId: customerId,
      creditCouponId: creditCouponId,
      creditPromotionCodeId: creditPromotionCodeId,
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
    let paymentIntentObj: Stripe.PaymentIntent | null = null;
    try {
      if (session.payment_intent) {
        if (typeof session.payment_intent !== "string") {
          paymentIntentObj = session.payment_intent as Stripe.PaymentIntent;
        } else {
          paymentIntentObj = await stripe.paymentIntents.retrieve(
            session.payment_intent as string,
          );
        }
      }
    } catch (_e) {}
    const paymentIntentId: string | null = paymentIntentObj
      ? paymentIntentObj.id
      : typeof session.payment_intent === "string"
        ? (session.payment_intent as string)
        : null;
    const paymentStatus =
      (paymentIntentObj?.status as any) || (session.payment_status as any);
    const blockedReferencesRaw =
      (paymentIntentObj?.metadata as any)?.blocked_references ||
      (session.metadata as any)?.blocked_references ||
      null;
    const blockedReferences =
      typeof blockedReferencesRaw === "string" && blockedReferencesRaw
        ? blockedReferencesRaw
            .split(";")
            .map((s: string) => String(s || "").trim())
            .filter((s: string) => s.length > 0)
        : [];
    const creditedReferencesRaw =
      (paymentIntentObj?.metadata as any)?.credited_references ||
      (paymentIntentObj?.metadata as any)?.refunded_references ||
      null;
    const creditedReferences =
      typeof creditedReferencesRaw === "string" && creditedReferencesRaw
        ? creditedReferencesRaw
            .split(";")
            .map((s: string) => String(s || "").trim())
            .filter((s: string) => s.length > 0)
        : [];
    const purchasedReferencesRaw =
      (paymentIntentObj?.metadata as any)?.purchased_references || null;
    const purchasedReferences =
      typeof purchasedReferencesRaw === "string" && purchasedReferencesRaw
        ? purchasedReferencesRaw
            .split(";")
            .map((s: string) => String(s || "").trim())
            .filter((s: string) => s.length > 0)
        : [];
    const stockUnfulfilledReferencesRaw =
      (paymentIntentObj?.metadata as any)?.stock_unfulfilled_references || null;
    const stockUnfulfilledReferences =
      typeof stockUnfulfilledReferencesRaw === "string" &&
      stockUnfulfilledReferencesRaw
        ? stockUnfulfilledReferencesRaw
            .split(";")
            .map((s: string) => String(s || "").trim())
            .filter((s: string) => s.length > 0)
        : [];
    const creditAmountRaw =
      (paymentIntentObj?.metadata as any)?.credit_amount_cents ||
      (paymentIntentObj?.metadata as any)?.refund_amount ||
      null;
    const creditAmountCents =
      typeof creditAmountRaw === "string" && creditAmountRaw
        ? Number(creditAmountRaw)
        : null;

    const storeNameFromSession = (session as any)?.metadata?.store_name;
    const referenceFromSession = (session as any)?.metadata?.product_reference;
    const deliveryMethodFromSession = (session as any)?.metadata
      ?.delivery_method;
    const deliveryNetworkFromSession = (session as any)?.metadata
      ?.delivery_network;
    let pickupPointMeta: any = null;
    try {
      pickupPointMeta = (session as any)?.metadata?.pickup_point
        ? JSON.parse(String((session as any).metadata.pickup_point))
        : null;
    } catch (_e) {
      pickupPointMeta = null;
    }
    const parcelPointCodeFromSession =
      (session as any)?.metadata?.parcel_point || pickupPointMeta?.code || "";
    const parcelPointNameFromSession =
      (session as any)?.metadata?.parcel_point_name ||
      pickupPointMeta?.name ||
      "";
    const parcelPointNetworkFromSession =
      (session as any)?.metadata?.parcel_point_network ||
      pickupPointMeta?.network ||
      "";
    let dropoffPointMeta: any = null;
    try {
      dropoffPointMeta = (session as any)?.metadata?.dropoff_point
        ? JSON.parse(String((session as any).metadata.dropoff_point))
        : null;
    } catch (_e) {
      dropoffPointMeta = null;
    }

    let referenceWithQuantity: string | undefined = undefined;
    let detailedLineItems: Array<{
      title: string;
      description?: string;
      reference?: string;
      quantity: number;
      amount_total: number;
      currency: string;
      stripe_product_id?: string;
      is_delivery_regulation?: boolean;
    }> = [];
    try {
      const lineItemsResp = await stripe.checkout.sessions.listLineItems(
        sessionId,
        { limit: 100, expand: ["data.price.product"] },
      );
      const refQtyMap = new Map<string, number>();
      const items: any[] = Array.isArray(lineItemsResp?.data)
        ? (lineItemsResp.data as any[])
        : [];
      for (const item of (lineItemsResp?.data || []) as any[]) {
        const name = String(item?.price?.product?.name || "").trim();
        if (!name) continue;
        const qty = Number(item?.quantity || 1);
        refQtyMap.set(name, (refQtyMap.get(name) || 0) + qty);
      }
      detailedLineItems = items.map((li: any) => {
        const prod: any = li?.price?.product || null;
        const title = String(prod?.name || li?.description || "").trim();
        const description = String(prod?.description || "").trim() || undefined;
        const qty = Math.max(1, Math.floor(Number(li?.quantity || 1)));
        const amountTotal = Math.max(
          0,
          Math.round(Number(li?.amount_total ?? li?.amount_subtotal ?? 0)),
        );
        const currency = String(session.currency || "eur").toUpperCase();
        const ref =
          String(prod?.metadata?.product_reference || "").trim() || undefined;
        const isDeliveryRegulation = title
          ? /r[ée]gulation\s+livraison/i.test(title)
          : false;
        return {
          title,
          description,
          reference: ref,
          quantity: qty,
          amount_total: amountTotal,
          currency,
          stripe_product_id: String(prod?.id || "").trim() || undefined,
          is_delivery_regulation: isDeliveryRegulation || undefined,
        };
      });
      referenceWithQuantity = Array.from(refQtyMap.entries())
        .map(([n, q]) => `${n}**${q}`)
        .join(";");
      if (!referenceWithQuantity) referenceWithQuantity = undefined;
    } catch (_e) {}

    let promoCodeDetails: Array<{
      code: string;
      amount_off_cents?: number;
    }> = [];
    try {
      let expandedSession: any = session;
      try {
        expandedSession = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: [
            "total_details.breakdown.discounts.discount",
            "total_details.breakdown.discounts.discount.promotion_code",
            "total_details.breakdown.discounts.discount.coupon",
          ],
        } as any);
      } catch (_e) {
        expandedSession = session;
      }
      const breakdownDiscounts: any[] = Array.isArray(
        (expandedSession as any)?.total_details?.breakdown?.discounts,
      )
        ? ((expandedSession as any).total_details.breakdown.discounts as any[])
        : [];
      for (const d of breakdownDiscounts) {
        const amountOff = Math.max(0, Math.round(Number(d?.amount || 0)));
        const discountObj: any = d?.discount || {};
        const promo = discountObj?.promotion_code;
        if (!promo) continue;
        let promoCode: any = promo;
        if (typeof promo === "string") {
          try {
            promoCode = await stripe.promotionCodes.retrieve(promo);
          } catch (_e) {
            promoCode = null;
          }
        }
        const code = String((promoCode as any)?.code || "").trim();
        if (!code) continue;
        promoCodeDetails.push({
          code,
          amount_off_cents: amountOff > 0 ? amountOff : undefined,
        });
      }
    } catch (_e) {}

    const promoCodesUsed = Array.from(
      new Set(
        promoCodeDetails
          .map((d) => String(d?.code || "").trim())
          .filter((s) => s.length > 0),
      ),
    );
    const creditCodes = promoCodesUsed.filter((c) => /^CREDIT-/i.test(c));
    const platformCodes = promoCodesUsed.filter((c) => /^PAYLIVE-/i.test(c));
    const storeCodes = promoCodesUsed.filter(
      (c) => !/^CREDIT-/i.test(c) && !/^PAYLIVE-/i.test(c),
    );

    const creditAppliedCentsParsed = Number.parseInt(
      String((session as any)?.metadata?.credit_applied_cents || "0"),
      10,
    );
    const creditAppliedCents =
      Number.isFinite(creditAppliedCentsParsed) && creditAppliedCentsParsed > 0
        ? creditAppliedCentsParsed
        : 0;
    const creditUsedEffectiveCentsParsed = Number.parseInt(
      String(
        (paymentIntentObj?.metadata as any)
          ?.credit_balance_used_cents_effective || "",
      ),
      10,
    );
    const creditUsedEffectiveCents =
      Number.isFinite(creditUsedEffectiveCentsParsed) &&
      creditUsedEffectiveCentsParsed > 0
        ? creditUsedEffectiveCentsParsed
        : 0;
    const creditUsedCents =
      creditUsedEffectiveCents > 0
        ? creditUsedEffectiveCents
        : creditAppliedCents;
    const creditPromoDiscountCents = promoCodeDetails
      .filter((d) => /^CREDIT-/i.test(String(d?.code || "")))
      .reduce((sum, d) => {
        const v = Number(d?.amount_off_cents || 0);
        return sum + (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
      }, 0);

    const shippingDetails: any = (session as any)?.shipping_details || null;
    const customerDetails: any = (session as any)?.customer_details || null;

    const paymentDetails = {
      amount:
        ((paymentIntentObj as any)?.amount_received ??
          (paymentIntentObj as any)?.amount ??
          session.amount_total) ||
        0,
      currency: session.currency || "eur",
      reference: referenceFromSession || "N/A",
      reference_with_quantity: referenceWithQuantity || undefined,
      storeName: storeNameFromSession || "PayLive",
      customerEmail: customer?.email || "N/A",
      customerPhone: customer?.phone || "N/A",
      status: paymentStatus,
      session_status: session.payment_status,
      payment_intent_id: paymentIntentId,
      blocked_references: blockedReferences,
      credited_references: creditedReferences,
      purchased_references: purchasedReferences,
      stock_unfulfilled_references: stockUnfulfilledReferences,
      credit_amount_cents: creditAmountCents,
      deliveryMethod: deliveryMethodFromSession || undefined,
      deliveryNetwork: deliveryNetworkFromSession || undefined,
      parcelPointCode: parcelPointCodeFromSession || undefined,
      parcelPointName: parcelPointNameFromSession || undefined,
      parcelPointNetwork: parcelPointNetworkFromSession || undefined,
      pickup_point: pickupPointMeta || undefined,
      dropoff_point: dropoffPointMeta || undefined,
      shipping_details: shippingDetails || undefined,
      customer_details: customerDetails || undefined,
      line_items: detailedLineItems,
      delivery_regulation_items: detailedLineItems.filter(
        (it) => (it as any)?.is_delivery_regulation,
      ),
      promo_codes: promoCodesUsed,
      promo_codes_store: storeCodes,
      promo_codes_platform: platformCodes,
      promo_codes_credit: creditCodes,
      promo_code_details: promoCodeDetails,
      credit_balance_used_cents: creditUsedCents || undefined,
      credit_discount_total_cents:
        creditPromoDiscountCents > 0 ? creditPromoDiscountCents : undefined,
    };

    let businessStatus: "PAID" | "PAYMENT_FAILED" | "PENDING" | undefined =
      undefined;

    if (!businessStatus) {
      if (paymentStatus === "succeeded") {
        businessStatus = "PAID";
      } else if (
        ["requires_payment_method", "canceled", "failed"].includes(
          String(paymentStatus || ""),
        )
      ) {
        businessStatus = "PAYMENT_FAILED";
      } else {
        businessStatus = "PENDING";
      }
    }

    const result = {
      ...paymentDetails,
      businessStatus,
      success: paymentStatus === "succeeded",
      failed: ["requires_payment_method", "canceled", "failed"].includes(
        String(paymentStatus || ""),
      ),
      credited:
        Array.isArray(creditedReferences) && creditedReferences.length > 0,
    };

    res.json(result);
  } catch (error) {
    console.error("Erreur lors de la récupération de la session:", error);
    res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

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
      parcelPointCode: c.metadata?.parcel_point,
      deliveryNetwork: c.metadata?.delivery_network,
      shippingOrderIds: c.metadata?.shipping_order_ids,
      clerkUserId: (c.metadata as any)?.clerk_id,
    } as any;
    res.json({ customer: customerData });
  } catch (error) {
    console.error("Error retrieving customer by ID:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/customer-credit-balance", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const customerId = String((req.query.customerId as any) || "").trim();
    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const expectedCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!expectedCustomerId || expectedCustomerId !== customerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || (customer as any).deleted) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const rawCredit = ((customer as any)?.metadata as any)?.credit_balance;
    const parsed = Number.parseInt(String(rawCredit || "0"), 10);
    const cents = Number.isFinite(parsed) ? parsed : 0;
    return res.json({
      credit_balance_cents: cents,
      credit_balance_eur: cents / 100,
    });
  } catch (error) {
    console.error("Error retrieving customer credit balance:", error);
    return res.status(500).json({ error: (error as Error).message });
  }
});

// Nouveau endpoint: récupérer les comptes externes Clerk d’un utilisateur via clerk_id
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
        (e: any) => e.id === user?.primaryEmailAddressId,
      )?.emailAddress ||
      (user?.emailAddresses || [])[0]?.emailAddress ||
      null;
    const primaryPhone =
      (user?.phoneNumbers || []).find(
        (p: any) => p.id === user?.primaryPhoneNumberId,
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

// Créer un code promo Stripe à partir d'un coupon
router.post("/promotion-codes", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      couponId,
      code,
      minimum_amount,
      first_time_transaction,
      expires_at,
      active = true,
      max_redemptions,
      storeSlug,
    } = req.body || {};

    if (!couponId || !code) {
      return res.status(400).json({ error: "couponId et code sont requis" });
    }

    const params: Stripe.PromotionCodeCreateParams = {
      coupon: String(couponId),
      code: String(code),
      active: !!active,
    } as Stripe.PromotionCodeCreateParams;

    if (typeof max_redemptions === "number" && max_redemptions > 0) {
      (params as any).max_redemptions = max_redemptions;
    }
    if (typeof expires_at === "number" && expires_at > 0) {
      (params as any).expires_at = expires_at;
    }
    if (
      typeof minimum_amount === "number" ||
      typeof first_time_transaction === "boolean"
    ) {
      (params as any).restrictions = {
        ...(typeof minimum_amount === "number" && minimum_amount > 0
          ? { minimum_amount, minimum_amount_currency: "eur" }
          : {}),
        ...(typeof first_time_transaction === "boolean"
          ? { first_time_transaction }
          : {}),
      } as Stripe.PromotionCodeCreateParams.Restrictions;
    }

    // Ajouter metadata avec le storeSlug si fourni
    if (storeSlug) {
      (params as any).metadata = {
        storeSlug: String(storeSlug),
      } as Record<string, string>;
    }

    const promotionCode = await stripe.promotionCodes.create(params);
    const storeSlugTrim = String(storeSlug || "").trim();
    const promoCodeUpper = String((promotionCode as any)?.code || "")
      .trim()
      .toUpperCase();
    if (storeSlugTrim && promoCodeUpper) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id,promo_code")
        .eq("slug", storeSlugTrim)
        .maybeSingle();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      if (storeRow) {
        const currentRaw = String((storeRow as any)?.promo_code || "").trim();
        const codes = currentRaw
          ? currentRaw
              .split(";;")
              .map((s: any) => String(s || "").trim())
              .filter(Boolean)
          : [];
        const next = Array.from(
          new Set(
            [...codes, promoCodeUpper].map((c) => c.trim().toUpperCase()),
          ),
        )
          .filter(Boolean)
          .filter((c) => !c.startsWith("CREDIT-"))
          .join(";;");
        const { error: updErr } = await supabase
          .from("stores")
          .update({ promo_code: next })
          .eq("id", (storeRow as any).id);
        if (updErr) {
          return res.status(500).json({ error: updErr.message });
        }
      }
    }
    return res.json({ promotionCode });
  } catch (error) {
    console.error("Erreur lors de la création du code promo:", error);
    const msg = String((error as any)?.message || "");
    const normalized = msg.toLowerCase();
    if (
      normalized.includes("promotion code") &&
      normalized.includes("already exists")
    ) {
      return res.status(409).json({ error: "Ce nom de code existe déjà" });
    }
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
  }
});

// Lister les codes promo (optionnellement filtré par couponId ou active)
router.get("/promotion-codes", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { couponId, active, limit, storeSlug } = req.query as {
      couponId?: string;
      active?: string;
      limit?: string;
      storeSlug?: string;
    };

    const listParams: Stripe.PromotionCodeListParams = {
      limit: Math.min(Math.max(parseInt(limit || "50", 10), 1), 100),
    } as Stripe.PromotionCodeListParams;

    if (couponId) (listParams as any).coupon = couponId;
    if (typeof active !== "undefined")
      (listParams as any).active = active === "true";

    const result = await stripe.promotionCodes.list(listParams);

    // Filtrage côté serveur par metadata.storeSlug si demandé
    const data = Array.isArray(result.data) ? result.data : [];
    const filtered = storeSlug
      ? data.filter(
          (pc) =>
            String((pc as any)?.metadata?.storeSlug || "") ===
            String(storeSlug),
        )
      : data;

    return res.json({ data: filtered });
  } catch (error) {
    console.error("Erreur lors du listage des codes promo:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
  }
});

// Désactiver (supprimer logiquement) un code promo Stripe
router.delete("/promotion-codes/:id", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params as { id?: string };
    if (!id) {
      return res.status(400).json({ error: "promotion code id requis" });
    }

    // Stripe ne supprime pas vraiment les codes promo; on les désactive
    const promotionCode = await stripe.promotionCodes.update(String(id), {
      active: false,
    } as Stripe.PromotionCodeUpdateParams);

    const storeSlug = String(
      (promotionCode as any)?.metadata?.storeSlug || "",
    ).trim();
    const promoCodeUpper = String((promotionCode as any)?.code || "")
      .trim()
      .toUpperCase();
    if (storeSlug && promoCodeUpper) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id,promo_code")
        .eq("slug", storeSlug)
        .maybeSingle();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      if (storeRow) {
        const currentRaw = String((storeRow as any)?.promo_code || "").trim();
        const codes = currentRaw
          ? currentRaw
              .split(";;")
              .map((s: any) => String(s || "").trim())
              .filter(Boolean)
          : [];
        const filtered = codes.filter(
          (c: string) => c.trim().toUpperCase() !== promoCodeUpper,
        );
        const next = filtered
          .map((c: string) => c.trim().toUpperCase())
          .filter(Boolean)
          .filter((c: string) => !c.startsWith("CREDIT-"))
          .join(";;");
        const { error: updErr } = await supabase
          .from("stores")
          .update({ promo_code: next })
          .eq("id", (storeRow as any).id);
        if (updErr) {
          return res.status(500).json({ error: updErr.message });
        }
      }
    }

    return res.json({ success: true, promotionCode });
  } catch (error) {
    console.error("Erreur lors de la désactivation du code promo:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
  }
});

router.put("/promotion-codes/:id/active", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params as { id?: string };
    if (!id) {
      return res.status(400).json({ error: "promotion code id requis" });
    }

    const { active } = req.body || {};
    const nextActive = Boolean(active);

    const promotionCode = await stripe.promotionCodes.update(String(id), {
      active: nextActive,
    } as Stripe.PromotionCodeUpdateParams);

    const storeSlug = String(
      (promotionCode as any)?.metadata?.storeSlug || "",
    ).trim();
    const promoCodeUpper = String((promotionCode as any)?.code || "")
      .trim()
      .toUpperCase();
    if (storeSlug && promoCodeUpper) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id,promo_code")
        .eq("slug", storeSlug)
        .maybeSingle();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      if (storeRow) {
        const currentRaw = String((storeRow as any)?.promo_code || "").trim();
        const codes = currentRaw
          ? currentRaw
              .split(";;")
              .map((s: any) => String(s || "").trim())
              .filter(Boolean)
          : [];
        const next = (
          nextActive
            ? Array.from(
                new Set(
                  [...codes, promoCodeUpper].map((c) => c.trim().toUpperCase()),
                ),
              )
            : codes.filter(
                (c: string) => c.trim().toUpperCase() !== promoCodeUpper,
              )
        )
          .filter(Boolean)
          .filter((c: string) => !c.startsWith("CREDIT-"))
          .join(";;");
        const { error: updErr } = await supabase
          .from("stores")
          .update({ promo_code: next })
          .eq("id", (storeRow as any).id);
        if (updErr) {
          return res.status(500).json({ error: updErr.message });
        }
      }
    }

    return res.json({ success: true, promotionCode });
  } catch (error) {
    console.error("Erreur lors de la mise à jour du code promo:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Erreur" });
  }
});

router.get("/coupons", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const desiredLimit = 50000;
    const pageLimit = 100;
    let startingAfter: string | undefined = undefined;
    const activeCoupons: Stripe.Coupon[] = [];
    let hasMore = true;

    while (hasMore && activeCoupons.length < desiredLimit) {
      const options: Stripe.CouponListParams = {
        limit: pageLimit,
      } as Stripe.CouponListParams;
      if (startingAfter) options.starting_after = startingAfter;

      const list = await stripe.coupons.list(options);
      const data = Array.isArray(list?.data) ? list.data : [];
      for (const c of data) {
        if (c && c.valid === true) activeCoupons.push(c);
        if (activeCoupons.length >= desiredLimit) break;
      }

      hasMore = Boolean(list?.has_more);
      const last = data.length > 0 ? data[data.length - 1] : null;
      startingAfter = last?.id || undefined;
      if (!startingAfter) hasMore = false;
    }

    const data = activeCoupons.slice(0, desiredLimit).map((c) => ({
      id: c.id,
      name: c.name || null,
    }));
    res.json({ data });
  } catch (error) {
    res.status(500).json({ error: (error as any).message || "Internal error" });
  }
});

export default router;
