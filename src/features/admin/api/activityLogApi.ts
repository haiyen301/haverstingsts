import { buildStsProxyGetUrl, stsProxyGetFullJson } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";

export type ActivityLogAction = "created" | "updated" | "deleted";
export type ActivityLogModule =
  | "harvest_api"
  | "project_api"
  | "inventory_api"
  | "zones_api"
  | "zone_configurations_api"
  | "grasses_api"
  | "keyareas_api"
  | "project_paces_api"
  | "countries_api"
  | "roles_api"
  | "regrowth_rules_api"
  | "project_form_catalog_api"
  | "staff_api";

export type ActivityLogChange = {
  field: string;
  from: string;
  to: string;
};

export type ActivityLogRow = {
  id: number;
  createdAt: string;
  createdBy: number;
  createdByUser: string;
  createdByAvatar: string;
  action: ActivityLogAction | string;
  logType: ActivityLogModule | string;
  logTypeTitle: string;
  logTypeId: number;
  logFor: string;
  logForId: number;
  logFor2: string | null;
  logForId2: number | null;
  logForTitle: string;
  changes: ActivityLogChange[];
};

export type ActivityLogListMeta = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type ActivityLogListResult = {
  rows: ActivityLogRow[];
  meta: ActivityLogListMeta;
};

export type FetchActivityLogsParams = {
  page?: number;
  perPage?: number;
  logType?: ActivityLogModule | "";
  action?: ActivityLogAction | "";
  search?: string;
};

function mapChange(raw: Record<string, unknown>): ActivityLogChange {
  return {
    field: String(raw.field ?? "").trim(),
    from: String(raw.from ?? ""),
    to: String(raw.to ?? ""),
  };
}

function mapRow(raw: Record<string, unknown>): ActivityLogRow {
  const changesRaw = Array.isArray(raw.changes) ? raw.changes : [];
  return {
    id: Number(raw.id) || 0,
    createdAt: String(raw.created_at ?? "").trim(),
    createdBy: Number(raw.created_by) || 0,
    createdByUser: String(raw.created_by_user ?? "").trim() || "System",
    createdByAvatar: String(raw.created_by_avatar ?? "").trim(),
    action: String(raw.action ?? "").trim(),
    logType: String(raw.log_type ?? "").trim(),
    logTypeTitle: String(raw.log_type_title ?? "").trim(),
    logTypeId: Number(raw.log_type_id) || 0,
    logFor: String(raw.log_for ?? "").trim(),
    logForId: Number(raw.log_for_id) || 0,
    logFor2: raw.log_for2 == null ? null : String(raw.log_for2).trim(),
    logForId2: raw.log_for_id2 == null ? null : Number(raw.log_for_id2) || 0,
    logForTitle: String(raw.log_for_title ?? "").trim(),
    changes: changesRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map(mapChange),
  };
}

export async function fetchActivityLogs(
  params: FetchActivityLogsParams = {},
): Promise<ActivityLogListResult> {
  const query: Record<string, string | number> = {
    page: params.page ?? 1,
    per_page: params.perPage ?? 25,
  };
  if (params.logType) query.log_type = params.logType;
  if (params.action) query.action = params.action;
  if (params.search?.trim()) query.search = params.search.trim();

  const json = await stsProxyGetFullJson(
    buildStsProxyGetUrl(STS_API_PATHS.activityLogs, query),
  );

  const data = Array.isArray(json.data) ? json.data : [];
  const metaRaw = (json.meta ?? {}) as Record<string, unknown>;
  const perPage = Number(metaRaw.per_page) || Number(query.per_page) || 25;
  const total = Number(metaRaw.total) || 0;

  return {
    rows: data
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map(mapRow),
    meta: {
      page: Number(metaRaw.page) || 1,
      perPage,
      total,
      totalPages: Number(metaRaw.total_pages) || (perPage > 0 ? Math.ceil(total / perPage) : 0),
    },
  };
}
