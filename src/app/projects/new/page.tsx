"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, MoreVertical, Plus, Trash2 } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { canAccessModule } from "@/shared/auth/permissions";
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
import {
  fetchKeyAreas,
  sortKeyAreaRows,
  fetchProjectFormCatalog,
  isArchitectCatalogKey,
  isProjectCatalogKey,
  type KeyAreaRow,
  type ProjectFormCatalogRow,
} from "@/features/admin/api/adminApi";
import {
  PROJECT_TYPE_VALUES,
  projectTypeMessageKey,
} from "@/features/project/lib/projectTypeDisplay";
import {
  generatePlannedHarvestsForNewProject,
  isProjectPaceForHarvestPlan,
  persistPlannedHarvestSeedsForProject,
} from "@/features/project/lib/generatePlannedHarvestsForNewProject";
import {
  buildCountrySelectOptions,
  pickGrassCatalogRows,
  todayYmdLocal,
} from "@/shared/lib/harvestReferenceData";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { AlertRouteCategoryBanner } from "@/features/alerts/AlertRouteCategoryBanner";
import { dispatchRouteAlert } from "@/features/alerts/dispatchRouteAlert";
import { CheckBadge } from "@/shared/ui/check-badge";
import { MultiSelect } from "@/shared/ui/multi-select";
import { getInternalStsProxyUrl } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";

