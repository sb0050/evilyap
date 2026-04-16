import { EventEmitter } from "events";
import {
  ControlEvent,
  SignConfig,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";

export type LiveStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export type LiveSystemEventName =
  | "connect_requested"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error"
  | "order_parsed"
  | "order_failed"
  | "email_linked"
  | "email_link_failed";

export type LiveEvent =
  | {
      id: number;
      type: "system";
      timestamp: string;
      storeSlug: string | null;
      storeId: number | null;
      event: LiveSystemEventName;
      payload?: Record<string, unknown>;
    }
  | {
      id: number;
      type: "chat";
      timestamp: string;
      storeSlug: string | null;
      storeId: number | null;
      username: string;
      nickname: string | null;
      comment: string;
      raw?: Record<string, unknown>;
    }
  | {
      id: number;
      type: "order";
      timestamp: string;
      storeSlug: string | null;
      storeId: number | null;
      username: string;
      comment: string;
      intent: string;
      reference: string | null;
      quantity: number | null;
      source: "regex" | "llm";
      success: boolean;
      reason: string;
      payload?: Record<string, unknown>;
    };

type LiveEventInput =
  | Omit<Extract<LiveEvent, { type: "system" }>, "id" | "timestamp" | "storeSlug" | "storeId">
  | Omit<Extract<LiveEvent, { type: "chat" }>, "id" | "timestamp" | "storeSlug" | "storeId">
  | Omit<Extract<LiveEvent, { type: "order" }>, "id" | "timestamp" | "storeSlug" | "storeId">;

export type LiveState = {
  status: LiveStatus;
  uniqueId: string | null;
  roomId: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  messagePerMinute: number;
  storeSlug: string | null;
  storeId: number | null;
};

type ConnectOptions = {
  uniqueId: string;
  storeSlug?: string | null;
  storeId?: number | null;
  roomId?: string | null;
};

type Subscriber = (event: LiveEvent) => void;
type ConnectProfile = {
  name: string;
  options: Record<string, unknown>;
};

/**
 * Service singleton qui encapsule la connexion TikTok LIVE.
 *
 * Pourquoi ce service existe:
 * - Le package `tiktok-live-connector` est stateful; l'encapsulation évite
 *   de dupliquer sa gestion de cycle de vie dans les routes.
 * - Le frontend a besoin d'un flux temps réel; on expose donc un bus
 *   d'événements interne exploitable en SSE.
 * - La logique de reconnexion doit être centralisée pour limiter les bugs
 *   de concurrence (double connexion, timers multiples, etc.).
 */
class TikTokLiveService {
  private connection: TikTokLiveConnection | null = null;
  private emitter = new EventEmitter();
  private status: LiveStatus = "disconnected";
  private uniqueId: string | null = null;
  private roomId: string | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = false;
  private manuallyDisconnected = false;
  private eventId = 0;
  private readonly maxBufferedEvents = 250;
  private bufferedEvents: LiveEvent[] = [];
  private messageTimestampsMs: number[] = [];
  private storeSlug: string | null = null;
  private storeId: number | null = null;
  private forcedRoomId: string | null = null;
  private connectionToken = 0;
  private readonly duplicateChatTtlMs = 8_000;
  private readonly duplicateChatMaxEntries = 5_000;
  private recentChatFingerprints = new Map<string, number>();

  private sanitizeUniqueId(value: string): string {
    return String(value || "")
      .trim()
      .replace(/^@+/, "");
  }

  private isRetryableConnectError(error: unknown): boolean {
    const raw = String((error as any)?.message || error || "")
      .trim()
      .toLowerCase();
    if (!raw) return false;
    return (
      raw.includes("status 429") ||
      raw.includes("rate limit") ||
      raw.includes("status 500") ||
      raw.includes("internal server error") ||
      raw.includes("sign error") ||
      raw.includes("fetch failed") ||
      raw.includes("etimedout") ||
      raw.includes("econnreset") ||
      raw.includes("econnrefused")
    );
  }

  private cleanupMessageRateWindow(nowMs: number): void {
    const oneMinuteAgo = nowMs - 60_000;
    this.messageTimestampsMs = this.messageTimestampsMs.filter((ts) => ts >= oneMinuteAgo);
  }

  private getMessagePerMinute(): number {
    this.cleanupMessageRateWindow(Date.now());
    return this.messageTimestampsMs.length;
  }

  private setStatus(nextStatus: LiveStatus): void {
    this.status = nextStatus;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupRecentChatFingerprints(nowMs: number): void {
    for (const [key, ts] of this.recentChatFingerprints.entries()) {
      if (nowMs - ts > this.duplicateChatTtlMs) {
        this.recentChatFingerprints.delete(key);
      }
    }
    while (this.recentChatFingerprints.size > this.duplicateChatMaxEntries) {
      const oldest = this.recentChatFingerprints.keys().next().value;
      if (!oldest) break;
      this.recentChatFingerprints.delete(oldest);
    }
  }

  private buildStableChatFingerprint(data: any, username: string, comment: string): string {
    const asString = (value: unknown): string => String(value ?? "").trim();
    const candidates = [
      asString(data?.msgId),
      asString(data?.messageId),
      asString(data?.eventId),
      asString(data?.logId),
      asString(data?.common?.msgId),
      asString(data?.common?.messageId),
    ].filter(Boolean);
    if (candidates.length > 0) {
      // Quand TikTok fournit un identifiant d'événement, on l'utilise
      // pour une déduplication exacte sans risquer de masquer un vrai
      // deuxième message utilisateur.
      return `id:${candidates[0]}`;
    }
    const userId = asString(data?.user?.userId);
    const createTime = asString(data?.createTime || data?.common?.createTime);
    const normalizedComment = String(comment || "").trim().toLowerCase();
    const stableSeed = [username, userId, createTime, normalizedComment]
      .filter(Boolean)
      .join("|");
    if (stableSeed) return `seed:${stableSeed}`;
    return `fallback:${username}|${normalizedComment}`;
  }

  private shouldDropDuplicateChat(data: any, username: string, comment: string): boolean {
    const nowMs = Date.now();
    this.cleanupRecentChatFingerprints(nowMs);
    const fingerprint = this.buildStableChatFingerprint(data, username, comment);
    if (!fingerprint) return false;
    const previousTs = this.recentChatFingerprints.get(fingerprint);
    if (typeof previousTs === "number" && nowMs - previousTs <= this.duplicateChatTtlMs) {
      return true;
    }
    this.recentChatFingerprints.set(fingerprint, nowMs);
    return false;
  }

  private pushEvent(event: LiveEventInput): LiveEvent {
    const fullEvent = {
      ...event,
      id: ++this.eventId,
      timestamp: new Date().toISOString(),
      storeSlug: this.storeSlug,
      storeId: this.storeId,
    } as LiveEvent;
    this.bufferedEvents.push(fullEvent);
    if (this.bufferedEvents.length > this.maxBufferedEvents) {
      this.bufferedEvents.shift();
    }
    this.emitter.emit("event", fullEvent);
    return fullEvent;
  }

  private attachConnectionListeners(conn: TikTokLiveConnection, token: number): void {
    conn.on(ControlEvent.CONNECTED, (state: any) => {
      if (token !== this.connectionToken) return;
      this.roomId = String(state?.roomId || "") || null;
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.pushEvent({
        type: "system",
        event: "connected",
        payload: {
          roomId: this.roomId,
          uniqueId: this.uniqueId,
          storeSlug: this.storeSlug,
          storeId: this.storeId,
        },
      });
    });

    conn.on(ControlEvent.DISCONNECTED, ({ code, reason }: any) => {
      if (token !== this.connectionToken) return;
      this.roomId = null;
      const reasonText = String(reason || "").trim() || null;
      this.setStatus(this.shouldReconnect ? "reconnecting" : "disconnected");
      this.pushEvent({
        type: "system",
        event: "disconnected",
        payload: { code, reason: reasonText, uniqueId: this.uniqueId },
      });
      if (this.shouldReconnect && !this.manuallyDisconnected && this.uniqueId) {
        this.scheduleReconnect();
      }
    });

    conn.on(ControlEvent.ERROR, (err: any) => {
      if (token !== this.connectionToken) return;
      const info = String(err?.info || "Erreur inconnue TikTok LIVE");
      const exception = String(err?.exception || "").trim();
      this.lastError = exception ? `${info}: ${exception}` : info;
      this.pushEvent({
        type: "system",
        event: "error",
        payload: {
          info,
          exception,
        },
      });
    });

    conn.on(WebcastEvent.CHAT, (data: any) => {
      if (token !== this.connectionToken) return;
      const comment = String(data?.comment || "").trim();
      if (!comment) return;
      const username = String(data?.user?.uniqueId || "").trim().toLowerCase();
      if (!username) return;
      if (this.shouldDropDuplicateChat(data, username, comment)) return;
      const nicknameRaw = String(data?.user?.nickname || "").trim();
      const nickname = nicknameRaw || null;
      const nowMs = Date.now();
      this.messageTimestampsMs.push(nowMs);
      this.cleanupMessageRateWindow(nowMs);
      this.pushEvent({
        type: "chat",
        username,
        nickname,
        comment,
        raw: {
          userId: data?.user?.userId,
          followRole: data?.user?.followRole,
        },
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.uniqueId) return;
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    const delayMs = Math.min(30_000, 2_000 * Math.max(1, attempt));
    this.setStatus("reconnecting");
    this.pushEvent({
      type: "system",
      event: "reconnecting",
      payload: { attempt, delayMs, uniqueId: this.uniqueId },
    });
    this.reconnectTimer = setTimeout(async () => {
      if (!this.shouldReconnect || !this.uniqueId) return;
      try {
        await this.connect({
          uniqueId: this.uniqueId,
          storeSlug: this.storeSlug,
          storeId: this.storeId,
          roomId: this.forcedRoomId,
        });
      } catch {
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  getState(): LiveState {
    return {
      status: this.status,
      uniqueId: this.uniqueId,
      roomId: this.roomId,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      messagePerMinute: this.getMessagePerMinute(),
      storeSlug: this.storeSlug,
      storeId: this.storeId,
    };
  }

  getRecentEvents(limit = 100): LiveEvent[] {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.bufferedEvents.slice(-safeLimit);
  }

  subscribe(listener: Subscriber): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  emitOrderEvent(
    event: Omit<Extract<LiveEvent, { type: "order" }>, "id" | "timestamp" | "storeSlug" | "storeId">,
  ): void {
    this.pushEvent(event);
  }

  emitChatEvent(event: {
    username: string;
    comment: string;
    nickname?: string | null;
    raw?: Record<string, unknown>;
  }): LiveEvent | null {
    const comment = String(event.comment || "").trim();
    const username = String(event.username || "")
      .trim()
      .toLowerCase()
      .replace(/^@+/, "");
    if (!comment || !username) return null;
    const nowMs = Date.now();
    this.messageTimestampsMs.push(nowMs);
    this.cleanupMessageRateWindow(nowMs);
    return this.pushEvent({
      type: "chat",
      username,
      nickname:
        typeof event.nickname === "string" && event.nickname.trim()
          ? event.nickname.trim()
          : null,
      comment,
      raw: event.raw,
    });
  }

  emitSystemEvent(
    event: LiveSystemEventName,
    payload?: Record<string, unknown>,
  ): void {
    this.pushEvent({
      type: "system",
      event,
      payload,
    });
  }

  async connect({ uniqueId, storeSlug, storeId, roomId }: ConnectOptions): Promise<LiveState> {
    const normalizedUniqueId = this.sanitizeUniqueId(uniqueId);
    if (!normalizedUniqueId) {
      throw new Error("Le username TikTok est requis");
    }
    this.uniqueId = normalizedUniqueId;
    this.storeSlug = storeSlug ? String(storeSlug).trim() : null;
    this.storeId = Number.isFinite(Number(storeId)) ? Number(storeId) : null;
    this.manuallyDisconnected = false;
    this.shouldReconnect = true;
    this.lastError = null;
    this.clearReconnectTimer();
    this.setStatus("connecting");
    const roomIdInput = String(roomId || "")
      .trim()
      .replace(/\D+/g, "");
    this.forcedRoomId = roomIdInput || null;

    this.emitSystemEvent("connect_requested", {
      uniqueId: this.uniqueId,
      storeSlug: this.storeSlug,
      storeId: this.storeId,
      roomId: this.forcedRoomId,
    });

    if (this.connection) {
      try {
        this.connection.disconnect();
      } catch {
        // best effort
      }
      this.connection = null;
    }

    const signApiKey = String(
      process.env.TIKTOK_SIGN_API_KEY || process.env.EULER_SIGN_API_KEY || "",
    ).trim();
    const signBasePath = String(
      process.env.TIKTOK_SIGN_BASE_PATH || process.env.EULER_SIGN_BASE_PATH || "",
    ).trim();
    const useUniqueIdSigning =
      String(process.env.TIKTOK_CONNECT_WITH_UNIQUE_ID || "")
        .trim()
        .toLowerCase() === "true";
    const disableEulerFallbacks =
      String(process.env.TIKTOK_DISABLE_EULER_FALLBACKS || "false")
        .trim()
        .toLowerCase() === "true";
    const fetchRoomInfoOnConnect =
      String(process.env.TIKTOK_FETCH_ROOM_INFO_ON_CONNECT || "true")
        .trim()
        .toLowerCase() === "true";
    const processInitialData =
      String(process.env.TIKTOK_PROCESS_INITIAL_DATA || "false")
        .trim()
        .toLowerCase() === "true";
    // Pourquoi config globale + option locale:
    // Selon les versions du connecteur, certaines routes lisent SignConfig,
    // d'autres lisent directement l'option `signApiKey`.
    if (signApiKey) {
      SignConfig.apiKey = signApiKey as any;
    }
    if (signBasePath) {
      SignConfig.basePath = signBasePath as any;
    }

    const connectProfiles: ConnectProfile[] = [
      {
        name: "primary",
        options: {
          processInitialData,
          fetchRoomInfoOnConnect,
          requestPollingIntervalMs: 1_500,
          // Pourquoi cette option:
          // Sans API key, le service de signature public est rapidement rate-limité
          // en environnement de dev. Une clé Euler lève ce blocage.
          signApiKey: signApiKey || undefined,
          // Attention: `connectWithUniqueId` est une feature Pro côté Euler.
          // On la garde désactivée par défaut pour rester compatible plan gratuit.
          connectWithUniqueId: useUniqueIdSigning,
          // En pratique, beaucoup de comptes dev nécessitent le fallback Euler.
          // Le bool reste configurable via .env pour les environnements verrouillés.
          disableEulerFallbacks,
        },
      },
    ];

    if (!signApiKey) {
      // Fallback sans optimisation: on laisse le connector choisir ses defaults
      // pour maximiser les chances de connexion en local.
      connectProfiles.push({
        name: "no_sign_defaults",
        options: {
          processInitialData,
          fetchRoomInfoOnConnect,
          requestPollingIntervalMs: 1_500,
          disableEulerFallbacks: false,
        },
      });
    }

    const maxAttemptsRaw = Number(process.env.TIKTOK_CONNECT_RETRY_MAX || 3);
    const maxAttemptsPerProfile =
      Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0
        ? Math.min(5, Math.floor(maxAttemptsRaw))
        : 3;

    let lastError: unknown = null;
    for (const profile of connectProfiles) {
      for (let attempt = 1; attempt <= maxAttemptsPerProfile; attempt += 1) {
        const conn = new TikTokLiveConnection(normalizedUniqueId, profile.options as any);
        const token = ++this.connectionToken;
        this.connection = conn;
        this.attachConnectionListeners(conn, token);

        this.emitSystemEvent("reconnecting", {
          profile: profile.name,
          attempt,
          maxAttempts: maxAttemptsPerProfile,
          roomId: this.forcedRoomId,
        });

        try {
          if (roomIdInput) {
            await conn.connect(roomIdInput as any);
          } else {
            await conn.connect();
          }
          return this.getState();
        } catch (err: any) {
          lastError = err;
          const retryable = this.isRetryableConnectError(err);
          this.emitSystemEvent("error", {
            scope: "connect_retry",
            profile: profile.name,
            attempt,
            maxAttempts: maxAttemptsPerProfile,
            message: String(err?.message || "Erreur connexion live"),
            retryable,
          });

          try {
            conn.disconnect();
          } catch {
            // best effort
          } finally {
            if (this.connection === conn) this.connection = null;
          }

          if (!retryable || attempt >= maxAttemptsPerProfile) {
            break;
          }

          const delayMs = 1_500 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const finalMessage = String(
      (lastError as any)?.message || "Échec de connexion TikTok LIVE",
    );
    this.lastError = finalMessage;
    this.setStatus("disconnected");
    throw new Error(finalMessage);
  }

  async disconnect(): Promise<LiveState> {
    this.shouldReconnect = false;
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    if (this.connection) {
      try {
        this.connection.disconnect();
      } catch {
        // best effort
      }
    }
    this.connection = null;
    this.roomId = null;
    this.forcedRoomId = null;
    this.setStatus("disconnected");
    this.emitSystemEvent("disconnected", {
      manual: true,
      uniqueId: this.uniqueId,
      storeSlug: this.storeSlug,
      storeId: this.storeId,
    });
    return this.getState();
  }
}

export const tiktokLiveService = new TikTokLiveService();
