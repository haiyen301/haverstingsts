import {
  stsProxyGet,
  stsProxyPostFormData,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import type {
  DynamicTableDataQuery,
  MondayDynamicTableResponse,
  MondayProjectServerRow,
  MondayUpdateParentItemResponse,
} from "../model/types";

/**
 * Clone from Flutter `DynamicTableDataRepo.getAllDynamicTableData`:
 * 1) Build queryParameters from `filter`
 * 2) Force `order_dir=DESC` and `order_by=id`
 * 3) Append `page`, `per_page` when provided
 * 4) GET `${baseUrl}${dynamicTableDataUrl}/?queryString`
 */
export async function getAllDynamicTableDataFromServer(
  params?: DynamicTableDataQuery,
): Promise<MondayDynamicTableResponse> {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params?.filter ?? {})) {
    if (value != null && String(value).trim() !== "") {
      sp.set(key, String(value));
    }
  }
  const sortBy = String((params?.filter as Record<string, unknown> | undefined)?.sort_by ?? "").trim();
  if (!sortBy) {
    sp.set("order_dir", "DESC");
    sp.set("order_by", "id");
  }
  if (params?.page != null) sp.set("page", String(params.page));
  if (params?.perPage != null) sp.set("per_page", String(params.perPage));

  const upstreamPath = sp.toString()
    ? `${STS_API_PATHS.mondayDynamicTableData}?${sp.toString()}`
    : STS_API_PATHS.mondayDynamicTableData;

  const data = await stsProxyGet<unknown>(upstreamPath);

  const rows: MondayProjectServerRow[] = [];
  const root = (data ?? {}) as Record<string, unknown>;

  const appendRowsFromTables = (tablesLike: unknown) => {
    if (!Array.isArray(tablesLike)) return;
    for (const table of tablesLike) {
      if (!table || typeof table !== "object") continue;
      const t = table as Record<string, unknown>;
      const tableId = String(t.table_id ?? "").trim();
      const tableRows = t.rows;
      if (!Array.isArray(tableRows)) continue;
      const tableName = String(t.table_name ?? "").trim();
      for (const row of tableRows) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        rows.push({
          ...(rec as MondayProjectServerRow),
          table_id:
            (rec.table_id as string | number | undefined) ??
            (tableId || undefined),
          table_name:
            String(rec.table_name ?? "").trim() || tableName || undefined,
        });
      }
    }
  };

  appendRowsFromTables(root.data);

  if (!rows.length && Array.isArray(data)) {
    appendRowsFromTables(data);
  }

  if (!rows.length) {
    if (Array.isArray(root.rows)) {
      for (const row of root.rows) {
        if (row && typeof row === "object") {
          rows.push(row as MondayProjectServerRow);
        }
      }
    } else if (Array.isArray(data)) {
      const looksLikeRows = data.some((x) => {
        if (!x || typeof x !== "object") return false;
        const r = x as Record<string, unknown>;
        return "row_id" in r || "id" in r;
      });
      if (looksLikeRows) {
        for (const row of data) {
          if (row && typeof row === "object") {
            rows.push(row as MondayProjectServerRow);
          }
        }
      }
    }
  }

  return { rows, raw: data };
}

/**
 * Backward-compatible wrapper (existing call-sites).
 */
export async function fetchMondayProjectRowsFromServer(params?: {
  search?: string;
  page?: number;
  perPage?: number;
  module?: string;
  /** Filter by normalized card status (Ongoing|Future|Done|Warning). */
  status?: string;
  /** Filter by `country_id` (same as ProjectListItem country pill / Zustand countries). */
  countryId?: string;
  /** Server sort: country_id, status bucket, first grass product_id. */
  sortBy?: "country" | "status" | "grass";
  sortDir?: "asc" | "desc";
}): Promise<MondayDynamicTableResponse> {
  return getAllDynamicTableDataFromServer({
    page: params?.page,
    perPage: params?.perPage,
    filter: {
      module: params?.module,
      search: params?.search,
      status: params?.status,
      country_id: params?.countryId,
      sort_by: params?.sortBy,
      sort_dir: params?.sortDir,
    },
  });
}

/**
 * Clone of MondayUpdateRepo intent: update parent row/project item payload.
 * Endpoint matches Flutter `react_update_parent_item`.
 */
export async function updateMondayProjectParentItem(
  payload: Record<string, unknown>,
): Promise<MondayUpdateParentItemResponse> {
  return stsProxyPostJson<MondayUpdateParentItemResponse>(
    STS_API_PATHS.mondayUpdateParentItem,
    payload,
  );
}

/**
 * Flutter `MondayUpdateRepo.deleteParentOrSubItem` → `react_delete_parent_or_sub_item`.
 */
export async function deleteMondayParentOrSubItem(payload: {
  tableId: string;
  tableName: string;
  rowId: string;
  type: "parent" | "sub";
  deleteMode?: "soft" | "hard";
}): Promise<void> {
  await stsProxyPostJson<unknown>(STS_API_PATHS.mondayDeleteParentOrSubItem, {
    tableId: payload.tableId,
    tableName: payload.tableName,
    rowId: payload.rowId,
    type: payload.type,
    deleteMode: payload.deleteMode ?? "soft",
  });
}

export async function uploadMondayProjectImageFromCard(params: {
  rowId: string;
  tableId: string;
  projectId: string;
  file: File;
  existingFilesToRemove: string[];
  rowData?: Record<string, unknown>;
}) {
  const fd = new FormData();
  fd.append("table_id", params.tableId);
  fd.append("row_id", params.rowId);
  fd.append("field", "project_img");
  fd.append("upload_type", "single");
  fd.append("save_to", "parent");
  fd.append("images_removed", JSON.stringify({ project_img: params.existingFilesToRemove }));
  const rowData = { ...(params.rowData ?? {}) };
  if (!("id" in rowData) || !rowData.id) {
    rowData.id = Number.parseInt(params.rowId, 10) || 1;
  }
  if (!("project_id" in rowData) || !rowData.project_id) {
    rowData.project_id = params.projectId;
  }
  fd.append("row_data", JSON.stringify(rowData));
  fd.append("project_img_image", params.file, params.file.name);
  return stsProxyPostFormData<unknown>(STS_API_PATHS.mondayParentUploadFiles, fd);
}
