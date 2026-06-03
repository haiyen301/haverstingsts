"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Trash2,
  Download,
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
import {
  canAccessModule,
  canViewAllModuleData,
} from "@/shared/auth/permissions";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import type { MondayProjectServerRow } from "@/entities/projects";
import {
  deleteMondayParentOrSubItem,
  fetchProjectDynamicFieldsByProjectId,
} from "@/entities/projects/api/projectsApi";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { HARVEST_ATTACHMENT_SOURCES } from "@/shared/lib/harvestAttachmentImages";
import {
  buildHarvestAttachmentSlidesFromRow,
  openHarvestAttachmentFancybox,
} from "@/shared/lib/harvestAttachmentFancybox";
import { formatDateDisplay, isValidDate } from "@/shared/lib/format/date";
import {
  farmNameByIdFromRows,
  findProjectRowBySelectId,
  harvestRecordZoneStoredValue,
  keyAreaIdOrKeyToLabel,
  type FarmZoneReferenceRow,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { parseJsonMaybe } from "@/shared/lib/parseJsonMaybe";
import {
  calculateDeliveredQuantityDeliveryOnly,
  isSodToSprigHarvestLine,
} from "@/features/project/lib/subitemDeliveredQuantity";
import {
  buildHarvestPlanVisibilityCtx,
  canUserManageHarvestPlanRecord,
  filterHarvestHistoryForProjectDetail,
  PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE,
} from "@/features/harvesting/lib/harvestPlanVisibility";
import {
  HARVEST_PROJECT_PROGRESS_SCOPE,
} from "@/features/project/lib/mergeProjectSubitemsWithHarvestPlan";
import {
  effectiveRequiredQuantityFromRecord,
  formatRequirementUomDisplay,
  inferRequirementUom,
} from "@/features/project/lib/effectiveRequirementQuantity";
import { useLocale } from "next-intl";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { translateProjectType } from "@/features/project/lib/projectTypeDisplay";
import {
  calculateOverallProjectProgressFromRaw,
  formatGrassQuantityProgressLabel,
  formatGrassRequiredQuantityLabel,
  formatGrassRequirementDisplayName,
} from "@/features/project/lib/buildProjectCardData";
import {
  getActualHarvestEndDateFromRow,
  getEstimatedDateEndFromRow,
  getGeneralNoteFromRow,
  getShippingDispatchDetailsFromRow,
  getTruckNoteFromRow,
} from "@/shared/lib/harvestPlanExtendedFields";
import {
  harvestTypeDisplayLabel,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { normalizeAppNavigationHref } from "@/shared/lib/appNavigationHref";
import { DatePicker } from "@/shared/ui/date-picker";
import {
  compareProjectDetailHarvestHistory,
  deriveProjectHarvestStatusFromRecord,
  PROJECT_DETAIL_HARVEST_HISTORY_ORDER_MODE,
  projectHarvestDisplayDateFromRecord,
  projectHarvestLineStatusLabel,
} from "@/features/project/lib/projectHarvestPlanExport";
import { ProjectDetailHarvestExportDialog } from "@/features/project/ui/ProjectDetailHarvestExportDialog";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode } from "swiper/modules";
import { Fancybox } from "@fancyapps/ui";
import "swiper/css";
import "swiper/css/free-mode";
import "@fancyapps/ui/dist/fancybox/fancybox.css";

const HARVEST_HISTORY_PER_PAGE = 30;

type ProjectDetailHarvestScope = {
  userId?: string | number;
  farmUserMeta?: string;
};

function mergeHarvestPlanRows(
  prev: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set(
    prev.map((r) => String(r.id ?? "").trim()).filter(Boolean),
  );
  const out = [...prev];
  for (const r of next) {
    const id = String(r.id ?? "").trim();
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(r);
  }
  return out;
}

function harvestPlanHasMoreFromResponse(
  loadedCount: number,
  lastPageRowCount: number,
  totalRecords: number | null,
): boolean {
  if (totalRecords != null) return loadedCount < totalRecords;
  return lastPageRowCount >= HARVEST_HISTORY_PER_PAGE;
}

/** Harvest history on project detail: all plan rows for the project; edit/delete gated client-side. */
function buildProjectDetailHarvestHistoryApiParams(
  projectId: string,
  page: number,
  scope: ProjectDetailHarvestScope,
): Record<string, string | number | undefined> {
  return {
    project_id: projectId,
    per_page: HARVEST_HISTORY_PER_PAGE,
    page,
    user_id: scope.userId,
    project_progress_scope: HARVEST_PROJECT_PROGRESS_SCOPE,
    view_all_data_module: "harvests",
    order_mode: PROJECT_DETAIL_HARVEST_HISTORY_ORDER_MODE,
  };
}

async function fetchAllHarvestPlanPagesForProjectDetailHistory(
  projectId: string,
  scope: ProjectDetailHarvestScope,
): Promise<{
  planRows: Array<Record<string, unknown>>;
  totalRecords: number | null;
}> {
  let page = 1;
  let allRows: Array<Record<string, unknown>> = [];
  let totalRecords: number | null = null;
  const maxPages = 50;

  for (;;) {
    const h = await stsProxyGetHarvestingIndex(
      buildProjectDetailHarvestHistoryApiParams(projectId, page, scope),
    );
    const pageRows = h.rows.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object",
    );
    if (totalRecords == null && h.totalRecords != null) {
      totalRecords = h.totalRecords;
    }
    if (pageRows.length === 0) break;
    allRows = mergeHarvestPlanRows(allRows, pageRows);
    if (
      !harvestPlanHasMoreFromResponse(
        allRows.length,
        pageRows.length,
        h.totalRecords,
      )
    ) {
      break;
    }
    page += 1;
    if (page > maxPages) break;
  }

  return { planRows: allRows, totalRecords };
}

/** Merge `sts_projects` catalog row + dynamic-table fields (requirements, contacts, edit ids). */
function mergeProjectDetailFromServer(
  projectId: string,
  catalogRow: Record<string, unknown> | undefined,
  dynamicRow: Record<string, unknown> | undefined,
): MondayProjectServerRow {
  const rowId = String(
    dynamicRow?.id_row ?? dynamicRow?.row_id ?? catalogRow?.row_id ?? catalogRow?.id ?? "",
  ).trim();
  return {
    ...(catalogRow ?? {}),
    ...(dynamicRow ?? {}),
    project_id: projectId,
    row_id: rowId || undefined,
    id: (rowId || catalogRow?.id) as string | number | undefined,
    table_id: (dynamicRow?.table_id ?? catalogRow?.table_id) as
      | string
      | number
      | undefined,
    table_name:
      String(dynamicRow?.table_name ?? catalogRow?.table_name ?? "Harvesting").trim() ||
      "Harvesting",
    title: String(
      catalogRow?.title ??
        catalogRow?.name ??
        dynamicRow?.title ??
        dynamicRow?.name ??
        "",
    ).trim() || undefined,
    quantity_required_sprig_sod:
      dynamicRow?.quantity_required_sprig_sod ??
      catalogRow?.quantity_required_sprig_sod,
  };
}

