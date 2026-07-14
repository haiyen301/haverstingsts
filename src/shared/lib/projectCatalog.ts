import { canViewAllModuleData } from "@/shared/auth/permissions";
import type { SessionUser } from "@/shared/lib/sessionUser";

type ProjectCatalogSlice = {
  allProjects: unknown[];
  roleVisibleProjects: unknown[];
  projects: unknown[];
};

type HarvestProjectCatalogSlice = {
  /** Unscoped catalog from `react_get_all_projects_for_harvest`. */
  allProjectsForHarvest: unknown[];
  roleVisibleProjects: unknown[];
  projects: unknown[];
};

/** Whether the client may request the unscoped `react_get_all_projects` catalog. */
export function canFetchUnscopedProjectCatalog(
  user: SessionUser | null | undefined,
): boolean {
  return canViewAllModuleData(user, "projects");
}

/** Dropdown / form / export project rows — scoped unless user has view-all on projects. */
export function projectCatalogForUser(
  state: ProjectCatalogSlice,
  user: SessionUser | null | undefined,
): unknown[] {
  const scoped =
    state.roleVisibleProjects.length > 0 ? state.roleVisibleProjects : state.projects;
  if (canFetchUnscopedProjectCatalog(user) && state.allProjects.length > 0) {
    return state.allProjects;
  }
  return scoped;
}

/**
 * Harvest create/edit project dropdown — always the full active catalog when loaded.
 * Other screens must keep using `projectCatalogForUser`.
 */
export function projectCatalogForHarvestForm(
  state: HarvestProjectCatalogSlice,
): unknown[] {
  if (state.allProjectsForHarvest.length > 0) {
    return state.allProjectsForHarvest;
  }
  return state.roleVisibleProjects.length > 0
    ? state.roleVisibleProjects
    : state.projects;
}
