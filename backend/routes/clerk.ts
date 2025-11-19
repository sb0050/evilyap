import { clerkClient } from "@clerk/express";
import { getAuth } from "@clerk/express";
import express from "express";

const router = express.Router();

// POST /api/clerk/update-public-metadata
// Met à jour les public metadata de l'utilisateur Clerk authentifié
router.post("/update-public-metadata", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = auth.userId || null;
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
// GET /api/clerk/users?search=...
router.get("/users", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const search = ((req.query.search as string) || "").trim().toLowerCase();
    try {
      const list = await clerkClient.users.getUserList({ limit: 200 } as any);
      const arr = ((list as any)?.data || list || []) as any[];
      const users = arr.map((u: any) => {
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ");
        const primaryEmail = u.primaryEmailAddress
          ? u.primaryEmailAddress.emailAddress
          : Array.isArray(u.emailAddresses) && u.emailAddresses.length > 0
          ? u.emailAddresses[0].emailAddress
          : null;
        const stripeId = (u.publicMetadata as any)?.stripe_id || null;
        const imageUrl = u.imageUrl || null;
        const hasImage = Boolean(u.hasImage);
        return {
          id: u.id,
          fullName,
          email: primaryEmail,
          stripeId,
          imageUrl,
          hasImage,
        };
      });
      const filtered = search
        ? users.filter((u: any) =>
            (u.fullName || "").toLowerCase().includes(search) ||
            (u.email || "").toLowerCase().includes(search)
          )
        : users;
      return res.json({ users: filtered });
    } catch (err) {
      console.error("Erreur liste utilisateurs Clerk:", err);
      return res.status(500).json({ error: "Erreur récupération utilisateurs" });
    }
  } catch (e) {
    console.error("Erreur serveur (users):", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});
