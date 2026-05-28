import { parseJsonMaybe } from "@/shared/lib/parseJsonMaybe";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";

/** Server skips `created_by` / farm scope — all plan rows for progress aggregation. */
export const HARVEST_PROJECT_PROGRESS_SCOPE = 1 as const;

function parseRowSubitems(raw: unknown): Array<Record<string, unknown>> {
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function mergeHarvestPlanRows(
  prev: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set(
    prev.map((r) => String(r.id ?? "").trim()).filter(Boolean),
  );
  const out = [...prev];
  for (const r of next) {
    const id = String(r.id ?? "").trim();
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(r);
  }
  return out;
}

async function fetchHarvestPlanPages(
  baseParams: Record<string, string | number | undefined>,
  options?: { perPage?: number; maxPages?: number },
): Promise<{
  planRows: Array<Record<string, unknown>>;
  totalRecords: number | null;
}> {
  const perPage = options?.perPage ?? 200;
  const maxPages = options?.maxPages ?? 20;
  let page = 1;
  let allRows: Array<Record<string, unknown>> = [];
  let totalRecords: number | null = null;

  for (;;) {
    const res = await stsProxyGetHarvestingIndex({
      ...baseParams,
      page,
      per_page: perPage,
    });
    const pageRows = res.rows.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object",
    );
    if (totalRecords == null && res.totalRecords != null) {
      totalRecords = res.totalRecords;
    }
    if (pageRows.length === 0) break;
    allRows = mergeHarvestPlanRows(allRows, pageRows);
    const hasMore =
      res.totalRecords != null
        ? allRows.length < res.totalRecords
        : pageRows.length >= perPage;
    if (!hasMore) break;
    page += 1;
    if (page > maxPages) break;
  }

  return { planRows: allRows, totalRecords };
}

/**
 * Merge `project_harvesting_plan` rows into each Monday project row's `subitems`.
 * Card progress uses delivery_harvest_date on subitems; plan rows often hold the real
 * delivered totals while Monday JSON subitems stay empty (see project detail page).
 */
export function mergeProjectSubitemsWithHarvestPlan(
  projectRows: Array<Record<string, unknown>>,
  harvestPlanRows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (projectRows.length === 0 || harvestPlanRows.length === 0) return projectRows;
  const planByProjectId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of harvestPlanRows) {
    const pid = String(row.project_id ?? "").trim();
    if (!pid) continue;
    const list = planByProjectId.get(pid) ?? [];
    list.push(row);
    planByProjectId.set(pid, list);
  }
  return projectRows.map((row) => {
    const projectId = String(row.project_id ?? "").trim();
    if (!projectId) return row;
    const planRows = planByProjectId.get(projectId) ?? [];
    if (planRows.length === 0) return row;
    const existingSubitems = parseRowSubitems(row.subitems);
    const planIds = new Set(
      planRows
        .map((x) => String(x.id ?? "").trim())
        .filter(Boolean),
    );
    const merged = [
      ...planRows,
      ...existingSubitems.filter((x) => {
        const sid = String(x.id ?? "").trim();
        return !sid || !planIds.has(sid);
      }),
    ];
    return {
      ...row,
      subitems: JSON.stringify(merged),
    };
  });
}

/**
 * All harvesting plan rows for project list card progress (every farm / creator on each project).
 */
export async function fetchAllHarvestPlanIndexRows(options?: {
  perPage?: number;
  maxPages?: number;
  userId?: string | number;
}): Promise<Array<Record<string, unknown>>> {
  const { planRows } = await fetchHarvestPlanPages(
    {
      user_id: options?.userId,
      project_progress_scope: HARVEST_PROJECT_PROGRESS_SCOPE,
    },
    options,
  );
  return planRows;
}

/** All plan rows for one project — progress bars / delivered totals (not harvest history list). */
export async function fetchAllHarvestPlanPagesForProjectProgress(
  projectId: string,
  options?: { perPage?: number; maxPages?: number; userId?: string | number },
): Promise<{
  planRows: Array<Record<string, unknown>>;
  totalRecords: number | null;
}> {
  const normalized = projectId.trim();
  return fetchHarvestPlanPages(
    {
      project_id: normalized,
      user_id: options?.userId,
      project_progress_scope: HARVEST_PROJECT_PROGRESS_SCOPE,
    },
    options,
  );
}
