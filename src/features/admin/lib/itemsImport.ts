import * as XLSX from "xlsx";

export type ItemImportInputRow = {
  row_index: number;
  sku_sts: string;
  old_sku: string;
  commodity_code: string;
  thai_code: string;
  myanmar_code: string;
  malaysia_code: string;
  singapore_code: string;
  commodity_name: string;
  description: string;
  unit: string;
  brand: string;
  category_path: string;
  product_type: string;
  /** Active | Inactive from Excel; empty defaults to Inactive on import. */
  item_status: string;
};

export type ItemImportPreviewStatus = "ready" | "skip_duplicate" | "skip_invalid";

export type ItemImportPreviewRow = ItemImportInputRow & {
  status: ItemImportPreviewStatus;
  reason: string;
  matched_field?: string;
  matched_item_id?: number;
  category_id?: number;
  brand_id?: number;
  unit_id?: number;
};

export function normalizeItemImportStatus(raw: string | null | undefined): "Active" | "Inactive" {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "active" ? "Active" : "Inactive";
}

export type ItemImportPreview = {
  rows: ItemImportPreviewRow[];
  summary: {
    total: number;
    ready: number;
    skip_duplicate: number;
    skip_invalid: number;
  };
};

export type ItemImportCommitResult = {
  summary: {
    imported: number;
    failed: number;
    skipped: number;
  };
  results: Array<{
    row_index: number | null;
    status: "imported" | "failed" | "skipped";
    item_id?: number;
    reason?: string;
  }>;
};

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map((header) => normalizeHeader(header));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseItemsImportWorkbook(buffer: ArrayBuffer): ItemImportInputRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("emptySheet");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (!matrix.length) {
    throw new Error("emptySheet");
  }

  const headers = matrix[0].map((cell) => cellText(cell));
  const idx = {
    skuSts: findHeaderIndex(headers, ["skusts"]),
    oldSts: findHeaderIndex(headers, ["oldsts"]),
    code: findHeaderIndex(headers, ["code", "commoditycode"]),
    thaiCode: findHeaderIndex(headers, ["thaicode"]),
    myanmarCode: findHeaderIndex(headers, ["myanmarcode"]),
    malaysiaCode: findHeaderIndex(headers, ["malaysiacode"]),
    singaporeCode: findHeaderIndex(headers, ["singaporecode"]),
    name: findHeaderIndex(headers, ["name", "commodityname"]),
    description: findHeaderIndex(headers, ["description"]),
    unit: findHeaderIndex(headers, ["unit"]),
    brand: findHeaderIndex(headers, ["brand", "brandname"]),
    category: findHeaderIndex(headers, ["category"]),
    productType: findHeaderIndex(headers, ["producttype"]),
    itemStatus: findHeaderIndex(headers, ["status", "itemstatus"]),
  };

  if (idx.skuSts < 0 && idx.code < 0 && idx.name < 0) {
    throw new Error("missingColumns");
  }

  const rows: ItemImportInputRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const read = (columnIndex: number) => (columnIndex >= 0 ? cellText(line[columnIndex]) : "");

    const skuSts = read(idx.skuSts);
    const commodityName = read(idx.name);
    const categoryPath = read(idx.category);
    const brand = read(idx.brand);
    const unit = read(idx.unit);
    const itemStatusRaw = read(idx.itemStatus);

    if (!skuSts && !commodityName && !categoryPath && !brand && !unit) {
      continue;
    }

    rows.push({
      row_index: i + 1,
      sku_sts: skuSts,
      old_sku: read(idx.oldSts),
      commodity_code: read(idx.code),
      thai_code: read(idx.thaiCode),
      myanmar_code: read(idx.myanmarCode),
      malaysia_code: read(idx.malaysiaCode),
      singapore_code: read(idx.singaporeCode),
      commodity_name: commodityName,
      description: read(idx.description),
      unit,
      brand,
      category_path: categoryPath,
      product_type: read(idx.productType),
      item_status: itemStatusRaw,
    });
  }

  if (!rows.length) {
    throw new Error("noRows");
  }

  return rows;
}
