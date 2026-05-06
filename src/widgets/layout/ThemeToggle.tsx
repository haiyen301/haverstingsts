"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { useTheme } from "@/shared/theme/ThemeProvider";

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme, mounted } = useTheme();
  const t = useTranslations("Theme");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={
        className ??
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted"
      }
      aria-label={t("toggleAria")}
      title={theme === "dark" ? t("useLight") : t("useDark")}
      disabled={!mounted}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
