export type ParsedOrderIntent = "ADD_TO_CART" | "UNKNOWN";

export type ParsedOrder = {
  intent: ParsedOrderIntent;
  reference: string | null;
  quantity: number | null;
  variant: string | null;
  confidence: number;
  reason: string;
  triggerMatched: string | null;
  normalizedText: string;
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
};

const ORDER_VERB_FRAGMENT =
  "(?:je\\s+(?:prends?|veux|voudrais|souhaite|commande)|j[' ]?(?:achete|prends?|veux|commande)|prends?\\s+moi|ajoute(?:r|z)?|met(?:s|tez)?|commande(?:r|z)?|reserve(?:r|z)?|envoie(?:r|z)?|donne(?:s|z)?|passe(?:r|z)?)";

const PURCHASE_TRIGGERS: Array<{ label: string; regex: RegExp }> = [
  { label: "je_prends", regex: /\bje\s+prends?\b/i },
  { label: "j_achete", regex: /\bj['’]?\s*ach(?:e|è)te(?:s)?\b/i },
  { label: "ajoute", regex: /\bajoute(?:r|z)?\b/i },
  { label: "prends_moi", regex: /\bprends?\s+moi\b/i },
  { label: "je_veux", regex: /\bje\s+veux\b/i },
  { label: "je_voudrais", regex: /\bje\s+voudrais\b/i },
  { label: "je_souhaite", regex: /\bje\s+souhaite\b/i },
  { label: "je_commande", regex: /\bje\s+commande\b/i },
  { label: "mets", regex: /\bmet(?:s|tez)\b/i },
  { label: "commande", regex: /\bcommande(?:r|z)?\b/i },
  { label: "reserve", regex: /\breserve(?:r|z)?\b/i },
  { label: "passe", regex: /\bpasse(?:r|z)?\b/i },
];

const INVALID_REFERENCE_TOKENS = new Set([
  "stp",
  "svp",
  "please",
  "merci",
  "demain",
  "oui",
  "non",
  "ok",
  "okay",
  "bonjour",
  "salut",
  "la",
  "le",
  "les",
  "un",
  "une",
  "des",
  "moi",
  "pour",
  "reference",
  "ref",
  "article",
  "code",
  "produit",
  "veux",
  "voudrais",
  "souhaite",
  "prends",
  "prend",
  "achete",
  "acheter",
  "commande",
  "commander",
  "mets",
  "mettez",
  "ajoute",
  "ajouter",
  "reserve",
  "reserver",
  "passer",
  "passe",
  "sais",
  "pas",
  "rouge",
  "bleu",
  "bleue",
  "bleus",
  "bleues",
  "noir",
  "noire",
  "noirs",
  "noires",
  "blanc",
  "blanche",
  "blancs",
  "blanches",
  "vert",
  "verte",
  "verts",
  "vertes",
  "jaune",
  "jaunes",
  "rose",
  "roses",
  "marron",
  "gris",
  "grise",
  "grises",
  "violet",
  "violette",
  "violets",
  "violettes",
]);

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function parseQuantityFromText(normalizedText: string): number | null {
  const explicitNumericPatterns = [
    /\bx\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*x\b/i,
    /\b(?:ref|reference|article|code|produit)\s*[:#-]?\s*[a-z0-9][a-z0-9\-_/]{1,40}\s+(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:piece|pieces|pcs|article|articles|exemplaire|exemplaires)\b/i,
    new RegExp(`\\b${ORDER_VERB_FRAGMENT}\\b\\s+(\\d{1,2})\\b`, "i"),
    new RegExp(
      `\\b${ORDER_VERB_FRAGMENT}\\b\\s+(?:la|le|les|un|une|des)?\\s*[a-z0-9][a-z0-9\\-_/]{1,40}\\s+(\\d{1,2})\\b`,
      "i",
    ),
  ];
  for (const pattern of explicitNumericPatterns) {
    const match = normalizedText.match(pattern);
    const raw = Number(match?.[1] || NaN);
    if (Number.isFinite(raw) && raw > 0) return raw;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(normalizedText)) {
      return value;
    }
  }
  return 1;
}

function sanitizeReferenceCandidate(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function isLikelyReferenceToken(candidate: string): boolean {
  const token = String(candidate || "").trim().toLowerCase();
  if (!token || /^\d+$/.test(token)) return false;
  if (INVALID_REFERENCE_TOKENS.has(token)) return false;
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) return false;

  // Pourquoi cette heuristique:
  // - on accepte des refs courantes (AB12, PULL-XL, sac_noir),
  // - on accepte aussi des refs boutique très courtes (ex: GSS, K12),
  // - on évite de transformer des phrases de chat générales en commande.
  const hasStructuredChars = /[\d\-_/]/.test(token);
  if (hasStructuredChars) return true;
  return token.length >= 3;
}

function parseReferenceFromText(normalizedText: string): string | null {
  const strongReferencePatterns = [
    /\b(?:reference|article|code|produit|ref)\b\s*[:#-]?\s*([a-z0-9][a-z0-9\-_/]{1,40})\b/i,
    new RegExp(
      `\\b${ORDER_VERB_FRAGMENT}\\b\\s+(?:la|le|les|un|une|des|du)?\\s*([a-z0-9][a-z0-9\\-_/]{1,40})\\b`,
      "i",
    ),
  ];
  for (const pattern of strongReferencePatterns) {
    const match = normalizedText.match(pattern);
    const candidate = sanitizeReferenceCandidate(String(match?.[1] || ""));
    if (!isLikelyReferenceToken(candidate)) continue;
    return candidate.toUpperCase();
  }
  return null;
}

function parseReferenceOnlyFromText(normalizedText: string): string | null {
  // Pourquoi ce mode existe:
  // en live, beaucoup d'acheteurs envoient juste la ref ("AB12", "PULL-XL", "REF AB12").
  const compact = normalizedText
    .replace(/[!?.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return null;

  const patterns = [
    /\b(?:ref|reference|article|code|produit)\b\s*[:#-]?\s*([a-z0-9][a-z0-9\-_/]{1,40})\b/i,
    /^([a-z0-9][a-z0-9\-_/]{1,40})(?:\s+(?:x\s*)?\d{1,2})?$/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const candidate = sanitizeReferenceCandidate(String(match?.[1] || ""));
    if (!isLikelyReferenceToken(candidate)) continue;
    return candidate.toUpperCase();
  }
  return null;
}

function parseVariantFromText(normalizedText: string): string | null {
  const variantPattern =
    /\b(?:taille|size|couleur|color|pointure)\s*[:#-]?\s*([a-z0-9][a-z0-9\-_/]{0,20})\b/i;
  const match = normalizedText.match(variantPattern);
  const candidate = String(match?.[1] || "").trim();
  return candidate || null;
}

/**
 * Parseur déterministe des intentions d'achat depuis un message TikTok.
 *
 * Pourquoi un parseur regex en premier:
 * - Il est très rapide et peu coûteux.
 * - Il est explicable (facile à auditer pour les règles métier).
 * - Il sert de garde-fou quand le LLM est indisponible.
 */
export function parseOrderFromRegex(inputText: string): ParsedOrder {
  const normalizedText = normalizeText(inputText);
  if (!normalizedText) {
    return {
      intent: "UNKNOWN",
      reference: null,
      quantity: null,
      variant: null,
      confidence: 0,
      reason: "Message vide",
      triggerMatched: null,
      normalizedText,
    };
  }

  const trigger = PURCHASE_TRIGGERS.find((item) => item.regex.test(normalizedText));
  const referenceWithoutTrigger = parseReferenceOnlyFromText(normalizedText);
  if (!trigger && !referenceWithoutTrigger) {
    return {
      intent: "UNKNOWN",
      reference: null,
      quantity: null,
      variant: null,
      confidence: 0.05,
      reason: "Aucun déclencheur d'achat détecté",
      triggerMatched: null,
      normalizedText,
    };
  }

  const quantity = parseQuantityFromText(normalizedText);
  const reference = parseReferenceFromText(normalizedText) || referenceWithoutTrigger;
  const variant = parseVariantFromText(normalizedText);
  const usedReferenceOnly = !trigger && Boolean(referenceWithoutTrigger);
  const baseConfidence = reference ? (usedReferenceOnly ? 0.72 : 0.82) : 0.45;
  const confidence = clampConfidence(
    baseConfidence + (quantity && quantity > 1 ? 0.05 : 0) + (variant ? 0.03 : 0),
  );

  return {
    intent: reference ? "ADD_TO_CART" : "UNKNOWN",
    reference,
    quantity,
    variant,
    confidence,
    reason: reference
      ? usedReferenceOnly
        ? "Référence détectée sans verbe d'achat explicite"
        : "Référence détectée avec un déclencheur d'achat"
      : "Déclencheur détecté mais référence manquante",
    triggerMatched: trigger?.label || (usedReferenceOnly ? "reference_only" : null),
    normalizedText,
  };
}
