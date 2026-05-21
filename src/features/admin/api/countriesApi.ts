"use client";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyGet, stsProxyPostJson } from "@/shared/api/stsProxyClient";

export type CountryRow = {
  id: number;
  country_code: string;
  country_name: string;
  name?: string | null;
  sovereignty?: string | null;
  iso_3166_1_alpha_2?: string | null;
  iso_3166_1_alpha_3?: string | null;
  iso_3166_1_numeric?: string | null;
  iso_3166_2_link?: string | null;
  tld?: string | null;
  active?: number | boolean | string | null;
  deleted?: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CountrySavePayload = {
  id: number;
  name?: string;
  active?: boolean;
};

export function countryDisplayName(row: CountryRow): string {
  const name = String(row.name ?? row.country_name ?? "").trim();
  return name || String(row.country_code ?? "").trim() || "—";
}

export function isCountryActive(row: CountryRow): boolean {
  const v = row.active;
  if (v === true || v === 1 || v === "1") return true;
  const text = String(v ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "active";
}

export async function fetchAdminCountries(): Promise<CountryRow[]> {
  const data = await stsProxyGet<unknown[]>(STS_API_PATHS.countries);
  return Array.isArray(data) ? (data as CountryRow[]) : [];
}

export async function saveAdminCountry(
  payload: CountrySavePayload,
): Promise<CountryRow> {
  return stsProxyPostJson<CountryRow>(STS_API_PATHS.countriesSave, payload);
}
