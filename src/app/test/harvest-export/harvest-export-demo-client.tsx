"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";

import { DashboardKpiDateFilter } from "@/features/dashboard/DashboardKpiDateFilter";
import {
  buildHarvestExportDemoProjectOptions,
  buildHarvestExportDemoResolveContext,
  buildHarvestExportDemoRows,
  DEMO_HARVEST_EXPORT_FARMS,
  DEMO_HARVEST_EXPORT_GRASSES,
  DEMO_HARVEST_EXPORT_STATUSES,
} from "@/features/harvest/lib/harvestExportDemoData";
import { filterHarvestExportDemoRows } from "@/features/harvest/lib/harvestExportDemoFilter";
import type { HarvestListExportFilter } from "@/features/harvest/lib/harvestListExport";
import { HARVEST_EXPORT_DEMO_OAUTH_APP_NAME } from "@/app/test/harvest-export/constants";
import { HarvestExportDemoDialog } from "@/features/harvest/ui/HarvestExportDemoDialog";
import { cn } from "@/lib/utils";
import {
  KPI_DATE_PRESET_HARVEST as HARVEST_PRESETS,
  kpiDateRangeFromFilter,
  type KpiDeliveryDateFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";
import { formatDateDisplayDmy } from "@/shared/lib/format/date";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { MultiSelect } from "@/shared/ui/multi-select";

const HARVEST_DATE_FILTER_BASELINE = "all" as const;
const ALL_DEMO_ROWS = buildHarvestExportDemoRows();
const DEMO_RESOLVE_CONTEXT = buildHarvestExportDemoResolveContext();

function joinCsvFilter(values: string[]): string {
  return values.join(",");
}

function harvestStatusLabel(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "planned") return "Planned";
  if (s === "scheduled") return "Scheduled";
  if (s === "harvested") return "Harvested";
  if (s === "delivered") return "Delivered";
  return status || "—";
}

