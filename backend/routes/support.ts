import express from "express";
import { createClient } from "@supabase/supabase-js";
import { clerkClient } from "@clerk/clerk-sdk-node";
const { requireAuth } = require("../middleware/auth");
import { emailService } from "../services/emailService";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase credentials are not set in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// POST /api/support/contact - Store owner sends a support message to admin
router.post("/contact", requireAuth, async (req, res) => {
  try {
    const { storeSlug, message } = req.body as {
      storeSlug?: string;
      message?: string;
    };

    const requesterId = (req as any)?.auth?.userId || null;
    if (!requesterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const msg = (message || "").trim();
    if (!msg) {
      return res.status(400).json({ error: "Message requis" });
    }

    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }

    const decodedSlug = decodeURIComponent(storeSlug);
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id, name, slug, owner_email, clerk_id")
      .eq("slug", decodedSlug)
      .maybeSingle();

    if (storeErr) {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!store) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    let isAdmin = false;
    try {
      const user = await clerkClient.users.getUser(requesterId);
      const role = (user?.publicMetadata as any)?.role;
      isAdmin = role === "admin";
    } catch (_e) {
      // default false
    }

    const isOwner =
      (store as any)?.clerk_id && (store as any).clerk_id === requesterId;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "Accès refusé !" });
    }

    try {
      await emailService.sendAdminSupportMessage({
        storeName: (store as any)?.name || "Votre Boutique",
        storeSlug: (store as any)?.slug || decodedSlug,
        ownerEmail: (store as any)?.owner_email || undefined,
        clerkUserId: requesterId || undefined,
        message: msg,
      });
    } catch (emailErr) {
      console.error("Erreur envoi email support:", emailErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de l'envoi de l'email de support" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Erreur serveur (support contact):", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
