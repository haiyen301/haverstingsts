"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
} from "react";
import { GripVertical, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import RequireAuth from "@/features/auth/RequireAuth";
import {
  fetchRegrowthRules,
  saveRegrowthRules,
  type RegrowthRuleRow,
  type RegrowthRulesSavePayload,
} from "@/features/admin/api/adminApi";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SprigBandRow = {
  id: string;
  maxKgPerM2: number;
  regrowthDays: number;
  label: string;
};

type RegrowthFormState = {
  sodDays: number;
  sodForSprigDays: number;
  overrideRecoveryDays: number;
  sprigBands: SprigBandRow[];
};

const DEFAULT_REGROWTH: RegrowthFormState = {
  sodDays: 120,
  sodForSprigDays: 120,
  overrideRecoveryDays: 120,
  sprigBands: [
    { id: "b1", maxKgPerM2: 1, regrowthDays: 30, label: "≤ 1.0 kg/m²" },
    { id: "b2", maxKgPerM2: 1.5, regrowthDays: 45, label: "1.0 – 1.5 kg/m²" },
    { id: "b3", maxKgPerM2: 2.5, regrowthDays: 60, label: "1.5 – 2.5 kg/m²" },
    { id: "b4", maxKgPerM2: 3.5, regrowthDays: 75, label: "2.5 – 3.5 kg/m²" },
    { id: "b5", maxKgPerM2: Number.POSITIVE_INFINITY, regrowthDays: 90, label: "> 3.5 kg/m²" },
  ],
};

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

function rowsToFormState(rows: RegrowthRuleRow[]): RegrowthFormState {
  const sod = rows.find((r) => r.harvest_type === "SOD");
  const sodSprig = rows.find((r) => r.harvest_type === "SOD_FOR_SPRIG");
  const overrideRow = rows.find((r) => r.harvest_type === "OVERRIDE_RECOVERY");
  const sprig = rows
    .filter((r) => r.harvest_type === "SPRIG")
    .sort((a, b) => a.sort_order - b.sort_order || Number(a.id) - Number(b.id));

  const sprigBands: SprigBandRow[] =
    sprig.length > 0
      ? sprig.map((r) => ({
          id: String(r.id),
          label: r.label,
          regrowthDays: Number(r.regrowth_days),
          maxKgPerM2: parseMaxKgPerM2(r.max_kg_per_m2),
        }))
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
      label: b.label,
      max_kg_per_m2:
        b.maxKgPerM2 === Number.POSITIVE_INFINITY ? null : b.maxKgPerM2,
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
      if (v === "∞" || v.toLowerCase() === "infinity") {
        return { ...b, maxKgPerM2: Number.POSITIVE_INFINITY };
      }
      if (v === "") return { ...b, maxKgPerM2: Number.POSITIVE_INFINITY };
      const normalized = v.replace(",", ".");
      if (
        normalized === "." ||
        normalized === "," ||
        /^\d+[.,]$/.test(v)
      ) {
        return b;
      }
      const n = Number(normalized);
      if (!Number.isNaN(n) && n >= 0) return { ...b, maxKgPerM2: n };
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
      <td colSpan={5} className="h-1 border-0 p-0">
        <div className="bg-primary mx-4 h-1 rounded-full shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" />
      </td>
    </tr>
  );
}

