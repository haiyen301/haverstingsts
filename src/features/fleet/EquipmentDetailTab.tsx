"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  Hash,
  MapPin,
  Pencil,
  Plus,
  Settings,
  Tag,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import {
  fetchEquipmentDetail,
  formatEquipmentCost,
  removeEquipment,
  removeEquipmentHourMeterReading,
  removeEquipmentServiceLog,
  saveEquipmentServiceLog,
  updateEquipmentHourMeter,
  type EquipmentDetail,
  type EquipmentHourMeterReading,
  type EquipmentRow,
  type EquipmentServiceLog,
  type EquipmentServiceLogType,
} from "@/features/fleet/api/equipmentApi";
import { FLEET_OPTION_CATALOG_KEYS } from "@/features/fleet/api/fleetOptionCatalogApi";
import { fetchStaffOptions } from "@/features/fleet/api/machineryApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
import { equipmentCardModelTitle } from "@/features/fleet/lib/equipmentModelDisplay";
import { calcEquipmentServiceInterval } from "@/features/fleet/lib/equipmentServiceInterval";
import { EquipmentFormDialog } from "@/features/fleet/ui/EquipmentFormDialog";
import { canAccessModule } from "@/shared/auth/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateDisplay } from "@/shared/lib/format/date";
import {
  formatDecimalInput,
  formatDecimalInputFromValue,
  formatNumber,
  parseDecimalField,
} from "@/shared/lib/format/number";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { ConfirmDeleteDialog } from "@/shared/ui/ConfirmDeleteDialog";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { DatePicker } from "@/shared/ui/date-picker";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const textareaClass =
  "flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ServiceLogForm = {
  id?: number;
  service_date: string;
  service_type: EquipmentServiceLogType | string;
  description: string;
  hours_at_service: string;
  cost: string;
  performed_by_user_id: string;
};

function emptyServiceLogForm(): ServiceLogForm {
  return {
    service_date: "",
    service_type: "Scheduled",
    description: "",
    hours_at_service: "",
    cost: "",
    performed_by_user_id: "",
  };
}

function serviceLogToForm(log: EquipmentServiceLog): ServiceLogForm {
  return {
    id: log.id,
    service_date: String(log.service_date ?? "").slice(0, 10),
    service_type: log.service_type ?? "Scheduled",
    description: String(log.description ?? ""),
    hours_at_service: formatDecimalInputFromValue(log.hours_at_service),
    cost: formatDecimalInputFromValue(log.cost),
    performed_by_user_id: log.performed_by_user_id ? String(log.performed_by_user_id) : "",
  };
}

function equipmentStatusKey(status: string): "operational" | "maintenance" | "outOfService" {
  if (status === "Under Maintenance") return "maintenance";
  if (status === "Out of Service" || status === "Retired") return "outOfService";
  return "operational";
}

function serviceTypeBadgeClass(type: string): string {
  if (type === "Repair") return "bg-red-100 text-red-800";
  if (type === "Unscheduled") return "border border-input bg-background text-foreground";
  return "bg-muted text-foreground";
}

type Props = {
  equipmentId: number;
  returnTo?: string;
};

type DeleteConfirmTarget =
  | { kind: "equipment" }
  | { kind: "serviceLog"; log: EquipmentServiceLog }
  | { kind: "hourMeterReading"; reading: EquipmentHourMeterReading };

