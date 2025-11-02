import express from "express";
import { clerkClient } from "@clerk/clerk-sdk-node";
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/clerk/update-public-metadata
// Met à jour les public metadata de l'utilisateur Clerk authentifié
router.post("/update-public-metadata", requireAuth, async (req, res) => {
  try {
    const userId = (req as any)?.auth?.userId || null;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const publicMetadata = (req.body?.publicMetadata as any) || null;
    if (!publicMetadata || typeof publicMetadata !== "object") {
      return res
        .status(400)
        .json({ error: "publicMetadata requis (objet non vide)" });
    }

    try {
      const updated = await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata,
      });
      return res.json({
        success: true,
        user: {
          id: updated.id,
          publicMetadata: updated.publicMetadata || {},
        },
      });
    } catch (err) {
      console.error("Erreur mise à jour publicMetadata Clerk:", err);
      return res
        .status(500)
        .json({ error: "Erreur lors de la mise à jour des metadata" });
    }
  } catch (e) {
    console.error("Erreur serveur (update-public-metadata):", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

export default router;