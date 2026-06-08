/**
 * Re-localizes alert title/body that were persisted in English (e.g. created under EN locale)
 * so the My Alerts feed matches the current UI language.
 */

type TForm = (key: string, values?: Record<string, string | number>) => string;

const NEW_PROJECT_TITLE = /^New project:\s*(.+)$/i;
const PROJECT_UPDATED_TITLE = /^Project updated:\s*(.+)$/i;
const NEW_HARVEST_TITLE = /^New harvest:\s*(.+)$/i;
const HARVEST_UPDATED_TITLE = /^Harvest updated:\s*(.+)$/i;
const INVENTORY_UPDATED_TITLE = /^Inventory updated:\s*(.+)$/i;

const PLANNED_SAVED_EN = /\s*·\s*(\d+)\s+planned harvests?\s+saved/gi;
const PLANNED_FAILED_EN =
  /\s*·\s*(\d+)\s+planned harvests?\s+failed to save(?:\s*\(([^)]*)\))?/gi;

export function localizeAlertTitleForDisplay(
  title: string,
  tHarvest: TForm,
  tProject: TForm,
  tInventory?: TForm,
): string {
  const trimmed = title.trim();
  const mNew = NEW_PROJECT_TITLE.exec(trimmed);
  if (mNew?.[1]) return tProject("alertNewProjectTitle", { name: mNew[1].trim() });
  const mUp = PROJECT_UPDATED_TITLE.exec(trimmed);
  if (mUp?.[1]) return tProject("alertProjectUpdatedTitle", { name: mUp[1].trim() });
  const mH = NEW_HARVEST_TITLE.exec(trimmed);
  if (mH?.[1]) return tHarvest("alertNewHarvestTitle", { grass: mH[1].trim() });
  const mHu = HARVEST_UPDATED_TITLE.exec(trimmed);
  if (mHu?.[1]) return tHarvest("alertHarvestUpdatedTitle", { grass: mHu[1].trim() });
  const mInv = INVENTORY_UPDATED_TITLE.exec(trimmed);
  if (mInv?.[1] && tInventory) {
    return tInventory("alertInventoryUpdatedTitle", { farm: mInv[1].trim() });
  }
  return title;
}

export function localizeAlertMessageForDisplay(message: string, tProject: TForm): string {
  let out = message;
  out = out.replace(PLANNED_FAILED_EN, (_full, countStr: string, inner?: string) => {
    const count = Number.parseInt(String(countStr), 10);
    const safeCount = Number.isFinite(count) ? count : 0;
    const detail =
      typeof inner === "string" && inner.trim() !== ""
        ? tProject("alertPlannedHarvestFailDetail", { message: inner.trim() })
        : "";
    return tProject("alertPlannedHarvestsFailedSuffix", { count: safeCount, detail });
  });
  out = out.replace(PLANNED_SAVED_EN, (_full, countStr: string) => {
    const count = Number.parseInt(String(countStr), 10);
    const safeCount = Number.isFinite(count) ? count : 0;
    return tProject("alertPlannedHarvestsSavedSuffix", { count: safeCount });
  });
  return out;
}

export const LOCALIZED_ALERT_CATEGORY_IDS = ["daily-harvest", "inventory", "new-project"] as const;
export type LocalizedAlertCategoryId = (typeof LOCALIZED_ALERT_CATEGORY_IDS)[number];

export function isLocalizedAlertCategoryId(id: string): id is LocalizedAlertCategoryId {
  return (LOCALIZED_ALERT_CATEGORY_IDS as readonly string[]).includes(id);
}

export function localizedFeedCategoryCopy(
  id: string,
  fallbackTitle: string,
  fallbackDesc: string,
  tMyAlerts: (key: string) => string,
): { title: string; description: string } {
  if (!isLocalizedAlertCategoryId(id)) {
    return { title: fallbackTitle, description: fallbackDesc };
  }
  switch (id) {
    case "daily-harvest":
      return {
        title: tMyAlerts("categoryDailyHarvestTitle"),
        description: tMyAlerts("categoryDailyHarvestDescription"),
      };
    case "inventory":
      return {
        title: tMyAlerts("categoryInventoryTitle"),
        description: tMyAlerts("categoryInventoryDescription"),
      };
    case "new-project":
      return {
        title: tMyAlerts("categoryNewProjectTitle"),
        description: tMyAlerts("categoryNewProjectDescription"),
      };
    default:
      return { title: fallbackTitle, description: fallbackDesc };
  }
}
