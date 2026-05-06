"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  Cog,
  FolderKanban,
  Fuel,
  Gauge,
  LayoutGrid,
  Leaf,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sprout,
  Timer,
  Tractor,
  Truck,
  Warehouse,
  X,
} from "lucide-react";

import { images } from "@/lib/assets/images";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { mapRowsToSelectOptions } from "@/shared/lib/harvestReferenceData";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MobileBottomNav } from "@/widgets/layout/MobileBottomNav";
import { SidebarProfile } from "@/widgets/layout/SidebarProfile";
import { ThemeToggle } from "@/widgets/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";

interface DashboardLayoutProps {
  children: ReactNode;
  /** When true, hides the left navigation (desktop sidebar and mobile chrome) for a full-width workspace. */
  hideAppNav?: boolean;
}

type SidebarSectionId = "operations" | "harvesting" | "fleet" | "admin";

type SidebarNavItemModel = {
  key: string;
  path: string;
  icon: LucideIcon;
  label: string;
  tabs?: SidebarNavItemTabModel[];
  badge?: number;
  disabled?: boolean;
  /** When omitted, defaults to path-aware matching via `pathname`. */
  isActive?: (pathname: string) => boolean;
};

type SidebarNavItemTabModel = {
  value: string;
  label: string;
  icon: LucideIcon;
  path?: string;
  disabled?: boolean;
};

const INVENTORY_IMPORT_ALLOWED_USER_IDS = new Set<number>([409]);

