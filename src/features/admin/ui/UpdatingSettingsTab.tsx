"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  fetchProjectPaces,
  fetchZoneConfigurations,
  type ProjectPaceRow,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import {
  applyPrivilegedPaceRecalcForProject,
  countHarvestBatchesForProject,
  fetchHarvestVisibilityDebug,
  parseGrassRequirementsFromProjectRow,
  previewPrivilegedPaceRecalcForProject,
  type PrivilegedPaceRecalcPreview,
  type PrivilegedPaceRecalcPreviewRow,
} from "@/features/project/lib/privilegedPaceRecalcProject";
import { fetchAllHarvestPlanRowsForProject } from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import { mondayProjectTitleFromRow, resolveMondayCardStatusForListFilter } from "@/features/project";
import type { ProjectStatus } from "@/entities/projects";
import {
  fetchMondayProjectRowsFromServer,
  fetchMondayProjectTotalFromServer,
  type MondayProjectListQuery,
  type MondayProjectServerRow,
} from "@/entities/projects";
import { canAccessModule } from "@/shared/auth/permissions";
import { userIdIsPrivilegedAdmin } from "@/shared/auth/privilegedAdminAccess";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { MultiSelect } from "@/shared/ui/multi-select";
import { RainfallImportSection } from "@/features/admin/ui/RainfallImportSection";
import { cn } from "@/lib/utils";

const PROJECT_LIST_PAGE_SIZE = 40;

const PROJECT_STATUS_FILTERS = ["Ongoing", "Future", "Done", "Warning"] as const;

function normalizeProjectStatusLabel(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (!s) return "";
  if (s.includes("done") || s.includes("complete")) return "Done";
  if (s.includes("future")) return "Future";
  if (s.includes("warning")) return "Warning";
  if (s.includes("ongoing")) return "Ongoing";
  return "";
}

function isAllProjectStatusesSelected(values: string[]): boolean {
  if (values.length === 0) return true;
  const picked = new Set(
    values.map((x) => normalizeProjectStatusLabel(x)).filter(Boolean),
  );
  return PROJECT_STATUS_FILTERS.every((s) => picked.has(s));
}

function buildStatusQuery(statusFilterValues: string[]): string {
  if (isAllProjectStatusesSelected(statusFilterValues)) return "";
  return statusFilterValues
    .map((x) => normalizeProjectStatusLabel(x))
    .filter(Boolean)
    .join(",");
}

const STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  Ongoing: "border-[#CFE93E] bg-[#FFFAFA] text-foreground",
  Future: "border-[#349EF5] bg-[#FFFAFA] text-foreground",
  Done: "border-[#9D9D9D] bg-[#FFFAFA] text-muted-foreground",
  Warning: "border-destructive/50 bg-destructive/5 text-destructive",
};

function ProjectStatusBadge({
  status,
  label,
}: {
  status: ProjectStatus;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_BADGE_CLASS[status],
      )}
    >
      {label}
    </span>
  );
}

type ProjectListEntry = {
  row: MondayProjectServerRow;
  projectId: string;
  name: string;
  paceKey: string;
  status: ProjectStatus;
  grassLineCount: number;
  /** Filled only after preview/load for this project. */
  harvestCounts?: { total: number; actual: number; estimate: number };
};

function projectIdFromRow(row: MondayProjectServerRow): string {
  return String(row.project_id ?? "").trim();
}

function paceKeyFromRow(row: MondayProjectServerRow): string {
  const rec = row as Record<string, unknown>;
  const pace = String(rec.project_pace ?? "").trim().toLowerCase();
  return pace === "none" ? "" : pace;
}

function rowToListEntry(row: MondayProjectServerRow): ProjectListEntry | null {
  const projectId = projectIdFromRow(row);
  if (!projectId) return null;
  const grassReqs = parseGrassRequirementsFromProjectRow(row);
  return {
    row,
    projectId,
    name: mondayProjectTitleFromRow(row as Record<string, unknown>, { projectId }),
    paceKey: paceKeyFromRow(row),
    status: resolveMondayCardStatusForListFilter(row),
    grassLineCount: grassReqs.length,
  };
}

