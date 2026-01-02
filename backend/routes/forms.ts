import express from "express";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const VOLUME_BANDS = new Set(["0-20", "20-50", "50-100", "100+"]);

router.post("/responses", async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Database not configured" });

    const {
      email,
      activities,
      volume_band,
      top_priority,
      obs_used,
      answers,
    } = req.body || {};

    const acts = Array.isArray(activities) ? activities.filter((x) => typeof x === "string") : [];
    const vol = typeof volume_band === "string" ? volume_band : null;
    const top = typeof top_priority === "string" ? top_priority : null;
    const obs = typeof obs_used === "boolean" ? obs_used : null;
    const emailVal = typeof email === "string" ? email : null;
    const ans = answers && typeof answers === "object" ? answers : {};

    if (vol && !VOLUME_BANDS.has(vol)) {
      return res.status(400).json({ error: "volume_band invalide" });
    }

    const payload = {
      email: emailVal,
      activities: acts,
      volume_band: vol,
      top_priority: top,
      obs_used: obs,
      answers: ans,
    };

    const { data, error } = await supabase.from("form_responses").insert(payload).select("id").maybeSingle();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ success: true, id: data?.id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Erreur interne" });
  }
});

export default router;