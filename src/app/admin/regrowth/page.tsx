"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  GripVertical,
  HelpCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  calculateZoneAutoConfiguration,
  fetchGrassCultivarProfiles,
  fetchRegrowthRules,
  fetchZoneAutoConfigurations,
  fetchZoneConfigurations,
  runDailyZoneAutoConfigurations,
  saveRegrowthRules,
  saveZoneAutoConfiguration,
  type GrassCultivarProfileRow,
  type RegrowthRuleRow,
  type RegrowthRulesSavePayload,
  type ZoneAutoConfigSavePayload,
  type ZoneAutoConfigurationRow,
  type ZoneConfigurationRow,
} from "@/features/admin/api/adminApi";
import { onForecastMutation } from "@/features/forecasting/forecastDataSync";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { Checkbox } from "@/shared/ui/checkbox";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useModuleAccess } from "@/shared/auth/useModuleAccess";

type SprigBandRow = {
  id: string;
  maxKgPerM2: number;
  comparator: "LT" | "LTE" | "EQ" | "GTE" | "GT";
  thresholdKgPerM2: number;
  regrowthDays: number;
  label: string;
};

type RegrowthFormState = {
  sodDays: number;
  sodForSprigDays: number;
  overrideRecoveryDays: number;
  sprigBands: SprigBandRow[];
};

type AutoSettings = {
  autoEnabled: boolean;
  grassCultivarProfileId: number;
  weatherLocationId: string;
  managementLevel: string;
  soilType: string;
  soilFactor: number;
  drainageScore: number;
  phValue: number | null;
  organicMatterPct: number | null;
  compactionScore: number;
  shadePercent: number;
  irrigationMode: string;
  irrigationMmPerWeek: number;
  nitrogenKgHaMonth: number;
  potassiumFactor: number;
  mowingHeightMm: number;
  mowingFrequencyPerWeek: number;
  trafficLevel: number;
  pestDiseaseRiskScore: number;
  allowAutoUpdateInventory: boolean;
  allowAutoFillHarvestArea: boolean;
  lastInventoryKgPerM2: number | null;
  lastRecoveryDays: number | null;
  lastConfidencePct: number | null;
  lastCalculatedAt: string | null;
};

type AutoZoneRow = {
  id: string;
  farmName: string;
  country: string;
  turfgrass: string;
  zone: string;
  sizeM2: number;
  inventoryKgPerM2: number;
  maxInventoryKg: number;
  auto: AutoSettings;
};

const DEFAULT_REGROWTH: RegrowthFormState = {
  sodDays: 120,
  sodForSprigDays: 120,
  overrideRecoveryDays: 120,
  sprigBands: [
    { id: "b1", maxKgPerM2: 1, comparator: "LTE", thresholdKgPerM2: 1, regrowthDays: 30, label: "≤ 1.0 kg/m²" },
    { id: "b2", maxKgPerM2: 1.5, comparator: "LTE", thresholdKgPerM2: 1.5, regrowthDays: 45, label: "≤ 1.5 kg/m²" },
    { id: "b3", maxKgPerM2: 2.5, comparator: "LTE", thresholdKgPerM2: 2.5, regrowthDays: 60, label: "≤ 2.5 kg/m²" },
    { id: "b4", maxKgPerM2: 3.5, comparator: "LTE", thresholdKgPerM2: 3.5, regrowthDays: 75, label: "≤ 3.5 kg/m²" },
    { id: "b5", maxKgPerM2: Number.POSITIVE_INFINITY, comparator: "GT", thresholdKgPerM2: 3.5, regrowthDays: 90, label: "> 3.5 kg/m²" },
  ],
};

const COMPARATOR_OPTIONS: Array<{
  value: SprigBandRow["comparator"];
  label: string;
}> = [
  { value: "LT", label: "<" },
  { value: "LTE", label: "<=" },
  { value: "EQ", label: "=" },
  { value: "GTE", label: ">=" },
  { value: "GT", label: ">" },
];

function comparatorSymbol(
  comparator: SprigBandRow["comparator"],
): string {
  if (comparator === "LT") return "<";
  if (comparator === "LTE") return "<=";
  if (comparator === "EQ") return "=";
  if (comparator === "GTE") return ">=";
  return ">";
}

function formatComparatorLabel(
  comparator: SprigBandRow["comparator"],
  threshold: number,
): string {
  const symbol = comparatorSymbol(comparator);
  const value = Number.isFinite(threshold) ? threshold : 0;
  return `${symbol} ${value} kg/m²`;
}

function formatSprigRangePreview(
  bands: SprigBandRow[],
  rowIndex: number,
): string {
  const cur = bands[rowIndex];
  if (!cur) return "";
  const t = Number.isFinite(cur.thresholdKgPerM2) ? cur.thresholdKgPerM2 : 0;
  if (rowIndex === 0) {
    if (cur.comparator === "LT" || cur.comparator === "LTE") return `Up to ${t} kg/m²`;
    if (cur.comparator === "EQ") return `Exactly ${t} kg/m²`;
    return `Above ${t} kg/m²`;
  }
  const prev = bands[rowIndex - 1];
  if (!prev) return `Up to ${t} kg/m²`;
  const p = Number.isFinite(prev.thresholdKgPerM2) ? prev.thresholdKgPerM2 : 0;
  if (cur.comparator === "GT" || cur.comparator === "GTE") {
    return `Above ${t} kg/m²`;
  }
  if (cur.comparator === "EQ") return `Exactly ${t} kg/m²`;
  return `${p} to ${t} kg/m²`;
}

function recommendedComparatorForRow(
  bands: SprigBandRow[],
  rowIndex: number,
): SprigBandRow["comparator"] {
  if (rowIndex >= bands.length - 1) return "GT";
  return "LTE";
}

const AUTO_FORMULA_HELP = [
  "Core output formulas:",
  "baseDays = grass.base_recovery_days * grass.recovery_multiplier",
  "growthFactor = clamp(weather * soil * drainage * shade * nitrogen * potassium * mowing * management * compaction, 0.45, 1.45)",
  "stressFactor = clamp(1 + pestRisk*0.32 + traffic*0.18 + pHPenalty + drainagePenalty, 1.00, 1.75)",
  "autoYieldKgM2 = clamp(baseInventory * growthFactor / stressFactor, 0.20, 6.00)",
  "recoveryDays = round(clamp(baseDays * stressFactor / growthFactor, minDays, maxDays))",
  "confidence = clamp(40 + weatherCoverage*30 + configCompleteness*18 - pestRisk*4 - shadePenalty, 30, 92)",
].join("\n");

