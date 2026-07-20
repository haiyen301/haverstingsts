import type {
  FleetOption,
  FleetOptionCatalogKey,
} from "@/features/fleet/api/fleetOptionCatalogApi";

/** next-intl `useTranslations` return (supports `.has` for missing keys). */
export type FleetOptionLabelTranslator = {
  (key: string): string;
  has: (key: string) => boolean;
};

export function resolveFleetOptionLabel(
  t: FleetOptionLabelTranslator,
  catalog: FleetOptionCatalogKey,
  value: string,
  fallbackLabel?: string,
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return fallbackLabel?.trim() || "";

  const key = `optionLabels.${catalog}.${trimmed}`;
  if (t.has(key)) {
    return t(key);
  }

  const fallback = fallbackLabel?.trim();
  return fallback || trimmed;
}

export function localizeFleetOptions(
  options: FleetOption[],
  catalog: FleetOptionCatalogKey,
  t: FleetOptionLabelTranslator,
): FleetOption[] {
  return options.map((option) => ({
    ...option,
    label: resolveFleetOptionLabel(t, catalog, option.value, option.label),
  }));
}
