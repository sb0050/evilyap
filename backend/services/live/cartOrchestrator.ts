import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export type CartOrchestrationInput = {
  storeId: number;
  tiktokUsername: string;
  reference: string;
  quantity: number;
  sourceComment: string;
  customerEmail?: string | null;
};

export type CartOrchestrationResult = {
  success: boolean;
  reason: string;
  cartId: number | null;
  customerStripeId: string | null;
  payload?: Record<string, unknown>;
};

export type LinkTikTokEmailInput = {
  storeId: number;
  tiktokUsername: string;
  email: string;
};

export type LinkTikTokEmailResult = {
  success: boolean;
  reason: string;
  customerStripeId: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables for cartOrchestrator");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-06-30.basil",
});

function normalizeTikTokUsername(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
}

function normalizeEmail(input: string | null | undefined): string | null {
  const email = String(input || "").trim().toLowerCase();
  if (!email) return null;
  const emailRegex =
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  return emailRegex.test(email) ? email : null;
}

async function getStripeUnitPriceEur(productId: string): Promise<number | null> {
  const pid = String(productId || "").trim();
  if (!pid.startsWith("prod_")) return null;
  try {
    const list = await stripe.prices.list({
      product: pid,
      active: true,
      limit: 100,
    } as any);
    const prices = Array.isArray((list as any)?.data) ? (list as any).data : [];
    const eur = prices.find(
      (p: any) =>
        String(p?.currency || "").toLowerCase() === "eur" && Number(p?.unit_amount || 0) > 0,
    );
    if (!eur) return null;
    const cents = Number((eur as any)?.unit_amount || 0);
    const value = cents / 100;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function resolveOrCreateStripeCustomerId(
  tiktokUsername: string,
  customerEmail?: string | null,
): Promise<string | null> {
  const _normalized = normalizeTikTokUsername(tiktokUsername);
  const _normalizedEmail = normalizeEmail(customerEmail);
  // Pourquoi toujours null ici:
  // le flux live doit stocker d'abord customer_tiktok_username + customer_email dans `carts`.
  // La liaison vers Stripe se fait uniquement au checkout après auth Clerk.
  return null;
}

function isMissingColumnError(err: any, column: string): boolean {
  const msg = String(err?.message || "").toLowerCase();
  if (!msg) return false;
  return msg.includes(`column "${String(column).toLowerCase()}`) || msg.includes("does not exist");
}

async function resolveStockProduct(storeId: number, rawReference: string) {
  const normalizeRef = (value: string) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9_-]/g, "");

  const reference = String(rawReference || "").trim();
  const upperRef = reference.toUpperCase();
  const normalizedInput = normalizeRef(reference);
  if (!reference) return null;

  const exact = await supabase
    .from("stock")
    .select("id,product_reference,product_stripe_id,weight,quantity")
    .eq("store_id", storeId)
    .eq("product_reference", upperRef)
    .limit(1);
  if (Array.isArray(exact.data) && exact.data.length > 0) {
    return exact.data[0] as any;
  }

  const fallback = await supabase
    .from("stock")
    .select("id,product_reference,product_stripe_id,weight,quantity")
    .eq("store_id", storeId)
    .ilike("product_reference", `%${reference}%`)
    .limit(1);
  if (Array.isArray(fallback.data) && fallback.data.length > 0) {
    return fallback.data[0] as any;
  }

  // Fallback robuste:
  // - certaines références ont des variantes de saisie (espaces, tirets, I/1, O/0),
  // - on charge les références du store puis on matche côté applicatif.
  const allRowsResp = await supabase
    .from("stock")
    .select("id,product_reference,product_stripe_id,weight,quantity")
    .eq("store_id", storeId)
    .limit(500);
  const allRows = Array.isArray(allRowsResp.data) ? (allRowsResp.data as any[]) : [];
  if (allRows.length === 0) return null;

  const relaxed = (s: string) =>
    normalizeRef(s)
      .replace(/I/g, "1")
      .replace(/O/g, "0")
      .replace(/L/g, "1");

  const inputRelaxed = relaxed(reference);
  const exactNormalized = allRows.find(
    (row) => normalizeRef(String(row?.product_reference || "")) === normalizedInput,
  );
  if (exactNormalized) return exactNormalized;

  const exactRelaxed = allRows.find(
    (row) => relaxed(String(row?.product_reference || "")) === inputRelaxed,
  );
  if (exactRelaxed) return exactRelaxed;

  const containsNormalized = allRows.find((row) =>
    normalizeRef(String(row?.product_reference || "")).includes(normalizedInput),
  );
  if (containsNormalized) return containsNormalized;

  const containsRelaxed = allRows.find((row) =>
    relaxed(String(row?.product_reference || "")).includes(inputRelaxed),
  );
  if (containsRelaxed) return containsRelaxed;

  return null;
}

