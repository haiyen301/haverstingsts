"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Calendar,
  FolderKanban,
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
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { SidebarProfile } from "@/widgets/layout/SidebarProfile";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const t = useAppTranslations();
  const router = useRouter();
  const pathname = usePathname();
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

  const navItems = [
    { path: "/dashboard", label: t("Nav.dashboard"), icon: LayoutDashboard },
    { path: "/harvest", label: t("Nav.harvests"), icon: Leaf },
    { path: "/projects", label: t("Nav.projects"), icon: FolderKanban },
    { path: "/overview", label: t("Nav.overview"), icon: Table2 },
    { path: "/planning", label: t("Nav.planning"), icon: Calendar },
    { path: "/forecasting", label: t("Nav.forecasting"), icon: BarChart3 },
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
    return pathname === path;
  };

  return (
    <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
      {/* Mobile Header */}
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

      {/* Mobile Menu */}
      {mobileMenuOpen && (
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

        {/* Main Content */}
        <main className={`w-full transition-all ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-60"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