function PreviewRowLine({ row }: { row: PrivilegedPaceRecalcPreviewRow }) {
  const t = useTranslations("AdminUpdating");
  const isDeleted = row.action === "delete" || row.action === "soft_delete";
  const isNew = row.action === "create";
  const isUpdated = row.action === "update";

  const actionLabel =
    row.action === "delete"
      ? t("actionDelete")
      : row.action === "soft_delete"
        ? t("actionSoftDelete")
        : row.action === "create"
          ? t("actionCreate")
          : row.action === "update"
            ? t("actionUpdate")
            : t("actionUnchanged");

  return (
    <tr
      className={cn(
        "border-b border-border/60 text-sm",
        isDeleted && "bg-destructive/5 text-muted-foreground",
        isNew && "bg-primary/5",
        isUpdated && "bg-amber-500/5",
      )}
    >
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={cn(
            "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
            isDeleted && "bg-destructive/15 text-destructive",
            isNew && "bg-primary/15 text-primary",
            isUpdated && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            row.action === "unchanged" && "bg-muted text-muted-foreground",
          )}
        >
          {actionLabel}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{row.estimatedDate || "—"}</td>
      <td className="px-3 py-2">
        <div className="font-medium">{row.productId}</div>
        <div className="text-xs text-muted-foreground">
          {row.uom} · {row.loadType}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={cn(isDeleted && "line-through")}>
          {row.beforeQuantity || "—"}
        </span>
        {(isUpdated || isNew) && (
          <>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="font-medium text-foreground">{row.afterQuantity}</span>
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <span className={cn(isDeleted && "line-through")}>
          {row.beforeHarvestedArea || "—"}
        </span>
        {(isUpdated || isNew) && row.afterHarvestedArea ? (
          <>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="font-medium text-foreground">{row.afterHarvestedArea}</span>
          </>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {row.deleteReason === "past_estimate"
          ? t("reasonPastEstimate")
          : row.deleteReason === "fulfilled"
            ? t("reasonFulfilled")
            : row.deleteReason === "over_delivered"
              ? t("reasonOverDelivered")
              : row.deleteReason === "actual_unchanged"
                ? t("reasonActualUnchanged")
                : ""}
      </td>
    </tr>
  );
}

export function UpdatingSettingsTab() {
  const t = useTranslations("AdminUpdating");
  const tProjects = useTranslations("Projects");
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const isPrivilegedAdmin = userIdIsPrivilegedAdmin(user?.id);
  const canRegeneratePaceHarvestsOnEdit = canAccessModule(user, "harvests", "create");

  const [catalogsReady, setCatalogsReady] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilterValues, setStatusFilterValues] = useState<string[]>([]);
  const [totalProjects, setTotalProjects] = useState<number | null>(null);
  const [totalLoading, setTotalLoading] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [hasMoreProjects, setHasMoreProjects] = useState(false);
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Hidden for this visit to Updating — cleared when leaving the page (unmount). */
  const [appliedInSessionIds, setAppliedInSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [previewProjectId, setPreviewProjectId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PrivilegedPaceRecalcPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [projectPaceCatalogRows, setProjectPaceCatalogRows] = useState<ProjectPaceRow[]>([]);
  const [zoneConfigurations, setZoneConfigurations] = useState<ZoneConfigurationRow[]>([]);
  const harvestPlansRef = useRef<Map<string, Array<Record<string, unknown>>>>(new Map());

  useEffect(() => {
    if (user && !isPrivilegedAdmin) {
      router.replace("/admin/settings/countries");
    }
  }, [user, isPrivilegedAdmin, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCatalogs = useCallback(async () => {
    const [paces, zones] = await Promise.all([
      fetchProjectPaces(),
      fetchZoneConfigurations(),
    ]);
    setProjectPaceCatalogRows(paces);
    setZoneConfigurations(zones);
    setCatalogsReady(true);
  }, []);

  const buildListFilterParams = useCallback(
    (searchQuery: string): Omit<MondayProjectListQuery, "page" | "perPage" | "listPaged"> => ({
      module: "project",
      search: searchQuery || undefined,
      status: buildStatusQuery(statusFilterValues) || undefined,
      sortBy: "project_id",
      sortDir: "desc",
    }),
    [statusFilterValues],
  );

  const loadProjectTotal = useCallback(async () => {
    setTotalLoading(true);
    try {
      const total = await fetchMondayProjectTotalFromServer(
        buildListFilterParams(debouncedSearch),
      );
      setTotalProjects(total);
    } catch {
      setTotalProjects(null);
    } finally {
      setTotalLoading(false);
    }
  }, [buildListFilterParams, debouncedSearch]);

  const loadProjectPage = useCallback(
    async (opts: { page: number; searchQuery: string; append: boolean }) => {
      setListLoading(true);
      setError(null);
      try {
        const res = await fetchMondayProjectRowsFromServer({
          ...buildListFilterParams(opts.searchQuery),
          page: opts.page,
          perPage: PROJECT_LIST_PAGE_SIZE,
          listPaged: true,
        });
        const entries: ProjectListEntry[] = [];
        for (const row of res.rows) {
          const entry = rowToListEntry(row);
          if (entry) entries.push(entry);
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        setProjects((prev) => {
          if (!opts.append) return entries;
          const seen = new Set(prev.map((p) => p.projectId));
          const merged = [...prev];
          for (const e of entries) {
            if (!seen.has(e.projectId)) {
              seen.add(e.projectId);
              merged.push(e);
            }
          }
          merged.sort((a, b) => a.name.localeCompare(b.name));
          return merged;
        });

        const total = res.totalRecords;
        const loadedCount = opts.append
          ? opts.page * PROJECT_LIST_PAGE_SIZE
          : entries.length;
        setHasMoreProjects(
          total != null ? loadedCount < total : entries.length >= PROJECT_LIST_PAGE_SIZE,
        );
        setListPage(opts.page);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("errors.load"));
      } finally {
        setListLoading(false);
      }
    },
    [buildListFilterParams, t],
  );

  useEffect(() => {
    if (!isPrivilegedAdmin) return;
    void loadCatalogs();
  }, [isPrivilegedAdmin, loadCatalogs]);

  useEffect(() => {
    if (!catalogsReady) return;
    void loadProjectTotal();
    void loadProjectPage({ page: 1, searchQuery: debouncedSearch, append: false });
  }, [catalogsReady, debouncedSearch, statusFilterValues, loadProjectPage, loadProjectTotal]);

  const visibleProjects = useMemo(
    () => projects.filter((p) => !appliedInSessionIds.has(p.projectId)),
    [projects, appliedInSessionIds],
  );

  const selectedCount = selectedIds.size;
  const allVisibleSelected =
    visibleProjects.length > 0 &&
    visibleProjects.every((p) => selectedIds.has(p.projectId));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of visibleProjects) next.delete(p.projectId);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of visibleProjects) next.add(p.projectId);
        return next;
      });
    }
  };

  const toggleProject = (projectId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const fetchHarvestPlanForProject = useCallback(
    async (projectId: string, force = false) => {
      if (!force && harvestPlansRef.current.has(projectId)) {
        return harvestPlansRef.current.get(projectId)!;
      }
      const rows = await fetchAllHarvestPlanRowsForProject(
        projectId,
        user?.id != null ? Number(user.id) : undefined,
      );
      harvestPlansRef.current.set(projectId, rows);
      return rows;
    },
    [user?.id],
  );

  const buildContextForProject = useCallback(
    async (entry: ProjectListEntry, forceHarvestRefresh = false) => {
      const harvestPlanRows = await fetchHarvestPlanForProject(
        entry.projectId,
        forceHarvestRefresh,
      );
      return {
        projectRow: entry.row,
        projectId: entry.projectId,
        grassRequirements: parseGrassRequirementsFromProjectRow(entry.row),
        harvestPlanRows,
        projectPaceCatalogRows,
        zoneConfigurations,
        canRegeneratePaceHarvestsOnEdit,
        userId: user?.id != null ? Number(user.id) : undefined,
      };
    },
    [
      canRegeneratePaceHarvestsOnEdit,
      fetchHarvestPlanForProject,
      projectPaceCatalogRows,
      user?.id,
      zoneConfigurations,
    ],
  );

  const runPreview = async (projectId: string) => {
    const entry = projects.find((p) => p.projectId === projectId);
    if (!entry || appliedInSessionIds.has(projectId)) return;
    setLoadingPreview(true);
    setError(null);
    setPreviewProjectId(projectId);
    setPreview(null);
    try {
      const [ctx, dataSource] = await Promise.all([
        buildContextForProject(entry),
        fetchHarvestVisibilityDebug(projectId),
      ]);
      const result = previewPrivilegedPaceRecalcForProject({
        ...ctx,
      });
      setPreview({ ...result, dataSource: dataSource ?? undefined });
      const counts = countHarvestBatchesForProject(ctx.harvestPlanRows);
      setProjects((prev) =>
        prev.map((p) =>
          p.projectId === projectId ? { ...p, harvestCounts: counts } : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.preview"));
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const selectAndLoadProject = (projectId: string) => {
    if (appliedInSessionIds.has(projectId)) return;
    void runPreview(projectId);
  };

  const runApply = async () => {
    const ids = Array.from(selectedIds).filter((id) => !appliedInSessionIds.has(id));
    if (ids.length === 0) return;
    setApplying(true);
    setError(null);
    setSuccess(null);
    setConfirmOpen(false);

    let ok = 0;
    let fail = 0;
    const details: string[] = [];
    const appliedNow = new Set<string>();

    for (const projectId of ids) {
      const entry = projects.find((p) => p.projectId === projectId);
      if (!entry) {
        fail += 1;
        continue;
      }
      try {
        const ctx = await buildContextForProject(entry, true);
        const result = await applyPrivilegedPaceRecalcForProject(ctx);
        if (result.error) {
          fail += 1;
          details.push(`${entry.name}: ${result.error}`);
        } else {
          ok += 1;
          appliedNow.add(projectId);
          harvestPlansRef.current.delete(projectId);
        }
      } catch (e) {
        fail += 1;
        details.push(
          `${entry.name}: ${e instanceof Error ? e.message : t("errors.apply")}`,
        );
      }
    }

    if (appliedNow.size > 0) {
      setAppliedInSessionIds((prev) => {
        const next = new Set(prev);
        for (const id of appliedNow) next.add(id);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of appliedNow) next.delete(id);
        return next;
      });
      if (previewProjectId && appliedNow.has(previewProjectId)) {
        setPreview(null);
        setPreviewProjectId(null);
      }
    }

    if (fail === 0) {
      setSuccess(t("applySuccess", { ok }));
    } else {
      setError(t("applyPartial", { ok, fail, details: details.join("; ") }));
    }
    setApplying(false);
  };

  if (!user || !isPrivilegedAdmin) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (!catalogsReady) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {appliedInSessionIds.size > 0 ? (
        <p className="text-sm text-muted-foreground">{t("appliedHiddenBanner", { count: appliedInSessionIds.size })}</p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
          {success}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
          />
        </div>
        <MultiSelect
          options={[
            { value: "Ongoing", label: tProjects("statusOngoing") },
            { value: "Future", label: tProjects("statusFuture") },
            { value: "Done", label: tProjects("statusDone") },
            { value: "Warning", label: tProjects("statusWarning") },
          ]}
          values={statusFilterValues}
          onChange={setStatusFilterValues}
          placeholder={t("statusAll")}
          showAllOption
          className={cn(
            "h-9 min-w-[160px] rounded-md border border-input bg-background text-sm shadow-sm",
            bgSurfaceFilter(statusFilterValues.length > 0),
          )}
        />
        <button
          type="button"
          disabled={listLoading || applying || totalLoading}
          onClick={() => {
            void loadProjectTotal();
            void loadProjectPage({ page: 1, searchQuery: debouncedSearch, append: false });
          }}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-muted/50 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", listLoading && "animate-spin")} />
          {t("refresh")}
        </button>
        <button
          type="button"
          disabled={selectedCount === 0 || applying || loadingPreview}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {applying ? t("applying") : t("applySelected", { count: selectedCount })}
        </button>
      </div>

      {confirmOpen ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-sm font-medium text-foreground">{t("confirmTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("confirmBody", { count: selectedCount })}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runApply()}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                >
                  {t("confirmYes")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm"
                >
                  {t("confirmNo")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">{t("projectsTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("projectsHintLazy")}</p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {totalLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("loadingTotal")}
                  </span>
                ) : totalProjects != null ? (
                  <span className="font-medium text-foreground">
                    {t("totalProjects", { count: totalProjects })}
                  </span>
                ) : null}
                <p>
                  {t("listStats", {
                    loaded: visibleProjects.length,
                    hidden: appliedInSessionIds.size,
                  })}
                </p>
              </div>
            </div>
          </div>
          <div className="max-h-128 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label={t("selectAll")}
                    />
                  </th>
                  <th className="px-3 py-2">{t("colProject")}</th>
                  <th className="px-3 py-2">{t("colStatus")}</th>
                  <th className="px-3 py-2 text-right">{t("colGrass")}</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((p) => (
                  <tr
                    key={p.projectId}
                    className={cn(
                      "border-b border-border/60 hover:bg-muted/30",
                      previewProjectId === p.projectId && "bg-primary/5",
                      selectedIds.has(p.projectId) && "bg-muted/20",
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.projectId)}
                        onChange={() => toggleProject(p.projectId)}
                        aria-label={p.name}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => selectAndLoadProject(p.projectId)}
                      >
                        <div className="font-medium hover:text-primary">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.paceKey ? t("paceLabel", { pace: p.paceKey }) : t("noPace")}
                          {p.harvestCounts
                            ? ` · ${t("harvestCountsShort", {
                                estimate: p.harvestCounts.estimate,
                                actual: p.harvestCounts.actual,
                              })}`
                            : null}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <ProjectStatusBadge
                        status={p.status}
                        label={
                          p.status === "Ongoing"
                            ? tProjects("statusOngoing")
                            : p.status === "Future"
                              ? tProjects("statusFuture")
                              : p.status === "Done"
                                ? tProjects("statusDone")
                                : tProjects("statusWarning")
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.grassLineCount}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        title={t("preview")}
                        disabled={loadingPreview && previewProjectId === p.projectId}
                        onClick={() => void runPreview(p.projectId)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        {loadingPreview && previewProjectId === p.projectId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listLoading && visibleProjects.length === 0 ? (
              <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingProjects")}
              </p>
            ) : null}
            {!listLoading && visibleProjects.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("noProjects")}</p>
            ) : null}
            {hasMoreProjects ? (
              <div className="border-t border-border p-3">
                <button
                  type="button"
                  disabled={listLoading}
                  onClick={() =>
                    void loadProjectPage({
                      page: listPage + 1,
                      searchQuery: debouncedSearch,
                      append: true,
                    })
                  }
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
                >
                  {listLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{t("previewTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("previewHint")}</p>
          </div>
          <div className="max-h-128 overflow-auto p-4">
            {loadingPreview ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loadingPreview")}
              </p>
            ) : !preview ? (
              <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>
            ) : preview.skipped ? (
              <p className="text-sm text-muted-foreground">{t("previewSkipped")}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">{preview.projectName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("previewSummary", {
                      deleted: preview.summary.deleted + preview.summary.softDeleted,
                      updated: preview.summary.updated,
                      created: preview.summary.created,
                      unchanged: preview.summary.unchanged,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("harvestCounts", {
                      estimate: preview.harvestCounts.estimate,
                      actual: preview.harvestCounts.actual,
                    })}
                  </p>
                  {preview.dataSource ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("dataSourceStats", {
                        active: preview.dataSource.apiActiveRows,
                        softDeleted: preview.dataSource.softDeletedInDb,
                        dbTotal: preview.dataSource.dbTotalRows,
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">{t("colAction")}</th>
                        <th className="px-3 py-2 text-left">{t("colDate")}</th>
                        <th className="px-3 py-2 text-left">{t("colGrass")}</th>
                        <th className="px-3 py-2 text-right">{t("colQuantity")}</th>
                        <th className="px-3 py-2 text-right">{t("colArea")}</th>
                        <th className="px-3 py-2 text-left">{t("colReason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <PreviewRowLine key={row.key} row={row} />
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t("previewNoChanges")}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <RainfallImportSection />
    </div>
  );
}
