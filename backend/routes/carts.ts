import express from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { emailService } from "../services/emailService";
import { getAuth } from "@clerk/express";

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
    if (!stripeId) {
      return res.status(400).json({ error: "stripeId requis" });
    }
    if (paymentId && /[,()]/.test(paymentId)) {
      return res.status(400).json({ error: "paymentId invalide" });
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
    const cartsSelectWithWeight =
      "id, store_id, customer_stripe_id, product_reference, value, quantity, created_at, description, recap_sent_at, weight";
    const cartsSelectWithoutWeight =
      "id, store_id, customer_stripe_id, product_reference, value, quantity, created_at, description, recap_sent_at";

    let carts: any[] | null = null;
    let error: any = null;
    {
      const resp = await supabase
        .from("carts")
        .select(cartsSelectWithWeight)
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      carts = resp.data as any;
      error = resp.error;
    }
    if (error && isMissingColumnError(error, "weight")) {
      const resp2 = await supabase
        .from("carts")
        .select(cartsSelectWithoutWeight)
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      carts = resp2.data as any;
      error = resp2.error;
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
    const { stripeIds, storeSlug } = req.body || {};
    if (!Array.isArray(stripeIds) || stripeIds.length === 0) {
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
    const checkoutLink = `${frontendUrl}/checkout/${encodeURIComponent(
      storeSlug,
    )}`;
    const sentStripeIds: string[] = [];
    const failedStripeIds: string[] = [];
    for (const sid of stripeIds) {
      const stripeId = String(sid || "");
      if (!stripeId) continue;
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
      {
        const resp = await supabase
          .from("carts")
          .select("id, product_reference, value, description, quantity")
          .eq("customer_stripe_id", stripeId)
          .eq("store_id", storeId);
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
        const updResp = await supabase
          .from("carts")
          .update({ recap_sent_at: nowIso })
          .eq("customer_stripe_id", stripeId)
          .eq("store_id", storeId);
        if (updResp.error) {
          failedStripeIds.push(stripeId);
        } else {
          sentStripeIds.push(stripeId);
        }
      } else {
        failedStripeIds.push(stripeId);
      }
    }
    return res.json({ success: true, sentStripeIds, failedStripeIds });
  } catch (e) {
    console.error("Error sending recap:", e);
    return res
      .status(500)
      .json({ error: "Erreur lors de l'envoi du récapitulatif" });
  }
});

export default router;
