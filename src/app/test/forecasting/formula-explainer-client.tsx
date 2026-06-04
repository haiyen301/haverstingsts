"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BookOpen, Calculator } from "lucide-react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import RequireAuth from "@/features/auth/RequireAuth";
import {
  DEFAULT_REGROWTH_REFERENCE_CONFIG,
  type RegrowthReferenceConfig,
} from "@/features/forecasting/forecastingRegrowth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import {
  computeLoveableZoneAtDate,
  diffDays,
  parseYmdLocal,
  regrowthDaysForScenarioHarvest,
  type InventoryOverrideDef,
  type ScenarioHarvestDef,
} from "./loveableZoneForecast";

const REGROWTH_CONFIG = DEFAULT_REGROWTH_REFERENCE_CONFIG;
const ZONE_MAX_KG = 10_000;

function regrowDaysFor(h: ScenarioHarvestDef, cfg: RegrowthReferenceConfig = REGROWTH_CONFIG): number {
  return regrowthDaysForScenarioHarvest(h, cfg);
}

type ScenarioConfig = {
  id: string;
  tabLabel: string;
  title: string;
  summary: string;
  harvests: ScenarioHarvestDef[];
  inventoryOverride?: InventoryOverrideDef;
  /** Fixed on-hand stock carried into business formula (e.g. prior regrowth balance). */
  businessPriorKg?: number;
  businessPriorDate?: string;
  milestoneDates: { key: string; label: string }[];
};

const SCENARIOS: ScenarioConfig[] = [
  {
    id: "case-4900",
    tabLabel: "Case ~4,900 kg",
    title: "Case 1 — Zone max 10,000; A cut 17/03; B cut 1,000 kg on 15/05",
    summary:
      "Loveable: available = max − Σ Q×(1−progress). On 15/05 (same day as B cut): A depleted + B depleted → ~3,917 kg; " +
      "on 14/05 only A regrowing ~4,833 kg.",
    harvests: [
      { id: "a", label: "A", date: "2026-03-17", qty: 10_000, harvestType: "SOD" },
      { id: "b", label: "B", date: "2026-05-15", qty: 1_000, harvestType: "SOD" },
    ],
    milestoneDates: [
      { key: "2026-05-14", label: "14/05/2026 — before B cut (A regrowing only)" },
      { key: "2026-05-15", label: "15/05/2026 — B cut 1,000 kg" },
      { key: "2026-06-15", label: "15/06/2026 — 31 days after B cut" },
    ],
  },
  {
    id: "case-500",
    tabLabel: "Case 500 kg",
    title: "Case 2 — A cut 09/05 (6 days regrow); B cut 300 kg on 15/05",
    summary:
      "On 15/05: A regrown 500 kg (10,000×6/120). B cut 300 → depleted +300.",
    harvests: [
      { id: "a", label: "A", date: "2026-05-09", qty: 10_000, harvestType: "SOD" },
      { id: "b", label: "B", date: "2026-05-15", qty: 300, harvestType: "SOD" },
    ],
    milestoneDates: [
      { key: "2026-05-15", label: "15/05/2026 — available ~500 kg; B cut 300 kg" },
      { key: "2026-06-15", label: "15/06/2026 — 31 days after B cut" },
    ],
  },
  {
    id: "case-2000-plus-4900",
    tabLabel: "Case 2,000 override",
    title: "Case 3 — Prior 2,000 kg + A regrow; cut 1,000 kg on 15/05; Loveable override 2,000 kg",
    summary:
      "Prior available 2,000 kg (since 15/02/2026) + harvest A regrow at 15/05: 59/120 × 10,000 ≈ 4,917 kg. " +
      "Business on 15/05: 2,000 + 4,917 − 1,000 = 5,917 kg. " +
      "Loveable (right column): inventory override snapshot 2,000 kg — app-only recovery branch.",
    harvests: [
      { id: "a", label: "A", date: "2026-03-17", qty: 10_000, harvestType: "SOD" },
      { id: "b", label: "B", date: "2026-05-15", qty: 1_000, harvestType: "SOD" },
    ],
    businessPriorKg: 2_000,
    businessPriorDate: "2026-02-15",
    inventoryOverride: { date: "2026-05-15", updatedKg: 2_000 },
    milestoneDates: [
      { key: "2026-05-14", label: "14/05/2026 — before B cut (2,000 prior + A regrowing ~4,833)" },
      { key: "2026-05-15", label: "15/05/2026 — B cut 1,000 kg → business 5,917 kg; Loveable override 2,000 kg" },
      { key: "2026-06-15", label: "15/06/2026 — 31 days after B cut (business + B regrow)" },
    ],
  },
];

