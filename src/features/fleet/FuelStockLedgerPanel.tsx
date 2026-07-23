"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Package, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchFleetStockLedger,
  recalculateFleetStockLedger,
  removeFleetStockLedger,
  saveFleetStockLedger,
  type FleetStockLedgerRow,
  type FleetStockModule,
} from "@/features/fleet/api/fleetStockLedgerApi";
import {
  fetchFleetFuelImports,
  removeFleetFuelImport,
  saveFleetFuelImport,
  type FleetFuelImportRow,
} from "@/features/fleet/api/fleetFuelImportsApi";
import { FuelStockImportDialog } from "@/features/fleet/ui/FuelStockImportDialog";
import { FLEET_OPTION_CATALOG_KEYS } from "@/features/fleet/api/fleetOptionCatalogApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
import { resolveFleetOptionLabel } from "@/features/fleet/lib/resolveFleetOptionLabel";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateDisplay } from "@/shared/lib/format/date";
import {
  formatDecimalInput,
  formatDecimalInputFromValue,
  formatNumber,
  stripDecimalGrouping,
} from "@/shared/lib/format/number";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import {
  CALENDAR_FUEL_BALANCE_DAY_CLASS,
  DatePicker,
} from "@/shared/ui/date-picker";
import { MultiSelect } from "@/shared/ui/multi-select";
import { filterStockKeyOptionsForFarmCountry } from "@/features/fertilizer/lib/filterFertilizerProductsForFarm";

const FUEL_KINDS_FALLBACK = ["diesel", "petrol", "engine_oil_grease"] as const;
const OPENING_LIST_PAGE_SIZE = 8;

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnPrimaryIcon =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary pl-3 pr-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";
const btnDangerOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-destructive/40 bg-background px-4 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50";
const btnHeaderSm =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";
const btnIconSm =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-sm transition-colors hover:bg-muted/80 disabled:pointer-events-none disabled:opacity-50";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;

export type FuelStockFarmOption = {
  id: string;
  label: string;
};

export type StockLedgerStockKeyOption = {
  value: string;
  label: string;
  subLabel?: string;
};

type StockLedgerVariant = "fuel" | "fertilizer";

type OpeningConfig = FleetStockLedgerRow & {
  latestRemaining: number | null;
};

type PanelView = "balance" | "configuredOpenings";

export type FuelStockBalanceResumeState = {
  farmId: string;
  kind: string;
  date: string;
  openingAnchorDate: string;
  view: "balance" | "configuredOpenings";
};

export type StockLedgerPanelProps = {
  variant: StockLedgerVariant;
  farmOptions: FuelStockFarmOption[];
  stockKeyOptions: StockLedgerStockKeyOption[];
  quantityUnitSuffix?: string;
  calendarMarkedDateClassName?: string;
  initialFarmId?: string | null;
  /** Restore panel selection after closing for Excel import. */
  resumeState?: FuelStockBalanceResumeState | null;
  balanceFrom?: string;
  reloadToken?: number;
  embedded?: boolean;
  onClose?: () => void;
  onDataChanged?: () => void;
  /** Close balance popup and open Excel import; parent should reopen with resumeState. */
  onRequestStockImport?: (resume: FuelStockBalanceResumeState) => void;
  /** When set (fertilizer), product keys are filtered by the selected farm's country. */
  farmCountryById?: Map<string, number>;
  productCountryByStockKey?: Map<string, number | null>;
};

type FuelStockLedgerPanelProps = Omit<
  StockLedgerPanelProps,
  "variant" | "stockKeyOptions" | "quantityUnitSuffix" | "calendarMarkedDateClassName"
>;

function num(v: unknown): number {
  const n = Number(stripDecimalGrouping(String(v ?? "")));
  return Number.isFinite(n) ? n : 0;
}

function parseQty(raw: string): number {
  const n = Number(stripDecimalGrouping(raw.trim()));
  return Number.isFinite(n) ? n : NaN;
}

function kindLabel(
  kind: string,
  options: Array<{ value: string; label: string }>,
  t: (key: string) => string,
  variant: StockLedgerVariant,
): string {
  const fromCatalog = options.find((row) => row.value === kind)?.label;
  if (fromCatalog) return fromCatalog;
  if (variant === "fuel") {
    if (kind === "diesel") return t("stock.diesel");
    if (kind === "petrol") return t("stock.petrol");
  }
  return kind;
}

function formatQtyDisplay(qty: number, unitSuffix: string): string {
  const formatted = formatNumber(qty, { maximumFractionDigits: 3 });
  return unitSuffix ? `${formatted}${unitSuffix}` : formatted;
}

function rowDateYmd(row: FleetStockLedgerRow): string {
  return String(row.balance_date).slice(0, 10);
}

function ymdFromDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function rowHasBalanceMarker(row: FleetStockLedgerRow): boolean {
  if (Number(row.is_opening_anchor) === 1 || row.is_opening_anchor === true) {
    return true;
  }
  return num(row.import_qty) > 0;
}

function isOpeningAnchorRow(row: FleetStockLedgerRow): boolean {
  return Number(row.is_opening_anchor) === 1 || row.is_opening_anchor === true;
}

function dayBeforeYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return ymdFromDate(d);
}

function configKey(
  farmId: number | string,
  stockKey: string,
  openingDate?: string,
): string {
  if (openingDate) return `${farmId}:${stockKey}:${openingDate}`;
  return `${farmId}:${stockKey}`;
}

function buildOpeningConfigs(allRows: FleetStockLedgerRow[]): OpeningConfig[] {
  const anchors = allRows.filter(isOpeningAnchorRow);
  const anchorsByFarmStock = new Map<string, FleetStockLedgerRow[]>();

  for (const anchor of anchors) {
    const groupKey = configKey(anchor.farm_id, String(anchor.stock_key));
    const list = anchorsByFarmStock.get(groupKey) ?? [];
    list.push(anchor);
    anchorsByFarmStock.set(groupKey, list);
  }
  for (const list of anchorsByFarmStock.values()) {
    list.sort((a, b) => rowDateYmd(a).localeCompare(rowDateYmd(b)));
  }

  return anchors
    .map((anchor) => {
      const farmId = Number(anchor.farm_id);
      const stockKey = String(anchor.stock_key);
      const anchorDate = rowDateYmd(anchor);
      const siblings = anchorsByFarmStock.get(configKey(farmId, stockKey)) ?? [];
      const nextAnchor = siblings.find((a) => rowDateYmd(a) > anchorDate);
      const segmentEnd = nextAnchor ? dayBeforeYmd(rowDateYmd(nextAnchor)) : null;

      const segmentRows = allRows
        .filter(
          (r) =>
            Number(r.farm_id) === farmId &&
            String(r.stock_key) === stockKey &&
            rowDateYmd(r) >= anchorDate &&
            (!segmentEnd || rowDateYmd(r) <= segmentEnd),
        )
        .sort((a, b) => rowDateYmd(a).localeCompare(rowDateYmd(b)));

      const latest = segmentRows[segmentRows.length - 1];
      return {
        ...anchor,
        latestRemaining: latest ? num(latest.remaining_qty) : null,
      };
    })
    .sort((a, b) => {
      const dateCmp = rowDateYmd(b).localeCompare(rowDateYmd(a));
      if (dateCmp !== 0) return dateCmp;
      const farmCmp = String(a.farm_name ?? a.farm_id).localeCompare(
        String(b.farm_name ?? b.farm_id),
      );
      if (farmCmp !== 0) return farmCmp;
      return String(a.stock_key).localeCompare(String(b.stock_key));
    });
}

