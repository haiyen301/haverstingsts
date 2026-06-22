type HarvestImportDateRow = {
  deliveryDate: string;
  actualDate: string;
  estimatedDate: string;
};

function isoDateYear(iso: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(iso.trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * Legacy harvest Excel files (year <= 2025) often omit Delivery Date.
 * When that column is not mapped, use Actual Harvest Date as delivery date.
 */
export function resolveHarvestImportDeliveryDate(
  row: HarvestImportDateRow,
  hasDeliveryDateColumn: boolean,
): string {
  const delivery = row.deliveryDate.trim();
  if (delivery) return delivery;
  if (hasDeliveryDateColumn) return "";

  const actual = row.actualDate.trim();
  const referenceYear =
    isoDateYear(actual) ?? isoDateYear(row.estimatedDate.trim());
  if (referenceYear != null && referenceYear <= 2025 && actual) {
    return actual;
  }
  return "";
}
