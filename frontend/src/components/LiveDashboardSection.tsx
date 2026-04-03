import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Radio, RefreshCw, Square } from "lucide-react";
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

export default function LiveDashboardSection({
  storeSlug,
  onToast,
}: LiveDashboardSectionProps) {
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
  const [isSimulating, setIsSimulating] = useState(false);
  const [simUsername, setSimUsername] = useState("");
  const [simComment, setSimComment] = useState("");
  const [liveCarts, setLiveCarts] = useState<StoreCartItem[]>([]);
  const [isLoadingLiveCarts, setIsLoadingLiveCarts] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const sortedChatEvents = useMemo(() => {
    // Le panneau "Flux du chat" ne doit afficher que les messages utilisateur
    // pour éviter de mélanger des logs système/opérationnels avec la conversation live.
    return [...events]
      .filter((event) => event.type === "chat")
      .sort((a, b) => b.id - a.id)
      .slice(0, 80);
  }, [events]);

  const loadLiveCarts = async () => {
    if (!storeSlug) return;
    try {
      setIsLoadingLiveCarts(true);
      const resp = await apiGet(`/api/carts/store/${encodeURIComponent(storeSlug)}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Erreur chargement paniers live");
      }
      const carts = Array.isArray(json?.carts) ? (json.carts as StoreCartItem[]) : [];
      const liveOnly = carts.filter((c) =>
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
    try {
      const resp = await apiGet("/api/live/state");
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

  const closeEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const openEventSource = () => {
    closeEventSource();
    const es = new EventSource(`${API_BASE_URL}/api/live/events`);
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
      // Pas de toast ici: EventSource gère déjà sa reconnexion.
    };
    eventSourceRef.current = es;
  };

  const handleConnect = async () => {
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
      const resp = await apiPost("/api/live/connect", {
        uniqueId,
        storeSlug,
        roomId: String(liveRoomId || "")
          .trim()
          .replace(/\D+/g, ""),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Connexion live impossible");
      }
      setState((json?.state || state) as LiveState);
      onToast("Connexion TikTok en cours", "success");
      openEventSource();
      await loadState();
    } catch (e: any) {
      onToast(e?.message || "Erreur de connexion live", "error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      const resp = await apiPost("/api/live/disconnect", {});
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

  const handleSimulate = async () => {
    if (!storeSlug) {
      onToast("La boutique est introuvable", "error");
      return;
    }
    const username = String(simUsername || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
    const comment = String(simComment || "").trim();
    if (!username) {
      onToast("Username requis", "error");
      return;
    }
    if (!comment) {
      onToast("Message requis", "error");
      return;
    }
    try {
      setIsSimulating(true);
      const resp = await apiPost("/api/live/simulate-message", {
        storeSlug,
        username,
        comment,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json?.error || "Simulation impossible");
      }
      onToast("Message simulé envoyé", "success");
      await loadState();
      await loadLiveCarts();
    } catch (e: any) {
      onToast(e?.message || "Erreur simulation live", "error");
    } finally {
      setIsSimulating(false);
    }
  };

  useEffect(() => {
    loadState();
    openEventSource();
    return () => {
      closeEventSource();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeSlug) return;
    loadLiveCarts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlug]);

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

      <div className="rounded-md border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Simulation live</h3>
        <p className="text-xs text-gray-500">
          Simule un message d&apos;achat pour tester l&apos;ajout panier en temps réel.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={simUsername}
              onChange={(e) => setSimUsername(e.target.value)}
              placeholder="client_test"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-7">
            <label className="block text-xs font-medium text-gray-700 mb-1">Message chat</label>
            <input
              type="text"
              value={simComment}
              onChange={(e) => setSimComment(e.target.value)}
              placeholder="je prends ref AB12 x2"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2">
            <button
              onClick={handleSimulate}
              disabled={isSimulating || !storeSlug}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-md text-white ${
                isSimulating || !storeSlug
                  ? "bg-indigo-300"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {isSimulating ? "Simulation..." : "Simuler"}
            </button>
          </div>
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
