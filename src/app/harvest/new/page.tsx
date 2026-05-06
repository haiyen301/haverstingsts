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
import { AlertCircle, ArrowLeft, Camera, Check, MoreVertical, Trash2 } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
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
  filterZoneEntriesByFarmName,
  mapRowsToSelectOptions,
  parseFarmZoneEntries,
} from "@/shared/lib/harvestReferenceData";
import { resolveHarvestDisplayUrl } from "@/shared/config/stsUrls";
import { DatePicker } from "@/shared/ui/date-picker";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { deleteMondayParentOrSubItem } from "@/entities/projects/api/projectsApi";
import { effectiveRequiredQuantityForFormUom } from "@/features/project/lib/effectiveRequirementQuantity";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

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

const SHIPPING_NOTE_SPLIT = "\n\n--- Shipping / dispatch ---\n\n";

const emptyForm = {
  /** Matches `customer_id` on plan row when available from projects (`odoo_customer_id`). */
  customerId: "",
  grass: "",
  harvestType: "Sprig",
  quantity: "",
  uom: "M2",
  referenceHarvestQuantity: "",
  /** `harvested_area` — Kg: nhập thủ công; M2: có thể đồng bộ với quantity ở UI, không gửi vào cột này từ Ref. Harvest Qty. */
  harvestedArea: "",
  zone: "",
  farm: "",
  project: "",
  estimatedDate: "",
  /** Stored inside `description` with structured prefix when API has no dedicated column. */
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

function normalizeHarvestTypeForForm(loadType: unknown): string {
  const raw = String(loadType ?? "").trim();
  const t = raw.toUpperCase();
  if (t === "SOD" || raw === "Sod") return "Sod";
  if (t === "SPRIG" || raw === "Sprig") return "Sprig";
  if (
    t === "SOD_FOR_SPRIG" ||
    /sod\s*for\s*sprig/i.test(raw) ||
    /sod.*sprig/i.test(raw)
  ) {
    return "Sod for Sprig";
  }
  return "";
}

function harvestTypeToApi(loadType: string): string {
  const s = loadType.trim();
  if (s === "Sod for Sprig") return "Sod for Sprig";
  return s;
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
  const uomStr = String(r.uom ?? "M2").trim() || "M2";
  const harvested = r.harvested_area;
  const referenceHarvestQty = r.ref_hrv_qty_sprig;
  const harvestedStr = normalizeNonNegativeInput(String(harvested ?? ""));
  const referenceHarvestQtyStr = normalizeNonNegativeInput(
    String(referenceHarvestQty ?? ""),
  );
  const isKg = uomStr.toLowerCase() === "kg";
  const descParsed = parseDescriptionFromRow(String(r.description ?? ""));
  const { truckNote, shippingDispatchDetails } = splitTruckNoteFromRow(
    String(r.truck_note ?? ""),
  );
  const ht = normalizeHarvestTypeForForm(r.load_type);
  return {
    customerId: String(r.customer_id ?? "").trim(),
    project: String(r.project_id ?? ""),
    grass: String(r.product_id ?? ""),
    farm: String(r.farm_id ?? ""),
    zone: String(r.zone ?? ""),
    quantity: String(r.quantity ?? ""),
    uom: uomStr,
    referenceHarvestQuantity: !isKg
      ? (referenceHarvestQtyStr || harvestedStr)
      : "",
    harvestedArea: isKg ? harvestedStr : "",
    harvestType: ht || "Sprig",
    estimatedDate: toDateInput(r.estimated_harvest_date),
    estimatedDateEnd: descParsed.estimatedDateEnd,
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
  harvestedAreaKgRequired: string;
  selectZone: string;
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
  // Harvest type input is currently hidden in the web form, so do not block submit here.
  if (!formData.quantity.trim() || parseNum(formData.quantity) <= 0) {
    errors.quantity = messages.enterQuantity;
  }
  // if (
  //   formData.uom.trim().toLowerCase() === "m2" &&
  //   (!formData.referenceHarvestQuantity.trim() ||
  //     parseNum(formData.referenceHarvestQuantity) <= 0)
  // ) {
  //   errors.referenceHarvestQuantity = messages.enterQuantity;
  // }
  const uomLower = formData.uom.trim().toLowerCase();
  const hasActual = Boolean(formData.actualDate.trim());
  if (hasActual && !formData.zone.trim()) errors.zone = messages.selectZone;
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

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const projectOptions = useMemo(
    () => mapRowsToSelectOptions(projects as unknown[], "title"),
    [projects],
  );
  const productOptions = useMemo(
    () => mapRowsToSelectOptions(products as unknown[], "title"),
    [products],
  );
  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const zoneEntries = useMemo(
    () => parseFarmZoneEntries(farmZones),
    [farmZones],
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
  /** Mirrors HarvestForm “Use date range” for estimated window end (persisted via `description`). */
  const [useEstimatedDateRange, setUseEstimatedDateRange] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const filteredZoneEntries = useMemo(() => {
    const farmLabel = farmOptions.find((f) => f.id === formData.farm)?.label ?? "";
    return filterZoneEntriesByFarmName(zoneEntries, farmLabel);
  }, [farmOptions, formData.farm, zoneEntries]);

  const filteredProjectOptions = useMemo(() => {
    const cid = formData.customerId.trim();
    if (!cid) return projectOptions;
    return projectOptions.filter((o) => {
      const pr = projects.find((x) => {
        if (!x || typeof x !== "object") return false;
        const row = x as Record<string, unknown>;
        return String(row.id ?? "").trim() === o.id;
      }) as Record<string, unknown> | undefined;
      if (!pr) return false;
      return String(pr.odoo_customer_id ?? "").trim() === cid;
    });
  }, [formData.customerId, projectOptions, projects]);

  const validationMessages: HarvestValidationMessages = {
    selectProject: t("validationSelectProject"),
    selectGrass: t("validationSelectGrassType"),
    selectHarvestType: t("validationSelectHarvestType"),
    enterQuantity: t("validationEnterQuantity"),
    harvestedAreaKgRequired: t("validationHarvestedAreaKg"),
    selectZone: t("validationSelectZone"),
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
    if (!editId) {
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
        if (!raw || typeof raw !== "object") throw new Error(t("harvestNotFound"));
        if (cancelled) return;
        const row = raw as Record<string, unknown>;
        setFormData(applyRowToFormState(row));
        setUseEstimatedDateRange(
          parseDescriptionFromRow(String(row.description ?? ""))
            .useEstimatedDateRange,
        );
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
  }, [editId, initialProjectId]);

  const showDeleteMenu = () => setDeleteMenuOpen(true);

  const closeDeleteMenu = () => setDeleteMenuOpen(false);

  const onPickDeleteFromSheet = () => {
    closeDeleteMenu();
    setConfirmDeleteOpen(true);
  };

  const onConfirmDeleteHarvest = async () => {
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
      router.push(returnTarget);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Delete harvest failed.");
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
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
  }, [formData.project]);

  useEffect(() => {
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
  }, [formData.project]);

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

  const harvestDatePairError =
    fieldErrors.actualDate ?? fieldErrors.estimatedDate ?? null;

  useEffect(() => {
    if (!formData.zone) return;
    const isValid = filteredZoneEntries.some(([key]) => key === formData.zone);
    if (!isValid) {
      setFormData((prev) => ({ ...prev, zone: "" }));
    }
  }, [filteredZoneEntries, formData.zone]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      await submitFlutterHarvest(
        {
          id: editId ?? undefined,
          projectId: formData.project,
          productId: formData.grass,
          farmId: formData.farm,
          zone: formData.zone,
          quantity: formData.quantity,
          uom: formData.uom,
          harvestType: harvestTypeToApi(formData.harvestType || "Sprig"),
          estimatedHarvestDate: formData.estimatedDate,
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
      );
      updateHarvestLimitDescriptionsForSelection(formData.project);
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
    refLoading || submitLoading || deleting || (Boolean(editId) && !editLoaded);

  const zoneRequiredButMissing =
    Boolean(formData.actualDate.trim()) && !formData.zone.trim();

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
        <div className="dashboard-harvesting-skin min-h-screen pb-10 lg:pb-14">
          <div className="mx-auto w-full max-w-[900px] px-4 pt-4 lg:px-6 lg:pt-8">
            <div className="mb-5 flex flex-wrap items-start gap-3">
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
              <div className="flex items-center gap-2">
                {editId ? (
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
                {bootstrapDone &&
                  !refLoading &&
                  projectOptions.length +
                  productOptions.length +
                  farmOptions.length +
                  zoneEntries.length ===
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
                      <div>
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
                      </div>

                      <div>
                        <label className={harvestLabelClass} htmlFor="harvest-project">
                          {t("selectProjectLabel")}
                        </label>
                        <select
                          id="harvest-project"
                          value={formData.project}
                          onChange={(e) => {
                            const project = e.target.value;
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
                          className={`${harvestFieldClass} ${fieldErrors.project ? "ring-2 ring-destructive" : ""}`}
                          disabled={formDisabled}
                        >
                          <option value="">
                            {refLoading ? t("loadingProjects") : t("selectProject")}
                          </option>
                          {filteredProjectOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
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
                            setFormData({ ...formData, grass, uom: nextUom });
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
                        <label className={harvestLabelClass} htmlFor="harvest-zone">
                          {tCommon("zone")}{" "}
                          {formData.actualDate.trim() ? (
                            <span className="text-destructive">*</span>
                          ) : (
                            <span className="text-muted-foreground/60">
                              ({t("zoneOptionalShort")})
                            </span>
                          )}
                        </label>
                        <select
                          id="harvest-zone"
                          value={formData.zone}
                          onChange={(e) => {
                            setFormData({ ...formData, zone: e.target.value });
                            setFieldErrors((prev) => ({ ...prev, zone: undefined }));
                          }}
                          className={`${harvestFieldClass} ${fieldErrors.zone || zoneRequiredButMissing ? "ring-2 ring-destructive" : ""}`}
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
                        {zoneRequiredButMissing ? (
                          <p className="mt-1.5 flex items-center gap-1 text-xs leading-snug text-destructive">
                            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                            {t("zoneRequiredWhenActual")}
                          </p>
                        ) : null}
                        {fieldErrors.zone ? (
                          <p className="mt-1.5 text-xs leading-snug text-destructive">
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
                      <div className="w-fit shrink-0 space-y-2">
                        <label className={harvestLabelClass}>{t("unit")}</label>
                        <div className="inline-grid w-auto shrink-0 grid-cols-[auto_auto] gap-2 bg-surface-filter-filled">
                          {(["Kg", "M2"] as const).map((u) => (
                            <button
                              key={`harvest-uom-${u}`}
                              type="button"
                              onClick={() => {
                                if (formDisabled) return;
                                setFormData((prev) => ({
                                  ...prev,
                                  quantity: prev.quantity,
                                  uom: u,
                                  referenceHarvestQuantity:
                                    u.trim().toLowerCase() === "m2"
                                      ? prev.referenceHarvestQuantity
                                      : "",
                                  harvestedArea:
                                    u.trim().toLowerCase() === "m2"
                                      ? ""
                                      : prev.harvestedArea,
                                }));
                                setFieldErrors((prev) => ({
                                  ...prev,
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
                                <span className="absolute left-1 top-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                  <Check className="h-3 w-3" />
                                </span>
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
                          {t("referenceHarvestQuantity")}
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
                            className={harvestFieldClass}
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
                            type="text"
                            readOnly
                            value={formData.quantity}
                            className={`${harvestFieldClass} cursor-not-allowed opacity-80`}
                            placeholder={t("harvestedArea")}
                            disabled={formDisabled}
                            aria-readonly="true"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("harvestedAreaHintM2")}
                          </p>
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
                            {t("harvestedAreaHintKg")}
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
                          <input
                            type="checkbox"
                            checked={useEstimatedDateRange}
                            onChange={(e) => {
                              setUseEstimatedDateRange(e.target.checked);
                              if (!e.target.checked) {
                                setFormData((prev) => ({ ...prev, estimatedDateEnd: "" }));
                              }
                            }}
                            className="rounded border-border"
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
                              zone: value.trim() ? prev.zone : undefined,
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
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("photosHelpText")}
                    </p>
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
                  </div>
                </div>
              </form>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>

      {deleteMenuOpen ? (
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

      {confirmDeleteOpen ? (
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
              Delete harvest?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete this harvest record?
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
