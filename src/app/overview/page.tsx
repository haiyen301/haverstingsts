"use client";

import { useEffect, useMemo, useState } from "react";
import { AlignLeft, ArrowDown } from "lucide-react";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { fetchMondayProjectRowsFromServer, type MondayProjectServerRow } from "@/entities/projects";
import { parseSubitems } from "@/shared/lib/parseJsonMaybe";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";

type OverviewType = "grass" | "farm" | "project" | "country";

type OverviewLine = {
  project: string;
  projectSub: string;
  country: string;
  grass: string;
  farm: string;
  farmText: string;
  quantity: number;
  remaining: number;
  unit: string;
};

function toRecArray(rows: unknown[]): Record<string, unknown>[] {
  return rows.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "Kg";
  if (s === "m2" || s === "m²" || s === "sqm") return "M2";
  if (s === "kg" || s === "kgs") return "Kg";
  return String(v ?? "").trim();
}

function fmtQty(v: number): string {
  return v.toLocaleString("en-US");
}

function parseQtyByUom(item: Record<string, unknown>, reqUom: string): number {
  const uom = reqUom.toLowerCase();
  if (uom === "kg") {
    return item.total_kg != null ? parseNum(item.total_kg) : parseNum(item.quantity);
  }
  if (uom === "m2") {
    return item.total_m2 != null ? parseNum(item.total_m2) : parseNum(item.quantity);
  }
  return parseNum(item.quantity);
}

function firstFarmNameFromText(farmText: string, fallback: string): string {
  const s = String(farmText ?? "").trim();
  if (!s || s === "-") return fallback;
  const first = s.split(",")[0]?.trim() ?? "";
  const idx = first.indexOf(" (");
  if (idx > 0) return first.slice(0, idx).trim();
  return first || fallback;
}