function pickDynamicRowForProject(
  rows: Array<Record<string, unknown>>,
  preferredRowId: string,
  preferredTableId: string,
): Record<string, unknown> | undefined {
  if (rows.length === 0) return undefined;
  const rowId = preferredRowId.trim();
  const tableId = preferredTableId.trim();
  if (rowId) {
    const byRow = rows.find((r) => {
      const id = String(r.id_row ?? r.row_id ?? "").trim();
      if (id !== rowId) return false;
      if (!tableId) return true;
      return String(r.table_id ?? "").trim() === tableId;
    });
    if (byRow) return byRow;
  }
  if (tableId) {
    const byTable = rows.find((r) => String(r.table_id ?? "").trim() === tableId);
    if (byTable) return byTable;
  }
  return rows[0];
}

function harvestPlanRowsForProject(
  planRows: Array<Record<string, unknown>>,
  projectId: string,
): Array<Record<string, unknown>> {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) return planRows;
  return planRows.filter(
    (row) => String(row.project_id ?? "").trim() === normalizedProjectId,
  );
}

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

/** Project detail harvest list: scheduled → harvested → delivered only. */
type HarvestLineStatus = "scheduled" | "harvested" | "delivered";

type HarvestPhaseFilter = "all" | "upcoming" | "completed";

function harvestMatchesPhaseFilter(
  status: HarvestLineStatus,
  phase: HarvestPhaseFilter,
): boolean {
  if (phase === "all") return true;
  if (phase === "upcoming") {
    return status === "scheduled" || status === "harvested";
  }
  return status === "delivered";
}

const HARVEST_STATUS_ROW_CLASSES: Record<HarvestLineStatus, string> = {
  scheduled: "text-accent",
  harvested: "text-info",
  delivered: "text-primary",
};

const HARVEST_PHASE_FILTER_OPTIONS: HarvestPhaseFilter[] = [
  "all",
  "upcoming",
  "completed",
];

/** Phase tabs stick below app header when the page scrolls. */
const HARVEST_TABLE_STICKY_CHROME_CLASS =
  "sticky top-14 z-20 -mx-6 border-b border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80";

const HARVEST_TABLE_HORIZONTAL_SCROLL_CLASS =
  "overflow-x-auto overflow-y-visible px-6";

const HARVEST_TABLE_COLUMN_HEAD_CLASS =
  "bg-muted py-2.5 font-medium text-muted-foreground";

const HARVEST_TABLE_CLASS =
  "w-full min-w-[900px] table-fixed border-separate border-spacing-0 text-sm";

const HARVEST_TABLE_CELL_CLASS = "px-3 py-2.5";

function HarvestHistoryTableColGroup() {
  return (
    <colgroup>
      <col className="w-[10%]" />
      <col className="w-[14%]" />
      <col className="w-[12%]" />
      <col className="w-[10%]" />
      <col className="w-[12%]" />
      <col className="w-[10%]" />
      <col className="w-[14%]" />
      <col className="w-[8%]" />
    </colgroup>
  );
}

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
  /** ISO yyyy-mm-dd for delivered-row sort (valid delivery date only). */
  deliveryFilterDate: string;
  createdAt: string;
  date: string;
  grass: string;
  /** Resolved from `farm_id` via reference `farms` (Zustand). */
  farm: string;
  zone: string;
  quantity: string;
  quantityValue: number;
  limitStatus: "limit" | "overLimit" | null;
  remainingQuantityDisplay: string | null;
  /** `harvested_area` formatted when UOM is Kg. */
  harvestedAreaDisplay: string | null;
  /** `harvested_area` when UOM is M2 or Sod→Sprig (m²). */
  harvestedAreaM2Display: string | null;
  estimatedDate: string;
  actualDate: string;
  deliveryDate: string;
  doSoNumber: string;
  doSoDate: string;
  truckNote: string;
  shippingDispatchDetails: string;
  generalNote: string;
  licensePlate: string;
  harvestTypeLabel: string;
  harvestTypeKey: HarvestTypeStorageKey | "";
  uomDisplay: string;
  customerDisplay: string;
  estimatedDateEnd: string;
  actualHarvestEndDate: string;
  portArrivalDate: string;
  /** Harvested area with unit for detail modal. */
  harvestedAreaFullDisplay: string | null;
  densityDisplay: string | null;
  attachments: Array<{ label: string; url: string }>;
  /** Per-record edit/delete (see `PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE`). */
  canManageHarvest: boolean;
};

function harvestDetailDisplayText(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s || s === "-") return "—";
  return s;
}

function harvestHistoryTableAreaDisplay(h: HarvestRow): string {
  return h.harvestedAreaM2Display ?? h.harvestedAreaDisplay ?? "—";
}

function HarvestHistoryDetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <p className={className}>
      <span className="inline-block w-[140px] shrink-0 text-gray-500">{label}</span>
      <span className="text-foreground">{value}</span>
    </p>
  );
}

function HarvestHistoryDetailNote({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const text = harvestDetailDisplayText(value);
  return (
    <div>
      <p className="mb-1 text-gray-500">{label}</p>
      <p className="whitespace-pre-wrap wrap-break-word text-foreground">{text}</p>
    </div>
  );
}

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
  farmZones: FarmZoneReferenceRow[];
  farms: unknown[];
  remainingByProductUom: Map<string, number>;
  unitByProductUom: Map<string, string>;
  productMap: Map<string, string>;
  locale: string;
  /** Harvest delete/edit parity when API rows omit Monday table ids. */
  defaultTableId?: string;
  defaultTableName?: string;
  harvestVisibilityCtx: ReturnType<typeof buildHarvestPlanVisibilityCtx>;
};

/** Raw harvest plan rows + requirement maps; remapped when locale or reference data changes. */
type HarvestSourceBundle = {
  planRows: Record<string, unknown>[];
  projectId: string;
  defaultTableId: string;
  defaultTableName: string;
  remainingByProductUom: [string, number][];
  unitByProductUom: [string, string][];
};

