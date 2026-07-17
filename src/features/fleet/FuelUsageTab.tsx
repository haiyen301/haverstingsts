"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowDown,
  ChevronDown,
  DollarSign,
  Fuel,
  Info,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Download,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchFuelUsage,
  fuelUsageFuelKindLabel,
  fuelUsageVehicleLabel,
  fuelUsageVehiclePrimaryName,
  fuelUsageVehicleTypeAliasLine,
  removeFuelUsage,
  saveFuelUsage,
  suggestFuelUsageCost,
  type FuelUsageRow,
} from "@/features/fleet/api/fuelUsageApi";
import { FLEET_OPTION_CATALOG_KEYS } from "@/features/fleet/api/fleetOptionCatalogApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
import { FuelStockLedgerPanel, type FuelStockBalanceResumeState } from "@/features/fleet/FuelStockLedgerPanel";
import { FuelStockImportDialog } from "@/features/fleet/ui/FuelStockImportDialog";
import { FuelUsageImportDialog } from "@/features/fleet/ui/FuelUsageImportDialog";
import { FuelUsageExportDialog } from "@/features/fleet/ui/FuelUsageExportDialog";
import { FuelUsageBalanceBreakdownPanel } from "@/features/fleet/ui/FuelUsageBalanceBreakdownPanel";
import {
  buildFuelUsageBalanceIndex,
  farmFuelBalanceKey,
  fuelRowHasRemaining,
  fuelRowRemainingLitres,
  fuelTimelineUpToUsageId,
  normalizeFuelKind,
} from "@/features/fleet/lib/fuelUsageBalance";
import {
  fetchFleetStockLedger,
  type FleetStockLedgerRow,
} from "@/features/fleet/api/fleetStockLedgerApi";
import { useSearchParams } from "next/navigation";
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
  formatDecimalDisplay,
  formatDecimalInput,
  formatDecimalInputFromValue,
  formatNumber,
  normalizeDecimalTyping,
  normalizedDecimalApiString,
  parseDecimalField,
  stripDecimalGrouping,
} from "@/shared/lib/format/number";
import {
  type KpiDatePreset,
  type KpiDeliveryDateFilter,
  kpiDateRangeFromFilter,
} from "@/shared/lib/dashboardKpiProjectFilters";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { canAccessModule } from "@/shared/auth/permissions";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const textareaClass =
  "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const tabBtn =
  "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors";
const tabBtnActive = "bg-muted text-foreground shadow-sm";
const tabBtnIdle = "text-muted-foreground hover:text-foreground hover:bg-muted/60";
const CHART_FILL = "hsl(152,55%,36%)";
const CHART_ROW_HEIGHT = 32;
const CHART_MIN_HEIGHT = 300;
const CHART_MAX_VIEWPORT = 420;

const FUEL_DATE_FILTER_BASELINE: KpiDatePreset = "all";
const USAGE_LIST_PAGE_SIZE = 40;

type BreakdownTab = "vehicle" | "fuel" | "farm" | "type";

type EntryForm = {
  fuel_date: string;
  farm_id: string;
  vehicle_inspection_id: string;
  vehicle_type: string;
  fuel_kind: string;
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
    fuel_kind: "",
    litres: "",
    cost_per_litre: "",
    odometer_km: "",
    operator_id: "",
    purpose: "",
  };
}

function num(v: unknown): number {
  const n = Number(
    stripDecimalGrouping(normalizeDecimalTyping(String(v ?? "").trim())),
  );
  return Number.isFinite(n) ? n : 0;
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
    return `${name} (${alias})`;
  }
  return name || alias || `#${row.id}`;
}

function inspectionVehicleSelectOption(row: VehicleInspectionRow): {
  value: string;
  label: string;
  subLabel?: string;
} {
  const alias = String(row.alias_name ?? "").trim();
  const name = String(row.vehicle_name ?? "").trim();
  const label = name || alias || `#${row.id}`;
  const subLabel =
    alias && name && alias !== name ? `(${alias})` : undefined;
  return { value: String(row.id), label, subLabel };
}

