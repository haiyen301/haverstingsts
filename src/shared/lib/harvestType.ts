export type HarvestTypeStorageKey = "sprig" | "sod" | "sod_to_sprig";

function normalizeHarvestTypeText(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

function isKgLikeUom(raw: unknown): boolean {
  const u = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/²/g, "2");
  return u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms";
}

export function normalizeHarvestTypeStorageKey(raw: unknown): HarvestTypeStorageKey | "" {
  const text = normalizeHarvestTypeText(raw);
  if (!text) return "";

  if (
    text === "sod_to_sprig" ||
    text === "sod_for_sprig" ||
    /sod\s*(?:for|to|->|→|\/)?\s*sprig/i.test(text) ||
    (text.includes("sod") && text.includes("sprig"))
  ) {
    return "sod_to_sprig";
  }
  if (text === "sprig" || text.includes("sprig")) return "sprig";
  if (text === "sod" || text.includes("sod")) return "sod";
  return "";
}

export function defaultHarvestTypeForUom(rawUom: unknown): HarvestTypeStorageKey {
  return isKgLikeUom(rawUom) ? "sprig" : "sod";
}

export function harvestTypeDisplayLabel(raw: unknown): string {
  const key = normalizeHarvestTypeStorageKey(raw);
  if (key === "sod_to_sprig") return "Sod -> Sprig";
  if (key === "sprig") return "Sprig";
  if (key === "sod") return "Sod";
  return String(raw ?? "").trim();
}
