"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format, isValid, parseISO } from "date-fns";
import { CalendarDays, CircleAlert, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchZoneConfigurations,
  removeZoneConfiguration,
  saveZoneConfiguration,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import { onForecastMutation } from "@/features/forecasting/forecastDataSync";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  farmZoneSelectIdForStoredZone,
  filterFarmZoneRowsByFarmId,
  mapRowsToSelectOptions,
  parseFarmZoneEntries,
  todayYmdLocal,
  zoneIdToLabel,
  type FarmZoneReferenceRow,
} from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { DatePicker, DateRangePicker } from "@/shared/ui/date-picker";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  id?: number;
  farm_id: string;
  grass_id: string;
  zone: string;
  size_m2: string;
  inventory_kg_per_m2: string;
  date_planted: string;
  effective_from: string;
  effective_to: string;
  country?: string | null;
};

type DateRangeFilter = { from?: string; to?: string };

function emptyForm(): FormState {
  return {
    farm_id: "",
    grass_id: "",
    zone: "",
    size_m2: "",
    inventory_kg_per_m2: "",
    date_planted: "",
    effective_from: "",
    effective_to: "",
    country: null,
  };
}

function ymdSlice(value: string | null | undefined): string {
  const s = String(value ?? "").trim().slice(0, 10);
  if (!s || s.startsWith("0000-00-00")) return "";
  return s;
}

function formatDisplayDate(value: string | null | undefined): string {
  const ymd = ymdSlice(value);
  if (!ymd) return "";
  const parsed = parseISO(ymd);
  return isValid(parsed) ? format(parsed, "dd/M/yyyy") : ymd;
}

