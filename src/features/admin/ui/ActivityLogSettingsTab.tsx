"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  fetchActivityLogs,
  type ActivityLogAction,
  type ActivityLogModule,
  type ActivityLogRow,
} from "@/features/admin/api/activityLogApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  formatDateTimeInDisplayZone,
  formatStsPortalUtcTooltip,
} from "@/shared/lib/format/date";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

function actionBadgeClass(action: string): string {
  switch (action) {
    case "created":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "updated":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "deleted":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function moduleBadgeClass(logType: string): string {
  switch (logType) {
    case "project_api":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "harvest_api":
      return "bg-lime-100 text-lime-900 border-lime-200";
    case "inventory_api":
      return "bg-violet-100 text-violet-900 border-violet-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function truncateValue(value: string, max = 120): string {
  const s = value.trim();
  if (s.length <= max) return s || "—";
  return `${s.slice(0, max)}…`;
}

function fieldLabel(field: string, t: ReturnType<typeof useTranslations>): string {
  const known = [
    "project_id", "project_name", "alias_title", "title", "name", "description", "quantity", "uom",
    "farm_id", "zone", "product_id", "status", "status_id", "estimated_harvest_date",
    "estimated_harvest_end_date", "actual_harvest_date", "delivery_harvest_date",
    "available_kg", "calculated_kg", "balance_date", "grass_id", "zone_configuration_id",
    "odoo_customer_id", "truck_note", "load_type",
  ] as const;
  if ((known as readonly string[]).includes(field)) {
    return t(`fields.${field}` as "fields.project_id");
  }
  return field.replace(/_/g, " ");
}

const ACTIVITY_LOG_MODULES: ActivityLogModule[] = [
  "project_api",
  "harvest_api",
  "inventory_api",
  "zones_api",
  "zone_configurations_api",
  "grasses_api",
  "keyareas_api",
  "countries_api",
  "roles_api",
  "regrowth_rules_api",
  "project_form_catalog_api",
  "staff_api",
];

function moduleLabel(logType: string, t: ReturnType<typeof useTranslations>): string {
  if ((ACTIVITY_LOG_MODULES as readonly string[]).includes(logType)) {
    return t(`module.${logType}` as "module.project_api");
  }
  return logType;
}

function actionLabel(action: string, t: ReturnType<typeof useTranslations>): string {
  if (action === "created" || action === "updated" || action === "deleted") {
    return t(`action.${action}` as "action.created");
  }
  return action;
}

function ActivityLogEntry({
  row,
  t,
  locale,
}: {
  row: ActivityLogRow;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = row.changes.length > 0;

  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (row.logForTitle) {
      parts.push(`${t("contextProject")}: ${row.logForTitle}`);
    } else if (row.logFor === "project" && row.logForId > 0) {
      parts.push(`${t("contextProject")} #${row.logForId}`);
    } else if (row.logFor === "inventory" && row.logForId > 0) {
      parts.push(`${t("contextFarm")} #${row.logForId}`);
    } else if (row.logFor === "admin" && row.logForId > 0) {
      parts.push(`${t("contextAdmin")} #${row.logForId}`);
    }
    if (row.logTypeId > 0) {
      parts.push(`${t("recordId")} #${row.logTypeId}`);
    }
    return parts.join(" · ");
  }, [row, t]);

  return (
    <article className="rounded-xl border border-border bg-white shadow-sm transition hover:shadow-md">
      <div className="flex gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {row.createdByUser
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "S"}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{row.createdByUser}</p>
              <p
                className="text-xs text-muted-foreground"
                title={formatStsPortalUtcTooltip(row.createdAt, locale)}
              >
                {formatDateTimeInDisplayZone(row.createdAt, locale)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  moduleBadgeClass(row.logType),
                )}
              >
                {moduleLabel(row.logType, t)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  actionBadgeClass(row.action),
                )}
              >
                {actionLabel(row.action, t)}
              </span>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">
              {row.logTypeTitle || t("untitledRecord")}
            </p>
            {contextLine ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{contextLine}</p>
            ) : null}
          </div>

          {hasChanges ? (
            <div>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition hover:text-primary/80"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {expanded
                  ? t("hideChanges", { count: row.changes.length })
                  : t("showChanges", { count: row.changes.length })}
              </button>

              {expanded ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("field")}</th>
                        <th className="px-3 py-2 font-medium">{t("before")}</th>
                        <th className="px-3 py-2 font-medium">{t("after")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.changes.map((change) => (
                        <tr key={`${row.id}-${change.field}`} className="border-t border-border">
                          <td className="px-3 py-2 align-top font-medium text-foreground">
                            {fieldLabel(change.field, t)}
                          </td>
                          <td className="max-w-[14rem] px-3 py-2 align-top break-words text-muted-foreground">
                            {truncateValue(change.from)}
                          </td>
                          <td className="max-w-[14rem] px-3 py-2 align-top break-words text-foreground">
                            {truncateValue(change.to)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : row.action === "deleted" ? (
            <p className="text-xs text-muted-foreground">{t("deletedHint")}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const PER_PAGE = 25;

export function ActivityLogSettingsTab() {
  const t = useTranslations("AdminActivityLog");
  const tc = useTranslations("Common");
  const locale = useLocale();

  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [logType, setLogType] = useState<ActivityLogModule | "">("");
  const [action, setAction] = useState<ActivityLogAction | "">("");
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadInitial = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await fetchActivityLogs({
          page: 1,
          perPage: PER_PAGE,
          logType,
          action,
          search,
        });
        setRows(result.rows);
        setPage(1);
        setTotal(result.meta.total);
        setHasMore(result.meta.totalPages > 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errors.load"));
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [action, logType, search, t],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const nextPage = page + 1;
      const result = await fetchActivityLogs({
        page: nextPage,
        perPage: PER_PAGE,
        logType,
        action,
        search,
      });
      setRows((prev) => [...prev, ...result.rows]);
      setPage(nextPage);
      setTotal(result.meta.total);
      setHasMore(nextPage < result.meta.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.load"));
    } finally {
      setLoadingMore(false);
    }
  }, [action, hasMore, loadingMore, logType, page, search, t]);

  useEffect(() => {
    if (loading || !hasMore || loadingMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, loadingMore, rows.length]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const summary = useMemo(() => {
    if (total === 0) return t("summaryEmpty");
    return t("summaryLoaded", { loaded: rows.length, total });
  }, [rows.length, t, total]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <ClipboardList className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => void loadInitial({ silent: true })}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-medium text-foreground transition hover:bg-muted/40 disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("refresh")}
        </button>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className={cn(inputClass, "pl-9")}
              />
            </div>
            <select
              value={logType}
              onChange={(e) => {
                setLogType(e.target.value as ActivityLogModule | "");
              }}
              className={selectClass}
              aria-label={t("filterModule")}
            >
              <option value="">{t("filterAllModules")}</option>
              {ACTIVITY_LOG_MODULES.map((moduleKey) => (
                <option key={moduleKey} value={moduleKey}>
                  {t(`module.${moduleKey}` as "module.project_api")}
                </option>
              ))}
            </select>
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value as ActivityLogAction | "");
              }}
              className={selectClass}
              aria-label={t("filterAction")}
            >
              <option value="">{t("filterAllActions")}</option>
              <option value="created">{t("action.created")}</option>
              <option value="updated">{t("action.updated")}</option>
              <option value="deleted">{t("action.deleted")}</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {tc("loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <ActivityLogEntry key={row.id} row={row} t={t} locale={locale} />
          ))}
          {hasMore ? (
            <div ref={loadMoreRef} className="flex justify-center py-4">
              {loadingMore ? (
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("loadingMore")}
                </div>
              ) : (
                <div className="h-1 w-full" aria-hidden="true" />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
