import express from "express";
import { createClient } from "@supabase/supabase-js";
import { clerkClient, getAuth } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
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
const LIVE_EMAIL_HINT_TTL_MS = 6 * 60 * 60 * 1000;
const LIVE_EMAIL_HINT_MAX_ENTRIES = 5_000;
const liveEmailHints = new Map<string, { email: string; updatedAt: number }>();
const LIVE_ORDER_DEDUP_TTL_MS = 2_500;
const LIVE_ORDER_DEDUP_MAX_ENTRIES = 10_000;
const recentLiveOrderFingerprints = new Map<string, number>();

function normalizeTikTokUsername(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
}

function buildEmailHintKey(storeId: number, username: string): string {
  return `${storeId}:${normalizeTikTokUsername(username)}`;
}

function cleanupExpiredEmailHints(nowMs: number): void {
  for (const [key, entry] of liveEmailHints.entries()) {
    if (nowMs - Number(entry.updatedAt || 0) > LIVE_EMAIL_HINT_TTL_MS) {
      liveEmailHints.delete(key);
    }
  }
  // Pourquoi cette seconde borne:
  // même avec un TTL, un live très actif peut pousser beaucoup d'entrées
  // avant le prochain passage de nettoyage. On limite donc la mémoire.
  while (liveEmailHints.size > LIVE_EMAIL_HINT_MAX_ENTRIES) {
    const firstKey = liveEmailHints.keys().next().value;
    if (!firstKey) break;
    liveEmailHints.delete(firstKey);
  }
}

function rememberEmailHintForLiveOrder(storeId: number, username: string, email: string): void {
  const safeStoreId = Number(storeId);
  const safeUsername = normalizeTikTokUsername(username);
  const safeEmail = normalizeEmail(email);
  if (!Number.isFinite(safeStoreId) || safeStoreId <= 0 || !safeUsername || !safeEmail) return;
  const nowMs = Date.now();
  cleanupExpiredEmailHints(nowMs);
  liveEmailHints.set(buildEmailHintKey(safeStoreId, safeUsername), {
    email: safeEmail,
    updatedAt: nowMs,
  });
}

