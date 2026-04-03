import express from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { emailService } from "../services/emailService";
import { clerkClient, getAuth } from "@clerk/express";

const router = express.Router();

// Supabase configuration
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

function isMissingColumnError(err: any, column: string): boolean {
  const msg = String(err?.message || "");
  return (
    msg.includes(`column "${column}"`) ||
    msg.includes(`column '${column}'`) ||
    msg.includes(`column ${column}`) ||
    msg.toLowerCase().includes("does not exist")
  );
}

function parseWeightKgFromDescription(description: string): number | null {
  const s = String(description || "").toLowerCase();
  if (!s.trim()) return null;

  const m = s.match(
    /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilogramme?s?|kilo?s?|g|gr|gramme?s?)\b/i,
  );
  if (!m) return null;

  const raw = parseFloat(String(m[1] || "").replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return null;

  const unit = String(m[2] || "").toLowerCase();
  const kg = unit.startsWith("g") || unit.startsWith("gr") ? raw / 1000 : raw;
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

function getFallbackWeightKgFromDescription(description: string): number {
  return parseWeightKgFromDescription(description) ?? 0.5;
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function extractTikTokUsernameFromDescription(description: unknown): string | null {
  const raw = String(description || "");
  const match = raw.match(/commande\s+tiktok\s+@([a-z0-9._-]+)/i);
  return match?.[1] ? String(match[1]).trim().toLowerCase() : null;
}

/**
 * Déduit l'email principal d'un user Clerk de manière tolérante.
 * Pourquoi: selon le contexte d'auth, `primaryEmailAddress` peut être absent
 * et l'email peut exister uniquement dans `emailAddresses`.
 */
function getNormalizedClerkPrimaryEmail(clerkUser: any): string {
  return normalizeEmail(
    (clerkUser as any)?.primaryEmailAddress?.emailAddress ||
      (Array.isArray((clerkUser as any)?.emailAddresses) &&
      (clerkUser as any).emailAddresses.length > 0
        ? (clerkUser as any).emailAddresses[0]?.emailAddress
        : ""),
  );
}

/**
 * Résout le customer Stripe d'un utilisateur Clerk sans effet de bord.
 * Pourquoi: pour un contrôle d'accès, on ne doit jamais créer de customer
 * Stripe automatiquement, seulement vérifier l'identité existante.
 */
async function resolveExistingStripeIdForClerkUser(
  clerkUser: any,
  userEmail: string,
): Promise<string> {
  const metadataStripeId = String(
    (clerkUser as any)?.publicMetadata?.stripe_id || "",
  ).trim();
  if (metadataStripeId) return metadataStripeId;
  if (!userEmail) return "";
  try {
    const listed = await stripe.customers.list({ email: userEmail, limit: 1 });
    if (Array.isArray(listed.data) && listed.data.length > 0) {
      return String(listed.data[0]?.id || "").trim();
    }
  } catch {
    // Best effort: l'appel peut échouer en environnement local.
  }
  return "";
}

async function deleteCartInternal(id: number) {
  if (!id || typeof id !== "number") {
    return { success: false, error: "id requis pour la suppression" };
  }
  const { error } = await supabase.from("carts").delete().eq("id", id);
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

// POST /api/carts - Add item to cart
router.post("/", async (req, res) => {
  try {
    const {
      store_id,
      product_reference,
      value,
      customer_stripe_id,
      payment_id,
      description,
      quantity,
      weight,
    } = req.body || {};

    if (!customer_stripe_id) {
      return res
        .status(400)
        .json({ error: "customer_stripe_id requis pour le panier" });
    }
    if (!store_id || !product_reference) {
      return res.status(400).json({
        error:
          "store_id et product_reference sont requis pour ajouter au panier",
      });
    }

    const descriptionTrimmed =
      typeof description === "string" ? description.trim() : "";
    if (!descriptionTrimmed) {
      return res
        .status(400)
        .json({ error: "description requise pour le panier" });
    }

    const normalizedQuantity =
      typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0
        ? quantity
        : 1;

    const storeIdNum =
      typeof store_id === "number"
        ? store_id
        : typeof store_id === "string"
          ? Number(store_id)
          : NaN;

    const refTrimmed = String(product_reference || "").trim();
    const deliveryRegulationRegex = /r[ée]gularisation\s+livraison/i;
    if (
      deliveryRegulationRegex.test(refTrimmed) ||
      deliveryRegulationRegex.test(descriptionTrimmed)
    ) {
      return res.status(400).json({ error: "Référence interdite" });
    }
    const refCandidates = Array.from(
      new Set(
        [refTrimmed, refTrimmed.toLowerCase(), refTrimmed.toUpperCase()].filter(
          Boolean,
        ),
      ),
    );

    let stockMatch: any | null = null;
    if (Number.isFinite(storeIdNum) && storeIdNum > 0 && refCandidates.length) {
      let stockErr: any = null;
      let stockData: any[] | null = null;
      {
        const resp = await supabase
          .from("stock")
          .select("product_reference,product_stripe_id,weight,quantity")
          .eq("store_id", storeIdNum)
          .in("product_reference", refCandidates)
          .limit(1);
        stockData = resp.data as any;
        stockErr = resp.error;
      }
      if (!stockErr && Array.isArray(stockData) && stockData.length > 0) {
        stockMatch = stockData[0] || null;
      }
    }

    const normalizedWeight = (() => {
      if (weight === undefined || weight === null || weight === "") {
        const stockWeightRaw = Number((stockMatch as any)?.weight);
        if (Number.isFinite(stockWeightRaw) && stockWeightRaw >= 0) {
          return stockWeightRaw;
        }
        return getFallbackWeightKgFromDescription(descriptionTrimmed);
      }
      const wRaw =
        typeof weight === "number"
          ? weight
          : typeof weight === "string"
            ? parseFloat(weight.trim().replace(",", "."))
            : NaN;
      if (Number.isFinite(wRaw) && wRaw >= 0) return wRaw;
      return null;
    })();
    if (normalizedWeight === null) {
      return res.status(400).json({ error: "weight invalide (>= 0)" });
    }

    const stockStripeId =
      typeof (stockMatch as any)?.product_stripe_id === "string"
        ? String((stockMatch as any).product_stripe_id || "").trim()
        : "";
    let resolvedStripeProductId =
      stockStripeId && stockStripeId.startsWith("prod_") ? stockStripeId : "";

    const getStripeUnitPriceEur = async (stripeProductId: string) => {
      const pid = String(stripeProductId || "").trim();
      if (!pid || !pid.startsWith("prod_")) return null;
      try {
        const list = await stripe.prices.list({
          product: pid,
          active: true,
          limit: 100,
        } as any);
        const prices = Array.isArray((list as any)?.data)
          ? (list as any).data
          : [];
        const eur = prices.find(
          (p: any) =>
            String(p?.currency || "").toLowerCase() === "eur" &&
            Number(p?.unit_amount || 0) > 0,
        );
        if (!eur) return null;
        const cents = Number((eur as any)?.unit_amount || 0);
        const v = cents / 100;
        return Number.isFinite(v) && v > 0 ? v : null;
      } catch {
        return null;
      }
    };

    const incomingValueRaw =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseFloat(value.trim().replace(",", "."))
          : 0;
    const stripeUnitPrice = resolvedStripeProductId
      ? await getStripeUnitPriceEur(resolvedStripeProductId)
      : null;
    const normalizedValue =
      stripeUnitPrice && stripeUnitPrice > 0
        ? stripeUnitPrice
        : Number.isFinite(incomingValueRaw)
          ? incomingValueRaw
          : 0;

    const paymentIdTrimmed =
      typeof payment_id === "string" ? payment_id.trim() : "";
    if (paymentIdTrimmed && /[,()]/.test(paymentIdTrimmed)) {
      return res.status(400).json({ error: "payment_id invalide" });
    }

    const row: any = {
      store_id,
      product_reference,
      value: normalizedValue,
      customer_stripe_id,
      description: descriptionTrimmed,
      ...(paymentIdTrimmed ? { payment_id: paymentIdTrimmed } : {}),
      quantity: normalizedQuantity,
      weight: normalizedWeight,
      created_at: new Date().toISOString(),
    };

    let data: any = null;
    let error: any = null;
    const candidates: any[] = [];
    const pushCandidate = (c: any) => {
      const key = JSON.stringify(
        Object.keys(c)
          .sort()
          .reduce((acc: any, k) => {
            acc[k] = c[k];
            return acc;
          }, {}),
      );
      if (!candidates.some((x) => (x as any).__key === key)) {
        (c as any).__key = key;
        candidates.push(c);
      }
    };

    pushCandidate({ ...row });
    pushCandidate(
      (() => {
        const { weight: _w, ...withoutWeight } = row;
        return { ...withoutWeight };
      })(),
    );
    if (paymentIdTrimmed) {
      pushCandidate(
        (() => {
          const { payment_id: _pid, ...withoutPaymentId } = row;
          return { ...withoutPaymentId };
        })(),
      );
      pushCandidate(
        (() => {
          const { payment_id: _pid, weight: _w, ...rest } = row;
          return { ...rest };
        })(),
      );
    }

    for (const cand of candidates) {
      const { __key: _k, ...payload } = cand as any;
      const resp = await supabase
        .from("carts")
        .insert([payload])
        .select()
        .single();
      data = resp.data;
      error = resp.error;
      if (!error) break;
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true, item: data });
  } catch (e) {
    console.error("Error adding to cart:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/carts/summary?stripeId=<id>
router.get("/summary", async (req, res) => {
  try {
    const stripeId = (req.query.stripeId as string) || "";
    const paymentIdRaw = (req.query.paymentId as string) || "";
    const paymentId = String(paymentIdRaw || "").trim();
    const onlyPayment =
      String((req.query.onlyPayment as string) || "").trim() === "true";
    if (!stripeId) {
      return res.status(400).json({ error: "stripeId requis" });
    }
    if (paymentId && /[,()]/.test(paymentId)) {
      return res.status(400).json({ error: "paymentId invalide" });
    }
    if (onlyPayment && !paymentId) {
      return res.status(400).json({ error: "paymentId requis" });
    }

    const baseFields =
      "id,store_id,product_reference,value,quantity,created_at,description,recap_sent_at";

    let includeWeight = true;
    let paymentIdColumnOk = true;

    const buildSelect = () => {
      const cols: string[] = [baseFields];
      if (includeWeight) cols.push("weight");
      if (paymentIdColumnOk) cols.push("payment_id");
      return cols.join(",");
    };

    let cartRows: any[] | null = null;
    let error: any = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      let q = supabase
        .from("carts")
        .select(buildSelect())
        .eq("customer_stripe_id", stripeId)
        .order("id", { ascending: false });
      if (paymentId && paymentIdColumnOk) {
        q = q.eq("payment_id", paymentId);
      }

      const resp = await q;
      cartRows = resp.data as any;
      error = resp.error;
      if (!error) break;

      let changed = false;
      if (paymentIdColumnOk && isMissingColumnError(error, "payment_id")) {
        paymentIdColumnOk = false;
        changed = true;
      }
      if (includeWeight && isMissingColumnError(error, "weight")) {
        includeWeight = false;
        changed = true;
      }
      if (!changed) break;
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (paymentId && !paymentIdColumnOk) {
      return res
        .status(500)
        .json({ error: "Impossible de filtrer: colonne payment_id manquante" });
    }

    const validRows = cartRows || [];
    const storeIds = Array.from(
      new Set(validRows.map((r: any) => r.store_id).filter(Boolean)),
    );

    let storesMap: Record<number, { id: number; name: string; slug: string }> =
      {};
    if (storeIds.length > 0) {
      const { data: storesData, error: storesErr } = await supabase
        .from("stores")
        .select("id,name,slug")
        .in("id", storeIds);
      if (storesErr) {
        return res.status(500).json({ error: storesErr.message });
      }
      storesMap = (storesData || []).reduce(
        (
          acc: Record<number, { id: number; name: string; slug: string }>,
          s: any,
        ) => {
          acc[s.id] = { id: s.id, name: s.name, slug: s.slug };
          return acc;
        },
        {},
      );
    }

    const uniqueRefs = Array.from(
      new Set(
        validRows
          .map((r: any) => String(r?.product_reference || "").trim())
          .filter(Boolean),
      ),
    );
    const stockStripeIdByStoreAndRef = new Map<string, string>();
    if (storeIds.length > 0 && uniqueRefs.length > 0) {
      const { data: stockRows, error: stockErr } = await supabase
        .from("stock")
        .select("store_id,product_reference,product_stripe_id")
        .in("store_id", storeIds as any)
        .in("product_reference", uniqueRefs as any);
      if (stockErr) {
        return res.status(500).json({ error: stockErr.message });
      }
      for (const r of Array.isArray(stockRows) ? stockRows : []) {
        const sid = Number((r as any)?.store_id || 0);
        const ref = String((r as any)?.product_reference || "").trim();
        const pid = String((r as any)?.product_stripe_id || "").trim();
        if (!Number.isFinite(sid) || sid <= 0 || !ref || !pid) continue;
        stockStripeIdByStoreAndRef.set(`${sid}::${ref.toLowerCase()}`, pid);
      }
    }

    const itemsByStore: Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      suggestedWeight: number;
      items: Array<{
        id: number;
        product_reference: string;
        value: number;
        quantity?: number;
        created_at?: string;
        description?: string;
        recap_sent_at?: string;
        weight?: number | null;
        payment_id?: string | null;
      }>;
    }> = [];

    const grouped: Record<string, { total: number; items: any[]; store: any }> =
      {};
    for (const r of validRows) {
      const key = String(r.store_id || "null");
      if (!grouped[key]) {
        grouped[key] = {
          total: 0,
          items: [],
          store: r.store_id ? storesMap[r.store_id] || null : null,
        };
      }
      const rowItem: any = {
        id: r.id,
        product_reference: r.product_reference,
        value: r.value,
        quantity: (r as any).quantity ?? 1,
        created_at: (r as any).created_at,
        description: (r as any).description,
        recap_sent_at: (r as any).recap_sent_at,
        weight: (r as any).weight ?? null,
      };
      const storeIdNum = Number(r?.store_id || 0);
      const refTrimmed = String(r?.product_reference || "").trim();
      const pid = stockStripeIdByStoreAndRef.get(
        `${storeIdNum}::${refTrimmed.toLowerCase()}`,
      );
      if (pid) {
        rowItem.product_stripe_id = pid;
      }
      if (paymentIdColumnOk) {
        rowItem.payment_id = (r as any).payment_id ?? null;
      }
      grouped[key].items.push(rowItem);
      const qty = Number((r as any).quantity ?? 1);
      grouped[key].total += (r.value || 0) * (Number.isFinite(qty) ? qty : 1);
    }

    let grandTotal = 0;
    for (const k of Object.keys(grouped)) {
      let suggestedWeight = 0;
      for (const it of grouped[k].items || []) {
        const qty = Math.max(1, Number((it as any)?.quantity ?? 1));
        const itemWeightRaw = (it as any)?.weight;
        const itemWeight =
          typeof itemWeightRaw === "number" &&
          Number.isFinite(itemWeightRaw) &&
          itemWeightRaw > 0
            ? itemWeightRaw
            : parseWeightKgFromDescription(
                String((it as any)?.description || ""),
              );
        if (itemWeight != null) {
          suggestedWeight += itemWeight * (Number.isFinite(qty) ? qty : 1);
        }
      }
      if (!Number.isFinite(suggestedWeight) || suggestedWeight <= 0) {
        suggestedWeight = 0.5;
      }
      itemsByStore.push({
        store: grouped[k].store,
        total: grouped[k].total,
        items: grouped[k].items,
        suggestedWeight,
      });
      grandTotal += grouped[k].total;
    }

    return res.json({ itemsByStore, grandTotal });
  } catch (e) {
    console.error("Error fetching cart summary:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

/**
 * GET /api/carts/summary-live?storeSlug=<slug>&email=<email>
 * Récupère le panier live par email (avant liaison customer_stripe_id).
 */
router.get("/summary-live", async (req, res) => {
  try {
    const storeSlug = String(req.query.storeSlug || "").trim();
    const email = normalizeEmail(req.query.email);
    if (!storeSlug) {
      return res.status(400).json({ error: "storeSlug requis" });
    }
    if (!email) {
      return res.status(400).json({ error: "email requis" });
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id,name,slug")
      .eq("slug", storeSlug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message || "Erreur store" });
    }
    if (!storeRow?.id) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const selectWithWeight =
      "id,store_id,product_reference,value,quantity,created_at,description,recap_sent_at,weight,payment_id";
    const selectWithoutWeight =
      "id,store_id,product_reference,value,quantity,created_at,description,recap_sent_at,payment_id";
    const selectWithoutPayment =
      "id,store_id,product_reference,value,quantity,created_at,description,recap_sent_at";

    let rows: any[] | null = null;
    let error: any = null;
    {
      const resp = await supabase
        .from("carts")
        .select(selectWithWeight)
        .eq("store_id", Number(storeRow.id))
        .eq("customer_email", email)
        .order("id", { ascending: false });
      rows = resp.data as any;
      error = resp.error;
    }
    if (error && isMissingColumnError(error, "weight")) {
      const resp2 = await supabase
        .from("carts")
        .select(selectWithoutWeight)
        .eq("store_id", Number(storeRow.id))
        .eq("customer_email", email)
        .order("id", { ascending: false });
      rows = resp2.data as any;
      error = resp2.error;
    }
    if (error && isMissingColumnError(error, "payment_id")) {
      const resp3 = await supabase
        .from("carts")
        .select(selectWithoutPayment)
        .eq("store_id", Number(storeRow.id))
        .eq("customer_email", email)
        .order("id", { ascending: false });
      rows = resp3.data as any;
      error = resp3.error;
    }
    if (error) {
      return res.status(500).json({ error: error.message || "Erreur lecture panier live" });
    }

    const items = Array.isArray(rows) ? rows : [];
    let suggestedWeight = 0;
    for (const it of items) {
      const qty = Math.max(1, Number((it as any)?.quantity ?? 1));
      const itemWeightRaw = (it as any)?.weight;
      const itemWeight =
        typeof itemWeightRaw === "number" &&
        Number.isFinite(itemWeightRaw) &&
        itemWeightRaw > 0
          ? itemWeightRaw
          : parseWeightKgFromDescription(String((it as any)?.description || ""));
      if (itemWeight != null) {
        suggestedWeight += itemWeight * qty;
      }
    }
    if (!Number.isFinite(suggestedWeight) || suggestedWeight <= 0) {
      suggestedWeight = 0.5;
    }
    const total = items.reduce(
      (sum, it) => sum + Number((it as any)?.value || 0) * Math.max(1, Number((it as any)?.quantity || 1)),
      0,
    );

    return res.json({
      itemsByStore: [
        {
          store: {
            id: Number(storeRow.id),
            name: String((storeRow as any)?.name || ""),
            slug: String((storeRow as any)?.slug || storeSlug),
          },
          total,
          suggestedWeight,
          items,
        },
      ],
      grandTotal: total,
    });
  } catch (e) {
    console.error("Error fetching live summary:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

/**
 * GET /api/carts/live-recipient-access?liveEmail=<email>|liveStripeId=<id>
 * Vérifie que l'utilisateur Clerk connecté correspond bien au destinataire
 * du lien checkout live. Cette validation est côté serveur pour éviter tout
 * contournement front-end.
 */
router.get("/live-recipient-access", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const liveEmail = normalizeEmail(req.query.liveEmail);
    const liveStripeId = String(req.query.liveStripeId || "").trim();
    if ((!liveEmail && !liveStripeId) || (liveEmail && liveStripeId)) {
      return res
        .status(400)
        .json({ error: "Fournir exactement un parametre: liveEmail ou liveStripeId" });
    }

    const clerkUser = await clerkClient.users.getUser(auth.userId);
    const userEmail = getNormalizedClerkPrimaryEmail(clerkUser);
    if (!userEmail) {
      return res.status(400).json({ error: "Email utilisateur Clerk introuvable" });
    }

    if (liveEmail) {
      const allowed = userEmail === liveEmail;
      return res.json({
        allowed,
        userEmail,
        target: liveEmail,
        reason: allowed ? null : "email_mismatch",
      });
    }

    const userStripeId = await resolveExistingStripeIdForClerkUser(
      clerkUser,
      userEmail,
    );
    if (userStripeId && userStripeId === liveStripeId) {
      return res.json({
        allowed: true,
        userEmail,
        target: liveStripeId,
        reason: null,
      });
    }

    try {
      const customer = await stripe.customers.retrieve(liveStripeId);
      const customerEmail = normalizeEmail((customer as any)?.email || "");
      if (customerEmail && customerEmail === userEmail) {
        return res.json({
          allowed: true,
          userEmail,
          target: liveStripeId,
          reason: null,
        });
      }
    } catch {
      // Best effort: on conserve un refus explicite si la vérification Stripe échoue.
    }

    return res.json({
      allowed: false,
      userEmail,
      target: liveStripeId,
      reason: "stripe_mismatch",
    });
  } catch (e: any) {
    console.error("Error checking live recipient access:", e);
    return res.status(500).json({ error: String(e?.message || "Erreur interne du serveur") });
  }
});

/**
 * POST /api/carts/link-live-cart
 * Lie les lignes `carts` du panier live (par email) à l'utilisateur Clerk connecté.
 */
router.post("/link-live-cart", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const storeSlug = String(req.body?.storeSlug || "").trim();
    if (!storeSlug) {
      return res.status(400).json({ error: "storeSlug requis" });
    }

    const clerkUser = await clerkClient.users.getUser(auth.userId);
    const userEmail = getNormalizedClerkPrimaryEmail(clerkUser);
    if (!userEmail) {
      return res.status(400).json({ error: "Email utilisateur Clerk introuvable" });
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id,slug")
      .eq("slug", storeSlug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message || "Erreur store" });
    }
    if (!storeRow?.id) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    let stripeId = String((clerkUser as any)?.publicMetadata?.stripe_id || "").trim();
    if (!stripeId) {
      const listed = await stripe.customers.list({ email: userEmail, limit: 1 });
      if (Array.isArray(listed.data) && listed.data.length > 0) {
        stripeId = String(listed.data[0]?.id || "").trim();
      }
      if (!stripeId) {
        const fullName = [String((clerkUser as any)?.firstName || "").trim(), String((clerkUser as any)?.lastName || "").trim()]
          .filter(Boolean)
          .join(" ")
          .trim();
        const created = await stripe.customers.create({
          name: fullName || userEmail,
          email: userEmail,
          metadata: { clerk_id: String(auth.userId) },
        });
        stripeId = String(created?.id || "").trim();
      }
      if (!stripeId) {
        return res.status(500).json({ error: "Impossible de créer/résoudre customer Stripe" });
      }
    }

    let tiktokUsername: string | null = null;
    const cartRowsResp = await supabase
      .from("carts")
      .select("id,customer_tiktok_username,customer_stripe_id,description")
      .eq("store_id", Number(storeRow.id))
      .eq("customer_email", userEmail)
      .is("payment_id", null)
      .order("id", { ascending: false })
      .limit(200);
    if (
      cartRowsResp.error &&
      !isMissingColumnError(cartRowsResp.error, "customer_tiktok_username")
    ) {
      return res.status(500).json({ error: cartRowsResp.error.message || "Erreur lecture panier" });
    }
    const rows = Array.isArray(cartRowsResp.data) ? cartRowsResp.data : [];
    if (rows.length === 0) {
      // Cas user déjà connecté Clerk:
      // si aucune ligne n'est trouvée par email, on tente de retrouver un username
      // TikTok depuis les lignes déjà liées au customer Stripe du user.
      const fallbackRowsResp = await supabase
        .from("carts")
        .select("customer_tiktok_username,description")
        .eq("store_id", Number(storeRow.id))
        .eq("customer_stripe_id", stripeId)
        .is("payment_id", null)
        .order("id", { ascending: false })
        .limit(50);
      if (
        fallbackRowsResp.error &&
        !isMissingColumnError(fallbackRowsResp.error, "customer_tiktok_username")
      ) {
        return res.status(500).json({
          error: fallbackRowsResp.error.message || "Erreur lecture panier (fallback stripe)",
        });
      }

      let fallbackTikTokUsername: string | null = null;
      const fallbackRows = Array.isArray(fallbackRowsResp.data)
        ? fallbackRowsResp.data
        : [];
      for (const row of fallbackRows) {
        const byColumn = String((row as any)?.customer_tiktok_username || "")
          .trim()
          .toLowerCase();
        const byDescription = extractTikTokUsernameFromDescription(
          (row as any)?.description,
        );
        const candidate = byColumn || byDescription || "";
        if (candidate) {
          fallbackTikTokUsername = candidate;
          break;
        }
      }

      const nextPublicMetadata: Record<string, unknown> = {
        stripe_id: stripeId,
        tiktok_username:
          fallbackTikTokUsername ||
          String((clerkUser as any)?.publicMetadata?.tiktok_username || "")
            .trim()
            .toLowerCase(),
      };
      await clerkClient.users.updateUserMetadata(auth.userId, {
        publicMetadata: nextPublicMetadata,
      } as any);

      return res.json({
        success: true,
        stripeId,
        email: userEmail,
        tiktokUsername: fallbackTikTokUsername,
        linkedStoreId: Number(storeRow.id),
        linkedCount: 0,
        matchedEmail: false,
      });
    }
    for (const row of rows) {
      const byColumn = String((row as any)?.customer_tiktok_username || "")
        .trim()
        .toLowerCase();
      const byDescription = extractTikTokUsernameFromDescription((row as any)?.description);
      const candidate = byColumn || byDescription || "";
      if (candidate) {
        tiktokUsername = candidate;
        break;
      }
    }

    const idsToLink = rows
      .map((row: any) => Number(row?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0);
    const idsToLinkWithoutCurrentStripe = rows
      .filter(
        (row: any) =>
          String((row as any)?.customer_stripe_id || "").trim() !== stripeId,
      )
      .map((row: any) => Number(row?.id || 0))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (idsToLinkWithoutCurrentStripe.length > 0) {
      const upd = await supabase
        .from("carts")
        .update({ customer_stripe_id: stripeId })
        .in("id", idsToLinkWithoutCurrentStripe);
      if (upd.error) {
        return res.status(500).json({ error: upd.error.message || "Erreur liaison panier" });
      }
    }

    const nextPublicMetadata: Record<string, unknown> = {
      stripe_id: stripeId,
    };
    // Le username TikTok est persisté côté Clerk pour éviter de le redemander
    // à l'utilisateur à chaque nouveau passage checkout live.
    nextPublicMetadata.tiktok_username =
      tiktokUsername ||
      String((clerkUser as any)?.publicMetadata?.tiktok_username || "")
        .trim()
        .toLowerCase();

    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: nextPublicMetadata,
    } as any);

    return res.json({
      success: true,
      stripeId,
      email: userEmail,
      tiktokUsername,
      linkedStoreId: Number(storeRow.id),
      linkedCount: idsToLinkWithoutCurrentStripe.length,
      matchedEmail: true,
      inspectedCount: idsToLink.length,
    });
  } catch (e: any) {
    console.error("Error linking live cart:", e);
    return res.status(500).json({ error: String(e?.message || "Erreur interne du serveur") });
  }
});

// DELETE /api/carts - Remove item by id only
router.delete("/", async (req, res) => {
  try {
    const { id } = (req.body || {}) as {
      id?: number;
    };

    if (!id || typeof id !== "number") {
      return res.status(400).json({ error: "id requis pour la suppression" });
    }

    const result = await deleteCartInternal(id);
    if (!result.success) {
      if (result.error === "item_not_found") {
        return res.status(404).json({ error: "item_not_found" });
      }
      return res.status(500).json({ error: result.error || "unknown_error" });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("Error deleting from cart:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// PUT /api/carts/:id - Update quantity for a cart item
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { quantity } = req.body || {};
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "id invalide" });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "quantity invalide" });
    }
    const { data, error } = await supabase
      .from("carts")
      .update({ quantity: qty })
      .eq("id", id)
      .select(
        "id,store_id,product_reference,value,quantity,created_at,description,weight",
      )
      .single();
    if (error && isMissingColumnError(error, "weight")) {
      const { data: data2, error: error2 } = await supabase
        .from("carts")
        .update({ quantity: qty })
        .eq("id", id)
        .select(
          "id,store_id,product_reference,value,quantity,created_at,description",
        )
        .single();
      if (error2) {
        return res.status(500).json({ error: error2.message });
      }
      return res.json({ success: true, item: data2 });
    }
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true, item: data });
  } catch (e) {
    console.error("Error updating cart item quantity:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/carts/store/:slug - list all carts for a given store
router.get("/store/:slug", async (req, res) => {
  try {
    const slug = (req.params.slug || "").trim();
    if (!slug) {
      return res.status(400).json({ error: "slug requis" });
    }
    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }
    const storeId = (storeRow as any)?.id;
    let carts: any[] | null = null;
    let error: any = null;
    let includeWeight = true;
    let includeCustomerEmail = true;
    let includeTikTokUsername = true;
    const buildSelect = () => {
      const cols = [
        "id",
        "store_id",
        "customer_stripe_id",
        "product_reference",
        "value",
        "quantity",
        "created_at",
        "description",
        "recap_sent_at",
      ];
      if (includeCustomerEmail) cols.push("customer_email");
      if (includeTikTokUsername) cols.push("customer_tiktok_username");
      if (includeWeight) cols.push("weight");
      return cols.join(", ");
    };
    for (let attempt = 0; attempt < 8; attempt++) {
      const resp = await supabase
        .from("carts")
        .select(buildSelect())
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      carts = resp.data as any;
      error = resp.error;
      if (!error) break;
      let changed = false;
      if (includeWeight && isMissingColumnError(error, "weight")) {
        includeWeight = false;
        changed = true;
      }
      if (
        includeCustomerEmail &&
        isMissingColumnError(error, "customer_email")
      ) {
        includeCustomerEmail = false;
        changed = true;
      }
      if (
        includeTikTokUsername &&
        isMissingColumnError(error, "customer_tiktok_username")
      ) {
        includeTikTokUsername = false;
        changed = true;
      }
      if (!changed) break;
    }
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ carts: carts || [] });
  } catch (e) {
    console.error("Error fetching store carts:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/recap", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { stripeIds, storeSlug, selectedCartIds } = req.body || {};
    const recipientKeys = Array.isArray(stripeIds) ? stripeIds : [];
    const selectedIds = Array.isArray(selectedCartIds)
      ? Array.from(
          new Set(
            selectedCartIds
              .map((id: unknown) => Number(id))
              .filter((id: number) => Number.isFinite(id) && id > 0),
          ),
        )
      : [];
    if (recipientKeys.length === 0) {
      return res.status(400).json({ error: "Aucun panier sélectionné" });
    }
    if (!storeSlug || typeof storeSlug !== "string") {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, name")
      .eq("slug", storeSlug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }
    const storeId = (storeRow as any)?.id;
    const storeName = (storeRow as any)?.name;
    const cloud = (process.env.CLOUDFRONT_URL || "").replace(/\/+$/, "");
    const storeLogo = cloud ? `${cloud}/images/${storeId}` : "";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const checkoutBaseUrl = `${frontendUrl}/checkout/${encodeURIComponent(
      storeSlug,
    )}`;
    /**
     * Construit un lien de checkout spécifique au destinataire.
     * Pourquoi: éviter d'envoyer exactement la même URL à deux clients différents,
     * et conserver un identifiant de contexte (email/stripe) dans le lien.
     */
    const buildCheckoutLink = (input: {
      recipientType: "email" | "stripe";
      recipientValue: string;
      selectedIdsForRecipient: number[];
    }): string => {
      const params = new URLSearchParams();
      if (input.recipientType === "email") {
        params.set("live_email", normalizeEmail(input.recipientValue));
      } else {
        params.set("live_stripe_id", String(input.recipientValue || "").trim());
      }
      if (Array.isArray(input.selectedIdsForRecipient) && input.selectedIdsForRecipient.length > 0) {
        params.set(
          "cart_ids",
          input.selectedIdsForRecipient
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
            .join(","),
        );
      }
      const qs = params.toString();
      return qs ? `${checkoutBaseUrl}?${qs}` : checkoutBaseUrl;
    };
    const sentStripeIds: string[] = [];
    const failedStripeIds: string[] = [];
    const sentRecipientKeys: string[] = [];
    const failedRecipientKeys: string[] = [];
    // Précharge les lignes explicitement sélectionnées (si présentes) pour
    // garantir qu'un récap ne peut jamais inclure des articles d'un autre client.
    const selectedRowsById = new Map<number, any>();
    if (selectedIds.length > 0) {
      const selectedRowsResp = await supabase
        .from("carts")
        .select(
          "id,store_id,customer_email,customer_stripe_id,customer_tiktok_username,product_reference,value,description,quantity,payment_id",
        )
        .eq("store_id", storeId)
        .in("id", selectedIds as any);
      if (selectedRowsResp.error) {
        return res.status(500).json({
          error: selectedRowsResp.error.message || "Erreur lecture paniers sélectionnés",
        });
      }
      for (const row of Array.isArray(selectedRowsResp.data) ? selectedRowsResp.data : []) {
        const id = Number((row as any)?.id || 0);
        if (Number.isFinite(id) && id > 0) {
          selectedRowsById.set(id, row);
        }
      }
    }
    for (const sid of recipientKeys) {
      const recipientKey = String(sid || "").trim();
      if (!recipientKey) continue;

      if (recipientKey.toLowerCase().startsWith("email:")) {
        const customerEmail = normalizeEmail(recipientKey.slice("email:".length));
        if (!customerEmail) {
          failedRecipientKeys.push(recipientKey);
          continue;
        }

        // Cas prioritaire: reconstruction stricte depuis les IDs sélectionnés.
        let carts: Array<{
          id: unknown;
          product_reference: unknown;
          value: unknown;
          description: unknown;
          quantity: unknown;
          customer_tiktok_username?: unknown;
        }> = [];
        if (selectedIds.length > 0) {
          carts = selectedIds
            .map((id) => selectedRowsById.get(Number(id)))
            .filter((row) => !!row)
            .filter(
              (row: any) =>
                normalizeEmail((row as any)?.customer_email) === customerEmail &&
                !String((row as any)?.payment_id || "").trim(),
            )
            .map((row: any) => ({
              id: (row as any)?.id,
              product_reference: (row as any)?.product_reference,
              value: (row as any)?.value,
              description: (row as any)?.description,
              quantity: (row as any)?.quantity,
              customer_tiktok_username: (row as any)?.customer_tiktok_username,
            }));
        } else {
          const cartsResp = await supabase
            .from("carts")
            .select(
              "id, product_reference, value, description, quantity, customer_tiktok_username",
            )
            .eq("customer_email", customerEmail)
            .eq("store_id", storeId)
            .is("payment_id", null);
          if (
            cartsResp.error &&
            !isMissingColumnError(cartsResp.error, "customer_tiktok_username")
          ) {
            failedRecipientKeys.push(recipientKey);
            continue;
          }
          carts = Array.isArray(cartsResp.data) ? (cartsResp.data as any[]) : [];
          if (
            cartsResp.error &&
            isMissingColumnError(cartsResp.error, "customer_tiktok_username")
          ) {
            const cartsRespFallback = await supabase
              .from("carts")
              .select("id, product_reference, value, description, quantity")
              .eq("customer_email", customerEmail)
              .eq("store_id", storeId)
              .is("payment_id", null);
            if (cartsRespFallback.error) {
              failedRecipientKeys.push(recipientKey);
              continue;
            }
            carts = Array.isArray(cartsRespFallback.data)
              ? (cartsRespFallback.data as any[])
              : [];
          }
        }

        const items = (carts || []).map((c: any) => ({
          product_reference: String(c.product_reference || ""),
          value: Number(c.value || 0),
          description: typeof c.description === "string" ? c.description : "",
          quantity:
            typeof c.quantity === "number" &&
            Number.isFinite(c.quantity) &&
            c.quantity > 0
              ? c.quantity
              : 1,
        }));
        if (items.length === 0) {
          failedRecipientKeys.push(recipientKey);
          continue;
        }

        let customerName = "Client";
        const byUsernameColumn = String((carts[0] as any)?.customer_tiktok_username || "")
          .trim()
          .replace(/^@+/, "");
        const byDescription = extractTikTokUsernameFromDescription((carts[0] as any)?.description);
        if (byUsernameColumn) {
          customerName = `@${byUsernameColumn}`;
        } else if (byDescription) {
          customerName = `@${byDescription}`;
        }

        const selectedIdsForRecipient = (carts || [])
          .map((c: any) => Number(c?.id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0);
        const checkoutLink = buildCheckoutLink({
          recipientType: "email",
          recipientValue: customerEmail,
          selectedIdsForRecipient,
        });

        const ok = await emailService.sendCartRecap({
          customerEmail,
          customerName,
          storeName,
          storeLogo,
          carts: items,
          checkoutLink,
        });
        if (ok) {
          const nowIso = new Date().toISOString();
          const idsToUpdate = (carts || [])
            .map((c: any) => Number(c?.id || 0))
            .filter((id: number) => Number.isFinite(id) && id > 0);
          if (idsToUpdate.length === 0) {
            failedRecipientKeys.push(recipientKey);
            continue;
          }
          const updResp = await supabase
            .from("carts")
            .update({ recap_sent_at: nowIso })
            .in("id", idsToUpdate as any);
          if (updResp.error) {
            failedRecipientKeys.push(recipientKey);
          } else {
            sentRecipientKeys.push(recipientKey);
          }
        } else {
          failedRecipientKeys.push(recipientKey);
        }
        continue;
      }

      const stripeId = recipientKey;
      let customerEmail = "";
      let customerName = "Client";
      try {
        const customer = await stripe.customers.retrieve(stripeId);
        customerEmail = String((customer as any)?.email || "");
        customerName = String((customer as any)?.name || "Client");
      } catch {}
      if (!customerEmail) continue;
      let carts: any[] | null = null;
      let error: any = null;
      if (selectedIds.length > 0) {
        carts = selectedIds
          .map((id) => selectedRowsById.get(Number(id)))
          .filter((row) => !!row)
          .filter(
            (row: any) =>
              String((row as any)?.customer_stripe_id || "").trim() === stripeId &&
              !String((row as any)?.payment_id || "").trim(),
          )
          .map((row: any) => ({
            id: (row as any)?.id,
            product_reference: (row as any)?.product_reference,
            value: (row as any)?.value,
            description: (row as any)?.description,
            quantity: (row as any)?.quantity,
          }));
      } else {
        const resp = await supabase
          .from("carts")
          .select("id, product_reference, value, description, quantity")
          .eq("customer_stripe_id", stripeId)
          .eq("store_id", storeId)
          .is("payment_id", null);
        carts = resp.data as any;
        error = resp.error;
      }
      if (error) continue;
      const items = (carts || []).map((c: any) => ({
        product_reference: String(c.product_reference || ""),
        value: Number(c.value || 0),
        description: typeof c.description === "string" ? c.description : "",
        quantity:
          typeof c.quantity === "number" &&
          Number.isFinite(c.quantity) &&
          c.quantity > 0
            ? c.quantity
            : 1,
      }));
      if (items.length === 0) continue;
      const selectedIdsForRecipient = (carts || [])
        .map((c: any) => Number(c?.id || 0))
        .filter((id: number) => Number.isFinite(id) && id > 0);
      const checkoutLink = buildCheckoutLink({
        recipientType: "stripe",
        recipientValue: stripeId,
        selectedIdsForRecipient,
      });
      const ok = await emailService.sendCartRecap({
        customerEmail,
        customerName,
        storeName,
        storeLogo,
        carts: items,
        checkoutLink,
      });
      if (ok) {
        const nowIso = new Date().toISOString();
        const idsToUpdate = (carts || [])
          .map((c: any) => Number(c?.id || 0))
          .filter((id: number) => Number.isFinite(id) && id > 0);
        if (idsToUpdate.length === 0) {
          failedStripeIds.push(stripeId);
          failedRecipientKeys.push(recipientKey);
          continue;
        }
        const updResp = await supabase
          .from("carts")
          .update({ recap_sent_at: nowIso })
          .in("id", idsToUpdate as any);
        if (updResp.error) {
          failedStripeIds.push(stripeId);
          failedRecipientKeys.push(recipientKey);
        } else {
          sentStripeIds.push(stripeId);
          sentRecipientKeys.push(recipientKey);
        }
      } else {
        failedStripeIds.push(stripeId);
        failedRecipientKeys.push(recipientKey);
      }
    }
    return res.json({
      success: true,
      sentStripeIds,
      failedStripeIds,
      sentRecipientKeys,
      failedRecipientKeys,
    });
  } catch (e) {
    console.error("Error sending recap:", e);
    return res
      .status(500)
      .json({ error: "Erreur lors de l'envoi du récapitulatif" });
  }
});

export default router;
