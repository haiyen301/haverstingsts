"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Plus,
  Search,
  Pencil,
  Trash2,
  Truck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  defectsPreview,
  fetchVehicleInspectionFormOptions,
  fetchVehicleInspections,
  findVehicleInspectionDuplicate,
  hasDefectsText,
  removeVehicleInspection,
  saveVehicleInspection,
  type InspectionStatusOption,
  type VehicleInspectionRow,
} from "@/features/fleet/api/vehicleInspectionsApi";
import {
  DEFAULT_INSPECTION_STATUSES,
  FLEET_OPTION_CATALOG_KEYS,
} from "@/features/fleet/api/fleetOptionCatalogApi";
import { fuelUsageFuelKindLabel } from "@/features/fleet/api/fuelUsageApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateDisplayDmy } from "@/shared/lib/format/date";
import { canAccessModule } from "@/shared/auth/permissions";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useFarmUserScope, useScopedFarmSelectOptions } from "@/shared/store/farmUserScope";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { DatePicker } from "@/shared/ui/date-picker";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const datePickerClass = "h-9 rounded-md text-sm shadow-sm";
const fieldClass = "flex min-w-0 flex-col gap-1.5";
const labelClass = "text-xs font-medium text-foreground";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const textareaClass =
  "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const STATUS_STYLE: Record<string, { className: string; icon: typeof CheckCircle2 }> = {
  pass: { className: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  fail: { className: "bg-red-100 text-red-800", icon: AlertTriangle },
  due: { className: "bg-amber-100 text-amber-800", icon: Clock },
  overdue: { className: "bg-red-100 text-red-800", icon: AlertTriangle },
};

const DEFAULT_STATUSES: InspectionStatusOption[] = DEFAULT_INSPECTION_STATUSES;