function getRememberedEmailHint(storeId: number, username: string): string | null {
  const safeStoreId = Number(storeId);
  const safeUsername = normalizeTikTokUsername(username);
  if (!Number.isFinite(safeStoreId) || safeStoreId <= 0 || !safeUsername) return null;
  const nowMs = Date.now();
  cleanupExpiredEmailHints(nowMs);
  const key = buildEmailHintKey(safeStoreId, safeUsername);
  const entry = liveEmailHints.get(key);
  if (!entry?.email) return null;
  if (nowMs - Number(entry.updatedAt || 0) > LIVE_EMAIL_HINT_TTL_MS) {
    liveEmailHints.delete(key);
    return null;
  }
  return entry.email;
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function cleanupRecentLiveOrderFingerprints(nowMs: number): void {
  for (const [key, ts] of recentLiveOrderFingerprints.entries()) {
    if (nowMs - Number(ts || 0) > LIVE_ORDER_DEDUP_TTL_MS) {
      recentLiveOrderFingerprints.delete(key);
    }
  }
  while (recentLiveOrderFingerprints.size > LIVE_ORDER_DEDUP_MAX_ENTRIES) {
    const firstKey = recentLiveOrderFingerprints.keys().next().value;
    if (!firstKey) break;
    recentLiveOrderFingerprints.delete(firstKey);
  }
}

function shouldSkipDuplicateLiveOrderEvent(input: {
  storeId: number;
  username: string;
  comment: string;
}): boolean {
  const storeId = Number(input.storeId);
  const username = normalizeTikTokUsername(input.username);
  const comment = String(input.comment || "").trim().toLowerCase();
  if (!Number.isFinite(storeId) || storeId <= 0 || !username || !comment) return false;
  const nowMs = Date.now();
  cleanupRecentLiveOrderFingerprints(nowMs);
  const fingerprint = `${storeId}|${username}|${comment}`;
  const previousTs = recentLiveOrderFingerprints.get(fingerprint);
  if (typeof previousTs === "number" && nowMs - previousTs <= LIVE_ORDER_DEDUP_TTL_MS) {
    return true;
  }
  recentLiveOrderFingerprints.set(fingerprint, nowMs);
  return false;
}

async function linkTikTokUsernameToClerkByEmail(input: {
  email: string;
  tiktokUsername: string;
}): Promise<{ success: boolean; reason: string; clerkUserId: string | null }> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedTikTokUsername = normalizeTikTokUsername(input.tiktokUsername);
  if (!normalizedEmail) {
    return {
      success: false,
      reason: "Email invalide",
      clerkUserId: null,
    };
  }
  if (!normalizedTikTokUsername) {
    return {
      success: false,
      reason: "Username TikTok invalide",
      clerkUserId: null,
    };
  }

  try {
    // Pourquoi cette recherche ciblée:
    // on évite de parcourir toute la base utilisateurs Clerk à chaque message live.
    const direct = await clerkClient.users.getUserList({
      emailAddress: [normalizedEmail],
      limit: 10,
    } as any);
    const directArr = ((direct as any)?.data || direct || []) as any[];
    let matchedUser = directArr.find((user: any) => {
      const emails = Array.isArray(user?.emailAddresses) ? user.emailAddresses : [];
      return emails.some(
        (entry: any) => normalizeEmail(entry?.emailAddress) === normalizedEmail,
      );
    });

    if (!matchedUser) {
      // Fallback défensif paginé:
      // si le filtre direct ne renvoie rien, on scanne par pages pour éviter
      // de rater l'utilisateur sur des instances Clerk volumineuses.
      const pageSize = 100;
      const maxScannedUsers = 3_000;
      let offset = 0;
      let scanned = 0;
      while (!matchedUser && scanned < maxScannedUsers) {
        const listed = await clerkClient.users.getUserList({
          limit: pageSize,
          offset,
        } as any);
        const users = ((listed as any)?.data || listed || []) as any[];
        if (!Array.isArray(users) || users.length === 0) break;
        scanned += users.length;
        matchedUser =
          users.find((user: any) => {
            const emails = Array.isArray(user?.emailAddresses) ? user.emailAddresses : [];
            return emails.some(
              (entry: any) => normalizeEmail(entry?.emailAddress) === normalizedEmail,
            );
          }) || null;
        if (matchedUser) break;
        if (users.length < pageSize) break;
        offset += users.length;
      }
    }

    if (!matchedUser?.id) {
      return {
        success: false,
        reason: "Aucun utilisateur Clerk trouvé pour cet email",
        clerkUserId: null,
      };
    }

    const existingPublicMetadata =
      matchedUser?.publicMetadata && typeof matchedUser.publicMetadata === "object"
        ? (matchedUser.publicMetadata as Record<string, unknown>)
        : {};
    await clerkClient.users.updateUserMetadata(String(matchedUser.id), {
      // Pourquoi merger explicitement:
      // on veut enrichir les metadata sans risquer d'écraser d'autres clés
      // comme stripe_id, préférences, etc.
      publicMetadata: {
        ...existingPublicMetadata,
        tiktok_username: normalizedTikTokUsername,
      },
    } as any);

    return {
      success: true,
      reason: "Metadata Clerk mise à jour",
      clerkUserId: String(matchedUser.id),
    };
  } catch (error: any) {
    return {
      success: false,
      reason: String(error?.message || "Erreur Clerk update metadata"),
      clerkUserId: null,
    };
  }
}

