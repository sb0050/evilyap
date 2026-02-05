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
const supabaseKey = process.env.SUPABASE_ANON_KEY;
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

        let blockedFlowTriggered = false;
        let creditAmountForMissingRefs = 0;
        let refsToProcessOverride: string[] | null = null;
        let productReferenceOverride: string | null = null;
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
        } catch (lineItemsErr) {
          console.warn(
            "checkout.session.completed webhook: Error fetching line items:",
            (lineItemsErr as any)?.message || lineItemsErr,
          );
        }
        try {
          const pi = paymentIntent;
          if (!pi) {
            console.warn(
              "checkout.session.completed: payment_intent missing for blocked check",
            );
          } else {
            console.log(
              "checkout.session.completed: payment_intent for blocked check",
              pi.id,
            );
            console.log(
              "checkout.session.completed: payment_intent metadata",
              pi.metadata || {},
            );

            const storeNameToCheck = String(
              (pi.metadata as any)?.store_name || "",
            ).trim();
            const refsToCheck = normalizeRefs(
              (pi.metadata as any)?.product_reference || "",
            );
            console.log(
              "checkout.session.completed: store/refs",
              storeNameToCheck || "missing",
              refsToCheck,
            );
            if (storeNameToCheck && refsToCheck.length > 0) {
              const { data: storeRow, error: storeErr } = await supabase
                .from("stores")
                .select("id")
                .eq("name", storeNameToCheck)
                .maybeSingle();
              if (!storeErr && storeRow) {
                const storeId = Number((storeRow as any)?.id);
                if (Number.isFinite(storeId)) {
                  if (resolvedCustomerId) {
                    const { data: cartRows, error: cartErr } = await supabase
                      .from("carts")
                      .select("product_reference")
                      .eq("customer_stripe_id", resolvedCustomerId)
                      .eq("store_id", storeId)
                      .eq("status", "PENDING")
                      .in("product_reference", refsToCheck);
                    if (cartErr) {
                      console.error(
                        "checkout.session.completed: Error fetching customer carts:",
                        cartErr.message,
                      );
                    } else {
                      const availableRefSet = new Set(
                        (cartRows || [])
                          .map((r: any) =>
                            String((r as any)?.product_reference || "").trim(),
                          )
                          .filter((r: string) => r.length > 0),
                      );
                      const availableRefs = refsToCheck.filter((r) =>
                        availableRefSet.has(r),
                      );
                      const missingRefs = refsToCheck.filter(
                        (r) => !availableRefSet.has(r),
                      );
                      console.log(
                        "checkout.session.completed: availableRefs",
                        availableRefs,
                      );
                      console.log(
                        "checkout.session.completed: missingRefs",
                        missingRefs,
                      );

                      if (availableRefs.length > 0) {
                        refsToProcessOverride = availableRefs;
                        productReferenceOverride = availableRefs.join(";");
                        try {
                          const { error: otherDelErr } = await supabase
                            .from("carts")
                            .delete()
                            .eq("store_id", storeId)
                            .eq("status", "PENDING")
                            .neq("customer_stripe_id", resolvedCustomerId)
                            .in("product_reference", availableRefs);
                          if (otherDelErr) {
                            console.error(
                              "checkout.session.completed: Error deleting other users cart refs:",
                              otherDelErr.message,
                            );
                          } else {
                            console.log(
                              "checkout.session.completed: refs deleted for other users",
                              availableRefs,
                            );
                          }
                        } catch (otherDelErr) {
                          console.error(
                            "checkout.session.completed: Error deleting other users cart refs:",
                            otherDelErr,
                          );
                        }

                        try {
                          const { error: selfDelErr } = await supabase
                            .from("carts")
                            .delete()
                            .eq("customer_stripe_id", resolvedCustomerId)
                            .eq("store_id", storeId)
                            .eq("status", "PENDING")
                            .in("product_reference", availableRefs);
                          if (selfDelErr) {
                            console.error(
                              "checkout.session.completed: Error deleting customer cart refs:",
                              selfDelErr.message,
                            );
                          } else {
                            console.log(
                              "checkout.session.completed: refs deleted for customer",
                              resolvedCustomerId,
                              availableRefs,
                            );
                          }
                        } catch (selfDelErr) {
                          console.error(
                            "checkout.session.completed: Error deleting customer cart refs:",
                            selfDelErr,
                          );
                        }
                      }

                      if (missingRefs.length > 0) {
                        const paymentTotal = Number(
                          pi.amount ?? session.amount_total ?? 0,
                        );
                        let creditAmount = 0;
                        if (lineItemsResp?.data?.length) {
                          for (const item of lineItemsResp.data as any[]) {
                            const name = String(
                              item?.price?.product?.name || "",
                            ).trim();
                            if (name && missingRefs.includes(name)) {
                              const itemTotal = Number(item?.amount_total || 0);
                              if (Number.isFinite(itemTotal)) {
                                creditAmount += itemTotal;
                              }
                            }
                          }
                        }
                        if (availableRefs.length === 0) {
                          creditAmount = paymentTotal;
                        }
                        if (creditAmount > paymentTotal) {
                          creditAmount = paymentTotal;
                        }
                        console.log(
                          "checkout.session.completed: creditAmount",
                          creditAmount,
                        );
                        try {
                          await stripe.paymentIntents.update(pi.id, {
                            metadata: {
                              ...(pi.metadata || {}),
                              credited_references: missingRefs.join(";"),
                              purchased_references: availableRefs.join(";"),
                              credit_amount_cents: String(
                                Math.round(creditAmount),
                              ),
                            },
                          });
                        } catch (metaErr: any) {
                          console.warn(
                            "checkout.session.completed: Update PI metadata failed:",
                            metaErr?.message || metaErr,
                          );
                        }
                        const creditAmountCents = Math.round(creditAmount);
                        if (creditAmountCents > 0 && resolvedCustomerId) {
                          try {
                            const existingCreditIssuedParsed = Number.parseInt(
                              String(
                                (pi.metadata as any)?.credit_issued_cents ||
                                  "0",
                              ),
                              10,
                            );
                            const existingCreditIssuedCents =
                              Number.isFinite(existingCreditIssuedParsed) &&
                              existingCreditIssuedParsed > 0
                                ? existingCreditIssuedParsed
                                : 0;
                            if (
                              existingCreditIssuedCents === creditAmountCents
                            ) {
                              creditAmountForMissingRefs = creditAmountCents;
                            } else if (existingCreditIssuedCents > 0) {
                              console.warn(
                                "checkout.session.completed: credit already issued with different amount",
                                {
                                  paymentIntentId: pi.id,
                                  existingCreditIssuedCents,
                                  creditAmountCents,
                                },
                              );
                            } else {
                              const cust = (await stripe.customers.retrieve(
                                resolvedCustomerId,
                              )) as Stripe.Customer;
                              if (cust && !("deleted" in cust)) {
                                const meta = (cust as any)?.metadata || {};
                                const prevBalanceParsed = Number.parseInt(
                                  String(meta?.credit_balance || "0"),
                                  10,
                                );
                                const prevBalanceCents = Number.isFinite(
                                  prevBalanceParsed,
                                )
                                  ? prevBalanceParsed
                                  : 0;
                                const nextBalanceCents =
                                  prevBalanceCents + creditAmountCents;
                                await stripe.customers.update(
                                  resolvedCustomerId,
                                  {
                                    metadata: {
                                      ...meta,
                                      credit_balance: String(nextBalanceCents),
                                    },
                                  } as any,
                                  {
                                    idempotencyKey: `credit-missingrefs-${pi.id}`,
                                  } as any,
                                );
                                try {
                                  await stripe.paymentIntents.update(pi.id, {
                                    metadata: {
                                      ...(pi.metadata || {}),
                                      credit_issued_cents:
                                        String(creditAmountCents),
                                    },
                                  });
                                } catch (_e) {}
                                creditAmountForMissingRefs = creditAmountCents;
                              }
                            }
                          } catch (creditErr: any) {
                            console.warn(
                              "checkout.session.completed: credit issue failed:",
                              creditErr?.message || creditErr,
                            );
                          }
                        }
                      }

                      if (availableRefs.length === 0) {
                        blockedFlowTriggered = true;
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (_e) {}

        if (blockedFlowTriggered) {
          break;
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
          const tempTopupCents =
            Number.isFinite(tempTopupCentsParsed) && tempTopupCentsParsed > 0
              ? tempTopupCentsParsed
              : 0;

          const deliveryDebtPaidCentsParsed = Number.parseInt(
            String(session.metadata?.delivery_debt_paid_cents || "0"),
            10,
          );
          const deliveryDebtPaidCents =
            Number.isFinite(deliveryDebtPaidCentsParsed) &&
            deliveryDebtPaidCentsParsed > 0
              ? deliveryDebtPaidCentsParsed
              : 0;

          let deliveryDebtLineItemAmountCents = 0;
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
              const raw = Number(
                debtItem?.amount_total ??
                  debtItem?.price?.unit_amount ??
                  debtItem?.amount_subtotal ??
                  0,
              );
              deliveryDebtLineItemAmountCents = Number.isFinite(raw) ? raw : 0;
            }
          }

          const shouldResetDebtBalance =
            expectedDeliveryDebtCents > 0 &&
            deliveryDebtLineItemAmountCents === expectedDeliveryDebtCents;

          if (expectedDeliveryDebtCents > 0 && !shouldResetDebtBalance) {
            console.warn(
              "checkout.session.completed: delivery debt mismatch, skipping credit_balance reset",
              {
                sessionId: session.id,
                customerId,
                expectedDeliveryDebtCents,
                deliveryDebtPaidCents,
                deliveryDebtLineItemAmountCents,
              },
            );
          }

          if (shouldResetDebtBalance) {
            try {
              await stripe.customers.update(
                customerId,
                { metadata: { credit_balance: "0" } },
                { idempotencyKey: `credit-debt-${session.id}` },
              );
            } catch (e) {
              console.warn(
                "checkout.session.completed webhook: unable to reset credit_balance:",
                (e as any)?.message || e,
              );
            }
          } else if (stripeCreditAppliedCents > 0 || tempTopupCents > 0) {
            const nextBalanceCents =
              Math.max(0, currentBalanceCents - stripeCreditAppliedCents) +
              tempTopupCents;
            try {
              await stripe.customers.update(
                customerId,
                { metadata: { credit_balance: String(nextBalanceCents) } },
                { idempotencyKey: `credit-balance-${session.id}` },
              );
            } catch (e) {
              console.warn(
                "checkout.session.completed webhook: unable to update credit_balance:",
                (e as any)?.message || e,
              );
            }
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
          const productReference =
            productReferenceOverride ||
            session.metadata?.product_reference ||
            "N/A";
          const amount = paymentIntent?.amount ?? session.amount_total ?? 0;
          const netAmount = Math.max(0, amount - creditAmountForMissingRefs);
          const currency = paymentIntent?.currency ?? session.currency ?? "eur";
          const paymentId = paymentIntent?.id ?? session.id;
          const weight = formatWeight(session.metadata?.weight);
          let estimatedDeliveryDate: string = "";
          let boxtalId = "";
          let trackingUrl = "";
          let shipmentId = "";
          const promoCodeDetails = [];
          const estimatedDeliveryCost =
            session.shipping_cost?.amount_total || 0;

          if (session.discounts?.length) {
            for (const discount of session.discounts) {
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
          const vendorPromoCodeId =
            promoCodeDetails.find((d: any) => {
              const code = String(d?.code || "")
                .trim()
                .toUpperCase();
              if (!code) return false;
              if (code.startsWith("CREDIT-")) return false;
              if (code.startsWith("PAYLIVE-")) return false;
              const id = String(d?.id || "").trim();
              return id.startsWith("promo_") || id.startsWith("promo-");
            })?.id || null;

          const products = (lineItemsResp?.data || [])
            .map((item: any) => ({
              id: item.price.product.id,
              name: item.price.product.name,
              description: item.price.product.description,
              image: item.price.product.images?.[0],
              quantity: item.quantity,
              amount_total: item.amount_total,
              currency: item.currency,
              unit_price: item.price.unit_amount,
              price_id: item.price.id,
            }))
            .filter((p: any) => {
              if (
                !refsToProcessOverride ||
                refsToProcessOverride.length === 0
              ) {
                return true;
              }
              const name = String(p?.name || "").trim();
              return name && refsToProcessOverride.includes(name);
            });

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
              const oldBoxtalShipmentId = String(
                openShipmentRow?.shipment_id || "",
              ).trim();
              if (openShipmentRow && oldBoxtalShipmentId) {
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

                const { error: delErr } = await supabase
                  .from("shipments")
                  .delete()
                  .eq("id", openShipmentRow.id);
                if (delErr) {
                  await emailService.sendAdminError({
                    subject: "Suppression shipment open_shipment échouée",
                    message: `Boxtal annulé mais suppression shipments échouée (id=${openShipmentRow.id}, payment_id=${openShipmentPaymentId}).`,
                    context: JSON.stringify(delErr),
                  });
                }
              } else if (openShipmentRow && !oldBoxtalShipmentId) {
                const { error: delErr } = await supabase
                  .from("shipments")
                  .delete()
                  .eq("id", openShipmentRow.id);
                if (delErr) {
                  await emailService.sendAdminError({
                    subject: "Suppression shipment open_shipment échouée",
                    message: `Suppression shipments échouée (id=${openShipmentRow.id}, payment_id=${openShipmentPaymentId}).`,
                    context: JSON.stringify(delErr),
                  });
                }
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

          if (!storeId) {
            console.error(
              "checkout.session.completed webhook: storeId missing",
            );
            res.json({ received: true });
            return;
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
                  const m = new Map<
                    string,
                    { quantity: number; description?: string | null }
                  >();
                  for (const p of products) {
                    const n = String((p as any)?.name || "").trim();
                    if (!n) continue;
                    const q = Number((p as any)?.quantity || 1);
                    const rawDesc = String(
                      (p as any)?.description || "",
                    ).trim();
                    const desc = rawDesc
                      ? rawDesc.replace(/[\r\n]+/g, " ").replace(/;+/g, ", ")
                      : "";
                    const prev = m.get(n) || { quantity: 0, description: null };
                    m.set(n, {
                      quantity: prev.quantity + q,
                      description: prev.description || desc || null,
                    });
                  }
                  return Array.from(m.entries())
                    .map(([n, info]) => {
                      const q = info.quantity;
                      const d = String(info.description || "").trim();
                      return `${n}**${q}${d ? `(${d})` : ""}`;
                    })
                    .filter((s) => s && s.length > 0)
                    .join(";");
                }
                return productReference;
              })() || null;

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
              paid_value: (netAmount || 0) / 100,
              boxtal_shipping_json: boxtalOrderFailed
                ? JSON.stringify(createOrderPayload)
                : null,
              delivery_cost:
                (dataBoxtal?.content?.deliveryPriceExclTax?.value || 0) * 1.2,
              promo_code_id: vendorPromoCodeId,
              product_value: (products?.[0]?.unit_price || 0) / 100,
              estimated_delivery_cost: (estimatedDeliveryCost || 0) / 100,
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
            await emailService.sendCustomerConfirmation({
              customerEmail:
                paymentIntent?.receipt_email || customerEmail || "",
              customerName: customerName,
              storeName: storeName || "Votre Boutique",
              storeDescription: storeDescription,
              storeLogo: `${CLOUDFRONT_URL}/images/${storeId}`,
              storeAddress: storeAddress,
              productReference: productReference,
              amount: netAmount / 100,
              currency: currency,
              paymentId: paymentId,
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
              estimatedDeliveryCost: estimatedDeliveryCost / 100,
            });
          } catch (emailErr) {
            console.error(
              "Error sending customer confirmation email:",
              emailErr,
            );
          }

          try {
            console.log("Stripe webhook: send store owner notification");
            if (storeOwnerEmail) {
              const sentOwner = await emailService.sendStoreOwnerNotification({
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
                amount: netAmount / 100,
                weight,
                currency,
                paymentId,
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
              });
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
