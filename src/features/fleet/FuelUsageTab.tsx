"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  ArrowDown,
  DollarSign,
  Fuel,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchFuelUsage,
  fuelUsageVehicleLabel,
  removeFuelUsage,
  saveFuelUsage,
  type FuelUsageRow,
} from "@/features/fleet/api/fuelUsageApi";
import {
  fetchVehicleInspections,
  type VehicleInspectionRow,
} from "@/features/fleet/api/vehicleInspectionsApi";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import {
  DashboardKpiDateFilter,
  KPI_DATE_PRESET_FUEL,
} from "@/features/dashboard/DashboardKpiDateFilter";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import {
  formatDecimalInput,
  formatDecimalInputFromValue,
  formatNumber,
  stripDecimalGrouping,
} from "@/shared/lib/format/number";
import {
  type KpiDatePreset,
  type KpiDeliveryDateFilter,
  kpiDateRangeFromFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const textareaClass =
  "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

const FUEL_DATE_FILTER_BASELINE: KpiDatePreset = "all";

type EntryForm = {
  fuel_date: string;
  farm_id: string;
  vehicle_inspection_id: string;
  vehicle_type: string;
  litres: string;
  cost_per_litre: string;
  odometer_km: string;
  operator_id: string;
  purpose: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(farmId = "", vehicleTypeDefault = ""): EntryForm {
  return {
    fuel_date: todayIso(),
    farm_id: farmId,
    vehicle_inspection_id: "",
    vehicle_type: vehicleTypeDefault,
    litres: "",
    cost_per_litre: "",
    odometer_km: "",
    operator_id: "",
    purpose: "",
  };
}

function num(v: unknown): number {
  const n = Number(stripDecimalGrouping(String(v ?? "")));
  return Number.isFinite(n) ? n : 0;
}

function parseDecimalField(raw: string): number {
  const n = Number(stripDecimalGrouping(raw.trim()));
  return Number.isFinite(n) ? n : NaN;
}

function parseIntegerField(raw: string): number {
  const n = Number(stripDecimalGrouping(raw.trim()));
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

function lineCost(row: FuelUsageRow): number {
  return num(row.litres) * num(row.cost_per_litre);
}

function staffDisplayName(row: Record<string, unknown>): string {
  const firstName = String(row.first_name ?? "").trim();
  const lastName = String(row.last_name ?? "").trim();
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullNameFromParts || String(row.full_name ?? row.name ?? "").trim();
}

function inspectionVehicleLabel(row: VehicleInspectionRow): string {
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  if (alias && name && alias !== name) {
    return `${alias} (${name})`;
  }
  return alias || name || `#${row.id}`;
}

export function FuelUsageTab() {
  const t = useTranslations("FuelUsage");
  const { types: machineryTypes } = useMachineryTypes();
  const farms = useHarvestingDataStore((s) => s.farms);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const {
    selectedFarmIds,
    setSelectedFarmIds,
    farmOptions,
    farmNameById: scopedFarmNameById,
  } = useSyncedFarmMultiSelect("harvests");

  const [entries, setEntries] = useState<FuelUsageRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleInspectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kpiDateFilter, setKpiDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: "lastWeek",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<EntryForm>(() => emptyForm());

  const farmNameById = useMemo(() => {
    const map = new Map(scopedFarmNameById);
    for (const farm of farms) {
      const id = String((farm as { id?: unknown }).id ?? "").trim();
      const name = String((farm as { name?: unknown }).name ?? "").trim();
      if (id && !map.has(id)) map.set(id, name || id);
    }
    return map;
  }, [farms, scopedFarmNameById]);

  const dateRange = useMemo(() => kpiDateRangeFromFilter(kpiDateFilter), [kpiDateFilter]);
  const hasActiveDateFilter = kpiDateFilter.preset !== FUEL_DATE_FILTER_BASELINE;

  const fuelPresetLabelMap = useMemo(
    (): Partial<Record<KpiDatePreset, string>> => ({
      all: t("filters.allTime"),
      today: t("filters.today"),
      lastWeek: t("filters.thisWeek"),
      lastMonth: t("filters.thisMonth"),
      lastQuarter: t("filters.thisQuarter"),
    }),
    [t],
  );

  const staffOptions = useMemo(() => {
    return (staffs as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => {
        const id = String(s.id ?? "").trim();
        const name = staffDisplayName(s);
        return { id, name: name || id };
      })
      .filter((s) => s.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffs]);

  const formVehicles = useMemo(() => {
    if (!form.farm_id) return vehicles;
    return vehicles.filter((v) => String(v.farm_id) === form.farm_id);
  }, [form.farm_id, vehicles]);

  const loadVehicles = useCallback(async () => {
    try {
      const rows = await fetchVehicleInspections();
      setVehicles(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.loadVehicles"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        farm_ids?: string;
        fuel_from?: string;
        fuel_to?: string;
      } = {};
      if (selectedFarmIds.length > 0) {
        params.farm_ids = selectedFarmIds.join(",");
      }
      if (hasActiveDateFilter) {
        if (dateRange.start) params.fuel_from = dateRange.start;
        if (dateRange.end) params.fuel_to = dateRange.end;
      }
      const usageRows = await fetchFuelUsage(params);
      setEntries(usageRows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedFarmIds, hasActiveDateFilter, dateRange.start, dateRange.end, t]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData(false);
    void loadVehicles();
  }, [fetchAllHarvestingReferenceData, loadVehicles]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = entries;
  const totalLitres = filtered.reduce((s, e) => s + num(e.litres), 0);
  const totalCost = filtered.reduce((s, e) => s + lineCost(e), 0);
  const avgPerEntry = filtered.length > 0 ? totalLitres / filtered.length : 0;

  const openCreate = () => {
    const firstFarm = farms[0] as { id?: unknown } | undefined;
    setEditingId(null);
    setForm(
      emptyForm(
        firstFarm ? String(firstFarm.id ?? "") : "",
        machineryTypes[0] ?? "",
      ),
    );
    setDialogOpen(true);
  };

  const openEdit = (row: FuelUsageRow) => {
    setEditingId(Number(row.id));
    setForm({
      fuel_date: String(row.fuel_date).slice(0, 10),
      farm_id: String(row.farm_id),
      vehicle_inspection_id: String(row.vehicle_inspection_id),
      vehicle_type: String(row.vehicle_type ?? ""),
      litres: formatDecimalInputFromValue(row.litres),
      cost_per_litre: formatDecimalInputFromValue(row.cost_per_litre),
      odometer_km: formatDecimalInputFromValue(row.odometer_km),
      operator_id: row.operator_id ? String(row.operator_id) : "",
      purpose: String(row.purpose ?? ""),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  const handleVehicleChange = (vehicleInspectionId: string) => {
    const selected = vehicles.find((v) => String(v.id) === vehicleInspectionId);
    setForm((f) => ({
      ...f,
      vehicle_inspection_id: vehicleInspectionId,
      vehicle_type: selected?.vehicle_type ?? f.vehicle_type,
    }));
  };

  const handleFarmChange = (farmId: string) => {
    setForm((f) => {
      const stillValid = farmId
        ? vehicles.some(
            (v) => String(v.id) === f.vehicle_inspection_id && String(v.farm_id) === farmId,
          )
        : false;
      return {
        ...f,
        farm_id: farmId,
        vehicle_inspection_id: stillValid ? f.vehicle_inspection_id : "",
      };
    });
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const vehicleInspectionId = Number(form.vehicle_inspection_id);
    const litres = parseDecimalField(form.litres);
    const costPerLitre = form.cost_per_litre.trim()
      ? parseDecimalField(form.cost_per_litre)
      : undefined;
    const odometerKm = form.odometer_km.trim()
      ? parseIntegerField(form.odometer_km)
      : undefined;
    if (
      !form.fuel_date ||
      !Number.isFinite(farmId) ||
      farmId <= 0 ||
      !Number.isFinite(vehicleInspectionId) ||
      vehicleInspectionId <= 0 ||
      !Number.isFinite(litres) ||
      litres <= 0
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    if (
      costPerLitre !== undefined &&
      (!Number.isFinite(costPerLitre) || costPerLitre < 0)
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    if (
      odometerKm !== undefined &&
      (!Number.isFinite(odometerKm) || odometerKm < 0)
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveFuelUsage({
        id: editingId ?? undefined,
        fuel_date: form.fuel_date,
        farm_id: farmId,
        vehicle_inspection_id: vehicleInspectionId,
        vehicle_type: form.vehicle_type,
        litres,
        cost_per_litre: costPerLitre,
        odometer_km: odometerKm,
        operator_id: form.operator_id ? Number(form.operator_id) : undefined,
        purpose: form.purpose.trim() || undefined,
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
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

  const handleDelete = async (row: FuelUsageRow) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      await removeFuelUsage(Number(row.id));
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

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t("logFuel")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Fuel className="mt-1 h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.totalLitres")}</p>
              <p className="text-2xl font-bold">
                {formatNumber(totalLitres, { maximumFractionDigits: 3 })}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <DollarSign className="mt-1 h-8 w-8 text-accent-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.totalCost")}</p>
              <p className="text-2xl font-bold">
                ${formatNumber(totalCost, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <TrendingUp className="mt-1 h-8 w-8 text-sky-600" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.avgPerFill")}</p>
              <p className="text-2xl font-bold">
                {formatNumber(avgPerEntry, { maximumFractionDigits: 1 })} L
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <TrendingDown className="mt-1 h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.entries")}</p>
              <p className="text-2xl font-bold">{filtered.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <MultiSelect
          options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
          values={selectedFarmIds}
          onChange={setSelectedFarmIds}
          placeholder={t("filters.allFarms")}
          showAllOption
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <DashboardKpiDateFilter
          value={kpiDateFilter}
          onChange={setKpiDateFilter}
          presets={KPI_DATE_PRESET_FUEL}
          baselinePreset={FUEL_DATE_FILTER_BASELINE}
          presetLabelMap={fuelPresetLabelMap}
          className="shrink-0"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">{t("table.date")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.vehicle")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.litres")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.cost")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.odometer")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.operator")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.purpose")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateDisplay(e.fuel_date)}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{fuelUsageVehicleLabel(e)}</p>
                          {e.vehicle_type ? (
                            <p className="text-xs text-muted-foreground">{e.vehicle_type}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {e.farm_name ?? farmNameById.get(String(e.farm_id)) ?? e.farm_id}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {formatNumber(e.litres, { maximumFractionDigits: 3 })} L
                      </td>
                      <td className="px-4 py-3">
                        ${formatNumber(lineCost(e), { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        {e.odometer_km != null
                          ? `${formatNumber(e.odometer_km, { maximumFractionDigits: 0 })} km`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {e.operator_name?.trim() || "—"}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground">
                        {e.purpose?.trim() || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={saving}
                            onClick={() => openEdit(e)}
                            aria-label={t("dialog.editTitle")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={cn(btnGhost, "text-destructive hover:bg-destructive/10")}
                            disabled={saving}
                            onClick={() => void handleDelete(e)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                        {t("table.empty")}
                      </td>
                    </tr>
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
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.date")} *</span>
                <input
                  type="date"
                  className={inputClass}
                  value={form.fuel_date}
                  onChange={(e) => setForm((f) => ({ ...f, fuel_date: e.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.farm")} *</span>
                <select
                  className={inputClass}
                  value={form.farm_id}
                  onChange={(e) => handleFarmChange(e.target.value)}
                >
                  <option value="">{t("dialog.selectFarm")}</option>
                  {farms.map((farm) => {
                    const id = String((farm as { id?: unknown }).id ?? "");
                    return (
                      <option key={id} value={id}>
                        {String((farm as { name?: unknown }).name ?? id)}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.vehicle")} *</span>
                <select
                  className={inputClass}
                  value={form.vehicle_inspection_id}
                  onChange={(e) => handleVehicleChange(e.target.value)}
                  disabled={!form.farm_id}
                >
                  <option value="">{t("dialog.selectVehicle")}</option>
                  {formVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={String(vehicle.id)}>
                      {inspectionVehicleLabel(vehicle)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.vehicleType")}</span>
                <select
                  className={inputClass}
                  value={form.vehicle_type}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                >
                  {machineryTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.litres")} *</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.litres}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, litres: formatDecimalInput(e.target.value) }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.costPerLitre")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.cost_per_litre}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      cost_per_litre: formatDecimalInput(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.odometer")}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.odometer_km}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      odometer_km: formatDecimalInput(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.operator")}</span>
                <select
                  className={inputClass}
                  value={form.operator_id}
                  onChange={(e) => setForm((f) => ({ ...f, operator_id: e.target.value }))}
                >
                  <option value="">{t("dialog.selectOperator")}</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-xs font-medium">{t("dialog.purpose")}</span>
                <textarea
                  className={textareaClass}
                  placeholder={t("dialog.purposePlaceholder")}
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={closeDialog}>
                {t("dialog.cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {t("dialog.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
