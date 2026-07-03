"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlignLeft, ArrowDown, Download, Search, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import { fetchAdminCountries, countryDisplayName } from "@/features/admin/api/countriesApi";
import { fetchItemFormOptions, type ItemFormOptions } from "@/features/admin/api/itemsApi";
import {
  fetchStockSummaryPage,
  STOCK_SUMMARY_PAGE_SIZE,
  type StockSummaryRow,
} from "@/features/warehouse/api/stockSummaryApi";
import type { StockSummaryExportFilter } from "@/features/warehouse/lib/stockSummaryExport";
import { StockSummaryExportDialog } from "@/features/warehouse/ui/StockSummaryExportDialog";
import { StockSummaryImportDialog } from "@/features/warehouse/ui/StockSummaryImportDialog";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { canAccessModule } from "@/shared/auth/permissions";
import {
  itemCategoryDisplayPath,
  sortItemCategoriesByPath,
  type ItemCategoryNode,
} from "@/shared/lib/itemCategoryPath";
import { formatNumber } from "@/shared/lib/format/number";
import { formatDateTimeDisplayDmyHms } from "@/shared/lib/format/date";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const multiSelectBaseClass =
  "min-w-[140px] max-w-[220px] rounded-md border border-input text-sm hover:bg-btnhover/40";

const filterTriggerIcon = (
  <>
    <AlignLeft className="h-3.5 w-3.5 shrink-0" />
    <ArrowDown className="h-3.5 w-3.5 shrink-0" />
  </>
);
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function collectCategoryDescendantIdsForRoot(
  categoryId: string,
  categories: ItemCategoryNode[],
): number[] {
  const rootId = Number(categoryId);
  if (!Number.isFinite(rootId) || rootId <= 0) return [];

  const childrenByParent = new Map<number, number[]>();
  for (const cat of categories) {
    const id = Number(cat.id);
    const parentId = Number(cat.parent_id ?? 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!Number.isFinite(parentId) || parentId <= 0) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(id);
    childrenByParent.set(parentId, list);
  }

  const ids: number[] = [];
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    for (const childId of childrenByParent.get(current) ?? []) {
      stack.push(childId);
    }
  }

  return ids;
}

function collectCategoryDescendantIds(
  categoryIds: string[],
  categories: ItemCategoryNode[],
): string {
  const allIds = new Set<number>();
  for (const categoryId of categoryIds) {
    for (const id of collectCategoryDescendantIdsForRoot(categoryId, categories)) {
      allIds.add(id);
    }
  }
  return [...allIds].join(",");
}

function formatCodeLines(
  row: StockSummaryRow,
  labels: {
    th: string;
    my: string;
    myn: string;
    sg: string;
    oldSku: string;
  },
): string[] {
  const lines: string[] = [];
  const base = String(row.commodity_code ?? "").trim();
  if (base) lines.push(base);
  if (String(row.thai_code ?? "").trim()) {
    lines.push(`${labels.th}: ${String(row.thai_code).trim()}`);
  }
  if (String(row.malaysia_code ?? "").trim()) {
    lines.push(`${labels.my}: ${String(row.malaysia_code).trim()}`);
  }
  if (String(row.myanmar_code ?? "").trim()) {
    lines.push(`${labels.myn}: ${String(row.myanmar_code).trim()}`);
  }
  if (String(row.singapore_code ?? "").trim()) {
    lines.push(`${labels.sg}: ${String(row.singapore_code).trim()}`);
  }
  if (String(row.old_sku ?? "").trim()) {
    lines.push(`${labels.oldSku}: ${String(row.old_sku).trim()}`);
  }
  return lines;
}

