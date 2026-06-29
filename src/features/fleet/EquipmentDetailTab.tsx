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
  removeEquipmentServiceLog,
  saveEquipmentServiceLog,
  type EquipmentDetail,
  type EquipmentRow,
  type EquipmentServiceLog,
  type EquipmentServiceLogType,
} from "@/features/fleet/api/equipmentApi";
import { fetchStaffOptions } from "@/features/fleet/api/machineryApi";
import { equipmentCardModelTitle } from "@/features/fleet/lib/equipmentModelDisplay";
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

export function EquipmentDetailTab({ equipmentId, returnTo = "/fleet/equipment" }: Props) {
  const t = useTranslations("EquipmentDetail");
  const tEq = useTranslations("Equipment");
  const router = useRouter();

  const [detail, setDetail] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<Array<{ id: number | string; label: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<EquipmentServiceLog | null>(null);
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [logForm, setLogForm] = useState<ServiceLogForm>(emptyServiceLogForm());

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
  const serviceTypes = detail?.service_types ?? ["Scheduled", "Unscheduled", "Repair"];

  const statusKey = eq ? equipmentStatusKey(String(eq.status)) : "operational";
  const statusBadgeClass: Record<string, string> = {
    operational: "bg-emerald-100 text-emerald-800",
    maintenance: "bg-amber-100 text-amber-800",
    outOfService: "bg-red-100 text-red-800",
  };

  const hoursBetween = num(eq?.hours_between_service) || 250;
  const hoursUsed = num(eq?.hours_used);
  const hoursUntilService = hoursBetween - (hoursUsed % hoursBetween);
  const serviceProgress = Math.min(
    100,
    Math.round(((hoursBetween - hoursUntilService) / hoursBetween) * 100),
  );

  const titleModel = useMemo(() => {
    if (!eq) return "";
    return equipmentCardModelTitle({
      model_short: eq.model_short,
      equipment_name: eq.equipment_name,
      model: eq.model,
    });
  }, [eq]);

  const openAddLog = () => {
    setLogForm({
      ...emptyServiceLogForm(),
      hours_at_service: eq ? formatDecimalInputFromValue(eq.hours_used) : "",
      performed_by_user_id: eq?.assigned_to_user_id ? String(eq.assigned_to_user_id) : "",
    });
    setLogFormOpen(true);
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
    if (!window.confirm(t("deleteServiceConfirm"))) return;
    try {
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
      toast.success(t("serviceDeleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    }
  };

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
            <h1 className="text-2xl font-semibold">
              {eq.brand} {titleModel}
            </h1>
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", statusBadgeClass[statusKey])}>
              {tEq(`status.${statusKey}`)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{eq.type}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
            <div>
              <p className="text-xs text-muted-foreground">{t("hoursUsed")}</p>
              <p className="text-sm font-semibold">
                {formatNumber(hoursUsed, { maximumFractionDigits: 2 })} {t("hrs")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {eq.model ? (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{tEq("form.model")}</p>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {eq.model}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-base font-semibold">{t("serviceInterval")}</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("everyHours", { hours: hoursBetween })}</span>
            <span className="font-medium">{t("hoursUntil", { hours: hoursUntilService })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${serviceProgress}%` }} />
          </div>
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
          {eq.notes ? (
            <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{eq.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-base font-semibold">{t("serviceHistory")}</p>
            <button type="button" className={btnPrimary} onClick={openAddLog}>
              <Plus className="h-4 w-4" />
              {t("addService")}
            </button>
          </div>

          {logs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noServiceRecords")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">{t("table.date")}</th>
                    <th className="pb-2 pr-3 font-medium">{t("table.type")}</th>
                    <th className="pb-2 pr-3 font-medium">{t("table.description")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("table.hours")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("table.cost")}</th>
                    <th className="pb-2 font-medium">{t("table.performedBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="py-3 pr-3">{formatDateDisplay(log.service_date)}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-xs font-medium",
                            serviceTypeBadgeClass(String(log.service_type)),
                          )}
                        >
                          {log.service_type}
                        </span>
                      </td>
                      <td className="max-w-[280px] truncate py-3 pr-3">{log.description || "—"}</td>
                      <td className="py-3 pr-3 text-right">
                        {formatNumber(log.hours_at_service, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-3 text-right">{formatEquipmentCost(log.cost)}</td>
                      <td className="py-3">{log.performed_by_name || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  {eq.brand} {titleModel}
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
                  <p className="text-xs text-muted-foreground">{t("table.hours")}</p>
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
              <button
                type="button"
                className={btnOutline}
                onClick={() => openEditLog(selectedLog)}
              >
                <Pencil className="h-4 w-4" />
                {t("editService")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                <span className="text-xs font-medium">{t("table.hours")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputClass}
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
              {logForm.id ? (
                <button
                  type="button"
                  className={cn(btnOutline, "text-red-600 hover:bg-red-50")}
                  disabled={saving}
                  onClick={() => {
                    const log = logs.find((l) => l.id === logForm.id);
                    if (log) void handleRemoveLog(log);
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
    </div>
  );
}
