import { parseJsonMaybe } from "./parseJson";

export function extractProjectImageFileNamesFromRow(row: Record<string, unknown>): string[] {
  const result: string[] = [];
  const raw = parseJsonMaybe(row.project_img);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === "string" && item.trim()) {
        result.push(item.trim());
        continue;
      }
      if (typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const f = String(rec.file_name ?? "").trim();
        if (f) result.push(f);
      }
    }
    return result;
  }
  if (raw && typeof raw === "object") {
    const f = String((raw as Record<string, unknown>).file_name ?? "").trim();
    if (f) result.push(f);
    return result;
  }
  if (typeof raw === "string" && raw.trim()) {
    result.push(raw.trim());
  }
  return result;
}

export function findFirstFileNameFromAny(v: unknown): string | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = findFirstFileNameFromAny(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const direct = String(rec.file_name ?? "").trim();
    if (direct) return direct;
    for (const value of Object.values(rec)) {
      const hit = findFirstFileNameFromAny(value);
      if (hit) return hit;
    }
  }
  return undefined;
}
