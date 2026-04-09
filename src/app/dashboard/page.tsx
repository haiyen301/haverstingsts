"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  ComposedChart,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { Globe, TrendingUp, Package, Scale, MapPin, Eye, EyeOff } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { FarmCountryFlag } from "./FarmCountryFlag";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import {
  compareNumbers,
  compareStrings,
} from "@/shared/lib/tableSort";

type DashProjectSortKey =
  | "customerName"
  | "harvestTypeLabel"
  | "activeProjects"
  | "activeHarvests"
  | "contractAmount"
  | "amountDelivered"
  | "amountOutstanding"
  | "grassTypeLabel";

const seedCountryData = [
  {
    country: "USA",
    flag: "🇺🇸",
    projects: 12,
    activeHarvests: 24,
    delivered: 125000,
    revenue: 2500000,
    growth: 15,
  },
  {
    country: "UK",
    flag: "🇬🇧",
    projects: 8,
    activeHarvests: 16,
    delivered: 85000,
    revenue: 1700000,
    growth: 12,
  },
  {
    country: "Scotland",
    flag: "🏴",
    projects: 5,
    activeHarvests: 10,
    delivered: 52000,
    revenue: 1040000,
    growth: 8,
  },
  {
    country: "Australia",
    flag: "🇦🇺",
    projects: 6,
    activeHarvests: 12,
    delivered: 64000,
    revenue: 1280000,
    growth: 18,
  },
  {
    country: "Japan",
    flag: "🇯🇵",
    projects: 4,
    activeHarvests: 8,
    delivered: 38000,
    revenue: 760000,
    growth: 10,
  },
  {
    country: "South Korea",
    flag: "🇰🇷",
    projects: 3,
    activeHarvests: 6,
    delivered: 28000,
    revenue: 560000,
    growth: 20,
  },
];

const COLORS = ["#1F7A4C", "#2E9B5F", "#3EBC72", "#4FDD85", "#60EE98", "#71FFAB"];

function countryCodeToFlag(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🏳️";
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397,
  );
}

