import express from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

import { isValidIBAN, isValidBIC } from "ibantools";
import slugify from "slugify";
import { clerkClient, getAuth } from "@clerk/express";
import { emailService } from "../services/emailService";

const router = express.Router();

// Configuration Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
router.post("/", async (req, res) => {
  try {
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
          clerk_id: clerkUserId || null,
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

    // Mettre à jour le rôle Clerk en "owner" après la création du store
    if (clerkUserId) {
      try {
        await clerkClient.users.updateUserMetadata(clerkUserId, {
          publicMetadata: { role: "owner" },
        });
      } catch (e) {
        console.error("Erreur mise à jour du rôle Clerk:", e);
      }
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
router.put("/:storeSlug", async (req, res) => {
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
});

// GET /api/stores/:storeSlug - Récupérer une boutique par son slug
router.get("/:storeSlug", async (req, res) => {
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

    const { iban, bic } = req.body as { iban?: string; bic?: string };
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

    const paymentRows: any[] = [];
    const pageSizeDb = 1000;
    for (let from = 0; ; from += pageSizeDb) {
      const q = supabase
        .from("shipments")
        .select("payment_id")
        .eq("store_id", storeId)
        .not("payment_id", "is", null)
        .order("id", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      const { data, error } = await q;
      if (error) {
        console.error("Erreur Supabase (list shipments payment_id):", error);
        return res.status(500).json({ error: error.message });
      }
      paymentRows.push(...(data || []));
      if (!data || data.length < pageSizeDb) break;
    }

    const paymentIdsAll = paymentRows
      .map((r) => String((r as any)?.payment_id || "").trim())
      .filter(Boolean);
    const paymentIdSet = new Set(paymentIdsAll);

    const listAllCheckoutSessionsAfter = async (options?: {
      startTimestamp?: number;
    }): Promise<any[]> => {
      const out: any[] = [];
      let hasMore = true;
      let startingAfter: string | undefined = undefined;

      const queryParams: any = {
        limit: 100,
        expand: ["data.customer", "data.shipping_cost"],
      };
      if (options?.startTimestamp) {
        queryParams.created = { gte: options.startTimestamp };
      }

      while (hasMore) {
        if (startingAfter) queryParams.starting_after = startingAfter;
        const page = await stripe.checkout.sessions.list(queryParams);
        out.push(...(page.data || []));
        hasMore = Boolean(page.has_more);
        if (hasMore && (page.data || []).length > 0) {
          startingAfter = (page.data || [])[(page.data || []).length - 1]?.id;
        }
      }

      return out;
    };

    const allSessionsAfter = await listAllCheckoutSessionsAfter({
      startTimestamp: lastPayoutTimestamp,
    });

    const matchedSessions = allSessionsAfter
      .map((s) => {
        const pid =
          typeof (s as any)?.payment_intent === "string"
            ? String((s as any).payment_intent)
            : String((s as any)?.payment_intent?.id || "");
        const paymentId = pid.trim();
        if (!paymentId) return null;
        if (!paymentIdSet.has(paymentId)) return null;
        return { session: s, paymentId };
      })
      .filter(Boolean) as Array<{ session: any; paymentId: string }>;

    const uniqByPaymentId = new Map<
      string,
      { session: any; paymentId: string }
    >();
    for (const it of matchedSessions) {
      const existing = uniqByPaymentId.get(it.paymentId);
      if (!existing) {
        uniqByPaymentId.set(it.paymentId, it);
        continue;
      }
      const prevCreated = Number((existing.session as any)?.created || 0);
      const nextCreated = Number((it.session as any)?.created || 0);
      if (nextCreated > prevCreated) {
        uniqByPaymentId.set(it.paymentId, it);
      }
    }
    const uniqMatchedSessions = Array.from(uniqByPaymentId.values());

    const refundedByPaymentId = new Map<string, number>();
    const refundCentsList = await mapWithLimit(
      uniqMatchedSessions,
      6,
      async (it) => {
        const paymentId = it.paymentId;
        try {
          const refunds = await stripe.refunds.list({
            payment_intent: paymentId,
            limit: 100,
          });
          const refundedCents = (refunds.data || []).reduce(
            (sum, r) => sum + Number((r as any)?.amount || 0),
            0,
          );
          refundedByPaymentId.set(paymentId, refundedCents);
          return refundedCents;
        } catch {
          refundedByPaymentId.set(paymentId, 0);
          return 0;
        }
      },
    );

    const grossCents = uniqMatchedSessions.reduce((sum, it, idx) => {
      const s = it.session as any;
      const paymentId = it.paymentId;
      const totalCents = Number(s?.amount_total || 0);
      const refundedCents =
        typeof refundCentsList[idx] === "number"
          ? refundCentsList[idx]
          : Number(refundedByPaymentId.get(paymentId) || 0);
      const netCents = totalCents - refundedCents;
      return sum + (Number.isFinite(netCents) ? Math.max(0, netCents) : 0);
    }, 0);

    if (!Number.isFinite(grossCents) || grossCents <= 0) {
      return res.status(400).json({ error: "Aucun gain disponible" });
    }

    const platformFeeCents = Math.round(grossCents * 0.03) + 30;
    const payoutCents = grossCents - platformFeeCents;
    if (!Number.isFinite(payoutCents) || payoutCents <= 0) {
      return res.status(400).json({ error: "Montant insuffisant après frais" });
    }

    const country = ibanTrim.substring(0, 2).toUpperCase();
    const idempotencyBase = `payout_${storeId}_${
      lastPayoutTimestamp ? String(lastPayoutTimestamp) : "first"
    }_${grossCents}`;

    const account: any = await stripe.accounts.retrieve();
    const stripeAccountId = String(account?.id || "").trim();
    if (!stripeAccountId) {
      return res.status(500).json({ error: "Stripe account indisponible" });
    }

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

    const destinationId = String(externalAccount?.id || "").trim();
    if (!destinationId) {
      return res.status(500).json({ error: "Destination bancaire invalide" });
    }

    const payout: any = await stripe.payouts.create(
      {
        amount: payoutCents,
        currency: "eur",
        method: "standard",
        destination: destinationId,
        description: `Payout PayLive - ${String((store as any)?.name || "")}`,
        metadata: {
          store_id: String(storeId),
          store_slug: String(decodedSlug),
          gross_cents: String(grossCents),
          fee_cents: String(platformFeeCents),
        },
      } as any,
      {
        idempotencyKey: `${idempotencyBase}_payout`,
        stripeAccount: "acct_1SramGC1Oc6JE3hW",
      } as any,
    );

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

    uniqMatchedSessions.sort(
      (a, b) =>
        Number((b.session as any)?.created || 0) -
        Number((a.session as any)?.created || 0),
    );

    const transactions: any[] = await mapWithLimit(
      uniqMatchedSessions,
      6,
      async (it) => {
        const session = it.session as any;
        const paymentId = it.paymentId;
        const created = Number(session?.created || 0);
        const currency = String(session?.currency || "eur").toLowerCase();
        const customerObj =
          session?.customer && typeof session.customer === "object"
            ? (session.customer as any)
            : null;
        const shippingCents = Number(session?.shipping_cost?.amount_total || 0);
        const totalCents = Number(session?.amount_total || 0);
        const refundedCents = Number(refundedByPaymentId.get(paymentId) || 0);
        const baseNet = (totalCents - refundedCents) / 100;

        let lineItems: any[] = [];
        try {
          const liResp: any = await stripe.checkout.sessions.listLineItems(
            String(session?.id || ""),
            { limit: 100, expand: ["data.price.product"] } as any,
          );
          lineItems = Array.isArray(liResp?.data) ? liResp.data : [];
        } catch {}

        const items = lineItems.map((li) => {
          const price = (li as any)?.price || null;
          const unit = Number((price as any)?.unit_amount || 0);
          const qty = Number((li as any)?.quantity || 1);
          const product = (price as any)?.product || null;
          const ref = String(
            (product as any)?.name || (li as any)?.description || "",
          ).trim();
          const desc = String((product as any)?.description || "").trim();
          return {
            reference: ref || "—",
            description: desc || null,
            unit_price: unit / 100,
            quantity: qty,
            line_total: (unit * qty) / 100,
          };
        });

        return {
          payment_id: paymentId,
          created,
          currency,
          customer: {
            name: String(customerObj?.name || "").trim() || null,
            email: String(customerObj?.email || "").trim() || null,
            id: String(customerObj?.id || "").trim() || null,
          },
          items,
          shipping_fee: shippingCents / 100,
          total: totalCents / 100,
          refunded_total: refundedCents / 100,
          net_total: baseNet,
        };
      },
    );

    const storeName = String((store as any)?.name || "").trim() || "—";
    const storeOwnerEmail = String(
      (updated as any)?.owner_email || (store as any)?.owner_email || "",
    ).trim();
    const createdEpochs = uniqMatchedSessions
      .map((it) => Number((it.session as any)?.created || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const minCreated =
      createdEpochs.length > 0 ? Math.min(...createdEpochs) : NaN;
    const maxCreated =
      createdEpochs.length > 0 ? Math.max(...createdEpochs) : NaN;
    const periodStart = Number.isFinite(minCreated)
      ? new Date(minCreated * 1000)
      : null;
    const periodEnd = Number.isFinite(maxCreated)
      ? new Date(maxCreated * 1000)
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
        .text(moneyFmt.format(grossCents / 100), totalsValueX, y, {
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
        .text(moneyFmt.format(platformFeeCents / 100), totalsValueX, y, {
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
      const colNetW = 90;
      const colPaymentW = 150;
      const colClientW = tableW - colDateW - colPaymentW - colNetW;

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
        doc.text("Payment", x + colDateW + colClientW + 6, y + rowTextY, {
          width: colPaymentW - 12,
        });
        doc.text("Net", x + colDateW + colClientW + colPaymentW, y + rowTextY, {
          width: colNetW - 6,
          align: "right",
        });
        y += rowH;
      };

      const drawSummaryRow = (row: {
        date: string;
        client: string;
        payment: string;
        net: string;
      }) => {
        doc.save();
        doc
          .strokeColor("#E5E7EB")
          .lineWidth(1)
          .rect(x, y, tableW, rowH)
          .stroke();
        doc.restore();
        doc.fillColor("#111827").fontSize(9);
        doc.text(row.date, x + 6, y + rowTextY, { width: colDateW - 12 });
        doc.text(row.client, x + colDateW + 6, y + rowTextY, {
          width: colClientW - 12,
        });
        doc.text(row.payment, x + colDateW + colClientW + 6, y + rowTextY, {
          width: colPaymentW - 12,
        });
        doc.text(
          row.net,
          x + colDateW + colClientW + colPaymentW,
          y + rowTextY,
          {
            width: colNetW - 6,
            align: "right",
          },
        );
        y += rowH;
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
        const customerName =
          sanitizeOneLine(String((tx as any)?.customer?.name || "")) ||
          sanitizeOneLine(String((tx as any)?.customer?.email || "")) ||
          "—";
        const paymentId =
          sanitizeOneLine(String((tx as any)?.payment_id || "")) || "—";
        const netText = moneyFmt.format(Number((tx as any)?.net_total || 0));

        drawSummaryRow({
          date: dateText,
          client: customerName.slice(0, 44),
          payment: paymentId.slice(0, 26),
          net: netText,
        });
      }

      y += 18;
      doc
        .fillColor("#374151")
        .fontSize(9)
        .text("Détail des lignes par transaction en pages suivantes.", x, y);

      addPage();
      doc
        .fillColor("#111827")
        .fontSize(14)
        .text("Détail des transactions", x, y);
      y += 20;

      const itemRowH = 16;
      const itemQtyW = 44;
      const itemUnitW = 80;
      const itemTotalW = 90;
      const itemRefW = tableW - itemQtyW - itemUnitW - itemTotalW;

      const drawItemsHeader = () => {
        doc.save();
        doc.fillColor("#F3F4F6").rect(x, y, tableW, itemRowH).fill();
        doc.restore();
        doc.save();
        doc
          .strokeColor("#E5E7EB")
          .lineWidth(1)
          .rect(x, y, tableW, itemRowH)
          .stroke();
        doc.restore();
        doc.fillColor("#111827").fontSize(9);
        doc.text("Article", x + 6, y + 4, { width: itemRefW - 12 });
        doc.text("Qté", x + itemRefW, y + 4, {
          width: itemQtyW - 6,
          align: "right",
        });
        doc.text("PU", x + itemRefW + itemQtyW, y + 4, {
          width: itemUnitW - 6,
          align: "right",
        });
        doc.text("Total", x + itemRefW + itemQtyW + itemUnitW, y + 4, {
          width: itemTotalW - 6,
          align: "right",
        });
        y += itemRowH;
      };

      const drawItemRow = (row: {
        ref: string;
        qty: string;
        unit: string;
        total: string;
      }) => {
        doc.save();
        doc
          .strokeColor("#E5E7EB")
          .lineWidth(1)
          .rect(x, y, tableW, itemRowH)
          .stroke();
        doc.restore();
        doc.fillColor("#111827").fontSize(9);
        doc.text(row.ref, x + 6, y + 4, { width: itemRefW - 12 });
        doc.text(row.qty, x + itemRefW, y + 4, {
          width: itemQtyW - 6,
          align: "right",
        });
        doc.text(row.unit, x + itemRefW + itemQtyW, y + 4, {
          width: itemUnitW - 6,
          align: "right",
        });
        doc.text(row.total, x + itemRefW + itemQtyW + itemUnitW, y + 4, {
          width: itemTotalW - 6,
          align: "right",
        });
        y += itemRowH;
      };

      for (const tx of transactions) {
        if (y > doc.page.height - margin - 160) addPage();

        const createdTs = Number((tx as any)?.created || 0);
        const createdText = createdTs
          ? dtLong.format(new Date(createdTs * 1000))
          : "—";
        const customerName =
          sanitizeOneLine(String((tx as any)?.customer?.name || "")) ||
          sanitizeOneLine(String((tx as any)?.customer?.email || "")) ||
          "—";
        const paymentId =
          sanitizeOneLine(String((tx as any)?.payment_id || "")) || "—";

        doc
          .fillColor("#111827")
          .fontSize(11)
          .text(`${createdText} — ${customerName}`, x, y, {
            width: tableW,
          });
        y += 14;
        doc
          .fillColor("#374151")
          .fontSize(9)
          .text(`Payment: ${paymentId}`, x, y, {
            width: tableW,
          });
        y += 12;

        drawItemsHeader();
        const items = Array.isArray((tx as any)?.items)
          ? (tx as any).items
          : [];
        for (const it2 of items) {
          if (y > doc.page.height - margin - 120) {
            addPage();
            drawItemsHeader();
          }
          const ref =
            sanitizeOneLine(String((it2 as any)?.reference || "—")) || "—";
          const qty = Number((it2 as any)?.quantity || 0);
          const unit = Number((it2 as any)?.unit_price || 0);
          const lineTotal = Number((it2 as any)?.line_total || 0);
          drawItemRow({
            ref: ref.slice(0, 70),
            qty: String(qty || 0),
            unit: moneyFmt.format(unit),
            total: moneyFmt.format(lineTotal),
          });
        }

        y += 10;
        const totalsLabelW = 170;
        const totalsValueW = 110;
        const totalsRightX = doc.page.width - margin - totalsValueW;
        const kv = [
          { k: "Total", v: moneyFmt.format(Number((tx as any)?.total || 0)) },
          {
            k: "Livraison",
            v: moneyFmt.format(Number((tx as any)?.shipping_fee || 0)),
          },
          {
            k: "Remboursé",
            v: moneyFmt.format(Number((tx as any)?.refunded_total || 0)),
          },
          { k: "Net", v: moneyFmt.format(Number((tx as any)?.net_total || 0)) },
        ];
        for (const { k, v } of kv) {
          if (y > doc.page.height - margin - 60) addPage();
          doc
            .fillColor("#374151")
            .fontSize(9)
            .text(k, totalsRightX - totalsLabelW, y, {
              width: totalsLabelW,
              align: "right",
            });
          doc.fillColor("#111827").fontSize(9).text(v, totalsRightX, y, {
            width: totalsValueW,
            align: "right",
          });
          y += 12;
        }

        y += 14;
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
          grossAmount: grossCents / 100,
          feeAmount: platformFeeCents / 100,
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
        gross_cents: grossCents,
        fee_cents: platformFeeCents,
        payout_cents: payoutCents,
        currency: "eur",
        recipient_id: stripeAccountId || null,
        payment_id: payout?.id || null,
        status: payout?.status || null,
        destination_id: destinationId || null,
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

    const paymentRows: any[] = [];
    const pageSizeDb = 1000;
    for (let from = 0; ; from += pageSizeDb) {
      const q = supabase
        .from("shipments")
        .select("payment_id")
        .eq("store_id", storeId)
        .not("payment_id", "is", null)
        .order("id", { ascending: false })
        .range(from, from + pageSizeDb - 1);

      const { data, error } = await q;
      if (error) {
        console.error("Erreur Supabase (list shipments payment_id):", error);
        return res.status(500).json({ error: error.message });
      }
      paymentRows.push(...(data || []));
      if (!data || data.length < pageSizeDb) break;
    }

    const paymentIdsAll = paymentRows
      .map((r) => String((r as any)?.payment_id || "").trim())
      .filter(Boolean);

    const paymentIdSet = new Set(paymentIdsAll);

    const listAllCheckoutSessionsAfter = async (options?: {
      startTimestamp?: number;
    }): Promise<any[]> => {
      const out: any[] = [];
      let hasMore = true;
      let startingAfter: string | undefined = undefined;

      const queryParams: any = {
        limit: 100,
        expand: ["data.customer", "data.shipping_cost"],
      };
      if (options?.startTimestamp) {
        queryParams.created = { gte: options.startTimestamp };
      }

      while (hasMore) {
        if (startingAfter) queryParams.starting_after = startingAfter;
        const page = await stripe.checkout.sessions.list(queryParams);
        out.push(...(page.data || []));
        hasMore = Boolean(page.has_more);
        if (hasMore && (page.data || []).length > 0) {
          startingAfter = (page.data || [])[(page.data || []).length - 1]?.id;
        }
      }

      return out;
    };

    const allSessionsAfter = await listAllCheckoutSessionsAfter({
      startTimestamp,
    });

    const matchedSessions = allSessionsAfter
      .map((s) => {
        const pid =
          typeof (s as any)?.payment_intent === "string"
            ? String((s as any).payment_intent)
            : String((s as any)?.payment_intent?.id || "");
        const paymentId = pid.trim();
        if (!paymentId) return null;
        if (!paymentIdSet.has(paymentId)) return null;
        return { session: s, paymentId };
      })
      .filter(Boolean) as Array<{ session: any; paymentId: string }>;

    const uniqByPaymentId = new Map<
      string,
      { session: any; paymentId: string }
    >();
    for (const it of matchedSessions) {
      const existing = uniqByPaymentId.get(it.paymentId);
      if (!existing) {
        uniqByPaymentId.set(it.paymentId, it);
        continue;
      }
      const prevCreated = Number((existing.session as any)?.created || 0);
      const nextCreated = Number((it.session as any)?.created || 0);
      if (nextCreated > prevCreated) {
        uniqByPaymentId.set(it.paymentId, it);
      }
    }
    const uniqMatchedSessions = Array.from(uniqByPaymentId.values());

    const refundedByPaymentId = new Map<string, number>();
    const refundCentsList = await mapWithLimit(
      uniqMatchedSessions,
      6,
      async (it) => {
        const paymentId = it.paymentId;
        try {
          const refunds = await stripe.refunds.list({
            payment_intent: paymentId,
            limit: 100,
          });
          const refundedCents = (refunds.data || []).reduce(
            (sum, r) => sum + Number((r as any)?.amount || 0),
            0,
          );
          refundedByPaymentId.set(paymentId, refundedCents);
          return refundedCents;
        } catch {
          refundedByPaymentId.set(paymentId, 0);
          return 0;
        }
      },
    );

    const totalNetAll = uniqMatchedSessions.reduce((sum, it, idx) => {
      const s = it.session as any;
      const paymentId = it.paymentId;
      const totalCents = Number(s?.amount_total || 0);
      const refundedCents =
        typeof refundCentsList[idx] === "number"
          ? refundCentsList[idx]
          : Number(refundedByPaymentId.get(paymentId) || 0);
      const baseNet = (totalCents - refundedCents) / 100;
      return sum + (Number.isFinite(baseNet) ? baseNet : 0);
    }, 0);

    uniqMatchedSessions.sort(
      (a, b) =>
        Number((b.session as any)?.created || 0) -
        Number((a.session as any)?.created || 0),
    );

    const view = limitAll
      ? uniqMatchedSessions
      : uniqMatchedSessions.slice(0, limit);
    const transactions: any[] = await mapWithLimit(view, 6, async (it) => {
      const session = it.session as any;
      const paymentId = it.paymentId;
      const created = Number(session?.created || 0);
      const currency = String(session?.currency || "eur").toLowerCase();
      const status = String(session?.payment_status || session?.status || "");
      const customerObj =
        session?.customer && typeof session.customer === "object"
          ? (session.customer as any)
          : null;
      const shippingCents = Number(session?.shipping_cost?.amount_total || 0);
      const totalCents = Number(session?.amount_total || 0);
      const refundedCents = Number(refundedByPaymentId.get(paymentId) || 0);
      const baseNet = (totalCents - refundedCents) / 100;

      let lineItems: any[] = [];
      try {
        const liResp: any = await stripe.checkout.sessions.listLineItems(
          String(session?.id || ""),
          { limit: 100, expand: ["data.price.product"] } as any,
        );
        lineItems = Array.isArray(liResp?.data) ? liResp.data : [];
      } catch {}

      const items = lineItems.map((li) => {
        const price = (li as any)?.price || null;
        const unit = Number((price as any)?.unit_amount || 0);
        const qty = Number((li as any)?.quantity || 1);
        const product = (price as any)?.product || null;
        const ref = String(
          (product as any)?.name || (li as any)?.description || "",
        ).trim();
        const desc = String((product as any)?.description || "").trim();
        return {
          reference: ref || "—",
          description: desc || null,
          unit_price: unit / 100,
          quantity: qty,
          line_total: (unit * qty) / 100,
        };
      });

      return {
        payment_id: paymentId,
        created,
        currency,
        status,
        customer: {
          name: String(customerObj?.name || "").trim() || null,
          email: String(customerObj?.email || "").trim() || null,
          id: String(customerObj?.id || "").trim() || null,
        },
        items,
        shipping_fee: shippingCents / 100,
        total: totalCents / 100,
        refunded_total: refundedCents / 100,
        net_total: baseNet,
      };
    });

    return res.json({
      success: true,
      storeSlug: decodedSlug,
      startDate: startDateRaw || null,
      total_count: uniqMatchedSessions.length,
      total_net: totalNetAll,
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
      Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : NaN;
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      return res.status(400).json({ error: "Quantité invalide (>= 1)" });
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
        weight: String(normalizedWeight),
        weight_kg: String(normalizedWeight),
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

    const isMissingColumnError = (err: any, column: string) => {
      const code = String(err?.code || "").trim();
      const msg = String(err?.message || "").toLowerCase();
      const col = String(column || "").toLowerCase();
      if (!col) return false;
      if (code === "42703") return msg.includes(col);
      return msg.includes(col) && msg.includes("does not exist");
    };

    const payloadWithPrice: any = {
      store_id: storeId,
      product_reference: referenceTrim,
      quantity: normalizedQty,
      weight: normalizedWeight,
      image_url: imageUrlJoined,
      product_stripe_id: stripeProductId,
      price: normalizedPrice,
    };

    let stockInserted: any = null;
    let stockInsertErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .insert([payloadWithPrice])
        .select("*")
        .single();
      stockInserted = resp.data as any;
      stockInsertErr = resp.error as any;
    }
    if (stockInsertErr && isMissingColumnError(stockInsertErr, "price")) {
      const { price: _omit, ...payloadWithoutPrice } = payloadWithPrice;
      const resp2 = await supabase
        .from("stock")
        .insert([payloadWithoutPrice])
        .select("*")
        .single();
      stockInserted = resp2.data as any;
      stockInsertErr = resp2.error as any;
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

    const selectWithPrice =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought, price";
    const selectWithoutPrice =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";

    let stockRows: any[] | null = null;
    let stockErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .select(selectWithPrice)
        .eq("store_id", storeId)
        .ilike("product_reference", `%${q}%`)
        .order("product_reference", { ascending: true })
        .limit(10);
      stockRows = resp.data as any;
      stockErr = resp.error as any;
    }
    if (stockErr && String(stockErr?.code || "").trim() === "42703") {
      const msg = String(stockErr?.message || "").toLowerCase();
      if (msg.includes("price") && msg.includes("does not exist")) {
        const resp2 = await supabase
          .from("stock")
          .select(selectWithoutPrice)
          .eq("store_id", storeId)
          .ilike("product_reference", `%${q}%`)
          .order("product_reference", { ascending: true })
          .limit(10);
        stockRows = resp2.data as any;
        stockErr = resp2.error as any;
      }
    }
    if (stockErr) return res.status(500).json({ error: stockErr.message });

    const rows = Array.isArray(stockRows) ? stockRows : [];

    const items = await Promise.all(
      rows.map(async (r: any) => {
        const raw = (r as any)?.product_stripe_id;
        const asString = String(raw ?? "").trim();
        let product: any = null;
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
        return { stock: r, product };
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

    const isMissingColumnError = (err: any, column: string) => {
      const code = String(err?.code || "").trim();
      const msg = String(err?.message || "").toLowerCase();
      const col = String(column || "").toLowerCase();
      if (!col) return false;
      if (code === "42703") return msg.includes(col);
      return msg.includes(col) && msg.includes("does not exist");
    };

    const selectWithPrice =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought, price";
    const selectWithoutPrice =
      "id, created_at, store_id, product_reference, quantity, weight, image_url, product_stripe_id, bought";

    let stockRows: any[] | null = null;
    let stockErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .select(selectWithPrice)
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      stockRows = resp.data as any;
      stockErr = resp.error as any;
    }
    if (stockErr && isMissingColumnError(stockErr, "price")) {
      const resp2 = await supabase
        .from("stock")
        .select(selectWithoutPrice)
        .eq("store_id", storeId)
        .order("id", { ascending: false });
      stockRows = resp2.data as any;
      stockErr = resp2.error as any;
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
      Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : NaN;
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      return res.status(400).json({ error: "Quantité invalide (>= 1)" });
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
        weight: String(normalizedWeight),
        weight_kg: String(normalizedWeight),
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

    const isMissingColumnError = (err: any, column: string) => {
      const code = String(err?.code || "").trim();
      const msg = String(err?.message || "").toLowerCase();
      const col = String(column || "").toLowerCase();
      if (!col) return false;
      if (code === "42703") return msg.includes(col);
      return msg.includes(col) && msg.includes("does not exist");
    };

    const updateWithPrice: any = {
      product_reference: referenceTrim,
      quantity: normalizedQty,
      weight: normalizedWeight,
      image_url: imageUrlJoined,
      price: normalizedPrice,
    };

    let updatedStock: any = null;
    let updateErr: any = null;
    {
      const resp = await supabase
        .from("stock")
        .update(updateWithPrice)
        .eq("id", stockIdNum)
        .eq("store_id", storeId)
        .select("*")
        .single();
      updatedStock = resp.data as any;
      updateErr = resp.error as any;
    }
    if (updateErr && isMissingColumnError(updateErr, "price")) {
      const { price: _omit, ...withoutPrice } = updateWithPrice;
      const resp2 = await supabase
        .from("stock")
        .update(withoutPrice)
        .eq("id", stockIdNum)
        .eq("store_id", storeId)
        .select("*")
        .single();
      updatedStock = resp2.data as any;
      updateErr = resp2.error as any;
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

      if (bought > 0) {
        const { error: updErr } = await supabase
          .from("stock")
          .update({ quantity: 0 })
          .eq("id", id)
          .eq("store_id", storeId);
        if (updErr) {
          results.push({ id, ok: false, error: updErr.message });
          continue;
        }
        results.push({ id, ok: true, archived: true });
        continue;
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
      results.push({ id, ok: true, deleted: true });
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
