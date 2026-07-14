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
  farmsSave: "/api/farms/save",
  farmsRemove: "/api/farms/remove",
  /** Role-scoped list (`Projects::index` → `filterVisibleProjectsForUser`). */
  projects: "/api/projects",
  /** View-all / form catalog still role-aware (`filterVisibleProjectsForUser`). */
  projectsAll: "/api/projects/react_get_all_projects",
  /** Harvest create/edit only — all `deleted=0`, no role filter. */
  projectsAllForHarvest: "/api/projects/react_get_all_projects_for_harvest",
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
  /** Privileged admin — sts_items CRUD */
  itemsAdminList: "/api/items/admin_list",
  itemsFormOptions: "/api/items/form_options",
  /** GET `/api/items/catalog` — product catalog (category ids in `Items::catalog`). */
  itemsCatalog: "/api/items/catalog",
  itemsSave: "/api/items/save",
  itemsRemove: "/api/items/remove",
  itemsImportPreview: "/api/items/import_preview",
  itemsImportCommit: "/api/items/import_commit",
  /** Privileged admin — item categories CRUD */
  itemCategoriesAdminList: "/api/item_categories/admin_list",
  itemCategoriesSave: "/api/item_categories/save",
  itemCategoriesRemove: "/api/item_categories/remove",
  /** Privileged admin — sts_ware_unit_type CRUD */
  wareUnitTypesAdminList: "/api/ware_unit_types/admin_list",
  wareUnitTypesSave: "/api/ware_unit_types/save",
  wareUnitTypesRemove: "/api/ware_unit_types/remove",
  /** Privileged admin — sts_brands CRUD */
  brandsAdminList: "/api/brands/admin_list",
  brandsSave: "/api/brands/save",
  brandsRemove: "/api/brands/remove",
  /** Fertilizer application log */
  fertilizerUsage: "/api/fertilizer_usage",
  fertilizerUsageSave: "/api/fertilizer_usage/save",
  fertilizerUsageRemove: "/api/fertilizer_usage/remove",
  /** Farm-specific item/vehicle display aliases */
  farmAliases: "/api/farm_aliases",
  farmAliasesSave: "/api/farm_aliases/save",
  farmAliasesRemove: "/api/farm_aliases/remove",
  /** Fuel usage log */
  fuelUsage: "/api/fuel_usage",
  fuelUsageSave: "/api/fuel_usage/save",
  fuelUsageRemove: "/api/fuel_usage/remove",
  fuelUsageSuggestCost: "/api/fuel_usage/suggest_cost",
  fuelUsageDiaryReport: "/api/fuel_usage/diary_report",
  fuelUsageImportBulk: "/api/fuel_usage/import_bulk",
  /** Fleet consumable stock ledger (fuel diesel/petrol, fertilizer by item) */
  fleetStockLedger: "/api/fleet_stock_ledger",
  fleetStockLedgerSave: "/api/fleet_stock_ledger/save",
  fleetStockLedgerRecalculate: "/api/fleet_stock_ledger/recalculate",
  fleetStockLedgerRemove: "/api/fleet_stock_ledger/remove",
  fleetFuelImports: "/api/fleet_fuel_imports",
  fleetFuelImportsSave: "/api/fleet_fuel_imports/save",
  fleetFuelImportsRemove: "/api/fleet_fuel_imports/remove",
  fleetFuelImportsImportBulk: "/api/fleet_fuel_imports/import_bulk",
  machinery: "/api/machinery",
  machineryCatalog: "/api/machinery/catalog",
  machinerySave: "/api/machinery/save",
  machineryRemove: "/api/machinery/remove",
  machineryProducts: "/api/machinery/products",
  /** GET fleet machinery type catalog (`Machinery_types::index`). */
  machineryTypes: "/api/machinery_types",
  machineryTypesSave: "/api/machinery_types/save",
  machineryTypesRemove: "/api/machinery_types/remove",
  /** Fleet option catalogs in sts_settings (statuses, service types, fuel types). */
  fleetOptionCatalogs: "/api/fleet_option_catalogs",
  fleetOptionCatalogsSave: "/api/fleet_option_catalogs/save",
  fleetOptionCatalogsRemove: "/api/fleet_option_catalogs/remove",
  /** Fleet equipment registry (sts_equipment + sts_items catalog). */
  equipment: "/api/equipment",
  equipmentCatalog: "/api/equipment/catalog",
  equipmentFormOptions: "/api/equipment/form_options",
  equipmentSave: "/api/equipment/save",
  equipmentRemove: "/api/equipment/remove",
  equipmentDetail: "/api/equipment/detail",
  equipmentSaveServiceLog: "/api/equipment/save_service_log",
  equipmentRemoveServiceLog: "/api/equipment/remove_service_log",
  equipmentUpdateHourMeter: "/api/equipment/update_hour_meter",
  equipmentRemoveHourMeterReading: "/api/equipment/remove_hour_meter_reading",
  equipmentCategoryConfig: "/api/equipment/category_config",
  equipmentSaveCategory: "/api/equipment/save_category",
  fleetItemCategoriesConfig: "/api/fleet_item_categories/category_config",
  fleetItemCategoriesSave: "/api/fleet_item_categories/save_category",
  vehicleInspections: "/api/vehicle_inspections",
  vehicleInspectionsFormOptions: "/api/vehicle_inspections/form_options",
  vehicleInspectionsSave: "/api/vehicle_inspections/save",
  vehicleInspectionsRemove: "/api/vehicle_inspections/remove",
  keyareas: "/api/keyareas",
  keyareasSave: "/api/keyareas/save",
  keyareasRemove: "/api/keyareas/remove",
  /** Fertilizer product catalog (name lookup) */
  fertilizerProducts: "/api/fertilizer_product",
  fertilizerProductsSave: "/api/fertilizer_product/save",
  fertilizerProductsRemove: "/api/fertilizer_product/remove",
  projectPaces: "/api/project_paces",
  projectPacesSave: "/api/project_paces/save",
  projectPacesRemove: "/api/project_paces/remove",
  /** GET `Warehouse::index` — FAST warehouse stock (`country_id`, `brand_id`, `category_id`, `search`). */
  warehouse: "/api/warehouse",
  warehousePreviewImportFast: "/api/warehouse/preview_import_fast",
  warehouseImportFast: "/api/warehouse/import_fast",
  /** GET cron preview — Odoo fetch + mapped rows (no DB write). */
  warehouseOdooStock: "/api/warehouse/odoo_stock",
  /** GET|POST cron sync — Odoo fetch + FAST import. */
  warehouseCronSyncOdoo: "/api/warehouse/cron_sync_odoo",
  /** GET `Harvesting::index` — query: `page`, `per_page`, `search`, `farm_id`, `status_id`, … */
  harvesting: "/api/harvesting",
  /** GET nested inventory report (`Harvesting::react_get_inventory_report`): `country`, `year`, `product_id`, `farm_id`. */
  inventoryReport: "/api/harvesting/react_get_inventory_report",
  /** GET Flutter Monday list source (`DynamicTableDataRepo.dynamicTableDataUrl`). */
  mondayDynamicTableData: "/api/harvesting/react_get_harvesting_table",
  /** GET filtered Monday project row count only (no row payload). */
  mondayDynamicTableTotal: "/api/harvesting/react_get_harvesting_table_total",
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
  /** POST JSON: write failed import rows into `files/system/Harvests-Import-Template.xlsx`. */
  harvestSaveImportErrors: "/api/harvesting/save_harvest_import_errors",
  /** POST bulk update `project_harvesting_plan.description` for Limit / Over limit markers. */
  updateHarvestLimitDescriptions: "/api/harvesting/react_update_harvest_limit_descriptions",
  /** POST recalc estimate quantities + pace_grass_batch_quantities after actual harvest date. */
  recalculatePaceAfterActual:
    "/api/harvesting/react_recalculate_pace_quantities_after_actual",
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
  /** GET inventory forecast snapshots (aggregate + zone rows). */
  forecastSnapshots: "/api/forecast/snapshots",
  /** GET inventory totals by farm / farm×grass (cap C rollup). */
  forecastInventoryTotals: "/api/forecast/inventory_totals",
  forecastMeta: "/api/forecast/meta",
  forecastDayDetail: "/api/forecast/day_detail",
  forecastRegrowthStats: "/api/forecast/regrowth_stats",
  /** POST queue forward/full rebuild. */
  forecastRebuild: "/api/forecast/rebuild",
  /** POST mechanism-specific snapshot queue (harvest_plan, project_pace, …). */
  forecastSnapshotUpdate: "/api/forecast/snapshot_update",
  /** GET forecast queue depth / processing state. */
  forecastQueueStatus: "/api/forecast/queue_status",
  /** POST process one forecast queue job immediately. */
  forecastProcessQueue: "/api/forecast/process_queue",
  /** Help & knowledge base */
  help: "/api/help",
  helpCategories: "/api/help/categories",
  helpCategory: "/api/help/category",
  helpSaveCategory: "/api/help/save_category",
  helpRemoveCategory: "/api/help/remove_category",
  helpArticles: "/api/help/articles",
  helpArticle: "/api/help/article",
  helpSaveArticle: "/api/help/save_article",
  helpRemoveArticle: "/api/help/remove_article",
  helpSuggestions: "/api/help/suggestions",
  helpIncrementView: "/api/help/increment_view",
  helpCanManage: "/api/help/can_manage",
  /** POST change password for the logged-in user (`Profile::change_password`). */
  profileChangePassword: "/api/profile/change_password",
} as const;
