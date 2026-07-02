import type { EquipmentProductOption } from "@/features/fleet/api/equipmentApi";

export type EquipmentModelFields = Pick<
  EquipmentProductOption,
  | "commodity_name"
  | "model_short"
  | "sku_sts"
  | "commodity_code"
  | "thai_code"
  | "myanmar_code"
  | "malaysia_code"
  | "singapore_code"
>;

const CODE_FIELDS: Array<{ key: keyof EquipmentModelFields; label: string }> = [
  { key: "sku_sts", label: "SKU STS" },
  { key: "commodity_code", label: "VN" },
  { key: "thai_code", label: "TH" },
  { key: "myanmar_code", label: "MM" },
  { key: "malaysia_code", label: "MY" },
  { key: "singapore_code", label: "SG" },
];

/** Model lines for readonly display — each product code on its own line. */
export function formatEquipmentModelLines(item: EquipmentModelFields): string[] {
  const lines: string[] = [];

  for (const { key, label } of CODE_FIELDS) {
    const value = String(item[key] ?? "").trim();
    if (value) lines.push(`${label}: ${value}`);
  }

  return lines.length ? lines : ["—"];
}

export function formatEquipmentModelDisplay(item: EquipmentModelFields): string {
  return formatEquipmentModelLines(item).join("\n");
}

export function equipmentCardModelTitle(item: {
  model_short?: string | null;
  equipment_name?: string | null;
  model?: string | null;
}): string {
  const short = String(item.model_short ?? item.equipment_name ?? "").trim();
  if (short) return short;
  const first = String(item.model ?? "").split("\n")[0]?.trim();
  return first || "—";
}
