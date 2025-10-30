import express from "express";
import { createClient } from "@supabase/supabase-js";
const { requireAuth } = require("../middleware/auth");
import { clerkClient } from "@clerk/clerk-sdk-node";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase credentials are not set in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// GET /api/shipments/customer?stripeId=<id>&storeSlug=<slug?>
router.get("/customer", requireAuth, async (req, res) => {
  try {
    const storeSlug = (req.query.storeSlug as string) || null;
    const stripeId = (req.query.stripeId as string) || "";

    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    let storeFilterId: number | null = null;

    if (storeSlug) {
      const { data: store, error: storeErr } = await supabase
        .from("stores")
        .select("id,name,slug")
        .eq("slug", storeSlug)
        .single();
      if (storeErr) {
        return res.status(500).json({ error: storeErr.message });
      }
      storeFilterId = store?.id ?? null;
    }

    const baseQuery = supabase
      .from("shipments")
      .select(
        "id, store_id, customer_stripe_id, shipment_id, document_created, delivery_method, delivery_network, dropoff_point, pickup_point, weight, product_reference, value, created_at, status, estimated_delivery_date, cancel_requested, return_requested, delivery_cost, tracking_url"
      )
      .eq("customer_stripe_id", stripeId)
      .order("id", { ascending: false });

    const { data, error } =
      storeFilterId !== null
        ? await baseQuery.eq("store_id", storeFilterId)
        : await baseQuery;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const storeIds = Array.from(
      new Set((data || []).map((d: any) => d.store_id).filter(Boolean))
    );

    let storesMap: Record<number, { name: string; slug: string }> = {};
    if (storeIds.length > 0) {
      const { data: storesData, error: storesError } = await supabase
        .from("stores")
        .select("id,name,slug")
        .in("id", storeIds);
      if (storesError) {
        return res.status(500).json({ error: storesError.message });
      }
      storesMap = (storesData || []).reduce(
        (acc: Record<number, { name: string; slug: string }>, s: any) => {
          acc[s.id] = { name: s.name, slug: s.slug };
          return acc;
        },
        {}
      );
    }

    const result = (data || []).map((rec: any) => ({
      ...rec,
      store: rec.store_id ? storesMap[rec.store_id] || null : null,
    }));

    return res.json({ shipments: result });
  } catch (e) {
    console.error("Error fetching shipments:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/shipments/stores-for-customer/:stripeId
router.get("/stores-for-customer/:stripeId", requireAuth, async (req, res) => {
  try {
    const stripeId = req.params.stripeId;
    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    const { data, error } = await supabase
      .from("shipments")
      .select("store_id")
      .eq("customer_stripe_id", stripeId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const storeIds = Array.from(
      new Set((data || []).map((d: any) => d.store_id).filter(Boolean))
    );

    if (storeIds.length === 0) {
      return res.json({ slugs: [] });
    }

    const { data: stores, error: storesErr } = await supabase
      .from("stores")
      .select("id,slug")
      .in("id", storeIds);

    if (storesErr) {
      return res.status(500).json({ error: storesErr.message });
    }

    const slugs = (stores || []).map((s: any) => s.slug).filter(Boolean);
    return res.json({ slugs });
  } catch (e) {
    console.error("Error fetching stores for customer:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/shipments/store/:storeSlug - list shipments for a store (owner/admin only)
router.get("/store/:storeSlug", requireAuth, async (req, res) => {
  try {
    const storeSlug = req.params.storeSlug;
    if (!storeSlug) {
      return res.status(400).json({ error: "Missing storeSlug" });
    }

    const decoded = decodeURIComponent(storeSlug);
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id,slug,name,clerk_id")
      .eq("slug", decoded)
      .single();

    if (storeErr) {
      if ((storeErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "La boutique n'existe pas" });
      }
      return res.status(500).json({ error: storeErr.message });
    }

    const requesterId = (req as any)?.auth?.userId || null;
    if (!requesterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let isAdmin = false;
    try {
      const user = await clerkClient.users.getUser(requesterId);
      const role = (user?.publicMetadata as any)?.role;
      isAdmin = role === "admin";
    } catch (_e) {
      // default is not admin
    }

    const isOwner = store?.clerk_id && store.clerk_id === requesterId;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const { data: shipments, error: shipErr } = await supabase
      .from("shipments")
      .select(
        "id, store_id, customer_stripe_id, shipment_id, document_created, delivery_method, delivery_network, dropoff_point, pickup_point, weight, product_reference, value, created_at, status, estimated_delivery_date, cancel_requested, return_requested, delivery_cost, tracking_url"
      )
      .eq("store_id", store.id)
      .order("id", { ascending: false });

    if (shipErr) {
      return res.status(500).json({ error: shipErr.message });
    }

    return res.json({
      shipments,
      store: { id: store.id, name: store.name, slug: store.slug },
    });
  } catch (e) {
    console.error("Error fetching store shipments:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