/**
 * Orchestrateur panier:
 * - résout le client Stripe à partir du username TikTok,
 * - résout le produit stock,
 * - crée ou incrémente une ligne panier.
 */
export async function createOrUpdateCartFromLiveOrder(
  input: CartOrchestrationInput,
): Promise<CartOrchestrationResult> {
  const storeId = Number(input.storeId);
  const quantity = Number(input.quantity);
  const reference = String(input.reference || "").trim();
  const tiktokUsername = normalizeTikTokUsername(input.tiktokUsername);
  const customerEmail = normalizeEmail(input.customerEmail || null);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    return { success: false, reason: "storeId invalide", cartId: null, customerStripeId: null };
  }
  if (!reference) {
    return { success: false, reason: "Référence manquante", cartId: null, customerStripeId: null };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { success: false, reason: "Quantité invalide", cartId: null, customerStripeId: null };
  }
  if (!tiktokUsername) {
    return { success: false, reason: "Username TikTok manquant", cartId: null, customerStripeId: null };
  }

  const customerStripeId = await resolveOrCreateStripeCustomerId(tiktokUsername, customerEmail);

  const stockRow = await resolveStockProduct(storeId, reference);
  if (!stockRow) {
    return {
      success: false,
      reason: "Produit introuvable en stock",
      cartId: null,
      customerStripeId,
      payload: { reference },
    };
  }

  const productReference = String(stockRow?.product_reference || reference).trim().toUpperCase();
  const weightRaw = Number(stockRow?.weight);
  const weight = Number.isFinite(weightRaw) && weightRaw >= 0 ? weightRaw : 0.5;
  const stripeProductId = String(stockRow?.product_stripe_id || "").trim();
  const stripeUnitPrice = await getStripeUnitPriceEur(stripeProductId);
  const value =
    stripeUnitPrice && stripeUnitPrice > 0
      ? stripeUnitPrice
      : 0;

  let existingRow: any = null;
  {
    let existing = await supabase
      .from("carts")
      .select("id,quantity")
      .eq("store_id", storeId)
      .eq("product_reference", productReference)
      .is("payment_id", null)
      .is("customer_stripe_id", null)
      .eq("customer_tiktok_username", tiktokUsername)
      .limit(1);
    if (existing.error && isMissingColumnError(existing.error, "customer_tiktok_username")) {
      existing = await supabase
        .from("carts")
        .select("id,quantity,description")
        .eq("store_id", storeId)
        .eq("product_reference", productReference)
        .is("payment_id", null)
        .is("customer_stripe_id", null)
        .ilike("description", `%commande tiktok @${tiktokUsername}%`)
        .limit(1);
    }
    if (existing.error) {
      return {
        success: false,
        reason: existing.error.message || "Erreur lecture panier live",
        cartId: null,
        customerStripeId: null,
      };
    }
    existingRow =
      Array.isArray(existing.data) && existing.data.length > 0 ? existing.data[0] : null;
  }

  const description = `Commande TikTok @${tiktokUsername}: ${String(input.sourceComment || "").slice(0, 240)}`;
  if (existingRow?.id) {
    const currentQtyRaw = Number(existingRow.quantity || 1);
    const currentQty = Number.isFinite(currentQtyRaw) && currentQtyRaw > 0 ? Math.floor(currentQtyRaw) : 1;
    const nextQty = currentQty + Math.floor(quantity);
    let upd = await supabase
      .from("carts")
      .update({
        quantity: nextQty,
        value,
        description,
        customer_tiktok_username: tiktokUsername,
        ...(customerEmail ? { customer_email: customerEmail } : {}),
      } as any)
      .eq("id", existingRow.id)
      .select("id")
      .single();
    if (
      upd.error &&
      (isMissingColumnError(upd.error, "customer_tiktok_username") ||
        isMissingColumnError(upd.error, "customer_email"))
    ) {
      upd = await supabase
        .from("carts")
        .update({
          quantity: nextQty,
          value,
          description,
        })
        .eq("id", existingRow.id)
        .select("id")
        .single();
    }
    if (upd.error) {
      return {
        success: false,
        reason: upd.error.message || "Erreur update panier",
        cartId: null,
        customerStripeId,
      };
    }
    return {
      success: true,
      reason: "Panier mis à jour",
      cartId: Number((upd.data as any)?.id || existingRow.id),
      customerStripeId,
      payload: { productReference, quantity: nextQty, value },
    };
  }

  let insert = await supabase
    .from("carts")
    .insert([
      {
        store_id: storeId,
        product_reference: productReference,
        value,
        customer_stripe_id: customerStripeId,
        description,
        quantity: Math.floor(quantity),
        weight,
        customer_tiktok_username: tiktokUsername,
        ...(customerEmail ? { customer_email: customerEmail } : {}),
        created_at: new Date().toISOString(),
      } as any,
    ])
    .select("id")
    .single();
  if (
    insert.error &&
    (isMissingColumnError(insert.error, "customer_tiktok_username") ||
      isMissingColumnError(insert.error, "customer_email"))
  ) {
    insert = await supabase
      .from("carts")
      .insert([
        {
          store_id: storeId,
          product_reference: productReference,
          value,
          customer_stripe_id: customerStripeId,
          description,
          quantity: Math.floor(quantity),
          weight,
          created_at: new Date().toISOString(),
        },
      ])
      .select("id")
      .single();
  }
  if (insert.error) {
    return {
      success: false,
      reason: insert.error.message || "Erreur insertion panier",
      cartId: null,
      customerStripeId,
    };
  }
  return {
    success: true,
    reason: "Panier créé",
    cartId: Number((insert.data as any)?.id || 0) || null,
    customerStripeId,
    payload: { productReference, quantity: Math.floor(quantity), value },
  };
}

