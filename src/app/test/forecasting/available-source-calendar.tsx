"use client";

import type { DbCalendarDay } from "@/app/test/forecasting/available-source-formatters";
import {
  formatKg,
  formatNumber,
  formatPlanQty,
  formatWeekdayShort,
  toDisplayDate,
  uniqueSortedYmds,
} from "@/app/test/forecasting/available-source-formatters";
import type {
  DevForecastCalendarHarvestPlan,
  SourceAuditRow,
} from "@/features/forecasting/availableSourceDbMappers";

function HarvestPlanCard({ plan }: { plan: DevForecastCalendarHarvestPlan }) {
  const title = plan.project || plan.customer || "No project";
  return (
    <div className="rounded border border-amber-200 bg-white/80 px-1.5 py-1 text-left">
      <div className="flex items-start justify-between gap-2 text-[10px] font-semibold text-amber-900">
        <span className="tabular-nums">#{plan.planId}</span>
        <span className="shrink-0 tabular-nums">{formatKg(plan.kg)}</span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-600">{title}</div>
      {plan.rawQty > 0 ? (
        <div className="mt-0.5 text-[10px] text-slate-500">
          {formatPlanQty(plan.rawQty, plan.rawUom)}
          {plan.zones.length > 0 ? ` · ${plan.zones.join(", ")}` : null}
        </div>
      ) : null}
      {plan.regrowthSchedule.length > 0 ? (
        plan.regrowthSchedule.map((entry) => (
          <div key={`${entry.dateYmd}-${entry.days}`} className="mt-0.5 text-[10px] text-emerald-700">
            +{entry.days}d ({entry.harvestType}) → RG {toDisplayDate(entry.dateYmd)}
          </div>
        ))
      ) : plan.harvestType ? (
        <div className="mt-0.5 text-[10px] text-slate-500">{plan.harvestType}</div>
      ) : null}
    </div>
  );
}

function formatSourcePlanLine(source: SourceAuditRow): string {
  const detail =
    source.notes.filter(Boolean).join(" · ") ||
    source.m2ConversionRows[0]?.sourceNote ||
    "inventory kg, no m2 zone conversion";
  return `Plan ${formatKg(source.creditedKg)} — ${detail}`;
}

function RegrowthSourceCard({ source, regrowthDay }: { source: SourceAuditRow; regrowthDay: string }) {
  const ruleLabel =
    source.notes.find((n) => n.includes("admin config") || n.includes("+")) ||
    `${source.harvestType} +${source.regrowthDays}d`;

  return (
    <div className="rounded border border-emerald-200 bg-white/80 px-1.5 py-1 text-left">
      <div className="flex items-start justify-between gap-2 text-[10px] font-semibold text-emerald-900">
        <span className="tabular-nums">#{source.planId}</span>
        <span className="shrink-0 tabular-nums">{formatKg(source.creditedKg)}</span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-600">
        {source.project || source.customer || "No project"}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-700">
        Harvest day: {toDisplayDate(source.harvestDate)} ({source.harvestDateSource})
      </div>
      <div className="mt-0.5 text-[10px] text-emerald-800">
        Regrowth day: {toDisplayDate(regrowthDay)} · {ruleLabel}
      </div>
      {source.m2ConversionRows.map((line) => (
        <div key={`${line.forecastRowId}-${line.zoneLabel}`} className="mt-0.5 text-[10px] text-amber-900">
          {line.zoneLabel}: {formatNumber(line.inputM2)} m² × {line.kgPerM2.toFixed(4)} kg/m² ={" "}
          {formatKg(line.multipliedKg)}
        </div>
      ))}
      <div className="mt-0.5 text-[10px] text-slate-600">{formatSourcePlanLine(source)}</div>
      {source.notCountedKg > 0 ? (
        <div className="mt-0.5 text-[10px] font-medium text-amber-800">
          not counted {formatKg(source.notCountedKg)}
        </div>
      ) : null}
    </div>
  );
}

