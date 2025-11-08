import express from "express";

const router = express.Router();

const INSEE_API_URL = (process.env.INSEE_API_URL || "https://api.insee.fr").replace(/\/+$/, "");
const INSEE_API_KEY = process.env.INSEE_API_KEY;

if (!INSEE_API_KEY) {
  console.warn(
    "⚠️ INSEE_API_KEY manquant. Ajoutez INSEE_API_KEY dans backend/.env pour activer la vérification SIRET."
  );
}

// GET /api/insee/siret/:siret - Vérifier un SIRET via l'API INSEE
router.get("/siret/:siret", async (req, res) => {
  try {
    const raw = (req.params.siret || "").trim();
    const siret = raw.replace(/\s+/g, "");

    // Validation locale basique pour éviter les appels inutiles
    if (!/^\d{14}$/.test(siret)) {
      return res.status(400).json({
        header: {
          statut: 400,
          message: `Erreur de format de siret (${raw}) - Format attendu : 14 chiffres`,
        },
      });
    }

    if (!INSEE_API_KEY) {
      return res.status(500).json({
        error:
          "Configuration INSEE manquante côté serveur (INSEE_API_KEY). Contactez l'administrateur.",
      });
    }

    const url = `${INSEE_API_URL}/api-sirene/3.11/siret/${siret}`;

    const resp = await fetch(url, {
      headers: {
        "X-INSEE-Api-Key-Integration": INSEE_API_KEY,
      },
    });

    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (resp.ok) {
      return res.json({ success: true, data: json });
    }

    const header = json?.header;
    if (header && typeof header?.statut === "number") {
      return res.status(header.statut).json({ header });
    }

    return res.status(resp.status).json(json || { error: `INSEE error ${resp.status}` });
  } catch (error) {
    console.error("Erreur vérification INSEE:", error);
    return res
      .status(500)
      .json({ error: "Erreur lors de la vérification du SIRET" });
  }
});

export default router;