export function EquipmentDetailTab({ equipmentId, returnTo = "/fleet/equipment" }: Props) {
  const t = useTranslations("EquipmentDetail");
  const tEq = useTranslations("Equipment");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const canEdit = canAccessModule(user, "equipment", "edit");
  const canCreate = canAccessModule(user, "equipment", "create");
  const canDelete = canAccessModule(user, "equipment", "delete");
  const { values: catalogServiceTypes } = useFleetOptionCatalog(
    FLEET_OPTION_CATALOG_KEYS.equipmentServiceTypes,
  );

  const [detail, setDetail] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<Array<{ id: number | string; label: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<EquipmentServiceLog | null>(null);
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [logForm, setLogForm] = useState<ServiceLogForm>(emptyServiceLogForm());
  const [editEquipmentOpen, setEditEquipmentOpen] = useState(false);
  const [hourMeterOpen, setHourMeterOpen] = useState(false);
  const [hourMeterListOpen, setHourMeterListOpen] = useState(false);
  const [selectedReading, setSelectedReading] = useState<EquipmentHourMeterReading | null>(null);
  const [hourMeterForm, setHourMeterForm] = useState({
    id: undefined as number | undefined,
    hours_reading: "",
    reading_date: "",
    notes: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEquipmentDetail(equipmentId);
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [equipmentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchStaffOptions()
      .then((rows) =>
        setStaff(
          rows.map((s) => ({
            id: s.id,
            label:
              `${String(s.first_name ?? "").trim()} ${String(s.last_name ?? "").trim()}`.trim() ||
              String(s.id),
          })),
        ),
      )
      .catch(() => setStaff([]));
  }, []);

  const eq = detail?.equipment ?? null;
  const logs = detail?.service_logs ?? [];
  const hourMeterReadings = detail?.hour_meter_readings ?? [];
  const serviceTypes = detail?.service_types?.length ? detail.service_types : catalogServiceTypes;

  const statusKey = eq ? equipmentStatusKey(String(eq.status)) : "operational";
  const statusBadgeClass: Record<string, string> = {
    operational: "bg-emerald-100 text-emerald-800",
    maintenance: "bg-amber-100 text-amber-800",
    outOfService: "bg-red-100 text-red-800",
  };

  const interval = calcEquipmentServiceInterval(eq ?? {});
  const hasServiceLogs = logs.length > 0;
  const canUpdateHourMeter = canEdit && hasServiceLogs;
  const outOfServiceReason =
    statusKey === "outOfService"
      ? String(logs[0]?.description ?? "").trim()
      : "";

  const titleModel = useMemo(() => {
    if (!eq) return "";
    return equipmentCardModelTitle({
      model_short: eq.model_short,
      equipment_name: eq.equipment_name,
      model: eq.model,
    });
  }, [eq]);

  const openAddLog = () => {
    const meterReading =
      eq && Number(eq.hours_used) > 0
        ? formatDecimalInputFromValue(eq.hours_used)
        : "";
    setLogForm({
      ...emptyServiceLogForm(),
      hours_at_service: meterReading,
      performed_by_user_id: eq?.assigned_to_user_id ? String(eq.assigned_to_user_id) : "",
    });
    setLogFormOpen(true);
  };

  const openHourMeter = (reading?: EquipmentHourMeterReading | null) => {
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (reading) {
      setHourMeterForm({
        id: reading.id,
        hours_reading: formatDecimalInputFromValue(reading.hours_reading),
        reading_date: String(reading.reading_date ?? "").slice(0, 10) || ymd,
        notes: String(reading.notes ?? ""),
      });
      setSelectedReading(null);
    } else {
      setHourMeterForm({
        id: undefined,
        hours_reading: "",
        reading_date: ymd,
        notes: "",
      });
    }
    setHourMeterOpen(true);
  };

  const handleSaveHourMeter = async () => {
    if (!hourMeterForm.hours_reading.trim()) {
      toast.error(t("errors.hourMeterRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    const hoursReading = parseDecimalField(hourMeterForm.hours_reading);
    if (!Number.isFinite(hoursReading)) {
      toast.error(t("errors.invalidNumber"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    const isEdit = hourMeterForm.id != null && hourMeterForm.id > 0;
    const current = Number(eq?.hours_used ?? 0);
    if (!isEdit && hoursReading + 0.0001 < current) {
      toast.error(t("errors.hourMeterTooLow"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    try {
      setSaving(true);
      const result = await updateEquipmentHourMeter({
        id: hourMeterForm.id,
        equipment_id: equipmentId,
        hours_reading: hoursReading,
        reading_date: hourMeterForm.reading_date.trim() || undefined,
        notes: hourMeterForm.notes.trim() || undefined,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              equipment: (result.equipment as EquipmentRow) ?? prev.equipment,
              hour_meter_readings:
                result.hour_meter_readings ?? prev.hour_meter_readings ?? [],
            }
          : prev,
      );
      toast.success(t("hourMeterSaved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setHourMeterOpen(false);
      setSelectedReading(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveHourMeterReading = async (reading: EquipmentHourMeterReading) => {
    try {
      setDeleting(true);
      const result = await removeEquipmentHourMeterReading(reading.id, equipmentId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              equipment: (result.equipment as EquipmentRow) ?? prev.equipment,
              hour_meter_readings:
                result.hour_meter_readings ??
                (prev.hour_meter_readings ?? []).filter((r) => r.id !== reading.id),
            }
          : prev,
      );
      setSelectedReading(null);
      setHourMeterOpen(false);
      setDeleteConfirm(null);
      toast.success(t("hourMeterDeleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setDeleting(false);
    }
  };

  const openEditLog = (log: EquipmentServiceLog) => {
    setLogForm(serviceLogToForm(log));
    setSelectedLog(null);
    setLogFormOpen(true);
  };

  const handleSaveLog = async () => {
    if (!logForm.service_date.trim()) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    try {
      setSaving(true);
      const hoursAtService = logForm.hours_at_service.trim()
        ? parseDecimalField(logForm.hours_at_service)
        : 0;
      const cost = logForm.cost.trim() ? parseDecimalField(logForm.cost) : 0;
      if (
        (logForm.hours_at_service.trim() && !Number.isFinite(hoursAtService)) ||
        (logForm.cost.trim() && !Number.isFinite(cost))
      ) {
        toast.error(t("errors.invalidNumber"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
        return;
      }

      const result = await saveEquipmentServiceLog({
        id: logForm.id,
        equipment_id: equipmentId,
        service_date: logForm.service_date,
        service_type: logForm.service_type,
        description: logForm.description.trim() || undefined,
        hours_at_service: Number.isFinite(hoursAtService) ? hoursAtService : 0,
        cost: Number.isFinite(cost) ? cost : 0,
        performed_by_user_id: logForm.performed_by_user_id
          ? Number(logForm.performed_by_user_id)
          : null,
      });
      if (result.equipment) {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                equipment: result.equipment as EquipmentRow,
                service_logs: prev.service_logs.some((l) => l.id === result.service_log.id)
                  ? prev.service_logs.map((l) =>
                      l.id === result.service_log.id ? result.service_log : l,
                    )
                  : [result.service_log, ...prev.service_logs].sort((a, b) =>
                      String(b.service_date).localeCompare(String(a.service_date)),
                    ),
              }
            : prev,
        );
      } else {
        await load();
      }
      setLogFormOpen(false);
      toast.success(t("serviceSaved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLog = async (log: EquipmentServiceLog) => {
    try {
      setDeleting(true);
      const result = await removeEquipmentServiceLog(log.id, equipmentId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              equipment: (result.equipment as EquipmentRow) ?? prev.equipment,
              service_logs: prev.service_logs.filter((l) => l.id !== log.id),
            }
          : prev,
      );
      setSelectedLog(null);
      setLogFormOpen(false);
      setDeleteConfirm(null);
      toast.success(t("serviceDeleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteEquipment = async () => {
    try {
      setDeleting(true);
      await removeEquipment(equipmentId);
      toast.success(t("deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      router.push(returnTo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.deleteEquipment"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteDialogCopy = useMemo(() => {
    if (!deleteConfirm) return null;
    if (deleteConfirm.kind === "equipment") {
      return {
        title: t("deleteEquipmentConfirmTitle"),
        message: t("deleteEquipmentConfirmMessage", {
          name: eq ? `${titleModel}${eq.brand ? ` (${eq.brand})` : ""}`.trim() : "",
        }),
      };
    }
    if (deleteConfirm.kind === "hourMeterReading") {
      return {
        title: t("deleteHourMeterConfirmTitle"),
        message: t("deleteHourMeterConfirmMessage", {
          date: formatDateDisplay(deleteConfirm.reading.reading_date),
          hours: formatNumber(deleteConfirm.reading.hours_reading, {
            maximumFractionDigits: 2,
          }),
        }),
      };
    }
    return {
      title: t("deleteServiceConfirmTitle"),
      message: t("deleteServiceConfirmMessage", {
        date: formatDateDisplay(deleteConfirm.log.service_date),
      }),
    };
  }, [deleteConfirm, eq, t, titleModel]);

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">{tEq("loading")}</p>;
  }

  if (!eq) {
    return (
      <div className="space-y-4 p-8">
        <button type="button" className={cn(btnOutline, "h-9")} onClick={() => router.push(returnTo)}>
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </button>
        <p className="text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <div className="flex items-center gap-3">
        <button type="button" className={btnGhost} onClick={() => router.push(returnTo)}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{titleModel}</h1>
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", statusBadgeClass[statusKey])}>
              {tEq(`status.${statusKey}`)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{eq.type}</p>
        </div>
        {canEdit || canDelete ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                className={btnOutline}
                disabled={saving}
                onClick={() => setEditEquipmentOpen(true)}
              >
                <Pencil className="h-4 w-4" />
                {t("editEquipment")}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className={cn(btnOutline, "text-destructive hover:bg-destructive/10")}
                disabled={saving || deleting}
                onClick={() => setDeleteConfirm({ kind: "equipment" })}
              >
                <Trash2 className="h-4 w-4" />
                {t("deleteEquipment")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Tag className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{tEq("form.brand")}</p>
              <p className="text-sm font-semibold">{eq.brand || "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Settings className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("engineCode")}</p>
              <p className="text-sm font-semibold">{eq.engine_code || "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("location")}</p>
              <p className="text-sm font-semibold">{eq.farm_name ?? eq.farm_id}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("pic")}</p>
              <p className="text-sm font-semibold">{eq.assigned_to_name || "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Hash className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t("hoursUsed")}</p>
              <p className="text-sm font-semibold">
                {formatNumber(interval.hoursUsed, { maximumFractionDigits: 2 })} {t("hrs")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold">{t("serviceInterval")}</p>
            {hasServiceLogs ? (
              <button
                type="button"
                className={cn(btnOutline, "h-8")}
                onClick={() => setHourMeterListOpen(true)}
              >
                <Hash className="h-3.5 w-3.5" />
                {t("hourMeterHistory")}
              </button>
            ) : null}
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("everyHours", { hours: interval.hoursBetween })}
            </span>
            <span className="font-medium">
              {!interval.hasServiceBaseline
                ? t("noServiceRecorded")
                : interval.isOverdue
                  ? t("serviceOverdue")
                  : t("hoursUntil", { hours: interval.hoursUntilService })}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                interval.isOverdue ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${interval.serviceProgress}%` }}
            />
          </div>
          {!interval.hasServiceBaseline ? (
            <p className="text-xs text-muted-foreground">{t("noServiceRecorded")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("hoursSinceLastService", {
                hours: formatNumber(interval.hoursSinceLastService, {
                  maximumFractionDigits: 2,
                }),
              })}
            </p>
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {tEq("card.last")}: {formatDateDisplay(eq.last_service_date)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {tEq("card.next")}: {formatDateDisplay(eq.next_service_due)}
            </span>
          </div>
          {outOfServiceReason ? (
            <p className="rounded px-2 py-1 text-xs bg-red-50 text-red-900">
              {outOfServiceReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold">{t("serviceHistory")}</p>
              {hasServiceLogs ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("serviceHistoryCount", { count: String(logs.length) })}
                </p>
              ) : null}
            </div>
            {canCreate ? (
              <button type="button" className={btnPrimary} onClick={openAddLog}>
                <Plus className="h-4 w-4" />
                {t("addService")}
              </button>
            ) : null}
          </div>

          {logs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
              <Wrench className="mx-auto h-8 w-8 text-muted-foreground/70" />
              <p className="mt-3 text-sm font-medium text-foreground">{t("noServiceRecords")}</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {t("noServiceRecordsHint")}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2.5 font-medium">{t("table.date")}</th>
                      <th className="px-3 py-2.5 font-medium">{t("table.type")}</th>
                      <th className="px-3 py-2.5 font-medium">{t("table.description")}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t("table.hoursAtService")}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t("table.cost")}</th>
                      <th className="px-3 py-2.5 font-medium">{t("table.performedBy")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                        onClick={() => setSelectedLog(log)}
                      >
                        <td className="whitespace-nowrap px-3 py-3 font-medium">
                          {formatDateDisplay(log.service_date)}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded px-2 py-0.5 text-xs font-medium",
                              serviceTypeBadgeClass(String(log.service_type)),
                            )}
                          >
                            {log.service_type}
                          </span>
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-3 text-muted-foreground">
                          {log.description || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {formatNumber(log.hours_at_service, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {formatEquipmentCost(log.cost)}
                        </td>
                        <td className="px-3 py-3">{log.performed_by_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedLog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold">{t("serviceRecord")}</h2>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-medium",
                      serviceTypeBadgeClass(String(selectedLog.service_type)),
                    )}
                  >
                    {selectedLog.service_type}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {titleModel}
                  {eq.brand ? ` · ${eq.brand}` : ""}
                  {eq.engine_code ? ` · ${eq.engine_code}` : ""}
                </p>
              </div>
              <button type="button" className={btnGhost} onClick={() => setSelectedLog(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Calendar className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("table.date")}</p>
                  <p className="text-sm font-semibold">{formatDateDisplay(selectedLog.service_date)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Tag className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("table.type")}</p>
                  <p className="text-sm font-semibold">{selectedLog.service_type}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Hash className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("table.hoursAtService")}</p>
                  <p className="text-sm font-semibold">
                    {formatNumber(selectedLog.hours_at_service, { maximumFractionDigits: 2 })}{" "}
                    {t("hrs")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <DollarSign className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("table.cost")}</p>
                  <p className="text-sm font-semibold">{formatEquipmentCost(selectedLog.cost)}</p>
                </div>
              </div>
              <div className="col-span-2 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("table.performedBy")}</p>
                  <p className="text-sm font-semibold">{selectedLog.performed_by_name || "—"}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{t("table.description")}</p>
              </div>
              <p className="rounded-md bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
                {selectedLog.description || "—"}
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              {canEdit ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => openEditLog(selectedLog)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("editService")}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className={cn(btnOutline, "text-destructive hover:bg-destructive/10")}
                  disabled={saving || deleting}
                  onClick={() => setDeleteConfirm({ kind: "serviceLog", log: selectedLog })}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("deleteService")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <EquipmentFormDialog
        open={editEquipmentOpen}
        onClose={() => setEditEquipmentOpen(false)}
        equipment={eq}
        onSaved={(row) => {
          setDetail((prev) =>
            prev ? { ...prev, equipment: row } : prev,
          );
        }}
      />

      {logFormOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {logForm.id ? t("editServiceTitle") : t("addServiceTitle")}
              </h2>
              <button type="button" className={btnGhost} onClick={() => setLogFormOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.date")} *</span>
                <DatePicker
                  value={logForm.service_date}
                  onChange={(v) => setLogForm((f) => ({ ...f, service_date: v }))}
                  className="h-9 w-full rounded-md text-sm shadow-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.type")} *</span>
                <select
                  className={inputClass}
                  value={logForm.service_type}
                  disabled={saving}
                  onChange={(e) => setLogForm((f) => ({ ...f, service_type: e.target.value }))}
                >
                  {serviceTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.hoursAtService")}</span>
                <p className="text-xs text-muted-foreground">{t("hoursAtServiceHint")}</p>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  placeholder={t("hoursAtServicePlaceholder")}
                  value={logForm.hours_at_service}
                  disabled={saving}
                  onChange={(e) =>
                    setLogForm((f) => ({
                      ...f,
                      hours_at_service: formatDecimalInput(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.cost")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  value={logForm.cost}
                  disabled={saving}
                  onChange={(e) =>
                    setLogForm((f) => ({ ...f, cost: formatDecimalInput(e.target.value) }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.performedBy")}</span>
                <select
                  className={inputClass}
                  value={logForm.performed_by_user_id}
                  disabled={saving}
                  onChange={(e) =>
                    setLogForm((f) => ({ ...f, performed_by_user_id: e.target.value }))
                  }
                >
                  <option value="">{t("selectPic")}</option>
                  {staff.map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("table.description")}</span>
                <textarea
                  className={textareaClass}
                  value={logForm.description}
                  disabled={saving}
                  onChange={(e) => setLogForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-between gap-2">
              {logForm.id && canDelete ? (
                <button
                  type="button"
                  className={cn(btnOutline, "text-red-600 hover:bg-red-50")}
                  disabled={saving}
                  onClick={() => {
                    const log = logs.find((l) => l.id === logForm.id);
                    if (log) setDeleteConfirm({ kind: "serviceLog", log });
                  }}
                >
                  {t("deleteService")}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" className={btnOutline} onClick={() => setLogFormOpen(false)}>
                  {tEq("cancel")}
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={saving}
                  onClick={() => void handleSaveLog()}
                >
                  {t("saveService")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hourMeterListOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{t("hourMeterHistory")}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("hourMeterHistoryCount", { count: String(hourMeterReadings.length) })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canUpdateHourMeter ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => openHourMeter()}
                  >
                    <Plus className="h-4 w-4" />
                    {t("updateHourMeter")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => setHourMeterListOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {hourMeterReadings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                  <Hash className="mx-auto h-7 w-7 text-muted-foreground/70" />
                  <p className="mt-2 text-sm font-medium">{t("noHourMeterReadings")}</p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                    {t("noHourMeterReadingsHint")}
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/40">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2.5 font-medium">{t("readingDate")}</th>
                          <th className="px-3 py-2.5 text-right font-medium">{t("newHourMeter")}</th>
                          <th className="px-3 py-2.5 text-right font-medium">{t("previousHourMeter")}</th>
                          <th className="px-3 py-2.5 font-medium">{t("hourMeterNotes")}</th>
                          <th className="px-3 py-2.5 font-medium">{t("recordedBy")}</th>
                          <th className="px-3 py-2.5 text-right font-medium">{t("table.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hourMeterReadings.map((reading) => (
                          <tr
                            key={reading.id}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                            onClick={() => setSelectedReading(reading)}
                          >
                            <td className="whitespace-nowrap px-3 py-3 font-medium">
                              {formatDateDisplay(reading.reading_date)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                              {formatNumber(reading.hours_reading, {
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">
                              {reading.previous_hours != null
                                ? formatNumber(reading.previous_hours, {
                                    maximumFractionDigits: 2,
                                  })
                                : "—"}
                            </td>
                            <td className="max-w-[220px] truncate px-3 py-3 text-muted-foreground">
                              {reading.notes || "—"}
                            </td>
                            <td className="px-3 py-3">{reading.created_by_name || "—"}</td>
                            <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-0.5">
                                {canEdit ? (
                                  <button
                                    type="button"
                                    className={btnGhost}
                                    disabled={saving}
                                    aria-label={t("editHourMeter")}
                                    title={t("editHourMeter")}
                                    onClick={() => openHourMeter(reading)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                                {canDelete ? (
                                  <button
                                    type="button"
                                    className={cn(
                                      btnGhost,
                                      "text-destructive hover:bg-destructive/10",
                                    )}
                                    disabled={saving}
                                    aria-label={t("deleteHourMeter")}
                                    title={t("deleteHourMeter")}
                                    onClick={() =>
                                      setDeleteConfirm({
                                        kind: "hourMeterReading",
                                        reading,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedReading ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{t("hourMeterReading")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{titleModel}</p>
              </div>
              <button type="button" className={btnGhost} onClick={() => setSelectedReading(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{t("readingDate")}</p>
                <p className="text-sm font-semibold">
                  {formatDateDisplay(selectedReading.reading_date)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("newHourMeter")}</p>
                <p className="text-sm font-semibold">
                  {formatNumber(selectedReading.hours_reading, { maximumFractionDigits: 2 })}{" "}
                  {t("hrs")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("previousHourMeter")}</p>
                <p className="text-sm font-semibold">
                  {selectedReading.previous_hours != null
                    ? `${formatNumber(selectedReading.previous_hours, { maximumFractionDigits: 2 })} ${t("hrs")}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("recordedBy")}</p>
                <p className="text-sm font-semibold">{selectedReading.created_by_name || "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">{t("hourMeterNotes")}</p>
                <p className="mt-1 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                  {selectedReading.notes || "—"}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {canEdit ? (
                <button
                  type="button"
                  className={btnOutline}
                  onClick={() => openHourMeter(selectedReading)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("editHourMeter")}
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className={cn(btnOutline, "text-destructive hover:bg-destructive/10")}
                  disabled={saving || deleting}
                  onClick={() =>
                    setDeleteConfirm({ kind: "hourMeterReading", reading: selectedReading })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  {t("deleteHourMeter")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {hourMeterOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {hourMeterForm.id ? t("editHourMeterTitle") : t("updateHourMeterTitle")}
              </h2>
              <button type="button" className={btnGhost} onClick={() => setHourMeterOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t("updateHourMeterHint")}</p>
            <div className="mt-4 space-y-3">
              {!hourMeterForm.id ? (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{t("currentHourMeter")}: </span>
                  <span className="font-semibold">
                    {formatNumber(interval.hoursUsed, { maximumFractionDigits: 2 })} {t("hrs")}
                  </span>
                </div>
              ) : null}
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("newHourMeter")} *</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
                  placeholder={t("newHourMeterPlaceholder")}
                  value={hourMeterForm.hours_reading}
                  disabled={saving}
                  onChange={(e) =>
                    setHourMeterForm((f) => ({
                      ...f,
                      hours_reading: formatDecimalInput(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("readingDate")}</span>
                <DatePicker
                  value={hourMeterForm.reading_date}
                  onChange={(v) => setHourMeterForm((f) => ({ ...f, reading_date: v }))}
                  className="h-9 w-full rounded-md text-sm shadow-sm"
                  disabled={saving}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t("hourMeterNotes")}</span>
                <textarea
                  className={textareaClass}
                  placeholder={t("hourMeterNotesPlaceholder")}
                  value={hourMeterForm.notes}
                  disabled={saving}
                  onChange={(e) => setHourMeterForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={btnOutline} onClick={() => setHourMeterOpen(false)}>
                {tEq("cancel")}
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={saving}
                onClick={() => void handleSaveHourMeter()}
              >
                {t("saveHourMeter")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={deleteConfirm != null && deleteDialogCopy != null}
        title={deleteDialogCopy?.title ?? tCommon("confirmDeleteTitle")}
        message={deleteDialogCopy?.message ?? tCommon("confirmDeleteMessage")}
        cancelLabel={tCommon("cancel")}
        confirmLabel={tCommon("delete")}
        deleting={deleting}
        deletingLabel={tCommon("deleting")}
        onCancel={() => {
          if (!deleting) setDeleteConfirm(null);
        }}
        onConfirm={() => {
          if (!deleteConfirm || deleting) return;
          if (deleteConfirm.kind === "equipment") {
            void handleDeleteEquipment();
            return;
          }
          if (deleteConfirm.kind === "hourMeterReading") {
            void handleRemoveHourMeterReading(deleteConfirm.reading);
            return;
          }
          void handleRemoveLog(deleteConfirm.log);
        }}
      />
    </div>
  );
}
