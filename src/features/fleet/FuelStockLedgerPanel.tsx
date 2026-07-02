"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Package, Pencil, Plus, Trash2 } from "lucide-react";
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
import { FLEET_OPTION_CATALOG_KEYS } from "@/features/fleet/api/fleetOptionCatalogApi";
import { useFleetOptionCatalog } from "@/features/fleet/hooks/useFleetOptionCatalog";
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

const FUEL_KINDS_FALLBACK = ["diesel", "petrol"] as const;
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

export type StockLedgerPanelProps = {
  variant: StockLedgerVariant;
  farmOptions: FuelStockFarmOption[];
  stockKeyOptions: StockLedgerStockKeyOption[];
  quantityUnitSuffix?: string;
  calendarMarkedDateClassName?: string;
  initialFarmId?: string | null;
  balanceFrom?: string;
  reloadToken?: number;
  embedded?: boolean;
  onClose?: () => void;
  onDataChanged?: () => void;
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
  balanceFrom,
  reloadToken = 0,
  embedded = false,
  onClose,
  onDataChanged,
}: StockLedgerPanelProps) {
  const t = useTranslations(variant === "fuel" ? "FuelUsage" : "FertilizerUsage");
  const ledgerModule: FleetStockModule = variant;
  const stockKeyLabel = variant === "fuel" ? "stock.fuelType" : "stock.product";
  const stockKindOptions = useMemo(
    () => stockKeyOptions.map((row) => row.value),
    [stockKeyOptions],
  );
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [selectedKind, setSelectedKind] = useState(stockKindOptions[0] ?? "");
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [selectedOpeningAnchorDate, setSelectedOpeningAnchorDate] = useState("");
  const [editingOpeningConfigId, setEditingOpeningConfigId] = useState<number | null>(null);
  const [openingListVisibleCount, setOpeningListVisibleCount] = useState(OPENING_LIST_PAGE_SIZE);
  const [rows, setRows] = useState<FleetStockLedgerRow[]>([]);
  const [openingConfigs, setOpeningConfigs] = useState<OpeningConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openingQty, setOpeningQty] = useState("");
  const [openingDateDraft, setOpeningDateDraft] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [importDraft, setImportDraft] = useState("");
  const [view, setView] = useState<PanelView>("balance");
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

  const load = useCallback(
    async (options?: { background?: boolean; balanceTo?: string }) => {
      if (!farmId) {
        setRows([]);
        return;
      }

      const cacheKey = configKey(farmId, selectedKind, selectedOpeningAnchorDate || effectiveBalanceFrom);
      const cachedRows = rowsCacheRef.current.get(cacheKey);
      const balanceTo = options?.balanceTo ?? recalcToDate;

      if (cachedRows?.length) {
        setRows(cachedRows);
      } else {
        setRows([]);
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
      }
    },
    [farmId, selectedKind, selectedOpeningAnchorDate, effectiveBalanceFrom, recalcToDate, t],
  );

  const applyOpeningConfigSelection = useCallback((config: OpeningConfig) => {
    setSelectedFarmId(String(config.farm_id));
    setSelectedKind(String(config.stock_key));
    setSelectedOpeningAnchorDate(rowDateYmd(config));
    setSelectedDate(rowDateYmd(config));
  }, []);

  useEffect(() => {
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
  }, [selectedFarmId, openingConfigs, selectedKind, selectedOpeningAnchorDate]);

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
    void load({
      background: rowsCacheRef.current.has(cacheKey),
    });
  }, [
    farmId,
    selectedKind,
    selectedOpeningAnchorDate,
    effectiveBalanceFrom,
    load,
    activeOpeningConfig,
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
      setCreatingOpening(false);
      setEditingOpening(false);
      setView((current) => (current === "configuredOpenings" ? current : "balance"));
      return;
    }

    if (didInitFirstSetupRef.current) return;

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

  const startCreateOpening = () => {
    snapshotBalanceSelection();
    setView("configuredOpenings");
    setCreatingOpening(true);
    setEditingOpening(false);
    setEditingOpeningConfigId(null);
    setOpeningDateDraft(new Date().toISOString().slice(0, 10));
    setOpeningQty("");
    const nextFarm = farmOptions[0];
    const nextKind = stockKindOptions[0] ?? "";
    if (nextFarm) setSelectedFarmId(nextFarm.id);
    if (nextKind) setSelectedKind(nextKind);
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
    if (selectedDayRow) {
      setImportDraft(formatDecimalInputFromValue(selectedDayRow.import_qty));
      return;
    }
    setImportDraft("");
  }, [selectedDayRow]);

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
        setImportDraft("");
      }
      invalidateRowsCache(configKey(farmId, selectedKind, selectedOpeningAnchorDate || selectedDate));
      await Promise.all([
        loadOpeningConfigs({ background: true }),
        load({ background: true }),
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

    try {
      setSaving(true);
      await removeFleetStockLedger({ id: config.id });
      toast.success(t("stock.deleted"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      if (wasSelected) {
        setOpeningQty("");
        setImportDraft("");
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
    ],
  );

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
            onChange={(e) => setSelectedFarmId(e.target.value)}
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
            onChange={setSelectedDate}
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnOutline}
                  disabled={saving}
                  onClick={() => void handleSaveImport()}
                >
                  {t("stock.saveImport")}
                </button>
                {selectedDayRow && rowHasBalanceMarker(selectedDayRow) ? (
                  <button
                    type="button"
                    className={btnDangerOutline}
                    disabled={saving}
                    onClick={() => void handleDeleteBalance()}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("stock.deleteBalance")}
                  </button>
                ) : null}
              </div>
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
    </div>
  );
}

export function FuelStockLedgerPanel(props: FuelStockLedgerPanelProps) {
  const { options: fuelTypeOptions, values: fuelKinds } = useFleetOptionCatalog(
    FLEET_OPTION_CATALOG_KEYS.fuelTypes,
  );
  const stockKeyOptions = useMemo(() => {
    const values = fuelKinds.length ? fuelKinds : [...FUEL_KINDS_FALLBACK];
    return values.map((value) => ({
      value,
      label:
        fuelTypeOptions.find((row) => row.value === value)?.label ??
        (value === "diesel" ? "Diesel" : value === "petrol" ? "Petrol" : value),
    }));
  }, [fuelKinds, fuelTypeOptions]);

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
