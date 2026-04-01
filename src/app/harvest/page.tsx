"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlignLeft,
  ArrowDown,
} from "lucide-react";

import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import RequireAuth from "@/features/auth/RequireAuth";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  mapRowsToSelectOptions,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { formatNumber } from "@/shared/lib/format/number";
import { MultiSelect } from "@/components/ui/multi-select";

const PER_PAGE = 30;

function isValidHarvestDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "0000-00-00") return false;
  return true;
}

/** List status: done when actual harvest date is set; otherwise progressing. */
function deriveHarvestListStatus(r: Record<string, unknown>): "done" | "progressing" {
  return isValidHarvestDateString(r.actual_harvest_date) ? "done" : "progressing";
}

/** UI label (internal values remain `done` | `progressing`). */
function harvestStatusDisplayLabel(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "done") return "Done";
  if (lower === "progressing") return "Processing";
  return status;
}

const HARVEST_STATUS_BADGE_BASE =
  "inline-flex px-2.5 py-1 text-xs font-medium rounded-full border bg-white";

/** Bordered pill: Done = primary border; Processing = #ECD929 border. */
function harvestStatusBadgeClassName(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "done" || lower.includes("deliver") || lower.includes("complete")) {
    return `${HARVEST_STATUS_BADGE_BASE} border-[var(--primary-color)] text-[var(--primary-color)]`;
  }
  if (
    lower === "progressing" ||
    lower.includes("transit") ||
    lower.includes("ship")
  ) {
    return `${HARVEST_STATUS_BADGE_BASE} border-[#ECD929] text-gray-800`;
  }
  if (lower.includes("pending") || lower.includes("plan")) {
    return `${HARVEST_STATUS_BADGE_BASE} border-amber-300 text-amber-900`;
  }
  return `${HARVEST_STATUS_BADGE_BASE} border-gray-300 text-gray-800`;
}

/**
 * Display date: prefer actual harvest date; if missing or invalid, use estimated.
 */
function pickHarvestDisplayDate(r: Record<string, unknown>): string {
  const actual = r.actual_harvest_date;
  const est = r.estimated_harvest_date;
  if (isValidHarvestDateString(actual)) return actual.trim().slice(0, 10);
  if (isValidHarvestDateString(est)) return est.trim().slice(0, 10);
  return "";
}

export type HarvestListRow = {
  id: string;
  date: string;
  project: string;
  farm: string;
  grass: string;
  zone: string;
  qty: number;
  /** Derived: `done` if `actual_harvest_date` is set, else `progressing`. */
  status: "done" | "progressing";
  qtyLabel: string;
};

function parseCsvFilter(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toCsvFilter(values: string[]): string {
  return Array.from(new Set(values.map((x) => String(x).trim()).filter(Boolean))).join(",");
}

function normalizeHarvestRow(raw: unknown): HarvestListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (id === undefined || id === null) return null;
  const dateStr = pickHarvestDisplayDate(r);
  const qty = Number(r.quantity);
  const q = Number.isFinite(qty) ? qty : 0;
  const uom = String(r.uom ?? "").trim();
  return {
    id: String(id),
    date: dateStr,
    project: String(r.project_name ?? ""),
    farm: String(r.farm_name ?? ""),
    grass: String(r.grass_name ?? ""),
    zone: String(r.zone ?? ""),
    qty: q,
    status: deriveHarvestListStatus(r),
    qtyLabel: uom ? `${q.toLocaleString()} ${uom}` : q.toLocaleString(),
  };
}