/**
 * Lie un email client à un username TikTok directement dans `carts`
 * via `customer_email` et `customer_tiktok_username`.
 *
 * Pourquoi ce point d'entrée:
 * - le panier live est indexé par customer_stripe_id,
 * - la clé de rapprochement côté live est le username TikTok.
 * On synchronise donc l'email pour permettre l'envoi du récap.
 */
export async function linkTikTokUsernameToEmail(
  input: LinkTikTokEmailInput,
): Promise<LinkTikTokEmailResult> {
  const storeId = Number(input.storeId);
  const tiktokUsername = normalizeTikTokUsername(input.tiktokUsername);
  const email = normalizeEmail(input.email);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    return {
      success: false,
      reason: "storeId invalide",
      customerStripeId: null,
    };
  }
  if (!tiktokUsername) {
    return {
      success: false,
      reason: "Username TikTok manquant",
      customerStripeId: null,
    };
  }
  if (!email) {
    return {
      success: false,
      reason: "Email invalide",
      customerStripeId: null,
    };
  }

  let updated = await supabase
    .from("carts")
    .update({ customer_email: email } as any)
    .eq("store_id", storeId)
    .eq("customer_tiktok_username", tiktokUsername)
    .is("payment_id", null)
    .is("customer_stripe_id", null)
    .select("id")
    .limit(1);
  if (updated.error && isMissingColumnError(updated.error, "customer_tiktok_username")) {
    updated = await supabase
      .from("carts")
      .update({ customer_email: email } as any)
      .eq("store_id", storeId)
      .is("payment_id", null)
      .is("customer_stripe_id", null)
      .ilike("description", `%commande tiktok @${tiktokUsername}%`)
      .select("id")
      .limit(1);
  }
  if (updated.error) {
    return {
      success: false,
      reason: updated.error.message || "Impossible de lier l'email",
      customerStripeId: null,
    };
  }

  return {
    success: true,
    reason: "Email lié au username TikTok dans le panier",
    customerStripeId: null,
  };
}
