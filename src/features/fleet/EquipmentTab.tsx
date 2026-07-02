"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock, MapPin, Plus, Search, Settings, User, Wrench, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  buildEquipmentProductSelectOption,
  equipmentProductOptionLabel,
  fetchEquipmentCatalog,
  fetchEquipmentFormOptions,
  saveEquipment,
  type EquipmentProductOption,
  type EquipmentRow,
} from "@/features/fleet/api/equipmentApi";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import { fetchStaffOptions } from "@/features/fleet/api/machineryApi";
import {
  equipmentCardModelTitle,
  formatEquipmentModelDisplay,
} from "@/features/fleet/lib/equipmentModelDisplay";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const readOnlyClass = cn(inputClass, "bg-muted/50");
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  item_id: string;
  brand: string;
  model_display: string;
  type: string;
  engine_code: string;
  hours_between_service: string;
  farm_id: string;
  assigned_to_user_id: string;
};

function emptyForm(typeDefault = "", farmId = ""): FormState {
  return {
    item_id: "",
    brand: "",
    model_display: "",
    type: typeDefault,
    engine_code: "",
    hours_between_service: "250",
    farm_id: farmId,
    assigned_to_user_id: "",
  };
}

function equipmentStatusKey(status: string): "operational" | "maintenance" | "outOfService" {
  if (status === "Under Maintenance") return "maintenance";
  if (status === "Out of Service" || status === "Retired") return "outOfService";
  return "operational";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function EquipmentTab() {
  const t = useTranslations("Equipment");
  const router = useRouter();
  const { types: machineryTypes } = useMachineryTypes();
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const farms = useHarvestingDataStore((s) => s.farms);

  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [products, setProducts] = useState<EquipmentProductOption[]>([]);
  const [staff, setStaff] = useState<Array<{ id: number | string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [farmFilter, setFarmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { farm_id?: number; type?: string } = {};
      if (farmFilter !== "all") params.farm_id = Number(farmFilter);
      if (typeFilter !== "all") params.type = typeFilter;
      const data = await fetchEquipmentCatalog(params);
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [farmFilter, typeFilter, t]);

  const loadFormOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [options, staffRows] = await Promise.all([
        fetchEquipmentFormOptions(),
        staff.length ? Promise.resolve(null) : fetchStaffOptions().catch(() => []),
      ]);
      setProducts(options.products ?? []);
      if (staffRows) {
        setStaff(
          staffRows.map((s) => ({
            id: s.id,
            label:
              `${String(s.first_name ?? "").trim()} ${String(s.last_name ?? "").trim()}`.trim() ||
              String(s.id),
          })),
        );
      }
    } catch {
      setProducts([]);
    } finally {
      setOptionsLoading(false);
    }
  }, [staff.length]);

  useEffect(() => {
    void fetchAllHarvestingReferenceData(false);
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    void load();
  }, [load]);

  const equipmentOptions = useMemo(
    () =>
      products.map((product) => {
        const parts = buildEquipmentProductSelectOption(product);
        return {
          value: String(product.id),
          label: parts.label,
          subLabel: parts.subLabel,
        };
      }),
    [products],
  );

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === form.item_id) ?? null,
    [products, form.item_id],
  );

  const applyEquipmentSelection = (itemId: string) => {
    const product = products.find((p) => String(p.id) === itemId);
    if (!product) {
      setForm((f) => ({ ...f, item_id: itemId, brand: "", model_display: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      item_id: itemId,
      brand: String(product.brand ?? "").trim(),
      model_display: formatEquipmentModelDisplay(product),
    }));
  };

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== "all") {
      list = list.filter((e) => equipmentStatusKey(String(e.status)) === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      `${e.brand} ${e.model} ${e.type} ${e.equipment_name ?? ""}`.toLowerCase().includes(q),
    );
  }, [rows, search, statusFilter]);

  const operationalCount = rows.filter(
    (e) => equipmentStatusKey(String(e.status)) === "operational",
  ).length;
  const maintenanceCount = rows.filter((e) => {
    const k = equipmentStatusKey(String(e.status));
    return k === "maintenance" || k === "outOfService";
  }).length;
  const farmsCovered = new Set(rows.map((e) => e.farm_id)).size;
  const uniqueTypes = [...new Set(rows.map((e) => e.type))];

  const statusBadgeClass: Record<string, string> = {
    operational: "bg-emerald-100 text-emerald-800",
    maintenance: "bg-amber-100 text-amber-800",
    outOfService: "bg-red-100 text-red-800",
  };

  const equipmentDetailHref = useCallback(
    (id: number) => `/fleet/equipment/detail?id=${encodeURIComponent(String(id))}`,
    [],
  );

  const openRegister = () => {
    const firstFarm = farms[0] as { id?: unknown } | undefined;
    setForm(emptyForm(machineryTypes[0] ?? "", firstFarm ? String(firstFarm.id ?? "") : ""));
    setOpen(true);
    void loadFormOptions();
  };

  const handleSave = async () => {
    const itemId = Number(form.item_id);
    const farmId = Number(form.farm_id);
    if (
      !form.item_id ||
      !form.type ||
      !Number.isFinite(itemId) ||
      itemId <= 0 ||
      !Number.isFinite(farmId) ||
      farmId <= 0
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    try {
      setSaving(true);
      await saveEquipment({
        item_id: itemId,
        brand: form.brand.trim() || selectedProduct?.brand,
        equipment_name:
          selectedProduct?.equipment_name ?? selectedProduct?.model_short ?? "",
        type: form.type,
        engine_code: form.engine_code.trim() || undefined,
        farm_id: farmId,
        assigned_to_user_id: form.assigned_to_user_id
          ? Number(form.assigned_to_user_id)
          : null,
        hours_between_service: form.hours_between_service
          ? Number(form.hours_between_service)
          : undefined,
        status: "Active",
      });
      setOpen(false);
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={openRegister}>
          <Plus className="h-4 w-4" />
          {t("register")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.total")}</p><p className="text-2xl font-bold">{rows.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.operational")}</p><p className="text-2xl font-bold text-primary">{operationalCount}</p></CardContent></Card>
        <Card className="border-amber-200/50"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.attention")}</p><p className="text-2xl font-bold text-amber-600">{maintenanceCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.farms")}</p><p className="text-2xl font-bold">{farmsCovered}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={cn(inputClass, "w-[160px]")} value={farmFilter} onChange={(e) => setFarmFilter(e.target.value)}>
          <option value="all">{t("filters.allFarms")}</option>
          {farms.map((farm) => {
            const id = String((farm as { id?: unknown }).id ?? "");
            return <option key={id} value={id}>{String((farm as { name?: unknown }).name ?? id)}</option>;
          })}
        </select>
        <select className={cn(inputClass, "w-[160px]")} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">{t("filters.allTypes")}</option>
          {uniqueTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          {uniqueTypes.length === 0
            ? machineryTypes.map((type) => <option key={type} value={type}>{type}</option>)
            : null}
        </select>
        <select className={cn(inputClass, "w-[160px]")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t("filters.allStatuses")}</option>
          <option value="operational">{t("status.operational")}</option>
          <option value="maintenance">{t("status.maintenance")}</option>
          <option value="outOfService">{t("status.outOfService")}</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((eq) => {
            const statusKey = equipmentStatusKey(String(eq.status));
            const hoursBetween = num(eq.hours_between_service) || 250;
            const hoursUsed = num(eq.hours_used);
            const hoursUntilService = hoursBetween - (hoursUsed % hoursBetween);
            const serviceProgress = Math.min(
              100,
              Math.round(((hoursBetween - hoursUntilService) / hoursBetween) * 100),
            );
            return (
              <Card
                key={eq.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => router.push(equipmentDetailHref(eq.id))}
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">
                          {eq.brand}{" "}
                          {equipmentCardModelTitle({
                            model_short: eq.model_short,
                            equipment_name: eq.equipment_name,
                            model: eq.model,
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">{eq.type}</p>
                      </div>
                    </div>
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", statusBadgeClass[statusKey])}>
                      {t(`status.${statusKey}`)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{eq.farm_name ?? eq.farm_id}</span>
                    {eq.assigned_to_name ? (
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{eq.assigned_to_name}</span>
                    ) : null}
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground">{t("card.serviceIn", { hours: hoursUntilService })}</span>
                      <span className="font-medium">
                        {formatNumber(hoursUsed, { maximumFractionDigits: 2 })} {t("card.hrsTotal")}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${serviceProgress}%` }} />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      {t("card.last")}: {formatDateDisplay(eq.last_service_date)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t("card.next")}: {formatDateDisplay(eq.next_service_due)}
                    </span>
                  </div>
                  {eq.notes ? (
                    <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{eq.notes}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 ? (
            <div className="col-span-full py-8 text-center text-muted-foreground">{t("empty")}</div>
          ) : null}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.equipment")} *</span>
                <MultiSelect
                  options={equipmentOptions}
                  values={form.item_id ? [form.item_id] : []}
                  onChange={(next) => applyEquipmentSelection(next[0] ?? "")}
                  placeholder={
                    optionsLoading ? t("form.loadingProducts") : t("form.selectEquipment")
                  }
                  className={selectClass}
                  rightIcon={selectChevron}
                  disabled={optionsLoading || saving || equipmentOptions.length === 0}
                  multi={false}
                  maxSelections={1}
                  selectionSummary="full"
                  showSelectedChipsInPopover={false}
                />
                {!optionsLoading && equipmentOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("form.noProducts")}</p>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.brand")} *</span>
                <input
                  className={readOnlyClass}
                  value={form.brand}
                  readOnly
                  placeholder="—"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.type")} *</span>
                <select
                  className={inputClass}
                  value={form.type}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="">{t("form.selectType")}</option>
                  {machineryTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.model")} *</span>
                <textarea
                  className={cn(readOnlyClass, "min-h-[120px] resize-none py-2 font-mono text-xs leading-relaxed")}
                  value={form.model_display}
                  readOnly
                  rows={6}
                  placeholder="—"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.engineCode")}</span>
                <input
                  className={inputClass}
                  placeholder={t("form.engineCodePlaceholder")}
                  value={form.engine_code}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, engine_code: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.hoursBetweenService")}</span>
                <input
                  type="number"
                  className={inputClass}
                  placeholder={t("form.hoursBetweenServicePlaceholder")}
                  value={form.hours_between_service}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, hours_between_service: e.target.value }))}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.farm")} *</span>
                <select
                  className={inputClass}
                  value={form.farm_id}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, farm_id: e.target.value }))}
                >
                  <option value="">{t("form.selectFarm")}</option>
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
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("form.pic")}</span>
                <select
                  className={inputClass}
                  value={form.assigned_to_user_id}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, assigned_to_user_id: e.target.value }))}
                >
                  <option value="">{t("form.selectPic")}</option>
                  {staff.map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setOpen(false)}>
                {t("cancel")}
              </button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>
                {t("registerSubmit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
