import type { RegrowthRuleRow, ZoneConfigurationRow } from "@/features/admin/api/adminApi";

/** STS soft-delete: active rows use `deleted = 0` (string `"0"` or number `0`). */
export function isStsRecordDeleted(row: { deleted?: unknown } | Record<string, unknown>): boolean {
  return String((row as Record<string, unknown>).deleted ?? "0").trim() === "1";
}

export function filterActiveHarvestPlanRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.filter((r) => !isStsRecordDeleted(r));
}

export function filterActiveZoneConfigurations(
  rows: ZoneConfigurationRow[],
): ZoneConfigurationRow[] {
  return rows.filter((r) => !isStsRecordDeleted(r as unknown as Record<string, unknown>));
}

export function filterActiveRegrowthRules(rows: RegrowthRuleRow[]): RegrowthRuleRow[] {
  return rows.filter((r) => !isStsRecordDeleted(r as unknown as Record<string, unknown>));
}
