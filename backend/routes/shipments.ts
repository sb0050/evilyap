import express from "express";
import { createClient } from "@supabase/supabase-js";
import { clerkClient, getAuth } from "@clerk/express";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase credentials are not set in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// GET /api/shipments/customer?stripeId=<id>
router.get("/customer", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const stripeId = (req.query.stripeId as string) || "";

    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    const { data, error } = await supabase
      .from("shipments")
      .select(
        "id, store_id, customer_stripe_id, shipment_id, document_created, delivery_method, delivery_network, dropoff_point, pickup_point, weight, product_reference, value, reference_value, created_at, status, estimated_delivery_date, cancel_requested, return_requested, is_final_destination, delivery_cost, tracking_url"
      )
      .eq("customer_stripe_id", stripeId)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const storeIds = Array.from(
      new Set((data || []).map((d: any) => d.store_id).filter(Boolean))
    );

    let storesMap: Record<
      number,
      {
        name: string;
        slug: string;
        description?: string | null;
        address?: any | null;
        website?: string | null;
        owner_email?: string | null;
      }
    > = {};
    if (storeIds.length > 0) {
      const { data: storesData, error: storesError } = await supabase
        .from("stores")
        .select("id,name,slug, description, address, website, owner_email")
        .in("id", storeIds);
      if (storesError) {
        return res.status(500).json({ error: storesError.message });
      }
      storesMap = (storesData || []).reduce(
        (
          acc: Record<
            number,
            {
              name: string;
              slug: string;
              description?: string | null;
              address?: any | null;
              website?: string | null;
              owner_email?: string | null;
            }
          >,
          s: any
        ) => {
          acc[s.id] = {
            name: s.name,
            slug: s.slug,
            description: s.description ?? null,
            address: s.address ?? null,
            website: s.website ?? null,
            owner_email: s.owner_email ?? null,
          };
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
router.get("/stores-for-customer/:stripeId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const stripeId = req.params.stripeId;
    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    console.log("Fetching stores for customer with stripeId:", stripeId);

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
router.get("/store/:storeSlug", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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

    const requesterId = auth.userId || null;
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
      return res.status(403).json({ error: "Accès refusé !" });
    }

    const { data: shipments, error: shipErr } = await supabase
      .from("shipments")
      .select(
        "id, store_id, customer_stripe_id, shipment_id, document_created, delivery_method, delivery_network, dropoff_point, pickup_point, weight, product_reference, value, reference_value, created_at, status, estimated_delivery_date, cancel_requested, return_requested, is_final_destination, delivery_cost, tracking_url"
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
