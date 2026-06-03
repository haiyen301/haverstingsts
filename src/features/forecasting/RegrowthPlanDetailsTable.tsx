"use client";

import { useTranslations } from "next-intl";

import {
  type RegrowthPlanDetailRow,
  sumRegrowthPlanDetailTotals,
} from "@/features/forecasting/regrowthEventPlanDetails";
import { cn } from "@/lib/utils";

function formatPlanDateYmd(ymd: string): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusBadgeClass(status: RegrowthPlanDetailRow["status"]): string {
  switch (status) {
    case "delivered":
      return "bg-emerald-100 text-emerald-800";
    case "harvested":
      return "bg-sky-100 text-sky-800";
    case "scheduled":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

type RegrowthPlanDetailsTableProps = {
  rows: RegrowthPlanDetailRow[];
  regrowthDateLabel: string;
  farmGrassLabel: string;
  className?: string;
};

export function RegrowthPlanDetailsTable({
  rows,
  regrowthDateLabel,
  farmGrassLabel,
  className,
}: RegrowthPlanDetailsTableProps) {
  const t = useTranslations("ForecastInventory");
  const tHarvest = useTranslations("Harvest");
  const totals = sumRegrowthPlanDetailTotals(rows);

  const statusLabel = (status: RegrowthPlanDetailRow["status"]) => {
    if (status === "planned") return tHarvest("harvestStatus_planned");
    if (status === "scheduled") return tHarvest("harvestStatus_scheduled");
    if (status === "harvested") return tHarvest("harvestStatus_harvested");
    if (status === "delivered") return tHarvest("harvestStatus_delivered");
    return status;
  };

  const qtyTotalParts = [...totals.qtyByUom.entries()].map(
    ([uom, n]) => `${n.toLocaleString()} ${uom}`,
  );

  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{t("events.planDetailsTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("events.planDetailsSubtitle", {
            regrowthDate: regrowthDateLabel,
            farmGrass: farmGrassLabel,
            count: rows.length,
          })}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColProject")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColEstDate")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColHarvestDate")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColFarm")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColGrass")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColZone")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColType")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("events.planDetailsColArea")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("events.planDetailsColQty")}</th>
              <th className="py-2 pr-3 font-medium">{t("events.planDetailsColDelivery")}</th>
              <th className="py-2 font-medium">{t("events.planDetailsColStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="py-2.5 pr-3 font-medium text-foreground">
                  {row.project || "—"}
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  {formatPlanDateYmd(row.estimatedDate)}
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  {formatPlanDateYmd(row.harvestDate)}
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">{row.farm || "—"}</td>
                <td className="py-2.5 pr-3 text-muted-foreground">{row.grass || "—"}</td>
                <td className="py-2.5 pr-3 text-muted-foreground">{row.zone || "—"}</td>
                <td className="py-2.5 pr-3 text-muted-foreground">{row.type || "—"}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {row.areaM2 > 0 ? row.areaM2.toLocaleString() : "—"}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums font-medium text-foreground">
                  {row.qtyLabel}
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  {formatPlanDateYmd(row.deliveryDate)}
                </td>
                <td className="py-2.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                      statusBadgeClass(row.status),
                    )}
                  >
                    {statusLabel(row.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/30 font-medium">
              <td colSpan={7} className="py-2.5 pr-3 text-foreground">
                {t("events.planDetailsTotal")}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                {totals.areaM2 > 0 ? `${totals.areaM2.toLocaleString()} m²` : "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-foreground">
                {qtyTotalParts.length > 0 ? qtyTotalParts.join(" · ") : "—"}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
