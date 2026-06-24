"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import {
  onForecastMutation,
  onHarvestForecastMutation,
  rowDataAffectsHarvest,
} from "@/features/forecasting/forecastDataSync";
import { canAccessModule, isSuperAdmin } from "@/shared/auth/permissions";
import { userIdIsPrivilegedAdmin } from "@/shared/auth/privilegedAdminAccess";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import {
  deleteMondayParentOrSubItem,
  fetchMondayProjectRowsFromServer,
  type MondayProjectServerRow,
  updateMondayProjectParentItem,
} from "@/entities/projects";
import { DatePicker } from "@/shared/ui/date-picker";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

const TURF_FARM_MANAGER_ROLE = "Turf Farm Manager";

function toProjectDateInput(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "";
  const s = v.trim();
  if (s.startsWith("0000")) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
}
import {
  fetchKeyAreas,
  sortKeyAreaRows,
  fetchProjectFormCatalog,
  fetchProjectPaces,
  isArchitectCatalogKey,
  isProjectCatalogKey,
  type KeyAreaRow,
  type ProjectFormCatalogRow,
  type ProjectPaceRow,
} from "@/features/admin/api/adminApi";
import {
  PROJECT_TYPE_VALUES,
  projectTypeMessageKey,
} from "@/features/project/lib/projectTypeDisplay";
import {
  buildPaceGrassBatchQuantitiesFromHarvestRecalc,
  fetchAllHarvestPlanRowsForProject,
  runPaceHarvestRecalcForProjectGrassLines,
  type GrassRequirementForPaceRecalc,
} from "@/features/project/lib/buildPaceGrassBatchQuantitiesFromHarvestRecalc";
import {
  buildPaceGrassBatchQuantitiesAfterPaceChange,
  areAllGrassRequirementsFulfilledByActualHarvests,
  runProjectPaceChangeHarvestRegeneration,
} from "@/features/project/lib/regenerateEstimateHarvestsOnProjectPaceChange";
import {
  buildPaceGrassBatchQuantities,
  estimatePaceDurationWeeks,
  estimatePaceHarvestDateSpan,
  estimateTotalHarvestBatches,
  generatePlannedHarvestsForNewProject,
  isProjectPaceForHarvestPlan,
  persistPlannedHarvestSeedsForProject,
  projectPaceConfigFromRow,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import {
  mondayProjectAliasTitleFromRow,
  mondayProjectTitleFromRow,
} from "@/features/project/lib/resolveMondayProjectRowFields";
import {
  buildCountrySelectOptions,
  pickGrassCatalogRows,
  todayYmdLocal,
} from "@/shared/lib/harvestReferenceData";
import { buildGrassFilterOptionsForFarms } from "@/shared/lib/grassFilterByFarmZone";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { AlertRouteCategoryBanner } from "@/features/alerts/AlertRouteCategoryBanner";
import { dispatchRouteAlert } from "@/features/alerts/dispatchRouteAlert";
import { toast } from "react-toastify";
import { CheckBadge } from "@/shared/ui/check-badge";
import { MultiSelect } from "@/shared/ui/multi-select";
import { getInternalStsProxyUrl } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

interface GrassRow {
  id: string;
  grass: string;
  keyAreaIds: string[];
  loadType: HarvestTypeStorageKey;
  required: string;
  delivered: string;
  farmId: string;
}

const GRASS_LOAD_TYPE_OPTIONS: readonly {
  value: HarvestTypeStorageKey;
  labelKey: "loadTypeSprig" | "loadTypeSod" | "loadTypeSodToSprig";
  uom: "Kg" | "M2";
  uomLabel: string;
}[] = [
  { value: "sprig", labelKey: "loadTypeSprig", uom: "Kg", uomLabel: "kg" },
  { value: "sod", labelKey: "loadTypeSod", uom: "M2", uomLabel: "m2" },
  { value: "sod_to_sprig", labelKey: "loadTypeSodToSprig", uom: "Kg", uomLabel: "kg" },
];

function uomForGrassLoadType(loadType: HarvestTypeStorageKey): "Kg" | "M2" {
  return loadType === "sod" ? "M2" : "Kg";
}

function resolveGrassLoadTypeFromApiRow(
  row: Record<string, unknown>,
): HarvestTypeStorageKey {
  const fromLoadType = normalizeHarvestTypeStorageKey(row.load_type);
  if (fromLoadType) return fromLoadType;
  const uomRaw = String(row.uom ?? "").trim();
  return defaultHarvestTypeForUom(uomRaw || "Kg");
}

function parseKeyAreaIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  const value = String(raw ?? "").trim();
  if (!value) return [];
  if (value.includes(",")) {
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [value];
}

function serializeKeyAreaIdForApi(
  ids: string[],
): string | number | number[] | undefined {
  const parsed = ids
    .map((id) => Number.parseInt(id.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (parsed.length === 0) return undefined;
  if (parsed.length === 1) return parsed[0];
  return parsed;
}

function deriveKeyAreasCsvFromGrassRows(
  rows: GrassRow[],
  keyAreaTitleById: Map<string, string>,
): string {
  const titles = new Set<string>();
  for (const row of rows) {
    for (const id of row.keyAreaIds) {
      const trimmed = id.trim();
      if (!trimmed) continue;
      const title = keyAreaTitleById.get(trimmed);
      if (title) titles.add(title);
    }
  }
  return [...titles].join(",");
}

function grassLoadTypeKey(grass: string, loadType: string): string | null {
  const grassId = grass.trim();
  const lt = loadType.trim();
  if (!grassId || !lt) return null;
  return `${grassId}::${lt}`;
}

function isDuplicateGrassLoadType(
  rows: GrassRow[],
  rowId: string,
  grass: string,
  loadType: HarvestTypeStorageKey,
): boolean {
  const key = grassLoadTypeKey(grass, loadType);
  if (!key) return false;
  return rows.some(
    (row) =>
      row.id !== rowId && grassLoadTypeKey(row.grass, row.loadType) === key,
  );
}

function hasDuplicateGrassLoadTypeRows(rows: GrassRow[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = grassLoadTypeKey(row.grass, row.loadType);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function normalizeProjectNameForCompare(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isProjectPaceUnset(pace: string): boolean {
  const trimmed = pace.trim();
  return !trimmed || trimmed.toLowerCase() === "none";
}

import {
  resolvePostProjectSaveReturnHref,
  resolveReturnToTarget,
  withRefreshQueryParam,
} from "@/shared/lib/appNavigationHref";

type TopFieldErrors = Partial<
  Record<
    | "projectName"
    | "company"
    | "golfClub"
    | "architect"
    | "country"
    | "stsPic"
    | "estimateStartDate"
    | "actualStartDate"
    | "endDate",
    string
  >
>;

/** TEMP: tắt validate Company / Golf club / Architect / STS PIC (bật lại khi cần bắt buộc các trường này) */
const VALIDATE_COMPANY_GOLF_ARCHITECT_PIC = false;

const GOLF_COURSE_TYPES_REQUIRING_HOLES = [
  "Golf Course - New",
  "Golf Course - Renovation",
] as const;
const GOLF_COURSE_TYPES_REQUIRING_HOLES_NORMALIZED = new Set(
  GOLF_COURSE_TYPES_REQUIRING_HOLES.map((v) => v.toLowerCase()),
);

function normalizeHoleValue(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.toLowerCase() === "none") return "none";
  return value;
}

function isActiveCatalogStatus(status: string | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "active" || s === "1" || s === "yes";
}

function firstCatalogLine(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return "";
  const first = String(raw).split(/\r?\n/)[0] ?? "";
  return first.replace(/<[^>]*>/g, "").trim();
}

export default function ProjectInputPage() {
  const tBase = useAppTranslations();
  const t = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) =>
    values
      ? tBase(`ProjectForm.${key}`, values as Parameters<typeof tBase>[1])
      : tBase(`ProjectForm.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const holeOptions = useMemo(
    () =>
      [
        { value: "none" as const, label: tBase("ProjectForm.holesNone") },
        { value: "9" as const, label: "9" },
        { value: "18" as const, label: "18" },
        { value: "27" as const, label: "27" },
        { value: "36" as const, label: "36" },
      ] as const,
    [tBase],
  );
  const router = useRouter();
  const searchParams = useSearchParams();
  const editRowId = searchParams.get("rowId")?.trim() ?? "";
  const editTableIdFromQuery = searchParams.get("tableId")?.trim() ?? "";
  const returnToParam = searchParams.get("returnTo")?.trim() ?? "";
  const isEdit = Boolean(editRowId);
  const user = useAuthUserStore((s) => s.user);
  const canCreateProjects = canAccessModule(user, "projects", "create");
  const canEditProjects = canAccessModule(user, "projects", "edit");
  const canDeleteProjects = canAccessModule(user, "projects", "delete");
  const canAccessProjectForm = isEdit
    ? canEditProjects || canDeleteProjects
    : canCreateProjects;
  const accessDenied = Boolean(user) && !canAccessProjectForm;
  const canSubmitProject = isEdit ? canEditProjects : canCreateProjects;
  /** Planned harvest seeds run only on create — never when updating an existing project row. */
  const canSeedPlannedHarvestsOnCreate =
    !isEdit && canAccessModule(user, "harvests", "create");
  const canRegeneratePaceHarvestsOnEdit =
    isEdit && canAccessModule(user, "harvests", "create");
  const canDeleteProject = isEdit && canDeleteProjects;
  const showProjectLogisticsTimelineDates = useMemo(
    () =>
      isSuperAdmin(user) ||
      user?.role_title?.trim() === TURF_FARM_MANAGER_ROLE,
    [user],
  );

  const [loading, setLoading] = useState(isEdit);
  type ProjectSavePhase = false | "project" | "planned_harvests" | "pace_recalc";
  const [savePhase, setSavePhase] = useState<ProjectSavePhase>(false);
  const [applyPrivilegedPaceHarvestRecalc, setApplyPrivilegedPaceHarvestRecalc] =
    useState(false);
  const saving = savePhase !== false;
  const formControlsDisabled = loading || saving || !canSubmitProject;
  const submitButtonLabel = useMemo(() => {
    if (!saving) {
      return isEdit ? t("updateProject") : t("createProject");
    }
    if (!isEdit && savePhase === "planned_harvests") {
      return t("creatingPlannedHarvests");
    }
    if (savePhase === "pace_recalc") {
      return t("recalculatingPaceHarvests");
    }
    return t("saving");
  }, [isEdit, savePhase, saving, t]);
  const [error, setError] = useState<string | null>(null);
  const [defaultTableId, setDefaultTableId] = useState("");
  const [editTableId, setEditTableId] = useState(editTableIdFromQuery);
  const [projectTypeError, setProjectTypeError] = useState<string | null>(null);
  const [holesError, setHolesError] = useState<string | null>(null);
  const [startDateError, setStartDateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TopFieldErrors>({});
  const [startDateTouched, setStartDateTouched] = useState(false);
  const [grassValidationError, setGrassValidationError] = useState<string | null>(null);
  const [projectPaceError, setProjectPaceError] = useState<string | null>(null);
  /** Pace loaded from server — used to detect pace change on edit save. */
  const [loadedProjectPace, setLoadedProjectPace] = useState("");
  /** Cached harvest plan rows for edit-mode pace fulfillment checks. */
  const [editHarvestPlanRows, setEditHarvestPlanRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  /** From loaded row / API (`react_get_harvesting_table`); fallback `Harvesting` for delete. */
  const [editTableName, setEditTableName] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [projectTypeCatalogRows, setProjectTypeCatalogRows] = useState<ProjectFormCatalogRow[]>([]);
  const [architectCatalogRows, setArchitectCatalogRows] = useState<ProjectFormCatalogRow[]>([]);
  const [keyAreaCatalogRows, setKeyAreaCatalogRows] = useState<KeyAreaRow[]>([]);
  const [projectPaceCatalogRows, setProjectPaceCatalogRows] = useState<ProjectPaceRow[]>([]);
  const [formData, setFormData] = useState({
    projectName: "",
    golfClub: "",
    company: "",
    architect: "",
    country: "",
    stsPic: "",
    odooCustomerId: "",
    estimateStartDate: "",
    actualStartDate: "",
    endDate: "",
    actualCompletionDate: "",
    inTransitDate: "",
    pickUpDate: "",
    projectType: "",
    holes: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    projectPace: "",
  });

  const [grassRows, setGrassRows] = useState<GrassRow[]>([
    {
      id: "1",
      grass: "",
      keyAreaIds: [],
      loadType: "sprig",
      required: "",
      delivered: "",
      farmId: "",
    },
  ]);

  const keyAreaTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of keyAreaCatalogRows) {
      const id = String(row.id ?? "").trim();
      const title = String(row.title ?? "").trim();
      if (id && title) map.set(id, title);
    }
    return map;
  }, [keyAreaCatalogRows]);

  const keyAreaOptions = useMemo(
    () => sortKeyAreaRows(keyAreaCatalogRows),
    [keyAreaCatalogRows],
  );

  const keyAreaMultiOptions = useMemo(
    () =>
      keyAreaOptions.map((ka) => ({
        value: String(ka.id),
        label: String(ka.title ?? "").trim() || String(ka.id),
      })),
    [keyAreaOptions],
  );

  const projectTypeCatalogValues = useMemo(
    () =>
      projectTypeCatalogRows
        .filter((r) => isActiveCatalogStatus(r.status))
        .map((r) => firstCatalogLine(r.value) || String(r.label ?? "").trim())
        .filter(Boolean),
    [projectTypeCatalogRows],
  );

  const architectCatalogValues = useMemo(
    () =>
      architectCatalogRows
        .filter((r) => isActiveCatalogStatus(r.status))
        .map((r) => firstCatalogLine(r.value) || String(r.label ?? "").trim())
        .filter(Boolean),
    [architectCatalogRows],
  );

  /** Include legacy / unknown stored values so edit mode can show the current selection. */
  const projectTypeSelectOptions = useMemo(() => {
    const cur = formData.projectType.trim();
    const sourceValues = projectTypeCatalogValues.length
      ? projectTypeCatalogValues
      : [...PROJECT_TYPE_VALUES];
    const uniqueValues = Array.from(new Set(sourceValues));
    if (cur && !uniqueValues.includes(cur)) {
      return [cur, ...uniqueValues];
    }
    return uniqueValues;
  }, [formData.projectType, projectTypeCatalogValues]);

  const architectOptions = useMemo(() => {
    const values = Array.from(new Set(architectCatalogValues));
    const current = formData.architect.trim();
    if (current && !values.includes(current)) {
      return [current, ...values];
    }
    return values;
  }, [architectCatalogValues, formData.architect]);

  const normalizeProjectPaceKey = (pace: string) =>
    isProjectPaceUnset(pace) ? "" : pace.trim().toLowerCase();

  const showPrivilegedPaceRecalcSetting = useMemo(
    () =>
      isEdit &&
      isProjectPaceUnset(formData.projectPace) &&
      (isSuperAdmin(user) || userIdIsPrivilegedAdmin(user?.id)),
    [formData.projectPace, isEdit, user],
  );

  const projectPaceSelectOptions = useMemo(() => {
    const fromCatalog = projectPaceCatalogRows
      .map((row) => {
        const rawValue = String(row.pace_key ?? "").trim();
        if (!rawValue || rawValue.toLowerCase() === "none") return null;
        const value = rawValue.toLowerCase();
        const title = String(row.title ?? rawValue).trim();
        const paceConfig = projectPaceConfigFromRow(row);
        const months = Math.max(0, paceConfig.durationMonths);
        const weeks = estimatePaceDurationWeeks(paceConfig);
        const totalBatches = estimateTotalHarvestBatches(paceConfig);
        const harvestBatches = Math.max(1, paceConfig.harvestBatches);
        const harvestEveryWeeks = Math.max(1, paceConfig.harvestEveryWeeks);
        return {
          value,
          title,
          months,
          weeks,
          totalBatches,
          harvestBatches,
          harvestEveryWeeks,
        };
      })
      .filter((opt): opt is NonNullable<typeof opt> => opt != null);

    const cur = formData.projectPace.trim().toLowerCase();
    if (
      cur &&
      !isProjectPaceUnset(cur) &&
      !fromCatalog.some((opt) => opt.value === cur)
    ) {
      return [
        {
          value: cur,
          title: cur,
          months: 0,
          weeks: 0,
          totalBatches: 0,
          harvestBatches: 1,
          harvestEveryWeeks: 1,
        },
        ...fromCatalog,
      ];
    }
    return fromCatalog;
  }, [formData.projectPace, projectPaceCatalogRows]);

  const labelForProjectTypeOption = (type: string) => {
    const mk = projectTypeMessageKey(type);
    if (mk) return t(mk);
    const low = type.toLowerCase();
    if (low === "new" || low === "grassing_project") return t("typeNew");
    if (low === "renovation" || low === "renovation_project") return t("typeRenovation");
    return type;
  };

  const labelForProjectPaceOption = (opt: {
    title: string;
    months: number;
  }) => {
    if (opt.months > 0) {
      return `${opt.title} — ${t("projectPaceDurationLine", { months: opt.months })}`;
    }
    return opt.title;
  };

  const selectedProjectPaceValue = isProjectPaceUnset(formData.projectPace)
    ? ""
    : formData.projectPace.trim().toLowerCase();

  const requiresHoles = GOLF_COURSE_TYPES_REQUIRING_HOLES_NORMALIZED.has(
    formData.projectType.trim().toLowerCase(),
  );

  const projects = useHarvestingDataStore((s) => s.projects);
  const countries = useHarvestingDataStore((s) => s.countries);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const products = useHarvestingDataStore((s) => s.products);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
  const farmsRaw = useHarvestingDataStore((s) => s.farms);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const upsertProjectInList = useHarvestingDataStore((s) => s.upsertProjectInList);

  /** Edit mode: `project_id` for resolving display title once Zustand `projects` loads. */
  const [editProjectIdForLabel, setEditProjectIdForLabel] = useState("");

  const editFallbackDetailHref = useMemo(() => {
    if (!isEdit) return "/projects";
    const projectId = editProjectIdForLabel.trim();
    if (!projectId) return "/projects";
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (editRowId) params.set("rowId", editRowId);
    const tableId = editTableId.trim() || editTableIdFromQuery.trim();
    if (tableId) params.set("tableId", tableId);
    return `/projects/detail?${params.toString()}`;
  }, [
    editProjectIdForLabel,
    editRowId,
    editTableId,
    editTableIdFromQuery,
    isEdit,
  ]);

  const returnTarget = useMemo(
    () =>
      resolveReturnToTarget(returnToParam, {
        allowedPrefixes: ["/projects", "/harvest"],
        fallback: isEdit ? editFallbackDetailHref : "/projects",
      }),
    [editFallbackDetailHref, isEdit, returnToParam],
  );

  const goBack = useCallback(() => {
    if (returnToParam) {
      router.push(returnTarget);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(returnTarget);
  }, [router, returnTarget, returnToParam]);

  useEffect(() => {
    if (!isProjectPaceUnset(formData.projectPace)) {
      setApplyPrivilegedPaceHarvestRecalc(false);
    }
  }, [formData.projectPace]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    if (!isEdit) {
      setEditProjectIdForLabel("");
      setLoadedProjectPace("");
      setEditHarvestPlanRows([]);
    }
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit || !editProjectIdForLabel.trim()) {
      setEditHarvestPlanRows([]);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const rows = await fetchAllHarvestPlanRowsForProject(
          editProjectIdForLabel.trim(),
          user?.id != null ? Number(user.id) : undefined,
        );
        if (mounted) setEditHarvestPlanRows(rows);
      } catch {
        if (mounted) setEditHarvestPlanRows([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [editProjectIdForLabel, isEdit, user?.id]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const rows = await fetchProjectFormCatalog();
        if (!mounted) return;
        setProjectTypeCatalogRows(rows.filter((r) => isProjectCatalogKey(r.setting_key)));
        setArchitectCatalogRows(rows.filter((r) => isArchitectCatalogKey(r.setting_key)));
      } catch {
        if (!mounted) return;
        setProjectTypeCatalogRows([]);
        setArchitectCatalogRows([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const rows = await fetchKeyAreas();
        if (!mounted) return;
        setKeyAreaCatalogRows(rows);
      } catch {
        if (!mounted) return;
        setKeyAreaCatalogRows([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const rows = await fetchProjectPaces();
        if (!mounted) return;
        setProjectPaceCatalogRows(rows);
      } catch {
        if (!mounted) return;
        setProjectPaceCatalogRows([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setEditTableId(editTableIdFromQuery);
  }, [editTableIdFromQuery, editRowId]);

  /** When reference `projects` loads after the row, replace raw id in the name field with title. */
  useEffect(() => {
    if (!isEdit || !editProjectIdForLabel) return;
    const opts = (projects as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({
        id: String(p.id ?? "").trim(),
        label: String(p.title ?? p.name ?? "").trim(),
      }))
      .filter((x) => x.id && x.label);
    const label = opts.find((p) => p.id === editProjectIdForLabel)?.label;
    if (!label) return;
    setFormData((prev) => {
      const cur = prev.projectName.trim();
      if (cur === editProjectIdForLabel || cur === "") {
        return { ...prev, projectName: label };
      }
      return prev;
    });
  }, [isEdit, editProjectIdForLabel, projects]);

  const projectNameOptions = (projects as unknown[])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      id: String(p.id ?? "").trim(),
      label: String(p.title ?? p.name ?? "").trim(),
    }))
    .filter((x) => x.id && x.label);

  const countryOptions = useMemo(
    () =>
      buildCountrySelectOptions(
        countries as unknown[],
        isEdit ? formData.country : null,
      ),
    [countries, formData.country, isEdit],
  );
  const staffOptions = (staffs as unknown[])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const firstName = String(s.first_name ?? "").trim();
      const lastName = String(s.last_name ?? "").trim();
      const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
      return {
        id: String(s.id ?? "").trim(),
        name: fullNameFromParts || String(s.full_name ?? s.name ?? "").trim(),
      };
    })
    .filter((x) => x.id && x.name);
  const productOptions = useMemo(() => {
    const refs = [formData.estimateStartDate, formData.actualStartDate]
      .map((s) => String(s ?? "").trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    const pinned = grassRows.map((r) => r.grass.trim()).filter((id) => id.length > 0);
    const mergedRows = pickGrassCatalogRows({
      catalog: products as unknown[],
      mode: "harvest_form_dates",
      refYmds: refs.length ? refs : [todayYmdLocal()],
      pinnedGrassIds: pinned,
    });

    return mergedRows
      .map((p) => {
        const rec = p as Record<string, unknown>;
        return {
          id: String(rec.id ?? "").trim(),
          name: String(rec.name ?? rec.title ?? "").trim(),
        };
      })
      .filter((x) => x.id && x.name);
  }, [products, formData.estimateStartDate, formData.actualStartDate, grassRows]);

  const grassRefYmds = useMemo(() => {
    const refs = [formData.estimateStartDate, formData.actualStartDate]
      .map((s) => String(s ?? "").trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    return refs.length ? refs : [todayYmdLocal()];
  }, [formData.estimateStartDate, formData.actualStartDate]);

  const grassesCatalog = useMemo(() => {
    const grassArr = grasses as unknown[];
    return grassArr.length > 0 ? grassArr : (products as unknown[]);
  }, [grasses, products]);

  const getGrassOptionsForRow = useCallback(
    (row: GrassRow): { id: string; name: string }[] => {
      const farmId = row.farmId.trim();
      if (!farmId) return productOptions;
      return buildGrassFilterOptionsForFarms({
        grasses: grassesCatalog,
        zoneConfigs: zoneConfigurations,
        selectedFarmIds: [farmId],
        pinnedGrassIds: row.grass.trim() ? [row.grass.trim()] : [],
        catalogMode: "harvest_form_dates",
        refYmds: grassRefYmds,
      })
        .map((o) => ({ id: o.value, name: o.label }))
        .filter((x) => x.id && x.name);
    },
    [grassRefYmds, grassesCatalog, productOptions, zoneConfigurations],
  );

  /** All farms (same as harvest entry) — grass supply is not limited to the project country. */
  const farmOptions = useMemo(() => {
    return (farmsRaw as unknown[])
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .map((f) => ({
        id: String(f.id ?? "").trim(),
        name: String(f.name ?? f.title ?? "").trim(),
      }))
      .filter((x) => x.id && x.name);
  }, [farmsRaw]);

  useEffect(() => {
    if (accessDenied) {
      setLoading(false);
      return;
    }
    if (!isEdit) {
      setLoading(false);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 300 });
        if (!mounted) return;
        const row = res.rows.find(
          (r) => String(r.row_id ?? r.id ?? "").trim() === editRowId,
        );
        if (!row) {
          setError(tBase("ProjectForm.cannotFindProjectRow"));
          return;
        }
        applyEditRow(row);
      } catch (e) {
        if (!mounted) return;
        setError(
          e instanceof Error ? e.message : tBase("ProjectForm.loadProjectFailed"),
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [accessDenied, editRowId, isEdit]);

  useEffect(() => {
    if (accessDenied) return;
    if (isEdit) return;
    let mounted = true;
    void (async () => {
      try {
        const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 1 });
        if (!mounted) return;
        const first = res.rows[0];
        const tableId = String(first?.table_id ?? "").trim();
        if (tableId) setDefaultTableId(tableId);
      } catch {
        // Ignore: create flow will show explicit error if table id is still missing.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [accessDenied, isEdit]);

  const addGrassRow = () => {
    setGrassRows((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        grass: "",
        keyAreaIds: [],
        loadType: "sprig",
        required: "",
        delivered: "",
        farmId: "",
      },
    ]);
  };

  const removeGrassRow = (id: string) => {
    setGrassRows((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== id);
    });
  };

  const updateGrassRow = (
    id: string,
    field: keyof GrassRow,
    value: string,
  ) => {
    setGrassRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const updateGrassRowFarm = (id: string, farmId: string) => {
    setGrassRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next: GrassRow = { ...row, farmId };
        if (!farmId.trim() || !next.grass.trim()) return next;
        const allowed = getGrassOptionsForRow(next).map((o) => o.id);
        if (!allowed.includes(next.grass.trim())) {
          return { ...next, grass: "", keyAreaIds: [] };
        }
        return next;
      }),
    );
  };

  const calculateRemaining = (required: string, delivered: string) => {
    const req = parseFloat(required) || 0;
    const del = parseFloat(delivered) || 0;
    return req - del;
  };

  const calculateComplete = (required: string, delivered: string) => {
    const req = parseFloat(required) || 0;
    const del = parseFloat(delivered) || 0;
    if (req === 0) return 0;
    return Math.min(100, Math.round((del / req) * 100));
  };

  const isGrassItemComplete = (g: GrassRow) =>
    g.grass.trim().length > 0 &&
    g.required.trim().length > 0 &&
    g.loadType.trim().length > 0;

  const hasInvalidGrassItem = grassRows.some((g) => {
    const touched =
      g.grass.trim().length > 0 ||
      g.loadType.trim().length > 0 ||
      g.required.trim().length > 0;
    if (!touched) return false;
    const requiredQty = Number.parseFloat(g.required);
    return (
      !g.grass.trim() ||
      !g.loadType.trim() ||
      !g.required.trim() ||
      !Number.isFinite(requiredQty) ||
      requiredQty <= 0
    );
  });

  const hasDuplicateGrassLoadType = hasDuplicateGrassLoadTypeRows(grassRows);

  const getTopFieldErrors = (): TopFieldErrors => {
    const errors: TopFieldErrors = {};
    const projectName = formData.projectName.trim();
    const actualStartDate = formData.actualStartDate.trim();
    const estimateStartDate = formData.estimateStartDate.trim();
    if (!projectName) {
      errors.projectName = t("projectNameRequired");
    }
    if (VALIDATE_COMPANY_GOLF_ARCHITECT_PIC) {
      if (!formData.company.trim()) errors.company = t("companyRequired");
      if (!formData.golfClub.trim()) {
        errors.golfClub = t("golfClubRequired");
      }
      if (!formData.architect.trim()) errors.architect = t("architectRequired");
      if (!formData.stsPic.trim()) {
        errors.stsPic = t("validationSelectPersonInCharge");
      }
    }
    if (!formData.country.trim()) errors.country = t("validationSelectCountry");
    if (!actualStartDate && !estimateStartDate) {
      const msg = t("startDatePairRequiredError");
      errors.estimateStartDate = msg;
      errors.actualStartDate = msg;
    }
    if (!formData.endDate.trim()) errors.endDate = t("endDateRequired");
    return errors;
  };

  const firstTopFieldError = (errors: TopFieldErrors): string | null => {
    const orderedKeys: (keyof TopFieldErrors)[] = [
      "projectName",
      "company",
      "golfClub",
      "architect",
      "country",
      "stsPic",
      "estimateStartDate",
      "actualStartDate",
      "endDate",
    ];
    for (const key of orderedKeys) {
      const message = errors[key];
      if (message) return message;
    }
    return null;
  };

  const getStartDatePairError = (
    estimateStartDate: string,
    actualStartDate: string,
  ): string | null => {
    if (!actualStartDate.trim() && !estimateStartDate.trim()) {
      return t("startDatePairRequiredError");
    }
    return null;
  };

  const getGrassReqsForPaceRecalc = useCallback(
    (): GrassRequirementForPaceRecalc[] =>
      grassRows
        .filter(isGrassItemComplete)
        .map((r) => ({
          productId: r.grass.trim(),
          uom: uomForGrassLoadType(r.loadType),
          loadType: r.loadType,
          totalRequired: Number.parseFloat(r.required) || 0,
          farmId: r.farmId.trim() || undefined,
        })),
    [grassRows],
  );

  const maybeToastPaceRequirementFulfilled = useCallback(
    async (paceValue: string, harvestRows?: Array<Record<string, unknown>>) => {
      if (!isEdit || isProjectPaceUnset(paceValue)) return;
      if (!isProjectPaceForHarvestPlan(paceValue, projectPaceCatalogRows)) return;
      const grassReqs = getGrassReqsForPaceRecalc();
      if (grassReqs.length === 0) return;

      let rows = harvestRows ?? editHarvestPlanRows;
      if (rows.length === 0 && editProjectIdForLabel.trim()) {
        try {
          rows = await fetchAllHarvestPlanRowsForProject(
            editProjectIdForLabel.trim(),
            user?.id != null ? Number(user.id) : undefined,
          );
          setEditHarvestPlanRows(rows);
        } catch {
          return;
        }
      }
      if (
        areAllGrassRequirementsFulfilledByActualHarvests(grassReqs, rows)
      ) {
        toast.info(t("paceRequirementFulfilledNoEstimates"), {
          toastId: "pace-requirement-fulfilled",
        });
      }
    },
    [
      editHarvestPlanRows,
      editProjectIdForLabel,
      getGrassReqsForPaceRecalc,
      isEdit,
      projectPaceCatalogRows,
      t,
      user?.id,
    ],
  );

  const getProjectPaceTimelineError = useCallback((): string | null => {
    if (isProjectPaceUnset(formData.projectPace)) return null;

    const paceKey = formData.projectPace.trim().toLowerCase();
    if (!isProjectPaceForHarvestPlan(paceKey, projectPaceCatalogRows)) return null;

    const selectedPace = projectPaceCatalogRows.find(
      (row) => String(row.pace_key ?? "").trim().toLowerCase() === paceKey,
    );
    if (!selectedPace) return null;

    const timelineStartYmd = formData.estimateStartDate.trim();
    const endYmd = formData.endDate.trim();
    if (!timelineStartYmd) {
      return t("validationEstimateStartDateRequiredForPace");
    }
    if (!endYmd) return null;

    const span = estimatePaceHarvestDateSpan({
      paceConfig: projectPaceConfigFromRow(selectedPace),
      estimatedStartYmd: timelineStartYmd,
    });
    if (!span) return null;

    if (span.lastYmd > endYmd) {
      return t("validationProjectPaceExceedsEndDate", {
        lastHarvestDate: span.lastYmd,
      });
    }
    return null;
  }, [
    formData.endDate,
    formData.estimateStartDate,
    formData.projectPace,
    projectPaceCatalogRows,
    t,
  ]);

  const scrollToField = useCallback(
    (elementId: string, behavior: ScrollBehavior = "smooth") => {
      if (typeof window === "undefined") return false;
      const element = document.getElementById(elementId);
      if (!element) return false;
      element.scrollIntoView({ behavior, block: "start" });
      const focusTarget =
        element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
          ? element
          : (element.querySelector(
            "input, select, textarea, button, [tabindex]",
          ) as HTMLElement | null);
      if (focusTarget && "focus" in focusTarget) {
        focusTarget.focus({ preventScroll: true });
      }
      return true;
    },
    [],
  );

  /** Deep-link from harvest form — scroll ASAP (do not wait for project row API). */
  useLayoutEffect(() => {
    if (accessDenied) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "").trim();
    if (hash !== "project-grass-info") return;

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      if (scrollToField("project-grass-info", "auto")) return;
      attempts += 1;
      if (attempts < 60) {
        requestAnimationFrame(tryScroll);
      }
    };

    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [accessDenied, scrollToField]);

  const orderedTopFieldKeys: (keyof TopFieldErrors)[] = [
    "projectName",
    "company",
    "golfClub",
    "architect",
    "country",
    "stsPic",
    "estimateStartDate",
    "actualStartDate",
    "endDate",
  ];

  const activeIssueCount = useMemo(() => {
    const topCount = orderedTopFieldKeys.filter((k) => Boolean(fieldErrors[k])).length;
    const others = [
      projectTypeError,
      holesError,
      startDateError,
      projectPaceError,
      grassValidationError,
    ]
      .filter(Boolean).length;
    return topCount + others;
  }, [
    fieldErrors,
    grassValidationError,
    holesError,
    orderedTopFieldKeys,
    projectPaceError,
    projectTypeError,
    startDateError,
  ]);

  const jumpToFirstIssue = useCallback(() => {
    const firstTop = orderedTopFieldKeys.find((k) => Boolean(fieldErrors[k]));
    if (firstTop) {
      const topFieldScrollMap: Record<keyof TopFieldErrors, string> = {
        projectName: "project-name",
        company: "project-company",
        golfClub: "project-golf-club",
        architect: "project-architect",
        country: "project-country",
        stsPic: "project-sts-pic",
        estimateStartDate: "project-estimate-start-date",
        actualStartDate: "project-actual-start-date",
        endDate: "project-end-date",
      };
      scrollToField(topFieldScrollMap[firstTop]);
      return;
    }
    if (projectPaceError) {
      scrollToField("project-pace");
      return;
    }
    if (holesError) {
      scrollToField("project-holes");
      return;
    }
    if (grassValidationError) {
      scrollToField("project-grass-info");
    }
  }, [
    fieldErrors,
    grassValidationError,
    holesError,
    orderedTopFieldKeys,
    projectPaceError,
    scrollToField,
  ]);

  useEffect(() => {
    if (!startDateTouched) return;
    const pairError = getStartDatePairError(
      formData.estimateStartDate,
      formData.actualStartDate,
    );
    setStartDateError(pairError);
    setFieldErrors((prev) => ({
      ...prev,
      estimateStartDate: pairError ?? undefined,
      actualStartDate: pairError ?? undefined,
    }));
  }, [formData.actualStartDate, formData.estimateStartDate, startDateTouched]);

  useEffect(() => {
    setProjectPaceError(getProjectPaceTimelineError());
  }, [getProjectPaceTimelineError]);

  const applyEditRow = (row: MondayProjectServerRow) => {
    const projectId = String(row.project_id ?? "").trim();
    const rec = row as Record<string, unknown>;
    setEditProjectIdForLabel(projectId);
    const fromList = projectNameOptions.find((p) => p.id === projectId);
    const projectNameDisplay = mondayProjectTitleFromRow(rec, {
      catalogTitle: fromList?.label,
      projectId,
    });
    setEditTableName(String(row.table_name ?? "").trim());
    const rowTableId = String(row.table_id ?? "").trim();
    if (rowTableId) setEditTableId(rowTableId);
    const paceRaw = String(rec.project_pace ?? "").trim().toLowerCase();
    const projectPace = paceRaw === "none" ? "" : paceRaw;
    setLoadedProjectPace(projectPace);
    setFormData({
      projectName: projectNameDisplay,
      golfClub: mondayProjectAliasTitleFromRow(rec),
      company: String(rec.company_name ?? "").trim(),
      architect: String(rec.golf_course_architect ?? "").trim(),
      country: String(row.country_id ?? "").trim(),
      stsPic: String(row.pic ?? "").trim(),
      odooCustomerId: String(row.odoo_customer_id ?? "").trim(),
      estimateStartDate: String(rec.estimate_start_date ?? "").trim(),
      actualStartDate: String(rec.start_date ?? "").trim(),
      endDate: String(row.deadline ?? "").trim(),
      actualCompletionDate: String(rec.actual_completion_date ?? "").trim(),
      inTransitDate: toProjectDateInput(rec.in_transit_date),
      pickUpDate: toProjectDateInput(rec.pick_up_date),
      projectType: String(row.project_type ?? "").trim(),
      holes: normalizeHoleValue(row.no_of_holes),
      contactName: String(rec.main_contact_name ?? "").trim(),
      contactEmail: String(rec.main_contact_email ?? "").trim(),
      contactPhone: String(rec.main_contact_phone ?? "").trim(),
      projectPace,
    });

    const raw = row.quantity_required_sprig_sod;
    const list = Array.isArray(raw)
      ? raw
      : typeof raw === "string" && raw.trim().startsWith("[")
        ? (JSON.parse(raw) as unknown[])
        : [];
    const mapped = list
      .filter((x) => x && typeof x === "object")
      .map((x) => x as Record<string, unknown>)
      .map((x) => {
        const loadType = resolveGrassLoadTypeFromApiRow(x);
        return {
          id: String(x.id ?? Date.now()),
          grass: String(x.product_id ?? "").trim(),
          keyAreaIds: parseKeyAreaIds(x.key_area_id),
          loadType,
          required: String(x.quantity ?? "").trim(),
          delivered: "",
          farmId: String(x.farm_id ?? "").trim(),
        };
      });
    if (mapped.length) setGrassRows(mapped);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitProject) {
      setError(
        isEdit
          ? "You do not have permission to edit this project."
          : "You do not have permission to create a project.",
      );
      return;
    }
    setProjectTypeError(null);
    setHolesError(null);
    setStartDateError(null);
    setFieldErrors({});
    setGrassValidationError(null);
    setProjectPaceError(null);
    setStartDateTouched(true);

    const topFieldErrors = getTopFieldErrors();
    setFieldErrors(topFieldErrors);
    const firstTopFieldErrorKey =
      orderedTopFieldKeys.find((key) => Boolean(topFieldErrors[key])) ?? null;
    const textFieldError = firstTopFieldError(topFieldErrors);
    const nextStartDateError =
      topFieldErrors.actualStartDate ?? topFieldErrors.estimateStartDate ?? null;
    const nextProjectTypeError = null;
    const nextHolesError =
      requiresHoles && !formData.holes
        ? t("validationSelectHoles")
        : null;
    setProjectTypeError(nextProjectTypeError);
    setHolesError(nextHolesError);
    setStartDateError(nextStartDateError);

    const hasCompleteGrassItem = grassRows.some(isGrassItemComplete);
    const noCompleteGrassError = t("validationGrassAtLeastOneComplete");
    const invalidGrassError = t("validationGrassInvalidRows");
    const duplicateGrassError = t("validationGrassDuplicateLoadType");
    if (!hasCompleteGrassItem) {
      setGrassValidationError(noCompleteGrassError);
    } else if (hasDuplicateGrassLoadType) {
      setGrassValidationError(duplicateGrassError);
    } else if (hasInvalidGrassItem) {
      setGrassValidationError(invalidGrassError);
    } else {
      setGrassValidationError(null);
    }

    const nextProjectPaceError = getProjectPaceTimelineError();
    setProjectPaceError(nextProjectPaceError);

    const firstError =
      textFieldError ?? nextStartDateError ?? nextProjectPaceError ?? nextHolesError;
    if (firstError) {
      setError(firstError);
      const topFieldScrollMap: Record<keyof TopFieldErrors, string> = {
        projectName: "project-name",
        company: "project-company",
        golfClub: "project-golf-club",
        architect: "project-architect",
        country: "project-country",
        stsPic: "project-sts-pic",
        estimateStartDate: "project-estimate-start-date",
        actualStartDate: "project-actual-start-date",
        endDate: "project-end-date",
      };
      if (firstTopFieldErrorKey) {
        scrollToField(topFieldScrollMap[firstTopFieldErrorKey]);
      } else if (nextProjectPaceError) {
        scrollToField("project-pace");
      } else if (nextHolesError) {
        scrollToField("project-holes");
      }
      return;
    }

    if (!hasCompleteGrassItem) {
      setError(noCompleteGrassError);
      scrollToField("project-grass-info");
      return;
    }
    if (hasDuplicateGrassLoadType) {
      setError(duplicateGrassError);
      scrollToField("project-grass-info");
      return;
    }
    if (hasInvalidGrassItem) {
      setError(invalidGrassError);
      scrollToField("project-grass-info");
      return;
    }

    try {
      setSavePhase("project");
      setError(null);
      let harvestSnapshotPending = false;
      const resolvedTableId = isEdit ? editTableId : defaultTableId;
      if (!resolvedTableId) {
        setError(t("missingTableIdForSave"));
        return;
      }
      const resolvedRowId = isEdit
        ? editRowId
        : (globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}`);
      const projectName = formData.projectName.trim();
      if (!isEdit && projectName) {
        const existedRows = await fetchMondayProjectRowsFromServer({
          module: "project",
          search: projectName,
          page: 1,
          perPage: 300,
        });
        const normalizedInput = normalizeProjectNameForCompare(projectName);
        const duplicated = existedRows.rows.some((row) => {
          const rowName = normalizeProjectNameForCompare(
            (row as Record<string, unknown>).title ??
            (row as Record<string, unknown>).project_name ??
            row.project_id,
          );
          return rowName && rowName === normalizedInput;
        });
        if (duplicated) {
          setError(t("projectDuplicateName"));
          return;
        }
      }
      // `client_source: nextjs` + `project_name` triggers server-side project resolve/create only for
      // this app. Flutter sends `project_id` from its own flow and must not set `client_source`, or
      // duplicate `sts_projects` rows would be created.
      const normalizedHoles = requiresHoles
        ? formData.holes.trim() || "none"
        : "none";
      const editProjectId = editProjectIdForLabel.trim();
      const paceKeyForSave = formData.projectPace.trim().toLowerCase();
      const selectedPaceForSave = projectPaceCatalogRows.find(
        (row) => String(row.pace_key ?? "").trim().toLowerCase() === paceKeyForSave,
      );
      const grassReqsForPace = grassRows
        .filter(isGrassItemComplete)
        .map((r) => ({
          productId: r.grass.trim(),
          uom: uomForGrassLoadType(r.loadType),
          loadType: r.loadType,
          amountRequired: Number.parseFloat(r.required) || 0,
          farmId: r.farmId.trim(),
        }));
      const grassReqsForPrivilegedRecalc: GrassRequirementForPaceRecalc[] =
        grassReqsForPace.map((r) => ({
          productId: r.productId,
          uom: r.uom,
          loadType: r.loadType,
          totalRequired: r.amountRequired,
          farmId: r.farmId || undefined,
        }));

      let harvestPlanRowsForPaceOps: Array<Record<string, unknown>> = [];
      const projectPaceChangedOnEdit =
        isEdit &&
        normalizeProjectPaceKey(formData.projectPace) !==
          normalizeProjectPaceKey(loadedProjectPace);
      const shouldRegeneratePaceHarvestsOnEdit =
        projectPaceChangedOnEdit &&
        canRegeneratePaceHarvestsOnEdit &&
        isProjectPaceForHarvestPlan(paceKeyForSave, projectPaceCatalogRows) &&
        Boolean(selectedPaceForSave) &&
        grassReqsForPace.length > 0;
      const usePrivilegedPaceHarvestRecalc =
        isEdit &&
        isProjectPaceUnset(formData.projectPace) &&
        applyPrivilegedPaceHarvestRecalc &&
        showPrivilegedPaceRecalcSetting &&
        !shouldRegeneratePaceHarvestsOnEdit;

      if (shouldRegeneratePaceHarvestsOnEdit || usePrivilegedPaceHarvestRecalc) {
        const projectIdForPaceOps = editProjectIdForLabel.trim();
        if (!projectIdForPaceOps) {
          setError(t("privilegedPaceRecalcNoProjectId"));
          return;
        }
        try {
          harvestPlanRowsForPaceOps = await fetchAllHarvestPlanRowsForProject(
            projectIdForPaceOps,
            user?.id != null ? Number(user.id) : undefined,
          );
        } catch {
          setError(t("privilegedPaceRecalcFetchFailed"));
          return;
        }
      }

      const paceGrassBatchQuantities = shouldRegeneratePaceHarvestsOnEdit &&
        selectedPaceForSave
        ? buildPaceGrassBatchQuantitiesAfterPaceChange({
            paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
            grassRequirements: grassReqsForPrivilegedRecalc,
            harvestPlanRows: harvestPlanRowsForPaceOps,
          })
        : usePrivilegedPaceHarvestRecalc
          ? buildPaceGrassBatchQuantitiesFromHarvestRecalc({
              grassRequirements: grassReqsForPrivilegedRecalc,
              harvestPlanRows: harvestPlanRowsForPaceOps,
            })
          : isProjectPaceForHarvestPlan(paceKeyForSave, projectPaceCatalogRows) &&
              selectedPaceForSave &&
              grassReqsForPace.length > 0
            ? buildPaceGrassBatchQuantities({
                paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
                grassRequirements: grassReqsForPace,
              })
            : [];
      const payload: Record<string, unknown> = {
        id: resolvedRowId,
        table_id: resolvedTableId,
        data: {
          project_name: projectName,
          ...(isEdit && editProjectId ? { project_id: editProjectId } : {}),
          alias_title: formData.golfClub,
          company_name: formData.company,
          golf_course_architect: formData.architect,
          estimate_start_date: formData.estimateStartDate,
          start_date: formData.actualStartDate,
          deadline: formData.endDate,
          country_id: formData.country,
          pic: formData.stsPic,
          odoo_customer_id: formData.odooCustomerId.trim(),
          project_type: formData.projectType,
          no_of_holes: normalizedHoles,
          key_areas: deriveKeyAreasCsvFromGrassRows(grassRows, keyAreaTitleById),
          quantity_required_sprig_sod: grassRows.map((r) => {
            const keyAreaId = serializeKeyAreaIdForApi(r.keyAreaIds);
            const uom = uomForGrassLoadType(r.loadType);
            return {
              id: r.id,
              product_id: r.grass,
              quantity: r.required,
              uom,
              load_type: r.loadType,
              ...(keyAreaId != null ? { key_area_id: keyAreaId } : {}),
              ...(r.farmId.trim() ? { farm_id: r.farmId.trim() } : {}),
            };
          }),
          main_contact_name: formData.contactName.trim(),
          main_contact_email: formData.contactEmail.trim(),
          main_contact_phone: formData.contactPhone.trim(),
          project_pace: isProjectPaceUnset(formData.projectPace)
            ? ""
            : formData.projectPace.trim().toLowerCase(),
          pace_grass_batch_quantities: paceGrassBatchQuantities,
          actual_completion_date: formData.actualCompletionDate.trim(),
          ...(showProjectLogisticsTimelineDates
            ? {
                in_transit_date: formData.inTransitDate.trim(),
                pick_up_date: formData.pickUpDate.trim(),
              }
            : {}),
        },
      };
      if (!isEdit) {
        payload.client_source = "nextjs";
      }
      const saveResponse = await updateMondayProjectParentItem(payload);
      if (saveResponse?.project && typeof saveResponse.project === "object") {
        upsertProjectInList(saveResponse.project);
      }
      const proj = saveResponse?.project;
      const rowData = saveResponse?.row_data;
      /** `react_update_parent_item` returns `Projects_model` as array — PK is `id`, not `project_id`. */
      const projectIdStr = (() => {
        if (proj && typeof proj === "object") {
          const o = proj as Record<string, unknown>;
          const fromProject = String(o.project_id ?? o.id ?? "").trim();
          if (fromProject) return fromProject;
        }
        if (rowData && typeof rowData === "object") {
          const fromRow = String(
            (rowData as Record<string, unknown>).project_id ?? "",
          ).trim();
          if (fromRow) return fromRow;
        }
        return "";
      })();

      let plannedHarvestAlertSuffix = "";
      let plannedHarvestAlertSeverity:
        | "info"
        | "success"
        | "warning"
        | "critical"
        | undefined;

      if (shouldRegeneratePaceHarvestsOnEdit && projectIdStr && selectedPaceForSave) {
        setSavePhase("pace_recalc");
        const anchorYmd = formData.estimateStartDate.trim();
        const paceSpan = estimatePaceHarvestDateSpan({
          paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
          estimatedStartYmd: anchorYmd,
        });
        const {
          deleted,
          deleteFailed,
          created,
          createFailed,
          firstCreateMessage,
          allRequirementsFulfilled,
        } = await runProjectPaceChangeHarvestRegeneration({
          projectId: projectIdStr,
          countryId: formData.country,
          customerId: formData.odooCustomerId,
          userId: user?.id != null ? String(user.id) : undefined,
          paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
          estimatedStartYmd: anchorYmd,
          grassRequirements: grassReqsForPace,
          harvestPlanRows: harvestPlanRowsForPaceOps,
          zoneConfigurations,
          paceSnapshotSpan: paceSpan,
          fallbackTableId: resolvedTableId,
        });
        if (allRequirementsFulfilled && created === 0) {
          toast.info(t("paceRequirementFulfilledNoEstimates"), {
            toastId: "pace-requirement-fulfilled-save",
          });
          plannedHarvestAlertSuffix += t("alertPaceRequirementFulfilledSuffix");
        }
        if (deleted > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRegenerateDeletedSuffix", {
            count: deleted,
          });
        }
        if (deleteFailed > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRegenerateDeleteFailedSuffix", {
            count: deleteFailed,
          });
          plannedHarvestAlertSeverity = "warning";
        }
        if (created > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRegenerateCreatedSuffix", {
            count: created,
          });
          const url = getInternalStsProxyUrl(
            STS_API_PATHS.updateHarvestLimitDescriptions,
          );
          void fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            keepalive: true,
            body: JSON.stringify({ project_id: projectIdStr }),
          }).catch(() => {});
        }
        if (createFailed > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRegenerateCreateFailedSuffix", {
            count: createFailed,
            detail: firstCreateMessage
              ? t("alertPlannedHarvestFailDetail", {
                  message: firstCreateMessage,
                })
              : "",
          });
          plannedHarvestAlertSeverity = "warning";
        }
        if (deleted > 0 || created > 0 || deleteFailed > 0 || createFailed > 0) {
          harvestSnapshotPending = true;
        }
      } else if (usePrivilegedPaceHarvestRecalc && projectIdStr) {
        setSavePhase("pace_recalc");
        let harvestPlanRowsForRecalcApi = harvestPlanRowsForPaceOps;
        try {
          harvestPlanRowsForRecalcApi =
            await fetchAllHarvestPlanRowsForProject(
              projectIdStr,
              user?.id != null ? Number(user.id) : undefined,
            );
        } catch {
          setError(t("privilegedPaceRecalcFetchFailed"));
          return;
        }
        const { ok, fail } = await runPaceHarvestRecalcForProjectGrassLines({
          projectId: projectIdStr,
          grassRequirements: grassReqsForPrivilegedRecalc,
          harvestPlanRows: harvestPlanRowsForRecalcApi,
          zoneConfigurations,
        });
        if (ok > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRecalcSuffix", { ok });
        }
        if (fail > 0) {
          plannedHarvestAlertSuffix += t("alertPaceRecalcFailedSuffix", {
            fail,
          });
          plannedHarvestAlertSeverity = "warning";
        }
        if (ok > 0 || fail > 0) {
          harvestSnapshotPending = true;
        }
      }

      if (!isEdit && canSeedPlannedHarvestsOnCreate && projectIdStr) {
        if (
          isProjectPaceForHarvestPlan(paceKeyForSave, projectPaceCatalogRows) &&
          selectedPaceForSave &&
          grassReqsForPace.length > 0
        ) {
          const anchorYmd =
            formData.estimateStartDate.trim() ||
            formData.actualStartDate.trim();
          const paceSpan = estimatePaceHarvestDateSpan({
            paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
            estimatedStartYmd: anchorYmd,
          });
          const seeds = generatePlannedHarvestsForNewProject({
            paceConfig: projectPaceConfigFromRow(selectedPaceForSave),
            estimatedStartYmd: anchorYmd,
            grassRequirements: grassReqsForPace,
            zoneConfigurations,
          });
          if (seeds.length > 0) {
            setSavePhase("planned_harvests");
            const { ok, fail, firstMessage } =
              await persistPlannedHarvestSeedsForProject({
                projectId: projectIdStr,
                countryId: formData.country,
                customerId: formData.odooCustomerId,
                userId: user?.id != null ? String(user.id) : undefined,
                seeds,
                paceSnapshotSpan: paceSpan,
              });
            if (ok > 0) {
              harvestSnapshotPending = true;
              plannedHarvestAlertSuffix += t(
                "alertPlannedHarvestsSavedSuffix",
                { count: ok },
              );
              const url = getInternalStsProxyUrl(
                STS_API_PATHS.updateHarvestLimitDescriptions,
              );
              void fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                keepalive: true,
                body: JSON.stringify({ project_id: projectIdStr }),
              }).catch(() => {});
            }
            if (fail > 0) {
              plannedHarvestAlertSuffix += t(
                "alertPlannedHarvestsFailedSuffix",
                {
                  count: fail,
                  detail: firstMessage
                    ? t("alertPlannedHarvestFailDetail", {
                        message: firstMessage,
                      })
                    : "",
                },
              );
              plannedHarvestAlertSeverity = "warning";
            }
          }
        }
      }

      const detailHrefAfterSave = (() => {
        if (!projectIdStr) return "/projects";
        const params = new URLSearchParams();
        params.set("projectId", projectIdStr);
        params.set("rowId", resolvedRowId);
        params.set("tableId", resolvedTableId);
        if (projectName) params.set("projectTitle", projectName);
        return `/projects/detail?${params.toString()}`;
      })();
      const alertHref = detailHrefAfterSave;
      await dispatchRouteAlert({
        routeKey: "projects_new",
        title: isEdit
          ? t("alertProjectUpdatedTitle", { name: projectName })
          : t("alertNewProjectTitle", { name: projectName }),
        message: [formData.company.trim(), formData.golfClub.trim(), projectName]
          .filter(Boolean)
          .join(" · ")
          .concat(plannedHarvestAlertSuffix),
        href: alertHref,
        sourceEntityId: projectIdStr || String(resolvedRowId),
        ...(plannedHarvestAlertSeverity
          ? { severity: plannedHarvestAlertSeverity }
          : {}),
      });
      try {
        await fetchAllHarvestingReferenceData(true);
      } catch {
        // Navigation still carries a refresh token so the list can re-fetch on return.
      }
      onForecastMutation("reference");
      if (
        harvestSnapshotPending ||
        (rowData &&
          typeof rowData === "object" &&
          rowDataAffectsHarvest(rowData as Record<string, unknown>))
      ) {
        onHarvestForecastMutation();
      }
      const postSaveHref = resolvePostProjectSaveReturnHref({
        isEdit,
        returnToParam,
        returnTarget,
        projectName,
        detailHrefAfterSave,
      });
      router.push(postSaveHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavePhase(false);
    }
  };

  const onConfirmDeleteProject = async () => {
    if (!canDeleteProject) {
      setError("You do not have permission to delete this project.");
      setConfirmDeleteOpen(false);
      return;
    }
    if (!editRowId || !editTableId) {
      setError(t("deleteMissingIds"));
      setConfirmDeleteOpen(false);
      return;
    }
    const tableName = editTableName.trim() || "Harvesting";
    try {
      setDeleting(true);
      setError(null);
      await deleteMondayParentOrSubItem({
        tableId: editTableId,
        tableName,
        rowId: editRowId,
        type: "parent",
      });
      setConfirmDeleteOpen(false);
      try {
        await fetchAllHarvestingReferenceData(true);
      } catch {
        // Best-effort only; the return route still gets a refresh token.
      }
      // After delete, never send the user back to detail — the row no longer exists.
      router.push(withRefreshQueryParam("/projects"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        {accessDenied ? (
          <div className="min-h-screen pb-10 lg:pb-14">
            <div className="mx-auto w-full space-y-4 px-4 pt-4 lg:px-6 lg:pt-8">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h1 className="text-xl font-semibold text-amber-900">
                  {isEdit ? t("editTitle") : t("newTitle")}
                </h1>
                <p className="mt-2 text-sm text-amber-800">
                  {isEdit
                    ? "You do not have permission to edit or delete this project."
                    : "You do not have permission to create a project."}
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-amber-300 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
                  >
                    {t("backToProjects")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div className="min-h-screen pb-10 lg:pb-14">
          <div className="mx-auto w-full space-y-6 px-4 pt-4 lg:px-6 lg:pt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={goBack}
                  type="button"
                  aria-label={t("backToProjects")}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <ArrowLeft className="h-4 w-4" strokeWidth={2.25} />
                </button>
                <h1 className="font-heading text-2xl font-bold text-foreground">
                  {isEdit ? t("editTitle") : t("newTitle")}
                </h1>
              </div>
              {canDeleteProject ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                  aria-label={tCommon("delete")}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2.25} />
                  {tCommon("delete")}
                </button>
              ) : null}
            </div>

            <form
              onSubmit={handleSubmit}
              noValidate
              className="space-y-8 [&_input]:h-10 [&_input]:py-0 [&_select]:h-10 [&_select]:py-0"
            >
              {activeIssueCount > 0 ? (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm font-medium text-destructive">
                    {activeIssueCount} fields need attention
                  </p>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                    onClick={jumpToFirstIssue}
                  >
                    Go to first issue
                  </button>
                </div>
              ) : null}

              {loading ? (
                <p className="text-sm text-muted-foreground">{t("loadingProject")}</p>
              ) : null}

              <fieldset
                disabled={formControlsDisabled}
                className="flex min-w-0 flex-col gap-10 border-0 p-0 m-0"
                aria-readonly={!canSubmitProject}
              >
              {/* Basic Information */}
              <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                <div className="px-4 py-3 lg:px-5">
                  <h2 className="text-base font-semibold">{t("basicInformation")}</h2>
                </div>
                <div className="space-y-4 p-4 lg:p-5">
                  <div id="project-basic-info" className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-name">
                        {t("projectName")}
                      </label>
                      <input
                        id="project-name"
                        name="projectName"
                        type="text"
                        value={formData.projectName}
                        onChange={(e) => {
                          setFormData({ ...formData, projectName: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, projectName: undefined }));
                        }}
                        placeholder={t("projectNamePlaceholder")}
                        autoComplete="off"
                        aria-invalid={Boolean(fieldErrors.projectName)}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.projectName ? "border-destructive" : "border-input"
                          }`}
                      />
                      {fieldErrors.projectName ? (
                        <p className="text-xs text-destructive">{fieldErrors.projectName}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-sts-pic">
                        {t("stsPic")}
                      </label>
                      <select
                        id="project-sts-pic"
                        value={formData.stsPic}
                        onChange={(e) => {
                          setFormData({ ...formData, stsPic: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, stsPic: undefined }));
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.stsPic ? "border-destructive" : "border-input"
                          }`}
                      >
                        <option value="">{t("selectPersonInCharge")}</option>
                        {staffOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.stsPic ? (
                        <p className="text-xs text-destructive">{fieldErrors.stsPic}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-company">
                        {tCommon("company")}
                      </label>
                      <input
                        id="project-company"
                        type="text"
                        value={formData.company}
                        onChange={(e) => {
                          setFormData({ ...formData, company: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, company: undefined }));
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.company ? "border-destructive" : "border-input"
                          }`}
                        placeholder={t("companyPlaceholder")}
                      />
                      {fieldErrors.company ? (
                        <p className="text-xs text-destructive">{fieldErrors.company}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-golf-club">
                        {t("golfClub")}
                      </label>
                      <input
                        id="project-golf-club"
                        type="text"
                        value={formData.golfClub}
                        onChange={(e) => {
                          setFormData({ ...formData, golfClub: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, golfClub: undefined }));
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.golfClub ? "border-destructive" : "border-input"
                          }`}
                        placeholder={t("golfClubPlaceholder")}
                      />
                      {fieldErrors.golfClub ? (
                        <p className="text-xs text-destructive">{fieldErrors.golfClub}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-odoo-customer-id">
                        {t("odooCustomerRef")}
                      </label>
                      <input
                        id="project-odoo-customer-id"
                        type="text"
                        value={formData.odooCustomerId}
                        onChange={(e) => {
                          setFormData({ ...formData, odooCustomerId: e.target.value });
                        }}
                        className="w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                        placeholder={t("odooCustomerRefPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-architect">
                        {t("architect")}
                      </label>
                      <select
                        id="project-architect"
                        value={formData.architect}
                        onChange={(e) => {
                          setFormData({ ...formData, architect: e.target.value });
                          setFieldErrors((prev) => ({ ...prev, architect: undefined }));
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.architect ? "border-destructive" : "border-input"
                          }`}
                      >
                        <option value="">{t("architectPlaceholder")}</option>
                        {architectOptions.map((architect) => (
                          <option key={architect} value={architect}>
                            {architect}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.architect ? (
                        <p className="text-xs text-destructive">{fieldErrors.architect}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground" htmlFor="project-country">
                        {tCommon("country")}
                      </label>
                      <select
                        id="project-country"
                        value={formData.country}
                        onChange={(e) => {
                          const nextCountry = e.target.value;
                          setFormData({ ...formData, country: nextCountry });
                          setFieldErrors((prev) => ({ ...prev, country: undefined }));
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${fieldErrors.country ? "border-destructive" : "border-input"
                          }`}
                      >
                        <option value="">{t("selectCountry")}</option>
                        {countryOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.country ? (
                        <p className="text-xs text-destructive">{fieldErrors.country}</p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor="project-type"
                      >
                        {t("projectType")}
                      </label>
                      <select
                        id="project-type"
                        value={formData.projectType}
                        onChange={(e) => {
                          const nextType = e.target.value;
                          const nextIsGolfCourse =
                            GOLF_COURSE_TYPES_REQUIRING_HOLES_NORMALIZED.has(
                              nextType.trim().toLowerCase(),
                            );
                          setFormData({
                            ...formData,
                            projectType: nextType,
                            holes: nextIsGolfCourse ? formData.holes : "",
                          });
                          setProjectTypeError(null);
                          setHolesError(null);
                        }}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${projectTypeError ? "border-destructive" : "border-input"
                          }`}
                      >
                        <option value="">{t("selectProjectType")}</option>
                        {projectTypeSelectOptions.map((type) => (
                          <option key={type} value={type}>
                            {labelForProjectTypeOption(type)}
                          </option>
                        ))}
                      </select>
                      {projectTypeError ? (
                        <p className="text-xs text-destructive">{projectTypeError}</p>
                      ) : null}
                    </div>
                    <div id="project-pace" className="space-y-1.5">
                      <label
                        className="text-sm font-medium text-foreground"
                        htmlFor="project-pace-select"
                      >
                        {t("projectPaceLabel")}{" "}
                        <span className="text-xs font-normal text-muted-foreground">
                          {t("projectPaceHint")}
                        </span>
                      </label>
                      <select
                        id="project-pace-select"
                        value={selectedProjectPaceValue}
                        onChange={(e) => {
                          const nextPace = e.target.value;
                          setFormData({ ...formData, projectPace: nextPace });
                          setProjectPaceError(null);
                          void maybeToastPaceRequirementFulfilled(nextPace);
                        }}
                        disabled={projectPaceSelectOptions.length === 0}
                        className={`w-full rounded-md border bg-card px-3 text-sm text-foreground shadow-sm ${projectPaceError ? "border-destructive" : "border-input"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <option value="">{t("paceNoneOption")}</option>
                        {projectPaceSelectOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {labelForProjectPaceOption(opt)}
                          </option>
                        ))}
                      </select>
                      {projectPaceSelectOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("projectPaceEmptyCatalog")}
                        </p>
                      ) : null}
                      {projectPaceError ? (
                        <p className="text-xs text-destructive">{projectPaceError}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              {/* Main contact */}
              <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                <div className="border-b border-border px-4 py-3 lg:px-5">
                  <h2 className="text-base font-semibold">{t("mainProjectContact")}</h2>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-3 lg:p-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="contact-name">
                      {t("contactName")}
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      value={formData.contactName}
                      onChange={(e) =>
                        setFormData({ ...formData, contactName: e.target.value })
                      }
                      className="w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                      placeholder={t("contactNamePlaceholder")}
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="contact-email">
                      {t("contactEmail")}
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) =>
                        setFormData({ ...formData, contactEmail: e.target.value })
                      }
                      className="w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                      placeholder={t("contactEmailPlaceholder")}
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="contact-phone">
                      {t("contactPhone")}
                    </label>
                    <input
                      id="contact-phone"
                      type="tel"
                      value={formData.contactPhone}
                      onChange={(e) =>
                        setFormData({ ...formData, contactPhone: e.target.value })
                      }
                      className="w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                      placeholder={t("contactPhonePlaceholder")}
                      autoComplete="tel"
                    />
                  </div>
                </div>
              </section>

              {/* Timeline */}
              <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                <div className="border-b border-border px-4 py-3 lg:px-5">
                  <h2 className="text-base font-semibold">{t("timeline")}</h2>
                </div>
                <div id="project-setup-info" className="grid gap-4 p-4 sm:grid-cols-2 lg:p-5">
                  <div id="project-estimate-start-date" className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t("estimateStartDate")}
                    </label>
                    <DatePicker
                      value={formData.estimateStartDate}
                      onChange={(value) => {
                        setFormData({ ...formData, estimateStartDate: value });
                        setFieldErrors((prev) => ({ ...prev, estimateStartDate: undefined }));
                      }}
                      onBlur={() => setStartDateTouched(true)}
                      hasError={Boolean(fieldErrors.estimateStartDate || startDateError)}
                    />
                    {fieldErrors.estimateStartDate ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.estimateStartDate}
                      </p>
                    ) : null}
                  </div>

                  <div id="project-actual-start-date" className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t("actualStartDate")}
                    </label>
                    <DatePicker
                      value={formData.actualStartDate}
                      onChange={(value) => {
                        setFormData({ ...formData, actualStartDate: value });
                        setFieldErrors((prev) => ({ ...prev, actualStartDate: undefined }));
                      }}
                      onBlur={() => setStartDateTouched(true)}
                      hasError={Boolean(fieldErrors.actualStartDate || startDateError)}
                    />
                    {startDateError ? (
                      <p className="text-xs text-destructive">{startDateError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t("startDatePairHint")}
                      </p>
                    )}
                  </div>

                  <div id="project-end-date" className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t("estimatedCompletionDate")}
                    </label>
                    <DatePicker
                      value={formData.endDate}
                      onChange={(value) => {
                        setFormData({ ...formData, endDate: value });
                        setFieldErrors((prev) => ({ ...prev, endDate: undefined }));
                      }}
                      hasError={Boolean(fieldErrors.endDate || projectPaceError)}
                    />
                    {fieldErrors.endDate ? (
                      <p className="text-xs text-destructive">{fieldErrors.endDate}</p>
                    ) : projectPaceError ? (
                      <p className="text-xs text-destructive">{projectPaceError}</p>
                    ) : null}
                  </div>

                  <div id="project-actual-completion-date" className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t("actualCompletionDate")}
                    </label>
                    <DatePicker
                      value={formData.actualCompletionDate}
                      onChange={(value) =>
                        setFormData({ ...formData, actualCompletionDate: value })
                      }
                    />
                  </div>

                  {showProjectLogisticsTimelineDates ? (
                    <>
                      <div id="project-in-transit-date" className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          {t("inTransitDay")}
                        </label>
                        <DatePicker
                          value={formData.inTransitDate}
                          onChange={(value) =>
                            setFormData({ ...formData, inTransitDate: value })
                          }
                          disabled={formControlsDisabled}
                        />
                      </div>

                      <div id="project-pick-up-date" className="space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          {t("pickUpDay")}
                        </label>
                        <DatePicker
                          value={formData.pickUpDate}
                          onChange={(value) =>
                            setFormData({ ...formData, pickUpDate: value })
                          }
                          disabled={formControlsDisabled}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              {requiresHoles ? (
              <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                <div className="border-b border-border px-4 py-3 lg:px-5">
                  <h2 className="text-base font-semibold">{t("details")}</h2>
                </div>
                <div className="space-y-4 p-4 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:p-5">
                  <div id="project-holes" className="space-y-2">
                    <p className="text-sm text-muted-foreground">{t("noOfHoles")}</p>
                    <div
                      className="rounded-lg border border-border bg-surface-filter-filled p-3"
                      style={{ outline: holesError ? "1px solid hsl(var(--destructive))" : "none" }}
                    >
                      <div className="grid grid-cols-3 gap-2 xl:grid-cols-5">
                      {holeOptions.map((hole) => (
                        <button
                          key={hole.value}
                          type="button"
                          onClick={() => {
                            const nextHoles = formData.holes === hole.value ? "" : hole.value;
                            setFormData({ ...formData, holes: nextHoles });
                            setHolesError(null);
                          }}
                          className="relative block cursor-pointer text-left"
                        >
                          <span
                            className={`flex min-h-10 items-center justify-center rounded-md border px-3 text-sm transition-colors ${formData.holes === hole.value
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-card text-foreground shadow-sm"
                              }`}
                          >
                            {hole.label}
                          </span>
                          {formData.holes === hole.value ? <CheckBadge /> : null}
                        </button>
                      ))}
                      </div>
                    </div>
                    {holesError ? <p className="text-xs text-destructive">{holesError}</p> : null}
                  </div>
                </div>
              </section>
              ) : null}

              {showPrivilegedPaceRecalcSetting ? (
                <section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                  <div className="border-b border-border px-4 py-3 lg:px-5">
                    <h2 className="text-base font-semibold">{t("settingsSectionTitle")}</h2>
                  </div>
                  <div className="p-4 lg:p-5">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        checked={applyPrivilegedPaceHarvestRecalc}
                        disabled={formControlsDisabled}
                        onChange={(e) =>
                          setApplyPrivilegedPaceHarvestRecalc(e.target.checked)
                        }
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-foreground">
                          {t("privilegedPaceRecalcLabel")}
                        </span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {t("privilegedPaceRecalcHint")}
                        </span>
                      </span>
                    </label>
                  </div>
                </section>
              ) : null}

              <section
                id="project-grass-info"
                className="scroll-mt-20 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3 lg:px-5">
                  <h2 className="text-base font-semibold">{t("grassRequirements")}</h2>
                  <button
                    type="button"
                    onClick={addGrassRow}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-card"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {tCommon("add")}
                  </button>
                </div>
                <div className="space-y-4 p-4 lg:p-5">
                  {grassRows.map((row) => (
                    <div
                      key={row.id}
                      className="grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto_minmax(0,0.9fr)_auto] xl:items-end"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <label className="text-sm font-medium text-foreground">{t("farm")}</label>
                        <select
                          value={row.farmId}
                          onChange={(e) =>
                            updateGrassRowFarm(row.id, e.target.value)
                          }
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                        >
                          <option value="">{tBase("HarvestForm.selectFarm")}</option>
                          {farmOptions.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <label className="text-sm font-medium text-foreground">{t("grassType")}</label>
                        <select
                          value={row.grass}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (
                              v.trim() &&
                              isDuplicateGrassLoadType(
                                grassRows,
                                row.id,
                                v,
                                row.loadType,
                              )
                            ) {
                              return;
                            }
                            setGrassRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      grass: v,
                                      keyAreaIds: v.trim() ? r.keyAreaIds : [],
                                    }
                                  : r,
                              ),
                            );
                          }}
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                        >
                          <option value="">{t("selectGrass")}</option>
                          {getGrassOptionsForRow(row).map((p) => {
                            const optionDisabled = isDuplicateGrassLoadType(
                              grassRows,
                              row.id,
                              p.id,
                              row.loadType,
                            );
                            return (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={optionDisabled}
                              >
                                {p.name}
                                {optionDisabled ? ` (${t("grassLoadTypeTaken")})` : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <label className="text-sm font-medium text-foreground">{t("keyArea")}</label>
                        <MultiSelect
                          options={keyAreaMultiOptions}
                          values={row.keyAreaIds}
                          onChange={(next) =>
                            setGrassRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, keyAreaIds: next } : r,
                              ),
                            )
                          }
                          placeholder={
                            row.grass.trim()
                              ? t("farmOptional")
                              : t("selectGrassFirst")
                          }
                          selectionSummary="compact"
                    
                          formatSelectedCount={(count) =>
                            t("keyAreasSelectedCount", { count })
                          }
                          formatMoreCount={(count) =>
                            t("keyAreasSelectedMore", { count })
                          }
                          formatManySelectedHint={() => t("keyAreasManySelectedHint")}
                          disabled={!row.grass.trim()}
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm disabled:opacity-50"
                          rightIcon={<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        />
                      </div>
                      <div className="w-fit shrink-0 space-y-2">
                        <div className="inline-grid w-auto shrink-0 grid-cols-[auto_auto_auto] gap-2 bg-surface-filter-filled">
                          {GRASS_LOAD_TYPE_OPTIONS.map((opt) => {
                            const loadTypeDisabled =
                              row.grass.trim().length > 0 &&
                              isDuplicateGrassLoadType(
                                grassRows,
                                row.id,
                                row.grass,
                                opt.value,
                              );
                            return (
                              <button
                                key={`${row.id}-${opt.value}`}
                                type="button"
                                disabled={loadTypeDisabled}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  if (row.loadType === opt.value || loadTypeDisabled) {
                                    return;
                                  }
                                  updateGrassRow(row.id, "loadType", opt.value);
                                }}
                                className={`relative w-max text-left justify-self-start ${loadTypeDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                              >
                                  <label className="text-sm font-medium text-foreground">{t(opt.labelKey)}</label>
                                <span
                                  className={`relative flex min-h-10 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 transition-colors ${opt.value === "sod_to_sprig" ? "min-w-[5.5rem]" : "min-w-[4.5rem]"} ${row.loadType === opt.value
                                      ? "border-primary bg-primary/5 text-primary"
                                      : "border-input bg-card text-foreground shadow-sm"
                                    }`}
                                >
                                 
                                  <span
                                    className={`text-sm font-semibold leading-tight ${row.loadType === opt.value
                                        ? "text-primary"
                                        : "text-foreground"
                                      }`}
                                  >
                                    {opt.uomLabel}
                                  </span>
                                  {row.loadType === opt.value ? (
                                    <CheckBadge className="left-1 top-1 h-3 w-3" />
                                  ) : null}
                                </span>
                                
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <label className="text-sm font-medium text-foreground">
                          {t("amountRequired")}
                        </label>
                        <input
                          type="number"
                          value={row.required}
                          onChange={(e) =>
                            updateGrassRow(row.id, "required", e.target.value)
                          }
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                          placeholder={t("amountPlaceholder")}
                        />
                      </div>
                      {grassRows.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeGrassRow(row.id)}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-md text-destructive hover:bg-destructive/10"
                          aria-label={tCommon("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {grassValidationError ? (
                    <p className="text-xs text-destructive">{grassValidationError}</p>
                  ) : null}
                </div>
              </section>
              </fieldset>

              <div className="sticky bottom-0 z-30 mt-8 flex flex-col gap-3 border-t border-border bg-background/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-h-5 flex-1 text-xs text-muted-foreground sm:order-1">
                  {error ? (
                    <span className="text-destructive" role="alert">
                      {error}
                    </span>
                  ) : null}
                </div>
                <div className="flex w-full flex-col gap-2 sm:order-2 sm:w-auto sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={goBack}
                    className="inline-flex h-11 min-w-[120px] items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-card"
                  >
                    {tCommon("cancel")}
                  </button>
                  {canSubmitProject ? (
                    <button
                      type="submit"
                      disabled={loading || saving}
                      aria-busy={saving}
                      className={`inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ${saving && (savePhase === "planned_harvests" || savePhase === "pace_recalc") ? "min-w-[240px]" : "min-w-[140px]"}`}
                    >
                      {submitButtonLabel}
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          </div>
        </div>
        )}

        {confirmDeleteOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            role="presentation"
            onClick={() => {
              if (!deleting) setConfirmDeleteOpen(false);
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-project-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="delete-project-title" className="text-lg font-semibold text-gray-900">
                {t("confirmDeleteTitle")}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {t("confirmDeleteMessage")}
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
                  onClick={() => void onConfirmDeleteProject()}
                  disabled={deleting}
                >
                  {deleting ? t("deleting") : tCommon("delete")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}