export default function HarvestListPage() {
  const router = useRouter();
  const farms = useHarvestingDataStore((s) => s.farms);
  const projects = useHarvestingDataStore((s) => s.projects);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const refLoading = useHarvestingDataStore((s) => s.loading);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const harvestListSearch = useHarvestingDataStore((s) => s.harvestListSearch);
  const setHarvestListSearch = useHarvestingDataStore(
    (s) => s.setHarvestListSearch,
  );
  const harvestListFarmFilter = useHarvestingDataStore(
    (s) => s.harvestListFarmFilter,
  );
  const setHarvestListFarmFilter = useHarvestingDataStore(
    (s) => s.setHarvestListFarmFilter,
  );
  const harvestListProjectFilter = useHarvestingDataStore(
    (s) => s.harvestListProjectFilter,
  );
  const setHarvestListProjectFilter = useHarvestingDataStore(
    (s) => s.setHarvestListProjectFilter,
  );
  const harvestListStatusFilter = useHarvestingDataStore(
    (s) => s.harvestListStatusFilter,
  );
  const setHarvestListStatusFilter = useHarvestingDataStore(
    (s) => s.setHarvestListStatusFilter,
  );

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [rows, setRows] = useState<HarvestListRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalM2, setTotalM2] = useState("0");
  const [totalKg, setTotalKg] = useState("0");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(harvestListSearch.trim()), 400);
    return () => clearTimeout(t);
  }, [harvestListSearch]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const projectOptions = useMemo(
    () => mapRowsToSelectOptions(projects as unknown[], "title"),
    [projects],
  );

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        per_page: PER_PAGE,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (harvestListFarmFilter) params.farm_id = harvestListFarmFilter;
      if (harvestListProjectFilter) params.project_id = harvestListProjectFilter;
      if (harvestListStatusFilter) params.harvest_status = harvestListStatusFilter;

      const res = await stsProxyGetHarvestingIndex(params);
      const normalized = res.rows
        .map(normalizeHarvestRow)
        .filter((x): x is HarvestListRow => x !== null);
      setRows(normalized);
      setTotalPages(res.totalPages);
      setTotalM2(res.totalM2);
      setTotalKg(res.totalKg);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to load harvest list.";
      setListError(msg);
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [
    page,
    debouncedSearch,
    harvestListFarmFilter,
    harvestListProjectFilter,
    harvestListStatusFilter,
  ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const zoneLabel = useCallback(
    (zoneId: string) => zoneIdToLabel(zoneId, farmZones),
    [farmZones],
  );
  const pageStart = rows.length > 0 ? (page - 1) * PER_PAGE + 1 : 0;
  const pageEnd = rows.length > 0 ? pageStart + rows.length - 1 : 0;
  const approxTotalLabel = `${formatNumber(totalPages * PER_PAGE)}+`;

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">
              Harvests
            </h1>
            <button
              onClick={() => router.push("/harvest/new")}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-button-primary text-white rounded-lg hover:bg-[#196A40] transition-colors"
              type="button"
            >
              <Plus className="w-5 h-5" />
              New Harvest
            </button>
          </div>

          <p className="text-sm text-gray-600 mb-4">
            Totals (filtered server-side): M2{" "}
            <span className="font-medium text-gray-900">{formatNumber(totalM2)}</span>
            {" · "}
            Kg <span className="font-medium text-gray-900">{formatNumber(totalKg)}</span>
            {totalPages > 1 ? (
              <span className="text-gray-500">
                {" "}
                · Page {page} of {totalPages}
              </span>
            ) : null}
          </p>

          {/* Filters */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={harvestListSearch}
                onChange={(e) => {
                  setHarvestListSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-full border border-gray-300 pl-10 pr-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="flex w-full items-center gap-1">
                <MultiSelect
                  options={farmOptions.map((o) => ({ value: o.id, label: o.label }))}
                  values={parseCsvFilter(harvestListFarmFilter)}
                  onChange={(values) => {
                    setHarvestListFarmFilter(toCsvFilter(values));
                    setPage(1);
                  }}
                  placeholder="All Farms"
                  disabled={refLoading}
                  className="rounded-lg border-gray-300"
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>
              <div className="flex w-full items-center gap-1">
                <MultiSelect
                  options={projectOptions.map((o) => ({ value: o.id, label: o.label }))}
                  values={parseCsvFilter(harvestListProjectFilter)}
                  onChange={(values) => {
                    setHarvestListProjectFilter(toCsvFilter(values));
                    setPage(1);
                  }}
                  placeholder="All Projects"
                  disabled={refLoading}
                  className="rounded-lg border-gray-300"
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>
              <div className="flex w-full items-center gap-1">
                <MultiSelect
                  options={[
                    { value: "done", label: harvestStatusDisplayLabel("done") },
                    { value: "progressing", label: harvestStatusDisplayLabel("progressing") },
                  ]}
                  values={parseCsvFilter(harvestListStatusFilter)}
                  onChange={(values) => {
                    setHarvestListStatusFilter(toCsvFilter(values));
                    setPage(1);
                  }}
                  placeholder="All Status"
                  className="rounded-lg border-gray-300"
                  rightIcon={
                    <>
                      <AlignLeft className="h-3.5 w-3.5" />
                      <ArrowDown className="h-3.5 w-3.5" />
                    </>
                  }
                />
              </div>
            </div>
          </div>

          {listError ? (
            <p className="text-sm text-red-600 mb-4" role="alert">
              {listError}
            </p>
          ) : null}

          {totalPages > 1 ? (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-800">
                {pageStart} - {pageEnd} of {approxTotalLabel} harvests
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={listLoading || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  disabled={listLoading || page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : null}

          {/* Harvests Table */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {listLoading ? (
              <p className="p-6 text-sm text-gray-600">Loading harvests…</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-gray-600">No harvests found.</p>
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Project
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Farm
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Grass
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Zone
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Qty
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {rows.map((harvest) => (
                        <tr key={harvest.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {harvest.date
                              ? new Date(harvest.date).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )
                              : "—"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                            {harvest.project ? (
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    `/harvest/new?id=${encodeURIComponent(harvest.id)}`,
                                  )
                                }
                                className="text-left text-[#1F7A4C] hover:text-[#196A40] hover:underline font-medium"
                              >
                                {harvest.project}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {harvest.farm || "—"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {harvest.grass || "—"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {harvest.zone
                              ? zoneLabel(harvest.zone) || harvest.zone
                              : "—"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {harvest.qtyLabel}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={harvestStatusBadgeClassName(harvest.status)}
                            >
                              {harvestStatusDisplayLabel(harvest.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="lg:hidden divide-y divide-gray-200">
                  {rows.map((harvest) => (
                    <div key={harvest.id} className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="font-medium text-gray-900 mb-1">
                            {harvest.project ? (
                              <button
                                type="button"
                                onClick={() =>
                                  router.push(
                                    `/harvest/new?id=${encodeURIComponent(harvest.id)}`,
                                  )
                                }
                                className="text-left text-[#1F7A4C] hover:text-[#196A40] hover:underline"
                              >
                                {harvest.project}
                              </button>
                            ) : (
                              "—"
                            )}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {harvest.date
                              ? new Date(harvest.date).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )
                              : "—"}
                          </p>
                        </div>
                        <span
                          className={harvestStatusBadgeClassName(harvest.status)}
                        >
                          {harvestStatusDisplayLabel(harvest.status)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-600">Farm:</span>
                          <div className="text-gray-900">
                            {harvest.farm || "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">Zone:</span>
                          <div className="text-gray-900">
                            {harvest.zone
                              ? zoneLabel(harvest.zone) || harvest.zone
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">Grass:</span>
                          <div className="text-gray-900">
                            {harvest.grass || "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">Quantity:</span>
                          <div className="text-gray-900">
                            {harvest.qtyLabel}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