/** Month bucket YYYY-MM from `sts_project_harvesting_plan.delivery_harvest_date` only (subitems). */
function monthKeyFromSubitem(item: Record<string, unknown>): string | null {
  const raw = item.delivery_harvest_date;
  const s = String(raw ?? "").trim();
  if (!s || s === "0000-00-00" || s === "null") return null;
  const datePart = s.includes(" ") ? s.split(" ")[0] : s;
  const d = new Date(datePart);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function hasDeliveryHarvestDate(item: Record<string, unknown>): boolean {
  return monthKeyFromSubitem(item) !== null;
}

export default function DashboardPage() {
  const t = useAppTranslations();
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [deliveredByMonthMode, setDeliveredByMonthMode] = useState<"sprig" | "sod">("sprig");
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [showAnalyticsPanels, setShowAnalyticsPanels] = useState(true);
  const { sortKey, sortDir, onSort } =
    useTableColumnSort<DashProjectSortKey>("customerName");
  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const res = await fetchMondayProjectRowsFromServer({
        module: "project",
        page: 1,
        perPage: 5000,
      });
      if (!mounted) return;
      setRows(res.rows);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const countryData = useMemo(() => {
    const countriesById = new Map<
      string,
      { id: string; country_code: string; country_name: string }
    >();
    for (const row of countriesRef) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      countriesById.set(id, {
        id,
        country_code: String(r.country_code ?? "").trim().toUpperCase(),
        country_name: String(r.country_name ?? r.name ?? "").trim(),
      });
    }

    const seen = new Set<string>();
    const out: Array<{
      countryId: string;
      country: string;
      countryCode: string;
      flag: string;
      projects: number;
      activeHarvests: number;
      delivered: number;
      revenue: number;
      growth: number;
    }> = [];

    for (const row of farmsRef) {
      if (!row || typeof row !== "object") continue;
      const farm = row as Record<string, unknown>;
      if (String(farm.deleted ?? "0") === "1") continue;
      const countryId = String(farm.country_id ?? "").trim();
      if (!countryId || seen.has(countryId)) continue;
      seen.add(countryId);
      const country = countriesById.get(countryId);
      if (!country) continue;
      const seed = seedCountryData[out.length % seedCountryData.length];
      out.push({
        countryId,
        country: country.country_name || seed.country,
        countryCode: country.country_code,
        flag: countryCodeToFlag(country.country_code),
        projects: seed.projects,
        activeHarvests: seed.activeHarvests,
        delivered: seed.delivered,
        revenue: seed.revenue,
        growth: seed.growth,
      });
    }

    return out.length ? out : seedCountryData.map((x) => ({ ...x, countryId: x.country, countryCode: "" }));
  }, [farmsRef, countriesRef]);

  const farmFilters = useMemo(() => {
    const countriesById = new Map<string, { countryName: string; countryCode: string }>();
    for (const row of countriesRef) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      countriesById.set(id, {
        countryName: String(r.country_name ?? r.name ?? "").trim(),
        countryCode: String(r.country_code ?? "").trim().toUpperCase(),
      });
    }

    const out: Array<{
      farmId: string;
      farmName: string;
      countryId: string;
      countryName: string;
      countryCode: string;
      flag: string;
    }> = [];

    for (const row of farmsRef) {
      if (!row || typeof row !== "object") continue;
      const farm = row as Record<string, unknown>;
      if (String(farm.deleted ?? "0") === "1") continue;
      const farmId = String(farm.id ?? "").trim();
      const farmName = String(farm.name ?? "").trim();
      const countryId = String(farm.country_id ?? "").trim();
      if (!farmId || !farmName || !countryId) continue;
      const c = countriesById.get(countryId);
      const countryCode = (c?.countryCode ?? "").trim();
      out.push({
        farmId,
        farmName,
        countryId,
        countryName: c?.countryName ?? "",
        countryCode,
        flag: countryCodeToFlag(countryCode),
      });
    }
    const countryPriority = (countryName: string): number => {
      const key = countryName.trim().toLowerCase();
      if (key === "vietnam") return 0;
      if (key === "thailand") return 1;
      return 2;
    };
    return out.sort((a, b) => {
      const aCountry = a.countryName || a.countryId;
      const bCountry = b.countryName || b.countryId;
      const pDiff = countryPriority(aCountry) - countryPriority(bCountry);
      if (pDiff !== 0) return pDiff;

      const countryCmp = aCountry.localeCompare(bCountry, undefined, { sensitivity: "base" });
      if (countryCmp !== 0) return countryCmp;
      return a.farmName.localeCompare(b.farmName, undefined, { sensitivity: "base" });
    });
  }, [farmsRef, countriesRef]);

  const totalProjects = countryData.reduce((sum, c) => sum + c.projects, 0);
  const totalDelivered = countryData.reduce((sum, c) => sum + c.delivered, 0);
  const totalRevenue = countryData.reduce((sum, c) => sum + c.revenue, 0);

  const totalFarms = useMemo(() => {
    return farmsRef.filter((x) => {
      if (!x || typeof x !== "object") return false;
      const r = x as Record<string, unknown>;
      return String(r.deleted ?? "0") !== "1";
    }).length;
  }, [farmsRef]);

  const normalizeStatus = (v: unknown): string => {
    const s = String(v ?? "").toLowerCase().trim();
    if (!s) return "";
    if (s.includes("done") || s.includes("complete")) return "Done";
    if (s.includes("future")) return "Future";
    if (s.includes("warning")) return "Warning";
    if (s.includes("ongoing")) return "Ongoing";
    return "";
  };

  const isDeleted = (row: MondayProjectServerRow): boolean =>
    String((row as Record<string, unknown>).deleted ?? "0").trim() === "1";

  const allProjectCount = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      const id = String((row as Record<string, unknown>).project_id ?? row.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows]);

  const totalCurrentProjects = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      const status = normalizeStatus((row as Record<string, unknown>).status_app ?? row.status);
      if (!(status === "Ongoing" || status === "Future" || status === "Warning")) continue;
      const id = String((row as Record<string, unknown>).project_id ?? row.id ?? "").trim();
      if (id) ids.add(id);
    }
    return ids.size;
  }, [rows]);

  const deliveredTotals = useMemo(() => {
    let sprigKg = 0;
    let sodM2 = 0;
    for (const row of rows) {
      if (isDeleted(row)) continue;
      for (const item of parseSubitems((row as Record<string, unknown>).subitems)) {
        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty)) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (uom === "kg") sprigKg += qty;
        if (uom === "m2" || uom === "m²" || uom === "sqm") sodM2 += qty;
      }
    }
    return { sprigKg, sodM2 };
  }, [rows]);

  const countryProjectsChartData = useMemo(() => {
    const counts = new Map<string, { country: string; projects: number }>();

    for (const row of rows) {
      if (isDeleted(row)) continue;
      const rec = row as Record<string, unknown>;
      const countryId = String(rec.country_id ?? "").trim();
      if (!countryId) continue;
      if (selectedCountry && countryId !== selectedCountry) continue;

      const projectId = String(rec.project_id ?? rec.id ?? "").trim();
      if (!projectId) continue;

      const key = `${countryId}`;
      const existing = counts.get(key) ?? {
        country: "",
        projects: 0,
      };

      // Set country name once from countriesRef
      if (!existing.country) {
        let name = "";
        for (const c of countriesRef) {
          if (!c || typeof c !== "object") continue;
          const cr = c as Record<string, unknown>;
          if (String(cr.id ?? "").trim() === countryId) {
            name = String(cr.country_name ?? cr.name ?? "").trim();
            break;
          }
        }
        existing.country = name || countryId;
      }

      // Use a Set per country to ensure unique project ids
      const setKey = `${key}::${projectId}`;
      if (!(counts as unknown as { _seen?: Set<string> })._seen) {
        (counts as unknown as { _seen: Set<string> })._seen = new Set<string>();
      }
      const seen = (counts as unknown as { _seen: Set<string> })._seen;
      if (!seen.has(setKey)) {
        seen.add(setKey);
        existing.projects += 1;
      }

      counts.set(key, existing);
    }

    return Array.from(counts.values()).sort((a, b) => a.country.localeCompare(b.country));
  }, [rows, countriesRef, selectedCountry]);

  const grassDistributionByUnit = useMemo(() => {
    const productNameById = new Map<string, string>();
    for (const row of productsRef) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (String(rec.deleted ?? "0").trim() === "1") continue;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      productNameById.set(id, String(rec.title ?? rec.name ?? "").trim() || id);
    }

    const qtyByProductKg = new Map<string, number>();
    const qtyByProductM2 = new Map<string, number>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      const subitems = parseSubitems((row as Record<string, unknown>).subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (selectedFarmId && farmId !== selectedFarmId) continue;

        const productId = String(item.product_id ?? "").trim();
        if (!productId) continue;

        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (uom === "kg") {
          qtyByProductKg.set(productId, (qtyByProductKg.get(productId) ?? 0) + qty);
        } else if (uom === "m2" || uom === "m²" || uom === "sqm") {
          qtyByProductM2.set(productId, (qtyByProductM2.get(productId) ?? 0) + qty);
        }
      }
    }

    const toSeries = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([productId, value]) => ({
          productId,
          grass: productNameById.get(productId) ?? productId,
          value,
        }))
        .sort((a, b) => b.value - a.value);

    return {
      kg: toSeries(qtyByProductKg),
      m2: toSeries(qtyByProductM2),
    };
  }, [productsRef, rows, selectedFarmId]);

  const grassDistributionData = useMemo(() => {
    return deliveredByMonthMode === "sprig" ? grassDistributionByUnit.kg : grassDistributionByUnit.m2;
  }, [grassDistributionByUnit, deliveredByMonthMode]);

  const grassPieUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  const deliveredByMonthChartData = useMemo(() => {
    const now = new Date();
    const monthSlots: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthSlots.push({ key, label });
    }

    const totals = new Map<string, number>();
    for (const { key } of monthSlots) {
      totals.set(key, 0);
    }

    const wantSprig = deliveredByMonthMode === "sprig";

    for (const row of rows) {
      if (isDeleted(row)) continue;
      const subitems = parseSubitems((row as Record<string, unknown>).subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (selectedFarmId && farmId !== selectedFarmId) continue;

        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (wantSprig) {
          if (uom !== "kg") continue;
        } else if (!(uom === "m2" || uom === "m²" || uom === "sqm")) {
          continue;
        }

        const monthKey = monthKeyFromSubitem(item as Record<string, unknown>);
        if (!monthKey || !totals.has(monthKey)) continue;

        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty) || qty <= 0) continue;

        totals.set(monthKey, (totals.get(monthKey) ?? 0) + qty);
      }
    }

    return monthSlots.map(({ key, label }) => ({
      month: label,
      total: totals.get(key) ?? 0,
    }));
  }, [rows, selectedFarmId, deliveredByMonthMode]);

  const deliveredByMonthUnitLabel = deliveredByMonthMode === "sprig" ? "kg" : "m2";

  /** Per-farm horizontal bars: Y = farm, X = quantity for the current calendar month only. */
  const deliveredByFarmComposed = useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (selectedFarmId) {
      farms = farms.filter((f) => f.farmId === selectedFarmId);
    }
    farms = farms.slice(0, 16);

    const farmIds = new Set(farms.map((f) => f.farmId));
    const perFarmTotal = new Map<string, number>();
    for (const f of farms) {
      perFarmTotal.set(f.farmId, 0);
    }

    for (const row of rows) {
      if (isDeleted(row)) continue;
      const rec = row as Record<string, unknown>;
      const rowCountry = String(rec.country_id ?? "").trim();
      if (selectedCountry && rowCountry !== selectedCountry) continue;

      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (!farmIds.has(farmId)) continue;

        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (wantSprig) {
          if (uom !== "kg") continue;
        } else if (!(uom === "m2" || uom === "m²" || uom === "sqm")) {
          continue;
        }

        const monthKey = monthKeyFromSubitem(item as Record<string, unknown>);
        if (!monthKey || monthKey !== currentMonthKey) continue;

        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty) || qty <= 0) continue;

        perFarmTotal.set(farmId, (perFarmTotal.get(farmId) ?? 0) + qty);
      }
    }

    const chartRows = farms.map((f) => ({
      farm: f.farmName,
      total: perFarmTotal.get(f.farmId) ?? 0,
    }));

    return { chartRows, currentMonthLabel };
  }, [rows, farmFilters, selectedCountry, selectedFarmId, deliveredByMonthMode]);

  /** Rolling 6 months: one line per farm (up to 6), same sprig/sod + country/farm filters as the farm chart above. */
  const deliveredSixMonthFarmTrend = useMemo(() => {
    const now = new Date();
    const monthSlots: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthSlots.push({ key, label });
    }

    const wantSprig = deliveredByMonthMode === "sprig";

    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    if (selectedFarmId) {
      farms = farms.filter((f) => f.farmId === selectedFarmId);
    }
    farms = farms.slice(0, 6);

    const farmKey = (id: string) => `k_${String(id).replace(/\W/g, "_")}`;

    const farmIds = new Set(farms.map((f) => f.farmId));
    const perFarmMonth = new Map<string, Map<string, number>>();
    for (const f of farms) {
      perFarmMonth.set(f.farmId, new Map(monthSlots.map((m) => [m.key, 0])));
    }

    for (const row of rows) {
      if (isDeleted(row)) continue;
      const rec = row as Record<string, unknown>;
      const rowCountry = String(rec.country_id ?? "").trim();
      if (selectedCountry && rowCountry !== selectedCountry) continue;

      const subitems = parseSubitems(rec.subitems);
      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const fid = String(item.farm_id ?? "").trim();
        if (!farmIds.has(fid)) continue;

        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (wantSprig) {
          if (uom !== "kg") continue;
        } else if (!(uom === "m2" || uom === "m²" || uom === "sqm")) {
          continue;
        }

        const monthKey = monthKeyFromSubitem(item as Record<string, unknown>);
        if (!monthKey) continue;
        const inner = perFarmMonth.get(fid);
        if (!inner || !inner.has(monthKey)) continue;

        const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
        const qty = Number(String(qtyRaw).replace(/,/g, "").trim());
        if (!Number.isFinite(qty) || qty <= 0) continue;

        inner.set(monthKey, (inner.get(monthKey) ?? 0) + qty);
      }
    }

    const data = monthSlots.map(({ key, label }) => {
      const row: Record<string, string | number> = { month: label };
      for (const f of farms) {
        row[farmKey(f.farmId)] = perFarmMonth.get(f.farmId)?.get(key) ?? 0;
      }
      return row;
    });

    const series = farms.map((f) => ({
      dataKey: farmKey(f.farmId),
      name: f.farmName,
    }));

    return { data, series };
  }, [rows, farmFilters, selectedCountry, selectedFarmId, deliveredByMonthMode]);

  /**
   * All-farm view: one row per (project × product_id). Quantities are split per grass; names from Zustand `products`.
   * Same project can appear on multiple rows (e.g. TifEagle Bermuda vs Zeon Zoysia). Sorted by grass, then customer.
   */
  const allFarmProjectDetailRows = useMemo(() => {
    if (selectedFarmId) return [];
    const wantSprig = deliveredByMonthMode === "sprig";
    let farms = farmFilters;
    if (selectedCountry) {
      farms = farms.filter((f) => f.countryId === selectedCountry);
    }
    const farmIdSet = new Set(farms.map((x) => x.farmId));
    if (farmIdSet.size === 0) return [];

    const productNameById = new Map<string, string>();
    for (const pr of productsRef) {
      if (!pr || typeof pr !== "object") continue;
      const rec = pr as Record<string, unknown>;
      if (String(rec.deleted ?? "0").trim() === "1") continue;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      productNameById.set(id, String(rec.title ?? rec.name ?? "").trim() || id);
    }

    const harvestTypeLabel = wantSprig ? t("Dashboard.sprigKg") : t("Dashboard.sodM2");
    const byProjectId = new Map<string, MondayProjectServerRow[]>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      const rec = row as Record<string, unknown>;
      if (selectedCountry && String(rec.country_id ?? "").trim() !== selectedCountry) continue;
      const projectId = String(rec.project_id ?? rec.id ?? "").trim();
      if (!projectId) continue;
      const list = byProjectId.get(projectId);
      if (list) list.push(row);
      else byProjectId.set(projectId, [row]);
    }

    type PerProduct = { requested: number; delivered: number; activeHarvests: number };
    const NONE_KEY = "__no_product__";

    const out: Array<{
      projectId: string;
      productId: string;
      grassTypeLabel: string;
      customerName: string;
      harvestTypeLabel: string;
      activeProjects: number;
      activeHarvests: number;
      contractAmount: number;
      amountDelivered: number;
      amountOutstanding: number;
    }> = [];

    for (const [projectId, projectRows] of byProjectId) {
      const rec = projectRows[0] as Record<string, unknown>;
      const subitems = projectRows.flatMap((r) => parseSubitems((r as Record<string, unknown>).subitems));

      const byProduct = new Map<string, PerProduct>();
      const touch = (key: string): PerProduct => {
        let p = byProduct.get(key);
        if (!p) {
          p = { requested: 0, delivered: 0, activeHarvests: 0 };
          byProduct.set(key, p);
        }
        return p;
      };

      let contractAmount = 0;
      let amountDelivered = 0;
      let hasLine = false;

      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (!farmIdSet.has(farmId)) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (wantSprig) {
          if (uom !== "kg") continue;
        } else if (!(uom === "m2" || uom === "m²" || uom === "sqm")) {
          continue;
        }
        hasLine = true;

        const rawPid = String(item.product_id ?? "").trim();
        const pKey = rawPid || NONE_KEY;
        const per = touch(pKey);

        const reqQty = Number(String(item.quantity ?? 0).replace(/,/g, "").trim());
        if (Number.isFinite(reqQty) && reqQty > 0) {
          contractAmount += reqQty;
          per.requested += reqQty;
        }

        const itemRec = item as Record<string, unknown>;
        if (!hasDeliveryHarvestDate(itemRec)) {
          per.activeHarvests += 1;
        } else {
          const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
          const q = Number(String(qtyRaw).replace(/,/g, "").trim());
          if (Number.isFinite(q) && q > 0) {
            amountDelivered += q;
            per.delivered += q;
          }
        }
      }

      if (!hasLine) continue;

      const customerName = String(rec.title ?? rec.name ?? rec.alias_title ?? projectId).trim() || projectId;
      const st = normalizeStatus(rec.status_app ?? rec.status);
      const isDone = st === "Done";
      const activeProjects = !isDone && contractAmount > amountDelivered + 0.0001 ? 1 : 0;

      const productKeys = Array.from(byProduct.keys()).filter((k) => {
        const b = byProduct.get(k)!;
        return b.requested > 0 || b.activeHarvests > 0 || b.delivered > 0;
      });
      if (productKeys.length === 0) continue;

      productKeys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      for (const pKey of productKeys) {
        const b = byProduct.get(pKey)!;
        const productId = pKey === NONE_KEY ? "" : pKey;
        const grassTypeLabel =
          pKey === NONE_KEY ? t("Dashboard.noProduct") : productNameById.get(pKey) ?? pKey;
        const contractAmount = b.requested;
        const amountDelivered = b.delivered;
        const amountOutstanding = Math.max(0, contractAmount - amountDelivered);
        out.push({
          projectId,
          productId,
          grassTypeLabel,
          customerName,
          harvestTypeLabel,
          activeProjects,
          activeHarvests: b.activeHarvests,
          contractAmount,
          amountDelivered,
          amountOutstanding,
        });
      }
    }

    out.sort((a, b) => {
      const g = a.grassTypeLabel.localeCompare(b.grassTypeLabel, undefined, { sensitivity: "base" });
      if (g !== 0) return g;
      const c = a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" });
      if (c !== 0) return c;
      return a.productId.localeCompare(b.productId, undefined, { sensitivity: "base" });
    });

    return out;
  }, [rows, farmFilters, productsRef, selectedCountry, selectedFarmId, deliveredByMonthMode, t]);

  const sortedAllFarmProjectDetailRows = useMemo(() => {
    const list = [...allFarmProjectDetailRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case "grassTypeLabel":
          return compareStrings(a.grassTypeLabel, b.grassTypeLabel, sortDir);
        case "customerName":
          return compareStrings(a.customerName, b.customerName, sortDir);
        case "harvestTypeLabel":
          return compareStrings(a.harvestTypeLabel, b.harvestTypeLabel, sortDir);
        case "activeProjects":
          return compareNumbers(a.activeProjects, b.activeProjects, sortDir);
        case "activeHarvests":
          return compareNumbers(a.activeHarvests, b.activeHarvests, sortDir);
        case "contractAmount":
          return compareNumbers(a.contractAmount, b.contractAmount, sortDir);
        case "amountDelivered":
          return compareNumbers(a.amountDelivered, b.amountDelivered, sortDir);
        case "amountOutstanding":
          return compareNumbers(a.amountOutstanding, b.amountOutstanding, sortDir);
        default:
          return 0;
      }
    });
    return list;
  }, [allFarmProjectDetailRows, sortKey, sortDir]);

  /** Same rows with `grassRowSpan` for the first column (0 = skip grass `<td>`). */
  const allFarmProjectTableRows = useMemo(() => {
    const list = sortedAllFarmProjectDetailRows;
    const out: Array<
      (typeof list)[number] & {
        grassRowSpan: number;
      }
    > = [];
    let i = 0;
    while (i < list.length) {
      const label = list[i].grassTypeLabel;
      let j = i + 1;
      while (j < list.length && list[j].grassTypeLabel === label) j++;
      const span = j - i;
      for (let k = i; k < j; k++) {
        out.push({
          ...list[k],
          grassRowSpan: k === i ? span : 0,
        });
      }
      i = j;
    }
    return out;
  }, [sortedAllFarmProjectDetailRows]);

  /** One row per project for the selected farm (Sprig/Sod filter applies to numeric columns). */
  const singleFarmProjectDetailRows = useMemo(() => {
    if (!selectedFarmId) return [];
    const wantSprig = deliveredByMonthMode === "sprig";
    const harvestTypeLabel = wantSprig ? t("Dashboard.sprigKg") : t("Dashboard.sodM2");
    const out: Array<{
      projectId: string;
      customerName: string;
      harvestTypeLabel: string;
      activeProjects: number;
      activeHarvests: number;
      contractAmount: number;
      amountDelivered: number;
      amountOutstanding: number;
    }> = [];

    for (const row of rows) {
      if (isDeleted(row)) continue;
      const rec = row as Record<string, unknown>;
      const rowCountry = String(rec.country_id ?? "").trim();
      if (selectedCountry && rowCountry !== selectedCountry) continue;
      const projectId = String(rec.project_id ?? rec.id ?? "").trim();
      if (!projectId) continue;

      let contractAmount = 0;
      let amountDelivered = 0;
      let activeHarvests = 0;
      let hasLine = false;
      const subitems = parseSubitems(rec.subitems);

      for (const item of subitems) {
        if (String(item.deleted ?? "0").trim() === "1") continue;
        const farmId = String(item.farm_id ?? "").trim();
        if (farmId !== selectedFarmId) continue;
        const uom = String(item.uom ?? "").trim().toLowerCase();
        if (wantSprig) {
          if (uom !== "kg") continue;
        } else if (!(uom === "m2" || uom === "m²" || uom === "sqm")) {
          continue;
        }
        hasLine = true;

        const reqQty = Number(String(item.quantity ?? 0).replace(/,/g, "").trim());
        if (Number.isFinite(reqQty) && reqQty > 0) contractAmount += reqQty;

        const itemRec = item as Record<string, unknown>;
        if (!hasDeliveryHarvestDate(itemRec)) {
          activeHarvests += 1;
        } else {
          const qtyRaw = item.quantity_harvested ?? item.quantity ?? 0;
          const q = Number(String(qtyRaw).replace(/,/g, "").trim());
          if (Number.isFinite(q) && q > 0) amountDelivered += q;
        }
      }

      if (!hasLine) continue;

      const customerName = String(rec.title ?? rec.name ?? rec.alias_title ?? projectId).trim() || projectId;
      const st = normalizeStatus(rec.status_app ?? rec.status);
      const isDone = st === "Done";
      const amountOutstanding = Math.max(0, contractAmount - amountDelivered);
      const activeProjects = !isDone && contractAmount > amountDelivered + 0.0001 ? 1 : 0;

      out.push({
        projectId,
        customerName,
        harvestTypeLabel,
        activeProjects,
        activeHarvests,
        contractAmount,
        amountDelivered,
        amountOutstanding,
      });
    }

    return out;
  }, [rows, selectedFarmId, selectedCountry, deliveredByMonthMode, t]);

  const sortedSingleFarmProjectDetailRows = useMemo(() => {
    const list = [...singleFarmProjectDetailRows];
    const key =
      sortKey === "grassTypeLabel" ? "customerName" : sortKey;
    list.sort((a, b) => {
      switch (key) {
        case "customerName":
          return compareStrings(a.customerName, b.customerName, sortDir);
        case "harvestTypeLabel":
          return compareStrings(a.harvestTypeLabel, b.harvestTypeLabel, sortDir);
        case "activeProjects":
          return compareNumbers(a.activeProjects, b.activeProjects, sortDir);
        case "activeHarvests":
          return compareNumbers(a.activeHarvests, b.activeHarvests, sortDir);
        case "contractAmount":
          return compareNumbers(a.contractAmount, b.contractAmount, sortDir);
        case "amountDelivered":
          return compareNumbers(a.amountDelivered, b.amountDelivered, sortDir);
        case "amountOutstanding":
          return compareNumbers(a.amountOutstanding, b.amountOutstanding, sortDir);
        default:
          return 0;
      }
    });
    return list;
  }, [singleFarmProjectDetailRows, sortKey, sortDir]);

  const selectedFarmName = selectedFarmId
    ? farmFilters.find((f) => f.farmId === selectedFarmId)?.farmName ?? ""
    : "";

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="min-h-screen bg-gray-50">
          <div className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="w-8 h-8 text-[#1F7A4C]" />
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900">{t("Dashboard.title")}</h1>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t("Dashboard.totalFarms")}</span>
                  <MapPin className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-2xl font-semibold text-gray-900">{totalFarms}</div>
                {/* <p className="text-xs text-green-600 mt-1">Active operations</p> */}
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t("Dashboard.totalCurrentProjects")}</span>
                  <Package className="w-5 h-5 text-purple-600" />
                </div>
                <div className="text-2xl font-semibold text-gray-900">{totalCurrentProjects}</div>
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t("Dashboard.allProjects")}</span>
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div className="text-2xl font-semibold text-gray-900">{allProjectCount}</div>
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t("Dashboard.totalSprigDelivered")}</span>
                  <Scale className="w-5 h-5 text-yellow-600" />
                </div>
                <div className="text-2xl font-semibold text-gray-900">{deliveredTotals.sprigKg.toLocaleString()} kg</div>
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">{t("Dashboard.totalSodDelivered")}</span>
                  <Package className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-2xl font-semibold text-gray-900">{deliveredTotals.sodM2.toLocaleString()} m2</div>
              </div>
            </div>

            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setSelectedCountry(null);
                    setSelectedFarmId(null);
                  }}
                  className={`px-4 py-2 rounded-lg border transition-colors ${selectedCountry === null
                    ? " text-[var(--primary-color)] border-[var(--primary-color)]"
                    : "bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]"
                    }`}
                  type="button"
                >
                  {t("Dashboard.allCountries")}
                </button>
                {farmFilters.map((f) => (
                  <button
                    key={f.farmId}
                    onClick={() => {
                      setSelectedFarmId(f.farmId);
                      setSelectedCountry(f.countryId);
                    }}
                    className={`px-4 py-2 rounded-lg border transition-colors flex items-center gap-2 ${selectedFarmId === f.farmId
                      ? " text-[var(--primary-color)] border-[var(--primary-color)]"
                      : "bg-white text-gray-700 border-gray-300 hover:border-[#1F7A4C]"
                      }`}
                    type="button"
                  >
                    <FarmCountryFlag
                      countryCode={f.countryCode}
                      flagEmoji={f.flag}
                      active={selectedFarmId === f.farmId}
                    />
                    {f.farmName}
                  </button>
                ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowAnalyticsPanels((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-[#1F7A4C] hover:text-[#1F7A4C]"
                  aria-pressed={!showAnalyticsPanels}
                >
                  {showAnalyticsPanels ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showAnalyticsPanels ? "Hide charts" : "Show charts"}
                </button>
              </div>
            </div>

            {showAnalyticsPanels ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("Dashboard.projectsByCountry")}</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={countryProjectsChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="country" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar dataKey="projects" fill="#1F7A4C" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{t("Dashboard.grassTypeDistribution")}</h2>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sprig")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sprig" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sprigKgToggle")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sod")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sod" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sodM2Toggle")}
                    </button>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={grassDistributionData}
                      dataKey="value"
                      nameKey="grass"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={(entry: unknown) =>
                        `${String((entry as { grass?: string }).grass ?? "")} ${String(
                          ((entry as { percent?: number }).percent ?? 0) * 100,
                        ).slice(0, 2)}%`
                      }
                      labelLine={false}
                    >
                      {grassDistributionData.map((entry, index) => (
                        <Cell key={entry.productId} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => `${value.toLocaleString()} ${grassPieUnitLabel}`}
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {deliveredByMonthMode === "sprig"
                        ? t("Dashboard.deliveredByFarmSprig")
                        : t("Dashboard.deliveredByFarmSod")}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      {t("Dashboard.farmAxisHintPrefix")}{" "}
                      <span className="font-medium text-gray-600">
                        {deliveredByFarmComposed.currentMonthLabel}
                      </span>{" "}
                      {t("Dashboard.currentMonthOnly")}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sprig")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sprig" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sprigKg")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sod")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sod" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sodM2")}
                    </button>
                  </div>
                </div>
                {deliveredByFarmComposed.chartRows.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8">
                    {t("Dashboard.noFarmsForFilters")}
                  </p>
                ) : (
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(320, deliveredByFarmComposed.chartRows.length * 40)}
                  >
                    <ComposedChart
                      layout="vertical"
                      data={deliveredByFarmComposed.chartRows}
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v: number) => v.toLocaleString()}
                        label={{
                          value: `${t("Common.quantity")} (${deliveredByMonthUnitLabel})`,
                          position: "insideBottom",
                          offset: -4,
                          style: { fontSize: 11, fill: "#6b7280" },
                        }}
                      />
                      <YAxis
                        type="category"
                        dataKey="farm"
                        width={120}
                        tick={{ fontSize: 11 }}
                        interval={0}
                      />
                      <Tooltip
                        formatter={(value: number) => [
                          `${value.toLocaleString()} ${deliveredByMonthUnitLabel}`,
                          deliveredByFarmComposed.currentMonthLabel,
                        ]}
                        contentStyle={{
                          backgroundColor: "white",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar
                        dataKey="total"
                        name={deliveredByFarmComposed.currentMonthLabel}
                        fill={deliveredByMonthMode === "sprig" ? "#1F7A4C" : "#2E9B5F"}
                        radius={[0, 8, 8, 0]}
                        barSize={18}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{t("Dashboard.sixMonthDeliveryTrends")}</h2>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sprig")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sprig" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sprigKg")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveredByMonthMode("sod")}
                      className={`px-3 py-1 text-xs ${deliveredByMonthMode === "sod" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                    >
                      {t("Dashboard.sodM2")}
                    </button>
                  </div>
                </div>
                {/* <p className="text-xs text-gray-500 mb-3">
                  {t("Dashboard.rollingSixMonthsHint")}
                </p> */}
                {deliveredSixMonthFarmTrend.series.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8">
                    {t("Dashboard.noTrendsForFilters")}
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={deliveredSixMonthFarmTrend.data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip
                        formatter={(value: number) => `${value.toLocaleString()} ${deliveredByMonthUnitLabel}`}
                        contentStyle={{
                          backgroundColor: "white",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                        formatter={(value) => <span className="text-gray-700">{value}</span>}
                      />
                      {deliveredSixMonthFarmTrend.series.map((s, i) => {
                        const stroke = COLORS[i % COLORS.length];
                        return (
                          <Line
                            key={s.dataKey}
                            type="monotone"
                            dataKey={s.dataKey}
                            name={s.name}
                            stroke={stroke}
                            strokeWidth={2}
                            dot={{ r: 4, fill: "#fff", stroke, strokeWidth: 2 }}
                            activeDot={{ r: 5, stroke, strokeWidth: 2, fill: "#fff" }}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              </div>
            ) : (
              <div className="mb-6 rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
                Charts are hidden. Click "Show charts" to display dashboard analytics panels.
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setDeliveredByMonthMode("sprig")}
                    className={`px-3 py-1.5 text-xs ${deliveredByMonthMode === "sprig" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                  >
                    {t("Dashboard.sprigKg")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveredByMonthMode("sod")}
                    className={`px-3 py-1.5 text-xs ${deliveredByMonthMode === "sod" ? "bg-[#1F7A4C] text-white" : "bg-white text-gray-700"}`}
                  >
                    {t("Dashboard.sodM2")}
                  </button>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {selectedFarmId ? t("Projects.projectDetails") : t("Projects.projectDetailsAllFarms")}
                    {selectedFarmId && selectedFarmName ? (
                      <span className="ml-2 font-normal text-gray-600">— {selectedFarmName}</span>
                    ) : null}
                  </h2>
                </div>
              </div>
              <div className="hidden md:block overflow-x-auto">
                {selectedFarmId ? (
                  <table className="w-full min-w-[56rem]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <SortableTh
                          label={t("Dashboard.customerName")}
                          columnKey="customerName"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.harvestType")}
                          columnKey="harvestTypeLabel"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.activeProjects")}
                          columnKey="activeProjects"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.activeHarvests")}
                          columnKey="activeHarvests"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.contractAmount")} (${deliveredByMonthUnitLabel})`}
                          columnKey="contractAmount"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.amountDelivered")} (${deliveredByMonthUnitLabel})`}
                          columnKey="amountDelivered"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.amountOutstanding")} (${deliveredByMonthUnitLabel})`}
                          columnKey="amountOutstanding"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedSingleFarmProjectDetailRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                            {t("Dashboard.noProjectsForFarm")}
                          </td>
                        </tr>
                      ) : null}
                      {sortedSingleFarmProjectDetailRows.map((row) => (
                        <tr key={row.projectId} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[14rem] truncate" title={row.customerName}>
                            {row.customerName}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.harvestTypeLabel}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.activeProjects}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.activeHarvests}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.contractAmount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.amountDelivered.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.amountOutstanding.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full min-w-[56rem]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <SortableTh
                          label={t("Overview.grassType")}
                          columnKey="grassTypeLabel"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.harvestType")}
                          columnKey="harvestTypeLabel"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.activeProjects")}
                          columnKey="activeProjects"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={t("Dashboard.activeHarvests")}
                          columnKey="activeHarvests"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.contractAmount")} (${deliveredByMonthUnitLabel})`}
                          columnKey="contractAmount"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.amountDelivered")} (${deliveredByMonthUnitLabel})`}
                          columnKey="amountDelivered"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                        <SortableTh
                          label={`${t("Dashboard.amountOutstanding")} (${deliveredByMonthUnitLabel})`}
                          columnKey="amountOutstanding"
                          activeKey={sortKey}
                          direction={sortDir}
                          onSort={onSort}
                          className="px-4 py-3 text-xs text-gray-600"
                        />
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedAllFarmProjectDetailRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                            {t("Dashboard.noProjectsForFilters")}
                          </td>
                        </tr>
                      ) : null}
                      {allFarmProjectTableRows.map((row) => (
                        <tr key={`${row.projectId}-${row.productId || "none"}`} className="hover:bg-gray-50">
                          {row.grassRowSpan > 0 ? (
                            <td
                              rowSpan={row.grassRowSpan}
                              className="px-4 py-3 align-top text-sm font-medium text-gray-900 border-r border-gray-100 "
                            >
                              {row.grassTypeLabel}
                            </td>
                          ) : null}
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{row.harvestTypeLabel}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.activeProjects}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.activeHarvests}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.contractAmount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.amountDelivered.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{row.amountOutstanding.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="md:hidden divide-y divide-gray-200">
                {selectedFarmId ? (
                  <>
                    {sortedSingleFarmProjectDetailRows.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">
                        {t("Dashboard.noProjectsForFarm")}
                      </div>
                    ) : null}
                    {sortedSingleFarmProjectDetailRows.map((row) => (
                      <div key={row.projectId} className="p-4">
                        <h3 className="font-medium text-gray-900 mb-4">{row.customerName}</h3>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-600">{t("Dashboard.harvestType")}</span>
                            <div className="font-medium text-gray-900">{row.harvestTypeLabel}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">{t("Dashboard.activeProjects")}</span>
                            <div className="font-medium text-gray-900">{row.activeProjects}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">{t("Dashboard.activeHarvests")}</span>
                            <div className="font-medium text-gray-900">{row.activeHarvests}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">{t("Dashboard.contractAmount")} ({deliveredByMonthUnitLabel})</span>
                            <div className="font-medium text-gray-900">{row.contractAmount.toLocaleString()}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">{t("Dashboard.amountDelivered")} ({deliveredByMonthUnitLabel})</span>
                            <div className="font-medium text-gray-900">{row.amountDelivered.toLocaleString()}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">{t("Dashboard.amountOutstanding")} ({deliveredByMonthUnitLabel})</span>
                            <div className="font-medium text-gray-900">{row.amountOutstanding.toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {sortedAllFarmProjectDetailRows.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">
                        {t("Dashboard.noProjectsForFilters")}
                      </div>
                    ) : null}
                    {(() => {
                      const groups: Array<{ grass: string; rows: typeof sortedAllFarmProjectDetailRows }> = [];
                      for (const r of sortedAllFarmProjectDetailRows) {
                        const last = groups[groups.length - 1];
                        if (last && last.grass === r.grassTypeLabel) last.rows.push(r);
                        else groups.push({ grass: r.grassTypeLabel, rows: [r] });
                      }
                      return groups.map((g, gi) => (
                        <div key={`${g.grass}-${gi}`} className="border-b border-gray-200 last:border-b-0">
                          <div className="px-4 py-2 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
                            {g.grass}
                          </div>
                          {g.rows.map((row) => (
                            <div
                              key={`${row.projectId}-${row.productId || "none"}`}
                              className="p-4 border-t border-gray-100 bg-white"
                            >
                              <h3 className="font-medium text-gray-900 mb-3 truncate" title={row.customerName}>
                                {row.customerName}
                              </h3>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.harvestType")}</span>
                                  <div className="font-medium text-gray-900">{row.harvestTypeLabel}</div>
                                </div>
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.activeProjects")}</span>
                                  <div className="font-medium text-gray-900">{row.activeProjects}</div>
                                </div>
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.activeHarvests")}</span>
                                  <div className="font-medium text-gray-900">{row.activeHarvests}</div>
                                </div>
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.contractAmount")} ({deliveredByMonthUnitLabel})</span>
                                  <div className="font-medium text-gray-900">{row.contractAmount.toLocaleString()}</div>
                                </div>
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.amountDelivered")} ({deliveredByMonthUnitLabel})</span>
                                  <div className="font-medium text-gray-900">{row.amountDelivered.toLocaleString()}</div>
                                </div>
                                <div>
                                  <span className="text-gray-600">{t("Dashboard.amountOutstanding")} ({deliveredByMonthUnitLabel})</span>
                                  <div className="font-medium text-gray-900">{row.amountOutstanding.toLocaleString()}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
