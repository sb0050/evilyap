export type ParsedContactIntent = "LINK_EMAIL" | "UNKNOWN";

export type ParsedContact = {
  intent: ParsedContactIntent;
  email: string | null;
  confidence: number;
  reason: string;
  normalizedText: string;
};

/**
 * Pourquoi cette regex:
 * - couvre les emails courants saisis rapidement en live,
 * - impose au moins un point dans le domaine pour limiter les faux positifs,
 * - reste suffisamment simple pour un parsing temps réel robuste.
 */
const EMAIL_REGEX =
  /\b([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/i;

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sanitizeEmailCandidate(rawEmail: string): string {
  return String(rawEmail || "")
    .trim()
    .replace(/^[<(\["']+/, "")
    .replace(/[>)\]"',;:!?]+$/, "")
    .toLowerCase();
}

/**
 * Détecte un email dans un message de chat live pour associer
 * l'identité TikTok au contact email du client.
 */
export function parseContactFromRegex(inputText: string): ParsedContact {
  const normalizedText = normalizeText(inputText);
  if (!normalizedText) {
    return {
      intent: "UNKNOWN",
      email: null,
      confidence: 0,
      reason: "Message vide",
      normalizedText,
    };
  }

  const emailMatch = normalizedText.match(EMAIL_REGEX);
  const email = sanitizeEmailCandidate(String(emailMatch?.[1] || ""));
  if (!email) {
    return {
      intent: "UNKNOWN",
      email: null,
      confidence: 0.03,
      reason: "Aucun email détecté",
      normalizedText,
    };
  }

  return {
    intent: "LINK_EMAIL",
    email,
    confidence: 0.95,
    reason: "Email détecté pour liaison TikTok",
    normalizedText,
  };
}
