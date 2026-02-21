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
      .neq("is_cancelled", true)
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
      .neq("is_cancelled", true)
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
      .select(
        "id,shipment_id,store_id,customer_stripe_id,payment_id,customer_spent_amount",
      )
      .eq("payment_id", paymentIdStr)
      .eq("store_id", storeIdNum)
      .neq("is_cancelled", true)
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
              const isDeliveryRegulation =
                /r[ée]gularisation\s+livraison/i.test(ref) ||
                /r[ée]gularisation\s+livraison/i.test(description);
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
              return {
                product_reference: ref,
                description,
                value,
                quantity,
                weight,
                _is_delivery_regulation: isDeliveryRegulation,
              };
            })
            .filter(
              (it: any) =>
                Boolean(String(it.product_reference || "").trim()) &&
                !Boolean((it as any)?._is_delivery_regulation),
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
      vatPct: number;
      totalHt: number;
    }> = [];

    const storeEarningsCents = Math.max(
      0,
      Math.round(Number((shipment as any)?.store_earnings_amount || 0)),
    );
    const storeEarningsTtc = storeEarningsCents / 100;
    const regulationRegex = /r[ée]gularisation\s+livraison/i;
    const shippingRegex = /frais\s+de\s+livraison/i;
    const storePromoCodes = String((shipment as any)?.promo_code || "")
      .split(";;")
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .filter((t) => {
        const up = t.toUpperCase();
        return !up.startsWith("PAYLIVE-") && !up.startsWith("CREDIT-");
      });

    const productLines: Array<{
      reference: string;
      description?: string;
      qty: number;
      grossCents: number;
      netCents: number;
    }> = [];

    const productRefRaw = String((shipment as any)?.product_reference || "");
    const parts = productRefRaw
      .split(";")
      .map((p) => String(p || "").trim())
      .filter(Boolean);
    const onlyStripeIds =
      parts.length > 0 &&
      parts.every((p) => String(p || "").startsWith("prod_"));

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
      const counts = new Map<string, number>();
      for (const pid of parts) {
        const id = String(pid || "").trim();
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
      }

      for (const [pid, qtyRaw] of counts.entries()) {
        const qty = Math.max(1, Number(qtyRaw || 1));
        const details = await getStripeProductInvoiceDetails(pid);
        const name = String(details?.name || pid).trim();
        const desc = String(details?.description || "").trim();
        if (
          regulationRegex.test(name) ||
          regulationRegex.test(desc) ||
          shippingRegex.test(name) ||
          shippingRegex.test(desc)
        )
          continue;
        const unitCents = Math.max(
          0,
          Math.round(Number(details?.unit_amount_cents || 0)),
        );
        productLines.push({
          reference: name || "Produit",
          description: desc || undefined,
          qty,
          grossCents: unitCents * qty,
          netCents: 0,
        });
      }
    } else {
      const productItems = parseProductReferenceItems(productRefRaw);
      if (productItems.length === 0) {
        productLines.push({
          reference: "Produit",
          qty: 1,
          grossCents: 0,
          netCents: 0,
        });
      } else {
        for (let i = 0; i < productItems.length; i++) {
          const it = productItems[i];
          const qty = Math.max(1, Number(it.quantity || 1));
          const ref = String(it.reference || "").trim();
          const desc = String(it.description || "").trim();
          if (
            regulationRegex.test(ref) ||
            regulationRegex.test(desc) ||
            shippingRegex.test(ref) ||
            shippingRegex.test(desc)
          )
            continue;
          productLines.push({
            reference: ref || "Produit",
            description: desc || undefined,
            qty,
            grossCents: 0,
            netCents: 0,
          });
        }
      }
    }

    const totalGrossCents = productLines.reduce(
      (sum, l) => sum + l.grossCents,
      0,
    );
    if (productLines.length > 0) {
      const baseCents = totalGrossCents > 0 ? totalGrossCents : null;
      if (baseCents && baseCents > 0) {
        let allocated = 0;
        for (let i = 0; i < productLines.length; i++) {
          const l = productLines[i];
          if (i === productLines.length - 1) {
            l.netCents = Math.max(0, storeEarningsCents - allocated);
          } else {
            const ratio = Math.min(1, Math.max(0, l.grossCents / baseCents));
            const net = Math.round(storeEarningsCents * ratio);
            l.netCents = Math.max(0, net);
            allocated += l.netCents;
          }
        }
      } else {
        const totalQty = productLines.reduce(
          (sum, l) => sum + Math.max(1, l.qty),
          0,
        );
        let allocated = 0;
        for (let i = 0; i < productLines.length; i++) {
          const l = productLines[i];
          if (i === productLines.length - 1) {
            l.netCents = Math.max(0, storeEarningsCents - allocated);
          } else {
            const ratio =
              totalQty > 0 ? Math.min(1, Math.max(0, l.qty / totalQty)) : 0;
            const net = Math.round(storeEarningsCents * ratio);
            l.netCents = Math.max(0, net);
            allocated += l.netCents;
          }
        }
      }
    }

    for (const l of productLines) {
      const lineTtc = Math.max(0, l.netCents) / 100;
      const { ht } = splitTtc(lineTtc);
      const qty = Math.max(1, l.qty);
      const unitHt = qty > 0 ? round2(ht / qty) : 0;
      invoiceRows.push({
        reference: l.reference,
        description: l.description,
        qty,
        unitHt,
        vatPct,
        totalHt: ht,
      });
    }

    const totalsSplit = splitTtc(storeEarningsTtc);
    let totalHt = totalsSplit.ht;
    let totalVat = totalsSplit.vat;
    let totalTtc = totalsSplit.ttc;

    if (invoiceRows.length > 0) {
      const sumRowsHt = round2(
        invoiceRows.reduce((sum, r) => sum + (r.totalHt || 0), 0),
      );
      const diff = round2(totalHt - sumRowsHt);
      if (Math.abs(diff) >= 0.01) {
        const last = invoiceRows[invoiceRows.length - 1];
        last.totalHt = round2(Math.max(0, last.totalHt + diff));
        last.unitHt = round2(last.totalHt / Math.max(1, last.qty));
      }
    }

    const storeDiscountCents =
      storePromoCodes.length > 0
        ? Math.max(0, totalGrossCents - storeEarningsCents)
        : 0;
    const grossSplit = splitTtc(Math.max(0, totalGrossCents) / 100);
    const discountSplit = splitTtc(storeDiscountCents / 100);

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
    doc.text("Article", colDescX, y + 6);
    doc.text("Qté", colQtyX, y + 6);
    doc.text("Prix unitaire", colUnitX, y + 6);
    doc.text("TVA %", colVatX, y + 6);
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
        width: colVatX - colUnitX - 6,
      });
      doc.text(`${r.vatPct}%`, colVatX, y, { width: colTotalX - colVatX - 6 });
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
