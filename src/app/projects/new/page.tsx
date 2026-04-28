"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, MoreVertical, Plus, Trash2 } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  deleteMondayParentOrSubItem,
  fetchMondayProjectRowsFromServer,
  type MondayProjectServerRow,
  updateMondayProjectParentItem,
} from "@/entities/projects";
import { DatePicker } from "@/shared/ui/date-picker";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import {
  PROJECT_TYPE_VALUES,
  projectTypeMessageKey,
} from "@/features/project/lib/projectTypeDisplay";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

interface GrassRow {
  id: string;
  grass: string;
  type: string;
  required: string;
  delivered: string;
}

function normalizeProjectNameForCompare(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

const HOLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "9", label: "9" },
  { value: "18", label: "18" },
  { value: "27", label: "27" },
  { value: "36", label: "36" },
] as const;

function normalizeHoleValue(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.toLowerCase() === "none") return "none";
  return value;
}

export default function ProjectInputPage() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`ProjectForm.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const router = useRouter();
  const searchParams = useSearchParams();
  const editRowId = searchParams.get("rowId")?.trim() ?? "";
  const editTableIdFromQuery = searchParams.get("tableId")?.trim() ?? "";
  const returnToParam = searchParams.get("returnTo")?.trim() ?? "";
  const isEdit = Boolean(editRowId);
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultTableId, setDefaultTableId] = useState("");
  const [editTableId, setEditTableId] = useState(editTableIdFromQuery);
  const [projectTypeError, setProjectTypeError] = useState<string | null>(null);
  const [holesError, setHolesError] = useState<string | null>(null);
  const [keyAreasError, setKeyAreasError] = useState<string | null>(null);
  const [startDateError, setStartDateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TopFieldErrors>({});
  const [startDateTouched, setStartDateTouched] = useState(false);
  const [grassValidationError, setGrassValidationError] = useState<string | null>(null);
  /** From loaded row / API (`react_get_harvesting_table`); fallback `Harvesting` for delete. */
  const [editTableName, setEditTableName] = useState("");
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    projectType: "",
    holes: "",
    keyAreas: [] as string[],
  });

  const [grassRows, setGrassRows] = useState<GrassRow[]>([
    { id: "1", grass: "", type: "", required: "", delivered: "" },
  ]);

  /** Include legacy / unknown stored values so edit mode can show the current selection. */
  const projectTypeRadioValues = useMemo(() => {
    const cur = formData.projectType.trim();
    const canonical = PROJECT_TYPE_VALUES as readonly string[];
    if (cur && !canonical.includes(cur)) {
      return [cur, ...PROJECT_TYPE_VALUES];
    }
    return [...PROJECT_TYPE_VALUES];
  }, [formData.projectType]);

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

  const countryOptions = (countries as unknown[])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      id: String(c.id ?? "").trim(),
      name: String(c.country_name ?? c.name ?? c.title ?? "").trim(),
    }))
    .filter((x) => x.id && x.name);
  const staffOptions = (staffs as unknown[])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      id: String(s.id ?? "").trim(),
      name: String(s.first_name ?? s.full_name ?? s.name ?? "").trim(),
    }))
    .filter((x) => x.id && x.name);
  const productOptions = (products as unknown[])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      id: String(p.id ?? "").trim(),
      name: String(p.name ?? p.title ?? "").trim(),
    }))
    .filter((x) => x.id && x.name);

  useEffect(() => {
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
  }, [editRowId, isEdit]);

  useEffect(() => {
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
  }, [isEdit]);

  const addGrassRow = () => {
    setGrassRows((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        grass: "",
        type: "",
        required: "",
        delivered: "",
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
    g.required.trim().length > 0 &&
    g.type.trim().length > 0;

  const hasInvalidGrassItem = grassRows.some((g) => {
    const touched =
      g.grass.trim().length > 0 ||
      g.type.trim().length > 0 ||
      g.required.trim().length > 0;
    if (!touched) return false;
    const requiredQty = Number.parseFloat(g.required);
    return (
      !g.grass.trim() ||
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
    setFormData({
      projectName: projectNameDisplay,
      golfClub: String(row.alias_title ?? "").trim(),
      company: String((row as Record<string, unknown>).company_name ?? "").trim(),
      architect: String(
        (row as Record<string, unknown>).golf_course_architect ?? "",
      ).trim(),
      country: String(row.country_id ?? "").trim(),
      stsPic: String(row.pic ?? "").trim(),
      odooCustomerId: String(row.odoo_customer_id ?? "").trim(),
      estimateStartDate: String((row as Record<string, unknown>).estimate_start_date ?? "").trim(),
      actualStartDate: String((row as Record<string, unknown>).start_date ?? "").trim(),
      endDate: String(row.deadline ?? "").trim(),
      projectType: String(row.project_type ?? "").trim(),
      holes: normalizeHoleValue(row.no_of_holes),
      keyAreas: String(row.key_areas ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
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
      .map((x) => ({
        id: String(x.id ?? Date.now()),
        grass: String(x.product_id ?? "").trim(),
        type: String(x.uom ?? "").trim(),
        required: String(x.quantity ?? "").trim(),
        delivered: "",
      }));
    if (mapped.length) setGrassRows(mapped);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setProjectTypeError(null);
    setHolesError(null);
    setKeyAreasError(null);
    setStartDateError(null);
    setFieldErrors({});
    setGrassValidationError(null);
    setStartDateTouched(true);

    const topFieldErrors = getTopFieldErrors();
    setFieldErrors(topFieldErrors);
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
    const nextKeyAreasError = null;
    setProjectTypeError(nextProjectTypeError);
    setHolesError(nextHolesError);
    setKeyAreasError(nextKeyAreasError);
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

    const firstError =
      textFieldError ??
      nextStartDateError ??
      nextHolesError ??
      nextKeyAreasError;
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
      setSaving(true);
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
          setError("Project name already exists. Please use another project name.");
          return;
        }
      }
      // `client_source: nextjs` + `project_name` triggers server-side project resolve/create only for
      // this app. Flutter sends `project_id` from its own flow and must not set `client_source`, or
      // duplicate `sts_projects` rows would be created.
      const normalizedHoles = formData.holes.trim() || "none";
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
          key_areas: formData.keyAreas.join(","),
          quantity_required_sprig_sod: grassRows.map((r) => ({
            id: r.id,
            product_id: r.grass,
            quantity: r.required,
            uom: r.type,
          })),
        },
      };
      if (!isEdit) {
        payload.client_source = "nextjs";
      }
      const saveResponse = await updateMondayProjectParentItem(payload);
      if (saveResponse?.project && typeof saveResponse.project === "object") {
        upsertProjectInList(saveResponse.project);
      }
      router.push(returnTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const showDeleteMenu = () => setDeleteMenuOpen(true);

  const closeDeleteMenu = () => setDeleteMenuOpen(false);

  const onPickDeleteFromSheet = () => {
    closeDeleteMenu();
    setConfirmDeleteOpen(true);
  };

  const onConfirmDeleteProject = async () => {
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
      router.push(returnTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

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
                {isEdit ? (
                  <button
                    type="button"
                    onClick={showDeleteMenu}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    aria-label={t("moreActions")}
                  >
                    <MoreVertical className="h-5 w-5" strokeWidth={2.25} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-gray-900 lg:text-3xl">
                {isEdit ? t("editTitle") : t("newTitle")}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {t("projectName")} • {t("projectType")} • {t("grassRequirements")}
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">

              {/* Form */}
              <form
                onSubmit={handleSubmit}
                noValidate
                  className="space-y-3 p-4 lg:p-5 [&_input]:h-10 [&_input]:py-0 [&_select]:h-10 [&_select]:py-0 [&_textarea]:py-1.5"
              >
                {loading ? <p className="text-sm text-gray-600">{t("loadingProject")}</p> : null}
                {/*
            With `client_source: nextjs`, `data.project_name` is resolved on the server (Flutter uses
            `project_id` from its own API instead).
          */}
                <div id="project-basic-info" className="grid gap-3 lg:grid-cols-2 pb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="project-name">
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
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.projectName ? "border-red-500" : "border-gray-300"
                        }`}
                    />
                    {fieldErrors.projectName ? (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.projectName}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("stsPic")}
                    </label>
                    <select
                      id="project-sts-pic"
                      value={formData.stsPic}
                      onChange={(e) => {
                        setFormData({ ...formData, stsPic: e.target.value });
                        setFieldErrors((prev) => ({ ...prev, stsPic: undefined }));
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.stsPic ? "border-red-500" : "border-gray-300"
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
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.stsPic}</p>
                    ) : null}
                  </div>
                </div>

                {/* Company */}
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 pb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.company ? "border-red-500" : "border-gray-300"
                        }`}
                      placeholder={t("companyPlaceholder")}
                    />
                    {fieldErrors.company ? (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.company}</p>
                    ) : null}
                  </div>

                  {/* Golf Club */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.golfClub ? "border-red-500" : "border-gray-300"
                        }`}
                      placeholder={t("golfClubPlaceholder")}
                    />
                    {fieldErrors.golfClub ? (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.golfClub}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("odooCustomerRef")}
                    </label>
                    <input
                      id="project-odoo-customer-id"
                      type="text"
                      value={formData.odooCustomerId}
                      onChange={(e) => {
                        setFormData({ ...formData, odooCustomerId: e.target.value });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent"
                      placeholder={t("odooCustomerRefPlaceholder")}
                    />
                  </div>
                </div>

                {/* Architect */}
                <div className="grid gap-3 lg:grid-cols-3 pb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("architect")}
                    </label>
                    <input
                      id="project-architect"
                      type="text"
                      value={formData.architect}
                      onChange={(e) => {
                        setFormData({ ...formData, architect: e.target.value });
                        setFieldErrors((prev) => ({ ...prev, architect: undefined }));
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.architect ? "border-red-500" : "border-gray-300"
                        }`}
                      placeholder={t("architectPlaceholder")}
                    />
                    {fieldErrors.architect ? (
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.architect}</p>
                    ) : null}
                  </div>

                  {/* Country */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {tCommon("country")}
                    </label>
                    <select
                      id="project-country"
                      value={formData.country}
                      onChange={(e) => {
                        setFormData({ ...formData, country: e.target.value });
                        setFieldErrors((prev) => ({ ...prev, country: undefined }));
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#1F7A4C] focus:border-transparent ${fieldErrors.country ? "border-red-500" : "border-gray-300"
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
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.country}</p>
                    ) : null}
                  </div>
                </div>

                <div id="project-setup-info" className="grid gap-4 lg:grid-cols-3 pb-4">
                  <div id="project-estimate-start-date">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                      <p className="mt-1 text-xs text-red-600">
                        {fieldErrors.estimateStartDate}
                      </p>
                    ) : null}
                  </div>

                  <div id="project-actual-start-date">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                      <p className="mt-1 text-xs text-red-600">{startDateError}</p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">
                        {t("startDatePairHint")}
                      </p>
                    )}
                  </div>

                  <div id="project-end-date">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("endDate")}
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
                      <p className="mt-1 text-xs text-red-600">{fieldErrors.endDate}</p>
                    ) : null}
                  </div>
                </div>

                {/* Project Type */}
                <div className="pb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("projectType")}
                  </label>
                  <div
                    className="grid grid-cols-1 gap-2 rounded-lg border bg-white p-3 lg:grid-cols-2 xl:grid-cols-3"
                    style={{ borderColor: projectTypeError ? "#dc2626" : "#e5e7eb" }}
                  >
                    {projectTypeRadioValues.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          const nextType = formData.projectType === type ? "" : type;
                          setFormData({ ...formData, projectType: nextType });
                          setProjectTypeError(null);
                          setHolesError(null);
                        }}
                        className="relative block cursor-pointer text-left"
                      >
                        <span
                          className={`flex min-h-11 items-center justify-center rounded-md border px-3 text-sm transition-colors ${formData.projectType === type
                              ? "border-[var(--color-primary)] bg-white text-[var(--color-primary)]"
                              : "border-transparent bg-gray-100 text-gray-700"
                            }`}
                        >
                          {labelForProjectTypeOption(type)}
                        </span>
                        {formData.projectType === type ? (
                          <span className="absolute left-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {projectTypeError ? (
                    <p className="mt-1 text-xs text-red-600">{projectTypeError}</p>
                  ) : null}
                </div>

                <div className="pb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("details")}
                  </label>
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 pb-4">
                    <div id="project-holes">
                      <p className="mb-2 text-sm text-gray-600">{t("noOfHoles")}</p>
                      <div
                        className="grid grid-cols-3 gap-2 rounded-md xl:grid-cols-5"
                        style={{ outline: holesError ? "1px solid #dc2626" : "none" }}
                      >
                        {HOLE_OPTIONS.map((hole) => (
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
                                  ? "border-[var(--color-primary)] bg-white text-[var(--color-primary)]"
                                  : "border-transparent bg-gray-100 text-gray-700"
                                }`}
                            >
                              {hole.label}
                            </span>
                            {formData.holes === hole.value ? (
                              <span className="absolute left-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                      {holesError ? <p className="mt-1 text-xs text-red-600">{holesError}</p> : null}
                    </div>
                    <div>
                      <p className="mb-2 text-sm text-gray-600">{t("keyAreas")}</p>
                      <div
                        className="grid grid-cols-2 gap-2 rounded-md"
                        style={{ outline: keyAreasError ? "1px solid #dc2626" : "none" }}
                      >
                        {["Tees", "Roughs", "Fairways", "Greens", "Bunkers"].map((area) => (
                          <label key={area} className="relative block cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={formData.keyAreas.includes(area)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...formData.keyAreas, area]
                                  : formData.keyAreas.filter((x) => x !== area);
                                setFormData({ ...formData, keyAreas: next });
                                setKeyAreasError(null);
                              }}
                            />
                            <span
                              className={`flex min-h-10 items-center justify-center rounded-md border px-3 text-sm transition-colors ${formData.keyAreas.includes(area)
                                  ? "border-[var(--color-primary)] bg-white text-[var(--color-primary)]"
                                  : "border-transparent bg-gray-100 text-gray-700"
                                }`}
                            >
                              {area}
                            </span>
                            {formData.keyAreas.includes(area) ? (
                              <span className="absolute left-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : null}
                          </label>
                        ))}
                      </div>
                      {keyAreasError ? (
                        <p className="mt-1 text-xs text-red-600">{keyAreasError}</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Grass Requirements Section */}
                <div id="project-grass-info" className="pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-gray-700">
                      {t("grassRequirements")}
                    </label>
                    <button
                      type="button"
                      onClick={addGrassRow}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-button-primary text-white rounded-lg hover:bg-[#196A40] transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {tCommon("add")}
                    </button>
                  </div>

                  {grassRows.map((row) => (
                    <div
                      key={row.id}
                      className="mb-4 p-4 bg-white rounded-lg border border-gray-200"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">
                          {t("grassType")}
                        </span>
                        {grassRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeGrassRow(row.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid gap-3 lg:grid-cols-3">
                        <select
                          value={row.grass}
                          onChange={(e) =>
                            updateGrassRow(row.id, "grass", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] text-sm"
                        >
                          <option value="">{t("selectGrass")}</option>
                          {productOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>

                        <select
                          value={row.type}
                          onChange={(e) =>
                            updateGrassRow(row.id, "type", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] text-sm"
                        >
                          <option value="">{t("kgOrM2")}</option>
                          <option value="Kg">Kg</option>
                          <option value="M2">M2</option>
                        </select>

                        <input
                          type="number"
                          value={row.required}
                          onChange={(e) =>
                            updateGrassRow(
                              row.id,
                              "required",
                              e.target.value,
                            )
                          }
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-[#1F7A4C]"
                          placeholder={t("requiredPlaceholder")}
                        />
                      </div>
                    </div>
                  ))}
                  {grassValidationError ? (
                    <p className="mt-1 text-xs text-red-600">{grassValidationError}</p>
                  ) : null}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || saving}
                  className="w-full py-3 bg-button-primary text-white rounded-lg font-medium hover:bg-[#196A40] transition-colors mt-6 disabled:opacity-60"
                >
                  {saving ? t("saving") : isEdit ? t("updateProject") : t("createProject")}
                </button>
              </form>
            </div>
          </div>
        </div>

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