function formatKg(value: number): string {
  return `${Math.round(value).toLocaleString()} kg`;
}

function RegrowthReferenceTable({ cfg }: { cfg: RegrowthReferenceConfig }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[480px] w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Type (Loveable regrowth table)</th>
            <th className="px-4 py-3 text-right">R days</th>
            <th className="px-4 py-3">Used when</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr>
            <td className="px-4 py-3 font-medium">SOD</td>
            <td className="px-4 py-3 text-right tabular-nums">{cfg.sodDays}</td>
            <td className="px-4 py-3 text-slate-600">getRegrowthDays(SOD, …) — depleted / harvest progress</td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium">SOD_FOR_SPRIG</td>
            <td className="px-4 py-3 text-right tabular-nums">{cfg.sodForSprigDays}</td>
            <td className="px-4 py-3 text-slate-600">Sod-for-sprig harvest type</td>
          </tr>
          {cfg.sprigBands.map((b) => (
            <tr key={b.id}>
              <td className="px-4 py-3 font-medium">SPRIG — {b.label}</td>
              <td className="px-4 py-3 text-right tabular-nums">{b.regrowthDays}</td>
              <td className="px-4 py-3 text-slate-600">kg/m² ≤ {b.maxKgPerM2 === Number.POSITIVE_INFINITY ? "∞" : b.maxKgPerM2}</td>
            </tr>
          ))}
          <tr className="bg-blue-50/50">
            <td className="px-4 py-3 font-medium">Override recovery</td>
            <td className="px-4 py-3 text-right tabular-nums">{cfg.overrideRecoveryDays}</td>
            <td className="px-4 py-3 text-slate-600">
              After inventory override — recover deficit toward max (not harvest R)
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function formatDisplayYmd(ymd: string): string {
  const d = parseYmdLocal(ymd);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function regrowContribution(h: ScenarioHarvestDef, atYmd: string): number {
  const elapsed = diffDays(h.date, atYmd);
  if (elapsed < 0) return 0;
  const r = regrowDaysFor(h);
  const progress = Math.max(0, Math.min(elapsed / r, 1));
  return h.qty * progress;
}

function scenarioPriorKg(scenario: ScenarioConfig): number {
  return scenario.businessPriorKg ?? 0;
}

function priorStockStep(scenario: ScenarioConfig): StepRow | null {
  const prior = scenarioPriorKg(scenario);
  if (prior <= 0) return null;
  const since = scenario.businessPriorDate
    ? ` (available since ${formatDisplayYmd(scenario.businessPriorDate)})`
    : "";
  return {
    label: `Prior available${since}`,
    formula: `${prior.toLocaleString()} kg`,
    result: prior,
  };
}

/** Business reality (does not use Loveable inventory override). */
function computeBusinessAvailableAt(scenario: ScenarioConfig, forecastYmd: string): number {
  const prior = scenarioPriorKg(scenario);
  const harvests = [...scenario.harvests].sort((a, b) => a.date.localeCompare(b.date));
  const cutsOnOrBefore = harvests.filter((h) => h.date <= forecastYmd);
  if (cutsOnOrBefore.length === 0) return ZONE_MAX_KG;

  const first = cutsOnOrBefore[0];
  if (cutsOnOrBefore.length === 1) {
    return prior + regrowContribution(first, forecastYmd);
  }

  const second = cutsOnOrBefore[1];
  if (forecastYmd < second.date) {
    return prior + regrowContribution(first, forecastYmd);
  }

  const availBeforeSecond = regrowContribution(first, second.date);
  const remaining = Math.max(0, prior + availBeforeSecond - second.qty);

  if (forecastYmd === second.date) {
    return remaining;
  }

  return remaining + regrowContribution(second, forecastYmd);
}

type StepRow = {
  label: string;
  formula: string;
  result: number;
  /** Hide "= X kg" line (notes / rules only). */
  omitResult?: boolean;
  /** Override display e.g. "→ 0 days" */
  resultText?: string;
  /** intro = plain-language rule; reference = footnote (not used in final number) */
  variant?: "intro" | "reference" | "calc";
};

type StepItem = StepRow | { type: "section"; title: string; hint?: string };

function buildLoveableOverrideSteps(
  scenario: ScenarioConfig,
  forecastYmd: string,
  ov: InventoryOverrideDef,
  available: number,
): StepItem[] {
  const daysSince = diffDays(ov.date, forecastYmd);
  const zoneMax = ZONE_MAX_KG;
  const updatedKg = ov.updatedKg;
  const deficit = zoneMax - updatedKg;
  const recoveryDays = REGROWTH_CONFIG.overrideRecoveryDays;
  const recoveryRatio = daysSince / recoveryDays;
  const recoveredRaw = deficit * recoveryRatio;
  const recovered = deficit > 0 ? Math.min(deficit, recoveredRaw) : 0;
  const base = updatedKg + recovered;

  let plannedDeduction = 0;
  const plannedLines: string[] = [];
  for (const h of scenario.harvests) {
    const strictlyAfterSnapshot = diffDays(ov.date, h.date) > 0;
    const onOrBeforeT = diffDays(h.date, forecastYmd) >= 0;
    const included = strictlyAfterSnapshot && onOrBeforeT;
    if (included) plannedDeduction += h.qty;

    let reason: string;
    if (h.date < ov.date) {
      reason = "before snapshot → skip";
    } else if (h.date === ov.date) {
      reason = "same day as snapshot → already in updatedKg → skip";
    } else if (h.date > forecastYmd) {
      reason = "after forecast date T → skip";
    } else {
      reason = `strictly after snapshot → −${h.qty.toLocaleString()} kg`;
    }
    plannedLines.push(`${h.label} (${formatDisplayYmd(h.date)}): ${reason}`);
  }

  const sameDayHarvests = scenario.harvests.filter((h) => h.date === ov.date);
  const roundedBase = Math.round(base);
  const roundedRecovered = Math.round(recovered);
  const finalAvailable = Math.max(0, Math.min(zoneMax, Math.round(base - plannedDeduction)));

  const tOnOrAfterSnapshot = diffDays(ov.date, forecastYmd) >= 0;
  const introFormula =
    forecastYmd === ov.date
      ? `Forecast date T (${formatDisplayYmd(forecastYmd)}) = snapshot date. Loveable starts from the entered stock count (${updatedKg.toLocaleString()} kg) and does not recompute earlier harvest depletion (max − depleted).`
      : `Forecast date T (${formatDisplayYmd(forecastYmd)}) is after snapshot (${formatDisplayYmd(ov.date)}). Loveable grows from snapshot stock toward zone max — not from harvest depletion math.`;

  const steps: StepItem[] = [
    {
      type: "section",
      title: "Inventory override path",
      hint: "ForecastingPage.tsx: when T ≥ overrideDate (lines 142–166)",
    },
    {
      label: "Rule",
      formula: introFormula,
      result: 0,
      variant: "intro",
      omitResult: true,
    },
    {
      type: "section",
      title: "① Start from snapshot",
    },
    {
      label: "updatedKg — stock on snapshot date",
      formula: `${updatedKg.toLocaleString()} kg (physical count entered on ${formatDisplayYmd(ov.date)})`,
      result: updatedKg,
    },
    {
      type: "section",
      title: "② Regrow from snapshot toward zone max",
      hint: `overrideRecoveryDays = ${recoveryDays}`,
    },
    {
      label: "daysSinceOverride = T − snapshot date",
      formula: `${formatDisplayYmd(forecastYmd)} − ${formatDisplayYmd(ov.date)} = ${daysSince} days`,
      result: daysSince,
      resultText: `${daysSince} days`,
    },
    {
      label: "deficit = zoneMax − updatedKg (room left to full)",
      formula: `${zoneMax.toLocaleString()} − ${updatedKg.toLocaleString()} = ${deficit.toLocaleString()} kg`,
      result: deficit,
    },
    {
      label: "recovery progress = daysSinceOverride ÷ overrideRecoveryDays",
      formula: `${daysSince} ÷ ${recoveryDays} = ${recoveryRatio.toFixed(4)}`,
      result: recoveryRatio,
      resultText: recoveryRatio.toFixed(4),
    },
    {
      label: "recovered = min(deficit, deficit × progress)",
      formula:
        daysSince === 0
          ? `min(${deficit.toLocaleString()}, ${deficit.toLocaleString()} × 0) = min(${deficit.toLocaleString()}, 0) = 0 kg`
          : `min(${deficit.toLocaleString()}, ${deficit.toLocaleString()} × ${daysSince}/${recoveryDays}) = min(${deficit.toLocaleString()}, ${Math.round(recoveredRaw).toLocaleString()}) = ${roundedRecovered.toLocaleString()} kg`,
      result: recovered,
    },
    {
      label: "baseProjected = updatedKg + recovered",
      formula: `${updatedKg.toLocaleString()} + ${roundedRecovered.toLocaleString()} = ${roundedBase.toLocaleString()} kg`,
      result: base,
    },
    {
      type: "section",
      title: "③ Subtract planned harvests after snapshot",
      hint: "Only hDate > snapshot date AND hDate ≤ T",
    },
    ...plannedLines.map(
      (line): StepRow => ({
        label: "Check harvest",
        formula: line,
        result: 0,
        variant: "intro",
        omitResult: true,
      }),
    ),
    {
      label: "plannedDeduction (sum of qualifying cuts)",
      formula:
        plannedDeduction > 0
          ? plannedLines.filter((l) => l.includes("strictly after")).join(" · ")
          : "no harvest strictly after snapshot and on/before T",
      result: plannedDeduction,
    },
    {
      type: "section",
      title: "④ Cap at zone max",
    },
    {
      label: "available = max(0, min(zoneMax, round(baseProjected − plannedDeduction)))",
      formula: `max(0, min(${zoneMax.toLocaleString()}, round(${roundedBase.toLocaleString()} − ${plannedDeduction.toLocaleString()}))) = ${finalAvailable.toLocaleString()} kg`,
      result: available,
    },
  ];

  if (sameDayHarvests.length > 0 && forecastYmd === ov.date && tOnOrAfterSnapshot) {
    const preCutOnly = buildPreCutSteps(scenario, ov.date);
    if (preCutOnly.length > 0) {
      steps.push(
        { type: "section", title: "Reference only — depleted path (not used here)" },
        ...preCutOnly.map(
          (s): StepRow => ({
            ...s,
            variant: "reference",
            omitResult: true,
            resultText: "Ignored when T ≥ snapshot date",
          }),
        ),
        {
          label: "Same-day cut on snapshot",
          formula: sameDayHarvests.map((h) => `${h.label}: ${h.qty.toLocaleString()} kg`).join("; "),
          result: sameDayHarvests.reduce((sum, h) => sum + h.qty, 0),
          variant: "reference",
          omitResult: true,
          resultText: `Already reflected in updatedKg (${updatedKg.toLocaleString()} kg) — not subtracted again`,
        },
      );
    }
  }

  return steps;
}

function buildPreCutSteps(scenario: ScenarioConfig, cutDateYmd: string): StepRow[] {
  const harvestsBeforeCut = scenario.harvests.filter((h) => h.date !== cutDateYmd);
  if (harvestsBeforeCut.length === 0) return [];

  const preCutAvailable = computeLoveableZoneAtDate(
    ZONE_MAX_KG,
    harvestsBeforeCut,
    cutDateYmd,
    REGROWTH_CONFIG,
  ).available;

  const detailSteps: StepRow[] = harvestsBeforeCut.map((h) => {
    const elapsed = Math.round(diffDays(h.date, cutDateYmd));
    const r = regrowDaysFor(h);
    const progress = Math.max(0, Math.min(elapsed / r, 1));
    const availFromH = h.qty * progress;
    const typeLabel = h.harvestType ?? "SOD";
    return {
      label: `${h.label} — available regrow = Q × (elapsed/R)`,
      formula: `${elapsed}/${r} × ${h.qty.toLocaleString()} = ${Math.round(availFromH).toLocaleString()} kg [${typeLabel} R=${r}]`,
      result: availFromH,
    };
  });

  if (harvestsBeforeCut.length === 1) {
    return detailSteps;
  }

  return [
    ...detailSteps,
    {
      label: "Before cut (depleted path total)",
      formula: `${ZONE_MAX_KG.toLocaleString()} − Σ depleted = ${Math.round(preCutAvailable).toLocaleString()} kg`,
      result: preCutAvailable,
    },
  ];
}

function buildLoveableSteps(scenario: ScenarioConfig, forecastYmd: string): StepItem[] {
  const result = computeLoveableZoneAtDate(
    ZONE_MAX_KG,
    scenario.harvests,
    forecastYmd,
    REGROWTH_CONFIG,
    scenario.inventoryOverride,
  );

  if (result.mode === "override" && scenario.inventoryOverride) {
    return buildLoveableOverrideSteps(
      scenario,
      forecastYmd,
      scenario.inventoryOverride,
      result.available,
    );
  }

  const steps: StepRow[] = [
    {
      label: "Zone capacity (max)",
      formula: `${ZONE_MAX_KG.toLocaleString()} kg`,
      result: ZONE_MAX_KG,
    },
  ];

  let depletedSum = 0;
  for (const h of scenario.harvests) {
    const dep = result.byHarvestDepletion[h.id];
    if (dep == null) {
      const hBefore = diffDays(h.date, forecastYmd) < 0;
      steps.push({
        label: `${h.label} — no depletion`,
        formula: hBefore ? "H > T (not cut yet)" : "regrow complete",
        result: 0,
      });
      continue;
    }
    const elapsed = diffDays(h.date, forecastYmd);
    const r = regrowDaysFor(h);
    const progress = Math.max(0, Math.min(elapsed / r, 1));
    depletedSum += dep;
    const typeLabel = h.harvestType ?? "SOD";
    steps.push({
      label: `${h.label} — depleted = Q × (1 − progress)`,
      formula: `${h.qty.toLocaleString()} × (1 − ${elapsed}/${r}) [${typeLabel} R=${r}] = ${h.qty.toLocaleString()} × ${(1 - progress).toFixed(3)}`,
      result: dep,
    });
  }

  steps.push({
    label: "Total depleted",
    formula: `Σ depleted`,
    result: depletedSum,
  });
  steps.push({
    label: "available = max − depleted",
    formula: `${ZONE_MAX_KG.toLocaleString()} − ${Math.round(depletedSum).toLocaleString()}`,
    result: result.available,
  });

  return steps;
}

function buildBusinessSteps(scenario: ScenarioConfig, forecastYmd: string): StepRow[] {
  const harvests = [...scenario.harvests].sort((a, b) => a.date.localeCompare(b.date));
  const first = harvests[0];
  if (!first) return [];

  const prior = scenarioPriorKg(scenario);
  const priorStep = priorStockStep(scenario);
  const second = harvests[1];

  if (!second || forecastYmd < second.date) {
    const elapsed = Math.round(diffDays(first.date, forecastYmd));
    const r = regrowDaysFor(first);
    const fromFirst = regrowContribution(first, forecastYmd);
    const total = prior + fromFirst;
    const steps: StepRow[] = [];
    if (priorStep) steps.push(priorStep);
    steps.push({
      label: `${first.label} — available = Q × (elapsed/R)`,
      formula: `${elapsed}/${r} × ${first.qty.toLocaleString()} = ${Math.round(fromFirst).toLocaleString()} kg`,
      result: fromFirst,
    });
    if (prior > 0) {
      steps.push({
        label: "Business total",
        formula: `${prior.toLocaleString()} + ${Math.round(fromFirst).toLocaleString()} = ${Math.round(total).toLocaleString()} kg`,
        result: total,
      });
    }
    return steps;
  }

  const preCutSteps = buildPreCutSteps(scenario, second.date);
  const fromA = regrowContribution(first, second.date);
  const totalBeforeCut = prior + fromA;
  const remaining = Math.max(0, totalBeforeCut - second.qty);
  const elapsedB = Math.round(diffDays(second.date, forecastYmd));
  const rB = regrowDaysFor(second);
  const regrowB = regrowContribution(second, forecastYmd);

  if (forecastYmd === second.date) {
    return [
      ...(priorStep ? [priorStep] : []),
      ...preCutSteps,
      {
        label: "Before cut (prior + A regrow)",
        formula:
          prior > 0
            ? `${prior.toLocaleString()} + ${Math.round(fromA).toLocaleString()} = ${Math.round(totalBeforeCut).toLocaleString()} kg`
            : `${Math.round(fromA).toLocaleString()} kg`,
        result: totalBeforeCut,
      },
      {
        label: `Cut ${second.label}`,
        formula: `− ${second.qty.toLocaleString()} kg`,
        result: second.qty,
      },
      {
        label: "After cut",
        formula: `${Math.round(totalBeforeCut).toLocaleString()} − ${second.qty.toLocaleString()} = ${Math.round(remaining).toLocaleString()} kg`,
        result: remaining,
      },
    ];
  }

  return [
    {
      label: "Remaining after cut (fixed)",
      formula: `${Math.round(remaining).toLocaleString()} kg`,
      result: remaining,
    },
    {
      label: `${second.label} — regrow from cut portion`,
      formula: `${elapsedB}/${rB} × ${second.qty.toLocaleString()} = ${Math.round(regrowB).toLocaleString()} kg`,
      result: regrowB,
    },
    {
      label: "Business total",
      formula: `${Math.round(remaining).toLocaleString()} + ${Math.round(regrowB).toLocaleString()}`,
      result: remaining + regrowB,
    },
  ];
}

function ComparisonTable({
  rows,
  harvestIds,
}: {
  harvestIds: string[];
  rows: {
    dateYmd: string;
    business: number;
    loveable: number;
    depletedByHarvest: Record<string, number | undefined>;
  }[];
}) {
  const labels = harvestIds.map((id) => id.toUpperCase());

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[900px] w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Date T</th>
            <th className="px-4 py-3 text-right">Business</th>
            {labels.map((l) => (
              <th key={l} className="px-4 py-3 text-right">
                depl({l}) Loveable
              </th>
            ))}
            <th className="px-4 py-3 text-right">Loveable available</th>
            <th className="px-4 py-3 text-right">Delta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const delta = row.loveable - row.business;
            const isClose = Math.abs(delta) <= 50;
            return (
              <tr key={row.dateYmd} className={isClose ? "bg-emerald-50/40" : "bg-red-50/40"}>
                <td className="px-4 py-3 font-medium tabular-nums">{formatDisplayYmd(row.dateYmd)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                  {formatKg(row.business)}
                </td>
                {harvestIds.map((id) => (
                  <td key={id} className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.depletedByHarvest[id] != null ? formatKg(row.depletedByHarvest[id]!) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-800">
                  {formatKg(row.loveable)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-semibold ${isClose ? "text-emerald-700" : "text-red-700"}`}
                >
                  {delta >= 0 ? "+" : ""}
                  {formatKg(delta)}
                  {isClose ? " ✓" : " ✗"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioPanel({ scenario }: { scenario: ScenarioConfig }) {
  const harvestIds = scenario.harvests.map((h) => h.id);

  const comparisonRows = scenario.milestoneDates.map(({ key }) => {
    const loveable = computeLoveableZoneAtDate(
      ZONE_MAX_KG,
      scenario.harvests,
      key,
      REGROWTH_CONFIG,
      scenario.inventoryOverride,
    );
    return {
      dateYmd: key,
      business: computeBusinessAvailableAt(scenario, key),
      loveable: loveable.available,
      depletedByHarvest: Object.fromEntries(
        harvestIds.map((id) => [id, loveable.byHarvestDepletion[id]]),
      ) as Record<string, number | undefined>,
    };
  });

  const chartData = useMemo(() => {
    const start = parseYmdLocal(scenario.harvests[0]?.date ?? "2026-03-01");
    const end = parseYmdLocal("2026-07-15");
    const points: { date: string; business: number; loveable: number }[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const loveable = computeLoveableZoneAtDate(
        ZONE_MAX_KG,
        scenario.harvests,
        ymd,
        REGROWTH_CONFIG,
        scenario.inventoryOverride,
      );
      points.push({
        date: formatDisplayYmd(ymd),
        business: Math.round(computeBusinessAvailableAt(scenario, ymd)),
        loveable: Math.round(loveable.available),
      });
    }
    return points;
  }, [scenario]);

  const loveableAtMay15 = computeLoveableZoneAtDate(
    ZONE_MAX_KG,
    scenario.harvests,
    "2026-05-15",
    REGROWTH_CONFIG,
    scenario.inventoryOverride,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {scenario.summary}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-950">
        <strong>Zone max = {ZONE_MAX_KG.toLocaleString()} kg.</strong> Loveable on 15/05:{" "}
        <strong>{formatKg(loveableAtMay15.available)}</strong>
        {loveableAtMay15.mode === "override" ? " (inventory override branch)" : " (max − depleted)"}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Harvests in zone</h3>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Date H</th>
                <th className="px-4 py-3 text-right">Q (kg)</th>
                <th className="px-4 py-3 text-right">R (getRegrowthDays)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scenario.harvests.map((h) => {
                const r = regrowDaysFor(h);
                return (
                  <tr key={h.id}>
                    <td className="px-4 py-3 font-medium">{h.label}</td>
                    <td className="px-4 py-3">{h.harvestType ?? "SOD"}</td>
                    <td className="px-4 py-3 tabular-nums">{formatDisplayYmd(h.date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{h.qty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r} days</td>
                  </tr>
                );
              })}
              {scenario.inventoryOverride ? (
                <tr className="bg-blue-50/50">
                  <td className="px-4 py-3 font-medium">Override</td>
                  <td className="px-4 py-3">snapshot</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatDisplayYmd(scenario.inventoryOverride.date)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {scenario.inventoryOverride.updatedKg.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-blue-800">
                    recovery R={REGROWTH_CONFIG.overrideRecoveryDays}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <ComparisonTable rows={comparisonRows} harvestIds={harvestIds} />

      {scenario.milestoneDates.map(({ key, label }) => (
        <div key={key} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-950">{label}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <StepBlock title="Business (expected)" tone="business" steps={buildBusinessSteps(scenario, key)} />
            <StepBlock title="Loveable code (zone model)" tone="loveable" steps={buildLoveableSteps(scenario, key)} />
          </div>
        </div>
      ))}

      <div>
        <h3 className="mb-2 font-semibold text-slate-950">Weekly chart</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}k`} />
              <Tooltip formatter={(v: number) => formatKg(v)} />
              <Legend />
              <Line type="monotone" dataKey="business" name="Business" stroke="#059669" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="loveable" name="Loveable" stroke="#d97706" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StepBlock({ title, tone, steps }: { title: string; tone: "loveable" | "business"; steps: StepItem[] }) {
  const border =
    tone === "business" ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40";
  let stepIndex = 0;
  return (
    <div className={`rounded-lg border p-4 ${border}`}>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <ol className="mt-3 space-y-3">
        {steps.map((item, i) => {
          if ("type" in item && item.type === "section") {
            return (
              <li key={`section-${i}-${item.title}`} className="list-none pt-1">
                <div className="border-t border-slate-200/80 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {item.title}
                </div>
                {item.hint ? <div className="mt-0.5 text-xs text-slate-400">{item.hint}</div> : null}
              </li>
            );
          }

          const step = item as StepRow;
          const isIntro = step.variant === "intro";
          const isReference = step.variant === "reference";
          if (!isIntro && !isReference) stepIndex += 1;

          return (
            <li
              key={`${i}-${step.label}`}
              className={`text-sm ${isReference ? "border-l-2 border-dashed border-slate-300 pl-3 opacity-80" : ""}`}
            >
              <div
                className={`font-medium ${isIntro ? "text-slate-600" : isReference ? "text-slate-500" : "text-slate-800"}`}
              >
                {isIntro || isReference ? step.label : `${stepIndex}. ${step.label}`}
              </div>
              <div
                className={`mt-1 text-xs ${isIntro || isReference ? "text-slate-500" : "font-mono text-slate-600"}`}
              >
                {step.formula}
              </div>
              {!step.omitResult ? (
                <div className="mt-1 tabular-nums font-semibold text-slate-950">
                  = {step.resultText ?? formatKg(step.result)}
                </div>
              ) : step.resultText ? (
                <div className="mt-1 text-xs font-medium text-slate-600">{step.resultText}</div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SummaryComparisonTable() {
  const rows = SCENARIOS.flatMap((s) => {
    const milestones = s.milestoneDates.slice(-2);
    return milestones.map((m) => {
      const loveable = computeLoveableZoneAtDate(
        ZONE_MAX_KG,
        s.harvests,
        m.key,
        REGROWTH_CONFIG,
        s.inventoryOverride,
      );
      const business = computeBusinessAvailableAt(s, m.key);
      const delta = loveable.available - business;
      return {
        case: s.tabLabel,
        date: formatDisplayYmd(m.key),
        business,
        loveable: loveable.available,
        delta,
        close: Math.abs(delta) <= 50,
      };
    });
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-red-200 bg-white">
      <table className="min-w-[720px] w-full text-sm">
        <thead className="bg-red-50 text-left text-xs font-semibold uppercase text-red-800">
          <tr>
            <th className="px-4 py-3">Case</th>
            <th className="px-4 py-3">Milestone</th>
            <th className="px-4 py-3 text-right">Business</th>
            <th className="px-4 py-3 text-right">Loveable</th>
            <th className="px-4 py-3 text-right">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-red-100">
          {rows.map((r) => (
            <tr key={`${r.case}-${r.date}`}>
              <td className="px-4 py-3 font-medium">{r.case}</td>
              <td className="px-4 py-3">{r.date}</td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatKg(r.business)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-amber-800">{formatKg(r.loveable)}</td>
              <td
                className={`px-4 py-3 text-right tabular-nums font-medium ${r.close ? "text-emerald-700" : "text-red-700"}`}
              >
                {r.delta >= 0 ? "+" : ""}
                {formatKg(r.delta)}
                {r.close ? " ✓" : " ✗"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DevForecastingFormulaClient() {
  const [activeId, setActiveId] = useState("case-4900");
  const activeScenario = SCENARIOS.find((s) => s.id === activeId) ?? SCENARIOS[0];

  return (
    <RequireAuth>
      <DashboardLayout>
        <main className="min-h-screen bg-slate-50">
          <div className="mx-auto w-full max-w-7xl space-y-6 p-4 lg:p-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Development only</p>
                <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-950">
                  <BookOpen className="h-6 w-6 text-slate-600" />
                  Forecasting — Loveable zone model
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">
                  Parity with{" "}
                  <code className="rounded bg-slate-200 px-1 text-xs">loveable_harvest/ForecastingPage.tsx</code>
                  : available = max − Σ depleted, depleted = Q×(1−progress).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/dev/forecasting"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Source audit
                </Link>
              </div>
            </div>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                <Calculator className="h-5 w-5" />
                Formulas
              </h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-lg bg-amber-50/60 p-4 font-mono text-xs leading-relaxed text-slate-800">
                  <p className="mb-2 font-sans text-sm font-semibold">Per harvest (regrowing)</p>
                  <p>R = getRegrowthDays(harvestType, kgPerM2)</p>
                  <p>progress = (T−H) / R</p>
                  <p>depleted += Q × (1 − progress)</p>
                  <p className="mt-2">H &gt; T → skip (not cut yet)</p>
                  <p>regrow complete → skip</p>
                </div>
                <div className="rounded-lg bg-amber-50/60 p-4 font-mono text-xs leading-relaxed text-slate-800">
                  <p className="mb-2 font-sans text-sm font-semibold">Per zone (Loveable)</p>
                  <p>available = maxInventoryKg − Σ depleted</p>
                  <p className="mt-2 text-slate-600">
                    Override: base = updatedKg + deficit×(days/overrideRecoveryDays) − planned harvest
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50/60 p-4 font-mono text-xs leading-relaxed text-slate-800">
                  <p className="mb-2 font-sans text-sm font-semibold">Business (expected)</p>
                  <p>Prior available (optional)</p>
                  <p>+ before cut: Q × (elapsed/R)</p>
                  <p>Cut day: prior + regrow − Q_cut</p>
                  <p>After cut: remaining + Q_cut×(days/R)</p>
                  <p className="mt-2 text-slate-600">
                    Does not use inventory override — override is Loveable-only
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-700">
                  Regrowth table (RegrowthConfigContext — Loveable default)
                </h3>
                <RegrowthReferenceTable cfg={REGROWTH_CONFIG} />
              </div>
            </section>

            <section className="rounded-lg border border-red-200 bg-red-50/50 p-5">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-red-900">
                <AlertTriangle className="h-5 w-5" />
                Summary comparison (Loveable vs business)
              </h2>
              <p className="mt-1 mb-4 text-sm text-slate-600">
                ✓ = delta ≤ 50 kg. Case 1 has no prior stock. Case 3 business adds 2,000 kg prior (since 15/02/2026)
                plus A regrow; Loveable override 2,000 kg is a separate app snapshot.
              </p>
              <SummaryComparisonTable />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveId(s.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      activeId === s.id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {s.tabLabel}
                  </button>
                ))}
              </div>
              <h2 className="text-lg font-semibold text-slate-950">{activeScenario.title}</h2>
              <div className="mt-4">
                <ScenarioPanel key={activeScenario.id} scenario={activeScenario} />
              </div>
            </section>
          </div>
        </main>
      </DashboardLayout>
    </RequireAuth>
  );
}
