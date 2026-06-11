"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { InventoryOverlimitBreakdown } from "@/features/forecasting/inventoryOverlimitBreakdown";
import { formatShortDateYmd } from "@/features/forecasting/zoneBalanceBreakdown";
import { cn } from "@/lib/utils";

export function InventoryOverlimitBreakdownPanel({
  breakdown,
  zoneLabelFn,
  onClose,
}: {
  breakdown: InventoryOverlimitBreakdown;
  zoneLabelFn: (zoneId: string) => string;
  onClose: () => void;
}) {
  const t = useTranslations("InventoryBalance");
  const zoneRows = breakdown.zoneLines.filter(
    (z) => z.grossKg > 0 || z.creditedKg > 0 || z.overflowKg > 0 || z.nozoneFillKg > 0,
  );

  return (
    <section className="relative border-t-2 border-red-200/80 bg-red-50/20 px-4 py-5 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t("overlimitBreakdownTitle")}</h3>
          <p className="text-sm text-muted-foreground">
            {[breakdown.farmName, breakdown.turfgrass].filter(Boolean).join(" · ")}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("overlimitBreakdownSummary", {
              gross: breakdown.totalGrossKg.toLocaleString(),
              credited: breakdown.totalCreditedKg.toLocaleString(),
              cap: breakdown.farmProductCapKg.toLocaleString(),
              overlimit: breakdown.overlimitKg.toLocaleString(),
            })}
          </p>
          <p className="text-[11px] text-muted-foreground">{t("overlimitBreakdownHint")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {breakdown.nozoneInputKg > 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {t("overlimitBreakdownNozonePool", { kg: breakdown.nozoneInputKg.toLocaleString() })}
        </p>
      ) : null}

      {zoneRows.length > 0 ? (
        <div className="mb-4 overflow-x-auto rounded-lg border border-border/70 bg-background">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("overlimitBreakdownThZone")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overlimitBreakdownThGross")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overlimitBreakdownThCredited")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("overlimitBreakdownThOverflow")}</th>
              </tr>
            </thead>
            <tbody>
              {zoneRows.map((z) => (
                <tr key={z.zoneKey} className="border-b border-border/50 last:border-b-0">
                  <td className="px-3 py-2">{zoneLabelFn(z.zoneLabel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.grossKg.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{z.creditedKg.toLocaleString()}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums font-medium",
                      z.overflowKg > 0 ? "text-red-700" : "text-muted-foreground",
                    )}
                  >
                    {z.overflowKg > 0 ? `+${z.overflowKg.toLocaleString()}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {breakdown.otherOverflowKg > 0 ? (
        <p className="mb-4 text-xs text-red-700">
          {t("overlimitBreakdownOtherOverflow", { kg: breakdown.otherOverflowKg.toLocaleString() })}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">{t("overlimitBreakdownSourcesTitle")}</p>
        {breakdown.sourceRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("overlimitBreakdownNoSources")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("overlimitBreakdownThProject")}</th>
                  <th className="px-3 py-2 font-medium">{t("overlimitBreakdownThZone")}</th>
                  <th className="px-3 py-2 font-medium">{t("overlimitBreakdownThHarvest")}</th>
                  <th className="px-3 py-2 font-medium">{t("overlimitBreakdownThRegrowth")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("overlimitBreakdownThKg")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.sourceRows.map((row) => (
                  <tr key={row.rowId} className="border-b border-border/50 last:border-b-0">
                    <td className="px-3 py-2">{row.projectLabel}</td>
                    <td className="px-3 py-2">{zoneLabelFn(row.zoneLabel)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.harvestDateYmd ? formatShortDateYmd(row.harvestDateYmd) : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.regrowthDateYmd ? formatShortDateYmd(row.regrowthDateYmd) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {row.kg.toLocaleString()}
                      {row.fromNozoneSpreadKg > 0 ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          {t("overlimitBreakdownFromNozone", {
                            kg: row.fromNozoneSpreadKg.toLocaleString(),
                          })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
