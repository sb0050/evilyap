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
      quantity,
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
          quantity:
            typeof quantity === "number" &&
            Number.isFinite(quantity) &&
            quantity > 0
              ? quantity
              : 1,
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
        "id,store_id,product_reference,value,quantity,created_at,description,status"
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
        quantity?: number;
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
        quantity: (r as any).quantity ?? 1,
        created_at: (r as any).created_at,
        description: (r as any).description,
      });
      const qty = Number((r as any).quantity ?? 1);
      grouped[key].total += (r.value || 0) * (Number.isFinite(qty) ? qty : 1);
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
        "id,store_id,product_reference,value,quantity,created_at,description,status"
      )
      .single();
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
    const { data: carts, error } = await supabase
      .from("carts")
      .select(
        "id, store_id, customer_stripe_id, product_reference, value, quantity, created_at, description, status"
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

export default router;
