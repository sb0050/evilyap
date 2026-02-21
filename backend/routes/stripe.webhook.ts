import Stripe from "stripe";
import { emailService } from "../services/emailService";
import { createClient } from "@supabase/supabase-js";

const formatWeight = (weight?: string): number => {
  if (!weight) return 0;
  const cleanWeight = weight.toString().toLowerCase().trim();
  const match = cleanWeight.match(/^(\d+(?:\.\d+)?)\s*(g|kg)?$/);
  if (!match) {
    return 0;
  }
  const value = parseFloat(match[1]);
  const unit = match[2] || "kg";
  if (unit === "kg") {
    return value;
  } else if (unit === "g") {
    return value / 1000;
  }
  return 0;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase environment variables are missing");
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const normalizeRefs = (raw: unknown): string[] => {
  const refs = String(raw || "")
    .split(";")
    .map((s) => String(s || "").trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(refs));
};

const safeStripeMetadata = (
  input: Record<string, any>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input || {})) {
    const key = String(k || "").trim();
    if (!key || key.length > 40) continue;
    if (v === null || v === undefined) continue;
    out[key] = String(v);
  }
  return out;
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

const getInternalBase = (): string => {
  const explicit = (process.env.INTERNAL_API_BASE || "").trim();
  if (explicit) return explicit;
  const vercelUrl = (process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    return /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
  }
  return `http://localhost:${process.env.PORT || 5000}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCapturablePaymentIntent = async (
  paymentIntentId: string,
): Promise<Stripe.PaymentIntent | null> => {
  const id = String(paymentIntentId || "").trim();
  if (!id) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const pi = await stripe.paymentIntents.retrieve(id);
      const status = String((pi as any)?.status || "");
      if (status === "requires_capture" || status === "succeeded") return pi;
    } catch (_e) {}
    await sleep(400 * (attempt + 1));
  }
  try {
    return await stripe.paymentIntents.retrieve(id);
  } catch (_e) {
    return null;
  }
};

const ensurePaymentIntentSucceededForFulfillment = async (
  paymentIntentId: string,
): Promise<Stripe.PaymentIntent | null> => {
  const fresh = await waitForCapturablePaymentIntent(paymentIntentId);
  if (!fresh) return null;
  if (fresh.status === "succeeded") return fresh;

  const captureMethod = String((fresh as any)?.capture_method || "");
  if (captureMethod !== "manual") return null;
  if (fresh.status !== "requires_capture") return null;

  const md: any = (fresh as any)?.metadata || {};
  const amountFromMetaRaw = Number.parseInt(
    String(md?.amount_to_capture_cents || "0"),
    10,
  );
  const amountCapturable = Number((fresh as any)?.amount_capturable || 0);
  const amountToCapture = Math.max(
    0,
    Math.min(
      amountCapturable,
      Number.isFinite(amountFromMetaRaw) && amountFromMetaRaw > 0
        ? amountFromMetaRaw
        : amountCapturable,
    ),
  );
  if (amountToCapture <= 0) return null;

  try {
    await stripe.paymentIntents.capture(
      fresh.id,
      { amount_to_capture: amountToCapture } as any,
      {
        idempotencyKey: `capture-${fresh.id}-${amountToCapture}`,
      } as any,
    );
  } catch (_e) {
    return null;
  }

  try {
    const after = await stripe.paymentIntents.retrieve(fresh.id);
    return after.status === "succeeded" ? after : null;
  } catch (_e) {
    return null;
  }
};

export const stripeWebhookHandler = async (req: any, res: any) => {
  const sig: any = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err: any) {
    console.log(`Webhook signature verification failed.`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  let paymentIntent: Stripe.PaymentIntent | null = null;
  console.log("Event type Webhook:", event.type);

  switch (event.type) {
    case "payment_intent.succeeded":
      console.log("payment_intent.succeeded", event.data.object.id);
      break;
    case "payment_intent.created":
      break;
    case "payment_intent.amount_capturable_updated":
      try {
        const evtPi = event.data.object as Stripe.PaymentIntent;
        const fresh = await stripe.paymentIntents.retrieve(evtPi.id);
        if (fresh.status !== "requires_capture") break;
        const md: any = (fresh as any)?.metadata || {};
        const amountFromMetaRaw = Number.parseInt(
          String(md?.amount_to_capture_cents || "0"),
          10,
        );
        if (!Number.isFinite(amountFromMetaRaw) || amountFromMetaRaw <= 0) {
          break;
        }
        const amountCapturable = Number((fresh as any)?.amount_capturable || 0);
        const amountToCapture = Math.max(
          0,
          Math.min(amountCapturable, amountFromMetaRaw),
        );
        if (amountToCapture <= 0) break;
        await stripe.paymentIntents.capture(
          fresh.id,
          { amount_to_capture: amountToCapture } as any,
          {
            idempotencyKey: `capture-${fresh.id}-${amountToCapture}`,
          } as any,
        );
        console.log("payment_intent.amount_capturable_updated: captured", {
          paymentIntentId: fresh.id,
          amountToCapture,
        });
      } catch (e: any) {
        console.error(
          "payment_intent.amount_capturable_updated: capture failed",
          e?.message || e,
        );
      }
      break;
    case "refund.created":
      console.log(`Remboursement ${event.data.object.id} créé`);
      break;
    case "refund.updated":
      console.log(
        `Remboursement ${event.data.object.id} mis à jour: ${event.data.object.status}`,
      );
      break;
    case "refund.failed":
      console.log(`Remboursement ${event.data.object.id} échoué`);
      break;
    case "payment_intent.canceled":
      console.log(`PaymentIntent ${event.data.object.id} annulé`);
      break;
    case "checkout.session.completed":
      try {
        const session: Stripe.Checkout.Session = event.data
          .object as Stripe.Checkout.Session;
        console.log(
          "checkout.session.completed Session metadata:",
          session.metadata,
        );
        let resolvedCustomerId: string | null =
          typeof session.customer === "string"
            ? (session.customer as string)
            : null;

        console.log("checkout.session.completed customer:", resolvedCustomerId);
        console.log("checkout.session.completed:", session.payment_intent);
        try {
          if (session.payment_intent) {
            paymentIntent = await stripe.paymentIntents.retrieve(
              session.payment_intent as string,
            );
            if (!resolvedCustomerId && paymentIntent?.customer) {
              resolvedCustomerId = paymentIntent.customer as string;
            }
          }
        } catch (e) {
          console.warn(
            "⚠️ Unable to retrieve PaymentIntent, falling back to session fields:",
            (e as any)?.message || e,
          );
        }

        const sessionId = event.data.object.id;
        let lineItemsResp: any = null;
        try {
          lineItemsResp = await stripe.checkout.sessions.listLineItems(
            sessionId,
            {
              limit: 100,
              expand: ["data.price.product"],
            },
          );
          console.log(
            "checkout.session.completed webhook: lineItemsResp",
            lineItemsResp,
          );
        } catch (lineItemsErr) {
          console.warn(
            "checkout.session.completed webhook: Error fetching line items:",
            (lineItemsErr as any)?.message || lineItemsErr,
          );
        }
        let customer: Stripe.Customer | null = null;
        if (resolvedCustomerId) {
          customer = (await stripe.customers.retrieve(
            resolvedCustomerId,
          )) as Stripe.Customer;
        } else {
          console.warn("checkout.session.completed without a linked customer");
        }
        if (customer && !("deleted" in customer)) {
          const customerPhone = customer.phone || null;
          const customerId = customer.id;
          const customerShippingAddress: any = customer.shipping;
          const customerEmail = customer.email || null;
          const customerName = customer.name || "Client";
          const customerBillingAddress: any = customer.address;
          const creditAppliedCentsParsed = Number.parseInt(
            String(session.metadata?.credit_applied_cents || "0"),
            10,
          );
          const tempBalanceCentsParsed = Number.parseInt(
            String(session.metadata?.temp_credit_balance_cents || "0"),
            10,
          );
          const tempAppliedCentsParsed = Number.parseInt(
            String(session.metadata?.temp_credit_applied_cents || "0"),
            10,
          );
          const tempTopupCentsParsed = Number.parseInt(
            String(session.metadata?.temp_credit_topup_cents || "0"),
            10,
          );

          let promoCreditBalanceAppliedCents = 0;
          const creditPromoCodeId = String(
            session.metadata?.credit_promo_code_id || "",
          ).trim();
          if (creditPromoCodeId) {
            try {
              const promoCode =
                await stripe.promotionCodes.retrieve(creditPromoCodeId);
              const rawPromoCredit = (promoCode.metadata as any)
                ?.customer_credit_balance_amount_cents;
              const parsedPromoCredit = Number.parseInt(
                String(rawPromoCredit || "0"),
                10,
              );
              promoCreditBalanceAppliedCents =
                Number.isFinite(parsedPromoCredit) && parsedPromoCredit > 0
                  ? parsedPromoCredit
                  : 0;
            } catch (_e) {}
          }

          const currentBalanceParsed = Number.parseInt(
            String((customer.metadata as any)?.credit_balance || "0"),
            10,
          );
          const currentBalanceCents = Number.isFinite(currentBalanceParsed)
            ? currentBalanceParsed
            : 0;
          const expectedDeliveryDebtCents =
            currentBalanceCents < 0 ? Math.abs(currentBalanceCents) : 0;

          const stripeCreditAppliedCents =
            promoCreditBalanceAppliedCents > 0
              ? promoCreditBalanceAppliedCents
              : Number.isFinite(creditAppliedCentsParsed) &&
                  creditAppliedCentsParsed > 0
                ? creditAppliedCentsParsed
                : 0;
          let effectiveCustomerCreditAppliedCents = stripeCreditAppliedCents;
          const tempAppliedCents =
            Number.isFinite(tempAppliedCentsParsed) &&
            tempAppliedCentsParsed > 0
              ? tempAppliedCentsParsed
              : 0;
          let effectiveTempAppliedCents = tempAppliedCents;
          const tempBalanceCents =
            Number.isFinite(tempBalanceCentsParsed) &&
            tempBalanceCentsParsed > 0
              ? tempBalanceCentsParsed
              : 0;
          const tempTopupCents =
            Number.isFinite(tempTopupCentsParsed) && tempTopupCentsParsed > 0
              ? tempTopupCentsParsed
              : 0;
          let effectiveTempTopupCents = tempTopupCents;

          const deliveryDebtPaidCentsParsed = Number.parseInt(
            String(session.metadata?.delivery_debt_paid_cents || "0"),
            10,
          );
          const deliveryDebtPaidCents =
            Number.isFinite(deliveryDebtPaidCentsParsed) &&
            deliveryDebtPaidCentsParsed > 0
              ? deliveryDebtPaidCentsParsed
              : 0;

          let deliveryDebtLineItemOriginalCents = 0;
          let deliveryDebtLineItemTotalCents = 0;
          let hasDeliveryDebtLineItem = false;
          if (expectedDeliveryDebtCents > 0 && lineItemsResp?.data) {
            const items: any[] = Array.isArray(lineItemsResp.data)
              ? lineItemsResp.data
              : [];
            const debtItem = items.find((it: any) => {
              const desc = String(it?.description || "").trim();
              const pname = String(it?.price?.product?.name || "").trim();
              const name = (desc || pname).toLowerCase();
              return name === "régularisation livraison";
            });
            if (debtItem) {
              hasDeliveryDebtLineItem = true;
              const originalRaw = Number(
                debtItem?.amount_subtotal ??
                  debtItem?.price?.unit_amount ??
                  debtItem?.amount_total ??
                  0,
              );
              const totalRaw = Number(
                debtItem?.amount_total ??
                  debtItem?.amount_subtotal ??
                  debtItem?.price?.unit_amount ??
                  0,
              );
              deliveryDebtLineItemOriginalCents = Number.isFinite(originalRaw)
                ? Math.max(0, Math.round(originalRaw))
                : 0;
              deliveryDebtLineItemTotalCents = Number.isFinite(totalRaw)
                ? Math.max(0, Math.round(totalRaw))
                : 0;
            }
          }

          const shouldResetDebtBalance =
            expectedDeliveryDebtCents > 0 &&
            (hasDeliveryDebtLineItem
              ? deliveryDebtLineItemOriginalCents === expectedDeliveryDebtCents
              : deliveryDebtPaidCents === expectedDeliveryDebtCents);
          const deliveryRegulationPaidCents = hasDeliveryDebtLineItem
            ? deliveryDebtLineItemOriginalCents
            : deliveryDebtPaidCents;
          const deliveryRegulationCashDueCents = hasDeliveryDebtLineItem
            ? deliveryDebtLineItemTotalCents
            : deliveryDebtPaidCents;

          if (expectedDeliveryDebtCents > 0 && !shouldResetDebtBalance) {
            console.warn(
              "checkout.session.completed: delivery debt mismatch, skipping credit_balance reset",
              {
                sessionId: session.id,
                customerId,
                expectedDeliveryDebtCents,
                deliveryDebtPaidCents,
                deliveryDebtLineItemOriginalCents,
                deliveryDebtLineItemTotalCents,
              },
            );
          }

          if (
            shouldResetDebtBalance ||
            stripeCreditAppliedCents > 0 ||
            tempTopupCents > 0
          ) {
          }
          const deliveryMethod =
            (session.metadata?.delivery_method as any) ||
            customer.metadata?.delivery_method ||
            "N/A";
          const deliveryNetwork =
            (session.metadata?.delivery_network as any) ||
            customer.metadata?.delivery_network ||
            "N/A";
          const clerkUserId = customer.metadata.clerk_id || null;
          let pickupPoint: any = {};
          let dropOffPoint: any = {};
          try {
            pickupPoint = session.metadata?.pickup_point
              ? JSON.parse(session.metadata.pickup_point as any)
              : {};
          } catch (e) {
            pickupPoint = {};
          }
          try {
            dropOffPoint = session.metadata?.dropoff_point
              ? JSON.parse(session.metadata.dropoff_point as any)
              : {};
          } catch (e) {
            dropOffPoint = {};
          }
          const storeName = session.metadata?.store_name || null;
          let productReference = session.metadata?.product_reference || "N/A";
          const amount = paymentIntent?.amount ?? session.amount_total ?? 0;
          let netAmount = Math.max(0, amount);
          const currency = paymentIntent?.currency ?? session.currency ?? "eur";
          const paymentId = paymentIntent?.id ?? session.id;
          let weight = formatWeight(session.metadata?.weight);
          let estimatedDeliveryDate: string = "";
          let boxtalId = "";
          let trackingUrl = "";
          let shipmentId = "";
          const promoCodeDetails = [];
          const estimatedDeliveryCost =
            session.shipping_cost?.amount_total || 0;

          let expandedSession: any = session;
          try {
            expandedSession = await stripe.checkout.sessions.retrieve(
              sessionId,
              {
                expand: [
                  "total_details.breakdown.discounts.discount",
                  "total_details.breakdown.discounts.discount.promotion_code",
                  "total_details.breakdown.discounts.discount.coupon",
                ],
              } as any,
            );
          } catch (_e) {
            expandedSession = session;
          }

          const breakdownDiscounts: any[] = Array.isArray(
            (expandedSession as any)?.total_details?.breakdown?.discounts,
          )
            ? ((expandedSession as any).total_details.breakdown
                .discounts as any[])
            : [];

          if (breakdownDiscounts.length > 0) {
            for (const d of breakdownDiscounts) {
              const amountOff = Math.max(0, Math.round(Number(d?.amount || 0)));
              const discountObj: any = d?.discount || {};
              try {
                const promo = discountObj?.promotion_code;
                if (promo) {
                  let promoCode: any = promo;
                  if (typeof promo === "string") {
                    promoCode = await stripe.promotionCodes.retrieve(promo);
                  }
                  promoCodeDetails.push({
                    code: promoCode?.code || null,
                    id: promoCode?.id || null,
                    amount_off: amountOff,
                    coupon: promoCode?.coupon || null,
                  });
                  continue;
                }
                const coupon = discountObj?.coupon;
                if (coupon) {
                  let couponObj: any = coupon;
                  if (typeof coupon === "string") {
                    couponObj = await stripe.coupons.retrieve(coupon);
                  }
                  promoCodeDetails.push({
                    code: null,
                    id: couponObj?.id || null,
                    amount_off: amountOff,
                    coupon: couponObj || null,
                  });
                  continue;
                }
              } catch (error) {
                console.error(
                  "checkout.session.completed webhook: Erreur lors de la récupération du code promo :",
                  error,
                );
              }
            }
          } else if ((session as any).discounts?.length) {
            for (const discount of (session as any).discounts) {
              try {
                if (discount.promotion_code) {
                  const promoCode = await stripe.promotionCodes.retrieve(
                    discount.promotion_code as string,
                  );
                  promoCodeDetails.push({
                    code: promoCode.code,
                    id: promoCode.id,
                    amount_off: session.total_details?.amount_discount ?? 0,
                    coupon: promoCode.coupon,
                  });
                } else if (discount.coupon) {
                  const coupon = await stripe.coupons.retrieve(
                    discount.coupon as string,
                  );
                  promoCodeDetails.push({
                    code: null,
                    id: coupon.id,
                    amount_off: session.total_details?.amount_discount ?? 0,
                    coupon,
                  });
                }
              } catch (error) {
                console.error(
                  "checkout.session.completed webhook: Erreur lors de la récupération du code promo :",
                  error,
                );
              }
            }
          }

          const appliedPromoCodes =
            Array.from(
              new Set(
                promoCodeDetails
                  .map((d: any) =>
                    String(d?.code || "")
                      .trim()
                      .toUpperCase(),
                  )
                  .filter(Boolean)
                  .filter((c: string) => !c.startsWith("CREDIT-")),
              ),
            ).join(";;") || null;

          const regulationName = "Régularisation livraison";
          const regulationRegex = /r[ée]gularisation\s+livraison/i;

          console.log(
            "checkout.session.completed webhook: lineItemsResp bis",
            lineItemsResp,
          );
          let products = (lineItemsResp?.data || [])
            .map((item: any) => {
              const prod = item?.price?.product as any;
              const productId =
                typeof prod === "string" ? prod : String(prod?.id || "").trim();
              const productName =
                typeof prod === "string"
                  ? String(item?.description || item?.price?.nickname || "")
                  : String(prod?.name || "");
              const productDescription =
                typeof prod === "string"
                  ? undefined
                  : (prod?.description as any);
              const productImage =
                typeof prod === "string"
                  ? undefined
                  : (prod?.images?.[0] as any);
              return {
                id: productId,
                name: productName,
                description: productDescription,
                image: productImage,
                quantity: item.quantity,
                amount_total: item.amount_total,
                amount_subtotal: item.amount_subtotal,
                currency: item.currency,
                unit_price: item.price?.unit_amount,
                price_id: item.price?.id,
              };
            })
            .filter((p: any) => {
              const name = String(p?.name || "").trim();
              if (!name) return true;
              if (name === regulationName) return false;
              return !regulationRegex.test(name);
            });

          console.log(
            "checkout.session.completed webhook: products 0000",
            products,
          );
          const nonRegItemsSubtotalCents = (lineItemsResp?.data || []).reduce(
            (sum: number, item: any) => {
              const prod = item?.price?.product as any;
              const name =
                typeof prod === "string"
                  ? String(
                      item?.description || item?.price?.nickname || "",
                    ).trim()
                  : String(prod?.name || "").trim();
              if (name === regulationName || regulationRegex.test(name))
                return sum;
              const vRaw =
                item?.amount_subtotal ??
                item?.amount_total ??
                item?.amount ??
                0;
              const v = Math.max(0, Math.round(Number(vRaw || 0)));
              return sum + v;
            },
            0,
          );
          console.log(
            "checkout.session.completed webhook: nonRegItemsSubtotalCents",
            nonRegItemsSubtotalCents,
          );
          const shippingCostCents = Math.max(
            0,
            Math.round(
              Number(
                (expandedSession as any)?.shipping_cost?.amount_total || 0,
              ),
            ),
          );
          let adjustedShippingCostCents = shippingCostCents;
          let stripeFeesCents: number | null = null;

          let storePromoDiscountCents = 0;
          let paylivePromoDiscountCents = 0;
          for (const d of promoCodeDetails) {
            const code = String(d?.code || "")
              .trim()
              .toUpperCase();
            const amountOff = Math.max(
              0,
              Math.round(Number(d?.amount_off || 0)),
            );
            if (!code || amountOff <= 0) continue;
            if (code.startsWith("CREDIT-")) continue;
            if (code.startsWith("PAYLIVE-")) {
              paylivePromoDiscountCents += amountOff;
              continue;
            }
            storePromoDiscountCents += amountOff;
          }

          let storeEarningsAmountCents = Math.max(
            0,
            nonRegItemsSubtotalCents - storePromoDiscountCents,
          );
          let customerSpentAmountCents = Math.max(
            0,
            nonRegItemsSubtotalCents +
              Math.max(
                0,
                Math.round(Number(deliveryRegulationPaidCents || 0)),
              ) +
              shippingCostCents -
              (storePromoDiscountCents + paylivePromoDiscountCents),
          );

          let storeOwnerEmail = null;
          let storeDescription = null;
          let storeLogo = null;
          let storeId: number | null = null;
          let storeSlug: string | null = null;
          let storeAddress: any = null;
          let storeStripeId: any = null;

          console.log(
            "checkout.session.completed webhook: storeName",
            storeName,
          );
          if (storeName) {
            try {
              const { data: storeData, error: storeError } = await supabase
                .from("stores")
                .select(
                  "id, slug, owner_email, description, address, stripe_id",
                )
                .eq("name", storeName)
                .single();

              if (!storeError && storeData) {
                storeOwnerEmail = storeData.owner_email;
                storeDescription = storeData.description;
                storeId = storeData.id || null;
                storeSlug = storeData.slug || null;
                storeStripeId = storeData.stripe_id || null;
                storeAddress = (storeData as any)?.address || null;
                if (process.env.CLOUDFRONT_URL && storeSlug) {
                  storeLogo = `${process.env.CLOUDFRONT_URL}/images/${storeId}`;
                }
              }
            } catch (storeErr) {
              console.error(
                "checkout.session.completed webhook: Error fetching store data:",
                storeErr,
              );
            }
          }

          const uniqueRefs = normalizeRefs(productReference);

          const effectivePaymentId = paymentIntent?.id || null;
          if (effectivePaymentId) {
            try {
              const { data: existingByPayment } = await supabase
                .from("shipments")
                .select("id")
                .eq("payment_id", effectivePaymentId)
                .maybeSingle();
              if (existingByPayment) {
                res.json({ received: true });
                return;
              }
            } catch (_e) {}
          }

          const openShipmentPaymentId = String(
            session.metadata?.open_shipment_payment_id || "",
          ).trim();
          let previousBoxtalId: string | null = null;
          let previousShipmentId: string | null = null;
          let openShipmentRowId: number | null = null;
          let oldBoxtalShipmentId: string | null = null;
          if (openShipmentPaymentId) {
            try {
              const openShipmentQuery = supabase
                .from("shipments")
                .select("id,shipment_id,payment_id,is_open_shipment")
                .eq("payment_id", openShipmentPaymentId)
                .eq("is_open_shipment", true)
                .limit(1);
              const { data: openShipments, error: openShipErr } =
                await openShipmentQuery;
              if (openShipErr) {
                await emailService.sendAdminError({
                  subject: "Lecture shipment open_shipment échouée",
                  message: `Impossible de lire la commande ouverte (payment_id=${openShipmentPaymentId}) avant création de la nouvelle commande.`,
                  context: JSON.stringify(openShipErr),
                });
                res.json({ received: true });
                return;
              }
              const openShipmentRow: any =
                Array.isArray(openShipments) && openShipments.length > 0
                  ? openShipments[0]
                  : null;
              openShipmentRowId =
                openShipmentRow && Number.isFinite(Number(openShipmentRow.id))
                  ? Number(openShipmentRow.id)
                  : null;
              oldBoxtalShipmentId =
                String(openShipmentRow?.shipment_id || "").trim() || null;
              previousBoxtalId = oldBoxtalShipmentId || null;
              previousShipmentId = oldBoxtalShipmentId || null;
            } catch (e) {
              await emailService.sendAdminError({
                subject: "Annulation Boxtal exception (modification)",
                message: `Exception lors de l'annulation Boxtal pour payment_id=${openShipmentPaymentId}.`,
                context: JSON.stringify(e),
              });
              res.json({ received: true });
              return;
            }
          }

          if (!storeId) {
            console.error(
              "checkout.session.completed webhook: storeId missing",
            );
            res.json({ received: true });
            return;
          }

          try {
            console.log(
              "checkout.session.completed webhook: products",
              products,
            );
            const purchased = (Array.isArray(products) ? products : [])
              .map((p: any) => {
                const pid = String(p?.id || "").trim();
                const ref = String(p?.name || "").trim();
                const qtyRaw = Number(p?.quantity || 1);
                const qty =
                  Number.isFinite(qtyRaw) && qtyRaw > 0
                    ? Math.floor(qtyRaw)
                    : 1;
                const amountSubtotalRaw = Number(p?.amount_subtotal || 0);
                const amountSubtotalCents =
                  Number.isFinite(amountSubtotalRaw) && amountSubtotalRaw > 0
                    ? Math.round(amountSubtotalRaw)
                    : 0;
                const amountTotalRaw = Number(p?.amount_total || 0);
                const amountTotalCents =
                  Number.isFinite(amountTotalRaw) && amountTotalRaw > 0
                    ? Math.round(amountTotalRaw)
                    : 0;
                return {
                  pid,
                  ref,
                  qty,
                  amountSubtotalCents,
                  amountTotalCents,
                  original: p,
                };
              })
              .filter(
                (p) =>
                  p.pid.startsWith("prod_") && p.ref.length > 0 && p.qty > 0,
              );

            console.log(
              "checkout.session.completed webhook: purchased",
              purchased,
            );

            if (purchased.length > 0) {
              const uniquePids = Array.from(
                new Set(purchased.map((p) => p.pid)),
              );
              const { data: stockRows, error: stockErr } = await supabase
                .from("stock")
                .select(
                  "id, product_stripe_id, product_reference, quantity, bought, weight",
                )
                .eq("store_id", storeId)
                .in("product_stripe_id", uniquePids as any);

              if (stockErr) {
                console.error(
                  "checkout.session.completed webhook: stock read failed (post-payment)",
                  stockErr,
                );
              } else {
                const stockByPid = new Map<string, any>();
                for (const r of Array.isArray(stockRows) ? stockRows : []) {
                  const pid = String(
                    (r as any)?.product_stripe_id || "",
                  ).trim();
                  if (pid && pid.startsWith("prod_")) stockByPid.set(pid, r);
                }

                const expectedByStockId = new Map<
                  number,
                  { quantity: number | null; bought: number }
                >();
                const creditedRefSet = new Set<string>();
                const purchasedRefSet = new Set<string>();
                const adjustedProducts: any[] = [];
                let stockCreditAmountCents = 0;
                let shippingCreditAmountCents = 0;
                let shippingToCaptureCents = shippingCostCents;
                let fulfilledItemsWeightKg = 0;

                for (const p of purchased) {
                  const row = stockByPid.get(p.pid) || null;
                  const stockId = Number((row as any)?.id || 0);
                  if (!row || !Number.isFinite(stockId) || stockId <= 0) {
                    if (p.qty > 0) {
                      creditedRefSet.add(p.ref);
                      stockCreditAmountCents += p.amountTotalCents;
                    }
                    continue;
                  }
                  const stockRef = String(
                    (row as any)?.product_reference || p.ref || "",
                  ).trim();

                  const rawQtyField = (row as any)?.quantity;
                  console.log(
                    "checkout.session.completed webhook: rawQtyField",
                    rawQtyField,
                  );
                  const bRaw = Number((row as any)?.bought || 0);
                  const currentBought =
                    Number.isFinite(bRaw) && bRaw >= 0 ? Math.floor(bRaw) : 0;

                  let fulfilledQty = p.qty;
                  console.log(
                    "checkout.session.completed webhook: p.qty",
                    p.qty,
                  );
                  let nextQty: number | null = null;

                  if (rawQtyField !== null && rawQtyField !== undefined) {
                    const parsedQty = Number(rawQtyField);
                    if (!Number.isFinite(parsedQty)) {
                      console.error(
                        "checkout.session.completed webhook: invalid stock.quantity (post-payment)",
                        { storeId, stockId, product_stripe_id: p.pid, row },
                      );
                      fulfilledQty = 0;
                      nextQty = 0;
                    } else {
                      const available = Math.max(0, Math.floor(parsedQty));
                      fulfilledQty = Math.min(p.qty, available);
                      nextQty = available - fulfilledQty;
                    }
                  }

                  const creditedQty = Math.max(0, p.qty - fulfilledQty);
                  const nextBought = currentBought + fulfilledQty;
                  expectedByStockId.set(stockId, {
                    quantity: nextQty,
                    bought: nextBought,
                  });

                  const unitWeightRaw = Number((row as any)?.weight || 0);
                  const unitWeightKg =
                    Number.isFinite(unitWeightRaw) && unitWeightRaw > 0
                      ? unitWeightRaw
                      : 0;
                  if (fulfilledQty > 0 && unitWeightKg > 0) {
                    fulfilledItemsWeightKg += unitWeightKg * fulfilledQty;
                  }

                  const fulfilledAmountSubtotalCents =
                    fulfilledQty > 0
                      ? Math.round(
                          (p.amountSubtotalCents * fulfilledQty) / p.qty,
                        )
                      : 0;
                  const fulfilledAmountCents =
                    fulfilledQty > 0
                      ? Math.round((p.amountTotalCents * fulfilledQty) / p.qty)
                      : 0;

                  console.log(
                    "checkout.session.completed webhook: fulfilledQty",
                    fulfilledQty,
                    stockRef,
                    fulfilledAmountCents,
                  );
                  if (fulfilledQty > 0) {
                    purchasedRefSet.add(stockRef);
                    adjustedProducts.push({
                      ...(p.original || {}),
                      quantity: fulfilledQty,
                      amount_total: fulfilledAmountCents,
                      amount_subtotal: fulfilledAmountSubtotalCents,
                    });
                  }
                  console.log(
                    "checkout.session.completed webhook: adjustedProducts",
                    creditedQty,
                    stockRef,
                    adjustedProducts,
                  );

                  if (creditedQty > 0) {
                    creditedRefSet.add(stockRef);
                    stockCreditAmountCents += Math.max(
                      0,
                      p.amountTotalCents - fulfilledAmountCents,
                    );
                  }
                }

                const totalFulfilledQty = adjustedProducts.reduce(
                  (sum, p) => sum + Math.max(0, Number(p?.quantity || 0)),
                  0,
                );
                console.log(
                  "checkout.session.completed webhook: totalFulfilledQty",
                  totalFulfilledQty,
                );
                const totalOrderedQty = purchased.reduce(
                  (sum, p) => sum + Math.max(0, Number(p?.qty || 0)),
                  0,
                );
                if (totalFulfilledQty <= 0 && paymentIntent?.id) {
                  try {
                    await stripe.paymentIntents.update(paymentIntent.id, {
                      metadata: safeStripeMetadata({
                        ...(paymentIntent.metadata || {}),
                        blocked_reason: "out_of_stock",
                      }),
                    });
                  } catch (_e) {}
                  try {
                    if (paymentIntent.status === "requires_capture") {
                      await stripe.paymentIntents.cancel(paymentIntent.id, {
                        cancellation_reason: "requested_by_customer",
                      } as any);
                    }
                  } catch (_e) {}
                  res.json({
                    received: true,
                    blocked: true,
                    reason: "out_of_stock",
                  });
                  return;
                }
                if (
                  shippingCostCents > 0 &&
                  totalOrderedQty > 0 &&
                  totalFulfilledQty > 0
                ) {
                  const fulfilledRatio = Math.min(
                    1,
                    Math.max(0, totalFulfilledQty / totalOrderedQty),
                  );
                  shippingToCaptureCents = Math.max(
                    0,
                    Math.round(shippingCostCents * fulfilledRatio),
                  );
                  shippingCreditAmountCents = Math.max(
                    0,
                    shippingCostCents - shippingToCaptureCents,
                  );
                  adjustedShippingCostCents = shippingToCaptureCents;
                }
                if (fulfilledItemsWeightKg > 0) {
                  weight = Math.max(0, fulfilledItemsWeightKg + 0.4);
                }

                console.log(
                  "checkout.session.completed webhook: non-regulation items subtotal",
                  nonRegItemsSubtotalCents,
                  adjustedProducts.length,
                );
                if (
                  nonRegItemsSubtotalCents > 0 &&
                  adjustedProducts.length > 0
                ) {
                  const adjustedItemsSubtotalCents = adjustedProducts.reduce(
                    (sum, p) => {
                      const raw =
                        p?.amount_subtotal ?? p?.amount_total ?? p?.amount ?? 0;
                      const v = Math.max(0, Math.round(Number(raw || 0)));
                      return sum + v;
                    },
                    0,
                  );
                  const ratio = Math.min(
                    1,
                    Math.max(
                      0,
                      adjustedItemsSubtotalCents / nonRegItemsSubtotalCents,
                    ),
                  );
                  const storePromoAppliedCents = Math.max(
                    0,
                    Math.round(storePromoDiscountCents * ratio),
                  );
                  const paylivePromoAppliedCents = Math.max(
                    0,
                    Math.round(paylivePromoDiscountCents * ratio),
                  );
                  storeEarningsAmountCents = Math.max(
                    0,
                    adjustedItemsSubtotalCents - storePromoAppliedCents,
                  );
                  customerSpentAmountCents = Math.max(
                    0,
                    adjustedItemsSubtotalCents +
                      Math.max(
                        0,
                        Math.round(Number(deliveryRegulationPaidCents || 0)),
                      ) +
                      adjustedShippingCostCents -
                      (storePromoAppliedCents + paylivePromoAppliedCents),
                  );
                }

                console.log(
                  "checkout.session.completed webhook: stock update begin (post-payment)",
                  {
                    storeId,
                    paymentIntentId: paymentIntent?.id || null,
                    paymentIntentStatus: paymentIntent?.status || null,
                    expectedCount: expectedByStockId.size,
                    usingServiceRole: Boolean(
                      process.env.SUPABASE_SERVICE_ROLE_KEY,
                    ),
                  },
                );

                let stockUpdateOk = 0;
                let stockUpdateFail = 0;
                for (const [stockId, exp] of expectedByStockId.entries()) {
                  const payload =
                    exp.quantity === null
                      ? { bought: exp.bought }
                      : { quantity: exp.quantity, bought: exp.bought };
                  const { error: updErr } = await supabase
                    .from("stock")
                    .update(payload as any)
                    .eq("id", stockId)
                    .eq("store_id", storeId);

                  if (updErr) {
                    stockUpdateFail++;
                    console.error(
                      "checkout.session.completed webhook: stock update failed (post-payment)",
                      updErr,
                      {
                        storeId,
                        stockId,
                        expected: exp,
                      },
                    );
                  } else {
                    stockUpdateOk++;
                  }
                }

                console.log(
                  "checkout.session.completed webhook: stock update end (post-payment)",
                  {
                    storeId,
                    paymentIntentId: paymentIntent?.id || null,
                    ok: stockUpdateOk,
                    failed: stockUpdateFail,
                  },
                );

                if (expectedByStockId.size > 0) {
                  const ids = Array.from(expectedByStockId.keys());
                  const { data: afterRows, error: afterErr } = await supabase
                    .from("stock")
                    .select(
                      "id, quantity, bought, product_stripe_id, product_reference",
                    )
                    .eq("store_id", storeId)
                    .in("id", ids as any);

                  if (afterErr) {
                    console.error(
                      "checkout.session.completed webhook: stock reread failed (post-payment)",
                      afterErr,
                      { storeId },
                    );
                  } else {
                    const mismatches: any[] = [];
                    for (const r of Array.isArray(afterRows) ? afterRows : []) {
                      const stockId = Number((r as any)?.id || 0);
                      const exp = expectedByStockId.get(stockId);
                      if (!exp) continue;
                      const b = Math.floor(Number((r as any)?.bought || 0));
                      const rawQ = (r as any)?.quantity;
                      const q =
                        rawQ === null || rawQ === undefined
                          ? null
                          : Math.floor(Number(rawQ || 0));
                      const qtyMismatch =
                        exp.quantity === null ? false : q !== exp.quantity;
                      if (qtyMismatch || b !== exp.bought) {
                        mismatches.push({
                          stockId,
                          expected: exp,
                          actual: { quantity: q, bought: b },
                          row: r,
                        });
                      }
                    }
                    if (mismatches.length > 0) {
                      console.error(
                        "checkout.session.completed webhook: stock mismatch after update",
                        { storeId, mismatches },
                      );
                    } else {
                      console.log(
                        "checkout.session.completed webhook: stock verified ok (post-payment)",
                        {
                          storeId,
                          verifiedCount: Array.isArray(afterRows)
                            ? afterRows.length
                            : 0,
                        },
                      );
                    }
                  }
                }

                const orderedItemsSubtotalExclShippingCents = purchased.reduce(
                  (sum, p) =>
                    sum +
                    Math.max(
                      0,
                      Math.round(Number(p?.amountSubtotalCents || 0)),
                    ),
                  0,
                );
                const fulfilledItemsSubtotalExclShippingCents =
                  adjustedProducts.reduce((sum, p) => {
                    const raw = Number(p?.amount_subtotal || 0);
                    return (
                      sum +
                      (Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0)
                    );
                  }, 0);
                effectiveTempAppliedCents = Math.min(
                  effectiveTempAppliedCents,
                  fulfilledItemsSubtotalExclShippingCents,
                );
                const remainingAfterTempCents = Math.max(
                  0,
                  fulfilledItemsSubtotalExclShippingCents -
                    effectiveTempAppliedCents,
                );
                effectiveCustomerCreditAppliedCents = Math.min(
                  stripeCreditAppliedCents,
                  remainingAfterTempCents,
                );
                const creditBalanceRefundCents = Math.max(
                  0,
                  stripeCreditAppliedCents -
                    effectiveCustomerCreditAppliedCents,
                );

                const regulationDiscountAppliedCents = Math.max(
                  0,
                  Math.round(
                    Number(deliveryRegulationPaidCents || 0) -
                      Number(deliveryRegulationCashDueCents || 0),
                  ),
                );
                effectiveTempTopupCents =
                  tempBalanceCents > 0
                    ? Math.max(
                        0,
                        tempBalanceCents -
                          effectiveTempAppliedCents -
                          regulationDiscountAppliedCents,
                      )
                    : 0;

                if (paymentIntent?.id) {
                  try {
                    const unfulfilledItemCents = Math.max(
                      0,
                      Math.round(stockCreditAmountCents || 0),
                    );
                    const unfulfilledShippingCents = Math.max(
                      0,
                      Math.round(shippingCreditAmountCents || 0),
                    );
                    const unfulfilledCents = Math.max(
                      0,
                      unfulfilledItemCents + unfulfilledShippingCents,
                    );
                    const amountToCapture = (() => {
                      if (
                        openShipmentPaymentId ||
                        creditBalanceRefundCents > 0 ||
                        effectiveTempTopupCents > 0
                      ) {
                        const ratio = (() => {
                          if (orderedItemsSubtotalExclShippingCents <= 0)
                            return 0;
                          return Math.min(
                            1,
                            Math.max(
                              0,
                              fulfilledItemsSubtotalExclShippingCents /
                                orderedItemsSubtotalExclShippingCents,
                            ),
                          );
                        })();
                        const storePromoAppliedCents = Math.max(
                          0,
                          Math.round(storePromoDiscountCents * ratio),
                        );
                        const paylivePromoAppliedCents = Math.max(
                          0,
                          Math.round(paylivePromoDiscountCents * ratio),
                        );
                        const fulfilledItemsAfterPromoCents = Math.max(
                          0,
                          fulfilledItemsSubtotalExclShippingCents -
                            storePromoAppliedCents -
                            paylivePromoAppliedCents,
                        );
                        const itemsDueCents = Math.max(
                          0,
                          fulfilledItemsAfterPromoCents -
                            effectiveTempAppliedCents -
                            effectiveCustomerCreditAppliedCents,
                        );
                        const shippingDueCents = Math.max(
                          0,
                          Math.round(shippingToCaptureCents || 0),
                        );
                        const debtDueCents = Math.max(
                          0,
                          Math.round(deliveryRegulationCashDueCents || 0),
                        );
                        return Math.max(
                          0,
                          Math.round(
                            itemsDueCents + shippingDueCents + debtDueCents,
                          ),
                        );
                      }
                      return Math.max(
                        0,
                        Math.round(netAmount || 0) - unfulfilledCents,
                      );
                    })();
                    if (amountToCapture <= 0) {
                      try {
                        await stripe.paymentIntents.update(paymentIntent.id, {
                          metadata: safeStripeMetadata({
                            ...(paymentIntent.metadata || {}),
                            blocked_reason: "out_of_stock",
                          }),
                        });
                      } catch (_e) {}
                      try {
                        await stripe.paymentIntents.cancel(paymentIntent.id, {
                          cancellation_reason: "requested_by_customer",
                        } as any);
                      } catch (_e) {}
                      res.json({
                        received: true,
                        blocked: true,
                        reason: "out_of_stock",
                      });
                      return;
                    }

                    const existingPurchasedRefs = normalizeRefs(
                      (paymentIntent.metadata as any)?.purchased_references ||
                        "",
                    );
                    const mergedPurchasedRefs = Array.from(
                      new Set([
                        ...existingPurchasedRefs,
                        ...Array.from(purchasedRefSet),
                      ]),
                    );
                    await stripe.paymentIntents.update(paymentIntent.id, {
                      metadata: safeStripeMetadata({
                        ...(paymentIntent.metadata || {}),
                        purchased_references: mergedPurchasedRefs.join(";"),
                        stock_unfulfilled_references:
                          Array.from(creditedRefSet).join(";"),
                        stock_unfulfilled_amount_cents:
                          String(unfulfilledCents),
                        stock_unfulfilled_items_amount_cents:
                          String(unfulfilledItemCents),
                        shipping_original_amount_cents:
                          String(shippingCostCents),
                        shipping_to_capture_amount_cents: String(
                          shippingToCaptureCents,
                        ),
                        shipping_unfulfilled_amount_cents: String(
                          unfulfilledShippingCents,
                        ),
                        amount_to_capture_cents: String(amountToCapture),
                        credit_balance_used_cents_effective: String(
                          effectiveCustomerCreditAppliedCents,
                        ),
                        credit_balance_refund_cents: String(
                          creditBalanceRefundCents,
                        ),
                        temp_credit_applied_cents_effective: String(
                          effectiveTempAppliedCents,
                        ),
                        temp_credit_topup_cents_effective: String(
                          effectiveTempTopupCents,
                        ),
                        open_shipment_payment_id: String(
                          openShipmentPaymentId || "",
                        ),
                        ord_items_sub_ex_ship_cents: String(
                          orderedItemsSubtotalExclShippingCents,
                        ),
                        ful_items_sub_ex_ship_cents: String(
                          fulfilledItemsSubtotalExclShippingCents,
                        ),
                      }),
                    });
                    const fresh = await waitForCapturablePaymentIntent(
                      paymentIntent.id,
                    );
                    if (fresh && fresh.status === "requires_capture") {
                      const captured = await stripe.paymentIntents.capture(
                        paymentIntent.id,
                        { amount_to_capture: amountToCapture } as any,
                        {
                          idempotencyKey: `capture-${paymentIntent.id}-${amountToCapture}`,
                        } as any,
                      );
                      console.log(
                        "checkout.session.completed webhook: capture success",
                        {
                          paymentIntentId: paymentIntent.id,
                          amountToCapture,
                          status: (captured as any)?.status || null,
                        },
                      );
                      netAmount = amountToCapture;
                      if (!openShipmentPaymentId) {
                        customerSpentAmountCents = Math.max(
                          0,
                          Math.round(netAmount || 0),
                        );
                      }
                    } else if (fresh && fresh.status === "succeeded") {
                      console.log(
                        "checkout.session.completed webhook: already captured",
                        {
                          paymentIntentId: paymentIntent.id,
                          amountReceived: Number(
                            (fresh as any)?.amount_received || 0,
                          ),
                        },
                      );
                      const ar = Number((fresh as any)?.amount_received || 0);
                      if (
                        !openShipmentPaymentId &&
                        Number.isFinite(ar) &&
                        ar > 0
                      ) {
                        customerSpentAmountCents = Math.max(0, Math.round(ar));
                      }
                    } else {
                      console.warn(
                        "checkout.session.completed webhook: payment_intent not capturable yet, will rely on amount_capturable_updated",
                        {
                          paymentIntentId: paymentIntent.id,
                          status: (fresh as any)?.status || null,
                          amountToCapture,
                        },
                      );
                    }
                  } catch (capErr: any) {
                    console.error(
                      "checkout.session.completed webhook: capture failed",
                      capErr?.message || capErr,
                    );
                    res.json({ received: true });
                    return;
                  }
                }
                if (paymentIntent?.status === "succeeded") {
                  const ar = Number(
                    (paymentIntent as any)?.amount_received || 0,
                  );
                  if (!openShipmentPaymentId && Number.isFinite(ar) && ar > 0) {
                    customerSpentAmountCents = Math.max(0, Math.round(ar));
                  }
                }

                if (adjustedProducts.length > 0) {
                  products = adjustedProducts;
                  productReference = Array.from(
                    new Set(
                      adjustedProducts
                        .map((p: any) => String(p?.name || "").trim())
                        .filter(Boolean),
                    ),
                  ).join(";");
                } else if (stockCreditAmountCents > 0) {
                  console.log(
                    "checkout.session.completed webhook: all paid products were unavailable, skipping shipment creation",
                    {
                      paymentIntentId: paymentIntent?.id || null,
                      creditedRefs: Array.from(creditedRefSet),
                    },
                  );
                  res.json({ received: true });
                  return;
                }
              }
            }
          } catch (stockUpdateEx) {
            console.error(
              "checkout.session.completed webhook: stock update exception (post-payment)",
              stockUpdateEx,
              { storeId },
            );
          }

          console.log("checkout.session.completed webhook: build addresses");
          const toAddress = {
            type: "RESIDENTIAL",
            contact: {
              email: customerEmail,
              phone: customerPhone?.split("+")[1],
              lastName: (customerName || "").split(" ").slice(-1)[0] || "",
              firstName:
                (customerName || "").split(" ").slice(0, -1).join(" ") ||
                customerName ||
                "",
            },
            location: {
              city: customerBillingAddress?.city,
              street: customerBillingAddress?.line1,
              postalCode: customerBillingAddress?.postal_code,
              countryIsoCode: customerBillingAddress?.country || "FR",
            },
          };

          console.log(
            "checkout.session.completed webhook: retrieve store owner customer",
          );
          const storeOwner: any = await stripe.customers.retrieve(
            storeStripeId as string,
          );

          console.log(
            "checkout.session.completed webhook: compute package dimensions",
          );
          const fromAddress = {
            type: "BUSINESS",
            contact: {
              email: process.env.SMTP_USER || "contact@paylive.cc",
              phone: (storeAddress as any)?.phone || "33666477877",
              lastName: storeOwner?.name?.split(" ").slice(-1)[0] || "",
              firstName:
                storeOwner?.name?.split(" ").slice(0, -1).join(" ") ||
                storeOwner?.name ||
                "",
              company: storeName || "PayLive",
            },
            location: {
              city: (storeAddress?.city as any) || "Paris",
              street: (storeAddress?.line1 as any) || "1 Rue Exemple",
              number: (storeAddress?.line1 as any).split(" ")[0] || "1",
              postalCode: (storeAddress?.postal_code as any) || "75001",
              countryIsoCode: (storeAddress?.country as any) || "FR",
            },
          };

          const offerDimensions: Record<
            string,
            { width: number; length: number; height: number }
          > = {
            "MONR-CpourToi": { width: 41, length: 64, height: 38 },
            "MONR-DomicileFrance": { width: 41, length: 64, height: 38 },
            "SOGP-RelaisColis": { width: 50, length: 80, height: 40 },
            "CHRP-Chrono2ShopDirect": { width: 30, length: 100, height: 20 },
            "CHRP-Chrono18": { width: 30, length: 100, height: 20 },
            "UPSE-Express": { width: 41, length: 64, height: 38 },
            "POFR-ColissimoAccess": { width: 24, length: 34, height: 26 },
            "COPR-CoprRelaisDomicileNat": {
              width: 49,
              length: 69,
              height: 29,
            },
            "COPR-CoprRelaisRelaisNat": { width: 49, length: 69, height: 29 },
            "MONR-CpourToiEurope": { width: 41, length: 64, height: 38 },
            "CHRP-Chrono2ShopEurope": { width: 30, length: 100, height: 20 },
            "MONR-DomicileEurope": { width: 41, length: 64, height: 38 },
            "CHRP-ChronoInternationalClassic": {
              width: 30,
              length: 100,
              height: 20,
            },
            "DLVG-DelivengoEasy": { width: 20, length: 60, height: 10 },
            "FEDX-FedexRegionalEconomy": {
              width: 20,
              length: 200,
              height: 10,
            },
          };
          const dims = offerDimensions[deliveryNetwork] || {
            width: 10,
            length: 10,
            height: 5,
          };

          const shipment = {
            packages: [
              {
                type: "PARCEL",
                value: {
                  value: (netAmount || 0) / 100,
                  currency: "EUR",
                },
                width: dims.width,
                length: dims.length,
                height: dims.height,
                weight: weight,
                content: {
                  id: "content:v1:40110",
                  description: `${storeName} - ${productReference}`,
                },
              },
            ],
            toAddress,
            fromAddress,
            pickupPointCode: pickupPoint.code,
            dropOffPointCode: dropOffPoint.code,
          };

          const createOrderPayload: any = {
            insured: false,
            shipment,
            labelType: "PDF_A4",
            shippingOfferCode: deliveryNetwork,
          };

          let dataBoxtal: any = {};
          let attachments: Array<{
            filename: string;
            content: Buffer;
            contentType?: string;
          }> = [];
          let boxtalOrderFailed = false;

          if (paymentId) {
            const succeededPi =
              await ensurePaymentIntentSucceededForFulfillment(paymentId);
            if (!succeededPi) {
              console.warn(
                "checkout.session.completed webhook: payment not captured, skipping fulfillment",
                {
                  paymentIntentId: paymentId,
                  status: paymentIntent?.status || null,
                },
              );
              res.json({ received: true });
              return;
            }
            paymentIntent = succeededPi;
          }

          if (openShipmentPaymentId && openShipmentRowId) {
            try {
              if (oldBoxtalShipmentId) {
                const apiBase = getInternalBase();
                const cancelResp = await fetch(
                  `${apiBase}/api/boxtal/shipping-orders/${encodeURIComponent(
                    oldBoxtalShipmentId,
                  )}?skipAdminRefundEmail=true`,
                  { method: "DELETE" },
                );
                if (!cancelResp.ok) {
                  const body = await cancelResp.text().catch(() => "");
                  await emailService.sendAdminError({
                    subject: "Annulation Boxtal échouée (modification)",
                    message: `Echec annulation Boxtal shipment_id=${oldBoxtalShipmentId} (payment_id=${openShipmentPaymentId}). 
                    Statut=${cancelResp.status}.`,
                    context: body,
                  });
                  res.json({ received: true });
                  return;
                }
              }
              const { error: delErr } = await supabase
                .from("shipments")
                .update({ is_cancelled: true, is_open_shipment: false })
                .eq("id", openShipmentRowId);
              if (delErr) {
                await emailService.sendAdminError({
                  subject: "Annulation shipment open_shipment échouée",
                  message: `Annulation shipments échouée (id=${openShipmentRowId}, payment_id=${openShipmentPaymentId}).`,
                  context: JSON.stringify(delErr),
                });
              }
            } catch (e) {
              await emailService.sendAdminError({
                subject: "Annulation Boxtal exception (modification)",
                message: `Exception lors de l'annulation Boxtal pour payment_id=${openShipmentPaymentId}.`,
                context: JSON.stringify(e),
              });
              res.json({ received: true });
              return;
            }
          }

          if (paymentIntent?.id) {
            try {
              const pi = await stripe.paymentIntents.retrieve(paymentIntent.id);
              const chargeId =
                typeof (pi as any)?.latest_charge === "string"
                  ? ((pi as any).latest_charge as string)
                  : String((pi as any)?.latest_charge?.id || "").trim();
              if (chargeId) {
                const charge = await stripe.charges.retrieve(chargeId, {
                  expand: ["balance_transaction"],
                } as any);
                const btRaw: any = (charge as any)?.balance_transaction || null;
                const bt =
                  typeof btRaw === "string"
                    ? await stripe.balanceTransactions.retrieve(btRaw)
                    : btRaw;
                const feeDetails: any[] = Array.isArray(bt?.fee_details)
                  ? bt.fee_details
                  : [];
                const stripeOnly = feeDetails
                  .filter((d: any) => String(d?.type || "") === "stripe_fee")
                  .reduce(
                    (sum: number, d: any) =>
                      sum + Math.max(0, Math.round(Number(d?.amount || 0))),
                    0,
                  );
                const feeRaw = Math.max(0, Math.round(Number(bt?.fee || 0)));
                stripeFeesCents = stripeOnly > 0 ? stripeOnly : feeRaw;
              }
            } catch (_e) {}
          }

          try {
            const cartItemIdsRaw = String(
              (session as any)?.metadata?.cart_item_ids ||
                (paymentIntent as any)?.metadata?.cart_item_ids ||
                "",
            ).trim();
            const cartItemIds = Array.from(
              new Set(
                cartItemIdsRaw
                  .split(",")
                  .map((s) => Number(String(s || "").trim()))
                  .filter((n) => Number.isFinite(n) && n > 0),
              ),
            );

            if (customerId && storeId) {
              if (cartItemIds.length > 0) {
                const delResp = await supabase
                  .from("carts")
                  .delete()
                  .eq("customer_stripe_id", customerId)
                  .eq("store_id", storeId)
                  .in("id", cartItemIds as any);
                if (delResp.error) {
                  console.error(
                    "checkout.session.completed webhook: failed to delete cart items by id",
                    delResp.error,
                    {
                      storeId,
                      customerId,
                      cartItemIdsCount: cartItemIds.length,
                    },
                  );
                }
              } else if (uniqueRefs.length > 0) {
                const delResp = await supabase
                  .from("carts")
                  .delete()
                  .eq("customer_stripe_id", customerId)
                  .eq("store_id", storeId)
                  .in("product_reference", uniqueRefs as any);
                if (delResp.error) {
                  console.error(
                    "checkout.session.completed webhook: failed to delete cart items by reference",
                    delResp.error,
                    { storeId, customerId, refsCount: uniqueRefs.length },
                  );
                }
              }
            }
          } catch (cartCleanupErr) {
            console.error(
              "checkout.session.completed webhook: cart cleanup exception",
              cartCleanupErr,
            );
          }

          if (deliveryMethod !== "store_pickup") {
            console.log(
              "checkout.session.completed webhook: create Boxtal order",
              deliveryNetwork,
            );
            const apiBase = getInternalBase();
            console.log(
              "createOrderPayload",
              JSON.stringify(createOrderPayload),
            );
            const resp = await fetch(`${apiBase}/api/boxtal/shipping-orders`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(createOrderPayload),
            });

            if (!resp.ok) {
              const text = await resp.text();
              console.error(
                "checkout.session.completed webhook: Failed to create Boxtal shipping order:",
                resp.status,
                text,
              );
              boxtalOrderFailed = true;
              await emailService.sendAdminError({
                subject: "Boxtal shipping order échec",
                message: `Echec de création Boxtal pour store ${storeName} / network ${deliveryNetwork}. Erreur: ${text}`,
                context: JSON.stringify(createOrderPayload),
              });
            } else {
              dataBoxtal = await resp.json();
              estimatedDeliveryDate = dataBoxtal.content.estimatedDeliveryDate;
              boxtalId = dataBoxtal.content.id;

              try {
                console.log(
                  "checkout.session.completed webhook: fetch Boxtal documents",
                );
                const shippingOrderIdForDoc = boxtalId;
                const base = getInternalBase();

                for (let attempt = 1; attempt <= 2; attempt++) {
                  await new Promise((resolve) => setTimeout(resolve, 10000));
                  console.log(
                    "checkout.session.completed webhook: fetch Boxtal document attempt",
                    attempt,
                  );
                  const docApiResp = await fetch(
                    `${base}/api/boxtal/shipping-orders/${encodeURIComponent(
                      shippingOrderIdForDoc,
                    )}/shipping-document`,
                    { method: "GET" },
                  );

                  if (docApiResp.ok) {
                    const docJson: any = await docApiResp.json();
                    const docs: any[] = docJson?.content || [];
                    const labelDoc =
                      docs.find((d) => d.type === "LABEL") || docs[0];

                    if (labelDoc?.url) {
                      const docResp = await fetch(labelDoc.url);
                      if (docResp.ok) {
                        const buf = Buffer.from(await docResp.arrayBuffer());
                        attachments = [
                          {
                            filename: `${
                              labelDoc.type || "LABEL"
                            }_${shippingOrderIdForDoc}.pdf`,
                            content: buf,
                            contentType: "application/pdf",
                          },
                        ];
                        break;
                      }
                    }
                  } else {
                    console.error(
                      "checkout.session.completed webhook: Failed to fetch shipping document:",
                      docApiResp.status,
                      await docApiResp.text(),
                    );
                  }
                }

                if (attachments && attachments.length > 0) {
                  try {
                    console.log(
                      "checkout.session.completed webhook: update shipments.document_created",
                    );
                    const { error: updateErr } = await supabase
                      .from("shipments")
                      .update({ document_created: true })
                      .eq("shipment_id", shippingOrderIdForDoc);
                    if (updateErr) {
                      console.error(
                        "checkout.session.completed webhook: Error updating shipments.document_created:",
                        updateErr,
                      );
                      await emailService.sendAdminError({
                        subject: "Erreur update document_created",
                        message: `Mise à jour échouée pour boxtalId ${shippingOrderIdForDoc}`,
                        context: JSON.stringify(updateErr),
                      });
                    }
                  } catch (updEx) {
                    console.error(
                      "Exception updating shipments.document_created:",
                      updEx,
                    );
                  }
                }
              } catch (e) {
                console.error(
                  "Error sending store owner notification with document:",
                  e,
                );
              }
            }
          }

          try {
            const _productReference =
              (() => {
                if (Array.isArray(products) && products.length > 0) {
                  const ids: string[] = [];
                  for (const p of products) {
                    const pid = String((p as any)?.id || "").trim();
                    if (!pid || !pid.startsWith("prod_")) continue;
                    const qRaw = Number((p as any)?.quantity || 1);
                    const q =
                      Number.isFinite(qRaw) && qRaw > 0 ? Math.floor(qRaw) : 1;
                    for (let i = 0; i < q; i++) ids.push(pid);
                  }
                  const joined = ids.filter(Boolean).join(";");
                  if (joined) return joined;
                }
                const metaRaw =
                  String(
                    (session as any)?.metadata?.stripe_product_ids ||
                      (paymentIntent as any)?.metadata?.stripe_product_ids ||
                      "",
                  ).trim() || "";
                if (metaRaw) {
                  const joined = metaRaw
                    .split(";")
                    .map((s) => String(s || "").trim())
                    .filter((s) => s.startsWith("prod_"))
                    .join(";");
                  if (joined) return joined;
                }
                return productReference;
              })() || null;

            const boxtalShippingJsonForDb = (() => {
              if (!boxtalOrderFailed) return null;
              if (
                createOrderPayload &&
                typeof createOrderPayload === "object" &&
                !Array.isArray(createOrderPayload)
              ) {
                return createOrderPayload;
              }
              if (typeof createOrderPayload === "string") {
                try {
                  const parsed = JSON.parse(createOrderPayload);
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                  ) {
                    return parsed;
                  }
                } catch {}
              }
              return null;
            })();

            const shipmentRowData: any = {
              store_id: storeId,
              customer_stripe_id: customerId || null,
              shipment_id: boxtalId ? boxtalId : null,
              status: (dataBoxtal?.content?.status as any) || null,
              estimated_delivery_date: estimatedDeliveryDate || null,
              document_created: attachments && attachments.length > 0,
              delivery_method: deliveryMethod,
              delivery_network: deliveryNetwork,
              dropoff_point: dropOffPoint,
              pickup_point: pickupPoint,
              weight: Number.isFinite(weight) ? weight : null,
              product_reference: _productReference,
              payment_id: paymentIntent?.id || null,
              store_earnings_amount: storeEarningsAmountCents,
              customer_spent_amount: customerSpentAmountCents,
              stripe_fees: stripeFeesCents,
              boxtal_shipment_creation_failed: boxtalOrderFailed,
              boxtal_shipping_json: boxtalShippingJsonForDb,
              delivery_cost:
                (dataBoxtal?.content?.deliveryPriceExclTax?.value || 0) * 1.2,
              promo_code: appliedPromoCodes,
              estimated_delivery_cost: (adjustedShippingCostCents || 0) / 100,
            };

            let shipmentUpsert: any = null;
            let shipmentUpsertError: any = null;

            const { data, error } = await supabase
              .from("shipments")
              .insert({
                ...shipmentRowData,
                created_at: dataBoxtal?.timestamp
                  ? new Date(dataBoxtal.timestamp).toISOString()
                  : new Date().toISOString(),
              })
              .select("id")
              .single();
            shipmentUpsert = data;
            shipmentUpsertError = error;

            shipmentId = shipmentUpsert?.id || "";

            if (shipmentUpsertError) {
              console.error(
                "checkout.session.completed webhook: Error inserting shipment row:",
                shipmentUpsertError,
              );
              await emailService.sendAdminError({
                subject: "Erreur insertion shipments",
                message: `Insertion échouée pour boxtalId ${boxtalId} (store ${storeName}).`,
                context: JSON.stringify(shipmentUpsertError),
              });
            }
          } catch (dbErr) {
            console.error("DB insert shipments exception:", dbErr);
            await emailService.sendAdminError({
              subject: "Erreur insertion shipments",
              message: `Insertion échouée pour boxtalId ${boxtalId} (store ${storeName}).`,
              context: JSON.stringify(dbErr),
            });
          }

          if (deliveryMethod !== "store_pickup") {
            try {
              if (boxtalId) {
                console.log(
                  "checkout.session.completed webhook: fetch tracking URL",
                  boxtalId,
                );
                const base = getInternalBase();
                const trackingResp = await fetch(
                  `${base}/api/boxtal/shipping-orders/${encodeURIComponent(
                    boxtalId,
                  )}/tracking`,
                  { method: "GET" },
                );

                if (trackingResp.ok) {
                  const trackingJson: any = await trackingResp.json();
                  let packageTrackingUrl: string | undefined = undefined;

                  if (Array.isArray(trackingJson?.content)) {
                    const firstWithUrl = (trackingJson.content || []).find(
                      (ev: any) => ev && ev.packageTrackingUrl,
                    );
                    packageTrackingUrl =
                      firstWithUrl?.packageTrackingUrl ||
                      (trackingJson.content[0]?.packageTrackingUrl as any);
                  } else {
                    packageTrackingUrl =
                      trackingJson?.content?.packageTrackingUrl;
                  }

                  if (packageTrackingUrl) {
                    trackingUrl = packageTrackingUrl;
                    try {
                      const { error: updError } = await supabase
                        .from("shipments")
                        .update({ tracking_url: packageTrackingUrl })
                        .eq("shipment_id", boxtalId);
                      if (updError) {
                        console.error(
                          "checkout.session.completed webhook: Error updating shipments.tracking_url:",
                          updError,
                        );
                      }
                    } catch (updEx) {
                      console.error(
                        "checkout.session.completed webhook: Exception updating shipments.tracking_url:",
                        updEx,
                      );
                    }
                  }
                }
              }
            } catch (trackErr) {
              console.error(
                "Error retrieving tracking URL from internal Boxtal API:",
                trackErr,
              );
            }
          }

          try {
            console.log(
              "checkout.session.completed webhook: send customer confirmation email",
            );
            const isModification = Boolean(openShipmentPaymentId);
            if (paymentId) {
              const succeededPi =
                await ensurePaymentIntentSucceededForFulfillment(paymentId);
              if (!succeededPi) {
                console.warn(
                  "checkout.session.completed webhook: payment not captured, skipping customer email",
                  {
                    paymentIntentId: paymentId,
                    status: paymentIntent?.status || null,
                  },
                );
              } else {
                paymentIntent = succeededPi;
              }
            }
            if (paymentIntent?.status !== "succeeded") {
              res.json({ received: true });
              return;
            }

            if (paymentId) {
              try {
                const pi = await stripe.paymentIntents.retrieve(paymentId);
                const alreadyFinalized =
                  String(
                    (pi?.metadata as any)?.credit_balance_finalized || "",
                  ) === "1";
                const alreadyTopupFinalized =
                  String(
                    (pi?.metadata as any)
                      ?.credit_modification_topup_finalized || "",
                  ) === "1";
                if (
                  !alreadyFinalized &&
                  (shouldResetDebtBalance ||
                    effectiveCustomerCreditAppliedCents > 0 ||
                    (openShipmentPaymentId &&
                      Number.isFinite(effectiveTempTopupCents) &&
                      effectiveTempTopupCents > 0))
                ) {
                  const topupCents = openShipmentPaymentId
                    ? Math.max(
                        0,
                        Math.round(Number(effectiveTempTopupCents || 0)),
                      )
                    : 0;
                  const latestCustomer = (await stripe.customers.retrieve(
                    customerId,
                  )) as Stripe.Customer;
                  if (latestCustomer && !("deleted" in latestCustomer)) {
                    const meta: any = (latestCustomer.metadata as any) || {};
                    const prevRaw = Number.parseInt(
                      String(meta?.credit_balance || "0"),
                      10,
                    );
                    const prevBalanceCents = Number.isFinite(prevRaw)
                      ? prevRaw
                      : 0;
                    const baseBalanceCents = shouldResetDebtBalance
                      ? 0
                      : prevBalanceCents;
                    const usedCents = Math.max(
                      0,
                      Math.round(
                        Number(effectiveCustomerCreditAppliedCents || 0),
                      ),
                    );
                    const afterUsedCents = Math.max(
                      0,
                      baseBalanceCents - usedCents,
                    );
                    const addTopupCents = openShipmentPaymentId
                      ? shouldResetDebtBalance
                        ? topupCents
                        : alreadyTopupFinalized
                          ? 0
                          : topupCents
                      : 0;
                    const nextBalanceCents = Math.max(
                      0,
                      afterUsedCents + addTopupCents,
                    );
                    await stripe.customers.update(
                      customerId,
                      {
                        metadata: {
                          ...meta,
                          credit_balance: String(nextBalanceCents),
                        },
                      } as any,
                      {
                        idempotencyKey: `credit-balance-finalize-${paymentId}-${nextBalanceCents}`,
                      } as any,
                    );
                    try {
                      await stripe.paymentIntents.update(paymentId, {
                        metadata: safeStripeMetadata({
                          ...(pi?.metadata || {}),
                          credit_balance_before_cents_observed:
                            String(prevBalanceCents),
                          credit_balance_after_cents_effective:
                            String(nextBalanceCents),
                          credit_balance_used_cents_effective:
                            String(usedCents),
                          credit_modification_topup_amount_cents_effective:
                            String(addTopupCents),
                          credit_modification_topup_finalized:
                            addTopupCents > 0 || alreadyTopupFinalized
                              ? "1"
                              : "0",
                          credit_balance_finalized: "1",
                        }),
                      });
                    } catch (_e) {}
                  }
                }
              } catch (_e) {}
            }

            const emailProducts = (Array.isArray(products) ? products : [])
              .map((p: any) => {
                const ref = String(p?.name || p?.id || "").trim();
                const desc = String(p?.description || "").trim();
                const qtyRaw = Number(p?.quantity || 1);
                const quantity =
                  Number.isFinite(qtyRaw) && qtyRaw > 0
                    ? Math.floor(qtyRaw)
                    : 1;
                const unitCentsRaw = Number(p?.unit_price || 0);
                const unit_price =
                  Number.isFinite(unitCentsRaw) && unitCentsRaw >= 0
                    ? unitCentsRaw / 100
                    : 0;
                return {
                  product_reference: ref,
                  description: desc || undefined,
                  quantity,
                  unit_price,
                  currency,
                };
              })
              .filter((p: any) => String(p?.product_reference || "").trim());
            const customerEmailPayload = {
              customerEmail:
                paymentIntent?.receipt_email || customerEmail || "",
              customerName: customerName,
              storeName: storeName || "Votre Boutique",
              storeDescription: storeDescription,
              storeLogo: `${CLOUDFRONT_URL}/images/${storeId}`,
              storeAddress: storeAddress,
              productReference: productReference,
              products: emailProducts,
              creditUsedAmount: effectiveCustomerCreditAppliedCents / 100,
              refundCreditAmount: effectiveTempTopupCents / 100,
              deliveryRegulationPaidAmount: deliveryRegulationPaidCents / 100,
              amount: customerSpentAmountCents / 100,
              currency: currency,
              paymentId: paymentId,
              previousPaymentId: openShipmentPaymentId || undefined,
              previousBoxtalId: previousBoxtalId || undefined,
              previousShipmentId: previousShipmentId || undefined,
              boxtalId: boxtalId,
              shipmentId: shipmentId,
              deliveryMethod: deliveryMethod,
              deliveryNetwork: deliveryNetwork,
              pickupPointCode: pickupPoint.code || "",
              estimatedDeliveryDate: estimatedDeliveryDate,
              trackingUrl: trackingUrl,
              promoCodes:
                promoCodeDetails
                  .map((d: any) => d?.code || d?.id || "")
                  .filter(Boolean)
                  .join(", ") || "",
              productValue: (products?.[0]?.unit_price || 0) / 100,
              estimatedDeliveryCost:
                Math.max(0, Number(adjustedShippingCostCents || 0)) / 100,
            };
            if (isModification) {
              await emailService.sendCustomerOrderModified(
                customerEmailPayload,
              );
            } else {
              await emailService.sendCustomerConfirmation(customerEmailPayload);
            }
          } catch (emailErr) {
            console.error(
              "Error sending customer confirmation email:",
              emailErr,
            );
          }

          try {
            console.log("Stripe webhook: send store owner notification");
            const isModification = Boolean(openShipmentPaymentId);
            if (storeOwnerEmail) {
              if (paymentIntent?.status !== "succeeded") {
                res.json({ received: true });
                return;
              }
              const emailProducts = (Array.isArray(products) ? products : [])
                .map((p: any) => {
                  const ref = String(p?.name || p?.id || "").trim();
                  const desc = String(p?.description || "").trim();
                  const qtyRaw = Number(p?.quantity || 1);
                  const quantity =
                    Number.isFinite(qtyRaw) && qtyRaw > 0
                      ? Math.floor(qtyRaw)
                      : 1;
                  const unitCentsRaw = Number(p?.unit_price || 0);
                  const unit_price =
                    Number.isFinite(unitCentsRaw) && unitCentsRaw >= 0
                      ? unitCentsRaw / 100
                      : 0;
                  return {
                    product_reference: ref,
                    description: desc || undefined,
                    quantity,
                    unit_price,
                    currency,
                  };
                })
                .filter((p: any) => String(p?.product_reference || "").trim());
              const ownerEmailPayload = {
                ownerEmail: storeOwnerEmail,
                storeName: storeName || "Votre Boutique",
                customerEmail: customerEmail || "",
                customerName: customerName || "",
                customerPhone: customerPhone || "",
                deliveryMethod,
                deliveryNetwork,
                shippingAddress: {
                  name: (customerShippingAddress as any)?.name,
                  address: {
                    line1: (customerShippingAddress as any)?.address?.line1,
                    line2:
                      (customerShippingAddress as any)?.address?.line2 || "",
                    city: (customerShippingAddress as any)?.address?.city,
                    state: (customerShippingAddress as any)?.address?.state,
                    postal_code: (customerShippingAddress as any)?.address
                      ?.postal_code,
                    country: (customerShippingAddress as any)?.address?.country,
                  },
                },
                customerAddress: {},
                pickupPointCode: pickupPoint.code || "",
                productReference,
                products: emailProducts,
                amount: storeEarningsAmountCents / 100,
                weight,
                currency,
                paymentId,
                previousPaymentId: openShipmentPaymentId || undefined,
                previousBoxtalId: previousBoxtalId || undefined,
                previousShipmentId: previousShipmentId || undefined,
                boxtalId,
                shipmentId,
                promoCodes:
                  promoCodeDetails
                    .map((d: any) => d?.code || d?.id || "")
                    .filter(Boolean)
                    .join(", ") || "",
                productValue: (products?.[0]?.unit_price || 0) / 100,
                estimatedDeliveryCost: estimatedDeliveryCost / 100,
                attachments,
                documentPendingNote:
                  attachments?.length === 0
                    ? "Vous pourrez télécharger votre bordereau d'envoi depuis votre tableau de bord dans quelques minutes."
                    : undefined,
              };
              if (isModification) {
                await emailService.sendStoreOwnerOrderModified(
                  ownerEmailPayload,
                );
              } else {
                await emailService.sendStoreOwnerNotification(
                  ownerEmailPayload,
                );
              }
            }
          } catch (ownerEmailErr) {
            console.error(
              "Error sending store owner notification:",
              ownerEmailErr,
            );
          }
        }
      } catch (sessionErr) {
        await emailService.sendAdminError({
          subject: "Erreur lors de la création de la session de paiement",
          message: `Une erreur est survenue lors de la création de la session de paiement pour l'email ${
            paymentIntent?.receipt_email
          }: ${JSON.stringify(sessionErr)}`,
        });
        console.error("Error handling checkout.session.completed:", sessionErr);
      }
      break;
    case "payment_intent.payment_failed":
      const failedPaymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log(
        "payment_intent.payment_failed webhook: Payment failed:",
        failedPaymentIntent.id,
      );
      try {
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: failedPaymentIntent.id,
          limit: 1,
        });
        if (sessions.data.length > 0) {
          const failedSession = sessions.data[0];
          console.log(
            `payment_intent.payment_failed webhook: Payment failed for session: ${failedSession.id}`,
          );
        }
      } catch (sessionErr) {
        console.error("Error handling payment failure:", sessionErr);
      }
      break;
    default:
      console.log(
        `payment_intent.payment_failed webhook: Unhandled event type ${event.type}`,
      );
  }

  res.json({ received: true });
};
