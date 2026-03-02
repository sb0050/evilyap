import express from "express";
import { createClient } from "@supabase/supabase-js";
import { clerkClient, getAuth } from "@clerk/express";
import Stripe from "stripe";
import PDFDocument from "pdfkit";
import { emailService } from "../services/emailService";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase credentials are not set in environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecret
  ? new Stripe(stripeSecret, { apiVersion: "2025-06-30.basil" as any })
  : null;

const round2 = (v: number) => Math.round(v * 100) / 100;

const formatDateFr = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

const formatMonthYearFr = (d: Date) =>
  new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(d);

const getInternalBase = (): string => {
  const explicit = String(process.env.INTERNAL_API_BASE || "").trim();
  if (explicit) return explicit;
  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    return /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
};

const capitalizeFirst = (s: string) => {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
};

const formatMoneyFr = (v: number) =>
  `${round2(Number.isFinite(v) ? v : 0).toFixed(2)} €`;

const sanitizeFilenamePart = (raw: string) =>
  String(raw || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^\dA-Za-z _-]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "client";

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

type ProductReferenceItem = {
  reference: string;
  quantity: number;
  description?: string;
};

const parseProductReferenceItems = (raw: string): ProductReferenceItem[] => {
  const val = String(raw || "").trim();
  if (!val) return [];

  const parts = val
    .split(";")
    .map((p) => String(p || "").trim())
    .filter(Boolean);

  const onlyStripeIds =
    parts.length > 0 && parts.every((p) => String(p || "").startsWith("prod_"));
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
      description: undefined,
    }));
  }

  const acc = new Map<
    string,
    { reference: string; quantity: number; description?: string }
  >();

  const add = (
    referenceRaw: string,
    quantityRaw: number,
    descriptionRaw?: any,
  ) => {
    const reference = String(referenceRaw || "").trim();
    if (!reference) return;
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw > 0
        ? Math.floor(quantityRaw)
        : 1;
    const description = String(descriptionRaw || "").trim() || undefined;
    const cur = acc.get(reference);
    if (!cur) {
      acc.set(reference, { reference, quantity, description });
      return;
    }
    cur.quantity += quantity;
    if (!cur.description && description) cur.description = description;
  };

  for (const p of parts) {
    const seg = String(p || "").trim();
    if (!seg) continue;

    if (seg.includes("**")) {
      const [refRaw, tailRaw] = seg.split("**", 2);
      const ref = String(refRaw || "").trim();
      const tail = String(tailRaw || "").trim();
      if (!ref) continue;

      let quantity = 1;
      let description: string | undefined = undefined;
      if (tail) {
        const m = tail.match(/^(\d+)?(?:@(\d+))?\s*(?:\((.*)\))?$/);
        if (m?.[1]) {
          const q = Number(m[1]);
          if (Number.isFinite(q) && q > 0) quantity = Math.floor(q);
        }
        if (typeof m?.[3] === "string") {
          const d = String(m[3] || "").trim();
          if (d) description = d;
        }
      }

      add(
        ref.replace(/(?:@(\d+))?\s*\((.*)\)$/, "").trim(),
        quantity,
        description,
      );
      continue;
    }

    const mDesc = seg.match(/^(.*)\(([^()]*)\)\s*$/);
    const base = mDesc ? String(mDesc[1] || "").trim() : seg;
    const desc =
      mDesc && typeof mDesc[2] === "string"
        ? String(mDesc[2] || "").trim()
        : "";
    const ref = base.replace(/@(\d+)\s*$/, "").trim();
    add(ref, 1, desc || undefined);
  }

  return Array.from(acc.values());
};

async function applyStockAdjustmentForItems(options: {
  storeId: number;
  items: ProductReferenceItem[];
  mode: "restock" | "unrestock";
}) {
  const storeId = options.storeId;
  const items = Array.isArray(options.items) ? options.items : [];
  if (!Number.isFinite(storeId) || storeId <= 0) return;
  if (items.length === 0) return;

  const stripeIds = items
    .map((it) => String(it.reference || "").trim())
    .filter((r) => r.startsWith("prod_"));
  const refs = items
    .map((it) => String(it.reference || "").trim())
    .filter((r) => r && !r.startsWith("prod_"));

  const stockByStripeId = new Map<string, any>();
  if (stripeIds.length > 0) {
    const unique = Array.from(new Set(stripeIds));
    const { data: rows, error: readErr } = await supabase
      .from("stock")
      .select("id,product_stripe_id,quantity,bought")
      .eq("store_id", storeId)
      .in("product_stripe_id", unique as any);
    if (readErr) throw new Error(readErr.message);
    for (const r of Array.isArray(rows) ? rows : []) {
      const pid = String((r as any)?.product_stripe_id || "").trim();
      if (pid) stockByStripeId.set(pid, r);
    }
  }

  const stockByReference = new Map<string, any>();
  if (refs.length > 0) {
    const unique = Array.from(new Set(refs));
    const { data: rows, error: readErr } = await supabase
      .from("stock")
      .select("id,product_reference,quantity,bought")
      .eq("store_id", storeId)
      .in("product_reference", unique as any);
    if (readErr) throw new Error(readErr.message);
    for (const r of Array.isArray(rows) ? rows : []) {
      const ref = String((r as any)?.product_reference || "").trim();
      if (ref) stockByReference.set(ref, r);
    }
  }

  for (const it of items) {
    const reference = String(it.reference || "").trim();
    if (!reference) continue;
    const qtyRaw = Number(it.quantity || 1);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;

    const row = reference.startsWith("prod_")
      ? stockByStripeId.get(reference)
      : stockByReference.get(reference);
    const stockId = Number((row as any)?.id || 0);
    if (!row || !Number.isFinite(stockId) || stockId <= 0) continue;

    const bRaw = Number((row as any)?.bought || 0);
    const currentBought =
      Number.isFinite(bRaw) && bRaw >= 0 ? Math.floor(bRaw) : 0;

    const rawQtyField = (row as any)?.quantity;
    const hasQtyField = rawQtyField !== null && rawQtyField !== undefined;
    const parsedQty = hasQtyField ? Number(rawQtyField) : NaN;
    const available =
      hasQtyField && Number.isFinite(parsedQty) && parsedQty >= 0
        ? Math.floor(parsedQty)
        : 0;

    const nextBought =
      options.mode === "restock"
        ? Math.max(0, currentBought - qty)
        : Math.max(0, currentBought + qty);
    const nextQty =
      options.mode === "restock"
        ? Math.max(0, available + qty)
        : Math.max(0, available - qty);

    if (!hasQtyField) {
      const { error: updErr } = await supabase
        .from("stock")
        .update({ bought: nextBought } as any)
        .eq("id", stockId)
        .eq("store_id", storeId);
      if (updErr) throw new Error(updErr.message);
      continue;
    }

    const { error: updErr } = await supabase
      .from("stock")
      .update({ quantity: nextQty, bought: nextBought } as any)
      .eq("id", stockId)
      .eq("store_id", storeId);
    if (updErr) throw new Error(updErr.message);
  }
}

function isMissingColumnError(err: any, column: string): boolean {
  const msg = String(err?.message || "");
  return (
    msg.includes(`column "${column}"`) ||
    msg.includes(`column '${column}'`) ||
    msg.includes(`column ${column}`) ||
    msg.toLowerCase().includes("does not exist")
  );
}

