import express from "express";
import { createClient } from "@supabase/supabase-js";
import { tiktokLiveService } from "../services/live/tiktokLiveService";
import { interpretOrderMessage } from "../services/live/orderInterpreter";
import {
  createOrUpdateCartFromLiveOrder,
  linkTikTokUsernameToEmail,
} from "../services/live/cartOrchestrator";
import { parseContactFromRegex } from "../services/live/contactRegexParser";

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env for live routes");
}
const supabase = createClient(supabaseUrl, supabaseKey);

let liveProcessorBound = false;

async function processChatOrder(
  event: {
    username: string;
    comment: string;
  },
  storeId: number,
): Promise<void> {
  try {
    const parsedContact = parseContactFromRegex(event.comment);
    if (parsedContact.intent === "LINK_EMAIL" && parsedContact.email) {
      const linked = await linkTikTokUsernameToEmail({
        storeId,
        tiktokUsername: event.username,
        email: parsedContact.email,
      });
      tiktokLiveService.emitSystemEvent(
        linked.success ? "email_linked" : "email_link_failed",
        {
          username: event.username,
          email: parsedContact.email,
          customerStripeId: linked.customerStripeId,
          reason: linked.reason,
        },
      );
    }

    const interpreted = await interpretOrderMessage(event.comment);
    if (interpreted.intent !== "ADD_TO_CART" || !interpreted.reference) {
      // Pourquoi ignorer ici:
      // un message qui contient uniquement un email n'est pas une commande,
      // mais reste un signal métier valide pour relier le panier live au contact.
      if (parsedContact.intent === "LINK_EMAIL") return;
      tiktokLiveService.emitSystemEvent("order_failed", {
        username: event.username,
        source: interpreted.source,
        reason: interpreted.reason,
      });
      return;
    }
    const quantity = interpreted.quantity && interpreted.quantity > 0 ? interpreted.quantity : 1;
    const result = await createOrUpdateCartFromLiveOrder({
      storeId,
      tiktokUsername: event.username,
      reference: interpreted.reference,
      quantity,
      sourceComment: event.comment,
      customerEmail: parsedContact.email,
    });
    tiktokLiveService.emitOrderEvent({
      type: "order",
      username: event.username,
      comment: event.comment,
      intent: interpreted.intent,
      reference: interpreted.reference,
      quantity,
      source: interpreted.source,
      success: result.success,
      reason: result.reason,
      payload: {
        cartId: result.cartId,
        customerStripeId: result.customerStripeId,
        ...(result.payload || {}),
      },
    });
    tiktokLiveService.emitSystemEvent(result.success ? "order_parsed" : "order_failed", {
      username: event.username,
      source: interpreted.source,
      reason: result.reason,
    });
  } catch (error: any) {
    tiktokLiveService.emitSystemEvent("error", {
      scope: "live_order_processor",
      message: String(error?.message || "Erreur inconnue"),
    });
  }
}

function bindLiveProcessorOnce(): void {
  if (liveProcessorBound) return;
  liveProcessorBound = true;
  tiktokLiveService.subscribe(async (event) => {
    if (event.type !== "chat") return;
    const state = tiktokLiveService.getState();
    if (state.status !== "connected") return;
    if (!state.storeId || state.storeId <= 0) return;
    await processChatOrder(
      {
        username: event.username,
        comment: event.comment,
      },
      state.storeId,
    );
  });
}

bindLiveProcessorOnce();

/**
 * GET /api/live/state
 * Retourne l'état temps réel pour l'onglet Live.
 */
router.get("/state", async (_req, res) => {
  try {
    return res.json({
      success: true,
      state: tiktokLiveService.getState(),
      events: tiktokLiveService.getRecentEvents(100),
    });
  } catch (e: any) {
    return res.status(500).json({
      error: String(e?.message || "Erreur interne"),
    });
  }
});

/**
 * POST /api/live/connect
 * Démarre la connexion à un live TikTok pour la boutique courante.
 */
router.post("/connect", async (req, res) => {
  try {
    const uniqueId = String(req.body?.uniqueId || "")
      .trim()
      .replace(/^@+/, "");
    const storeSlug = String(req.body?.storeSlug || "").trim();
    const roomId = String(req.body?.roomId || "")
      .trim()
      .replace(/\D+/g, "");
    if (!uniqueId) {
      return res.status(400).json({ error: "uniqueId requis" });
    }
    if (!storeSlug) {
      return res.status(400).json({ error: "storeSlug requis" });
    }
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id,slug")
      .eq("slug", storeSlug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message || "Erreur store" });
    }
    if (!store?.id) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    const state = await tiktokLiveService.connect({
      uniqueId,
      storeSlug: String(store.slug || storeSlug),
      storeId: Number(store.id),
      roomId: roomId || null,
    });
    return res.json({ success: true, state });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || "Erreur connect") });
  }
});

/**
 * POST /api/live/disconnect
 * Arrête explicitement la connexion live.
 */
router.post("/disconnect", async (_req, res) => {
  try {
    const state = await tiktokLiveService.disconnect();
    return res.json({ success: true, state });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || "Erreur disconnect") });
  }
});

/**
 * POST /api/live/parse-preview
 * Endpoint QA pour vérifier l'interprétation d'un message.
 */
router.post("/parse-preview", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "text requis" });
    }
    const parsed = await interpretOrderMessage(text);
    return res.json({ success: true, parsed });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || "Erreur parse-preview") });
  }
});

/**
 * POST /api/live/simulate-message
 * Simule un message live et exécute le même pipeline métier.
 */
router.post("/simulate-message", async (req, res) => {
  try {
    const storeSlug = String(req.body?.storeSlug || "").trim();
    const username = String(req.body?.username || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    const comment = String(req.body?.comment || "").trim();
    if (!storeSlug) {
      return res.status(400).json({ error: "storeSlug requis" });
    }
    if (!username) {
      return res.status(400).json({ error: "username requis" });
    }
    if (!comment) {
      return res.status(400).json({ error: "comment requis" });
    }
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .select("id,slug")
      .eq("slug", storeSlug)
      .maybeSingle();
    if (storeErr) {
      return res.status(500).json({ error: storeErr.message || "Erreur store" });
    }
    if (!store?.id) {
      return res.status(404).json({ error: "Boutique introuvable" });
    }

    tiktokLiveService.emitChatEvent({
      username,
      nickname: username,
      comment,
      raw: { simulated: true },
    });
    await processChatOrder({ username, comment }, Number(store.id));

    return res.json({
      success: true,
      storeId: Number(store.id),
      username,
      comment,
    });
  } catch (e: any) {
    return res
      .status(500)
      .json({ error: String(e?.message || "Erreur simulate-message") });
  }
});

/**
 * GET /api/live/events
 * Flux SSE pour l'UI dashboard live.
 */
router.get("/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (eventName: string, payload: unknown) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent("state", tiktokLiveService.getState());
  for (const event of tiktokLiveService.getRecentEvents(100)) {
    sendEvent("live", event);
  }

  const unsubscribe = tiktokLiveService.subscribe((event) => {
    sendEvent("live", event);
  });

  const heartbeat = setInterval(() => {
    sendEvent("ping", { ts: Date.now() });
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

export default router;
