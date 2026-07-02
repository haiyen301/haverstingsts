import { readFileSync } from "node:fs";
import { join } from "node:path";

import { unstable_noStore } from "next/cache";
import { cookies } from "next/headers";
import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import type { AppLocale } from "@/i18n/config";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/config";

function loadMessages(locale: AppLocale): AbstractIntlMessages {
  const filePath = join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(filePath, "utf8")) as AbstractIntlMessages;
}

/**
 * next-intl request config (wired in `next.config.ts` via `createNextIntlPlugin`).
 * Locale priority: request locale -> cookie (`NEXT_LOCALE`/`locale`) -> `DEFAULT_LOCALE`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  unstable_noStore();
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
    messages: loadMessages(locale),
  };
});
