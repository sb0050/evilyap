import fs from "fs/promises";
import path from "path";

export type FallbackCotationBoxtalTable = Record<string, Record<string, number>>;

let fallbackCotationBoxtalCache: FallbackCotationBoxtalTable | null = null;

export const loadFallbackCotationBoxtal =
  async (): Promise<FallbackCotationBoxtalTable | null> => {
    if (fallbackCotationBoxtalCache) return fallbackCotationBoxtalCache;
    const candidatePaths = [
      path.resolve(process.cwd(), "FALLBACK_COTATION_BOXTAL.json"),
      path.resolve(__dirname, "..", "FALLBACK_COTATION_BOXTAL.json"),
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "FALLBACK_COTATION_BOXTAL.json",
      ),
    ];
    for (const p of candidatePaths) {
      try {
        const raw = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(raw) as FallbackCotationBoxtalTable;
        if (parsed && typeof parsed === "object") {
          fallbackCotationBoxtalCache = parsed;
          return parsed;
        }
      } catch (_e) {}
    }
    return null;
  };

export const pickFallbackCotationBoxtal = (
  table: FallbackCotationBoxtalTable,
  deliveryNetworkRaw: string,
  weightKg: number,
): number | null => {
  const deliveryNetwork = String(deliveryNetworkRaw || "").trim();
  if (!deliveryNetwork) return null;
  const byCarrier =
    (table as any)?.[deliveryNetwork] ||
    (() => {
      const target = deliveryNetwork.toUpperCase();
      const matchKey = Object.keys(table).find(
        (k) =>
          String(k || "")
            .trim()
            .toUpperCase() === target,
      );
      return matchKey ? (table as any)?.[matchKey] : null;
    })();
  if (!byCarrier || typeof byCarrier !== "object") return null;

  const weightKeys = Object.keys(byCarrier)
    .map((k) => ({ raw: k, n: Number(String(k).replace(",", ".")) }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n);
  if (weightKeys.length === 0) return null;

  const w = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 0;
  const picked =
    weightKeys.find((x) => x.n >= w) || weightKeys[weightKeys.length - 1];
  const price = Number((byCarrier as any)?.[picked.raw]);
  return Number.isFinite(price) ? Math.max(0, price) : null;
};

