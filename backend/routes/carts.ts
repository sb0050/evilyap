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

async function deleteCartInternal(id: number, requireExpired?: boolean) {
  if (!id || typeof id !== "number") {
    return { success: false, error: "id requis pour la suppression" };
  }
  if (requireExpired) {
    const { data: rec, error: selErr } = await supabase
      .from("carts")
      .select("id,created_at,time_to_live")
      .eq("id", id)
      .single();
    if (selErr) {
      if ((selErr as any)?.code === "PGRST116") {
        return { success: false, error: "item_not_found" };
      }
      return { success: false, error: selErr.message };
    }
    const ttlMinutes = (rec as any)?.time_to_live ?? 5;
    const ttlMs = Number(ttlMinutes) * 60 * 1000;
    const createdMs = rec?.created_at
      ? new Date(rec.created_at as any).getTime()
      : null;
    const nowMs = Date.now();
    const leftMs = createdMs ? ttlMs - (nowMs - createdMs) : 0;
    if (leftMs > 0) {
      return { success: false, error: "not_expired" };
    }
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
      time_to_live,
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
      return res.status(409).json({
        error: "reference_exists",
        message: "Cette reference existe déjà dans un autre panier",
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
          time_to_live: typeof time_to_live === "number" ? time_to_live : 15,
          description: typeof description === "string" ? description : null,
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
        "id,store_id,product_reference,value,created_at,time_to_live,description"
      )
      .eq("customer_stripe_id", stripeId)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const rows = cartRows || [];
    const nowMs = Date.now();
    const expiredIds: number[] = [];
    const validRows: any[] = [];
    for (const r of rows as any[]) {
      const ttlMinutes =
        typeof (r as any).time_to_live === "number"
          ? (r as any).time_to_live
          : 15;
      const ttlMs = Number(ttlMinutes) * 60 * 1000;
      const createdMs = (r as any)?.created_at
        ? new Date((r as any).created_at as any).getTime()
        : null;
      const leftMs = createdMs ? ttlMs - (nowMs - createdMs) : 0;
      if (leftMs <= 0) {
        expiredIds.push((r as any).id as number);
      } else {
        validRows.push(r);
      }
    }
    if (expiredIds.length > 0) {
      await Promise.all(expiredIds.map((id) => deleteCartInternal(id, true)));
    }
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
        time_to_live: (r as any).time_to_live,
        description: (r as any).description,
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
    const { id, requireExpired } = (req.body || {}) as {
      id?: number;
      requireExpired?: boolean;
    };

    if (!id || typeof id !== "number") {
      return res.status(400).json({ error: "id requis pour la suppression" });
    }

    // Si on demande de vérifier l'expiration, contrôler TTL spécifique à l'item
    if (requireExpired) {
      const { data: rec, error: selErr } = await supabase
        .from("carts")
        .select("id,created_at,time_to_live")
        .eq("id", id)
        .single();
      if (selErr) {
        // PGRST116: not found
        if ((selErr as any)?.code === "PGRST116") {
          return res.status(404).json({ error: "item_not_found" });
        }
        return res.status(500).json({ error: selErr.message });
      }

      const ttlMinutes = (rec as any)?.time_to_live ?? 5;
      const ttlMs = Number(ttlMinutes) * 60 * 1000;
      const createdMs = rec?.created_at
        ? new Date(rec.created_at as any).getTime()
        : null;
      const nowMs = Date.now();
      const leftMs = createdMs ? ttlMs - (nowMs - createdMs) : 0; // si pas de created_at, considérer expiré
      if (leftMs > 0) {
        const expiresAt = createdMs
          ? new Date(createdMs + ttlMs).toISOString()
          : null;
        return res
          .status(409)
          .json({ error: "not_expired", timeLeftMs: leftMs, expiresAt });
      }
    }

    const result = await deleteCartInternal(id, requireExpired);
    if (!result.success) {
      if (result.error === "item_not_found") {
        return res.status(404).json({ error: "item_not_found" });
      }
      if (result.error === "not_expired") {
        return res.status(409).json({ error: "not_expired" });
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
        "id, store_id, customer_stripe_id, product_reference, value, created_at, time_to_live, description"
      )
      .eq("store_id", storeId)
      .order("id", { ascending: false });
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    const rows = carts || [];
    const nowMs = Date.now();
    const expiredIds: number[] = [];
    const validRows: any[] = [];
    for (const r of rows as any[]) {
      const ttlMinutes =
        typeof (r as any).time_to_live === "number"
          ? (r as any).time_to_live
          : 15;
      const ttlMs = Number(ttlMinutes) * 60 * 1000;
      const createdMs = (r as any)?.created_at
        ? new Date((r as any).created_at as any).getTime()
        : null;
      const leftMs = createdMs ? ttlMs - (nowMs - createdMs) : 0;
      if (leftMs <= 0) {
        expiredIds.push((r as any).id as number);
      } else {
        validRows.push(r);
      }
    }
    if (expiredIds.length > 0) {
      await Promise.all(expiredIds.map((id) => deleteCartInternal(id, true)));
    }
    return res.json({ carts: validRows || [] });
  } catch (e) {
    console.error("Error fetching store carts:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
