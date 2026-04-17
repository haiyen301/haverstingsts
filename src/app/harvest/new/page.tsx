"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, MoreVertical, Trash2 } from "lucide-react";

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
import { ACCUWEATHER_ASIA_BROWSE_LINKS } from "@/data/accuweatherAsiaBrowseLinks";

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

const emptyForm = {
  grass: "",
  harvestType: "",
  quantity: "",
  uom: "M2",
  referenceHarvestQuantity: "",
  /** Flutter `harvestedAreaController` → `harvested_area`. Editable when UOM is Kg; M2 mirrors quantity. */
  harvestedArea: "",
  zone: "",
  farm: "",
  project: "",
  estimatedDate: "",
  actualDate: "",
  deliveryDate: "",
  doSoNumber: "",
  truckNote: "",
  licensePlate: "",
};

function toDateInput(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  const s = v.trim();
  if (s.startsWith("0000")) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function normalizeHarvestTypeForForm(loadType: unknown): string {
  const t = String(loadType ?? "").trim();
  if (t === "Sod" || t === "Sprig") return t;
  return "";
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

function applyRowToFormState(r: Record<string, unknown>) {
  const uomStr = String(r.uom ?? "M2").trim() || "M2";
  const harvested = r.harvested_area;
  const referenceHarvestQty = r.ref_hrv_qty_sprig;
  const harvestedStr = normalizeNonNegativeInput(String(harvested ?? ""));
  const referenceHarvestQtyStr = normalizeNonNegativeInput(
    String(referenceHarvestQty ?? ""),
  );
  const isKg = uomStr.toLowerCase() === "kg";
  return {
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
    harvestType: normalizeHarvestTypeForForm(r.load_type),
    estimatedDate: toDateInput(r.estimated_harvest_date),
    actualDate: toDateInput(r.actual_harvest_date),
    deliveryDate: toDateInput(r.delivery_harvest_date),
    doSoNumber: String(r.do_so_number ?? ""),
    truckNote: String(r.truck_note ?? ""),
    licensePlate: String(r.license_plate ?? ""),
  };
}

type HarvestFormState = typeof emptyForm;

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
  if (!formData.zone.trim()) errors.zone = messages.selectZone;
  if (!formData.farm.trim()) errors.farm = messages.selectFarm;
  const uomLower = formData.uom.trim().toLowerCase();
  const hasActual = Boolean(formData.actualDate.trim());
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
  const [quantityWarning, setQuantityWarning] = useState<string | null>(null);
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
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const filteredZoneEntries = useMemo(() => {
    const farmLabel = farmOptions.find((f) => f.id === formData.farm)?.label ?? "";
    return filterZoneEntriesByFarmName(zoneEntries, farmLabel);
  }, [farmOptions, formData.farm, zoneEntries]);
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
      setSubmitError(firstErr);
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
      const fieldId = firstErrKey ? fieldIdMap[firstErrKey] : null;
      if (fieldId && typeof window !== "undefined") {
        const element = document.getElementById(fieldId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          const focusTarget =
            element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement
              ? element
              : (element.querySelector(
                "input, select, textarea, button, [tabindex]",
              ) as HTMLElement | null);
          if (focusTarget && "focus" in focusTarget) {
            focusTarget.focus();
          }
        }
      }
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
      const isM2 = mainUom === "m2";
      const referenceQtyStripped = formData.referenceHarvestQuantity
        .replace(/,/g, "")
        .trim();
      const haStripped = formData.harvestedArea.replace(/,/g, "").trim();
      const harvestedAreaPayload = isM2
        ? referenceQtyStripped || undefined
        : haStripped || undefined;
      await submitFlutterHarvest(
        {
          id: editId ?? undefined,
          projectId: formData.project,
          productId: formData.grass,
          farmId: formData.farm,
          zone: formData.zone,
          quantity: formData.quantity,
          uom: formData.uom,
          harvestType: formData.harvestType,
          estimatedHarvestDate: formData.estimatedDate,
          actualHarvestDate: formData.actualDate,
          deliveryHarvestDate: formData.deliveryDate,
          doSoNumber: formData.doSoNumber,
          truckNote: formData.truckNote,
          licensePlate: formData.licensePlate,
          assignedTo: user?.id != null ? String(user.id) : "",
          harvestedArea: harvestedAreaPayload,
          refHrvQtySprig: referenceQtyStripped || undefined,
        },
        photos,
        removedPayload,
      );
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

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="min-h-screen bg-gray-50 pb-10 lg:pb-14">
          <div className="w-full px-4 pt-4 lg:px-8 lg:pt-8">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <button
                onClick={goBack}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                type="button"
                aria-label="Back"
              >
                <svg width="20" height="20" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 6L2.29289 6.70711L1.58579 6L2.29289 5.29289L3 6ZM6.75 15.25C6.19772 15.25 5.75 14.8023 5.75 14.25C5.75 13.6977 6.19772 13.25 6.75 13.25L6.75 14.25L6.75 15.25ZM6.75 9.75L6.04289 10.4571L2.29289 6.70711L3 6L3.70711 5.29289L7.45711 9.04289L6.75 9.75ZM3 6L2.29289 5.29289L6.04289 1.54289L6.75 2.25L7.45711 2.95711L3.70711 6.70711L3 6ZM3 6L3 5L10.875 5L10.875 6L10.875 7L3 7L3 6ZM10.875 14.25L10.875 15.25L6.75 15.25L6.75 14.25L6.75 13.25L10.875 13.25L10.875 14.25ZM15 10.125L16 10.125C16 12.9555 13.7055 15.25 10.875 15.25L10.875 14.25L10.875 13.25C12.6009 13.25 14 11.8509 14 10.125L15 10.125ZM10.875 6L10.875 5C13.7055 5 16 7.29454 16 10.125L15 10.125L14 10.125C14 8.39911 12.6009 7 10.875 7L10.875 6Z" fill="#374151" />
                </svg>
                <span>Back</span>
              </button>
              <div className="flex items-center gap-2">
                {editId ? (
                  <button
                    type="button"
                    onClick={showDeleteMenu}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    aria-label="More actions"
                  >
                    <MoreVertical className="h-5 w-5" strokeWidth={2.25} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">
                {editId ? t("editTitle") : t("newTitle")}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {t("selectProjectLabel")} • {t("selectGrassLabel")} • {t("documentationPhotos")}
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 lg:px-5">
                <p className="text-sm font-semibold text-gray-800">
                  AccuWeather - Châu Á
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Liên kết tĩnh (API AccuWeather đã chuyển vào{" "}
                  <code className="rounded bg-gray-100 px-1">backup/app-api-accuweather</code>).
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {ACCUWEATHER_ASIA_BROWSE_LINKS.map((item) => (
                    <a
                      key={`${item.name}-${item.href}`}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[#1F7A4C] underline-offset-2 hover:underline"
                    >
                      {item.name}
                    </a>
                  ))}
                </div>
              </div>
              <form
                onSubmit={handleSubmit}
                noValidate
                className="mx-auto max-w-6xl p-4 lg:p-5 [&_input]:py-1.5 [&_select]:py-1.5 [&_textarea]:py-1.5"
                aria-label={editId ? t("editAriaLabel") : t("newAriaLabel")}
              >

                {editId && !editLoaded ? (
                  <p className="text-sm text-gray-600">{t("loadingHarvest")}</p>
                ) : null}
                {bootstrapDone &&
                  !refLoading &&
                  projectOptions.length +
                  productOptions.length +
                  farmOptions.length +
                  zoneEntries.length ===
                  0 ? (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {t("noReferenceLists")}
                  </p>
                ) : null}

                <div id="harvest-logistics-info" className="">
                  <div id="harvest-basic-info" className="grid gap-3 lg:grid-cols-3 pb-0 min-[992px]:pb-9">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("selectProjectLabel")}
                      </label>
                      <select
                        id="harvest-project"
                        value={formData.project}
                        onChange={(e) => {
                          setFormData({ ...formData, project: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, project: undefined }));
                        }}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${fieldErrors.project ? "border-red-500" : "border-gray-300"
                          }`}
                        disabled={formDisabled}
                      >
                        <option value="">
                          {refLoading ? t("loadingProjects") : t("selectProject")}
                        </option>
                        {projectOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.project ? (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.project}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${fieldErrors.grass ? "border-red-500" : "border-gray-300"
                          }`}
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
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.grass}</p>
                      ) : null}
                    </div>

                    <div id="harvest-docs-info">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("unit")}
                      </label>
                      <select
                        value={formData.uom}
                        onChange={(e) => {
                          const uom = e.target.value;
                          setFormData((prev) => ({
                            ...prev,
                            quantity: prev.quantity,
                            uom,
                            referenceHarvestQuantity:
                              uom.trim().toLowerCase() === "m2"
                                ? prev.referenceHarvestQuantity
                                : "",
                            harvestedArea:
                              uom.trim().toLowerCase() === "m2" ? "" : prev.harvestedArea,
                          }));
                          setFieldErrors((prev) => ({
                            ...prev,
                            harvestedArea: undefined,
                            referenceHarvestQuantity: undefined,
                          }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100"
                        disabled={formDisabled}
                      >
                        <option value="M2">M2</option>
                        <option value="Kg">Kg</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3 pb-0 min-[992px]:pb-9">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                          const entered = parseNum(nextValue);
                          if (
                            maxAllowedQuantity !== null &&
                            entered > 0 &&
                            entered > maxAllowedQuantity
                          ) {
                            setQuantityWarning(
                              t("quantityAdjustedWarning"),
                            );
                            setFormData({
                              ...formData,
                              quantity: String(Math.round(maxAllowedQuantity)),
                            });
                            setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                            return;
                          }
                          setQuantityWarning(null);
                          setFormData({ ...formData, quantity: nextValue });
                          setFieldErrors((prev) => ({ ...prev, quantity: undefined }));
                        }}
                        onBlur={() => {
                          setFormData((prev) => ({
                            ...prev,
                            quantity: normalizeNonNegativeInput(prev.quantity),
                          }));
                        }}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100 ${fieldErrors.quantity ? "border-red-500" : "border-gray-300"
                          }`}
                        placeholder={t("quantityPlaceholder")}
                        disabled={formDisabled}
                      />
                      {requirementForGrass && remainingAfterEntered !== null ? (
                        <p className="mt-1 text-xs text-[#7A7A7A]">
                          {t("remainingQuantityFmt", {
                            grass: requirementForGrass.grassName,
                            quantity: new Intl.NumberFormat().format(
                              Math.round(remainingAfterEntered),
                            ),
                            unit: remainingDisplayUnit,
                          })}
                        </p>
                      ) : null}
                      {quantityWarning ? (
                        <p className="mt-1 text-xs text-red-600">{quantityWarning}</p>
                      ) : null}
                      {fieldErrors.quantity ? (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.quantity}</p>
                      ) : null}
                    </div>

                    {formData.uom.trim().toLowerCase() === "m2" ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100"
                            placeholder={t("quantityPlaceholder")}
                            disabled={formDisabled}
                          />
                          <span className="text-sm text-gray-600">{t("referenceHarvestUnit")}</span>
                        </div>
                        {fieldErrors.referenceHarvestQuantity ? (
                          <p className="mt-1 text-xs text-red-600">
                            {fieldErrors.referenceHarvestQuantity}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("harvestedArea")}
                      </label>
                      {formData.uom.trim().toLowerCase() === "m2" ? (
                        <>
                          <input
                            type="text"
                            readOnly
                            value={formData.quantity}
                            className="w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-800"
                            placeholder={t("harvestedArea")}
                            disabled={formDisabled}
                            aria-readonly="true"
                          />
                          <p className="mt-1 text-xs text-[#7A7A7A]">
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
                            className={`w-full rounded-lg border px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-[#1F7A4C] disabled:bg-gray-100 ${fieldErrors.harvestedArea ? "border-red-500" : "border-gray-300"
                              }`}
                            placeholder={t("harvestedAreaPlaceholderKg")}
                            disabled={formDisabled}
                          />
                          <p className="mt-1 text-xs text-[#7A7A7A]">
                            {t("harvestedAreaHintKg")}
                          </p>
                          {fieldErrors.harvestedArea ? (
                            <p className="mt-1 text-xs text-red-600">
                              {fieldErrors.harvestedArea}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-3 pb-0 min-[992px]:pb-9">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${fieldErrors.farm ? "border-red-500" : "border-gray-300"
                          }`}
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
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.farm}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {tCommon("zone")}
                      </label>
                      <select
                        id="harvest-zone"
                        value={formData.zone}
                        onChange={(e) => {
                          setFormData({ ...formData, zone: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, zone: undefined }));
                        }}
                        className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${fieldErrors.zone ? "border-red-500" : "border-gray-300"
                          }`}
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
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.zone}</p>
                      ) : null}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("doSoNumber")}{" "}
                      </label>
                      <input
                        type="text"
                        value={formData.doSoNumber}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            doSoNumber: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100"
                        placeholder={t("doSoPlaceholder")}
                        disabled={formDisabled}
                      />
                    </div>
                  </div>
                </div>



                <div className="pb-0 min-[992px]:pb-12">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <div id="harvest-estimated-date">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("estimatedDate")}
                      </label>
                      <DatePicker
                        value={formData.estimatedDate}
                        onChange={(value) => {
                          setFormData({
                            ...formData,
                            estimatedDate: value,
                          });
                          setFieldErrors((prev) => ({ ...prev, estimatedDate: undefined }));
                        }}
                        onBlur={() => setHarvestDateTouched(true)}
                        disabled={formDisabled}
                        hasError={Boolean(fieldErrors.estimatedDate || harvestDatePairError)}
                      />
                      {fieldErrors.estimatedDate ? (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors.estimatedDate}</p>
                      ) : null}
                    </div>

                    <div id="harvest-actual-date">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("actualDate")}
                      </label>
                      <DatePicker
                        value={formData.actualDate}
                        onChange={(value) => {
                          setFormData({ ...formData, actualDate: value });
                          setFieldErrors((prev) => ({ ...prev, actualDate: undefined }));
                        }}
                        onBlur={() => setHarvestDateTouched(true)}
                        disabled={formDisabled}
                        hasError={Boolean(fieldErrors.actualDate || harvestDatePairError)}
                      />
                      {harvestDatePairError ? (
                        <p className="mt-1 text-xs text-red-600">{harvestDatePairError}</p>
                      ) : (
                        <p className="mt-1 text-xs text-gray-500">
                          {t("datePairHint")}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t("deliveryDate")}{" "}
                      </label>
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


                <div className="grid gap-3 lg:grid-cols-1">
                  <div className="pb-0 min-[992px]:pb-9">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("licensePlate")}{" "}
                    </label>
                    <input
                      type="text"
                      value={formData.licensePlate}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          licensePlate: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100"
                      placeholder={t("licensePlatePlaceholder")}
                      disabled={formDisabled}
                    />
                  </div>
                  <div className="pb-0 min-[992px]:pb-9">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("truckNote")}{" "}
                    </label>
                    <textarea
                      value={formData.truckNote}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          truckNote: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent disabled:bg-gray-100"
                      rows={2}
                      placeholder={t("truckNotePlaceholder")}
                      disabled={formDisabled}
                    />
                  </div>


                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      {t("documentationPhotos")}{" "}
                    </label>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
                              className={`relative aspect-[4/3] rounded-lg bg-gray-100 transition-colors hover:bg-gray-50 flex flex-col items-center justify-center gap-1 cursor-pointer overflow-hidden xl:aspect-square ${formDisabled ? "opacity-50 pointer-events-none" : ""}`}
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
                                  <span className="text-[10px] font-medium text-gray-700">
                                    {t("fileLabel")}
                                  </span>
                                  <span className="text-xs text-gray-600">{label}</span>
                                </div>
                              ) : (
                                <div className="z-[1] flex flex-col items-center justify-center gap-1 p-1 text-center">
                                  <Camera className="w-6 h-6 text-gray-400 shrink-0" />
                                  <span className="text-[11px] text-gray-600">{label}</span>
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
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={formDisabled}
                  className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors mt-6 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {submitLoading
                    ? t("saving")
                    : editId
                      ? t("saveChanges")
                      : t("saveHarvest")}
                </button>
              </form>
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
