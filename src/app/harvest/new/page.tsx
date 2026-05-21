"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Camera, MoreVertical, Trash2 } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { canAccessModule } from "@/shared/auth/permissions";
import {
  HARVEST_DOC_PHOTO_FIELDS,
  submitFlutterHarvest,
  type HarvestDocPhotoField,
  type HarvestPhotoFiles,
} from "@/features/harvesting/api/flutterHarvestSubmit";
import {
  parseHarvestDocImagesFromRow,
  type ParsedHarvestDocSlot,
} from "@/features/harvesting/lib/parseHarvestDocImages";
import {
  getInternalStsProxyUrl,
  stsProxyGetHarvestingIndex,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import {
  filterFarmZoneRowsByFarmId,
  mapRowsToSelectOptions,
  parseFarmZoneEntries,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";
import { resolveHarvestDisplayUrl } from "@/shared/config/stsUrls";
import { DatePicker } from "@/shared/ui/date-picker";
import { MultiSelect } from "@/shared/ui/multi-select";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { deleteMondayParentOrSubItem } from "@/entities/projects/api/projectsApi";
import { effectiveRequiredQuantityForFormUom } from "@/features/project/lib/effectiveRequirementQuantity";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { AlertRouteCategoryBanner } from "@/features/alerts/AlertRouteCategoryBanner";
import { dispatchRouteAlert } from "@/features/alerts/dispatchRouteAlert";
import {
  fetchZoneAutoConfigurations,
  fetchZoneConfigurations,
  type ZoneAutoConfigurationRow,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import { CheckBadge } from "@/shared/ui/check-badge";
import { Checkbox } from "@/shared/ui/checkbox";
import { peelHarvestDuplicateDraftRow } from "@/features/harvesting/lib/harvestDuplicateDraft";

const DOC_PHOTO_SLOTS: HarvestDocPhotoField[] = [
  "payment_img",
  "shipping_note_img",
  "thermostats_img",
  "truck_license_plate_img",
  "product_being_cut_img",
  "truck_loaded_img",
];

/** Backend validates `tableId` for both parent/sub delete, even though sub-delete only uses `rowId`. */
const SUB_DELETE_TABLE_ID_FALLBACK = "subitem";

function withRefreshQueryParam(target: string, key = "refresh"): string {
  const [pathAndQuery, hash = ""] = target.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(key, String(Date.now()));
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

const SHIPPING_NOTE_SPLIT = "\n\n--- Shipping / dispatch ---\n\n";

const emptyForm = {
  /** Matches `customer_id` on plan row when available from projects (`odoo_customer_id`). */
  customerId: "",
  grass: "",
  harvestType: "sod",
  quantity: "",
  uom: "M2",
  referenceHarvestQuantity: "",
  /** `harvested_area` — nhập riêng với quantity; payload M2 vẫn không gửi cột này (theo API). */
  harvestedArea: "",
  zone: "",
  farm: "",
  project: "",
  estimatedDate: "",
  /** Stored in `estimated_harvest_end_date`; keeps description fallback for older rows. */
  estimatedDateEnd: "",
  actualDate: "",
  /** Stored inside `description` when API has no dedicated column. */
  actualHarvestEndDate: "",
  deliveryDate: "",
  /** Maps to `shipment_required_date` (Port arrival). */
  portArrivalDate: "",
  doSoNumber: "",
  doSoDate: "",
  truckNote: "",
  /** Appended to `truck_note` on save (HarvestForm “Shipping / Dispatch Details”). */
  shippingDispatchDetails: "",
  /** Maps to `description`. */
  generalNote: "",
  licensePlate: "",
};

type HarvestFormState = typeof emptyForm;

function toDateInput(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  const s = v.trim();
  if (s.startsWith("0000")) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function requiredUomForHarvestType(harvestType: HarvestTypeStorageKey): "Kg" | "M2" {
  return harvestType === "sprig" ? "Kg" : "M2";
}

function resolvedHarvestTypeForForm(
  harvestType: string,
  fallbackUom: string,
): HarvestTypeStorageKey {
  return normalizeHarvestTypeStorageKey(harvestType) || defaultHarvestTypeForUom(fallbackUom);
}

function applyHarvestTypeConstraint(
  prev: HarvestFormState,
  harvestType: HarvestTypeStorageKey,
): HarvestFormState {
  const nextUom = requiredUomForHarvestType(harvestType);
  return {
    ...prev,
    harvestType,
    uom: nextUom,
    referenceHarvestQuantity: nextUom === "Kg" ? "" : prev.referenceHarvestQuantity,
    harvestedArea: nextUom === "M2" ? "" : prev.harvestedArea,
  };
}

function applyUomConstraint(
  prev: HarvestFormState,
  uom: "Kg" | "M2",
): HarvestFormState {
  const currentHarvestType = resolvedHarvestTypeForForm(prev.harvestType, prev.uom);
  const nextHarvestType =
    normUomKey(uom) === "kg"
      ? "sprig"
      : currentHarvestType === "sod_to_sprig"
        ? "sod_to_sprig"
        : "sod";
  return applyHarvestTypeConstraint({ ...prev, uom }, nextHarvestType);
}

function harvestTypeAllowedForUom(
  harvestType: HarvestTypeStorageKey,
  uom: string,
): boolean {
  const uomKey = normUomKey(uom);
  if (uomKey === "kg") return harvestType === "sprig";
  if (uomKey === "m2") return harvestType === "sod" || harvestType === "sod_to_sprig";
  return true;
}

type ParsedHarvestDescription = {
  generalNote: string;
  estimatedDateEnd: string;
  actualHarvestEndDate: string;
  useEstimatedDateRange: boolean;
};

function parseDescriptionFromRow(description: string): ParsedHarvestDescription {
  const raw = String(description ?? "").trim();
  if (!raw) {
    return {
      generalNote: "",
      estimatedDateEnd: "",
      actualHarvestEndDate: "",
      useEstimatedDateRange: false,
    };
  }
  let estimatedDateEnd = "";
  let actualHarvestEndDate = "";
  const body: string[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const mEst = block.match(/^Estimated harvest end:\s*(\d{4}-\d{2}-\d{2})\s*$/i);
    const mAct = block.match(/^Harvest end:\s*(\d{4}-\d{2}-\d{2})\s*$/i);
    if (mEst) {
      estimatedDateEnd = mEst[1];
      continue;
    }
    if (mAct) {
      actualHarvestEndDate = mAct[1];
      continue;
    }
    body.push(block);
  }
  return {
    generalNote: body.join("\n\n").trim(),
    estimatedDateEnd,
    actualHarvestEndDate,
    useEstimatedDateRange: Boolean(estimatedDateEnd),
  };
}

function getEstimatedDateEndFromRow(
  row: Record<string, unknown>,
  descParsed?: ParsedHarvestDescription,
): string {
  const parsed = descParsed ?? parseDescriptionFromRow(String(row.description ?? ""));
  return toDateInput(row.estimated_harvest_end_date) || parsed.estimatedDateEnd;
}

function buildDescriptionForSubmit(
  form: HarvestFormState,
  useEstimatedRange: boolean,
): string {
  const parts: string[] = [];
  if (useEstimatedRange && form.estimatedDateEnd.trim()) {
    parts.push(`Estimated harvest end: ${form.estimatedDateEnd.trim()}`);
  }
  if (form.actualHarvestEndDate.trim()) {
    parts.push(`Harvest end: ${form.actualHarvestEndDate.trim()}`);
  }
  if (form.generalNote.trim()) {
    parts.push(form.generalNote.trim());
  }
  return parts.join("\n\n");
}

function splitTruckNoteFromRow(raw: string): {
  truckNote: string;
  shippingDispatchDetails: string;
} {
  const s = String(raw ?? "");
  const idx = s.indexOf(SHIPPING_NOTE_SPLIT);
  if (idx === -1) {
    return { truckNote: s.trim(), shippingDispatchDetails: "" };
  }
  return {
    truckNote: s.slice(0, idx).trim(),
    shippingDispatchDetails: s.slice(idx + SHIPPING_NOTE_SPLIT.length).trim(),
  };
}

/** Mirrors `QuantityRequiredProject` + harvesting_form remaining line (kg / m² / generic). */
type QuantityRequirement = {
  productId: string;
  grassName: string;
  quantityKg: number | null;
  quantityM2: number | null;
  /** Generic `quantity` when API does not split kg/m2. */
  quantity: number | null;
  uom: string | null;
};

/** Server / Flutter `getRemainingQuantityForProduct` — branches use form UOM (`uomRaw`). */
function getRequiredQtyForUom(req: QuantityRequirement, uomRaw: string): number {
  return effectiveRequiredQuantityForFormUom(
    {
      quantity: req.quantity ?? undefined,
      quantity_m2: req.quantityM2 ?? undefined,
      quantity_kg: req.quantityKg ?? undefined,
      uom: req.uom ?? undefined,
    },
    uomRaw,
  );
}

function defaultUomForRequirement(req: QuantityRequirement): string {
  if (req.quantityKg != null && req.quantityKg > 0) {
    return "Kg";
  }
  if (req.quantityM2 != null && req.quantityM2 > 0) {
    return "M2";
  }
  const u = req.uom?.trim().toLowerCase() ?? "";
  if (u === "kg" || u === "kgs") {
    return "Kg";
  }
  if (u === "m2" || u === "m²" || u === "sqm") {
    return "M2";
  }
  return "M2";
}

function normUomKey(u: string): string {
  const s = u.trim().toLowerCase();
  if (s === "m²" || s === "m2") {
    return "m2";
  }
  return s;
}

/** Column present in JSON (including `0`) — matches PHP / Dart for `quantity_kg` / `quantity_m2`. */
function parseQtyColumnNullable(v: unknown): number | null {
  if (v === undefined || v === null || v === "") {
    return null;
  }
  const n = typeof v === "number" && Number.isFinite(v) ? v : parseNum(v);
  return Number.isFinite(n) ? n : null;
}

type HarvestDeliveredRow = {
  id: string;
  projectId: string;
  productId: string;
  uom: string;
  quantity: number;
};

type DynamicProjectRow = {
  id_row?: string;
  table_id?: string;
  quantity_required_sprig_sod?: unknown;
};

function parseNum(v: unknown): number {
  const n = Number.parseFloat(String(v ?? "").replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeNonNegativeInput(raw: string): string {
  const s = raw.replace(/,/g, "").trim();
  if (!s) return "";
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

function normalizeMatchText(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function isTruthyFlag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * API / store may send `quantity_required_sprig_sod` as:
 * - `Array<{ product_id, quantity, uom, ... }>` (typical)
 * - JSON string of that array
 * - a single object (legacy)
 */
function normalizeQuantityRequiredSprigSod(raw: unknown): unknown[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) {
      return [];
    }
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === "object") {
        return [parsed];
      }
      return [];
    } catch {
      return [];
    }
  }
  if (typeof raw === "object") {
    return [raw];
  }
  return [];
}

function parseRequirements(raw: unknown, productNameById: Map<string, string>) {
  const list = normalizeQuantityRequiredSprigSod(raw);
  const out: QuantityRequirement[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const productId = String(row.product_id ?? "").trim();
    if (!productId) continue;

    const quantityKg = parseQtyColumnNullable(row.quantity_kg);
    const quantityM2 = parseQtyColumnNullable(row.quantity_m2);
    /** Supports string `"10000"` or number from JSON. */
    const genericQty = parseNum(row.quantity);
    const uomRaw = String(row.uom ?? "").trim();
    const qRaw = String(row.quantity ?? "").trim();

    if (quantityKg == null && quantityM2 == null && qRaw === "") {
      continue;
    }

    out.push({
      productId,
      grassName: productNameById.get(productId) ?? productId,
      quantityKg,
      quantityM2,
      quantity: qRaw !== "" ? genericQty : null,
      uom: uomRaw || null,
    });
  }
  return out;
}

function requirementMatchesFormUom(req: QuantityRequirement, formUomRaw: string): boolean {
  const formKey = normUomKey(formUomRaw);
  if (formKey === "kg") {
    if (req.quantityKg != null) return true;
    return normUomKey(req.uom ?? "") === "kg";
  }
  if (formKey === "m2") {
    if (req.quantityM2 != null) return true;
    return normUomKey(req.uom ?? "") === "m2";
  }
  return false;
}

function parseHarvestDeliveredRow(raw: unknown): HarvestDeliveredRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const projectId = String(row.project_id ?? "").trim();
  const productId = String(row.product_id ?? "").trim();
  const uom = String(row.uom ?? "").trim();
  const quantity = parseNum(row.quantity);
  if (!projectId || !productId || quantity <= 0) return null;
  return { id, projectId, productId, uom, quantity };
}

function applyRowToFormState(r: Record<string, unknown>): HarvestFormState {
  const rawUom = String(r.uom ?? "M2").trim() || "M2";
  const harvestType = resolvedHarvestTypeForForm(String(r.load_type ?? ""), rawUom);
  const uomStr = requiredUomForHarvestType(harvestType);
  const harvested = r.harvested_area;
  const referenceHarvestQty = r.ref_hrv_qty_sprig;
  const harvestedStr = normalizeNonNegativeInput(String(harvested ?? ""));
  const referenceHarvestQtyStr = normalizeNonNegativeInput(
    String(referenceHarvestQty ?? ""),
  );
  const isKg = uomStr.toLowerCase() === "kg";
  const descParsed = parseDescriptionFromRow(String(r.description ?? ""));
  const estimatedDateEnd = getEstimatedDateEndFromRow(r, descParsed);
  const { truckNote, shippingDispatchDetails } = splitTruckNoteFromRow(
    String(r.truck_note ?? ""),
  );
  return {
    customerId: String(r.customer_id ?? "").trim(),
    project: String(r.project_id ?? ""),
    grass: String(r.product_id ?? ""),
    farm: String(r.farm_id ?? ""),
    zone: String(r.zone ?? ""),
    quantity: String(r.quantity ?? ""),
    uom: uomStr,
    referenceHarvestQuantity: !isKg ? referenceHarvestQtyStr : "",
    harvestedArea: harvestedStr,
    harvestType,
    estimatedDate: toDateInput(r.estimated_harvest_date),
    estimatedDateEnd,
    actualDate: toDateInput(r.actual_harvest_date),
    actualHarvestEndDate: descParsed.actualHarvestEndDate,
    deliveryDate: toDateInput(r.delivery_harvest_date),
    portArrivalDate: toDateInput(r.shipment_required_date),
    doSoNumber: String(r.do_so_number ?? ""),
    doSoDate: toDateInput(r.do_so_date),
    truckNote,
    shippingDispatchDetails,
    generalNote: descParsed.generalNote,
    licensePlate: String(r.license_plate ?? ""),
  };
}

type HarvestFieldErrors = Partial<
  Record<
    | "project"
    | "grass"
    | "harvestType"
    | "quantity"
    | "referenceHarvestQuantity"
    | "harvestedArea"
    | "zone"
    | "farm"
    | "estimatedDate"
    | "actualDate",
    string
  >
>;

function getHarvestDatePairError(
  estimated: string,
  actual: string,
  datePairRequiredMessage: string,
): string | null {
  if (!actual.trim() && !estimated.trim()) {
    return datePairRequiredMessage;
  }
  return null;
}

type HarvestValidationMessages = {
  selectProject: string;
  selectGrass: string;
  selectHarvestType: string;
  enterQuantity: string;
  referenceHarvestQuantityRequired: string;
  harvestedAreaKgRequired: string;
  selectZone: string;
  zoneRequiredWhenActual: string;
  selectFarm: string;
  datePairRequired: string;
};

function getHarvestFieldErrors(
  formData: HarvestFormState,
  messages: HarvestValidationMessages,
): HarvestFieldErrors {
  const errors: HarvestFieldErrors = {};
  if (!formData.project.trim()) errors.project = messages.selectProject;
  if (!formData.grass.trim()) errors.grass = messages.selectGrass;
  const harvestType = normalizeHarvestTypeStorageKey(formData.harvestType);
  const uomLower = formData.uom.trim().toLowerCase();
  if (!harvestType) {
    errors.harvestType = messages.selectHarvestType;
  } else if (
    (harvestType === "sprig" && uomLower !== "kg") ||
    (harvestType !== "sprig" && uomLower !== "m2")
  ) {
    errors.harvestType = messages.selectHarvestType;
  }
  if (!formData.quantity.trim() || parseNum(formData.quantity) <= 0) {
    errors.quantity = messages.enterQuantity;
  }
  if (harvestType === "sod_to_sprig") {
    const refQty = formData.referenceHarvestQuantity.trim();
    if (!refQty || parseNum(refQty) <= 0) {
      errors.referenceHarvestQuantity = messages.referenceHarvestQuantityRequired;
    }
  }
  const hasActual = Boolean(formData.actualDate.trim());
  if (hasActual && !formData.zone.trim()) {
    errors.zone = messages.zoneRequiredWhenActual;
  }
  if (!formData.farm.trim()) errors.farm = messages.selectFarm;
  if (hasActual && uomLower === "kg") {
    const ha = formData.harvestedArea.trim();
    const n = parseNum(ha);
    if (!ha || n <= 0) {
      errors.harvestedArea = messages.harvestedAreaKgRequired;
    }
  }
  const dateErr = getHarvestDatePairError(
    formData.estimatedDate,
    formData.actualDate,
    messages.datePairRequired,
  );
  if (dateErr) {
    errors.estimatedDate = dateErr;
    errors.actualDate = dateErr;
  }
  return errors;
}

function firstHarvestFieldError(errors: HarvestFieldErrors): string | null {
  const order: (keyof HarvestFieldErrors)[] = [
    "project",
    "grass",
    "harvestType",
    "quantity",
    "referenceHarvestQuantity",
    "harvestedArea",
    "zone",
    "farm",
    "estimatedDate",
    "actualDate",
  ];
  for (const key of order) {
    const msg = errors[key];
    if (msg) return msg;
  }
  return null;
}

function firstHarvestFieldErrorKey(errors: HarvestFieldErrors): keyof HarvestFieldErrors | null {
  const order: (keyof HarvestFieldErrors)[] = [
    "project",
    "grass",
    "harvestType",
    "quantity",
    "referenceHarvestQuantity",
    "harvestedArea",
    "zone",
    "farm",
    "estimatedDate",
    "actualDate",
  ];
  return order.find((key) => Boolean(errors[key])) ?? null;
}

function focusHarvestFieldByErrorKey(
  key: keyof HarvestFieldErrors | null | undefined,
): void {
  if (!key || typeof window === "undefined") return;
  const fieldIdMap: Partial<Record<keyof HarvestFieldErrors, string>> = {
    project: "harvest-project",
    grass: "harvest-grass",
    harvestType: "harvest-harvest-type",
    quantity: "harvest-quantity",
    referenceHarvestQuantity: "harvest-reference-quantity",
    harvestedArea: "harvest-harvested-area",
    zone: "harvest-zone",
    farm: "harvest-farm",
    estimatedDate: "harvest-estimated-date",
    actualDate: "harvest-actual-date",
  };
  const fieldId = fieldIdMap[key];
  if (!fieldId) return;
  const element = document.getElementById(fieldId);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusTarget =
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element
      : (element.querySelector(
          "button, input, select, textarea, [tabindex]",
        ) as HTMLElement | null);
  if (focusTarget && "focus" in focusTarget) {
    focusTarget.focus();
  }
}

function HarvestFormSection({
  id,
  title,
  hint,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="bg-card rounded-xl border border-border p-4 shadow-sm md:p-5"
    >
      <header className="mb-4 border-b border-border/60 pb-3">
        <h4 className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h4>
        {hint ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function HarvestInputPageInner() {
  const tBase = useAppTranslations();
  const t = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) =>
    values
      ? tBase(`HarvestForm.${key}`, values as Parameters<typeof tBase>[1])
      : tBase(`HarvestForm.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("id")?.trim() || null;
  const projectIdParam = searchParams.get("projectId")?.trim() || "";
  const returnToParam = searchParams.get("returnTo")?.trim() || "";
  const initialProjectId = useMemo(() => {
    if (!projectIdParam) return "";
    let decoded = projectIdParam;
    try {
      decoded = decodeURIComponent(projectIdParam);
    } catch {
      decoded = projectIdParam;
    }
    return decoded.trim();
  }, [projectIdParam]);
  const returnTarget = useMemo(() => {
    if (!returnToParam) return "/harvest";
    let decoded = returnToParam;
    try {
      decoded = decodeURIComponent(returnToParam);
    } catch {
      decoded = returnToParam;
    }
    const safeTarget = decoded.trim();
    if (
      safeTarget.startsWith("/harvest") ||
      safeTarget.startsWith("/projects/detail")
    ) {
      return safeTarget;
    }
    return "/harvest";
  }, [returnToParam]);

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(returnTarget);
  }, [router, returnTarget]);

  const user = useAuthUserStore((s) => s.user);
  const canCreateHarvest = canAccessModule(user, "harvests", "create");
  const canEditHarvest = canAccessModule(user, "harvests", "edit");
  const canDeleteHarvest = canAccessModule(user, "harvests", "delete");
  const canAccessHarvestForm = editId
    ? canEditHarvest || canDeleteHarvest
    : canCreateHarvest;
  const accessDenied = Boolean(user) && !canAccessHarvestForm;
  const canSubmitHarvest = editId ? canEditHarvest : canCreateHarvest;
  const canDeleteCurrentHarvest = Boolean(editId) && canDeleteHarvest;
  const farms = useHarvestingDataStore((s) => s.farms);
  const projects = useHarvestingDataStore((s) => s.projects);
  const products = useHarvestingDataStore((s) => s.products);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const refLoading = useHarvestingDataStore((s) => s.loading);
  const refError = useHarvestingDataStore((s) => s.error);
  const bootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const pickGrassesForHarvestGrassSelect = useHarvestingDataStore(
    (s) => s.pickGrassesForHarvestGrassSelect,
  );

  useEffect(() => {
    if (accessDenied) return;
    void fetchAllHarvestingReferenceData();
  }, [accessDenied, fetchAllHarvestingReferenceData]);

  const projectOptions = useMemo(
    () => mapRowsToSelectOptions(projects as unknown[], "title"),
    [projects],
  );
  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const customerOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of projects) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const cid = String(row.odoo_customer_id ?? "").trim();
      if (!cid) continue;
      const label =
        String(row.company_name ?? row.alias_title ?? "").trim() || cid;
      if (!m.has(cid)) m.set(cid, label);
    }
    return Array.from(m.entries()).map(([id, label]) => ({ id, label }));
  }, [projects]);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of products) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      const label = String(row.title ?? row.name ?? id).trim() || id;
      m.set(id, label);
    }
    return m;
  }, [products]);

  const [formData, setFormData] = useState(emptyForm);

  const grassRowsForSelect = useMemo(() => {
    const ymds = [
      toDateInput(formData.estimatedDate),
      toDateInput(formData.estimatedDateEnd),
      toDateInput(formData.actualDate),
      toDateInput(formData.actualHarvestEndDate),
    ].filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    return pickGrassesForHarvestGrassSelect(ymds, formData.grass);
  }, [
    pickGrassesForHarvestGrassSelect,
    products,
    formData.estimatedDate,
    formData.estimatedDateEnd,
    formData.actualDate,
    formData.actualHarvestEndDate,
    formData.grass,
  ]);
  const productOptions = useMemo(
    () => mapRowsToSelectOptions(grassRowsForSelect as unknown[], "title"),
    [grassRowsForSelect],
  );

  const filteredFarmZoneRows = useMemo(
    () => filterFarmZoneRowsByFarmId(farmZones, formData.farm),
    [farmZones, formData.farm],
  );
  const [zoneConfigRows, setZoneConfigRows] = useState<ZoneConfigurationRow[]>([]);
  const [zoneAutoConfigRows, setZoneAutoConfigRows] = useState<
    ZoneAutoConfigurationRow[]
  >([]);
  const [harvestedAreaManual, setHarvestedAreaManual] = useState(false);
  const [photos, setPhotos] = useState<HarvestPhotoFiles>({});
  /** Loaded from API in edit mode — preview URLs + file names for `images_removed`. */
  const [existingDocSlots, setExistingDocSlots] = useState<
    Partial<Record<HarvestDocPhotoField, ParsedHarvestDocSlot>>
  >({});
  /** Staged basenames for `images_removed` / `files_removed` (Flutter replace + remove flows). */
  const [pendingImagesRemoved, setPendingImagesRemoved] = useState<
    Partial<Record<HarvestDocPhotoField, string[]>>
  >({});
  const [pendingFilesRemoved, setPendingFilesRemoved] = useState<
    Partial<Record<HarvestDocPhotoField, string[]>>
  >({});
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLoaded, setEditLoaded] = useState(!editId);
  const [editTableId, setEditTableId] = useState("");
  const [editTableName, setEditTableName] = useState("Harvesting");
  const [projectHarvestRows, setProjectHarvestRows] = useState<HarvestDeliveredRow[]>(
    [],
  );
  const [dynamicProjectRows, setDynamicProjectRows] = useState<DynamicProjectRow[]>(
    [],
  );
  const [fieldErrors, setFieldErrors] = useState<HarvestFieldErrors>({});
  const [harvestDateTouched, setHarvestDateTouched] = useState(false);
  /** Mirrors HarvestForm “Use date range” for estimated start/end inputs. */
  const [useEstimatedDateRange, setUseEstimatedDateRange] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [zones, autoRows] = await Promise.all([
        fetchZoneConfigurations().catch(() => [] as ZoneConfigurationRow[]),
        fetchZoneAutoConfigurations().catch(() => [] as ZoneAutoConfigurationRow[]),
      ]);
      if (!mounted) return;
      setZoneConfigRows(zones);
      setZoneAutoConfigRows(autoRows);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredZoneEntries = useMemo(() => {
    const entries = parseFarmZoneEntries(filteredFarmZoneRows, "id");
    const currentZone = String(formData.zone ?? "").trim();
    if (!currentZone || entries.some(([value]) => value === currentZone)) {
      return entries;
    }
    return [[currentZone, zoneIdToLabel(currentZone, farmZones) || currentZone], ...entries];
  }, [filteredFarmZoneRows, formData.zone, farmZones]);

  const selectedFarmLabel = useMemo(
    () => farmOptions.find((f) => f.id === formData.farm)?.label ?? "",
    [farmOptions, formData.farm],
  );
  const selectedGrassLabel = useMemo(
    () => productOptions.find((p) => p.id === formData.grass)?.label ?? "",
    [formData.grass, productOptions],
  );
  const selectedZoneLabel = useMemo(
    () => filteredZoneEntries.find(([key]) => key === formData.zone)?.[1] ?? "",
    [filteredZoneEntries, formData.zone],
  );
  const matchedZoneConfiguration = useMemo(() => {
    if (!selectedFarmLabel || !selectedGrassLabel || !formData.zone) return null;
    const farmNeedle = normalizeMatchText(selectedFarmLabel);
    const grassNeedle = normalizeMatchText(selectedGrassLabel);
    const zoneNeedles = new Set([
      normalizeMatchText(formData.zone),
      normalizeMatchText(selectedZoneLabel),
    ]);
    return (
      zoneConfigRows.find((row) => {
        const farm = normalizeMatchText(row.farm_name);
        const grass = normalizeMatchText(row.turfgrass);
        const zone = normalizeMatchText(row.zone);
        return farm === farmNeedle && grass === grassNeedle && zoneNeedles.has(zone);
      }) ?? null
    );
  }, [
    formData.zone,
    selectedFarmLabel,
    selectedGrassLabel,
    selectedZoneLabel,
    zoneConfigRows,
  ]);
  const matchedZoneAutoConfiguration = useMemo(() => {
    if (!matchedZoneConfiguration) return null;
    return (
      zoneAutoConfigRows.find(
        (row) =>
          String(row.zone_configuration_id) === String(matchedZoneConfiguration.id),
      ) ?? null
    );
  }, [matchedZoneConfiguration, zoneAutoConfigRows]);
  const autoHarvestAreaInfo = useMemo(() => {
    const isKg = formData.uom.trim().toLowerCase() === "kg";
    const qtyKg = parseNum(formData.quantity);
    if (!isKg || qtyKg <= 0 || !matchedZoneConfiguration || !matchedZoneAutoConfiguration) {
      return null;
    }
    if (
      !isTruthyFlag(matchedZoneAutoConfiguration.auto_enabled) ||
      !isTruthyFlag(matchedZoneAutoConfiguration.allow_auto_fill_harvest_area)
    ) {
      return null;
    }
    const inventoryKgPerM2 =
      parseNum(matchedZoneAutoConfiguration.last_inventory_kg_per_m2) ||
      parseNum(matchedZoneConfiguration.inventory_kg_per_m2);
    if (inventoryKgPerM2 <= 0) return null;
    return {
      harvestedAreaM2: qtyKg / inventoryKgPerM2,
      inventoryKgPerM2,
      confidencePct: parseNum(matchedZoneAutoConfiguration.last_confidence_pct),
    };
  }, [
    formData.quantity,
    formData.uom,
    matchedZoneAutoConfiguration,
    matchedZoneConfiguration,
  ]);

  const filteredProjectOptions = useMemo(() => {
    const cid = formData.customerId.trim();
    if (!cid) return projectOptions;
    const filtered = projectOptions.filter((o) => {
      const pr = projects.find((x) => {
        if (!x || typeof x !== "object") return false;
        const row = x as Record<string, unknown>;
        return String(row.id ?? "").trim() === o.id;
      }) as Record<string, unknown> | undefined;
      if (!pr) return false;
      return String(pr.odoo_customer_id ?? "").trim() === cid;
    });
    if (filtered.length === 0) {
      return projectOptions;
    }
    const selectedProjectId = formData.project.trim();
    if (!selectedProjectId) {
      return filtered;
    }
    const hasSelected = filtered.some((o) => o.id === selectedProjectId);
    if (hasSelected) {
      return filtered;
    }
    const selectedFromAll = projectOptions.find((o) => o.id === selectedProjectId);
    if (!selectedFromAll) {
      return filtered;
    }
    return [selectedFromAll, ...filtered];
  }, [formData.customerId, formData.project, projectOptions, projects]);

  const validationMessages: HarvestValidationMessages = {
    selectProject: t("validationSelectProject"),
    selectGrass: t("validationSelectGrassType"),
    selectHarvestType: t("validationSelectHarvestType"),
    enterQuantity: t("validationEnterQuantity"),
    referenceHarvestQuantityRequired: t("validationReferenceHarvestQuantityRequired"),
    harvestedAreaKgRequired: t("validationHarvestedAreaKg"),
    selectZone: t("validationSelectZone"),
    zoneRequiredWhenActual: t("zoneRequiredWhenActual"),
    selectFarm: t("validationSelectFarm"),
    datePairRequired: t("datePairRequiredError"),
  };
  const getPhotoSlotLabel = (field: HarvestDocPhotoField): string => {
    const keyMap: Record<HarvestDocPhotoField, string> = {
      payment_img: "photoSlotPayment",
      shipping_note_img: "photoSlotShipping",
      thermostats_img: "photoSlotThermostat",
      truck_license_plate_img: "photoSlotPlate",
      product_being_cut_img: "photoSlotCutting",
      truck_loaded_img: "photoSlotLoaded",
    };
    return t(keyMap[field]);
  };

  useEffect(() => {
    if (accessDenied) return;
    if (!editId) {
      const dupRow = peelHarvestDuplicateDraftRow();
      if (dupRow) {
        const descParsed = parseDescriptionFromRow(String(dupRow.description ?? ""));
        setFormData(applyRowToFormState(dupRow));
        setUseEstimatedDateRange(
          Boolean(getEstimatedDateEndFromRow(dupRow, descParsed)),
        );
        setPhotos({});
        setExistingDocSlots({});
        setPendingImagesRemoved({});
        setPendingFilesRemoved({});
        setEditTableId("");
        setEditTableName("Harvesting");
        setEditLoadError(null);
        setEditLoaded(true);
        setFieldErrors({});
        setHarvestDateTouched(false);
        return;
      }
      setFormData({ ...emptyForm, project: initialProjectId });
      setUseEstimatedDateRange(false);
      setPhotos({});
      setExistingDocSlots({});
      setPendingImagesRemoved({});
      setPendingFilesRemoved({});
      setEditTableId("");
      setEditTableName("Harvesting");
      setEditLoadError(null);
      setEditLoaded(true);
      setFieldErrors({});
      setHarvestDateTouched(false);
      return;
    }
    setEditLoaded(false);
    setEditLoadError(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await stsProxyGetHarvestingIndex({
          id: editId,
          page: 1,
          per_page: 1,
        });
        const raw = res.rows[0];
        if (!raw || typeof raw !== "object") {
          const upstreamMessage =
            typeof res.message === "string" ? res.message.trim() : "";
          throw new Error(upstreamMessage || t("harvestNotFound"));
        }
        if (cancelled) return;
        const row = raw as Record<string, unknown>;
        const descParsed = parseDescriptionFromRow(String(row.description ?? ""));
        setFormData(applyRowToFormState(row));
        setUseEstimatedDateRange(Boolean(getEstimatedDateEndFromRow(row, descParsed)));
        setEditTableId(String(row.table_id ?? "").trim());
        setEditTableName(String(row.table_name ?? "Harvesting").trim() || "Harvesting");
        setExistingDocSlots(parseHarvestDocImagesFromRow(row));
        setPendingImagesRemoved({});
        setPendingFilesRemoved({});
        setFieldErrors({});
        setHarvestDateTouched(false);
        setEditLoaded(true);
      } catch (e) {
        if (!cancelled) {
          setEditLoadError(
            e instanceof Error ? e.message : t("loadError"),
          );
          setEditLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessDenied, editId, initialProjectId]);

  const showDeleteMenu = () => {
    if (!canDeleteCurrentHarvest) return;
    setDeleteMenuOpen(true);
  };

  const closeDeleteMenu = () => setDeleteMenuOpen(false);

  const onPickDeleteFromSheet = () => {
    closeDeleteMenu();
    setConfirmDeleteOpen(true);
  };

  const onConfirmDeleteHarvest = async () => {
    if (!canDeleteCurrentHarvest) {
      setSubmitError("You do not have permission to delete this harvest.");
      setConfirmDeleteOpen(false);
      return;
    }
    if (!editId) {
      setSubmitError("Missing delete identifiers.");
      setConfirmDeleteOpen(false);
      return;
    }
    try {
      setDeleting(true);
      setSubmitError(null);
      await deleteMondayParentOrSubItem({
        tableId: editTableId || SUB_DELETE_TABLE_ID_FALLBACK,
        tableName: editTableName.trim() || "Harvesting",
        rowId: editId,
        type: "sub",
      });
      setConfirmDeleteOpen(false);
      // After delete, never send the user back to detail — the row no longer exists.
      router.push(withRefreshQueryParam("/harvest"));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Delete harvest failed.");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (accessDenied) return;
    if (!formData.project) {
      setProjectHarvestRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all: HarvestDeliveredRow[] = [];
        let page = 1;
        let totalPages = 1;
        const maxPages = 30;
        do {
          const res = await stsProxyGetHarvestingIndex({
            page,
            per_page: 200,
            project_id: formData.project,
          });
          for (const raw of res.rows) {
            const parsed = parseHarvestDeliveredRow(raw);
            if (!parsed || parsed.projectId !== formData.project) continue;
            all.push(parsed);
          }
          totalPages = Math.max(1, res.totalPages);
          page += 1;
        } while (page <= totalPages && page <= maxPages);
        if (!cancelled) setProjectHarvestRows(all);
      } catch {
        if (!cancelled) setProjectHarvestRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessDenied, formData.project]);

  useEffect(() => {
    if (accessDenied) return;
    if (!formData.project.trim()) {
      setDynamicProjectRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await stsProxyPostJson<unknown[]>(
          STS_API_PATHS.mondayFindDynamicByField,
          {
            field_name: "project_id",
            field_value: formData.project.trim(),
          },
        );
        if (cancelled) return;
        setDynamicProjectRows(
          Array.isArray(rows) ? (rows as DynamicProjectRow[]) : [],
        );
      } catch {
        if (!cancelled) setDynamicProjectRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessDenied, formData.project]);

  const selectedProjectRequirements = useMemo(() => {
    // Prefer server dynamic-table lookup by project_id, fallback to store project payload.
    const dynamicRow = dynamicProjectRows.find((r) =>
      r && typeof r === "object" && r.quantity_required_sprig_sod != null,
    );
    if (dynamicRow?.quantity_required_sprig_sod != null) {
      return parseRequirements(dynamicRow.quantity_required_sprig_sod, productNameById);
    }

    const selected = projects.find((x) => {
      if (!x || typeof x !== "object") return false;
      const row = x as Record<string, unknown>;
      return String(row.id ?? "").trim() === formData.project;
    });
    if (!selected || typeof selected !== "object") return [] as QuantityRequirement[];
    const row = selected as Record<string, unknown>;
    return parseRequirements(row.quantity_required_sprig_sod, productNameById);
  }, [dynamicProjectRows, formData.project, productNameById, projects]);

  /** One row per `product_id` in `quantity_required_sprig_sod`, like Flutter `quantityRequiredSprigSod.firstWhereOrNull`. */
  const requirementForGrass = useMemo(() => {
    const productId = formData.grass.trim();
    if (!productId) return null;
    const sameProduct = selectedProjectRequirements.filter(
      (r) => r.productId === productId,
    );
    if (sameProduct.length === 0) return null;
    const matchByFormUom = sameProduct.find((r) =>
      requirementMatchesFormUom(r, formData.uom),
    );
    return matchByFormUom ?? sameProduct[0] ?? null;
  }, [formData.grass, formData.uom, selectedProjectRequirements]);

  const deliveredQuantityForSelection = useMemo(() => {
    if (!requirementForGrass) return 0;
    const formUomKey = normUomKey(formData.uom);
    return projectHarvestRows.reduce((sum, row) => {
      if (row.productId !== requirementForGrass.productId) return sum;
      if (normUomKey(row.uom) !== formUomKey) return sum;
      if (editId && row.id === editId) return sum;
      return sum + row.quantity;
    }, 0);
  }, [editId, formData.uom, projectHarvestRows, requirementForGrass]);

  const maxAllowedQuantity = useMemo(() => {
    if (!requirementForGrass) return null;
    const required = getRequiredQtyForUom(requirementForGrass, formData.uom);
    return Math.max(0, required - deliveredQuantityForSelection);
  }, [deliveredQuantityForSelection, formData.uom, requirementForGrass]);

  const updateHarvestLimitDescriptionsForSelection = useCallback(
    (projectId: string) => {
      const normalizedProjectId = projectId.trim();
      if (!normalizedProjectId) return;

      const url = getInternalStsProxyUrl(STS_API_PATHS.updateHarvestLimitDescriptions);
      void fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          project_id: normalizedProjectId,
        }),
      }).catch(() => {
        // Recalculation runs in the background; saving the harvest should not wait on it.
      });
    },
    [],
  );

  const remainingAfterEntered = useMemo(() => {
    if (!requirementForGrass || maxAllowedQuantity === null) return null;
    const entered = parseNum(formData.quantity);
    if (entered <= 0) return maxAllowedQuantity;
    return Math.max(0, maxAllowedQuantity - entered);
  }, [formData.quantity, maxAllowedQuantity, requirementForGrass]);

  /** Unit label under Quantity — same source as Flutter `remainingInfo['unit']`, else current UoM. */
  const remainingDisplayUnit = useMemo(() => {
    const u = formData.uom.trim();
    if (u.toLowerCase() === "kg") return "kg";
    if (u.toLowerCase() === "m2") return "m²";
    return u || "M2";
  }, [formData.uom]);

  useEffect(() => {
    if (!harvestDateTouched) return;
    const pairError = getHarvestDatePairError(formData.estimatedDate, formData.actualDate, validationMessages.datePairRequired);
    setFieldErrors((prev) => ({
      ...prev,
      estimatedDate: pairError ?? undefined,
      actualDate: pairError ?? undefined,
    }));
  }, [formData.estimatedDate, formData.actualDate, harvestDateTouched]);

  useEffect(() => {
    const hasActual = Boolean(formData.actualDate.trim());
    const zoneErr = validationMessages.zoneRequiredWhenActual;
    setFieldErrors((prev) => {
      if (hasActual && !formData.zone.trim()) {
        return prev.zone === zoneErr ? prev : { ...prev, zone: zoneErr };
      }
      if (prev.zone === zoneErr) {
        return { ...prev, zone: undefined };
      }
      return prev;
    });
  }, [
    formData.actualDate,
    formData.zone,
    validationMessages.zoneRequiredWhenActual,
  ]);

  const harvestDatePairError =
    fieldErrors.actualDate ?? fieldErrors.estimatedDate ?? null;

  useEffect(() => {
    if (!formData.zone) return;
    const isValid = filteredZoneEntries.some(([key]) => key === formData.zone);
    if (!isValid) {
      setFormData((prev) => ({ ...prev, zone: "" }));
    }
  }, [filteredZoneEntries, formData.zone]);

  useEffect(() => {
    setHarvestedAreaManual(false);
  }, [formData.farm, formData.grass, formData.uom, formData.zone]);

  useEffect(() => {
    if (!autoHarvestAreaInfo || harvestedAreaManual) return;
    const nextHarvestedArea = autoHarvestAreaInfo.harvestedAreaM2.toFixed(2);
    setFormData((prev) => {
      if (prev.uom.trim().toLowerCase() !== "kg") return prev;
      if (prev.harvestedArea === nextHarvestedArea) return prev;
      return {
        ...prev,
        harvestedArea: nextHarvestedArea,
      };
    });
    setFieldErrors((prev) => ({ ...prev, harvestedArea: undefined }));
  }, [autoHarvestAreaInfo, harvestedAreaManual]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitHarvest) {
      setSubmitError(
        editId
          ? "You do not have permission to edit this harvest."
          : "You do not have permission to create a harvest.",
      );
      return;
    }
    setSubmitError(null);
    setHarvestDateTouched(true);
    const errors = getHarvestFieldErrors(formData, validationMessages);
    setFieldErrors(errors);
    const firstErrKey = firstHarvestFieldErrorKey(errors);
    const firstErr = firstHarvestFieldError(errors);
    if (firstErr) {
      focusHarvestFieldByErrorKey(firstErrKey);
      return;
    }

    setSubmitLoading(true);
    try {
      const imagesRemoved: Partial<
        Record<HarvestDocPhotoField, string[]>
      > = {};
      const filesRemoved: Partial<
        Record<HarvestDocPhotoField, string[]>
      > = {};
      for (const f of HARVEST_DOC_PHOTO_FIELDS) {
        const inames = pendingImagesRemoved[f];
        if (inames?.length) imagesRemoved[f] = inames;
        const fnames = pendingFilesRemoved[f];
        if (fnames?.length) filesRemoved[f] = fnames;
      }
      const hasRemoved =
        Object.keys(imagesRemoved).length > 0 ||
        Object.keys(filesRemoved).length > 0;
      const removedPayload = hasRemoved
        ? { imagesRemoved, filesRemoved }
        : undefined;

      const mainUom = formData.uom.trim().toLowerCase();
      const referenceQtyStripped = formData.referenceHarvestQuantity
        .replace(/,/g, "")
        .trim();
      const haStripped = formData.harvestedArea.replace(/,/g, "").trim();
      const harvestedAreaPayload =
        mainUom === "m2" ? undefined : haStripped || undefined;
      const selectedProjectRow = projects.find((x) => {
        if (!x || typeof x !== "object") return false;
        const row = x as Record<string, unknown>;
        return String(row.id ?? "").trim() === formData.project.trim();
      }) as Record<string, unknown> | undefined;
      const customerFromProject = String(
        selectedProjectRow?.odoo_customer_id ?? "",
      ).trim();
      const customerIdSubmit =
        formData.customerId.trim() || customerFromProject || undefined;
      const descriptionPayload = buildDescriptionForSubmit(
        formData,
        useEstimatedDateRange,
      ).trim();
      const truckNotePayload = [formData.truckNote.trim(), formData.shippingDispatchDetails.trim()]
        .filter(Boolean)
        .join(SHIPPING_NOTE_SPLIT);
      const savedHarvest = (await submitFlutterHarvest(
        {
          id: editId ?? undefined,
          projectId: formData.project,
          productId: formData.grass,
          farmId: formData.farm,
          zone: formData.zone,
          quantity: formData.quantity,
          uom: formData.uom,
          harvestType:
            normalizeHarvestTypeStorageKey(formData.harvestType) ||
            defaultHarvestTypeForUom(formData.uom),
          estimatedHarvestDate: formData.estimatedDate,
          estimatedHarvestEndDate: useEstimatedDateRange
            ? formData.estimatedDateEnd
            : undefined,
          actualHarvestDate: formData.actualDate,
          deliveryHarvestDate: formData.deliveryDate,
          shipmentRequiredDate: formData.portArrivalDate.trim() || undefined,
          doSoNumber: formData.doSoNumber,
          doSoDate: formData.doSoDate.trim() || undefined,
          truckNote: truckNotePayload,
          licensePlate: formData.licensePlate,
          customerId: customerIdSubmit,
          description: descriptionPayload || undefined,
          assignedTo: user?.id != null ? String(user.id) : "",
          createdBy: !editId && user?.id != null ? String(user.id) : undefined,
          harvestedArea: harvestedAreaPayload,
          refHrvQtySprig: referenceQtyStripped || undefined,
        },
        photos,
        removedPayload,
      )) as Record<string, unknown>;
      updateHarvestLimitDescriptionsForSelection(formData.project);
      if (!editId) {
        const newHarvestId = String(savedHarvest?.id ?? "").trim();
        const projectLabel =
          String(
            selectedProjectRow?.title ??
              selectedProjectRow?.project_name ??
              "",
          ).trim() || formData.project.trim();
        const grassId = formData.grass.trim();
        const grassLabel = productNameById.get(grassId) || grassId;
        const qtyDisplay = formData.quantity.trim();
        const uomDisplay = formData.uom.trim();
        const alertHref =
          newHarvestId.length > 0
            ? `/harvest/detail?id=${encodeURIComponent(newHarvestId)}&returnTo=${encodeURIComponent(returnTarget)}`
            : returnTarget;
        void dispatchRouteAlert({
          routeKey: "harvest_new",
          title: t("alertNewHarvestTitle", { grass: grassLabel }),
          message: t("alertNewHarvestMessage", {
            project: projectLabel,
            quantity: qtyDisplay,
            uom: uomDisplay,
          }),
          href: alertHref,
          sourceEntityId: newHarvestId || formData.project.trim(),
        });
      }
      router.push(returnTarget);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("saveFailed");
      setSubmitError(msg);
    } finally {
      setSubmitLoading(false);
    }
  };

  /** Local file picks — object URLs for preview (revoked on change/unmount). */
  const filePreviewUrls = useMemo(() => {
    const m: Partial<Record<HarvestDocPhotoField, string>> = {};
    for (const f of HARVEST_DOC_PHOTO_FIELDS) {
      const file = photos[f];
      if (file) m[f] = URL.createObjectURL(file);
    }
    return m;
  }, [photos]);

  useEffect(() => {
    return () => {
      Object.values(filePreviewUrls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [filePreviewUrls]);

  const setPhoto = (field: HarvestDocPhotoField, file: File | undefined) => {
    setPhotos((prev) => {
      const next = { ...prev };
      if (file) next[field] = file;
      else delete next[field];
      return next;
    });
    if (file) {
      const slot = existingDocSlots[field];
      const hasServer =
        (slot?.imageFileNames.length ?? 0) > 0 ||
        (slot?.documentFileNames.length ?? 0) > 0;
      if (editId && hasServer && slot) {
        setPendingImagesRemoved((p) => ({
          ...p,
          [field]: [...slot.imageFileNames],
        }));
        setPendingFilesRemoved((p) => ({
          ...p,
          [field]: [...slot.documentFileNames],
        }));
      } else {
        setPendingImagesRemoved((p) => {
          const n = { ...p };
          delete n[field];
          return n;
        });
        setPendingFilesRemoved((p) => {
          const n = { ...p };
          delete n[field];
          return n;
        });
      }
    } else {
      setPendingImagesRemoved((p) => {
        const n = { ...p };
        delete n[field];
        return n;
      });
      setPendingFilesRemoved((p) => {
        const n = { ...p };
        delete n[field];
        return n;
      });
    }
  };

  const markExistingDocRemoved = (field: HarvestDocPhotoField) => {
    const slot = existingDocSlots[field];
    if (
      !slot?.imageFileNames.length &&
      !slot?.documentFileNames.length
    ) {
      return;
    }
    setPendingImagesRemoved((p) => ({
      ...p,
      [field]: [...slot.imageFileNames],
    }));
    setPendingFilesRemoved((p) => ({
      ...p,
      [field]: [...slot.documentFileNames],
    }));
  };

  const formDisabled =
    refLoading ||
    submitLoading ||
    deleting ||
    !canSubmitHarvest ||
    (Boolean(editId) && !editLoaded);

  const zoneFieldHelpText = formData.actualDate.trim()
    ? t("zoneFieldHelpTooltipWhenActual")
    : t("zoneFieldHelpTooltip");

  const activeFieldIssueCount = useMemo(
    () =>
      (Object.keys(fieldErrors) as (keyof HarvestFieldErrors)[]).filter((k) =>
        Boolean(fieldErrors[k]),
      ).length,
    [fieldErrors],
  );

  /* Nền trống/đầy do rule toàn cục globals.css (--surface-filter-*) — không đặt bg-muted ở đây */
  const harvestFieldClass =
    "w-full min-h-10 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
  const harvestLabelClass =
    "mb-1.5 block text-xs font-medium text-muted-foreground";

  return (
    <RequireAuth>
      <DashboardLayout>
        {accessDenied ? (
          <div className="dashboard-harvesting-skin min-h-screen pb-10 lg:pb-14">
            <div className="mx-auto w-full max-w-[900px] px-4 pt-4 lg:px-6 lg:pt-8">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h1 className="font-heading text-xl font-bold text-amber-900">
                  {editId ? t("editTitle") : t("newTitle")}
                </h1>
                <p className="mt-2 text-sm text-amber-800">
                  {editId
                    ? "You do not have permission to edit or delete this harvest."
                    : "You do not have permission to create a harvest."}
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-300 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
                  >
                    {tCommon("back")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard-harvesting-skin min-h-screen pb-10 lg:pb-14">
            <div className="mx-auto w-full max-w-[900px] px-4 pt-4 lg:px-6 lg:pt-8">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={goBack}
                    aria-label={tCommon("back")}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                  <h1 className="font-heading text-2xl font-bold text-foreground">
                    {editId ? t("editTitle") : t("newTitle")}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  {canDeleteCurrentHarvest ? (
                    <button
                      type="button"
                      onClick={showDeleteMenu}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted/80"
                      aria-label="More actions"
                    >
                      <MoreVertical className="h-5 w-5" strokeWidth={2.25} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl">
                <div className="">
                <div className=" flex flex-wrap items-start justify-between gap-3">
                  <div>
                   
                  </div>
                </div>

              <form
                onSubmit={handleSubmit}
                noValidate
                className="[&_textarea]:py-2"
                aria-label={editId ? t("editAriaLabel") : t("newAriaLabel")}
              >

                {editId && !editLoaded ? (
                  <p className="text-sm text-muted-foreground">{t("loadingHarvest")}</p>
                ) : null}
                {editId && editLoaded && editLoadError ? (
                  <p
                    role="alert"
                    className="mb-4 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {editLoadError}
                  </p>
                ) : null}
                {bootstrapDone &&
                  !refLoading &&
                  projectOptions.length +
                  productOptions.length +
                  farmOptions.length +
                  farmZones.length ===
                  0 ? (
                  <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t("noReferenceLists")}
                  </p>
                ) : null}

                {activeFieldIssueCount > 0 ? (
                  <div
                    role="alert"
                    className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-sm font-medium text-destructive">
                      {t("validationIssuesSummary", {
                        count: activeFieldIssueCount,
                      })}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                      onClick={() =>
                        focusHarvestFieldByErrorKey(
                          firstHarvestFieldErrorKey(fieldErrors),
                        )
                      }
                    >
                      {t("jumpToFirstIssue")}
                    </button>
                  </div>
                ) : null}

                <div id="harvest-logistics-info" className="space-y-8">
                  <HarvestFormSection
                    title={t("sectionCoreTitle")}
                    hint={t("sectionCoreHint")}
                  >
                    <div
                      id="harvest-basic-info"
                      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                    >
                      {/* <div>
                        <label className={harvestLabelClass} htmlFor="harvest-customer">
                          {t("customer")}
                        </label>
                        <input
                          id="harvest-customer"
                          type="text"
                          value={formData.customerId}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              customerId: e.target.value,
                            })
                          }
                          className={harvestFieldClass}
                          placeholder={t("selectCustomer")}
                          disabled={formDisabled}
                        />
                      </div> */}

                      <div>
                        <label className={harvestLabelClass}>
                          {t("selectProjectLabel")}
                        </label>
                        <MultiSelect
                          options={filteredProjectOptions.map((o) => ({
                            value: o.id,
                            label: o.label,
                          }))}
                          values={formData.project ? [formData.project] : []}
                          onChange={(nextValues) => {
                            const project = nextValues[0] ?? "";
                            const pr = projects.find((x) => {
                              if (!x || typeof x !== "object") return false;
                              const row = x as Record<string, unknown>;
                              return String(row.id ?? "").trim() === project;
                            }) as Record<string, unknown> | undefined;
                            const cid = String(pr?.odoo_customer_id ?? "").trim();
                            setFormData({
                              ...formData,
                              project,
                              customerId: formData.customerId || cid,
                            });
                            setFieldErrors((prev) => ({ ...prev, project: undefined }));
                          }}
                          multi={false}
                          placeholder={refLoading ? t("loadingProjects") : t("selectProject")}
                          className={`${harvestFieldClass} ${fieldErrors.project ? "ring-2 ring-destructive" : ""}`}
                          disabled={formDisabled}
                        />
                        {fieldErrors.project ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {fieldErrors.project}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label className={harvestLabelClass} htmlFor="harvest-farm">
                          {tCommon("farm")}
                        </label>
                        <select
                          id="harvest-farm"
                          value={formData.farm}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              farm: e.target.value,
                              zone: "",
                            });
                            setFieldErrors((prev) => ({
                              ...prev,
                              farm: undefined,
                              zone: undefined,
                            }));
                          }}
                          className={`${harvestFieldClass} ${fieldErrors.farm ? "ring-2 ring-destructive" : ""}`}
                          disabled={formDisabled}
                        >
                          <option value="">
                            {refLoading ? t("loadingFarms") : t("selectFarm")}
                          </option>
                          {farmOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.farm ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {fieldErrors.farm}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label className={harvestLabelClass} htmlFor="harvest-grass">
                          {t("selectGrassLabel")}
                        </label>
                        <select
                          id="harvest-grass"
                          value={formData.grass}
                          onChange={(e) => {
                            const grass = e.target.value;
                            const req =
                              selectedProjectRequirements.find(
                                (r) => r.productId === grass,
                              ) ?? null;
                            const nextUom = req ? defaultUomForRequirement(req) : formData.uom;
                            setFormData((prev) =>
                              applyUomConstraint({ ...prev, grass }, nextUom as "Kg" | "M2"),
                            );
                            setFieldErrors((prev) => ({ ...prev, grass: undefined }));
                          }}
                          className={`${harvestFieldClass} ${fieldErrors.grass ? "ring-2 ring-destructive" : ""}`}
                          disabled={formDisabled}
                        >
                          <option value="">
                            {refLoading ? t("loadingGrassTypes") : t("selectGrassType")}
                          </option>
                          {productOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.grass ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {fieldErrors.grass}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <div className="relative mb-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <label htmlFor="harvest-zone">{tCommon("zone")}</label>
                          <span
                            className="peer inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-input text-[10px] font-semibold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus:border-foreground/30 focus:text-foreground"
                            tabIndex={0}
                            aria-label={zoneFieldHelpText}
                          >
                            ?
                          </span>
                          {formData.actualDate.trim() ? (
                            <span className="text-destructive">*</span>
                          ) : (
                            <span className="text-muted-foreground/60">
                              ({t("zoneOptionalShort")})
                            </span>
                          )}
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-full max-w-[300px] rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] font-normal leading-relaxed text-card-foreground shadow-lg peer-hover:block peer-focus:block"
                          >
                            {zoneFieldHelpText}
                          </span>
                        </div>
                        <select
                          id="harvest-zone"
                          value={formData.zone}
                          onChange={(e) => {
                            setFormData({ ...formData, zone: e.target.value });
                            setFieldErrors((prev) => ({ ...prev, zone: undefined }));
                          }}
                          className={`${harvestFieldClass} ${fieldErrors.zone ? "ring-2 ring-destructive" : ""}`}
                          disabled={formDisabled}
                        >
                          <option value="">
                            {refLoading ? t("loadingZones") : t("selectZone")}
                          </option>
                          {filteredZoneEntries.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.zone ? (
                          <p className="mt-1.5 flex items-center gap-1 text-xs leading-snug text-destructive">
                            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                            {fieldErrors.zone}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </HarvestFormSection>

                  <HarvestFormSection
                    title={t("sectionQuantityTitle")}
                    hint={t("sectionQuantityHint")}
                  >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div
                        id="harvest-harvest-type"
                        className="w-fit shrink-0 space-y-2"
                      >
                        <label className={harvestLabelClass}>{t("harvestType")}</label>
                        <div
                          className={`inline-grid w-auto shrink-0 grid-cols-[auto_auto_auto] gap-2 bg-surface-filter-filled ${
                            fieldErrors.harvestType ? "rounded-md ring-2 ring-destructive" : ""
                          }`}
                        >
                          {(
                            [
                              ["sprig", "Sprig"],
                              ["sod", "Sod"],
                              ["sod_to_sprig", "Sod -> Sprig"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={`harvest-type-${value}`}
                              type="button"
                              onClick={() => {
                                if (formDisabled) return;
                                setFormData((prev) =>
                                  applyHarvestTypeConstraint(
                                    prev,
                                    value as HarvestTypeStorageKey,
                                  ),
                                );
                                setFieldErrors((prev) => ({
                                  ...prev,
                                  harvestType: undefined,
                                  referenceHarvestQuantity: undefined,
                                  harvestedArea: undefined,
                                }));
                              }}
                              className="relative w-max cursor-pointer text-left justify-self-start disabled:cursor-not-allowed"
                              disabled={
                                formDisabled ||
                                !harvestTypeAllowedForUom(
                                  value as HarvestTypeStorageKey,
                                  formData.uom,
                                )
                              }
                              aria-pressed={formData.harvestType === value}
                            >
                              <span
                                className={`flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm transition-colors ${
                                  formData.harvestType === value
                                    ? "border-primary bg-primary/5 text-primary"
                                    : harvestTypeAllowedForUom(
                                          value as HarvestTypeStorageKey,
                                          formData.uom,
                                        )
                                      ? "border-input bg-card text-foreground shadow-sm"
                                      : "border-input bg-muted text-muted-foreground/60 shadow-sm"
                                }`}
                              >
                                {label}
                              </span>
                              {formData.harvestType === value ? (
                                <CheckBadge className="left-1 top-1 h-3 w-3" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                        {fieldErrors.harvestType ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {fieldErrors.harvestType}
                          </p>
                        ) : null}
                      </div>

                      <div className="w-fit shrink-0 space-y-2">
                        <label className={harvestLabelClass}>{t("unit")}</label>
                        <div className="inline-grid w-auto shrink-0 grid-cols-[auto_auto] gap-2 bg-surface-filter-filled">
                          {(["Kg", "M2"] as const).map((u) => (
                            <button
                              key={`harvest-uom-${u}`}
                              type="button"
                              onClick={() => {
                                if (formDisabled) return;
                                setHarvestedAreaManual(false);
                                setFormData((prev) => applyUomConstraint(prev, u));
                                setFieldErrors((prev) => ({
                                  ...prev,
                                  harvestType: undefined,
                                  harvestedArea: undefined,
                                  referenceHarvestQuantity: undefined,
                                }));
                              }}
                              className="relative w-max cursor-pointer text-left justify-self-start disabled:cursor-not-allowed"
                              disabled={formDisabled}
                              aria-pressed={formData.uom === u}
                            >
                              <span
                                className={`flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm transition-colors ${
                                  formData.uom === u
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-input bg-card text-foreground shadow-sm"
                                }`}
                              >
                                {u}
                              </span>
                              {formData.uom === u ? (
                                <CheckBadge className="left-1 top-1 h-3 w-3" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-quantity">
                        {tCommon("quantity")}
                      </label>
                      <input
                        id="harvest-quantity"
                        type="number"
                        min={0}
                        value={formData.quantity}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (nextValue.trim().startsWith("-")) return;
                          setFormData({ ...formData, quantity: nextValue });
                          setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                        }}
                        onBlur={() => {
                          setFormData((prev) => ({
                            ...prev,
                            quantity: normalizeNonNegativeInput(prev.quantity),
                          }));
                        }}
                        className={`${harvestFieldClass} ${fieldErrors.quantity ? "ring-2 ring-destructive" : ""}`}
                        placeholder={t("quantityPlaceholder")}
                        disabled={formDisabled}
                      />
                      {requirementForGrass && remainingAfterEntered !== null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("remainingQuantityFmt", {
                            grass: requirementForGrass.grassName,
                            quantity: new Intl.NumberFormat().format(
                              Math.round(remainingAfterEntered),
                            ),
                            unit: remainingDisplayUnit,
                          })}
                        </p>
                      ) : null}
                      {fieldErrors.quantity ? (
                        <p className="mt-1.5 text-xs leading-snug text-destructive">
                          {fieldErrors.quantity}
                        </p>
                      ) : null}
                    </div>

                    {formData.uom.trim().toLowerCase() === "m2" ? (
                      <div>
                        <label className={harvestLabelClass} htmlFor="harvest-reference-quantity">
                          {t("referenceHarvestQuantity")}{" "}
                          {normalizeHarvestTypeStorageKey(formData.harvestType) ===
                          "sod_to_sprig" ? (
                            <span className="text-destructive">*</span>
                          ) : null}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="harvest-reference-quantity"
                            type="number"
                            min={0}
                            value={formData.referenceHarvestQuantity}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              if (nextValue.trim().startsWith("-")) return;
                              setFormData({
                                ...formData,
                                referenceHarvestQuantity: nextValue,
                              });
                              setFieldErrors((prev) => ({
                                ...prev,
                                referenceHarvestQuantity: undefined,
                              }));
                            }}
                            onBlur={() => {
                              setFormData((prev) => ({
                                ...prev,
                                referenceHarvestQuantity: normalizeNonNegativeInput(
                                  prev.referenceHarvestQuantity,
                                ),
                              }));
                            }}
                            className={`${harvestFieldClass} ${
                              fieldErrors.referenceHarvestQuantity
                                ? "ring-2 ring-destructive"
                                : ""
                            }`}
                            placeholder={t("quantityPlaceholder")}
                            disabled={formDisabled}
                          />
                          <span className="shrink-0 text-sm text-muted-foreground">
                            {t("referenceHarvestUnit")}
                          </span>
                        </div>
                        {fieldErrors.referenceHarvestQuantity ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {fieldErrors.referenceHarvestQuantity}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-harvested-area">
                        {t("harvestedArea")}
                      </label>
                      {formData.uom.trim().toLowerCase() === "m2" ? (
                        <>
                          <input
                            id="harvest-harvested-area"
                            type="number"
                            min={0}
                            value={formData.harvestedArea}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              if (nextValue.trim().startsWith("-")) return;
                              setFormData({
                                ...formData,
                                harvestedArea: nextValue,
                              });
                              setFieldErrors((prev) => ({
                                ...prev,
                                harvestedArea: undefined,
                              }));
                            }}
                            onBlur={() => {
                              setFormData((prev) => ({
                                ...prev,
                                harvestedArea: normalizeNonNegativeInput(prev.harvestedArea),
                              }));
                            }}
                            className={`${harvestFieldClass} ${
                              fieldErrors.harvestedArea ? "ring-2 ring-destructive" : ""
                            }`}
                            placeholder={t("harvestedArea")}
                            disabled={formDisabled}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("harvestedAreaHintM2")}
                          </p>
                          {fieldErrors.harvestedArea ? (
                            <p className="mt-1.5 text-xs leading-snug text-destructive">
                              {fieldErrors.harvestedArea}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <input
                            id="harvest-harvested-area"
                            type="number"
                            min={0}
                            value={formData.harvestedArea}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              if (nextValue.trim().startsWith("-")) return;
                              setHarvestedAreaManual(true);
                              setFormData({
                                ...formData,
                                harvestedArea: nextValue,
                              });
                              setFieldErrors((prev) => ({
                                ...prev,
                                harvestedArea: undefined,
                              }));
                            }}
                            onBlur={() => {
                              setFormData((prev) => ({
                                ...prev,
                                harvestedArea: normalizeNonNegativeInput(prev.harvestedArea),
                              }));
                            }}
                            className={`${harvestFieldClass} ${fieldErrors.harvestedArea ? "ring-2 ring-destructive" : ""}`}
                            placeholder={t("harvestedAreaPlaceholderKg")}
                            disabled={formDisabled}
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {autoHarvestAreaInfo && !harvestedAreaManual
                              ? `Auto: quantity / ${autoHarvestAreaInfo.inventoryKgPerM2.toFixed(3)} kg/m²${
                                  autoHarvestAreaInfo.confidencePct
                                    ? `, confidence ${autoHarvestAreaInfo.confidencePct.toFixed(0)}%`
                                    : ""
                                }`
                              : t("harvestedAreaHintKg")}
                          </p>
                          {fieldErrors.harvestedArea ? (
                            <p className="mt-1.5 text-xs leading-snug text-destructive">
                              {fieldErrors.harvestedArea}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  </HarvestFormSection>

                  <HarvestFormSection
                    title={t("sectionTimelineTitle")}
                    hint={t("sectionTimelineHint")}
                  >
                  <div className="flex flex-col gap-6">
                    <div
                      id="harvest-estimated-date"
                      className="rounded-lg border border-border/60 bg-muted/30 p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t("estimatedDate")}
                        </span>
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={useEstimatedDateRange}
                            onChange={(e) => {
                              setUseEstimatedDateRange(e.target.checked);
                              if (!e.target.checked) {
                                setFormData((prev) => ({ ...prev, estimatedDateEnd: "" }));
                              }
                            }}
                            disabled={formDisabled}
                          />
                          {t("useDateRange")}
                        </label>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="min-w-0 flex-1">
                          <DatePicker
                            value={formData.estimatedDate}
                            onChange={(value) => {
                              setFormData({
                                ...formData,
                                estimatedDate: value,
                              });
                              setFieldErrors((prev) => ({
                                ...prev,
                                estimatedDate: undefined,
                              }));
                            }}
                            onBlur={() => setHarvestDateTouched(true)}
                            disabled={formDisabled}
                            hasError={Boolean(
                              fieldErrors.estimatedDate || harvestDatePairError,
                            )}
                          />
                          {useEstimatedDateRange ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("estimatedRangeStartHint")}
                            </p>
                          ) : null}
                          {fieldErrors.estimatedDate ? (
                            <p className="mt-1.5 text-xs leading-snug text-destructive">
                              {fieldErrors.estimatedDate}
                            </p>
                          ) : null}
                        </div>
                        {useEstimatedDateRange ? (
                          <div className="min-w-0 flex-1">
                            <DatePicker
                              value={formData.estimatedDateEnd}
                              onChange={(value) =>
                                setFormData({ ...formData, estimatedDateEnd: value })
                              }
                              disabled={formDisabled}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("estimatedRangeEndHint")}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div id="harvest-actual-date">
                        <label className={harvestLabelClass}>
                          {t("actualDateHarvestForm")}
                        </label>
                        <DatePicker
                          value={formData.actualDate}
                          onChange={(value) => {
                            setFormData({ ...formData, actualDate: value });
                            setFieldErrors((prev) => ({
                              ...prev,
                              actualDate: undefined,
                            }));
                          }}
                          onBlur={() => setHarvestDateTouched(true)}
                          disabled={formDisabled}
                          hasError={Boolean(fieldErrors.actualDate || harvestDatePairError)}
                        />
                        {harvestDatePairError ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
                            {harvestDatePairError}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("datePairHint")}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className={harvestLabelClass}>{t("harvestEndDate")}</label>
                        <DatePicker
                          value={formData.actualHarvestEndDate}
                          onChange={(value) =>
                            setFormData({ ...formData, actualHarvestEndDate: value })
                          }
                          disabled={formDisabled}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("harvestEndDateHint")}
                        </p>
                      </div>
                      <div>
                        <label className={harvestLabelClass}>{t("portArrivalDate")}</label>
                        <DatePicker
                          value={formData.portArrivalDate}
                          onChange={(value) =>
                            setFormData({ ...formData, portArrivalDate: value })
                          }
                          disabled={formDisabled}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("portArrivalDateHint")}
                        </p>
                      </div>
                      <div>
                        <label className={harvestLabelClass}>{t("deliveryDate")}</label>
                        <DatePicker
                          value={formData.deliveryDate}
                          onChange={(value) =>
                            setFormData({
                              ...formData,
                              deliveryDate: value,
                            })
                          }
                          disabled={formDisabled}
                        />
                      </div>
                    </div>
                  </div>
                  </HarvestFormSection>

                  <HarvestFormSection
                    title={t("sectionLogisticsTitle")}
                    hint={t("sectionLogisticsHint")}
                  >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className={harvestLabelClass} htmlFor="harvest-doso-num">
                          {t("doSoNumber")}
                        </label>
                        <input
                          id="harvest-doso-num"
                          type="text"
                          value={formData.doSoNumber}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              doSoNumber: e.target.value,
                            })
                          }
                          className={harvestFieldClass}
                          placeholder={t("doSoPlaceholder")}
                          disabled={formDisabled}
                        />
                      </div>
                      <div id="harvest-doso-date">
                        <label className={harvestLabelClass}>{t("doSoDate")}</label>
                        <DatePicker
                          value={formData.doSoDate}
                          onChange={(value) =>
                            setFormData({
                              ...formData,
                              doSoDate: value,
                            })
                          }
                          disabled={formDisabled}
                        />
                      </div>
                    </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-license">
                        {t("licensePlate")}
                      </label>
                      <input
                        id="harvest-license"
                        type="text"
                        value={formData.licensePlate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            licensePlate: e.target.value,
                          })
                        }
                        className={harvestFieldClass}
                        placeholder={t("licensePlatePlaceholder")}
                        disabled={formDisabled}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-general-note">
                        {t("generalNote")}{" "}
                        <span className="font-normal text-muted-foreground/70">
                          ({t("generalNoteHint")})
                        </span>
                      </label>
                      <textarea
                        id="harvest-general-note"
                        value={formData.generalNote}
                        onChange={(e) =>
                          setFormData({ ...formData, generalNote: e.target.value })
                        }
                        rows={2}
                        className={`${harvestFieldClass} resize-none`}
                        placeholder={t("generalNotePlaceholder")}
                        disabled={formDisabled}
                      />
                    </div>
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-truck-note">
                        {t("truckNote")}
                      </label>
                      <textarea
                        id="harvest-truck-note"
                        value={formData.truckNote}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            truckNote: e.target.value,
                          })
                        }
                        className={`${harvestFieldClass} resize-none`}
                        rows={2}
                        placeholder={t("truckNotePlaceholder")}
                        disabled={formDisabled}
                      />
                    </div>
                    <div>
                      <label className={harvestLabelClass} htmlFor="harvest-shipping">
                        {t("shippingDispatchDetails")}
                      </label>
                      <textarea
                        id="harvest-shipping"
                        value={formData.shippingDispatchDetails}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            shippingDispatchDetails: e.target.value,
                          })
                        }
                        rows={3}
                        className={`${harvestFieldClass} resize-none`}
                        placeholder={t("shippingDispatchPlaceholder")}
                        disabled={formDisabled}
                      />
                    </div>
                  </div>
                  </HarvestFormSection>

                  <HarvestFormSection
                    title={t("documentationPhotos")}
                    hint={t("sectionPhotosHint")}
                  >
                    {/* <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("photosHelpText")}
                    </p> */}
                    <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                      {DOC_PHOTO_SLOTS.map((field) => {
                        const label = getPhotoSlotLabel(field);
                        const blobSrc = filePreviewUrls[field];
                        const existing = existingDocSlots[field];
                        const removedPending =
                          Boolean(pendingImagesRemoved[field]?.length) ||
                          Boolean(pendingFilesRemoved[field]?.length);
                        const hasServerImage = Boolean(
                          existing?.previewUrl?.trim() ||
                          existing?.imageFileNames?.length,
                        );
                        const hasServerDocOnly =
                          !existing?.previewUrl &&
                          (existing?.documentFileNames.length ?? 0) > 0;
                        const showRemote =
                          (hasServerImage || hasServerDocOnly) &&
                          !removedPending &&
                          !blobSrc;
                        /** Same rules as `stsUrls.resolveHarvestDisplayUrl` (`/files/timeline_files/harvesting`). */
                        const serverImageCandidate =
                          existing?.previewUrl?.trim() ||
                          existing?.imageFileNames[0] ||
                          "";
                        const remoteDisplayUrl =
                          hasServerImage &&
                            showRemote &&
                            serverImageCandidate
                            ? resolveHarvestDisplayUrl(serverImageCandidate)
                            : null;
                        const previewSrc = blobSrc ?? remoteDisplayUrl;
                        const showDocOnlyPlaceholder = Boolean(
                          showRemote && hasServerDocOnly,
                        );

                        return (
                          <div key={field} className="relative">
                            <input
                              id={`harvest-photo-${field}`}
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              disabled={formDisabled}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                setPhoto(field, f);
                                e.target.value = "";
                              }}
                            />
                            <label
                              htmlFor={`harvest-photo-${field}`}
                              className={`relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-muted transition-colors hover:bg-muted/80 xl:aspect-square ${formDisabled ? "pointer-events-none opacity-50" : ""}`}
                            >
                              {previewSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element -- dynamic STS / blob URLs
                                <img
                                  src={previewSrc}
                                  alt=""
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              ) : showDocOnlyPlaceholder ? (
                                <div className="z-[1] flex flex-col items-center justify-center gap-1 p-1 text-center">
                                  <span className="text-[10px] font-medium text-foreground">
                                    {t("fileLabel")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{label}</span>
                                </div>
                              ) : (
                                <div className="z-[1] flex flex-col items-center justify-center gap-1 p-1 text-center">
                                  <Camera className="h-6 w-6 shrink-0 text-muted-foreground" />
                                  <span className="text-[11px] text-muted-foreground">{label}</span>
                                </div>
                              )}
                              {photos[field] ? (
                                <span className="absolute bottom-0 left-0 right-0 z-[1] truncate bg-black/55 px-0.5 py-0.5 text-center text-[9px] text-white pointer-events-none">
                                  {photos[field]?.name}
                                </span>
                              ) : null}
                            </label>
                            {previewSrc ||
                              photos[field] ||
                              showDocOnlyPlaceholder ? (
                              <button
                                type="button"
                                className="absolute -top-1 -right-1 z-[2] w-5 h-5 rounded-full bg-gray-800 text-white text-xs leading-5"
                                aria-label={t("removePhotoAria", { label })}
                                onClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  if (photos[field]) {
                                    setPhoto(field, undefined);
                                  } else if (showRemote) {
                                    markExistingDocRemoved(field);
                                  }
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </HarvestFormSection>
                </div>

                <div className="sticky bottom-0 z-30 mt-10 flex flex-col gap-3 border-t border-border bg-background/95 py-4 backdrop-blur supports-[padding:env(safe-area-inset-bottom)]:pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-h-5 flex-1 text-xs text-muted-foreground sm:order-1">
                    {submitError ? (
                      <span className="text-destructive" role="alert">
                        {submitError}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:order-2 sm:w-auto sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={goBack}
                      disabled={submitLoading || deleting}
                      className="inline-flex h-11 min-w-[120px] items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {tCommon("back")}
                    </button>
                    {canSubmitHarvest ? (
                      <button
                        type="submit"
                        disabled={formDisabled}
                        className="inline-flex h-11 min-w-[140px] flex-1 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 sm:flex-none"
                      >
                        {submitLoading
                          ? t("saving")
                          : editId
                            ? t("saveChanges")
                            : t("saveHarvest")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </form>
                </div>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>

      {canDeleteCurrentHarvest && deleteMenuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-60 bg-black/40"
            aria-label="Close actions menu"
            onClick={closeDeleteMenu}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-61 mx-auto max-w-md rounded-t-2xl border border-gray-200 bg-white shadow-lg"
            role="dialog"
            aria-label="Actions"
          >
            <div className="py-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50"
                onClick={onPickDeleteFromSheet}
              >
                <Trash2 className="h-5 w-5 shrink-0" />
                <span className="font-medium">{tCommon("delete")}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-gray-800 hover:bg-gray-50"
                onClick={closeDeleteMenu}
              >
                <span className="pl-8 font-medium">{tCommon("cancel")}</span>
              </button>
            </div>
          </div>
        </>
      ) : null}

      {canDeleteCurrentHarvest && confirmDeleteOpen ? (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!deleting) setConfirmDeleteOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-harvest-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-harvest-title" className="text-lg font-semibold text-gray-900">
              {t("deleteHarvestTitle")}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {t("deleteHarvestMessage")}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
                onClick={() => void onConfirmDeleteHarvest()}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : tCommon("delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </RequireAuth>
  );
}

export default function HarvestInputPage() {
  const tBase = useAppTranslations();
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-600">
          {tBase("Common.loading")}
        </div>
      }
    >
      <HarvestInputPageInner />
    </Suspense>
  );
}
