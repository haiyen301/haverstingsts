import type {
  BuildProjectDataOptions,
  MondayProjectEditArgs,
  MondayProjectServerRow,
  ProjectData,
} from "@/entities/projects";

/** Props for the Monday-style project card (Flutter `MondayProjectCard`). */
export interface ProjectListItemProps {
  project?: ProjectData;
  /** Raw server row (Flutter widget.data + rowData) */
  serverRow?: MondayProjectServerRow;
  options?: BuildProjectDataOptions;
  getProjectTitleById?: (projectId?: string) => string | undefined;
  getCountryNameById?: (countryId?: string) => string | undefined;
  getUserNameById?: (userId?: string) => string | undefined;
  getProductNameById?: (productId?: string) => string | undefined;
  getUserAvatarById?: (userId?: string) => string | undefined;
  /** Clone of Flutter onEditProject args in monday_screen.dart */
  onEditProject?: (args: MondayProjectEditArgs) => void;
}
