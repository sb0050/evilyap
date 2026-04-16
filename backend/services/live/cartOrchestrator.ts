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

function pickMostFrequentStripeCustomerId(rows: any[]): string | null {
  const counts = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String((row as any)?.customer_stripe_id || "").trim();
    if (!/^cus_[a-zA-Z0-9]+$/.test(id)) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestId = "";
  let bestCount = -1;
  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId || null;
}

async function findExistingStripeCustomerByTikTokMetadata(input: {
  tiktokUsername: string;
  storeId: number;
}): Promise<string | null> {
  const username = normalizeTikTokUsername(input.tiktokUsername);
  const storeId = Number(input.storeId);
  if (!username || !Number.isFinite(storeId) || storeId <= 0) return null;

  const isStripeCustomerId = (value: unknown): boolean =>
    /^cus_[a-zA-Z0-9]+$/.test(String(value || "").trim());

  // Chemin principal: search API (rapide, ciblé).
  try {
    const search = await (stripe.customers as any).search({
      query: `metadata['tiktok_username']:'${username}' AND metadata['store_id']:'${String(
        storeId,
      )}'`,
      limit: 10,
    });
    const data = Array.isArray((search as any)?.data) ? (search as any).data : [];
    const withEmail = data.find((c: any) => String(c?.email || "").trim());
    const candidate = withEmail || data[0];
    const candidateId = String(candidate?.id || "").trim();
    if (isStripeCustomerId(candidateId)) return candidateId;
  } catch {
    // Fallback paginé ci-dessous.
  }

  // Fallback robuste: parcours paginé des customers pour matcher metadata.
  // Pourquoi: certaines configs Stripe n'activent pas `customers.search`.
  try {
    const maxScanned = 3000;
    let scanned = 0;
    let startingAfter: string | undefined = undefined;
    let bestWithEmail: string | null = null;
    let bestAny: string | null = null;
    while (scanned < maxScanned) {
      const page = await stripe.customers.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      } as any);
      const items = Array.isArray(page.data) ? page.data : [];
      if (items.length === 0) break;
      scanned += items.length;
      for (const customer of items as any[]) {
        const mdUsername = normalizeTikTokUsername(customer?.metadata?.tiktok_username || "");
        const mdStoreId = String(customer?.metadata?.store_id || "").trim();
        if (mdUsername !== username || mdStoreId !== String(storeId)) continue;
        const cid = String(customer?.id || "").trim();
        if (!isStripeCustomerId(cid)) continue;
        if (String(customer?.email || "").trim()) {
          bestWithEmail = cid;
          break;
        }
        if (!bestAny) bestAny = cid;
      }
      if (bestWithEmail) return bestWithEmail;
      if (!page.has_more) break;
      const last = items[items.length - 1] as any;
      startingAfter = String(last?.id || "").trim() || undefined;
      if (!startingAfter) break;
    }
    return bestWithEmail || bestAny;
  } catch {
    return null;
  }
}

/**
 * Résout un customer Stripe existant à partir d'un email.
 *
 * Pourquoi cette stratégie:
 * - l'email est la clé d'identité la plus stable côté checkout,
 * - on veut éviter de fragmenter un même client en plusieurs customers Stripe.
 *
 * La sélection préfère un customer dont les metadata correspondent déjà au
 * couple (username TikTok, store), puis retombe sur le premier customer valide
 * trouvé pour cet email.
 */
