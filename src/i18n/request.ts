import { cookies } from "next/headers";
import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import type { AppLocale } from "@/i18n/config";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/config";

import en from "../../messages/en.json";
import th from "../../messages/th.json";
import vi from "../../messages/vi.json";

const messagesByLocale: Record<AppLocale, AbstractIntlMessages> = {
  en,
  th,
  vi,
};

/**
 * next-intl request config (wired in `next.config.ts` via `createNextIntlPlugin`).
 * Locale priority: request locale -> cookie (`NEXT_LOCALE`/`locale`) -> `DEFAULT_LOCALE`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const cookieStore = await cookies();
  const routeLocale = String((await requestLocale) ?? "");
  const cookieLocale =
    cookieStore.get("NEXT_LOCALE")?.value ??
    cookieStore.get("locale")?.value;
  const locale = isAppLocale(routeLocale)
    ? routeLocale
    : cookieLocale && isAppLocale(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;

  return {
    locale,
    messages: messagesByLocale[locale],
  };
});
