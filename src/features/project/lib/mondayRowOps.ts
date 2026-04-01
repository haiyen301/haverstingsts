import type {
  MondayDynamicRowLike,
  MondayProjectEditArgs,
  MondayProjectServerRow,
} from "@/entities/projects";

function toOptionalString(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s || undefined;
}

function getRowId(data: Record<string, unknown>): string {
  return String(data.row_id ?? data.id ?? "").trim();
}

function parseCreatedAt(createdAt: unknown): Date | null {
  const s = String(createdAt ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStatusForSort(status: unknown): string {
  return String(status ?? "").toLowerCase().trim();
}

function getStatusOrder(status: string): number {
  switch (status) {
    case "warning":
      return 0;
    case "ongoing":
      return 1;
    case "future":
      return 2;
    case "done":
      return 3;
    default:
      return 4;
  }
}

/**
 * Clone of MondayScreen behavior:
 * - rowMap = rowData?.toJson() ?? Map.from(data)
 * - prefer `rowData` for fields that are fresher after save (`project_img`, `subitems`, quantities)
 * - fallback to `data` for the rest.
 */
export function mergeMondayDisplayData(
  data: Record<string, unknown>,
  rowData?: MondayDynamicRowLike | null,
): MondayProjectServerRow {
  const rowMap = rowData?.toJson?.() ?? data;
  const rowMapRec = rowMap as Record<string, unknown>;
  const merged: MondayProjectServerRow = {
    ...(data as MondayProjectServerRow),
    ...(rowMap as MondayProjectServerRow),
    row_id: String(data.row_id ?? rowData?.rowId ?? rowMap.row_id ?? data.id ?? "").trim(),
    id:
      (data.id as string | number | undefined) ??
      (rowMapRec.id as string | number | undefined),
    table_id:
      (data.table_id as string | number | undefined) ??
      rowData?.tableId ??
      (rowMapRec.table_id as string | number | undefined),
    status_app:
      toOptionalString((data as Record<string, unknown>).status_app) ??
      toOptionalString(rowData?.status) ??
      toOptionalString(rowMapRec.status_app),
    created_at:
      toOptionalString(data.created_at) ??
      toOptionalString(rowData?.createdAt) ??
      toOptionalString(rowMapRec.created_at),
    project_img:
      (rowMap as Record<string, unknown>).project_img ??
      rowData?.projectImg ??
      data.project_img,
    subitems:
      (rowMap as Record<string, unknown>).subitems ??
      rowData?.subitems ??
      data.subitems,
    quantity_required_sprig_sod:
      (rowMap as Record<string, unknown>).quantity_required_sprig_sod ??
      rowData?.quantityRequiredSprigSod ??
      data.quantity_required_sprig_sod,
  };
  return merged;
}

/**
 * Clone sorting in `monday_screen.dart`:
 * 1) status_app order: warning -> ongoing -> future -> done
 * 2) within same status: created_at newest first
 */
export function sortMondayProjectRows(
  rawDisplayData: Record<string, unknown>[],
  rowsById?: Record<string, MondayDynamicRowLike | undefined>,
): MondayProjectServerRow[] {
  const list = rawDisplayData
    .map((data) => {
      const rowId = getRowId(data);
      const rowData = rowId ? rowsById?.[rowId] : undefined;
      return mergeMondayDisplayData(data, rowData);
    })
    .filter((x) => String(x.row_id ?? x.id ?? "").trim().length > 0);

  list.sort((a, b) => {
    const statusA = normalizeStatusForSort(a.status_app);
    const statusB = normalizeStatusForSort(b.status_app);
    const orderA = getStatusOrder(statusA);
    const orderB = getStatusOrder(statusB);
    if (orderA !== orderB) return orderA - orderB;

    const dateA = parseCreatedAt(a.created_at);
    const dateB = parseCreatedAt(b.created_at);
    if (dateA && dateB) return dateB.getTime() - dateA.getTime();
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    return 0;
  });

  return list;
}

/** Build edit payload exactly like MondayScreen `onEditProject`. */
export function buildMondayEditArgs(
  data: Record<string, unknown>,
  rowData?: MondayDynamicRowLike | null,
): MondayProjectEditArgs {
  const rowMap = rowData?.toJson?.() ?? { ...data };
  const rowId = String(data.row_id ?? data.id ?? rowData?.rowId ?? "").trim() || undefined;
  const tableId = String(data.table_id ?? rowData?.tableId ?? "").trim() || undefined;
  return { rowId, tableId, rowData: rowMap };
}
