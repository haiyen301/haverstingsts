import * as XLSX from "xlsx";

import type { FertilizerProductRow } from "@/features/admin/api/adminApi";
import type { FertilizerUsageImportEntryPayload } from "@/features/fertilizer/api/fertilizerUsageApi";
import {
  filterFarmZoneRowsByFarmId,
  parseFarmZoneEntries,
  type FarmZoneReferenceRow,
} from "@/shared/lib/harvestReferenceData";

export type FertilizerUsageImportInputRow = {
  row_index: number;
  date_raw: string;
  farm_raw: string;
  grass_raw: string;
  zone_raw: string;
  product_raw: string;
  amount_raw: string;
  rate_raw: string;
  rate_uom_raw: string;
  /** Issued by — names separated by `,` or `;`. */
  issued_by_raw: string;
  /** Received by — names separated by `,` or `;`. */
  received_by_raw: string;
  /** @deprecated Legacy column; merged into received_by when received_by empty. */
  operator_raw: string;
  transfer_farm_raw: string;
  notes_raw: string;
  alias_raw: string;
  /** Raw Excel cell, e.g. `a.jpg; b.png`. */
  images_raw: string;
};

/** Basename (lowercase) → File selected alongside the Excel workbook. */
export type FertilizerUsageImportImageMap = Map<string, File>;

export type FertilizerUsageImportPreviewStatus = "ready" | "invalid";

export type FertilizerUsageImportPreviewRow = {
  row_index: number;
  status: FertilizerUsageImportPreviewStatus;
  reason: string;
  applied_date: string;
  farm_label: string;
  grass_label: string;
  zone_label: string;
  product_label: string;
  /** Best fuzzy-match score against the fertilizer product catalog (0–1). */
  product_score: number;
  product_uom: string;
  amount: number;
  rate: number | null;
  rate_uom: string;
  /** Matched Issued by display names. */
  issued_by_label: string;
  /** Matched Received by display names. */
  received_by_label: string;
  /** Person names declared but not found in staff directory. */
  people_missing: string[];
  transfer_farm_label: string;
  notes: string;
  alias_title: string;
  /** Declared image file names from the Excel `images` column. */
  image_names: string[];
  /** Declared names matched to locally selected image files. */
  images_found: string[];
  /** Declared names not found among selected local files (server may still resolve). */
  images_missing: string[];
  entry: FertilizerUsageImportEntryPayload | null;
};

export type FertilizerUsageImportPreview = {
  rows: FertilizerUsageImportPreviewRow[];
  summary: { total: number; ready: number; invalid: number };
};

export type FertilizerUsageImportOption = { id: string; label: string };

export type FertilizerUsageImportReferences = {
  farms: FertilizerUsageImportOption[];
  grasses: FertilizerUsageImportOption[];
  products: FertilizerProductRow[];
  staffs: FertilizerUsageImportOption[];
  /** Raw farm-zone reference rows from the harvesting store. */
  farmZones: FarmZoneReferenceRow[];
};

export type FertilizerUsageImportMessages = {
  dateInvalid: string;
  farmNotFound: string;
  grassNotFound: string;
  zoneNotFound: string;
  productNotFound: string;
  amountInvalid: string;
  transferFarmInvalid: string;
};

/** Minimum fuzzy score required to accept a product name match. */
export const PRODUCT_MATCH_THRESHOLD = 0.5;

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return normalizeMatchText(value).replace(/\s+/g, "");
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map((header) => normalizeHeader(header));
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Lowercase, strip Vietnamese diacritics, collapse non-alphanumerics to spaces. */
export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Extract numeric zone index from Excel values like `Z1`, `Zone 1`, `Zone1`, `khu 2`.
 * Returns null when the value is not a numbered zone (e.g. `Zone A`).
 */
