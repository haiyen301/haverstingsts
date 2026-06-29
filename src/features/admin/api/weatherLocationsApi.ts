import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type WeatherLocationRow = {
  id?: number;
  location_id: string;
  label: string;
  country_code?: string | null;
  country_name?: string | null;
  latitude: number | string;
  longitude: number | string;
  timezone: string;
  farm_id?: number | null;
  farm_name?: string | null;
  is_active?: number | boolean;
  is_country_default?: number | boolean;
  sort_order?: number;
  notes?: string | null;
  last_verified_at?: string | null;
};

export type WeatherLocationOption = {
  location_id: string;
  label: string;
};

export async function fetchWeatherLocations(): Promise<WeatherLocationRow[]> {
  return stsProxyGet<WeatherLocationRow[]>("/api/weather/open_meteo_locations");
}

export async function fetchWeatherLocationOptions(): Promise<WeatherLocationOption[]> {
  return stsProxyGet<WeatherLocationOption[]>("/api/weather/open_meteo_location_options");
}

export async function saveWeatherLocation(
  payload: Partial<WeatherLocationRow> & { location_id: string; label: string; latitude: number; longitude: number },
): Promise<WeatherLocationRow> {
  return stsProxyPostJson<WeatherLocationRow>("/api/weather/open_meteo_locations_save", payload);
}

export async function verifyWeatherLocation(payload: {
  latitude: number;
  longitude: number;
  timezone?: string;
}): Promise<{
  timezone: string;
  sample_date: string | null;
  rainfall_mm: number;
  precipitation_mm: number;
  snowfall_cm: number;
}> {
  return stsProxyPostJson("/api/weather/open_meteo_locations_verify", payload);
}

export async function geocodeWeatherLocation(name: string, countryCode?: string): Promise<{
  latitude: number;
  longitude: number;
  timezone: string;
}> {
  const qs = new URLSearchParams({ name });
  if (countryCode) qs.set("country_code", countryCode);
  return stsProxyGet(`/api/weather/open_meteo_locations_geocode?${qs.toString()}`);
}
