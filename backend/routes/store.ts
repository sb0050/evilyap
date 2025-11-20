import express from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { emailService } from "../services/emailService";
import { isValidIBAN, isValidBIC } from "ibantools";
import slugify from "slugify";
import { clerkClient } from "@clerk/express";

const router = express.Router();

// Configuration Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: validation website (TLD domain or full URL with TLD)
const isValidWebsite = (url?: string | null) => {
  const value = (url || "").trim();
  if (!value) return true; // facultatif
  const domainOnlyRegex = /^(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;
  if (domainOnlyRegex.test(value)) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname || "";
    const hasTld = /\.[a-zA-Z]{2,}$/.test(host);
    return hasTld;
  } catch {
    return false;
  }
};

// GET /api/stores - Récupérer tous les stores
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase.from("stores").select("*");

    if (error) {
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération des stores" });
    }

    return res.json(data || []);
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/stores/exists?slug=... - Vérifier l'existence d'un slug
router.get("/exists", async (req, res) => {
  try {
    const raw = (req.query.slug as string) || (req.query.name as string) || "";
    if (!raw.trim()) {
      return res.status(400).json({ error: "Slug ou nom requis" });
    }

    const candidate = slugify(raw, { lower: true, strict: true });

    const { data, error } = await supabase
      .from("stores")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error && (error as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du slug" });
    }

    if (data) {
      return res.json({ exists: true });
    }
    return res.json({ exists: false, slug: candidate });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/stores/check-owner/:email - Vérifier si un email existe comme propriétaire
router.get("/check-owner/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ error: "Email requis" });
    }

    const { data, error } = await supabase
      .from("stores")
      .select("name, owner_email, slug, rib")
      .eq("owner_email", email)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // Aucun résultat trouvé
        return res.json({ exists: false });
      }
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification de l'email" });
    }

    return res.json({
      exists: true,
      storeName: data.name,
      ownerEmail: data.owner_email,
      slug: (data as any)?.slug,
      rib: (data as any)?.rib || null,
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// Nouvelle route: GET /api/stores/wallet-balance?ownerEmail=...
router.get("/wallet-balance", async (req, res) => {
  try {
    const ownerEmail = (req.query.ownerEmail as string) || "";
    if (!ownerEmail) {
      return res.status(400).json({ error: "ownerEmail requis" });
    }

    // Placeholder: à remplacer par une vraie logique de calcul
    // Exemple: agrégation de paiements Stripe ou table des commandes
    const availableBalance = 0;

    return res.json({ success: true, balance: availableBalance });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/stores - Créer une nouvelle boutique
router.post("/", async (req, res) => {
  try {
    const {
      storeName,
      storeDescription,
      ownerEmail,
      slug,
      clerkUserId,
      name,
      phone,
      address,
      website,
      siret,
      is_verified,
      stripeCustomerId,
    } = req.body;

    if (!storeName || !ownerEmail) {
      return res.status(400).json({ error: "Nom de boutique et email requis" });
    }

    // Vérifier si l'email a déjà une boutique
    const { data: existingStore } = await supabase
      .from("stores")
      .select("id")
      .eq("owner_email", ownerEmail)
      .single();

    if (existingStore) {
      return res.status(409).json({ error: "Cet email a déjà une boutique" });
    }

    // Vérifier l'unicité par slug
    if (!slug) {
      return res.status(400).json({ error: "Slug requis" });
    }
    const { data: existingBySlug, error: slugCheckError } = await supabase
      .from("stores")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (slugCheckError && slugCheckError.code !== "PGRST116") {
      console.error("Erreur Supabase (vérif slug):", slugCheckError);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du slug" });
    }

    if (existingBySlug) {
      return res.status(409).json({ error: "Ce nom de boutique existe déjà" });
    }

    // Construire l'adresse JSON attendue
    const addressJson =
      address && typeof address === "object"
        ? {
            city: address.city || null,
            line1: address.line1 || null,
            country: address.country || null,
            postal_code: address.postal_code || null,
            phone: phone || null,
          }
        : null;

    const { data, error } = await supabase
      .from("stores")
      .insert([
        {
          name: storeName,
          slug: slug,
          description: storeDescription || "",
          owner_email: ownerEmail,
          stripe_id: stripeCustomerId,
          address: addressJson,
          website: website || null,
          clerk_id: clerkUserId || null,
          siret: siret || null,
          is_verified: is_verified === true ? true : false,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la création de la boutique" });
    }

    // Mettre à jour le rôle Clerk en "owner" après la création du store
    if (clerkUserId) {
      try {
        await clerkClient.users.updateUserMetadata(clerkUserId, {
          publicMetadata: { role: "owner" },
        });
      } catch (e) {
        console.error("Erreur mise à jour du rôle Clerk:", e);
      }
    }

    return res.status(201).json({
      success: true,
      store: data,
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// PUT /api/stores/:storeSlug - Mettre à jour nom/description/website
// PUT /api/stores/:storeSlug - Mettre à jour nom/description/website/siret et éventuellement is_verified
router.put("/:storeSlug", async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    const { name, description, website, siret, is_verified, address, phone } = req.body as {
      name?: string;
      description?: string;
      website?: string;
      siret?: string;
      is_verified?: boolean;
      address?: any;
      phone?: string;
    };

    if (!storeSlug)
      return res.status(400).json({ error: "Slug de boutique requis" });
    const decodedSlug = decodeURIComponent(storeSlug);

    // Validation website (facultatif, mais si présent doit être valide)
    if (website && !isValidWebsite(website)) {
      return res.status(400).json({
        error:
          "Site web invalide: fournir un domaine avec TLD ou une URL complète",
      });
    }

    const { data: existing, error: getErr } = await supabase
      .from("stores")
      .select("id, name, slug")
      .eq("slug", decodedSlug)
      .maybeSingle();

    if (getErr && (getErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store):", getErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!existing) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    const payload: any = {};
    if (typeof name === "string") payload.name = name;
    if (typeof description === "string") payload.description = description;
    if (typeof website === "string") payload.website = website || null;
    if (typeof siret === "string") payload.siret = siret || null;
    // Autoriser uniquement l'upgrade de vérification côté serveur
    if (is_verified === true) {
      payload.is_verified = true;
    }

    // Mise à jour de l'adresse JSONB si fournie
    if (address && typeof address === "object") {
      const addressJson = {
        city: address.city || null,
        line1: address.line1 || null,
        country: address.country || null,
        postal_code: address.postal_code || null,
        phone: (typeof phone === "string" ? phone : null) || null,
      };
      payload.address = addressJson;
    } else if (typeof phone === "string") {
      // Permettre la mise à jour du téléphone seul dans l'adresse existante
      const { data: existingStore, error: getAddressErr } = await supabase
        .from("stores")
        .select("address")
        .eq("slug", decodedSlug)
        .maybeSingle();
      if (!getAddressErr && existingStore && (existingStore as any)?.address) {
        const current = (existingStore as any).address || {};
        payload.address = {
          city: current.city || null,
          line1: current.line1 || null,
          country: current.country || null,
          postal_code: current.postal_code || null,
          phone: phone || null,
        };
      }
    }

    // Si le nom change, recalculer le slug côté backend et vérifier l'unicité
    if (typeof name === "string") {
      const newName = (name || "").trim();
      const currentName = ((existing as any)?.name || "").trim();
      if (newName && newName !== currentName) {
        const newSlug = slugify(newName, { lower: true, strict: true });
        // Vérifier unicité du nouveau slug, en excluant la boutique actuelle
        const { data: existingByNewSlug, error: slugCheckErr } = await supabase
          .from("stores")
          .select("id")
          .eq("slug", newSlug)
          .maybeSingle();

        if (slugCheckErr && (slugCheckErr as any)?.code !== "PGRST116") {
          console.error("Erreur Supabase (vérif nouveau slug):", slugCheckErr);
          return res
            .status(500)
            .json({ error: "Erreur lors de la vérification du slug" });
        }
        if (
          existingByNewSlug &&
          existingByNewSlug.id !== (existing as any)?.id
        ) {
          return res.status(409).json({ error: "Ce nom existe déjà" });
        }
        payload.slug = newSlug;
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("stores")
      .update(payload)
      .eq("slug", decodedSlug)
      .select("*")
      .single();

    if (updErr) {
      console.error("Erreur Supabase (update store):", updErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la mise à jour de la boutique" });
    }

    return res.json({ success: true, store: updated });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/stores/:storeSlug - Récupérer une boutique par son slug
router.get("/:storeSlug", async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };

    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }

    const decodedSlug = decodeURIComponent(storeSlug);
    const { data: store, error } = await supabase
      .from("stores")
      .select("*")
      .eq("slug", decodedSlug)
      .single();

    if (error) {
      if ((error as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Boutique non trouvée" });
      }
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }

    return res.json({ success: true, store });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/stores/:storeSlug/confirm-payout - Confirmer demande de versement
router.post("/:storeSlug/confirm-payout", async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    const { method, iban, bic } = req.body as {
      method?: "database" | "link";
      iban?: string;
      bic?: string;
    };

    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    if (!method || (method !== "database" && method !== "link")) {
      return res
        .status(400)
        .json({ error: "Méthode invalide: 'database' ou 'link' requis" });
    }

    const { data: store, error: getErr } = await supabase
      .from("stores")
      .select("id, name, slug, owner_email, rib")
      .eq("slug", decodedSlug)
      .maybeSingle();

    if (getErr && (getErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store):", getErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!store) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    const currentRib = (store as any)?.rib || null;

    let newRib: any = null;
    if (method === "database") {
      if (!iban || !bic) {
        return res
          .status(400)
          .json({ error: "IBAN et BIC requis pour la méthode 'database'" });
      }
      if (!isValidIBAN(iban)) {
        return res.status(400).json({ error: "IBAN invalide" });
      }
      if (!isValidBIC(bic)) {
        return res.status(400).json({ error: "BIC invalide" });
      }
      newRib = {
        type: "database",
        iban,
        bic,
        url: currentRib?.type === "link" ? currentRib.url || null : null,
      };
    } else {
      // method === "link"
      if (!currentRib || currentRib?.type !== "link" || !currentRib?.url) {
        return res
          .status(400)
          .json({ error: "Aucun RIB (lien) enregistré pour cette boutique" });
      }
      newRib = {
        type: "link",
        url: currentRib.url,
        iban: currentRib?.iban || "",
        bic: currentRib?.bic || "",
      };
    }

    const { data: updated, error: updErr } = await supabase
      .from("stores")
      .update({ rib: newRib })
      .eq("slug", decodedSlug)
      .select("id, name, slug, owner_email, rib, balance")
      .single();

    if (updErr) {
      console.error("Erreur Supabase (update rib):", updErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la mise à jour du RIB" });
    }

    // Email SAV de demande de versement
    try {
      await emailService.sendPayoutRequest({
        ownerEmail: (updated as any).owner_email,
        storeName: (updated as any).name,
        storeSlug: (updated as any).slug,
        method,
        iban: newRib?.iban,
        bic: newRib?.bic,
        ribUrl: newRib?.url,
        amount: (updated as any)?.balance ?? 0,
        currency: "EUR",
      });
    } catch (emailErr) {
      console.error("Erreur envoi email demande de versement:", emailErr);
    }

    return res.json({ success: true, store: updated });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
