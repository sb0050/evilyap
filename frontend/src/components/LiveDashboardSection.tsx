import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Activity, Check, Copy, Radio, RefreshCw, Square } from "lucide-react";
import { API_BASE_URL, apiGet, apiPost } from "../utils/api";

type LiveStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

type LiveState = {
  status: LiveStatus;
  uniqueId: string | null;
  roomId: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  messagePerMinute: number;
  storeSlug: string | null;
  storeId: number | null;
};

type LiveEvent = {
  id: number;
  type: "system" | "chat" | "order";
  timestamp: string;
  [key: string]: any;
};

type LiveDashboardSectionProps = {
  storeSlug: string | null;
  onToast: (message: string, type?: "success" | "error" | "info") => void;
};

type StoreCartItem = {
  id: number;
  customer_stripe_id?: string | null;
  payment_id?: string | null;
  product_reference?: string | null;
  quantity?: number | null;
  value?: number | null;
  description?: string | null;
  created_at?: string | null;
};

function extractTikTokUsernameFromDescription(description: string | null | undefined): string | null {
  const raw = String(description || "");
  const match = raw.match(/commande\s+tiktok\s+@([a-z0-9._-]+)/i);
  if (!match?.[1]) return null;
  return `@${match[1]}`;
}

const statusBadgeClass: Record<LiveStatus, string> = {
  disconnected: "bg-gray-100 text-gray-700",
  connecting: "bg-yellow-100 text-yellow-700",
  connected: "bg-green-100 text-green-700",
  reconnecting: "bg-orange-100 text-orange-700",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeBaseUrl(raw?: string): string {
  const val = String(raw || "").trim();
  if (!val) return "http://localhost:3000";
  if (/^https?:\/\//i.test(val)) return val.replace(/\/+$/, "");
  const isLocal = /^(localhost|127\.0\.0\.1)/i.test(val);
  const defaultScheme = isLocal ? "http" : "https";
  return `${defaultScheme}://${val}`.replace(/\/+$/, "");
}

function getClientBaseUrl(): string {
  const env = (import.meta as any)?.env || {};
  const vercelEnv = String(env.VERCEL_ENV || env.VITE_VERCEL_ENV || "")
    .toLowerCase()
    .trim();
  if (vercelEnv === "prod") return "https://paylive.cc";
  if (vercelEnv === "preview") return "https://preview-paylive.vercel.app";
  const fromEnv = String(env.VITE_CLIENT_URL || "").trim();
  if (fromEnv) return normalizeBaseUrl(fromEnv);
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalizeBaseUrl(window.location.origin);
  }
  return "http://localhost:3000";
}

async function copyTextToClipboard(text: string): Promise<void> {
  const value = String(text || "").trim();
  if (!value) throw new Error("Texte vide");

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Copie indisponible dans cet environnement");
  }

  // Fallback pour les navigateurs/environnements qui bloquent l'API Clipboard.
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("Impossible de copier le lien");
}