export function extractZoneNumber(raw: string): number | null {
  const text = normalizeMatchText(raw);
  if (!text) return null;
  const spaced = text.replace(/\s+/g, " ");
  const match =
    /^(?:z|zone|khu(?:\s*vuc)?)\s*0*(\d+)$/.exec(spaced) ??
    /^0*(\d+)$/.exec(spaced);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Comparable keys so `Z1` matches `Zone 1` / `Zone1` / label containing that number. */
function zoneMatchKeys(raw: string): Set<string> {
  const keys = new Set<string>();
  const norm = normalizeMatchText(raw);
  if (norm) {
    keys.add(norm);
    keys.add(norm.replace(/\s+/g, ""));
  }
  const n = extractZoneNumber(raw);
  if (n != null) {
    keys.add(`z${n}`);
    keys.add(`zone${n}`);
    keys.add(`zone ${n}`);
    keys.add(`khu ${n}`);
    keys.add(`khu vuc ${n}`);
    keys.add(`khuvuc${n}`);
  }
  return keys;
}

function findZoneOption(
  raw: string,
  options: [string, string][],
): { id: string; label: string } | null {
  const target = raw.trim();
  if (!target || options.length === 0) return null;

  const targetKeys = zoneMatchKeys(target);
  const targetNum = extractZoneNumber(target);

  for (const [id, label] of options) {
    const candidateKeys = new Set([...zoneMatchKeys(label), ...zoneMatchKeys(id)]);
    for (const key of targetKeys) {
      if (candidateKeys.has(key)) {
        return { id, label };
      }
    }
    if (targetNum != null) {
      const labelNum = extractZoneNumber(label);
      const idNum = extractZoneNumber(id);
      if (labelNum === targetNum || idNum === targetNum) {
        return { id, label };
      }
    }
  }

  let best: { id: string; label: string; score: number } | null = null;
  for (const [id, label] of options) {
    const score = Math.max(matchScore(target, label), matchScore(target, id));
    if (!best || score > best.score) {
      best = { id, label, score };
    }
  }
  if (best && best.score >= 0.7) {
    return { id: best.id, label: best.label };
  }
  return null;
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = value.replace(/\s+/g, " ");
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice bigram similarity between two normalized strings (0–1). */
function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of gramsA.values()) totalA += count;
  for (const count of gramsB.values()) totalB += count;
  for (const [gram, countA] of gramsA) {
    const countB = gramsB.get(gram);
    if (countB) overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (totalA + totalB);
}

/** Score how well `input` matches `candidate` (0–1). */
export function matchScore(input: string, candidate: string): number {
  const a = normalizeMatchText(input);
  const b = normalizeMatchText(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = diceCoefficient(a, b);
  if (a.includes(b) || b.includes(a)) {
    return Math.max(0.85, dice);
  }
  return dice;
}

export function findBestProductMatch(
  name: string,
  products: FertilizerProductRow[],
): { product: FertilizerProductRow; score: number } | null {
  let best: { product: FertilizerProductRow; score: number } | null = null;
  for (const product of products) {
    const score = matchScore(name, String(product.name ?? ""));
    if (!best || score > best.score) {
      best = { product, score };
    }
  }
  if (!best || best.score < PRODUCT_MATCH_THRESHOLD) return null;
  return best;
}

function findExactishOption(
  raw: string,
  options: FertilizerUsageImportOption[],
): FertilizerUsageImportOption | null {
  const target = normalizeMatchText(raw);
  if (!target) return null;
  let best: { option: FertilizerUsageImportOption; score: number } | null = null;
  for (const option of options) {
    const score = matchScore(raw, option.label);
    if (!best || score > best.score) {
      best = { option, score };
    }
  }
  if (best && best.score >= 0.7) return best.option;
  return null;
}

function parseImportDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (dmy) {
    const [, d, m, yRaw] = dmy;
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const month = Number(m);
    const day = Number(d);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function parseImportNumber(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Basename for local file lookup (ignores month folder prefix). */
export function importImageLookupKey(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const basename = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return basename.toLowerCase();
}

/**
 * Split Excel person cell into names.
 * Multiple people: `Anh Thi, Brad Burgess` or `Anh Thi; Brad Burgess`.
 */
export function parsePersonNames(raw: string): string[] {
  const parts = raw
    .split(/[;,\n|]+/)
    .map((part) => part.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of parts) {
    const key = normalizeMatchText(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

/** Resolve Excel person names against staff directory (fuzzy label match). */
export function resolveImportPeople(
  raw: string,
  staffs: FertilizerUsageImportOption[],
): { ids: number[]; labels: string[]; missing: string[] } {
  const names = parsePersonNames(raw);
  const ids: number[] = [];
  const labels: string[] = [];
  const missing: string[] = [];
  const seenIds = new Set<number>();

  for (const name of names) {
    const match = findExactishOption(name, staffs);
    if (!match) {
      missing.push(name);
      continue;
    }
    const id = Number(match.id);
    if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
    labels.push(match.label);
  }

  return { ids, labels, missing };
}

/**
 * Split Excel `images` cell into declared paths.
 * Supports `07/photo.jpg`, `photo.jpg`, or `photo1.jpg; photo2.jpg`.
 */
export function parseImageFilenames(raw: string): string[] {
  const parts = raw
    .split(/[;,\n|]+/)
    .map((part) => part.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean)
    .map((part) => part.replace(/\\/g, "/").replace(/^\/+/, ""));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of parts) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

/** Build a lookup map from selected local image files (keyed by lowercase basename). */
export function buildImportImageMap(files: File[]): FertilizerUsageImportImageMap {
  const map: FertilizerUsageImportImageMap = new Map();
  for (const file of files) {
    const name = file.name.trim();
    if (!name) continue;
    map.set(name.toLowerCase(), file);
  }
  return map;
}

/** Resolve File objects for a preview row from the local image map. */
export function resolveImportImageFiles(
  row: Pick<FertilizerUsageImportPreviewRow, "images_found">,
  imagesByName: FertilizerUsageImportImageMap,
): File[] {
  const files: File[] = [];
  for (const name of row.images_found) {
    const file = imagesByName.get(importImageLookupKey(name));
    if (file) files.push(file);
  }
  return files;
}

export function parseFertilizerUsageImportWorkbook(
  buffer: ArrayBuffer,
): FertilizerUsageImportInputRow[] {
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
    date: findHeaderIndex(headers, ["date", "applieddate", "ngay", "ngayapdung"]),
    farm: findHeaderIndex(headers, ["farm", "farmname", "trangtrai", "nongtrai"]),
    grass: findHeaderIndex(headers, ["grass", "grasstype", "loaico", "co"]),
    zone: findHeaderIndex(headers, ["zone", "zonename", "khuvuc", "khu"]),
    product: findHeaderIndex(headers, ["product", "productname", "sanpham", "phanbon"]),
    amount: findHeaderIndex(headers, ["amount", "amountused", "quantity", "soluong", "luongdung"]),
    rate: findHeaderIndex(headers, ["rate", "tile", "lieuluong"]),
    rateUom: findHeaderIndex(headers, ["rateunit", "rateuom", "donvirate", "donvilieuluong"]),
    issuedBy: findHeaderIndex(headers, [
      "issuedby",
      "issued_by",
      "sender",
      "bengiao",
      "nguoigiao",
      "deliveredby",
    ]),
    receivedBy: findHeaderIndex(headers, [
      "receivedby",
      "received_by",
      "receiver",
      "bennhan",
      "nguoinhan",
    ]),
    operator: findHeaderIndex(headers, ["operator", "nguoivanhanh", "nguoithuchien"]),
    transferFarm: findHeaderIndex(headers, [
      "transfertofarm",
      "transferfarm",
      "chuyendentrangtrai",
      "chuyenden",
    ]),
    notes: findHeaderIndex(headers, ["notes", "note", "ghichu"]),
    alias: findHeaderIndex(headers, ["aliastitle", "alias", "tengoikhac", "bidanh"]),
    images: findHeaderIndex(headers, [
      "images",
      "image",
      "photos",
      "photo",
      "hinhanh",
      "anh",
      "filenames",
      "files",
    ]),
  };

  if (idx.date < 0 || idx.farm < 0 || idx.product < 0 || idx.amount < 0) {
    throw new Error("missingColumns");
  }

  const rows: FertilizerUsageImportInputRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const pick = (index: number): string => (index >= 0 ? cellText(line[index]) : "");
    const row: FertilizerUsageImportInputRow = {
      row_index: i + 1,
      date_raw: pick(idx.date),
      farm_raw: pick(idx.farm),
      grass_raw: pick(idx.grass),
      zone_raw: pick(idx.zone),
      product_raw: pick(idx.product),
      amount_raw: pick(idx.amount),
      rate_raw: pick(idx.rate),
      rate_uom_raw: pick(idx.rateUom),
      issued_by_raw: pick(idx.issuedBy),
      received_by_raw: pick(idx.receivedBy),
      operator_raw: pick(idx.operator),
      transfer_farm_raw: pick(idx.transferFarm),
      notes_raw: pick(idx.notes),
      alias_raw: pick(idx.alias),
      images_raw: pick(idx.images),
    };
    const hasAny = Object.entries(row).some(
      ([key, value]) => key !== "row_index" && String(value).trim() !== "",
    );
    if (hasAny) rows.push(row);
  }

  if (!rows.length) {
    throw new Error("noRows");
  }

  return rows;
}

export function buildFertilizerUsageImportPreview(
  rows: FertilizerUsageImportInputRow[],
  refs: FertilizerUsageImportReferences,
  messages: FertilizerUsageImportMessages,
  imagesByName: FertilizerUsageImportImageMap = new Map(),
): FertilizerUsageImportPreview {
  const zoneOptionsByFarmId = new Map<string, [string, string][]>();
  const zoneOptionsForFarm = (farmId: string): [string, string][] => {
    const cached = zoneOptionsByFarmId.get(farmId);
    if (cached) return cached;
    const entries = parseFarmZoneEntries(
      filterFarmZoneRowsByFarmId(refs.farmZones, farmId),
      "id",
    );
    zoneOptionsByFarmId.set(farmId, entries);
    return entries;
  };

  const previewRows: FertilizerUsageImportPreviewRow[] = rows.map((row) => {
    const imageNames = parseImageFilenames(row.images_raw);
    const imagesFound = imageNames.filter((name) =>
      imagesByName.has(importImageLookupKey(name)),
    );
    const imagesMissing = imageNames.filter(
      (name) => !imagesByName.has(importImageLookupKey(name)),
    );

    const receivedByRaw = row.received_by_raw.trim() || row.operator_raw.trim();
    const issuedPeople = resolveImportPeople(row.issued_by_raw, refs.staffs);
    const receivedPeople = resolveImportPeople(receivedByRaw, refs.staffs);
    const peopleMissing = [...issuedPeople.missing, ...receivedPeople.missing];

    const base: FertilizerUsageImportPreviewRow = {
      row_index: row.row_index,
      status: "invalid",
      reason: "",
      applied_date: "",
      farm_label: row.farm_raw,
      grass_label: row.grass_raw,
      zone_label: row.zone_raw,
      product_label: row.product_raw,
      product_score: 0,
      product_uom: "",
      amount: 0,
      rate: null,
      rate_uom: row.rate_uom_raw,
      issued_by_label: issuedPeople.labels.join(", "),
      received_by_label: receivedPeople.labels.join(", "),
      people_missing: peopleMissing,
      transfer_farm_label: row.transfer_farm_raw,
      notes: row.notes_raw,
      alias_title: row.alias_raw,
      image_names: imageNames,
      images_found: imagesFound,
      images_missing: imagesMissing,
      entry: null,
    };

    const appliedDate = parseImportDate(row.date_raw);
    if (!appliedDate) {
      return { ...base, reason: messages.dateInvalid };
    }
    base.applied_date = appliedDate;

    const farm = findExactishOption(row.farm_raw, refs.farms);
    if (!farm) {
      return { ...base, reason: messages.farmNotFound };
    }
    base.farm_label = farm.label;

    const grass = findExactishOption(row.grass_raw, refs.grasses);
    if (!grass) {
      return { ...base, reason: messages.grassNotFound };
    }
    base.grass_label = grass.label;

    const zoneOptions = zoneOptionsForFarm(farm.id);
    const zoneMatch = findZoneOption(row.zone_raw, zoneOptions);
    if (!zoneMatch) {
      return { ...base, reason: messages.zoneNotFound };
    }
    base.zone_label = zoneMatch.label;
    const zoneId = zoneMatch.id;

    const productMatch = findBestProductMatch(row.product_raw, refs.products);
    if (!productMatch) {
      return { ...base, reason: messages.productNotFound };
    }
    base.product_label = String(productMatch.product.name ?? row.product_raw);
    base.product_score = productMatch.score;
    base.product_uom = String(productMatch.product.uom ?? "").trim();

    const amount = parseImportNumber(row.amount_raw);
    if (amount == null || amount <= 0) {
      return { ...base, reason: messages.amountInvalid };
    }
    base.amount = amount;

    let isTransfer = false;
    let transferToFarmId: number | null = null;
    if (row.transfer_farm_raw.trim()) {
      const transferFarm = findExactishOption(row.transfer_farm_raw, refs.farms);
      if (!transferFarm || transferFarm.id === farm.id) {
        return { ...base, reason: messages.transferFarmInvalid };
      }
      isTransfer = true;
      transferToFarmId = Number(transferFarm.id);
      base.transfer_farm_label = transferFarm.label;
    }

    const rate = parseImportNumber(row.rate_raw);
    base.rate = rate != null && rate > 0 ? rate : null;

    const softWarnings: string[] = [];
    // Local missing images are a soft warning — backend may still resolve from disk.
    if (imagesMissing.length > 0 && imagesByName.size > 0) {
      softWarnings.push(imagesMissing.join(", "));
    }
    if (peopleMissing.length > 0) {
      softWarnings.push(peopleMissing.join(", "));
    }
    if (softWarnings.length > 0) {
      base.reason = softWarnings.join("; ");
    }

    base.status = "ready";
    base.entry = {
      applied_date: appliedDate,
      farm_id: Number(farm.id),
      grass_id: Number(grass.id),
      zone_id: zoneId,
      item_id: Number(productMatch.product.id),
      amount,
      is_transfer: isTransfer,
      transfer_to_farm_id: transferToFarmId,
      rate: base.rate,
      rate_uom: row.rate_uom_raw.trim() || null,
      sender_user_ids: issuedPeople.ids,
      receiver_user_ids: receivedPeople.ids,
      notes: row.notes_raw.trim() || null,
      alias_title: row.alias_raw.trim() || null,
      client_row_index: row.row_index,
      image_names: imageNames.length > 0 ? imageNames : undefined,
    };
    return base;
  });

  const summary = { total: previewRows.length, ready: 0, invalid: 0 };
  for (const row of previewRows) {
    if (row.status === "ready") summary.ready++;
    else summary.invalid++;
  }

  return { rows: previewRows, summary };
}

/** Sample image paths from files/timeline_files/fertilizer_usage/ on the server. */
const FERTILIZER_USAGE_IMPORT_SAMPLE_IMAGES = {
  row2a:
    "07/1784276782_file6a59e72e4adb5-WhatsApp-Image-2026-07-17-at-14.35.40--2-.jpeg",
  row2b:
    "07/1784276782_file6a59e72e466bc-WhatsApp-Image-2026-07-17-at-14.35.40--3-.jpeg",
  row3: "07/1784277507_file6a59ea0396cb6-WhatsApp-Image-2026-07-17-at-14.35.38.jpeg",
} as const;

export function downloadFertilizerUsageImportTemplate(): void {
  const rows = [
    [
      "date",
      "farm",
      "grass",
      "zone",
      "product",
      "amount",
      "rate",
      "rate_unit",
      "issued_by",
      "received_by",
      "transfer_to_farm",
      "notes",
      "alias_title",
      "images",
    ],
    [
      "2026-07-01",
      "Ban Beung",
      "Zoysia",
      "Z1",
      "NPK 16-16-8",
      "50",
      "30",
      "kg/ha",
      "Anh Thi Nguyen Huynh, Brad Burgess",
      "Chau Thien Tan Pham",
      "",
      "",
      "NPK yellow bag",
      `${FERTILIZER_USAGE_IMPORT_SAMPLE_IMAGES.row2a}; ${FERTILIZER_USAGE_IMPORT_SAMPLE_IMAGES.row2b}`,
    ],
    [
      "02/07/2026",
      "Ban Beung",
      "Zoysia",
      "Z2",
      "Urea 46%",
      "25",
      "",
      "",
      "Brad Burgess",
      "Anh Thi Nguyen Huynh, Chau Thien Tan Pham",
      "Hoi An",
      "Transferred for trial",
      "",
      FERTILIZER_USAGE_IMPORT_SAMPLE_IMAGES.row3,
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "fertilizer_usage");
  XLSX.writeFile(workbook, "fertilizer-usage-import-template.xlsx");
}
