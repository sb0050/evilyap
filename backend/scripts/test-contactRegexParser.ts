import assert from "assert/strict";
import { parseContactFromRegex } from "../services/live/contactRegexParser";

type Case = {
  text: string;
  expectedIntent: "LINK_EMAIL" | "UNKNOWN";
  expectedEmail?: string | null;
};

const cases: Case[] = [
  { text: "mon mail est client@test.fr", expectedIntent: "LINK_EMAIL", expectedEmail: "client@test.fr" },
  { text: "email: CLIENT+live@gmail.com", expectedIntent: "LINK_EMAIL", expectedEmail: "client+live@gmail.com" },
  { text: "tu peux me joindre sur jean.dupont@outlook.fr stp", expectedIntent: "LINK_EMAIL", expectedEmail: "jean.dupont@outlook.fr" },
  { text: "<anna.shop@icloud.com>", expectedIntent: "LINK_EMAIL", expectedEmail: "anna.shop@icloud.com" },
  { text: "je prends ref AB12 x2", expectedIntent: "UNKNOWN", expectedEmail: null },
  { text: "merci pour le live", expectedIntent: "UNKNOWN", expectedEmail: null },
  { text: "mon email est test@localhost", expectedIntent: "UNKNOWN", expectedEmail: null },
];

let passed = 0;
for (const t of cases) {
  const parsed = parseContactFromRegex(t.text);
  assert.equal(parsed.intent, t.expectedIntent, `intent mismatch for: ${t.text}`);
  if (t.expectedEmail !== undefined) {
    assert.equal(parsed.email, t.expectedEmail, `email mismatch for: ${t.text}`);
  }
  passed += 1;
}

console.log(`Contact regex parser tests passed: ${passed}/${cases.length}`);
