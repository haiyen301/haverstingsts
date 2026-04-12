/**
 * Project entity types (Monday / dynamic table parity with Flutter).
 */

export type ProjectStatus = "Ongoing" | "Future" | "Done" | "Warning";

export interface ProjectItem {
  name: string;
  required: number;
  delivered: number;
  remaining: number;
  percentage: number;
}

export interface ProjectAssignee {
  name: string;
  avatar: string;
}

export interface ProjectData {
  id: string;
  name: string;
  subtitle: string;
  country_id: string;
  country_name: string;
  holes: number;
  estimatedStartDate: string;
  actualStartDate: string;
  endDate: string;
  image: string;
  progress: number;
  status: ProjectStatus;
  items: ProjectItem[];
  tags: string[];
  assignee: ProjectAssignee;
}

export type QuantityRequiredProject = {
  product_id?: string;
  quantity?: string | number;
  /** M² target when `uom` is m² / sqm (parity with `quantity_required_sprig_sod` JSON). */
  quantity_m2?: string | number | null;
  /** Kg target when `uom` is kg. */
  quantity_kg?: string | number | null;
  uom?: string;
  zone_id?: string;
};

export type SubItem = {
  /** When set, must match parent Monday row `project_id` for harvest math (plan parity). */
  project_id?: string;
  product_id?: string;
  quantity?: string | number;
  quantity_harvested?: string | number;
  /** Delivered to site / committed delivery */
  delivery_harvest_date?: string;
  /** Harvest completed (fallback when delivery date not set yet) */
  actual_harvest_date?: string;
  uom?: string;
};

export interface MondayProjectServerRow {
  id?: string | number;
  row_id?: string | number;
  table_id?: string | number;
  table_name?: string;
  project_id?: string | number;
  title?: string;
  name?: string;
  /** Golf club / stadium label (matches `react_get_harvesting_table`). */
  alias_title?: string;
  /** Company / customer name from dynamic table row. */
  company_name?: string;
  country?: string;
  country_id?: string | number;
  no_of_holes?: string | number;
  project_type?: string;
  key_areas?: unknown;
  pic?: string | number;
  status?: string;
  status_app?: string;
  /** When set: server plan-table gate (see Harvesting.php). True = any matching plan row has actual_harvest_date; false = Future by that gate; omit/null = legacy subitem-only path. */
  harvest_plan_started?: boolean | null;
  deadline?: string;
  created_at?: string;
  lasted_updated?: string;
  estimated_harvest_date?: string;
  project_img?: unknown;
  quantity_required_sprig_sod?: unknown;
  subitems?: unknown;
  start_date?: string;
  estimate_start_date?: string;
}

export type MondayDynamicTableResponse = {
  rows: MondayProjectServerRow[];
  raw: unknown;
};

export type DynamicTableDataQuery = {
  /** Flutter `filter` map in DynamicTableDataRepo.getAllDynamicTableData */
  filter?: Record<string, string | number | boolean | null | undefined>;
  page?: number;
  perPage?: number;
};

/** `data` payload from `Harvesting::react_update_parent_item` (stsProxyPostJson returns this). */
export type MondayUpdateParentItemResponse = {
  saved_id?: unknown;
  row_data?: Record<string, unknown>;
  project?: Record<string, unknown> | null;
};

export interface BuildProjectDataOptions {
  /** Flutter baseController.getProjectModelById(project_id)?.title */
  getProjectTitleById?: (projectId?: string) => string | undefined;
  /** Flutter baseController.getCountryNameById(country_id) */
  getCountryNameById?: (countryId?: string) => string | undefined;
  /** Flutter baseController.getUserNameById(pic) */
  getUserNameById?: (userId?: string) => string | undefined;
  /** Flutter getGrassName(product_id) */
  getProductNameById?: (productId?: string) => string | undefined;
  /** Flutter baseController.getUserValueById(pic, "image") -> profile avatar URL */
  getUserAvatarById?: (userId?: string) => string | undefined;
  /** Optional already-resolved image URL from row model */
  projectImageUrl?: string | null;
  /** Localized or formatted label for `project_type` (card tag). */
  getProjectTypeLabel?: (projectTypeRaw?: string) => string | undefined;
}

export interface MondayProjectEditArgs {
  rowId?: string;
  tableId?: string;
  rowData: Record<string, unknown>;
}

/** Equivalent shape of `DynamicTableRow` used as `rowData` in MondayScreen. */
export interface MondayDynamicRowLike {
  rowId?: string;
  tableId?: string;
  status?: string;
  createdAt?: string;
  projectImg?: unknown;
  subitems?: unknown;
  quantityRequiredSprigSod?: unknown;
  toJson?: () => Record<string, unknown>;
}