function dedupeFuelUsageRows(rows: FuelUsageRow[]): FuelUsageRow[] {
  const seen = new Set<number>();
  const deduped: FuelUsageRow[] = [];
  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) {
      deduped.push(row);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(row);
  }
  return deduped;
}

export function FuelUsageTab() {
  const t = useTranslations("FuelUsage");
  const searchParams = useSearchParams();
  const user = useAuthUserStore((s) => s.user);
  const canCreate = canAccessModule(user, "fuel_usage", "create");
  const canImport =
    canAccessModule(user, "fuel_usage", "import") || canCreate;
  const canEdit = canAccessModule(user, "fuel_usage", "edit");
  const canDelete = canAccessModule(user, "fuel_usage", "delete");
  const canExport = canAccessModule(user, "fuel_usage", "export");
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
    () => ({ diesel: t("stock.diesel"), petrol: t("stock.petrol") }),
    [t],
  );
  const fuelKindFilterOptions = useMemo(
    () =>
      fuelTypeOptions.map((option) => ({
        value: String(option.value).toLowerCase(),
        label: option.label,
      })),
    [fuelTypeOptions],
  );
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
  } = useSyncedFarmMultiSelect("fuel_usage");

  const [entries, setEntries] = useState<FuelUsageRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<FleetStockLedgerRow[]>([]);
  const [balanceUsageRows, setBalanceUsageRows] = useState<FuelUsageRow[]>([]);
  const [balanceBreakdownUsageId, setBalanceBreakdownUsageId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<VehicleInspectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kpiDateFilter, setKpiDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: "thisMonth",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<EntryForm>(() => emptyForm());
  const [costManuallyEdited, setCostManuallyEdited] = useState(false);
  const [costSuggestHint, setCostSuggestHint] = useState<string | null>(null);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [stockImportOpen, setStockImportOpen] = useState(false);
  const [balanceResume, setBalanceResume] = useState<FuelStockBalanceResumeState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [listVisibleCount, setListVisibleCount] = useState(USAGE_LIST_PAGE_SIZE);
  const [stockReloadToken, setStockReloadToken] = useState(0);
  const [selectedFuelKinds, setSelectedFuelKinds] = useState<string[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>("vehicle");
  const loadSeqRef = useRef(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreLockRef = useRef(false);

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
      thisWeek: t("filters.thisWeek"),
      thisMonth: t("filters.thisMonth"),
      thisQuarter: t("filters.thisQuarter"),
      lastWeek: t("filters.lastWeek"),
      lastMonth: t("filters.lastMonth"),
      lastQuarter: t("filters.lastQuarter"),
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

  const vehicleLabelByInspectionId = useMemo(() => {
    const map = new Map<string, string>();
    for (const vehicle of vehicles) {
      map.set(String(vehicle.id), inspectionVehicleLabel(vehicle));
    }
    return map;
  }, [vehicles]);

  const formVehicles = useMemo(() => {
    if (!form.farm_id) return vehicles;
    return vehicles.filter((v) => String(v.farm_id) === form.farm_id);
  }, [form.farm_id, vehicles]);

  const vehicleSelectOptions = useMemo(
    () => formVehicles.map((vehicle) => inspectionVehicleSelectOption(vehicle)),
    [formVehicles],
  );

  const operatorSelectOptions = useMemo(
    () => staffOptions.map((staff) => ({ value: staff.id, label: staff.name })),
    [staffOptions],
  );

  const vehicleTypeOptions = useMemo(() => {
    const options = [...machineryTypes];
    const current = form.vehicle_type.trim();
    if (current && !options.includes(current)) {
      options.unshift(current);
    }
    return options;
  }, [machineryTypes, form.vehicle_type]);

  const vehicleTypeForInspection = useCallback(
    (vehicleInspectionId: string): string => {
      if (!vehicleInspectionId) return "";
      const selected = vehicles.find((v) => String(v.id) === vehicleInspectionId);
      return String(selected?.vehicle_type ?? "").trim();
    },
    [vehicles],
  );

  const fuelKindForInspection = useCallback(
    (vehicleInspectionId: string): string => {
      if (!vehicleInspectionId) return "";
      const selected = vehicles.find((v) => String(v.id) === vehicleInspectionId);
      return String(selected?.fuel_kind ?? "").trim();
    },
    [vehicles],
  );

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
    const seq = ++loadSeqRef.current;
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
      const usageRows = dedupeFuelUsageRows(await fetchFuelUsage(params));
      if (seq !== loadSeqRef.current) return;
      setEntries(usageRows);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [selectedFarmIds, hasActiveDateFilter, dateRange.start, dateRange.end, t]);

  const loadBalanceData = useCallback(async () => {
    try {
      const params: { farm_ids?: string } = {};
      if (selectedFarmIds.length > 0) {
        params.farm_ids = selectedFarmIds.join(",");
      }
      const [ledger, usage] = await Promise.all([
        fetchFleetStockLedger({ module: "fuel", ...params }),
        fetchFuelUsage(params),
      ]);
      setLedgerRows(ledger);
      setBalanceUsageRows(usage);
    } catch {
      setLedgerRows([]);
      setBalanceUsageRows([]);
    }
  }, [selectedFarmIds, stockReloadToken]);

  const balanceIndex = useMemo(
    () =>
      buildFuelUsageBalanceIndex({
        ledgerRows,
        usageRows: balanceUsageRows,
        farmNameById,
        fuelLabelByKind: fuelKindLabelByValue,
      }),
    [ledgerRows, balanceUsageRows, farmNameById, fuelKindLabelByValue],
  );

  useEffect(() => {
    void loadBalanceData();
  }, [loadBalanceData]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData(false);
    void loadVehicles();
  }, [fetchAllHarvestingReferenceData, loadVehicles]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dialogOpen || !form.vehicle_inspection_id) return;
    const nextType = vehicleTypeForInspection(form.vehicle_inspection_id);
    const nextFuelKind = fuelKindForInspection(form.vehicle_inspection_id);
    setForm((f) => {
      const typeChanged = nextType && f.vehicle_type !== nextType;
      const fuelChanged = nextFuelKind && f.fuel_kind !== nextFuelKind;
      if (!typeChanged && !fuelChanged) return f;
      return {
        ...f,
        ...(typeChanged ? { vehicle_type: nextType } : {}),
        ...(fuelChanged ? { fuel_kind: nextFuelKind } : {}),
      };
    });
  }, [dialogOpen, form.vehicle_inspection_id, vehicleTypeForInspection, fuelKindForInspection]);

  useEffect(() => {
    if (!dialogOpen || costManuallyEdited) return;
    const farmId = Number(form.farm_id);
    const fuelDate = form.fuel_date.trim();
    const fuelKind = form.fuel_kind.trim();
    const vehicleInspectionId = Number(form.vehicle_inspection_id);
    if (
      !Number.isFinite(farmId) ||
      farmId <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fuelDate) ||
      (!fuelKind && !(Number.isFinite(vehicleInspectionId) && vehicleInspectionId > 0))
    ) {
      setCostSuggestHint(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await suggestFuelUsageCost({
            farm_id: farmId,
            fuel_date: fuelDate,
            fuel_kind: fuelKind || undefined,
            vehicle_inspection_id:
              Number.isFinite(vehicleInspectionId) && vehicleInspectionId > 0
                ? vehicleInspectionId
                : undefined,
          });
          if (cancelled || costManuallyEdited) return;
          if (result.cost_per_litre != null && Number.isFinite(Number(result.cost_per_litre))) {
            setForm((f) => ({
              ...f,
              cost_per_litre: formatDecimalInputFromValue(result.cost_per_litre),
            }));
            setCostSuggestHint(t("dialog.costPerLitreAutoHint"));
          } else {
            setForm((f) => ({ ...f, cost_per_litre: "" }));
            setCostSuggestHint(t("dialog.costPerLitreNoImport"));
          }
        } catch {
          if (!cancelled) setCostSuggestHint(null);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    dialogOpen,
    costManuallyEdited,
    form.farm_id,
    form.fuel_date,
    form.fuel_kind,
    form.vehicle_inspection_id,
    t,
  ]);

  const filtered = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    return entries.filter((row) => {
      if (selectedFuelKinds.length > 0) {
        const kind = String(row.fuel_kind ?? "")
          .trim()
          .toLowerCase();
        const selected = new Set(selectedFuelKinds.map((kind) => kind.toLowerCase()));
        if (!kind || !selected.has(kind)) return false;
      }
      if (!q) return true;
      const hay = [
        fuelUsageVehicleLabel(row, vehicleLabelByInspectionId),
        row.vehicle_name,
        row.alias_name,
        row.vehicle_type,
      ]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [entries, selectedFuelKinds, vehicleSearch, vehicleLabelByInspectionId]);

  const visibleUsageRows = useMemo(
    () => filtered.slice(0, listVisibleCount),
    [filtered, listVisibleCount],
  );

  const hasMoreUsageRows = filtered.length > listVisibleCount;

  const loadMoreUsageRows = useCallback(() => {
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    setListVisibleCount((count) => {
      const next = Math.min(count + USAGE_LIST_PAGE_SIZE, filtered.length);
      if (next === count) {
        loadMoreLockRef.current = false;
        return count;
      }
      requestAnimationFrame(() => {
        loadMoreLockRef.current = false;
      });
      return next;
    });
  }, [filtered.length]);

  useEffect(() => {
    setListVisibleCount(USAGE_LIST_PAGE_SIZE);
    loadMoreLockRef.current = false;
  }, [selectedFarmIds, selectedFuelKinds, vehicleSearch, hasActiveDateFilter, dateRange.start, dateRange.end]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMoreUsageRows || loading) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadMoreUsageRows();
      },
      { root: null, rootMargin: "200px", threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMoreUsageRows, loadMoreUsageRows, loading, visibleUsageRows.length]);

  const balanceBreakdownRow = useMemo(
    () =>
      balanceBreakdownUsageId != null
        ? filtered.find((row) => Number(row.id) === balanceBreakdownUsageId) ??
          balanceUsageRows.find((row) => Number(row.id) === balanceBreakdownUsageId) ??
          null
        : null,
    [balanceBreakdownUsageId, filtered, balanceUsageRows],
  );

  const balanceBreakdownTimeline = useMemo(() => {
    if (!balanceBreakdownRow) return [];
    const fuelKind = normalizeFuelKind(balanceBreakdownRow.fuel_kind);
    if (!fuelKind) return [];
    const key = farmFuelBalanceKey(Number(balanceBreakdownRow.farm_id), fuelKind);
    const timeline = balanceIndex.timelinesByFarmFuel.get(key) ?? [];
    return fuelTimelineUpToUsageId(timeline, Number(balanceBreakdownRow.id));
  }, [balanceBreakdownRow, balanceIndex.timelinesByFarmFuel]);

  const totalLitres = filtered.reduce((s, e) => s + num(e.litres), 0);
  const totalCost = filtered.reduce((s, e) => s + lineCost(e), 0);
  const avgPerEntry = filtered.length > 0 ? totalLitres / filtered.length : 0;

  const byVehicle = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of filtered) {
      const name = fuelUsageVehiclePrimaryName(row, vehicleLabelByInspectionId) || "—";
      map[name] = (map[name] || 0) + num(row.litres);
    }
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, vehicleLabelByInspectionId]);

  const byFuel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of filtered) {
      const name = fuelUsageFuelKindLabel(
        row.fuel_kind,
        fuelKindLabelByValue,
        fuelKindFallback,
      );
      map[name] = (map[name] || 0) + num(row.litres);
    }
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, fuelKindLabelByValue, fuelKindFallback]);

  const byFarm = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of filtered) {
      const name =
        row.farm_name ?? farmNameById.get(String(row.farm_id)) ?? String(row.farm_id) ?? "—";
      map[name] = (map[name] || 0) + num(row.litres);
    }
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, farmNameById]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of filtered) {
      const name = String(row.vehicle_type ?? "").trim() || "—";
      map[name] = (map[name] || 0) + num(row.litres);
    }
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  const breakdownViews: Record<
    BreakdownTab,
    { title: string; data: { name: string; amount: number }[] }
  > = {
    vehicle: { title: t("charts.byVehicle"), data: byVehicle },
    fuel: { title: t("charts.byFuel"), data: byFuel },
    farm: { title: t("charts.byFarm"), data: byFarm },
    type: { title: t("charts.byType"), data: byType },
  };
  const activeChart = breakdownViews[breakdownTab];
  const chartInnerHeight = Math.max(
    CHART_MIN_HEIGHT,
    activeChart.data.length * CHART_ROW_HEIGHT,
  );

  const resumeGoogleSheetExport =
    (searchParams.get("googleSheetExport") ?? "").trim() === "resume";
  const googleSheetExportError = (searchParams.get("googleSheetError") ?? "").trim();

  const clearGoogleSheetExportQuery = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("googleSheetExport");
    url.searchParams.delete("googleSheetError");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (resumeGoogleSheetExport || googleSheetExportError) {
      setExportOpen(true);
    }
  }, [resumeGoogleSheetExport, googleSheetExportError]);

  const openCreate = () => {
    setEditingId(null);
    setCostManuallyEdited(false);
    setCostSuggestHint(null);
    setForm(emptyForm(farmOptions[0]?.id ?? ""));
    setDialogOpen(true);
  };

  const openEdit = (row: FuelUsageRow) => {
    const vehicleInspectionId = String(row.vehicle_inspection_id);
    const typeFromVehicle = vehicleTypeForInspection(vehicleInspectionId);
    const isManual = String(row.cost_mode ?? "").toLowerCase() === "manual";
    setEditingId(Number(row.id));
    setCostManuallyEdited(isManual);
    setCostSuggestHint(
      isManual
        ? t("dialog.costPerLitreManualHint")
        : null,
    );
    setForm({
      fuel_date: String(row.fuel_date).slice(0, 10),
      farm_id: String(row.farm_id),
      vehicle_inspection_id: vehicleInspectionId,
      vehicle_type: typeFromVehicle || String(row.vehicle_type ?? ""),
      fuel_kind: fuelKindForInspection(vehicleInspectionId) || String(row.fuel_kind ?? ""),
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
    setCostManuallyEdited(false);
    setCostSuggestHint(null);
  };

  const handleVehicleChange = (vehicleInspectionId: string) => {
    setForm((f) => ({
      ...f,
      vehicle_inspection_id: vehicleInspectionId,
      vehicle_type: vehicleTypeForInspection(vehicleInspectionId),
      fuel_kind: fuelKindForInspection(vehicleInspectionId),
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
        vehicle_type: stillValid ? f.vehicle_type : "",
        fuel_kind: stillValid ? f.fuel_kind : "",
      };
    });
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const vehicleInspectionId = Number(form.vehicle_inspection_id);
    const litresText = normalizedDecimalApiString(form.litres);
    const litres = litresText ? parseDecimalField(form.litres) : NaN;
    const costPerLitreText = normalizedDecimalApiString(form.cost_per_litre);
    const costPerLitre = costPerLitreText
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
      loadSeqRef.current += 1;
      const payload: Parameters<typeof saveFuelUsage>[0] = {
        id: editingId ?? undefined,
        fuel_date: form.fuel_date,
        farm_id: farmId,
        vehicle_inspection_id: vehicleInspectionId,
        vehicle_type: form.vehicle_type,
        litres,
        odometer_km: odometerKm,
        operator_id: form.operator_id ? Number(form.operator_id) : undefined,
        purpose: form.purpose.trim() || undefined,
      };
      if (costManuallyEdited) {
        payload.cost_mode = "manual";
        payload.cost_per_litre =
          costPerLitre !== undefined && Number.isFinite(costPerLitre)
            ? costPerLitre
            : null;
      }
      // else omit cost → server fills from latest import (auto)
      await saveFuelUsage(payload);
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      closeDialog();
      setStockReloadToken((n) => n + 1);
      await Promise.all([load(), loadBalanceData()]);
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
    const rowId = Number(row.id);
    if (!Number.isFinite(rowId) || rowId <= 0) return;
    try {
      setSaving(true);
      loadSeqRef.current += 1;
      await removeFuelUsage(rowId);
      setEntries((prev) => prev.filter((entry) => Number(entry.id) !== rowId));
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setStockReloadToken((n) => n + 1);
      await Promise.all([load(), loadBalanceData()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
      await load();
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canCreate ? (
            <button type="button" className={btnPrimary} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("logFuel")}
            </button>
          ) : null}
          <button type="button" className={btnOutline} onClick={() => setBalanceOpen(true)}>
            <Package className="h-4 w-4" />
            {t("stock.balanceButton")}
          </button>
          {canImport ? (
            <button type="button" className={btnOutline} onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              {t("import.button")}
            </button>
          ) : null}
          {canExport ? (
            <button
              type="button"
              className={btnOutline}
              disabled={loading}
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-4 w-4" />
              {t("export.button")}
            </button>
          ) : null}
        </div>
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
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={cn(inputClass, "pl-9")}
            placeholder={t("filters.searchVehicle")}
            value={vehicleSearch}
            onChange={(e) => setVehicleSearch(e.target.value)}
          />
        </div>
        <MultiSelect
          options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
          values={selectedFarmIds}
          onChange={setSelectedFarmIds}
          placeholder={t("filters.allFarms")}
          showAllOption
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
          rightIcon={filterTriggerIcon}
        />
        <MultiSelect
          options={fuelKindFilterOptions}
          values={selectedFuelKinds}
          onChange={setSelectedFuelKinds}
          placeholder={t("filters.allFuelTypes")}
          showAllOption
          className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFuelKinds.length > 0))}
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

      <div className="space-y-4">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1">
          {(["vehicle", "fuel", "farm", "type"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={cn(tabBtn, breakdownTab === key ? tabBtnActive : tabBtnIdle)}
              onClick={() => setBreakdownTab(key)}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{activeChart.title}</h3>
              {activeChart.data.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("charts.itemCount", { count: activeChart.data.length })}
                </span>
              ) : null}
            </div>
            {activeChart.data.some((d) => d.amount > 0) ? (
              <div
                className="overflow-y-auto pr-1"
                style={{ maxHeight: CHART_MAX_VIEWPORT }}
              >
                <ResponsiveContainer width="100%" height={chartInnerHeight}>
                  <BarChart
                    data={activeChart.data}
                    layout="vertical"
                    margin={{ left: 24 }}
                    barCategoryGap={6}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
                    <Tooltip
                      formatter={(v: number) => [
                        `${formatNumber(v, { maximumFractionDigits: 3 })} L`,
                        t("charts.litres"),
                      ]}
                    />
                    <Bar dataKey="amount" fill={CHART_FILL} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("charts.empty")}</p>
            )}
          </CardContent>
        </Card>
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
                    <th className="px-4 py-3 text-left font-medium">{t("table.fuelKind")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.litres")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("table.remaining")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.costPerLitre")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.cost")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.odometer")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.operator")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.purpose")}</th>
                    {canManageRows ? (
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleUsageRows.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateDisplay(e.fuel_date)}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">
                            {fuelUsageVehiclePrimaryName(e, vehicleLabelByInspectionId)}
                          </p>
                          {(() => {
                            const secondary = fuelUsageVehicleTypeAliasLine(e);
                            return secondary ? (
                              <p className="text-xs text-muted-foreground">{secondary}</p>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {e.farm_name ?? farmNameById.get(String(e.farm_id)) ?? e.farm_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md bg-muted/60 px-2 py-0.5 text-xs font-medium text-foreground">
                          {fuelUsageFuelKindLabel(e.fuel_kind, fuelKindLabelByValue, fuelKindFallback)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {formatNumber(e.litres, { maximumFractionDigits: 3 })} L
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <span className="font-semibold tabular-nums">
                            {(() => {
                              const value = fuelRowRemainingLitres(e, balanceIndex);
                              return value != null
                                ? `${formatNumber(value, { maximumFractionDigits: 3 })} L`
                                : "—";
                            })()}
                          </span>
                          {fuelRowHasRemaining(e, balanceIndex) ? (
                            <button
                              type="button"
                              className={cn(
                                btnGhost,
                                "h-7 w-7",
                                balanceBreakdownUsageId === Number(e.id) && "bg-primary/10 text-primary",
                              )}
                              aria-label={t("balanceTimeline.showBreakdown")}
                              title={t("balanceTimeline.showBreakdown")}
                              onClick={() =>
                                setBalanceBreakdownUsageId((current) =>
                                  current === Number(e.id) ? null : Number(e.id),
                                )
                              }
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {num(e.cost_per_litre) > 0
                          ? `$${formatDecimalDisplay(num(e.cost_per_litre), 4)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {lineCost(e) > 0
                          ? `$${formatNumber(lineCost(e), { maximumFractionDigits: 2 })}`
                          : "—"}
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
                      {canManageRows ? (
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit ? (
                              <button
                                type="button"
                                className={btnGhost}
                                disabled={saving}
                                onClick={() => openEdit(e)}
                                aria-label={t("dialog.editTitle")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                className={cn(btnGhost, "text-destructive hover:bg-destructive/10")}
                                disabled={saving}
                                onClick={() => void handleDelete(e)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={canManageRows ? 11 : 10} className="px-4 py-8 text-center text-muted-foreground">
                        {t("table.empty")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          {!loading && hasMoreUsageRows ? (
            <div ref={loadMoreSentinelRef} className="h-8 w-full" aria-hidden />
          ) : null}
        </CardContent>
      </Card>

      {balanceBreakdownRow && balanceBreakdownTimeline.length > 0 ? (
        <FuelUsageBalanceBreakdownPanel
          farmName={
            balanceBreakdownRow.farm_name ??
            farmNameById.get(String(balanceBreakdownRow.farm_id)) ??
            String(balanceBreakdownRow.farm_id)
          }
          fuelLabel={fuelUsageFuelKindLabel(
            balanceBreakdownRow.fuel_kind,
            fuelKindLabelByValue,
            fuelKindFallback,
          )}
          timeline={balanceBreakdownTimeline}
          highlightUsageId={Number(balanceBreakdownRow.id)}
          onClose={() => setBalanceBreakdownUsageId(null)}
        />
      ) : null}

      {balanceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <FuelStockLedgerPanel
              farmOptions={farmOptions.map((f) => ({ id: f.id, label: f.label }))}
              initialFarmId={
                balanceResume?.farmId ??
                (selectedFarmIds.length === 1 ? selectedFarmIds[0] : farmOptions[0]?.id ?? null)
              }
              resumeState={balanceResume}
              reloadToken={stockReloadToken}
              embedded
              onClose={() => {
                setBalanceOpen(false);
                setBalanceResume(null);
              }}
              onRequestStockImport={(resume) => {
                setBalanceResume(resume);
                setBalanceOpen(false);
                setStockImportOpen(true);
              }}
              onDataChanged={() => {
                setStockReloadToken((token) => token + 1);
                void Promise.all([load(), loadBalanceData()]);
              }}
            />
          </div>
        </div>
      ) : null}

      <FuelStockImportDialog
        open={stockImportOpen}
        onClose={() => {
          setStockImportOpen(false);
          if (balanceResume) {
            setBalanceOpen(true);
          }
        }}
        farmOptions={farmOptions.map((f) => ({ id: f.id, label: f.label }))}
        onImported={() => {
          setStockReloadToken((token) => token + 1);
          void Promise.all([load(), loadBalanceData()]);
        }}
      />

      <FuelUsageImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        farmOptions={farmOptions.map((f) => ({ id: f.id, label: f.label }))}
        vehicles={vehicles}
        initialFarmId={
          selectedFarmIds.length === 1 ? selectedFarmIds[0] : farmOptions[0]?.id
        }
        onImported={() => {
          setStockReloadToken((token) => token + 1);
          void Promise.all([load(), loadBalanceData()]);
        }}
      />

      <FuelUsageExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
          clearGoogleSheetExportQuery();
        }}
        farmOptions={farmOptions.map((f) => ({ id: f.id, label: f.label }))}
        initialFarmIds={selectedFarmIds}
        initialDateFrom={hasActiveDateFilter ? dateRange.start : ""}
        initialDateTo={hasActiveDateFilter ? dateRange.end : ""}
        fuelKindLabelByValue={fuelKindLabelByValue}
        fuelKindFallback={fuelKindFallback}
        vehicleLabelByInspectionId={vehicleLabelByInspectionId}
        resumeGoogleSheetExport={resumeGoogleSheetExport}
        onResumeHandled={clearGoogleSheetExportQuery}
      />
      {googleSheetExportError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {googleSheetExportError}
        </p>
      ) : null}
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
                  {farmOptions.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.vehicle")} *</span>
                <MultiSelect
                  options={vehicleSelectOptions}
                  values={form.vehicle_inspection_id ? [form.vehicle_inspection_id] : []}
                  onChange={(next) => handleVehicleChange(next[0] ?? "")}
                  multi={false}
                  placeholder={t("dialog.selectVehicle")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  disabled={!form.farm_id || saving}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.vehicleType")}</span>
                <select
                  className={cn(inputClass, "bg-muted/50")}
                  value={form.vehicle_type}
                  disabled
                >
                  <option value="">
                    {form.vehicle_inspection_id
                      ? t("dialog.vehicleTypeEmpty")
                      : t("dialog.selectVehicleFirst")}
                  </option>
                  {vehicleTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.fuelType")}</span>
                <select
                  className={cn(inputClass, "bg-muted/50")}
                  value={form.fuel_kind}
                  disabled
                >
                  <option value="">
                    {form.vehicle_inspection_id
                      ? t("dialog.fuelTypeEmpty")
                      : t("dialog.selectVehicleFirst")}
                  </option>
                  {form.fuel_kind ? (
                    <option value={form.fuel_kind}>
                      {fuelUsageFuelKindLabel(
                        form.fuel_kind,
                        fuelKindLabelByValue,
                        fuelKindFallback,
                      )}
                    </option>
                  ) : null}
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
                  onChange={(e) => {
                    setCostManuallyEdited(true);
                    setCostSuggestHint(t("dialog.costPerLitreManualHint"));
                    setForm((f) => ({
                      ...f,
                      cost_per_litre: formatDecimalInput(e.target.value),
                    }));
                  }}
                />
                {costSuggestHint ? (
                  <p className="text-[11px] text-muted-foreground">{costSuggestHint}</p>
                ) : null}
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
                <MultiSelect
                  options={operatorSelectOptions}
                  values={form.operator_id ? [form.operator_id] : []}
                  onChange={(next) => setForm((f) => ({ ...f, operator_id: next[0] ?? "" }))}
                  multi={false}
                  placeholder={t("dialog.selectOperator")}
                  className={selectClass}
                  rightIcon={selectChevron}
                  showSelectedChipsInPopover={false}
                  disabled={saving}
                />
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
