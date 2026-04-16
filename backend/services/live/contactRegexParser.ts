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

function parseObfuscatedEmailFromText(normalizedText: string): string | null {
  const text = String(normalizedText || "").trim();
  if (!text) return null;

  // Pourquoi ce fallback:
  // TikTok masque souvent les emails explicites dans le flux API.
  // On accepte donc une saisie anti-spam courante:
  // "prenom arobase gmail point com" / "prenom (at) gmail (dot) com".
  const containsObfuscatedHints =
    /\b(?:arobase|point|dot)\b/i.test(text) ||
    /\((?:at|dot)\)|\[(?:at|dot)\]|\{(?:at|dot)\}/i.test(text) ||
    /\bat\b/i.test(text);
  if (!containsObfuscatedHints) return null;

  const canonical = text
    .replace(/\((?:at)\)|\[(?:at)\]|\{(?:at)\}/gi, "@")
    .replace(/\((?:dot)\)|\[(?:dot)\]|\{(?:dot)\}/gi, ".")
    .replace(/\b(?:arobase)\b/gi, "@")
    .replace(/\bat\b/gi, "@")
    .replace(/\b(?:point|dot)\b/gi, ".")
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  const match = canonical.match(EMAIL_REGEX);
  const email = sanitizeEmailCandidate(String(match?.[1] || ""));
  return email || null;
}

function parseSpacedSymbolEmailFromText(normalizedText: string): string | null {
  const text = String(normalizedText || "").trim();
  if (!text) return null;
  if (!text.includes("@")) return null;

  // Pourquoi ce fallback:
  // certains messages live conservent les symboles email mais ajoutent des espaces
  // autour de "@" et "." (ex: "nom @ gmail . com").
  const compact = text
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  const match = compact.match(EMAIL_REGEX);
  const email = sanitizeEmailCandidate(String(match?.[1] || ""));
  return email || null;
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
  const directEmail = sanitizeEmailCandidate(String(emailMatch?.[1] || ""));
  const email =
    directEmail ||
    parseSpacedSymbolEmailFromText(normalizedText) ||
    parseObfuscatedEmailFromText(normalizedText);
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
