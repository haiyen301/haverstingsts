import * as XLSX from "xlsx";

import type { CountryRow } from "@/features/admin/api/countriesApi";
import { countryDisplayName } from "@/features/admin/api/countriesApi";
import type { FertilizerProductRow } from "@/features/admin/api/adminApi";

export type FertilizerProductImportInputRow = {
  row_index: number;
  name: string;
  uom: string;
  country_raw: string;
  country_id: number | null;
};

export type FertilizerProductImportPreviewStatus =
  | "ready"
  | "skip_duplicate"
  | "skip_invalid";

export type FertilizerProductImportPreviewRow = FertilizerProductImportInputRow & {
  status: FertilizerProductImportPreviewStatus;
  reason: string;
  country_label: string;
};

export type FertilizerProductImportPreview = {
  rows: FertilizerProductImportPreviewRow[];
  summary: {
    total: number;
    ready: number;
    skip_duplicate: number;
    skip_invalid: number;
  };
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

function duplicateKey(name: string, countryId: number | null): string {
  return `${name.trim().toLowerCase()}|${countryId ?? "global"}`;
}

const GLOBAL_COUNTRY_VALUES = new Set([
  "",
  "global",
  "all",
  "none",
  "na",
  "n/a",
  "toancau",
  "toàn cầu",
  "toan cau",
  "—",
  "-",
]);

function isGlobalCountryValue(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return GLOBAL_COUNTRY_VALUES.has(value);
}

export type CountryLookup = {
  byId: Map<string, CountryRow>;
  byCode: Map<string, CountryRow>;
  byName: Map<string, CountryRow>;
};

export function buildCountryLookup(countries: CountryRow[]): CountryLookup {
  const byId = new Map<string, CountryRow>();
  const byCode = new Map<string, CountryRow>();
  const byName = new Map<string, CountryRow>();

  for (const country of countries) {
    const id = String(country.id ?? "").trim();
    if (id) byId.set(id, country);

    const code = String(country.country_code ?? "").trim().toLowerCase();
    if (code) byCode.set(code, country);

    const name = countryDisplayName(country).trim().toLowerCase();
    if (name) byName.set(name, country);

    const altName = String(country.country_name ?? "").trim().toLowerCase();
    if (altName) byName.set(altName, country);
  }

  return { byId, byCode, byName };
}

export function resolveCountryId(
  raw: string,
  lookup: CountryLookup,
): { country_id: number | null; country_label: string } | null {
  const trimmed = raw.trim();
  if (isGlobalCountryValue(trimmed)) {
    return { country_id: null, country_label: "global" };
  }

  if (/^\d+$/.test(trimmed)) {
    const match = lookup.byId.get(trimmed);
    if (!match) return null;
    return {
      country_id: Number(match.id),
      country_label: countryDisplayName(match),
    };
  }

  const lower = trimmed.toLowerCase();
  const byCode = lookup.byCode.get(lower);
  if (byCode) {
    return {
      country_id: Number(byCode.id),
      country_label: countryDisplayName(byCode),
    };
  }

  const byName = lookup.byName.get(lower);
  if (byName) {
    return {
      country_id: Number(byName.id),
      country_label: countryDisplayName(byName),
    };
  }

  return null;
}

export function parseFertilizerProductImportWorkbook(
  buffer: ArrayBuffer,
): FertilizerProductImportInputRow[] {
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
    name: findHeaderIndex(headers, ["name", "ten", "productname", "product"]),
    uom: findHeaderIndex(headers, ["uom", "unit", "donvi", "đơnvị"]),
    country: findHeaderIndex(headers, [
      "country",
      "countryid",
      "countryname",
      "countrycode",
      "quocgia",
      "quốcgia",
    ]),
  };

  if (idx.name < 0) {
    throw new Error("missingColumns");
  }

  const rows: FertilizerProductImportInputRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const name = cellText(line[idx.name]);
    const uom = idx.uom >= 0 ? cellText(line[idx.uom]) : "";
    const country_raw = idx.country >= 0 ? cellText(line[idx.country]) : "";

    if (!name && !uom && !country_raw) continue;

    rows.push({
      row_index: i + 1,
      name,
      uom,
      country_raw,
      country_id: null,
    });
  }

  if (!rows.length) {
    throw new Error("noRows");
  }

  return rows;
}

export function buildFertilizerProductImportPreview(
  rows: FertilizerProductImportInputRow[],
  existingRows: FertilizerProductRow[],
  countries: CountryRow[],
  messages: {
    nameRequired: string;
    duplicateExisting: string;
    duplicateInFile: string;
    countryNotFound: string;
    globalLabel: string;
  },
): FertilizerProductImportPreview {
  const lookup = buildCountryLookup(countries);
  const existingKeys = new Set(
    existingRows.map((row) =>
      duplicateKey(String(row.name ?? ""), row.country_id ? Number(row.country_id) : null),
    ),
  );
  const seenInFile = new Set<string>();

  const previewRows: FertilizerProductImportPreviewRow[] = rows.map((row) => {
    const name = row.name.trim();
    if (!name) {
      return {
        ...row,
        status: "skip_invalid",
        reason: messages.nameRequired,
        country_label: "—",
      };
    }

    const countryResolved = resolveCountryId(row.country_raw, lookup);
    if (!countryResolved) {
      return {
        ...row,
        status: "skip_invalid",
        reason: messages.countryNotFound,
        country_label: row.country_raw || "—",
      };
    }

    const country_id = countryResolved.country_id;
    const country_label =
      country_id == null ? messages.globalLabel : countryResolved.country_label;
    const key = duplicateKey(name, country_id);

    if (existingKeys.has(key)) {
      return {
        ...row,
        name,
        country_id,
        status: "skip_duplicate",
        reason: messages.duplicateExisting,
        country_label,
      };
    }

    if (seenInFile.has(key)) {
      return {
        ...row,
        name,
        country_id,
        status: "skip_duplicate",
        reason: messages.duplicateInFile,
        country_label,
      };
    }

    seenInFile.add(key);
    return {
      ...row,
      name,
      country_id,
      status: "ready",
      reason: "",
      country_label,
    };
  });

  const summary = {
    total: previewRows.length,
    ready: 0,
    skip_duplicate: 0,
    skip_invalid: 0,
  };

  for (const row of previewRows) {
    summary[row.status]++;
  }

  return { rows: previewRows, summary };
}

export function downloadFertilizerProductImportTemplate(): void {
  const rows = [
    ["name", "uom", "country"],
    ["Urea 46%", "kg", "Vietnam"],
    ["NPK 16-16-8", "bag", ""],
    ["Organic compost", "tonne", "TH"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "fertilizer_products");
  XLSX.writeFile(workbook, "fertilizer-product-import-template.xlsx");
}