function farmLabelForConfig(
  config: OpeningConfig,
  farmOptions: FuelStockFarmOption[],
): string {
  if (config.farm_name) return config.farm_name;
  return (
    farmOptions.find((f) => f.id === String(config.farm_id))?.label ??
    String(config.farm_id)
  );
}

function pickPreferredOpeningConfig(
  openingConfigs: OpeningConfig[],
  initialFarmId?: string | null,
): OpeningConfig | null {
  if (openingConfigs.length === 0) return null;
  return (
    (initialFarmId
      ? openingConfigs.find((c) => String(c.farm_id) === initialFarmId)
      : null) ?? openingConfigs[0]
  );
}

export function StockLedgerPanel({
  variant,
  farmOptions,
  stockKeyOptions,
  quantityUnitSuffix = "",
  calendarMarkedDateClassName,
  initialFarmId = null,
  resumeState = null,
  balanceFrom,
  reloadToken = 0,
  embedded = false,
  onClose,
  onDataChanged,
  onRequestStockImport,
  farmCountryById,
  productCountryByStockKey,
}: StockLedgerPanelProps) {
  const t = useTranslations(variant === "fuel" ? "FuelUsage" : "FertilizerUsage");
  const ledgerModule: FleetStockModule = variant;
  const stockKeyLabel = variant === "fuel" ? "stock.fuelType" : "stock.product";
  const [selectedFarmId, setSelectedFarmId] = useState(resumeState?.farmId ?? "");
  const [selectedKind, setSelectedKind] = useState(resumeState?.kind ?? "");
  const [selectedDate, setSelectedDate] = useState(
    () => resumeState?.date ?? new Date().toISOString().slice(0, 10),
  );
  const [selectedOpeningAnchorDate, setSelectedOpeningAnchorDate] = useState(
    resumeState?.openingAnchorDate ?? "",
  );
  const [editingOpeningConfigId, setEditingOpeningConfigId] = useState<number | null>(null);
  const [openingListVisibleCount, setOpeningListVisibleCount] = useState(OPENING_LIST_PAGE_SIZE);
  const [rows, setRows] = useState<FleetStockLedgerRow[]>([]);
  const [openingConfigs, setOpeningConfigs] = useState<OpeningConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);
  const [openingQty, setOpeningQty] = useState("");
  const [openingDateDraft, setOpeningDateDraft] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [importDraft, setImportDraft] = useState("");
  const [importAmountDraft, setImportAmountDraft] = useState("");
  const [importNotesDraft, setImportNotesDraft] = useState("");
  const [dayImports, setDayImports] = useState<FleetFuelImportRow[]>([]);
  const [editingImportId, setEditingImportId] = useState<number | null>(null);
  const [stockImportOpen, setStockImportOpen] = useState(false);
  const [view, setView] = useState<PanelView>(resumeState?.view ?? "balance");
  const resumeAppliedRef = useRef(false);
  const [creatingOpening, setCreatingOpening] = useState(false);
  const [editingOpening, setEditingOpening] = useState(false);
  const didAutoSelectConfigRef = useRef(false);
  const didInitFirstSetupRef = useRef(false);
  const balanceSelectionRef = useRef<{
    farmId: string;
    kind: string;
    date: string;
    openingAnchorDate: string;
  } | null>(null);
  const rowsCacheRef = useRef<Map<string, FleetStockLedgerRow[]>>(new Map());
  const loadRequestIdRef = useRef(0);

  const farmCountryIdForFilter = useMemo(() => {
    if (!farmCountryById || !selectedFarmId) return null;
    return farmCountryById.get(selectedFarmId) ?? null;
  }, [farmCountryById, selectedFarmId]);

  const selectableStockKeyOptions = useMemo(() => {
    if (!farmCountryById || !productCountryByStockKey) return stockKeyOptions;
    const pinned =
      editingOpening && selectedKind.trim() !== "" ? [selectedKind] : [];
    return filterStockKeyOptionsForFarmCountry(
      stockKeyOptions,
      productCountryByStockKey,
      farmCountryIdForFilter,
      pinned,
    );
  }, [
    stockKeyOptions,
    farmCountryById,
    productCountryByStockKey,
    farmCountryIdForFilter,
    editingOpening,
    selectedKind,
  ]);

  const stockKindOptions = useMemo(
    () => selectableStockKeyOptions.map((row) => row.value),
    [selectableStockKeyOptions],
  );

  const farmId = useMemo(() => {
    const id = Number(selectedFarmId);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [selectedFarmId]);

  const configuringOpening = creatingOpening || editingOpening;

  const usedConfigKeys = useMemo(
    () =>
      new Set(
        openingConfigs.map((c) =>
          configKey(c.farm_id, String(c.stock_key), rowDateYmd(c)),
        ),
      ),
    [openingConfigs],
  );

  const isFirstTimeSetup = !configsLoading && openingConfigs.length === 0;

  const isComboAvailable = useCallback(
    (
      farmOptionId: string,
      kind: string,
      openingDate: string,
      exceptConfig?: OpeningConfig | null,
    ) => {
      const key = configKey(farmOptionId, kind, openingDate.slice(0, 10));
      if (
        exceptConfig &&
        configKey(
          exceptConfig.farm_id,
          String(exceptConfig.stock_key),
          rowDateYmd(exceptConfig),
        ) === key
      ) {
        return true;
      }
      return !usedConfigKeys.has(key);
    },
    [usedConfigKeys],
  );

  useEffect(() => {
    if (initialFarmId && farmOptions.some((f) => f.id === initialFarmId)) {
      setSelectedFarmId(initialFarmId);
      return;
    }
    setSelectedFarmId((current) => {
      if (current && farmOptions.some((f) => f.id === current)) return current;
      return farmOptions[0]?.id ?? "";
    });
  }, [initialFarmId, farmOptions]);

  useEffect(() => {
    setSelectedKind((current) => {
      if (current && stockKindOptions.includes(current)) return current;
      return stockKindOptions[0] ?? "";
    });
  }, [stockKindOptions]);

  const kindRows = useMemo(() => {
    return rows
      .filter((r) => String(r.stock_key) === selectedKind)
      .sort((a, b) => rowDateYmd(a).localeCompare(rowDateYmd(b)));
  }, [rows, selectedKind]);

  const anchorRow = useMemo(() => {
    if (selectedOpeningAnchorDate) {
      return (
        kindRows.find(
          (r) => isOpeningAnchorRow(r) && rowDateYmd(r) === selectedOpeningAnchorDate,
        ) ?? null
      );
    }
    return kindRows.find(isOpeningAnchorRow) ?? null;
  }, [kindRows, selectedOpeningAnchorDate]);

  const selectedConfigKey =
    farmId && selectedOpeningAnchorDate
      ? configKey(farmId, selectedKind, selectedOpeningAnchorDate)
      : "";

  const activeOpeningConfig = useMemo(() => {
    if (!farmId || !selectedKind) return null;
    if (selectedOpeningAnchorDate) {
      const match = openingConfigs.find(
        (c) =>
          Number(c.farm_id) === farmId &&
          String(c.stock_key) === selectedKind &&
          rowDateYmd(c) === selectedOpeningAnchorDate,
      );
      if (match) return match;
    }
    return (
      openingConfigs.find(
        (c) => Number(c.farm_id) === farmId && String(c.stock_key) === selectedKind,
      ) ?? null
    );
  }, [openingConfigs, farmId, selectedKind, selectedOpeningAnchorDate]);

  const selectedDayRow = useMemo(
    () => kindRows.find((r) => rowDateYmd(r) === selectedDate) ?? null,
    [kindRows, selectedDate],
  );

  const latestRemaining =
    kindRows.length > 0 ? num(kindRows[kindRows.length - 1]?.remaining_qty) : null;

  const effectiveBalanceFrom = useMemo(() => {
    if (activeOpeningConfig) {
      return rowDateYmd(activeOpeningConfig);
    }
    if (anchorRow) {
      return rowDateYmd(anchorRow);
    }
    return balanceFrom;
  }, [activeOpeningConfig, anchorRow, balanceFrom]);

  const balanceMarkedDateSet = useMemo(() => {
    return new Set(kindRows.filter(rowHasBalanceMarker).map((row) => rowDateYmd(row)));
  }, [kindRows]);

  const isBalanceMarkedDate = useCallback(
    (date: Date) => balanceMarkedDateSet.has(ymdFromDate(date)),
    [balanceMarkedDateSet],
  );

  const recalcToDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return selectedDate > today ? selectedDate : today;
  }, [selectedDate]);

  const loadOpeningConfigs = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background ?? false;
    if (!background) setConfigsLoading(true);
    try {
      const allRows = await fetchFleetStockLedger({ module: ledgerModule });
      setOpeningConfigs(buildOpeningConfigs(allRows));
      setOpeningListVisibleCount(OPENING_LIST_PAGE_SIZE);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      if (!background) setConfigsLoading(false);
    }
  }, [t, ledgerModule]);

  const applyImportDraftsFromRow = useCallback((row: FleetStockLedgerRow | null) => {
    if (!row) {
      setImportDraft("");
      setImportAmountDraft("");
      return;
    }
    setImportDraft(formatDecimalInputFromValue(row.import_qty));
    setImportAmountDraft(
      row.import_amount != null && row.import_amount !== ""
        ? formatDecimalInputFromValue(row.import_amount)
        : "",
    );
  }, []);

  const load = useCallback(
    async (options?: { background?: boolean; balanceTo?: string }) => {
      if (!farmId) {
        setRows([]);
        setDayLoading(false);
        return;
      }

      const background = options?.background ?? false;
      const cacheKey = configKey(farmId, selectedKind, selectedOpeningAnchorDate || effectiveBalanceFrom);
      const cachedRows = rowsCacheRef.current.get(cacheKey);
      const balanceTo = options?.balanceTo ?? recalcToDate;

      if (cachedRows?.length) {
        setRows(cachedRows);
      } else {
        setRows([]);
      }

      if (!background) {
        applyImportDraftsFromRow(null);
        setEditingImportId(null);
        setDayLoading(true);
      }

      const requestId = ++loadRequestIdRef.current;

      try {
        await recalculateFleetStockLedger({
          farm_id: farmId,
          module: ledgerModule,
          stock_key: selectedKind,
          balance_from: effectiveBalanceFrom,
          balance_to: balanceTo,
        }).catch(() => []);

        const ledgerRows = await fetchFleetStockLedger({
          farm_id: farmId,
          module: ledgerModule,
          stock_key: selectedKind,
          balance_from: effectiveBalanceFrom,
        });

        if (requestId !== loadRequestIdRef.current) return;

        rowsCacheRef.current.set(cacheKey, ledgerRows);
        setRows(ledgerRows);

        const anchor = ledgerRows.find(
          (r) =>
            String(r.stock_key) === selectedKind &&
            isOpeningAnchorRow(r) &&
            (!selectedOpeningAnchorDate || rowDateYmd(r) === selectedOpeningAnchorDate),
        );
        if (anchor?.opening_qty != null && anchor.opening_qty !== "") {
          setOpeningQty(formatDecimalInputFromValue(anchor.opening_qty));
        } else if (!anchor) {
          setOpeningQty("");
        }
      } catch (e) {
        if (requestId !== loadRequestIdRef.current) return;
        toast.error(e instanceof Error ? e.message : t("stock.errors.load"), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } finally {
        if (requestId === loadRequestIdRef.current && !background) {
          setDayLoading(false);
        }
      }
    },
    [farmId, selectedKind, selectedOpeningAnchorDate, effectiveBalanceFrom, recalcToDate, t, ledgerModule, applyImportDraftsFromRow],
  );

  const applyOpeningConfigSelection = useCallback((config: OpeningConfig) => {
    setSelectedFarmId(String(config.farm_id));
    setSelectedKind(String(config.stock_key));
    setSelectedOpeningAnchorDate(rowDateYmd(config));
    setSelectedDate(rowDateYmd(config));
  }, []);

  useEffect(() => {
    if (configuringOpening) return;
    if (!selectedFarmId || openingConfigs.length === 0) return;
    const forFarm = openingConfigs.filter((c) => String(c.farm_id) === selectedFarmId);
    if (forFarm.length === 0) return;
    const stillValid = forFarm.some(
      (c) =>
        String(c.stock_key) === selectedKind &&
        rowDateYmd(c) === selectedOpeningAnchorDate,
    );
    if (!stillValid) {
      const next = forFarm[0]!;
      setSelectedKind(String(next.stock_key));
      setSelectedOpeningAnchorDate(rowDateYmd(next));
    }
  }, [
    configuringOpening,
    selectedFarmId,
    openingConfigs,
    selectedKind,
    selectedOpeningAnchorDate,
  ]);

  const restoreBalanceSelection = useCallback(() => {
    const saved = balanceSelectionRef.current;
    if (
      saved &&
      openingConfigs.some(
        (c) =>
          configKey(c.farm_id, String(c.stock_key), rowDateYmd(c)) ===
          configKey(saved.farmId, saved.kind, saved.openingAnchorDate),
      )
    ) {
      setSelectedFarmId(saved.farmId);
      setSelectedKind(saved.kind);
      setSelectedDate(saved.date);
      setSelectedOpeningAnchorDate(saved.openingAnchorDate);
      return;
    }

    const preferred = pickPreferredOpeningConfig(openingConfigs, initialFarmId);
    if (preferred) {
      applyOpeningConfigSelection(preferred);
    }
  }, [openingConfigs, initialFarmId, applyOpeningConfigSelection]);

  const handleBalanceDateChange = useCallback(
    (nextDate: string) => {
      setSelectedDate(nextDate);
      applyImportDraftsFromRow(null);
      setEditingImportId(null);
      setDayLoading(true);

      const today = new Date().toISOString().slice(0, 10);
      if (nextDate > today) {
        return;
      }

      const row = kindRows.find((r) => rowDateYmd(r) === nextDate) ?? null;
      // Let the loading state paint before filling local values.
      requestAnimationFrame(() => {
        if (variant !== "fuel") {
          applyImportDraftsFromRow(row);
        }
        setDayLoading(false);
      });
    },
    [kindRows, applyImportDraftsFromRow, variant],
  );

  const snapshotBalanceSelection = useCallback(() => {
    if (!activeOpeningConfig) return;
    balanceSelectionRef.current = {
      farmId: selectedFarmId,
      kind: selectedKind,
      date: selectedDate,
      openingAnchorDate: selectedOpeningAnchorDate,
    };
  }, [activeOpeningConfig, selectedFarmId, selectedKind, selectedDate, selectedOpeningAnchorDate]);

  useEffect(() => {
    void loadOpeningConfigs();
  }, [loadOpeningConfigs]);

  useEffect(() => {
    if (!farmId || !activeOpeningConfig) return;
    const cacheKey = configKey(
      farmId,
      selectedKind,
      selectedOpeningAnchorDate || effectiveBalanceFrom,
    );
    const today = new Date().toISOString().slice(0, 10);
    const needsForeground =
      !rowsCacheRef.current.has(cacheKey) || recalcToDate > today;
    void load({
      background: !needsForeground,
    });
  }, [
    farmId,
    selectedKind,
    selectedOpeningAnchorDate,
    effectiveBalanceFrom,
    load,
    activeOpeningConfig,
    recalcToDate,
  ]);

  useEffect(() => {
    if (reloadToken === 0) return;
    rowsCacheRef.current.clear();
    void loadOpeningConfigs({ background: true });
    void load({ background: false });
  }, [reloadToken, loadOpeningConfigs, load]);

  useEffect(() => {
    if (configsLoading) return;

    if (openingConfigs.length > 0) {
      setView((current) => (current === "configuredOpenings" ? current : "balance"));
      return;
    }

    if (didInitFirstSetupRef.current) return;
    if (!farmOptions.length) return;

    didInitFirstSetupRef.current = true;
    setView("balance");
    setCreatingOpening(true);
    setEditingOpening(false);
    setOpeningDateDraft(new Date().toISOString().slice(0, 10));
    setOpeningQty("");
    const nextFarm = farmOptions[0];
    const nextKind = stockKindOptions[0] ?? "";
    if (nextFarm) setSelectedFarmId(nextFarm.id);
    if (nextKind) setSelectedKind(nextKind);
  }, [configsLoading, openingConfigs.length, farmOptions, stockKindOptions]);

  useEffect(() => {
    if (didAutoSelectConfigRef.current) return;
    if (configsLoading || openingConfigs.length === 0 || configuringOpening) return;

    if (resumeState && !resumeAppliedRef.current) {
      resumeAppliedRef.current = true;
      didAutoSelectConfigRef.current = true;
      setSelectedFarmId(resumeState.farmId);
      setSelectedKind(resumeState.kind);
      setSelectedDate(resumeState.date);
      setSelectedOpeningAnchorDate(resumeState.openingAnchorDate);
      setView(resumeState.view);
      return;
    }

    const preferred = pickPreferredOpeningConfig(openingConfigs, initialFarmId);
    if (!preferred) return;

    didAutoSelectConfigRef.current = true;
    applyOpeningConfigSelection(preferred);
  }, [
    configsLoading,
    openingConfigs,
    configuringOpening,
    initialFarmId,
    applyOpeningConfigSelection,
    resumeState,
  ]);

  useEffect(() => {
    if (view !== "balance" || configsLoading || openingConfigs.length === 0) return;
    if (activeOpeningConfig) return;

    const preferred = pickPreferredOpeningConfig(openingConfigs, initialFarmId);
    if (preferred) {
      applyOpeningConfigSelection(preferred);
    }
  }, [
    view,
    configsLoading,
    openingConfigs,
    activeOpeningConfig,
    initialFarmId,
    applyOpeningConfigSelection,
  ]);

  const selectConfig = (config: OpeningConfig) => {
    setCreatingOpening(false);
    setEditingOpening(false);
    applyOpeningConfigSelection(config);
    setView("balance");
  };

  const pickFirstAvailableKind = useCallback(
    (farmOptionId: string, openingDate: string) =>
      stockKindOptions.find((kind) =>
        isComboAvailable(farmOptionId, kind, openingDate),
      ) ?? "",
    [stockKindOptions, isComboAvailable],
  );

  const startCreateOpening = () => {
    snapshotBalanceSelection();
    setView("configuredOpenings");
    setCreatingOpening(true);
    setEditingOpening(false);
    setEditingOpeningConfigId(null);
    const openingDate = new Date().toISOString().slice(0, 10);
    setOpeningDateDraft(openingDate);
    setOpeningQty("");
    setSelectedOpeningAnchorDate("");
    const nextFarm = farmOptions[0];
    if (nextFarm) {
      setSelectedFarmId(nextFarm.id);
      setSelectedKind(pickFirstAvailableKind(nextFarm.id, openingDate));
    }
  };

  const startEditOpening = (config: OpeningConfig) => {
    setView("configuredOpenings");
    setCreatingOpening(false);
    setEditingOpening(true);
    setEditingOpeningConfigId(Number(config.id));
    setSelectedFarmId(String(config.farm_id));
    setSelectedKind(String(config.stock_key));
    setOpeningDateDraft(rowDateYmd(config));
    setOpeningQty(formatDecimalInputFromValue(config.opening_qty));
  };

  const cancelConfiguringOpening = () => {
    setCreatingOpening(false);
    setEditingOpening(false);
    setEditingOpeningConfigId(null);
    if (isFirstTimeSetup) {
      onClose?.();
      return;
    }
    if (anchorRow) {
      setOpeningDateDraft(rowDateYmd(anchorRow));
      if (anchorRow.opening_qty != null && anchorRow.opening_qty !== "") {
        setOpeningQty(formatDecimalInputFromValue(anchorRow.opening_qty));
      }
    } else {
      setOpeningQty("");
    }
  };

  const goToConfiguredOpenings = () => {
    snapshotBalanceSelection();
    setCreatingOpening(false);
    setEditingOpening(false);
    setView("configuredOpenings");
  };

  const backToBalance = () => {
    setCreatingOpening(false);
    setEditingOpening(false);
    restoreBalanceSelection();
    setView("balance");
  };

  useEffect(() => {
    if (dayLoading) return;
    if (variant === "fuel") return;
    applyImportDraftsFromRow(selectedDayRow);
  }, [selectedDayRow, dayLoading, applyImportDraftsFromRow, variant]);

  const loadDayImports = useCallback(async () => {
    if (variant !== "fuel" || !farmId || !selectedKind.trim() || !selectedDate) {
      setDayImports([]);
      setEditingImportId(null);
      return;
    }
    try {
      const rows = await fetchFleetFuelImports({
        farm_id: farmId,
        fuel_kind: selectedKind,
        import_date: selectedDate,
      });
      setDayImports(rows);
    } catch (e) {
      setDayImports([]);
      toast.error(e instanceof Error ? e.message : t("stock.errors.load"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    }
  }, [variant, farmId, selectedKind, selectedDate, t]);

  useEffect(() => {
    if (variant !== "fuel") return;
    if (dayLoading) {
      setDayImports([]);
      return;
    }
    void loadDayImports();
  }, [variant, dayLoading, loadDayImports]);

  const resetImportForm = useCallback(() => {
    setImportDraft("");
    setImportAmountDraft("");
    setImportNotesDraft("");
    setEditingImportId(null);
  }, []);

  const dayImportTotalQty = useMemo(
    () => dayImports.reduce((sum, row) => sum + num(row.import_qty), 0),
    [dayImports],
  );

  const invalidateRowsCache = useCallback((key?: string) => {
    if (key) {
      rowsCacheRef.current.delete(key);
      return;
    }
    rowsCacheRef.current.clear();
  }, []);

  const handleSaveOpening = async () => {
    if (!farmId) {
      toast.error(t("stock.errors.farmRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    if (!selectedKind.trim()) {
      toast.error(t("stock.errors.openingRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    const opening = parseQty(openingQty);
    const openingDate = openingDateDraft.trim().slice(0, 10);
    if (!openingDate || !Number.isFinite(opening) || opening < 0) {
      toast.error(t("stock.errors.openingRequired"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    if (
      creatingOpening &&
      !isComboAvailable(String(farmId), selectedKind, openingDate)
    ) {
      toast.error(t("stock.errors.duplicateConfig"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveFleetStockLedger({
        ...(editingOpening && editingOpeningConfigId
          ? { id: editingOpeningConfigId }
          : {}),
        balance_date: openingDate,
        farm_id: farmId,
        module: ledgerModule,
        stock_key: selectedKind,
        opening_qty: opening,
        is_opening_anchor: true,
      });
      toast.success(t("stock.openingSaved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      setCreatingOpening(false);
      setEditingOpening(false);
      setEditingOpeningConfigId(null);
      setSelectedOpeningAnchorDate(openingDate);
      setSelectedDate(openingDate);
      setView("balance");
      invalidateRowsCache(configKey(farmId, selectedKind, openingDate));
      await Promise.all([
        loadOpeningConfigs({ background: true }),
        load({ background: true }),
      ]);
      onDataChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveImport = async () => {
    if (!farmId) return;
    const importQty = parseQty(importDraft);
    if (variant === "fuel") {
      if (!Number.isFinite(importQty) || importQty <= 0) {
        toast.error(t("stock.errors.importInvalid"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
        return;
      }
      const importAmountRaw = importAmountDraft.trim();
      let importAmount: number | null = null;
      if (importAmountRaw !== "") {
        importAmount = parseQty(importAmountDraft);
        if (!Number.isFinite(importAmount) || importAmount < 0) {
          toast.error(t("stock.errors.importAmountInvalid"), {
            containerId: TOAST_CONTAINER_TOP_RIGHT,
          });
          return;
        }
      }
      try {
        setSaving(true);
        await saveFleetFuelImport({
          ...(editingImportId ? { id: editingImportId } : {}),
          farm_id: farmId,
          fuel_kind: selectedKind,
          import_date: selectedDate,
          import_qty: importQty,
          import_amount: importAmount,
          notes: importNotesDraft.trim() || undefined,
        });
        toast.success(t("stock.importSaved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
        resetImportForm();
        invalidateRowsCache(configKey(farmId, selectedKind, selectedOpeningAnchorDate || selectedDate));
        await Promise.all([
          loadOpeningConfigs({ background: true }),
          load({ background: true }),
          loadDayImports(),
        ]);
        onDataChanged?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("stock.errors.save"), {
          containerId: TOAST_CONTAINER_TOP_RIGHT,
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!Number.isFinite(importQty) || importQty < 0) {
      toast.error(t("stock.errors.importInvalid"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    try {
      setSaving(true);
      await saveFleetStockLedger({
        balance_date: selectedDate,
        farm_id: farmId,
        module: ledgerModule,
        stock_key: selectedKind,
        import_qty: importQty,
      });
      toast.success(t("stock.importSaved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      invalidateRowsCache(configKey(farmId, selectedKind, selectedOpeningAnchorDate || selectedDate));
      await Promise.all([
        loadOpeningConfigs({ background: true }),
        load({ background: true }),
      ]);
      onDataChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditFuelImport = (row: FleetFuelImportRow) => {
    setEditingImportId(Number(row.id));
    setImportDraft(formatDecimalInputFromValue(row.import_qty));
    setImportAmountDraft(
      row.import_amount != null && row.import_amount !== ""
        ? formatDecimalInputFromValue(row.import_amount)
        : "",
    );
    setImportNotesDraft(String(row.notes ?? "").trim());
  };

  const handleDeleteFuelImport = async (row: FleetFuelImportRow) => {
    if (!farmId) return;
    if (!window.confirm(t("stock.deleteImportConfirm"))) return;
    try {
      setSaving(true);
      await removeFleetFuelImport({ id: Number(row.id) });
      toast.success(t("stock.importDeleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      if (editingImportId === Number(row.id)) {
        resetImportForm();
      }
      invalidateRowsCache(configKey(farmId, selectedKind, selectedOpeningAnchorDate || selectedDate));
      await Promise.all([
        loadOpeningConfigs({ background: true }),
        load({ background: true }),
        loadDayImports(),
      ]);
      onDataChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const isOpeningDay =
    selectedDayRow != null && isOpeningAnchorRow(selectedDayRow);

  const handleDeleteBalance = async () => {
    if (!farmId || !selectedDayRow) return;

    const confirmMessage = isOpeningDay
      ? t("stock.deleteOpeningConfirm")
      : t("stock.deleteConfirm", { date: formatDateDisplay(selectedDate) });
    if (!window.confirm(confirmMessage)) return;

    try {
      setSaving(true);
      await removeFleetStockLedger({ id: selectedDayRow.id });
      toast.success(t("stock.deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      if (isOpeningDay) {
        setOpeningQty("");
        resetImportForm();
      }
      invalidateRowsCache(configKey(farmId, selectedKind, selectedOpeningAnchorDate || selectedDate));
      await Promise.all([
        loadOpeningConfigs({ background: true }),
        load({ background: true }),
        variant === "fuel" ? loadDayImports() : Promise.resolve(),
      ]);
      onDataChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOpeningConfig = async (config: OpeningConfig) => {
    if (!window.confirm(t("stock.deleteOpeningConfirm"))) return;

    const deletedKey = configKey(
      config.farm_id,
      String(config.stock_key),
      rowDateYmd(config),
    );
    const wasSelected = deletedKey === selectedConfigKey;
    const wasEditing = editingOpeningConfigId === Number(config.id);

    try {
      setSaving(true);
      await removeFleetStockLedger({ id: config.id });
      toast.success(t("stock.deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      if (wasSelected) {
        setOpeningQty("");
        setImportDraft("");
      }
      if (wasEditing) {
        setEditingOpening(false);
        setEditingOpeningConfigId(null);
        setCreatingOpening(false);
      }
      const allRows = await fetchFleetStockLedger({ module: ledgerModule });
      const nextConfigs = buildOpeningConfigs(allRows);
      setOpeningConfigs(nextConfigs);
      invalidateRowsCache(deletedKey);
      if (nextConfigs.length === 0) {
        didInitFirstSetupRef.current = false;
        setView("balance");
        setCreatingOpening(true);
        setEditingOpening(false);
      } else if (wasSelected) {
        applyOpeningConfigSelection(nextConfigs[0]!);
        setView("balance");
      }
      setOpeningListVisibleCount(OPENING_LIST_PAGE_SIZE);
      await load({ background: true });
      onDataChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("stock.errors.delete"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  const openingFormTitle = editingOpening
    ? t("stock.editOpeningTitle")
    : isFirstTimeSetup
      ? t("stock.firstTimeSetupTitle")
      : t("stock.setOpening");

  const editingConfig = useMemo(
    () =>
      editingOpeningConfigId != null
        ? (openingConfigs.find((c) => Number(c.id) === editingOpeningConfigId) ?? null)
        : null,
    [openingConfigs, editingOpeningConfigId],
  );

  const configsForSelectedFarm = useMemo(
    () => openingConfigs.filter((c) => String(c.farm_id) === selectedFarmId),
    [openingConfigs, selectedFarmId],
  );

  const openingDateForCombo = openingDateDraft.trim().slice(0, 10);

  const stockKindSelectOptions = useMemo(
    () =>
      stockKindOptions
        .filter((kind) => {
          if (!creatingOpening) return true;
          return isComboAvailable(
            selectedFarmId,
            kind,
            openingDateForCombo,
            editingOpening ? editingConfig : null,
          );
        })
        .map((kind) => {
          const option = stockKeyOptions.find((row) => row.value === kind);
          return {
            value: kind,
            label: option?.label ?? kindLabel(kind, stockKeyOptions, t, variant),
            subLabel: option?.subLabel,
          };
        }),
    [
      stockKindOptions,
      stockKeyOptions,
      t,
      variant,
      creatingOpening,
      selectedFarmId,
      openingDateForCombo,
      editingOpening,
      editingConfig,
      isComboAvailable,
    ],
  );

  useEffect(() => {
    if (!creatingOpening || editingOpening) return;
    if (!selectedFarmId || !openingDateForCombo) return;
    if (
      selectedKind &&
      isComboAvailable(selectedFarmId, selectedKind, openingDateForCombo)
    ) {
      return;
    }
    const nextKind = pickFirstAvailableKind(selectedFarmId, openingDateForCombo);
    if (nextKind && nextKind !== selectedKind) {
      setSelectedKind(nextKind);
    }
  }, [
    creatingOpening,
    editingOpening,
    selectedFarmId,
    selectedKind,
    openingDateForCombo,
    isComboAvailable,
    pickFirstAvailableKind,
  ]);

  const visibleOpeningConfigs = useMemo(
    () => openingConfigs.slice(0, openingListVisibleCount),
    [openingConfigs, openingListVisibleCount],
  );

  const farmsWithConfig = useMemo(() => {
    const ids = new Set(openingConfigs.map((c) => String(c.farm_id)));
    return farmOptions.filter((f) => ids.has(f.id));
  }, [farmOptions, openingConfigs]);

  const openingForm = (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <p className="mb-3 text-sm font-medium text-foreground">{openingFormTitle}</p>
      {creatingOpening ? (
        <p className="mb-3 text-sm text-muted-foreground">{t("stock.openingHint")}</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium">{t("stock.farm")}</span>
          <select
            className={inputClass}
            value={selectedFarmId}
            disabled={editingOpening}
            onChange={(e) => {
              setSelectedFarmId(e.target.value);
              if (!editingOpening) setSelectedKind("");
            }}
          >
            <option value="">{t("stock.selectFarm")}</option>
            {farmOptions.map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium">{t(stockKeyLabel)}</span>
          <MultiSelect
            options={stockKindSelectOptions}
            values={selectedKind ? [selectedKind] : []}
            onChange={(next) => setSelectedKind(next[0] ?? "")}
            multi={false}
            placeholder={t(stockKeyLabel)}
            className={inputClass}
            rightIcon={selectChevron}
            showSelectedChipsInPopover={false}
            disabled={editingOpening}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium">{t("stock.openingDate")}</span>
          <DatePicker
            value={openingDateDraft}
            onChange={setOpeningDateDraft}
            isMarkedDate={isBalanceMarkedDate}
            markedDateModifierClassName={
              calendarMarkedDateClassName ?? CALENDAR_FUEL_BALANCE_DAY_CLASS
            }
            className="h-9"
          />
          {creatingOpening ? (
            <p className="text-xs text-muted-foreground">{t("stock.applicationDateHint")}</p>
          ) : null}
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium">{t("stock.openingQty")}</span>
          <input
            type="text"
            inputMode="decimal"
            className={inputClass}
            placeholder="0"
            value={openingQty}
            onChange={(e) => setOpeningQty(formatDecimalInput(e.target.value))}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={saving}
          onClick={() => void handleSaveOpening()}
        >
          {editingOpening ? t("stock.saveOpening") : t("stock.setOpening")}
        </button>
        <button
          type="button"
          className={btnOutline}
          disabled={saving}
          onClick={cancelConfiguringOpening}
        >
          {t("stock.cancelEdit")}
        </button>
      </div>
    </div>
  );

  const configuredOpeningsList = (
    <>
      <div className="max-h-[min(360px,50vh)] space-y-2 overflow-y-auto pr-1">
      {visibleOpeningConfigs.map((config) => {
        const key = configKey(config.farm_id, String(config.stock_key), rowDateYmd(config));
        const farmName = farmLabelForConfig(config, farmOptions);
        const stockName = kindLabel(String(config.stock_key), stockKeyOptions, t, variant);
        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => selectConfig(config)}
            >
              <p className="text-sm font-medium text-foreground">
                {t("stock.openingConfigRow", {
                  farm: farmName,
                  ...(variant === "fuel"
                    ? { fuel: stockName }
                    : { product: stockName }),
                  date: formatDateDisplay(rowDateYmd(config)),
                  qty: formatQtyDisplay(num(config.opening_qty), quantityUnitSuffix),
                })}
              </p>
              {config.latestRemaining != null ? (
                <p className="text-xs text-muted-foreground">
                  {t("stock.openingConfigRemaining", {
                    qty: formatQtyDisplay(config.latestRemaining, quantityUnitSuffix),
                  })}
                </p>
              ) : null}
            </button>
            <button
              type="button"
              className={btnIconSm}
              disabled={saving}
              aria-label={t("stock.editOpening")}
              onClick={() => startEditOpening(config)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={`${btnIconSm} text-destructive hover:bg-destructive/10`}
              disabled={saving}
              aria-label={t("stock.deleteBalance")}
              onClick={() => void handleDeleteOpeningConfig(config)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      </div>
      {openingListVisibleCount < openingConfigs.length ? (
        <button
          type="button"
          className={`${btnOutline} mt-3 w-full`}
          disabled={saving}
          onClick={() =>
            setOpeningListVisibleCount((count) => count + OPENING_LIST_PAGE_SIZE)
          }
        >
          {t("stock.loadMore")}
        </button>
      ) : null}
    </>
  );

  const displayedLatestRemaining =
    latestRemaining ??
    (activeOpeningConfig?.latestRemaining != null
      ? activeOpeningConfig.latestRemaining
      : null);

  const openingAnchorDate = anchorRow
    ? rowDateYmd(anchorRow)
    : activeOpeningConfig
      ? rowDateYmd(activeOpeningConfig)
      : null;

  const balanceContent = activeOpeningConfig ? (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-medium">{t("stock.farm")}</span>
          <select
            className={inputClass}
            value={selectedFarmId}
            onChange={(e) => setSelectedFarmId(e.target.value)}
          >
            <option value="">{t("stock.selectFarm")}</option>
            {farmsWithConfig.map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium">{t(stockKeyLabel)}</span>
          <select
            className={inputClass}
            value={selectedConfigKey}
            onChange={(e) => {
              const config = openingConfigs.find(
                (c) =>
                  configKey(c.farm_id, String(c.stock_key), rowDateYmd(c)) ===
                  e.target.value,
              );
              if (config) applyOpeningConfigSelection(config);
            }}
          >
            {configsForSelectedFarm.map((config) => {
              const configValue = configKey(
                config.farm_id,
                String(config.stock_key),
                rowDateYmd(config),
              );
              return (
                <option key={configValue} value={configValue}>
                  {kindLabel(String(config.stock_key), stockKeyOptions, t, variant)} ·{" "}
                  {formatDateDisplay(rowDateYmd(config))}
                </option>
              );
            })}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium">{t("stock.balanceDate")}</span>
          <DatePicker
            value={selectedDate}
            onChange={handleBalanceDateChange}
            isMarkedDate={isBalanceMarkedDate}
            markedDateModifierClassName={
              calendarMarkedDateClassName ?? CALENDAR_FUEL_BALANCE_DAY_CLASS
            }
            className="h-9"
          />
        </label>
      </div>

      {displayedLatestRemaining !== null ? (
        <p className="text-sm text-muted-foreground">
          {t("stock.currentRemaining")} ({kindLabel(selectedKind, stockKeyOptions, t, variant)}):{" "}
          <span className="font-semibold text-foreground">
            {formatQtyDisplay(displayedLatestRemaining, quantityUnitSuffix)}
          </span>
        </p>
      ) : null}

      <Card>
        <CardContent className="p-4">
          {!farmId ? (
            <p className="text-sm text-muted-foreground">{t("stock.selectFarm")}</p>
          ) : openingAnchorDate && selectedDate < openingAnchorDate ? (
            <p className="text-sm text-muted-foreground">{t("stock.beforeOpeningDate")}</p>
          ) : dayLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-medium text-foreground">
                {formatDateDisplay(selectedDate)}
                {isOpeningDay ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({t("stock.openingBadge")})
                  </span>
                ) : null}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("stock.usage")}
                  </span>
                  <p className="text-lg font-semibold">
                    {selectedDayRow
                      ? formatQtyDisplay(num(selectedDayRow.usage_qty), quantityUnitSuffix)
                      : "—"}
                  </p>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("stock.importTotal")}
                  </span>
                  <p className="text-lg font-semibold">
                    {variant === "fuel"
                      ? formatQtyDisplay(dayImportTotalQty, quantityUnitSuffix)
                      : selectedDayRow
                        ? formatQtyDisplay(num(selectedDayRow.import_qty), quantityUnitSuffix)
                        : "—"}
                  </p>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("stock.remaining")}
                  </span>
                  <p className="text-lg font-semibold text-primary">
                    {selectedDayRow
                      ? formatQtyDisplay(num(selectedDayRow.remaining_qty), quantityUnitSuffix)
                      : "—"}
                  </p>
                </label>
              </div>

              {variant === "fuel" ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium">{t("stock.import")}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={inputClass}
                        placeholder="0"
                        value={importDraft}
                        disabled={saving}
                        onChange={(e) => setImportDraft(formatDecimalInput(e.target.value))}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">{t("stock.importAmount")}</span>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={`${inputClass} pr-12`}
                          placeholder="0"
                          value={importAmountDraft}
                          disabled={saving}
                          onChange={(e) =>
                            setImportAmountDraft(formatDecimalInput(e.target.value))
                          }
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                          USD
                        </span>
                      </div>
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-medium">{t("stock.importNotes")}</span>
                      <input
                        type="text"
                        className={inputClass}
                        placeholder={t("stock.importNotesPlaceholder")}
                        value={importNotesDraft}
                        disabled={saving}
                        onChange={(e) => setImportNotesDraft(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnOutline}
                      disabled={saving}
                      onClick={() => void handleSaveImport()}
                    >
                      {editingImportId
                        ? t("stock.updateImport")
                        : t("stock.saveImport")}
                    </button>
                    {editingImportId ? (
                      <button
                        type="button"
                        className={btnOutline}
                        disabled={saving}
                        onClick={resetImportForm}
                      >
                        {t("stock.cancelEdit")}
                      </button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("stock.importsForDay")}
                    </p>
                    {dayImports.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("stock.noImports")}</p>
                    ) : (
                      <ul className="max-h-[7.5rem] overflow-y-auto divide-y divide-border rounded-md border border-border">
                        {dayImports.map((row) => (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">
                                {formatQtyDisplay(num(row.import_qty), quantityUnitSuffix)}
                              </span>
                              <span className="ml-2 text-muted-foreground">
                                {row.import_amount != null && row.import_amount !== ""
                                  ? `${formatNumber(num(row.import_amount), { maximumFractionDigits: 2 })} USD`
                                  : "—"}
                              </span>
                              {row.notes ? (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={String(row.notes)}>
                                  {String(row.notes)}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                className={btnIconSm}
                                disabled={saving}
                                title={t("stock.editImport")}
                                onClick={() => handleEditFuelImport(row)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className={btnIconSm}
                                disabled={saving}
                                title={t("stock.deleteImport")}
                                onClick={() => void handleDeleteFuelImport(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <label className="block max-w-xs space-y-1">
                    <span className="text-xs font-medium">{t("stock.import")}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={inputClass}
                      placeholder="0"
                      value={importDraft}
                      disabled={saving}
                      onChange={(e) => setImportDraft(formatDecimalInput(e.target.value))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnOutline}
                      disabled={saving}
                      onClick={() => void handleSaveImport()}
                    >
                      {t("stock.saveImport")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  ) : null;

  const pageTitle =
    view === "configuredOpenings" ? t("stock.configuredOpenings") : t("stock.title");

  const showConfigureOpeningButton =
    !configsLoading && !isFirstTimeSetup && view === "balance";

  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
      {variant === "fuel" && view === "balance" && !isFirstTimeSetup ? (
        <button
          type="button"
          className={btnHeaderSm}
          disabled={saving || configsLoading}
          onClick={() => {
            const resume = {
              farmId: selectedFarmId,
              kind: selectedKind,
              date: selectedDate,
              openingAnchorDate: selectedOpeningAnchorDate,
              view: "balance" as const,
            };
            if (onRequestStockImport) {
              onRequestStockImport(resume);
              return;
            }
            setStockImportOpen(true);
          }}
        >
          <Upload className="h-3.5 w-3.5" />
          {t("stock.importExcel")}
        </button>
      ) : null}
      {showConfigureOpeningButton ? (
        <button
          type="button"
          className={btnHeaderSm}
          disabled={saving}
          onClick={goToConfiguredOpenings}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("stock.configureOpeningBalance")}
        </button>
      ) : null}
      {onClose ? (
        <button type="button" className={btnHeaderSm} onClick={onClose}>
          {t("dialog.cancel")}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {embedded ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{pageTitle}</h2>
          {headerActions}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{pageTitle}</h2>
          </div>
          {headerActions}
        </div>
      )}

      {view === "configuredOpenings" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${btnOutline} w-fit`}
              onClick={backToBalance}
            >
              <ChevronLeft className="h-4 w-4" />
              {t("stock.backToBalance")}
            </button>

            {!configuringOpening ? (
              <button
                type="button"
                className={`${btnPrimaryIcon} w-fit`}
                disabled={saving || configsLoading}
                onClick={startCreateOpening}
              >
                <Plus className="h-4 w-4 shrink-0" />
                {t("stock.addOpeningConfig")}
              </button>
            ) : null}
          </div>

          {configuringOpening ? openingForm : null}

          <div className="rounded-md border border-border bg-muted/10 p-4">
            {configsLoading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : openingConfigs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("stock.noOpeningConfigs")}</p>
            ) : (
              configuredOpeningsList
            )}
            {openingConfigs.length > 0 && !configuringOpening ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("stock.selectConfigHint")}</p>
            ) : null}
          </div>
        </>
      ) : isFirstTimeSetup ? (
        configsLoading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          openingForm
        )
      ) : (
        <>
          {activeOpeningConfig ? (
            balanceContent
          ) : configsLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("stock.selectFarm")}</p>
          )}
        </>
      )}

      {variant === "fuel" && !onRequestStockImport ? (
        <FuelStockImportDialog
          open={stockImportOpen}
          onClose={() => setStockImportOpen(false)}
          farmOptions={farmOptions}
          onImported={() => {
            invalidateRowsCache();
            void Promise.all([
              loadOpeningConfigs({ background: true }),
              load({ background: true }),
              loadDayImports(),
            ]);
            onDataChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}

export function FuelStockLedgerPanel(props: FuelStockLedgerPanelProps) {
  const tCatalog = useTranslations("AdminFleetOptionCatalogs");
  const { options: fuelTypeOptions, values: fuelKinds } = useFleetOptionCatalog(
    FLEET_OPTION_CATALOG_KEYS.fuelTypes,
  );
  const stockKeyOptions = useMemo(() => {
    const values = fuelKinds.length ? fuelKinds : [...FUEL_KINDS_FALLBACK];
    return values.map((value) => {
      const fromCatalog = fuelTypeOptions.find((row) => row.value === value)?.label;
      return {
        value,
        label: resolveFleetOptionLabel(
          tCatalog,
          FLEET_OPTION_CATALOG_KEYS.fuelTypes,
          value,
          fromCatalog ??
            (value === "diesel" ? "Diesel" : value === "petrol" ? "Petrol" : value),
        ),
      };
    });
  }, [fuelKinds, fuelTypeOptions, tCatalog]);

  return (
    <StockLedgerPanel
      variant="fuel"
      stockKeyOptions={stockKeyOptions}
      quantityUnitSuffix=" L"
      calendarMarkedDateClassName={CALENDAR_FUEL_BALANCE_DAY_CLASS}
      {...props}
    />
  );
}
