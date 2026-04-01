/**
 * Parse `project_harvesting_plan` doc image columns for preview + `images_removed` / `files_removed`
 * (Flutter `CustomImageAndFileField` + `pathSource` = `UrlContainer.harvestingImgUrl`).
 */

import { resolveHarvestDisplayUrl } from "@/shared/config/stsUrls";
import {
  HARVEST_DOC_PHOTO_FIELDS,
  type HarvestDocPhotoField,
} from "@/features/harvesting/api/flutterHarvestSubmit";

export type ParsedHarvestDocSlot = {
  /** First image URL for `<img src>` (image[] only; not PDF rows). */
  previewUrl: string | null;
  /** Basenames/paths for `images_removed[field]` (grouped `image` or non-file rows). */
  imageFileNames: string[];
  /** Basenames/paths for `files_removed[field]` (grouped `file` or `file_type === "file"`). */
  documentFileNames: string[];
};

export { resolveHarvestDisplayUrl };

function extractFileNamesFromPhpSerialized(str: string): string[] {
  const out: string[] = [];
  const re = /file_name";s:\d+:"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function pushNameFromItem(
  item: unknown,
  imageNames: string[],
  docNames: string[],
): void {
  if (!item || typeof item !== "object" || !("file_name" in item)) return;
  const rec = item as Record<string, unknown>;
  const fn = String(rec.file_name ?? "").trim();
  if (!fn) return;
  const ft = String(rec.file_type ?? "").trim();
  if (ft === "file") docNames.push(fn);
  else imageNames.push(fn);
}

/**
 * Normalize one DB/API value: `{ image: [], file: [] }`, JSON string, plain URL, relative path, PHP-serialized blob, or legacy array.
 */
export function parseHarvestImageField(value: unknown): ParsedHarvestDocSlot {
  if (value == null || value === "") {
    return { previewUrl: null, imageFileNames: [], documentFileNames: [] };
  }

  if (Array.isArray(value)) {
    const imageNames: string[] = [];
    const docNames: string[] = [];
    for (const item of value) {
      pushNameFromItem(item, imageNames, docNames);
    }
    const firstImg = imageNames[0];
    return {
      previewUrl: firstImg ? resolveHarvestDisplayUrl(firstImg) : null,
      imageFileNames: imageNames,
      documentFileNames: docNames,
    };
  }

  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    const imageNames: string[] = [];
    const docNames: string[] = [];

    const imgList = o.image;
    if (Array.isArray(imgList)) {
      for (const item of imgList) {
        if (item && typeof item === "object" && "file_name" in item) {
          const fn = String((item as Record<string, unknown>).file_name ?? "").trim();
          if (fn) imageNames.push(fn);
        } else if (typeof item === "string" && item.trim()) {
          imageNames.push(item.trim());
        }
      }
    }
    const fileList = o.file;
    if (Array.isArray(fileList)) {
      for (const item of fileList) {
        if (item && typeof item === "object" && "file_name" in item) {
          const fn = String((item as Record<string, unknown>).file_name ?? "").trim();
          if (fn) docNames.push(fn);
        }
      }
    }

    if (imageNames.length || docNames.length) {
      const firstImg = imageNames[0];
      return {
        previewUrl: firstImg ? resolveHarvestDisplayUrl(firstImg) : null,
        imageFileNames: imageNames,
        documentFileNames: docNames,
      };
    }
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) {
      return { previewUrl: null, imageFileNames: [], documentFileNames: [] };
    }
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const base = s.split("/").pop() ?? "";
      return {
        previewUrl: s,
        imageFileNames: base ? [base] : [],
        documentFileNames: [],
      };
    }
    if (s.startsWith("{") || s.startsWith("[")) {
      try {
        return parseHarvestImageField(JSON.parse(s) as unknown);
      } catch {
        /* fallthrough */
      }
    }
    if (s.includes("file_name")) {
      const extracted = extractFileNamesFromPhpSerialized(s);
      if (extracted.length) {
        return {
          previewUrl: resolveHarvestDisplayUrl(extracted[0]),
          imageFileNames: extracted,
          documentFileNames: [],
        };
      }
    }
    const base = s.split("/").pop() ?? s;
    return {
      previewUrl: resolveHarvestDisplayUrl(s),
      imageFileNames: base ? [base] : [],
      documentFileNames: [],
    };
  }

  return { previewUrl: null, imageFileNames: [], documentFileNames: [] };
}

function getRowImageField(
  row: Record<string, unknown>,
  field: HarvestDocPhotoField,
): unknown {
  const main = row[field];
  if (main != null && main !== "") return main;
  const dataKey = `${field}_data`;
  if (dataKey in row) {
    const d = row[dataKey];
    if (d != null && d !== "") return d;
  }
  return null;
}

/** Parse all documentation slots from a harvesting plan row (GET index / id). */
export function parseHarvestDocImagesFromRow(
  row: Record<string, unknown>,
): Partial<Record<HarvestDocPhotoField, ParsedHarvestDocSlot>> {
  const out: Partial<Record<HarvestDocPhotoField, ParsedHarvestDocSlot>> = {};
  for (const field of HARVEST_DOC_PHOTO_FIELDS) {
    const raw = getRowImageField(row, field);
    const parsed = parseHarvestImageField(raw);
    if (
      parsed.previewUrl ||
      parsed.imageFileNames.length ||
      parsed.documentFileNames.length
    ) {
      out[field] = parsed;
    }
  }
  return out;
}
