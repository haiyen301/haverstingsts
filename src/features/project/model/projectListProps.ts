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
  getKeyAreaNameById?: (keyAreaId?: string | number) => string | undefined;
  getUserAvatarById?: (userId?: string) => string | undefined;
  /** Opens project detail (card click). */
  onViewProject?: (args: MondayProjectEditArgs) => void;
  /** Clone of Flutter onEditProject args in monday_screen.dart (pencil icon). */
  onEditProject?: (args: MondayProjectEditArgs) => void;
  /** Controls visibility of the top-right edit/manage affordance. */
  showEditAction?: boolean;
}
