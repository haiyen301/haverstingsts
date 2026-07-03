import * as XLSX from "xlsx";

import {
  DEFAULT_COUNTRY_ID,
  parseInventoryRawSheet,
  type InventoryImportFileCountry,
} from "@/features/inventory/lib/inventoryOnhandImport";
import type { StockSummaryRow } from "@/features/warehouse/api/stockSummaryApi";

export type StockSummaryImportInputRow = {
  sku_sts: string;
  on_hand: number | string;
  country_id: number | string;
};

export type StockSummaryImportPreviewAction =
  | "insert"
  | "update"
  | "inactive"
  | "error";

export type StockSummaryImportPreviewRow = {
  line: number;
  sku_sts: string;
  on_hand: number | null;
  country_id: number;
  country_code: string;
  commodity_id: number | null;
  commodity_name: string | null;
  brand_name: string | null;
  current_on_hand: number | null;
  action: StockSummaryImportPreviewAction;
  error: string | null;
};

export type StockSummaryImportPreview = {
  country_id: number;
  rows: StockSummaryImportPreviewRow[];
  summary: {
    total: number;
    valid: number;
    errors: number;
    inserts: number;
    updates: number;
    inactive: number;
    imported?: number;
    failed?: number;
  };
};

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  return String(value).trim();
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseStockSummaryImportWorkbook(buffer: ArrayBuffer): StockSummaryImportInputRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet?.["!ref"]) {
    throw new Error("invalidSheet");
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  if (matrix.length === 0) {
    throw new Error("emptySheet");
  }

  const header = (matrix[0] ?? []).map((cell) => cellText(cell).toLowerCase());
  const skuIndex = header.findIndex((cell) =>
    ["sku sts", "sku_sts", "commodity_code", "code"].includes(cell),
  );
  const onHandIndex = header.findIndex((cell) =>
    ["on hand", "on_hand", "onhand"].includes(cell),
  );
  const countryIndex = header.findIndex((cell) =>
    ["country", "country_id", "country id"].includes(cell),
  );

  const useHeader = skuIndex >= 0 && onHandIndex >= 0;
  const startRow = useHeader ? 1 : 0;
  const resolvedSkuIndex = useHeader ? skuIndex : 0;
  const resolvedOnHandIndex = useHeader ? onHandIndex : 1;
  const resolvedCountryIndex = useHeader ? countryIndex : 2;

  const rows: StockSummaryImportInputRow[] = [];
  for (let i = startRow; i < matrix.length; i += 1) {
    const line = matrix[i] ?? [];
    const sku = cellText(line[resolvedSkuIndex]);
    const onHand = cellText(line[resolvedOnHandIndex]);
    const countryId = cellText(
      resolvedCountryIndex >= 0 ? line[resolvedCountryIndex] : "",
    );
    if (!sku && !onHand && !countryId) continue;
    rows.push({
      sku_sts: sku,
      on_hand: onHand,
      country_id: countryId,
    });
  }

  if (rows.length === 0) {
    throw new Error("noRows");
  }

  return rows;
}

export function parseStockSummaryRawWorkbook(
  buffer: ArrayBuffer,
  fileCountry: InventoryImportFileCountry,
  countryId?: number | string,
): StockSummaryImportInputRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error("invalidSheet");
  }

  const parsed = parseInventoryRawSheet(sheet, fileCountry);
  if (parsed && "error" in parsed) {
    throw new Error(parsed.error);
  }

  const resolvedCountryId = cellText(countryId ?? DEFAULT_COUNTRY_ID[fileCountry]);
  const rows: StockSummaryImportInputRow[] = [];

  for (const row of parsed.rows) {
    const sku = cellText(row["Sku STS"]);
    const onHand = row["On Hand"];
    if (!sku && (onHand == null || cellText(onHand) === "")) continue;
    rows.push({
      sku_sts: sku,
      on_hand: typeof onHand === "number" ? onHand : cellText(onHand),
      country_id: resolvedCountryId,
    });
  }

  if (rows.length === 0) {
    throw new Error("noRows");
  }

  return rows;
}

export function buildStockSummaryTestImportRows(params: {
  stockRows: StockSummaryRow[];
  countries: Array<{ id: number; code: string; label: string }>;
}): StockSummaryImportInputRow[] {
  const { stockRows, countries } = params;
  const countryByCode = new Map(
    countries.map((country) => [country.code.toUpperCase(), country.id]),
  );
  const defaultCountryId = countries[0]?.id ?? 1;

  const baseRows = stockRows.slice(0, 6).map((row, index) => {
    const code = String(row.country_code ?? "").trim().toUpperCase();
    const countryId = countryByCode.get(code) ?? defaultCountryId;
    const current = num(row.on_hand);
    return {
      sku_sts: String(row.sku_sts ?? "").trim(),
      on_hand: current > 0 ? current + 10 + index : 25 + index,
      country_id: countryId,
    };
  });

  if (baseRows.length === 0) {
    return [
      { sku_sts: "TEST-SKU-001", on_hand: 120, country_id: defaultCountryId },
      { sku_sts: "TEST-SKU-002", on_hand: 85, country_id: defaultCountryId },
      { sku_sts: "INVALID-TEST-SKU", on_hand: 40, country_id: defaultCountryId },
      { sku_sts: "", on_hand: 10, country_id: defaultCountryId },
      { sku_sts: "TEST-SKU-003", on_hand: "abc", country_id: defaultCountryId },
    ];
  }

  return [
    ...baseRows,
    {
      sku_sts: "INVALID-TEST-SKU",
      on_hand: 99,
      country_id: baseRows[0]?.country_id ?? defaultCountryId,
    },
    {
      sku_sts: "",
      on_hand: 12,
      country_id: baseRows[0]?.country_id ?? defaultCountryId,
    },
    {
      sku_sts: baseRows[0]?.sku_sts ?? "TEST-SKU-BAD-QTY",
      on_hand: "not-a-number",
      country_id: baseRows[0]?.country_id ?? defaultCountryId,
    },
  ].filter((row) => row.sku_sts !== "" || row.on_hand !== "");
}

export function downloadStockSummaryImportTemplate(): void {
  const rows = [
    { "Sku STS": "EXAMPLE-SKU-001", "On Hand": 100, Country: 1 },
    { "Sku STS": "EXAMPLE-SKU-002", "On Hand": 250, Country: 1 },
  ];
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["Sku STS", "On Hand", "Country"],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "ImportStock");
  XLSX.writeFile(workbook, "stock-summary-import-template.xlsx");
}
