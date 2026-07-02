export type ItemProductCodeFields = {
  sku_sts?: string | null;
  commodity_code?: string | null;
  thai_code?: string | null;
  myanmar_code?: string | null;
  malaysia_code?: string | null;
  singapore_code?: string | null;
};

function trimCode(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Parenthetical product codes for dropdown labels, e.g.
 * `(SKU STS: ABC, VN: 123 | TH: 456 | MM: 789)` — excludes old_sku.
 */
export function formatItemProductCodesParenthetical(item: ItemProductCodeFields): string {
  const sku = trimCode(item.sku_sts);
  const countryCodes: string[] = [];
  const vn = trimCode(item.commodity_code);
  if (vn) countryCodes.push(`VN: ${vn}`);
  const th = trimCode(item.thai_code);
  if (th) countryCodes.push(`TH: ${th}`);
  const mm = trimCode(item.myanmar_code);
  if (mm) countryCodes.push(`MM: ${mm}`);
  const my = trimCode(item.malaysia_code);
  if (my) countryCodes.push(`MY: ${my}`);
  const sg = trimCode(item.singapore_code);
  if (sg) countryCodes.push(`SG: ${sg}`);

  if (!sku && countryCodes.length === 0) return "";
  if (sku && countryCodes.length) {
    return `(SKU STS: ${sku}, ${countryCodes.join(" | ")})`;
  }
  if (sku) return `(SKU STS: ${sku})`;
  return `(${countryCodes.join(" | ")})`;
}

export type ItemCatalogSelectOptionParts = {
  label: string;
  subLabel?: string;
};

/** Split product name (line 1) and code parenthetical (line 2) for searchable selects. */
export function buildItemCatalogSelectOption(
  primaryName: string,
  item: ItemProductCodeFields,
): ItemCatalogSelectOptionParts {
  const label = trimCode(primaryName) || "—";
  const subLabel = formatItemProductCodesParenthetical(item) || undefined;
  return subLabel ? { label, subLabel } : { label };
}

/** Primary name plus optional code parenthetical on one line (legacy / search fallback). */
export function formatItemCatalogOptionLabel(
  primaryName: string,
  item: ItemProductCodeFields,
): string {
  const { label, subLabel } = buildItemCatalogSelectOption(primaryName, item);
  return subLabel ? `${label} ${subLabel}` : label;
}
