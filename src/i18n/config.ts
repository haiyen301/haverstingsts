// export const LOCALES = ["en", "th", "vi"] as const;
export const LOCALES = ["en", "th", "vi"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export function isAppLocale(value: string): value is AppLocale {
  return LOCALES.includes(value as AppLocale);
}
