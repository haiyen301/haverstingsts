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
  farmZones: "/api/zones",
  zones: "/api/zones",
  zonesSave: "/api/zones/save",
  zonesRemove: "/api/zones/remove",
  staffs: "/api/base/react_get_staffs",
  staffToggleLogin: "/api/base/react_toggle_staff_login",
  staffSave: "/api/base/react_save_staff",
  staffDelete: "/api/base/react_delete_staff",
  farms: "/api/farms",
  /** Role-scoped list (`Projects::index` → `filterVisibleProjectsForUser`). */
  projects: "/api/projects",
  /** All active projects (`deleted = 0`), no role filter — `Projects::react_get_all_projects`. */
  projectsAll: "/api/projects/react_get_all_projects",
  countries: "/api/countries",
  countriesSave: "/api/countries/save",
  products: "/api/items",
  /** GET `Project_form_catalog::index` — use `?admin=1` for inactive rows too. */
  projectFormCatalog: "/api/project_form_catalog",
  /** POST `Project_form_catalog::save` */
  projectFormCatalogSave: "/api/project_form_catalog/save",
  /** POST `Project_form_catalog::remove` */
  projectFormCatalogRemove: "/api/project_form_catalog/remove",
  zoneConfigurations: "/api/zone_configurations",
  zoneConfigurationsSave: "/api/zone_configurations/save",
  zoneConfigurationsRemove: "/api/zone_configurations/remove",
  inventoryBalance: "/api/inventory_balance",
  inventoryBalanceSave: "/api/inventory_balance/save",
  inventoryBalanceRemove: "/api/inventory_balance/remove",
  zoneAutoConfigurations: "/api/zone_auto_configurations",
  zoneAutoProfiles: "/api/zone_auto_configurations/profiles",
  zoneAutoSave: "/api/zone_auto_configurations/save",
  zoneAutoCalculate: "/api/zone_auto_configurations/calculate",
  zoneAutoRunDaily: "/api/zone_auto_configurations/run_daily",
  zoneAutoEstimateHarvestArea: "/api/zone_auto_configurations/estimate_harvest_area",
  regrowthRules: "/api/regrowth_rules",
  /** POST persist regrowth form (`Regrowth_rules::save`). */
  regrowthRulesSave: "/api/regrowth_rules/save",
  /** GET `Grasses::index` — active grass rows (`sts_grasses` / `grasses`). */
  grasses: "/api/grasses",
  grassesSave: "/api/grasses/save",
  grassesRemove: "/api/grasses/remove",
  keyareas: "/api/keyareas",
  keyareasSave: "/api/keyareas/save",
  keyareasRemove: "/api/keyareas/remove",
  /** GET `Harvesting::index` — query: `page`, `per_page`, `search`, `farm_id`, `status_id`, … */
  harvesting: "/api/harvesting",
  /** GET nested inventory report (`Harvesting::react_get_inventory_report`): `country`, `year`, `product_id`, `farm_id`. */
  inventoryReport: "/api/harvesting/react_get_inventory_report",
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
  /** POST bulk update `project_harvesting_plan.description` for Limit / Over limit markers. */
  updateHarvestLimitDescriptions: "/api/harvesting/react_update_harvest_limit_descriptions",
  /** GET `Timeline::index` — query: `from`, `to` (Y-m-d H:i:s), optional `include_unscheduled`, `unscheduled_limit`. */
  timeline: "/api/timeline",
  /** GET `Timeline::detail` — query: `id`. */
  timelineDetail: "/api/timeline/detail",
  /** POST create/update task (`Timeline::save`). */
  timelineSave: "/api/timeline/save",
  /** POST soft-delete (`Timeline::remove`). */
  timelineRemove: "/api/timeline/remove",
  alerts: "/api/alerts",
  alertDetail: "/api/alerts/detail",
  alertSave: "/api/alerts/save",
  alertMarkRead: "/api/alerts/mark_read",
  alertMarkAllRead: "/api/alerts/mark_all_read",
  alertMarkTypeRead: "/api/alerts/mark_type_read",
  /** POST archive current user's copy (`Alerts::remove`). */
  alertRemove: "/api/alerts/remove",
  /** POST update event text/media for alerts the user created (`Alerts::update_event`). */
  alertUpdateEvent: "/api/alerts/update_event",
  roles: "/api/roles",
  rolesSave: "/api/roles/save",
  rolesRemove: "/api/roles/remove",
  /** GET public maintenance status (DB via sts_settings). */
  maintenanceGet: "/api/base/react_get_maintenance_mode",
  /** POST toggle maintenance — user id 409 only. */
  maintenanceSave: "/api/base/react_save_maintenance_mode",
  /** GET activity audit log — user id 409 only (`Activity_logs::index`). */
  activityLogs: "/api/activity_logs",
} as const;