export default function AdminRegrowthPage() {
  const [config, setConfig] = useState<RegrowthFormState>(DEFAULT_REGROWTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newBand, setNewBand] = useState({
    label: "",
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
        setError(e instanceof Error ? e.message : "Failed to load regrowth rules.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

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
      text: "Defaults restored — regrowth rules reset to the original methodology.",
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
          text: "No changes detected — nothing to save.",
        });
        return;
      }
      const rows = await saveRegrowthRules(payload);
      setMaxKgDraftById({});
      const nextConfig = rowsToFormState(rows);
      setConfig(nextConfig);
      setSavedFingerprint(payloadFingerprint(formStateToSavePayload(nextConfig)));
      setNotice({
        variant: "ok",
        text: "Saved — regrowth rules are stored on the server.",
      });
    } catch (e) {
      setNotice({
        variant: "err",
        text:
          e instanceof Error ? e.message : "Could not save regrowth rules.",
      });
    } finally {
      setSaving(false);
    }
  }, [config, maxKgDraftById, savedFingerprint]);

  const handleAddBand = () => {
    const maxRaw = newBand.maxKgPerM2.trim();
    const normalizedMaxRaw = maxRaw.replace(",", ".");
    const max =
      maxRaw === "" ||
      maxRaw === "∞" ||
      maxRaw.toLowerCase() === "infinity"
        ? Number.POSITIVE_INFINITY
        : Number(normalizedMaxRaw);
    const days = Number(newBand.regrowthDays);
    const maxIsInfinity = max === Number.POSITIVE_INFINITY;
    const maxIsValidNumber = Number.isFinite(max) && max >= 0;
    if (
      !newBand.label.trim() ||
      (!maxIsInfinity && !maxIsValidNumber) ||
      !Number.isFinite(days) ||
      days <= 0
    ) {
      setNotice({
        variant: "err",
        text: "Provide a label, max kg/m² >= 0 (or blank/∞), and positive days.",
      });
      return;
    }
    const labelAdded = newBand.label;
    addBand({
      label: labelAdded,
      maxKgPerM2: max,
      regrowthDays: days,
    });
    setNewBand({ label: "", maxKgPerM2: "", regrowthDays: "" });
    setNotice({
      variant: "ok",
      text: `Band added — ${labelAdded}: ${days} days.`,
    });
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="space-y-6 p-4 text-foreground lg:p-8">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
            Regrowth Rules
          </h1>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading regrowth rules…
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
                  These rules drive every regrowth calculation in Inventory and
                  Forecasting. Sod harvests use a single recovery period; sprig
                  harvests use density-based bands.
                </p>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    className={btnOutline}
                    onClick={resetToDefaults}
                    disabled={saving}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset to Defaults
                  </button>
                  <button
                    type="button"
                    className={cn(btnSm, "h-9 px-4 text-sm")}
                    onClick={() => void handleSaveChanges()}
                    disabled={saving}
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Sod Regrowth
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.sodDays}
                        onChange={(e) =>
                          updateSodDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        days
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Applied to all SOD harvests.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Sod for Sprig Regrowth
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.sodForSprigDays}
                        onChange={(e) =>
                          updateSodForSprigDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        days
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Used when SOD is harvested to produce sprig material.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Manual Override Recovery
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        className={cn(inputClass, "w-24")}
                        value={config.overrideRecoveryDays}
                        onChange={(e) =>
                          updateOverrideRecoveryDays(
                            Math.max(1, Number(e.target.value) || 0),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        days
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Forecast refill period after a manual inventory adjustment.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sprig Density Bands</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each band specifies the regrowth period for sprig harvests up
                    to a given density (kg/m²). Bands are matched in ascending
                    order — use ∞ for the final open-ended band. Drag the grip
                    icon on the left to reorder rows. Leave max blank to default
                    as ∞, and value 0 is allowed.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="border-b border-border [&_tr]:border-b">
                        <tr className="border-b border-border transition-colors">
                          <th
                            className="h-10 w-10 px-2 text-center align-middle font-medium text-muted-foreground"
                            title="Drag rows by the grip icon"
                          >
                            <span className="sr-only">Reorder</span>
                            <GripVertical
                              className="mx-auto h-4 w-4 opacity-50"
                              aria-hidden
                            />
                          </th>
                          <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
                            Label
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            Max kg/m²
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            Regrowth (days)
                          </th>
                          <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">
                            Actions
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
                                  draggable
                                  role="button"
                                  tabIndex={0}
                                  aria-label="Drag to reorder row"
                                  title="Drag to reorder"
                                  onDragStart={(e) =>
                                    handleBandDragStart(e, band.id)
                                  }
                                  onDragEnd={handleBandDragEnd}
                                  className="inline-flex cursor-grab touch-manipulation rounded-md p-1.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
                                >
                                  <GripVertical className="h-4 w-4 shrink-0" />
                                </div>
                              </td>
                              <td className="p-2 align-middle px-4">
                                <input
                                  className={cn(inputClass, "h-8")}
                                  value={band.label}
                                  onChange={(e) =>
                                    updateBand(band.id, {
                                      label: e.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td className="p-2 px-4 text-right align-middle">
                                <div className="ml-auto inline-flex items-center gap-1">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className={cn(
                                      inputClass,
                                      "h-8 w-28 text-right",
                                    )}
                                    value={
                                      maxKgDraftById[band.id] !== undefined
                                        ? maxKgDraftById[band.id]
                                        : band.maxKgPerM2 ===
                                            Number.POSITIVE_INFINITY
                                          ? "∞"
                                          : String(band.maxKgPerM2)
                                    }
                                    onFocus={() => {
                                      setMaxKgDraftById((d) => ({
                                        ...d,
                                        [band.id]:
                                          band.maxKgPerM2 ===
                                          Number.POSITIVE_INFINITY
                                            ? "∞"
                                            : String(band.maxKgPerM2),
                                      }));
                                    }}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      setMaxKgDraftById((d) => ({
                                        ...d,
                                        [band.id]: raw,
                                      }));
                                      const v = raw.trim();
                                      if (
                                        v === "∞" ||
                                        v.toLowerCase() === "infinity"
                                      ) {
                                        updateBand(band.id, {
                                          maxKgPerM2: Number.POSITIVE_INFINITY,
                                        });
                                        return;
                                      }
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
                                          maxKgPerM2: n,
                                        });
                                      }
                                    }}
                                    onBlur={(e) => {
                                      const v = e.target.value.trim();
                                      if (
                                        v === "" ||
                                        v === "∞" ||
                                        v.toLowerCase() === "infinity"
                                      ) {
                                        setMaxKgDraftById((d) => ({
                                          ...d,
                                          [band.id]: v === "" ? "" : "∞",
                                        }));
                                        updateBand(band.id, {
                                          maxKgPerM2: Number.POSITIVE_INFINITY,
                                        });
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
                                        maxKgPerM2: n,
                                      });
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className={cn(btnOutline, "h-8 px-2 text-xs")}
                                    onClick={() => {
                                      setMaxKgDraftById((d) => ({
                                        ...d,
                                        [band.id]: "∞",
                                      }));
                                      updateBand(band.id, {
                                        maxKgPerM2: Number.POSITIVE_INFINITY,
                                      });
                                    }}
                                    title="Set to infinity"
                                  >
                                    ∞
                                  </button>
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
                                <button
                                  type="button"
                                  className={btnGhost}
                                  onClick={() => deleteBand(band.id)}
                                  disabled={config.sprigBands.length <= 1}
                                  title="Remove band"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          </Fragment>
                          ))}
                        {dragBandId != null &&
                        bandDropInsertPreview === config.sprigBands.length ? (
                          <BandDropInsertionLine />
                        ) : null}
                        <tr
                          className="border-b border-border bg-muted/30"
                          onDragOver={handleBandDragOverAfterLast}
                          onDrop={handleBandDrop}
                        >
                          <td className="p-2 px-2 align-middle" aria-hidden />
                          <td className="p-2 align-middle px-4">
                            <input
                              placeholder="e.g. 4–5 kg/m²"
                              className={cn(inputClass, "h-8")}
                              value={newBand.label}
                              onChange={(e) =>
                                setNewBand((b) => ({
                                  ...b,
                                  label: e.target.value,
                                }))
                              }
                            />
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <div className="ml-auto inline-flex items-center gap-1">
                              <input
                                placeholder="blank, 0, 5 or ∞"
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
                              <button
                                type="button"
                                className={cn(btnOutline, "h-8 px-2 text-xs")}
                                onClick={() =>
                                  setNewBand((b) => ({ ...b, maxKgPerM2: "∞" }))
                                }
                                title="Set to infinity"
                              >
                                ∞
                              </button>
                            </div>
                          </td>
                          <td className="p-2 px-4 text-right align-middle">
                            <input
                              type="number"
                              placeholder="days"
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
                              Add
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                Edits stay on this page until you choose{" "}
                <span className="font-medium text-foreground">Save changes</span>
                . After saving, updated rules apply to inventory projections,
                forecast charts, and harvest regrowth progress.
              </p>
            </>
          ) : null}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
