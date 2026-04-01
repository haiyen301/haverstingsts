/**
 * Harvest plan image fields: parse nested JSON / strings and resolve display URLs
 * (uses {@link resolveHarvestDisplayUrl} — same rules as Flutter).
 */

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

export function getAttachmentUrls(raw: unknown): string[] {
  const out = new Set<string>();
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
    const parsed = parseJsonMaybe(s);
    if (parsed !== s) {
      visit(parsed);
      return;
    }
    const re =
      /(https?:\/\/[^\s"'<>]+|\/?files\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)|\/?timeline_files\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)|[A-Za-z0-9_\-\/]+\.(?:png|jpe?g|gif|webp))/gi;
    const matches = s.match(re) ?? [];
    for (const m of matches) {
      const cleaned = m.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "").trim();
      if (!cleaned) continue;
      out.add(resolveHarvestDisplayUrl(cleaned));
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