const AUTO_FIELD_HELP = {
  autoCalculate:
    "Turns on automatic calculation for this zone. Save or Calculate sends the grass profile, weather and management factors to the backend.",
  updateInventory:
    "If enabled, each calculation writes the auto yield back to zone_configurations.inventory_kg_per_m2 and recomputes max_inventory_kg = size_m2 * autoYieldKgM2.",
  fillHarvestArea:
    "If enabled, harvest area can be estimated from latest auto yield: harvested_area_m2 = requested_quantity_kg / latest_inventory_kg_per_m2.",
  grassProfile:
    "Cultivar baseline: base kg/m2, base recovery days, multiplier, min/max recovery days, optimum temperature, shade tolerance, nitrogen response and default mowing/N values.",
  weatherLocation:
    "Uses stored Open-Meteo forecast first. Days beyond the forecast window use monthly climate normals for this location.",
  management:
    "Management multiplier: low = 0.90, standard = 1.00, high/intensive = 1.07.",
  soilFactor:
    "Manual expert soil factor used directly inside growthFactor. Backend accepts 0.50 to 1.40; 1.00 means neutral.",
  drainageScore:
    "0 to 1 score. drainageFactor = clamp(0.75 + drainageScore*0.35, 0.65, 1.10). Low drainage also adds stress.",
  shadePercent:
    "shadeFactor = clamp(1 - ((shadePercent/100) * (1 - grass.shadeToleranceScore)), 0.45, 1.02).",
  compaction:
    "compactionFactor = clamp(1 - compactionScore*0.22, 0.76, 1.00). Higher compaction lowers growth.",
  irrigation:
    "Irrigation converts to mm/day = irrigationMmPerWeek / 7. Water score uses rain + irrigation against target water max(3, ET0).",
  nitrogen:
    "nitrogenFactor = clamp(1 + ((N/defaultN)-1)*grass.nitrogenResponseScore, 0.65, 1.18).",
  mowingHeight:
    "mowingFactor = clamp(1 - min(abs(mowingHeight/defaultMowing - 1)*0.18, 0.22), 0.78, 1.05).",
  traffic:
    "Traffic increases stressFactor by trafficLevel*0.18, which increases recovery days and lowers yield.",
  pestDisease:
    "Pest/disease increases stressFactor by pestRisk*0.32 and reduces confidence by pestRisk*4.",
  ph:
    "pH target is around 6.4. Large deviation adds pHPenalty into stressFactor.",
  organicMatter:
    "Stored for expert reference and config completeness/confidence. It is not yet a direct growth multiplier.",
  mowingFrequency:
    "If mowingFrequencyPerWeek is below 1, mowingFactor is multiplied by 0.95.",
} as const;

const WEATHER_LOCATIONS = [
  { id: "ban-bueng-th", label: "Ban Bueng, Thailand" },
  { id: "laem-chabang-th", label: "Laem Chabang, Thailand" },
  { id: "semenyih-my", label: "Semenyih, Malaysia" },
  { id: "hoi-an-vn", label: "Hoi An, Vietnam" },
  { id: "phan-thiet-vn", label: "Phan Thiet, Vietnam" },
] as const;

function parseMaxKgPerM2(
  raw: string | number | null | undefined,
): number {
  if (raw == null || raw === "") return Number.POSITIVE_INFINITY;
  const normalizedRaw =
    typeof raw === "string" ? raw.replace(",", ".").trim() : raw;
  const n =
    typeof normalizedRaw === "string"
      ? Number.parseFloat(normalizedRaw)
      : Number(normalizedRaw);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  if (n >= 999999) return Number.POSITIVE_INFINITY;
  return n;
}

function parseComparatorFromLegacyLabel(
  label: string | null | undefined,
): SprigBandRow["comparator"] | null {
  const s = String(label ?? "").trim();
  if (s.startsWith(">=")) return "GTE";
  if (s.startsWith(">")) return "GT";
  if (s.startsWith("<=")) return "LTE";
  if (s.startsWith("<")) return "LT";
  if (s.startsWith("=")) return "EQ";
  return null;
}