function parseWeightKgFromDescription(description: string): number | null {
  const s = String(description || "").toLowerCase();
  if (!s.trim()) return null;
  const m = s.match(
    /(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilogramme?s?|kilo?s?|g|gr|gramme?s?)\b/i,
  );
  if (!m) return null;
  const raw = parseFloat(String(m[1] || "").replace(",", "."));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const unit = String(m[2] || "").toLowerCase();
  const kg = unit.startsWith("g") || unit.startsWith("gr") ? raw / 1000 : raw;
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

function getFallbackWeightKgFromDescription(description: string): number {
  return parseWeightKgFromDescription(description) ?? 0.5;
}

router.post("/open-shipment", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { shipmentId, force } = req.body || {};
    const shipmentIdNum = Number(shipmentId);
    if (!Number.isFinite(shipmentIdNum) || shipmentIdNum <= 0) {
      return res.status(400).json({ error: "shipmentId requis" });
    }
    const forceSwitch = Boolean(force);

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select(
        "id,store_id,customer_stripe_id,is_open_shipment,status,product_reference,payment_id",
      )
      .eq("id", shipmentIdNum)
      .maybeSingle();
    if (shipErr) {
      return res.status(500).json({ error: shipErr.message });
    }
    if (!shipment) {
      return res.status(404).json({ error: "Commande introuvable" });
    }
    if (
      String((shipment as any)?.customer_stripe_id || "") !== stripeCustomerId
    ) {
      return res.status(403).json({ error: "Accès interdit à cette commande" });
    }
    const currentStatus = (shipment as any)?.status;
    if (String(currentStatus || "").toUpperCase() === "CANCELLED") {
      return res.status(400).json({ error: "Commande déjà annulée" });
    }

    const storeIdNum = Number((shipment as any)?.store_id || 0);
    const { data: otherOpen, error: otherErr } = await supabase
      .from("shipments")
      .select("id,shipment_id,payment_id")
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("store_id", storeIdNum)
      .eq("is_open_shipment", true)
      .or("status.is.null,status.neq.CANCELLED")
      .neq("id", shipmentIdNum)
      .limit(1);
    if (otherErr) {
      return res.status(500).json({ error: otherErr.message });
    }
    if ((otherOpen || []).length > 0) {
      if (!forceSwitch) {
        return res.status(409).json({
          error: "Une autre commande est déjà ouverte en modification",
          openShipment: (otherOpen || [])[0] || null,
        });
      }
      const openRows = Array.isArray(otherOpen) ? otherOpen : [];
      const openIds = openRows
        .map((r: any) => Number(r?.id || 0))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (openIds.length > 0) {
        const { data: openShipments, error: openShipErr } = await supabase
          .from("shipments")
          .select("id,product_reference,is_open_shipment")
          .in("id", openIds as any)
          .eq("store_id", storeIdNum)
          .eq("customer_stripe_id", stripeCustomerId)
          .limit(50);
        if (openShipErr) {
          return res.status(500).json({ error: openShipErr.message });
        }
        for (const s of Array.isArray(openShipments) ? openShipments : []) {
          if ((s as any)?.is_open_shipment !== true) continue;
          const items = parseProductReferenceItems(
            String((s as any)?.product_reference || "").trim(),
          );
          if (items.length > 0) {
            try {
              await applyStockAdjustmentForItems({
                storeId: storeIdNum,
                items,
                mode: "unrestock",
              });
            } catch (e: any) {
              return res.status(500).json({
                error:
                  e?.message ||
                  "Erreur lors de la restauration du stock (changement de commande)",
              });
            }
          }
        }
      }
      const paymentIdsToCleanup = (otherOpen || [])
        .map((r: any) => String(r?.payment_id || "").trim())
        .filter(Boolean);
      const { error: closeErr } = await supabase
        .from("shipments")
        .update({ is_open_shipment: false })
        .eq("customer_stripe_id", stripeCustomerId)
        .eq("store_id", storeIdNum)
        .eq("is_open_shipment", true)
        .neq("id", shipmentIdNum);
      if (closeErr) {
        return res.status(500).json({ error: closeErr.message });
      }
      if (paymentIdsToCleanup.length > 0) {
        const delResp = await supabase
          .from("carts")
          .delete()
          .eq("customer_stripe_id", stripeCustomerId)
          .eq("store_id", storeIdNum)
          .in("payment_id", paymentIdsToCleanup);
        if (
          delResp.error &&
          !isMissingColumnError(delResp.error, "payment_id")
        ) {
          return res.status(500).json({ error: delResp.error.message });
        }
      }
    }

    const wasAlreadyOpen = Boolean((shipment as any)?.is_open_shipment);

    const { error: updErr } = await supabase
      .from("shipments")
      .update({ is_open_shipment: true })
      .eq("id", shipmentIdNum)
      .eq("store_id", storeIdNum)
      .eq("customer_stripe_id", stripeCustomerId);
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    if (!wasAlreadyOpen) {
      const items = parseProductReferenceItems(
        String((shipment as any)?.product_reference || "").trim(),
      );
      if (items.length > 0) {
        try {
          await applyStockAdjustmentForItems({
            storeId: storeIdNum,
            items,
            mode: "restock",
          });
        } catch (e: any) {
          await supabase
            .from("shipments")
            .update({ is_open_shipment: false })
            .eq("id", shipmentIdNum)
            .eq("store_id", storeIdNum)
            .eq("customer_stripe_id", stripeCustomerId);
          return res.status(500).json({
            error:
              e?.message ||
              "Erreur lors de la préparation du stock pour modification",
          });
        }
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("Error opening shipment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/open-shipment-by-payment", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { paymentId, storeId, force } = req.body || {};
    const paymentIdStr = String(paymentId || "").trim();
    const storeIdNum = Number(storeId);
    if (!paymentIdStr) {
      return res.status(400).json({ error: "paymentId requis" });
    }
    if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
      return res.status(400).json({ error: "storeId requis" });
    }
    const forceSwitch = Boolean(force);

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data: shipment, error: shipmentErr } = await supabase
      .from("shipments")
      .select(
        "id,shipment_id,store_id,customer_stripe_id,payment_id,customer_spent_amount,status,is_open_shipment,product_reference",
      )
      .eq("payment_id", paymentIdStr)
      .eq("store_id", storeIdNum)
      .or("status.is.null,status.neq.CANCELLED")
      .maybeSingle();
    if (shipmentErr) {
      return res.status(500).json({ error: shipmentErr.message });
    }
    if (!shipment) {
      return res.status(404).json({ error: "Commande introuvable" });
    }
    if (
      String((shipment as any)?.customer_stripe_id || "") !== stripeCustomerId
    ) {
      return res.status(403).json({ error: "Accès interdit à cette commande" });
    }
    const currentStatus = (shipment as any)?.status;
    if (String(currentStatus || "").toUpperCase() === "CANCELLED") {
      return res.status(400).json({ error: "Commande déjà annulée" });
    }

    const shipmentIdNum = Number((shipment as any)?.id || 0);
    if (!Number.isFinite(shipmentIdNum) || shipmentIdNum <= 0) {
      return res.status(404).json({ error: "Commande introuvable" });
    }

    const { data: otherOpen, error: otherErr } = await supabase
      .from("shipments")
      .select("id,shipment_id,payment_id")
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("store_id", storeIdNum)
      .eq("is_open_shipment", true)
      .neq("id", shipmentIdNum)
      .limit(1);
    if (otherErr) {
      return res.status(500).json({ error: otherErr.message });
    }
    if ((otherOpen || []).length > 0) {
      if (!forceSwitch) {
        return res.status(409).json({
          error: "Une autre commande est déjà ouverte en modification",
          openShipment: (otherOpen || [])[0] || null,
        });
      }
      const openRows = Array.isArray(otherOpen) ? otherOpen : [];
      const openIds = openRows
        .map((r: any) => Number(r?.id || 0))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (openIds.length > 0) {
        const { data: openShipments, error: openShipErr } = await supabase
          .from("shipments")
          .select("id,product_reference,is_open_shipment")
          .in("id", openIds as any)
          .eq("store_id", storeIdNum)
          .eq("customer_stripe_id", stripeCustomerId)
          .limit(50);
        if (openShipErr) {
          return res.status(500).json({ error: openShipErr.message });
        }
        for (const s of Array.isArray(openShipments) ? openShipments : []) {
          if ((s as any)?.is_open_shipment !== true) continue;
          const items = parseProductReferenceItems(
            String((s as any)?.product_reference || "").trim(),
          );
          if (items.length > 0) {
            try {
              await applyStockAdjustmentForItems({
                storeId: storeIdNum,
                items,
                mode: "unrestock",
              });
            } catch (e: any) {
              return res.status(500).json({
                error:
                  e?.message ||
                  "Erreur lors de la restauration du stock (changement de commande)",
              });
            }
          }
        }
      }
      const paymentIdsToCleanup = (otherOpen || [])
        .map((r: any) => String(r?.payment_id || "").trim())
        .filter(Boolean);
      const { error: closeErr } = await supabase
        .from("shipments")
        .update({ is_open_shipment: false })
        .eq("customer_stripe_id", stripeCustomerId)
        .eq("store_id", storeIdNum)
        .eq("is_open_shipment", true)
        .neq("id", shipmentIdNum);
      if (closeErr) {
        return res.status(500).json({ error: closeErr.message });
      }
      if (paymentIdsToCleanup.length > 0) {
        const delResp = await supabase
          .from("carts")
          .delete()
          .eq("customer_stripe_id", stripeCustomerId)
          .eq("store_id", storeIdNum)
          .in("payment_id", paymentIdsToCleanup);
        if (
          delResp.error &&
          !isMissingColumnError(delResp.error, "payment_id")
        ) {
          return res.status(500).json({ error: delResp.error.message });
        }
      }
    }

    const wasAlreadyOpen = Boolean((shipment as any)?.is_open_shipment);
    const { error: updErr } = await supabase
      .from("shipments")
      .update({ is_open_shipment: true })
      .eq("id", shipmentIdNum);
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    if (!wasAlreadyOpen) {
      const items = parseProductReferenceItems(
        String((shipment as any)?.product_reference || "").trim(),
      );
      if (items.length > 0) {
        try {
          await applyStockAdjustmentForItems({
            storeId: storeIdNum,
            items,
            mode: "restock",
          });
        } catch (e: any) {
          await supabase
            .from("shipments")
            .update({ is_open_shipment: false })
            .eq("id", shipmentIdNum)
            .eq("store_id", storeIdNum)
            .eq("customer_stripe_id", stripeCustomerId);
          return res.status(500).json({
            error:
              e?.message ||
              "Erreur lors de la préparation du stock pour modification",
          });
        }
      }
    }

    const spentRaw = Number((shipment as any)?.customer_spent_amount ?? 0);
    let paidItemsCents = Number.isFinite(spentRaw)
      ? Math.max(0, Math.round(spentRaw))
      : 0;

    if (stripe) {
      try {
        const sessions: any = await stripe.checkout.sessions.list({
          payment_intent: paymentIdStr,
          limit: 1,
        });
        const session: any = Array.isArray(sessions?.data)
          ? sessions.data[0]
          : null;
        const sessionId = String(session?.id || "").trim();
        const sessionTotalCents =
          typeof session?.amount_total === "number" &&
          Number.isFinite(session.amount_total)
            ? Math.max(0, Math.round(session.amount_total))
            : null;
        if (sessionId) {
          const lineItemsResp: any =
            await stripe.checkout.sessions.listLineItems(sessionId, {
              limit: 100,
              expand: ["data.price.product"],
            } as any);
          const regulationRegex = /r[ée]gularisation\s+livraison/i;
          const regulationAmountCents = (lineItemsResp?.data || []).reduce(
            (sum: number, item: any) => {
              const prod = item?.price?.product as any;
              const name =
                typeof prod === "string"
                  ? String(
                      item?.description || item?.price?.nickname || "",
                    ).trim()
                  : String(prod?.name || "").trim();
              const description =
                typeof prod === "string"
                  ? String(item?.description || "").trim()
                  : String(prod?.description || "").trim();
              const isReg =
                regulationRegex.test(name) || regulationRegex.test(description);
              if (!isReg) return sum;
              const vRaw =
                item?.amount_total ??
                item?.amount_subtotal ??
                item?.amount ??
                0;
              const v = Math.max(0, Math.round(Number(vRaw || 0)));
              return sum + (Number.isFinite(v) ? v : 0);
            },
            0,
          );
          if (
            regulationAmountCents > 0 &&
            sessionTotalCents !== null &&
            Math.abs(paidItemsCents - sessionTotalCents) <= 2
          ) {
            paidItemsCents = Math.max(
              0,
              paidItemsCents - regulationAmountCents,
            );
          }
        }
      } catch {}
    }

    return res.json({
      success: true,
      shipmentId: shipmentIdNum,
      shipmentDisplayId: String((shipment as any)?.shipment_id || "").trim(),
      paidValue: Math.max(0, paidItemsCents) / 100,
    });
  } catch (e) {
    console.error("Error opening shipment by payment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/active-open-shipment", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const storeIdNum = Number(req.query.storeId);
    if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
      return res.status(400).json({ error: "storeId requis" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data, error } = await supabase
      .from("shipments")
      .select("id,shipment_id,payment_id")
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("store_id", storeIdNum)
      .eq("is_open_shipment", true)
      .limit(1);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const row: any = (data || [])[0] || null;
    if (!row) return res.json({ openShipment: null });

    return res.json({
      openShipment: {
        id: Number(row?.id || 0) || null,
        shipment_id: String(row?.shipment_id || "").trim() || null,
        payment_id: String(row?.payment_id || "").trim() || null,
      },
    });
  } catch (e) {
    console.error("Error getting active open shipment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/cancel-open-shipment", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { paymentId, storeId } = req.body || {};
    const paymentIdStr = String(paymentId || "").trim();
    const storeIdNum = Number(storeId);
    if (!paymentIdStr) {
      return res.status(400).json({ error: "paymentId requis" });
    }
    if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
      return res.status(400).json({ error: "storeId requis" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data: shipmentByPayment, error: shipmentErr } = await supabase
      .from("shipments")
      .select(
        "id,shipment_id,customer_stripe_id,payment_id,is_open_shipment,product_reference",
      )
      .eq("payment_id", paymentIdStr)
      .eq("store_id", storeIdNum)
      .maybeSingle();
    if (shipmentErr) {
      return res.status(500).json({ error: shipmentErr.message });
    }
    if (
      shipmentByPayment &&
      String((shipmentByPayment as any)?.customer_stripe_id || "") !==
        stripeCustomerId
    ) {
      return res.status(403).json({ error: "Accès interdit à cette commande" });
    }

    const { data: openShipmentRows, error: openErr } = await supabase
      .from("shipments")
      .select(
        "id,shipment_id,payment_id,customer_stripe_id,is_open_shipment,product_reference",
      )
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("store_id", storeIdNum)
      .eq("is_open_shipment", true)
      .limit(50);
    if (openErr) {
      return res.status(500).json({ error: openErr.message });
    }
    const openShipments: any[] = Array.isArray(openShipmentRows)
      ? openShipmentRows
      : [];
    const openShipment: any = openShipments[0] || null;

    const shipmentToClose: any = shipmentByPayment || openShipment;
    if (!shipmentToClose) {
      return res.status(404).json({ error: "Commande introuvable" });
    }

    const idsToClose = Array.from(
      new Set(
        (openShipments.length > 0
          ? openShipments
          : shipmentByPayment
            ? [shipmentByPayment]
            : []
        )
          .map((s: any) => Number(s?.id || 0))
          .filter((n: number) => Number.isFinite(n) && n > 0),
      ),
    );
    if (idsToClose.length === 0) {
      return res
        .status(500)
        .json({ error: "Impossible de fermer la commande" });
    }

    for (const s of openShipments) {
      const items = parseProductReferenceItems(
        String((s as any)?.product_reference || "").trim(),
      );
      if (items.length === 0) continue;
      try {
        await applyStockAdjustmentForItems({
          storeId: storeIdNum,
          items,
          mode: "unrestock",
        });
      } catch (e: any) {
        return res.status(500).json({
          error:
            e?.message ||
            "Erreur lors de la restauration du stock (annulation modification)",
        });
      }
    }

    const { data: closedRows, error: updErr } = await supabase
      .from("shipments")
      .update({ is_open_shipment: false })
      .in("id", idsToClose)
      .eq("store_id", storeIdNum)
      .eq("customer_stripe_id", stripeCustomerId)
      .select("id");
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }
    const closedCount = Array.isArray(closedRows) ? closedRows.length : 0;
    if (closedCount === 0) {
      return res
        .status(500)
        .json({ error: "Impossible de fermer la commande" });
    }

    const { data: stillOpen, error: stillOpenErr } = await supabase
      .from("shipments")
      .select("id")
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("store_id", storeIdNum)
      .eq("is_open_shipment", true)
      .limit(1);
    if (stillOpenErr) {
      return res.status(500).json({ error: stillOpenErr.message });
    }
    if (Array.isArray(stillOpen) && stillOpen.length > 0) {
      return res
        .status(500)
        .json({ error: "Impossible de fermer la commande" });
    }

    const paymentIdsToCleanup = [
      paymentIdStr,
      ...openShipments.map((s: any) => String(s?.payment_id || "").trim()),
      String((shipmentByPayment as any)?.payment_id || "").trim(),
    ].filter(Boolean);

    if (paymentIdsToCleanup.length > 0) {
      const delResp = await supabase
        .from("carts")
        .delete()
        .eq("customer_stripe_id", stripeCustomerId)
        .eq("store_id", storeIdNum)
        .in("payment_id", Array.from(new Set(paymentIdsToCleanup)));
      if (delResp.error && !isMissingColumnError(delResp.error, "payment_id")) {
        return res.status(500).json({ error: delResp.error.message });
      }
    }

    return res.json({
      success: true,
      shipmentDisplayId: String(
        (shipmentToClose as any)?.shipment_id || "",
      ).trim(),
    });
  } catch (e) {
    console.error("Error cancelling open shipment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rebuild-carts-from-payment", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { paymentId, storeId } = req.body || {};
    const paymentIdStr = String(paymentId || "").trim();
    const storeIdNum = Number(storeId);
    if (!paymentIdStr) {
      return res.status(400).json({ error: "paymentId requis" });
    }
    if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
      return res.status(400).json({ error: "storeId requis" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data: shipment, error: shipmentErr } = await supabase
      .from("shipments")
      .select(
        "id,store_id,customer_stripe_id,payment_id,product_reference,delivery_method,delivery_network",
      )
      .eq("payment_id", paymentIdStr)
      .eq("store_id", storeIdNum)
      .maybeSingle();
    if (shipmentErr) {
      return res.status(500).json({ error: shipmentErr.message });
    }
    if (!shipment) {
      return res.status(404).json({ error: "Commande introuvable" });
    }
    if (
      String((shipment as any)?.customer_stripe_id || "") !== stripeCustomerId
    ) {
      return res.status(403).json({ error: "Accès interdit à cette commande" });
    }

    const shipmentIdNum = Number((shipment as any)?.id || 0);
    if (Number.isFinite(shipmentIdNum) && shipmentIdNum > 0) {
      const { error: updPaymentErr } = await supabase
        .from("shipments")
        .update({ payment_id: paymentIdStr })
        .eq("id", shipmentIdNum)
        .eq("store_id", storeIdNum)
        .eq("customer_stripe_id", stripeCustomerId);
      if (updPaymentErr) {
        return res.status(500).json({ error: updPaymentErr.message });
      }
    }

    let items: Array<{
      product_reference: string;
      description: string;
      value: number;
      quantity: number;
      weight: number;
    }> = [];

    const isDeliveryRegulationItem = (ref: string, description: string) =>
      /r[ée]gularisation\s+livraison/i.test(String(ref || "").trim()) ||
      /r[ée]gularisation\s+livraison/i.test(String(description || "").trim());

    const parsedFromShipment = parseProductReferenceItems(
      String((shipment as any)?.product_reference || ""),
    );

    const lineItemByProductId = new Map<
      string,
      { name: string; description: string; value: number; weight: number }
    >();
    const lineItemByNameLower = new Map<
      string,
      { name: string; description: string; value: number; weight: number }
    >();

    if (stripe) {
      try {
        const sessions: any = await stripe.checkout.sessions.list({
          payment_intent: paymentIdStr,
          limit: 1,
        });
        const sessionId = String(sessions?.data?.[0]?.id || "").trim();
        if (sessionId) {
          const lineItemsResp: any =
            await stripe.checkout.sessions.listLineItems(sessionId, {
              limit: 100,
              expand: ["data.price.product"],
            } as any);
          const lineItems = Array.isArray(lineItemsResp?.data)
            ? lineItemsResp.data
            : [];
          for (const li of lineItems) {
            const priceObj: any = li?.price || null;
            const unitAmount = Number(priceObj?.unit_amount || 0);
            const value = Number.isFinite(unitAmount)
              ? Math.max(0, unitAmount / 100)
              : 0;
            const prodObj: any = priceObj?.product || null;
            const productId = String(prodObj?.id || "").trim();
            const name = String(prodObj?.name || li?.description || "").trim();
            const description = String(
              prodObj?.description || li?.description || "",
            ).trim();
            const rawMetaWeight =
              (prodObj?.metadata as any)?.weight ??
              (prodObj?.metadata as any)?.weight_kg;
            const parsedMetaWeight = rawMetaWeight
              ? Number(String(rawMetaWeight).replace(",", "."))
              : NaN;
            const weight = Number.isFinite(parsedMetaWeight)
              ? Math.max(0, parsedMetaWeight)
              : (parseWeightKgFromDescription(description) ??
                getFallbackWeightKgFromDescription(description));
            const entry = { name, description, value, weight };
            if (productId && productId.startsWith("prod_")) {
              lineItemByProductId.set(productId, entry);
            }
            if (name) {
              lineItemByNameLower.set(name.toLowerCase(), entry);
            }
          }
        }
      } catch {}
    }

    const parsedRefs = (parsedFromShipment || [])
      .map((p) => String(p?.reference || "").trim())
      .filter(Boolean);
    const onlyStripeIds =
      parsedRefs.length > 0 &&
      parsedRefs.every((p) => String(p || "").startsWith("prod_"));

    const stockRefByProductId = new Map<string, string>();
    if (onlyStripeIds) {
      const ids = Array.from(new Set(parsedRefs));
      if (ids.length > 0) {
        const { data: stockRows, error: stockErr } = await supabase
          .from("stock")
          .select("product_reference,product_stripe_id")
          .eq("store_id", storeIdNum)
          .in("product_stripe_id", ids as any);
        if (stockErr) {
          return res.status(500).json({ error: stockErr.message });
        }
        for (const r of Array.isArray(stockRows) ? stockRows : []) {
          const pid = String((r as any)?.product_stripe_id || "").trim();
          const ref = String((r as any)?.product_reference || "").trim();
          if (pid && ref) stockRefByProductId.set(pid, ref);
        }
      }
    }

    if (parsedFromShipment.length > 0) {
      items = parsedFromShipment
        .map((p) => {
          const refRaw = String(p?.reference || "").trim();
          const qty = Math.max(1, Number(p?.quantity || 1));
          const shippedDesc = String(p?.description || "").trim();

          const li = refRaw.startsWith("prod_")
            ? lineItemByProductId.get(refRaw) || null
            : lineItemByNameLower.get(refRaw.toLowerCase()) || null;

          const resolvedRef = refRaw.startsWith("prod_")
            ? String(stockRefByProductId.get(refRaw) || refRaw).trim()
            : refRaw;

          const description = String(
            li?.description || shippedDesc || "",
          ).trim();
          const weight =
            typeof li?.weight === "number" && Number.isFinite(li.weight)
              ? Math.max(0, li.weight)
              : (parseWeightKgFromDescription(description) ??
                getFallbackWeightKgFromDescription(description));

          return {
            product_reference: resolvedRef,
            description,
            value: typeof li?.value === "number" ? li.value : 0,
            quantity: qty,
            weight,
          };
        })
        .filter(
          (it) =>
            Boolean(String(it.product_reference || "").trim()) &&
            !isDeliveryRegulationItem(it.product_reference, it.description),
        );
    } else if (lineItemByProductId.size > 0 || lineItemByNameLower.size > 0) {
      const fallbackItems: Array<{
        product_reference: string;
        description: string;
        value: number;
        quantity: number;
        weight: number;
      }> = [];

      for (const [pid, li] of lineItemByProductId.entries()) {
        if (!pid) continue;
        if (isDeliveryRegulationItem(li.name, li.description)) continue;
        fallbackItems.push({
          product_reference: pid,
          description: li.description,
          value: li.value,
          quantity: 1,
          weight: li.weight,
        });
      }

      items = fallbackItems;
    }

    {
      const delResp = await supabase
        .from("carts")
        .delete()
        .eq("customer_stripe_id", stripeCustomerId)
        .eq("store_id", storeIdNum)
        .eq("payment_id", paymentIdStr);
      if (delResp.error && !isMissingColumnError(delResp.error, "payment_id")) {
        return res.status(500).json({ error: delResp.error.message });
      }
    }

    const nowIso = new Date().toISOString();
    const baseRowsWithWeight = items.map((it) => ({
      store_id: storeIdNum,
      product_reference: it.product_reference,
      value: it.value,
      customer_stripe_id: stripeCustomerId,
      payment_id: paymentIdStr,
      description: it.description,
      quantity: it.quantity,
      weight: it.weight,
      created_at: nowIso,
    }));

    let insertErr: any = null;
    const candidates: any[][] = [];
    const pushCandidate = (rows: any[]) => {
      const key = JSON.stringify(
        (rows || []).map((r) =>
          Object.keys(r || {})
            .sort()
            .reduce((acc: any, k) => {
              acc[k] = (r as any)[k];
              return acc;
            }, {}),
        ),
      );
      if (!candidates.some((c) => (c as any).__key === key)) {
        (rows as any).__key = key;
        candidates.push(rows);
      }
    };

    const rowsNoStatus = baseRowsWithWeight;
    const rowsNoStatusNoWeight = baseRowsWithWeight.map((r: any) => {
      const { weight: _w, ...rest } = r;
      return rest;
    });
    const rowsNoStatusNoPayment = baseRowsWithWeight.map((r: any) => {
      const { payment_id: _p, ...rest } = r;
      return rest;
    });
    const rowsNoStatusNoPaymentNoWeight = baseRowsWithWeight.map((r: any) => {
      const { payment_id: _p, weight: _w, ...rest } = r;
      return rest;
    });

    pushCandidate(rowsNoStatus);
    pushCandidate(rowsNoStatusNoWeight);
    pushCandidate(rowsNoStatusNoPayment);
    pushCandidate(rowsNoStatusNoPaymentNoWeight);

    for (const cand of candidates) {
      const resp = await supabase.from("carts").insert(cand);
      insertErr = resp.error;
      if (!insertErr) break;
    }
    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    return res.json({ success: true, count: items.length });
  } catch (e) {
    console.error("Error rebuilding carts from payment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/request-return", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      paymentId,
      storeId,
      items,
      return_method,
      return_store_address,
      return_parcel_point,
      return_delivery_network,
    } = req.body || {};
    const paymentIdStr = String(paymentId || "").trim();
    const storeIdNum = Number(storeId);
    const itemsArr: any[] = Array.isArray(items) ? items : [];
    const returnMethodRaw = String(return_method || "").trim();
    const returnMethod: "home_delivery" | "pickup_point" | "store_pickup" | null =
      returnMethodRaw === "home_delivery" ||
      returnMethodRaw === "pickup_point" ||
      returnMethodRaw === "store_pickup"
        ? (returnMethodRaw as "home_delivery" | "pickup_point" | "store_pickup")
        : null;
    const returnDeliveryNetwork = String(return_delivery_network || "").trim() || null;
    const returnStoreAddress =
      return_store_address && typeof return_store_address === "object"
        ? {
            line1: String((return_store_address as any)?.line1 || "").trim() || null,
            line2: String((return_store_address as any)?.line2 || "").trim() || null,
            postal_code:
              String((return_store_address as any)?.postal_code || "").trim() ||
              null,
            city: String((return_store_address as any)?.city || "").trim() || null,
            country:
              String((return_store_address as any)?.country || "").trim() || null,
            state: String((return_store_address as any)?.state || "").trim() || null,
          }
        : null;
    const returnParcelPoint = return_parcel_point ?? null;

    if (!paymentIdStr) {
      return res.status(400).json({ error: "paymentId requis" });
    }
    if (!Number.isFinite(storeIdNum) || storeIdNum <= 0) {
      return res.status(400).json({ error: "storeId requis" });
    }
    if (itemsArr.length === 0) {
      return res.status(400).json({ error: "items requis" });
    }

    const normalizedItems = itemsArr
      .map((it) => {
        const ref = String(it?.product_reference || "").trim();
        const description = String(it?.description || "").trim();
        const quantity = Math.max(1, Math.round(Number(it?.quantity || 1)));
        const value = Number(it?.value ?? 0);
        const cartItemId = Number(it?.cart_item_id ?? it?.id ?? NaN);
        return {
          cart_item_id: Number.isFinite(cartItemId) ? cartItemId : null,
          product_reference: ref,
          description: description || null,
          quantity,
          value: Number.isFinite(value) ? value : 0,
        };
      })
      .filter((it) => Boolean(it.product_reference));

    if (normalizedItems.length === 0) {
      return res.status(400).json({ error: "items invalides" });
    }
    const cartItemIds = Array.from(
      new Set(
        normalizedItems
          .map((it) => Number(it.cart_item_id || 0))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    );
    if (cartItemIds.length !== normalizedItems.length) {
      return res.status(400).json({ error: "cart_item_id requis" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const stripeCustomerId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();
    if (!stripeCustomerId) {
      return res
        .status(400)
        .json({ error: "stripe_id manquant dans les metadata du user" });
    }

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select("*")
      .eq("payment_id", paymentIdStr)
      .eq("store_id", storeIdNum)
      .eq("customer_stripe_id", stripeCustomerId)
      .maybeSingle();
    if (shipErr) {
      return res.status(500).json({ error: shipErr.message });
    }
    if (!shipment) {
      return res.status(404).json({ error: "Commande introuvable" });
    }

    const { data: cartRows, error: cartErr } = await supabase
      .from("carts")
      .select(
        "id,store_id,customer_stripe_id,payment_id,product_reference,description,value,quantity",
      )
      .in("id", cartItemIds)
      .eq("store_id", storeIdNum)
      .eq("customer_stripe_id", stripeCustomerId)
      .eq("payment_id", paymentIdStr);
    if (cartErr) {
      if (isMissingColumnError(cartErr, "payment_id")) {
        return res
          .status(500)
          .json({ error: "Impossible de valider: colonne payment_id manquante" });
      }
      return res.status(500).json({ error: cartErr.message });
    }
    const cartById = new Map<number, any>();
    for (const r of cartRows || []) {
      const id = Number((r as any)?.id || 0);
      if (Number.isFinite(id) && id > 0) cartById.set(id, r);
    }
    if (cartById.size !== cartItemIds.length) {
      return res
        .status(400)
        .json({ error: "Certains articles sont introuvables" });
    }

    const validatedItems = normalizedItems.map((it) => {
      const cartId = Number(it.cart_item_id || 0);
      const row = cartById.get(cartId) || null;
      if (!row) {
        throw new Error("Certains articles sont introuvables");
      }
      const rowQty = Math.max(1, Math.round(Number((row as any)?.quantity || 1)));
      const reqQty = Math.max(1, Math.round(Number(it.quantity || 1)));
      if (reqQty > rowQty) {
        throw new Error(
          `Quantité invalide pour ${String(
            (row as any)?.product_reference || "",
          ).trim()}: max ${rowQty}`,
        );
      }
      return {
        cart_item_id: cartId,
        product_reference: String((row as any)?.product_reference || "").trim(),
        description:
          String((row as any)?.description || "").trim() ||
          String(it.description || "").trim() ||
          null,
        quantity_requested: reqQty,
        quantity_in_order: rowQty,
        value: Number((row as any)?.value ?? it.value ?? 0) || 0,
      };
    });

    let store: any = null;
    const { data: storeData, error: storeErr } = await supabase
      .from("stores")
      .select("id,name,owner_email,slug")
      .eq("id", storeIdNum)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message });
    }
    store = storeData || null;

    const subject = "Demande de retour client (articles sélectionnés)";
    const message = `Demande de retour pour payment_id=${paymentIdStr}, shipment_id=${String(
      (shipment as any)?.shipment_id || "",
    ).trim()}.`;
    const context = JSON.stringify(
      {
        paymentId: paymentIdStr,
        store,
        shipment,
        items: validatedItems,
        return: {
          method: returnMethod,
          delivery_network: returnDeliveryNetwork,
          store_address: returnStoreAddress,
          parcel_point: returnParcelPoint,
        },
      },
      null,
      2,
    );

    const sent = await emailService.sendAdminError({
      subject,
      message,
      context,
    });

    if (sent) {
      try {
        const { error: updErr } = await supabase
          .from("shipments")
          .update({ return_requested: true })
          .eq("id", Number((shipment as any)?.id || 0))
          .eq("store_id", storeIdNum)
          .eq("customer_stripe_id", stripeCustomerId);
        if (updErr) {
          console.error("Supabase update return_requested failed:", updErr);
        }
      } catch (dbEx) {
        console.error("DB update return_requested exception:", dbEx);
      }
    }

    return res.json({ success: true, emailSent: sent });
  } catch (e) {
    if (e instanceof Error) {
      const msg = String(e.message || "").trim();
      if (msg) return res.status(400).json({ error: msg });
    }
    console.error("Error in /api/shipments/request-return:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/shipments/customer?stripeId=<id>
router.get("/customer", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const stripeId = (req.query.stripeId as string) || "";

    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    const { data, error } = await supabase
      .from("shipments")
      .select("*")
      .eq("customer_stripe_id", stripeId)
      .order("id", { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const storeIds = Array.from(
      new Set((data || []).map((d: any) => d.store_id).filter(Boolean)),
    );

    let storesMap: Record<
      number,
      {
        name: string;
        slug: string;
        description?: string | null;
        address?: any | null;
        website?: string | null;
        owner_email?: string | null;
      }
    > = {};
    if (storeIds.length > 0) {
      const { data: storesData, error: storesError } = await supabase
        .from("stores")
        .select("id,name,slug, description, address, website, owner_email")
        .in("id", storeIds);
      if (storesError) {
        return res.status(500).json({ error: storesError.message });
      }
      storesMap = (storesData || []).reduce(
        (
          acc: Record<
            number,
            {
              name: string;
              slug: string;
              description?: string | null;
              address?: any | null;
              website?: string | null;
              owner_email?: string | null;
            }
          >,
          s: any,
        ) => {
          acc[s.id] = {
            name: s.name,
            slug: s.slug,
            description: s.description ?? null,
            address: s.address ?? null,
            website: s.website ?? null,
            owner_email: s.owner_email ?? null,
          };
          return acc;
        },
        {},
      );
    }

    const result = (data || []).map((rec: any) => ({
      ...rec,
      store: rec.store_id ? storesMap[rec.store_id] || null : null,
    }));

    return res.json({ shipments: result });
  } catch (e) {
    console.error("Error fetching shipments:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/shipments/stores-for-customer/:stripeId
router.get("/stores-for-customer/:stripeId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const stripeId = req.params.stripeId;
    if (!stripeId) {
      return res.status(400).json({ error: "Missing stripeId" });
    }

    console.log("Fetching stores for customer with stripeId:", stripeId);

    const { data, error } = await supabase
      .from("shipments")
      .select("store_id")
      .eq("customer_stripe_id", stripeId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const storeIds = Array.from(
      new Set((data || []).map((d: any) => d.store_id).filter(Boolean)),
    );

    if (storeIds.length === 0) {
      return res.json({ slugs: [] });
    }

    const { data: stores, error: storesErr } = await supabase
      .from("stores")
      .select("id,slug")
      .in("id", storeIds);

    if (storesErr) {
      return res.status(500).json({ error: storesErr.message });
    }

    const slugs = (stores || []).map((s: any) => s.slug).filter(Boolean);
    return res.json({ slugs });
  } catch (e) {
    console.error("Error fetching stores for customer:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/shipments/store/:storeSlug - list shipments for a store (owner/admin only)
router.get("/store/:storeSlug", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const storeSlug = req.params.storeSlug;
    if (!storeSlug) {
      return res.status(400).json({ error: "Missing storeSlug" });
    }

    const decoded = decodeURIComponent(storeSlug);
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id,slug,name,clerk_id")
      .eq("slug", decoded)
      .single();

    if (storeErr) {
      if ((storeErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "La boutique n'existe pas" });
      }
      return res.status(500).json({ error: storeErr.message });
    }

    const requesterId = auth.userId || null;
    if (!requesterId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const isOwner = store?.clerk_id && store.clerk_id === requesterId;
    if (!isOwner) {
      return res.status(403).json({ error: "Accès refusé !" });
    }

    const { data: shipments, error: shipErr } = await supabase
      .from("shipments")
      .select("*")
      .eq("store_id", store.id)
      .order("id", { ascending: false });

    if (shipErr) {
      return res.status(500).json({ error: shipErr.message });
    }

    return res.json({
      shipments,
      store: { id: store.id, name: store.name, slug: store.slug },
    });
  } catch (e) {
    console.error("Error fetching store shipments:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/cancel", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid shipment id" });
    }
    const traceId = `SHIPMENT_CANCEL:${id}:${Date.now()}`;
    console.log("SHIPMENT_CANCEL: start", { traceId, id });

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select(
        "id,store_id,customer_stripe_id,status,product_reference,shipment_id,payment_id,customer_spent_amount,store_earnings_amount",
      )
      .eq("id", id)
      .maybeSingle();
    if (shipErr) {
      if ((shipErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Shipment not found" });
      }
      return res.status(500).json({ error: shipErr.message });
    }
    if (!shipment) {
      return res.status(404).json({ error: "Shipment not found" });
    }

    const user = await clerkClient.users.getUser(auth.userId);
    const requesterStripeId = String(
      (user?.publicMetadata as any)?.stripe_id || "",
    ).trim();

    const storeId = Number((shipment as any)?.store_id || 0);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(400).json({ error: "Shipment has no store_id" });
    }

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id,clerk_id,name,owner_email,slug")
      .eq("id", storeId)
      .maybeSingle();
    if (storeErr) {
      if ((storeErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Store not found" });
      }
      return res.status(500).json({ error: storeErr.message });
    }
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    const isOwner =
      Boolean((store as any)?.clerk_id) &&
      String((store as any)?.clerk_id) === String(auth.userId);
    const shipmentCustomerStripeId = String(
      (shipment as any)?.customer_stripe_id || "",
    ).trim();
    const isCustomer =
      Boolean(requesterStripeId) &&
      requesterStripeId === shipmentCustomerStripeId;

    if (!isOwner && !isCustomer) {
      console.warn("SHIPMENT_CANCEL: forbidden", { traceId, id });
      return res.status(403).json({ error: "Forbidden" });
    }

    const st = String((shipment as any)?.status ?? "")
      .trim()
      .toUpperCase();
    if (st !== "" && st !== "PENDING") {
      console.warn("SHIPMENT_CANCEL: invalid status", { traceId, id, st });
      return res.status(400).json({ error: "Annulation non autorisée" });
    }

    const productRefRaw = String((shipment as any)?.product_reference || "")
      .trim()
      .toString();
    const productItems = parseProductReferenceItems(productRefRaw);
    console.log("SHIPMENT_CANCEL: parsed items", {
      traceId,
      id,
      itemsCount: productItems.length,
    });
    if (productItems.length > 0) {
      const stripeIds = productItems
        .map((it) => String(it.reference || "").trim())
        .filter((r) => r.startsWith("prod_"));
      const refs = productItems
        .map((it) => String(it.reference || "").trim())
        .filter((r) => r && !r.startsWith("prod_"));

      const stockByStripeId = new Map<string, any>();
      if (stripeIds.length > 0) {
        const unique = Array.from(new Set(stripeIds));
        const { data: rows, error: readErr } = await supabase
          .from("stock")
          .select("id,product_stripe_id,quantity,bought")
          .eq("store_id", storeId)
          .in("product_stripe_id", unique as any);
        if (readErr) return res.status(500).json({ error: readErr.message });
        for (const r of Array.isArray(rows) ? rows : []) {
          const pid = String((r as any)?.product_stripe_id || "").trim();
          if (pid) stockByStripeId.set(pid, r);
        }
      }

      const stockByReference = new Map<string, any>();
      if (refs.length > 0) {
        const unique = Array.from(new Set(refs));
        const { data: rows, error: readErr } = await supabase
          .from("stock")
          .select("id,product_reference,quantity,bought")
          .eq("store_id", storeId)
          .in("product_reference", unique as any);
        if (readErr) return res.status(500).json({ error: readErr.message });
        for (const r of Array.isArray(rows) ? rows : []) {
          const ref = String((r as any)?.product_reference || "").trim();
          if (ref) stockByReference.set(ref, r);
        }
      }

      for (const it of productItems) {
        const reference = String(it.reference || "").trim();
        if (!reference) continue;
        const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
        const row = reference.startsWith("prod_")
          ? stockByStripeId.get(reference)
          : stockByReference.get(reference);
        const stockId = Number((row as any)?.id || 0);
        if (!row || !Number.isFinite(stockId) || stockId <= 0) continue;

        const bRaw = Number((row as any)?.bought || 0);
        const currentBought =
          Number.isFinite(bRaw) && bRaw >= 0 ? Math.floor(bRaw) : 0;
        const nextBought = Math.max(0, currentBought - qty);

        const rawQtyField = (row as any)?.quantity;
        if (rawQtyField === null || rawQtyField === undefined) {
          const { error: updErr } = await supabase
            .from("stock")
            .update({ bought: nextBought } as any)
            .eq("id", stockId)
            .eq("store_id", storeId);
          if (updErr) return res.status(500).json({ error: updErr.message });
          continue;
        }

        const parsedQty = Number(rawQtyField);
        const available =
          Number.isFinite(parsedQty) && parsedQty >= 0
            ? Math.floor(parsedQty)
            : 0;
        const nextQty = available + qty;
        const { error: updErr } = await supabase
          .from("stock")
          .update({ quantity: nextQty, bought: nextBought } as any)
          .eq("id", stockId)
          .eq("store_id", storeId);
        if (updErr) return res.status(500).json({ error: updErr.message });
      }
    }

    console.log("SHIPMENT_CANCEL: stock updated", { traceId, id });

    const { error: updErr } = await supabase
      .from("shipments")
      .update({ status: "CANCELLED" })
      .eq("id", id);
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    const { data: updated, error: rereadErr } = await supabase
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (rereadErr) {
      return res.status(500).json({ error: rereadErr.message });
    }

    const shippingOrderId = String((shipment as any)?.shipment_id || "").trim();
    let boxtalCancel: any = null;
    let credit: any = null;
    if (shippingOrderId) {
      try {
        const base = getInternalBase();
        const url = `${base}/api/boxtal/shipping-orders/${encodeURIComponent(
          shippingOrderId,
        )}?silent=true&via=shipments_cancel&traceId=${encodeURIComponent(
          traceId,
        )}`;
        console.log("SHIPMENT_CANCEL: boxtal delete request", {
          traceId,
          id,
          shippingOrderId,
          url,
        });
        const resp = await fetch(url, { method: "DELETE" });
        const contentType = resp.headers.get("content-type") || "";
        const body = contentType.includes("application/json")
          ? await resp.json().catch(() => null as any)
          : await resp.text().catch(() => "");
        boxtalCancel = {
          ok: resp.ok,
          status: resp.status,
          body,
        };
        credit = (body as any)?.credit || null;
        console.log("SHIPMENT_CANCEL: boxtal delete response", {
          traceId,
          id,
          shippingOrderId,
          ok: resp.ok,
          status: resp.status,
        });
      } catch (boxtalEx) {
        boxtalCancel = {
          ok: false,
          status: 0,
          error:
            boxtalEx instanceof Error ? boxtalEx.message : String(boxtalEx),
        };
        console.error("SHIPMENT_CANCEL: boxtal delete exception", {
          traceId,
          id,
          shippingOrderId,
        });
      }
    } else {
      console.log("SHIPMENT_CANCEL: no shipment_id, skipping boxtal delete", {
        traceId,
        id,
      });
      const customerStripeId = String(
        (shipment as any)?.customer_stripe_id || "",
      ).trim();
      const paymentId = String((shipment as any)?.payment_id || "").trim();
      const customerSpentAmountCents = Math.max(
        0,
        Math.round(Number((shipment as any)?.customer_spent_amount || 0)),
      );
      const creditCents = Number.isFinite(customerSpentAmountCents)
        ? customerSpentAmountCents
        : 0;

      credit = {
        attempted: false,
        updated: false,
        alreadyIssued: false,
        creditCents,
        prevBalanceCents: null,
        nextBalanceCents: null,
        customerStripeId: customerStripeId || null,
        paymentId: paymentId || null,
        error: null,
        source: "shipments_cancel",
      };

      if (!stripe) {
        credit.error = "stripe_client_unavailable";
        console.warn("SHIPMENT_CANCEL: stripe client unavailable", {
          traceId,
          id,
        });
      } else if (!customerStripeId) {
        credit.error = "missing_customer_stripe_id";
        console.warn("SHIPMENT_CANCEL: missing customer_stripe_id", {
          traceId,
          id,
        });
      } else if (!(creditCents > 0)) {
        console.log("SHIPMENT_CANCEL: no credit to issue", {
          traceId,
          id,
          creditCents,
        });
      } else {
        try {
          credit.attempted = true;
          let alreadyIssued = false;
          if (paymentId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(paymentId);
              const keys = [
                "shipment_cancel_credit_cents",
                "boxtal_cancel_credit_cents",
              ];
              for (const k of keys) {
                const issuedParsed = Number.parseInt(
                  String((pi.metadata as any)?.[k] || "0"),
                  10,
                );
                if (
                  Number.isFinite(issuedParsed) &&
                  issuedParsed === creditCents
                ) {
                  alreadyIssued = true;
                  break;
                }
              }
            } catch (_e) {}
          }
          credit.alreadyIssued = alreadyIssued;

          if (!alreadyIssued) {
            const cust = (await stripe.customers.retrieve(
              customerStripeId,
            )) as Stripe.Customer;
            if (cust && !("deleted" in cust)) {
              const meta = (cust as any)?.metadata || {};
              const prevBalanceParsed = Number.parseInt(
                String(meta?.credit_balance || "0"),
                10,
              );
              const prevBalanceCents = Number.isFinite(prevBalanceParsed)
                ? prevBalanceParsed
                : 0;
              const nextBalanceCents = prevBalanceCents + creditCents;
              credit.prevBalanceCents = prevBalanceCents;
              credit.nextBalanceCents = nextBalanceCents;
              await stripe.customers.update(
                customerStripeId,
                {
                  metadata: {
                    ...meta,
                    credit_balance: String(nextBalanceCents),
                  },
                } as any,
                {
                  idempotencyKey: `credit-shipment-cancel-${id}-${creditCents}`,
                } as any,
              );
              credit.updated = true;
              console.log("SHIPMENT_CANCEL: credit_balance updated", {
                traceId,
                id,
                creditCents,
                prevBalanceCents,
                nextBalanceCents,
              });
              if (paymentId) {
                try {
                  await stripe.paymentIntents.update(paymentId, {
                    metadata: {
                      shipment_cancel_credit_cents: String(creditCents),
                      shipment_cancel_shipment_row_id: String(id),
                    },
                  });
                } catch (_e) {}
              }
            } else {
              credit.error = "stripe_customer_deleted_or_missing";
            }
          } else {
            console.log("SHIPMENT_CANCEL: credit already issued", {
              traceId,
              id,
              creditCents,
            });
          }
        } catch (creditErr) {
          credit.error =
            creditErr instanceof Error ? creditErr.message : String(creditErr);
          console.error("SHIPMENT_CANCEL: credit exception", {
            traceId,
            id,
          });
        }
      }
    }

    const storeName = String((store as any)?.name || "Votre Boutique").trim();
    const storeOwnerEmail = String((store as any)?.owner_email || "").trim();

    const customerStripeId = String(
      (shipment as any)?.customer_stripe_id || "",
    ).trim();
    let customerEmail: string | null = null;
    let customerName: string | null = null;
    if (stripe && customerStripeId) {
      try {
        const cust = await stripe.customers.retrieve(customerStripeId);
        if (cust && !("deleted" in cust)) {
          customerEmail = String((cust as any)?.email || "").trim() || null;
          customerName = String((cust as any)?.name || "").trim() || null;
        }
      } catch (_e) {}
    }

    const customerSpentAmountCents = Math.max(
      0,
      Math.round(Number((shipment as any)?.customer_spent_amount || 0)),
    );
    const orderAmount =
      Number.isFinite(customerSpentAmountCents) && customerSpentAmountCents
        ? customerSpentAmountCents / 100
        : 0;
    const storeEarningsAmountCents = Math.max(
      0,
      Math.round(Number((shipment as any)?.store_earnings_amount || 0)),
    );
    const storeEarningsAmount =
      Number.isFinite(storeEarningsAmountCents) && storeEarningsAmountCents
        ? storeEarningsAmountCents / 100
        : 0;
    const creditCentsRaw = Number((credit as any)?.creditCents || 0);
    const creditCents =
      Number.isFinite(creditCentsRaw) && creditCentsRaw > 0
        ? Math.round(creditCentsRaw)
        : 0;
    const refundCreditAmount = creditCents > 0 ? creditCents / 100 : 0;

    let ownerEmailSent = false;
    let customerEmailSent = false;
    const displayShipmentId = String(
      (shipment as any)?.shipment_id || "",
    ).trim();
    const paymentId = String((shipment as any)?.payment_id || "").trim();
    const productReference = String(
      (shipment as any)?.product_reference || "",
    ).trim();

    if (storeOwnerEmail) {
      try {
        ownerEmailSent = await emailService.sendStoreOwnerOrderCancelled({
          ownerEmail: storeOwnerEmail,
          storeName,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          storeEarningsAmount,
          customerSpentAmount: orderAmount,
          currency: "EUR",
          shipmentId: displayShipmentId || undefined,
          productReference: productReference || undefined,
          paymentId: paymentId || undefined,
        });
      } catch (_e) {}
    }

    if (customerEmail) {
      try {
        customerEmailSent = await emailService.sendCustomerOrderCancelled({
          customerEmail,
          customerName: customerName || undefined,
          storeName,
          customerSpentAmount: orderAmount,
          currency: "EUR",
          refundCreditAmount,
          shipmentId: displayShipmentId || undefined,
          productReference: productReference || undefined,
          paymentId: paymentId || undefined,
        });
      } catch (_e) {}
    }

    console.log("SHIPMENT_CANCEL: emails", {
      traceId,
      id,
      ownerEmailSent,
      customerEmailSent,
      hasStoreOwnerEmail: Boolean(storeOwnerEmail),
      hasCustomerEmail: Boolean(customerEmail),
    });

    console.log("SHIPMENT_CANCEL: done", { traceId, id });
    return res.json({
      shipment: updated,
      boxtalCancel,
      credit,
      emails: { ownerEmailSent, customerEmailSent },
    });
  } catch (e) {
    console.error("Error cancelling shipment:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/invoice", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid shipment id" });
    }

    const { data: shipment, error: shipmentErr } = await supabase
      .from("shipments")
      .select(
        "id,store_id,customer_stripe_id,shipment_id,product_reference,customer_spent_amount,store_earnings_amount,delivery_cost,estimated_delivery_cost,created_at,facture_id,payment_id,promo_code",
      )
      .eq("id", id)
      .single();

    if (shipmentErr) {
      if ((shipmentErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Shipment not found" });
      }
      return res.status(500).json({ error: shipmentErr.message });
    }

    const storeId = (shipment as any)?.store_id as number | null;
    if (!storeId) {
      return res.status(400).json({ error: "Shipment has no store_id" });
    }

    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select(
        "id,name,slug,address,clerk_id,owner_email,siret,tva_applicable,website",
      )
      .eq("id", storeId)
      .single();

    if (storeErr) {
      if ((storeErr as any)?.code === "PGRST116") {
        return res.status(404).json({ error: "Store not found" });
      }
      return res.status(500).json({ error: storeErr.message });
    }

    const isOwner =
      Boolean((store as any)?.clerk_id) &&
      String((store as any).clerk_id) === String(auth.userId);
    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let factureId: number | string | null =
      (shipment as any)?.facture_id ?? null;

    if (factureId === null || String(factureId).trim() === "") {
      const { data: maxRows, error: maxErr } = await supabase
        .from("shipments")
        .select("facture_id")
        .not("facture_id", "is", null)
        .order("facture_id", { ascending: false })
        .limit(1);

      if (maxErr) {
        return res.status(500).json({ error: maxErr.message });
      }

      const maxFactureId = Number((maxRows?.[0] as any)?.facture_id || 0);
      const nextFactureId = Number.isFinite(maxFactureId)
        ? maxFactureId + 1
        : 1;

      const { data: updated, error: updErr } = await supabase
        .from("shipments")
        .update({ facture_id: nextFactureId })
        .eq("id", id)
        .is("facture_id", null)
        .select("facture_id")
        .maybeSingle();

      if (updErr) {
        return res.status(500).json({ error: updErr.message });
      }

      if (updated?.facture_id != null) {
        factureId = updated.facture_id;
      } else {
        const { data: reread, error: rereadErr } = await supabase
          .from("shipments")
          .select("facture_id")
          .eq("id", id)
          .single();
        if (rereadErr) {
          return res.status(500).json({ error: rereadErr.message });
        }
        factureId = (reread as any)?.facture_id ?? null;
      }
    }

    if (factureId === null || String(factureId).trim() === "") {
      return res.status(500).json({ error: "Failed to allocate facture_id" });
    }

    const tvaApplicable = Boolean((store as any)?.tva_applicable);
    const tvaRate = tvaApplicable ? 0.2 : 0;
    const vatPct = tvaApplicable ? 20 : 0;

    const splitTtc = (ttc: number) => {
      const t = Math.max(0, Number.isFinite(ttc) ? ttc : 0);
      if (!tvaApplicable) {
        return { ht: round2(t), vat: 0, ttc: round2(t) };
      }
      const ht = round2(t / (1 + tvaRate));
      const vat = round2(t - ht);
      return { ht, vat, ttc: round2(t) };
    };

    let issueDate = new Date();
    {
      const createdAt = String((shipment as any)?.created_at || "").trim();
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      if (Number.isFinite(createdMs) && createdMs > 0) {
        issueDate = new Date(createdMs);
      }
    }

    const invoiceRows: Array<{
      reference: string;
      description?: string;
      qty: number;
      unitHt: number;
      totalHt: number;
    }> = [];

    const storeEarningsCents = Math.max(
      0,
      Math.round(Number((shipment as any)?.store_earnings_amount || 0)),
    );
    const storeEarningsTtc = storeEarningsCents / 100;
    const regulationRegex = /r[ée]gularisation\s+livraison/i;
    const shippingRegex = /frais\s+de\s+livraison/i;
    const promoCodesAll = String((shipment as any)?.promo_code || "")
      .split(";;")
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .filter((t) => !regulationRegex.test(t));
    const storePromoCodes = promoCodesAll.filter((t) => {
      const up = t.toUpperCase();
      return !up.startsWith("PAYLIVE-") && !up.startsWith("CREDIT-");
    });

    const productLines: Array<{
      reference: string;
      description?: string;
      qty: number;
      grossCents: number;
    }> = [];

    const productRefRaw = String((shipment as any)?.product_reference || "");
    const parsedProductItems = parseProductReferenceItems(productRefRaw);
    const onlyStripeIds =
      parsedProductItems.length > 0 &&
      parsedProductItems.every((p) =>
        String((p as any)?.reference || "").startsWith("prod_"),
      );

    const paymentIdStr = String((shipment as any)?.payment_id || "").trim();
    const lineItemByProductId = new Map<
      string,
      { name: string; description: string; unit_amount_cents: number | null }
    >();
    const lineItemByNameLower = new Map<
      string,
      { name: string; description: string; unit_amount_cents: number | null }
    >();

    if (stripe && paymentIdStr) {
      try {
        const sessions: any = await stripe.checkout.sessions.list({
          payment_intent: paymentIdStr,
          limit: 1,
        });
        const sessionId = String(sessions?.data?.[0]?.id || "").trim();
        if (sessionId) {
          const lineItemsResp: any =
            await stripe.checkout.sessions.listLineItems(sessionId, {
              limit: 100,
              expand: ["data.price.product"],
            } as any);
          const lineItems = Array.isArray(lineItemsResp?.data)
            ? lineItemsResp.data
            : [];
          for (const li of lineItems) {
            const priceObj: any = li?.price || null;
            const unitAmount = Number(priceObj?.unit_amount ?? NaN);
            const unit_amount_cents =
              Number.isFinite(unitAmount) && unitAmount > 0
                ? Math.round(unitAmount)
                : null;

            const prodObj: any = priceObj?.product || null;
            const productId =
              typeof prodObj === "string"
                ? String(prodObj || "").trim()
                : String(prodObj?.id || "").trim();
            const name = String(
              (typeof prodObj === "object" ? prodObj?.name : "") ||
                li?.description ||
                "",
            ).trim();
            const description = String(
              (typeof prodObj === "object" ? prodObj?.description : "") ||
                li?.description ||
                "",
            ).trim();

            if (productId && productId.startsWith("prod_")) {
              lineItemByProductId.set(productId, {
                name: name || productId,
                description,
                unit_amount_cents,
              });
            }
            if (name) {
              lineItemByNameLower.set(name.toLowerCase(), {
                name,
                description,
                unit_amount_cents,
              });
            }
          }
        }
      } catch {}
    }

    const stripeProductCache = new Map<
      string,
      {
        id: string;
        name?: string | null;
        description?: string | null;
        unit_amount_cents?: number | null;
      }
    >();
    const getStripeProductInvoiceDetails = async (pid: string) => {
      const id = String(pid || "").trim();
      if (!id || !id.startsWith("prod_")) return null;
      const cached = stripeProductCache.get(id);
      if (cached) return cached;
      if (!stripe) return null;

      let p: any = null;
      try {
        p = await stripe.products.retrieve(id, {
          expand: ["default_price"],
        } as any);
      } catch {
        p = null;
      }
      if (!p || p.deleted) return null;

      let unitAmountCents: number | null = null;
      const dp: any = (p as any)?.default_price || null;
      if (dp && typeof dp === "object") {
        const ua = Number((dp as any)?.unit_amount ?? NaN);
        if (Number.isFinite(ua) && ua > 0) unitAmountCents = Math.round(ua);
      }
      if (unitAmountCents === null) {
        try {
          const list = await stripe.prices.list({
            product: id,
            active: true,
            limit: 100,
          } as any);
          const prices = Array.isArray((list as any)?.data)
            ? (list as any).data
            : [];
          const eur = prices.find(
            (pr: any) =>
              String(pr?.currency || "").toLowerCase() === "eur" &&
              Number(pr?.unit_amount || 0) > 0,
          );
          const anyActive = prices.find(
            (pr: any) => Number(pr?.unit_amount || 0) > 0,
          );
          const picked = eur || anyActive || null;
          const ua = Number((picked as any)?.unit_amount ?? NaN);
          if (Number.isFinite(ua) && ua > 0) unitAmountCents = Math.round(ua);
        } catch {}
      }

      const row = {
        id,
        name: String(p?.name || "").trim() || null,
        description: String(p?.description || "").trim() || null,
        unit_amount_cents: unitAmountCents,
      };
      stripeProductCache.set(id, row);
      return row;
    };

    if (onlyStripeIds) {
      const stockRefByProductId = new Map<string, string>();
      try {
        const ids = Array.from(
          new Set(
            parsedProductItems
              .map((p) => String((p as any)?.reference || "").trim())
              .filter((id) => id.startsWith("prod_")),
          ),
        );
        if (ids.length > 0) {
          const { data: stockRows, error: stockErr } = await supabase
            .from("stock")
            .select("product_reference,product_stripe_id")
            .eq("store_id", storeId)
            .in("product_stripe_id", ids as any);
          if (!stockErr) {
            for (const r of Array.isArray(stockRows) ? stockRows : []) {
              const p = String((r as any)?.product_stripe_id || "").trim();
              const ref = String((r as any)?.product_reference || "").trim();
              if (p && ref) stockRefByProductId.set(p, ref);
            }
          }
        }
      } catch {}

      for (const it of parsedProductItems) {
        const pid = String((it as any)?.reference || "").trim();
        if (!pid) continue;
        const qty = Math.max(1, Number((it as any)?.quantity || 1));
        const fromLineItem = lineItemByProductId.get(pid) || null;
        const details =
          fromLineItem?.unit_amount_cents != null ||
          String(fromLineItem?.description || "").trim() ||
          String(fromLineItem?.name || "").trim()
            ? null
            : await getStripeProductInvoiceDetails(pid);

        const name = String(fromLineItem?.name || details?.name || pid).trim();
        const desc = String(
          fromLineItem?.description || details?.description || "",
        ).trim();
        const refForInvoice = String(
          stockRefByProductId.get(pid) || pid,
        ).trim();
        if (
          regulationRegex.test(name) ||
          regulationRegex.test(desc) ||
          shippingRegex.test(name) ||
          shippingRegex.test(desc)
        )
          continue;
        const unitCents =
          Math.max(0, Number(fromLineItem?.unit_amount_cents)) ||
          Math.max(0, Math.round(Number(details?.unit_amount_cents || 0)));
        const referenceText =
          name && name !== refForInvoice ? name : refForInvoice || "Produit";
        const descParts: string[] = [];
        if (refForInvoice && refForInvoice !== referenceText) {
          descParts.push(`Réf: ${refForInvoice}`);
        }
        if (desc) descParts.push(desc);
        productLines.push({
          reference: referenceText,
          description: descParts.join(" — ") || undefined,
          qty,
          grossCents: unitCents * qty,
        });
      }
    } else {
      if (parsedProductItems.length === 0) {
        productLines.push({
          reference: "Produit",
          qty: 1,
          grossCents: 0,
        });
      } else {
        for (let i = 0; i < parsedProductItems.length; i++) {
          const it = parsedProductItems[i] as any;
          const qty = Math.max(1, Number(it.quantity || 1));
          const ref = String(it.reference || "").trim();
          const desc = String(it.description || "").trim();
          const li =
            ref && !ref.startsWith("prod_")
              ? lineItemByNameLower.get(ref.toLowerCase()) || null
              : null;
          const liDesc = String(li?.description || "").trim();
          if (
            regulationRegex.test(ref) ||
            regulationRegex.test(desc || liDesc) ||
            shippingRegex.test(ref) ||
            shippingRegex.test(desc || liDesc)
          )
            continue;
          const refText = ref || "Produit";
          const descParts: string[] = [];
          if (refText) descParts.push(`Réf: ${refText}`);
          if (desc) descParts.push(desc);
          else if (liDesc && liDesc !== refText) descParts.push(liDesc);
          productLines.push({
            reference: li?.name ? String(li.name).trim() || refText : refText,
            description: descParts.join(" — ") || undefined,
            qty,
            grossCents: Math.max(0, Number(li?.unit_amount_cents)) * qty,
          });
        }
      }
    }

    const totalGrossCents = productLines.reduce(
      (sum, l) => sum + l.grossCents,
      0,
    );

    const grossSplit = splitTtc(Math.max(0, totalGrossCents) / 100);

    for (const l of productLines) {
      const lineTtc = Math.max(0, l.grossCents) / 100;
      const { ht } = splitTtc(lineTtc);
      const qty = Math.max(1, l.qty);
      const unitHt = qty > 0 ? round2(ht / qty) : 0;
      invoiceRows.push({
        reference: l.reference,
        description: l.description,
        qty,
        unitHt,
        totalHt: ht,
      });
    }

    const totalsSplit = splitTtc(storeEarningsTtc);
    let totalHt = totalsSplit.ht;
    let totalVat = totalsSplit.vat;
    let totalTtc = totalsSplit.ttc;

    const storeDiscountCents =
      storePromoCodes.length > 0
        ? Math.max(0, totalGrossCents - storeEarningsCents)
        : 0;
    const discountSplit = splitTtc(storeDiscountCents / 100);

    if (invoiceRows.length > 0) {
      const sumRowsHt = round2(
        invoiceRows.reduce((sum, r) => sum + (r.totalHt || 0), 0),
      );
      const diff = round2(grossSplit.ht - sumRowsHt);
      if (Math.abs(diff) >= 0.01) {
        const last = invoiceRows[invoiceRows.length - 1];
        last.totalHt = round2(Math.max(0, last.totalHt + diff));
        last.unitHt = round2(last.totalHt / Math.max(1, last.qty));
      }
    }

    let customerName = "";
    let customerEmail = "";
    let customerPhone = "";
    let customerAddressLine = "";
    const customerId = String(
      (shipment as any)?.customer_stripe_id || "",
    ).trim();
    if (stripe && customerId) {
      try {
        const customer: any = await stripe.customers.retrieve(customerId);
        customerName = String(customer?.name || "").trim();
        customerEmail = String(customer?.email || "").trim();
        customerPhone = String(customer?.phone || "").trim();
        const a: any = customer?.address || null;
        const line1 = String(a?.line1 || "").trim();
        const postal = String(a?.postal_code || "").trim();
        const city = String(a?.city || "").trim();
        const country = String(a?.country || "").trim();
        customerAddressLine = [
          line1,
          [postal, city].filter(Boolean).join(" "),
          country,
        ]
          .filter(Boolean)
          .join(", ");
      } catch {}
    }

    const storeAddress: any = (store as any)?.address || null;
    const storeLine1 = String(storeAddress?.line1 || "").trim();
    const storePostal = String(storeAddress?.postal_code || "").trim();
    const storeCity = String(storeAddress?.city || "").trim();
    const storeCountry = String(storeAddress?.country || "").trim();
    const storeAddressLine = [
      storeLine1,
      [storePostal, storeCity].filter(Boolean).join(" "),
      storeCountry,
    ]
      .filter(Boolean)
      .join(", ");
    const storeName = String((store as any)?.name || "").trim() || "—";
    const storeSiret = String((store as any)?.siret || "").trim();
    const storeWebsite = String((store as any)?.website || "").trim();
    const storeEmail = String((store as any)?.owner_email || "").trim();
    const storePhone = String(storeAddress?.phone || "").trim();

    let logoBuffer: Buffer | null = null;
    try {
      const logoUrl = `${getCloudBase()}/images/${storeId}`;
      const logoResp = await fetch(logoUrl);
      if (logoResp.ok) {
        const buf = Buffer.from(await logoResp.arrayBuffer());
        if (buf.length > 0) logoBuffer = buf;
      }
    } catch {}

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;
    const x = margin;
    let y = margin;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, x, y, { fit: [70, 40] });
      } catch {}
    }

    doc.fillColor("#111827");
    doc.fontSize(16).text(`Facture n° ${factureId}`, x, y, { align: "right" });
    doc
      .fontSize(10)
      .fillColor("#374151")
      .text(`Date d’émission : ${formatDateFr(issueDate)}`, x, y + 20, {
        align: "right",
      });

    y += 60;
    doc.save();
    doc.lineWidth(1).strokeColor("#E5E7EB");
    doc
      .moveTo(x, y)
      .lineTo(pageWidth - margin, y)
      .stroke();
    doc.restore();

    y += 14;
    const boxW = (pageWidth - margin * 2 - 20) / 2;
    const rightX = x + boxW + 20;

    doc.fillColor("#111827").fontSize(10).text("Boutique", x, y);
    doc.fillColor("#111827").fontSize(10).text("Client", rightX, y, {
      align: "right",
      width: boxW,
    });

    y += 14;
    doc.fillColor("#111827").fontSize(10).text(storeName, x, y, {
      width: boxW,
    });
    doc
      .fillColor("#111827")
      .fontSize(10)
      .text(customerName || "—", rightX, y, {
        width: boxW,
        align: "right",
      });

    y += 14;
    doc.fillColor("#374151").fontSize(9);
    if (storeAddressLine) {
      doc.text(storeAddressLine, x, y, { width: boxW });
    }
    if (customerAddressLine) {
      doc.text(customerAddressLine, rightX, y, { width: boxW, align: "right" });
    }

    y += 24;
    const storeMetaLines = [
      storeSiret ? `SIRET : ${storeSiret}` : "",
      storePhone ? `Tél : ${storePhone}` : "",
      storeEmail ? `Email : ${storeEmail}` : "",
      storeWebsite ? `Site : ${storeWebsite}` : "",
    ].filter(Boolean);
    if (storeMetaLines.length > 0) {
      doc.text(storeMetaLines.join("\n"), x, y, { width: boxW });
    }
    if (customerEmail) {
      doc.text(customerEmail, rightX, y, { width: boxW, align: "right" });
    }
    if (customerPhone) {
      doc.text(`Tél : ${customerPhone}`, rightX, y + (customerEmail ? 12 : 0), {
        width: boxW,
        align: "right",
      });
    }

    y += customerPhone ? 76 : 64;
    doc.fillColor("#111827");
    doc.fontSize(12).text(capitalizeFirst(formatMonthYearFr(issueDate)), x, y);

    y += 18;
    if (promoCodesAll.length > 0) {
      doc.fillColor("#6B7280");
      doc.fontSize(9).text(`Code promo : ${promoCodesAll.join(", ")}`, x, y);
      y += 18;
      doc.fillColor("#111827");
    } else {
      y += 4;
    }
    const tableW = pageWidth - margin * 2;
    const headerH = 22;
    doc.save();
    doc.rect(x, y, tableW, headerH).fill("#F3F4F6");
    doc.restore();
    doc.fillColor("#374151").fontSize(9);
    const colDescX = x + 8;
    const colQtyX = x + Math.round(tableW * 0.62);
    const colUnitX = x + Math.round(tableW * 0.74);
    const colTotalX = x + Math.round(tableW * 0.88);
    doc.text("Article", colDescX, y + 6);
    doc.text("Qté", colQtyX, y + 6);
    doc.text("Prix unitaire", colUnitX, y + 6);
    doc.text("Total HT", colTotalX, y + 6);

    y += headerH + 10;
    const rows = invoiceRows;

    doc.fillColor("#111827").fontSize(9);
    for (const r of rows) {
      doc.fillColor("#111827").fontSize(9);
      doc.text(r.reference, colDescX, y, { width: colQtyX - colDescX - 8 });
      const hasDesc = Boolean(String(r.description || "").trim());
      if (hasDesc) {
        doc.fillColor("#6B7280").fontSize(8);
        doc.text(String(r.description || "").trim(), colDescX, y + 10, {
          width: colQtyX - colDescX - 8,
        });
      }
      doc.fillColor("#111827").fontSize(9);
      doc.text(String(r.qty), colQtyX, y, { width: colUnitX - colQtyX - 6 });
      doc.text(formatMoneyFr(r.unitHt), colUnitX, y, {
        width: colTotalX - colUnitX - 6,
      });
      doc.text(formatMoneyFr(r.totalHt), colTotalX, y, {
        width: x + tableW - colTotalX - 8,
      });
      y += hasDesc ? 28 : 18;
    }

    y += 16;
    const totalsX = x + tableW - 200;
    doc.fillColor("#111827").fontSize(10);
    if (storeDiscountCents > 0) {
      doc.text("Total brut HT", totalsX, y, { width: 120 });
      doc.text(formatMoneyFr(grossSplit.ht), totalsX, y, {
        width: 200,
        align: "right",
      });
      y += 16;
      const codeLabel =
        storePromoCodes.length > 0 ? ` (${storePromoCodes.join(", ")})` : "";
      const discountLabel = `Remise boutique${codeLabel}`;
      const discountLabelH = doc.heightOfString(discountLabel, { width: 120 });
      const discountRowH = Math.max(16, Math.ceil(discountLabelH));
      doc.text(discountLabel, totalsX, y, { width: 120 });
      doc.text(`-${formatMoneyFr(discountSplit.ht)}`, totalsX, y, {
        width: 200,
        align: "right",
      });
      y += discountRowH;
    }
    doc.text("Total HT", totalsX, y, { width: 120 });
    doc.text(formatMoneyFr(totalHt), totalsX, y, {
      width: 200,
      align: "right",
    });
    y += 16;
    doc.text("TVA", totalsX, y, { width: 120 });
    doc.text(formatMoneyFr(totalVat), totalsX, y, {
      width: 200,
      align: "right",
    });
    y += 16;
    doc.fontSize(11).text("Total", totalsX, y, { width: 120 });
    doc.fontSize(11).text(formatMoneyFr(totalTtc), totalsX, y, {
      width: 200,
      align: "right",
    });

    if (!tvaApplicable) {
      y += 18;
      doc
        .fillColor("#374151")
        .fontSize(9)
        .text("TVA non applicable, article 293B du CGI", totalsX, y, {
          width: 200,
          align: "right",
        });
    }

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

    const pdfBuffer = await collectPdf(doc);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    const customerForFile = sanitizeFilenamePart(
      customerName || customerEmail || customerId || "client",
    );
    const factureIdForFile = String(factureId).replace(/[^\dA-Za-z_-]+/g, "_");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="facture_${factureIdForFile}_${customerForFile}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (e) {
    console.error("Error generating invoice:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
