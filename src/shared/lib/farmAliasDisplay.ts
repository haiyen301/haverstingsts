export function farmAliasDisplayLabel(
  alias: string | null | undefined,
  canonicalName: string | null | undefined,
  fallback = "—",
): string {
  const aliasText = String(alias ?? "").trim();
  const name = String(canonicalName ?? "").trim();
  if (aliasText && name && aliasText !== name) {
    return `${aliasText} (${name})`;
  }
  return aliasText || name || fallback;
}
