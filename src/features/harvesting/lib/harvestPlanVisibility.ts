import { parseFarmIdsFromMeta } from "@/shared/lib/harvestReferenceData";
import type { SessionUser } from "@/shared/lib/sessionUser";

/** Mirrors `Project_harvesting_plan_model::_build_created_by_scope_where` on the client. */
export type HarvestPlanVisibilityCtx = {
  userId?: string | number | null;
  userFarmIds: string[];
  canViewAll: boolean;
  /** `sts_users.id` where `is_admin = 1` — for admin-created plan rows. */
  adminCreatorIds: Set<string>;
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

export function buildHarvestPlanVisibilityCtx(
  user: SessionUser | null | undefined,
  canViewAll: boolean,
  staffs: unknown[] = [],
): HarvestPlanVisibilityCtx {
  const farmMeta = String(user?.farm_user_id ?? user?.farmUserId ?? "").trim();
  return {
    userId: user?.id,
    userFarmIds: parseFarmIdsFromMeta(farmMeta || undefined),
    canViewAll,
    adminCreatorIds: buildAdminCreatorIdsFromStaffs(staffs),
  };
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

  if (ctx.userFarmIds.length === 0) return false;

  const farmId = String(record.farm_id ?? record.farmId ?? "").trim();
  const farmMatches = Boolean(farmId && ctx.userFarmIds.includes(farmId));
  if (!farmMatches) return false;

  if (isEmptyHarvestCreatedBy(record.created_by ?? record.createdBy)) return true;
  if (ctx.adminCreatorIds.has(createdBy)) return true;

  return false;
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
 * - `show-readonly`: API loads every plan row for the project (`project_progress_scope=1`);
 *   rows stay visible; edit/delete only when `canUserManageHarvestPlanRecord` passes.
 * - `hide`: only rows the user may manage (same rules as `/harvest` list) — legacy behavior.
 *
 * Toggle here when product wants hide vs show-without-edit for other users' records.
 */
export type ProjectDetailHarvestHistoryDisplayMode = "show-readonly" | "hide";

export const PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE: ProjectDetailHarvestHistoryDisplayMode =
  "show-readonly";

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