export default function OverviewPage() {
  const tBase = useAppTranslations();
  const t = (key: string) => tBase(`Overview.${key}`);
  const tCommon = (key: string) => tBase(`Common.${key}`);
  const [currentType, setCurrentType] = useState<OverviewType>("grass");
  const [rows, setRows] = useState<MondayProjectServerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const farmsRef = useHarvestingDataStore((s) => s.farms);
  const projectsRef = useHarvestingDataStore((s) => s.projects);
  const countriesRef = useHarvestingDataStore((s) => s.countries);
  const productsRef = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        setLoading(true);
        const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 400 });
        if (!mounted) return;
        setRows(res.rows);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const projectTitleMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of toRecArray(projectsRef)) {
      const id = String(r.id ?? "").trim();
      const title = String(r.title ?? r.name ?? "").trim();
      if (id && title) m.set(id, title);
    }
    return m;
  }, [projectsRef]);

  const countryMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of toRecArray(countriesRef)) {
      const id = String(r.id ?? "").trim();
      const name = String(r.country_name ?? r.name ?? r.title ?? "").trim();
      if (id && name) m.set(id, name.toUpperCase());
    }
    return m;
  }, [countriesRef]);

  const farmMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of toRecArray(farmsRef)) {
      const id = String(r.id ?? "").trim();
      const name = String(r.name ?? r.title ?? "").trim();
      if (id && name) m.set(id, name);
    }
    return m;
  }, [farmsRef]);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of toRecArray(productsRef)) {
      const id = String(r.id ?? "").trim();
      const name = String(r.name ?? r.title ?? "").trim();
      if (id && name) m.set(id, name);
    }
    return m;
  }, [productsRef]);

  const lines = useMemo(() => {
    const fallbackUnknown = t("unknown");
    const fallbackNA = t("notAvailable");
    const out: OverviewLine[] = [];
    for (const row of rows) {
      const projectId = String(row.project_id ?? "").trim();
      const project =
        String(row.title ?? row.name ?? "").trim() ||
        projectTitleMap.get(projectId) ||
        fallbackUnknown;
      const projectSub = String(row.alias_title ?? "").trim();
      const countryId = String(row.country_id ?? "").trim();
      const country =
        countryMap.get(countryId) ||
        String(row.country ?? "").trim().toUpperCase() ||
        fallbackNA;

      const requirements = parseSubitems(row.quantity_required_sprig_sod);
      const subitems = parseSubitems(row.subitems);

      for (const req of requirements) {
        const productId = String(req.product_id ?? "").trim();
        if (!productId) continue;
        const reqUom = normalizeUnit(req.uom);
        const grass = productMap.get(productId) || productId;

        const quantity = parseNum(req.quantity);
        const matchingItems = subitems
          .filter((x) => String(x.product_id ?? "").trim() === productId)
          .filter((x) => {
            const u = normalizeUnit(x.uom);
            return !reqUom || u === reqUom;
          });
        const delivered = matchingItems.reduce(
          (sum, x) => sum + parseNum(x.quantity_harvested ?? x.quantity),
          0,
        );

        const farmQuantities = new Map<string, number>();
        for (const item of matchingItems) {
          const farmName =
            String(item.farm_name ?? "").trim() ||
            farmMap.get(String(item.farm_id ?? "").trim()) ||
            String(item.farm_id ?? "").trim();
          if (!farmName) continue;
          const q = parseQtyByUom(item, reqUom || "kg");
          if (q <= 0) continue;
          farmQuantities.set(farmName, (farmQuantities.get(farmName) ?? 0) + q);
        }
        const farmText =
          farmQuantities.size > 0
            ? [...farmQuantities.entries()]
                .map(([name, q]) => `${name} (${fmtQty(q)} ${reqUom || "Kg"})`)
                .join(", ")
            : "-";
        const farmId = String(req.farm_id ?? req.farm ?? "").trim();
        const farmFromReq = farmMap.get(farmId) || (farmId || fallbackNA);
        const farm = farmQuantities.size > 0 ? firstFarmNameFromText(farmText, fallbackNA) : farmFromReq;

        out.push({
          project,
          projectSub,
          country,
          grass,
          farm,
          farmText,
          quantity,
          remaining: Math.max(0, quantity - delivered),
          unit: reqUom || "Kg",
        });
      }
    }
    return out;
  }, [rows, projectTitleMap, countryMap, farmMap, productMap, t]);

  const grouped = useMemo(() => {
    const map = new Map<string, OverviewLine[]>();
    const getKey = (x: OverviewLine) => {
      if (currentType === "grass") return x.grass;
      if (currentType === "farm") {
        if (x.farm && x.farm !== "N/A") return x.farm;
        return firstFarmNameFromText(x.farmText, t("notAvailable"));
      }
      if (currentType === "project") return x.project;
      return x.country;
    };
    for (const x of lines) {
      const key = getKey(x);
      const list = map.get(key) ?? [];
      list.push(x);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines, currentType]);

  const renderHeader = () => {
    if (currentType === "grass") {
      return [tCommon("project"), tCommon("country"), tCommon("quantity"), t("remaining"), tCommon("farm")];
    }
    if (currentType === "farm") {
      return [tCommon("project"), tCommon("grass"), tCommon("quantity"), t("remaining")];
    }
    if (currentType === "project") {
      return [tCommon("grass"), tCommon("country"), tCommon("quantity"), t("remaining"), tCommon("farm")];
    }
    return [tCommon("project"), tCommon("grass"), tCommon("quantity"), t("remaining")];
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
          </div>

          <div className="mb-4 flex flex-wrap gap-3">
            {[
              { label: t("grassType"), value: "grass" as const },
              { label: t("farm"), value: "farm" as const },
              { label: t("project"), value: "project" as const },
              { label: t("country"), value: "country" as const },
            ].map((x) => {
              const active = currentType === x.value;
              return (
                <button
                  key={x.value}
                  type="button"
                  onClick={() => setCurrentType(x.value)}
                  className={`inline-flex items-center justify-between gap-3 rounded-full border px-4 py-2 text-sm font-semibold ${
                    active
                      ? "border-[#4B8B31] bg-[var(--primary-color)] text-white"
                      : "border-[#D9D9D9] bg-white text-[var(--primary-color)]"
                  }`}
                >
                  <span>{x.label}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <AlignLeft className="h-3.5 w-3.5" />
                    <ArrowDown className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">{t("loading")}</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          ) : (
            <div className="mt-10 space-y-5">
              {grouped.map(([group, items]) => (
                <section key={group} className="rounded-sm border border-[var(--primary-color)] bg-white mt-10">
                  <div className="relative left-[-1px] top-[-20px] inline-flex rounded-r-full border border-[#6A963F] bg-white px-2 py-1 text-[1.125] text-[var(--primary-color)]">
                    {group}
                  </div>
                  <div className="p-4">
                    {currentType === "country" ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-separate border-spacing-0">
                          <thead>
                            <tr className="text-sm font-semibold text-[var(--primary-color)]">
                              <th className="border-b border-gray-200 pb-2 pr-4 text-left">{tCommon("project")}</th>
                              <th className="border-b border-gray-200 pb-2 pr-4 text-left">{tCommon("grass")}</th>
                              <th className="border-b border-gray-200 pb-2 pr-4 text-right">{tCommon("quantity")}</th>
                              <th className="border-b border-gray-200 pb-2 pr-4 text-right">{t("remaining")}</th>
                              <th className="border-b border-gray-200 pb-2 text-right">{tCommon("farm")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(
                              items.reduce<Record<string, OverviewLine[]>>((acc, item) => {
                                const key = `${item.project}__${item.projectSub}`;
                                if (!acc[key]) acc[key] = [];
                                acc[key].push(item);
                                return acc;
                              }, {}),
                            ).map(([projectKey, rowsInProject]) => {
                              const [projectName, projectSub = ""] = projectKey.split("__");
                              return rowsInProject.map((x, idx) => (
                                <tr key={`${projectKey}-${idx}`} className="text-sm">
                                  {idx === 0 ? (
                                    <td
                                      rowSpan={rowsInProject.length}
                                      className="border-b border-gray-100 py-3 pr-4 align-top"
                                    >
                                      <div className="text-gray-900">{projectName}</div>
                                      {projectSub ? <div className="text-xs text-gray-500">{projectSub}</div> : null}
                                    </td>
                                  ) : null}
                                  <td className="border-b border-gray-100 py-3 pr-4 text-gray-700">
                                    {x.grass}
                                  </td>
                                  <td className="border-b border-gray-100 py-3 pr-4 text-right text-gray-800">
                                    {fmtQty(x.quantity)} {x.unit}
                                  </td>
                                  <td className={`border-b border-gray-100 py-3 pr-4 text-right ${x.remaining > 0 ? "text-[#BA4E4E]" : "text-gray-900"}`}>
                                    {fmtQty(x.remaining)} {x.unit}
                                  </td>
                                  <td className="border-b border-gray-100 py-3 text-right text-gray-700">
                                    {x.farmText}
                                  </td>
                                </tr>
                              ));
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <>
                        {currentType === "grass" || currentType === "farm" ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-separate border-spacing-0">
                              <thead>
                                <tr className="text-sm font-semibold text-[var(--primary-color)]">
                                  <th className="border-b border-gray-200 pb-2 pr-4 text-left">{tCommon("project")}</th>
                                  {currentType === "grass" ? (
                                    <th className="border-b border-gray-200 pb-2 pr-4 text-left">{tCommon("country")}</th>
                                  ) : null}
                                  <th className="border-b border-gray-200 pb-2 pr-4 text-left">{tCommon("grass")}</th>
                                  <th className="border-b border-gray-200 pb-2 pr-4 text-right">{tCommon("quantity")}</th>
                                  <th className="border-b border-gray-200 pb-2 pr-4 text-right">{t("remaining")}</th>
                                  {currentType === "grass" ? (
                                    <th className="border-b border-gray-200 pb-2 text-right">{tCommon("farm")}</th>
                                  ) : null}
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(
                                  items.reduce<Record<string, OverviewLine[]>>((acc, item) => {
                                    const key = `${item.project}__${item.projectSub}`;
                                    if (!acc[key]) acc[key] = [];
                                    acc[key].push(item);
                                    return acc;
                                  }, {}),
                                ).map(([projectKey, rowsInProject]) => {
                                  const [projectName, projectSub = ""] = projectKey.split("__");
                                  return rowsInProject.map((x, idx) => (
                                    <tr key={`${projectKey}-${idx}`} className="text-sm">
                                      {idx === 0 ? (
                                        <td
                                          rowSpan={rowsInProject.length}
                                          className="border-b border-gray-100 py-3 pr-4 align-top"
                                        >
                                          <div className="text-gray-900">{projectName}</div>
                                          {projectSub ? <div className="text-xs text-gray-500">{projectSub}</div> : null}
                                        </td>
                                      ) : null}
                                      {currentType === "grass" ? (
                                        <td className="border-b border-gray-100 py-3 pr-4 text-gray-700">
                                          {x.country}
                                        </td>
                                      ) : null}
                                      <td className="border-b border-gray-100 py-3 pr-4 text-gray-700">
                                        {x.grass}
                                      </td>
                                      <td className="border-b border-gray-100 py-3 pr-4 text-right text-gray-800">
                                        {fmtQty(x.quantity)} {x.unit}
                                      </td>
                                      <td className={`border-b border-gray-100 py-3 pr-4 text-right ${x.remaining > 0 ? "text-[#BA4E4E]" : "text-gray-900"}`}>
                                        {fmtQty(x.remaining)} {x.unit}
                                      </td>
                                      {currentType === "grass" ? (
                                        <td className="border-b border-gray-100 py-3 text-right text-gray-700">
                                          {x.farmText}
                                        </td>
                                      ) : null}
                                    </tr>
                                  ));
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <>
                            <div className={`grid gap-4 border-b border-gray-200 pb-2 text-sm font-semibold text-[var(--primary-color)] ${
                              currentType === "project" ? "grid-cols-5" : "grid-cols-4"
                            }`}>
                              {renderHeader().map((h) => (
                                <div key={h}>{h}</div>
                              ))}
                            </div>

                            <div className="divide-y divide-gray-100">
                              {items.map((x, idx) => (
                                <div
                                  key={`${group}-${idx}`}
                                  className={`grid gap-4 py-3 text-sm ${
                                    currentType === "project" ? "grid-cols-5" : "grid-cols-4"
                                  }`}
                                >
                                  <div>
                                    <div className="text-gray-900">{x.project}</div>
                                    {x.projectSub ? <div className="text-xs text-gray-500">{x.projectSub}</div> : null}
                                  </div>
                                  <div className="text-gray-700">{x.grass}</div>
                                  <div className="text-gray-800">{fmtQty(x.quantity)} {x.unit}</div>
                                  <div className={`${x.remaining > 0 ? "text-[#BA4E4E]" : "text-gray-900"}`}>
                                    {fmtQty(x.remaining)} {x.unit}
                                  </div>
                                  {currentType === "project" ? <div className="text-gray-700">{x.farmText}</div> : null}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

