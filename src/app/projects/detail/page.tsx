"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Building2,
  MapPin,
  Calendar,
  Image as ImageIcon,
} from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  fetchMondayProjectRowsFromServer,
  type MondayProjectServerRow,
} from "@/entities/projects";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import {
  HARVEST_ATTACHMENT_SOURCES,
  getAttachmentUrls,
  getFirstAttachmentUrlFromSubitems,
} from "@/shared/lib/harvestAttachmentImages";
import { formatDateDisplay, isValidDate } from "@/shared/lib/format/date";
import { zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { parseJsonMaybe, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { calculateDeliveredQuantity } from "@/features/project/lib/subitemDeliveredQuantity";
import { iconPaths } from "@/lib/assets/images";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import { compareNumbers, compareStrings } from "@/shared/lib/tableSort";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode } from "swiper/modules";
import { Fancybox } from "@fancyapps/ui";
import "swiper/css";
import "swiper/css/free-mode";
import "@fancyapps/ui/dist/fancybox/fancybox.css";

type GrassRow = {
  id: string;
  name: string;
  required: number;
  delivered: number;
  remaining: number;
  progress: number;
};

type GrassSortKey = "name" | "required" | "delivered" | "remaining" | "progress";

type HarvestRow = {
  id: string;
  productId: string;
  uom: string;
  status: "done" | "progressing";
  date: string;
  grass: string;
  zone: string;
  quantity: string;
  remainingQuantityDisplay: string | null;
  refQtyDisplay: string | null;
  /** `harvested_area` formatted when UOM is Kg (reference quantity + Kg). */
  harvestedAreaDisplay: string | null;
  /** `harvested_area` / quantity when UOM is M2 (Harvested area + m²). */
  harvestedAreaM2Display: string | null;
  estimatedDate: string;
  actualDate: string;
  deliveryDate: string;
  doSoNumber: string;
  truckNote: string;
  attachments: Array<{ label: string; url: string }>;
};

function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseRequirements(raw: unknown): Array<Record<string, unknown>> {
  const p = parseJsonMaybe(raw);
  return Array.isArray(p) ? (p.filter((x) => !!x && typeof x === "object") as Array<Record<string, unknown>>) : [];
}

function normalizeUomKey(uomRaw: string): string {
  const u = uomRaw.trim().toLowerCase();
  if (u === "m²") return "m2";
  return u;
}

export default function ProjectDetailPage() {
  // Namespace-scoped translators: `useTranslations()` without a namespace + dynamic
  // `ProjectDetail.${key}` can fail to resolve some nested keys in next-intl 4 (fallback shows
  // `ProjectDetail.harvestedArea`). Using namespaces matches the JSON shape and yields stable `t`.
  const t = useAppTranslations("ProjectDetail");
  const tForm = useAppTranslations("HarvestForm");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowId = searchParams.get("rowId")?.trim() ?? "";
  const tableId = searchParams.get("tableId")?.trim() ?? "";
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const staffsRef = useHarvestingDataStore((s) => s.staffs);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectRow, setProjectRow] = useState<MondayProjectServerRow | null>(null);
  const [harvests, setHarvests] = useState<HarvestRow[]>([]);
  const [expandedHarvestId, setExpandedHarvestId] = useState<string | null>(null);
  const currentProjectId = useMemo(
    () => String(projectRow?.project_id ?? "").trim(),
    [projectRow],
  );

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const projectTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of projectsRef as unknown[]) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const title = String(rec.title ?? rec.name ?? "").trim();
      if (id && title) map.set(id, title);
    }
    return map;
  }, [projectsRef]);

  const countryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of countriesRef as unknown[]) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const name = String(rec.country_name ?? rec.name ?? rec.title ?? "").trim();
      if (id && name) map.set(id, name);
    }
    return map;
  }, [countriesRef]);

  const staffMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of staffsRef as unknown[]) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const name = String(rec.first_name ?? rec.full_name ?? rec.name ?? "").trim();
      if (id && name) map.set(id, name);
    }
    return map;
  }, [staffsRef]);

  const productMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of productsRef as unknown[]) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      const name = String(rec.name ?? rec.title ?? "").trim();
      if (id && name) map.set(id, name);
    }
    return map;
  }, [productsRef]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        if (!rowId) {
          setError(t("missingRowId"));
          return;
        }
        const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 300 });
        if (!mounted) return;
        const row =
          res.rows.find((r) => String(r.row_id ?? "").trim() === rowId) ??
          res.rows.find((r) => String(r.id ?? "").trim() === rowId) ??
          null;
        if (!row) {
          setError(t("cannotFindDetail"));
          return;
        }
        setProjectRow(row);

        const projectId = String(row.project_id ?? "").trim();
        if (projectId) {
          const requirementRows = parseRequirements(row.quantity_required_sprig_sod);
          const projectSubitems = parseSubitems(row.subitems);
          const remainingByProductUom = new Map<string, number>();
          const unitByProductUom = new Map<string, string>();
          for (const req of requirementRows) {
            const productId = String(req.product_id ?? "").trim();
            if (!productId) continue;
            const reqUomRaw = String(req.uom ?? "").trim();
            const reqUomKey = normalizeUomKey(reqUomRaw);
            const required = parseNumber(req.quantity);
            const delivered = calculateDeliveredQuantity(projectSubitems, productId, reqUomRaw);
            const remaining = Math.max(0, required - delivered);
            const mapKey = `${productId}::${reqUomKey}`;
            remainingByProductUom.set(mapKey, remaining);
            unitByProductUom.set(mapKey, reqUomRaw || "-");
          }

          const h = await stsProxyGetHarvestingIndex({
            project_id: projectId,
            per_page: 30,
            page: 1,
          });
          if (!mounted) return;
          const farmZonesForLabels = useHarvestingDataStore.getState().farmZones;
          const parsed: HarvestRow[] = h.rows
            .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
            .map((r) => {
              const actual = String(r.actual_harvest_date ?? "").trim();
              const estimated = String(r.estimated_harvest_date ?? "").trim();
              const status = isValidDate(actual) ? "done" : "progressing";
              // Always render 6 attachment slots; empty field -> placeholder preview.
              const attachments: Array<{ label: string; url: string }> = HARVEST_ATTACHMENT_SOURCES.map(
                (src) => ({
                  label: src.label,
                  // Prefer row-level field, fallback to subitems field.
                  url:
                    getAttachmentUrls(r[src.field])[0] ??
                    getFirstAttachmentUrlFromSubitems(r.subitems, src.field) ??
                    "",
                }),
              );

              const uomRaw = String(r.uom ?? "").trim();
              const uomLower = uomRaw.toLowerCase();
              const ha = parseNumber(r.harvested_area);
              const refHarvestQty = parseNumber(r.ref_hrv_qty_sprig);
              const qty = parseNumber(r.quantity);
              const productId = String(r.product_id ?? "").trim();
              const uomKey = normalizeUomKey(uomRaw);
              const remainingMapKey = `${productId}::${uomKey}`;
              const remainingQty = remainingByProductUom.get(remainingMapKey);
              const remainingUnit = unitByProductUom.get(remainingMapKey) ?? uomRaw;
              const remainingQuantityDisplay =
                remainingQty != null
                  ? `${remainingQty.toLocaleString()} ${remainingUnit}`.trim()
                  : null;
              const harvestedAreaDisplay =
                uomLower === "kg" && ha > 0 ? ha.toLocaleString() : null;
              const refQtyDisplay =
                refHarvestQty > 0 ? refHarvestQty.toLocaleString() : null;
              const harvestedAreaM2Display =
                uomLower === "m2" && (ha > 0 || qty > 0)
                  ? (ha > 0 ? ha : qty).toLocaleString()
                  : null;

              return {
                id: String(r.id ?? ""),
                productId,
                uom: uomRaw,
                status,
                date: formatDateDisplay(isValidDate(actual) ? actual : estimated),
                grass: String(r.grass_name ?? r.commodity_name ?? "-"),
                zone: zoneIdToLabel(r.zone as string | undefined, farmZonesForLabels) ||
                  "-",
                quantity: `${parseNumber(r.quantity).toLocaleString()} ${uomRaw}`,
                remainingQuantityDisplay,
                refQtyDisplay,
                harvestedAreaDisplay,
                harvestedAreaM2Display,
                estimatedDate: formatDateDisplay(r.estimated_harvest_date),
                actualDate: formatDateDisplay(r.actual_harvest_date),
                deliveryDate: formatDateDisplay(r.delivery_harvest_date),
                doSoNumber: String(r.do_so_number ?? "").trim() || "-",
                truckNote: String(r.truck_note ?? "").trim() || "-",
                attachments,
              };
            });
          setHarvests(parsed);
        }
      } catch (e) {
        if (!mounted) return;
        setError(
          e instanceof Error ? e.message : t("loadError"),
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // Intentionally only `rowId`: including unstable deps caused repeated fetch loops; `farmZones`
    // from the store gets a new reference after bootstrap.
  }, [rowId]);

  useEffect(() => {
    Fancybox.bind(".harvest-fancybox-trigger", {
      Carousel: {
        infinite: false,
      },
    });
    return () => {
      Fancybox.unbind(".harvest-fancybox-trigger");
    };
  }, [expandedHarvestId, harvests]);

  const basic = useMemo(() => {
    const r = projectRow;
    if (!r) return null;
    const projectId = String(r.project_id ?? "").trim();
    const countryId = String(r.country_id ?? "").trim();
    const picId = String(r.pic ?? "").trim();
    return {
      projectName:
        projectTitleMap.get(projectId) ||
        String((r.title ?? r.name ?? projectId) || "-"),
      golfClub: String(r.name ?? r.title ?? "-"),
      company: String(r.alias_title ?? "-"),
      architect: String((r as Record<string, unknown>).golf_course_architect ?? "-"),
      country: countryMap.get(countryId) || String(r.country ?? "-"),
      pic: staffMap.get(picId) || picId || "-",
      projectType: String(r.project_type ?? "-"),
      holes: String(r.no_of_holes ?? "-"),
      estimateStartDate: formatDateDisplay((r as Record<string, unknown>).estimate_start_date),
      actualStartDate: formatDateDisplay((r as Record<string, unknown>).actual_start_date),
      endDate: formatDateDisplay(r.deadline),
      keyAreas: String(r.key_areas ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    };
  }, [projectRow, projectTitleMap, countryMap, staffMap]);

  const grassRows = useMemo<GrassRow[]>(() => {
    if (!projectRow) return [];
    const req = parseRequirements(projectRow.quantity_required_sprig_sod);
    const subitems = parseSubitems(projectRow.subitems);
    return req.map((r, idx) => {
      const productId = String(r.product_id ?? "").trim();
      const uom = String(r.uom ?? "").trim();
      const required = parseNumber(r.quantity);
      const delivered = calculateDeliveredQuantity(subitems, productId, uom);
      const remaining = Math.max(0, required - delivered);
      const progress = required > 0 ? Math.round((delivered / required) * 100) : 0;
      const productName =
        productMap.get(productId) ||
        productId ||
        t("unknownGrass");
      return {
        id: `${productId || "item"}-${idx}`,
        name: `${productName}${uom ? ` (${uom})` : ""}`,
        required,
        delivered,
        remaining,
        progress: Math.max(0, Math.min(100, progress)),
      };
    });
  }, [projectRow, productMap, t]);

  const { sortKey, sortDir, onSort } = useTableColumnSort<GrassSortKey>("name");

  const sortedGrassRows = useMemo(() => {
    const list = [...grassRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return compareStrings(a.name, b.name, sortDir);
        case "required":
          return compareNumbers(a.required, b.required, sortDir);
        case "delivered":
          return compareNumbers(a.delivered, b.delivered, sortDir);
        case "remaining":
          return compareNumbers(a.remaining, b.remaining, sortDir);
        case "progress":
          return compareNumbers(a.progress, b.progress, sortDir);
        default:
          return 0;
      }
    });
    return list;
  }, [grassRows, sortKey, sortDir]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
          <div className="mb-6 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("backToProjects")}
            </button>
          </div>

          {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-gray-600">{t("loading")}</p>
          ) : !projectRow || !basic ? (
            <p className="text-sm text-gray-600">{t("empty")}</p>
          ) : (
            <>
              <section className="mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
                <div className="flex items-center justify-between bg-[var(--primary-color)] px-8 py-4">
                  <h2 className="uppercase tracking-wider text-white">{t("projectDetails")}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      const editRowId =
                        String(projectRow?.row_id ?? projectRow?.id ?? "").trim() || rowId;
                      const editTableId =
                        String(projectRow?.table_id ?? "").trim() || tableId;
                      router.push(
                        `/projects/new?rowId=${encodeURIComponent(editRowId)}&tableId=${encodeURIComponent(editTableId)}&returnTo=${encodeURIComponent(returnTo)}`,
                      );
                    }}
                    className="rounded-lg p-2 text-white transition-colors hover:bg-white/10"
                  >
                    <svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2.25 14.5H8.55H14.5M0.5 13.268V10.608L10.4159 1.06225C10.7907 0.701519 11.2906 0.5 11.8107 0.5H12.1203C13.1081 0.5 13.8925 1.33059 13.8362 2.31671C13.8128 2.72543 13.6444 3.11239 13.3611 3.40793L4.42 12.736L1.13147 13.7774C1.0841 13.7924 1.03472 13.8 0.985037 13.8C0.717158 13.8 0.5 13.5826 0.5 13.3148C0.5 13.1198 0.5 13.0218 0.5 13.268Z" stroke="#FFFFFF" />
                    </svg>

                  </button>
                </div>
                <div className="p-6 lg:p-8">
                  <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6">
                    <div>
                      <div className="space-y-3 text-sm">
                        <p><span className="inline-block w-[130px] text-gray-500">{t("projectName")} </span>{basic.projectName}</p>
                        <p><span className="inline-block w-[130px] text-gray-500">{t("golfClubStadium")} </span>{basic.golfClub}</p>
                        <p><span className="inline-block w-[130px] text-gray-500">{t("companyName")} </span>{basic.company}</p>
                        <p><span className="inline-block w-[130px] text-gray-500">{t("golfCourseArchitect")} </span>{basic.architect}</p>
                      </div>
                    </div>

                    <div>
                      <div className="space-y-3 text-sm">
                        <p><span className="inline-block w-[120px] text-gray-500">{t("country")} </span>{basic.country}</p>
                        <p><span className="inline-block w-[120px] text-gray-500">{t("personInCharge")} </span>{basic.pic}</p>
                        <p><span className="inline-block w-[120px] text-gray-500">{t("projectType")} </span>{basic.projectType}</p>
                        <p><span className="inline-block w-[120px] text-gray-500">{t("noOfHoles")} </span>{basic.holes}</p>
                      </div>
                    </div>

                    <div>
                      <div className="space-y-3 text-sm">
                        <p><span className="inline-block w-[130px] text-gray-500">{t("estimateStartDate")} </span>{basic.estimateStartDate}</p>
                        <p><span className="inline-block w-[130px] text-gray-500">{t("actualStartDate")} </span>{basic.actualStartDate}</p>
                        <p><span className="inline-block w-[130px] text-gray-500">{t("endDate")} </span>{basic.endDate}</p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          <p><span className="text-gray-500">{t("keyAreas")} </span></p>
                          {(basic.keyAreas.length ? basic.keyAreas : ["-"]).map((a) => (
                            <span key={a} className="rounded-full bg-green-50 px-3 py-1 text-xs text-green-700">
                              {a}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border-gray-200">
                    <h3 className="mb-4 border-b border-gray-200 pb-3 uppercase tracking-wider text-[#5a7d3c]">
                      {t("grassesDetails")}
                    </h3>
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="w-full min-w-[760px]">
                        <thead className="bg-white">
                          <tr className="text-left text-xs uppercase tracking-wide text-gray-700">
                            <SortableTh
                              label={t("grassType")}
                              columnKey="name"
                              activeKey={sortKey}
                              direction={sortDir}
                              onSort={onSort}
                              className="px-4 py-3 !normal-case"
                            />
                            <SortableTh
                              label={t("required")}
                              columnKey="required"
                              activeKey={sortKey}
                              direction={sortDir}
                              onSort={onSort}
                              align="right"
                              className="px-4 py-3 !normal-case"
                            />
                            <SortableTh
                              label={t("delivered")}
                              columnKey="delivered"
                              activeKey={sortKey}
                              direction={sortDir}
                              onSort={onSort}
                              align="right"
                              className="px-4 py-3 !normal-case"
                            />
                            <SortableTh
                              label={t("remaining")}
                              columnKey="remaining"
                              activeKey={sortKey}
                              direction={sortDir}
                              onSort={onSort}
                              align="right"
                              className="px-4 py-3 !normal-case"
                            />
                            <SortableTh
                              label={t("progress")}
                              columnKey="progress"
                              activeKey={sortKey}
                              direction={sortDir}
                              onSort={onSort}
                              align="right"
                              className="px-4 py-3 !normal-case"
                            />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {sortedGrassRows.length === 0 ? (
                            <tr><td className="px-4 py-4 text-sm text-gray-500" colSpan={5}>{t("noGrasses")}</td></tr>
                          ) : (
                            sortedGrassRows.map((g) => (
                              <tr key={g.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900">{g.name}</td>
                                <td className="px-4 py-3 text-right text-sm">{g.required.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-sm">{g.delivered.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-sm text-red-600">{g.remaining.toLocaleString()}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
                                      <div className="h-full rounded-full bg-gradient-to-r from-[#5a7d3c] to-[#6b8f4a]" style={{ width: `${g.progress}%` }} />
                                    </div>
                                    <span className="w-10 text-right text-sm text-[#5a7d3c]">{g.progress}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
                <div className="flex items-center justify-between bg-[var(--primary-color)] px-8 py-4">
                  <h2 className="uppercase tracking-wider text-white">{t("harvestHistory")}</h2>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/harvest/new?returnTo=${encodeURIComponent(returnTo)}&projectId=${encodeURIComponent(currentProjectId)}`,
                      )
                    }
                    className="rounded-lg bg-white/20 p-2 text-white hover:bg-white/30"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                <div className="p-6 lg:p-8">
                  {harvests.length === 0 ? (
                    <p className="text-sm text-gray-600">{t("noHarvestRecords")}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      {harvests.map((h, idx) => {
                        const isExpanded = expandedHarvestId === h.id;
                        return (
                          <div
                            key={h.id}
                            className={`rounded-[20px] relative border-2 px-4 pt-12 pb-4 transition-all border-gray-200  ${isExpanded
                              ? "border-[#5a7d3c] shadow-2xl lg:col-span-2"
                              : "hover:shadow-xl hover:border-[#5a7d3c] hover:-translate-y-1"
                              }`}
                          >

                            <div className="absolute left-0 top-0 flex items-center gap-3">
                              <div
                                className={`absolute top-[1px] py-1 px-3 pr-[100px] ${h.status === "done"
                                  ? "border-[var(--primary-color)] text-[var(--primary-color)]"
                                  : "border-[#ECD929] text-gray-800"
                                  }`}
                              >
                                {idx + 1}
                              </div>
                              <span
                                className={`text absolute left-[-1px] top-[-2px] rounded-tr-[30px] rounded-br-[30px] rounded-tl-[30px] py-2 pl-10 pr-2 text-xs ${h.status === "done"
                                  ? "border border-[var(--primary-color)] text-[var(--primary-color)]"
                                  : "border border-[#ECD929] text-gray-800"
                                  }`}
                              >
                                {h.status === "done" ? t("statusDone") : t("statusProgressing")}
                              </span>
                            </div>

                            <div className="absolute right-3 top-1 flex items-center gap-3">
                              {isExpanded ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    router.push(
                                      `/harvest/new?id=${encodeURIComponent(h.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                                    )
                                  }
                                  className="rounded-lg p-2 text-[#5a7d3c] transition-colors hover:bg-green-50"
                                >
                                  <svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M2.25 14.5H8.55H14.5M0.5 13.268V10.608L10.4159 1.06225C10.7907 0.701519 11.2906 0.5 11.8107 0.5H12.1203C13.1081 0.5 13.8925 1.33059 13.8362 2.31671C13.8128 2.72543 13.6444 3.11239 13.3611 3.40793L4.42 12.736L1.13147 13.7774C1.0841 13.7924 1.03472 13.8 0.985037 13.8C0.717158 13.8 0.5 13.5826 0.5 13.3148C0.5 13.1198 0.5 13.0218 0.5 13.268Z" stroke="#1f7a4c" />
                                  </svg>

                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setExpandedHarvestId(isExpanded ? null : h.id)}
                                className="rounded-lg p-2 text-[#5a7d3c] transition-colors hover:bg-green-50"
                              >
                                {isExpanded ? (
                                  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7.83333 4.16667H7.33333V4.66667H7.83333V4.16667ZM11.8536 0.853553C12.0488 0.658291 12.0488 0.341709 11.8536 0.146447C11.6583 -0.0488155 11.3417 -0.0488155 11.1464 0.146447L11.5 0.5L11.8536 0.853553ZM4.16667 7.83333H4.66667V7.33333H4.16667V7.83333ZM0.146447 11.1464C-0.0488155 11.3417 -0.0488155 11.6583 0.146447 11.8536C0.341709 12.0488 0.658291 12.0488 0.853553 11.8536L0.5 11.5L0.146447 11.1464ZM7.83333 1.11111H7.33333V4.16667H7.83333H8.33333V1.11111H7.83333ZM7.83333 4.16667V4.66667H10.8889V4.16667V3.66667H7.83333V4.16667ZM7.83333 4.16667L8.18689 4.52022L11.8536 0.853553L11.5 0.5L11.1464 0.146447L7.47978 3.81311L7.83333 4.16667ZM4.16667 10.8889H4.66667V7.83333H4.16667H3.66667V10.8889H4.16667ZM4.16667 7.83333V7.33333H1.11111V7.83333V8.33333H4.16667V7.83333ZM4.16667 7.83333L3.81311 7.47978L0.146447 11.1464L0.5 11.5L0.853553 11.8536L4.52022 8.18689L4.16667 7.83333Z" fill="#1f7a4c" />
                                  </svg>

                                ) : (
                                  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M2 10H1.5V10.5H2V10ZM4.85355 7.85355C5.04882 7.65829 5.04882 7.34171 4.85355 7.14645C4.65829 6.95118 4.34171 6.95118 4.14645 7.14645L4.5 7.5L4.85355 7.85355ZM2 7H1.5V10H2H2.5V7H2ZM2 10V10.5H5V10V9.5H2V10ZM2 10L2.35355 10.3536L4.85355 7.85355L4.5 7.5L4.14645 7.14645L1.64645 9.64645L2 10Z" fill="#1f7a4c" />
                                    <path d="M10 2H10.5V1.5H10V2ZM7.14645 4.14645C6.95118 4.34171 6.95118 4.65829 7.14645 4.85355C7.34171 5.04882 7.65829 5.04882 7.85355 4.85355L7.5 4.5L7.14645 4.14645ZM10 5H10.5V2H10H9.5V5H10ZM10 2V1.5H7V2V2.5H10V2ZM10 2L9.64645 1.64645L7.14645 4.14645L7.5 4.5L7.85355 4.85355L10.3536 2.35355L10 2Z" fill="#1f7a4c" />
                                  </svg>

                                )}
                              </button>


                            </div>

                            {isExpanded ? (
                              <div className="space-y-4 text-sm">
                                <div className="grid grid-cols-1 gap-3 border-b border-gray-200 pb-4 sm:grid-cols-2">
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("grass")} </span>{h.grass}</p>
                                  <p>
                                    <span className="inline-block w-[110px] text-gray-500">{t("quantity")} </span>
                                    {h.quantity}
                                   
                                    <span className="mt-1 ml-[110px] block text-xs text-gray-500">
                                      {t("Remqty")} {h.remainingQuantityDisplay ? h.remainingQuantityDisplay : '-'}
                                    </span>
                                    
                                  </p>
                                  <p>
                                    <span className="inline-block w-[110px] text-gray-500 align-top">
                                      {tForm("referenceHarvestQuantity")}{" "}
                                    </span>
                                    {h.refQtyDisplay
                                      ? h.refQtyDisplay + tForm("referenceHarvestUnit")
                                      : "-"}
                                  </p>
                                  <p>
                                    <span className="inline-block w-[110px] text-gray-500 align-top">
                                      {t("harvestedArea")}{" "}
                                    </span>
                                    {h.harvestedAreaM2Display ? h.harvestedAreaM2Display + t("harvestedAreaUnitM2") : '-'}
                                  </p>


                                  <p><span className="inline-block w-[110px] text-gray-500">{t("zone")} </span>{h.zone}</p>
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("displayDate")} </span>{h.date}</p>

                                  
                                </div>
                                <div className="grid grid-cols-1 gap-3 border-b border-gray-200 pb-4 sm:grid-cols-2">
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("estimateDate")} </span>{h.estimatedDate}</p>
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("actualDate")} </span>{h.actualDate}</p>
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("deliveryDate")} </span>{h.deliveryDate}</p>
                                  <p><span className="inline-block w-[110px] text-gray-500">{t("doSoNumber")} </span>{h.doSoNumber}</p>
                                </div>
                                <p><span className="text-gray-500">{t("truckNote")} </span>{h.truckNote}</p>
                                <div>
                                  <label className="mb-3 block text-xs uppercase tracking-wider text-[#5a7d3c]">
                                    {t("attachment")}
                                  </label>
                                  <Swiper
                                    modules={[FreeMode]}
                                    freeMode
                                    grabCursor
                                    spaceBetween={12}
                                    slidesPerView={2.2}
                                    breakpoints={{
                                      640: { slidesPerView: 3.2 },
                                      1024: { slidesPerView: 4.2 },
                                    }}
                                  >
                                    {(h.attachments?.length
                                      ? h.attachments
                                      : HARVEST_ATTACHMENT_SOURCES.map((x) => ({
                                        label: x.label,
                                        url: "",
                                      }))
                                    ).map((a, i) => (
                                      <SwiperSlide key={`${h.id}-att-${i}`}>
                                        <div className="group rounded-lg border-2 border-dashed border-gray-300 p-2 transition-colors hover:border-[#5a7d3c]">
                                          <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded bg-gray-50 group-hover:bg-gray-100">
                                            {a.url ? (
                                              <a
                                                href={a.url}
                                                className="harvest-fancybox-trigger relative block h-full w-full cursor-zoom-in"
                                                data-fancybox={`harvest-${h.id}`}
                                                data-caption={a.label}
                                              >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                  src={a.url}
                                                  alt={a.label}
                                                  className="h-full w-full object-cover"
                                                />
                                              </a>
                                            ) : (
                                              <ImageIcon className="h-10 w-10 text-gray-300" />
                                            )}
                                          </div>
                                          <p className="line-clamp-2 text-center text-xs text-gray-600">
                                            {a.label}
                                          </p>
                                        </div>
                                      </SwiperSlide>
                                    ))}
                                  </Swiper>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2 text-sm">
                                <p><span className="text-gray-500">{t("date")} </span>{h.date}</p>
                                <p><span className="text-gray-500">{t("grass")} </span>{h.grass}</p>
                                <p><span className="text-gray-500">{t("zone")} </span>{h.zone}</p>
                                <p><span className="text-gray-500">{t("quantity")} </span>{h.quantity}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

