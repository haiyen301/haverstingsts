import type { ItemRow } from "@/features/admin/api/itemsApi";

import { buildItemCatalogSelectOption } from "@/shared/lib/format/itemProductCodes";

export type MachineryProductOption = {
  id: number;
  brand: string;
  model: string;
  model_short?: string;
  commodity_name?: string;
  sku_sts?: string;
  old_sku?: string;
  commodity_code?: string;
  thai_code?: string;
  myanmar_code?: string;
  malaysia_code?: string;
  singapore_code?: string;
};

export function formatMachineryModelDisplay(
  item: Pick<
    ItemRow | MachineryProductOption,
    | "sku_sts"
    | "commodity_code"
    | "thai_code"
    | "myanmar_code"
    | "malaysia_code"
    | "singapore_code"
  >,
): string {
  const parts: string[] = [];
  const push = (label: string, value?: string | null) => {
    const v = String(value ?? "").trim();
    if (v) parts.push(`${label}: ${v}`);
  };
  push("SKU STS", item.sku_sts);
  push("VN", item.commodity_code);
  push("TH", item.thai_code);
  push("MM", item.myanmar_code);
  push("MY", item.malaysia_code);
  push("SG", item.singapore_code);

  return parts.length ? parts.join(" · ") : "—";
}

export function formatMachineryProductOptionLabel(item: MachineryProductOption): string {
  const brand = String(item.brand ?? "").trim();
  const modelLine = String(item.model_short ?? item.model ?? "").trim();
  const primaryName =
    brand && modelLine ? `${brand} — ${modelLine}` : brand || modelLine || `#${item.id}`;
  const { label, subLabel } = buildItemCatalogSelectOption(primaryName, item);
  return subLabel ? `${label} ${subLabel}` : label;
}

export function buildMachineryProductSelectOption(item: MachineryProductOption) {
  const brand = String(item.brand ?? "").trim();
  const modelLine = String(item.model_short ?? item.model ?? "").trim();
  const primaryName =
    brand && modelLine ? `${brand} — ${modelLine}` : brand || modelLine || `#${item.id}`;
  return buildItemCatalogSelectOption(primaryName, item);
}

export function itemRowToMachineryProduct(item: ItemRow): MachineryProductOption {
  const model = formatMachineryModelDisplay(item);
  return {
    id: Number(item.id),
    brand: String(item.brand_name ?? "").trim(),
    model,
    model_short: model,
    sku_sts: item.sku_sts ?? undefined,
    old_sku: item.old_sku ?? undefined,
    commodity_code: item.commodity_code ?? undefined,
    thai_code: item.thai_code ?? undefined,
    myanmar_code: item.myanmar_code ?? undefined,
    malaysia_code: item.malaysia_code ?? undefined,
    singapore_code: item.singapore_code ?? undefined,
  };
}
