import type { HarvestListExportFilter } from "@/features/harvest/lib/harvestListExport";

function parseCsvIds(raw: string): string[] {
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function rowMatchesSearch(row: Record<string, unknown>, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.id,
    row.project_name,
    row.grass_name,
    row.farm_name,
    row.general_note,
    row.harvest_status,
    row.uom,
    row.quantity,
  ]
    .map((v) => String(v ?? "").toLowerCase())
    .join(" ");
  return haystack.includes(q);
}

function rowInDateRange(
  row: Record<string, unknown>,
  from: string,
  to: string,
): boolean {
  if (!from || !to) return true;
  const d = String(row.delivery_harvest_date ?? "").trim().slice(0, 10);
  if (!d) return false;
  return d >= from && d <= to;
}

export function filterHarvestExportDemoRows(
  rows: Array<Record<string, unknown>>,
  filter: HarvestListExportFilter,
): Array<Record<string, unknown>> {
  const farmIds = parseCsvIds(filter.farmIds);
  const grassIds = parseCsvIds(filter.grassIds);
  const projectIds = parseCsvIds(filter.projectIds);
  const statuses = parseCsvIds(filter.statusValues);

  return rows.filter((row) => {
    if (!rowMatchesSearch(row, filter.search)) return false;

    if (farmIds.length > 0) {
      const farmId = String(row.farm_id ?? "").trim();
      if (!farmIds.includes(farmId)) return false;
    }

    if (grassIds.length > 0) {
      const productId = String(row.product_id ?? "").trim();
      if (!grassIds.includes(productId)) return false;
    }

    if (projectIds.length > 0) {
      const projectId = String(row.project_id ?? "").trim();
      if (!projectIds.includes(projectId)) return false;
    }

    if (statuses.length > 0) {
      const status = String(row.harvest_status ?? "").trim();
      if (!statuses.includes(status)) return false;
    }

    if (
      !rowInDateRange(row, filter.deliveryHarvestFrom, filter.deliveryHarvestTo)
    ) {
      return false;
    }

    return true;
  });
}
