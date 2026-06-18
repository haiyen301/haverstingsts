/**
 * Debug: read aggregate snapshot from STSPortal API (parity /forecast_audit).
 * Run: STS_API_TOKEN=... npx tsx scripts/forecast-parity-debug.ts
 */
import { AGGREGATE_ZONE_KEY } from "../src/features/forecasting/forecastSnapshotApi";
import { kpiDateRangeFromFilter } from "../src/shared/lib/dashboardKpiProjectFilters";

const TOKEN = process.env.STS_API_TOKEN ?? process.env.STS_JWT ?? "";
const BASE = (process.env.STS_API_BASE ?? "http://192.168.1.149/api").replace(/\/$/, "");
const TARGET = process.env.FORECAST_PARITY_DATE ?? "2026-06-17";
const EXPECTED_AVAILABLE = Number(process.env.FORECAST_PARITY_EXPECTED ?? "3748980");

async function getJson(path: string, params?: Record<string, string>) {
  if (!TOKEN) {
    throw new Error("Set STS_API_TOKEN (JWT from stsrenew login) before running parity debug.");
  }
  const url = new URL(`${BASE}/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: TOKEN, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const range = kpiDateRangeFromFilter({ preset: "next3Months" });

  const [metaJson, snapJson] = await Promise.all([
    getJson("forecast/meta", { anchor_date: TARGET }),
    getJson("forecast/snapshots", {
      date_from: range.start,
      date_to: range.end,
      zone_key: AGGREGATE_ZONE_KEY,
      limit: "100000",
    }),
  ]);

  const rows = Array.isArray(snapJson.data)
    ? (snapJson.data as Record<string, unknown>[])
    : Array.isArray(snapJson)
      ? (snapJson as Record<string, unknown>[])
      : [];

  const day = rows.find(
    (r) => String(r.snapshot_date ?? "").slice(0, 10) === TARGET,
  );

  const available = day ? Math.round(Number(day.available_kg) || 0) : null;

  console.log(
    JSON.stringify(
      {
        source: "inventory_daily_snapshots",
        zone_key: AGGREGATE_ZONE_KEY,
        target: TARGET,
        horizon: range,
        is_stale: Boolean(metaJson.is_stale),
        snapshot_count: metaJson.snapshot_count ?? null,
        available,
        expectedAvailable: EXPECTED_AVAILABLE,
        match: available === EXPECTED_AVAILABLE,
        breakdown: day
          ? {
              prev: Math.round(Number(day.previous_available_kg) || 0),
              regrowth: Math.round(Number(day.regrowth_kg) || 0),
              harvest: Math.round(Number(day.harvest_kg) || 0),
              raw: Math.round(Number(day.raw_available_kg) || 0),
              cap: Math.round(Number(day.capacity_cap_kg) || 0),
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
