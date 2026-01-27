import { verifyWebhook } from "@clerk/express/webhooks";

export const clerkWebhookHandler = async (req: any, res: any) => {

  try {
    const evt = await verifyWebhook(req);
    if (evt.type === "user.created") {
      const d: any = evt.data;
      const id = d?.id;
      const email_addresses = d?.email_addresses || [];
      const first_name = d?.first_name || "";
      const last_name = d?.last_name || "";
      const image_url = d?.image_url || "";
    }
    if (evt.type === "user.updated") {
      const d: any = evt.data;
      const id = d?.id;
      const email_addresses = d?.email_addresses || [];
      const first_name = d?.first_name || "";
      const last_name = d?.last_name || "";
      const image_url = d?.image_url || "";
    }
    if (evt.type === "user.deleted") {
      const d: any = evt.data;
      const id = d?.id;
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: "Invalid signature" });
  }
};
