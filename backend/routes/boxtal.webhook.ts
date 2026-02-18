import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  emailService,
  CustomerTrackingEmailData,
} from "../services/emailService";

export const boxtalWebhookHandler = async (req: any, res: any) => {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  const supabase =
    supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  const stripe = stripeSecret
    ? new Stripe(stripeSecret, { apiVersion: "2025-06-30.basil" as any })
    : null;

  const getInternalBase = (): string => {
    const explicit = (process.env.INTERNAL_API_BASE || "").trim();
    if (explicit) return explicit;
    const vercelUrl = (process.env.VERCEL_URL || "").trim();
    if (vercelUrl) {
      return /^https?:\/\//i.test(vercelUrl)
        ? vercelUrl
        : `https://${vercelUrl}`;
    }
    return `http://localhost:${process.env.PORT || 5000}`;
  };

  const verifyWebhookSignature = (
    payload: string,
    signature: string,
    secret: string,
  ): boolean => {
    if (!signature || !payload || !secret) {
      return false;
    }
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload, "utf8")
      .digest("hex");
    return computedSignature === signature;
  };

  try {
    const signature = req.headers["x-bxt-signature"] as string;
    const webhookSecret = process.env.BOXTAL_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("BOXTAL_WEBHOOK_SECRET environment variable is not set");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const payload = req.body.toString("utf8");
    if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
      console.error("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(payload);

    switch (event.type) {
      case "DOCUMENT_CREATED":
        console.warn(
          `DOCUMENT_CREATED at ${new Date().toISOString()}`,
          JSON.stringify(event),
        );
        try {
          const shippingOrderId: string = event?.shippingOrderId;
          const docUrl: string | undefined =
            event?.payload?.documents?.[0]?.url;

          if (!shippingOrderId || !supabase) {
            console.warn(
              "DOCUMENT_CREATED: missing shippingOrderId or supabase not configured",
            );
            break;
          }

          const { data: shipment, error: shipmentError } = await supabase
            .from("shipments")
            .select("*")
            .eq("shipment_id", shippingOrderId)
            .maybeSingle();

          if (shipmentError) {
            console.error(
              "DOCUMENT_CREATED: Supabase error fetching shipment:",
              shipmentError,
            );
            break;
          }
          if (!shipment) {
            console.log(
              "DOCUMENT_CREATED: shipment not found for",
              shippingOrderId,
            );
            break;
          }

          if (shipment.document_created === true) {
            console.log("DOCUMENT_CREATED: existing document_url:", docUrl);
            if (docUrl) {
              try {
                const { error: updUrlErr } = await supabase
                  .from("shipments")
                  .update({ document_url: docUrl })
                  .eq("id", shipment.id);
                if (updUrlErr) {
                  console.error(
                    "DOCUMENT_CREATED: error updating document_url:",
                    updUrlErr,
                  );
                }
              } catch (updEx) {
                console.error(
                  "DOCUMENT_CREATED: exception updating document_url:",
                  updEx,
                );
              }
            }
            console.log(
              "DOCUMENT_CREATED: document already marked as created, skipping email",
            );
            break;
          }

          let storeOwnerEmail: string | undefined;
          let storeName: string = "Votre Boutique";
          if (shipment.store_id) {
            try {
              const { data: store, error: storeErr } = await supabase
                .from("stores")
                .select("owner_email,name")
                .eq("id", shipment.store_id as any)
                .maybeSingle();
              if (!storeErr) {
                storeOwnerEmail = (store as any)?.owner_email || undefined;
                storeName = (store as any)?.name || storeName;
              } else {
                console.warn(
                  "DOCUMENT_CREATED: error fetching store:",
                  storeErr,
                );
              }
            } catch (storeEx) {
              console.warn(
                "DOCUMENT_CREATED: exception fetching store:",
                storeEx,
              );
            }
          }

          if (!storeOwnerEmail) {
            console.warn(
              "DOCUMENT_CREATED: no store owner email found, skipping",
            );
            break;
          }

          let customerEmail: string = "";
          let customerName: string = "";
          try {
            if (stripe && shipment.customer_stripe_id) {
              const customer = await stripe.customers.retrieve(
                shipment.customer_stripe_id as string,
              );
              customerEmail = (customer as any)?.email || "";
              customerName =
                ((customer as any)?.name as string) ||
                ((customer as any)?.metadata?.name as any as string) ||
                "";
            }
          } catch (retrieveErr) {
            console.warn(
              "DOCUMENT_CREATED: unable to retrieve Stripe customer:",
              retrieveErr,
            );
          }

          let attachments: Array<{
            filename: string;
            content: Buffer;
            contentType?: string;
          }> = [];
          if (docUrl) {
            try {
              const resp = await fetch(docUrl);
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                const ct =
                  resp.headers.get("content-type") || "application/pdf";
                let filename = "shipping-document.pdf";
                try {
                  const urlObj = new URL(docUrl);
                  const parts = urlObj.pathname.split("/").filter(Boolean);
                  filename = parts[parts.length - 1] || filename;
                } catch {}
                attachments.push({ filename, content: buf, contentType: ct });
              } else {
                console.warn(
                  "DOCUMENT_CREATED: failed to download document:",
                  resp.status,
                );
              }
            } catch (downloadEx) {
              console.error(
                "DOCUMENT_CREATED: exception downloading document:",
                downloadEx,
              );
            }
          }

          try {
            const updateData: any = { document_created: true };
            if (docUrl) updateData.document_url = docUrl;
            const { error: updErr } = await supabase
              .from("shipments")
              .update(updateData)
              .eq("id", shipment.id);
            if (updErr) {
              console.error(
                "DOCUMENT_CREATED: error updating shipments document fields:",
                updErr,
              );
            }
          } catch (updEx) {
            console.error(
              "DOCUMENT_CREATED: exception updating shipments document fields:",
              updEx,
            );
          }
        } catch (e) {
          console.error("DOCUMENT_CREATED processing error:", e);
        }
        break;
      case "TRACKING_CHANGED":
        console.warn("TRACKING_CHANGED event:", JSON.stringify(event));
        try {
          const shippingOrderId: string = event?.shippingOrderId;
          const tracking = event?.payload?.trackings?.[0];

          if (!shippingOrderId || !stripe || !supabase) {
            console.warn(
              "TRACKING_CHANGED: missing shippingOrderId or stripe/supabase not configured",
            );
            break;
          }

          if (tracking?.packageTrackingUrl) {
            try {
              const { error: updErr } = await supabase
                .from("shipments")
                .update({ tracking_url: tracking?.packageTrackingUrl || "" })
                .eq("shipment_id", shippingOrderId);
              if (updErr) {
                console.error(
                  "TRACKING_CHANGED: error updating tracking_url:",
                  updErr,
                );
              }
              console.log(
                "TRACKING_CHANGED: updated tracking_url:",
                tracking?.packageTrackingUrl || "",
              );
            } catch (updEx) {
              console.error(
                "TRACKING_CHANGED: exception updating tracking_url:",
                updEx,
              );
            }
          }

          const currentStatus: string | undefined = tracking?.status;
          const historyArray: any[] = Array.isArray(tracking?.history)
            ? tracking.history
            : [];
          const lastHistoryStatus: string | undefined = historyArray.length
            ? historyArray[historyArray.length - 1]?.status
            : undefined;

          if (
            lastHistoryStatus &&
            currentStatus === lastHistoryStatus &&
            tracking?.isFinal !== true
          ) {
            console.log(
              "TRACKING_CHANGED: status unchanged, skipping email",
              currentStatus,
              shippingOrderId,
            );
            break;
          }

          const { data: shipment, error: shipmentError } = await supabase
            .from("shipments")
            .select(
              "id, shipment_id, status, customer_stripe_id, store_id, estimated_delivery_cost, delivery_cost, is_final_destination, delivery_date",
            )
            .eq("shipment_id", shippingOrderId)
            .maybeSingle();

          if (shipmentError) {
            console.error("Supabase error fetching shipment:", shipmentError);
            break;
          }
          if (!shipment) {
            console.log(
              "TRACKING_CHANGED: shipment not found for",
              shippingOrderId,
            );
            break;
          }

          if (tracking?.isFinal === true) {
            try {
              const apiBase = getInternalBase();
              const orderResp = await fetch(
                `${apiBase}/api/boxtal/shipping-orders/${encodeURIComponent(
                  shippingOrderId,
                )}`,
                { method: "GET" },
              );
              let actualDeliveryCostEur: number | null = null;
              if (orderResp.ok) {
                const orderJson: any = await orderResp.json();
                const rawExclTax = Number(
                  (orderJson?.content?.deliveryPriceExclTax?.value ?? 0) as any,
                );
                const ttc =
                  (Number.isFinite(rawExclTax) ? rawExclTax : 0) * 1.2;
                actualDeliveryCostEur = Number.isFinite(ttc)
                  ? Math.max(0, ttc)
                  : 0;
              } else {
                const t = await orderResp.text().catch(() => "");
                console.error(
                  "TRACKING_CHANGED: fetch boxtal shipping order failed",
                  {
                    shippingOrderId,
                    status: orderResp.status,
                    body: t ? t.slice(0, 800) : "",
                  },
                );
              }

              const prevFinal = Boolean(
                (shipment as any)?.is_final_destination,
              );
              const prevCost = Number((shipment as any)?.delivery_cost || 0);
              const prevDeliveryDateRaw = String(
                (shipment as any)?.delivery_date || "",
              ).trim();
              const resolvedDeliveryDateIso = (() => {
                for (let i = historyArray.length - 1; i >= 0; i--) {
                  const h: any = historyArray[i] || {};
                  const raw =
                    h?.date ??
                    h?.datetime ??
                    h?.deliveredAt ??
                    h?.createdAt ??
                    h?.created_at ??
                    h?.timestamp ??
                    null;
                  if (!raw) continue;
                  const numeric =
                    typeof raw === "number"
                      ? raw
                      : typeof raw === "string" && /^\d+$/.test(raw)
                        ? Number(raw)
                        : NaN;
                  if (Number.isFinite(numeric) && numeric > 0) {
                    const ms = numeric > 1e12 ? numeric : numeric * 1000;
                    const d = new Date(ms);
                    if (Number.isFinite(d.getTime())) return d.toISOString();
                  }
                  const d = new Date(raw);
                  if (Number.isFinite(d.getTime())) return d.toISOString();
                }
                return null;
              })();
              const sameCost =
                actualDeliveryCostEur === null
                  ? false
                  : Number.isFinite(prevCost) &&
                    Math.abs(prevCost - actualDeliveryCostEur) < 0.001;
              const sameDeliveryDate = resolvedDeliveryDateIso
                ? (() => {
                    const prevMs = prevDeliveryDateRaw
                      ? Date.parse(prevDeliveryDateRaw)
                      : NaN;
                    const nextMs = Date.parse(resolvedDeliveryDateIso);
                    return (
                      Number.isFinite(prevMs) &&
                      Number.isFinite(nextMs) &&
                      prevMs === nextMs
                    );
                  })()
                : true;

              if (
                !(
                  prevFinal &&
                  (actualDeliveryCostEur === null || sameCost) &&
                  sameDeliveryDate
                )
              ) {
                const updatePayload: any = { is_final_destination: true };
                if (actualDeliveryCostEur !== null) {
                  updatePayload.delivery_cost = actualDeliveryCostEur;
                }
                if (resolvedDeliveryDateIso) {
                  updatePayload.delivery_date = resolvedDeliveryDateIso;
                }
                const { error: finalErr } = await supabase
                  .from("shipments")
                  .update(updatePayload)
                  .eq("shipment_id", shippingOrderId);
                if (finalErr) {
                  console.error(
                    "TRACKING_CHANGED: error updating shipments final delivery_cost:",
                    finalErr,
                  );
                }

                const est = Number(
                  (shipment as any)?.estimated_delivery_cost || 0,
                );
                const diffCents =
                  actualDeliveryCostEur === null
                    ? 0
                    : Math.round((est - actualDeliveryCostEur) * 100);
                if (diffCents !== 0) {
                  try {
                    const cust: any = await stripe.customers.retrieve(
                      shipment.customer_stripe_id as string,
                    );
                    const meta: any = (cust as any)?.metadata || {};
                    const prevBalance = Number.parseInt(
                      String(meta?.credit_balance ?? "0"),
                      10,
                    );
                    const currentBalanceCents = Number.isFinite(prevBalance)
                      ? prevBalance
                      : 0;
                    const nextBalanceCents = currentBalanceCents + diffCents;
                    await stripe.customers.update(
                      shipment.customer_stripe_id as string,
                      {
                        metadata: {
                          ...meta,
                          credit_balance: String(nextBalanceCents),
                        },
                      } as any,
                    );
                  } catch (creditErr) {
                    console.error(
                      "TRACKING_CHANGED: error updating customer credit_balance:",
                      creditErr,
                    );
                  }
                }
              }
            } catch (finalEx) {
              console.error(
                "TRACKING_CHANGED: exception updating shipments.is_final_destination:",
                finalEx,
              );
            }
          }

          const previousStatus: string | undefined =
            shipment.status || undefined;
          if (
            previousStatus &&
            currentStatus === previousStatus &&
            tracking?.isFinal !== true
          ) {
            console.log(
              "TRACKING_CHANGED: status unchanged vs DB, skipping email",
              currentStatus,
              shippingOrderId,
            );
            break;
          }

          let storeName = "Votre Boutique";
          try {
            if (shipment.store_id) {
              const { data: store, error: storeErr } = await supabase
                .from("stores")
                .select("name")
                .eq("id", shipment.store_id as any)
                .maybeSingle();
              if (!storeErr && (store as any)?.name) {
                storeName = (store as any).name;
              }
            }
          } catch (storeEx) {
            console.warn(
              "TRACKING_CHANGED: error fetching store name:",
              storeEx,
            );
          }

          let customerEmail: string | undefined;
          let customerName: string = "";
          try {
            const customer = await stripe.customers.retrieve(
              shipment.customer_stripe_id as string,
            );
            customerEmail = (customer as any)?.email || undefined;
            customerName =
              ((customer as any)?.name as string) ||
              ((customer as any)?.metadata?.name as any as string) ||
              "";
          } catch (retrieveErr) {
            console.error(
              "TRACKING_CHANGED: unable to retrieve Stripe customer:",
              retrieveErr,
            );
          }

          if (!customerEmail) {
            console.log(
              "TRACKING_CHANGED: no email found for Stripe customer",
              shipment.customer_stripe_id,
            );
            break;
          }

          const emailData: CustomerTrackingEmailData = {
            customerEmail,
            customerName,
            storeName,
            shippingOrderId,
            status: currentStatus || "Mise à jour",
            message: tracking?.message || undefined,
            trackingNumber: tracking?.trackingNumber || undefined,
            packageId: tracking?.packageId,
            packageTrackingUrl: tracking?.packageTrackingUrl || undefined,
          };

          const sent = await emailService.sendCustomerTrackingUpdate(emailData);
          console.log(
            `TRACKING_CHANGED: email sent=${sent} to ${customerEmail} for ${shippingOrderId}`,
          );

          try {
            const { error: updErr } = await supabase
              .from("shipments")
              .update({ status: currentStatus })
              .eq("shipment_id", shippingOrderId);
            if (updErr) {
              console.error(
                "TRACKING_CHANGED: error updating shipments.status:",
                updErr,
              );
            }
          } catch (updEx) {
            console.error(
              "TRACKING_CHANGED: exception updating shipments.status:",
              updEx,
            );
          }
        } catch (e) {
          console.error("TRACKING_CHANGED processing error:", e);
        }
        break;
      default:
        console.log("Unhandled event type:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Error processing Boxtal webhook:", error);
    return res.status(400).json({
      error: "Failed to process webhook",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
