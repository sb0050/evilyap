import express from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getAuth } from "@clerk/express";
import { emailService } from "../services/emailService";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

router.post("/draw", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const participantIds = (req.body?.participantIds || []) as string[];
    const ids = Array.isArray(participantIds)
      ? participantIds.filter((v) => typeof v === "string" && v.trim())
      : [];
    if (ids.length < 2) {
      return res
        .status(400)
        .json({ error: "Au moins deux participants sont requis" });
    }

    const winnerIndex = crypto.randomInt(ids.length);
    const winnerId = ids[winnerIndex];

    let customer: Stripe.Customer | null = null;
    try {
      const c = await stripe.customers.retrieve(winnerId);
      if (c && !(c as any).deleted) {
        customer = c as Stripe.Customer;
      }
    } catch (e) {
      return res.status(404).json({ error: "Winner customer not found" });
    }

    if (!customer) {
      return res.status(404).json({ error: "Winner customer not found" });
    }

    const customerData = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      shipping: customer.shipping,
      deliveryMethod:
        (customer.metadata?.delivery_method as any) || undefined,
      parcelPointCode: (customer.metadata?.parcel_point as any) || undefined,
      deliveryNetwork:
        (customer.metadata?.delivery_network as any) || undefined,
      clerkUserId: (customer.metadata as any)?.clerk_id,
    } as any;

    return res.json({ winner: customerData });
  } catch (e) {
    console.error("Error in raffle draw:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/notify", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { email, name, storeSlug, storeName } = req.body || {};
    const to = (email || "").trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Email invalide" });
    }
    let finalStoreName =
      typeof storeName === "string" && storeName.trim()
        ? String(storeName).trim()
        : "Votre Boutique";
    let finalStoreLogo: string | undefined = undefined;
    if (supabase && typeof storeSlug === "string" && storeSlug.trim()) {
      try {
        const { data, error } = await supabase
          .from("stores")
          .select("id, name, slug")
          .eq("slug", String(storeSlug).trim())
          .single();
        if (!error && data?.name) {
          finalStoreName = data.name;
          const cloud = (process.env.CLOUDFRONT_URL || "").replace(/\/+$/, "");
          if ((data as any)?.id && cloud) {
            finalStoreLogo = `${cloud}/images/${(data as any).id}`;
          }
        }
      } catch {}
    }
    const sent = await emailService.sendRaffleWinnerCongrats({
      customerEmail: to,
      customerName: typeof name === "string" ? name : undefined,
      storeName: finalStoreName,
      storeLogo: finalStoreLogo,
    });
    if (!sent) {
      return res
        .status(500)
        .json({ error: "Erreur lors de l'envoi de l'email" });
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
