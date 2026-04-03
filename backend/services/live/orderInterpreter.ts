import fetch from "node-fetch";
import { parseOrderFromRegex, type ParsedOrder } from "./orderRegexParser";

export type InterpretedOrder = ParsedOrder & {
  source: "regex" | "llm";
};

type OllamaResponse = {
  response?: string;
};

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Certains modèles ajoutent du texte autour du JSON; on isole le bloc principal.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const slice = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNullableUpperString(value: unknown): string | null {
  const str = String(value ?? "")
    .trim()
    .toUpperCase();
  return str || null;
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

/**
 * Interpréteur hybride:
 * 1) Regex déterministe (rapide / fiable),
 * 2) LLM en fallback uniquement si ambigu.
 */
export async function interpretOrderMessage(text: string): Promise<InterpretedOrder> {
  const regexParsed = parseOrderFromRegex(text);
  if (regexParsed.intent === "ADD_TO_CART" && (regexParsed.confidence >= 0.75 || regexParsed.reference)) {
    return {
      ...regexParsed,
      source: "regex",
    };
  }

  const model = String(process.env.OLLAMA_MODEL || "qwen3.5:9b").trim();
  const baseUrl = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434")
    .trim()
    .replace(/\/+$/, "");
  const timeoutMsRaw = Number(process.env.OLLAMA_TIMEOUT_MS || 2200);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(800, timeoutMsRaw) : 2200;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const prompt = [
    "Tu es un parser de commandes Live Shopping en français.",
    "Retourne UNIQUEMENT un JSON valide sans texte autour.",
    "Schema:",
    "{",
    '  "intent": "ADD_TO_CART" | "UNKNOWN",',
    '  "reference": string|null,',
    '  "quantity": number|null,',
    '  "variant": string|null,',
    '  "confidence": number,',
    '  "reason": string',
    "}",
    "Règles:",
    "- Si une référence produit n'est pas identifiable, mets intent=UNKNOWN.",
    "- quantity doit être > 0 si présent.",
    `Message: """${String(text || "").trim()}"""`,
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.1 },
        prompt,
      }),
      signal: controller.signal as any,
    });
    if (!response.ok) {
      throw new Error(`Erreur Ollama HTTP ${response.status}`);
    }
    const json = (await response.json()) as OllamaResponse;
    const parsed = parseJsonObject(String(json?.response || ""));
    if (!parsed) {
      throw new Error("Réponse LLM non-JSON");
    }

    const intentRaw = String(parsed.intent || "")
      .trim()
      .toUpperCase();
    const interpreted: InterpretedOrder = {
      intent: intentRaw === "ADD_TO_CART" ? "ADD_TO_CART" : "UNKNOWN",
      reference: toNullableUpperString(parsed.reference),
      quantity: toNumberOrNull(parsed.quantity),
      variant: parsed.variant ? String(parsed.variant).trim() : null,
      confidence: normalizeConfidence(parsed.confidence),
      reason:
        String(parsed.reason || "").trim() || "Interprétation LLM",
      triggerMatched: regexParsed.triggerMatched,
      normalizedText: regexParsed.normalizedText,
      source: "llm",
    };

    if (interpreted.intent === "ADD_TO_CART" && interpreted.reference) {
      return interpreted;
    }
    return {
      ...regexParsed,
      intent: "UNKNOWN",
      reason: interpreted.reason || "Message ambigu après LLM",
      source: "llm",
    };
  } catch (error: any) {
    return {
      ...regexParsed,
      source: "regex",
      reason: `Fallback regex: ${String(error?.message || "LLM indisponible")}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
