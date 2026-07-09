import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type MachineryTypeRow = {
  id: number;
  label: string;
  slug: string;
  sort_order: number;
  active: boolean;
};

export const DEFAULT_MACHINERY_TYPES = [
  "Tractor",
  "Harvester",
  "Mower",
  "Sprayer",
  "Loader",
  "Forklift",
  "Truck",
  "Trailer",
  "Roller",
  "Aerator",
  "Sod Cutter",
  "Irrigation Pump",
  "Generator",
  "ATV/UTV",
  "Other",
] as const;

export async function fetchMachineryTypes(admin = false): Promise<MachineryTypeRow[]> {
  return stsProxyGetWithParams<MachineryTypeRow[]>(STS_API_PATHS.machineryTypes, admin ? { admin: 1 } : undefined);
}

export async function saveMachineryType(payload: {
  id?: number;
  label: string;
  sort_order?: number;
  active?: boolean;
  slug?: string;
}): Promise<MachineryTypeRow> {
  return stsProxyPostJson<MachineryTypeRow>(STS_API_PATHS.machineryTypesSave, payload);
}

export async function removeMachineryType(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.machineryTypesRemove, { id });
}

export function machineryTypeLabels(rows: MachineryTypeRow[] | null | undefined): string[] {
  if (!rows?.length) return [...DEFAULT_MACHINERY_TYPES];
  return rows.filter((r) => r.active !== false).map((r) => r.label);
}

export function machineryTypeSlugify(label: string): string {
  let s = label.trim().toLowerCase();
  s = s.replace(/[^a-z0-9]+/gi, "_");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  return s || "type";
}

export function findMachineryTypeDuplicate(
  rows: MachineryTypeRow[],
  label: string,
  slug: string,
  excludeId = 0,
): "label" | "slug" | null {
  const labelTrim = label.trim();
  const slugLower = slug.trim().toLowerCase();
  if (!labelTrim || !slugLower) return null;

  for (const row of rows) {
    if (row.id === excludeId) continue;
    if (row.label.trim().toLowerCase() === labelTrim.toLowerCase()) return "label";
    if (row.slug.trim().toLowerCase() === slugLower) return "slug";
  }

  return null;
}