type FormState = {
  id?: number;
  vehicle_name: string;
  alias_name: string;
  vehicle_type: string;
  fuel_kind: string;
  farm_id: string;
  registration: string;
  last_inspection_date: string;
  next_due_date: string;
  status: string;
  defects: string;
  notes: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(farmId = "", defaultStatus = "pass", vehicleTypeDefault = ""): FormState {
  return {
    vehicle_name: "",
    alias_name: "",
    vehicle_type: vehicleTypeDefault,
    fuel_kind: "",
    farm_id: farmId,
    registration: "",
    last_inspection_date: todayIso(),
    next_due_date: "",
    status: defaultStatus,
    defects: "",
    notes: "",
  };
}

function statusLabel(
  statuses: InspectionStatusOption[],
  value: string,
  t: (key: string) => string,
): string {
  const fromApi = statuses.find((s) => s.value === value)?.label;
  if (fromApi) return fromApi;
  const key = `status.${value}`;
  try {
    return t(key);
  } catch {
    return value;
  }
}

export function VehicleInspectionsTab() {
  const t = useTranslations("VehicleInspections");
  const user = useAuthUserStore((s) => s.user);
  const canCreate = canAccessModule(user, "vehicle_inspections", "create");
  const canEdit = canAccessModule(user, "vehicle_inspections", "edit");
  const canDelete = canAccessModule(user, "vehicle_inspections", "delete");
  const canManageRows = canEdit || canDelete;
  const { types: machineryTypes } = useMachineryTypes();
  const { options: fuelTypeOptions } = useFleetOptionCatalog(
    FLEET_OPTION_CATALOG_KEYS.fuelTypes,
  );
  const fuelKindLabelByValue = useMemo(() => {
    const map: Record<string, string> = {};
    for (const option of fuelTypeOptions) {
      map[String(option.value).toLowerCase()] = option.label;
    }
    return map;
  }, [fuelTypeOptions]);
  const fuelKindFallback = useMemo(
    () => ({ diesel: t("fuelKind.diesel"), petrol: t("fuelKind.petrol") }),
    [t],
  );
  const scopedFarmOptions = useScopedFarmSelectOptions("vehicle_inspections");
  const { scopeIds } = useFarmUserScope("vehicle_inspections");
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const [rows, setRows] = useState<VehicleInspectionRow[]>([]);
  const [statuses, setStatuses] = useState<InspectionStatusOption[]>(DEFAULT_STATUSES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [farmFilter, setFarmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());

  const loadFormOptions = useCallback(async () => {
    try {
      const options = await fetchVehicleInspectionFormOptions();
      if (options.statuses?.length) setStatuses(options.statuses);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.loadOptions"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { farm_id?: number; status?: string } = {};
      if (farmFilter !== "all") params.farm_id = Number(farmFilter);
      if (statusFilter !== "all") params.status = statusFilter;
      const data = await fetchVehicleInspections(params);
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [farmFilter, statusFilter, t]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData(false);
    void loadFormOptions();
  }, [fetchAllHarvestingReferenceData, loadFormOptions]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!scopeIds?.length || farmFilter === "all") return;
    if (!scopeIds.includes(farmFilter)) setFarmFilter("all");
  }, [farmFilter, scopeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((v) => {
      const hay = [v.vehicle_name, v.alias_name, v.registration, v.vehicle_type, v.farm_name, v.defects]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const overdueCount = rows.filter((v) => v.status === "overdue" || v.status === "fail").length;
  const openDefectsCount = rows.filter((v) => hasDefectsText(v.defects)).length;

  const fuelTypeSelectOptions = useMemo(
    () => fuelTypeOptions.map((option) => ({ value: String(option.value), label: option.label })),
    [fuelTypeOptions],
  );

  const farmOptions = useMemo(
    () => scopedFarmOptions.map((farm) => ({ value: farm.id, label: farm.label })),
    [scopedFarmOptions],
  );

  const machineryTypeOptions = useMemo(
    () => machineryTypes.map((type) => ({ value: type, label: type })),
    [machineryTypes],
  );

  const statusOptions = useMemo(
    () => statuses.map((status) => ({ value: status.value, label: status.label })),
    [statuses],
  );

  const openCreate = () => {
    const firstFarm = scopedFarmOptions[0];
    const defaultStatus = statuses[0]?.value ?? "pass";
    setEditingId(null);
    setForm(
      emptyForm(
        firstFarm ? firstFarm.id : "",
        defaultStatus,
        machineryTypes[0] ?? "",
      ),
    );
    setDialogOpen(true);
  };

  const openEdit = (row: VehicleInspectionRow) => {
    setEditingId(Number(row.id));
    setForm({
      id: Number(row.id),
      vehicle_name: String(row.vehicle_name ?? ""),
      alias_name: String(row.alias_name ?? ""),
      vehicle_type: row.vehicle_type || machineryTypes[0] || "",
      fuel_kind: String(row.fuel_kind ?? ""),
      farm_id: String(row.farm_id),
      registration: String(row.registration ?? ""),
      last_inspection_date: String(row.last_inspection_date ?? "").slice(0, 10),
      next_due_date: String(row.next_due_date ?? "").slice(0, 10),
      status: row.status || statuses[0]?.value || "pass",
      defects: String(row.defects ?? ""),
      notes: String(row.notes ?? ""),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  const handleFarmChange = (nextFarmId: string) => {
    setForm((f) => (f.farm_id === nextFarmId ? f : { ...f, farm_id: nextFarmId }));
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const vehicleName = form.vehicle_name.trim();
    if (
      vehicleName === "" ||
      !form.vehicle_type ||
      !Number.isFinite(farmId) ||
      farmId <= 0
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    const fuelKind = form.fuel_kind.trim() || null;
    const duplicate = findVehicleInspectionDuplicate(
      rows,
      {
        vehicle_name: vehicleName,
        vehicle_type: form.vehicle_type,
        fuel_kind: fuelKind,
        farm_id: farmId,
      },
      editingId ?? 0,
    );
    if (duplicate) {
      toast.error(t("errors.duplicate"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    try {
      setSaving(true);
      const shared = {
        vehicle_name: vehicleName,
        alias_name: form.alias_name.trim() || undefined,
        vehicle_type: form.vehicle_type,
        fuel_kind: fuelKind,
        farm_id: farmId,
        registration: form.registration.trim() || undefined,
        last_inspection_date: form.last_inspection_date || undefined,
        next_due_date: form.next_due_date || undefined,
        status: form.status,
        defects: form.defects.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (editingId) {
        await saveVehicleInspection({ id: editingId, ...shared });
        toast.success(t("updated"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      } else {
        await saveVehicleInspection({ ...shared });
        toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      }
      closeDialog();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: VehicleInspectionRow) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      await removeVehicleInspection(Number(row.id));
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("newInspection")}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.total")}</p><p className="text-2xl font-bold">{rows.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.passed")}</p><p className="text-2xl font-bold text-primary">{rows.filter((v) => v.status === "pass").length}</p></CardContent></Card>
        <Card className="border-destructive/30"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.attention")}</p><p className="text-2xl font-bold text-destructive">{overdueCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.defects")}</p><p className="text-2xl font-bold text-amber-600">{openDefectsCount}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-[160px]">
          <MultiSelect
            options={farmOptions}
            values={farmFilter !== "all" ? [farmFilter] : []}
            onChange={(next) => setFarmFilter(next[0] ?? "all")}
            multi={false}
            showAllOption
            allOptionLabel={t("filters.allFarms")}
            placeholder={t("filters.allFarms")}
            className={selectClass}
            rightIcon={selectChevron}
            showSelectedChipsInPopover={false}
          />
        </div>
        <div className="w-[160px]">
          <MultiSelect
            options={statusOptions}
            values={statusFilter !== "all" ? [statusFilter] : []}
            onChange={(next) => setStatusFilter(next[0] ?? "all")}
            multi={false}
            showAllOption
            allOptionLabel={t("filters.allStatuses")}
            placeholder={t("filters.allStatuses")}
            className={selectClass}
            rightIcon={selectChevron}
            showSelectedChipsInPopover={false}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">{t("table.vehicle")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.aliasName")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.type")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.fuelType")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.lastInspection")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.nextDue")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.defects")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.status")}</th>
                    {canManageRows ? (
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => {
                    const sc = STATUS_STYLE[v.status] ?? STATUS_STYLE.pass;
                    const Icon = sc.icon;
                    const defectText = defectsPreview(v.defects);
                    return (
                      <tr key={v.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{v.vehicle_name}</p>
                              <p className="text-xs text-muted-foreground">{v.registration || "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">{v.alias_name?.trim() || "—"}</td>
                        <td className="px-4 py-3">{v.vehicle_type}</td>
                        <td className="px-4 py-3">
                          {v.fuel_kind ? (
                            <span className="inline-flex rounded-md bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                              {fuelUsageFuelKindLabel(
                                v.fuel_kind,
                                fuelKindLabelByValue,
                                fuelKindFallback,
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">{v.farm_name ?? v.farm_id}</td>
                        <td className="px-4 py-3">{formatDateDisplayDmy(v.last_inspection_date)}</td>
                        <td className="px-4 py-3">{formatDateDisplayDmy(v.next_due_date)}</td>
                        <td className="px-4 py-3 max-w-[220px]">
                          {hasDefectsText(v.defects) ? (
                            <span className="line-clamp-2 text-xs text-red-800" title={String(v.defects ?? "")}>
                              {defectText}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("table.none")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", sc.className)}>
                            <Icon className="h-3 w-3" />
                            {statusLabel(statuses, v.status, t)}
                          </span>
                        </td>
                        {canManageRows ? (
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
                              {canEdit ? (
                                <button type="button" className={btnGhost} disabled={saving} onClick={() => openEdit(v)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              {canDelete ? (
                                <button type="button" className={cn(btnGhost, "text-destructive hover:bg-destructive/10")} disabled={saving} onClick={() => void handleDelete(v)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr><td colSpan={canManageRows ? 10 : 9} className="px-4 py-8 text-center text-muted-foreground">{t("table.empty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <h2 className="text-lg font-semibold">
              {editingId ? t("dialog.editTitle") : t("dialog.title")}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className={cn(fieldClass, "sm:col-span-2")}>
                <span className={labelClass}>{t("dialog.farm")} *</span>
                <MultiSelect
                  options={farmOptions}
                  values={form.farm_id ? [form.farm_id] : []}
                  onChange={(next) => handleFarmChange(next[0] ?? "")}
                  multi={false}
                  placeholder={t("dialog.selectFarm")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  disabled={saving}
                />
              </div>
              <div className={cn(fieldClass, "sm:col-span-2")}>
                <span className={labelClass}>{t("dialog.vehicleName")} *</span>
                <input
                  className={inputClass}
                  value={form.vehicle_name}
                  placeholder={t("dialog.vehicleNamePlaceholder")}
                  disabled={saving || !form.farm_id}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_name: e.target.value }))}
                />
              </div>
              <div className={cn(fieldClass, "sm:col-span-2")}>
                <span className={labelClass}>{t("dialog.aliasName")}</span>
                <input
                  className={inputClass}
                  value={form.alias_name}
                  placeholder={t("dialog.aliasNamePlaceholder")}
                  disabled={saving || !form.farm_id}
                  onChange={(e) => setForm((f) => ({ ...f, alias_name: e.target.value }))}
                />
              </div>
              <div className={fieldClass}>
                <span className={labelClass}>{t("dialog.type")} *</span>
                <MultiSelect
                  options={machineryTypeOptions}
                  values={form.vehicle_type ? [form.vehicle_type] : []}
                  onChange={(next) => setForm((f) => ({ ...f, vehicle_type: next[0] ?? "" }))}
                  multi={false}
                  placeholder={t("dialog.type")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  disabled={saving || !form.farm_id}
                />
              </div>
              <div className={fieldClass}>
                <span className={labelClass}>{t("dialog.fuelType")}</span>
                <select
                  className={selectClass}
                  value={form.fuel_kind}
                  disabled={saving || !form.farm_id}
                  onChange={(e) => setForm((f) => ({ ...f, fuel_kind: e.target.value }))}
                >
                  <option value="">{t("dialog.selectFuelType")}</option>
                  {fuelTypeSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {form.fuel_kind &&
                  !fuelTypeSelectOptions.some((option) => option.value === form.fuel_kind) ? (
                    <option value={form.fuel_kind}>
                      {fuelUsageFuelKindLabel(
                        form.fuel_kind,
                        fuelKindLabelByValue,
                        fuelKindFallback,
                      )}
                    </option>
                  ) : null}
                </select>
              </div>
              <div className={cn(fieldClass, "sm:col-span-2")}>
                <span className={labelClass}>{t("dialog.registration")}</span>
                <input
                  className={inputClass}
                  value={form.registration}
                  disabled={saving || !form.farm_id}
                  onChange={(e) => setForm((f) => ({ ...f, registration: e.target.value }))}
                />
              </div>
              <div className={fieldClass}>
                <span className={labelClass}>{t("dialog.lastInspection")}</span>
                <DatePicker
                  value={form.last_inspection_date}
                  onChange={(v) => setForm((f) => ({ ...f, last_inspection_date: v }))}
                  placeholder={t("dialog.datePlaceholder")}
                  disabled={saving || !form.farm_id}
                  className={datePickerClass}
                />
              </div>
              <div className={fieldClass}>
                <span className={labelClass}>{t("dialog.nextDue")}</span>
                <DatePicker
                  value={form.next_due_date}
                  onChange={(v) => setForm((f) => ({ ...f, next_due_date: v }))}
                  placeholder={t("dialog.datePlaceholder")}
                  disabled={saving || !form.farm_id}
                  className={datePickerClass}
                />
              </div>
              <div className={fieldClass}>
                <span className={labelClass}>{t("dialog.status")}</span>
                <MultiSelect
                  options={statusOptions}
                  values={form.status ? [form.status] : []}
                  onChange={(next) => setForm((f) => ({ ...f, status: next[0] ?? "" }))}
                  multi={false}
                  placeholder={t("dialog.status")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  disabled={saving || !form.farm_id}
                />
              </div>
              <div className={cn(fieldClass, "sm:col-span-2")}>
                <span className={labelClass}>{t("dialog.defects")}</span>
                <textarea
                  className={textareaClass}
                  rows={4}
                  placeholder={t("dialog.defectsPlaceholder")}
                  value={form.defects}
                  disabled={saving || !form.farm_id}
                  onChange={(e) => setForm((f) => ({ ...f, defects: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={closeDialog}>{t("dialog.cancel")}</button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>{t("dialog.save")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
