const HARVEST_IMPORT_RETURN_TO = "/harvest/import";

export function buildProjectGrassRequirementsEditHref(params: {
  rowId: string;
  tableId?: string;
  origin?: string;
  returnTo?: string;
}): string {
  const rowId = params.rowId.trim();
  if (!rowId) return "";

  const qs = new URLSearchParams();
  qs.set("rowId", rowId);
  const tableId = params.tableId?.trim();
  if (tableId) qs.set("tableId", tableId);

  const returnTo = params.returnTo?.trim() || HARVEST_IMPORT_RETURN_TO;
  if (returnTo.startsWith("/harvest") || returnTo.startsWith("/projects")) {
    qs.set("returnTo", returnTo);
  }

  const path = `/projects/new?${qs.toString()}#project-grass-info`;
  const origin = params.origin?.replace(/\/$/, "") ?? "";
  return origin ? `${origin}${path}` : path;
}