interface GrassRow {
  id: string;
  grass: string;
  keyAreaIds: string[];
  type: string;
  required: string;
  delivered: string;
  farmId: string;
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

function normalizeProjectNameForCompare(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function withRefreshQueryParam(target: string, key = "refresh"): string {
  const [pathAndQuery, hash = ""] = target.split("#", 2);
  const [pathname, query = ""] = pathAndQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(key, String(Date.now()));
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash ? `#${hash}` : ""}`;
}

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
  const canDeleteProject = isEdit && canDeleteProjects;
  const returnTarget = useMemo(() => {
    if (!returnToParam) return "/projects";
    let decoded = returnToParam;
    try {
      decoded = decodeURIComponent(returnToParam);
    } catch {
      decoded = returnToParam;
    }
    const safeTarget = decoded.trim();
    if (
      safeTarget.startsWith("/projects") ||
      safeTarget.startsWith("/projects/detail")
    ) {
      return safeTarget;
    }
    return "/projects";
  }, [returnToParam]);

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(returnTarget);
  }, [router, returnTarget]);

  const [loading, setLoading] = useState(isEdit);
  type ProjectSavePhase = false | "project" | "planned_harvests";
  const [savePhase, setSavePhase] = useState<ProjectSavePhase>(false);
  const saving = savePhase !== false;
  const formControlsDisabled = loading || saving || !canSubmitProject;
  const submitButtonLabel = useMemo(() => {
    if (!saving) {
      return isEdit ? t("updateProject") : t("createProject");
    }
    if (!isEdit && savePhase === "planned_harvests") {
      return t("creatingPlannedHarvests");
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
  /** From loaded row / API (`react_get_harvesting_table`); fallback `Harvesting` for delete. */
  const [editTableName, setEditTableName] = useState("");
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [projectTypeCatalogRows, setProjectTypeCatalogRows] = useState<ProjectFormCatalogRow[]>([]);
  const [architectCatalogRows, setArchitectCatalogRows] = useState<ProjectFormCatalogRow[]>([]);
  const [keyAreaCatalogRows, setKeyAreaCatalogRows] = useState<KeyAreaRow[]>([]);
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
    projectType: "",
    holes: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    projectPace: "medium" as "slow" | "medium" | "fast" | "none" | "",
  });

  const [grassRows, setGrassRows] = useState<GrassRow[]>([
    {
      id: "1",
      grass: "",
      keyAreaIds: [],
      type: "Kg",
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
  const projectTypeRadioValues = useMemo(() => {
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

  const labelForProjectTypeOption = (type: string) => {
    const mk = projectTypeMessageKey(type);
    if (mk) return t(mk);
    const low = type.toLowerCase();
    if (low === "new" || low === "grassing_project") return t("typeNew");
    if (low === "renovation" || low === "renovation_project") return t("typeRenovation");
    return type;
  };

  const requiresHoles = GOLF_COURSE_TYPES_REQUIRING_HOLES_NORMALIZED.has(
    formData.projectType.trim().toLowerCase(),
  );

  const projects = useHarvestingDataStore((s) => s.projects);
  const countries = useHarvestingDataStore((s) => s.countries);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const products = useHarvestingDataStore((s) => s.products);
  const farmsRaw = useHarvestingDataStore((s) => s.farms);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const upsertProjectInList = useHarvestingDataStore((s) => s.upsertProjectInList);

  /** Edit mode: `project_id` for resolving display title once Zustand `projects` loads. */
  const [editProjectIdForLabel, setEditProjectIdForLabel] = useState("");

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    if (!isEdit) setEditProjectIdForLabel("");
  }, [isEdit]);

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
        type: "Kg",
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
    g.keyAreaIds.length > 0 &&
    g.required.trim().length > 0 &&
    g.type.trim().length > 0;

  const hasInvalidGrassItem = grassRows.some((g) => {
    const touched =
      g.grass.trim().length > 0 ||
      g.keyAreaIds.length > 0 ||
      g.type.trim().length > 0 ||
      g.required.trim().length > 0;
    if (!touched) return false;
    const requiredQty = Number.parseFloat(g.required);
    return (
      !g.grass.trim() ||
      g.keyAreaIds.length === 0 ||
      !g.type.trim() ||
      !g.required.trim() ||
      !Number.isFinite(requiredQty) ||
      requiredQty <= 0
    );
  });

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

  const scrollToField = useCallback((elementId: string) => {
    if (typeof window === "undefined") return;
    const element = document.getElementById(elementId);
    if (!element) return;
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
  }, []);

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
    const others = [projectTypeError, holesError, startDateError, grassValidationError]
      .filter(Boolean).length;
    return topCount + others;
  }, [
    fieldErrors,
    grassValidationError,
    holesError,
    orderedTopFieldKeys,
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
    if (holesError) {
      scrollToField("project-holes");
      return;
    }
    if (grassValidationError) {
      scrollToField("project-grass-info");
    }
  }, [fieldErrors, grassValidationError, holesError, orderedTopFieldKeys, scrollToField]);

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

  const applyEditRow = (row: MondayProjectServerRow) => {
    const projectId = String(row.project_id ?? "").trim();
    setEditProjectIdForLabel(projectId);
    const fromList = projectNameOptions.find((p) => p.id === projectId);
    const titleFromRow = String(row.title ?? "").trim();
    const projectNameDisplay = fromList?.label ?? (titleFromRow || projectId);
    setEditTableName(String(row.table_name ?? "").trim());
    const rowTableId = String(row.table_id ?? "").trim();
    if (rowTableId) setEditTableId(rowTableId);
    const rec = row as Record<string, unknown>;
    const paceRaw = String(rec.project_pace ?? "").trim().toLowerCase();
    const projectPace =
      paceRaw === "slow" || paceRaw === "medium" || paceRaw === "fast"
        ? paceRaw
        : paceRaw === "none" || paceRaw === ""
          ? "none"
          : "medium";
    setFormData({
      projectName: projectNameDisplay,
      golfClub: String(row.alias_title ?? "").trim(),
      company: String(rec.company_name ?? "").trim(),
      architect: String(rec.golf_course_architect ?? "").trim(),
      country: String(row.country_id ?? "").trim(),
      stsPic: String(row.pic ?? "").trim(),
      odooCustomerId: String(row.odoo_customer_id ?? "").trim(),
      estimateStartDate: String(rec.estimate_start_date ?? "").trim(),
      actualStartDate: String(rec.start_date ?? "").trim(),
      endDate: String(row.deadline ?? "").trim(),
      actualCompletionDate: String(rec.actual_completion_date ?? "").trim(),
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
        const uomRaw = String(x.uom ?? "").trim().toLowerCase();
        const typeNorm =
          uomRaw === "m2" || uomRaw === "sqm" || uomRaw === "m²" ? "M2" : "Kg";
        return {
          id: String(x.id ?? Date.now()),
          grass: String(x.product_id ?? "").trim(),
          keyAreaIds: parseKeyAreaIds(x.key_area_id),
          type: uomRaw ? typeNorm : "Kg",
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
    if (!hasCompleteGrassItem) {
      setGrassValidationError(noCompleteGrassError);
    } else if (hasInvalidGrassItem) {
      setGrassValidationError(invalidGrassError);
    } else {
      setGrassValidationError(null);
    }

    const firstError = textFieldError ?? nextStartDateError ?? nextHolesError;
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
    if (hasInvalidGrassItem) {
      setError(invalidGrassError);
      scrollToField("project-grass-info");
      return;
    }

    try {
      setSavePhase("project");
      setError(null);
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
            return {
              id: r.id,
              product_id: r.grass,
              quantity: r.required,
              uom: r.type,
              ...(keyAreaId != null ? { key_area_id: keyAreaId } : {}),
              ...(r.farmId.trim() ? { farm_id: r.farmId.trim() } : {}),
            };
          }),
          main_contact_name: formData.contactName.trim(),
          main_contact_email: formData.contactEmail.trim(),
          main_contact_phone: formData.contactPhone.trim(),
          project_pace:
            formData.projectPace === "none" || !formData.projectPace.trim()
              ? ""
              : formData.projectPace.trim(),
          actual_completion_date: formData.actualCompletionDate.trim(),
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
      if (!isEdit && canSeedPlannedHarvestsOnCreate && projectIdStr) {
        const paceKey = formData.projectPace.trim().toLowerCase();
        if (isProjectPaceForHarvestPlan(paceKey)) {
          const anchorYmd =
            formData.estimateStartDate.trim() ||
            formData.actualStartDate.trim();
          const grassReqs = grassRows
            .filter(isGrassItemComplete)
            .map((r) => ({
              productId: r.grass.trim(),
              uom: r.type,
              amountRequired: Number.parseFloat(r.required) || 0,
            }));
          const seeds = generatePlannedHarvestsForNewProject({
            pace: paceKey,
            estimatedStartYmd: anchorYmd,
            grassRequirements: grassReqs,
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
              });
            if (ok > 0) {
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
      const nextReturnTarget = returnTarget.startsWith("/projects")
        ? withRefreshQueryParam(returnTarget)
        : returnTarget;
      if (!isEdit && projectIdStr) {
        router.push(withRefreshQueryParam(detailHrefAfterSave));
      } else {
        router.push(nextReturnTarget);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavePhase(false);
    }
  };

  const showDeleteMenu = () => setDeleteMenuOpen(true);

  const closeDeleteMenu = () => setDeleteMenuOpen(false);

  const onPickDeleteFromSheet = () => {
    closeDeleteMenu();
    setConfirmDeleteOpen(true);
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
                  onClick={showDeleteMenu}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-card hover:text-muted-foreground"
                  aria-label={t("moreActions")}
                >
                  <MoreVertical className="h-5 w-5" strokeWidth={2.25} />
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
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("projectType")}</label>
                    <div
                      className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-surface-filter-filled p-3 sm:grid-cols-2 lg:grid-cols-3"
                      style={
                        projectTypeError ? { borderColor: "hsl(var(--destructive))" } : undefined
                      }
                    >
                      {projectTypeRadioValues.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const nextType = formData.projectType === type ? "" : type;
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
                          className="relative block cursor-pointer text-left"
                        >
                          <span
                            className={`flex min-h-11 items-center justify-center rounded-md border px-3 text-sm transition-colors ${formData.projectType === type
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-card text-foreground shadow-sm"
                              }`}
                          >
                            {labelForProjectTypeOption(type)}
                          </span>
                          {formData.projectType === type ? <CheckBadge /> : null}
                        </button>
                      ))}
                    </div>
                    {projectTypeError ? (
                      <p className="text-xs text-destructive">{projectTypeError}</p>
                    ) : null}
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium text-foreground">
                      {t("projectPaceLabel")}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {t("projectPaceHint")}
                      </span>
                    </label>
                    <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-surface-filter-filled p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(
                        [
                          { value: "slow" as const, label: t("paceSlowOption") },
                          { value: "medium" as const, label: t("paceMediumOption") },
                          { value: "fast" as const, label: t("paceFastOption") },
                          { value: "none" as const, label: t("paceNoneOption") },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            const nextPace =
                              formData.projectPace === opt.value
                                ? "none"
                                : opt.value;
                            setFormData({ ...formData, projectPace: nextPace });
                          }}
                          className="relative block cursor-pointer text-left"
                        >
                          <span
                            className={`flex min-h-11 items-center justify-center rounded-md border px-3 text-center text-sm transition-colors ${formData.projectPace === opt.value
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-input bg-card text-foreground shadow-sm"
                              }`}
                          >
                            {opt.label}
                          </span>
                          {formData.projectPace === opt.value ? <CheckBadge /> : null}
                        </button>
                      ))}
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
                      hasError={Boolean(fieldErrors.endDate)}
                    />
                    {fieldErrors.endDate ? (
                      <p className="text-xs text-destructive">{fieldErrors.endDate}</p>
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

              <section
                id="project-grass-info"
                className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm"
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
                        <label className="text-sm font-medium text-foreground">{t("grassType")}</label>
                        <select
                          value={row.grass}
                          onChange={(e) => {
                            const v = e.target.value;
                            setGrassRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      grass: v,
                                      keyAreaIds: v.trim() ? r.keyAreaIds : [],
                                      farmId: v.trim() ? r.farmId : "",
                                    }
                                  : r,
                              ),
                            );
                          }}
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm"
                        >
                          <option value="">{t("selectGrass")}</option>
                          {productOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
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
                            row.grass.trim() ? t("selectKeyArea") : t("selectGrassFirst")
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
                      <div className="min-w-0 space-y-1.5">
                        <label className="text-sm font-medium text-foreground">{t("farm")}</label>
                        <select
                          value={row.farmId}
                          onChange={(e) =>
                            updateGrassRow(row.id, "farmId", e.target.value)
                          }
                          disabled={!row.grass.trim()}
                          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm disabled:opacity-50"
                        >
                          <option value="">
                            {row.grass.trim() ? t("farmOptional") : t("selectGrassFirst")}
                          </option>
                          {farmOptions.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-fit shrink-0 space-y-2">
                        <span className="block text-sm font-medium text-foreground">
                          {t("kgOrM2")}
                        </span>
                        <div className="inline-grid w-auto shrink-0 grid-cols-[auto_auto] gap-2 bg-surface-filter-filled ">
                          {(["Kg", "M2"] as const).map((u) => (
                            <button
                              key={`${row.id}-${u}`}
                              type="button"
                              onClick={() => updateGrassRow(row.id, "type", u)}
                              className="relative w-max cursor-pointer text-left justify-self-start"
                            >
                              <span
                                className={`flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm transition-colors ${row.type === u
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-input bg-card text-foreground shadow-sm"
                                  }`}
                              >
                                {u}
                              </span>
                              {row.type === u ? (
                                <CheckBadge className="left-1 top-1 h-3 w-3" />
                              ) : null}
                            </button>
                          ))}
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
                      className={`inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ${saving && !isEdit && savePhase === "planned_harvests" ? "min-w-[240px]" : "min-w-[140px]"}`}
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

        {deleteMenuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[60] bg-black/40"
              aria-label={t("closeMenuAria")}
              onClick={closeDeleteMenu}
            />
            <div
              className="fixed inset-x-0 bottom-0 z-[61] mx-auto max-w-md rounded-t-2xl border border-gray-200 bg-white shadow-lg"
              role="dialog"
              aria-label={t("actionsTitle")}
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

