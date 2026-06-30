"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export function HelpAdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("HelpAdmin");
  const pathname = usePathname();

  const tabs = [
    {
      href: "/help/admin/articles",
      label: t("articlesTitle"),
      active:
        pathname === "/help/admin/articles" ||
        pathname.startsWith("/help/admin/articles/"),
    },
    {
      href: "/help/admin/categories",
      label: t("categoriesTitle"),
      active: pathname.startsWith("/help/admin/categories"),
    },
  ];

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 border-b border-border">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab.active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        <Link href="/help" className="text-sm text-muted-foreground hover:text-foreground">
          {t("viewHelpCenter")}
        </Link>
      </div>
      {children}
    </div>
  );
}
