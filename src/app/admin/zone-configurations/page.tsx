"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchZoneConfigurations,
  removeZoneConfiguration,
  saveZoneConfiguration,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  filterFarmZoneRowsByFarmId,
  mapRowsToSelectOptions,
  parseFarmZoneEntries,
  zoneIdToLabel,
} from "@/shared/lib/harvestReferenceData";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";

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
  country?: string | null;
};

function emptyForm(): FormState {
  return {
    farm_id: "",
    grass_id: "",
    zone: "",
    size_m2: "",
    inventory_kg_per_m2: "",
    date_planted: "",
    country: null,
  };
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
  const [error, setError] = useState<string | null>(null);
  const [selectedFarmFilter, setSelectedFarmFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const farms = useHarvestingDataStore((s) => s.farms);
  const grasses = useHarvestingDataStore((s) => s.grasses);
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
    () => mapRowsToSelectOptions(grasses as unknown[], "title"),
    [grasses],
  );
  const filteredFarmZoneRows = useMemo(
    () => filterFarmZoneRowsByFarmId(farmZones, form.farm_id),
    [farmZones, form.farm_id],
  );
  const filteredZoneEntries = useMemo(() => {
    const entries = parseFarmZoneEntries(filteredFarmZoneRows);
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
        setError(null);
        const data = await fetchZoneConfigurations();
        if (!mounted) return;
        setRows(data);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load zone configurations.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const visibleRows = useMemo(() => {
    if (!selectedFarmFilter) return rows;
    return rows.filter((row) => String(row.farm_id) === selectedFarmFilter);
  }, [rows, selectedFarmFilter]);

  const openCreate = () => {
    setForm(emptyForm());
    setError(null);
    setOpen(true);
  };

  const openEdit = (row: ZoneConfigurationRow) => {
    setForm({
      id: Number(row.id),
      farm_id: String(row.farm_id),
      grass_id: String(row.grass_id),
      zone: String(row.zone ?? "").trim(),
      size_m2: String(row.size_m2 ?? ""),
      inventory_kg_per_m2: String(row.inventory_kg_per_m2 ?? ""),
      date_planted: String(row.date_planted ?? ""),
      country: row.country ?? null,
    });
    setError(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const grassId = Number(form.grass_id);
    const zone = form.zone.trim();
    const size = toNumber(form.size_m2);
    const yieldKg = toNumber(form.inventory_kg_per_m2);

    if (farmId <= 0 || grassId <= 0 || !zone || size <= 0 || yieldKg <= 0) {
      setError(t("errors.required"));
      return;
    }

    try {
      setSaving(true);
      setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save zone configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ZoneConfigurationRow) => {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!window.confirm(`Delete ${row.zone}?`)) return;

    try {
      setSaving(true);
      setError(null);
      await removeZoneConfiguration(id);
      setRows((prev) => prev.filter((item) => Number(item.id) !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete zone configuration.");
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              className={cn(inputClass, "w-full sm:max-w-xs")}
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
            {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">{t("table.farm")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.grassType")}</th>
                      <th className="px-4 py-3 text-left font-medium">{t("table.zone")}</th>
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
                        <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                          {t("empty")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
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
            }}
          >
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

              <Field label={t("form.datePlanted")}>
                <input
                  className={inputClass}
                  value={form.date_planted}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, date_planted: e.target.value }))
                  }
                  placeholder="e.g. March 2026"
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnOutline}
                onClick={() => {
                  if (saving) return;
                  setOpen(false);
                  setForm(emptyForm());
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
          <div className="flex items-center justify-between">
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
