import { parseJsonMaybe } from "./parseJson";

export function extractProjectImageFileNamesFromRow(row: Record<string, unknown>): string[] {
  const raw = parseJsonMaybe(row.project_img);
  const result = new Set<string>();

  const collectFileNames = (v: unknown, allowPlainString = false): void => {
    if (!v) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (allowPlainString && s) result.add(s);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) collectFileNames(item, allowPlainString);
      return;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const direct = String(rec.file_name ?? "").trim();
      if (direct) result.add(direct);
      for (const value of Object.values(rec)) collectFileNames(value, false);
    }
  };

  collectFileNames(raw, true);
  return Array.from(result);
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
