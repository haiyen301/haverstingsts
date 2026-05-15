"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { fetchAlertFeedConfig, resolveCategoryTypeForRoute } from "@/features/alerts/alertFeedConfigApi";
import type { AlertRouteKey } from "@/features/alerts/alertFeedConfigTypes";

type LoadState = "idle" | "loading" | "done";

export function AlertRouteCategoryBanner({ routeKey }: { routeKey: AlertRouteKey }) {
  const t = useTranslations("AlertRouteBanner");
  const [state, setState] = useState<LoadState>("loading");
  const [categoryTitle, setCategoryTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState("loading");
      try {
        const cfg = await fetchAlertFeedConfig();
        const code = resolveCategoryTypeForRoute(routeKey, cfg);
        const cat = code ? cfg.categories.find((c) => c.id === code) : undefined;
        if (cancelled) return;
        setCategoryTitle(cat?.title ?? code);
        setState("done");
      } catch {
        if (!cancelled) {
          setCategoryTitle(null);
          setState("done");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeKey]);

  if (state === "loading") {
    return (
      <div className="mb-4 h-10 animate-pulse rounded-lg bg-muted/40" aria-hidden />
    );
  }

  const hasMapping = Boolean(categoryTitle);

  return (
    <div className="mb-4 rounded-lg border border-dashed border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
      {hasMapping ? (
        <>
          <span className="font-medium text-foreground">{t("mappedLabel")}</span> {categoryTitle}
          <span className="mx-1 text-muted-foreground">·</span>
          <Link href="/admin/people/alerts" className="text-primary underline">
            {t("alertSettingsLink")}
          </Link>
        </>
      ) : (
        <>
          {t("noMapPrefix")}{" "}
          <Link href="/admin/people/alerts" className="font-medium text-primary underline">
            {t("noMapLink")}
          </Link>
          .
        </>
      )}
    </div>
  );
}
