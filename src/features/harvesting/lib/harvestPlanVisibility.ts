import { isSuperAdmin } from "@/shared/auth/permissions";
import { parseFarmIdsFromMeta } from "@/shared/lib/harvestReferenceData";
import { parseQuantityRequiredRows } from "@/shared/lib/parseJsonMaybe";
import type { SessionUser } from "@/shared/lib/sessionUser";

/** Mirrors `Project_harvesting_plan_model::_build_created_by_scope_where` on the client. */
export type HarvestPlanVisibilityCtx = {
  userId?: string | number | null;
  userFarmIds: string[];
  canViewAll: boolean;
  /** `sts_users.id` where `is_admin = 1` — for admin-created plan rows. */
  adminCreatorIds: Set<string>;
  /** Priority 2: `quantity_required_sprig_sod` lines for the open project (project detail). */
  quantityRequiredFarmIds?: Set<string>;
  /** Priority 1 on project detail: any plan row farm_id on this project in user's farm list. */
  projectHasHarvestPlanFarmMatch?: boolean;
};

export function isEmptyHarvestCreatedBy(value: unknown): boolean {
  const s = String(value ?? "").trim();
  return !s || s === "0";
}

export function buildAdminCreatorIdsFromStaffs(staffs: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const row of staffs) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (Number(rec.is_admin ?? 0) !== 1) continue;
    const id = String(rec.id ?? "").trim();
    if (id) out.add(id);
  }
  return out;
}

export function extractFarmIdsFromQuantityRequired(raw: unknown): Set<string> {
  const out = new Set<string>();
  for (const line of parseQuantityRequiredRows(raw)) {
    const farmId = String(line.farm_id ?? "").trim();
    if (farmId && farmId !== "0") out.add(farmId);
  }
  return out;
}

export function buildHarvestPlanVisibilityCtx(
  user: SessionUser | null | undefined,
  canViewAll: boolean,
  staffs: unknown[] = [],
  options?: {
    quantityRequiredSprigSod?: unknown;
    harvestPlanRecords?: Array<Record<string, unknown>>;
  },
): HarvestPlanVisibilityCtx {
  const farmMeta = String(user?.farm_user_id ?? user?.farmUserId ?? "").trim();
  const userFarmIds = parseFarmIdsFromMeta(farmMeta || undefined);
  /** farm_user_id always scopes harvest history; only super admin bypasses. */
  const effectiveCanViewAll =
    canViewAll && (userFarmIds.length === 0 || isSuperAdmin(user));
  const userFarmIdSet = new Set(userFarmIds);
  let projectHasHarvestPlanFarmMatch = false;
  if (userFarmIdSet.size > 0 && options?.harvestPlanRecords?.length) {
    projectHasHarvestPlanFarmMatch = options.harvestPlanRecords.some((record) => {
      const farmId = String(record.farm_id ?? record.farmId ?? "").trim();
      return Boolean(farmId && userFarmIdSet.has(farmId));
    });
  }

  return {
    userId: user?.id,
    userFarmIds,
    canViewAll: effectiveCanViewAll,
    adminCreatorIds: buildAdminCreatorIdsFromStaffs(staffs),
    quantityRequiredFarmIds: extractFarmIdsFromQuantityRequired(
      options?.quantityRequiredSprigSod,
    ),
    projectHasHarvestPlanFarmMatch,
  };
}

function quantityRequiredFarmMatchesUser(ctx: HarvestPlanVisibilityCtx): boolean {
  if (ctx.userFarmIds.length === 0 || !ctx.quantityRequiredFarmIds?.size) return false;
  if (ctx.projectHasHarvestPlanFarmMatch) return false;
  return ctx.userFarmIds.some((farmId) => ctx.quantityRequiredFarmIds?.has(farmId));
}

function canUserViewHarvestPlanRecordByFarmScope(
  record: Record<string, unknown>,
  ctx: HarvestPlanVisibilityCtx,
): boolean {
  if (ctx.userFarmIds.length === 0) return false;

  const farmId = String(record.farm_id ?? record.farmId ?? "").trim();
  if (farmId && ctx.userFarmIds.includes(farmId)) {
    return true;
  }

  if (quantityRequiredFarmMatchesUser(ctx)) {
    return true;
  }

  return false;
}

export function canUserViewHarvestPlanRecord(
  record: Record<string, unknown>,
  ctx: HarvestPlanVisibilityCtx,
): boolean {
  if (ctx.canViewAll) return true;

  const uid = String(ctx.userId ?? "").trim();
  if (!uid) return false;

  const createdBy = String(record.created_by ?? record.createdBy ?? "").trim();
  if (createdBy && createdBy !== "0" && createdBy === uid) return true;

  return canUserViewHarvestPlanRecordByFarmScope(record, ctx);
}

export function filterHarvestPlanRecordsForUser<T extends Record<string, unknown>>(
  records: T[],
  ctx: HarvestPlanVisibilityCtx,
): T[] {
  if (ctx.canViewAll) return records;
  return records.filter((r) => canUserViewHarvestPlanRecord(r, ctx));
}

/**
 * Project detail — Harvest History (`/projects/detail` only).
 *
 * - Progress bars use a separate API call with `project_progress_scope=1` (all plan rows).
 * - Harvest history list uses scoped API + client filter (`hide` = rows user may view).
 *
 * Toggle to `show-readonly` only if product wants other users' rows visible without edit.
 */
export type ProjectDetailHarvestHistoryDisplayMode = "show-readonly" | "hide";

export const PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE: ProjectDetailHarvestHistoryDisplayMode =
  "hide";

/**
 * Edit/delete on project detail harvest history — mirrors the view table in
 * `doc/prompt/harvest-plan-visibility-rules.prompt.md` (self, view-all, empty/admin creator + farm match).
 * Does NOT grant manage on `created_by` = another regular user (those rows may still display in show-readonly mode).
 */
export function canUserManageHarvestPlanRecord(
  record: Record<string, unknown>,
  ctx: HarvestPlanVisibilityCtx,
): boolean {
  return canUserViewHarvestPlanRecord(record, ctx);
}

export function filterHarvestHistoryForProjectDetail<T extends Record<string, unknown>>(
  records: T[],
  ctx: HarvestPlanVisibilityCtx,
  mode: ProjectDetailHarvestHistoryDisplayMode = PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE,
): T[] {
  if (mode === "hide") {
    return filterHarvestPlanRecordsForUser(records, ctx);
  }
  return records;
}
