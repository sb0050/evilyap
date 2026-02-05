import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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

    // Extract relevant details
    const customerData = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      shipping: customer.shipping,
      deliveryMethod: customer.metadata.delivery_method,
      parcelPointCode: customer.metadata.parcel_point,
      deliveryNetwork: customer.metadata.delivery_network,
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
            publicMetadata: { stripe_id: stripeId, role: "customer" },
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

      await stripe.coupons.del(cid);

      return res.json({
        success: true,
        action: "delete",
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
                  name: `${parcelPoint.name || ""} - ${parcelPoint.network}`,
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
            ...existingMetadata,
            clerk_id: clerkUserId || "",
            delivery_method: deliveryMethod || "",
            delivery_network: deliveryNetwork || "",
            store_name: storeName || "",
            parcel_point: pickupPointCode || "",
          },
        });
        customerId = customer.id;
      } else {
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
            deliveryMethod === "pickup_point" && parcelPoint
              ? {
                  name: `${parcelPoint.name || ""} - ${parcelPoint.network}`,
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
              : undefined,
          metadata: {
            clerk_id: clerkUserId || "",
            delivery_method: deliveryMethod || "",
            delivery_network: deliveryNetwork || "",
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
    const refsForCheck = incomingItems
      .map((it) => String(it.reference || "").trim())
      .filter((s) => s.length > 0);
    const uniqueRefsForCheck = Array.from(new Set(refsForCheck));
    const joinedRefs = incomingItems
      .map((it) => String(it.reference || "").trim())
      .filter((s) => s.length > 0)
      .join(";");

    const promotionCodeIdTrim = String(promotionCodeId || "").trim();
    let storeIdForCheck: number | null = null;
    let storePromoCodeIds: string[] = [];
    if (storeName) {
      const { data: storeRowForCheck, error: storeRowForCheckErr } =
        await supabase
          .from("stores")
          .select("id,promo_code_id")
          .eq("name", storeName)
          .maybeSingle();
      if (storeRowForCheckErr) {
        res.status(500).json({ error: storeRowForCheckErr.message });
        return;
      }
      storeIdForCheck = (storeRowForCheck as any)?.id ?? null;
      const rawPromoIds = String((storeRowForCheck as any)?.promo_code_id || "")
        .trim()
        .split(";;")
        .map((s: any) => String(s || "").trim())
        .filter(Boolean);
      storePromoCodeIds = Array.from(
        new Set(rawPromoIds.filter((id: string) => id.startsWith("promo_"))),
      );
    }
    if (!storeIdForCheck) {
      res.status(400).json({ error: "Boutique introuvable" });
      return;
    }
    if (promotionCodeIdTrim) {
      if (!promotionCodeIdTrim.startsWith("promo_")) {
        res.status(400).json({ error: "Code promo invalide" });
        return;
      }
      if (!storePromoCodeIds.includes(promotionCodeIdTrim)) {
        res.status(400).json({ error: "Code promo non autorisé" });
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
      { product_stripe_id?: string; weight?: number }
    >();
    if (uniqueRefsForCheck.length > 0) {
      try {
        const { data: stockRows, error: stockErr } = await supabase
          .from("stock")
          .select("product_reference, product_stripe_id, weight")
          .eq("store_id", storeIdForCheck as number)
          .in("product_reference", uniqueRefsForCheck as any);
        if (!stockErr && Array.isArray(stockRows)) {
          for (const r of stockRows as any[]) {
            const ref = String(r?.product_reference || "").trim();
            if (!ref) continue;
            stockByRef.set(ref, {
              product_stripe_id: String(r?.product_stripe_id || "").trim(),
              weight: Number(r?.weight),
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
        fromBody && fromBody.startsWith("prod_")
          ? fromBody
          : fromProductId && fromProductId.startsWith("prod_")
            ? fromProductId
            : fromStock && fromStock.startsWith("prod_")
              ? fromStock
              : ""
      ).trim();

      const wStockRaw = Number(stockRow?.weight);
      const stockWeightKg =
        Number.isFinite(wStockRaw) && wStockRaw >= 0 ? wStockRaw : null;

      const weightFromItemRaw = Number((it as any)?.weight);
      const weightFromItemKg =
        Number.isFinite(weightFromItemRaw) && weightFromItemRaw >= 0
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
      const missingWeights: Array<{ description: string; quantity: number }> =
        [];

      for (const it of resolvedItems as any[]) {
        const qty = Math.max(1, Math.round(Number(it.quantity || 1)));
        const itemUnitKg =
          Number.isFinite(it._item_weight_kg) && it._item_weight_kg >= 0
            ? Number(it._item_weight_kg)
            : NaN;
        if (Number.isFinite(itemUnitKg)) {
          itemsWeightKg += itemUnitKg * qty;
        } else {
          missingWeights.push({
            description: String(it.description || ""),
            quantity: qty,
          });
        }
      }

      if (missingWeights.length > 0) {
        const calc = calculateParcelWeight(missingWeights);
        const raw = Number(calc?.rawTotalKg ?? 0);
        if (Number.isFinite(raw) && raw >= 0) {
          itemsWeightKg += raw;
        }
      }

      weightKg =
        Math.round(Math.max(0, itemsWeightKg + PACKAGING_WEIGHT) * 100) / 100;
    }
    let computedDeliveryCost = 0;
    if (deliveryMethod !== "store_pickup") {
      try {
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
        const cotResp = await fetch(`${apiBase}/api/boxtal/cotation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
            computedDeliveryCost = parsed;
          }
        }
      } catch (_e) {}
    } else {
      computedDeliveryCost = 0;
    }

    for (const ref of uniqueRefsForCheck) {
      const { data: failedCartRows, error: failedCartErr } = await supabase
        .from("carts")
        .select("id")
        .eq("store_id", storeIdForCheck)
        .eq("product_reference", ref)
        .eq("status", "PAYMENT_FAILED")
        .limit(1);

      if (failedCartErr) {
        console.log("Failed Cart Err", failedCartErr);
        res.status(500).json({ error: failedCartErr.message });
        return;
      }
      if ((failedCartRows || []).length > 0) {
        console.log("Cart Failed", failedCartRows);
        res.status(409).json({
          blocked: true,
          reason: "already_bought",
          reference: ref,
          source: "carts",
        });
        return;
      }

      const { data: shippedRows, error: shippedErr } = await supabase
        .from("shipments")
        .select("id")
        .eq("store_id", storeIdForCheck)
        .or(buildProductReferenceOrFilter(ref))
        .not("payment_id", "is", null)
        .limit(1);

      if (shippedErr) {
        console.log("Shipped Err", shippedErr);
        res.status(500).json({ error: shippedErr.message });
        return;
      }
      if ((shippedRows || []).length > 0) {
        res.status(409).json({
          blocked: true,
          reason: "already_bought",
          reference: ref,
          source: "shipments",
        });
        return;
      }
    }

    const orderLineItems: any[] = [];
    const defaultPriceByStripeProductId = new Map<string, string>();
    for (const it of resolvedItems as any[]) {
      const pid = String(it.product_stripe_id || "").trim();
      const qty = Math.max(1, Math.round(Number(it.quantity || 1)));
      if (pid && pid.startsWith("prod_")) {
        let priceId = defaultPriceByStripeProductId.get(pid) || "";
        if (!priceId) {
          const p = stripeProductsById.get(pid);
          const candidate =
            typeof (p as any)?.default_price === "string"
              ? String((p as any).default_price)
              : String(((p as any)?.default_price as any)?.id || "").trim();
          if (candidate) {
            priceId = candidate;
          } else {
            try {
              const list = await stripe.prices.list({
                product: pid,
                active: true,
                limit: 1,
              });
              const first = Array.isArray(list?.data) ? list.data[0] : null;
              priceId = String(first?.id || "").trim();
            } catch (_e) {}
          }
          if (priceId) {
            defaultPriceByStripeProductId.set(pid, priceId);
          }
        }
        if (priceId) {
          orderLineItems.push({ price: priceId, quantity: qty });
          continue;
        }
      }

      const itemUnitKg =
        Number.isFinite(it._item_weight_kg) && it._item_weight_kg >= 0
          ? Number(it._item_weight_kg)
          : NaN;
      const computedUnitKg = (() => {
        if (Number.isFinite(itemUnitKg)) return itemUnitKg;
        const desc = String(it.description || "");
        const { unitWeight } = computeUnitWeight(desc);
        return Number.isFinite(unitWeight) && unitWeight >= 0
          ? unitWeight
          : NaN;
      })();

      const p = await stripe.products.create({
        name: `${String(it.reference || "N/A")}`,
        type: "good",
        shippable: true,
        ...(Number.isFinite(computedUnitKg)
          ? { metadata: { weight: String(computedUnitKg) } }
          : {}),
      });
      const pr = await stripe.prices.create({
        product: p.id,
        unit_amount: Math.round(Number(it.price || 0) * 100),
        currency: "eur",
      });
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
    const subtotalExclShippingCents = incomingItems.reduce((sum, it) => {
      const unitCents = Math.max(0, Math.round(Number(it.price || 0) * 100));
      const qty = Math.max(0, Math.round(Number(it.quantity || 1)));
      return sum + unitCents * qty;
    }, 0);

    const tempCentsParsed = Number.parseInt(
      String(tempCreditBalanceCents ?? "0"),
      10,
    );
    const tempBalanceCents =
      Number.isFinite(tempCentsParsed) && tempCentsParsed > 0
        ? tempCentsParsed
        : 0;
    const tempAppliedCents = Math.min(
      subtotalExclShippingCents,
      tempBalanceCents,
    );
    const tempTopupCents = Math.max(
      0,
      tempBalanceCents - subtotalExclShippingCents,
    );

    let creditAppliedCents = 0;
    let creditBalanceBeforeCents: number | null = null;
    let creditBalanceAfterCents: number | null = null;
    let creditCouponId: string | null = null;
    let creditPromotionCodeId: string | null = null;

    if (customerId && customer) {
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
    const totalDiscount = Math.ceil(totalDiscountCents / 100);

    if (customerId && totalDiscountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency: currencyLower,
        name: `CREDIT-${totalDiscount}`,
        duration: "once",
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

    // Créer la session de checkout intégrée
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      payment_method_types: ["card", "paypal"],
      customer: customerId,
      payment_intent_data: {
        description: `store: ${storeName || ""} - reference: ${
          joinedRefs || ""
        }`,
        metadata: {
          store_name: storeName || "PayLive",
          product_reference: joinedRefs || "N/A",
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
          open_shipment_payment_id: String(openShipmentPaymentId || "").trim(),
        },
      },
      // Duplicate useful metadata at the session level for easier retrieval
      metadata: {
        store_name: storeName || "PayLive",
        product_reference: joinedRefs || "N/A",
        delivery_method: deliveryMethod || "",
        delivery_network: deliveryNetwork || "",
        weight: String(weightKg || 0),
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
        open_shipment_payment_id: String(openShipmentPaymentId || "").trim(),
      },
      line_items: finalLineItems as any,
      mode: "payment",
      return_url: `${
        process.env.CLIENT_URL
      }/payment/return?session_id={CHECKOUT_SESSION_ID}&store_name=${encodeURIComponent(
        slugify(storeName, { lower: true, strict: true }) || "default",
      )}`,
      discounts:
        creditPromotionCodeId || promotionCodeIdTrim
          ? ([
              {
                promotion_code: creditPromotionCodeId || promotionCodeIdTrim,
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
            )} `,
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
    const parcelPointCodeFromSession = (session as any)?.metadata?.parcel_point;
    const parcelPointNameFromSession = (session as any)?.metadata
      ?.parcel_point_name;
    const parcelPointNetworkFromSession = (session as any)?.metadata
      ?.parcel_point_network;

    let referenceWithQuantity: string | undefined = undefined;
    try {
      const lineItemsResp = await stripe.checkout.sessions.listLineItems(
        sessionId,
        { limit: 100, expand: ["data.price.product"] },
      );
      const refQtyMap = new Map<string, number>();
      for (const item of (lineItemsResp?.data || []) as any[]) {
        const name = String(item?.price?.product?.name || "").trim();
        if (!name) continue;
        const qty = Number(item?.quantity || 1);
        refQtyMap.set(name, (refQtyMap.get(name) || 0) + qty);
      }
      referenceWithQuantity = Array.from(refQtyMap.entries())
        .map(([n, q]) => `${n}**${q}`)
        .join(";");
      if (!referenceWithQuantity) referenceWithQuantity = undefined;
    } catch (_e) {}

    const paymentDetails = {
      amount: session.amount_total || 0,
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
      credit_amount_cents: creditAmountCents,
      deliveryMethod: deliveryMethodFromSession || undefined,
      parcelPointCode: parcelPointCodeFromSession || undefined,
      parcelPointName: parcelPointNameFromSession || undefined,
      parcelPointNetwork: parcelPointNetworkFromSession || undefined,
    };

    let businessStatus: "PAID" | "PAYMENT_FAILED" | "PENDING" | undefined =
      undefined;

    try {
      const storeNameToCheck = String(storeNameFromSession || "").trim();
      const refsToCheck = String(referenceFromSession || "")
        .split(";")
        .map((s) => String(s || "").trim())
        .filter((s) => s.length > 0);
      const uniqueRefs = Array.from(new Set(refsToCheck));

      if (storeNameToCheck && uniqueRefs.length > 0) {
        const { data: storeRow, error: storeErr } = await supabase
          .from("stores")
          .select("id")
          .eq("name", storeNameToCheck)
          .maybeSingle();
        if (!storeErr) {
          const storeId = (storeRow as any)?.id ?? null;
          if (storeId) {
            for (const ref of uniqueRefs) {
              const { data: failedCart, error: failedErr } = await supabase
                .from("carts")
                .select("id")
                .eq("store_id", storeId)
                .eq("product_reference", ref)
                .eq("status", "PAYMENT_FAILED")
                .limit(1);
              if (!failedErr && (failedCart || []).length > 0) {
                businessStatus = "PAYMENT_FAILED";
                break;
              }
            }

            if (!businessStatus) {
              for (const ref of uniqueRefs) {
                const { data: shippedRows, error: shippedErr } = await supabase
                  .from("shipments")
                  .select("id")
                  .eq("store_id", storeId)
                  .or(buildProductReferenceOrFilter(ref))
                  .not("payment_id", "is", null)
                  .limit(1);
                if (!shippedErr && (shippedRows || []).length > 0) {
                  businessStatus = "PAID";
                  break;
                }
              }
            }

            if (!businessStatus) {
              businessStatus = "PENDING";
            }
          }
        }
      }
    } catch (_e) {}

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
    const promoId = String((promotionCode as any)?.id || "").trim();
    const storeSlugTrim = String(storeSlug || "").trim();
    if (storeSlugTrim && promoId.startsWith("promo_")) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id,promo_code_id")
        .eq("slug", storeSlugTrim)
        .maybeSingle();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      if (storeRow) {
        const currentRaw = String(
          (storeRow as any)?.promo_code_id || "",
        ).trim();
        const ids = currentRaw
          ? currentRaw
              .split(";;")
              .map((s: any) => String(s || "").trim())
              .filter(Boolean)
          : [];
        const next = Array.from(new Set([...ids, promoId])).join(";;");
        const { error: updErr } = await supabase
          .from("stores")
          .update({ promo_code_id: next })
          .eq("id", (storeRow as any).id);
        if (updErr) {
          return res.status(500).json({ error: updErr.message });
        }
      }
    }
    return res.json({ promotionCode });
  } catch (error) {
    console.error("Erreur lors de la création du code promo:", error);
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

    const promoId = String((promotionCode as any)?.id || "").trim();
    const storeSlug = String(
      (promotionCode as any)?.metadata?.storeSlug || "",
    ).trim();
    if (storeSlug && promoId.startsWith("promo_")) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id,promo_code_id")
        .eq("slug", storeSlug)
        .maybeSingle();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      if (storeRow) {
        const currentRaw = String(
          (storeRow as any)?.promo_code_id || "",
        ).trim();
        const ids = currentRaw
          ? currentRaw
              .split(";;")
              .map((s: any) => String(s || "").trim())
              .filter(Boolean)
          : [];
        const filtered = ids.filter((pid: string) => pid !== promoId);
        const next = filtered.join(";;");
        const { error: updErr } = await supabase
          .from("stores")
          .update({ promo_code_id: next })
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

export default router;
router.get("/coupons", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const list = await stripe.coupons.list({ limit: 50 });
    const data = (list.data || []).map((c) => ({
      id: c.id,
      name: c.name || null,
    }));
    res.json({ data });
  } catch (error) {
    res.status(500).json({ error: (error as any).message || "Internal error" });
  }
});
