import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  stsProxyGetWithParams,
  stsProxyPostFormData,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

export type FertilizerUsageImage = {
  /** Relative name under `files/timeline_files/fertilizer_usage/`, e.g. `07/1789..._file-x.jpg`. */
  file_name: string;
  file_size?: number | string | null;
  file_id?: string | number | null;
  service_type?: string | null;
  file_type?: string | null;
};

export type FertilizerUsageRow = {
  id: number;
  applied_date: string;
  farm_id: number;
  grass_id: number;
  zone_id: number | string;
  item_id: number;
  amount: number | string;
  remaining_qty?: number | string | null;
  is_transfer?: number | boolean | null;
  transfer_to_farm_id?: number | null;
  transfer_to_farm_name?: string | null;
  rate?: number | string | null;
  rate_uom?: string | null;
  operator_id?: number | string | null;
  operator_name?: string | null;
  sender_user_ids?: number[] | string | null;
  receiver_user_ids?: number[] | string | null;
  notes?: string | null;
  farm_name?: string | null;
  grass_name?: string | null;
  product_name?: string | null;
  product_unit?: string | null;
  alias_name?: string | null;
  alias_title?: string | null;
  zone_name?: string | null;
  images?: FertilizerUsageImage[] | string | null;
};

/** Normalize `row.images` (API array or raw JSON string) into a flat image list. */
export function parseFertilizerUsageImages(
  value: FertilizerUsageRow["images"],
): FertilizerUsageImage[] {
  let decoded: unknown = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      decoded = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(decoded)) return [];
  const images: FertilizerUsageImage[] = [];
  for (const item of decoded) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.file_name === "string" && record.file_name.trim()) {
      images.push(record as FertilizerUsageImage);
      continue;
    }
    // Upload helper may nest file rows one level deep.
    for (const sub of Object.values(record)) {
      if (
        sub &&
        typeof sub === "object" &&
        typeof (sub as Record<string, unknown>).file_name === "string"
      ) {
        images.push(sub as FertilizerUsageImage);
      }
    }
  }
  return images;
}

/** Parse stored user-id JSON (or array) into numeric ids. */
export function parseFertilizerUsageUserIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((id) => Number.isFinite(id) && id > 0);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return parseFertilizerUsageUserIds(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function formatFertilizerUsageUserLabels(
  ids: number[],
  staffNameById: Map<string, string>,
): string {
  if (!ids.length) return "—";
  return ids
    .map((id) => staffNameById.get(String(id)) ?? `#${id}`)
    .join(", ");
}

export type FertilizerUsageSavePayload = {
  id?: number;
  applied_date: string;
  farm_id: number;
  grass_id: number;
  zone_id: number | string;
  item_id: number;
  amount: number;
  is_transfer?: boolean;
  transfer_to_farm_id?: number | null;
  rate?: number | null;
  rate_uom?: string | null;
  sender_user_ids?: number[];
  receiver_user_ids?: number[];
  notes?: string;
  alias_title?: string;
  alias_name?: string;
};

export type FertilizerUsageListParams = {
  farm_id?: number;
  farm_ids?: string;
  transfer_to_farm_id?: number;
  applied_from?: string;
  applied_to?: string;
  period?: "all" | "month" | "quarter" | "year";
};

export async function fetchFertilizerUsage(
  params?: FertilizerUsageListParams,
): Promise<FertilizerUsageRow[]> {
  return stsProxyGetWithParams<FertilizerUsageRow[]>(
    STS_API_PATHS.fertilizerUsage,
    params,
  );
}

export async function saveFertilizerUsage(
  payload: FertilizerUsageSavePayload,
): Promise<FertilizerUsageRow> {
  return stsProxyPostJson<FertilizerUsageRow>(STS_API_PATHS.fertilizerUsageSave, payload);
}

export async function removeFertilizerUsage(id: number): Promise<void> {
  await stsProxyPostJson(STS_API_PATHS.fertilizerUsageRemove, { id });
}

/**
 * Upload/remove images for a usage row. New files are stored under
 * `files/timeline_files/fertilizer_usage/<month>/` and merged with existing ones.
 */
export async function uploadFertilizerUsageImages(params: {
  id: number;
  files?: File[];
  imagesRemoved?: string[];
}): Promise<FertilizerUsageRow> {
  const formData = new FormData();
  formData.append("id", String(params.id));
  for (const file of params.files ?? []) {
    formData.append("images[]", file, file.name);
  }
  if (params.imagesRemoved && params.imagesRemoved.length > 0) {
    formData.append("images_removed", JSON.stringify(params.imagesRemoved));
  }
  return stsProxyPostFormData<FertilizerUsageRow>(
    STS_API_PATHS.fertilizerUsageUploadFiles,
    formData,
  );
}

export type FertilizerUsageImportEntryPayload = {
  applied_date: string;
  farm_id: number;
  grass_id: number;
  zone_id: number | string;
  item_id: number;
  amount: number;
  is_transfer?: boolean;
  transfer_to_farm_id?: number | null;
  rate?: number | null;
  rate_uom?: string | null;
  operator_id?: number | null;
  notes?: string | null;
  alias_title?: string | null;
  /** Excel row number — used to map uploaded images after bulk insert. */
  client_row_index?: number;
  /**
   * Image basenames declared in the Excel `images` column.
   * Backend resolves them under `files/timeline_files/fertilizer_usage/`.
   */
  image_names?: string[];
};

export type FertilizerUsageImportResult = {
  summary: {
    created: number;
    skipped: number;
    total: number;
  };
  created_rows?: { id: number; client_row_index: number }[];
  errors: { row: number; message: string }[];
};

export async function importFertilizerUsageBulk(payload: {
  entries: FertilizerUsageImportEntryPayload[];
}): Promise<FertilizerUsageImportResult> {
  return stsProxyPostJson<FertilizerUsageImportResult>(
    STS_API_PATHS.fertilizerUsageImportBulk,
    payload,
  );
}