function zoneConfigCoversYmd(row: ZoneConfigurationRow, ymd: string): boolean {
  const from = ymdSlice(row.effective_from);
  const to = ymdSlice(row.effective_to);
  if (!from && !to) return false;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

function zoneConfigCoversDate(row: ZoneConfigurationRow, date: Date): boolean {
  return zoneConfigCoversYmd(row, format(date, "yyyy-MM-dd"));
}

function zoneConfigOverlapsFilter(
  row: ZoneConfigurationRow,
  filterFrom?: string,
  filterTo?: string,
): boolean {
  if (!filterFrom && !filterTo) return true;

  const rowFrom = ymdSlice(row.effective_from) || "0000-01-01";
  const rowTo = ymdSlice(row.effective_to) || "9999-12-31";
  const fFrom = filterFrom || "0000-01-01";
  const fTo = filterTo || "9999-12-31";

  return rowFrom <= fTo && rowTo >= fFrom;
}

function zoneConfigHasPeriod(input: {
  effective_from?: string | null;
  effective_to?: string | null;
}): boolean {
  return Boolean(ymdSlice(input.effective_from) || ymdSlice(input.effective_to));
}

function zoneConfigIdentityKey(input: {
  farm_id: number | string;
  grass_id: number | string;
  zone: string;
  effective_from?: string | null;
  effective_to?: string | null;
}): string {
  if (!zoneConfigHasPeriod(input)) {
    return [String(input.farm_id), String(input.grass_id), String(input.zone ?? "").trim()].join("|");
  }
  return [
    String(input.farm_id),
    String(input.grass_id),
    String(input.zone ?? "").trim(),
    ymdSlice(input.effective_from) || "",
    ymdSlice(input.effective_to) || "",
  ].join("|");
}

function findDuplicateZoneConfig(
  rows: ZoneConfigurationRow[],
  candidate: {
    id?: number;
    farm_id: number | string;
    grass_id: number | string;
    zone: string;
    effective_from?: string | null;
    effective_to?: string | null;
  },
): ZoneConfigurationRow | undefined {
  const key = zoneConfigIdentityKey(candidate);
  const excludeId = candidate.id != null ? Number(candidate.id) : 0;

  return rows.find((row) => {
    if (excludeId > 0 && Number(row.id) === excludeId) return false;
    return zoneConfigIdentityKey(row) === key;
  });
}

function zoneConfigRowMatchesFormZone(
  row: ZoneConfigurationRow,
  formZone: string,
  farmZones: FarmZoneReferenceRow[],
): boolean {
  const zone = formZone.trim();
  if (!zone) return false;

  const stored = String(row.zone ?? "").trim();
  if (stored === zone) return true;

  const zoneRows = filterFarmZoneRowsByFarmId(farmZones, row.farm_id);
  const mappedSelectId =
    farmZoneSelectIdForStoredZone(stored, zoneRows) ??
    farmZoneSelectIdForStoredZone(stored, farmZones);
  return mappedSelectId === zone;
}

function toNumber(value: string): number {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: string | number | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat().format(Number.isFinite(parsed) ? parsed : 0);
}

export default function AdminZoneConfigurationsPage() {
  const t = useTranslations("AdminZones");
  const [rows, setRows] = useState<ZoneConfigurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedFarmFilter, setSelectedFarmFilter] = useState("");
  const [selectedGrassFilter, setSelectedGrassFilter] = useState("");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const farms = useHarvestingDataStore((s) => s.farms);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const pickGrassesForZoneConfigSelectWithPins = useHarvestingDataStore(
    (s) => s.pickGrassesForZoneConfigSelectWithPins,
  );
  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const bootstrapDone = useHarvestingDataStore((s) => s.bootstrapDone);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  useEffect(() => {
    if (bootstrapDone) return;
    void fetchAllHarvestingReferenceData();
  }, [bootstrapDone, fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );
  const grassOptions = useMemo(
    () =>
      mapRowsToSelectOptions(
        pickGrassesForZoneConfigSelectWithPins(todayYmdLocal(), [
          form.grass_id.trim(),
        ]) as unknown[],
        "title",
      ),
    [grasses, form.grass_id, pickGrassesForZoneConfigSelectWithPins],
  );
  const filteredFarmZoneRows = useMemo(
    () => filterFarmZoneRowsByFarmId(farmZones, form.farm_id),
    [farmZones, form.farm_id],
  );
  const filteredZoneEntries = useMemo(() => {
    const entries = parseFarmZoneEntries(filteredFarmZoneRows, "id");
    const currentZone = form.zone.trim();
    if (!currentZone || entries.some(([value]) => value === currentZone)) {
      return entries;
    }
    return [[currentZone, zoneIdToLabel(currentZone, farmZones) || currentZone], ...entries];
  }, [filteredFarmZoneRows, form.zone, farmZones]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setPageError(null);
        const data = await fetchZoneConfigurations();
        if (!mounted) return;
        setRows(data);
      } catch (e) {
        if (!mounted) return;
        setPageError(e instanceof Error ? e.message : "Failed to load zone configurations.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const grassFilterOptions = useMemo(() => {
    const ids = new Set(rows.map((r) => String(r.grass_id)));
    const idToTitle = new Map<string, string>();
    for (const g of grasses as unknown[]) {
      if (!g || typeof g !== "object") continue;
      const r = g as Record<string, unknown>;
      const id = r.id != null ? String(r.id) : "";
      if (!id || !ids.has(id)) continue;
      const raw = r.title ?? r.name;
      idToTitle.set(id, raw != null ? String(raw) : id);
    }
    const options = [...ids].map((id) => {
      const fromRef = idToTitle.get(id);
      const sample = rows.find((row) => String(row.grass_id) === id);
      const turf =
        sample?.turfgrass != null && String(sample.turfgrass).trim() !== ""
          ? String(sample.turfgrass)
          : null;
      return { id, label: fromRef ?? turf ?? id };
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, grasses]);

  const rowsAfterFarmGrassFilter = useMemo(() => {
    let next = rows;
    if (selectedFarmFilter) {
      next = next.filter((row) => String(row.farm_id) === selectedFarmFilter);
    }
    if (selectedGrassFilter) {
      next = next.filter((row) => String(row.grass_id) === selectedGrassFilter);
    }
    return next;
  }, [rows, selectedFarmFilter, selectedGrassFilter]);

  const visibleRows = useMemo(
    () =>
      rowsAfterFarmGrassFilter.filter((row) =>
        zoneConfigOverlapsFilter(row, dateRangeFilter.from, dateRangeFilter.to),
      ),
    [rowsAfterFarmGrassFilter, dateRangeFilter.from, dateRangeFilter.to],
  );

  const totalMaxInventoryKg = useMemo(
    () =>
      visibleRows.reduce((sum, row) => {
        const v =
          typeof row.max_inventory_kg === "number"
            ? row.max_inventory_kg
            : toNumber(String(row.max_inventory_kg ?? ""));
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0),
    [visibleRows],
  );

  const isMarkedSetupDate = useCallback(
    (date: Date) => rowsAfterFarmGrassFilter.some((row) => zoneConfigCoversDate(row, date)),
    [rowsAfterFarmGrassFilter],
  );

  const formIdentityComplete = Boolean(
    form.farm_id.trim() && form.grass_id.trim() && form.zone.trim(),
  );

  const formMatchingRowsForMark = useMemo(() => {
    if (!formIdentityComplete) return [];
    return rows.filter(
      (row) =>
        String(row.farm_id) === form.farm_id &&
        String(row.grass_id) === form.grass_id &&
        zoneConfigRowMatchesFormZone(row, form.zone, farmZones),
    );
  }, [rows, form.farm_id, form.grass_id, form.zone, formIdentityComplete, farmZones]);

  const formMatchingRowsForDisable = useMemo(() => {
    const excludeId = form.id != null ? Number(form.id) : 0;
    return formMatchingRowsForMark.filter(
      (row) => excludeId <= 0 || Number(row.id) !== excludeId,
    );
  }, [formMatchingRowsForMark, form.id]);

  const isFormSetupDateMarked = useCallback(
    (date: Date) => formMatchingRowsForMark.some((row) => zoneConfigCoversDate(row, date)),
    [formMatchingRowsForMark],
  );

  const isFormSetupDateDisabled = useCallback(
    (date: Date) => formMatchingRowsForDisable.some((row) => zoneConfigCoversDate(row, date)),
    [formMatchingRowsForDisable],
  );

  const hasDateRangeFilter = Boolean(dateRangeFilter.from || dateRangeFilter.to);

  const openCreate = () => {
    setForm(emptyForm());
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (row: ZoneConfigurationRow) => {
    const zoneRows = filterFarmZoneRowsByFarmId(farmZones, row.farm_id);
    const stored = String(row.zone ?? "").trim();
    const mappedZone =
      farmZoneSelectIdForStoredZone(stored, zoneRows) ??
      farmZoneSelectIdForStoredZone(stored, farmZones) ??
      stored;
    setForm({
      id: Number(row.id),
      farm_id: String(row.farm_id),
      grass_id: String(row.grass_id),
      zone: mappedZone,
      size_m2: String(row.size_m2 ?? ""),
      inventory_kg_per_m2: String(row.inventory_kg_per_m2 ?? ""),
      date_planted: ymdSlice(row.date_planted),
      effective_from: ymdSlice(row.effective_from),
      effective_to: ymdSlice(row.effective_to),
      country: row.country ?? null,
    });
    setFormError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const grassId = Number(form.grass_id);
    const zone = form.zone.trim();
    const size = toNumber(form.size_m2);
    const yieldKg = toNumber(form.inventory_kg_per_m2);

    if (farmId <= 0 || grassId <= 0 || !zone || size <= 0 || yieldKg <= 0) {
      setFormError(t("errors.required"));
      return;
    }

    const effectiveFrom = form.effective_from.trim();
    const effectiveTo = form.effective_to.trim();
    if (!effectiveFrom && effectiveTo) {
      setFormError(t("errors.effectiveFromRequiredWhenToSet"));
      return;
    }
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
      setFormError(t("errors.dateRange"));
      return;
    }

    const duplicate = findDuplicateZoneConfig(rows, {
      id: form.id,
      farm_id: farmId,
      grass_id: grassId,
      zone,
      effective_from: effectiveFrom || null,
      effective_to: effectiveTo || null,
    });
    if (duplicate) {
      setFormError(
        zoneConfigHasPeriod({ effective_from: effectiveFrom, effective_to: effectiveTo })
          ? t("errors.duplicate")
          : t("errors.duplicateNoDates"),
      );
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const saved = await saveZoneConfiguration({
        id: form.id,
        farm_id: farmId,
        country: form.country ?? null,
        grass_id: grassId,
        zone,
        size_m2: size,
        inventory_kg_per_m2: yieldKg,
        max_inventory_kg: size * yieldKg,
        date_planted: form.date_planted.trim() || null,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        status: "active",
      });

      setRows((prev) => {
        const idx = prev.findIndex((row) => Number(row.id) === Number(saved.id));
        if (idx < 0) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
      });
      setOpen(false);
      setForm(emptyForm());
      setFormError(null);
      try {
        await fetchAllHarvestingReferenceData(true);
      } catch {
        /* best-effort */
      }
      onForecastMutation("zones");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save zone configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ZoneConfigurationRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    const zoneLabel = zoneIdToLabel(String(row.zone ?? ""), farmZones) || String(row.zone ?? "");
    if (!window.confirm(`Delete ${zoneLabel}?`)) return;

    try {
      setSaving(true);
      setPageError(null);
      await removeZoneConfiguration(id);
      setRows((prev) => prev.filter((item) => Number(item.id) !== id));
      try {
        await fetchAllHarvestingReferenceData(true);
      } catch {
        /* best-effort */
      }
      onForecastMutation("zones");
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Could not delete zone configuration.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 lg:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{t("title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
            </div>
            <button type="button" className={btnPrimary} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("addNewZone")}
            </button>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardContent className="space-y-4 p-4 lg:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t("filters.dateRangeSection")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("filters.dateRangeHint")}</p>
                  </div>
                </div>
                {hasDateRangeFilter ? (
                  <button
                    type="button"
                    className={cn(btnOutline, "h-8 px-3 text-xs")}
                    onClick={() => setDateRangeFilter({})}
                  >
                    {t("filters.clearDates")}
                  </button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                <select
                  className={inputClass}
                  value={selectedFarmFilter}
                  onChange={(e) => setSelectedFarmFilter(e.target.value)}
                >
                  <option value="">{t("allFarms")}</option>
                  {farmOptions.map((farm) => (
                    <option key={farm.id} value={farm.id}>
                      {farm.label}
                    </option>
                  ))}
                </select>
                <select
                  className={inputClass}
                  value={selectedGrassFilter}
                  onChange={(e) => setSelectedGrassFilter(e.target.value)}
                >
                  <option value="">{t("allGrasses")}</option>
                  {grassFilterOptions.map((grass) => (
                    <option key={grass.id} value={grass.id}>
                      {grass.label}
                    </option>
                  ))}
                </select>
                <DateRangePicker
                  value={dateRangeFilter}
                  onChange={setDateRangeFilter}
                  placeholder={t("filters.dateRangePlaceholder")}
                  selectingEndHint={t("filters.selectingEndHint")}
                  clearLabel={t("filters.clearDates")}
                  isMarkedDate={isMarkedSetupDate}
                  className="h-9 rounded-md border-border bg-background text-sm shadow-sm"
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  {t("filters.calendarLegend")}
                </span>
                <span>
                  {hasDateRangeFilter
                    ? t("filters.dateRangeActive", {
                        from: formatDisplayDate(dateRangeFilter.from) || "…",
                        to: formatDisplayDate(dateRangeFilter.to) || "…",
                      })
                    : t("filters.dateRangeAll")}
                </span>
                <span className="text-foreground/70">
                  {t("filters.rowCount", {
                    count: visibleRows.length,
                    total: rowsAfterFarmGrassFilter.length,
                  })}
                </span>
              </div>

              {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
              {pageError ? <p className="text-sm text-destructive">{pageError}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.grassType")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.zone")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.effectiveFrom")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.effectiveTo")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.size")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.yield")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.totalKg")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 font-medium">{row.farm_name ?? row.farm_id}</td>
                        <td className="px-4 py-3">{row.turfgrass ?? row.grass_id}</td>
                        <td className="px-4 py-3">
                          {zoneIdToLabel(String(row.zone ?? ""), farmZones) || row.zone}
                        </td>
                        <td className="px-4 py-3">
                          <DateBadge value={row.effective_from} />
                        </td>
                        <td className="px-4 py-3">
                          <DateBadge value={row.effective_to} openEndedLabel={
                            ymdSlice(row.effective_from) ? t("table.openEnded") : undefined
                          } />
                        </td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.size_m2)}</td>
                        <td className="px-4 py-3 text-right">
                          {formatNumber(row.inventory_kg_per_m2)}
                        </td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.max_inventory_kg)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" className={btnGhost} onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={cn(btnGhost, "text-destructive")}
                              disabled={saving}
                              onClick={() => void handleDelete(row)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!loading && visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                          {t("empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  {!loading && visibleRows.length > 0 ? (
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/40">
                        <td
                          colSpan={7}
                          className="px-4 py-3 text-right text-sm font-semibold text-foreground"
                        >
                          {t("stats.totalCapacity")}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                          {formatNumber(totalMaxInventoryKg)}
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {open ? (
          <Modal
            title={form.id ? t("editZoneConfiguration") : t("addNewZone")}
            onClose={() => {
              if (saving) return;
              setOpen(false);
              setForm(emptyForm());
              setFormError(null);
            }}
          >
            {formError ? (
              <FormErrorAlert message={formError} />
            ) : null}
            <div className="space-y-5">
              <section className="space-y-3">
                <FormSectionTitle>{t("form.zoneDetailsSection")}</FormSectionTitle>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("form.farmRequired")}>
                    <select
                      className={inputClass}
                      value={form.farm_id}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          farm_id: e.target.value,
                          zone: "",
                        }))
                      }
                    >
                      <option value="">{t("form.selectFarm")}</option>
                      {farmOptions.map((farm) => (
                        <option key={farm.id} value={farm.id}>
                          {farm.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t("form.grassTypeRequired")}>
                    <select
                      className={inputClass}
                      value={form.grass_id}
                      onChange={(e) => setForm((prev) => ({ ...prev, grass_id: e.target.value }))}
                    >
                      <option value="">{t("form.selectGrass")}</option>
                      {grassOptions.map((grass) => (
                        <option key={grass.id} value={grass.id}>
                          {grass.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label={t("form.zoneRequired")}>
                      <select
                        className={inputClass}
                        value={form.zone}
                        onChange={(e) => setForm((prev) => ({ ...prev, zone: e.target.value }))}
                      >
                        <option value="">{t("form.selectZone")}</option>
                        {filteredZoneEntries.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                <FormSectionTitle>{t("form.capacitySection")}</FormSectionTitle>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("form.sizeRequired")}>
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.size_m2}
                      onChange={(e) => setForm((prev) => ({ ...prev, size_m2: e.target.value }))}
                    />
                  </Field>

                  <Field label={t("form.yieldRequired")}>
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.inventory_kg_per_m2}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          inventory_kg_per_m2: e.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="flex flex-col justify-center rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 sm:min-h-[4.5rem]">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("form.maxInventoryPreview")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-primary">
                    {formatNumber(toNumber(form.size_m2) * toNumber(form.inventory_kg_per_m2))}{" "}
                    <span className="text-base font-medium">kg</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("form.maxInventoryFormula")}</p>
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div>
                    <FormSectionTitle className="mb-0">{t("filters.dateRangeSection")}</FormSectionTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{t("form.effectiveWindowHint")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("form.effectiveFrom")}>
                    <DatePicker
                      value={form.effective_from}
                      onChange={(v) => setForm((prev) => ({ ...prev, effective_from: v }))}
                      placeholder={t("form.datePlaceholder")}
                      disabled={saving}
                      isMarkedDate={formIdentityComplete ? isFormSetupDateMarked : undefined}
                      isDisabledDate={formIdentityComplete ? isFormSetupDateDisabled : undefined}
                    />
                  </Field>

                  <Field label={t("form.effectiveTo")}>
                    <DatePicker
                      value={form.effective_to}
                      onChange={(v) => setForm((prev) => ({ ...prev, effective_to: v }))}
                      placeholder={t("form.datePlaceholder")}
                      disabled={saving}
                      isMarkedDate={formIdentityComplete ? isFormSetupDateMarked : undefined}
                      isDisabledDate={formIdentityComplete ? isFormSetupDateDisabled : undefined}
                    />
                  </Field>
                </div>

                {formIdentityComplete ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      {t("filters.calendarLegend")}
                    </span>
                    <span>{t("form.calendarDisabledHint")}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("form.calendarSelectIdentityHint")}</p>
                )}
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setForm(emptyForm());
                  setFormError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </Modal>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}

function DateBadge({
  value,
  openEndedLabel,
}: {
  value?: string | null;
  openEndedLabel?: string;
}) {
  const ymd = ymdSlice(value);
  if (!ymd) {
    if (openEndedLabel) {
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          {openEndedLabel}
        </span>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  }

  const today = todayYmdLocal();
  const isCurrentOrPast = ymd <= today;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums",
        isCurrentOrPast
          ? "border-primary/20 bg-primary/5 text-primary"
          : "border-border bg-muted/40 text-foreground",
      )}
    >
      {formatDisplayDate(value)}
    </span>
  );
}

function FormErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function FormSectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn("text-sm font-semibold text-foreground", className)}>{children}</h3>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-80 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-3xl">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button type="button" className={btnGhost} onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