export function StockSummaryTab() {
  const t = useTranslations("StockSummary");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const user = useAuthUserStore((s) => s.user);
  const canImport =
    canAccessModule(user, "inventory", "import") ||
    canAccessModule(user, "inventory", "create");
  const canExport = canAccessModule(user, "inventory", "export");
  const [rows, setRows] = useState<StockSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalRecords, setTotalRecords] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const resumeGoogleSheetExport =
    (searchParams.get("googleSheetExport") ?? "").trim() === "resume";
  const googleSheetExportError = (searchParams.get("googleSheetError") ?? "").trim();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const pageLoadedRef = useRef(0);
  const loadMoreLockRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedCountryIds, setSelectedCountryIds] = useState<string[]>([]);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [countries, setCountries] = useState<
    Array<{ id: number; label: string; code: string }>
  >([]);
  const [formOptions, setFormOptions] = useState<ItemFormOptions | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchAdminCountries(), fetchItemFormOptions()])
      .then(([countryRows, options]) => {
        if (cancelled) return;
        setCountries(
          countryRows
            .map((row) => ({
              id: Number(row.id),
              label: countryDisplayName(row),
              code: String(row.country_code ?? "").trim().toUpperCase(),
            }))
            .filter((row) => Number.isFinite(row.id) && row.id > 0)
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
        setFormOptions(options);
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : t("errors.loadFilters"), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const countryFilterOptions = useMemo(
    () => countries.map((country) => ({ value: String(country.id), label: country.label })),
    [countries],
  );

  const brandFilterOptions = useMemo(
    () =>
      (formOptions?.brands ?? []).map((brand) => ({
        value: String(brand.id),
        label: brand.name,
      })),
    [formOptions],
  );

  const categoryFilterOptions = useMemo(() => {
    if (!formOptions?.categories?.length) return [];
    const sorted = sortItemCategoriesByPath(formOptions.categories);
    return sorted.map((cat) => ({
      value: String(cat.id),
      label: itemCategoryDisplayPath(cat, formOptions.categories),
    }));
  }, [formOptions]);

  const selectedCountryCodeSet = useMemo(() => {
    const codes = new Set<string>();
    for (const id of selectedCountryIds) {
      const country = countries.find((row) => String(row.id) === id);
      if (country?.code) codes.add(country.code);
    }
    return codes;
  }, [countries, selectedCountryIds]);

  const selectedBrandIdSet = useMemo(
    () => new Set(selectedBrandIds),
    [selectedBrandIds],
  );

  const listQueryParams = useMemo(() => {
    const categoryId =
      selectedCategoryIds.length > 0 && formOptions?.categories?.length
        ? collectCategoryDescendantIds(selectedCategoryIds, formOptions.categories)
        : undefined;
    return {
      country_id:
        selectedCountryIds.length === 1 ? selectedCountryIds[0] : undefined,
      brand_id: selectedBrandIds.length === 1 ? selectedBrandIds[0] : undefined,
      category_id: categoryId || undefined,
      search: search || undefined,
      per_page: STOCK_SUMMARY_PAGE_SIZE,
    };
  }, [
    formOptions,
    search,
    selectedBrandIds,
    selectedCategoryIds,
    selectedCountryIds,
  ]);

  const applyClientFilters = useCallback(
    (data: StockSummaryRow[]) =>
      data.filter((row) => {
        if (selectedCountryIds.length > 1) {
          const code = String(row.country_code ?? "").trim().toUpperCase();
          if (!code || !selectedCountryCodeSet.has(code)) return false;
        }
        if (selectedBrandIds.length > 1) {
          const brandId = String(row.brand_id ?? "");
          if (!brandId || !selectedBrandIdSet.has(brandId)) return false;
        }
        return true;
      }),
    [
      selectedBrandIdSet,
      selectedBrandIds.length,
      selectedCountryCodeSet,
      selectedCountryIds.length,
    ],
  );

  const loadPage = useCallback(
    async (page: number, mode: "replace" | "append") => {
      const isAppend = mode === "append";
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await fetchStockSummaryPage({
          ...listQueryParams,
          page,
        });
        const filtered = applyClientFilters(result.rows);

        setRows((prev) => (isAppend ? [...prev, ...filtered] : filtered));
        setTotalRecords(result.totalRecords);
        pageLoadedRef.current = page;
        setHasMore(page < result.totalPages);
      } catch (error) {
        if (!isAppend) {
          setRows([]);
          setTotalRecords(null);
          setHasMore(false);
        }
        toast.error(error instanceof Error ? error.message : t("errors.load"), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } finally {
        if (isAppend) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [applyClientFilters, listQueryParams, t],
  );

  const reloadFromStart = useCallback(async () => {
    pageLoadedRef.current = 0;
    loadMoreLockRef.current = false;
    setHasMore(false);
    await loadPage(1, "replace");
  }, [loadPage]);

  useEffect(() => {
    void reloadFromStart();
  }, [reloadFromStart]);

  useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (!el || loading || loadingMore || !hasMore) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (loadMoreLockRef.current || loading || loadingMore || !hasMore) return;
        loadMoreLockRef.current = true;
        const nextPage = pageLoadedRef.current + 1;
        void loadPage(nextPage, "append").finally(() => {
          loadMoreLockRef.current = false;
        });
      },
      { root: null, rootMargin: "160px", threshold: 0 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadPage, loading, loadingMore, rows.length]);

  const codeLabels = useMemo(
    () => ({
      th: t("code.th"),
      my: t("code.my"),
      myn: t("code.myn"),
      sg: t("code.sg"),
      oldSku: t("code.oldSku"),
    }),
    [t],
  );

  const clearGoogleSheetExportQuery = useCallback(() => {
    const params = new URLSearchParams(searchParamsKey);
    params.delete("googleSheetExport");
    params.delete("googleSheetError");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsKey]);

  useEffect(() => {
    if (resumeGoogleSheetExport) {
      setExportOpen(true);
    }
  }, [resumeGoogleSheetExport]);

  const exportFilter = useMemo<StockSummaryExportFilter>(
    () => ({
      countryIds: selectedCountryIds,
      brandIds: selectedBrandIds,
      categoryIds: selectedCategoryIds,
      search,
    }),
    [search, selectedBrandIds, selectedCategoryIds, selectedCountryIds],
  );

  const exportResolveContext = useMemo(
    () => ({
      codeLabels,
      countryCodeById: new Map(
        countries.map((country) => [String(country.id), country.code]),
      ),
      categories: formOptions?.categories ?? [],
    }),
    [codeLabels, countries, formOptions?.categories],
  );

  const onHandTotal = useMemo(
    () => rows.reduce((sum, row) => sum + num(row.on_hand), 0),
    [rows],
  );

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground lg:text-3xl">
          {t("title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {canExport ? (
            <button
              type="button"
              className={btnOutline}
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-4 w-4" />
              {t("export.button")}
            </button>
          ) : null}
          {canImport ? (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" />
              {t("import.button")}
            </button>
          ) : null}
        </div>
      </div>

      {googleSheetExportError ? (
        <p className="text-sm text-destructive">{googleSheetExportError}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <MultiSelect
          options={countryFilterOptions}
          values={selectedCountryIds}
          onChange={setSelectedCountryIds}
          placeholder={t("filters.allCountries")}
          showAllOption
          className={cn(
            multiSelectBaseClass,
            bgSurfaceFilter(selectedCountryIds.length > 0),
          )}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={brandFilterOptions}
          values={selectedBrandIds}
          onChange={setSelectedBrandIds}
          placeholder={t("filters.allBrands")}
          showAllOption
          className={cn(
            multiSelectBaseClass,
            bgSurfaceFilter(selectedBrandIds.length > 0),
          )}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={categoryFilterOptions}
          values={selectedCategoryIds}
          onChange={setSelectedCategoryIds}
          placeholder={t("filters.allCategories")}
          showAllOption
          selectionSummary="compact"
          className={cn(
            multiSelectBaseClass,
            "max-w-[280px]",
            bgSurfaceFilter(selectedCategoryIds.length > 0),
          )}
          rightIcon={filterTriggerIcon}
        />
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            className="h-10 w-full rounded-full border border-gray-300 bg-background py-1 pl-9 pr-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
          />
        </div>
      </div>

      <Card className="overflow-hidden border-border">
        <CardContent className="space-y-0 p-0">
          {!loading && rows.length > 0 ? (
            <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              {totalRecords != null
                ? t("list.showingOf", { shown: rows.length, total: totalRecords })
                : t("list.showing", { shown: rows.length })}
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">
                    {t("table.brand")}
                  </th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground lg:table-cell">
                    {t("table.category")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    {t("table.skuSts")}
                  </th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">
                    {t("table.code")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    {t("table.name")}
                  </th>
                  <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground lg:table-cell">
                    {t("table.unit")}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                    {t("table.country")}
                  </th>
                  <th className="w-24 px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                    {t("table.onHand")}
                  </th>
                  <th className="hidden min-w-[160px] px-4 py-3 text-left text-xs font-medium text-muted-foreground xl:table-cell">
                    {t("table.lastUpdate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      {t("loading")}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      {t("empty")}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const codeLines = formatCodeLines(row, codeLabels);
                    const rowKey = `${row.id ?? "row"}-${row.sku_sts ?? ""}-${row.country_code ?? ""}-${index}`;
                    return (
                      <tr
                        key={rowKey}
                        className="border-t border-border/60 align-top hover:bg-muted/20"
                      >
                        <td className="hidden px-4 py-3 text-foreground md:table-cell">
                          {String(row.brand_name ?? "").trim() || "—"}
                        </td>
                        <td className="hidden px-4 py-3 text-foreground lg:table-cell">
                          {String(row.category_title ?? "").trim() || "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {String(row.sku_sts ?? "").trim() || "—"}
                        </td>
                        <td className="hidden px-4 py-3 text-foreground md:table-cell">
                          {codeLines.length > 0 ? (
                            <div className="space-y-0.5 text-xs leading-snug">
                              {codeLines.map((line) => (
                                <div key={line}>{line}</div>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {String(row.commodity_name ?? "").trim() || "—"}
                        </td>
                        <td className="hidden px-4 py-3 text-foreground lg:table-cell">
                          {String(row.unit_name ?? "").trim() || "—"}
                        </td>
                        <td className="px-4 py-3 text-center text-foreground">
                          {String(row.country_code ?? "").trim() || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                          {formatNumber(num(row.on_hand))}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-foreground xl:table-cell">
                          {formatDateTimeDisplayDmyHms(row.last_update)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && rows.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td
                      colSpan={8}
                      className="px-4 py-3 text-sm font-semibold text-foreground"
                    >
                      {t("table.totalLoaded")}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatNumber(onHandTotal)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div ref={loadMoreSentinelRef} className="h-1" aria-hidden />
          {loadingMore ? (
            <p className="border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">
              {t("list.loadingMore")}
            </p>
          ) : null}
          {!loading && !loadingMore && hasMore ? (
            <div className="border-t border-border px-4 py-3 text-center">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (loadMoreLockRef.current || loadingMore || !hasMore) return;
                  loadMoreLockRef.current = true;
                  const nextPage = pageLoadedRef.current + 1;
                  void loadPage(nextPage, "append").finally(() => {
                    loadMoreLockRef.current = false;
                  });
                }}
              >
                {t("list.loadMore")}
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canExport ? (
        <StockSummaryExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          initialFilter={exportFilter}
          resolveContext={exportResolveContext}
          countryOptions={countryFilterOptions}
          brandOptions={brandFilterOptions}
          categoryOptions={categoryFilterOptions}
          resumeGoogleSheetExport={resumeGoogleSheetExport}
          onResumeHandled={clearGoogleSheetExportQuery}
        />
      ) : null}

      <StockSummaryImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void reloadFromStart()}
        stockRows={rows}
        countries={countries}
      />
    </div>
  );
}
