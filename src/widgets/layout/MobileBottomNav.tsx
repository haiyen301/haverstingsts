"use client";

import { usePathname, useRouter } from "next/navigation";
import { FolderKanban, LayoutDashboard, Leaf, MoreHorizontal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { SessionUser } from "@/shared/lib/sessionUser";
import { canAccessModule } from "@/shared/auth/permissions";

type NavLabelKey = "dashboard" | "harvests" | "projects";

type PrimaryNavEntry = {
  path: string;
  labelKey: NavLabelKey;
  icon: ComponentType<{ className?: string }>;
  module?: string;
};

export type MobileMoreNavTab = {
  path: string;
  label: string;
  icon: LucideIcon;
  isActive?: (pathname: string) => boolean;
  disabled?: boolean;
};

export type MobileMoreNavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  isActive?: (pathname: string) => boolean;
  disabled?: boolean;
  badge?: number;
  tabs?: MobileMoreNavTab[];
};

export type MobileMoreNavSection = {
  id: string;
  title: string;
  items: MobileMoreNavItem[];
};

type MobileBottomNavProps = {
  moreSections: MobileMoreNavSection[];
  user?: SessionUser | null;
  footer?: ReactNode;
};

function MoreNavButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
      }`}
    >
      <Icon className="h-6 w-6 shrink-0" />
      <span className="text-xs font-medium leading-tight">{label}</span>
    </button>
  );
}

export function MobileBottomNav({ moreSections, user = null, footer }: MobileBottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Nav");
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!moreOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  const primaryTabs: PrimaryNavEntry[] = [
    { path: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, module: "dashboard" },
    { path: "/harvest", labelKey: "harvests", icon: Leaf, module: "harvests" },
    { path: "/projects", labelKey: "projects", icon: FolderKanban, module: "projects" },
  ];

  const visiblePrimaryTabs = primaryTabs.filter(
    (tab) => !tab.module || canAccessModule(user, tab.module, "show"),
  );

  const resolveActive = (path: string, customIsActive?: (p: string) => boolean) => {
    if (customIsActive) return customIsActive(pathname);
    if (path === "/projects") return pathname.startsWith("/projects");
    if (path === "/harvest") {
      return pathname.startsWith("/harvest") && !pathname.startsWith("/harvest/schedule");
    }
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  const isMoreItemActive = (item: MobileMoreNavItem) => {
    if (item.tabs?.length) {
      return item.tabs.some(
        (tab) => tab.path && !tab.disabled && resolveActive(tab.path, tab.isActive),
      );
    }
    return resolveActive(item.path, item.isActive);
  };

  const hasMoreItems = moreSections.some((section) => section.items.length > 0);
  const showMoreTab = hasMoreItems || Boolean(footer);

  const moreActive = moreSections.some((section) => section.items.some(isMoreItemActive));

  const go = (path: string) => {
    router.push(path);
    setMoreOpen(false);
  };

  return (
    <>
      {mounted && moreOpen
        ? createPortal(
            <div className="fixed inset-0 z-120 lg:hidden">
              <div
                role="dialog"
                aria-modal="true"
                className="absolute inset-0 flex flex-col bg-sidebar text-sidebar-foreground shadow-2xl animate-in slide-in-from-right duration-300"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                  <p className="text-base font-semibold">{t("moreSheetTitle")}</p>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    className="rounded-lg p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                  {moreSections.map((section) => {
                    const simpleItems = section.items.filter((item) => !item.tabs?.length);
                    const groupedItems = section.items.filter((item) => (item.tabs?.length ?? 0) > 0);

                    return (
                      <div key={section.id}>
                        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                          {section.title}
                        </p>

                        {simpleItems.length > 0 ? (
                          <div className="mb-3 grid grid-cols-3 gap-2">
                            {simpleItems.map((item) => (
                              <MoreNavButton
                                key={item.key}
                                label={item.label}
                                icon={item.icon}
                                active={resolveActive(item.path, item.isActive)}
                                onClick={() => go(item.path)}
                              />
                            ))}
                          </div>
                        ) : null}

                        {groupedItems.map((item) => (
                          <div key={item.key} className="mb-3 last:mb-0">
                            <p className="mb-1.5 px-1 text-xs font-semibold text-sidebar-foreground/70">
                              {item.label}
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {(item.tabs ?? []).map((tab) => (
                                <MoreNavButton
                                  key={`${item.key}-${tab.path}`}
                                  label={tab.label}
                                  icon={tab.icon}
                                  active={resolveActive(tab.path, tab.isActive)}
                                  onClick={() => go(tab.path)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {footer ? (
                    <div className="mt-2 border-t border-sidebar-border pt-4">
                      {footer}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
        <div className="flex items-stretch justify-around">
          {visiblePrimaryTabs.map((tab) => {
            const Icon = tab.icon;
            const active = resolveActive(tab.path);
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
          {showMoreTab ? (
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
          ) : null}
        </div>
      </nav>
    </>
  );
}