function parseThresholdFromLegacyLabel(
  label: string | null | undefined,
): number | null {
  const s = String(label ?? "");
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function rowsToFormState(rows: RegrowthRuleRow[]): RegrowthFormState {
  const sod = rows.find((r) => r.harvest_type === "SOD");
  const sodSprig = rows.find((r) => r.harvest_type === "SOD_FOR_SPRIG");
  const overrideRow = rows.find((r) => r.harvest_type === "OVERRIDE_RECOVERY");
  const sprig = rows
    .filter((r) => r.harvest_type === "SPRIG")
    .sort((a, b) => a.sort_order - b.sort_order || Number(a.id) - Number(b.id));

  const sprigBands: SprigBandRow[] =
    sprig.length > 0
      ? sprig.map((r, idx, list) => {
          const maxKgPerM2 = parseMaxKgPerM2(r.max_kg_per_m2);
          const rawComparator = String(r.band_comparator ?? "").toUpperCase();
          const legacyComparator = parseComparatorFromLegacyLabel(r.label);
          const isValidRawComparator =
            rawComparator === "LT" ||
            rawComparator === "LTE" ||
            rawComparator === "EQ" ||
            rawComparator === "GTE" ||
            rawComparator === "GT";
          const comparator: SprigBandRow["comparator"] = isValidRawComparator
            ? (rawComparator as SprigBandRow["comparator"])
            : (legacyComparator ??
              (maxKgPerM2 === Number.POSITIVE_INFINITY && idx === list.length - 1
                ? "GT"
                : "LTE"));

          const thresholdFromApi = toNullableNumber(r.band_threshold_kg_per_m2);
          const thresholdFromMax = Number.isFinite(maxKgPerM2) ? maxKgPerM2 : null;
          const thresholdFromLabel = parseThresholdFromLegacyLabel(r.label);
          const thresholdFromPrev = idx > 0
            ? toNumber(list[idx - 1]?.max_kg_per_m2 ?? null)
            : null;
          const fallbackThreshold =
            thresholdFromApi ??
            thresholdFromMax ??
            thresholdFromLabel ??
            thresholdFromPrev ??
            0;

          return {
            id: String(r.id),
            label: r.label,
            regrowthDays: Number(r.regrowth_days),
            maxKgPerM2,
            comparator,
            thresholdKgPerM2: fallbackThreshold,
          };
        })
      : DEFAULT_REGROWTH.sprigBands.map((b) => ({ ...b, id: b.id }));

  return {
    sodDays: sod ? Number(sod.regrowth_days) : DEFAULT_REGROWTH.sodDays,
    sodForSprigDays: sodSprig
      ? Number(sodSprig.regrowth_days)
      : DEFAULT_REGROWTH.sodForSprigDays,
    overrideRecoveryDays: overrideRow
      ? Number(overrideRow.regrowth_days)
      : DEFAULT_REGROWTH.overrideRecoveryDays,
    sprigBands,
  };
}

function formStateToSavePayload(state: RegrowthFormState): RegrowthRulesSavePayload {
  return {
    sod_days: state.sodDays,
    sod_for_sprig_days: state.sodForSprigDays,
    override_recovery_days: state.overrideRecoveryDays,
    sprig_bands: state.sprigBands.map((b) => ({
      id: b.id,
      label: formatComparatorLabel(b.comparator, b.thresholdKgPerM2),
      max_kg_per_m2:
        b.maxKgPerM2 === Number.POSITIVE_INFINITY ? null : b.maxKgPerM2,
      band_comparator: b.comparator,
      band_threshold_kg_per_m2: b.thresholdKgPerM2,
      regrowth_days: b.regrowthDays,
    })),
  };
}

function payloadFingerprint(payload: RegrowthRulesSavePayload): string {
  const normalizedBands = [...payload.sprig_bands]
    .map((b, idx) => ({
      label: b.label.trim(),
      max_kg_per_m2:
        b.max_kg_per_m2 == null || b.max_kg_per_m2 >= 999999
          ? null
          : Number(b.max_kg_per_m2),
      band_comparator: String(b.band_comparator ?? "LTE").toUpperCase(),
      band_threshold_kg_per_m2: Number(b.band_threshold_kg_per_m2 ?? b.max_kg_per_m2 ?? 0),
      regrowth_days: Number(b.regrowth_days),
      sort_order: 11 + idx,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  return JSON.stringify({
    sod_days: Number(payload.sod_days),
    sod_for_sprig_days: Number(payload.sod_for_sprig_days),
    override_recovery_days: Number(payload.override_recovery_days),
    sprig_bands: normalizedBands,
  });
}

function toNumber(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
}

function numberOrFallback(
  value: string | number | null | undefined,
  fallback: number,
): number {
  if (value == null || value === "") return fallback;
  return toNumber(value);
}

function toBool(v: string | number | boolean | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function defaultWeatherLocationId(farmName: string, country: string): string {
  const s = `${farmName} ${country}`.toLowerCase();
  if (s.includes("laem") || s.includes("chabang")) return "laem-chabang-th";
  if (s.includes("ban") || s.includes("bueng") || s.includes("thai")) return "ban-bueng-th";
  if (s.includes("semenyih") || s.includes("malaysia")) return "semenyih-my";
  if (s.includes("phan") || s.includes("thiet")) return "phan-thiet-vn";
  if (s.includes("hoi")) return "hoi-an-vn";
  if (s.includes("vietnam") || s.includes("viet")) return "phan-thiet-vn";
  return "ban-bueng-th";
}

function normalizeGrassKey(v: string): string {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function findProfileForGrass(
  profiles: GrassCultivarProfileRow[],
  turfgrass: string,
): GrassCultivarProfileRow | undefined {
  const key = normalizeGrassKey(turfgrass);
  return profiles.find(
    (p) =>
      normalizeGrassKey(p.display_name) === key ||
      normalizeGrassKey(p.cultivar_key) === key,
  );
}

function defaultAutoSettings(
  profile: GrassCultivarProfileRow | undefined,
  farmName: string,
  country: string,
): AutoSettings {
  return {
    autoEnabled: false,
    grassCultivarProfileId: profile?.id ?? 0,
    weatherLocationId: defaultWeatherLocationId(farmName, country),
    managementLevel: "standard",
    soilType: "sandy_loam",
    soilFactor: 1,
    drainageScore: 0.75,
    phValue: 6.5,
    organicMatterPct: 2.5,
    compactionScore: 0.25,
    shadePercent: 0,
    irrigationMode: "scheduled",
    irrigationMmPerWeek: 15,
    nitrogenKgHaMonth: toNumber(profile?.default_nitrogen_kg_ha_month) || 20,
    potassiumFactor: 1,
    mowingHeightMm: toNumber(profile?.default_mowing_height_mm) || 25,
    mowingFrequencyPerWeek: 2,
    trafficLevel: 0.25,
    pestDiseaseRiskScore: 0.15,
    allowAutoUpdateInventory: true,
    allowAutoFillHarvestArea: true,
    lastInventoryKgPerM2: null,
    lastRecoveryDays: null,
    lastConfidencePct: null,
    lastCalculatedAt: null,
  };
}

function mapAutoSettings(
  row: ZoneAutoConfigurationRow | undefined,
  fallback: AutoSettings,
): AutoSettings {
  if (!row) return fallback;
  return {
    autoEnabled: toBool(row.auto_enabled),
    grassCultivarProfileId: Number(row.grass_cultivar_profile_id) || fallback.grassCultivarProfileId,
    weatherLocationId: row.weather_location_id ?? fallback.weatherLocationId,
    managementLevel: row.management_level ?? fallback.managementLevel,
    soilType: row.soil_type ?? fallback.soilType,
    soilFactor: numberOrFallback(row.soil_factor, fallback.soilFactor),
    drainageScore: numberOrFallback(row.drainage_score, fallback.drainageScore),
    phValue: toNullableNumber(row.ph_value) ?? fallback.phValue,
    organicMatterPct: toNullableNumber(row.organic_matter_pct) ?? fallback.organicMatterPct,
    compactionScore: numberOrFallback(row.compaction_score, fallback.compactionScore),
    shadePercent: numberOrFallback(row.shade_percent, fallback.shadePercent),
    irrigationMode: row.irrigation_mode ?? fallback.irrigationMode,
    irrigationMmPerWeek: numberOrFallback(row.irrigation_mm_per_week, fallback.irrigationMmPerWeek),
    nitrogenKgHaMonth: numberOrFallback(row.nitrogen_kg_ha_month, fallback.nitrogenKgHaMonth),
    potassiumFactor: numberOrFallback(row.potassium_factor, fallback.potassiumFactor),
    mowingHeightMm: numberOrFallback(row.mowing_height_mm, fallback.mowingHeightMm),
    mowingFrequencyPerWeek: numberOrFallback(row.mowing_frequency_per_week, fallback.mowingFrequencyPerWeek),
    trafficLevel: numberOrFallback(row.traffic_level, fallback.trafficLevel),
    pestDiseaseRiskScore: numberOrFallback(row.pest_disease_risk_score, fallback.pestDiseaseRiskScore),
    allowAutoUpdateInventory: toBool(row.allow_auto_update_inventory),
    allowAutoFillHarvestArea: toBool(row.allow_auto_fill_harvest_area),
    lastInventoryKgPerM2: toNullableNumber(row.last_inventory_kg_per_m2),
    lastRecoveryDays: toNullableNumber(row.last_recovery_days),
    lastConfidencePct: toNullableNumber(row.last_confidence_pct),
    lastCalculatedAt: row.last_calculated_at ?? null,
  };
}

function autoPayload(row: AutoZoneRow): ZoneAutoConfigSavePayload {
  return {
    zone_configuration_id: Number(row.id),
    grass_cultivar_profile_id: row.auto.grassCultivarProfileId || undefined,
    auto_enabled: row.auto.autoEnabled,
    weather_location_id: row.auto.weatherLocationId,
    management_level: row.auto.managementLevel,
    soil_type: row.auto.soilType,
    soil_factor: row.auto.soilFactor,
    drainage_score: row.auto.drainageScore,
    ph_value: row.auto.phValue,
    organic_matter_pct: row.auto.organicMatterPct,
    compaction_score: row.auto.compactionScore,
    shade_percent: row.auto.shadePercent,
    irrigation_mode: row.auto.irrigationMode,
    irrigation_mm_per_week: row.auto.irrigationMmPerWeek,
    nitrogen_kg_ha_month: row.auto.nitrogenKgHaMonth,
    potassium_factor: row.auto.potassiumFactor,
    mowing_height_mm: row.auto.mowingHeightMm,
    mowing_frequency_per_week: row.auto.mowingFrequencyPerWeek,
    traffic_level: row.auto.trafficLevel,
    pest_disease_risk_score: row.auto.pestDiseaseRiskScore,
    allow_auto_update_inventory: row.auto.allowAutoUpdateInventory,
    allow_auto_fill_harvest_area: row.auto.allowAutoFillHarvestArea,
  };
}

/** Apply in-progress max kg/m² text so Save works without blurring the field first. */
function mergeMaxKgDraftsIntoConfig(
  state: RegrowthFormState,
  drafts: Record<string, string>,
): RegrowthFormState {
  const touched = Object.keys(drafts);
  if (touched.length === 0) return state;
  return {
    ...state,
    sprigBands: state.sprigBands.map((b) => {
      const raw = drafts[b.id];
      if (raw === undefined) return b;
      const v = raw.trim();
      if (v === "") return b;
      const normalized = v.replace(",", ".");
      if (
        normalized === "." ||
        normalized === "," ||
        /^\d+[.,]$/.test(v)
      ) {
        return b;
      }
      const n = Number(normalized);
      if (!Number.isNaN(n) && n >= 0) {
        const nextMax =
          b.comparator === "LT" ||
          b.comparator === "LTE" ||
          b.comparator === "EQ"
            ? n
            : Number.POSITIVE_INFINITY;
        return {
          ...b,
          thresholdKgPerM2: n,
          maxKgPerM2: nextMax,
          label: formatComparatorLabel(b.comparator, n),
        };
      }
      return b;
    }),
  };
}

const inputClass =
  "flex h-8 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50";

const btnOutline =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const btnSm =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

const btnIcon =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function hslFromRootVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return fallback;
  if (raw.startsWith("#") || raw.startsWith("hsl") || raw.startsWith("rgb")) {
    return raw;
  }
  return `hsl(${raw})`;
}

function removeBandDragGhost(ref: MutableRefObject<HTMLTableElement | null>) {
  const g = ref.current;
  if (g?.parentNode) {
    g.parentNode.removeChild(g);
  }
  ref.current = null;
}

function BandDropInsertionLine() {
  return (
    <tr className="pointer-events-none border-0" aria-hidden>
      <td colSpan={6} className="h-1 border-0 p-0">
        <div className="bg-primary mx-4 h-1 rounded-full shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" />
      </td>
    </tr>
  );
}

export default function AdminRegrowthPage() {
  const t = useTranslations("AdminRegrowth");
  const { canCreate, canEdit, canDelete } = useModuleAccess("admin_regrowth");
  const readOnly = !canEdit;
  const [config, setConfig] = useState<RegrowthFormState>(DEFAULT_REGROWTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newBand, setNewBand] = useState({
    comparator: "LTE" as SprigBandRow["comparator"],
    maxKgPerM2: "",
    regrowthDays: "",
  });
  const [notice, setNotice] = useState<{
    variant: "ok" | "err";
    text: string;
  } | null>(null);
  const [dragBandId, setDragBandId] = useState<string | null>(null);
  /** Insert slot index 0..n while dragging (before row i, or n = after last band). */
  const [bandDropInsertPreview, setBandDropInsertPreview] = useState<
    number | null
  >(null);
  const bandDropInsertRef = useRef<number | null>(null);
  /** Lets users type decimals like `1.` without the controlled value snapping to an integer. */
  const [maxKgDraftById, setMaxKgDraftById] = useState<Record<string, string>>(
    {},
  );
  const [autoConfigOpen, setAutoConfigOpen] = useState(false);
  const [autoRows, setAutoRows] = useState<AutoZoneRow[]>([]);
  const [autoProfiles, setAutoProfiles] = useState<GrassCultivarProfileRow[]>([]);
  const [autoSelectedId, setAutoSelectedId] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const bandDragGhostRef = useRef<HTMLTableElement | null>(null);

  const setBandDropSlot = useCallback((index: number | null) => {
    bandDropInsertRef.current = index;
    setBandDropInsertPreview(index);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(
    () => () => {
      removeBandDragGhost(bandDragGhostRef);
    },
    [],
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchRegrowthRules();
        if (!mounted) return;
        const nextConfig = rowsToFormState(data);
        setMaxKgDraftById({});
        setConfig(nextConfig);
        setSavedFingerprint(
          payloadFingerprint(formStateToSavePayload(nextConfig)),
        );
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : t("errors.loadRules"));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const loadAutoRows = useCallback(async (preferredId?: string) => {
    setAutoLoading(true);
    try {
      const [zoneData, profileData, autoData] = await Promise.all([
        fetchZoneConfigurations(),
        fetchGrassCultivarProfiles().catch(() => [] as GrassCultivarProfileRow[]),
        fetchZoneAutoConfigurations().catch(() => [] as ZoneAutoConfigurationRow[]),
      ]);
      const autoByZoneId = new Map(
        autoData.map((a) => [String(a.zone_configuration_id), a]),
      );
      const mapped = (zoneData ?? []).map((r: ZoneConfigurationRow) => {
        const size = toNumber(r.size_m2);
        const inv = toNumber(r.inventory_kg_per_m2);
        const country = String(r.country ?? "");
        const turfgrass = String(r.turfgrass ?? "");
        const farmName = String(
          (r as { farm_name?: unknown; farmName?: unknown }).farm_name ??
            (r as { farm_name?: unknown; farmName?: unknown }).farmName ??
            "",
        );
        const profile = findProfileForGrass(profileData, turfgrass);
        const fallback = defaultAutoSettings(profile, farmName, country);
        return {
          id: String(r.id),
          farmName,
          country,
          turfgrass,
          zone: r.zone,
          sizeM2: size,
          inventoryKgPerM2: inv,
          maxInventoryKg: toNumber(r.max_inventory_kg) || size * inv,
          auto: mapAutoSettings(autoByZoneId.get(String(r.id)), fallback),
        };
      });
      setAutoProfiles(profileData);
      setAutoRows(mapped);
      setAutoSelectedId((current) => {
        const keep = preferredId || current;
        if (keep && mapped.some((r) => r.id === keep)) return keep;
        return mapped[0]?.id ?? "";
      });
    } catch (e) {
      setNotice({
        variant: "err",
        text:
          e instanceof Error
            ? e.message
            : t("errors.loadAutoConfig"),
      });
    } finally {
      setAutoLoading(false);
    }
  }, []);

  const selectedAutoRow = useMemo(
    () => autoRows.find((row) => row.id === autoSelectedId) ?? null,
    [autoRows, autoSelectedId],
  );

  const openAutoConfig = useCallback(() => {
    setAutoConfigOpen(true);
    void loadAutoRows();
  }, [loadAutoRows]);

  const updateAutoRow = useCallback((id: string, patch: Partial<AutoSettings>) => {
    setAutoRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              auto: {
                ...row.auto,
                ...patch,
              },
            }
          : row,
      ),
    );
  }, []);

  const saveSelectedAutoConfig = useCallback(async () => {
    if (!selectedAutoRow) return;
    const zoneId = Number(selectedAutoRow.id);
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      setNotice({ variant: "err", text: t("errors.selectSavedZoneForSave") });
      return;
    }
    setAutoSaving(true);
    try {
      await saveZoneAutoConfiguration(autoPayload(selectedAutoRow));
      await loadAutoRows(selectedAutoRow.id);
      setNotice({ variant: "ok", text: t("notices.autoConfigSaved") });
    } catch (e) {
      setNotice({
        variant: "err",
        text: e instanceof Error ? e.message : t("errors.saveAutoConfig"),
      });
    } finally {
      setAutoSaving(false);
    }
  }, [loadAutoRows, selectedAutoRow, t]);

  const calculateSelectedAutoConfig = useCallback(async () => {
    if (!selectedAutoRow) return;
    const zoneId = Number(selectedAutoRow.id);
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      setNotice({ variant: "err", text: t("errors.selectSavedZoneForCalculate") });
      return;
    }
    setAutoSaving(true);
    try {
      await saveZoneAutoConfiguration(autoPayload(selectedAutoRow));
      await calculateZoneAutoConfiguration(zoneId);
      await loadAutoRows(selectedAutoRow.id);
      setNotice({
        variant: "ok",
        text: t("notices.calculateAutoDone", {
          farm: selectedAutoRow.farmName,
          grass: selectedAutoRow.turfgrass,
          zone: selectedAutoRow.zone,
        }),
      });
    } catch (e) {
      setNotice({
        variant: "err",
        text: e instanceof Error ? e.message : t("errors.calculateAuto"),
      });
    } finally {
      setAutoSaving(false);
    }
  }, [loadAutoRows, selectedAutoRow, t]);

  const runDailyAutoConfig = useCallback(async () => {
    setAutoSaving(true);
    try {
      const result = await runDailyZoneAutoConfigurations();
      await loadAutoRows(autoSelectedId || undefined);
      setNotice({
        variant: "ok",
        text: `Daily auto calculation completed for ${result.count} zones.`,
      });
    } catch (e) {
      setNotice({
        variant: "err",
        text: e instanceof Error ? e.message : t("errors.runDailyAuto"),
      });
    } finally {
      setAutoSaving(false);
    }
  }, [autoSelectedId, loadAutoRows]);

  const updateSodDays = useCallback((days: number) => {
    setConfig((c) => ({ ...c, sodDays: days }));
  }, []);
  const updateSodForSprigDays = useCallback((days: number) => {
    setConfig((c) => ({ ...c, sodForSprigDays: days }));
  }, []);
  const updateOverrideRecoveryDays = useCallback((days: number) => {
    setConfig((c) => ({ ...c, overrideRecoveryDays: days }));
  }, []);

  const updateBand = useCallback(
    (id: string, patch: Partial<Omit<SprigBandRow, "id">>) => {
      setConfig((c) => ({
        ...c,
        sprigBands: c.sprigBands.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        ),
      }));
    },
    [],
  );

  const addBand = useCallback((band: Omit<SprigBandRow, "id">) => {
    setConfig((c) => ({
      ...c,
      sprigBands: [
        ...c.sprigBands,
        { ...band, id: `new-${Date.now()}` },
      ],
    }));
  }, []);

  const deleteBand = useCallback((id: string) => {
    setMaxKgDraftById((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setConfig((c) => ({
      ...c,
      sprigBands: c.sprigBands.filter((b) => b.id !== id),
    }));
  }, []);

  const handleBandDragStart = useCallback(
    (e: DragEvent, id: string) => {
      setDragBandId(id);
      setBandDropSlot(null);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";

      const handle = e.currentTarget as HTMLElement | null;
      const row = handle?.closest("tr");
      if (!row || !(row instanceof HTMLTableRowElement)) return;

      removeBandDragGhost(bandDragGhostRef);

      const clone = row.cloneNode(true) as HTMLTableRowElement;
      clone.querySelectorAll("[draggable]").forEach((el) => {
        el.removeAttribute("draggable");
      });
      clone.querySelectorAll("input, button").forEach((el) => {
        (el as HTMLElement).style.pointerEvents = "none";
      });

      const tbl = document.createElement("table");
      tbl.setAttribute("data-band-drag-ghost", "true");
      tbl.style.cssText = [
        "border-collapse: separate",
        "border-spacing: 0",
        "pointer-events: none",
        "user-select: none",
        "opacity: 0.96",
        `background: ${hslFromRootVar("--card", "#fff")}`,
        `border: 1px solid ${hslFromRootVar("--border", "#e5e5e5")}`,
        "border-radius: 10px",
        "box-shadow: 0 14px 44px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.04)",
        "overflow: hidden",
      ].join("; ");

      const tbody = document.createElement("tbody");
      tbody.appendChild(clone);
      tbl.appendChild(tbody);

      const rect = row.getBoundingClientRect();
      tbl.style.width = `${Math.ceil(rect.width)}px`;

      document.body.appendChild(tbl);
      bandDragGhostRef.current = tbl;

      const offsetX = Math.max(
        8,
        Math.min(e.clientX - rect.left, rect.width - 8),
      );
      const offsetY = Math.max(
        8,
        Math.min(e.clientY - rect.top, rect.height - 8),
      );
      e.dataTransfer.setDragImage(tbl, offsetX, offsetY);
    },
    [setBandDropSlot],
  );

  const handleBandDragEnd = useCallback(() => {
    setDragBandId(null);
    setBandDropSlot(null);
    removeBandDragGhost(bandDragGhostRef);
  }, [setBandDropSlot]);

  const handleBandDragOverRow = useCallback(
    (e: DragEvent, rowIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const tr = e.currentTarget;
      if (!(tr instanceof HTMLTableRowElement)) return;
      const rect = tr.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      const insertIdx = before ? rowIndex : rowIndex + 1;
      setBandDropSlot(insertIdx);
    },
    [setBandDropSlot],
  );

  const handleBandDragOverAfterLast = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setBandDropSlot(config.sprigBands.length);
    },
    [config.sprigBands.length, setBandDropSlot],
  );

  const handleBandDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) {
        setDragBandId(null);
        setBandDropSlot(null);
        removeBandDragGhost(bandDragGhostRef);
        return;
      }
      const sourceId = (dt.getData("text/plain").trim() || dragBandId || "").trim();
      const insertAt = bandDropInsertRef.current;
      if (!sourceId || insertAt == null) {
        setDragBandId(null);
        setBandDropSlot(null);
        removeBandDragGhost(bandDragGhostRef);
        return;
      }
      setConfig((c) => {
        const bands = [...c.sprigBands];
        const fromIndex = bands.findIndex((b) => b.id === sourceId);
        if (fromIndex < 0) return c;
        const n = bands.length;
        const clamped = Math.max(0, Math.min(insertAt, n));
        let insert = clamped;
        if (fromIndex < insert) insert -= 1;
        const [removed] = bands.splice(fromIndex, 1);
        bands.splice(insert, 0, removed);
        return { ...c, sprigBands: bands };
      });
      setDragBandId(null);
      setBandDropSlot(null);
      removeBandDragGhost(bandDragGhostRef);
    },
    [dragBandId, setBandDropSlot],
  );

  const resetToDefaults = useCallback(() => {
    setMaxKgDraftById({});
    setConfig({
      sodDays: DEFAULT_REGROWTH.sodDays,
      sodForSprigDays: DEFAULT_REGROWTH.sodForSprigDays,
      overrideRecoveryDays: DEFAULT_REGROWTH.overrideRecoveryDays,
      sprigBands: DEFAULT_REGROWTH.sprigBands.map((b) => ({ ...b })),
    });
    setNotice({
      variant: "ok",
      text: t("notices.defaultsRestored"),
    });
  }, []);

  const handleSaveChanges = useCallback(async () => {
    setNotice(null);
    setSaving(true);
    try {
      const merged = mergeMaxKgDraftsIntoConfig(config, maxKgDraftById);
      const payload = formStateToSavePayload(merged);
      const nextFingerprint = payloadFingerprint(payload);
      if (nextFingerprint === savedFingerprint) {
        setNotice({
          variant: "ok",
          text: t("notices.noChanges"),
        });
        return;
      }
      const rows = await saveRegrowthRules(payload);
      setMaxKgDraftById({});
      const nextConfig = rowsToFormState(rows);
      setConfig(nextConfig);
      setSavedFingerprint(payloadFingerprint(formStateToSavePayload(nextConfig)));
      toast.success(t("notices.savedRebuildQueued"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
        autoClose: 10000,
      });
      const fetchAll = useHarvestingDataStore.getState().fetchAllHarvestingReferenceData;
      void fetchAll(true);
      onForecastMutation("rules");
    } catch (e) {
      setNotice({
        variant: "err",
        text:
          e instanceof Error ? e.message : t("errors.saveRules"),
      });
    } finally {
      setSaving(false);
    }
  }, [config, maxKgDraftById, savedFingerprint]);

  const handleAddBand = () => {
    const maxRaw = newBand.maxKgPerM2.trim();
    const normalizedMaxRaw = maxRaw.replace(",", ".");
    const threshold = Number(normalizedMaxRaw);
    const max =
      newBand.comparator === "LT" ||
      newBand.comparator === "LTE" ||
      newBand.comparator === "EQ"
        ? threshold
        : Number.POSITIVE_INFINITY;
    const days = Number(newBand.regrowthDays);
    if (
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      !Number.isFinite(days) ||
      days <= 0
    ) {
      setNotice({
        variant: "err",
        text: t("errors.invalidBandInput"),
      });
      return;
    }
    const labelAdded = formatComparatorLabel(newBand.comparator, threshold);
    addBand({
      label: labelAdded,
      maxKgPerM2: max,
      comparator: newBand.comparator,
      thresholdKgPerM2: threshold,
      regrowthDays: days,
    });
    setNewBand({ comparator: "LTE", maxKgPerM2: "", regrowthDays: "" });
    setNotice({
      variant: "ok",
      text: t("notices.bandAdded", { label: labelAdded, days }),
    });
  };

  const renderAutoFields = (
    value: AutoSettings,
    onChange: (patch: Partial<AutoSettings>) => void,
  ) => (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Auto recovery formula</p>
          <HelpTip content={AUTO_FORMULA_HELP} />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>Recovery days = base days x stress / growth.</p>
          <p>Auto yield = base kg/m2 x growth / stress.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={value.autoEnabled}
            disabled={readOnly}
            onChange={(e) => onChange({ autoEnabled: e.target.checked })}
          />
          Auto calculate
          <HelpTip content={AUTO_FIELD_HELP.autoCalculate} />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={value.allowAutoUpdateInventory}
            disabled={readOnly}
            onChange={(e) => onChange({ allowAutoUpdateInventory: e.target.checked })}
          />
          Update inventory
          <HelpTip content={AUTO_FIELD_HELP.updateInventory} />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={value.allowAutoFillHarvestArea}
            disabled={readOnly}
            onChange={(e) => onChange({ allowAutoFillHarvestArea: e.target.checked })}
          />
          Fill harvest area
          <HelpTip content={AUTO_FIELD_HELP.fillHarvestArea} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <FieldLabel label="Grass profile" help={AUTO_FIELD_HELP.grassProfile} />
          <select
            className={inputClass}
            value={value.grassCultivarProfileId || ""}
            disabled={readOnly}
            onChange={(e) => {
              const profileId = Number(e.target.value) || 0;
              const p = autoProfiles.find((x) => x.id === profileId);
              onChange({
                grassCultivarProfileId: profileId,
                nitrogenKgHaMonth: p ? toNumber(p.default_nitrogen_kg_ha_month) : value.nitrogenKgHaMonth,
                mowingHeightMm: p ? toNumber(p.default_mowing_height_mm) : value.mowingHeightMm,
              });
            }}
          >
            <option value="">Select profile</option>
            {autoProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <FieldLabel label="Weather location" help={AUTO_FIELD_HELP.weatherLocation} />
          <select
            className={inputClass}
            value={value.weatherLocationId}
            disabled={readOnly}
            onChange={(e) => onChange({ weatherLocationId: e.target.value })}
          >
            {WEATHER_LOCATIONS.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <FieldLabel label="Management" help={AUTO_FIELD_HELP.management} />
          <select
            className={inputClass}
            value={value.managementLevel}
            disabled={readOnly}
            onChange={(e) => onChange({ managementLevel: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="standard">Standard</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <NumberField label="Soil factor" help={AUTO_FIELD_HELP.soilFactor} value={value.soilFactor} onChange={(soilFactor) => onChange({ soilFactor })} step="0.01" disabled={readOnly} />
        <NumberField label="Drainage score" help={AUTO_FIELD_HELP.drainageScore} value={value.drainageScore} onChange={(drainageScore) => onChange({ drainageScore })} step="0.01" disabled={readOnly} />
        <NumberField label="Shade %" help={AUTO_FIELD_HELP.shadePercent} value={value.shadePercent} onChange={(shadePercent) => onChange({ shadePercent })} step="1" disabled={readOnly} />
        <NumberField label="Compaction" help={AUTO_FIELD_HELP.compaction} value={value.compactionScore} onChange={(compactionScore) => onChange({ compactionScore })} step="0.01" disabled={readOnly} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <NumberField label="Irrigation mm/week" help={AUTO_FIELD_HELP.irrigation} value={value.irrigationMmPerWeek} onChange={(irrigationMmPerWeek) => onChange({ irrigationMmPerWeek })} step="1" disabled={readOnly} />
        <NumberField label="Nitrogen kg/ha/month" help={AUTO_FIELD_HELP.nitrogen} value={value.nitrogenKgHaMonth} onChange={(nitrogenKgHaMonth) => onChange({ nitrogenKgHaMonth })} step="1" disabled={readOnly} />
        <NumberField label="Mowing height mm" help={AUTO_FIELD_HELP.mowingHeight} value={value.mowingHeightMm} onChange={(mowingHeightMm) => onChange({ mowingHeightMm })} step="1" disabled={readOnly} />
        <NumberField label="Traffic level" help={AUTO_FIELD_HELP.traffic} value={value.trafficLevel} onChange={(trafficLevel) => onChange({ trafficLevel })} step="0.01" disabled={readOnly} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <NumberField label="Pest/disease risk" help={AUTO_FIELD_HELP.pestDisease} value={value.pestDiseaseRiskScore} onChange={(pestDiseaseRiskScore) => onChange({ pestDiseaseRiskScore })} step="0.01" disabled={readOnly} />
        <NumberField label="pH" help={AUTO_FIELD_HELP.ph} value={value.phValue ?? 0} onChange={(phValue) => onChange({ phValue })} step="0.1" disabled={readOnly} />
        <NumberField label="Organic matter %" help={AUTO_FIELD_HELP.organicMatter} value={value.organicMatterPct ?? 0} onChange={(organicMatterPct) => onChange({ organicMatterPct })} step="0.1" disabled={readOnly} />
        <NumberField label="Mowing / week" help={AUTO_FIELD_HELP.mowingFrequency} value={value.mowingFrequencyPerWeek} onChange={(mowingFrequencyPerWeek) => onChange({ mowingFrequencyPerWeek })} step="0.1" disabled={readOnly} />
      </div>
    </div>
  );

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 text-foreground lg:p-8">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
            {t("title")}
          </h1>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              {t("loading")}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          {notice ? (
            <p
              role="status"
              className={cn(
                "text-sm",
                notice.variant === "err"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {notice.text}
            </p>
          ) : null}

          {!loading && !error ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {t("description")}
	                </p>
	                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
	                  {/* <button
	                    type="button"
	                    className={btnOutline}
	                    onClick={openAutoConfig}
	                    disabled={autoLoading || autoSaving}
	                  >
	                    <Settings2 className="h-4 w-4" />
	                    Config
	                  </button>
	                  <button
	                    type="button"
	                    className={btnOutline}
                    onClick={resetToDefaults}
                    disabled={saving}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset to Defaults
                  </button> */}
                  {canEdit ? (
                    <button
                      type="button"
                      className={cn(btnSm, "h-9 px-4 text-sm")}
                      onClick={() => void handleSaveChanges()}
                      disabled={saving}
                    >
                      <Save className="h-4 w-4" />
                      {saving ? t("saving") : t("saveChanges")}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t("cards.sodRegrowth")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.sodDays}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateSodDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("days")}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("cards.sodRegrowthHint")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t("cards.sodForSprigRegrowth")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.sodForSprigDays}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateSodForSprigDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("days")}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("cards.sodForSprigHint")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t("cards.manualOverrideRecovery")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.overrideRecoveryDays}
                        disabled={readOnly}
                        onChange={(e) =>
                          updateOverrideRecoveryDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {t("days")}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("cards.manualOverrideHint")}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("sprigBands.title")}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("sprigBands.description")}
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="border-b border-border [&_tr]:border-b">
                        <tr className="border-b border-border transition-colors">
                          <th
                            className="h-10 w-10 px-2 text-center align-middle font-medium text-muted-foreground"
                            title={t("sprigBands.dragRowsTitle")}
                          >
                            <span className="sr-only">{t("sprigBands.reorder")}</span>
                            <GripVertical
                              className="mx-auto h-4 w-4 opacity-50"
                              aria-hidden
                            />
                          </th>
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                            {t("sprigBands.table.rule")}
                          </th>
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                            {t("sprigBands.table.comparator")}
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            {t("sprigBands.table.threshold")}
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            {t("sprigBands.table.regrowthDays")}
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            {t("sprigBands.table.actions")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {config.sprigBands.map((band, rowIndex) => (
                          <Fragment key={band.id}>
                            {dragBandId != null &&
                            bandDropInsertPreview === rowIndex ? (
                              <BandDropInsertionLine />
                            ) : null}
                            <tr
                              className={cn(
                                "border-b border-border transition-colors hover:bg-muted/40",
                                dragBandId === band.id &&
                                  "bg-muted/25 opacity-80",
                              )}
                              onDragOver={(e) =>
                                handleBandDragOverRow(e, rowIndex)
                              }
                              onDrop={handleBandDrop}
                            >
                              <td className="w-10 p-2 px-2 align-middle text-center">
                                <div
                                  draggable={canEdit}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("sprigBands.dragRowAria")}
                                  title={t("sprigBands.dragRowTitle")}
                                  onDragStart={(e) =>
                                    handleBandDragStart(e, band.id)
                                  }
                                  onDragEnd={handleBandDragEnd}
                                  className={cn(
                                    "inline-flex touch-manipulation rounded-md p-1.5 text-muted-foreground",
                                    canEdit
                                      ? "cursor-grab hover:bg-muted active:cursor-grabbing"
                                      : "cursor-not-allowed opacity-40",
                                  )}
                                >
                                  <GripVertical className="h-4 w-4 shrink-0" />
                                </div>
                              </td>
                              <td className="p-2 align-middle px-4">
                                <p className="text-sm font-medium text-foreground">
                                  {formatSprigRangePreview(config.sprigBands, rowIndex)}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  ({formatComparatorLabel(
                                    band.comparator,
                                    band.thresholdKgPerM2,
                                  )})
                                </p>
                              </td>
                              <td className="p-2 align-middle px-4">
                                {(() => {
                                  const recommended = recommendedComparatorForRow(
                                    config.sprigBands,
                                    rowIndex,
                                  );
                                  const current = band.comparator;
                                  const recommendedLabel = comparatorSymbol(recommended);
                                  return (
                                    <>
                                <select
                                  className={cn(inputClass, "h-8")}
                                  value={band.comparator}
                                  disabled={readOnly}
                                  onChange={(e) => {
                                    const comparator = e.target
                                      .value as SprigBandRow["comparator"];
                                    updateBand(band.id, {
                                      comparator,
                                      maxKgPerM2:
                                        comparator === "LT" ||
                                        comparator === "LTE" ||
                                        comparator === "EQ"
                                          ? band.thresholdKgPerM2
                                          : Number.POSITIVE_INFINITY,
                                      label: formatComparatorLabel(
                                        comparator,
                                        band.thresholdKgPerM2,
                                      ),
                                    });
                                  }}
                                >
                                  {COMPARATOR_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                      <div className="mt-1 flex items-center justify-between gap-2">
                                        <span className="text-[11px] text-muted-foreground">
                                          {t("sprigBands.suggestion")} <span className="font-medium text-foreground">{recommendedLabel}</span>{" "}
                                          {recommended === "LTE"
                                            ? t("sprigBands.upperBoundBand")
                                            : t("sprigBands.lastBandAboveThreshold")}
                                        </span>
                                        {current !== recommended && canEdit ? (
                                          <button
                                            type="button"
                                            className="text-[11px] text-primary hover:underline"
                                            onClick={() =>
                                              updateBand(band.id, {
                                                comparator: recommended,
                                                maxKgPerM2:
                                                  recommended === "LT" ||
                                                  recommended === "LTE" ||
                                                  recommended === "EQ"
                                                    ? band.thresholdKgPerM2
                                                    : Number.POSITIVE_INFINITY,
                                                label: formatComparatorLabel(
                                                  recommended,
                                                  band.thresholdKgPerM2,
                                                ),
                                              })
                                            }
                                          >
                                            {t("sprigBands.useSuggestion")}
                                          </button>
                                        ) : null}
                                      </div>
                                    </>
                                  );
                                })()}
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                <div className="ml-auto inline-flex items-center gap-1">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    disabled={readOnly}
                                    className={cn(
                                      inputClass,
                                      "h-8 w-28 text-right",
                                    )}
                                    value={
                                      maxKgDraftById[band.id] !== undefined
                                        ? maxKgDraftById[band.id]
                                        : String(band.thresholdKgPerM2)
                                    }
                                    onFocus={() => {
                                      setMaxKgDraftById((d) => ({
                                        ...d,
                                        [band.id]: String(band.thresholdKgPerM2),
                                      }));
                                    }}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      setMaxKgDraftById((d) => ({
                                        ...d,
                                        [band.id]: raw,
                                      }));
                                      const v = raw.trim();
                                    const normalized = v.replace(",", ".");
                                      if (
                                        v === "" ||
                                      normalized === "." ||
                                      normalized === "," ||
                                      /^\d+[.,]$/.test(v)
                                      ) {
                                        return;
                                      }
                                    const n = Number(normalized);
                                      if (!Number.isNaN(n) && n >= 0) {
                                        updateBand(band.id, {
                                          thresholdKgPerM2: n,
                                          maxKgPerM2:
                                            band.comparator === "LT" ||
                                            band.comparator === "LTE" ||
                                            band.comparator === "EQ"
                                              ? n
                                              : Number.POSITIVE_INFINITY,
                                          label: formatComparatorLabel(
                                            band.comparator,
                                            n,
                                          ),
                                        });
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const v = e.target.value.trim();
                                      if (v === "") {
                                        return;
                                      }
                                      setMaxKgDraftById((d) => {
                                        const next = { ...d };
                                        delete next[band.id];
                                        return next;
                                      });
                                      const n = Number(v.replace(",", "."));
                                      if (
                                        Number.isNaN(n) ||
                                        n < 0
                                      ) {
                                        return;
                                      }
                                      updateBand(band.id, {
                                        thresholdKgPerM2: n,
                                        maxKgPerM2:
                                          band.comparator === "LT" ||
                                          band.comparator === "LTE" ||
                                          band.comparator === "EQ"
                                            ? n
                                            : Number.POSITIVE_INFINITY,
                                        label: formatComparatorLabel(
                                          band.comparator,
                                          n,
                                        ),
                                      });
                                    }}
                                  />
                                </div>
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                <input
                                  type="number"
                                  min={1}
                                  className={cn(
                                    inputClass,
                                    "ml-auto h-8 w-24 text-right",
                                  )}
                                  value={band.regrowthDays}
                                  disabled={readOnly}
                                  onChange={(e) =>
                                    updateBand(band.id, {
                                      regrowthDays: Math.max(
                                        1,
                                        Number(e.target.value) || 0,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                {canDelete ? (
                                  <button
                                    type="button"
                                    className={btnGhost}
                                    onClick={() => deleteBand(band.id)}
                                    disabled={config.sprigBands.length <= 1}
                                    title={t("sprigBands.removeBand")}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          </Fragment>
                          ))}
                        {dragBandId != null &&
                        bandDropInsertPreview === config.sprigBands.length ? (
                          <BandDropInsertionLine />
                        ) : null}
                        {canCreate ? (
                        <tr
                          className="border-b border-border bg-muted/30"
                          onDragOver={handleBandDragOverAfterLast}
                          onDrop={handleBandDrop}
                        >
                          <td className="p-2 px-2 align-middle" aria-hidden />
                          <td className="p-2 align-middle px-4">
                            <p className="text-sm text-muted-foreground">{t("sprigBands.preview")}</p>
                          </td>
                          <td className="p-2 align-middle px-4">
                            <select
                              className={cn(inputClass, "h-8")}
                              value={newBand.comparator}
                              onChange={(e) =>
                                setNewBand((b) => ({
                                  ...b,
                                  comparator: e.target.value as SprigBandRow["comparator"],
                                }))
                              }
                            >
                              {COMPARATOR_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <div className="ml-auto inline-flex items-center gap-1">
                              <input
                                placeholder={t("sprigBands.thresholdPlaceholder")}
                                className={cn(
                                  inputClass,
                                  "h-8 w-28 text-right",
                                )}
                                value={newBand.maxKgPerM2}
                                onChange={(e) =>
                                  setNewBand((b) => ({
                                    ...b,
                                    maxKgPerM2: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <input
                              type="number"
                              placeholder={t("sprigBands.daysPlaceholder")}
                              className={cn(
                                inputClass,
                                "ml-auto h-8 w-24 text-right",
                              )}
                              value={newBand.regrowthDays}
                              onChange={(e) =>
                                setNewBand((b) => ({
                                  ...b,
                                  regrowthDays: e.target.value,
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <button
                              type="button"
                              className={btnSm}
                              onClick={handleAddBand}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {t("sprigBands.add")}
                            </button>
                          </td>
                        </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                {t("footer")}
              </p>
            </>
	          ) : null}
	        </div>

	        {autoConfigOpen ? (
	          <Modal
	            title={t("auto.title")}
	            onClose={() => setAutoConfigOpen(false)}
	            maxWidth="max-w-5xl"
	          >
	            <div className="space-y-4">
	              {autoLoading ? (
	                <p className="text-sm text-muted-foreground">{t("auto.loading")}</p>
	              ) : autoRows.length === 0 ? (
	                <p className="text-sm text-muted-foreground">{t("auto.empty")}</p>
	              ) : (
	                <>
	                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
	                    <div className="space-y-2">
	                      <FieldLabel
	                      label={t("auto.zone")}
	                        help={t("auto.zoneSelectHelp")}
	                      />
	                      <select
	                        className={inputClass}
	                        value={autoSelectedId}
	                        disabled={readOnly}
	                        onChange={(e) => setAutoSelectedId(e.target.value)}
	                      >
	                        {autoRows.map((row) => (
	                          <option key={row.id} value={row.id}>
	                            {t("auto.zoneOptionLine", {
	                              farm: row.farmName,
	                              grass: row.turfgrass,
	                              zone: row.zone,
	                            })}
	                          </option>
	                        ))}
	                      </select>
	                    </div>
	                    <MetricInline
	                      label={t("auto.recoveryDays")}
	                      value={selectedAutoRow?.auto.lastRecoveryDays ? String(selectedAutoRow.auto.lastRecoveryDays) : "-"}
	                    />
	                    <MetricInline
	                      label={t("auto.autoYield")}
	                      value={selectedAutoRow?.auto.lastInventoryKgPerM2 ? `${selectedAutoRow.auto.lastInventoryKgPerM2.toFixed(3)} kg/m2` : "-"}
	                    />
	                    <MetricInline
	                      label={t("auto.confidence")}
	                      value={selectedAutoRow?.auto.lastConfidencePct ? `${selectedAutoRow.auto.lastConfidencePct.toFixed(0)}%` : "-"}
	                    />
	                  </div>

	                  {selectedAutoRow ? (
	                    renderAutoFields(selectedAutoRow.auto, (patch) =>
	                      updateAutoRow(selectedAutoRow.id, patch),
	                    )
	                  ) : null}

	                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
	                    <button
	                      type="button"
	                      className={btnOutline}
	                      disabled={readOnly || autoSaving}
	                      onClick={() => void runDailyAutoConfig()}
	                    >
	                      <RefreshCw className="h-4 w-4" />
	                      {t("auto.runDailyAuto")}
	                    </button>
	                    <button
	                      type="button"
	                      className={btnOutline}
	                      disabled={readOnly || autoSaving || !selectedAutoRow}
	                      onClick={() => void saveSelectedAutoConfig()}
	                    >
	                      {t("auto.saveConfig")}
	                    </button>
	                    <button
	                      type="button"
	                      className={cn(btnSm, "h-9 px-4 text-sm")}
	                      disabled={readOnly || autoSaving || !selectedAutoRow}
	                      onClick={() => void calculateSelectedAutoConfig()}
	                    >
	                      {t("auto.calculate")}
	                    </button>
	                  </div>
	                </>
	              )}
	            </div>
	          </Modal>
	        ) : null}
	      </DashboardLayout>
	    </RequireAuth>
  );
}

function Modal({
  title,
  children,
  onClose,
  maxWidth,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidth: string;
}) {
  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <Card className={cn("w-full", maxWidth)} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <CardContent className="max-h-[88vh] space-y-4 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
            <button type="button" className={btnIcon} onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function HelpTip({ content }: { content: string }) {
  return (
    <span
      className="group relative inline-flex shrink-0 cursor-help items-center align-middle"
      tabIndex={0}
      aria-label="Calculation help"
    >
      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground group-focus:text-foreground" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-80 mt-2 hidden w-72 -translate-x-1/2 whitespace-pre-line rounded-md border border-border bg-card p-3 text-left text-xs font-normal leading-relaxed text-card-foreground shadow-lg group-hover:block group-focus:block"
      >
        {content}
      </span>
    </span>
  );
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {help ? <HelpTip content={help} /> : null}
    </label>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
  step = "1",
  disabled = false,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel label={label} help={help} />
      <input
        className={inputClass}
        type="number"
        min={0}
        step={step}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(toNumber(e.target.value))}
      />
    </div>
  );
}
