import {
  stsProxyGetFullJson,
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

  if (typeof window !== "undefined") {
    const { getSessionUser } = await import("@/shared/store/authUserStore");
    const uid = getSessionUser()?.id;
    if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) {
      sp.set("user_current_login", String(Number(uid)));
    }
  }

  const moduleName = String(
    (params?.filter as Record<string, unknown> | undefined)?.module ?? "",
  )
    .trim()
    .toLowerCase();
  void moduleName;
  const basePathForList = STS_API_PATHS.mondayDynamicTableData;
  const upstreamPath = sp.toString()
    ? `${basePathForList}?${sp.toString()}`
    : basePathForList;

  const json = await stsProxyGetFullJson(upstreamPath);
  const data = json.data;
  const hasTotalRecords =
    Object.prototype.hasOwnProperty.call(json, "total_records") &&
    json.total_records != null;
  const tr = Number(json.total_records);
  const totalRecords: number | null =
    hasTotalRecords && Number.isFinite(tr) && tr >= 0 ? Math.floor(tr) : null;

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

  return { rows, raw: data, totalRecords };
}

export type MondayProjectListQuery = {
  search?: string;
  page?: number;
  perPage?: number;
  module?: string;
  /** Filter by normalized card status (Ongoing|Future|Done|Warning). Comma-separated. */
  status?: string;
  /** Comma-separated `country_id` values. */
  countryId?: string;
  /** Comma-separated farm ids (`quantity_required_sprig_sod` / subitems). */
  farmId?: string;
  /** Comma-separated grass / product ids. */
  grassId?: string;
  /** Comma-separated project ids. */
  projectId?: string;
  sortBy?: "country" | "status" | "grass" | "project_id";
  sortDir?: "asc" | "desc";
  /**
   * When true, STSPortal applies `page` / `per_page` on the filtered Monday row list
   * (`Harvesting::_applyMondayHarvestingTableQuery`). Omit on screens that need the full list.
   */
  listPaged?: boolean;
};

function buildMondayProjectListFilter(
  params?: MondayProjectListQuery,
): Record<string, string | number | boolean | null | undefined> {
  return {
    module: params?.module,
    search: params?.search,
    status: params?.status,
    country_id: params?.countryId,
    farm_id: params?.farmId,
    grass_id: params?.grassId,
    project_id: params?.projectId,
    sort_by: params?.sortBy,
    sort_dir: params?.sortDir,
    ...(params?.listPaged ? { monday_slice: 1 } : {}),
  };
}

/**
 * Backward-compatible wrapper (existing call-sites).
 */
export async function fetchMondayProjectRowsFromServer(
  params?: MondayProjectListQuery,
): Promise<MondayDynamicTableResponse> {
  return getAllDynamicTableDataFromServer({
    page: params?.page,
    perPage: params?.perPage,
    filter: buildMondayProjectListFilter(params),
  });
}

/** Filtered project card count only — one HTTP call, no row payload. */
export async function fetchMondayProjectTotalFromServer(
  params?: Omit<MondayProjectListQuery, "page" | "perPage" | "listPaged">,
): Promise<number> {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(buildMondayProjectListFilter(params))) {
    if (value != null && String(value).trim() !== "") {
      sp.set(key, String(value));
    }
  }

  if (typeof window !== "undefined") {
    const { getSessionUser } = await import("@/shared/store/authUserStore");
    const uid = getSessionUser()?.id;
    if (uid != null && Number.isFinite(Number(uid)) && Number(uid) > 0) {
      sp.set("user_current_login", String(Number(uid)));
    }
  }

  const upstreamPath = sp.toString()
    ? `${STS_API_PATHS.mondayDynamicTableTotal}?${sp.toString()}`
    : STS_API_PATHS.mondayDynamicTableTotal;

  const json = await stsProxyGetFullJson(upstreamPath);
  const tr = Number(json.total_records);
  if (Number.isFinite(tr) && tr >= 0) {
    return Math.floor(tr);
  }
  return 0;
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

/** Direct lookup by `project_id` in `sts_dynamic_table_data` (not full Monday table list). */
export async function fetchProjectDynamicFieldsByProjectId(
  projectId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalized = projectId.trim();
  if (!normalized) return [];
  const rows = await stsProxyPostJson<unknown[]>(
    STS_API_PATHS.mondayFindDynamicByField,
    {
      field_name: "project_id",
      field_value: normalized,
    },
  );
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
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
