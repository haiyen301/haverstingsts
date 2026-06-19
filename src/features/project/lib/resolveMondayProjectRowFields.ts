/**
 * Canonical Monday parent-row project labels from `react_get_harvesting_table`.
 *
 * Server enriches rows with `title` / `alias_title` from `sts_projects`.
 * Legacy aliases (`project_title`, `project_name`, `project_alias_title`, `name`)
 * are still accepted for older rows and SQL summary payloads.
 */

export type MondayProjectRowLike = Record<string, unknown>;

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Project display name — same resolution order as Flutter `MondayProjectRowFields.resolveTitle`. */
export function mondayProjectTitleFromRow(
  row: MondayProjectRowLike | null | undefined,
  options?: {
    catalogTitle?: string | null;
    projectId?: string | null;
    fallback?: string;
  },
): string {
  const catalog = String(options?.catalogTitle ?? "").trim();
  if (catalog) return catalog;

  const rec = row ?? {};
  const fromRow = firstNonEmpty(
    rec.title,
    rec.project_title,
    rec.project_name,
    rec.name,
  );
  if (fromRow) return fromRow;

  const id = String(options?.projectId ?? rec.project_id ?? "").trim();
  if (id) return id;

  return String(options?.fallback ?? "").trim();
}

/** Golf club / stadium label — same order as Flutter `resolveAliasTitle`. */
export function mondayProjectAliasTitleFromRow(
  row: MondayProjectRowLike | null | undefined,
): string {
  const rec = row ?? {};
  return firstNonEmpty(rec.alias_title, rec.project_alias_title);
}
