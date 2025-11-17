import express from "express";

const router = express.Router();

const INSEE_API_URL = (
  process.env.INSEE_API_URL || "https://api.insee.fr"
).replace(/\/+$/, "");
const INSEE_API_KEY = process.env.INSEE_API_KEY;

const BCE_API_URL = (process.env.BCE_API_URL || "https://cbeapi.be").replace(/\/+$/, "");
const BCE_API_KEY = process.env.BCE_API_KEY;

if (!INSEE_API_KEY) {
  console.warn(
    "⚠️ INSEE_API_KEY manquant. Ajoutez INSEE_API_KEY dans backend/.env pour activer la vérification SIRET."
  );
}

// GET /api/insee-bce/siret/:siret - Vérifier un SIRET via l'API INSEE
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

    return res
      .status(resp.status)
      .json(json || { error: `INSEE error ${resp.status}` });
  } catch (error) {
    console.error("Erreur vérification INSEE:", error);
    return res
      .status(500)
      .json({ error: "Erreur lors de la vérification du SIRET" });
  }
});

router.get("/bce/:bce", async (req, res) => {
  try {
    const raw = (req.params.bce || "").trim();
    const normalized = raw.replace(/\s+/g, "").replace(/^BE/i, "").replace(/\./g, "");
    if (!/^\d{10}$/.test(normalized)) {
      return res.status(400).json({
        header: {
          statut: 400,
          message: `Erreur de format de BCE (${raw}) - Format attendu : 10 chiffres (ex: 0123.456.789 ou BE0123456789)`,
        },
      });
    }
    if (!BCE_API_KEY) {
      return res.status(500).json({
        error: "Configuration BCE manquante côté serveur (BCE_API_KEY). Contactez l'administrateur.",
      });
    }
    const url = `${BCE_API_URL}/api/v1/company/${encodeURIComponent(normalized)}?lang=fr`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BCE_API_KEY}`,
        "Content-Type": "application/json",
      },
    } as any);
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
    return res.status(resp.status).json(json || { error: `BCE error ${resp.status}` });
  } catch (error) {
    console.error("Erreur vérification BCE:", error);
    return res.status(500).json({ error: "Erreur lors de la vérification du BCE" });
  }
});

export default router;
