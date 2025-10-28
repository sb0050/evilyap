import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}
const supabase = createClient(supabaseUrl, supabaseKey);

// POST /api/carts - Add item to cart
router.post("/", async (req, res) => {
  try {
    const {
      store_id,
      product_reference,
      value,
      customer_stripe_id,
    } = req.body || {};

    if (!customer_stripe_id) {
      return res
        .status(400)
        .json({ error: "customer_stripe_id requis pour le panier" });
    }
    if (!store_id || !product_reference || typeof value !== "number") {
      return res.status(400).json({
        error:
          "store_id, product_reference et value (number) sont requis pour ajouter au panier",
      });
    }

    // Unicité: le couple (customer_stripe_id, product_reference, store_id) ne doit pas exister
    let existQuery = supabase
      .from("carts")
      .select("id")
      .eq("customer_stripe_id", customer_stripe_id)
      .eq("product_reference", product_reference);
    if (store_id === null) {
      existQuery = existQuery.is("store_id", null as any);
    } else {
      existQuery = existQuery.eq("store_id", store_id);
    }
    const { data: existing, error: existErr } = await existQuery.maybeSingle();
    if (existErr && (existErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: existErr.message });
    }
    if (existing) {
      return res
        .status(409)
        .json({ error: "reference_exists", message: "Cette reference existe déjà dans un autre panier" });
    }

    const { data, error } = await supabase
      .from("carts")
      .insert([
        {
          store_id,
          product_reference,
          value,
          customer_stripe_id,
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
      .select("id,store_id,product_reference,value")
      .eq("customer_stripe_id", stripeId)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const rows = cartRows || [];
    const storeIds = Array.from(
      new Set(rows.map((r: any) => r.store_id).filter(Boolean))
    );

    let storesMap: Record<number, { id: number; name: string; slug: string }> = {};
    if (storeIds.length > 0) {
      const { data: storesData, error: storesErr } = await supabase
        .from("stores")
        .select("id,name,slug")
        .in("id", storeIds);
      if (storesErr) {
        return res.status(500).json({ error: storesErr.message });
      }
      storesMap = (storesData || []).reduce(
        (acc: Record<number, { id: number; name: string; slug: string }>, s: any) => {
          acc[s.id] = { id: s.id, name: s.name, slug: s.slug };
          return acc;
        },
        {}
      );
    }

    const itemsByStore: Array<{
      store: { id: number; name: string; slug: string } | null;
      total: number;
      items: Array<{ id: number; product_reference: string; value: number }>;
    }> = [];

    const grouped: Record<string, { total: number; items: any[]; store: any }> = {};
    for (const r of rows) {
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
      });
      grouped[key].total += r.value || 0;
    }

    let grandTotal = 0;
    for (const k of Object.keys(grouped)) {
      itemsByStore.push({
        store: grouped[k].store,
        total: grouped[k].total,
        items: grouped[k].items,
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
    const { id } = (req.body || {}) as { id?: number };

    if (!id || typeof id !== "number") {
      return res.status(400).json({ error: "id requis pour la suppression" });
    }

    const { error } = await supabase.from("carts").delete().eq("id", id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("Error deleting from cart:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;