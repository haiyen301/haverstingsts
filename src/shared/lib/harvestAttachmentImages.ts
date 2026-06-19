/**
 * Harvest plan image fields: parse nested JSON / strings and resolve display URLs
 * (uses {@link resolveHarvestDisplayUrl} — same rules as Flutter).
 */

import { parseHarvestImageField } from "@/features/harvesting/lib/parseHarvestDocImages";
import { resolveHarvestDisplayUrl } from "@/shared/config/stsUrls";

import { parseJsonMaybe, parseSubitems } from "@/shared/lib/parseJsonMaybe";

export const HARVEST_ATTACHMENT_SOURCES: Array<{ field: string; label: string }> = [
  { field: "payment_img", label: "Payment Image" },
  { field: "shipping_note_img", label: "Shipping Note" },
  { field: "thermostats_img", label: "Thermostats" },
  { field: "truck_license_plate_img", label: "Truck License Plate" },
  { field: "product_being_cut_img", label: "Product Being Cut" },
  { field: "truck_loaded_img", label: "Truck Loaded" },
];

/** Main column or `*_data` from `get_detail` (grouped `{ image, file }`). */
export function getHarvestRowImageFieldValue(
  row: Record<string, unknown>,
  field: string,
): unknown {
  const main = row[field];
  if (main != null && main !== "") return main;
  const dataKey = `${field}_data`;
  const d = row[dataKey];
  if (d != null && d !== "") return d;
  return null;
}

export function getAttachmentUrls(raw: unknown): string[] {
  const parsed = parseHarvestImageField(raw);
  const out = new Set<string>();
  for (const fn of [...parsed.imageFileNames, ...parsed.documentFileNames]) {
    const url = resolveHarvestDisplayUrl(fn);
    if (url) out.add(url);
  }
  if (out.size > 0) return Array.from(out);

  // Legacy fallback for unstructured nested values (non-harvest field shapes).
  const visit = (val: unknown) => {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const x of val) visit(x);
      return;
    }
    if (typeof val === "object") {
      const rec = val as Record<string, unknown>;
      const fileName = String(rec.file_name ?? "").trim();
      if (fileName) out.add(resolveHarvestDisplayUrl(fileName));
      for (const v of Object.values(rec)) visit(v);
      return;
    }
    if (typeof val !== "string") return;
    const s = val.trim();
    if (!s) return;
    const jsonParsed = parseJsonMaybe(s);
    if (jsonParsed !== s) {
      visit(jsonParsed);
    }
  };
  visit(raw);
  return Array.from(out);
}

export function getFirstAttachmentUrlFromSubitems(
  rawSubitems: unknown,
  field: string,
): string {
  const subitems = parseSubitems(rawSubitems);
  for (const sub of subitems) {
    const hit = getAttachmentUrls(sub[field])[0];
    if (hit) return hit;
  }
  return "";
}
