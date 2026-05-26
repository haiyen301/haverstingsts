import { parseJsonMaybe } from "@/shared/lib/parseJsonMaybe";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";

function parseRowSubitems(raw: unknown): Array<Record<string, unknown>> {
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
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

/** Paginated harvesting index used by project list / dashboard cards. */
export async function fetchAllHarvestPlanIndexRows(options?: {
  perPage?: number;
  maxPages?: number;
}): Promise<Array<Record<string, unknown>>> {
  const perPage = options?.perPage ?? 200;
  const maxPages = options?.maxPages ?? 20;
  const allHarvestRows: Array<Record<string, unknown>> = [];
  let page = 1;
  let totalPages = 1;
  do {
    const harvestRes = await stsProxyGetHarvestingIndex({
      page,
      per_page: perPage,
    });
    allHarvestRows.push(
      ...harvestRes.rows.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === "object",
      ),
    );
    totalPages = Math.max(1, harvestRes.totalPages);
    page += 1;
  } while (page <= totalPages && page <= maxPages);
  return allHarvestRows;
}
