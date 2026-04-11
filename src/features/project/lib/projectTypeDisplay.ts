/**
 * Canonical `project_type` values saved to the server (aligned with Project form radios).
 */
export const PROJECT_TYPE_VALUES = [
  "Landscaping",
  "Sports Field - New",
  "Sports Field - Renovation",
  "Golf Course - New",
  "Golf Course - Renovation",
] as const;

export type ProjectTypeValue = (typeof PROJECT_TYPE_VALUES)[number];

const LEGACY_DISPLAY: Record<string, string> = {
  new: "New",
  grassing_project: "New",
  renovation: "Renovation",
  renovation_project: "Renovation",
};

/** English label for tags / fallback when no i18n callback is provided. */
export function formatProjectTypeForDisplay(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if ((PROJECT_TYPE_VALUES as readonly string[]).includes(s)) return s;
  // Legacy rows saved as lowercase before canonical casing
  if (s.toLowerCase() === "landscaping") return "Landscaping";
  const key = s.toLowerCase();
  if (LEGACY_DISPLAY[key]) return LEGACY_DISPLAY[key];
  return s;
}

/** Maps stored value to `ProjectForm.*` translation key (without namespace). */
export function projectTypeMessageKey(stored: string): string | null {
  const v = String(stored ?? "").trim();
  const map: Record<string, string> = {
    Landscaping: "projectTypeLandscaping",
    landscaping: "projectTypeLandscaping",
    "Sports Field - New": "projectTypeSportsFieldNew",
    "Sports Field - Renovation": "projectTypeSportsFieldRenovation",
    "Golf Course - New": "projectTypeGolfCourseNew",
    "Golf Course - Renovation": "projectTypeGolfCourseRenovation",
  };
  return map[v] ?? null;
}

/**
 * Localized label for project type (form, list tags, detail).
 * `t` should resolve `ProjectForm.${key}` (e.g. pass `(k) => tBase(\`ProjectForm.${k}\`)`).
 */
export function translateProjectType(
  stored: string,
  t: (projectFormKey: string) => string,
): string {
  const v = String(stored ?? "").trim();
  if (!v) return "";
  const mk = projectTypeMessageKey(v);
  if (mk) return t(mk);
  const low = v.toLowerCase();
  if (low === "new" || low === "grassing_project") return t("typeNew");
  if (low === "renovation" || low === "renovation_project") return t("typeRenovation");
  return formatProjectTypeForDisplay(v);
}

/** Same normalization as Excel import (`normalizeLoose`). */
function normalizeLooseImport(v: string): string {
  return v
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Map spreadsheet / pasted text to stored `project_type` (canonical list or legacy `new` / `renovation`).
 */
export function normalizeProjectTypeFromImportCell(raw: string): string {
  const s = normalizeLooseImport(raw);
  if (!s) return "";
  for (const opt of PROJECT_TYPE_VALUES) {
    if (normalizeLooseImport(opt) === s) return opt;
  }
  if (s.includes("landscaping")) return "Landscaping";
  if (s.includes("sports field") || s.includes("sportsfield")) {
    if (s.includes("new")) return "Sports Field - New";
    if (s.includes("reno") || s.includes("renovation")) return "Sports Field - Renovation";
  }
  if (s.includes("golf") && s.includes("course")) {
    if (s.includes("new")) return "Golf Course - New";
    if (s.includes("reno") || s.includes("renovation")) return "Golf Course - Renovation";
  }
  if (s === "new" || s === "grassingproject" || s === "grassing project") return "new";
  if (s === "renovation" || s === "renovationproject" || s === "renovation project") {
    return "renovation";
  }
  return "";
}