function harvestPhaseFilterLabel(
  tr: (key: string) => string,
  phase: HarvestPhaseFilter,
): string {
  switch (phase) {
    case "all":
      return tr("harvestPhase_all");
    case "upcoming":
      return tr("harvestPhase_upcoming");
    case "completed":
      return tr("harvestPhase_completed");
    default:
      return phase;
  }
}

/**
 * Map one `sts_project_harvesting_plan` API row to UI row.
 */
function mapHarvestRecordToHarvestRow(
  r: Record<string, unknown>,
  ctx: HarvestMapCtx,
): HarvestRow {
  const actual = String(r.actual_harvest_date ?? "").trim();
  const estimated = String(r.estimated_harvest_date ?? "").trim();
  const status = deriveProjectHarvestStatusFromRecord(r);
  const attachments = buildHarvestAttachmentSlidesFromRow(r);

  const uomRaw = String(r.uom ?? "").trim();
  const uomLower = uomRaw.toLowerCase();
  const uomNorm = normalizeUomKey(uomRaw);
  const ha = parseNumber(r.harvested_area);
  const qty = parseNumber(r.quantity);
  const isSodToSprig = isSodToSprigHarvestLine(r);
  const displayQty = qty;
  const displayUom = isSodToSprig
    ? "Kg"
    : formatRequirementUomDisplay(uomRaw) || uomRaw;
  const productId = String(r.product_id ?? "").trim();
  const uomKey = isSodToSprig ? "kg" : normalizeUomKey(uomRaw);
  const remainingMapKey = `${productId}::${uomKey}`;
  const remainingQty = ctx.remainingByProductUom.get(remainingMapKey);
  const remainingUnit =
    ctx.unitByProductUom.get(remainingMapKey) ??
    (isSodToSprig ? "Kg" : uomRaw);
  const remainingQuantityDisplay =
    remainingQty != null
      ? `${remainingQty.toLocaleString()} ${remainingUnit}`.trim()
      : null;
  const harvestedAreaDisplay =
    uomNorm === "kg" && ha > 0 ? ha.toLocaleString() : null;
  const harvestedAreaM2Display =
    ha > 0 && (isSodToSprig || uomNorm === "m2")
      ? ha.toLocaleString()
      : null;

  const grassName = String(r.grass_name ?? r.commodity_name ?? "").trim();
  const grass =
    grassName || ctx.productMap.get(productId) || "-";

  const farmIdRaw = String(r.farm_id ?? "").trim();
  const farmFromRef = farmNameByIdFromRows(ctx.farms, farmIdRaw);
  const farm =
    farmFromRef || (farmIdRaw ? farmIdRaw : "-");

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
  const deliveryRaw = String(r.delivery_harvest_date ?? "").trim();
  const deliveryFilterDate = isValidDate(deliveryRaw)
    ? deliveryRaw.slice(0, 10)
    : "";
  const createdAt = String(r.created_at ?? r.createdAt ?? "").trim();
  const kgPerM2Raw = parseNumber(r.kg_per_m2);
  const densityDisplay =
    kgPerM2Raw > 0
      ? `${kgPerM2Raw.toFixed(1)} kg/m²`
      : ha > 0 && qty > 0 && (isSodToSprig || uomLower === "kg")
        ? `${(qty / ha).toFixed(1)} kg/m²`
        : null;
  const harvestedAreaFullDisplay =
    harvestedAreaM2Display != null
      ? `${harvestedAreaM2Display} m²`
      : harvestedAreaDisplay != null
        ? `${harvestedAreaDisplay} m²`
        : null;
  const harvestTypeRaw = r.harvest_type ?? r.load_type ?? r.harvestType ?? "";
  const harvestTypeKey = normalizeHarvestTypeStorageKey(harvestTypeRaw);
  const harvestTypeLabel = harvestTypeDisplayLabel(harvestTypeRaw) || "—";
  const customerDisplay =
    String(r.customer_name ?? r.customer ?? "").trim() ||
    String(r.customer_id ?? "").trim() ||
    "";

  return {
    id: String(r.id ?? ""),
    tableId,
    tableName,
    productId,
    uom: uomRaw,
    status,
    filterDate,
    deliveryFilterDate,
    createdAt,
    date: projectHarvestDisplayDateFromRecord(r, ctx.locale),
    grass,
    farm,
    zone: (() => {
      const stored = harvestRecordZoneStoredValue(r);
      const label = zoneIdToLabel(stored, ctx.farmZones);
      return label || stored || "-";
    })(),
    quantity:
      displayQty > 0
        ? `${displayQty.toLocaleString()} ${displayUom}`.trim()
        : "-",
    quantityValue: displayQty,
    limitStatus: harvestLimitStatusFromDescription(r.description),
    remainingQuantityDisplay,
    harvestedAreaDisplay,
    harvestedAreaM2Display,
    estimatedDate: formatDateDisplay(r.estimated_harvest_date, ctx.locale),
    estimatedDateEnd: formatDateDisplay(getEstimatedDateEndFromRow(r), ctx.locale),
    actualDate: formatDateDisplay(r.actual_harvest_date, ctx.locale),
    actualHarvestEndDate: formatDateDisplay(getActualHarvestEndDateFromRow(r), ctx.locale),
    portArrivalDate: formatDateDisplay(r.shipment_required_date, ctx.locale),
    deliveryDate: formatDateDisplay(r.delivery_harvest_date, ctx.locale),
    doSoNumber: String(r.do_so_number ?? "").trim() || "-",
    doSoDate: formatDateDisplay(r.do_so_date, ctx.locale),
    truckNote: getTruckNoteFromRow(r) || "-",
    shippingDispatchDetails: getShippingDispatchDetailsFromRow(r) || "-",
    generalNote: getGeneralNoteFromRow(r) || "-",
    licensePlate: String(r.license_plate ?? "").trim() || "-",
    harvestTypeLabel,
    harvestTypeKey,
    uomDisplay: displayUom,
    customerDisplay,
    harvestedAreaFullDisplay,
    densityDisplay,
    attachments,
    canManageHarvest: canUserManageHarvestPlanRecord(r, ctx.harvestVisibilityCtx),
  };
}

