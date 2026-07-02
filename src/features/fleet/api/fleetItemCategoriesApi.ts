import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGet,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FleetCategoryOption = {
  id: number;
  title: string;
  parent_id?: number | null;
  path?: string | null;
};

export type FleetCategoryModuleConfig = {
  category_ids: number[];
  categories?: Array<{
    id: number;
    title?: string | null;
    parent_id?: number | null;
    path?: string | null;
  }>;
  category_id?: number;
  category_title?: string | null;
  excluded_category_ids?: number[];
  excluded_categories?: Array<{
    id: number;
    title?: string | null;
    parent_id?: number | null;
    path?: string | null;
  }>;
};

export type FleetCategoryModule =
  | "equipment"
  | "fertilizer_usage"
  | "vehicle_inspection";

export type FleetCategorySettingsConfig = {
  categories: FleetCategoryOption[];
  equipment: FleetCategoryModuleConfig;
  fertilizer_usage: FleetCategoryModuleConfig;
  vehicle_inspection: FleetCategoryModuleConfig;
};

export async function fetchFleetCategorySettingsConfig(): Promise<FleetCategorySettingsConfig> {
  return stsProxyGet<FleetCategorySettingsConfig>(
    STS_API_PATHS.fleetItemCategoriesConfig,
  );
}

export async function saveFleetCategorySettings(
  module: FleetCategoryModule,
  categoryIds: number[],
  excludedCategoryIds?: number[],
): Promise<{ module: FleetCategoryModule; config: FleetCategoryModuleConfig }> {
  const payload: {
    module: FleetCategoryModule;
    category_ids: number[];
    excluded_category_ids?: number[];
  } = {
    module,
    category_ids: categoryIds,
  };

  if (module === "vehicle_inspection" && excludedCategoryIds) {
    payload.excluded_category_ids = excludedCategoryIds;
  }

  return stsProxyPostJson(STS_API_PATHS.fleetItemCategoriesSave, payload);
}