export function HarvestExportDemoClient() {
  const t = useAppTranslations("Harvest");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const resumeGoogleSheetExport =
    (searchParams.get("googleSheetExport") ?? "").trim() === "resume";

  const [search, setSearch] = useState("");
  const [farmIds, setFarmIds] = useState<string[]>([]);
  const [grassIds, setGrassIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [statusValues, setStatusValues] = useState<string[]>([]);
  const [harvestDateFilter, setHarvestDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: HARVEST_DATE_FILTER_BASELINE,
  });
  const [exportOpen, setExportOpen] = useState(resumeGoogleSheetExport);

  const deliveryHarvestRange = useMemo(
    () => kpiDateRangeFromFilter(harvestDateFilter),
    [harvestDateFilter],
  );
  const hasActiveDateFilter =
    harvestDateFilter.preset !== HARVEST_DATE_FILTER_BASELINE;
  const deliveryHarvestFrom = hasActiveDateFilter ? deliveryHarvestRange.start : "";
  const deliveryHarvestTo = hasActiveDateFilter ? deliveryHarvestRange.end : "";

  const exportFilter = useMemo<HarvestListExportFilter>(
    () => ({
      search: search.trim(),
      farmIds: joinCsvFilter(farmIds),
      grassIds: joinCsvFilter(grassIds),
      projectIds: joinCsvFilter(projectIds),
      statusValues: joinCsvFilter(statusValues),
      deliveryHarvestFrom,
      deliveryHarvestTo,
    }),
    [
      deliveryHarvestFrom,
      deliveryHarvestTo,
      farmIds,
      grassIds,
      projectIds,
      search,
      statusValues,
    ],
  );

  const filteredRows = useMemo(
    () => filterHarvestExportDemoRows(ALL_DEMO_ROWS, exportFilter),
    [exportFilter],
  );

  const hasActiveFilters =
    search.trim().length > 0 ||
    farmIds.length > 0 ||
    grassIds.length > 0 ||
    projectIds.length > 0 ||
    statusValues.length > 0 ||
    hasActiveDateFilter;

  const clearAllFilters = () => {
    setSearch("");
    setFarmIds([]);
    setGrassIds([]);
    setProjectIds([]);
    setStatusValues([]);
    setHarvestDateFilter({ preset: HARVEST_DATE_FILTER_BASELINE });
  };

  const clearGoogleSheetExportQuery = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("googleSheetExport");
    params.delete("googleSheetError");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const multiSelectBaseClass =
    "h-10 min-h-10 text-sm [&_button]:h-10 [&_button]:min-h-10";
  const filterTriggerIcon = (
    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
  );

  const projectOptions = buildHarvestExportDemoProjectOptions();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 lg:px-6">
      <header className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Internal API demo
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">
              {HARVEST_EXPORT_DEMO_OAUTH_APP_NAME}
            </h1>
          </div>
          <span className="rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
            Sample data · No login required
          </span>
        </div>

        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            This page demonstrates the <strong className="text-foreground">Harvest export API</strong>{" "}
            used inside our company portal. Filters mirror the live Harvest list page. Exported
            files group rows by <strong className="text-foreground">Client</strong>: the Client
            column is vertically merged, project-related columns share alternating beige / white
            block shading, and Grass Type / Quantity / UOM stay on separate lines within each
            client block.
          </p>
          <p>
            Users choose an output format — <strong className="text-foreground">CSV</strong>,{" "}
            <strong className="text-foreground">Excel (.xlsx)</strong>, or{" "}
            <strong className="text-foreground">Google Sheet</strong>. CSV and Excel are generated
            in the browser from the current filter. For Google Sheet, the user grants Google OAuth
            permission so the app can create a spreadsheet on their Google Drive with the same
            layout (merged Client cells, block colours, and column picker).
          </p>
          <p>
            All data shown here is <strong className="text-foreground">mock sample data</strong> for
            demonstration only.
          </p>
          <p className="text-xs">
            <a
              href="https://sportsturfsolutions.com/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Privacy Policy
            </a>
            <span className="mx-2 text-muted-foreground">·</span>
            <a
              href="https://sportsturfsolutions.com/terms-of-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Terms of Service
            </a>
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border p-4 lg:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">Filtered harvest rows</h2>
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              disabled={filteredRows.length === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export ({filteredRows.length})
            </button>
          </div>

          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <div className="relative min-w-[180px] shrink-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className={cn(
                  "h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  bgSurfaceFilter(search.trim().length > 0),
                )}
              />
            </div>

            <MultiSelect
              options={DEMO_HARVEST_EXPORT_FARMS.map((f) => ({
                value: f.id,
                label: f.label,
              }))}
              values={farmIds}
              onChange={setFarmIds}
              placeholder={t("allFarms")}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                "min-w-[160px] max-w-[220px] shrink-0",
                bgSurfaceFilter(farmIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />

            <MultiSelect
              options={DEMO_HARVEST_EXPORT_GRASSES.map((g) => ({
                value: g.id,
                label: g.title,
              }))}
              values={grassIds}
              onChange={setGrassIds}
              placeholder={t("allGrassTypes", {
                count: DEMO_HARVEST_EXPORT_GRASSES.length,
              })}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                "min-w-[160px] max-w-[220px] shrink-0",
                bgSurfaceFilter(grassIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />

            <MultiSelect
              options={DEMO_HARVEST_EXPORT_STATUSES.map((s) => ({
                value: s,
                label: harvestStatusLabel(s),
              }))}
              values={statusValues}
              onChange={setStatusValues}
              placeholder={t("allStatuses", { count: DEMO_HARVEST_EXPORT_STATUSES.length })}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                "min-w-[160px] max-w-[220px] shrink-0",
                bgSurfaceFilter(statusValues.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />

            <MultiSelect
              options={projectOptions.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
              values={projectIds}
              onChange={setProjectIds}
              placeholder={t("allProjectsCount", { count: projectOptions.length })}
              showAllOption
              className={cn(
                multiSelectBaseClass,
                "min-w-[160px] max-w-[220px] shrink-0",
                bgSurfaceFilter(projectIds.length > 0),
              )}
              rightIcon={filterTriggerIcon}
            />

            <DashboardKpiDateFilter
              value={harvestDateFilter}
              onChange={setHarvestDateFilter}
              presets={HARVEST_PRESETS}
              baselinePreset={HARVEST_DATE_FILTER_BASELINE}
              className="shrink-0"
            />

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAllFilters}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("clearAll")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredRows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">{t("exportCol_client")}</th>
                  <th className="px-4 py-3">{t("exportCol_grass_type")}</th>
                  <th className="px-4 py-3">{t("exportCol_farm")}</th>
                  <th className="px-4 py-3 text-right">{t("exportCol_quantity")}</th>
                  <th className="px-4 py-3">{t("exportCol_uom")}</th>
                  <th className="px-4 py-3">{t("exportCol_actual_harvest_date")}</th>
                  <th className="px-4 py-3">{t("exportCol_delivery_harvest_date")}</th>
                  <th className="px-4 py-3" title={t("portArrivalTitle")}>
                    {t("portArrivalShort")}
                  </th>
                  <th className="px-4 py-3">{t("exportCol_general_note")}</th>
                  <th className="px-4 py-3">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={String(row.id)}
                    className="border-b border-border/50 hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {String(row.project_name ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {String(row.grass_name ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {String(row.farm_name ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {Number(row.quantity).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {String(row.uom ?? "—")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateDisplayDmy(String(row.actual_harvest_date ?? ""))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateDisplayDmy(String(row.delivery_harvest_date ?? ""))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateDisplayDmy(String(row.shipment_required_date ?? ""))}
                    </td>
                    <td className="max-w-[220px] px-4 py-3 text-muted-foreground">
                      <span className="line-clamp-2">
                        {String(row.general_note ?? "—")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {harvestStatusLabel(String(row.harvest_status ?? ""))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <HarvestExportDemoDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        rows={filteredRows}
        resolveContext={DEMO_RESOLVE_CONTEXT}
        resumeGoogleSheetExport={resumeGoogleSheetExport}
        onResumeHandled={clearGoogleSheetExportQuery}
      />
    </div>
  );
}
