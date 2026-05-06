"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Calendar,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  Leaf,
  MoreHorizontal,
  Sun,
  Table2,
  X,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";

type NavLabelKey =
  | "dashboard"
  | "harvests"
  | "projects"
  | "overview"
  | "planning"
  | "forecasting"
  | "inventoryImport"
  | "weather";

type NavEntry = {
  path: string;
  labelKey: NavLabelKey;
  icon: ComponentType<{ className?: string }>;
};

type MobileBottomNavProps = {
  showInventoryImport: boolean;
};

export function MobileBottomNav({ showInventoryImport }: MobileBottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryTabs: NavEntry[] = [
    { path: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
    { path: "/harvest", labelKey: "harvests", icon: Leaf },
    { path: "/projects", labelKey: "projects", icon: FolderKanban },
    { path: "/weather", labelKey: "weather", icon: Sun },
  ];

  const moreItems: NavEntry[] = [
    { path: "/overview", labelKey: "overview", icon: Table2 },
    { path: "/planning", labelKey: "planning", icon: Calendar },
    { path: "/forecasting", labelKey: "forecasting", icon: BarChart3 },
    ...(showInventoryImport
      ? ([
          {
            path: "/inventory-import",
            labelKey: "inventoryImport",
            icon: FileSpreadsheet,
          },
        ] as NavEntry[])
      : []),
  ];

  const isActive = (path: string) => {
    if (path === "/projects") return pathname.startsWith("/projects");
    if (path === "/harvest") return pathname.startsWith("/harvest");
    if (path === "/forecasting") return pathname.startsWith("/forecasting");
    if (path === "/inventory-import") return pathname.startsWith("/inventory-import");
    return pathname === path;
  };

  const moreActive = moreItems.some((item) => isActive(item.path));

  const go = (path: string) => {
    router.push(path);
    setMoreOpen(false);
  };

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-x-0 bottom-0 z-50 rounded-t-2xl border border-sidebar-border bg-sidebar px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-sidebar-foreground shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{t("moreSheetTitle")}</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-lg p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto pb-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => go(item.path)}
                    className={`flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors ${
                      active
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <Icon className="h-6 w-6 shrink-0" />
                    <span className="text-xs font-medium leading-tight">
                      {t(item.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
        <div className="flex items-stretch justify-around">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.path);
            return (
              <button
                key={tab.path}
                type="button"
                onClick={() => router.push(tab.path)}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors ${
                  active
                    ? "text-primary dark:text-sidebar-primary"
                    : "text-sidebar-foreground/60"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{t(tab.labelKey)}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors ${
              moreActive || moreOpen
                ? "text-primary dark:text-sidebar-primary"
                : "text-sidebar-foreground/60"
            }`}
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" />
            <span>{t("more")}</span>
          </button>
        </div>
      </nav>
    </>
  );
}
