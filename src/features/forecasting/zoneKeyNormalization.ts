/** Shared zone bucket key — harvest plans and zone-config both use `sts_zones.id` from `/admin/zones`. */

import {
  type FarmZoneReferenceRow,
  zoneCatalogBucketKey,
} from "@/shared/lib/harvestReferenceData";

export const FORECAST_NOZONE_ZONE = "nozone";

let forecastZoneCatalog: FarmZoneReferenceRow[] = [];

/** Keep in sync with `/api/zones` reference data before forecast / inventory zone matching. */
export function setForecastZoneCatalog(farmZones: FarmZoneReferenceRow[]): void {
  forecastZoneCatalog = farmZones;
}

export function getForecastZoneCatalog(): FarmZoneReferenceRow[] {
  return forecastZoneCatalog;
}

export function canonicalZoneBucketKey(
  raw: string,
  farmZones?: FarmZoneReferenceRow[],
): string {
  return zoneCatalogBucketKey(raw, farmZones ?? forecastZoneCatalog);
}

export function isForecastNoZoneBucketKey(normalizedZone: string): boolean {
  return canonicalZoneBucketKey(normalizedZone) === FORECAST_NOZONE_ZONE;
}
