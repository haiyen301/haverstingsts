/**
 * STSPortal API paths. Routing is defined in STSPortal
 * `plugins/STSApi/Config/Routes.php`: for each controller, `GET /api/{name}` maps to
 * `{Name}::index`, and `GET /api/{name}/{method}` maps to `{Name}::{method}`.
 *
 * Farms, projects, countries, items → `index()` (Bearer JWT via `getUserFromToken`).
 * Base helpers stay explicit: `/api/base/react_get_*`.
 *
 * Use with Next proxy: `stsProxyGet(path)` → `/api/...` with Authorization.
 */
export const STS_API_PATHS = {
  farmZones: "/api/base/react_get_farm_zones",
  staffs: "/api/base/react_get_staffs",
  farms: "/api/farms",
  projects: "/api/projects",
  countries: "/api/countries",
  products: "/api/items",
  /** GET `Harvesting::index` — query: `page`, `per_page`, `search`, `farm_id`, `status_id`, … */
  harvesting: "/api/harvesting",
  /** GET Flutter Monday list source (`DynamicTableDataRepo.dynamicTableDataUrl`). */
  mondayDynamicTableData: "/api/harvesting/react_get_harvesting_table",
  /** POST Flutter Monday update repo endpoint. */
  mondayUpdateParentItem: "/api/harvesting/react_update_parent_item",
  /** POST find dynamic rows by (field_name, field_value). */
  mondayFindDynamicByField: "/api/harvesting/react_get_dynamic_table_data_by_field",
  /** POST Flutter Monday project image upload endpoint (`react_parent_upload_files`). */
  mondayParentUploadFiles: "/api/harvesting/react_parent_upload_files",
  /** POST delete parent row or sub-item (`react_delete_parent_or_sub_item`). Body: tableId, tableName, rowId, type. */
  mondayDeleteParentOrSubItem: "/api/harvesting/react_delete_parent_or_sub_item",
  /** POST multipart: `records` JSON + `*_image` files (see Flutter `flutterAddNewSubRow`). */
  flutterAddHarvestSubRow: "/api/harvesting/flutter_add_new_sub_row",
} as const;
