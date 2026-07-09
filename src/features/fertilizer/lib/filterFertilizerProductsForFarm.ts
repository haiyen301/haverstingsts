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
