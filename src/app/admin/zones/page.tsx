"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import RequireAuth from "@/features/auth/RequireAuth";
import { fetchZoneConfigurations, type ZoneConfigurationRow } from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ZoneRow = {
  id: string;
  farmName: string;
  country: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  inventoryKgPerM2: number;
  maxInventoryKg: number;
  datePlanted: string;
};

const inputClass =
  "flex h-8 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

function toNumber(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function AdminZonesPage() {
  const [rows, setRows] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterFarm, setFilterFarm] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editSize, setEditSize] = useState("");
  const [editYield, setEditYield] = useState("");
  const [newZone, setNewZone] = useState({
    farmName: "",
    turfgrass: "",
    zone: "",
    sizeM2: "",
    inventoryKgPerM2: "",
    datePlanted: "",
  });

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchZoneConfigurations();
        if (!mounted) return;
        const mapped = (data ?? []).map((r: ZoneConfigurationRow) => {
          const size = toNumber(r.size_m2);
          const inv = toNumber(r.inventory_kg_per_m2);
          return {
            id: String(r.id),
            farmName: r.farm_name,
            country: r.country ?? "-",
            turfgrass: r.turfgrass,
            zone: r.zone,
            sizeM2: size,
            inventoryKgPerM2: inv,
            maxInventoryKg: toNumber(r.max_inventory_kg) || size * inv,
            datePlanted: r.date_planted ?? "TBC",
          };
        });
        setRows(mapped);
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

  const farmOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.farmName))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filteredRows = useMemo(
    () => rows.filter((r) => filterFarm === "all" || r.farmName === filterFarm),
    [filterFarm, rows],
  );

  const totalZones = filteredRows.length;
  const totalArea = filteredRows.reduce((sum, row) => sum + row.sizeM2, 0);
  const totalKg = filteredRows.reduce((sum, row) => sum + row.maxInventoryKg, 0);

  const startEdit = (row: ZoneRow) => {
    setEditId(row.id);
    setEditSize(String(row.sizeM2));
    setEditYield(String(row.inventoryKgPerM2));
  };

  const saveEdit = (row: ZoneRow) => {
    const size = toNumber(editSize);
    const yld = toNumber(editYield);
    if (size <= 0 || yld <= 0) {
      setNotice("Invalid values: size and yield must be positive numbers.");
      return;
    }
    setRows((prev) =>
      prev.map((z) =>
        z.id === row.id
          ? {
              ...z,
              sizeM2: size,
              inventoryKgPerM2: yld,
              maxInventoryKg: size * yld,
            }
          : z,
      ),
    );
    setEditId(null);
    setNotice("Zone updated in current view. Press Save changes to confirm.");
  };

  const handleDelete = (row: ZoneRow) => {
    setRows((prev) => prev.filter((z) => z.id !== row.id));
    setNotice(`Removed ${row.farmName} ${row.turfgrass} Zone ${row.zone}.`);
  };

  const handleAdd = () => {
    const size = toNumber(newZone.sizeM2);
    const yld = toNumber(newZone.inventoryKgPerM2);
    if (
      !newZone.farmName.trim() ||
      !newZone.turfgrass.trim() ||
      !newZone.zone.trim() ||
      size <= 0 ||
      yld <= 0
    ) {
      setNotice("Missing fields: farm, grass, zone, size and yield are required.");
      return;
    }
    const row: ZoneRow = {
      id: `new-${Date.now()}`,
      farmName: newZone.farmName.trim(),
      country: "-",
      turfgrass: newZone.turfgrass.trim(),
      zone: newZone.zone.trim(),
      sizeM2: size,
      inventoryKgPerM2: yld,
      maxInventoryKg: size * yld,
      datePlanted: newZone.datePlanted.trim() || "TBC",
    };
    setRows((prev) => [...prev, row]);
    setNotice(`Added ${row.farmName} ${row.turfgrass} Zone ${row.zone}.`);
    setNewZone({
      farmName: "",
      turfgrass: "",
      zone: "",
      sizeM2: "",
      inventoryKgPerM2: "",
      datePlanted: "",
    });
    setAddOpen(false);
  };

  useEffect(() => {
    if (!addOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addOpen]);

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 text-foreground lg:p-8">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
            Zone Configuration
          </h1>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading zone configurations...</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

          {!loading && !error ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  This table drives all inventory calculations, forecasting, and harvest data across the app.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => setAddOpen((v) => !v)}
                  >
                    <Plus className="h-4 w-4" />
                    {addOpen ? "Close Add Zone" : "Add Zone"}
                  </button>
                  <button
                    type="button"
                    className={btnOutline}
                    disabled={saving}
                    onClick={() => setNotice("Layout updated. Hook save API for persistent zone changes.")}
                  >
                    Save changes
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Zones</p>
                    <p className="text-2xl font-bold">{totalZones}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Area</p>
                    <p className="text-2xl font-bold">{(totalArea / 1000).toFixed(0)}k m²</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Capacity</p>
                    <p className="text-2xl font-bold">{(totalKg / 1000).toFixed(0)}k kg</p>
                  </CardContent>
                </Card>
              </div>

              <div className="max-w-[220px]">
                <select
                  className={inputClass}
                  value={filterFarm}
                  onChange={(e) => setFilterFarm(e.target.value)}
                >
                  <option value="all">All Farms</option>
                  {farmOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="border-b border-border [&_tr]:border-b">
                        <tr className="border-b border-border transition-colors">
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Farm</th>
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Grass Type</th>
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Zone</th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Size (m²)</th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Yield (kg/m²)</th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Total Kg</th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {filteredRows.map((row) => {
                          const isEditing = editId === row.id;
                          return (
                            <tr key={row.id} className="border-b border-border transition-colors hover:bg-muted/40">
                              <td className="p-2 px-4 align-middle text-sm font-medium">{row.farmName}</td>
                              <td className="p-2 px-4 align-middle text-sm">{row.turfgrass}</td>
                              <td className="p-2 px-4 align-middle text-sm">{row.zone}</td>
                              <td className="p-2 px-4 text-right align-middle">
                                {isEditing ? (
                                  <input
                                    value={editSize}
                                    onChange={(e) => setEditSize(e.target.value)}
                                    className={cn(inputClass, "ml-auto w-24 text-right")}
                                  />
                                ) : (
                                  <span className="text-sm">{row.sizeM2.toLocaleString()}</span>
                                )}
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                {isEditing ? (
                                  <input
                                    value={editYield}
                                    onChange={(e) => setEditYield(e.target.value)}
                                    className={cn(inputClass, "ml-auto w-24 text-right")}
                                  />
                                ) : (
                                  <span className="text-sm">{row.inventoryKgPerM2}</span>
                                )}
                              </td>
                              <td className="p-2 px-4 text-right align-middle text-sm font-medium">
                                {row.maxInventoryKg.toLocaleString()}
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                <div className="flex items-center justify-end gap-1">
                                  {isEditing ? (
                                    <>
                                      <button className={btnPrimary} onClick={() => saveEdit(row)}>
                                        Save
                                      </button>
                                      <button className={cn(btnOutline, "h-9")} onClick={() => setEditId(null)}>
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button className={btnGhost} onClick={() => startEdit(row)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        className={cn(btnGhost, "text-destructive")}
                                        onClick={() => handleDelete(row)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {filteredRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                              No zones found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
        {addOpen ? (
          <div
            className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={() => setAddOpen(false)}
          >
            <Card
              className="w-full max-w-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Add new zone"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">Add New Zone</h2>
                  <button
                    type="button"
                    className={cn(btnOutline, "h-8 px-3")}
                    onClick={() => setAddOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Farm *</label>
                    <input
                      className={inputClass}
                      value={newZone.farmName}
                      onChange={(e) => setNewZone((v) => ({ ...v, farmName: e.target.value }))}
                      placeholder="Farm name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Grass Type *</label>
                    <input
                      className={inputClass}
                      value={newZone.turfgrass}
                      onChange={(e) => setNewZone((v) => ({ ...v, turfgrass: e.target.value }))}
                      placeholder="e.g. Bermuda"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Zone # *</label>
                    <input
                      className={inputClass}
                      value={newZone.zone}
                      onChange={(e) => setNewZone((v) => ({ ...v, zone: e.target.value }))}
                      placeholder="e.g. 1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Size (m²) *</label>
                    <input
                      className={inputClass}
                      value={newZone.sizeM2}
                      onChange={(e) => setNewZone((v) => ({ ...v, sizeM2: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Yield (kg/m²) *</label>
                    <input
                      className={inputClass}
                      value={newZone.inventoryKgPerM2}
                      onChange={(e) =>
                        setNewZone((v) => ({ ...v, inventoryKgPerM2: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Date Planted</label>
                  <input
                    className={inputClass}
                    value={newZone.datePlanted}
                    onChange={(e) => setNewZone((v) => ({ ...v, datePlanted: e.target.value }))}
                    placeholder="e.g. March 2026"
                  />
                </div>
                <button type="button" onClick={handleAdd} className={cn(btnPrimary, "w-full")}>
                  Add Zone
                </button>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DashboardLayout>
    </RequireAuth>
  );
}
