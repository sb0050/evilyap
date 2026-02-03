import express from "express";
import { createClient } from "@supabase/supabase-js";
import { clerkClient, getAuth } from "@clerk/express";
import Stripe from "stripe";
import PDFDocument from "pdfkit";

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

  const items: ProductReferenceItem[] = [];
  for (const p of parts) {
    const [refRaw, tailRaw] = p.split("**", 2);
    const reference = String(refRaw || "").trim();
    const tail = String(tailRaw || "").trim();
    if (!reference) continue;

    let quantity = 1;
    let description = "";

    if (tail) {
      const m = tail.match(/^(\d+)?\s*(?:\((.*)\))?$/);
      if (m?.[1]) {
        const q = Number(m[1]);
        if (Number.isFinite(q) && q > 0) quantity = Math.floor(q);
      }
      if (typeof m?.[2] === "string") description = m[2];
    } else {
      const m = reference.match(/^(.*?)(?:\((.*)\))?$/);
      if (m?.[2]) {
        description = m[2];
      }
    }

    const descClean = String(description || "").trim();
    items.push({
      reference: reference.replace(/\((.*)\)$/, "").trim(),
      quantity,
      description: descClean || undefined,
    });
  }
  return items;
};

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
      .select("id,store_id,customer_stripe_id,is_open_shipment")
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

    const storeIdNum = Number((shipment as any)?.store_id || 0);
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
          .eq("status", "PENDING")
          .in("payment_id", paymentIdsToCleanup);
        if (
          delResp.error &&
          !isMissingColumnError(delResp.error, "payment_id")
        ) {
          return res.status(500).json({ error: delResp.error.message });
        }
      }
    }

    const { error: updErr } = await supabase
      .from("shipments")
      .update({ is_open_shipment: true })
      .eq("id", shipmentIdNum);
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
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
      .select("id,shipment_id,store_id,customer_stripe_id,payment_id,paid_value")
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
          .eq("status", "PENDING")
          .in("payment_id", paymentIdsToCleanup);
        if (
          delResp.error &&
          !isMissingColumnError(delResp.error, "payment_id")
        ) {
          return res.status(500).json({ error: delResp.error.message });
        }
      }
    }

    const { error: updErr } = await supabase
      .from("shipments")
      .update({ is_open_shipment: true })
      .eq("id", shipmentIdNum);
    if (updErr) {
      return res.status(500).json({ error: updErr.message });
    }

    return res.json({
      success: true,
      shipmentId: shipmentIdNum,
      shipmentDisplayId: String((shipment as any)?.shipment_id || "").trim(),
      paidValue: Number((shipment as any)?.paid_value || 0) || 0,
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
      .select("id,shipment_id,customer_stripe_id,payment_id,is_open_shipment")
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
      .select("id,shipment_id,payment_id,customer_stripe_id,is_open_shipment")
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
        .eq("status", "PENDING")
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
          items = lineItems
            .map((li: any) => {
              const qtyRaw = Number(li?.quantity || 1);
              const quantity =
                Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;
              const priceObj: any = li?.price || null;
              const unitAmount = Number(priceObj?.unit_amount || 0);
              const value = Number.isFinite(unitAmount)
                ? Math.max(0, unitAmount / 100)
                : 0;
              const prodObj: any = priceObj?.product || null;
              const ref = String(prodObj?.name || li?.description || "").trim();
              const description = String(
                prodObj?.description || li?.description || "",
              ).trim();
              const weight =
                parseWeightKgFromDescription(description) ??
                getFallbackWeightKgFromDescription(description);
              return {
                product_reference: ref,
                description,
                value,
                quantity,
                weight,
              };
            })
            .filter((it: any) =>
              Boolean(String(it.product_reference || "").trim()),
            );
        }
        console.log("******************", items);
      } catch {}
    }

    if (items.length === 0) {
      const parsed = parseProductReferenceItems(
        String((shipment as any)?.product_reference || ""),
      );
      items = parsed.map((p) => {
        const description = String(p.description || "").trim();
        const weight = getFallbackWeightKgFromDescription(description);
        return {
          product_reference: String(p.reference || "").trim(),
          description,
          value: 0,
          quantity: Math.max(1, Number(p.quantity || 1)),
          weight,
        };
      });
    }

    {
      const delResp = await supabase
        .from("carts")
        .delete()
        .eq("customer_stripe_id", stripeCustomerId)
        .eq("store_id", storeIdNum)
        .eq("status", "PENDING")
        .eq("payment_id", paymentIdStr);
      if (delResp.error && !isMissingColumnError(delResp.error, "payment_id")) {
        return res.status(500).json({ error: delResp.error.message });
      }
    }

    const nowIso = new Date().toISOString();
    const rowsWithWeight = items.map((it) => ({
      store_id: storeIdNum,
      product_reference: it.product_reference,
      value: it.value,
      customer_stripe_id: stripeCustomerId,
      payment_id: paymentIdStr,
      description: it.description,
      status: "PENDING",
      quantity: it.quantity,
      weight: it.weight,
      created_at: nowIso,
    }));

    let insertErr: any = null;
    {
      const resp = await supabase.from("carts").insert(rowsWithWeight);
      insertErr = resp.error;
    }
    if (insertErr && isMissingColumnError(insertErr, "weight")) {
      const rowsWithoutWeight = rowsWithWeight.map((r: any) => {
        const { weight: _w, ...rest } = r;
        return rest;
      });
      const resp2 = await supabase.from("carts").insert(rowsWithoutWeight);
      insertErr = resp2.error;
    }
    if (insertErr && isMissingColumnError(insertErr, "payment_id")) {
      const rowsWithoutPaymentId = rowsWithWeight.map((r: any) => {
        const { payment_id: _p, ...rest } = r;
        return rest;
      });
      const resp2 = await supabase.from("carts").insert(rowsWithoutPaymentId);
      insertErr = resp2.error;
    }
    if (insertErr && isMissingColumnError(insertErr, "weight")) {
      const rowsWithoutPaymentIdAndWeight = rowsWithWeight.map((r: any) => {
        const { payment_id: _p, weight: _w, ...rest } = r;
        return rest;
      });
      const resp2 = await supabase
        .from("carts")
        .insert(rowsWithoutPaymentIdAndWeight);
      insertErr = resp2.error;
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

    try {
      const user = await clerkClient.users.getUser(requesterId);
      const role = (user?.publicMetadata as any)?.role;
    } catch (_e) {
      // default is not admin
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
        "id,store_id,customer_stripe_id,shipment_id,product_reference,paid_value,product_value,delivery_cost,estimated_delivery_cost,created_at,facture_id,payment_id",
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
    const paymentIntentId = String((shipment as any)?.payment_id || "").trim();
    let checkoutSession: any = null;
    let checkoutLineItems: any[] = [];
    let checkoutShippingTtc: number | null = null;
    if (stripe && paymentIntentId) {
      try {
        const paymentIntent: any =
          await stripe.paymentIntents.retrieve(paymentIntentId);
        const created = Number(paymentIntent?.created || 0);
        if (Number.isFinite(created) && created > 0) {
          issueDate = new Date(created * 1000);
        }
      } catch {}

      try {
        const sessions: any = await stripe.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 1,
        });
        const foundId = String(sessions?.data?.[0]?.id || "").trim();
        if (foundId) {
          try {
            checkoutSession = await stripe.checkout.sessions.retrieve(foundId, {
              expand: ["shipping_cost", "shipping_details"],
            } as any);
          } catch {
            checkoutSession = sessions?.data?.[0] || null;
          }
        } else {
          checkoutSession = null;
        }

        if (checkoutSession?.id) {
          try {
            const lineItemsResp: any =
              await stripe.checkout.sessions.listLineItems(
                String(checkoutSession.id),
                { limit: 100, expand: ["data.price.product"] } as any,
              );
            checkoutLineItems = Array.isArray(lineItemsResp?.data)
              ? lineItemsResp.data
              : [];
          } catch {}
        }
        const shipCents =
          checkoutSession?.shipping_cost?.amount_total ??
          checkoutSession?.shipping_cost?.amount_subtotal ??
          null;
        checkoutShippingTtc =
          typeof shipCents === "number" && Number.isFinite(shipCents)
            ? shipCents / 100
            : null;
      } catch {}
    }

    const fallbackProductTtc = Math.max(
      0,
      Number((shipment as any)?.product_value || 0),
    );
    const fallbackDeliveryTtc = Math.max(
      0,
      Number((shipment as any)?.delivery_cost || 0),
    );
    const fallbackProductSplit = splitTtc(fallbackProductTtc);
    const fallbackDeliverySplit = splitTtc(fallbackDeliveryTtc);

    const invoiceRows: Array<{
      description: string;
      qty: number;
      unitHt: number;
      vatPct: number;
      totalHt: number;
    }> = [];

    let totalHt = 0;
    let totalVat = 0;
    let totalTtc = 0;

    if (checkoutLineItems.length > 0) {
      for (const li of checkoutLineItems) {
        const qty = Math.max(1, Number(li?.quantity || 1));
        const amountCents = Number(
          li?.amount_total ?? li?.amount_subtotal ?? 0,
        );
        const lineTtc = Number.isFinite(amountCents) ? amountCents / 100 : 0;
        const { ht, vat, ttc } = splitTtc(lineTtc);
        const unitHt = qty > 0 ? round2(ht / qty) : 0;
        const prod: any = li?.price?.product || null;
        const name = String(prod?.name || li?.description || "Produit").trim();
        const desc = String(prod?.description || "").trim();
        invoiceRows.push({
          description: `${name} Qté: ${qty}${desc ? ` — ${desc}` : ""}`,
          qty,
          unitHt,
          vatPct,
          totalHt: ht,
        });
        totalHt = round2(totalHt + ht);
        totalVat = round2(totalVat + vat);
        totalTtc = round2(totalTtc + ttc);
      }

      const shipTtc =
        checkoutShippingTtc != null ? checkoutShippingTtc : fallbackDeliveryTtc;
      const shipSplit = splitTtc(shipTtc);
      if (shipSplit.ttc > 0) {
        invoiceRows.push({
          description: "Frais de livraison",
          qty: 1,
          unitHt: shipSplit.ht,
          vatPct,
          totalHt: shipSplit.ht,
        });
        totalHt = round2(totalHt + shipSplit.ht);
        totalVat = round2(totalVat + shipSplit.vat);
        totalTtc = round2(totalTtc + shipSplit.ttc);
      }
    } else {
      const productRefRaw = String((shipment as any)?.product_reference || "");
      const productItems = parseProductReferenceItems(productRefRaw);
      if (productItems.length === 0) {
        invoiceRows.push({
          description: "Produit",
          qty: 1,
          unitHt: fallbackProductSplit.ht,
          vatPct,
          totalHt: fallbackProductSplit.ht,
        });
      } else {
        const totalUnits = productItems.reduce(
          (acc, it) => acc + Math.max(1, Number(it.quantity || 1)),
          0,
        );
        let allocatedHt = 0;
        for (let i = 0; i < productItems.length; i++) {
          const it = productItems[i];
          const qty = Math.max(1, Number(it.quantity || 1));
          const lineTotalHt =
            i === productItems.length - 1
              ? round2(fallbackProductSplit.ht - allocatedHt)
              : round2(fallbackProductSplit.ht * (qty / totalUnits));
          allocatedHt = round2(allocatedHt + lineTotalHt);
          const unitHt = round2(lineTotalHt / qty);
          invoiceRows.push({
            description: `${it.reference} Qté: ${qty}${it.description ? ` — ${it.description}` : ""}`,
            qty,
            unitHt,
            vatPct,
            totalHt: lineTotalHt,
          });
        }
      }

      invoiceRows.push({
        description: "Frais de livraison",
        qty: 1,
        unitHt: fallbackDeliverySplit.ht,
        vatPct,
        totalHt: fallbackDeliverySplit.ht,
      });

      totalHt = round2(fallbackProductSplit.ht + fallbackDeliverySplit.ht);
      totalVat = round2(fallbackProductSplit.vat + fallbackDeliverySplit.vat);
      totalTtc = round2(fallbackProductSplit.ttc + fallbackDeliverySplit.ttc);
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

    if (checkoutSession) {
      const cd: any = checkoutSession?.customer_details || null;
      if (!customerName) customerName = String(cd?.name || "").trim();
      if (!customerEmail) customerEmail = String(cd?.email || "").trim();
      if (!customerPhone) customerPhone = String(cd?.phone || "").trim();

      const sd: any = checkoutSession?.shipping_details || null;
      const a: any = sd?.address || cd?.address || null;
      if (!customerAddressLine && a) {
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
      }
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

    y += 22;
    const tableW = pageWidth - margin * 2;
    const headerH = 22;
    doc.save();
    doc.rect(x, y, tableW, headerH).fill("#F3F4F6");
    doc.restore();
    doc.fillColor("#374151").fontSize(9);
    const colDescX = x + 8;
    const colQtyX = x + Math.round(tableW * 0.62);
    const colUnitX = x + Math.round(tableW * 0.7);
    const colVatX = x + Math.round(tableW * 0.83);
    const colTotalX = x + Math.round(tableW * 0.91);
    doc.text("Description", colDescX, y + 6);
    doc.text("Qté", colQtyX, y + 6);
    doc.text("Prix unitaire", colUnitX, y + 6);
    doc.text("TVA %", colVatX, y + 6);
    doc.text("Total HT", colTotalX, y + 6);

    y += headerH + 10;
    const rows = invoiceRows;

    doc.fillColor("#111827").fontSize(9);
    const rowH = 18;
    for (const r of rows) {
      doc.text(r.description, colDescX, y, { width: colQtyX - colDescX - 8 });
      doc.text(String(r.qty), colQtyX, y, { width: colUnitX - colQtyX - 6 });
      doc.text(formatMoneyFr(r.unitHt), colUnitX, y, {
        width: colVatX - colUnitX - 6,
      });
      doc.text(`${r.vatPct}%`, colVatX, y, { width: colTotalX - colVatX - 6 });
      doc.text(formatMoneyFr(r.totalHt), colTotalX, y, {
        width: x + tableW - colTotalX - 8,
      });
      y += rowH;
    }

    y += 16;
    const totalsX = x + tableW - 200;
    doc.fillColor("#111827").fontSize(10);
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
