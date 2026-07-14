import * as XLSX from "xlsx";

export type FuelStockImportFarmOption = {
  id: string;
  label: string;
};

export type FuelStockImportFuelTypeOption = {
  value: string;
  label: string;
};

export type FuelStockImportRawRow = {
  line: number;
  farm: string;
  fuel_kind: string;
  import_date: string;
  import_qty: number | null;
  import_amount: number | null;
  notes: string;
};

export type FuelStockImportPreviewStatus = "ready" | "error";

export type FuelStockImportPreviewRow = FuelStockImportRawRow & {
  farm_id: number | null;
  farm_label: string | null;
  /** Stored catalog value (e.g. diesel, petrol, engine_oil_grease). */
  fuel_kind_normalized: string | null;
  status: FuelStockImportPreviewStatus;
  error: string | null;
};

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value).trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToYmd(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const text = cellText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    const y = Number(slash[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** Match key so "Engine Oil, Grease" ≈ "Engine Oil Grease" ≈ "engine_oil_grease". */
export function fuelTypeMatchKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function legacyFuelKindAlias(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  // Phan Thiet Excel grades: DO 0,05_II = diesel oil; RON 95_III = petrol
  if (
    text === "diesel" ||
    text.includes("diesel") ||
    text.includes("dầu") ||
    text.includes("dau") ||
    text.startsWith("do ") ||
    text.startsWith("do0") ||
    text.startsWith("do_") ||
    /^do[\s,._0-9]/.test(text)
  ) {
    return "diesel";
  }
  if (
    text === "petrol" ||
    text.includes("petrol") ||
    text.includes("gasoline") ||
    text.includes("xăng") ||
    text.includes("xang") ||
    text.includes("ron")
  ) {
    return "petrol";
  }
  return null;
}

export function resolveFuelStockImportFuelKind(
  raw: string,
  fuelTypeOptions: FuelStockImportFuelTypeOption[],
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const key = fuelTypeMatchKey(trimmed);

  for (const option of fuelTypeOptions) {
    const value = String(option.value ?? "").trim();
    const label = String(option.label ?? "").trim();
    if (!value) continue;
    const stored = value.toLowerCase();
    if (lower === stored) return stored;
    if (key && (fuelTypeMatchKey(value) === key || (label && fuelTypeMatchKey(label) === key))) {
      return stored;
    }
  }

  const legacy = legacyFuelKindAlias(trimmed);
  if (legacy) {
    const hasLegacy = fuelTypeOptions.some(
      (option) => String(option.value).trim().toLowerCase() === legacy,
    );
    if (hasLegacy || fuelTypeOptions.length === 0) return legacy;
  }

  return null;
}

function headerIndex(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeHeader(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseFuelStockImportWorkbook(buffer: ArrayBuffer): FuelStockImportRawRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("emptySheet");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("invalidSheet");

  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown as unknown[][];

  if (!matrix.length) throw new Error("emptySheet");

  const headers = (matrix[0] ?? []).map((cell) => cellText(cell));
  const farmIdx = headerIndex(headers, ["farm", "farm_name", "trangtrai"]);
  const fuelIdx = headerIndex(headers, [
    "fuel_type",
    "fuel_kind",
    "fuel",
    "loainhienlieu",
  ]);
  const dateIdx = headerIndex(headers, ["date", "import_date", "balance_date", "ngay"]);
  const qtyIdx = headerIndex(headers, [
    "import_qty",
    "qty",
    "quantity",
    "litres",
    "liters",
    "soluong",
  ]);
  const amountIdx = headerIndex(headers, [
    "import_amount",
    "amount",
    "price",
    "pre_tax_price",
    "pretaxprice",
    "usd",
    "giatien",
  ]);
  const notesIdx = headerIndex(headers, [
    "notes",
    "note",
    "diengiai",
    "description",
    "remark",
    "remarks",
  ]);

  if (farmIdx < 0 || fuelIdx < 0 || dateIdx < 0 || qtyIdx < 0) {
    throw new Error("missingColumns");
  }

  const rows: FuelStockImportRawRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const farm = cellText(row[farmIdx]);
    const fuelKind = cellText(row[fuelIdx]);
    const importDate = parseDate(row[dateIdx]) ?? cellText(row[dateIdx]);
    const importQty = parseNumber(row[qtyIdx]);
    const importAmount = amountIdx >= 0 ? parseNumber(row[amountIdx]) : null;
    const notes = notesIdx >= 0 ? cellText(row[notesIdx]) : "";
    if (
      !farm &&
      !fuelKind &&
      !importDate &&
      importQty == null &&
      importAmount == null &&
      !notes
    ) {
      continue;
    }
    rows.push({
      line: i + 1,
      farm,
      fuel_kind: fuelKind,
      import_date: importDate,
      import_qty: importQty,
      import_amount: importAmount,
      notes,
    });
  }

  if (rows.length === 0) {
    throw new Error("noRows");
  }

  return rows;
}

export function matchFuelStockImportRows(
  rows: FuelStockImportRawRow[],
  farmOptions: FuelStockImportFarmOption[],
  fuelTypeOptions: FuelStockImportFuelTypeOption[] = [],
): FuelStockImportPreviewRow[] {
  const byName = new Map<string, FuelStockImportFarmOption>();
  const byId = new Map<string, FuelStockImportFarmOption>();
  for (const farm of farmOptions) {
    byId.set(farm.id, farm);
    byName.set(farm.label.trim().toLowerCase(), farm);
  }

  return rows.map((row) => {
    const farmKey = row.farm.trim().toLowerCase();
    const farm =
      byId.get(row.farm.trim()) ??
      byName.get(farmKey) ??
      null;
    const fuelKindNormalized = resolveFuelStockImportFuelKind(row.fuel_kind, fuelTypeOptions);
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(row.import_date);
    const qtyOk = row.import_qty != null && Number.isFinite(row.import_qty) && row.import_qty > 0;
    const amountOk =
      row.import_amount == null ||
      (Number.isFinite(row.import_amount) && (row.import_amount as number) >= 0);

    let error: string | null = null;
    if (!farm) error = "farmNotFound";
    else if (!fuelKindNormalized) error = "fuelInvalid";
    else if (!dateOk) error = "dateInvalid";
    else if (!qtyOk) error = "qtyInvalid";
    else if (!amountOk) error = "amountInvalid";

    return {
      ...row,
      farm_id: farm ? Number(farm.id) : null,
      farm_label: farm?.label ?? null,
      fuel_kind_normalized: fuelKindNormalized,
      status: error ? "error" : "ready",
      error,
    };
  });
}

export function downloadFuelStockImportTemplate(
  fuelTypeOptions: FuelStockImportFuelTypeOption[] = [],
): void {
  const examples =
    fuelTypeOptions.length > 0
      ? fuelTypeOptions.slice(0, 3).map((option, index) => [
          "Hoi An",
          option.label || option.value,
          "2026-01-05",
          100 * (index + 1),
          50 * (index + 1),
          `Sample ${option.label || option.value}`,
        ])
      : [
          ["Hoi An", "Diesel", "2026-01-05", 200, 1000, "Supplier invoice A"],
          ["Hoi An", "Petrol", "2026-01-05", 100, 500, "Top-up"],
          ["Hoi An", "Engine Oil, Grease", "2026-01-05", 36, 20, "Castrol sample"],
        ];

  const sheet = XLSX.utils.aoa_to_sheet([
    ["farm", "fuel_type", "date", "import_qty", "import_amount", "notes"],
    ...examples,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "fuel_imports");
  XLSX.writeFile(workbook, "fuel_stock_import_sample.xlsx");
}

export function isFuelStockImportWorkbook(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv");
}