function safeProjectsListHref(raw: string | null | undefined): string {
  const fallback = "/projects";
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  if (
    (!s.startsWith("/projects") && !s.startsWith("/harvest")) ||
    s.startsWith("//")
  ) {
    return fallback;
  }
  return normalizeAppNavigationHref(s);
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

function harvestLoadTypeBadgeClass(key: HarvestTypeStorageKey | ""): string {
  if (key === "sod_to_sprig") return "bg-primary/10 text-primary";
  if (key === "sod") return "bg-primary/10 text-primary";
  if (key === "sprig") return "bg-secondary/40 text-foreground";
  return "bg-muted text-muted-foreground";
}

function HarvestHistoryLoadTypeBadge({
  label,
  storageKey,
}: {
  label: string;
  storageKey: HarvestTypeStorageKey | "";
}) {
  const text = harvestDetailDisplayText(label);
  if (text === "—") return null;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        harvestLoadTypeBadgeClass(storageKey),
      )}
    >
      {text}
    </span>
  );
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
  const tHarvestDetail = useAppTranslations("HarvestDetail");
  const tProjectForm = useAppTranslations("ProjectForm");
  const tBase = useAppTranslations();
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const canEditProjects = canAccessModule(user, "projects", "edit");
  const canDeleteProjects = canAccessModule(user, "projects", "delete");
  const canManageProject = canEditProjects || canDeleteProjects;
  const canCreateHarvest = canAccessModule(user, "harvests", "create");
  const canEditHarvest = canAccessModule(user, "harvests", "edit");
  const canDeleteHarvest = canAccessModule(user, "harvests", "delete");
  const canExportHarvest = canAccessModule(user, "harvests", "export");
  const canViewAllHarvestData = canViewAllModuleData(user, "harvests");
  const userId = user?.id;
  const harvestHistoryScope = useMemo(
    (): ProjectDetailHarvestScope => ({ userId }),
    [userId],
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowId = searchParams.get("rowId")?.trim() ?? "";
  const tableId = searchParams.get("tableId")?.trim() ?? "";
  const projectIdFromQuery =
    searchParams.get("projectId")?.trim() ||
    searchParams.get("id")?.trim() ||
    "";
  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return normalizeAppNavigationHref(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  const projectsListBackHref = useMemo(
    () => safeProjectsListHref(searchParams.get("returnTo")),
    [searchParams],
  );

  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const staffsRef = useHarvestingDataStore((s) => s.staffs);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const farmZonesForHarvest = useHarvestingDataStore((s) => s.farmZones);
  const keyAreasFromStore = useHarvestingDataStore((s) => s.keyAreas);
  const farmsForHarvest = useHarvestingDataStore((s) => s.farms);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const harvestVisibilityCtx = useMemo(
    () =>
      buildHarvestPlanVisibilityCtx(
        user,
        canViewAllHarvestData,
        staffsRef as unknown[],
      ),
    [user, canViewAllHarvestData, staffsRef],
  );

  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectRow, setProjectRow] = useState<MondayProjectServerRow | null>(null);
  const [deliveredQuantityRows, setDeliveredQuantityRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [harvestSource, setHarvestSource] = useState<HarvestSourceBundle | null>(
    null,
  );
  const [expandedHarvestId, setExpandedHarvestId] = useState<string | null>(null);
  const [harvestDeleteTarget, setHarvestDeleteTarget] = useState<HarvestRow | null>(
    null,
  );
  const [harvestDeleting, setHarvestDeleting] = useState(false);
  const [harvestDeleteError, setHarvestDeleteError] = useState<string | null>(null);
  const [harvestExportOpen, setHarvestExportOpen] = useState(false);
  const [harvestGrassFilter, setHarvestGrassFilter] = useState("");
  const [harvestStatusFilter, setHarvestStatusFilter] = useState<"" | HarvestLineStatus>(
    "",
  );
  const [harvestPhaseFilter, setHarvestPhaseFilter] =
    useState<HarvestPhaseFilter>("all");
  const [harvestDateFrom, setHarvestDateFrom] = useState("");
  const [harvestDateTo, setHarvestDateTo] = useState("");
  const [harvestPlanLoadingMore, setHarvestPlanLoadingMore] = useState(false);
  const [harvestPlanHasMore, setHarvestPlanHasMore] = useState(false);
  const [harvestPlanTotalRecords, setHarvestPlanTotalRecords] = useState<
    number | null
  >(null);
  const harvestPlanPageRef = useRef(0);
  const harvestLoadMoreLockRef = useRef(false);
  const harvestLoadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const harvestHeadScrollRef = useRef<HTMLDivElement | null>(null);
  const harvestBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const harvestScrollSyncLockRef = useRef(false);

  const syncHarvestTableHorizontalScroll = useCallback(
    (source: "head" | "body", scrollLeft: number) => {
      if (harvestScrollSyncLockRef.current) return;
      harvestScrollSyncLockRef.current = true;
      const head = harvestHeadScrollRef.current;
      const body = harvestBodyScrollRef.current;
      if (source === "head" && body && body.scrollLeft !== scrollLeft) {
        body.scrollLeft = scrollLeft;
      } else if (source === "body" && head && head.scrollLeft !== scrollLeft) {
        head.scrollLeft = scrollLeft;
      }
      harvestScrollSyncLockRef.current = false;
    },
    [],
  );
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

  const keyAreaMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of keyAreasFromStore) {
      if (r.id && r.title) map.set(r.id, r.title);
    }
    return map;
  }, [keyAreasFromStore]);

  const harvests = useMemo((): HarvestRow[] => {
    if (!harvestSource) return [];
    const remainingByProductUom = new Map(harvestSource.remainingByProductUom);
    const unitByProductUom = new Map(harvestSource.unitByProductUom);
    const mapCtx: HarvestMapCtx = {
      farmZones: farmZonesForHarvest,
      farms: farmsForHarvest,
      remainingByProductUom,
      unitByProductUom,
      productMap,
      locale,
      defaultTableId: harvestSource.defaultTableId,
      defaultTableName: harvestSource.defaultTableName,
      harvestVisibilityCtx,
    };
    return filterHarvestHistoryForProjectDetail(
      harvestPlanRowsForProject(harvestSource.planRows, harvestSource.projectId),
      harvestVisibilityCtx,
      PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE,
    ).map((r) => mapHarvestRecordToHarvestRow(r, mapCtx));
  }, [harvestSource, locale, productMap, farmZonesForHarvest, farmsForHarvest, harvestVisibilityCtx]);

  const loadMoreHarvestPlan = useCallback(async () => {
    const projectId = String(harvestSource?.projectId ?? "").trim();
    if (!projectId || harvestLoadMoreLockRef.current) return;
    harvestLoadMoreLockRef.current = true;
    setHarvestPlanLoadingMore(true);
    const nextPage = harvestPlanPageRef.current + 1;
    try {
      const h = await stsProxyGetHarvestingIndex(
        buildProjectDetailHarvestHistoryApiParams(projectId, nextPage, harvestHistoryScope),
      );
      const pageRows = h.rows.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === "object",
      );
      if (pageRows.length === 0) {
        setHarvestPlanHasMore(false);
        return;
      }
      if (h.totalRecords != null) {
        setHarvestPlanTotalRecords(h.totalRecords);
      }
      let mergedCount = 0;
      setHarvestSource((prev) => {
        if (!prev) return prev;
        const merged = mergeHarvestPlanRows(prev.planRows, pageRows);
        mergedCount = merged.length;
        return { ...prev, planRows: merged };
      });
      setHarvestPlanHasMore(
        harvestPlanHasMoreFromResponse(
          mergedCount,
          pageRows.length,
          h.totalRecords,
        ),
      );
      harvestPlanPageRef.current = nextPage;
    } catch {
      /* keep hasMore; scroll again to retry */
    } finally {
      harvestLoadMoreLockRef.current = false;
      setHarvestPlanLoadingMore(false);
    }
  }, [harvestHistoryScope, harvestSource?.projectId]);

  useEffect(() => {
    const el = harvestLoadMoreSentinelRef.current;
    if (!el || loading || !harvestPlanHasMore || !harvestSource) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        if (harvestLoadMoreLockRef.current || loading || harvestPlanLoadingMore) {
          return;
        }
        void loadMoreHarvestPlan();
      },
      { root: null, rootMargin: "160px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [
    loading,
    harvestPlanHasMore,
    harvestPlanLoadingMore,
    harvestSource,
    loadMoreHarvestPlan,
  ]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        harvestPlanPageRef.current = 0;
        harvestLoadMoreLockRef.current = false;
        setHarvestPlanHasMore(false);
        setHarvestPlanTotalRecords(null);
        setHarvestPlanLoadingMore(false);

        const normalizedProjectId = projectIdFromQuery.trim();
        if (!normalizedProjectId) {
          setHarvestSource(null);
          setProjectRow(null);
          setError(t("cannotFindDetail"));
          return;
        }

        await fetchAllHarvestingReferenceData();
        if (!mounted) return;

        const storeProjects = useHarvestingDataStore.getState();
        const catalogRow =
          findProjectRowBySelectId(storeProjects.allProjects, normalizedProjectId) ??
          findProjectRowBySelectId(storeProjects.projects, normalizedProjectId);

        const dynamicRows = await fetchProjectDynamicFieldsByProjectId(normalizedProjectId);
        if (!mounted) return;

        const dynamicRow = pickDynamicRowForProject(dynamicRows, rowId, tableId);
        const row = mergeProjectDetailFromServer(
          normalizedProjectId,
          catalogRow,
          dynamicRow,
        );

        if (!catalogRow && !dynamicRow) {
          setHarvestSource(null);
          setProjectRow(null);
          setError(t("cannotFindDetail"));
          return;
        }

        const historyHarvest = await fetchAllHarvestPlanPagesForProjectDetailHistory(
          normalizedProjectId,
          harvestHistoryScope,
        );
        const allPlanRows = harvestPlanRowsForProject(
          historyHarvest.planRows,
          normalizedProjectId,
        );
        const { totalRecords } = historyHarvest;
        if (!mounted) return;

        harvestPlanPageRef.current = Math.max(
          1,
          Math.ceil(allPlanRows.length / HARVEST_HISTORY_PER_PAGE),
        );
        setHarvestPlanTotalRecords(totalRecords);
        setHarvestPlanHasMore(
          harvestPlanHasMoreFromResponse(
            allPlanRows.length,
            allPlanRows.length,
            totalRecords,
          ),
        );
        setProjectRow(row);

        setDeliveredQuantityRows(allPlanRows);

        const requirementRows = parseRequirements(row.quantity_required_sprig_sod);
        const remainingByProductUom = new Map<string, number>();
        const unitByProductUom = new Map<string, string>();
        for (const req of requirementRows) {
          const productId = String(req.product_id ?? "").trim();
          if (!productId) continue;
          const reqUomRaw = String(req.uom ?? "").trim();
          const reqUomKey = normalizeUomKey(reqUomRaw);
          const required = effectiveRequiredQuantityFromRecord(req as Record<string, unknown>);
          const delivered = calculateDeliveredQuantityDeliveryOnly(
            allPlanRows,
            productId,
            reqUomRaw,
            normalizedProjectId,
          );
          const remaining = Math.max(0, required - delivered);
          const mapKey = `${productId}::${reqUomKey}`;
          remainingByProductUom.set(mapKey, remaining);
          unitByProductUom.set(mapKey, reqUomRaw || "-");
        }

        setHarvestSource({
          planRows: allPlanRows,
          projectId: normalizedProjectId,
          defaultTableId: String(row.table_id ?? tableId ?? "").trim(),
          defaultTableName: String(row.table_name ?? "Harvesting").trim() || "Harvesting",
          remainingByProductUom: [...remainingByProductUom.entries()],
          unitByProductUom: [...unitByProductUom.entries()],
        });
      } catch (e) {
        if (!mounted) return;
        setHarvestSource(null);
        setProjectRow(null);
        setError(e instanceof Error ? e.message : t("loadError"));
        setDeliveredQuantityRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchAllHarvestingReferenceData, harvestHistoryScope, projectIdFromQuery, rowId, tableId, t, userId]);

  useEffect(() => {
    if (!expandedHarvestId) {
      Fancybox.close();
    }
  }, [expandedHarvestId]);

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
      estimateStartDate: formatDateDisplay(rec.estimate_start_date, locale),
      actualStartDate: formatDateDisplay(actualStartRaw, locale),
      endDate: formatDateDisplay(r.deadline, locale),
      keyAreas: keyAreasParsed.map(
        (raw) => keyAreaIdOrKeyToLabel(raw, keyAreasFromStore) || raw,
      ),
      mainContactName: String(rec.main_contact_name ?? "").trim(),
      mainContactEmail: String(rec.main_contact_email ?? "").trim(),
      mainContactPhone: String(rec.main_contact_phone ?? "").trim(),
      actualCompletionDisplay: formatDateDisplay(rec.actual_completion_date, locale),
    };
  }, [projectRow, projectTitleMap, countryMap, staffMap, keyAreasFromStore, tProjectForm, locale]);

  const grassRows = useMemo<GrassRow[]>(() => {
    if (!projectRow) return [];
    const harvestProjectId = String(projectRow.project_id ?? "").trim();
    const req = parseRequirements(projectRow.quantity_required_sprig_sod);
    const sourceRows = deliveredQuantityRows;
    return req.map((r, idx) => {
      const productId = String(r.product_id ?? "").trim();
      const uom =
        inferRequirementUom({
          uom: String(r.uom ?? "").trim() || undefined,
          quantity_m2: r.quantity_m2 as string | number | null | undefined,
          quantity_kg: r.quantity_kg as string | number | null | undefined,
        }) || String(r.uom ?? "").trim();
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
      const keyAreaId = String(r.key_area_id ?? "").trim();
      const keyAreaName = keyAreaId ? keyAreaMap.get(keyAreaId) : undefined;
      return {
        id: `${productId || "item"}-${idx}`,
        name: formatGrassRequirementDisplayName(productName, keyAreaName, uom),
        uom,
        required,
        delivered,
        remaining,
        progress: Math.max(0, Math.min(100, progress)),
      };
    });
  }, [deliveredQuantityRows, keyAreaMap, projectRow, productMap, t]);

  const overallPercent = useMemo(() => {
    if (!projectRow) return 0;
    const harvestProjectId = String(projectRow.project_id ?? "").trim() || undefined;
    return calculateOverallProjectProgressFromRaw(
      deliveredQuantityRows,
      projectRow.quantity_required_sprig_sod,
      harvestProjectId,
    );
  }, [deliveredQuantityRows, projectRow]);

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

  const hasActiveHarvestFilters = Boolean(
    harvestGrassFilter.trim() ||
      harvestStatusFilter ||
      harvestPhaseFilter !== "all" ||
      normalizeDateFilterInput(harvestDateFrom) ||
      normalizeDateFilterInput(harvestDateTo),
  );

  const filteredHarvests = useMemo(() => {
    const fromIso = normalizeDateFilterInput(harvestDateFrom);
    const toIso = normalizeDateFilterInput(harvestDateTo);
    const filtered = harvestsWithProductNames.filter((h) => {
      if (harvestGrassFilter && h.grass !== harvestGrassFilter) return false;
      if (harvestStatusFilter && h.status !== harvestStatusFilter) return false;
      if (!harvestMatchesPhaseFilter(h.status, harvestPhaseFilter)) return false;
      if (fromIso && h.filterDate && h.filterDate < fromIso) return false;
      if (toIso && h.filterDate && h.filterDate > toIso) return false;
      if ((fromIso || toIso) && !h.filterDate) return false;
      return true;
    });
    if (!hasActiveHarvestFilters) return filtered;
    return [...filtered].sort(compareProjectDetailHarvestHistory);
  }, [
    harvestDateFrom,
    harvestDateTo,
    harvestGrassFilter,
    harvestPhaseFilter,
    harvestStatusFilter,
    harvestsWithProductNames,
    hasActiveHarvestFilters,
  ]);

  const harvestExportResolveContext = useMemo(
    () => ({
      projects: projectsRef,
      products: productsRef,
      farms: farmsForHarvest,
      farmZones: farmZonesForHarvest,
      defaultProjectLabel: basic?.projectName ?? "",
      locale,
      projectHarvestLineStatusLabel: (status: HarvestLineStatus) =>
        projectHarvestLineStatusLabel(t, status),
    }),
    [
      basic?.projectName,
      farmZonesForHarvest,
      farmsForHarvest,
      locale,
      productsRef,
      projectsRef,
      t,
    ],
  );

  const harvestRowsForExport = useMemo(() => {
    if (!harvestSource) return [];
    const filteredIds = new Set(
      filteredHarvests.map((h) => String(h.id ?? "").trim()).filter(Boolean),
    );
    if (filteredIds.size === 0) return [];
    const orderIndex = new Map(
      filteredHarvests.map((h, i) => [String(h.id ?? "").trim(), i]),
    );
    const exportFieldsById = new Map(
      filteredHarvests.map((h) => {
        const id = String(h.id ?? "").trim();
        const d = String(h.date ?? "").trim();
        return [
          id,
          {
            date: d && d !== "-" ? d : "",
            status: projectHarvestLineStatusLabel(t, h.status),
          },
        ] as const;
      }),
    );
    return filterHarvestHistoryForProjectDetail(
      harvestPlanRowsForProject(harvestSource.planRows, harvestSource.projectId),
      harvestVisibilityCtx,
      PROJECT_DETAIL_HARVEST_HISTORY_DISPLAY_MODE,
    )
      .filter((r) => filteredIds.has(String(r.id ?? "").trim()))
      .sort(
        (a, b) =>
          (orderIndex.get(String(a.id ?? "").trim()) ?? 0) -
          (orderIndex.get(String(b.id ?? "").trim()) ?? 0),
      )
      .map((r) => {
        const id = String(r.id ?? "").trim();
        const fields = exportFieldsById.get(id);
        if (!fields) return r;
        return {
          ...r,
          ...(fields.date ? { date: fields.date } : {}),
          status_label: fields.status,
        };
      });
  }, [
    filteredHarvests,
    harvestSource,
    harvestVisibilityCtx,
    t,
  ]);

  const canEditHarvestRow = (h: HarvestRow) =>
    canEditHarvest && h.canManageHarvest && Boolean(String(h.id ?? "").trim());

  const canDeleteHarvestRow = (h: HarvestRow) =>
    canDeleteHarvest &&
    h.canManageHarvest &&
    Boolean(String(h.id ?? "").trim()) &&
    Boolean(String(h.tableId ?? "").trim());

  const onConfirmDeleteHarvestFromDetail = async () => {
    if (!canDeleteHarvest) {
      setHarvestDeleteError(t("deleteHarvestFailed"));
      setHarvestDeleteTarget(null);
      return;
    }
    const target = harvestDeleteTarget;
    if (!target?.id?.trim() || !target.tableId?.trim() || !target.canManageHarvest) {
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
      setHarvestSource((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          planRows: prev.planRows.filter(
            (r) => String(r.id ?? "").trim() !== removedId,
          ),
        };
      });
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
                  {canManageProject ? (
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
                  ) : null}
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
                          <div className="mb-1 flex justify-between gap-2 text-sm">
                            <div className="min-w-0">
                              <span className="block font-medium text-foreground">{g.name}</span>
                              <span className="block tabular-nums text-muted-foreground">
                                {formatGrassRequiredQuantityLabel(g.required, g.uom)}
                              </span>
                            </div>
                            <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                              {formatGrassQuantityProgressLabel(
                                g.delivered,
                                g.required,
                                g.uom,
                                g.progress,
                              )}
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
                <div className="flex flex-row items-start justify-between gap-4 p-6 pb-3">
                  <div>
                    <h2 className="text-base font-semibold leading-none tracking-tight">
                      {t("harvestHistory")}
                    </h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {t("harvestHistoryRecordCount", {
                        count: harvests.length,
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {canExportHarvest ? (
                      <button
                        type="button"
                        onClick={() => setHarvestExportOpen(true)}
                        disabled={harvestRowsForExport.length === 0}
                        className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                        aria-label={t("exportExcel")}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                        {t("exportExcel")}
                      </button>
                    ) : null}
                    {canCreateHarvest ? (
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
                    ) : null}
                  </div>
                </div>
                <div className="space-y-4 p-6 pt-0">
                  {harvestDeleteError ? (
                    <p className="mb-3 text-sm text-destructive" role="alert">
                      {harvestDeleteError}
                    </p>
                  ) : null}
                  {hasActiveHarvestFilters ? (
                    <div className="mb-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setHarvestGrassFilter("");
                          setHarvestStatusFilter("");
                          setHarvestPhaseFilter("all");
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
                    </div>
                  ) : null}
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
                        <option value="scheduled">{t("harvestStatus_scheduled")}</option>
                        <option value="harvested">{t("harvestStatus_harvested")}</option>
                        <option value="delivered">{t("harvestStatus_delivered")}</option>
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
                  {harvests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("noHarvestRecords")}
                    </p>
                  ) : filteredHarvests.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("noHarvestRecordsFiltered")}
                    </p>
                  ) : (
                    <>
                      <div className={HARVEST_TABLE_STICKY_CHROME_CLASS}>
                        <div
                          className={cn(
                            "flex justify-start px-6 py-2",
                            bgSurfaceFilter(harvestPhaseFilter !== "all"),
                          )}
                          role="tablist"
                          aria-label={t("harvestPhaseFilter")}
                        >
                          <div className="inline-flex rounded-lg border border-border p-0.5">
                            {HARVEST_PHASE_FILTER_OPTIONS.map((phase) => {
                              const active = harvestPhaseFilter === phase;
                              return (
                                <button
                                  key={phase}
                                  type="button"
                                  role="tab"
                                  aria-selected={active}
                                  onClick={() => setHarvestPhaseFilter(phase)}
                                  className={cn(
                                    "rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                                    active
                                      ? "bg-primary text-primary-foreground shadow-sm"
                                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                  )}
                                >
                                  {harvestPhaseFilterLabel(t, phase)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div
                          ref={harvestHeadScrollRef}
                          className={HARVEST_TABLE_HORIZONTAL_SCROLL_CLASS}
                          onScroll={(e) =>
                            syncHarvestTableHorizontalScroll(
                              "head",
                              e.currentTarget.scrollLeft,
                            )
                          }
                        >
                          <table className={HARVEST_TABLE_CLASS}>
                            <HarvestHistoryTableColGroup />
                            <thead>
                              <tr className="text-left shadow-[0_1px_0_0_hsl(var(--border))]">
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                  )}
                                >
                                  {t("date")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                  )}
                                >
                                  {t("grass")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                  )}
                                >
                                  {t("farm")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                  )}
                                >
                                  {t("zone")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                    "text-right",
                                  )}
                                >
                                  {t("quantity")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                    "text-right",
                                  )}
                                >
                                  {t("area")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                  )}
                                >
                                  {tCommon("status")}
                                </th>
                                <th
                                  className={cn(
                                    HARVEST_TABLE_COLUMN_HEAD_CLASS,
                                    HARVEST_TABLE_CELL_CLASS,
                                    "text-right",
                                  )}
                                >
                                  {t("rowActions")}
                                </th>
                              </tr>
                            </thead>
                          </table>
                        </div>
                      </div>
                      <div
                        ref={harvestBodyScrollRef}
                        className={cn("-mx-6", HARVEST_TABLE_HORIZONTAL_SCROLL_CLASS)}
                        onScroll={(e) =>
                          syncHarvestTableHorizontalScroll(
                            "body",
                            e.currentTarget.scrollLeft,
                          )
                        }
                      >
                        <table className={HARVEST_TABLE_CLASS}>
                          <HarvestHistoryTableColGroup />
                          <tbody>
                          {filteredHarvests.map((h) => {
                            const areaDisplay = harvestHistoryTableAreaDisplay(h);
                            const StatusIcon =
                              h.status === "delivered" ? CheckCircle2 : Clock;
                            return (
                              <tr
                                key={h.id}
                                className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/50"
                                onClick={() => setExpandedHarvestId(h.id)}
                              >
                                <td className={cn(HARVEST_TABLE_CELL_CLASS, "text-foreground")}>
                                  {h.date}
                                </td>
                                <td
                                  className={cn(
                                    HARVEST_TABLE_CELL_CLASS,
                                    "font-medium text-foreground",
                                  )}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <span>{h.grass}</span>
                                    <HarvestLimitQuestionMark status={h.limitStatus} />
                                  </span>
                                </td>
                                <td className={cn(HARVEST_TABLE_CELL_CLASS, "text-muted-foreground")}>
                                  {h.farm && h.farm !== "-" ? h.farm : "—"}
                                </td>
                                <td className={cn(HARVEST_TABLE_CELL_CLASS, "text-muted-foreground")}>
                                  {h.zone}
                                </td>
                                <td
                                  className={cn(
                                    HARVEST_TABLE_CELL_CLASS,
                                    "text-right text-foreground",
                                  )}
                                >
                                  {h.quantity}
                                </td>
                                <td
                                  className={cn(
                                    HARVEST_TABLE_CELL_CLASS,
                                    "text-right text-foreground",
                                  )}
                                >
                                  {areaDisplay}
                                </td>
                                <td className={HARVEST_TABLE_CELL_CLASS}>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`inline-flex items-center gap-1 text-xs font-medium ${HARVEST_STATUS_ROW_CLASSES[h.status] ?? "text-muted-foreground"}`}
                                    >
                                      <StatusIcon className="h-3.5 w-3.5" />
                                      {projectHarvestLineStatusLabel(t, h.status)}
                                    </span>
                                    <HarvestHistoryLoadTypeBadge
                                      label={h.harvestTypeLabel}
                                      storageKey={h.harvestTypeKey}
                                    />
                                  </div>
                                </td>
                                <td className={cn(HARVEST_TABLE_CELL_CLASS, "text-right")}>
                                  <div className="flex items-center justify-end gap-1">
                                    {canEditHarvestRow(h) ? (
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
                                    ) : null}
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
                    </>
                  )}
                  {harvestPlanHasMore ? (
                    <div
                      ref={harvestLoadMoreSentinelRef}
                      className="flex min-h-10 items-center justify-center py-4"
                      aria-hidden={!harvestPlanLoadingMore}
                    >
                      {harvestPlanLoadingMore ? (
                        <p className="text-sm text-muted-foreground">
                          {t("loadingMoreHarvest")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </DashboardLayout>

      {canExportHarvest ? (
        <ProjectDetailHarvestExportDialog
          open={harvestExportOpen}
          onClose={() => setHarvestExportOpen(false)}
          rows={harvestRowsForExport}
          projectId={currentProjectId}
          projectLabel={basic?.projectName ?? ""}
          resolveContext={harvestExportResolveContext}
        />
      ) : null}

      {harvestDeleteTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
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
              h.status === "delivered" ? CheckCircle2 : Clock;
            return (
              <div
                className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl lg:p-6"
                role="dialog"
                aria-modal="true"
                aria-label={t("harvestHistory")}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-gray-500">#{filteredHarvests.findIndex((x) => x.id === h.id) + 1}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium ${HARVEST_STATUS_ROW_CLASSES[h.status] ?? "text-muted-foreground"}`}
                      >
                        <HeaderStatusIcon className="h-3.5 w-3.5" />
                        {projectHarvestLineStatusLabel(t, h.status)}
                      </span>
                      <HarvestHistoryLoadTypeBadge
                        label={h.harvestTypeLabel}
                        storageKey={h.harvestTypeKey}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canEditHarvestRow(h) ? (
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
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpandedHarvestId(null)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {tCommon("close")}
                    </button>
                  </div>
                </div>
                <div className="space-y-5 text-sm">
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#5a7d3c]">
                      {tForm("sectionQuantityTitle")}
                    </h3>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <HarvestHistoryDetailField
                        label={`${t("grass")}:`}
                        value={
                          <span className="inline-flex items-center gap-1">
                            {h.grass}
                            <HarvestLimitQuestionMark status={h.limitStatus} />
                          </span>
                        }
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("harvestType")}:`}
                        value={harvestDetailDisplayText(h.harvestTypeLabel)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("unit")}:`}
                        value={harvestDetailDisplayText(h.uomDisplay)}
                      />
                      <HarvestHistoryDetailField
                        label={`${t("farm")}:`}
                        value={
                          harvestDetailDisplayText(
                            h.farm && h.farm !== "-" ? h.farm : "",
                          )
                        }
                      />
                      <HarvestHistoryDetailField
                        label={`${t("zone")}:`}
                        value={harvestDetailDisplayText(h.zone)}
                      />
                   
                      <div className="sm:col-span-2">
                        <HarvestHistoryDetailField
                          label={`${t("quantity")}:`}
                          value={harvestDetailDisplayText(h.quantity)}
                        />
                        <p className="mt-1 pl-[140px] text-xs text-gray-500">
                          {t("Remqty")}{" "}
                          {h.remainingQuantityDisplay
                            ? h.remainingQuantityDisplay
                            : "—"}
                        </p>
                      </div>
                      <HarvestHistoryDetailField
                        label={`${t("area")}:`}
                        value={
                          harvestDetailDisplayText(h.harvestedAreaFullDisplay)
                        }
                      />
                      {h.densityDisplay ? (
                        <HarvestHistoryDetailField
                          label={`${tHarvestDetail("density")}:`}
                          value={h.densityDisplay}
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#5a7d3c]">
                      {tForm("sectionTimelineTitle")}
                    </h3>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <HarvestHistoryDetailField
                        label={`${t("displayDate")}`}
                        value={harvestDetailDisplayText(h.date)}
                      />
                      <HarvestHistoryDetailField
                        label={`${t("estimateDate")}`}
                        value={harvestDetailDisplayText(h.estimatedDate)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("estimatedRangeEndHint")}:`}
                        value={harvestDetailDisplayText(h.estimatedDateEnd)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("actualDateHarvestForm")}:`}
                        value={harvestDetailDisplayText(h.actualDate)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("harvestEndDate")}:`}
                        value={harvestDetailDisplayText(h.actualHarvestEndDate)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("portArrivalDate")}:`}
                        value={harvestDetailDisplayText(h.portArrivalDate)}
                      />
                      <HarvestHistoryDetailField
                        label={`${t("deliveryDate")}`}
                        value={harvestDetailDisplayText(h.deliveryDate)}
                      />
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#5a7d3c]">
                      {tForm("sectionLogisticsTitle")}
                    </h3>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <HarvestHistoryDetailField
                        label={`${t("doSoNumber")}`}
                        value={harvestDetailDisplayText(h.doSoNumber)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("doSoDate")}:`}
                        value={harvestDetailDisplayText(h.doSoDate)}
                      />
                      <HarvestHistoryDetailField
                        label={`${tForm("licensePlate")}:`}
                        value={harvestDetailDisplayText(h.licensePlate)}
                      />
                    </div>
                    <div className="mt-3 space-y-3">
                      <HarvestHistoryDetailNote
                        label={t("truckNote")}
                        value={h.truckNote}
                      />
                      <HarvestHistoryDetailNote
                        label={tForm("shippingDispatchDetails")}
                        value={h.shippingDispatchDetails}
                      />
                      <HarvestHistoryDetailNote
                        label={tForm("generalNote")}
                        value={h.generalNote}
                      />
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-[#5a7d3c]">
                      {tForm("documentationPhotos")}
                    </label>
                    <Swiper
                      modules={[FreeMode]}
                      freeMode
                      grabCursor
                      preventClicks={false}
                      preventClicksPropagation={false}
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
                                <button
                                  type="button"
                                  className="relative block h-full w-full cursor-zoom-in border-0 bg-transparent p-0"
                                  aria-label={`${t("expandHarvestRow")}: ${a.label}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openHarvestAttachmentFancybox(h.attachments, i);
                                  }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={a.url}
                                    alt={a.label}
                                    className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                                  />
                                </button>
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
                  {canDeleteHarvestRow(h) ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        title={t("deleteHarvestAria")}
                        aria-label={t("deleteHarvestAria")}
                        onClick={() => {
                          setHarvestDeleteError(null);
                          setHarvestDeleteTarget(h);
                        }}
                        className="flex gap-2 rounded-lg border p-2 text-gray-300 transition-colors hover:bg-red-50"
                      >
                        <Trash2 className="h-5 w-5" /> {tCommon("delete")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}
    </RequireAuth>
  );
}

