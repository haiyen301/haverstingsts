import type { FertilizerProductRow } from "@/features/admin/api/adminApi";

function productCountryId(product: FertilizerProductRow): number | null {
  const raw = product.country_id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Products with no country are global and shown for every farm.
 * Country-scoped products only appear when the farm's country matches.
 * Pinned item ids (e.g. current edit value) are always kept visible.
 */
export function filterFertilizerProductsForFarm(
  products: FertilizerProductRow[],
  farmCountryId: number | null | undefined,
  pinnedItemIds: number[] = [],
): FertilizerProductRow[] {
  const pinned = new Set(
    pinnedItemIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Number(id)),
  );
  const farmCountry =
    farmCountryId != null && Number.isFinite(Number(farmCountryId)) && Number(farmCountryId) > 0
      ? Number(farmCountryId)
      : null;

  return products.filter((product) => {
    const itemId = Number(product.id);
    if (pinned.has(itemId)) return true;

    const countryId = productCountryId(product);
    if (countryId == null) return true;
    if (farmCountry == null) return false;

    return countryId === farmCountry;
  });
}

export type StockKeyOption = {
  value: string;
  label: string;
  subLabel?: string;
};

/**
 * Same country rules as filterFertilizerProductsForFarm, for stock ledger product keys.
 */
export function filterStockKeyOptionsForFarmCountry(
  options: StockKeyOption[],
  productCountryByStockKey: Map<string, number | null>,
  farmCountryId: number | null | undefined,
  pinnedValues: string[] = [],
): StockKeyOption[] {
  const pinned = new Set(pinnedValues.filter((value) => value.trim() !== ""));
  const farmCountry =
    farmCountryId != null && Number.isFinite(Number(farmCountryId)) && Number(farmCountryId) > 0
      ? Number(farmCountryId)
      : null;

  return options.filter((option) => {
    if (pinned.has(option.value)) return true;

    const productCountry = productCountryByStockKey.get(option.value) ?? null;
    if (productCountry == null) return true;
    if (farmCountry == null) return false;

    return productCountry === farmCountry;
  });
}