async function requireAuthorizedStore(
  req: express.Request,
  res: express.Response,
  storeSlugInput: unknown,
  options?: { allowQueryToken?: boolean },
): Promise<{ id: number; slug: string } | null> {
  const auth = getAuth(req);
  let authenticatedUserId = auth?.isAuthenticated && auth.userId ? String(auth.userId) : "";
  if (!authenticatedUserId && options?.allowQueryToken) {
    const queryTokenRaw = req.query?.authToken;
    const queryToken = Array.isArray(queryTokenRaw)
      ? String(queryTokenRaw[0] || "").trim()
      : String(queryTokenRaw || "").trim();
    if (queryToken) {
      try {
        const payload = await verifyToken(queryToken, {
          secretKey: process.env.CLERK_SECRET_KEY,
        });
        authenticatedUserId = String((payload as any)?.sub || "").trim();
      } catch {
        // Token invalide/expiré: on laisse la réponse Unauthorized ci-dessous.
      }
    }
  }
  if (!authenticatedUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const storeSlug = String(storeSlugInput || "").trim();
  if (!storeSlug) {
    res.status(400).json({ error: "storeSlug requis" });
    return null;
  }

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("id, slug, clerk_id, owner_email")
    .eq("slug", storeSlug)
    .maybeSingle();
  if (storeErr) {
    res.status(500).json({ error: storeErr.message || "Erreur store" });
    return null;
  }
  if (!storeRow?.id) {
    res.status(404).json({ error: "Boutique introuvable" });
    return null;
  }

  let authorized = Boolean(
    (storeRow as any)?.clerk_id &&
    String((storeRow as any).clerk_id) === String(authenticatedUserId),
  );

  if (!authorized) {
    try {
      const user = await clerkClient.users.getUser(authenticatedUserId);
      const ownerEmail = normalizeEmail((storeRow as any)?.owner_email);
      const userEmails = (Array.isArray((user as any)?.emailAddresses)
        ? (user as any).emailAddresses
        : []
      )
        .map((entry: any) => normalizeEmail(entry?.emailAddress))
        .filter(Boolean);
      if (ownerEmail && userEmails.includes(ownerEmail)) {
        authorized = true;
      }
    } catch {
      // Si Clerk échoue, on garde un refus explicite pour éviter toute fuite cross-tenant.
    }
  }

  if (!authorized) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return {
    id: Number((storeRow as any).id),
    slug: String((storeRow as any).slug || storeSlug),
  };
}

function buildScopedDisconnectedState(store: { id: number; slug: string }) {
  return {
    status: "disconnected" as const,
    uniqueId: null,
    roomId: null,
    lastError: null,
    reconnectAttempts: 0,
    messagePerMinute: 0,
    storeSlug: store.slug,
    storeId: store.id,
  };
}

async function processChatOrder(
  event: {
    username: string;
    comment: string;
  },
  storeId: number,
): Promise<void> {
  try {
    if (
      shouldSkipDuplicateLiveOrderEvent({
        storeId,
        username: event.username,
        comment: event.comment,
      })
    ) {
      return;
    }
    const parsedContact = parseContactFromRegex(event.comment);
    if (parsedContact.intent === "LINK_EMAIL" && parsedContact.email) {
      // Pourquoi on mémorise aussi localement:
      // le client peut envoyer son email AVANT sa commande. Dans ce cas, il n'existe
      // pas encore de ligne panier à mettre à jour immédiatement.
      rememberEmailHintForLiveOrder(storeId, event.username, parsedContact.email);
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

      const clerkLinked = await linkTikTokUsernameToClerkByEmail({
        email: parsedContact.email,
        tiktokUsername: event.username,
      });
      tiktokLiveService.emitSystemEvent(
        clerkLinked.success ? "email_linked" : "email_link_failed",
        {
          username: event.username,
          email: parsedContact.email,
          clerkUserId: clerkLinked.clerkUserId,
          reason: clerkLinked.reason,
          scope: "clerk_metadata",
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
    const rememberedEmail = getRememberedEmailHint(storeId, event.username);
    const result = await createOrUpdateCartFromLiveOrder({
      storeId,
      tiktokUsername: event.username,
      reference: interpreted.reference,
      quantity,
      sourceComment: event.comment,
      customerEmail: parsedContact.email || rememberedEmail,
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
    const store = await requireAuthorizedStore(_req, res, _req.query?.storeSlug);
    if (!store) return;
    const liveState = tiktokLiveService.getState();
    const isCurrentStoreSession = Number(liveState.storeId || 0) === store.id;
    const events = isCurrentStoreSession
      ? tiktokLiveService
        .getRecentEvents(100)
        .filter((event: any) => Number(event?.storeId || 0) === store.id)
      : [];
    return res.json({
      success: true,
      state: isCurrentStoreSession ? liveState : buildScopedDisconnectedState(store),
      events,
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
    const store = await requireAuthorizedStore(req, res, storeSlug);
    if (!store) return;

    const state = await tiktokLiveService.connect({
      uniqueId,
      storeSlug: store.slug,
      storeId: store.id,
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
    const store = await requireAuthorizedStore(_req, res, _req.body?.storeSlug);
    if (!store) return;
    const currentState = tiktokLiveService.getState();
    if (Number(currentState.storeId || 0) !== store.id) {
      return res.json({
        success: true,
        state: buildScopedDisconnectedState(store),
      });
    }
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
    const auth = getAuth(req);
    if (!auth?.isAuthenticated || !auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
 * GET /api/live/events
 * Flux SSE pour l'UI dashboard live.
 */
router.get("/events", async (req, res) => {
  const store = await requireAuthorizedStore(req, res, req.query?.storeSlug, {
    allowQueryToken: true,
  });
  if (!store) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (eventName: string, payload: unknown) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const currentState = tiktokLiveService.getState();
  const isCurrentStoreSession = Number(currentState.storeId || 0) === store.id;
  sendEvent("state", isCurrentStoreSession ? currentState : buildScopedDisconnectedState(store));
  if (isCurrentStoreSession) {
    for (const event of tiktokLiveService.getRecentEvents(100)) {
      if (Number((event as any)?.storeId || 0) !== store.id) continue;
      sendEvent("live", event);
    }
  }

  const unsubscribe = tiktokLiveService.subscribe((event) => {
    if (Number((event as any)?.storeId || 0) !== store.id) return;
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
