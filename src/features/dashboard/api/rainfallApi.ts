import { stsProxyGet, stsProxyGetWithParams, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type RainfallRecentEntry = {
  id: number | null;
  date: string;
  farm_id: number;
  farm_name: string;
  weather_location_id: string;
  rainfall_mm: number;
  open_meteo_mm: number | null;
  source: "manual" | "open_meteo" | string;
  notes?: string | null;
};

export type RainfallDashboardData = {
  year: number;
  farms: Array<{ farm_id: number; farm_name: string; weather_location_id: string }>;
  summary: {
    today_mm: number;
    month_mm: number;
    year_mm: number;
    rain_days: number;
  };
  monthly: Array<{ month: string; mm: number }>;
  recent: RainfallRecentEntry[];
  permissions: {
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
  };
};

export type RainfallConfiguredFarm = {
  farm_id: number;
  farm_name: string;
  weather_location_id: string;
};

export async function fetchRainfallConfiguredFarms(): Promise<RainfallConfiguredFarm[]> {
  return stsProxyGet<RainfallConfiguredFarm[]>("/api/weather/rainfall_configured_farms");
}

export async function fetchRainfallDashboard(params: {
  year?: number;
  farmIds?: string[];
}): Promise<RainfallDashboardData> {
  const data = await stsProxyGetWithParams<RainfallDashboardData>("/api/weather/rainfall_dashboard", {
    year: params.year,
    farm_ids: params.farmIds?.length ? params.farmIds.join(",") : undefined,
  });
  return data;
}

export async function saveRainfallManual(payload: {
  id?: number;
  farm_id: number;
  record_date: string;
  rainfall_mm: number;
  notes?: string | null;
}): Promise<Record<string, unknown>> {
  return stsProxyPostJson<Record<string, unknown>>("/api/weather/rainfall_manual_save", payload);
}

export async function removeRainfallManual(id: number): Promise<void> {
  await stsProxyPostJson("/api/weather/rainfall_manual_remove", { id });
}
