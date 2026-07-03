"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { LOCALES, type AppLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/widgets/layout/ThemeToggle";

const LOCALE_FLAG_MAP: Record<AppLocale, { code: string; alt: string }> = {
  en: { code: "gb", alt: "English" },
  th: { code: "th", alt: "Thai" },
  vi: { code: "vn", alt: "Vietnamese" },
};

const themeToggleClassName =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/20 text-sidebar-foreground transition-colors hover:border-sidebar-foreground/25 hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type SidebarMenuProps = {
  compact?: boolean;
};

export function SidebarMenu({ compact = false }: SidebarMenuProps) {
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const t = useTranslations("SidebarProfile");

  const switchLocale = (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <div className={cn("space-y-4", compact ? "flex flex-col items-center" : "")}>
      <div className={cn("space-y-2.5", compact ? "flex w-full flex-col items-center" : "")}>
        {!compact ? (
          <div>
            <p
              id="sidebar-language-label"
              className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45"
            >
              {t("languageLabel")}
            </p>
            <p id="sidebar-language-hint" className="sr-only">
              {t("languageSwitchHint")}
            </p>
          </div>
        ) : (
          <>
            <p id="sidebar-language-label" className="sr-only">
              {t("languageLabel")}
            </p>
            <p id="sidebar-language-hint" className="sr-only">
              {t("languageSwitchHint")}
            </p>
          </>
        )}
        <div
          className={
            compact
              ? "flex w-full flex-col gap-1.5"
              : "flex w-full gap-1 rounded-lg border border-sidebar-border bg-sidebar-accent/20 p-1"
          }
          role="radiogroup"
          aria-labelledby="sidebar-language-label"
          aria-describedby="sidebar-language-hint"
        >
          {LOCALES.map((item) => {
            const selected = item === locale;
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => switchLocale(item)}
                className={cn(
                  "flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  compact
                    ? cn(
                        "h-9 w-full rounded-lg border",
                        selected
                          ? "border-primary/60 bg-primary/10 text-sidebar-foreground shadow-sm"
                          : "border-sidebar-border bg-sidebar-accent/20 text-sidebar-foreground/80 hover:border-sidebar-foreground/25 hover:bg-sidebar-accent/40",
                      )
                    : cn(
                        "min-h-9 flex-1 gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium",
                        selected
                          ? "bg-primary/15 text-sidebar-foreground shadow-sm ring-1 ring-primary/50"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                      ),
                )}
                title={t(`languageNames.${item}`)}
                aria-label={t(`languageNames.${item}`)}
              >
                <img
                  src={`/flags/${LOCALE_FLAG_MAP[item].code}.svg`}
                  alt=""
                  width={20}
                  height={15}
                  className={cn(
                    "h-3.5 w-5 shrink-0 rounded-sm object-cover",
                    selected ? "" : "opacity-80",
                  )}
                  aria-hidden
                />
                {!compact ? (
                  <span className="leading-none tracking-tight">{t(`languages.${item}`)}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "flex w-full items-center gap-2",
          compact ? "justify-center" : "justify-between",
        )}
      >
        {!compact ? (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
            {t("themeLabel")}
          </p>
        ) : null}
        <ThemeToggle className={themeToggleClassName} />
      </div>
    </div>
  );
}
