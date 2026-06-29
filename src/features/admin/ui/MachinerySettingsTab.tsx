"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchMachinery,
  fetchMachineryProducts,
  fetchStaffOptions,
  MACHINERY_FUEL_TYPES,
  removeMachinery,
  saveMachinery,
  type MachineryRow,
  type MachinerySavePayload,
  type MachineryStatus,
  type OwnershipType,
} from "@/features/fleet/api/machineryApi";
import {
  formatMachineryProductOptionLabel,
  type MachineryProductOption,
} from "@/features/fleet/lib/machineryProductCatalog";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type FormState = {
  id?: number;
  product_item_id: string;
  brand: string;
  model: string;
  type: string;
  serial_number: string;
  registration_number: string;
  year_of_manufacture: string;
  purchase_date: string;
  ownership: OwnershipType;
  farm_id: string;
  assigned_to_user_id: string;
  status: MachineryStatus;
  hours_used: string;
  hours_between_service: string;
  last_service_date: string;
  next_service_due: string;
  fuel_type: string;
  notes: string;
  odoo_id: string;
};

function emptyForm(): FormState {
  return {
    product_item_id: "",
    brand: "",
    model: "",
    type: "",
    serial_number: "",
    registration_number: "",
    year_of_manufacture: "",
    purchase_date: "",
    ownership: "Owned",
    farm_id: "",
    assigned_to_user_id: "",
    status: "Active",
    hours_used: "0",
    hours_between_service: "250",
    last_service_date: "",
    next_service_due: "",
    fuel_type: MACHINERY_FUEL_TYPES[0],
    notes: "",
    odoo_id: "",
  };
}

function rowToForm(row: MachineryRow): FormState {
  return {
    id: Number(row.id),
    product_item_id: row.product_item_id ? String(row.product_item_id) : "",
    brand: String(row.brand ?? ""),
    model: String(row.model ?? ""),
    type: String(row.type ?? ""),
    serial_number: String(row.serial_number ?? ""),
    registration_number: String(row.registration_number ?? ""),
    year_of_manufacture: row.year_of_manufacture ? String(row.year_of_manufacture) : "",
    purchase_date: String(row.purchase_date ?? "").slice(0, 10),
    ownership: (row.ownership as OwnershipType) || "Owned",
    farm_id: String(row.farm_id ?? ""),
    assigned_to_user_id: row.assigned_to_user_id ? String(row.assigned_to_user_id) : "",
    status: (row.status as MachineryStatus) || "Active",
    hours_used: row.hours_used != null ? String(row.hours_used) : "0",
    hours_between_service: row.hours_between_service != null ? String(row.hours_between_service) : "",
    last_service_date: String(row.last_service_date ?? "").slice(0, 10),
    next_service_due: String(row.next_service_due ?? "").slice(0, 10),
    fuel_type: String(row.fuel_type ?? MACHINERY_FUEL_TYPES[0]),
    notes: String(row.notes ?? ""),
    odoo_id: String(row.odoo_id ?? ""),
  };
}

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-800",
  "Under Maintenance": "bg-amber-100 text-amber-800",
  "Out of Service": "bg-red-100 text-red-800",
  Retired: "bg-muted text-muted-foreground",
};

