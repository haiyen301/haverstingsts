"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  Layers,
  MapPin,
  Ruler,
  Sprout,
  Truck,
  User,
  Weight,
} from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { zoneIdToLabel } from "@/shared/lib/harvestReferenceData";
import { HARVEST_DOC_PHOTO_FIELDS } from "@/features/harvesting/api/flutterHarvestSubmit";
import { parseHarvestDocImagesFromRow } from "@/features/harvesting/lib/parseHarvestDocImages";
import { effectiveHarvestDateYmd, isValidHarvestDateString } from "@/shared/lib/harvestPlanDates";
import { computeReadyDateYmdFromPlanRow } from "@/features/forecasting/computeReadyDateFromPlanRow";
import { cn } from "@/lib/utils";

type HarvestDetailRow = Record<string, unknown>;

function isValidDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return !!s && s !== "0000-00-00";
}

function displayDate(v: unknown): string {
  if (!isValidDateString(v)) return "—";
  return new Date(v.trim().slice(0, 10)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayLongDate(v: string): string {
  return new Date(v).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T00:00:00`);
  const to = new Date(`${toYmd}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
}

function deriveStatus(row: HarvestDetailRow): "planned" | "scheduled" | "harvested" | "delivered" {
  if (isValidDateString(row.delivery_harvest_date)) return "delivered";
  if (isValidDateString(row.actual_harvest_date)) return "harvested";
  if (isValidDateString(row.estimated_harvest_date)) return "scheduled";
  return "planned";
}

export default function HarvestDetailPage() {
  const t = useTranslations("HarvestDetail");
  const tHarvest = useTranslations("Harvest");
  const tForm = useTranslations("HarvestForm");
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = (searchParams.get("id") ?? "").trim();
  const returnTo = (searchParams.get("returnTo") ?? "/harvest").trim() || "/harvest";

  const farmZones = useHarvestingDataStore((s) => s.farmZones);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<HarvestDetailRow | null>(null);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    if (!id) {
      setError(t("missingId"));
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await stsProxyGetHarvestingIndex({ id, page: 1, per_page: 1 });
        const first = res.rows[0];
        if (!cancelled) {
          if (first && typeof first === "object") {
            setRow(first as HarvestDetailRow);
          } else {
            setRow(null);
            setError(t("notFound"));
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("loadError"));
          setRow(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const zoneText = useMemo(() => {
    if (!row) return "—";
    const z = String(row.zone ?? "").trim();
    if (!z) return "—";
    return zoneIdToLabel(z, farmZones) || z;
  }, [row, farmZones]);

  const status = useMemo(() => (row ? deriveStatus(row) : "planned"), [row]);
  const statusLabel = useMemo(
    () =>
      status === "planned"
        ? tHarvest("harvestStatus_planned")
        : status === "scheduled"
          ? tHarvest("harvestStatus_scheduled")
          : status === "harvested"
            ? tHarvest("harvestStatus_harvested")
            : tHarvest("harvestStatus_delivered"),
    [status, tHarvest],
  );
  const statusClass = useMemo(
    () =>
      status === "planned"
        ? "bg-info/10 text-info"
        : status === "scheduled"
          ? "bg-accent/10 text-accent"
          : status === "harvested"
            ? "bg-warning/10 text-warning"
            : "bg-primary/10 text-primary",
    [status],
  );
  const StatusIcon = status === "delivered" ? CheckCircle2 : status === "harvested" ? Clock : Calendar;

  const imageSlots = useMemo(() => {
    if (!row) return [];
    const parsed = parseHarvestDocImagesFromRow(row);
    const labelMap: Record<string, string> = {
      payment_img: tForm("photoSlotPayment"),
      shipping_note_img: tForm("photoSlotShipping"),
      thermostats_img: tForm("photoSlotThermostat"),
      truck_license_plate_img: tForm("photoSlotPlate"),
      product_being_cut_img: tForm("photoSlotCutting"),
      truck_loaded_img: tForm("photoSlotLoaded"),
    };
    return HARVEST_DOC_PHOTO_FIELDS.map((field) => ({
      field,
      label: labelMap[field] ?? field,
      previewUrl: parsed[field]?.previewUrl ?? null,
    })).filter((x) => !!x.previewUrl);
  }, [row, tForm]);

  const regrowth = useMemo(() => {
    if (!row) return null;
    const harvestYmd = effectiveHarvestDateYmd(row);
    if (!harvestYmd) return null;
    const readyYmd = computeReadyDateYmdFromPlanRow(row, harvestYmd);
    if (!readyYmd) return null;
    const periodDays = diffDaysYmd(harvestYmd, readyYmd);
    const todayYmd = new Date().toISOString().slice(0, 10);
    const elapsed = diffDaysYmd(harvestYmd, todayYmd);
    const progress = periodDays > 0 ? Math.min(100, Math.round((elapsed / periodDays) * 100)) : 0;
    const isRegrown = todayYmd >= readyYmd;
    return {
      basedOnEstimated: !isValidHarvestDateString(row.actual_harvest_date),
      periodDays,
      readyYmd,
      progress,
      isRegrown,
    };
  }, [row]);

  const qty = Number(row?.quantity);
  const qtySafe = Number.isFinite(qty) ? qty : 0;
  const area = Number(row?.harvested_area);
  const areaSafe = Number.isFinite(area) ? area : 0;
  const harvestTypeLabel = String(row?.harvest_type ?? row?.load_type ?? "—").trim() || "—";
  const harvestTypeClass =
    harvestTypeLabel.toLowerCase().includes("sod") && harvestTypeLabel.toLowerCase().includes("sprig")
      ? "bg-info/10 text-info"
      : harvestTypeLabel.toLowerCase().includes("sod")
        ? "bg-primary/10 text-primary"
        : harvestTypeLabel.toLowerCase().includes("sprig")
          ? "bg-accent/10 text-accent"
          : "bg-muted text-muted-foreground";
  const uom = String(row?.uom ?? "").trim().toLowerCase();
  const uomTypeLabel =
    uom === "kg"
      ? "Sprig"
      : uom === "m2" || uom === "m²"
        ? "Sod"
        : harvestTypeLabel;
  const uomTypeClass =
    uom === "kg"
      ? "bg-accent/10 text-accent"
      : uom === "m2" || uom === "m²"
        ? "bg-primary/10 text-primary"
        : harvestTypeClass;
  const kgPerM2 = uom === "kg" && areaSafe > 0 ? qtySafe / areaSafe : 0;

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="dashboard-harvesting-skin min-h-full min-w-0 flex-1 p-4 lg:p-8">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push(returnTo)}
                className="inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("backToList")}
              </button>
              {id ? (
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/harvest/new?id=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(returnTo)}`)
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t("editRecord")}
                </button>
              ) : null}
            </div>

            {loading ? (
              <p className="glass-card rounded-xl p-6 text-sm text-muted-foreground">{t("loading")}</p>
            ) : error || !row ? (
              <p className="glass-card rounded-xl p-6 text-sm text-destructive">{error ?? t("notFound")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-bold text-foreground">H{id}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${uomTypeClass}`}>
                    {uomTypeLabel}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
                    <StatusIcon className="h-3.5 w-3.5" />
                    {statusLabel}
                  </span>
                </div>
                <div className="glass-card rounded-xl p-5">
                  <h3 className="mb-4 text-sm font-semibold text-foreground">{t("harvestDetails")}</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[
                      { label: t("customer"), value: String(row.customer_name ?? row.customer ?? "—"), Icon: User },
                      { label: t("project"), value: String(row.project_name ?? "—"), Icon: FolderOpen },
                      { label: t("farm"), value: String(row.farm_name ?? "—"), Icon: MapPin },
                      { label: t("grass"), value: String(row.grass_name ?? "—"), Icon: Sprout },
                      { label: t("zone"), value: zoneText, Icon: Layers },
                      { label: t("estDate"), value: displayDate(row.estimated_harvest_date), Icon: Calendar },
                      { label: t("harvestDate"), value: displayDate(row.actual_harvest_date), Icon: Calendar },
                      { label: t("deliveryDate"), value: displayDate(row.delivery_harvest_date), Icon: Truck },
                      { label: t("areaM2"), value: areaSafe > 0 ? areaSafe.toLocaleString() : "—", Icon: Ruler },
                      { label: t("quantity"), value: `${qtySafe.toLocaleString()} ${String(row.uom ?? "").trim() || "KG"}`, Icon: Weight },
                      { label: t("density"), value: kgPerM2 > 0 ? `${kgPerM2.toFixed(1)} kg/m²` : "—", Icon: Weight },
                      { label: t("doSo"), value: String(row.do_so_number ?? "—"), Icon: FileText },
                      { label: t("truckNote"), value: String(row.truck_note ?? "—"), Icon: Truck },
                      { label: t("generalNote"), value: String(row.description ?? "—"), Icon: FileText },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <item.Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                          <p className="mt-0.5 wrap-break-word text-sm font-medium text-foreground">{item.value || "—"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-card rounded-xl p-5">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">{t("documentationPhotos")}</h3>
                  {imageSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noImages")}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {imageSlots.map((slot) => (
                        <div key={slot.field} className="space-y-1">
                          <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={slot.previewUrl ?? ""} alt={slot.label} className="h-full w-full object-cover" />
                          </div>
                          <p className="truncate text-center text-xs text-muted-foreground">{slot.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {regrowth ? (
                  <div className="glass-card rounded-xl p-5">
                    <h3 className="mb-4 text-sm font-semibold text-foreground">
                      {t("regrowthStatus")}{" "}
                      {regrowth.basedOnEstimated ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({t("basedOnEstimatedDate")})
                        </span>
                      ) : null}
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("regrowthPeriod")}</span>
                        <span className="font-medium">{regrowth.periodDays} days</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("expectedRecoveryDate")}</span>
                        <span className="font-medium">{displayLongDate(regrowth.readyYmd)}</span>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{t("progress")}</span>
                          <span>{regrowth.progress}%</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-2.5 rounded-full transition-all",
                              regrowth.isRegrown ? "bg-primary" : "bg-warning",
                            )}
                            style={{ width: `${regrowth.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

