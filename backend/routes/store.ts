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

export default router;