export function MachinerySettingsTab() {
  const t = useTranslations("AdminMachinery");
  const { types: machineryTypes } = useMachineryTypes();
  const farms = useHarvestingDataStore((s) => s.farms);
  const [rows, setRows] = useState<MachineryRow[]>([]);
  const [staff, setStaff] = useState<Array<{ id: number | string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [farmFilter, setFarmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [productCatalog, setProductCatalog] = useState<MachineryProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { farm_id?: number; status?: string; type?: string } = {};
      if (farmFilter !== "all") params.farm_id = Number(farmFilter);
      if (statusFilter !== "all") params.status = statusFilter;
      if (typeFilter !== "all") params.type = typeFilter;
      const [data, staffRows] = await Promise.all([
        fetchMachinery(params),
        staff.length ? Promise.resolve(null) : fetchStaffOptions().catch(() => []),
      ]);
      setRows(data);
      if (staffRows) {
        setStaff(
          staffRows.map((s) => ({
            id: s.id,
            label: `${String(s.first_name ?? "").trim()} ${String(s.last_name ?? "").trim()}`.trim() || String(s.id),
          })),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setLoading(false);
    }
  }, [farmFilter, statusFilter, typeFilter, staff.length, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const hay = [m.brand, m.model, m.serial_number, m.registration_number, m.type]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, search]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((m) => m.status === "Active").length,
      maintenance: rows.filter((m) => m.status === "Under Maintenance").length,
      outOfService: rows.filter((m) => m.status === "Out of Service" || m.status === "Retired").length,
    }),
    [rows],
  );

  const openCreate = () => {
    const firstFarm = farms[0] as { id?: unknown } | undefined;
    setForm({
      ...emptyForm(),
      type: machineryTypes[0] ?? "",
      farm_id: firstFarm ? String(firstFarm.id ?? "") : "",
    });
    setOpen(true);
    void loadProductCatalog();
  };

  const openEdit = (row: MachineryRow) => {
    setForm(rowToForm(row));
    setOpen(true);
    void loadProductCatalog();
  };

  const loadProductCatalog = useCallback(async () => {
    setProductsLoading(true);
    try {
      const data = await fetchMachineryProducts();
      setProductCatalog(data);
    } catch (e) {
      setProductCatalog([]);
      toast.error(e instanceof Error ? e.message : t("errors.loadProducts"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setProductsLoading(false);
    }
  }, [t]);

  const applyProductSelection = (productId: string) => {
    const product = productCatalog.find((p) => String(p.id) === productId);
    if (!product) {
      setForm((f) => ({ ...f, product_item_id: productId, brand: "", model: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      product_item_id: productId,
      brand: product.brand,
      model: product.model,
    }));
  };

  const productLocked = Boolean(form.product_item_id);

  const productOptions = useMemo(() => {
    if (!form.product_item_id) return productCatalog;
    if (productCatalog.some((p) => String(p.id) === form.product_item_id)) return productCatalog;
    return [
      ...productCatalog,
      {
        id: Number(form.product_item_id),
        brand: form.brand,
        model: form.model,
        model_short: form.model,
      },
    ];
  }, [productCatalog, form.product_item_id, form.brand, form.model]);

  const handleSave = async () => {
    const farmId = Number(form.farm_id);
    const productItemId = form.product_item_id ? Number(form.product_item_id) : undefined;
    if (
      !form.brand.trim() ||
      !form.model.trim() ||
      !form.type ||
      !Number.isFinite(farmId) ||
      farmId <= 0 ||
      (!form.id && (!productItemId || !Number.isFinite(productItemId) || productItemId <= 0))
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    const payload: MachinerySavePayload = {
      id: form.id,
      product_item_id: productItemId,
      brand: form.brand.trim(),
      model: form.model.trim(),
      type: form.type,
      farm_id: farmId,
      serial_number: form.serial_number.trim() || undefined,
      registration_number: form.registration_number.trim() || undefined,
      year_of_manufacture: form.year_of_manufacture ? Number(form.year_of_manufacture) : undefined,
      purchase_date: form.purchase_date || undefined,
      ownership: form.ownership,
      assigned_to_user_id: form.assigned_to_user_id ? Number(form.assigned_to_user_id) : null,
      status: form.status,
      hours_used: form.hours_used ? Number(form.hours_used) : 0,
      hours_between_service: form.hours_between_service ? Number(form.hours_between_service) : undefined,
      last_service_date: form.last_service_date || undefined,
      next_service_due: form.next_service_due || undefined,
      fuel_type: form.fuel_type || undefined,
      notes: form.notes.trim() || undefined,
      odoo_id: form.odoo_id.trim() || null,
    };
    try {
      setSaving(true);
      const saved = await saveMachinery(payload);
      setRows((prev) => {
        const idx = prev.findIndex((r) => Number(r.id) === Number(saved.id));
        if (idx < 0) return [...prev, saved];
        const next = [...prev];
        next[idx] = saved;
        return next;
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

  const handleDelete = async (row: MachineryRow) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      setSaving(true);
      await removeMachinery(Number(row.id));
      setRows((prev) => prev.filter((r) => Number(r.id) !== Number(row.id)));
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" className={btnPrimary} onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t("register")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.total")}</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.active")}</p><p className="text-2xl font-bold text-primary">{stats.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.maintenance")}</p><p className="text-2xl font-bold">{stats.maintenance}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t("kpi.outRetired")}</p><p className="text-2xl font-bold text-destructive">{stats.outOfService}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
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
          {machineryTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select className={cn(inputClass, "w-[170px]")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t("filters.allStatuses")}</option>
          <option value="Active">{t("status.active")}</option>
          <option value="Under Maintenance">{t("status.maintenance")}</option>
          <option value="Out of Service">{t("status.outOfService")}</option>
          <option value="Retired">{t("status.retired")}</option>
        </select>
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
                    <th className="px-4 py-3 text-left font-medium">{t("table.machine")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.type")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.location")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.year")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.hours")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("table.status")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">{m.brand} {m.model}</p>
                        <p className="text-xs text-muted-foreground">{m.serial_number || m.registration_number || "—"}</p>
                      </td>
                      <td className="px-4 py-3">{m.type}</td>
                      <td className="px-4 py-3">{m.farm_name ?? m.farm_id}</td>
                      <td className="px-4 py-3">{m.year_of_manufacture ?? "—"}</td>
                      <td className="px-4 py-3">{Number(m.hours_used ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS_BADGE[String(m.status)] ?? STATUS_BADGE.Active)}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className={btnGhost} onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" className={cn(btnGhost, "text-destructive hover:bg-destructive/10")} disabled={saving} onClick={() => void handleDelete(m)}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t("table.empty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{form.id ? t("editTitle") : t("createTitle")}</h2>
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <label className="col-span-2 space-y-1">
                <span className="text-xs font-medium">{t("form.product")} *</span>
                <select
                  className={inputClass}
                  value={form.product_item_id}
                  disabled={Boolean(form.id) || productsLoading || saving}
                  onChange={(e) => applyProductSelection(e.target.value)}
                >
                  <option value="">{productsLoading ? t("form.loadingProducts") : t("form.selectProduct")}</option>
                  {productOptions.map((product) => (
                    <option key={product.id} value={String(product.id)}>
                      {formatMachineryProductOptionLabel(product)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.brand")} *</span>
                <input
                  className={cn(inputClass, productLocked && "bg-muted/50")}
                  value={form.brand}
                  readOnly={productLocked}
                  placeholder={t("form.brandPlaceholder")}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">{t("form.model")} *</span>
                <input
                  className={cn(inputClass, productLocked && "bg-muted/50")}
                  value={form.model}
                  readOnly={productLocked}
                  placeholder={t("form.modelPlaceholder")}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                />
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.type")} *</span>
                <select className={inputClass} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {machineryTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.farm")} *</span>
                <select className={inputClass} value={form.farm_id} onChange={(e) => setForm((f) => ({ ...f, farm_id: e.target.value }))}>
                  <option value="">{t("form.select")}</option>
                  {farms.map((farm) => {
                    const id = String((farm as { id?: unknown }).id ?? "");
                    return <option key={id} value={id}>{String((farm as { name?: unknown }).name ?? id)}</option>;
                  })}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.serial")}</span><input className={inputClass} value={form.serial_number} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.registration")}</span><input className={inputClass} value={form.registration_number} onChange={(e) => setForm((f) => ({ ...f, registration_number: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.year")}</span><input type="number" className={inputClass} value={form.year_of_manufacture} onChange={(e) => setForm((f) => ({ ...f, year_of_manufacture: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.ownership")}</span>
                <select className={inputClass} value={form.ownership} onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value as OwnershipType }))}>
                  <option value="Owned">Owned</option><option value="Leased">Leased</option><option value="Rented">Rented</option>
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.status")}</span>
                <select className={inputClass} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MachineryStatus }))}>
                  <option value="Active">{t("status.active")}</option>
                  <option value="Under Maintenance">{t("status.maintenance")}</option>
                  <option value="Out of Service">{t("status.outOfService")}</option>
                  <option value="Retired">{t("status.retired")}</option>
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.assignedTo")}</span>
                <select className={inputClass} value={form.assigned_to_user_id} onChange={(e) => setForm((f) => ({ ...f, assigned_to_user_id: e.target.value }))}>
                  <option value="">{t("form.unassigned")}</option>
                  {staff.map((s) => <option key={String(s.id)} value={String(s.id)}>{s.label}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.hoursUsed")}</span><input type="number" className={inputClass} value={form.hours_used} onChange={(e) => setForm((f) => ({ ...f, hours_used: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.hoursBetweenService")}</span><input type="number" className={inputClass} value={form.hours_between_service} onChange={(e) => setForm((f) => ({ ...f, hours_between_service: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.lastService")}</span><input type="date" className={inputClass} value={form.last_service_date} onChange={(e) => setForm((f) => ({ ...f, last_service_date: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.nextService")}</span><input type="date" className={inputClass} value={form.next_service_due} onChange={(e) => setForm((f) => ({ ...f, next_service_due: e.target.value }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.fuelType")}</span>
                <select className={inputClass} value={form.fuel_type} onChange={(e) => setForm((f) => ({ ...f, fuel_type: e.target.value }))}>
                  {MACHINERY_FUEL_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="text-xs font-medium">{t("form.odooId")}</span><input className={inputClass} value={form.odoo_id} onChange={(e) => setForm((f) => ({ ...f, odoo_id: e.target.value }))} /></label>
              <label className="col-span-2 space-y-1"><span className="text-xs font-medium">{t("form.notes")}</span><textarea className={cn(inputClass, "min-h-[72px] py-2")} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setOpen(false)}>{t("cancel")}</button>
              <button type="button" className={btnPrimary} disabled={saving} onClick={() => void handleSave()}>{t("save")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
