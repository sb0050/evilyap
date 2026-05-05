import express from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

import { isValidIBAN, isValidBIC } from "ibantools";
import slugify from "slugify";
import { clerkClient, getAuth } from "@clerk/express";
import { emailService } from "../services/emailService";
import {
  getAuthContext,
  requireAuth,
  requireAuthWithStripe,
} from "../middlewares/requireAuth";
import { requireStoreOwner } from "../middlewares/ownership";

const router = express.Router();

// Configuration Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const createProspectTransporter = () => {
  const host = process.env.SMTP_HOST || "";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (!host) {
    throw new Error("SMTP_HOST manquant");
  }
  if (!user || !pass) {
    throw new Error("SMTP credentials missing");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const getCloudBase = () => {
  const raw = String(process.env.CLOUDFRONT_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "https://d1tmgyvizond6e.cloudfront.net";
};

const collectPdf = (doc: InstanceType<typeof PDFDocument>) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: any) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
    );
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });

const sanitizeOneLine = (raw: string) =>
  String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

// Helper: validation website (TLD domain or full URL with TLD)
const isValidWebsite = (url?: string | null) => {
  const value = (url || "").trim();
  if (!value) return true; // facultatif
  const domainOnlyRegex = /^(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;
  if (domainOnlyRegex.test(value)) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname || "";
    const hasTld = /\.[a-zA-Z]{2,}$/.test(host);
    return hasTld;
  } catch {
    return false;
  }
};

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
    const raw = (req.query.slug as string) || (req.query.name as string) || "";
    if (!raw.trim()) {
      return res.status(400).json({ error: "Slug ou nom requis" });
    }

    const candidate = slugify(raw, { lower: true, strict: true });

    const { data, error } = await supabase
      .from("stores")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error && (error as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du slug" });
    }

    if (data) {
      return res.json({ exists: true });
    }
    return res.json({ exists: false, slug: candidate });
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
      .select("name, owner_email, slug")
      .eq("owner_email", email)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
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
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/stores/check-owner-by-stripe/:stripeId - Vérifier si un stripe_id existe comme propriétaire
router.get(
  "/check-owner-by-stripe/:stripeId",
  requireAuthWithStripe(),
  async (req, res) => {
  try {
    const auth = getAuthContext(res);
    const stripeId = String(req.params?.stripeId || "").trim();

    if (!stripeId) {
      return res.status(400).json({ error: "stripeId requis" });
    }
    if (stripeId !== auth.stripeCustomerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabase
      .from("stores")
      .select("name, owner_email, slug")
      .eq("stripe_id", stripeId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.json({ exists: false });
      }
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du stripeId" });
    }

    return res.json({
      exists: true,
      storeName: data.name,
      ownerEmail: data.owner_email,
      slug: (data as any)?.slug,
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
  },
);

// GET /api/stores/check-owner-by-clerk/:clerkId - Vérifier si un clerk_id existe comme propriétaire
router.get("/check-owner-by-clerk/:clerkId", requireAuth(), async (req, res) => {
  try {
    const auth = getAuthContext(res);
    const clerkId = String(req.params?.clerkId || "").trim();

    if (!clerkId) {
      return res.status(400).json({ error: "clerkId requis" });
    }
    if (clerkId !== auth.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data, error } = await supabase
      .from("stores")
      .select("name, owner_email, slug")
      .eq("clerk_id", clerkId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.json({ exists: false });
      }
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du clerkId" });
    }

    return res.json({
      exists: true,
      storeName: data.name,
      ownerEmail: data.owner_email,
      slug: (data as any)?.slug,
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/stores - Créer une nouvelle boutique
router.post("/", requireAuth(), async (req, res) => {
  try {
    const auth = getAuthContext(res);
    const {
      storeName,
      storeDescription,
      ownerEmail,
      slug,
      clerkUserId,
      name,
      phone,
      address,
      website,
      siret,
      is_verified,
      stripeCustomerId,
    } = req.body;
    const requestedClerkUserId = String(clerkUserId || "").trim();
    if (requestedClerkUserId && requestedClerkUserId !== auth.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

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

    if (slugCheckError && slugCheckError.code !== "PGRST116") {
      console.error("Erreur Supabase (vérif slug):", slugCheckError);
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification du slug" });
    }

    if (existingBySlug) {
      return res.status(409).json({ error: "Ce nom de boutique existe déjà" });
    }

    // Construire l'adresse JSON attendue
    const addressJson =
      address && typeof address === "object"
        ? {
            city: address.city || null,
            line1: address.line1 || null,
            country: address.country || null,
            postal_code: address.postal_code || null,
            phone: phone || null,
          }
        : null;

    const { data, error } = await supabase
      .from("stores")
      .insert([
        {
          name: storeName,
          slug: slug,
          description: storeDescription || "",
          owner_email: ownerEmail,
          stripe_id: stripeCustomerId,
          address: addressJson,
          website: website || null,
          clerk_id: auth.userId,
          siret: siret || null,
          is_verified: is_verified === true ? true : false,
        },
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
      store: data,
    });
  } catch (error) {
    console.error("Erreur serveur:", error);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// PUT /api/stores/:storeSlug - Mettre à jour nom/description/website
// PUT /api/stores/:storeSlug - Mettre à jour nom/description/website/siret et éventuellement is_verified
router.put(
  "/:storeSlug",
  requireAuth(),
  requireStoreOwner({ source: "params", key: "storeSlug", column: "slug" }),
  async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    const {
      name,
      description,
      website,
      siret,
      is_verified,
      address,
      phone,
      tva_applicable,
    } = req.body as {
      name?: string;
      description?: string;
      website?: string;
      siret?: string;
      is_verified?: boolean;
      address?: any;
      phone?: string;
      tva_applicable?: boolean;
    };

    if (!storeSlug)
      return res.status(400).json({ error: "Slug de boutique requis" });
    const decodedSlug = decodeURIComponent(storeSlug);

    // Validation website (facultatif, mais si présent doit être valide)
    if (website && !isValidWebsite(website)) {
      return res.status(400).json({
        error:
          "Site web invalide: fournir un domaine avec TLD ou une URL complète",
      });
    }

    const { data: existing, error: getErr } = await supabase
      .from("stores")
      .select("id, name, slug")
      .eq("slug", decodedSlug)
      .maybeSingle();

    if (getErr && (getErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store):", getErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!existing) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    const payload: any = {};
    if (typeof name === "string") payload.name = name;
    if (typeof description === "string") payload.description = description;
    if (typeof website === "string") payload.website = website || null;
    if (typeof siret === "string") payload.siret = siret || null;
    if (typeof tva_applicable === "boolean") {
      payload.tva_applicable = tva_applicable;
    }
    // Autoriser uniquement l'upgrade de vérification côté serveur
    if (is_verified === true) {
      payload.is_verified = true;
    }

    // Mise à jour de l'adresse JSONB si fournie
    if (address && typeof address === "object") {
      const addressJson = {
        city: address.city || null,
        line1: address.line1 || null,
        country: address.country || null,
        postal_code: address.postal_code || null,
        phone: (typeof phone === "string" ? phone : null) || null,
      };
      payload.address = addressJson;
    } else if (typeof phone === "string") {
      // Permettre la mise à jour du téléphone seul dans l'adresse existante
      const { data: existingStore, error: getAddressErr } = await supabase
        .from("stores")
        .select("address")
        .eq("slug", decodedSlug)
        .maybeSingle();
      if (!getAddressErr && existingStore && (existingStore as any)?.address) {
        const current = (existingStore as any).address || {};
        payload.address = {
          city: current.city || null,
          line1: current.line1 || null,
          country: current.country || null,
          postal_code: current.postal_code || null,
          phone: phone || null,
        };
      }
    }

    // Si le nom change, recalculer le slug côté backend et vérifier l'unicité
    if (typeof name === "string") {
      const newName = (name || "").trim();
      const currentName = ((existing as any)?.name || "").trim();
      if (newName && newName !== currentName) {
        const newSlug = slugify(newName, { lower: true, strict: true });
        // Vérifier unicité du nouveau slug, en excluant la boutique actuelle
        const { data: existingByNewSlug, error: slugCheckErr } = await supabase
          .from("stores")
          .select("id")
          .eq("slug", newSlug)
          .maybeSingle();

        if (slugCheckErr && (slugCheckErr as any)?.code !== "PGRST116") {
          console.error("Erreur Supabase (vérif nouveau slug):", slugCheckErr);
          return res
            .status(500)
            .json({ error: "Erreur lors de la vérification du slug" });
        }
        if (
          existingByNewSlug &&
          existingByNewSlug.id !== (existing as any)?.id
        ) {
          return res.status(409).json({ error: "Ce nom existe déjà" });
        }
        payload.slug = newSlug;
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("stores")
      .update(payload)
      .eq("slug", decodedSlug)
      .select("*")
      .single();

    if (updErr) {
      console.error("Erreur Supabase (update store):", updErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la mise à jour de la boutique" });
    }

    return res.json({ success: true, store: updated });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
  },
);

router.get("/me", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const clerkId = String(auth.userId).trim();
    const { data: store, error } = await supabase
      .from("stores")
      .select("id, name, slug, clerk_id")
      .eq("clerk_id", clerkId)
      .maybeSingle();

    if (error && (error as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store by clerk_id):", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      hasStore: Boolean(store),
      store: store || null,
    });
  } catch (e) {
    console.error("Erreur serveur:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/need-a-demo", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const emailAddresses = Array.isArray((user as any)?.emailAddresses)
      ? (user as any).emailAddresses
      : [];
    const primaryEmail = String(
      (user as any)?.primaryEmailAddress?.emailAddress || "",
    ).trim();
    const source = String((req.body as any)?.source || "needademo").trim();
    const trigger = String((req.body as any)?.trigger || "manual").trim();
    const contactMethod = String(
      (req.body as any)?.contactMethod || "phone",
    ).trim();
    const phone = String((req.body as any)?.phone || "").trim() || null;
    const phoneRaw = String((req.body as any)?.phoneRaw || "").trim() || null;
    const contactEmail =
      String((req.body as any)?.contactEmail || "").trim() || null;
    const customerEmail = contactEmail || primaryEmail || null;

    const payload = {
      clerkUserId: String((user as any)?.id || auth.userId),
      fullName: String((user as any)?.fullName || "").trim() || null,
      firstName: String((user as any)?.firstName || "").trim() || null,
      lastName: String((user as any)?.lastName || "").trim() || null,
      primaryEmail: primaryEmail || null,
      emails: emailAddresses
        .map((e: any) => String(e?.emailAddress || "").trim())
        .filter(Boolean),
      createdAt: (user as any)?.createdAt || null,
      lastSignInAt: (user as any)?.lastSignInAt || null,
      source: source || null,
      trigger: trigger || null,
      contactMethod: contactMethod || null,
      contactEmail,
      phone,
      phoneRaw,
    };

    try {
      await emailService.sendAdminError({
        subject: "Demande de démo (NeedADemo)",
        message: `Le user souhaite une démo. clerk_id=${String(
          auth.userId,
        )} trigger=${trigger || "manual"} method=${
          contactMethod || "phone"
        } phone=${phone || phoneRaw || "—"} email=${customerEmail || "—"}`,
        context: JSON.stringify(payload, null, 2),
      });
    } catch {}

    if (customerEmail) {
      try {
        const transporter = createProspectTransporter();
        const fullNameRaw = String((user as any)?.fullName || "").trim();
        const sourceName =
          fullNameRaw || String(customerEmail.split("@")[0] || "").trim();
        const cleaned = sourceName
          .replace(/[._\-+]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const firstNameGuess = cleaned
          ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
          : "";
        const greeting = firstNameGuess
          ? `Bonjour ${firstNameGuess},`
          : "Bonjour,";
        const logoCandidates = [
          path.resolve(process.cwd(), "public", "logo_bis.png"),
          path.resolve(
            process.cwd(),
            "..",
            "frontend",
            "public",
            "logo_bis.png",
          ),
        ];
        const logoPath = logoCandidates.find((p) => fs.existsSync(p)) || "";
        const hasLogo = Boolean(logoPath);
        const subject = firstNameGuess
          ? `${firstNameGuess}, on organise une démo ? 🚀`
          : "On organise une démo ? 🚀";
        const html = `<!DOCTYPE html>
        <html lang="fr">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>On organise une démo ?</title>
        </head>
        <body style="margin:0;padding:0;background:#f7f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;color:#0f172a;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.08);overflow:hidden;">
            <div style="background:linear-gradient(90deg,#7c3aed,#2563eb);padding:24px;text-align:center;">
              ${
                hasLogo
                  ? `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer"><img src="cid:paylive-logo" alt="PayLive" style="height:44px;vertical-align:middle;" /></a>`
                  : `<a href="https://paylive.cc" target="_blank" rel="noopener noreferrer" style="text-decoration:none;"><div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">PayLive.cc</div></a>`
              }
              <div style="margin-top:8px;font-size:14px;color:#e5e7eb;">On organise une démo ? 🚀</div>
            </div>

            <div style="padding:28px 28px 8px 28px;">
              <div style="font-size:18px;line-height:1.5;">
                <span style="font-weight:700;">${greeting}</span>
              </div>
              <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
                Merci pour votre inscription !
              </p>
              <p style="margin:14px 0 0 0;font-size:16px;line-height:1.6;">
                Pour aller plus loin, je vous propose une démo rapide (30 min) pour vous montrer
                <span style="font-weight:700;color:#7c3aed;"> PayLive</span> en action — directement sur vos cas d’usage.
              </p>

              <div style="margin-top:18px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:10px;">Deux petites choses pour qu’on cale ça :</div>
                <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.8;">
                  <li>Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?</li>
                  <li>Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?</li>
                </ul>
              </div>
              <p style="margin:18px 0 0 0;font-size:16px;line-height:1.6;">
                Hâte de vous faire découvrir la solution !
              </p>

              <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:14px;font-size:14px;color:#475569;">
                À très vite,<br />
                <span style="font-weight:700;">L’équipe <a href="https://www.paylive.cc" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">PayLive.cc</a></span>
              </div>
            </div>
            <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12px;">
              © ${new Date().getFullYear()} PayLive.cc — Tous droits réservés
            </div>
          </div>
        </body>
        </html>`;
        const text = `${greeting}\n\nPour aller plus loin, je vous propose une démo rapide (30 min) pour vous montrer PayLive en action — directement sur vos cas d’usage.\n\nDeux petites choses pour qu’on cale ça :\n• Quelles sont vos disponibilités cette semaine ou la semaine prochaine ?\n• Quel est votre numéro de téléphone pour qu’on reste en contact facilement ?\n\nHâte de vous faire découvrir la solution !\n\nÀ très vite,\nL’équipe PayLive.cc`;
        const fromEmail = process.env.SMTP_USER || "noreply@paylive.cc";
        const attachments: any[] = [];
        if (hasLogo) {
          attachments.push({
            filename: "paylive.png",
            content: fs.readFileSync(logoPath),
            cid: "paylive-logo",
            contentType: "image/png",
          });
        }
        await transporter.sendMail({
          from: `Paylive.cc <${fromEmail}>`,
          to: customerEmail,
          subject,
          text,
          html,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      } catch (mailErr) {
        console.error("[need-a-demo] email client échoué:", mailErr);
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("Erreur serveur:", e);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// GET /api/stores/:storeSlug - Récupérer une boutique par son slug
router.get(
  "/:storeSlug/private",
  requireAuth(),
  requireStoreOwner({ source: "params", key: "storeSlug", column: "slug" }),
  async (req, res) => {
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
        if ((error as any)?.code === "PGRST116") {
          return res.status(404).json({ error: "Boutique non trouvÃ©e" });
        }
        console.error("Erreur Supabase:", error);
        return res
          .status(500)
          .json({ error: "Erreur lors de la rÃ©cupÃ©ration de la boutique" });
      }

      return res.json({ success: true, store });
    } catch (err) {
      console.error("Erreur serveur:", err);
      return res.status(500).json({ error: "Erreur interne du serveur" });
    }
  },
);

router.get("/:storeSlug", requireAuth(), async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };

    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }

    const decodedSlug = decodeURIComponent(storeSlug);
    const { data: store, error } = await supabase
      .from("stores")
      .select(
        "id, name, slug, description, website, is_verified, address, tva_applicable",
      )
      .eq("slug", decodedSlug)
      .single();

    if (error) {
      if ((error as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Boutique non trouvée" });
      }
      console.error("Erreur Supabase:", error);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }

    return res.json({ success: true, store });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

// POST /api/stores/:storeSlug/confirm-payout - Confirmer demande de versement
router.post("/:storeSlug/confirm-payout", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      console.warn("[confirm-payout] unauthorized", {
        isAuthenticated: Boolean(auth?.isAuthenticated),
        hasUserId: Boolean(auth?.userId),
        authUserId: auth?.userId ? String(auth.userId) : null,
        authSessionId: (auth as any)?.sessionId
          ? String((auth as any).sessionId)
          : null,
      });
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      console.warn("[confirm-payout] missing storeSlug");
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);
    console.log("[confirm-payout] resolved slug", { decodedSlug });

    const { iban, bic, payoutNetCents } = req.body as {
      iban?: string;
      bic?: string;
      payoutNetCents?: number | string;
    };
    const ibanTrim = String(iban || "").trim();
    const bicTrim = String(bic || "").trim();
    if (!ibanTrim || !bicTrim) {
      console.warn("[confirm-payout] missing iban/bic", {
        hasIban: Boolean(ibanTrim),
        hasBic: Boolean(bicTrim),
      });
      return res.status(400).json({ error: "IBAN et BIC requis" });
    }
    if (!isValidIBAN(ibanTrim)) {
      console.warn("[confirm-payout] invalid iban");
      return res.status(400).json({ error: "IBAN invalide" });
    }
    if (!isValidBIC(bicTrim)) {
      console.warn("[confirm-payout] invalid bic");
      return res.status(400).json({ error: "BIC invalide" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const ownerStripeId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!ownerStripeId) {
      console.warn("[confirm-payout] missing stripe_id in clerk metadata", {
        userId: String(auth.userId),
      });
      return res.status(400).json({ error: "stripe_id manquant" });
    }
    console.log("[confirm-payout] clerk identity", {
      userId: String(auth.userId),
      hasStripeId: Boolean(ownerStripeId),
    });

    const { data: store, error: getErr } = await supabase
      .from("stores")
      .select(
        "id, name, slug, clerk_id, owner_email, stripe_id, iban_bic, payout_created_at, payout_facture_id, siret, address",
      )
      .eq("stripe_id", ownerStripeId)
      .maybeSingle();

    if (getErr && (getErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store):", getErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!store) {
      console.warn("[confirm-payout] store not found", {
        ownerStripeId,
      });
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    if (String((store as any)?.slug || "") !== decodedSlug) {
      console.warn("[confirm-payout] slug mismatch", {
        decodedSlug,
        storeSlug: String((store as any)?.slug || ""),
        storeId: (store as any)?.id ?? null,
      });
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    let authorized = Boolean(
      (store as any)?.clerk_id && (store as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String(
          (store as any)?.owner_email || "",
        ).toLowerCase();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) {
      console.warn("[confirm-payout] forbidden", {
        userId: String(auth.userId),
        storeId: (store as any)?.id ?? null,
        storeClerkId: String((store as any)?.clerk_id || ""),
        storeOwnerEmail: String((store as any)?.owner_email || ""),
      });
      return res.status(403).json({ error: "Forbidden" });
    }

    const storeId = (store as any).id as number;
    console.log("[confirm-payout] authorized", {
      storeId,
      storeSlug: String((store as any)?.slug || ""),
    });
    const lastPayoutRaw = (store as any)?.payout_created_at as any;
    const lastPayoutMs = lastPayoutRaw
      ? new Date(lastPayoutRaw).getTime()
      : NaN;
    const lastPayoutTimestamp = Number.isFinite(lastPayoutMs)
      ? Math.floor(lastPayoutMs / 1000)
      : undefined;

    const mapWithLimit = async <T, R>(
      items: T[],
      maxConcurrent: number,
      fn: (item: T, idx: number) => Promise<R>,
    ): Promise<R[]> => {
      const out: R[] = new Array(items.length);
      let idx = 0;
      const workers = new Array(Math.max(1, maxConcurrent))
        .fill(null)
        .map(async () => {
          while (idx < items.length) {
            const current = idx++;
            out[current] = await fn(items[current], current);
          }
        });
      await Promise.all(workers);
      return out;
    };

    const payoutsSinceIso = Number.isFinite(lastPayoutMs)
      ? new Date(lastPayoutMs).toISOString()
      : null;

    const payoutShipments: any[] = [];
    const pageSizeDb = 1000;
    for (let from = 0; ; from += pageSizeDb) {
      let q = supabase
        .from("shipments")
        .select(
          "id, payment_id, created_at, customer_stripe_id, product_reference, promo_code, store_earnings_amount, stripe_fees",
        )
        .eq("store_id", storeId)
        .eq("is_final_destination", true)
        .or("status.is.null,and(status.neq.CANCELLED,status.neq.RETURNED)")
        .not("payment_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      if (payoutsSinceIso) q = q.gt("created_at", payoutsSinceIso);

      const { data, error } = await q;
      if (error) {
        console.error("Erreur Supabase (list shipments for payout):", error);
        return res.status(500).json({ error: error.message });
      }
      payoutShipments.push(...(data || []));
      if (!data || data.length < pageSizeDb) break;
    }

    const cancelledFeeShipments: any[] = [];
    for (let from = 0; ; from += pageSizeDb) {
      let q = supabase
        .from("shipments")
        .select("id, created_at, stripe_fees")
        .eq("store_id", storeId)
        .eq("status", "CANCELLED")
        .not("payment_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      if (payoutsSinceIso) q = q.gt("created_at", payoutsSinceIso);

      const { data, error } = await q;
      if (error) {
        console.error(
          "Erreur Supabase (list cancelled shipments fees for payout):",
          error,
        );
        return res.status(500).json({ error: error.message });
      }
      cancelledFeeShipments.push(...(data || []));
      if (!data || data.length < pageSizeDb) break;
    }

    const paidShipments = payoutShipments.filter((r) => {
      const st = String((r as any)?.status || "")
        .trim()
        .toUpperCase();
      return st !== "RETURNED";
    });

    const returnedSincePayout: any[] = [];
    if (payoutsSinceIso) {
      for (let from = 0; ; from += pageSizeDb) {
        let q = supabase
          .from("shipments")
          .select(
            "id, payment_id, created_at, delivery_date, customer_stripe_id, shipment_id, product_reference, promo_code, store_earnings_amount, stripe_fees",
          )
          .eq("store_id", storeId)
          .eq("status", "RETURNED")
          .not("payment_id", "is", null)
          .not("delivery_date", "is", null)
          .gt("delivery_date", payoutsSinceIso)
          .order("delivery_date", { ascending: false })
          .range(from, from + pageSizeDb - 1);

        const { data, error } = await q;
        if (error) {
          if ((error as any)?.code === "42703") {
            break;
          }
          console.error(
            "Erreur Supabase (list returned shipments for payout deduction):",
            error,
          );
          return res.status(500).json({ error: error.message });
        }
        returnedSincePayout.push(...(data || []));
        if (!data || data.length < pageSizeDb) break;
      }
    }

    const grossCents = paidShipments.reduce((sum, r) => {
      const v = Number((r as any)?.store_earnings_amount || 0);
      return sum + (Number.isFinite(v) ? Math.round(v) : 0);
    }, 0);

    if (!Number.isFinite(grossCents) || grossCents <= 0) {
      return res.status(400).json({ error: "Aucun gain disponible" });
    }

    const stripeFeesCentsFromPaid = paidShipments.reduce((sum, r) => {
      const v = Number((r as any)?.stripe_fees || 0);
      return sum + (Number.isFinite(v) ? Math.round(v) : 0);
    }, 0);
    const stripeFeesCentsFromCancelled = cancelledFeeShipments.reduce(
      (sum, r) => {
        const v = Number((r as any)?.stripe_fees || 0);
        return sum + (Number.isFinite(v) ? Math.round(v) : 0);
      },
      0,
    );
    const returnCutoffMs = payoutsSinceIso
      ? new Date(payoutsSinceIso).getTime()
      : NaN;
    const returnedEarningsCents = returnedSincePayout.reduce((sum, r) => {
      const createdAt = String((r as any)?.created_at || "").trim();
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      if (!Number.isFinite(createdMs) || !Number.isFinite(returnCutoffMs))
        return sum;
      if (createdMs >= returnCutoffMs) return sum;
      const v = Number((r as any)?.store_earnings_amount || 0);
      return sum + (Number.isFinite(v) ? Math.round(v) : 0);
    }, 0);
    const stripeFeesCentsFromReturned = returnedSincePayout.reduce((sum, r) => {
      const v = Number((r as any)?.stripe_fees || 0);
      return sum + (Number.isFinite(v) ? Math.round(v) : 0);
    }, 0);
    const storeEarningsCentsRaw = grossCents - returnedEarningsCents;
    const adjustedGrossCents = Math.max(0, storeEarningsCentsRaw);
    const stripeFeesCents =
      stripeFeesCentsFromPaid +
      stripeFeesCentsFromCancelled +
      stripeFeesCentsFromReturned;

    const payoutNetCentsRaw = Number(payoutNetCents);
    const payoutCents = Number.isFinite(payoutNetCentsRaw)
      ? Math.round(payoutNetCentsRaw)
      : NaN;
    if (!Number.isFinite(payoutCents) || payoutCents <= 0) {
      return res.status(400).json({ error: "Montant net invalide" });
    }
    if (payoutCents > storeEarningsCentsRaw) {
      return res
        .status(400)
        .json({ error: "Montant net supérieur au total net disponible" });
    }
    const payliveFeeCents = Math.max(0, storeEarningsCentsRaw - payoutCents);
    const platformFeeCents = Math.max(0, payliveFeeCents - stripeFeesCents);

    const country = ibanTrim.substring(0, 2).toUpperCase();
    const idempotencyBase = `payout_${storeId}_${
      lastPayoutTimestamp ? String(lastPayoutTimestamp) : "first"
    }_${adjustedGrossCents}`;

    let payout: any = null;
    let payoutError: any = null;
    let stripeAccountId: string | null = null;
    let destinationId: string | null = null;

    try {
      const account: any = await stripe.accounts.retrieve();
      stripeAccountId = String(account?.id || "").trim() || null;
      if (!stripeAccountId) throw new Error("Stripe account indisponible");

      const bankAccountName = String((store as any)?.name || "").trim();
      const externalAccount: any = await stripe.accounts.createExternalAccount(
        stripeAccountId,
        {
          external_account: {
            object: "bank_account",
            account_number: ibanTrim,
            country,
            currency: "eur",
            account_holder_name: bankAccountName || undefined,
          } as any,
          default_for_currency: true,
        } as any,
        { idempotencyKey: `${idempotencyBase}_external_account` } as any,
      );

      const connectAccountId = "acct_1RlSb5FvgBVqiF7V"; // ID du compte du vendeur

      destinationId = String(externalAccount?.id || "").trim() || null;
      if (!destinationId) throw new Error("Destination bancaire invalide");

      const externalAccounts = await stripe.accounts.listExternalAccounts(
        connectAccountId,
        { object: "bank_account", limit: 100 },
      );

      const validDestination = externalAccounts.data.some(
        (acc) => acc.id === destinationId,
      );
      if (!validDestination) {
        throw new Error(
          `La destination ${destinationId} n'appartient pas au compte ${connectAccountId}`,
        );
      }

      payout = await stripe.payouts.create(
        {
          amount: payoutCents,
          currency: "eur",
          method: "standard",
          destination: destinationId,
          description: `Payout PayLive - ${String((store as any)?.name || "")}`,
          metadata: {
            store_id: String(storeId),
            store_slug: String(decodedSlug),
            gross_cents: String(adjustedGrossCents),
            fee_cents: String(payliveFeeCents),
            stripe_fees_cents: String(stripeFeesCents),
            platform_fee_cents: String(platformFeeCents),
          },
        },
        {
          idempotencyKey: `${idempotencyBase}_payout`,
          stripeAccount: connectAccountId,
        },
      );
    } catch (e) {
      payoutError = e;
      try {
        await emailService.sendAdminError({
          subject: "Payout échoué (virement manuel)",
          message: `Le client souhaite faire un payout, mais Stripe a échoué. store_id=${storeId} slug=${decodedSlug}`,
          context: JSON.stringify(
            {
              storeId,
              storeName: String((store as any)?.name || "").trim() || null,
              storeSlug: decodedSlug,
              ownerEmail:
                String((store as any)?.owner_email || "").trim() || null,
              iban: ibanTrim,
              bic: bicTrim,
              feeCents: payliveFeeCents,
              stripeFeesCents,
              platformFeeCents,
              payoutCents,
              error: e instanceof Error ? e.message : String(e),
            },
            null,
            2,
          ),
        });
      } catch {}
    }

    const ibanBic = { iban: ibanTrim, bic: bicTrim };
    const payoutAtIso = new Date().toISOString();
    const lastFactureIdRaw = Number((store as any)?.payout_facture_id || 0);
    const nextFactureId =
      Number.isFinite(lastFactureIdRaw) && lastFactureIdRaw > 0
        ? Math.floor(lastFactureIdRaw) + 1
        : 1;

    const { data: updated, error: updErr } = await supabase
      .from("stores")
      .update({
        iban_bic: ibanBic,
        payout_created_at: payoutAtIso,
        payout_facture_id: nextFactureId,
      })
      .eq("id", storeId)
      .select(
        "id, name, slug, owner_email, iban_bic, payout_created_at, payout_facture_id, siret, address",
      )
      .single();

    if (updErr) {
      console.error("Erreur Supabase (update iban_bic):", updErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la mise à jour des infos bancaires" });
    }

    const formatPromoCodeForStore = (raw: any): string | null => {
      const tokens = String(raw || "")
        .split(";;")
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .filter((s) => !s.toUpperCase().startsWith("PAYLIVE-"));
      return tokens.length > 0 ? tokens.join(", ") : null;
    };

    const paidTransactions: any[] = paidShipments.map((r) => {
      const createdAt = String((r as any)?.created_at || "").trim();
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      const created = Number.isFinite(createdMs)
        ? Math.floor(createdMs / 1000)
        : 0;
      const paymentId = String((r as any)?.payment_id || "").trim() || "—";
      const customerId =
        String((r as any)?.customer_stripe_id || "").trim() || null;
      const netCentsRaw = Number((r as any)?.store_earnings_amount || 0);
      const netCents = Number.isFinite(netCentsRaw)
        ? Math.round(netCentsRaw)
        : 0;
      return {
        payment_id: paymentId,
        created,
        currency: "eur",
        customer: { id: customerId },
        product_reference:
          String((r as any)?.product_reference || "").trim() || null,
        promo_code: formatPromoCodeForStore((r as any)?.promo_code),
        status:
          String((r as any)?.status || "")
            .trim()
            .toUpperCase() || null,
        net_total: netCents / 100,
      };
    });

    const returnedTransactions: any[] = [];
    if (payoutsSinceIso) {
      const cutoffMs = new Date(payoutsSinceIso).getTime();
      for (const r of returnedSincePayout) {
        const createdAt = String((r as any)?.created_at || "").trim();
        const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
        if (!Number.isFinite(createdMs) || createdMs >= cutoffMs) continue;

        const deliveryAt = String((r as any)?.delivery_date || "").trim();
        const deliveryMs = deliveryAt ? new Date(deliveryAt).getTime() : NaN;
        const created =
          Number.isFinite(deliveryMs) && deliveryMs > 0
            ? Math.floor(deliveryMs / 1000)
            : 0;

        const paymentId = String((r as any)?.payment_id || "").trim() || "—";
        const customerId =
          String((r as any)?.customer_stripe_id || "").trim() || null;
        const netCentsRaw = Number((r as any)?.store_earnings_amount || 0);
        const netCents = Number.isFinite(netCentsRaw)
          ? Math.round(netCentsRaw)
          : 0;
        returnedTransactions.push({
          payment_id: paymentId,
          created,
          currency: "eur",
          customer: { id: customerId },
          product_reference:
            String((r as any)?.product_reference || "").trim() || null,
          promo_code: formatPromoCodeForStore((r as any)?.promo_code),
          status: "RETURNED",
          net_total: -Math.abs(netCents) / 100,
        });
      }
    }

    const transactions: any[] = [
      ...paidTransactions,
      ...returnedTransactions,
    ].sort(
      (a, b) =>
        Number((b as any)?.created || 0) - Number((a as any)?.created || 0),
    );

    const pdfTotalNetCents = transactions.reduce((sum, tx) => {
      const v = Number((tx as any)?.net_total ?? 0);
      return sum + (Number.isFinite(v) ? Math.round(v * 100) : 0);
    }, 0);
    const pdfFeeCents = Math.max(0, pdfTotalNetCents - payoutCents);

    const extractStripeProductIds = (raw: any): string[] =>
      String(raw || "")
        .split(";")
        .map((s) => String(s || "").trim())
        .filter((s) => s.startsWith("prod_"));

    const parseProductReferenceItems = (
      raw: string | null | undefined,
    ): Array<{
      reference: string;
      quantity: number;
      description?: string | null;
    }> => {
      const txt = String(raw || "").trim();
      if (!txt) return [];
      const parts = txt
        .split(";")
        .map((s) => String(s || "").trim())
        .filter(Boolean);

      const onlyStripeIds =
        parts.length > 0 &&
        parts.every((p) => String(p || "").startsWith("prod_"));
      if (onlyStripeIds) {
        const counts = new Map<string, number>();
        for (const pid of parts) {
          const id = String(pid || "").trim();
          if (!id) continue;
          counts.set(id, (counts.get(id) || 0) + 1);
        }
        return Array.from(counts.entries()).map(([reference, quantity]) => ({
          reference,
          quantity,
          description: null,
        }));
      }

      const m = new Map<
        string,
        { quantity: number; description?: string | null }
      >();
      for (const p of parts) {
        const seg = String(p || "").trim();
        if (!seg) continue;

        let reference = "";
        let quantity = 1;
        let description: string | null = null;

        if (seg.includes("**")) {
          const [refRaw, restRaw] = seg.split("**");
          reference = String(refRaw || "").trim();
          const rest = String(restRaw || "").trim();
          const match = rest.match(/^(\d+)(?:@(\d+))?\s*(?:\((.*)\))?$/);
          if (match) {
            const q = Number(match[1]);
            quantity = Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
            const descRaw = String(match[3] || "").trim();
            description = descRaw || null;
          } else {
            const qLoose = Number(rest);
            quantity =
              Number.isFinite(qLoose) && qLoose > 0 ? Math.floor(qLoose) : 1;
          }
        } else {
          reference = seg;
          quantity = 1;
        }

        if (!reference) continue;
        const prev = m.get(reference) || { quantity: 0, description: null };
        m.set(reference, {
          quantity: prev.quantity + quantity,
          description: description || prev.description || null,
        });
      }

      return Array.from(m.entries()).map(([reference, v]) => ({
        reference,
        quantity: Math.max(1, Number(v.quantity || 1)),
        description: v.description || null,
      }));
    };

    const formatArticlesFromIds = (
      raw: any,
      productsById: Map<
        string,
        { id: string; name?: string | null; unit_amount_cents?: number | null }
      >,
    ): string | null => {
      const ids = extractStripeProductIds(raw);
      if (ids.length === 0) return null;
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
      const parts: string[] = [];
      for (const [id, qty] of counts.entries()) {
        const p = productsById.get(id) || null;
        const label = String(p?.name || "").trim() || id;
        const base = qty > 1 ? `${label}(x${qty})` : label;
        const unit =
          typeof p?.unit_amount_cents === "number" &&
          Number.isFinite(p.unit_amount_cents) &&
          p.unit_amount_cents > 0
            ? p.unit_amount_cents
            : null;
        parts.push(
          unit != null ? `${base} — ${(unit / 100).toFixed(2)}€` : base,
        );
      }
      return parts.length > 0 ? parts.join(", ") : null;
    };

    const formatArticlesDetailFromRaw = (
      raw: string | null | undefined,
      productsById: Map<
        string,
        { id: string; name?: string | null; unit_amount_cents?: number | null }
      >,
    ): string | null => {
      const items = parseProductReferenceItems(raw);
      if (items.length === 0) return null;
      const lines: string[] = [];
      for (const it of items) {
        const ref = String(it.reference || "").trim();
        if (!ref) continue;
        const p = ref.startsWith("prod_")
          ? productsById.get(ref) || null
          : null;
        const label = String(p?.name || "").trim() || ref;
        const qty = Math.max(1, Number(it.quantity || 1));
        const price =
          typeof p?.unit_amount_cents === "number" &&
          Number.isFinite(p.unit_amount_cents) &&
          p.unit_amount_cents > 0
            ? `${(p.unit_amount_cents / 100).toFixed(2)}€`
            : "";
        const desc = String(it.description || "").trim();
        lines.push(label);
        const detail = [desc, `qté: ${qty}`, price].filter(Boolean).join(" — ");
        if (detail) lines.push(detail);
      }
      return lines.length > 0 ? lines.join("\n") : null;
    };

    const uniqueStripeProductIds = Array.from(
      new Set(
        transactions.flatMap((t) =>
          extractStripeProductIds(t.product_reference),
        ),
      ),
    );
    const stripeProductsById = new Map<
      string,
      { id: string; name?: string | null; unit_amount_cents?: number | null }
    >();
    if (uniqueStripeProductIds.length > 0) {
      let idx = 0;
      const maxConcurrent = 10;
      const workers = new Array(maxConcurrent).fill(null).map(async () => {
        while (idx < uniqueStripeProductIds.length) {
          const i = idx++;
          const pid = uniqueStripeProductIds[i];
          try {
            const p = (await stripe.products.retrieve(pid, {
              expand: ["default_price"],
            } as any)) as any;
            if (!p || p.deleted) continue;
            const dp: any = p.default_price;
            const unitAmount =
              dp && typeof dp === "object" ? Number(dp.unit_amount || 0) : null;
            stripeProductsById.set(pid, {
              id: String(p.id || pid),
              name: String(p.name || "").trim() || null,
              unit_amount_cents:
                typeof unitAmount === "number" && Number.isFinite(unitAmount)
                  ? unitAmount
                  : null,
            });
          } catch (_e) {}
        }
      });
      await Promise.all(workers);
    }

    for (const t of transactions) {
      (t as any).articles = formatArticlesFromIds(
        (t as any)?.product_reference,
        stripeProductsById,
      );
      (t as any).articles_detail = formatArticlesDetailFromRaw(
        (t as any)?.product_reference,
        stripeProductsById,
      );
    }

    const uniqueCustomerStripeIds = Array.from(
      new Set(
        transactions
          .map((t) => String((t as any)?.customer?.id || "").trim())
          .filter((id) => id.startsWith("cus_")),
      ),
    );
    const stripeCustomersById = new Map<
      string,
      { id: string; name?: string | null; email?: string | null }
    >();
    if (uniqueCustomerStripeIds.length > 0) {
      await mapWithLimit(uniqueCustomerStripeIds, 10, async (cid) => {
        try {
          const c = (await stripe.customers.retrieve(cid)) as any;
          if (!c || c.deleted) return null as any;
          stripeCustomersById.set(cid, {
            id: String(c.id || cid),
            name: String(c.name || "").trim() || null,
            email: String(c.email || "").trim() || null,
          });
        } catch (_e) {}
        return null as any;
      });
    }

    for (const t of transactions) {
      const cid = String((t as any)?.customer?.id || "").trim();
      const c = cid ? stripeCustomersById.get(cid) || null : null;
      const email = String(c?.email || "").trim();
      const name = String(c?.name || "").trim();
      (t as any).customer_name = name || (email ? email : null);
      (t as any).customer_email = email || null;
    }

    const storeName = String((store as any)?.name || "").trim() || "—";
    const storeOwnerEmail = String(
      (updated as any)?.owner_email || (store as any)?.owner_email || "",
    ).trim();
    const createdMsValues = payoutShipments
      .map((r) => {
        const createdAt = String((r as any)?.created_at || "").trim();
        const ms = createdAt ? new Date(createdAt).getTime() : NaN;
        return Number.isFinite(ms) && ms > 0 ? ms : NaN;
      })
      .filter((v) => Number.isFinite(v) && v > 0) as number[];
    const minCreatedMs =
      createdMsValues.length > 0 ? Math.min(...createdMsValues) : NaN;
    const maxCreatedMs =
      createdMsValues.length > 0 ? Math.max(...createdMsValues) : NaN;
    const periodStart = Number.isFinite(minCreatedMs)
      ? new Date(minCreatedMs)
      : null;
    const periodEnd = Number.isFinite(maxCreatedMs)
      ? new Date(maxCreatedMs)
      : new Date(payoutAtIso);
    const issueDate = new Date(payoutAtIso);

    const dtShort = new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dtLong = new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const moneyFmt = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
    });

    const invoiceId = `PL-${issueDate.getFullYear()}-${String(nextFactureId).padStart(5, "0")}`;

    let logoBuffer: Buffer | null = null;
    try {
      const logoPath = path.join(process.cwd(), "public", "logo_bis.png");
      if (fs.existsSync(logoPath)) {
        const buf = fs.readFileSync(logoPath);
        if (buf.length > 0) logoBuffer = buf;
      }
    } catch {}

    const pdfBuffer: Buffer = await (async () => {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const margin = 40;
      const x = margin;
      const tableW = doc.page.width - margin * 2;
      let y = margin;

      const drawFooter = () => {
        try {
          const footerY = doc.page.height - margin - 12;
          doc.fillColor("#6B7280").fontSize(8);
          doc.text("© 2026 ", x, footerY, { continued: true });
          doc.fillColor("#2563EB").text("PayLive", {
            link: "https://paylive.cc",
            underline: false,
            continued: true,
          });
          doc.fillColor("#6B7280").text(" - Tous droits réservés");
        } catch {}
      };

      const addPage = () => {
        drawFooter();
        doc.addPage();
        y = margin;
      };

      if (logoBuffer) {
        try {
          doc.image(logoBuffer, x, y, { fit: [70, 40] });
        } catch {}
      }

      doc.fillColor("#111827");
      doc.fontSize(16).text(`Facture n° ${invoiceId}`, x, y, {
        align: "right",
      });
      doc
        .fontSize(10)
        .fillColor("#374151")
        .text(`Date d’émission : ${dtLong.format(issueDate)}`, x, y + 20, {
          align: "right",
        });

      y += 60;
      doc.save();
      doc.lineWidth(1).strokeColor("#E5E7EB");
      doc
        .moveTo(x, y)
        .lineTo(doc.page.width - margin, y)
        .stroke();
      doc.restore();

      y += 14;
      const boxW = (doc.page.width - margin * 2 - 20) / 2;
      const rightX = x + boxW + 20;

      doc.fillColor("#111827").fontSize(10).text("Émetteur", x, y);
      doc.fillColor("#111827").fontSize(10).text("Client", rightX, y, {
        align: "right",
        width: boxW,
      });

      y += 14;
      doc.fillColor("#374151").fontSize(9);
      const issuerText = [
        "SAAD BENDAOUD (EI)",
        "PayLive (by PixSaaS)",
        "42 Rue Bernard Ortet",
        "31500 Toulouse, FR",
        "contact@paylive.cc",
        "www.paylive.cc",
        "SIREN : 983 708 637",
      ].join("\n");

      const storeSiret = sanitizeOneLine(
        String((updated as any)?.siret || (store as any)?.siret || ""),
      );
      const storeAddr =
        (updated as any)?.address || (store as any)?.address || null;
      const addrLine1 = sanitizeOneLine(String(storeAddr?.line1 || ""));
      const addrLine2 = sanitizeOneLine(String(storeAddr?.line2 || ""));
      const addrPostal = sanitizeOneLine(String(storeAddr?.postal_code || ""));
      const addrCity = sanitizeOneLine(String(storeAddr?.city || ""));
      const addrCountry = sanitizeOneLine(String(storeAddr?.country || ""));
      const storePhone = sanitizeOneLine(String(storeAddr?.phone || ""));

      const clientLines: string[] = [];
      clientLines.push(storeName);
      if (storeSiret) clientLines.push(`SIRET : ${storeSiret}`);
      const addrFirst = [addrLine1, addrLine2].filter(Boolean).join(", ");
      const addrSecond = [addrPostal, addrCity].filter(Boolean).join(" ");
      const addrThird = addrCountry || "FR";
      if (addrFirst) clientLines.push(addrFirst);
      if (addrSecond || addrThird)
        clientLines.push([addrSecond, addrThird].filter(Boolean).join(", "));
      if (storePhone) clientLines.push(`Téléphone : ${storePhone}`);
      if (storeOwnerEmail) clientLines.push(storeOwnerEmail);
      const clientText = clientLines.join("\n");

      doc.text(issuerText, x, y, { width: boxW });
      doc.text(clientText || "—", rightX, y, { width: boxW, align: "right" });

      const leftH = doc.heightOfString(issuerText, { width: boxW });
      const rightH = doc.heightOfString(clientText || "—", { width: boxW });
      y += Math.max(leftH, rightH) + 10;

      doc
        .fillColor("#374151")
        .fontSize(9)
        .text(
          `Période : Du ${periodStart ? dtShort.format(periodStart) : "—"} au ${dtShort.format(periodEnd)}`,
          x,
          y,
          { width: tableW },
        );

      y += 26;

      const totalsBoxW = 240;
      const totalsBoxX = doc.page.width - margin - totalsBoxW;
      const totalsLabelW = 140;
      const totalsValueX = totalsBoxX + totalsLabelW;
      const totalsValueW = totalsBoxW - totalsLabelW;

      doc.fillColor("#111827").fontSize(10).text("Total net", totalsBoxX, y, {
        width: totalsLabelW,
      });
      doc
        .fillColor("#111827")
        .fontSize(10)
        .text(moneyFmt.format(pdfTotalNetCents / 100), totalsValueX, y, {
          width: totalsValueW,
          align: "right",
        });

      y += 14;
      doc
        .fillColor("#374151")
        .fontSize(9)
        .text("Frais PayLive", totalsBoxX, y, { width: totalsLabelW });
      doc
        .fillColor("#374151")
        .fontSize(9)
        .text(moneyFmt.format(pdfFeeCents / 100), totalsValueX, y, {
          width: totalsValueW,
          align: "right",
        });

      y += 16;
      doc
        .fillColor("#111827")
        .fontSize(12)
        .text("Montant viré", totalsBoxX, y, { width: totalsLabelW });
      doc
        .fillColor("#111827")
        .fontSize(12)
        .text(moneyFmt.format(payoutCents / 100), totalsValueX, y, {
          width: totalsValueW,
          align: "right",
        });

      y += 26;
      doc.fillColor("#111827").fontSize(11).text("Transactions", x, y);
      y += 12;

      const rowH = 28;
      const rowTextY = 8;
      const colDateW = 72;
      const colNetW = 80;
      const colPromoW = 90;
      const colClientW = 130;
      const colArticlesW = tableW - colDateW - colClientW - colPromoW - colNetW;

      const drawSummaryHeader = () => {
        doc.save();
        doc.fillColor("#F3F4F6").rect(x, y, tableW, rowH).fill();
        doc.restore();
        doc.save();
        doc
          .strokeColor("#E5E7EB")
          .lineWidth(1)
          .rect(x, y, tableW, rowH)
          .stroke();
        doc.restore();
        doc.fillColor("#111827").fontSize(9);
        doc.text("Date", x + 6, y + rowTextY, { width: colDateW - 12 });
        doc.text("Client", x + colDateW + 6, y + rowTextY, {
          width: colClientW - 12,
        });
        doc.text("Articles", x + colDateW + colClientW + 6, y + rowTextY, {
          width: colArticlesW - 12,
        });
        doc.text(
          "Code Promo",
          x + colDateW + colClientW + colArticlesW + 6,
          y + rowTextY,
          { width: colPromoW - 12 },
        );
        doc.text(
          "Net",
          x + colDateW + colClientW + colArticlesW + colPromoW,
          y + rowTextY,
          { width: colNetW - 6, align: "right" },
        );
        y += rowH;
      };

      const drawSummaryRow = (row: {
        date: string;
        client: string;
        articles: string;
        promo: string;
        net: string;
      }) => {
        const padY = 6;
        const padX = 6;
        doc.fillColor("#111827").fontSize(9);
        const dateH = doc.heightOfString(row.date, {
          width: colDateW - padX * 2,
        });
        const clientH = doc.heightOfString(row.client, {
          width: colClientW - padX * 2,
        });
        const articlesH = doc.heightOfString(row.articles, {
          width: colArticlesW - padX * 2,
        });
        const promoH = doc.heightOfString(row.promo, {
          width: colPromoW - padX * 2,
        });
        const netH = doc.heightOfString(row.net, { width: colNetW - padX });
        const nextRowH =
          Math.max(dateH, clientH, articlesH, promoH, netH) + padY * 2;

        doc.save();
        doc
          .strokeColor("#E5E7EB")
          .lineWidth(1)
          .rect(x, y, tableW, nextRowH)
          .stroke();
        doc.restore();
        doc.fillColor("#111827").fontSize(9);
        const textY = y + padY;
        doc.text(row.date, x + padX, textY, { width: colDateW - padX * 2 });
        doc.text(row.client, x + colDateW + padX, textY, {
          width: colClientW - padX * 2,
        });
        doc.text(row.articles, x + colDateW + colClientW + padX, textY, {
          width: colArticlesW - padX * 2,
        });
        doc.text(
          row.promo,
          x + colDateW + colClientW + colArticlesW + padX,
          textY,
          { width: colPromoW - padX * 2 },
        );
        doc.text(
          row.net,
          x + colDateW + colClientW + colArticlesW + colPromoW,
          textY,
          {
            width: colNetW - 6,
            align: "right",
          },
        );
        y += nextRowH;
      };

      drawSummaryHeader();
      for (const tx of transactions) {
        if (y > doc.page.height - margin - 90) {
          addPage();
          doc
            .fillColor("#111827")
            .fontSize(11)
            .text("Transactions (suite)", x, y);
          y += 12;
          drawSummaryHeader();
        }

        const createdTs = Number((tx as any)?.created || 0);
        const dateText = createdTs
          ? dtShort.format(new Date(createdTs * 1000))
          : "—";
        const clientName = sanitizeOneLine(
          String((tx as any)?.customer_name || ""),
        );
        const clientEmail = sanitizeOneLine(
          String((tx as any)?.customer_email || ""),
        );
        const clientLine1 = clientName || clientEmail || "—";
        const clientLine2 =
          clientEmail && clientEmail !== clientLine1 ? clientEmail : "—";
        const clientText = `${clientLine1}\n${clientLine2}`;
        const articles = sanitizeOneLine(
          String((tx as any)?.articles_detail || ""),
        )
          ? String((tx as any)?.articles_detail)
          : sanitizeOneLine(
              String(
                (tx as any)?.articles || (tx as any)?.product_reference || "—",
              ),
            );
        const promo = sanitizeOneLine(String((tx as any)?.promo_code || "—"));
        const netText = moneyFmt.format(Number((tx as any)?.net_total || 0));

        drawSummaryRow({
          date: dateText,
          client: clientText,
          articles: articles || "—",
          promo,
          net: netText,
        });
      }

      drawFooter();
      return collectPdf(doc);
    })();

    const pdfBase64 = pdfBuffer.toString("base64");
    const fileName = `facture_${invoiceId}_${payoutAtIso.slice(0, 10)}.pdf`;

    try {
      const ownerEmail = String(
        (updated as any)?.owner_email || storeOwnerEmail || "",
      ).trim();
      if (ownerEmail) {
        await emailService.sendPayoutConfirmationToStoreOwner({
          ownerEmail,
          storeName,
          storeSlug: decodedSlug,
          periodStart: periodStart ? dtLong.format(periodStart) : null,
          periodEnd: dtLong.format(periodEnd),
          storeSiret: sanitizeOneLine(
            String((updated as any)?.siret || (store as any)?.siret || ""),
          ),
          storeAddress:
            (updated as any)?.address || (store as any)?.address || null,
          grossAmount: adjustedGrossCents / 100,
          feeAmount: payliveFeeCents / 100,
          payoutAmount: payoutCents / 100,
          currency: "EUR",
          attachments: [
            {
              filename: fileName,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
      }
    } catch (e) {
      console.error("Erreur envoi email versement:", e);
    }

    return res.json({
      success: true,
      store: updated,
      payout: {
        gross_cents: adjustedGrossCents,
        fee_cents: payliveFeeCents,
        payout_cents: payoutCents,
        currency: "eur",
        recipient_id: stripeAccountId || null,
        payment_id: payout?.id || null,
        status: payout?.status || (payoutError ? "FAILED" : null),
        destination_id: destinationId || null,
        error: payoutError
          ? payoutError instanceof Error
            ? payoutError.message
            : String(payoutError)
          : null,
      },
      pdf: { fileName, base64: pdfBase64 },
    });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.get("/:storeSlug/transactions", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    const maxLimit = 5000;
    const limitParam = String(req.query.limit ?? "")
      .trim()
      .toLowerCase();
    const limitAll = limitParam === "all";
    const limitNum = limitAll || limitParam === "" ? NaN : Number(limitParam);
    const limit = Number.isFinite(limitNum)
      ? Math.max(1, Math.min(maxLimit, Math.floor(limitNum)))
      : 50;

    const startDateRaw = String(req.query.startDate || "").trim();
    let startTimestamp: number | undefined = undefined;
    if (startDateRaw) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDateRaw);
      if (m) {
        const iso = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
        if (!Number.isNaN(iso.getTime())) {
          startTimestamp = Math.floor(iso.getTime() / 1000);
        }
      }
    }

    const startTimestampRaw = String(req.query.startTimestamp ?? "").trim();
    if (startTimestampRaw) {
      const ts = Number(startTimestampRaw);
      if (Number.isFinite(ts) && ts > 0) {
        startTimestamp = Math.floor(ts);
      }
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const ownerStripeId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!ownerStripeId) {
      return res.status(400).json({ error: "stripe_id manquant" });
    }

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug, clerk_id, owner_email, stripe_id")
      .eq("stripe_id", ownerStripeId)
      .maybeSingle();

    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      console.error("Erreur Supabase (get store):", storeErr);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération de la boutique" });
    }
    if (!store) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    if (String((store as any)?.slug || "") !== decodedSlug) {
      return res.status(404).json({ error: "Boutique non trouvée" });
    }

    let authorized = Boolean(
      (store as any)?.clerk_id && (store as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String(
          (store as any)?.owner_email || "",
        ).toLowerCase();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const storeId = (store as any).id as number;
    const formatPromoCodeForStore = (raw: any): string | null => {
      const tokens = String(raw || "")
        .split(";;")
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .filter((s) => !s.toUpperCase().startsWith("PAYLIVE-"));
      return tokens.length > 0 ? tokens.join(", ") : null;
    };

    const startIso =
      typeof startTimestamp === "number" &&
      Number.isFinite(startTimestamp) &&
      startTimestamp > 0
        ? new Date(startTimestamp * 1000).toISOString()
        : null;

    const cutoffMs = startIso ? new Date(startIso).getTime() : NaN;
    const baseSelect =
      "payment_id, created_at, delivery_date, customer_stripe_id, product_reference, promo_code, store_earnings_amount, status, stripe_fees";

    const mainRows: any[] = [];
    const pageSizeDb = 1000;
    for (let from = 0; ; from += pageSizeDb) {
      let q = supabase
        .from("shipments")
        .select(baseSelect)
        .eq("store_id", storeId)
        .eq("is_final_destination", true)
        .or("status.is.null,status.neq.CANCELLED")
        .not("payment_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      if (startIso) q = q.gte("created_at", startIso);

      const { data, error } = await q;
      if (error) {
        console.error("Erreur Supabase (list shipments transactions):", error);
        return res.status(500).json({ error: error.message });
      }

      const rows = Array.isArray(data) ? data : [];
      mainRows.push(...rows);
      if (rows.length < pageSizeDb) break;
    }

    const cancelledRows: any[] = [];
    for (let from = 0; ; from += pageSizeDb) {
      let q = supabase
        .from("shipments")
        .select(baseSelect)
        .eq("store_id", storeId)
        .eq("status", "CANCELLED")
        .not("payment_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      if (startIso) q = q.gte("created_at", startIso);

      const { data, error } = await q;
      if (error) {
        console.error("Erreur Supabase (list cancelled shipments):", error);
        return res.status(500).json({ error: error.message });
      }

      const rows = Array.isArray(data) ? data : [];
      cancelledRows.push(...rows);
      if (rows.length < pageSizeDb) break;
    }

    const returnedAdjustRows: any[] = [];
    if (startIso) {
      for (let from = 0; ; from += pageSizeDb) {
        let q = supabase
          .from("shipments")
          .select(baseSelect)
          .eq("store_id", storeId)
          .eq("is_final_destination", true)
          .eq("status", "RETURNED")
          .not("payment_id", "is", null)
          .not("delivery_date", "is", null)
          .gte("delivery_date", startIso)
          .lt("created_at", startIso)
          .order("delivery_date", { ascending: false })
          .range(from, from + pageSizeDb - 1);

        const { data, error } = await q;
        if (error) {
          if ((error as any)?.code === "42703") break;
          console.error(
            "Erreur Supabase (list returned shipments adjustments):",
            error,
          );
          return res.status(500).json({ error: error.message });
        }

        const rows = Array.isArray(data) ? data : [];
        returnedAdjustRows.push(...rows);
        if (rows.length < pageSizeDb) break;
      }
    }

    const mergedRows: any[] = [
      ...mainRows,
      ...cancelledRows,
      ...returnedAdjustRows,
    ];
    mergedRows.sort((a, b) => {
      const aStatus = String((a as any)?.status || "")
        .trim()
        .toUpperCase();
      const bStatus = String((b as any)?.status || "")
        .trim()
        .toUpperCase();

      const aCreatedAt =
        aStatus === "RETURNED" &&
        startIso &&
        Number.isFinite(cutoffMs) &&
        (() => {
          const raw = String((a as any)?.created_at || "").trim();
          const ms = raw ? new Date(raw).getTime() : NaN;
          return Number.isFinite(ms) && ms < cutoffMs;
        })()
          ? String((a as any)?.delivery_date || "").trim()
          : String((a as any)?.created_at || "").trim();
      const bCreatedAt =
        bStatus === "RETURNED" &&
        startIso &&
        Number.isFinite(cutoffMs) &&
        (() => {
          const raw = String((b as any)?.created_at || "").trim();
          const ms = raw ? new Date(raw).getTime() : NaN;
          return Number.isFinite(ms) && ms < cutoffMs;
        })()
          ? String((b as any)?.delivery_date || "").trim()
          : String((b as any)?.created_at || "").trim();

      const aMs = aCreatedAt ? new Date(aCreatedAt).getTime() : NaN;
      const bMs = bCreatedAt ? new Date(bCreatedAt).getTime() : NaN;
      const ax = Number.isFinite(aMs) ? aMs : 0;
      const bx = Number.isFinite(bMs) ? bMs : 0;
      return bx - ax;
    });

    const transactions: any[] = [];
    let totalCount = 0;
    let totalNet = 0;
    const seen = new Set<string>();
    for (const r of mergedRows) {
      const paymentId = String((r as any)?.payment_id || "").trim() || "—";
      const dedupeKey = paymentId;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const st = String((r as any)?.status || "")
        .trim()
        .toUpperCase();
      const createdAtRaw = String((r as any)?.created_at || "").trim();
      const createdAtMs = createdAtRaw ? new Date(createdAtRaw).getTime() : NaN;
      const createdBeforeCutoff =
        startIso &&
        Number.isFinite(cutoffMs) &&
        Number.isFinite(createdAtMs) &&
        createdAtMs < cutoffMs;

      const effectiveAtRaw =
        st === "RETURNED" && createdBeforeCutoff
          ? String((r as any)?.delivery_date || "").trim() || createdAtRaw
          : createdAtRaw;
      const effectiveMs = effectiveAtRaw
        ? new Date(effectiveAtRaw).getTime()
        : NaN;
      const created =
        Number.isFinite(effectiveMs) && effectiveMs > 0
          ? Math.floor(effectiveMs / 1000)
          : 0;

      const netCentsRaw = Number((r as any)?.store_earnings_amount || 0);
      const netEur = Number.isFinite(netCentsRaw) ? netCentsRaw / 100 : 0;
      const netTotal =
        st === "CANCELLED"
          ? 0
          : st === "RETURNED"
            ? createdBeforeCutoff
              ? -Math.abs(netEur)
              : 0
            : netEur;

      totalCount += 1;
      totalNet += netTotal;

      if (limitAll || transactions.length < limit) {
        const stripeFeesRaw = Number((r as any)?.stripe_fees ?? NaN);
        const stripeFeesCents = Number.isFinite(stripeFeesRaw)
          ? Math.round(stripeFeesRaw)
          : null;
        transactions.push({
          payment_id: paymentId,
          created,
          currency: "eur",
          customer: {
            id: String((r as any)?.customer_stripe_id || "").trim() || null,
          },
          product_reference:
            String((r as any)?.product_reference || "").trim() || null,
          promo_code: formatPromoCodeForStore((r as any)?.promo_code),
          status: st || null,
          stripe_fees: stripeFeesCents,
          net_total: netTotal,
        });
      }
    }

    const extractStripeProductIds = (raw: any): string[] =>
      String(raw || "")
        .split(";")
        .map((s) => String(s || "").trim())
        .filter((s) => s.startsWith("prod_"));

    const formatArticlesFromIds = (
      raw: any,
      productsById: Map<
        string,
        { id: string; name?: string | null; unit_amount_cents?: number | null }
      >,
    ): string | null => {
      const ids = extractStripeProductIds(raw);
      if (ids.length === 0) return null;
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
      const parts: string[] = [];
      for (const [id, qty] of counts.entries()) {
        const p = productsById.get(id) || null;
        const label = String(p?.name || "").trim() || id;
        const base = qty > 1 ? `${label}(x${qty})` : label;
        const unit =
          typeof p?.unit_amount_cents === "number" &&
          Number.isFinite(p.unit_amount_cents) &&
          p.unit_amount_cents > 0
            ? p.unit_amount_cents
            : null;
        parts.push(
          unit != null ? `${base} — ${(unit / 100).toFixed(2)}€` : base,
        );
      }
      return parts.length > 0 ? parts.join(", ") : null;
    };

    const uniqueStripeProductIds = Array.from(
      new Set(
        transactions.flatMap((t) =>
          extractStripeProductIds(t.product_reference),
        ),
      ),
    );
    const stripeProductsById = new Map<
      string,
      { id: string; name?: string | null; unit_amount_cents?: number | null }
    >();
    if (uniqueStripeProductIds.length > 0) {
      let idx = 0;
      const maxConcurrent = 10;
      const workers = new Array(maxConcurrent).fill(null).map(async () => {
        while (idx < uniqueStripeProductIds.length) {
          const i = idx++;
          const pid = uniqueStripeProductIds[i];
          try {
            const p = (await stripe.products.retrieve(pid, {
              expand: ["default_price"],
            } as any)) as any;
            if (!p || p.deleted) continue;
            const dp: any = p.default_price;
            const unitAmount =
              dp && typeof dp === "object" ? Number(dp.unit_amount || 0) : null;
            stripeProductsById.set(pid, {
              id: String(p.id || pid),
              name: String(p.name || "").trim() || null,
              unit_amount_cents:
                typeof unitAmount === "number" && Number.isFinite(unitAmount)
                  ? unitAmount
                  : null,
            });
          } catch (_e) {}
        }
      });
      await Promise.all(workers);
    }
    for (const t of transactions) {
      (t as any).articles = formatArticlesFromIds(
        (t as any)?.product_reference,
        stripeProductsById,
      );
    }

    return res.json({
      success: true,
      storeSlug: decodedSlug,
      startDate: startDateRaw || null,
      total_count: totalCount,
      total_net: totalNet,
      count: transactions.length,
      transactions,
    });
  } catch (err) {
    console.error("Erreur serveur:", err);
    return res.status(500).json({ error: "Erreur interne du serveur" });
  }
});

router.post("/:storeSlug/stock/products", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug, clerk_id, owner_email, name")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    let authorized = Boolean(
      (storeRow as any)?.clerk_id && (storeRow as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String((storeRow as any)?.owner_email || "")
          .toLowerCase()
          .trim();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const {
      title,
      reference,
      description,
      quantity,
      weight,
      image_url,
      price,
    }: {
      title?: string;
      reference?: string;
      description?: string;
      quantity?: number | string;
      weight?: number | string | null;
      image_url?: string | null;
      price?: number | string;
    } = req.body || {};

    const titleTrim = String(title || "").trim();
    const referenceTrim = String(reference || "").trim();
    const descTrim = String(description || "").trim();
    const imageUrlTrim = String(image_url || "").trim();

    if (!titleTrim) {
      return res.status(400).json({ error: "Titre requis" });
    }
    if (!referenceTrim) {
      return res.status(400).json({ error: "Référence requise" });
    }
    if (!descTrim) {
      return res.status(400).json({ error: "Description requise" });
    }

    const qtyRaw =
      typeof quantity === "number"
        ? quantity
        : typeof quantity === "string"
          ? parseInt(quantity.trim(), 10)
          : NaN;
    const normalizedQty =
      Number.isFinite(qtyRaw) && qtyRaw >= 0 ? Math.floor(qtyRaw) : NaN;
    if (!Number.isFinite(normalizedQty) || normalizedQty < 0) {
      return res.status(400).json({ error: "Quantité invalide (>= 0)" });
    }

    const weightRaw =
      typeof weight === "number"
        ? weight
        : typeof weight === "string"
          ? parseFloat(weight.trim().replace(",", "."))
          : weight === null
            ? null
            : NaN;
    if (
      weightRaw === null ||
      (typeof weight === "string" && weight.trim() === "")
    ) {
      return res.status(400).json({ error: "Poids requis" });
    }
    const normalizedWeight =
      Number.isFinite(weightRaw) && weightRaw >= 0 ? weightRaw : NaN;
    if (!Number.isFinite(normalizedWeight) || normalizedWeight < 0) {
      return res.status(400).json({ error: "Poids invalide (>= 0)" });
    }

    const priceRaw =
      typeof price === "number"
        ? price
        : typeof price === "string"
          ? parseFloat(price.trim().replace(",", "."))
          : NaN;
    const normalizedPrice =
      Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : NaN;
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return res.status(400).json({ error: "Prix invalide (> 0)" });
    }
    const unitAmountCents = Math.round(normalizedPrice * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 1) {
      return res.status(400).json({ error: "Prix invalide (>= 0,01€)" });
    }

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const imageUrlsRaw = imageUrlTrim
      ? imageUrlTrim
          .split(",")
          .map((u) => String(u || "").trim())
          .filter(Boolean)
      : [];

    const normalizedImageUrls: string[] = [];
    for (const u of imageUrlsRaw) {
      try {
        const parsed = new URL(u);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return res.status(400).json({ error: "URL image invalide" });
        }
        normalizedImageUrls.push(parsed.toString());
      } catch {
        return res.status(400).json({ error: "URL image invalide" });
      }
    }

    const imageUrlJoined =
      normalizedImageUrls.length > 0
        ? Array.from(new Set(normalizedImageUrls)).join(",")
        : null;

    const product = await stripe.products.create({
      name: titleTrim,
      description: descTrim,
      active: true,
      ...(normalizedImageUrls.length > 0
        ? { images: Array.from(new Set(normalizedImageUrls)).slice(0, 8) }
        : {}),
      metadata: {
        store_id: String(storeId),
        product_reference: referenceTrim,
        quantity: String(normalizedQty),
        price_eur: String(normalizedPrice),
      },
    } as any);

    const stripeProductId = String((product as any)?.id || "").trim();
    if (!stripeProductId || !stripeProductId.startsWith("prod_")) {
      return res.status(500).json({ error: "Création Stripe invalide" });
    }

    let stripePrice: any = null;
    try {
      stripePrice = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: unitAmountCents,
        currency: "eur",
      } as any);
    } catch {
      return res.status(500).json({ error: "Création prix Stripe invalide" });
    }
    try {
      await stripe.products.update(stripeProductId, {
        default_price: String((stripePrice as any)?.id || ""),
      } as any);
    } catch {
      return res.status(500).json({ error: "Mise à jour Stripe invalide" });
    }

    const stockPayload: any = {
      store_id: storeId,
      product_reference: referenceTrim,
      quantity: normalizedQty,
      weight: normalizedWeight,
      image_url: imageUrlJoined,
      product_stripe_id: stripeProductId,
    };

    let stockInserted: any = null;
    let stockInsertErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .insert([stockPayload])
        .select("*")
        .single();
      stockInserted = resp.data as any;
      stockInsertErr = resp.error as any;
    }
    if (stockInsertErr) {
      return res.status(500).json({ error: stockInsertErr.message });
    }

    return res.status(201).json({
      success: true,
      stock: stockInserted,
      product,
      price: stripePrice,
    });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    console.error("Error creating stock product:", e);
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.get("/:storeSlug/stock/search", async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);
    const qRaw = (req.query.q as string) || (req.query.query as string) || "";
    const q = String(qRaw || "").trim();
    if (q.length < 2) {
      return res.json({ success: true, items: [] });
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const stockSelect =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";

    let stockRows: any[] | null = null;
    let stockErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .select(stockSelect)
        .eq("store_id", storeId)
        .ilike("product_reference", `%${q}%`)
        .order("product_reference", { ascending: true })
        .limit(10);
      stockRows = resp.data as any;
      stockErr = resp.error as any;
    }
    if (stockErr) return res.status(500).json({ error: stockErr.message });

    const rows = Array.isArray(stockRows) ? stockRows : [];

    const items = await Promise.all(
      rows.map(async (r: any) => {
        const raw = (r as any)?.product_stripe_id;
        const asString = String(raw ?? "").trim();
        let product: any = null;
        let unit_price: number | null = null;
        try {
          if (asString && asString.startsWith("prod_")) {
            product = await stripe.products.retrieve(asString);
          }
        } catch {
          product = null;
        }
        if (product && (product as any)?.active === false) {
          product = null;
        }
        if (product?.id) {
          try {
            const p = await stripe.prices.list({
              product: product.id,
              active: true,
              limit: 100,
            } as any);
            const prices = Array.isArray((p as any)?.data)
              ? (p as any).data
              : [];
            const eur = prices.find(
              (pr: any) =>
                String(pr?.currency || "").toLowerCase() === "eur" &&
                Number(pr?.unit_amount || 0) > 0,
            );
            if (eur) {
              const v = Number((eur as any)?.unit_amount || 0) / 100;
              unit_price = Number.isFinite(v) && v > 0 ? v : null;
            }
          } catch {
            unit_price = null;
          }
        }
        return { stock: r, product, unit_price };
      }),
    );

    return res.json({ success: true, items });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.post("/:storeSlug/stock/by-stripe-product-ids", async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    const bodyIds = Array.isArray((req.body as any)?.ids)
      ? ((req.body as any).ids as any[])
      : [];
    const ids = Array.from(
      new Set(
        bodyIds
          .map((id) => String(id || "").trim())
          .filter((id) => id.startsWith("prod_")),
      ),
    ).slice(0, 100);

    if (ids.length === 0) {
      return res.json({ success: true, items: [] });
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const stockSelect =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";
    const { data: stockRows, error: stockErr } = await supabase
      .from("stock")
      .select(stockSelect)
      .eq("store_id", storeId)
      .in("product_stripe_id", ids as any);

    if (stockErr) {
      return res.status(500).json({ error: stockErr.message });
    }

    const rows = Array.isArray(stockRows) ? stockRows : [];
    const items = rows.map((r: any) => ({ stock: r }));
    return res.json({ success: true, items });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.get("/:storeSlug/stock", requireAuth(), async (req, res) => {
  try {
    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const stockSelect =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";

    const { data: stockRows, error: stockErr } = await supabase
      .from("stock")
      .select(stockSelect)
      .eq("store_id", storeId)
      .gt("quantity", 0)
      .order("id", { ascending: false });
    if (stockErr) return res.status(500).json({ error: stockErr.message });

    const rows = Array.isArray(stockRows) ? stockRows : [];

    const mapWithLimit = async <T, R>(
      items: T[],
      maxConcurrent: number,
      fn: (item: T, idx: number) => Promise<R>,
    ): Promise<R[]> => {
      const out: R[] = new Array(items.length);
      let idx = 0;
      const workers = new Array(Math.max(1, maxConcurrent))
        .fill(null)
        .map(async () => {
          while (idx < items.length) {
            const current = idx++;
            out[current] = await fn(items[current], current);
          }
        });
      await Promise.all(workers);
      return out;
    };

    const items = await mapWithLimit(rows, 6, async (r: any) => {
      const boughtRaw = Number((r as any)?.bought || 0);
      const bought =
        Number.isFinite(boughtRaw) && boughtRaw > 0 ? boughtRaw : 0;

      const raw = (r as any)?.product_stripe_id;
      const asString = String(raw ?? "").trim();
      if (!asString || !asString.startsWith("prod_")) {
        return { stock: { ...r, bought }, product: null, unit_price: null };
      }

      let product: any = null;
      try {
        product = await stripe.products.retrieve(asString);
      } catch {
        product = null;
      }
      if (product && (product as any)?.active === false) {
        return { stock: { ...r, bought }, product: null, unit_price: null };
      }

      let unit_price: number | null = null;
      if (product?.id) {
        try {
          const p = await stripe.prices.list({
            product: product.id,
            active: true,
            limit: 100,
          } as any);
          const prices = Array.isArray((p as any)?.data) ? (p as any).data : [];
          const eur = prices.find(
            (pr: any) =>
              String(pr?.currency || "").toLowerCase() === "eur" &&
              Number(pr?.unit_amount || 0) > 0,
          );
          if (eur) {
            const v = Number((eur as any)?.unit_amount || 0) / 100;
            unit_price = Number.isFinite(v) && v > 0 ? v : null;
          }
        } catch {
          unit_price = null;
        }
      }

      return { stock: { ...r, bought }, product, unit_price };
    });

    return res.json({ success: true, items });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    console.error("Error listing public stock products:", e);
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.get("/:storeSlug/stock/products", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) {
      return res.status(400).json({ error: "Slug de boutique requis" });
    }
    const decodedSlug = decodeURIComponent(storeSlug);

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug, clerk_id, owner_email, name")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    let authorized = Boolean(
      (storeRow as any)?.clerk_id && (storeRow as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String((storeRow as any)?.owner_email || "")
          .toLowerCase()
          .trim();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const stockSelect =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";

    let stockRows: any[] | null = null;
    let stockErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .select(stockSelect)
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      stockRows = resp.data as any;
      stockErr = resp.error as any;
    }
    if (stockErr) return res.status(500).json({ error: stockErr.message });

    const rows = Array.isArray(stockRows) ? stockRows : [];

    const mapWithLimit = async <T, R>(
      items: T[],
      maxConcurrent: number,
      fn: (item: T, idx: number) => Promise<R>,
    ): Promise<R[]> => {
      const out: R[] = new Array(items.length);
      let idx = 0;
      const workers = new Array(Math.max(1, maxConcurrent))
        .fill(null)
        .map(async () => {
          while (idx < items.length) {
            const current = idx++;
            out[current] = await fn(items[current], current);
          }
        });
      await Promise.all(workers);
      return out;
    };

    const items = await mapWithLimit(rows, 6, async (r: any) => {
      const raw = (r as any)?.product_stripe_id;
      const asString = String(raw ?? "").trim();

      let product: any = null;
      try {
        if (asString && asString.startsWith("prod_")) {
          product = await stripe.products.retrieve(asString);
        } else if (asString) {
          const escaped = asString.replace(/'/g, "\\'");
          const query = `metadata['store_id']:'${String(storeId)}' AND metadata['internal_product_id']:'${escaped}'`;
          const found: any = await stripe.products.search({
            query,
            limit: 1,
          } as any);
          product =
            Array.isArray(found?.data) && found.data.length > 0
              ? found.data[0]
              : null;
        }
      } catch {
        product = null;
      }

      if (product && (product as any)?.active === false) {
        return null as any;
      }

      let prices: any[] = [];
      if (product?.id) {
        try {
          const p = await stripe.prices.list({
            product: product.id,
            active: true,
            limit: 100,
          });
          prices = Array.isArray((p as any)?.data) ? (p as any).data : [];
        } catch {
          prices = [];
        }
      }

      return { stock: r, product, prices };
    });

    const filteredItems = (items || []).filter(Boolean);
    return res.json({ success: true, items: filteredItems });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    console.error("Error listing stock products:", e);
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.put("/:storeSlug/stock/products/:stockId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { storeSlug, stockId } = req.params as {
      storeSlug?: string;
      stockId?: string;
    };
    if (!storeSlug) return res.status(400).json({ error: "Slug requis" });
    const decodedSlug = decodeURIComponent(storeSlug);

    const stockIdNum = Number(stockId);
    if (!Number.isFinite(stockIdNum) || stockIdNum <= 0) {
      return res.status(400).json({ error: "id invalide" });
    }

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug, clerk_id, owner_email, name")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow)
      return res.status(404).json({ error: "Boutique introuvable" });

    const user = await clerkClient.users.getUser(auth.userId);
    let authorized = Boolean(
      (storeRow as any)?.clerk_id && (storeRow as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String((storeRow as any)?.owner_email || "")
          .toLowerCase()
          .trim();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) return res.status(403).json({ error: "Forbidden" });

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const {
      title,
      reference,
      description,
      quantity,
      weight,
      image_url,
      price,
    }: {
      title?: string;
      reference?: string;
      description?: string;
      quantity?: number | string;
      weight?: number | string | null;
      image_url?: string | null;
      price?: number | string;
    } = req.body || {};

    const titleTrim = String(title || "").trim();
    const referenceTrim = String(reference || "").trim();
    const descTrim = String(description || "").trim();
    const imageUrlTrim = String(image_url || "").trim();

    if (!titleTrim) return res.status(400).json({ error: "Titre requis" });
    if (!referenceTrim)
      return res.status(400).json({ error: "Référence requise" });
    if (!descTrim)
      return res.status(400).json({ error: "Description requise" });

    const qtyRaw =
      typeof quantity === "number"
        ? quantity
        : typeof quantity === "string"
          ? parseInt(quantity.trim(), 10)
          : NaN;
    const normalizedQty =
      Number.isFinite(qtyRaw) && qtyRaw >= 0 ? Math.floor(qtyRaw) : NaN;
    if (!Number.isFinite(normalizedQty) || normalizedQty < 0) {
      return res.status(400).json({ error: "Quantité invalide (>= 0)" });
    }

    const weightRaw =
      typeof weight === "number"
        ? weight
        : typeof weight === "string"
          ? parseFloat(weight.trim().replace(",", "."))
          : weight === null
            ? null
            : NaN;
    if (
      weightRaw === null ||
      (typeof weight === "string" && weight.trim() === "")
    ) {
      return res.status(400).json({ error: "Poids requis" });
    }
    const normalizedWeight =
      Number.isFinite(weightRaw) && weightRaw >= 0 ? weightRaw : NaN;
    if (!Number.isFinite(normalizedWeight) || normalizedWeight < 0) {
      return res.status(400).json({ error: "Poids invalide (>= 0)" });
    }

    const priceRaw =
      typeof price === "number"
        ? price
        : typeof price === "string"
          ? parseFloat(price.trim().replace(",", "."))
          : NaN;
    const normalizedPrice =
      Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : NaN;
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return res.status(400).json({ error: "Prix invalide (> 0)" });
    }
    const unitAmountCents = Math.round(normalizedPrice * 100);
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 1) {
      return res.status(400).json({ error: "Prix invalide (>= 0,01€)" });
    }

    const imageUrlsRaw = imageUrlTrim
      ? imageUrlTrim
          .split(",")
          .map((u) => String(u || "").trim())
          .filter(Boolean)
      : [];
    const normalizedImageUrls: string[] = [];
    for (const u of imageUrlsRaw) {
      try {
        const parsed = new URL(u);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return res.status(400).json({ error: "URL image invalide" });
        }
        normalizedImageUrls.push(parsed.toString());
      } catch {
        return res.status(400).json({ error: "URL image invalide" });
      }
    }

    const imageUrlJoined =
      normalizedImageUrls.length > 0
        ? Array.from(new Set(normalizedImageUrls)).join(",")
        : null;

    const { data: stockRow, error: stockRowErr } = await supabase
      .from("stock")
      .select("id, store_id, product_stripe_id, bought")
      .eq("id", stockIdNum)
      .eq("store_id", storeId)
      .maybeSingle();
    if (stockRowErr)
      return res.status(500).json({ error: stockRowErr.message });
    if (!stockRow)
      return res.status(404).json({ error: "Produit introuvable" });

    const stripeProductId = String(
      (stockRow as any)?.product_stripe_id || "",
    ).trim();
    if (!stripeProductId || !stripeProductId.startsWith("prod_")) {
      return res.status(500).json({ error: "product_stripe_id invalide" });
    }

    const updatedProduct = await stripe.products.update(stripeProductId, {
      name: titleTrim,
      description: descTrim,
      ...(normalizedImageUrls.length > 0
        ? { images: Array.from(new Set(normalizedImageUrls)).slice(0, 8) }
        : { images: [] }),
      metadata: {
        store_id: String(storeId),
        product_reference: referenceTrim,
        quantity: String(normalizedQty),
        price_eur: String(normalizedPrice),
      },
    } as any);

    let prices: any[] = [];
    try {
      const p = await stripe.prices.list({
        product: stripeProductId,
        active: true,
        limit: 100,
      } as any);
      prices = Array.isArray((p as any)?.data) ? (p as any).data : [];
    } catch {
      prices = [];
    }

    const same = prices.find(
      (p: any) =>
        String(p?.currency || "").toLowerCase() === "eur" &&
        Number(p?.unit_amount || 0) === unitAmountCents,
    );

    let activePrice = same || null;
    if (!activePrice) {
      for (const p of prices) {
        try {
          await stripe.prices.update(String((p as any)?.id || ""), {
            active: false,
          } as any);
        } catch {}
      }
      activePrice = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: unitAmountCents,
        currency: "eur",
      } as any);
    } else {
      for (const p of prices) {
        const pid = String((p as any)?.id || "");
        if (!pid || pid === String((activePrice as any)?.id || "")) continue;
        try {
          await stripe.prices.update(pid, { active: false } as any);
        } catch {}
      }
    }

    try {
      await stripe.products.update(stripeProductId, {
        default_price: String((activePrice as any)?.id || ""),
      } as any);
    } catch {}

    const updatePayload: any = {
      product_reference: referenceTrim,
      quantity: normalizedQty,
      weight: normalizedWeight,
      image_url: imageUrlJoined,
    };

    let updatedStock: any = null;
    let updateErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .update(updatePayload)
        .eq("id", stockIdNum)
        .eq("store_id", storeId)
        .select("*")
        .single();
      updatedStock = resp.data as any;
      updateErr = resp.error as any;
    }
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.json({
      success: true,
      stock: updatedStock,
      product: updatedProduct,
      price: activePrice,
    });
  } catch (e: any) {
    const msg = e?.message || "Erreur interne du serveur";
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

router.delete("/:storeSlug/stock/products", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { storeSlug } = req.params as { storeSlug?: string };
    if (!storeSlug) return res.status(400).json({ error: "Slug requis" });
    const decodedSlug = decodeURIComponent(storeSlug);

    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, slug, clerk_id, owner_email, name")
      .eq("slug", decodedSlug)
      .maybeSingle();
    if (storeErr && (storeErr as any)?.code !== "PGRST116") {
      return res.status(500).json({ error: storeErr.message });
    }
    if (!storeRow)
      return res.status(404).json({ error: "Boutique introuvable" });

    const user = await clerkClient.users.getUser(auth.userId);
    let authorized = Boolean(
      (storeRow as any)?.clerk_id && (storeRow as any).clerk_id === auth.userId,
    );
    if (!authorized) {
      try {
        const emails = (user.emailAddresses || [])
          .map((e) => String((e as any)?.emailAddress || "").toLowerCase())
          .filter(Boolean);
        const ownerEmail = String((storeRow as any)?.owner_email || "")
          .toLowerCase()
          .trim();
        if (ownerEmail && emails.includes(ownerEmail)) authorized = true;
      } catch {}
    }
    if (!authorized) return res.status(403).json({ error: "Forbidden" });

    const storeId = Number((storeRow as any)?.id);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(500).json({ error: "store_id invalide" });
    }

    const idsRaw = (req.body as any)?.ids;
    const ids = Array.isArray(idsRaw)
      ? Array.from(
          new Set(
            idsRaw
              .map((n: any) => Number(n))
              .filter((n: any) => Number.isFinite(n) && n > 0),
          ),
        )
      : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids requis" });

    const results: any[] = [];
    for (const id of ids) {
      const { data: stockRow, error: stockErr } = await supabase
        .from("stock")
        .select("id, store_id, product_stripe_id, bought")
        .eq("id", id)
        .eq("store_id", storeId)
        .maybeSingle();
      if (stockErr) {
        results.push({ id, ok: false, error: stockErr.message });
        continue;
      }
      if (!stockRow) {
        results.push({ id, ok: false, error: "not_found" });
        continue;
      }

      const boughtRaw = Number((stockRow as any)?.bought || 0);
      const bought =
        Number.isFinite(boughtRaw) && boughtRaw > 0 ? boughtRaw : 0;
      const stripeProductId = String(
        (stockRow as any)?.product_stripe_id || "",
      ).trim();

      if (stripeProductId && stripeProductId.startsWith("prod_")) {
        try {
          await stripe.products.update(stripeProductId, {
            default_price: null as any,
          });
          const p = await stripe.prices.list({
            product: stripeProductId,
            limit: 100,
          } as any);
          const prices = Array.isArray((p as any)?.data) ? (p as any).data : [];
          for (const pr of prices) {
            const pid = String((pr as any)?.id || "");
            if (!pid) continue;
            await stripe.prices.update(pid, { active: false } as any);
          }

          await stripe.products.update(stripeProductId, {
            active: false,
          } as any);
        } catch (e: any) {
          console.log("stripe error", e);
          const msg = e?.message || "stripe_error";
          results.push({
            id,
            ok: false,
            error: typeof msg === "string" ? msg : "stripe_error",
          });
          continue;
        }
      }

      const { error: delErr } = await supabase
        .from("stock")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);
      if (delErr) {
        results.push({ id, ok: false, error: delErr.message });
        continue;
      }
      results.push({ id, ok: true, deleted: true, bought });
    }

    return res.json({ success: true, results });
  } catch (e: any) {
    console.log("error", e);
    const msg = e?.message || "Erreur interne du serveur";
    return res.status(500).json({
      error: typeof msg === "string" ? msg : "Erreur interne du serveur",
    });
  }
});

export default router;
