import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { emailService } from "../services/emailService";
import { clerkClient } from "@clerk/express";
import { getAuth } from "@clerk/express";

const router = express.Router();

// Upload config: mémoire, limite de 8MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase credentials are not set in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// POST /api/support/contact - Store owner sends a support message to admin
router.post("/contact", upload.single("attachment"), async (req, res) => {
  try {
    const {
      storeSlug,
      message,
      context: rawContext,
    } = req.body as {
      storeSlug?: string;
      message?: string;
      context?: string;
    };

    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const requesterId = auth.userId;

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

    // Préparer les pièces jointes si fournies
    let attachments: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }> = [];
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) {
      const allowed = ["application/pdf", "image/png", "image/jpeg"];
      if (!allowed.includes(file.mimetype)) {
        return res.status(400).json({ error: "Type de fichier non supporté" });
      }
      attachments.push({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      });
    }

    try {
      await emailService.sendAdminSupportMessage({
        storeName: (store as any)?.name || "Votre Boutique",
        storeSlug: (store as any)?.slug || decodedSlug,
        ownerEmail: (store as any)?.owner_email || undefined,
        clerkUserId: requesterId || undefined,
        message: msg,
        context: rawContext,
        attachments,
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
// Nouveau endpoint: client contacte le propriétaire du store à propos d'un shipment
router.post(
  "/customer-contact",
  upload.single("attachment"),
  async (req, res) => {
    try {
      const auth = getAuth(req);
      if (!auth?.isAuthenticated) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const requesterId = auth.userId;

      const { shipmentId, message } = req.body as {
        shipmentId?: string;
        message?: string;
      };

      const msg = (message || "").trim();
      if (!msg) {
        return res.status(400).json({ error: "Message requis" });
      }
      if (!shipmentId) {
        return res.status(400).json({ error: "Shipment ID requis" });
      }

      // Rechercher le shipment et le store associé
      const { data: shipment, error: shipErr } = await supabase
        .from("shipments")
        .select(
          "id, store_id, shipment_id, tracking_url, product_reference, product_value, delivery_method, delivery_network"
        )
        .eq("shipment_id", shipmentId)
        .maybeSingle();

      if (shipErr) {
        return res.status(500).json({ error: shipErr.message });
      }
      if (!shipment) {
        return res.status(404).json({ error: "Expédition non trouvée" });
      }
      if (!shipment.store_id) {
        return res
          .status(400)
          .json({ error: "store_id manquant pour cette expédition" });
      }

      const { data: store, error: storeErr2 } = await supabase
        .from("stores")
        .select("id, name, slug, owner_email")
        .eq("id", shipment.store_id as any)
        .maybeSingle();
      if (storeErr2) {
        return res.status(500).json({ error: storeErr2.message });
      }
      if (!store || !(store as any).owner_email) {
        return res
          .status(404)
          .json({ error: "Boutique introuvable ou email propriétaire absent" });
      }

      // Info client depuis Clerk
      let customerEmail: string | undefined;
      let customerName: string | undefined;
      try {
        const user = await clerkClient.users.getUser(requesterId);
        customerEmail =
          (user?.primaryEmailAddress as any)?.emailAddress || undefined;
        const first = (user as any)?.firstName || "";
        const last = (user as any)?.lastName || "";
        const full = `${first} ${last}`.trim();
        customerName = full || undefined;
      } catch (_e) {
        // ignore
      }

      // Pièce jointe
      let attachments: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
      }> = [];
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) {
        const allowed = ["application/pdf", "image/png", "image/jpeg"];
        if (!allowed.includes(file.mimetype)) {
          return res
            .status(400)
            .json({ error: "Type de fichier non supporté" });
        }
        attachments.push({
          filename: file.originalname,
          content: file.buffer,
          contentType: file.mimetype,
        });
      }

      try {
        await emailService.sendCustomerMessageToStoreOwner({
          toEmail: (store as any).owner_email,
          storeName: (store as any).name || "Votre Boutique",
          storeSlug: (store as any).slug || undefined,
          customerEmail,
          customerName,
          shipmentId: (shipment as any).shipment_id || undefined,
          trackingUrl: (shipment as any).tracking_url || undefined,
          productReference: (shipment as any).product_reference || undefined,
          value: (shipment as any).product_value || undefined,
          deliveryMethod: (shipment as any).delivery_method || undefined,
          deliveryNetwork: (shipment as any).delivery_network || undefined,
          message: msg,
          promoCodes: (shipment as any).promo_code || "",
          attachments,
        });
      } catch (emailErr) {
        console.error("Erreur envoi email client→propriétaire:", emailErr);
        return res
          .status(500)
          .json({ error: "Erreur lors de l'envoi de l'email" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("Erreur serveur (customer-contact):", err);
      return res.status(500).json({ error: "Erreur interne du serveur" });
    }
  }
);
