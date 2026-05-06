"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Trash2,
  Filter,
  Users,
  Phone,
  Mail,
  CheckCircle2,
  Clock,
  Pencil,
  Maximize2,
} from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  fetchMondayProjectRowsFromServer,
  type MondayProjectServerRow,
} from "@/entities/projects";
import { deleteMondayParentOrSubItem } from "@/entities/projects/api/projectsApi";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import {
  HARVEST_ATTACHMENT_SOURCES,
  getAttachmentUrls,
  getFirstAttachmentUrlFromSubitems,
} from "@/shared/lib/harvestAttachmentImages";
import { formatDateDisplay, isValidDate } from "@/shared/lib/format/date";
import { zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { parseJsonMaybe, parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { calculateDeliveredQuantityDeliveryOnly } from "@/features/project/lib/subitemDeliveredQuantity";
import { effectiveRequiredQuantityFromRecord } from "@/features/project/lib/effectiveRequirementQuantity";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { translateProjectType } from "@/features/project/lib/projectTypeDisplay";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { DatePicker } from "@/shared/ui/date-picker";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode } from "swiper/modules";
import { Fancybox } from "@fancyapps/ui";
import "swiper/css";
import "swiper/css/free-mode";
import "@fancyapps/ui/dist/fancybox/fancybox.css";

type GrassRow = {
  id: string;
  /** Product / grass label only (no UOM). */
  name: string;
  /** Unit of measure; shown beside quantities, not in `name`. */
  uom: string;
  required: number;
  delivered: number;
  remaining: number;
  progress: number;
};

/** Parity with Harvesting Portal `ProjectHarvestStatus` / `deriveProjectHarvestStatus`. */
type HarvestLineStatus =
  | "planned"
  | "scheduled"
  | "harvested"
  | "delivered"
  | "completed";

function deriveProjectHarvestStatusFromRecord(
  r: Record<string, unknown>,
): HarvestLineStatus {
  const delivery = String(r.delivery_harvest_date ?? "").trim();
  const harvest = String(r.actual_harvest_date ?? "").trim();
  const est = String(r.estimated_harvest_date ?? "").trim();
  if (isValidDate(delivery)) return "delivered";
  if (isValidDate(harvest)) return "harvested";
  if (isValidDate(est)) return "scheduled";
  return "planned";
}

const HARVEST_STATUS_ROW_CLASSES: Record<HarvestLineStatus, string> = {
  planned: "text-muted-foreground",
  scheduled: "text-accent",
  harvested: "text-info",
  delivered: "text-primary",
  completed: "text-primary",
};

type HarvestRow = {
  id: string;
  /** Monday / dynamic table id for `react_delete_parent_or_sub_item`. */
  tableId: string;
  tableName: string;
  productId: string;
  uom: string;
  status: HarvestLineStatus;
  /** ISO yyyy-mm-dd for date-range filter. */
  filterDate: string;
  createdAt: string;
  date: string;
  grass: string;
  zone: string;
  quantity: string;
  quantityValue: number;
  limitStatus: "limit" | "overLimit" | null;
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

type HarvestMapCtx = {
  farmZones: unknown;
  remainingByProductUom: Map<string, number>;
  unitByProductUom: Map<string, string>;
  productMap: Map<string, string>;
  /** Subitem rows may omit `table_id`; use parent project row as fallback. */
  defaultTableId?: string;
  defaultTableName?: string;
};

/**
 * Map one harvesting-plan row OR one dynamic-table subitem to UI row.
 * `react_get_harvesting_table` embeds harvest-like lines in `subitems`; `GET /api/harvesting`
 * reads `project_harvesting_plan`. When the latter has no rows, we still show subitems.
 */
function mapHarvestRecordToHarvestRow(
  r: Record<string, unknown>,
  ctx: HarvestMapCtx,
): HarvestRow {
  const actual = String(r.actual_harvest_date ?? "").trim();
  const estimated = String(r.estimated_harvest_date ?? "").trim();
  const status = deriveProjectHarvestStatusFromRecord(r);
  const attachments: Array<{ label: string; url: string }> = HARVEST_ATTACHMENT_SOURCES.map(
    (src) => ({
      label: src.label,
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
  const remainingQty = ctx.remainingByProductUom.get(remainingMapKey);
  const remainingUnit = ctx.unitByProductUom.get(remainingMapKey) ?? uomRaw;
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

  const grassName = String(r.grass_name ?? r.commodity_name ?? "").trim();
  const grass =
    grassName || ctx.productMap.get(productId) || "-";

  const tableId =
    String(r.table_id ?? "").trim() || String(ctx.defaultTableId ?? "").trim();
  const tableNameRaw = String(r.table_name ?? "").trim();
  const tableName =
    tableNameRaw ||
    String(ctx.defaultTableName ?? "").trim() ||
    "Harvesting";
  const filterDate = isValidDate(actual)
    ? actual.slice(0, 10)
    : isValidDate(estimated)
      ? estimated.slice(0, 10)
      : "";
  const createdAt = String(r.created_at ?? r.createdAt ?? "").trim();

  return {
    id: String(r.id ?? ""),
    tableId,
    tableName,
    productId,
    uom: uomRaw,
    status,
    filterDate,
    createdAt,
    date: formatDateDisplay(isValidDate(actual) ? actual : estimated),
    grass,
    zone:
      zoneIdToLabel(r.zone as string | undefined, ctx.farmZones) || "-",
    quantity: `${qty.toLocaleString()} ${uomRaw}`.trim() || "-",
    quantityValue: qty,
    limitStatus: harvestLimitStatusFromDescription(r.description),
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
}

function safeProjectsListHref(raw: string | null | undefined): string {
  const fallback = "/projects";
  const s0 = String(raw ?? "").trim();
  if (!s0) return fallback;
  let s = s0;
  try {
    s = decodeURIComponent(s0);
  } catch {
    s = s0;
  }
  if (!s.startsWith("/projects") || s.startsWith("//")) return fallback;
  return s;
}

function subitemLooksLikeHarvestLine(sub: Record<string, unknown>): boolean {
  const actual = String(sub.actual_harvest_date ?? "").trim();
  const delivery = String(sub.delivery_harvest_date ?? "").trim();
  const est = String(sub.estimated_harvest_date ?? "").trim();
  const qty = parseNumber(sub.quantity);
  return (
    isValidDate(actual) ||
    isValidDate(delivery) ||
    isValidDate(est) ||
    qty > 0
  );
}

function buildDeliveredQuantitySourceRows(
  projectSubitems: Array<Record<string, unknown>>,
  planRows: Array<Record<string, unknown>>,
  projectId: string,
): Array<Record<string, unknown>> {
  const normalizedProjectId = projectId.trim();
  const fromPlan = planRows.filter((row) => {
    const pid = String(row.project_id ?? "").trim();
    return !normalizedProjectId || pid === normalizedProjectId;
  });
  const planIds = new Set(
    fromPlan
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean),
  );
  const fromSubitemsOnly = projectSubitems.filter((sub) => {
    const pid = String(sub.project_id ?? "").trim();
    if (pid && normalizedProjectId && pid !== normalizedProjectId) return false;
    const sid = String(sub.id ?? "").trim();
    if (sid && planIds.has(sid)) return false;
    return subitemLooksLikeHarvestLine(sub);
  });
  return [...fromPlan, ...fromSubitemsOnly];
}

function normalizeDateFilterInput(v: string): string {
  const s = v.trim().replace(/\//g, "-");
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function harvestLimitLabel(status: HarvestRow["limitStatus"]): string {
  if (status === "limit") return "Limit";
  if (status === "overLimit") return "Over limit";
  return "";
}

function HarvestLimitQuestionMark({ status }: { status: HarvestRow["limitStatus"] }) {
  if (!status) return null;
  const label = harvestLimitLabel(status);
  const colorClass =
    status === "limit" ? "text-amber-700 ring-amber-200" : "text-red-600 ring-red-200";
  const iconClass =
    status === "limit"
      ? "border-amber-400 bg-amber-50 text-amber-700"
      : "border-gray-200 bg-gray-50 text-gray-400";
  return (
    <span className="group relative inline-flex items-center">
      <span
        className={`inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border text-[10px] font-semibold ${iconClass}`}
        aria-label={label}
        tabIndex={0}
      >
        ?
      </span>
      <span className={`pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-medium shadow-sm ring-1 group-hover:inline-flex group-focus-within:inline-flex ${colorClass}`}>
        {label}
      </span>
    </span>
  );
}

function harvestLimitStatusFromDescription(raw: unknown): HarvestRow["limitStatus"] {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "limit") return "limit";
  if (value === "over limit" || value === "overlimit") return "overLimit";
  return null;
}

/** Harvesting Portal `Progress` parity — track `bg-secondary`, fill `bg-primary`. */
function DetailProgress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export default function ProjectDetailPage() {
  // Namespace-scoped translators: `useTranslations()` without a namespace + dynamic
  // `ProjectDetail.${key}` can fail to resolve some nested keys in next-intl 4 (fallback shows
  // `ProjectDetail.harvestedArea`). Using namespaces matches the JSON shape and yields stable `t`.
  const t = useAppTranslations("ProjectDetail");
  const tForm = useAppTranslations("HarvestForm");
  const tProjectForm = useAppTranslations("ProjectForm");
  const tBase = useAppTranslations();
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowId = searchParams.get("rowId")?.trim() ?? "";
  const tableId = searchParams.get("tableId")?.trim() ?? "";
  const projectIdFromQuery = searchParams.get("projectId")?.trim() ?? "";
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const projectsListBackHref = useMemo(
    () => safeProjectsListHref(searchParams.get("returnTo")),
    [searchParams],
  );

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
  const [deliveredQuantityRows, setDeliveredQuantityRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [harvests, setHarvests] = useState<HarvestRow[]>([]);
  const [expandedHarvestId, setExpandedHarvestId] = useState<string | null>(null);
  const [harvestDeleteTarget, setHarvestDeleteTarget] = useState<HarvestRow | null>(
    null,
  );
  const [harvestDeleting, setHarvestDeleting] = useState(false);
  const [harvestDeleteError, setHarvestDeleteError] = useState<string | null>(null);
  const [harvestFilterOpen, setHarvestFilterOpen] = useState(false);
  const [harvestGrassFilter, setHarvestGrassFilter] = useState("");
  const [harvestStatusFilter, setHarvestStatusFilter] = useState<"" | HarvestLineStatus>(
    "",
  );
  const [harvestDateFrom, setHarvestDateFrom] = useState("");
  const [harvestDateTo, setHarvestDateTo] = useState("");
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
        const normalizedTableId = tableId.trim();
        const normalizedProjectId = projectIdFromQuery.trim();
        const matchesRowAndMaybeTable = (r: MondayProjectServerRow): boolean => {
          const rowIdMatches =
            String(r.row_id ?? "").trim() === rowId ||
            String(r.id ?? "").trim() === rowId;
          if (!rowIdMatches) return false;
          if (!normalizedTableId) return true;
          if (String(r.table_id ?? "").trim() !== normalizedTableId) return false;
          if (!normalizedProjectId) return true;
          return String(r.project_id ?? "").trim() === normalizedProjectId;
        };
        const row = res.rows.find(matchesRowAndMaybeTable) ?? null;
        if (!row) {
          setError(t("cannotFindDetail"));
          return;
        }
        setProjectRow(row);

        const projectId = String(projectIdFromQuery || row.project_id || "").trim();
        if (projectId) {
          const requirementRows = parseRequirements(row.quantity_required_sprig_sod);
          const projectSubitems = parseSubitems(row.subitems);
          const h = await stsProxyGetHarvestingIndex({
            project_id: projectId,
            per_page: 30,
            page: 1,
          });
          if (!mounted) return;
          const planRows = h.rows.filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object",
          );
          const deliveredRows = buildDeliveredQuantitySourceRows(
            projectSubitems,
            planRows,
            projectId,
          );
          setDeliveredQuantityRows(deliveredRows);
          const remainingByProductUom = new Map<string, number>();
          const unitByProductUom = new Map<string, string>();
          for (const req of requirementRows) {
            const productId = String(req.product_id ?? "").trim();
            if (!productId) continue;
            const reqUomRaw = String(req.uom ?? "").trim();
            const reqUomKey = normalizeUomKey(reqUomRaw);
            const required = effectiveRequiredQuantityFromRecord(req as Record<string, unknown>);
            const delivered = calculateDeliveredQuantityDeliveryOnly(
              deliveredRows,
              productId,
              reqUomRaw,
              projectId,
            );
            const remaining = Math.max(0, required - delivered);
            const mapKey = `${productId}::${reqUomKey}`;
            remainingByProductUom.set(mapKey, remaining);
            unitByProductUom.set(mapKey, reqUomRaw || "-");
          }

          const farmZonesForLabels = useHarvestingDataStore.getState().farmZones;
          const fallbackTableId = String(row.table_id ?? tableId ?? "").trim();
          const fallbackTableName =
            String(row.table_name ?? "Harvesting").trim() || "Harvesting";
          const mapCtxBase: HarvestMapCtx = {
            farmZones: farmZonesForLabels,
            remainingByProductUom,
            unitByProductUom,
            productMap,
            defaultTableId: fallbackTableId,
            defaultTableName: fallbackTableName,
          };
          const fromPlan: HarvestRow[] = planRows
            .filter((x) => String(x.project_id ?? "").trim() === projectId)
            .map((r) => mapHarvestRecordToHarvestRow(r, mapCtxBase));
          const planIds = new Set(
            fromPlan.map((x) => x.id).filter((id) => id !== ""),
          );
          const mapCtxSub: HarvestMapCtx = {
            ...mapCtxBase,
            defaultTableId: fallbackTableId,
            defaultTableName: fallbackTableName,
          };
          const fromSubitemsOnly: HarvestRow[] = projectSubitems
            .filter((sub) => {
              const subProjectId = String(sub.project_id ?? "").trim();
              if (subProjectId && subProjectId !== projectId) return false;
              const sid = String(sub.id ?? "").trim();
              if (sid && planIds.has(sid)) return false;
              return subitemLooksLikeHarvestLine(sub);
            })
            .map((sub) => mapHarvestRecordToHarvestRow(sub, mapCtxSub));
          setHarvests([...fromPlan, ...fromSubitemsOnly]);
        }
      } catch (e) {
        if (!mounted) return;
        setError(
          e instanceof Error ? e.message : t("loadError"),
        );
        setDeliveredQuantityRows([]);
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
    const rec = r as Record<string, unknown>;
    const projectId = String(r.project_id ?? "").trim();
    const countryId = String(r.country_id ?? "").trim();
    const picId = String(r.pic ?? "").trim();
    /** Same field mapping as `projects/new` `applyEditRow` + `buildProjectDataFromServerRow` dates. */
    const golfClubFromRow =
      String(r.alias_title ?? "").trim() ||
      String(r.name ?? r.title ?? "").trim();
    const companyFromRow =
      String(rec.company_name ?? "").trim() || String(r.alias_title ?? "").trim();
    const keyAreasRaw = r.key_areas;
    const keyAreasParsed = (() => {
      const decoded = parseJsonMaybe(keyAreasRaw);
      if (Array.isArray(decoded)) {
        return decoded.map((x) => String(x).trim()).filter(Boolean);
      }
      if (typeof decoded === "string") {
        return decoded
          .split(/,\s*/)
          .map((x) => x.trim())
          .filter(Boolean);
      }
      return [];
    })();
    const actualStartRaw =
      (rec.start_date as string | undefined) ??
      (rec.actual_start_date as string | undefined);
    return {
      projectName:
        projectTitleMap.get(projectId) ||
        String((r.title ?? r.name ?? projectId) || "-"),
      golfClub: golfClubFromRow || "-",
      company: companyFromRow || "-",
      odooCustomerRef: String(rec.odoo_customer_id ?? "").trim() || "-",
      architect: String(rec.golf_course_architect ?? "-"),
      country: countryMap.get(countryId) || String(r.country ?? "-"),
      pic: staffMap.get(picId) || picId || "-",
      projectType: (() => {
        const raw = String(r.project_type ?? "").trim();
        if (!raw) return "-";
        return translateProjectType(raw, (k) => tProjectForm(k));
      })(),
      holes: String(r.no_of_holes ?? "-"),
      estimateStartDate: formatDateDisplay(rec.estimate_start_date),
      actualStartDate: formatDateDisplay(actualStartRaw),
      endDate: formatDateDisplay(r.deadline),
      keyAreas: keyAreasParsed,
      mainContactName: String(rec.main_contact_name ?? "").trim(),
      mainContactEmail: String(rec.main_contact_email ?? "").trim(),
      mainContactPhone: String(rec.main_contact_phone ?? "").trim(),
      actualCompletionDisplay: formatDateDisplay(rec.actual_completion_date),
    };
  }, [projectRow, projectTitleMap, countryMap, staffMap, tProjectForm]);

  const grassRows = useMemo<GrassRow[]>(() => {
    if (!projectRow) return [];
    const harvestProjectId = String(projectRow.project_id ?? "").trim();
    const req = parseRequirements(projectRow.quantity_required_sprig_sod);
    const sourceRows =
      deliveredQuantityRows.length > 0
        ? deliveredQuantityRows
        : parseSubitems(projectRow.subitems);
    return req.map((r, idx) => {
      const productId = String(r.product_id ?? "").trim();
      const uom = String(r.uom ?? "").trim();
      const required = effectiveRequiredQuantityFromRecord(r as Record<string, unknown>);
      const delivered = calculateDeliveredQuantityDeliveryOnly(
        sourceRows,
        productId,
        uom,
        harvestProjectId || undefined,
      );
      const remaining = Math.max(0, required - delivered);
      const progress = required > 0 ? Math.round((delivered / required) * 100) : 0;
      const productName =
        productMap.get(productId) ||
        productId ||
        t("unknownGrass");
      return {
        id: `${productId || "item"}-${idx}`,
        name: productName,
        uom,
        required,
        delivered,
        remaining,
        progress: Math.max(0, Math.min(100, progress)),
      };
    });
  }, [deliveredQuantityRows, projectRow, productMap, t]);

  const overallPercent = useMemo(() => {
    const totalReq = grassRows.reduce((s, g) => s + g.required, 0);
    const totalDel = grassRows.reduce(
      (s, g) => s + Math.min(g.delivered, g.required),
      0,
    );
    return totalReq > 0 ? Math.round((totalDel / totalReq) * 100) : 0;
  }, [grassRows]);

  const sortedGrassRows = useMemo(() => {
    return [...grassRows].sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.uom.localeCompare(b.uom);
    });
  }, [grassRows]);

  const harvestsWithProductNames = useMemo(() => {
    return harvests.map((h) => {
      const productName = productMap.get(h.productId);
      const currentGrass = h.grass.trim();
      if (!productName || (currentGrass && currentGrass !== "-" && currentGrass !== h.productId)) {
        return h;
      }
      return { ...h, grass: productName };
    });
  }, [harvests, productMap]);

  const harvestGrassOptions = useMemo(() => {
    return Array.from(
      new Set(
        harvestsWithProductNames
          .map((h) => h.grass.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [harvestsWithProductNames]);

  const filteredHarvests = useMemo(() => {
    const fromIso = normalizeDateFilterInput(harvestDateFrom);
    const toIso = normalizeDateFilterInput(harvestDateTo);
    const filtered = harvestsWithProductNames.filter((h) => {
      if (harvestGrassFilter && h.grass !== harvestGrassFilter) return false;
      if (harvestStatusFilter && h.status !== harvestStatusFilter) return false;
      if (fromIso && h.filterDate && h.filterDate < fromIso) return false;
      if (toIso && h.filterDate && h.filterDate > toIso) return false;
      if ((fromIso || toIso) && !h.filterDate) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      // Newest harvest date first; empty/invalid dates go to the end.
      const ad = a.filterDate.trim();
      const bd = b.filterDate.trim();
      if (ad && bd) {
        if (ad !== bd) return bd.localeCompare(ad);
        return String(b.id).localeCompare(String(a.id));
      }
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [
    harvestDateFrom,
    harvestDateTo,
    harvestGrassFilter,
    harvestStatusFilter,
    harvestsWithProductNames,
  ]);
  const hasActiveHarvestFilters = Boolean(
    harvestGrassFilter.trim() ||
      harvestStatusFilter ||
      normalizeDateFilterInput(harvestDateFrom) ||
      normalizeDateFilterInput(harvestDateTo),
  );

  const canDeleteHarvestRow = (h: HarvestRow) =>
    Boolean(String(h.id ?? "").trim());

  const onConfirmDeleteHarvestFromDetail = async () => {
    const target = harvestDeleteTarget;
    if (!target?.id?.trim() || !target.tableId?.trim()) {
      setHarvestDeleteError(t("deleteHarvestMissingIds"));
      setHarvestDeleteTarget(null);
      return;
    }
    try {
      setHarvestDeleting(true);
      setHarvestDeleteError(null);
      await deleteMondayParentOrSubItem({
        tableId: target.tableId,
        tableName: target.tableName.trim() || "Harvesting",
        rowId: target.id,
        type: "sub",
      });
      const removedId = target.id;
      setHarvestDeleteTarget(null);
      setHarvests((prev) => prev.filter((x) => x.id !== removedId));
      setExpandedHarvestId((cur) => (cur === removedId ? null : cur));
    } catch (e) {
      setHarvestDeleteError(
        e instanceof Error ? e.message : t("deleteHarvestFailed"),
      );
    } finally {
      setHarvestDeleting(false);
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="dashboard-harvesting-skin min-h-full min-w-0 flex-1 p-4 lg:p-8">
          {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : !projectRow || !basic ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="space-y-6">
              {/* Header — parity with Harvesting Portal ProjectDetailPage */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push(projectsListBackHref)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={t("backToProjects")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <h1 className="font-heading text-2xl font-bold text-foreground">
                    {basic.projectName}
                  </h1>
                  <p className="text-sm text-muted-foreground">{basic.company}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold text-foreground">
                    {basic.projectType}
                  </span>
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
                    className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                    aria-label={t("editProject")}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    {t("editProject")}
                  </button>
                </div>
              </div>

              {/* Info cards */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("location")}
                    </p>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {basic.country}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("personInCharge")}
                    </p>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {basic.pic}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("estCompletion")}
                    </p>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {basic.endDate}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("overallProgress")}
                    </p>
                    <div className="flex items-center gap-2">
                      <DetailProgress value={overallPercent} className="h-2 flex-1" />
                      <span
                        className={`text-sm font-bold ${overallPercent === 100 ? "text-primary" : "text-accent"}`}
                      >
                        {overallPercent}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contact & grass requirements */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-6 pb-3">
                    <h2 className="text-base font-semibold leading-none tracking-tight">
                      {t("mainContact")}
                    </h2>
                  </div>
                  <div className="space-y-2 p-6 pt-0 text-sm">
                    <p className="flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-foreground">
                        {basic.mainContactName || "—"}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-foreground">
                        {basic.mainContactEmail || "—"}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-foreground">
                        {basic.mainContactPhone || "—"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-6 pb-3">
                    <h2 className="text-base font-semibold leading-none tracking-tight">
                      {t("grassRequirements")}
                    </h2>
                  </div>
                  <div className="space-y-3 p-6 pt-0">
                    {sortedGrassRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("noGrasses")}</p>
                    ) : (
                      sortedGrassRows.map((g) => (
                        <div key={g.id}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span className="font-medium text-foreground">{g.name}</span>
                            <span className="text-muted-foreground">
                              {g.delivered.toLocaleString()} / {g.required.toLocaleString()}
                              {g.uom ? ` ${g.uom}` : ""} — {g.progress}%
                            </span>
                          </div>
                          <DetailProgress value={g.progress} className="h-1.5" />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Golf details (includes architect) */}
              {basic.holes !== "-" ||
              basic.keyAreas.length > 0 ||
              (basic.architect && basic.architect !== "-") ? (
                <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                  <div className="space-y-1.5 p-6 pb-3">
                    <h2 className="text-base font-semibold leading-none tracking-tight">
                      {t("golfCourseDetails")}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-4 p-6 pt-0 text-sm">
                    {basic.holes !== "-" ? (
                      <div>
                        <span className="text-muted-foreground">{t("holesLabel")} </span>
                        <span className="font-medium text-foreground">{basic.holes}</span>
                      </div>
                    ) : null}
                    {basic.keyAreas.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground">{t("keyAreasLabel")} </span>
                        {basic.keyAreas.map((a) => (
                          <span
                            key={a}
                            className="inline-flex items-center rounded-md border border-transparent bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {basic.architect && basic.architect !== "-" ? (
                      <div className="w-full min-w-[200px]">
                        <span className="text-muted-foreground">{t("golfCourseArchitect")} </span>
                        <span className="font-medium text-foreground">{basic.architect}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Project timeline */}
              <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                <div className="space-y-1.5 p-6 pb-3">
                  <h2 className="text-base font-semibold leading-none tracking-tight">
                    {t("projectTimeline")}
                  </h2>
                </div>
                <div className="p-6 pt-0">
                  <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                    <div>
                      <p className="mb-0.5 text-xs text-muted-foreground">{t("estStartShort")}</p>
                      <p className="font-medium text-foreground">{basic.estimateStartDate}</p>
                    </div>
                    <div>
                      <p className="mb-0.5 text-xs text-muted-foreground">{t("actualStartShort")}</p>
                      <p className="font-medium text-foreground">
                        {basic.actualStartDate || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="mb-0.5 text-xs text-muted-foreground">{t("estCompletionShort")}</p>
                      <p className="font-medium text-foreground">{basic.endDate}</p>
                    </div>
                    <div>
                      <p className="mb-0.5 text-xs text-muted-foreground">{t("actualCompletionShort")}</p>
                      <p className="font-medium text-foreground">
                        {basic.actualCompletionDisplay || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Harvests — table + filters (full parity with app data) */}
              <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
                <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-3">
                  <h2 className="text-base font-semibold leading-none tracking-tight">
                    {t("harvestHistory")} ({harvests.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/harvest/new?returnTo=${encodeURIComponent(returnTo)}&projectId=${encodeURIComponent(currentProjectId)}`,
                      )
                    }
                    className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                    aria-label={t("addHarvest")}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {t("addHarvest")}
                  </button>
                </div>
                <div className="space-y-4 p-6 pt-0">
                  {harvestDeleteError ? (
                    <p className="mb-3 text-sm text-destructive" role="alert">
                      {harvestDeleteError}
                    </p>
                  ) : null}
                  <div className="mb-4 flex justify-between gap-2">
                    {hasActiveHarvestFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setHarvestGrassFilter("");
                          setHarvestStatusFilter("");
                          setHarvestDateFrom("");
                          setHarvestDateTo("");
                        }}
                        className={cn(
                          "inline-flex items-center rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted",
                          bgSurfaceFilter(true),
                        )}
                      >
                        {t("clearFilters")}
                      </button>
                    ) : (
                      <div />
                    )}
                    <button
                      type="button"
                      onClick={() => setHarvestFilterOpen((v) => !v)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted",
                        bgSurfaceFilter(hasActiveHarvestFilters),
                      )}
                    >
                      <span>{t("filter")}</span>
                      <Filter className="h-4 w-4" />
                    </button>
                  </div>
                  {harvestFilterOpen ? (
                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <select
                        value={harvestGrassFilter}
                        onChange={(e) => setHarvestGrassFilter(e.target.value)}
                        className={cn(
                          "w-full rounded-md border border-input px-3 py-2 text-sm text-foreground",
                          bgSurfaceFilter(!!harvestGrassFilter.trim()),
                        )}
                        aria-label={t("grass")}
                      >
                        <option value="">{t("allGrassTypes")}</option>
                        {harvestGrassOptions.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                      <select
                        value={harvestStatusFilter}
                        onChange={(e) =>
                          setHarvestStatusFilter(e.target.value as "" | HarvestLineStatus)
                        }
                        className={cn(
                          "w-full rounded-md border border-input px-3 py-2 text-sm text-foreground",
                          bgSurfaceFilter(Boolean(harvestStatusFilter)),
                        )}
                        aria-label={t("filterHarvestStatus")}
                      >
                        <option value="">{t("allStatuses")}</option>
                        <option value="planned">{t("harvestStatus_planned")}</option>
                        <option value="scheduled">{t("harvestStatus_scheduled")}</option>
                        <option value="harvested">{t("harvestStatus_harvested")}</option>
                        <option value="delivered">{t("harvestStatus_delivered")}</option>
                        <option value="completed">{t("harvestStatus_completed")}</option>
                      </select>
                      <DatePicker
                        value={normalizeDateFilterInput(harvestDateFrom)}
                        onChange={setHarvestDateFrom}
                        placeholder={t("fromDate")}
                        className="h-[42px]"
                      />
                      <DatePicker
                        value={normalizeDateFilterInput(harvestDateTo)}
                        onChange={setHarvestDateTo}
                        placeholder={t("toDate")}
                        className="h-[42px]"
                      />
                    </div>
                  ) : null}
                  {harvests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("noHarvestRecords")}
                    </p>
                  ) : filteredHarvests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("noHarvestRecordsFiltered")}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              {t("date")}
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              {t("grass")}
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              {t("farm")}
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              {t("zone")}
                            </th>
                            <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                              {t("quantity")}
                            </th>
                            <th className="pb-2 pr-4 text-right font-medium text-muted-foreground">
                              {t("areaM2Short")}
                            </th>
                            <th className="pb-2 pr-4 font-medium text-muted-foreground">
                              {tCommon("status")}
                            </th>
                            <th className="pb-2 font-medium text-muted-foreground text-right">
                              {t("rowActions")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHarvests.map((h) => {
                            const areaDisplay =
                              h.harvestedAreaM2Display ??
                              h.harvestedAreaDisplay ??
                              "—";
                            const StatusIcon =
                              h.status === "delivered" || h.status === "completed"
                                ? CheckCircle2
                                : Clock;
                            return (
                              <tr
                                key={h.id}
                                className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/50"
                                onClick={() => setExpandedHarvestId(h.id)}
                              >
                                <td className="py-2.5 pr-4 text-foreground">{h.date}</td>
                                <td className="py-2.5 pr-4 font-medium text-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <span>{h.grass}</span>
                                    <HarvestLimitQuestionMark status={h.limitStatus} />
                                  </span>
                                </td>
                                <td className="py-2.5 pr-4 text-muted-foreground">
                                  {h.tableName || "—"}
                                </td>
                                <td className="py-2.5 pr-4 text-muted-foreground">{h.zone}</td>
                                <td className="py-2.5 pr-4 text-right text-foreground">
                                  {h.quantity}
                                </td>
                                <td className="py-2.5 pr-4 text-right text-foreground">
                                  {areaDisplay}
                                </td>
                                <td className="py-2.5 pr-4">
                                  <span
                                    className={`inline-flex items-center gap-1 text-xs font-medium capitalize ${HARVEST_STATUS_ROW_CLASSES[h.status] ?? "text-muted-foreground"}`}
                                  >
                                    <StatusIcon className="h-3.5 w-3.5" />
                                    {h.status}
                                  </span>
                                </td>
                                <td className="py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(
                                          `/harvest/new?id=${encodeURIComponent(h.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                                        );
                                      }}
                                      className="rounded-md p-2 text-primary hover:bg-muted"
                                      aria-label={tCommon("edit")}
                                      title={tCommon("edit")}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedHarvestId(h.id);
                                      }}
                                      className="rounded-md p-2 text-primary hover:bg-muted"
                                      aria-label={t("expandHarvestRow")}
                                      title={t("expandHarvestRow")}
                                    >
                                      <Maximize2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>

      {harvestDeleteTarget ? (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!harvestDeleting) setHarvestDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-harvest-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-harvest-detail-title"
              className="text-lg font-semibold text-gray-900"
            >
              {t("confirmDeleteHarvestTitle")}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {t("confirmDeleteHarvestMessage")}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                onClick={() => setHarvestDeleteTarget(null)}
                disabled={harvestDeleting}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => void onConfirmDeleteHarvestFromDetail()}
                disabled={harvestDeleting}
              >
                {harvestDeleting ? t("deletingHarvest") : tCommon("delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {expandedHarvestId ? (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setExpandedHarvestId(null)}
        >
          {(() => {
            const h = harvestsWithProductNames.find((item) => item.id === expandedHarvestId);
            if (!h) return null;
            const HeaderStatusIcon =
              h.status === "delivered" || h.status === "completed"
                ? CheckCircle2
                : Clock;
            return (
              <div
                className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl lg:p-6"
                role="dialog"
                aria-modal="true"
                aria-label={t("harvestHistory")}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-500">#{filteredHarvests.findIndex((x) => x.id === h.id) + 1}</span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium capitalize ${HARVEST_STATUS_ROW_CLASSES[h.status] ?? "text-muted-foreground"}`}
                    >
                      <HeaderStatusIcon className="h-3.5 w-3.5" />
                      {h.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/harvest/new?id=${encodeURIComponent(h.id)}&returnTo=${encodeURIComponent(returnTo)}`,
                        )
                      }
                      className="rounded-lg p-2 text-[#5a7d3c] transition-colors hover:bg-green-50"
                      aria-label={tCommon("edit")}
                    >
                      <svg width="20" height="20" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.25 14.5H8.55H14.5M0.5 13.268V10.608L10.4159 1.06225C10.7907 0.701519 11.2906 0.5 11.8107 0.5H12.1203C13.1081 0.5 13.8925 1.33059 13.8362 2.31671C13.8128 2.72543 13.6444 3.11239 13.3611 3.40793L4.42 12.736L1.13147 13.7774C1.0841 13.7924 1.03472 13.8 0.985037 13.8C0.717158 13.8 0.5 13.5826 0.5 13.3148C0.5 13.1198 0.5 13.0218 0.5 13.268Z" stroke="#1f7a4c" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedHarvestId(null)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 gap-3 border-b border-gray-200 pb-4 sm:grid-cols-2">
                    <p>
                      <span className="inline-block w-[110px] text-gray-500">{t("grass")}:</span>
                      {" "}
                      <span className="inline-flex items-center gap-1">
                        <span>{h.grass}</span>
                        <HarvestLimitQuestionMark status={h.limitStatus} />
                      </span>
                    </p>
                    <p>
                      <span className="inline-block w-[110px] text-gray-500">{t("quantity")}:</span>
                      {" "}
                      {h.quantity}
                      <span className="mt-1 ml-[110px] block text-xs text-gray-500">
                        {t("Remqty")} {h.remainingQuantityDisplay ? h.remainingQuantityDisplay : "-"}
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
                      {h.harvestedAreaM2Display ? h.harvestedAreaM2Display + t("harvestedAreaUnitM2") : "-"}
                    </p>
                    <p><span className="inline-block w-[110px] text-gray-500">{t("zone")}:</span>{` ${h.zone}`}</p>
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
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!canDeleteHarvestRow(h)}
                      title={
                        canDeleteHarvestRow(h)
                          ? t("deleteHarvestAria")
                          : t("deleteHarvestUnavailable")
                      }
                      aria-label={t("deleteHarvestAria")}
                      onClick={() => {
                        setHarvestDeleteError(null);
                        setHarvestDeleteTarget(h);
                      }}
                      className="flex gap-2 rounded-lg border p-2 text-gray-300 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-5 w-5" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}
    </RequireAuth>
  );
}

