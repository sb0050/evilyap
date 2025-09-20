import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

// Fonction pour normaliser le nom de boutique pour les URLs
// Convertit les espaces en tirets, garde les accents
function normalizeStoreName(storeName: string): string {
  return storeName
    .trim()
    .replace(/\s+/g, '-') // Remplace les espaces (un ou plusieurs) par des tirets
    .toLowerCase();
}

// Fonction pour vérifier si deux noms de boutique sont équivalents
function areStoreNamesEquivalent(name1: string, name2: string): boolean {
  return normalizeStoreName(name1) === normalizeStoreName(name2);
}

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
    const { storeName, storeTheme, storeDescription, ownerEmail } = req.body;

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

    // Vérifier l'unicité du nom de boutique (normalisé)
    const normalizedStoreName = normalizeStoreName(storeName);
    const { data: allStores } = await supabase
      .from("stores")
      .select("name");

    if (allStores) {
      const nameExists = allStores.some(store => 
        areStoreNamesEquivalent(store.name, storeName)
      );
      
      if (nameExists) {
        return res.status(409).json({ 
          error: "Ce nom de boutique existe déjà (ou un nom similaire)" 
        });
      }
    }

    const { data, error } = await supabase
      .from("stores")
      .insert([
        {
          name: storeName,
          theme: storeTheme || '#667eea',
          description: storeDescription || '',
          owner_email: ownerEmail
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

// GET /api/stores/:storeName - Récupérer une boutique par son nom
router.get("/:storeName", async (req, res) => {
  try {
    const { storeName } = req.params;

    if (!storeName) {
      return res.status(400).json({ error: "Nom de boutique requis" });
    }

    // Décoder l'URL pour gérer les caractères spéciaux et accents
    const decodedStoreName = decodeURIComponent(storeName);
    
    // Récupérer toutes les boutiques pour faire la comparaison normalisée
    const { data: allStores, error: fetchError } = await supabase
      .from("stores")
      .select("*");

    if (fetchError) {
      console.error("Erreur Supabase:", fetchError);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }

    // Trouver la boutique avec le nom normalisé correspondant
    const matchingStore = allStores?.find(store => 
      areStoreNamesEquivalent(store.name, decodedStoreName)
    );

    if (!matchingStore) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    return res.json({ 
      success: true, 
      store: matchingStore 
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;
