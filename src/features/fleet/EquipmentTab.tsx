"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, MapPin, Pencil, Plus, Search, Trash2, User, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchEquipmentCatalog,
  removeEquipment,
  type EquipmentRow,
} from "@/features/fleet/api/equipmentApi";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import {
  equipmentCardModelTitle,
} from "@/features/fleet/lib/equipmentModelDisplay";
import { EquipmentFormDialog } from "@/features/fleet/ui/EquipmentFormDialog";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { canAccessModule } from "@/shared/auth/permissions";
import { formatDateDisplay } from "@/shared/lib/format/date";
import { formatNumber } from "@/shared/lib/format/number";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { useFarmUserScope, useScopedFarmSelectOptions } from "@/shared/store/farmUserScope";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { ConfirmDeleteDialog } from "@/shared/ui/ConfirmDeleteDialog";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const canCreate = canAccessModule(user, "equipment", "create");
  const canEdit = canAccessModule(user, "equipment", "edit");
  const canDelete = canAccessModule(user, "equipment", "delete");
  const { types: machineryTypes } = useMachineryTypes();
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const scopedFarmOptions = useScopedFarmSelectOptions("equipment");
  const { scopeIds } = useFarmUserScope("equipment");

  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [farmFilter, setFarmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EquipmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => {
    void fetchAllHarvestingReferenceData(false);
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!scopeIds?.length || farmFilter === "all") return;
    if (!scopeIds.includes(farmFilter)) setFarmFilter("all");
  }, [farmFilter, scopeIds]);

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
    setEditingEquipment(null);
    setFormOpen(true);
  };

  const openEdit = (eq: EquipmentRow) => {
    setEditingEquipment(eq);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingEquipment(null);
  };

  const confirmDeleteLabel = useMemo(() => {
    if (!deleteTarget) return "";
    return equipmentCardModelTitle({
      model_short: deleteTarget.model_short,
      equipment_name: deleteTarget.equipment_name,
      model: deleteTarget.model,
    });
  }, [deleteTarget]);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canCreate ? (
          <button type="button" className={btnPrimary} onClick={openRegister}>
            <Plus className="h-4 w-4" />
            {t("register")}
          </button>
        ) : null}
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
          {scopedFarmOptions.map((farm) => (
            <option key={farm.id} value={farm.id}>
              {farm.label}
            </option>
          ))}
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
                    <div className="flex items-center gap-1">
                      {canEdit ? (
                        <button
                          type="button"
                          className={cn(btnGhost, "h-9 w-9 shrink-0")}
                          aria-label={t("editTitle")}
                          disabled={deleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(eq);
                          }}
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </button>
                      ) : null}
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

      <EquipmentFormDialog
        open={formOpen}
        onClose={closeForm}
        equipment={editingEquipment}
        onSaved={() => void load()}
      />

      <ConfirmDeleteDialog
        open={deleteTarget != null}
        title={t("deleteConfirmTitle")}
        message={t("deleteConfirmMessage", {
          name: deleteTarget
            ? `${deleteTarget.brand} ${confirmDeleteLabel}`.trim()
            : "",
        })}
        cancelLabel={tCommon("cancel")}
        confirmLabel={tCommon("delete")}
        deleting={deleting}
        deletingLabel={tCommon("deleting")}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget || deleting) return;
          void (async () => {
            try {
              setDeleting(true);
              await removeEquipment(deleteTarget.id);
              toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
              setDeleteTarget(null);
              await load();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("errors.delete"), {
                containerId: TOAST_CONTAINER_TOP_RIGHT,
              });
            } finally {
              setDeleting(false);
            }
          })();
        }}
      />
    </div>
  );
}