function parseSessionUserId(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseCsvFilter(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function DashboardLayout({ children, hideAppNav = false }: DashboardLayoutProps) {
  const t = useAppTranslations();
  const tn = useTranslations("SidebarNav");
  const th = useTranslations("AppHeader");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthUserStore((s) => s.user);
  const farms = useHarvestingDataStore((s) => s.farms);
  const harvestListFarmFilter = useHarvestingDataStore((s) => s.harvestListFarmFilter);
  const setHarvestListFarmFilter = useHarvestingDataStore(
    (s) => s.setHarvestListFarmFilter,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SidebarSectionId, boolean>>({
    operations: true,
    harvesting: true,
    fleet: true,
    admin: true,
  });
  const [openItemTabs, setOpenItemTabs] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void useHarvestingDataStore.getState().fetchAllHarvestingReferenceData();
  }, [mounted]);

  if (!mounted) return null;

  const userId = parseSessionUserId(user?.id);
  const canAccessInventoryImport =
    userId != null && INVENTORY_IMPORT_ALLOWED_USER_IDS.has(userId);

  function defaultSidebarPathActive(path: string, p: string): boolean {
    if (path === "/projects") return p.startsWith("/projects");
    if (path === "/harvest") return p.startsWith("/harvest");
    if (path === "/forecasting") return p.startsWith("/forecasting");
    if (path === "/inventory-import") return p.startsWith("/inventory-import");
    if (path === "/planning") return p.startsWith("/planning");
    if (path === "/overview") return p === "/overview" || p.startsWith("/overview/");
    return p === path;
  }

  function isSidebarNavItemActive(item: SidebarNavItemModel, p: string): boolean {
    if (item.disabled) return false;
    if (item.isActive) return item.isActive(p);
    return defaultSidebarPathActive(item.path, p);
  }

  const toggleSection = (id: SidebarSectionId) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const inventoryPath = canAccessInventoryImport ? "/inventory-import" : "/overview";

  const sidebarSections = useMemo(
    (): { id: SidebarSectionId; title: string; items: SidebarNavItemModel[] }[] => [
      {
        id: "operations",
        title: tn("operations"),
        items: [
          { key: "dash", path: "/dashboard", icon: LayoutGrid, label: t("Nav.dashboard") },
          // {
          //   key: "alerts",
          //   path: "/dashboard",
          //   icon: Bell,
          //   label: tn("myAlerts"),
          //   isActive: () => false,
          // },
          { key: "projects", path: "/projects", icon: FolderKanban, label: t("Nav.projects") },
          {
            key: "forecasting",
            path: "/forecasting",
            icon: BarChart3,
            label: t("Nav.forecasting"),
          },
          // {
          //   key: "inventory",
          //   path: inventoryPath,
          //   icon: Warehouse,
          //   label: tn("inventory"),
          // },
        ],
      },
      {
        id: "harvesting",
        title: tn("harvesting"),
        items: [
          // {
          //   key: "harvest-schedule",
          //   path: "/planning",
          //   icon: Calendar,
          //   label: tn("harvestSchedule"),
          // },
          { key: "harvests", path: "/harvest", icon: Leaf, label: t("Nav.harvests") },
        ],
      },
      // {
      //   id: "fleet",
      //   title: tn("fleetMechanical"),
      //   items: [
      //     {
      //       key: "vehicle-inspections",
      //       path: "",
      //       icon: Truck,
      //       label: tn("vehicleInspections"),
      //       disabled: true,
      //     },
      //     {
      //       key: "fuel",
      //       path: "",
      //       icon: Fuel,
      //       label: tn("fuelUsage"),
      //       disabled: true,
      //     },
      //     {
      //       key: "equipment",
      //       path: "",
      //       icon: Cog,
      //       label: tn("equipment"),
      //       disabled: true,
      //     },
      //   ],
      // },
      {
        id: "admin",
        title: tn("administration"),
        items: [
          {
            key: "users",
            path: "",
            icon: ShieldCheck,
            label: tn("userManagement"),
            // disabled: true,
          },
          {
            key: "turf-ops",
            path: "/admin/projectTypes",
            icon: Leaf,
            label: tn("turfOperations"),
            isActive: (p) => p.startsWith("/admin"),
            tabs: [
              {
                value: "projectTypes",
                label: "Projects",
                icon: Briefcase,
                path: "/admin/projectTypes",
              },
              {
                value: "architects",
                label: "Architects",
                icon: Building2,
                path: "/admin/architects",
              },
              {
                value: "zones",
                label: "Zone Configuration",
                icon: Sprout,
                path: "/admin/zones",
              },
              {
                value: "regrowth",
                label: "Regrowth Rules",
                icon: Timer,
                path: "/admin/regrowth",
              },
            ],
            // disabled: true,
          },
          // {
          //   key: "fleet-admin",
          //   path: "",
          //   icon: Tractor,
          //   label: tn("fleetMechanicalAdmin"),
          //   disabled: true,
          // },
        ],
      },
    ],
    [t, tn, inventoryPath],
  );

  const flatSidebarItems = useMemo(
    () => sidebarSections.flatMap((sec) => sec.items),
    [sidebarSections],
  );

  const sidebarWidthClass = sidebarCollapsed ? "lg:w-[5.25rem]" : "lg:w-72";
  const mainMarginClass = hideAppNav
    ? "lg:ml-0"
    : sidebarCollapsed
      ? "lg:ml-[5.25rem]"
      : "lg:ml-72";

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const farmIds = useMemo(
    () => parseCsvFilter(harvestListFarmFilter),
    [harvestListFarmFilter],
  );
  const selectedFarmId = farmIds.length === 1 ? farmIds[0] : null;
  const selectedFarmLabel = selectedFarmId
    ? farmOptions.find((o) => o.id === selectedFarmId)?.label ?? selectedFarmId
    : null;
  const multiFarm = farmIds.length > 1;
  const selectedFarmLabelsAll = useMemo(
    () =>
      farmIds.map(
        (fid) => farmOptions.find((o) => o.id === fid)?.label ?? fid,
      ),
    [farmIds, farmOptions],
  );

  const longDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date()),
    [locale],
  );

  return (
    <div className="flex min-h-screen text-foreground" suppressHydrationWarning>
      {!hideAppNav ? (
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex",
            sidebarWidthClass,
            "transition-[width] duration-200 ease-out",
          )}
        >
          <div
            className={cn(
              "shrink-0 border-b border-sidebar-border",
              sidebarCollapsed ? "px-2 py-4" : "px-4 py-5",
            )}
          >
            {!sidebarCollapsed ? (
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary/10"
                    aria-hidden
                  >
                    <Image
                      src={images.stsLogo}
                      alt={t("Common.company")}
                      fill
                      className="object-contain p-1.5 dark:hidden"
                      sizes="44px"
                    />
                    <Image
                      src={images.stsLogoDark}
                      alt={t("Common.company")}
                      fill
                      className="hidden object-contain p-1.5 dark:block"
                      sizes="44px"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold uppercase leading-tight tracking-tight text-sidebar-foreground">
                      {tn("brandTitle")}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-normal text-sidebar-foreground/55">
                      {tn("brandSubtitle")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  className="shrink-0 rounded-lg p-2 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary/10"
                  aria-hidden
                >
                  <Image
                    src={images.stsLogo}
                    alt={t("Common.company")}
                    fill
                    className="object-contain p-1.5 dark:hidden"
                    sizes="44px"
                  />
                  <Image
                    src={images.stsLogoDark}
                    alt={t("Common.company")}
                    fill
                    className="hidden object-contain p-1.5 dark:block"
                    sizes="44px"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed((v) => !v)}
                  className="rounded-lg p-2 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>

          <nav
            aria-label={tn("sidebarAria")}
            className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3"
          >
            {sidebarCollapsed ? (
              <div className="flex flex-col gap-0.5">
                {flatSidebarItems.map((item) => {
                  const Icon = item.icon;
                  const active = isSidebarNavItemActive(item, pathname);
                  return (
                    <button
                      key={`c-${item.key}`}
                      type="button"
                      disabled={item.disabled}
                      title={
                        item.disabled ? `${item.label} — ${tn("comingSoon")}` : item.label
                      }
                      onClick={() => {
                        if (item.disabled) return;
                        router.push(item.path);
                      }}
                      className={cn(
                        "flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        item.disabled
                          ? "cursor-not-allowed text-sidebar-foreground/35"
                          : active
                            ? "bg-sidebar-accent text-sidebar-primary"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="h-[22px] w-[22px] shrink-0 stroke-[1.75]" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sidebarSections.map((section) => {
                  const open = openSections[section.id];
                  return (
                    <div key={section.id}>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/70"
                        aria-expanded={open}
                      >
                        <span className="leading-tight">{section.title}</span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-sidebar-foreground/40 transition-transform",
                            open ? "rotate-0" : "-rotate-90",
                          )}
                          aria-hidden
                        />
                      </button>
                      {open ? (
                        <div className="mt-1 space-y-0.5 border-l border-transparent pl-1">
                          {section.items.map((item) => {
                            const Icon = item.icon;
                            const active = isSidebarNavItemActive(item, pathname);
                            const tabs = item.tabs ?? [];
                            const hasTabs = tabs.length > 0;
                            const tabsOpen = openItemTabs[item.key] ?? active;
                            return (
                              <div key={item.key}>
                                <div
                                  className={cn(
                                    "group flex w-full items-center gap-2 rounded-lg pr-2",
                                    item.disabled
                                      ? "text-sidebar-foreground/35"
                                      : active
                                        ? "bg-sidebar-accent text-sidebar-primary shadow-sm"
                                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                                  )}
                                >
                                  <button
                                    type="button"
                                    disabled={item.disabled}
                                    title={item.disabled ? `${item.label} — ${tn("comingSoon")}` : undefined}
                                    onClick={() => {
                                      if (item.disabled) return;
                                      router.push(item.path);
                                    }}
                                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                                  >
                                    <Icon
                                      className={cn(
                                        "h-[22px] w-[22px] shrink-0 stroke-[1.75]",
                                        !item.disabled &&
                                          active &&
                                          "text-sidebar-primary",
                                      )}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                                    {item.badge != null && item.badge > 0 ? (
                                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground">
                                        {item.badge > 99 ? "99+" : item.badge}
                                      </span>
                                    ) : null}
                                  </button>
                                  {hasTabs ? (
                                    <button
                                      type="button"
                                      disabled={item.disabled}
                                      aria-label={`Toggle ${item.label} submenu`}
                                      aria-expanded={tabsOpen}
                                      onClick={() => {
                                        if (item.disabled) return;
                                        setOpenItemTabs((prev) => ({
                                          ...prev,
                                          [item.key]: !(prev[item.key] ?? active),
                                        }));
                                      }}
                                      className={cn(
                                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
                                        item.disabled
                                          ? "cursor-not-allowed text-sidebar-foreground/35"
                                          : "text-sidebar-foreground/55 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                                      )}
                                    >
                                      <ChevronDown
                                        className={cn(
                                          "h-4 w-4 transition-transform",
                                          tabsOpen ? "rotate-0" : "-rotate-90",
                                        )}
                                        aria-hidden
                                      />
                                    </button>
                                  ) : null}
                                </div>
                                {hasTabs && tabsOpen ? (
                                  <div className="ml-7 mt-1 space-y-0.5">
                                    {tabs.map((tab) => {
                                      const TabIcon = tab.icon;
                                      return (
                                        <button
                                          key={`${item.key}-${tab.value}`}
                                          type="button"
                                          disabled={tab.disabled || !tab.path}
                                          title={
                                            tab.disabled || !tab.path
                                              ? `${tab.label} — ${tn("comingSoon")}`
                                              : undefined
                                          }
                                          onClick={() => {
                                            if (tab.disabled || !tab.path) return;
                                            router.push(tab.path);
                                          }}
                                          className={cn(
                                            "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                                            tab.disabled || !tab.path
                                              ? "cursor-not-allowed text-sidebar-foreground/35"
                                              : pathname === tab.path
                                                ? "bg-sidebar-accent/80 text-sidebar-primary"
                                                : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                                          )}
                                        >
                                          <TabIcon className="h-4 w-4 shrink-0 stroke-[1.75]" />
                                          <span className="truncate text-left">{tab.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </nav>

          <SidebarProfile compact={sidebarCollapsed} />
        </aside>
      ) : null}

      <div className={`flex min-h-screen flex-1 flex-col ${mainMarginClass}`}>
        {!hideAppNav ? (
          <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-2 border-b border-border px-4 py-2 bg-background/80 backdrop-blur-md sm:gap-3 lg:h-14 lg:flex-nowrap lg:px-6 lg:py-0">
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
              <div className="relative h-8 w-32 shrink-0 lg:hidden">
                <Image
                  src={images.stsLogo}
                  alt={t("Common.company")}
                  fill
                  className="object-contain object-left dark:hidden"
                  priority
                  sizes="128px"
                />
                <Image
                  src={images.stsLogoDark}
                  alt={t("Common.company")}
                  fill
                  className="hidden object-contain object-left dark:block"
                  priority
                  sizes="128px"
                />
              </div>
            </div>

            {/* Farm filter + date: fixed “light chrome” like Harvesting AppLayout — không theo theme sáng/tối */}
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:gap-2">
              {multiFarm || selectedFarmLabel ? (
                <div
                  className={cn(
                    "inline-flex min-w-0 gap-1.5 border border-[rgb(31,122,76)]/20 bg-[rgb(31,122,76)]/10 py-1 pl-2.5 pr-1 text-xs font-medium text-[rgb(31,122,76)]",
                    multiFarm
                      ? "max-w-[min(100%,min(92vw,640px))] items-start rounded-xl"
                      : "max-w-[min(100%,280px)] items-center rounded-full",
                  )}
                >
                  <MapPin
                    className={cn(
                      "h-3 w-3 shrink-0",
                      multiFarm ? "mt-0.5" : "",
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1",
                      multiFarm
                        ? "wrap-break-word whitespace-normal leading-snug"
                        : "truncate",
                    )}
                    title={
                      multiFarm
                        ? selectedFarmLabelsAll.join(", ")
                        : (selectedFarmLabel ?? undefined)
                    }
                  >
                    {multiFarm
                      ? `${th("farmLabel")}: ${selectedFarmLabelsAll.join(", ")}`
                      : `${th("farmLabel")}: ${selectedFarmLabel}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHarvestListFarmFilter("")}
                    className={cn(
                      "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[rgb(31,122,76)] transition-colors hover:bg-[rgb(31,122,76)]/20",
                      multiFarm ? "mt-0.5 self-start" : "",
                    )}
                    aria-label={th("clearFarmFilter")}
                    title={th("showAllFarms")}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ) : (
                <select
                  aria-label={th("allFarms")}
                  value={selectedFarmId ?? "all"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHarvestListFarmFilter(v === "all" ? "" : v);
                  }}
                  className={cn(
                    "h-8 w-[150px] shrink-0 rounded-md border border-input px-2 py-1 text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[rgb(31,122,76)]/35 text-foreground",
                    bgSurfaceFilter(Boolean(selectedFarmId)),
                  )}
                >
                  <option value="all">{th("allFarms")}</option>
                  {farmOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <div className="hidden text-xs font-medium text-gray-500 sm:block">
                {longDate}
              </div>
              <ThemeToggle />
            </div>
          </header>
        ) : null}

        <main
          className={
            hideAppNav
              ? "flex-1"
              : "flex-1 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-6"
          }
        >
          {children}
        </main>
      </div>

      {!hideAppNav ? (
        <MobileBottomNav showInventoryImport={canAccessInventoryImport} />
      ) : null}
    </div>
  );
}