export default function LiveDashboardSection({
  storeSlug,
  onToast,
}: LiveDashboardSectionProps) {
  const { getToken, isLoaded } = useAuth();
  const [liveUsername, setLiveUsername] = useState("");
  const [liveRoomId, setLiveRoomId] = useState("");
  const [state, setState] = useState<LiveState>({
    status: "disconnected",
    uniqueId: null,
    roomId: null,
    lastError: null,
    reconnectAttempts: 0,
    messagePerMinute: 0,
    storeSlug: null,
    storeId: null,
  });
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isBioLinkCopied, setIsBioLinkCopied] = useState(false);
  const [liveCarts, setLiveCarts] = useState<StoreCartItem[]>([]);
  const [isLoadingLiveCarts, setIsLoadingLiveCarts] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventSourceUrlRef = useRef<string | null>(null);
  const eventSourceOpenAttemptRef = useRef(0);

  const sortedChatEvents = useMemo(() => {
    // Le panneau "Flux du chat" ne doit afficher que les messages utilisateur
    // pour éviter de mélanger des logs système/opérationnels avec la conversation live.
    return [...events]
      .filter((event) => event.type === "chat")
      .sort((a, b) => b.id - a.id)
      .slice(0, 80);
  }, [events]);

  const tiktokBioCheckoutUrl = useMemo(() => {
    if (!storeSlug) return "";
    return `${getClientBaseUrl()}/checkout/${encodeURIComponent(storeSlug)}?tiktok=true`;
  }, [storeSlug]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (!isLoaded) {
      throw new Error("Chargement de la session en cours, réessaie dans quelques secondes.");
    }
    const token = await getToken();
    if (!token) {
      throw new Error("Session expirée. Merci de vous reconnecter.");
    }
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  const loadLiveCarts = async () => {
    if (!storeSlug) return;
    if (!isLoaded) return;
    try {
      setIsLoadingLiveCarts(true);
      const headers = await getAuthHeaders();
      const resp = await apiGet(`/api/carts/store/${encodeURIComponent(storeSlug)}`, { headers });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Erreur chargement paniers live");
      }
      const carts = Array.isArray(json?.carts) ? (json.carts as StoreCartItem[]) : [];
      const liveOnly = carts.filter((c) =>
        !String(c?.payment_id || "").trim() &&
        String(c?.description || "").toLowerCase().includes("commande tiktok @")
      );
      setLiveCarts(liveOnly.slice(0, 20));
    } catch (e: any) {
      onToast(e?.message || "Erreur paniers live", "error");
    } finally {
      setIsLoadingLiveCarts(false);
    }
  };

  const loadState = async () => {
    if (!isLoaded) return;
    if (!storeSlug) {
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        uniqueId: null,
        roomId: null,
        messagePerMinute: 0,
        reconnectAttempts: 0,
      }));
      setEvents([]);
      return;
    }
    try {
      const headers = await getAuthHeaders();
      const resp = await apiGet(`/api/live/state?storeSlug=${encodeURIComponent(storeSlug)}`, {
        headers,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Erreur chargement état live");
      }
      const nextState = (json?.state || {}) as LiveState;
      setState(nextState);
      if (nextState?.uniqueId) {
        setLiveUsername(nextState.uniqueId);
      }
      if (nextState?.roomId) {
        setLiveRoomId(String(nextState.roomId));
      }
      if (Array.isArray(json?.events)) {
        setEvents(json.events as LiveEvent[]);
      }
      await loadLiveCarts();
    } catch (e: any) {
      onToast(e?.message || "Erreur live/state", "error");
    }
  };

  const closeEventSource = (invalidatePending = true) => {
    if (invalidatePending) {
      eventSourceOpenAttemptRef.current += 1;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      eventSourceUrlRef.current = null;
    }
  };

  const openEventSource = async () => {
    const attemptId = eventSourceOpenAttemptRef.current + 1;
    eventSourceOpenAttemptRef.current = attemptId;
    closeEventSource(false);
    if (!storeSlug || !isLoaded) return;
    const token = await getToken().catch(() => null);
    if (attemptId !== eventSourceOpenAttemptRef.current) return;
    if (!token) return;
    const url = `${API_BASE_URL}/api/live/events?storeSlug=${encodeURIComponent(storeSlug)}&authToken=${encodeURIComponent(token)}`;
    // Pourquoi ce garde-fou:
    // en dev (React StrictMode) et/ou via plusieurs hooks, on peut ouvrir plusieurs
    // connexions SSE. Chaque connexion pousse le même événement, d'où les doublons.
    if (eventSourceRef.current && eventSourceUrlRef.current === url) return;
    const es = new EventSource(url);
    if (attemptId !== eventSourceOpenAttemptRef.current) {
      es.close();
      return;
    }
    es.addEventListener("state", (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data || "{}");
        setState(parsed as LiveState);
      } catch {
        // ignore malformed packet
      }
    });
    es.addEventListener("live", (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(evt.data || "{}") as LiveEvent;
        if (!parsed || typeof parsed.id !== "number") return;
        setEvents((prev) => {
          // Pourquoi dédupliquer: l'initial sync SSE envoie l'historique.
          if (prev.some((item) => item.id === parsed.id)) return prev;
          const next = [...prev, parsed];
          return next.slice(-250);
        });
      } catch {
        // ignore malformed packet
      }
    });
    es.onerror = () => {
      // Si le stream est coupé, EventSource va tenter de se reconnecter.
      // On n'affiche pas de toast bruité ici.
    };
    eventSourceRef.current = es;
    eventSourceUrlRef.current = url;
  };

  const handleConnect = async () => {
    if (!isLoaded) {
      onToast("Session en cours de chargement, réessaie dans quelques secondes.", "info");
      return;
    }
    const uniqueId = String(liveUsername || "")
      .trim()
      .replace(/^@+/, "");
    if (!uniqueId) {
      onToast("Le username TikTok est requis", "error");
      return;
    }
    if (!storeSlug) {
      onToast("La boutique est introuvable, impossible de connecter le live", "error");
      return;
    }
    try {
      setIsConnecting(true);
      const headers = await getAuthHeaders();
      const resp = await apiPost("/api/live/connect", {
        uniqueId,
        storeSlug,
        roomId: String(liveRoomId || "")
          .trim()
          .replace(/\D+/g, ""),
      }, { headers });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Connexion live impossible");
      }
      setState((json?.state || state) as LiveState);
      onToast("Connexion TikTok en cours", "success");
      // Le SSE est géré par un effet dédié pour éviter les connexions en double.
      await loadState();
    } catch (e: any) {
      onToast(e?.message || "Erreur de connexion live", "error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!isLoaded) {
      onToast("Session en cours de chargement, réessaie dans quelques secondes.", "info");
      return;
    }
    if (!storeSlug) {
      onToast("La boutique est introuvable, impossible de déconnecter le live", "error");
      return;
    }
    try {
      setIsDisconnecting(true);
      const headers = await getAuthHeaders();
      const resp = await apiPost("/api/live/disconnect", { storeSlug }, { headers });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Déconnexion live impossible");
      }
      setState((json?.state || state) as LiveState);
      onToast("Live déconnecté", "success");
      await loadState();
    } catch (e: any) {
      onToast(e?.message || "Erreur de déconnexion live", "error");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCopyBioLink = async () => {
    if (!tiktokBioCheckoutUrl) {
      onToast("Lien checkout indisponible: slug boutique manquant", "error");
      return;
    }
    try {
      await copyTextToClipboard(tiktokBioCheckoutUrl);
      setIsBioLinkCopied(true);
      onToast("Lien bio TikTok copié", "success");
      setTimeout(() => {
        setIsBioLinkCopied(false);
      }, 2000);
    } catch (e: any) {
      onToast(e?.message || "Impossible de copier le lien", "error");
    }
  };

  useEffect(() => {
    // Source unique de vérité: on (ré)ouvre le SSE uniquement quand la boutique change
    // et que la session Clerk est prête.
    loadState();
    void openEventSource();
    if (storeSlug) {
      loadLiveCarts();
    }
    return () => {
      closeEventSource();
    };
  }, [storeSlug, isLoaded]);

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Live TikTok</h2>
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadgeClass[state.status]}`}
          >
            {state.status}
          </span>
        </div>
        <button
          onClick={loadState}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm border border-gray-200 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Actualiser
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Username TikTok</p>
          <p className="text-sm font-medium text-gray-900">{state.uniqueId || "—"}</p>
        </div>
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Messages / minute</p>
          <p className="text-sm font-medium text-gray-900">{state.messagePerMinute || 0}</p>
        </div>
        <div className="rounded-md border border-gray-200 p-3">
          <p className="text-xs text-gray-500">Tentatives reconnexion</p>
          <p className="text-sm font-medium text-gray-900">{state.reconnectAttempts || 0}</p>
        </div>
      </div>

      <div className="rounded-md border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Lien bio TikTok</h3>
        <p className="text-xs text-gray-600">
          Copie ce lien dans la bio TikTok pour rediriger les acheteurs vers le checkout live.
        </p>
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <input
            type="text"
            readOnly
            value={tiktokBioCheckoutUrl}
            className="w-full border border-indigo-100 rounded-md px-3 py-2 text-sm text-gray-700 bg-white"
            placeholder="Lien indisponible tant que la boutique n'est pas chargée"
          />
          <button
            type="button"
            onClick={handleCopyBioLink}
            disabled={!tiktokBioCheckoutUrl}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md text-white ${
              !tiktokBioCheckoutUrl
                ? "bg-gray-300 cursor-not-allowed"
                : isBioLinkCopied
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {isBioLinkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {isBioLinkCopied ? "Copié" : "Copier le lien"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Compte TikTok live</label>
          <input
            type="text"
            value={liveUsername}
            onChange={(e) => setLiveUsername(e.target.value)}
            placeholder="@moncompte"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Room ID (optionnel)
          </label>
          <input
            type="text"
            value={liveRoomId}
            onChange={(e) => setLiveRoomId(e.target.value)}
            placeholder="ex: 752364918..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-3 flex gap-2">
        <button
          onClick={handleConnect}
          disabled={isConnecting || !storeSlug}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md text-white ${
            isConnecting || !storeSlug ? "bg-indigo-300" : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          <Activity className="w-4 h-4" />
          {isConnecting ? "Connexion..." : "Connecter"}
        </button>
        <button
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md text-white ${
            isDisconnecting ? "bg-gray-300" : "bg-gray-700 hover:bg-gray-800"
          }`}
        >
          <Square className="w-4 h-4" />
          {isDisconnecting ? "Déconnexion..." : "Déconnecter"}
        </button>
        </div>
      </div>

      {state.lastError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.lastError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900">Flux chat live</h3>
          <div className="max-h-[420px] overflow-auto border border-gray-200 rounded-md">
            {sortedChatEvents.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                Aucun message de chat live pour le moment.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {sortedChatEvents.map((evt) => (
                  <li key={evt.id} className="p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">Chat</span>
                      <span className="text-xs text-gray-500">{formatTimestamp(evt.timestamp)}</span>
                    </div>
                    <p className="text-gray-700 mt-1">
                      <span className="font-medium">@{evt.username}</span>: {evt.comment}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Panier live</h3>
            <button
              onClick={loadLiveCarts}
              className="text-xs text-indigo-600 hover:text-indigo-700"
            >
              Actualiser
            </button>
          </div>
          <div className="max-h-[420px] overflow-auto border border-gray-200 rounded-md">
            {isLoadingLiveCarts ? (
              <div className="p-4 text-sm text-gray-500">Chargement...</div>
            ) : liveCarts.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                Aucun article live dans le panier pour le moment.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {liveCarts.map((item) => {
                  const tiktokUsername = extractTikTokUsernameFromDescription(item.description);
                  return (
                    <li key={item.id} className="p-3 text-sm">
                      {tiktokUsername ? (
                        <p className="text-xs font-semibold text-indigo-700">{tiktokUsername}</p>
                      ) : null}
                      <p className="font-medium text-gray-900">
                        {item.product_reference || "Référence inconnue"}
                      </p>
                      <p className="text-gray-600">
                        Qté: {Number(item.quantity || 1)} - Prix:{" "}
                        {Number(item.value || 0).toFixed(2)} €
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {item.description || ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
