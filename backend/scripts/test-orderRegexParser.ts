import assert from "assert/strict";
import { parseOrderFromRegex } from "../services/live/orderRegexParser";

type Case = {
  text: string;
  expectedIntent: "ADD_TO_CART" | "UNKNOWN";
  expectedReference?: string | null;
  expectedQuantity?: number | null;
};

const cases: Case[] = [
  { text: "Je prends ref AB12", expectedIntent: "ADD_TO_CART", expectedReference: "AB12", expectedQuantity: 1 },
  { text: "j'achète REF: TSHIRT-XL", expectedIntent: "ADD_TO_CART", expectedReference: "TSHIRT-XL", expectedQuantity: 1 },
  { text: "ajoute ref #PULL01 x2", expectedIntent: "ADD_TO_CART", expectedReference: "PULL01", expectedQuantity: 2 },
  { text: "je veux article sac-noir 3", expectedIntent: "ADD_TO_CART", expectedReference: "SAC-NOIR", expectedQuantity: 3 },
  { text: "prends moi code: jean32", expectedIntent: "ADD_TO_CART", expectedReference: "JEAN32", expectedQuantity: 1 },
  { text: "je prends deux ref robeRouge", expectedIntent: "ADD_TO_CART", expectedReference: "ROBEROUGE", expectedQuantity: 2 },
  { text: "j achete 4 pieces ref TOP9", expectedIntent: "ADD_TO_CART", expectedReference: "TOP9", expectedQuantity: 4 },
  { text: "ajoutez produit basket_44", expectedIntent: "ADD_TO_CART", expectedReference: "BASKET_44", expectedQuantity: 1 },
  { text: "je prends la ref jupe-bleue taille M", expectedIntent: "ADD_TO_CART", expectedReference: "JUPE-BLEUE", expectedQuantity: 1 },
  { text: "je veux un tshirt-noir", expectedIntent: "ADD_TO_CART", expectedReference: "TSHIRT-NOIR", expectedQuantity: 1 },
  { text: "je voudrais ref AB12", expectedIntent: "ADD_TO_CART", expectedReference: "AB12", expectedQuantity: 1 },
  { text: "je souhaite article ROBE-XL", expectedIntent: "ADD_TO_CART", expectedReference: "ROBE-XL", expectedQuantity: 1 },
  { text: "commande REF-77 x2", expectedIntent: "ADD_TO_CART", expectedReference: "REF-77", expectedQuantity: 2 },
  { text: "mets AB12", expectedIntent: "ADD_TO_CART", expectedReference: "AB12", expectedQuantity: 1 },

  // Référence seule (sans verbe explicite)
  { text: "AB12", expectedIntent: "ADD_TO_CART", expectedReference: "AB12", expectedQuantity: 1 },
  { text: "PULL-XL x3", expectedIntent: "ADD_TO_CART", expectedReference: "PULL-XL", expectedQuantity: 3 },
  { text: "ref : sac_noir", expectedIntent: "ADD_TO_CART", expectedReference: "SAC_NOIR", expectedQuantity: 1 },

  { text: "Salut ça va ?", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "Merci pour le live", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "Je prends", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "ajoute stp", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "je veux 2", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "j'achète demain", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "Je prends la rouge", expectedIntent: "ADD_TO_CART", expectedReference: "ROUGE", expectedQuantity: 1 },
  { text: "Prends moi ref:12345", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "ajoute référence: ", expectedIntent: "UNKNOWN", expectedReference: null },
  { text: "je veux ref ABCD-10 taille L", expectedIntent: "ADD_TO_CART", expectedReference: "ABCD-10", expectedQuantity: 1 },
  { text: "J’achetes article pull-vert x 3", expectedIntent: "ADD_TO_CART", expectedReference: "PULL-VERT", expectedQuantity: 3 },
  { text: "Ajoute produit casquette", expectedIntent: "ADD_TO_CART", expectedReference: "CASQUETTE", expectedQuantity: 1 },
];

let passed = 0;
for (const t of cases) {
  const parsed = parseOrderFromRegex(t.text);
  assert.equal(parsed.intent, t.expectedIntent, `intent mismatch for: ${t.text}`);
  if (t.expectedReference !== undefined) {
    assert.equal(parsed.reference, t.expectedReference, `reference mismatch for: ${t.text}`);
  }
  if (t.expectedQuantity !== undefined) {
    assert.equal(parsed.quantity, t.expectedQuantity, `quantity mismatch for: ${t.text}`);
  }
  passed += 1;
}

console.log(`Regex parser tests passed: ${passed}/${cases.length}`);