async function findExistingStripeCustomerByEmail(input: {
  email: string;
  tiktokUsername?: string;
  storeId?: number;
}): Promise<string | null> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = normalizeTikTokUsername(input.tiktokUsername || "");
  const storeId = Number(input.storeId);
  if (!normalizedEmail) return null;

  const isStripeCustomerId = (value: unknown): boolean =>
    /^cus_[a-zA-Z0-9]+$/.test(String(value || "").trim());

  try {
    const listed = await stripe.customers.list({
      email: normalizedEmail,
      limit: 100,
    });
    const customers = Array.isArray(listed.data) ? listed.data : [];
    if (customers.length === 0) return null;

    let bestId: string | null = null;
    let bestScore = -1;
    for (const customer of customers as any[]) {
      const customerId = String(customer?.id || "").trim();
      if (!isStripeCustomerId(customerId)) continue;
      const customerEmail = String(customer?.email || "").trim().toLowerCase();
      if (customerEmail !== normalizedEmail) continue;

      const mdTikTok = normalizeTikTokUsername(customer?.metadata?.tiktok_username || "");
      const mdStoreId = String(customer?.metadata?.store_id || "").trim();
      let score = 1;
      if (normalizedUsername && mdTikTok === normalizedUsername) score += 3;
      if (Number.isFinite(storeId) && storeId > 0 && mdStoreId === String(storeId)) {
        score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = customerId;
      }
    }
    return bestId;
  } catch {
    return null;
  }
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
  storeId: number,
  tiktokUsername: string,
  customerEmail?: string | null,
): Promise<string | null> {
  const normalizedUsername = normalizeTikTokUsername(tiktokUsername);
  const normalizedEmail = normalizeEmail(customerEmail);
  const safeStoreId = Number(storeId);
  if (!normalizedUsername || !Number.isFinite(safeStoreId) || safeStoreId <= 0) {
    return null;
  }
  const isStripeCustomerId = (value: unknown): boolean =>
    /^cus_[a-zA-Z0-9]+$/.test(String(value || "").trim());

  // Règle principale:
  // si un email est fourni et qu'il pointe déjà vers un customer Stripe,
  // on réutilise systématiquement ce customer pour éviter les doublons.
  if (normalizedEmail) {
    const existingByEmail = await findExistingStripeCustomerByEmail({
      email: normalizedEmail,
      tiktokUsername: normalizedUsername,
      storeId: safeStoreId,
    });
    if (existingByEmail && isStripeCustomerId(existingByEmail)) {
      return existingByEmail;
    }
  }

  // Si un customer Stripe réel existe déjà pour ce client dans ce store, on le réutilise.
  {
    let byUsername = await supabase
      .from("carts")
      .select("customer_stripe_id")
      .eq("store_id", safeStoreId)
      .eq("customer_tiktok_username", normalizedUsername)
      .not("customer_stripe_id", "is", null)
      .order("id", { ascending: false })
      .limit(200);
    if (byUsername.error && isMissingColumnError(byUsername.error, "customer_tiktok_username")) {
      byUsername = await supabase
        .from("carts")
        .select("customer_stripe_id")
        .eq("store_id", safeStoreId)
        .not("customer_stripe_id", "is", null)
        .ilike("description", `%commande tiktok @${normalizedUsername}%`)
        .order("id", { ascending: false })
        .limit(200);
    }
    if (!byUsername.error && Array.isArray(byUsername.data) && byUsername.data.length > 0) {
      const existingId = pickMostFrequentStripeCustomerId(byUsername.data as any[]);
      if (existingId && isStripeCustomerId(existingId)) return existingId;
    }
  }

  // On tente aussi par email lorsque disponible pour éviter de fragmenter les historiques.
  // NOTE:
  // `customer_email` n'est plus utilisé dans la table `carts`.
  // On conserve la corrélation email uniquement côté Stripe (liste customers).

  const existingByMetadata = await findExistingStripeCustomerByTikTokMetadata({
    tiktokUsername: normalizedUsername,
    storeId: safeStoreId,
  });
  if (existingByMetadata && isStripeCustomerId(existingByMetadata)) {
    // Si on récupère un customer TikTok existant et qu'on dispose d'un email,
    // on tente de le compléter pour converger vers une identité Stripe unifiée.
    if (normalizedEmail) {
      try {
        const existingCustomer = await stripe.customers.retrieve(existingByMetadata);
        const currentEmail = normalizeEmail((existingCustomer as any)?.email || null);
        if (!currentEmail) {
          await stripe.customers.update(existingByMetadata, { email: normalizedEmail });
        }
      } catch {
        // Best effort: un échec de patch email ne doit pas bloquer la commande live.
      }
    }
    return existingByMetadata;
  }

  // Création d'un customer Stripe réel pour garantir customer_stripe_id non-null et exploitable.
  try {
    const created = await stripe.customers.create({
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      name: `@${normalizedUsername}`,
      metadata: {
        source: "tiktok_live",
        tiktok_username: normalizedUsername,
        store_id: String(safeStoreId),
      },
    }, {
      // Idempotency déterministe pour réduire les doublons en cas d'appels concurrents.
      idempotencyKey: `live_customer_${safeStoreId}_${normalizedUsername}`,
    } as any);
    const createdId = String(created?.id || "").trim();
    if (isStripeCustomerId(createdId)) return createdId;
  } catch {
    // Si Stripe échoue, on retourne null pour bloquer l'écriture invalide.
  }

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

  // Fallback robuste mais strict:
  // - on accepte les variantes de saisie courantes (espaces, accents, I/1, O/0),
  // - mais on refuse les correspondances "contains" trop larges qui peuvent ajouter
  //   un mauvais article quand le client envoie une référence invalide.
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

  const customerStripeId = await resolveOrCreateStripeCustomerId(
    storeId,
    tiktokUsername,
    customerEmail,
  );
  if (!customerStripeId) {
    return {
      success: false,
      reason: "Impossible de résoudre customer_stripe_id",
      cartId: null,
      customerStripeId: null,
    };
  }

  // Backfill opportuniste:
  // si des lignes legacy existent encore avec customer_stripe_id NULL pour ce
  // username TikTok, on les remet à niveau pour conserver un regroupement cohérent.
  {
    let backfill = await supabase
      .from("carts")
      .update({ customer_stripe_id: customerStripeId } as any)
      .eq("store_id", storeId)
      .eq("customer_tiktok_username", tiktokUsername)
      .is("payment_id", null)
      .is("customer_stripe_id", null);
    if (backfill.error && isMissingColumnError(backfill.error, "customer_tiktok_username")) {
      backfill = await supabase
        .from("carts")
        .update({ customer_stripe_id: customerStripeId } as any)
        .eq("store_id", storeId)
        .is("payment_id", null)
        .is("customer_stripe_id", null)
        .ilike("description", `%commande tiktok @${tiktokUsername}%`);
    }
    // Best effort: un échec de backfill ne doit pas bloquer l'ajout en cours.
  }

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
      .eq("customer_stripe_id", customerStripeId)
      .limit(1);
    if (existing.error) {
      return {
        success: false,
        reason: existing.error.message || "Erreur lecture panier live",
        cartId: null,
        customerStripeId,
      };
    }
    if (!Array.isArray(existing.data) || existing.data.length === 0) {
      // Compatibilité historique: anciennes lignes créées avec customer_stripe_id null.
      existing = await supabase
        .from("carts")
        .select("id,quantity,description")
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
          reason: existing.error.message || "Erreur lecture panier live (legacy)",
          cartId: null,
          customerStripeId,
        };
      }
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
        customer_stripe_id: customerStripeId,
        customer_tiktok_username: tiktokUsername,
      } as any)
      .eq("id", existingRow.id)
      .select("id")
      .single();
    if (upd.error && isMissingColumnError(upd.error, "customer_tiktok_username")) {
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
        created_at: new Date().toISOString(),
      } as any,
    ])
    .select("id")
    .single();
  if (insert.error && isMissingColumnError(insert.error, "customer_tiktok_username")) {
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
 * en forçant `customer_stripe_id` pour ce username.
 *
 * Pourquoi ce point d'entrée:
 * - le panier live est indexé par customer_stripe_id,
 * - la clé de rapprochement côté live est le username TikTok.
 * L'email est résolu côté Stripe (customer.email), pas via une colonne SQL dédiée.
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

  const customerStripeId = await resolveOrCreateStripeCustomerId(
    storeId,
    tiktokUsername,
    email,
  );
  if (!customerStripeId) {
    return {
      success: false,
      reason: "Impossible de résoudre customer_stripe_id",
      customerStripeId: null,
    };
  }

  let updated = await supabase
    .from("carts")
    .update({
      customer_stripe_id: customerStripeId,
    } as any)
    .eq("store_id", storeId)
    .eq("customer_tiktok_username", tiktokUsername)
    .is("payment_id", null)
    .select("id")
    .limit(1);
  if (updated.error && isMissingColumnError(updated.error, "customer_tiktok_username")) {
    updated = await supabase
      .from("carts")
      .update({
        customer_stripe_id: customerStripeId,
      } as any)
      .eq("store_id", storeId)
      .is("payment_id", null)
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
    customerStripeId,
  };
}
