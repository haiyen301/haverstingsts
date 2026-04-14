"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Calendar,
  FileSpreadsheet,
  FolderKanban,
  GanttChart,
  Leaf,
  LayoutDashboard,
  Table2,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { images } from "@/lib/assets/images";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { SidebarProfile } from "@/widgets/layout/SidebarProfile";

interface DashboardLayoutProps {
  children: ReactNode;
  /** When true, hides the left navigation (desktop sidebar and mobile top bar) for a full-width workspace. */
  hideAppNav?: boolean;
}

// Set IDs allowed to see Inventory Import menu here.
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

export function DashboardLayout({ children, hideAppNav = false }: DashboardLayoutProps) {
  const t = useAppTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthUserStore((s) => s.user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Keep suppressing hydration mismatch caused by browser extensions that patch DOM.
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

  const navItems = [
    { path: "/dashboard", label: t("Nav.dashboard"), icon: LayoutDashboard },
    { path: "/harvest", label: t("Nav.harvests"), icon: Leaf },
    { path: "/projects", label: t("Nav.projects"), icon: FolderKanban },
    { path: "/overview", label: t("Nav.overview"), icon: Table2 },
    { path: "/planning", label: t("Nav.planning"), icon: Calendar },
    { path: "/timeline", label: t("Nav.timeline"), icon: GanttChart },
    { path: "/forecasting", label: t("Nav.forecasting"), icon: BarChart3 },
    ...(canAccessInventoryImport
      ? [{ path: "/inventory-import", label: t("Nav.inventoryImport"), icon: FileSpreadsheet }]
      : []),
  ];

  const isActive = (path: string) => {
    if (path === "/projects") {
      return pathname.startsWith("/projects");
    }
    if (path === "/harvest") {
      return pathname.startsWith("/harvest");
    }
    if (path === "/forecasting") {
      return pathname.startsWith("/forecasting");
    }
    if (path === "/timeline") {
      return pathname.startsWith("/timeline");
    }
    if (path === "/inventory-import") {
      return pathname.startsWith("/inventory-import");
    }
    return pathname === path;
  };

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
      {/* Mobile Header */}
      {!hideAppNav ? (
      <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="relative h-9 w-40 shrink-0">
          <Image
            src={images.stsLogo}
            alt={t("Common.company")}
            fill
            className="object-contain object-left"
            priority
            sizes="160px"
          />
        </div>
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          type="button"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      ) : null}

      {/* Mobile Menu */}
      {!hideAppNav && mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 top-[57px] bg-black bg-opacity-50 z-10"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="bg-white w-64 h-[calc(100vh-57px)] flex flex-col shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="space-y-1 p-4 flex-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      router.push(item.path);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                      isActive(item.path)
                        ? "bg-button-primary text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                    type="button"
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <SidebarProfile onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex">
        {/* Desktop Sidebar */}
        {!hideAppNav ? (
        <aside
          className={`hidden lg:flex flex-col bg-white border-r border-gray-200 min-h-screen fixed left-0 top-0 z-10 transition-all ${
            sidebarCollapsed ? "w-20" : "w-60"
          }`}
        >
          <div className={`flex-1 flex flex-col pb-0 min-h-0 overflow-hidden ${sidebarCollapsed ? "p-3" : "p-6"}`}>
            <div className={`mb-6 flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
              {!sidebarCollapsed ? (
                <div className="relative h-11 w-full max-w-[200px] shrink-0">
                  <Image
                    src={images.stsLogo}
                    alt={t("Common.company")}
                    fill
                    className="object-contain object-left"
                    priority
                    sizes="200px"
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="h-5 w-5" />
                ) : (
                  <PanelLeftClose className="h-5 w-5" />
                )}
              </button>
            </div>
            <nav className="space-y-1 flex-1 overflow-y-auto min-h-0 pb-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => router.push(item.path)}
                    className={`w-full flex items-center px-3 py-2 rounded-lg transition-colors ${
                      isActive(item.path)
                        ? "bg-button-primary text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    } ${sidebarCollapsed ? "justify-center" : "gap-3"}`}
                    type="button"
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    {!sidebarCollapsed ? <span>{item.label}</span> : null}
                  </button>
                );
              })}
            </nav>
          </div>
          <SidebarProfile compact={sidebarCollapsed} />
        </aside>
        ) : null}

        {/* Main Content */}
        <main
          className={`w-full transition-all ${
            hideAppNav ? "lg:ml-0" : sidebarCollapsed ? "lg:ml-20" : "lg:ml-60"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
