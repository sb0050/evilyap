import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();


// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
    const slug = (req.query.slug as string) || "";
    if (!slug) {
      return res.status(400).json({ error: "Slug requis" });
    }

    const { data, error } = await supabase
      .from("stores")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (error && (error as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase:", error);
      return res.status(500).json({ error: "Erreur lors de la vérification du slug" });
    }

    return res.json({ exists: Boolean(data) });
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
      .select("name, owner_email")
      .eq("owner_email", email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
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
      ownerEmail: data.owner_email 
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/stores - Créer une nouvelle boutique
router.post("/", async (req, res) => {
  try {
    const { storeName, storeDescription, ownerEmail, slug, logoUrl } = req.body;

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

    if (slugCheckError && slugCheckError.code !== 'PGRST116') {
      console.error("Erreur Supabase (vérif slug):", slugCheckError);
      return res.status(500).json({ error: "Erreur lors de la vérification du slug" });
    }

    if (existingBySlug) {
      return res.status(409).json({ error: "Ce nom de boutique existe déjà" });
    }

    const { data, error } = await supabase
      .from("stores")
      .insert([
        {
          name: storeName,
          slug: slug,
          description: storeDescription || '',
          owner_email: ownerEmail,
          logo: logoUrl || null,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la création de la boutique" });
    }

    return res.status(201).json({ 
      success: true, 
      store: data 
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
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
      if ((error as any)?.code === 'PGRST116') {
        return res.status(404).json({ error: "Boutique non trouvée" });
      }
      console.error("Erreur Supabase:", error);
      return res.status(500).json({ error: "Erreur lors de la récupération de la boutique" });
    }

    return res.json({ success: true, store });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
