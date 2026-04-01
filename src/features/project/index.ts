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
  buildProjectDataFromServerRow,
  resolveReactHarvestingImageUrl,
} from "./lib/buildProjectCardData";
export {
  extractProjectImageFileNamesFromRow,
  findFirstFileNameFromAny,
} from "./lib/projectImageHelpers";
export type { ProjectListItemProps } from "./model/projectListProps";
export { ProjectListItem } from "./ui/ProjectListItem";
