"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlignLeft, ArrowDown, FlaskConical, Layers, MapPin, Pencil, Plus, Sprout, Trash2 } from "lucide-react";
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

import { fetchFertilizerItemsCatalog, type ItemCatalogRow } from "@/features/admin/api/itemsApi";
import {
  fetchFertilizerUsage,
  removeFertilizerUsage,
  saveFertilizerUsage,
  type FertilizerUsageRow,
} from "@/features/fertilizer/api/fertilizerUsageApi";
import { Card, CardContent } from "@/components/ui/card";
import {
  DashboardKpiDateFilter,
  KPI_DATE_PRESET_FERTILIZER,
} from "@/features/dashboard/DashboardKpiDateFilter";
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
import {
  filterFarmZoneRowsByFarmId,
  parseFarmZoneEntries,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";
import { DatePicker } from "@/shared/ui/date-picker";
import type { ZoneConfigurationRow } from "@/features/admin/api/adminApi";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_FILL = "hsl(152,55%,36%)";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
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
const FERTILIZER_DATE_FILTER_BASELINE: KpiDatePreset = "all";

type BreakdownTab = "product" | "month" | "grass" | "zone";

type EntryForm = {
  applied_date: string;
  farm_id: string;
  grass_id: string;
  zone_id: string;
  item_id: string;
  amount: string;
  rate: string;
  rate_uom: string;
  operator_id: string;
  notes: string;
};

function itemRateUom(product: ItemCatalogRow | undefined): string {
  return product?.rate_uom?.trim() || "";
}

function formatRateValue(rate: unknown): string {
  const n = Number(stripDecimalGrouping(String(rate ?? "")));
  if (!Number.isFinite(n) || n === 0) return "";
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

function formatUsageRateDisplay(row: FertilizerUsageRow): string {
  const n = Number(stripDecimalGrouping(String(row.rate ?? "")));
  const uom = String(row.rate_uom ?? "").trim();
  if (!Number.isFinite(n) || n === 0) {
    return uom || "—";
  }
  const rateText = formatNumber(n, { maximumFractionDigits: 3 });
  return uom ? `${rateText} ${uom}` : rateText;
}

function parseDecimalField(raw: string): number {
  const n = Number(stripDecimalGrouping(raw.trim()));
  return Number.isFinite(n) ? n : NaN;
}

function rateFieldsFromProduct(product: ItemCatalogRow | undefined): Pick<EntryForm, "rate" | "rate_uom"> {
  if (!product) {
    return { rate: "", rate_uom: "" };
  }
  const rate = Number(product.default_rate);
  return {
    rate:
      Number.isFinite(rate) && rate !== 0
        ? formatDecimalInputFromValue(rate)
        : "",
    rate_uom: itemRateUom(product),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(farmId = "", grassId = ""): EntryForm {
  return {
    applied_date: todayIso(),
    farm_id: farmId,
    grass_id: grassId,
    zone_id: "",
    item_id: "",
    amount: "",
    rate: "",
    rate_uom: "",
    operator_id: "",
    notes: "",
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function staffDisplayName(row: Record<string, unknown>): string {
  const firstName = String(row.first_name ?? "").trim();
  const lastName = String(row.last_name ?? "").trim();
  const fullNameFromParts = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullNameFromParts || String(row.full_name ?? row.name ?? "").trim();
}

export function FertilizerUsageTab() {
  const t = useTranslations("FertilizerUsage");
  const farms = useHarvestingDataStore((s) => s.farms);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const {
    selectedFarmIds,
    setSelectedFarmIds,
    farmOptions,
    farmNameById: scopedFarmNameById,
  } = useSyncedFarmMultiSelect("harvests");

  const [products, setProducts] = useState<ItemCatalogRow[]>([]);
  const [entries, setEntries] = useState<FertilizerUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kpiDateFilter, setKpiDateFilter] = useState<KpiDeliveryDateFilter>({
    preset: FERTILIZER_DATE_FILTER_BASELINE,
  });
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>("product");
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
  const hasActiveDateFilter = kpiDateFilter.preset !== FERTILIZER_DATE_FILTER_BASELINE;

  const grassNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const grass of grasses) {
      const id = String((grass as { id?: unknown }).id ?? "").trim();
      const title = String(
        (grass as { title?: unknown }).title ?? (grass as { name?: unknown }).name ?? "",
      ).trim();
      if (id) map.set(id, title || id);
    }
    return map;
  }, [grasses]);

  const productById = useMemo(() => {
    const map = new Map<number, ItemCatalogRow>();
    for (const p of products) map.set(Number(p.id), p);
    return map;
  }, [products]);

  const staffOptions = useMemo(() => {
    return (staffs as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => {
        const name = staffDisplayName(s);
        if (!name) return null;
        return { id: String(s.id ?? "").trim(), name };
      })
      .filter((x): x is { id: string; name: string } => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [staffs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: {
        farm_ids?: string;
        applied_from?: string;
        applied_to?: string;
      } = {};
      if (selectedFarmIds.length > 0) {
        params.farm_ids = selectedFarmIds.join(",");
      }
      if (hasActiveDateFilter) {
        if (dateRange.start) params.applied_from = dateRange.start;
        if (dateRange.end) params.applied_to = dateRange.end;
      }
      const [usageRows, catalogRows] = await Promise.all([
        fetchFertilizerUsage(params),
        fetchFertilizerItemsCatalog(),
      ]);
      setEntries(usageRows);
      setProducts(catalogRows);
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
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = entries;

  const totalAmount = filtered.reduce((s, e) => s + num(e.amount), 0);
  const productsUsed = new Set(filtered.map((e) => e.item_id)).size;
  const zonesTreated = new Set(filtered.map((e) => `${e.farm_id}-${e.zone_id}`)).size;

  const byProduct = useMemo(() => {
    const map: Record<number, number> = {};
    filtered.forEach((e) => {
      map[e.item_id] = (map[e.item_id] || 0) + num(e.amount);
    });
    return Object.entries(map)
      .map(([id, amount]) => ({
        name: productById.get(Number(id))?.name ?? `#${id}`,
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, productById]);

  const byMonth = useMemo(() => {
    const year = todayIso().slice(0, 4);
    const totals = Array(12).fill(0);
    filtered
      .filter((e) => String(e.applied_date).startsWith(year))
      .forEach((e) => {
        const month = Number(String(e.applied_date).slice(5, 7)) - 1;
        if (month >= 0 && month < 12) totals[month] += num(e.amount);
      });
    return MONTH_LABELS.map((month, i) => ({ name: month, amount: totals[i] }));
  }, [filtered]);

  const byGrass = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((e) => {
      const name = e.grass_name ?? grassNameById.get(String(e.grass_id)) ?? String(e.grass_id);
      map[name] = (map[name] || 0) + num(e.amount);
    });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, grassNameById]);

  const byZone = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((e) => {
      const farm = e.farm_name ?? farmNameById.get(String(e.farm_id)) ?? String(e.farm_id);
      const zoneLabel =
        e.zone_name?.trim() ||
        zoneIdToLabel(String(e.zone_id ?? ""), farmZones) ||
        String(e.zone_id ?? "");
      const k = `${farm} · ${zoneLabel}`;
      map[k] = (map[k] || 0) + num(e.amount);
    });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, farmNameById, farmZones]);

  const breakdownViews: Record<BreakdownTab, { title: string; data: { name: string; amount: number }[] }> =
    {
      product: { title: t("charts.byProduct"), data: byProduct },
      month: { title: t("charts.byMonth", { year: todayIso().slice(0, 4) }), data: byMonth },
      grass: { title: t("charts.byGrass"), data: byGrass },
      zone: { title: t("charts.byZone"), data: byZone },
    };

  const zoneRowsForForm = useMemo(() => {
    const farmId = form.farm_id;
    const grassId = form.grass_id;
    return (zoneConfigurations as ZoneConfigurationRow[]).filter((z) => {
      if (farmId && String(z.farm_id) !== farmId) return false;
      if (grassId && String(z.grass_id) !== grassId) return false;
      return true;
    });
  }, [zoneConfigurations, form.farm_id, form.grass_id]);

  const zoneOptions = useMemo(() => {
    const filteredFarmZoneRows = filterFarmZoneRowsByFarmId(farmZones, form.farm_id);
    return parseFarmZoneEntries(filteredFarmZoneRows, "id");
  }, [farmZones, form.farm_id]);

  const grassOptionsForForm = useMemo(() => {
    if (!form.farm_id) {
      return grasses.map((g) => ({
        id: String((g as { id?: unknown }).id ?? ""),
        title: String((g as { title?: unknown }).title ?? ""),
      }));
    }
    const ids = new Set(zoneRowsForForm.map((z) => String(z.grass_id)));
    return grasses
      .map((g) => ({
        id: String((g as { id?: unknown }).id ?? ""),
        title: String((g as { title?: unknown }).title ?? ""),
      }))
      .filter((g) => ids.has(g.id));
  }, [form.farm_id, grasses, zoneRowsForForm]);

  const openCreate = () => {
    const firstFarm = farms[0] as { id?: unknown } | undefined;
    setEditingId(null);
    setForm(emptyForm(firstFarm ? String(firstFarm.id ?? "") : ""));
    setDialogOpen(true);
  };

  const openEdit = (row: FertilizerUsageRow) => {
    const product = productById.get(Number(row.item_id));
    const storedRate = formatRateValue(row.rate);
    const storedUom = String(row.rate_uom ?? "").trim();
    setEditingId(Number(row.id));
    setForm({
      applied_date: String(row.applied_date).slice(0, 10),
      farm_id: String(row.farm_id),
      grass_id: String(row.grass_id),
      zone_id: String(row.zone_id),
      item_id: String(row.item_id),
      amount: formatDecimalInputFromValue(row.amount),
      rate: storedRate
        ? formatDecimalInputFromValue(storedRate)
        : rateFieldsFromProduct(product).rate,
      rate_uom: storedUom || rateFieldsFromProduct(product).rate_uom,
      operator_id: row.operator_id ? String(row.operator_id) : "",
      notes: String(row.notes ?? ""),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  const selectProduct = (itemId: string) => {
    const product = productById.get(Number(itemId));
    setForm((f) => ({
      ...f,
      item_id: itemId,
      ...rateFieldsFromProduct(product),
    }));
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const grassId = Number(form.grass_id);
    const itemId = Number(form.item_id);
    const amount = parseDecimalField(form.amount);
    if (
      !form.applied_date ||
      !Number.isFinite(farmId) ||
      farmId <= 0 ||
      !Number.isFinite(grassId) ||
      grassId <= 0 ||
      !form.zone_id ||
      !Number.isFinite(itemId) ||
      itemId <= 0 ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveFertilizerUsage({
        id: editingId ?? undefined,
        applied_date: form.applied_date,
        farm_id: farmId,
        grass_id: grassId,
        zone_id: Number(form.zone_id),
        item_id: itemId,
        amount,
        rate: form.rate.trim() ? parseDecimalField(form.rate) : null,
        rate_uom: form.rate_uom.trim() || null,
        operator_id: form.operator_id ? Number(form.operator_id) : undefined,
        notes: form.notes.trim() || undefined,
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

  const handleDelete = async (row: FertilizerUsageRow) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      await removeFertilizerUsage(Number(row.id));
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

  const activeChart = breakdownViews[breakdownTab];

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "min-w-[140px] max-w-[180px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  return (
    <div className="dashboard-harvesting-skin min-w-0 flex-1">
      <div className="mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t("logApplication")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <FlaskConical className="mt-1 h-8 w-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.totalApplied")}</p>
              <p className="text-2xl font-bold">
                {formatNumber(totalAmount, { maximumFractionDigits: 3 })}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Layers className="mt-1 h-8 w-8 text-accent-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.productsUsed")}</p>
              <p className="text-2xl font-bold">{productsUsed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <MapPin className="mt-1 h-8 w-8 text-sky-600" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.zonesTreated")}</p>
              <p className="text-2xl font-bold">{zonesTreated}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <Sprout className="mt-1 h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">{t("kpi.applications")}</p>
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
          presets={KPI_DATE_PRESET_FERTILIZER}
          baselinePreset={FERTILIZER_DATE_FILTER_BASELINE}
          className="shrink-0"
        />
      </div>

      <div className="space-y-4">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-background p-1">
          {(["product", "month", "grass", "zone"] as const).map((key) => (
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
            <h3 className="mb-4 text-sm font-semibold">{activeChart.title}</h3>
            {activeChart.data.some((d) => d.amount > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={activeChart.data} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={90} />
                  <Tooltip
                    formatter={(v: number) => [
                      formatNumber(v, { maximumFractionDigits: 3 }),
                      t("charts.amount"),
                    ]}
                  />
                  <Bar dataKey="amount" fill={CHART_FILL} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
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
                    <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.grass")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.zone")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.product")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.amount")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.rate")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.operator")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDateDisplay(e.applied_date)}
                      </td>
                      <td className="px-4 py-3">
                        {e.farm_name ?? farmNameById.get(String(e.farm_id)) ?? e.farm_id}
                      </td>
                      <td className="px-4 py-3">
                        {e.grass_name ?? grassNameById.get(String(e.grass_id)) ?? e.grass_id}
                      </td>
                      <td className="px-4 py-3">
                        {e.zone_name?.trim() ||
                          zoneIdToLabel(String(e.zone_id ?? ""), farmZones) ||
                          e.zone_id}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {e.product_name ?? productById.get(Number(e.item_id))?.name ?? e.item_id}
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {formatNumber(e.amount, { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatUsageRateDisplay(e)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {e.operator_name?.trim() || "—"}
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
                <DatePicker
                  value={form.applied_date}
                  onChange={(v) => setForm((f) => ({ ...f, applied_date: v }))}
                  placeholder={t("dialog.datePlaceholder")}
                  disabled={saving}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.farm")} *</span>
                <select
                  className={inputClass}
                  value={form.farm_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, farm_id: e.target.value, grass_id: "", zone_id: "" }))
                  }
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
                <span className="text-xs font-medium">{t("dialog.grass")} *</span>
                <select
                  className={inputClass}
                  value={form.grass_id}
                  onChange={(e) => setForm((f) => ({ ...f, grass_id: e.target.value, zone_id: "" }))}
                >
                  <option value="">{t("dialog.selectGrass")}</option>
                  {grassOptionsForForm.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.zone")} *</span>
                <select
                  className={inputClass}
                  value={form.zone_id}
                  onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}
                >
                  <option value="">{t("dialog.selectZone")}</option>
                  {zoneOptions.map(([zoneId, zoneLabel]) => (
                    <option key={zoneId} value={zoneId}>
                      {zoneLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-xs font-medium">{t("dialog.product")} *</span>
                <select
                  className={inputClass}
                  value={form.item_id}
                  onChange={(e) => selectProduct(e.target.value)}
                >
                  <option value="">{t("dialog.selectProduct")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {products.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("dialog.noProductsHint")}</p>
                ) : null}
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.amount")} *</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={cn(inputClass, "tabular-nums")}
                  value={form.amount}
                  placeholder="0"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: formatDecimalInput(e.target.value) }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.rate")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={cn(inputClass, "tabular-nums")}
                  value={form.rate}
                  placeholder={t("dialog.ratePlaceholder")}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, rate: formatDecimalInput(e.target.value) }))
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("dialog.rateUom")}</span>
                <input
                  type="text"
                  className={inputClass}
                  value={form.rate_uom}
                  placeholder={t("dialog.rateUomPlaceholder")}
                  onChange={(e) => setForm((f) => ({ ...f, rate_uom: e.target.value }))}
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
                <span className="text-xs font-medium">{t("dialog.notes")}</span>
                <textarea
                  className={cn(inputClass, "min-h-[72px] py-2")}
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
    </div>
  );
}
