import { canViewAllModuleData } from "@/shared/auth/permissions";
import type { SessionUser } from "@/shared/lib/sessionUser";

type ProjectCatalogSlice = {
  allProjects: unknown[];
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
