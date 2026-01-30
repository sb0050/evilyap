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

function getSuggestedWeightFromItemCount(itemCount: number): string {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return "500g";
  if (itemCount <= 1) return "500g";
  if (itemCount <= 3) return "1kg";
  return "2kg";
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
      description,
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

    const { data, error } = await supabase
      .from("carts")
      .insert([
        {
          store_id,
          product_reference,
          value: typeof value === "number" ? value : 0,
          customer_stripe_id,
          description: typeof description === "string" ? description : null,
          status: "PENDING",
          // Horodatage de création côté serveur (timestamptz)
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

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
    if (!stripeId) {
      return res.status(400).json({ error: "stripeId requis" });
    }

    const { data: cartRows, error } = await supabase
      .from("carts")
      .select(
        "id,store_id,product_reference,value,created_at,description,status,recap_sent_at"
      )
      .eq("customer_stripe_id", stripeId)
      .eq("status", "PENDING")
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const validRows = cartRows || [];
    const storeIds = Array.from(
      new Set(validRows.map((r: any) => r.store_id).filter(Boolean))
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
          s: any
        ) => {
          acc[s.id] = { id: s.id, name: s.name, slug: s.slug };
          return acc;
        },
        {}
      );
    }

    const itemsByStore: Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      suggestedWeight: string;
      items: Array<{
        id: number;
        product_reference: string;
        value: number;
        created_at?: string;
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
      grouped[key].items.push({
        id: r.id,
        product_reference: r.product_reference,
        value: r.value,
        created_at: (r as any).created_at,
        description: (r as any).description,
        recap_sent_at: (r as any).recap_sent_at,
      });
      grouped[key].total += r.value || 0;
    }

    let grandTotal = 0;
    for (const k of Object.keys(grouped)) {
      const suggestedWeight = getSuggestedWeightFromItemCount(
        Array.isArray(grouped[k].items) ? grouped[k].items.length : 0
      );
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
    const { data: carts, error } = await supabase
      .from("carts")
      .select(
      "id, store_id, customer_stripe_id, product_reference, value, created_at, description, status, recap_sent_at"
      )
      .eq("store_id", storeId)
      .eq("status", "PENDING")
      .order("id", { ascending: false });
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
      storeSlug
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
    const { data: carts, error } = await supabase
        .from("carts")
      .select("id, product_reference, value, description")
        .eq("customer_stripe_id", stripeId)
        .eq("store_id", storeId)
        .eq("status", "PENDING");
      if (error) continue;
    const items = (carts || []).map((c: any) => ({
        product_reference: String(c.product_reference || ""),
        value: Number(c.value || 0),
        description: typeof c.description === "string" ? c.description : "",
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
        sentStripeIds.push(stripeId);
      const nowIso = new Date().toISOString();
      await supabase
        .from("carts")
        .update({ recap_sent_at: nowIso })
        .eq("customer_stripe_id", stripeId)
        .eq("store_id", storeId)
        .eq("status", "PENDING");
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
