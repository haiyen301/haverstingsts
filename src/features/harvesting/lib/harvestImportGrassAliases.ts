function normalizeGrassAliasKey(v: string): string {
  return v
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Excel grass labels that map to the Lynkz product in STS. */
const LYNKZ_GRASS_ALIASES = new Set(["brg", "brg2"]);

/**
 * Normalize grass type from harvest Excel import.
 * BRG and BRG2 are legacy labels for Lynkz Zoysia.
 */
export function normalizeHarvestImportGrassLabel(grass: string): string {
  const raw = grass.trim();
  if (!raw) return "";
  if (LYNKZ_GRASS_ALIASES.has(normalizeGrassAliasKey(raw))) {
    return "Lynkz";
  }
  return raw;
}