function RegrowthSourcesHeader({
  regrowthDay,
  harvestYmds,
}: {
  regrowthDay: string;
  harvestYmds: string[];
}) {
  if (harvestYmds.length === 0) return null;
  return (
    <div className="mb-1 rounded border border-slate-200 bg-slate-100/80 px-1.5 py-1 text-[10px] text-slate-700">
      <span className="font-medium text-slate-800">
        Harvest days (source of today&apos;s regrowth)
      </span>
      <div className="mt-0.5">
        {harvestYmds.map((ymd, i) => (
          <span key={ymd}>
            {i > 0 ? ", " : ""}
            {toDisplayDate(ymd)} ({formatWeekdayShort(ymd)}) → RG {toDisplayDate(regrowthDay)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AvailableSourceCalendar({
  days,
  anchorDate,
  detailsLoading = false,
}: {
  days: DbCalendarDay[];
  anchorDate: string;
  detailsLoading?: boolean;
}) {
  if (days.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-slate-500">
        Không có snapshot trong khoảng ngày đã chọn.
      </p>
    );
  }

  const dayColClass =
    "w-[220px] min-w-[220px] border-b border-r border-slate-200 align-top px-2 py-2";

  return (
    <div className="overflow-x-auto p-4">
      <table className="min-w-max border-separate border-spacing-0 rounded-lg border border-slate-200 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 w-[132px] border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-600">
              Day
            </th>
            {days.map((day) => (
              <th
                key={day.date}
                className={`${dayColClass} text-center font-medium ${
                  day.isAnchor
                    ? "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-400 ring-inset"
                    : day.isToday
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-50 text-slate-900"
                }`}
              >
                <div className="tabular-nums">
                  {toDisplayDate(day.date)}
                  {day.isAnchor ? " ★" : ""}
                </div>
                <div className="mt-0.5 text-[10px] font-normal text-slate-500">
                  {formatWeekdayShort(day.date)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-semibold text-amber-800">
              Harvest date
            </th>
            {days.map((day) => (
              <td
                key={`hv-${day.date}`}
                className={`${dayColClass} ${day.harvestKg > 0 ? "bg-amber-50" : ""}`}
              >
                {day.harvestKg > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto text-left">
                    <div className="text-center text-[12px] font-semibold tabular-nums text-amber-800">
                      {formatKg(day.harvestKg)}
                    </div>
                    {day.harvestPlans.length > 0 ? (
                      day.harvestPlans.map((plan) => (
                        <HarvestPlanCard key={`${day.date}-${plan.planId}`} plan={plan} />
                      ))
                    ) : detailsLoading ? (
                      <p className="text-center text-[10px] text-amber-700">Đang tải plans…</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-center text-slate-300">—</div>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 text-left font-semibold text-emerald-800">
              Regrown
            </th>
            {days.map((day) => {
              const harvestYmds = uniqueSortedYmds(day.regrowthSources.map((s) => s.harvestDate));
              const overlimitOnly = day.regrowthKg <= 0 && day.regrowthSourceCount > 0;
              const hasRegrowth =
                day.regrowthKg > 0 || day.regrowthSources.length > 0 || overlimitOnly;

              return (
                <td
                  key={`rg-${day.date}`}
                  className={`${dayColClass} ${
                    overlimitOnly
                      ? "bg-amber-50"
                      : day.regrowthKg > 0
                        ? "bg-emerald-50/60"
                        : ""
                  }`}
                >
                  {!hasRegrowth ? (
                    <div className="text-center text-slate-300">—</div>
                  ) : (
                    <div className="max-h-52 space-y-1 overflow-y-auto text-left">
                      <div className="text-center">
                        <div className="text-[12px] font-semibold tabular-nums text-emerald-700">
                          {overlimitOnly ? "0" : formatKg(day.regrowthKg)}
                        </div>
                        <div className="text-[10px] text-emerald-800">
                          credited on RG {toDisplayDate(day.date)}
                        </div>
                      </div>
                      {day.regrowthSources.length > 0 ? (
                        <>
                          <RegrowthSourcesHeader regrowthDay={day.date} harvestYmds={harvestYmds} />
                          {day.regrowthSources.map((src) => (
                            <RegrowthSourceCard
                              key={`${day.date}-${src.planId}-${src.forecastRowIds[0] ?? "x"}`}
                              source={src}
                              regrowthDay={day.date}
                            />
                          ))}
                        </>
                      ) : overlimitOnly ? (
                        <p className="text-[10px] text-amber-800">
                          {day.regrowthSourceCount} source(s) · gross {formatKg(day.regrowthGrossKg)}{" "}
                          · over {formatKg(day.regrowthOverlimitKg)}
                        </p>
                      ) : day.regrowthKg > 0 && detailsLoading ? (
                        <p className="text-center text-[10px] text-emerald-700">Đang tải sources…</p>
                      ) : null}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
          <tr>
            <th className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-3 text-left font-semibold text-slate-900">
              Chart available
            </th>
            {days.map((day) => (
              <td
                key={`av-${day.date}`}
                className={`${dayColClass} border-b-0 ${
                  day.isAnchor ? "bg-emerald-100 font-bold" : day.available > 0 ? "bg-emerald-50/40" : ""
                }`}
              >
                <div className="text-center">
                  <span
                    className={`tabular-nums ${
                      day.isAnchor
                        ? "text-emerald-900"
                        : day.hasSnapshot
                          ? "text-emerald-700"
                          : "text-slate-300"
                    }`}
                  >
                    {day.hasSnapshot ? formatKg(day.available) : "—"}
                  </span>
                  {day.overlimit > 0 ? (
                    <div className="mt-0.5 text-[10px] text-amber-800">
                      over +{formatNumber(day.overlimit)}
                    </div>
                  ) : null}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-slate-500">
        ★ Anchor = {toDisplayDate(anchorDate)}. Harvest date = đợt gặt trong ngày · Regrown = regrowth
        credited từ các đợt gặt trước đó.
      </p>
    </div>
  );
}
