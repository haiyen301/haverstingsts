/**
 * @module features/project
 * Monday project list / card: row merge, sort, card view model, UI entry.
 */
export {
  mergeMondayDisplayData,
  sortMondayProjectRows,
  buildMondayEditArgs,
} from "./lib/mondayRowOps";
export {
  mondayProjectAliasTitleFromRow,
  mondayProjectTitleFromRow,
} from "./lib/resolveMondayProjectRowFields";
export type { MondayProjectRowLike } from "./lib/resolveMondayProjectRowFields";
export {
  buildProjectDataFromServerRow,
  calculateOverallProjectProgressFromRaw,
  resolveMondayCardStatusForListFilter,
  resolveReactHarvestingImageUrl,
} from "./lib/buildProjectCardData";
export {
  extractProjectImageFileNamesFromRow,
  findFirstFileNameFromAny,
} from "./lib/projectImageHelpers";
export {
  mergeProjectSubitemsWithHarvestPlan,
  mergeHarvestPlanRows,
  fetchAllHarvestPlanIndexRows,
  fetchHarvestPlanIndexRowsForProjects,
  fetchAllHarvestPlanPagesForProjectProgress,
  HARVEST_PROJECT_PROGRESS_SCOPE,
} from "./lib/mergeProjectSubitemsWithHarvestPlan";
export type { ProjectListItemProps } from "./model/projectListProps";
export { ProjectListItem } from "./ui/ProjectListItem";
