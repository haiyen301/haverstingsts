import type { RainfallChartLabels } from "@/features/dashboard/lib/rainfallExport";

type ChartTranslator = (key: string) => string;

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const CUMULATIVE_KEYS = [
  "sinceJan",
  "twoMonths",
  "threeMonths",
  "fourMonths",
  "fiveMonths",
  "sixMonths",
  "sevenMonths",
  "eightMonths",
  "nineMonths",
  "tenMonths",
  "elevenMonths",
  "year",
] as const;

/** Build chart row labels from `Dashboard.rainfall.export.chart` messages. */
export function rainfallChartLabelsFromTranslator(tChart: ChartTranslator): RainfallChartLabels {
  return {
    chartTitle: tChart("chartTitle"),
    date: tChart("date"),
    unitMm: tChart("unitMm"),
    monthHeaders: MONTH_KEYS.map((key) => tChart(`months.${key}`)),
    monthAvgHeaders: MONTH_KEYS.map((key) => tChart(`monthAvg.${key}`)),
    totals: tChart("totals"),
    noOf: tChart("noOf"),
    days: tChart("days"),
    cumulativeHeaders: CUMULATIVE_KEYS.map((key) => tChart(`cumulative.${key}`)),
    average: tChart("average"),
    yearCol: tChart("yearCol"),
    all: tChart("all"),
    years: tChart("years"),
    emptyDash: tChart("emptyDash"),
  };
}
