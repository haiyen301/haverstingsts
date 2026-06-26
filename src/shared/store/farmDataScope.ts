/** Comma-separated farm ids for optional UI filter query params (server applies permission scope). */
export function farmIdsToApiCsv(farmIds: string[]): string | undefined {
  const ids = farmIds.map((x) => x.trim()).filter(Boolean);
  return ids.length > 0 ? ids.join(",") : undefined;
}
