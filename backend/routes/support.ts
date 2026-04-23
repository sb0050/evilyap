import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { emailService } from "../services/emailService";
import { clerkClient } from "@clerk/express";
import { getAuth } from "@clerk/express";
import {
  detectFileFromMagicBytes,
  sanitizeAttachmentFilename,
} from "../utils/fileMagicBytes";

const router = express.Router();

/**
 * MIME types accepted as email attachments on support endpoints.
 *
 * Kept deliberately narrow: the file is forwarded to a human (admin inbox or
 * store owner), so we only accept formats the recipient can safely open — no
 * HTML, no office macros, no archives, no executables.
 *
 * Enforcement happens twice:
 *  - Multer `fileFilter` rejects early on the untrusted client-declared MIME.
 *  - The handler re-validates by magic bytes via {@link detectFileFromMagicBytes}
 *    so a file renamed from `exploit.html` to `image.png` cannot slip through.
 */
const ALLOWED_SUPPORT_ATTACHMENT_MIMES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

// Upload config: mémoire, limite de 8MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_SUPPORT_ATTACHMENT_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Type de fichier non supporté"));
  },
});

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

    const isOwner =
      (store as any)?.clerk_id && (store as any).clerk_id === requesterId;
    if (!isOwner) {
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
      // Authoritative magic-byte check: `file.mimetype` is the untrusted
      // `Content-Type` sent by the client and can be spoofed to smuggle a
      // disallowed payload (HTML, executable, archive) past the MIME filter.
      // We re-classify the buffer here and also intersect with the route's
      // own whitelist as defense in depth.
      const detected = await detectFileFromMagicBytes(
        file.buffer,
        ALLOWED_SUPPORT_ATTACHMENT_MIMES,
      );
      if (!detected) {
        return res
          .status(415)
          .json({ error: "Type de fichier non supporté" });
      }
      attachments.push({
        // `originalname` can contain CR/LF (MIME header injection on some
        // transports) or path separators (traversal in a few mail clients).
        // We replace the extension with the one derived from magic bytes so
        // the attachment cannot be re-labeled.
        filename: sanitizeAttachmentFilename(
          file.originalname,
          detected.ext,
        ),
        content: file.buffer,
        // `contentType` must reflect the VERIFIED MIME, not the client's one.
        contentType: detected.mime,
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
      const shipmentIdTrimmed = String(shipmentId || "").trim();
      if (!shipmentIdTrimmed) {
        return res.status(400).json({ error: "Shipment ID requis" });
      }

      // Info client depuis Clerk (email, nom + stripe_id pour autorisation)
      let customerEmail: string | undefined;
      let customerName: string | undefined;
      let stripeCustomerId: string | undefined;
      try {
        const user = await clerkClient.users.getUser(requesterId);
        customerEmail =
          (user?.primaryEmailAddress as any)?.emailAddress || undefined;
        const first = (user as any)?.firstName || "";
        const last = (user as any)?.lastName || "";
        const full = `${first} ${last}`.trim();
        customerName = full || undefined;
        stripeCustomerId = String(
          (user?.publicMetadata as any)?.stripe_id || "",
        ).trim();
      } catch (_e) {
        // ignore
      }
      if (!stripeCustomerId) {
        return res
          .status(400)
          .json({ error: "stripe_id manquant dans les metadata du user" });
      }

      // Rechercher le shipment et le store associé
      const baseSelect =
        "id, store_id, shipment_id, customer_stripe_id, tracking_url, product_reference, customer_spent_amount, promo_code, delivery_method, delivery_network";

      let shipment: any = null;
      {
        const { data, error: shipErr } = await supabase
          .from("shipments")
          .select(baseSelect)
          .eq("shipment_id", shipmentIdTrimmed)
          .maybeSingle();
        if (shipErr) {
          return res.status(500).json({ error: shipErr.message });
        }
        shipment = data;
      }

      if (!shipment) {
        const asNum = Number(shipmentIdTrimmed);
        if (Number.isFinite(asNum) && asNum > 0) {
          const { data, error: shipErr2 } = await supabase
            .from("shipments")
            .select(baseSelect)
            .eq("id", asNum)
            .maybeSingle();
          if (shipErr2) {
            return res.status(500).json({ error: shipErr2.message });
          }
          shipment = data;
        }
      }

      if (!shipment) {
        return res.status(404).json({ error: "Expédition non trouvée" });
      }
      if (
        String((shipment as any)?.customer_stripe_id || "").trim() !==
        stripeCustomerId
      ) {
        return res
          .status(403)
          .json({ error: "Accès interdit à cette commande" });
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

      // Pièce jointe — même contrôle magic-bytes que `/contact` ci-dessus.
      let attachments: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
      }> = [];
      const file = (req as any).file as Express.Multer.File | undefined;
      if (file) {
        const detected = await detectFileFromMagicBytes(
          file.buffer,
          ALLOWED_SUPPORT_ATTACHMENT_MIMES,
        );
        if (!detected) {
          return res
            .status(415)
            .json({ error: "Type de fichier non supporté" });
        }
        attachments.push({
          filename: sanitizeAttachmentFilename(
            file.originalname,
            detected.ext,
          ),
          content: file.buffer,
          contentType: detected.mime,
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
          value:
            typeof (shipment as any).customer_spent_amount === "number"
              ? Math.max(0, Number((shipment as any).customer_spent_amount)) /
                100
              : undefined,
          deliveryMethod: (shipment as any).delivery_method || undefined,
          deliveryNetwork: (shipment as any).delivery_network || undefined,
          message: msg,
          promoCodes: String((shipment as any).promo_code || "").replace(
            /;+/g,
            ", ",
          ),
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
  },
);
