"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, FlaskConical, CheckCircle2, Download, ExternalLink } from "lucide-react";
import * as XLSX from "xlsx";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { AlertRouteCategoryBanner } from "@/features/alerts/AlertRouteCategoryBanner";
import { dispatchRouteAlert } from "@/features/alerts/dispatchRouteAlert";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { canAccessModule } from "@/shared/auth/permissions";
import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";
import { downloadHarvestImportErrors } from "@/features/harvesting/lib/harvestImportErrorExport";
import { stsProxyGetHarvestingIndex, stsProxyPostJson } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import { compareNumbers, compareStrings } from "@/shared/lib/tableSort";
import { cn } from "@/lib/utils";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import {
  harvestTypeDisplayLabel,
  normalizeHarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

type FieldKey =
  | "customerName"
  | "projectName"
  | "name"
  | "farm"
  | "zone"
  | "grass"
  | "turfType"
  | "harvestType"
  | "uom"
  | "quantity"
  | "refHrvQtySprig"
  | "referenceHarvestUom"
  | "estimatedDate"
  | "estimatedDateEnd"
  | "actualDate"
  | "actualHarvestEndDate"
  | "deliveryDate"
  | "shipmentRequiredDate"
  | "doSoDate"
  | "doSoNumber"
  | "truckNote"
  | "shippingDispatchDetails"
  | "generalNote"
  | "licensePlate"
  | "paymentId"
  | "country"
  | "harvestedArea";

type ExcelRow = Record<string, unknown>;
type FieldMapping = Record<FieldKey, string>;

type RowIssue = { rowIndex: number; messages: string[] };

type MappedRow = {
  rowNumber: number;
  source: ExcelRow;
  customerName: string;
  projectName: string;
  name: string;
  farm: string;
  zone: string;
  grass: string;
  turfType: string;
  harvestType: string; // sod | sprig | sod_to_sprig
  quantity: string;
  uom: "M2" | "Kg";
  refHrvQtySprig: string;
  referenceHarvestUom: string;
  estimatedDate: string;
  estimatedDateEnd: string;
  actualDate: string;
  actualHarvestEndDate: string;
  deliveryDate: string;
  shipmentRequiredDate: string;
  doSoDate: string;
  doSoNumber: string;
  truckNote: string;
  shippingDispatchDetails: string;
  generalNote: string;
  licensePlate: string;
  paymentId: string;
  country: string;
  harvestedArea: string;
};

type DynamicProjectRow = {
  id_row?: string;
  table_id?: string;
  project_id?: string;
};

type TestResult = {
  warningRows: number;
  rowsWithWarnings: RowIssue[];
};

type ImportLog = {
  rowNumber: number;
  status: "success" | "error";
  message: string;
  source: ExcelRow;
  harvestId?: string;
  projectName?: string;
  farm?: string;
  zone?: string;
  grass?: string;
  quantity?: string;
  uom?: string;
};

const HARVEST_IMPORT_RETURN_TO = "/harvest/import";

const FIELDS: { key: FieldKey }[] = [
  { key: "customerName" },
  { key: "projectName" },
  { key: "name" },
  { key: "farm" },
  { key: "zone" },
  { key: "grass" },
  { key: "turfType" },
  { key: "harvestType" },
  { key: "uom" },
  { key: "quantity" },
  { key: "refHrvQtySprig" },
  { key: "referenceHarvestUom" },
  { key: "harvestedArea" },
  { key: "estimatedDate" },
  { key: "estimatedDateEnd" },
  { key: "actualDate" },
  { key: "actualHarvestEndDate" },
  { key: "deliveryDate" },
  { key: "shipmentRequiredDate" },
  { key: "doSoDate" },
  { key: "doSoNumber" },
  { key: "truckNote" },
  { key: "shippingDispatchDetails" },
  { key: "generalNote" },
  { key: "licensePlate" },
  { key: "paymentId" },
  { key: "country" },
];

function normalizeHeader(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toStringSafe(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeLoose(v: string): string {
  return v
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function tokensOf(v: string): string[] {
  return normalizeLoose(v).split(" ").filter(Boolean);
}

function toIsoDate(y: number, m: number, d: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1900 || y > 2200) return "";
  if (m < 1 || m > 12) return "";
  if (d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return "";
  }
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseFlexibleDateString(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const isoDayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoDayOnly) {
    const y = Number.parseInt(isoDayOnly[1], 10);
    const m = Number.parseInt(isoDayOnly[2], 10);
    const d = Number.parseInt(isoDayOnly[3], 10);
    return toIsoDate(y, m, d);
  }
  const firstChunk = s.split(" ")[0]?.trim() ?? s;
  const cleaned = firstChunk.replace(/\./g, "/").replace(/-/g, "/");
  const parts = cleaned.split("/").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 3) {
    const a = Number.parseInt(parts[0], 10);
    const b = Number.parseInt(parts[1], 10);
    const c = Number.parseInt(parts[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
      if (parts[0].length === 4) {
        return toIsoDate(a, b, c);
      }
      if (parts[2].length === 4) {
        // Default dd/mm/yyyy for spreadsheet manual input; fallback by range.
        if (a > 12) return toIsoDate(c, b, a);
        if (b > 12) return toIsoDate(c, a, b);
        return toIsoDate(c, b, a);
      }
    }
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return "";
}

/** Date from the Excel parser: use the instance as-is; read y/m/d with local getters (no UTC conversion). */
function dateToIsoFromExcelDate(d: Date): string {
  return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

type ExcelDateParseOpts = {
  /** Workbook uses 1904 date system (Excel Mac); required for correct serial → day when cell is number. */
  date1904?: boolean;
};

function tryParseDate(v: unknown, opts?: ExcelDateParseOpts): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return dateToIsoFromExcelDate(v);
  }
  if (typeof v === "number") {
    const excelDate = XLSX.SSF.parse_date_code(v, {
      date1904: opts?.date1904 === true,
    });
    if (excelDate) {
      const yyyy = String(excelDate.y).padStart(4, "0");
      const mm = String(excelDate.m).padStart(2, "0");
      const dd = String(excelDate.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  const s = toStringSafe(v);
  if (!s) return "";
  return parseFlexibleDateString(s);
}

// Logs `[HarvestImport:dates] …` in the browser console. Set to `true` to debug in production builds.
const DEBUG_IMPORT_DATES =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

function logHarvestImportDates(
  label: string,
  payload: Record<string, unknown>,
): void {
  if (!DEBUG_IMPORT_DATES) return;
  console.log(`[HarvestImport:dates] ${label}`, payload);
}

function normalizeHarvestType(v: string): { harvestType: string; uom: "M2" | "Kg" } {
  const key = normalizeHarvestTypeStorageKey(v);
  if (key) {
    return { harvestType: key, uom: key === "sod" ? "M2" : "Kg" };
  }
  const s = normalizeLoose(v);
  if (!s) return { harvestType: "", uom: "M2" };
  // Accept mixed strings when harvest type column only has UOM hints (e.g. "Sprig / KG", "Sod - M2").
  if (s === "m2" || s === "m²" || s.includes("m2") || s.includes("m²")) {
    return { harvestType: "sod", uom: "M2" };
  }
  if (s === "kg" || s.includes("kg")) {
    return { harvestType: "sprig", uom: "Kg" };
  }
  return { harvestType: "", uom: "M2" };
}

function normalizeUom(v: string, fallback: "M2" | "Kg"): "M2" | "Kg" {
  const s = normalizeLoose(v);
  if (!s) return fallback;
  if (s === "kg" || s.includes("kg")) return "Kg";
  if (s === "m2" || s === "m²" || s.includes("m2") || s.includes("sqm")) return "M2";
  return fallback;
}

function suggestMapping(headers: string[]): FieldMapping {
  const byNorm = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const pick = (candidates: string[]) => {
    for (const c of candidates) {
      const exact = byNorm.get(normalizeHeader(c));
      if (exact) return exact;
      const contains = headers.find((h) =>
        normalizeHeader(h).includes(normalizeHeader(c)),
      );
      if (contains) return contains;
    }
    return "";
  };
  return {
    customerName: pick(["customer", "customer name"]),
    projectName: pick(["project", "project name"]),
    name: pick(["name", "harvest name"]),
    farm: pick(["farm", "farm name"]),
    zone: pick(["zone"]),
    grass: pick(["grass", "grass type", "product"]),
    turfType: pick(["turf type", "turf_type"]),
    harvestType: pick([
      "harvest type",
      "load type",
      "sod/sprig",
      "sod sprig",
      "sod to sprig",
      "sod for sprig",
      "type",
    ]),
    uom: pick(["uom", "unit"]),
    quantity: pick(["quantity", "qty"]),
    refHrvQtySprig: pick(["ref harvest qty sprig", "ref_hrv_qty_sprig", "reference harvest qty"]),
    referenceHarvestUom: pick(["reference harvest uom", "reference_harvest_uom"]),
    estimatedDate: pick(["estimated harvest date", "estimated date", "estimate date", "est. date"]),
    estimatedDateEnd: pick(["estimated harvest end date", "estimated end date", "est. end date"]),
    actualDate: pick(["actual harvest date", "actual date", "harvest date"]),
    actualHarvestEndDate: pick(["actual harvest end date", "harvest end date", "actual end date"]),
    deliveryDate: pick(["delivery harvest date", "delivery date"]),
    shipmentRequiredDate: pick(["shipment required date", "port arrival date", "port arrival"]),
    doSoNumber: pick(["do/so", "do so", "do so number", "do_so_number", "do/so #"]),
    doSoDate: pick(["do so date", "do_so_date", "doso date", "do/so date"]),
    truckNote: pick(["truck note", "note"]),
    shippingDispatchDetails: pick(["shipping dispatch details", "shipping/dispatch", "dispatch details"]),
    generalNote: pick(["general note", "general_note", "general comments"]),
    licensePlate: pick(["license plate", "license", "plate"]),
    paymentId: pick(["payment id", "payment_id", "payment"]),
    country: pick(["country", "country code"]),
    harvestedArea: pick(["harvested area", "area"]),
  };
}

export default function HarvestImportPage() {
  const tBase = useAppTranslations();
  const t = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) =>
    values
      ? tBase(`HarvestImport.${key}`, values as Parameters<typeof tBase>[1])
      : tBase(`HarvestImport.${key}`);
  const router = useRouter();
  const user = useAuthUserStore((s) => s.user);
  const canImportHarvest = canAccessModule(user, "harvests", "import");
  const importDenied = Boolean(user) && !canImportHarvest;
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ExcelRow[]>([]);
  const [mapping, setMapping] = useState<FieldMapping | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [selectedImportRows, setSelectedImportRows] = useState<Set<number>>(
    () => new Set(),
  );
  const [downloadingErrors, setDownloadingErrors] = useState(false);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [currentFileHash, setCurrentFileHash] = useState("");
  /** Matches `wb.Workbook.WBProps.date1904` from the uploaded file (SheetJS). */
  const [workbookDate1904, setWorkbookDate1904] = useState(false);
  const [sameFileWarning, setSameFileWarning] = useState("");
  const [dynamicRowCache, setDynamicRowCache] = useState<
    Map<string, { idRow: string; tableId: string }>
  >(new Map());

  const farms = useHarvestingDataStore((s) => s.farms);
  const projects = useHarvestingDataStore((s) => s.projects);
  const allProjects = useHarvestingDataStore((s) => s.allProjects);
  const products = useHarvestingDataStore((s) => s.products);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmCandidates = useMemo(() => {
    return (farms as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({ id: toStringSafe(x.id), label: toStringSafe(x.name ?? x.title) }))
      .filter((x) => x.id && x.label);
  }, [farms]);

  const projectCandidates = useMemo(() => {
    return (projects as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        id: toStringSafe(x.id),
        label: toStringSafe(x.title ?? x.name),
      }))
      .filter((x) => x.id && x.label);
  }, [projects]);

  const productCandidates = useMemo(() => {
    return (products as unknown[])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        id: toStringSafe(x.id),
        label: toStringSafe(x.name ?? x.title),
      }))
      .filter((x) => x.id && x.label);
  }, [products]);

  const customerCandidates = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of allProjects as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const cid = toStringSafe(row.odoo_customer_id);
      if (!cid) continue;
      const label =
        toStringSafe(row.company_name ?? row.alias_title) || cid;
      if (!m.has(cid)) m.set(cid, label);
    }
    return Array.from(m.entries()).map(([id, label]) => ({ id, label }));
  }, [allProjects]);

  const resolveByLooseText = (
    raw: string,
    candidates: { id: string; label: string }[],
  ): string => {
    const text = raw.trim();
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;
    const norm = normalizeLoose(text);
    const qTokens = tokensOf(text);
    const exact = candidates.find((c) => normalizeLoose(c.label) === norm);
    if (exact) return exact.id;
    const tokenMatch = candidates.find((c) => {
      const cNorm = normalizeLoose(c.label);
      return qTokens.length > 0 && qTokens.every((t) => cNorm.includes(t));
    });
    if (tokenMatch) return tokenMatch.id;
    const like = candidates.find((c) => {
      const cNorm = normalizeLoose(c.label);
      return cNorm.includes(norm) || norm.includes(cNorm);
    });
    return like?.id ?? "";
  };

  const mappedRows = useMemo((): MappedRow[] => {
    if (!mapping) return [];
    const dateOpts = { date1904: workbookDate1904 };
    return rows.map((r, i) => {
      const get = (k: FieldKey) => r[mapping[k]];
      const ht = normalizeHarvestType(toStringSafe(get("harvestType")));
      const uom = normalizeUom(toStringSafe(get("uom")), ht.uom);
      return {
        rowNumber: i + 2,
        source: r,
        customerName: toStringSafe(get("customerName")),
        projectName: toStringSafe(get("projectName")),
        name: toStringSafe(get("name")),
        farm: toStringSafe(get("farm")),
        zone: toStringSafe(get("zone")),
        grass: toStringSafe(get("grass")),
        turfType: toStringSafe(get("turfType")),
        harvestType: ht.harvestType || "",
        quantity: toStringSafe(get("quantity")).replaceAll(",", ""),
        uom,
        refHrvQtySprig: toStringSafe(get("refHrvQtySprig")).replaceAll(",", ""),
        referenceHarvestUom: toStringSafe(get("referenceHarvestUom")),
        estimatedDate: tryParseDate(get("estimatedDate"), dateOpts),
        estimatedDateEnd: tryParseDate(get("estimatedDateEnd"), dateOpts),
        actualDate: tryParseDate(get("actualDate"), dateOpts),
        actualHarvestEndDate: tryParseDate(get("actualHarvestEndDate"), dateOpts),
        deliveryDate: tryParseDate(get("deliveryDate"), dateOpts),
        shipmentRequiredDate: tryParseDate(get("shipmentRequiredDate"), dateOpts),
        doSoDate: tryParseDate(get("doSoDate"), dateOpts),
        doSoNumber: toStringSafe(get("doSoNumber")),
        truckNote: toStringSafe(get("truckNote")),
        shippingDispatchDetails: toStringSafe(get("shippingDispatchDetails")),
        generalNote: toStringSafe(get("generalNote")),
        licensePlate: toStringSafe(get("licensePlate")),
        paymentId: toStringSafe(get("paymentId")),
        country: toStringSafe(get("country")),
        harvestedArea: toStringSafe(get("harvestedArea")).replaceAll(",", ""),
      };
    });
  }, [mapping, rows, workbookDate1904]);

  type HarvestImportSortKey =
    | "index"
    | "project"
    | "farm"
    | "zone"
    | "grass"
    | "type"
    | "uom"
    | "qty"
    | "dates";

  const { sortKey, sortDir, onSort } =
    useTableColumnSort<HarvestImportSortKey>("project");

  const warningByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const w of testResult?.rowsWithWarnings ?? []) {
      m.set(w.rowIndex, w.messages);
    }
    return m;
  }, [testResult]);

  const sortedMappedRows = useMemo(() => {
    const list = [...mappedRows];
    list.sort((a, b) => {
      switch (sortKey) {
        case "index":
          return compareNumbers(a.rowNumber, b.rowNumber, sortDir);
        case "project":
          return compareStrings(a.projectName, b.projectName, sortDir);
        case "farm":
          return compareStrings(a.farm, b.farm, sortDir);
        case "zone":
          return compareStrings(a.zone, b.zone, sortDir);
        case "grass":
          return compareStrings(a.grass, b.grass, sortDir);
        case "type":
          return compareStrings(a.harvestType, b.harvestType, sortDir);
        case "uom":
          return compareStrings(a.uom, b.uom, sortDir);
        case "qty":
          return compareStrings(a.quantity, b.quantity, sortDir);
        case "dates": {
          const da = `${a.estimatedDate || ""}|${a.actualDate || ""}`;
          const db = `${b.estimatedDate || ""}|${b.actualDate || ""}`;
          return compareStrings(da, db, sortDir);
        }
        default:
          return 0;
      }
    });
    return list;
  }, [mappedRows, sortKey, sortDir]);

  const buildHarvestBusinessKey = (input: {
    projectId: string;
    farmId: string;
    zone: string;
    productId: string;
    uom: string;
    quantity: string;
    estimatedDate: string;
    actualDate: string;
    deliveryDate: string;
  }): string => {
    return [
      input.projectId.trim(),
      input.farmId.trim(),
      normalizeLoose(input.zone),
      input.productId.trim(),
      input.uom.trim().toLowerCase(),
      input.quantity.trim(),
      input.estimatedDate.trim(),
      input.actualDate.trim(),
      input.deliveryDate.trim(),
    ].join("|");
  };

  const computeFileHash = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  };


  const getDynamicRowForProjectId = async (
    projectId: string,
  ): Promise<{ idRow: string; tableId: string } | null> => {
    const pid = projectId.trim();
    if (!pid) return null;
    const cached = dynamicRowCache.get(pid);
    if (cached) return cached;
    const rows = await stsProxyPostJson<unknown[]>(STS_API_PATHS.mondayFindDynamicByField, {
      field_name: "project_id",
      field_value: pid,
    });
    const list = Array.isArray(rows) ? (rows as DynamicProjectRow[]) : [];
    const first = list.find((r) => r && typeof r === "object") ?? null;
    const idRow = String(first?.id_row ?? "").trim();
    const tableId = String(first?.table_id ?? "").trim();
    if (!idRow || !tableId) return null;
    const next = new Map(dynamicRowCache);
    next.set(pid, { idRow, tableId });
    setDynamicRowCache(next);
    return { idRow, tableId };
  };

  const handleFile = async (file: File) => {
    setError("");
    setSummary("");
    setTestResult(null);
    setImportLogs([]);
    setImportPickerOpen(false);
    setSelectedImportRows(new Set());
    const hash = await computeFileHash(file);
    setCurrentFileHash(hash);
    const lastHash = localStorage.getItem("stsrenew:harvest-import:last-file-hash") ?? "";
    if (lastHash && lastHash === hash) {
      setSameFileWarning(t("sameFileWarning"));
    } else {
      setSameFileWarning("");
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const wbProps = (wb as { Workbook?: { WBProps?: { date1904?: boolean | string | number } } })
      .Workbook?.WBProps;
    const d1904 = wbProps?.date1904;
    setWorkbookDate1904(
      d1904 === true || d1904 === 1 || d1904 === "true" || d1904 === "1",
    );
    const sheetName =
      wb.SheetNames.find((n) => n.trim().toLowerCase() === "data") ??
      wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      setError(t("invalidSheet"));
      return;
    }
    const data = XLSX.utils.sheet_to_json<ExcelRow>(sheet, { defval: "" });
    if (!data.length) {
      setError(t("emptyExcel"));
      return;
    }
    const h = Object.keys(data[0] ?? {});
    setRows(data);
    setHeaders(h);
    setFileName(file.name);
    setMapping(suggestMapping(h));
  };

  const runTest = async () => {
    if (!canImportHarvest) {
      setError("You do not have permission to import harvest data.");
      return;
    }
    setTesting(true);
    try {
      if (mapping) {
        const dateKeys: FieldKey[] = [
          "estimatedDate",
          "estimatedDateEnd",
          "actualDate",
          "actualHarvestEndDate",
          "deliveryDate",
          "shipmentRequiredDate",
          "doSoDate",
        ];
        logHarvestImportDates("test data (column mapping + raw vs parsed)", {
          workbookDate1904,
          mappingDates: Object.fromEntries(
            dateKeys.map((k) => [k, mapping[k] || ""]),
          ),
          firstRows: mappedRows.slice(0, 8).map((r) => ({
            row: r.rowNumber,
            raw: {
              estimatedDate: mapping.estimatedDate
                ? r.source[mapping.estimatedDate]
                : undefined,
              actualDate: mapping.actualDate
                ? r.source[mapping.actualDate]
                : undefined,
              deliveryDate: mapping.deliveryDate
                ? r.source[mapping.deliveryDate]
                : undefined,
              doSoDate: mapping.doSoDate ? r.source[mapping.doSoDate] : undefined,
            },
            rawTypes: {
              estimatedDate: mapping.estimatedDate
                ? typeof r.source[mapping.estimatedDate]
                : undefined,
              actualDate: mapping.actualDate
                ? typeof r.source[mapping.actualDate]
                : undefined,
              deliveryDate: mapping.deliveryDate
                ? typeof r.source[mapping.deliveryDate]
                : undefined,
              doSoDate: mapping.doSoDate
                ? typeof r.source[mapping.doSoDate]
                : undefined,
            },
            parsed: {
              estimatedDate: r.estimatedDate,
              actualDate: r.actualDate,
              deliveryDate: r.deliveryDate,
              doSoDate: r.doSoDate,
            },
          })),
        });
      }
      const warnings: RowIssue[] = [];
      const seenBatchKeys = new Set<string>();
      for (const r of mappedRows) {
        const w: string[] = [];
        if (!r.projectName) w.push(t("warnProjectEmpty"));
        if (!r.farm) w.push(t("warnFarmEmpty"));
        if (!r.zone) w.push(t("warnZoneEmpty"));
        if (!r.grass) w.push(t("warnGrassEmpty"));
        const qty = Number.parseFloat(r.quantity);
        if (!Number.isFinite(qty) || qty <= 0) w.push(t("warnQuantityInvalid"));
        if (!r.estimatedDate && !r.actualDate) w.push(t("warnDatePairEmpty"));
        if (!r.harvestType) w.push(t("warnHarvestTypeInvalid"));
        const projectId = resolveByLooseText(r.projectName, projectCandidates);
        if (r.projectName && !projectId) {
          w.push(t("warnProjectNotFound", { value: r.projectName }));
        }
        const farmId = resolveByLooseText(r.farm, farmCandidates);
        if (r.farm && !farmId) {
          w.push(t("warnFarmNotFound", { value: r.farm }));
        }
        const productId = resolveByLooseText(r.grass, productCandidates);
        if (r.grass && !productId) {
          w.push(t("warnGrassNotFound", { value: r.grass }));
        }
        if (projectId) {
          const rowKey = buildHarvestBusinessKey({
            projectId,
            farmId: resolveByLooseText(r.farm, farmCandidates),
            zone: r.zone,
            productId: resolveByLooseText(r.grass, productCandidates),
            uom: r.uom,
            quantity: r.quantity,
            estimatedDate: r.estimatedDate,
            actualDate: r.actualDate,
            deliveryDate: r.deliveryDate,
          });
          if (seenBatchKeys.has(rowKey)) {
            w.push(t("warnDuplicateFile"));
          } else {
            seenBatchKeys.add(rowKey);
          }
        }
        if (w.length) warnings.push({ rowIndex: r.rowNumber, messages: w });
      }
      setTestResult({ warningRows: warnings.length, rowsWithWarnings: warnings });
    } finally {
      setTesting(false);
    }
  };

  const openImportPicker = () => {
    if (!testResult) return;
    setSelectedImportRows(new Set(mappedRows.map((r) => r.rowNumber)));
    setImportPickerOpen(true);
  };

  const toggleImportRow = (rowNumber: number, checked: boolean) => {
    setSelectedImportRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowNumber);
      else next.delete(rowNumber);
      return next;
    });
  };

  const setAllImportRowsSelected = (checked: boolean) => {
    if (checked) {
      setSelectedImportRows(new Set(mappedRows.map((r) => r.rowNumber)));
    } else {
      setSelectedImportRows(new Set());
    }
  };

  const selectImportRowsWithoutWarnings = () => {
    const next = new Set<number>();
    for (const r of mappedRows) {
      if (!warningByRow.has(r.rowNumber)) next.add(r.rowNumber);
    }
    setSelectedImportRows(next);
  };

  const handleImport = async (rowNumbers: Set<number>) => {
    if (!canImportHarvest) {
      setError("You do not have permission to import harvest data.");
      return;
    }
    if (!testResult) return;
    if (!rowNumbers.size) {
      setError(t("noRowsSelected"));
      return;
    }
    setImportPickerOpen(false);
    setImporting(true);
    setError("");
    setSummary("");
    const logs: ImportLog[] = [];
    const rowsToImport = mappedRows.filter((r) => rowNumbers.has(r.rowNumber));
    try {
      for (const r of rowsToImport) {
        const projectId = resolveByLooseText(r.projectName, projectCandidates);
        const farmId = resolveByLooseText(r.farm, farmCandidates);
        const productId = resolveByLooseText(r.grass, productCandidates);
        const customerIdFromName = resolveByLooseText(r.customerName, customerCandidates);
        const assignedTo = user?.id != null ? String(user.id) : "";
        const selectedProjectRow = (allProjects as unknown[]).find((item) => {
          if (!item || typeof item !== "object") return false;
          const row = item as Record<string, unknown>;
          return toStringSafe(row.id) === projectId;
        }) as Record<string, unknown> | undefined;
        const customerFromProject = toStringSafe(selectedProjectRow?.odoo_customer_id);
        const customerId = customerIdFromName || customerFromProject || undefined;
        try {
          if (!projectId) {
            throw new Error(t("warnProjectNotFound", { value: r.projectName }));
          }
          if (!farmId) {
            throw new Error(t("warnFarmNotFound", { value: r.farm }));
          }
          if (!productId) {
            throw new Error(t("warnGrassNotFound", { value: r.grass }));
          }
          const qty = Number.parseFloat(r.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error(t("warnQuantityInvalid"));
          }
          if (!r.estimatedDate && !r.actualDate) {
            throw new Error(t("warnDatePairEmpty"));
          }
          if (!r.harvestType) {
            throw new Error(t("warnHarvestTypeInvalid"));
          }
          const dynamicRow = await getDynamicRowForProjectId(projectId);
          if (!dynamicRow) {
            throw new Error(t("errDynamicRowNotFound"));
          }

          const saveResult = await submitFlutterHarvest(
            {
              projectId,
              productId,
              farmId,
              zone: r.zone,
              quantity: r.quantity,
              uom: r.uom,
              harvestType: r.harvestType,
              name: r.name || undefined,
              turfType: r.turfType || undefined,
              estimatedHarvestDate: r.estimatedDate,
              estimatedHarvestEndDate: r.estimatedDateEnd || undefined,
              actualHarvestDate: r.actualDate,
              actualHarvestEndDate: r.actualHarvestEndDate || undefined,
              deliveryHarvestDate: r.deliveryDate,
              shipmentRequiredDate: r.shipmentRequiredDate || undefined,
              doSoDate: r.doSoDate,
              doSoNumber: r.doSoNumber,
              truckNote: r.truckNote,
              shippingDispatchDetails: r.shippingDispatchDetails || undefined,
              generalNote: r.generalNote || undefined,
              licensePlate: r.licensePlate,
              paymentId: r.paymentId || undefined,
              refHrvQtySprig: r.refHrvQtySprig || undefined,
              referenceHarvestUom: r.referenceHarvestUom || undefined,
              country: r.country || undefined,
              customerId,
              assignedTo,
              createdBy: user?.id != null ? String(user.id) : undefined,
              harvestedArea: r.harvestedArea || undefined,
            },
            {},
          );
          const harvestId = toStringSafe(saveResult.harvest?.id);
          logs.push({
            rowNumber: r.rowNumber,
            status: "success",
            message: harvestId
              ? t("logImportSuccess", { id: harvestId })
              : `Imported successfully (id_row=${dynamicRow.idRow}, table_id=${dynamicRow.tableId})`,
            source: r.source,
            harvestId: harvestId || undefined,
            projectName: r.projectName,
            farm: r.farm,
            zone: r.zone,
            grass: r.grass,
            quantity: r.quantity,
            uom: r.uom,
          });
        } catch (e) {
          logs.push({
            rowNumber: r.rowNumber,
            status: "error",
            message: e instanceof Error ? e.message : t("logImportFailed"),
            source: r.source,
          });
        }
      }
      setImportLogs(logs);
      const ok = logs.filter((x) => x.status === "success").length;
      const bad = logs.filter((x) => x.status === "error").length;
      setSummary(t("summaryDone", { ok, bad }));
      if (ok > 0) {
        void dispatchRouteAlert({
          routeKey: "harvest_import",
          title: t("alertImportHarvestTitle", { ok }),
          message: t("alertImportHarvestMessage", { ok, bad }),
          href: "/harvest/import",
          sourceEntityId: currentFileHash.trim() || `harvest-import-${Date.now()}`,
        });
      }
      if (currentFileHash) {
        localStorage.setItem("stsrenew:harvest-import:last-file-hash", currentFileHash);
      }
    } finally {
      setImporting(false);
    }
  };

  const errorCount = importLogs.filter((x) => x.status === "error").length;
  const importErrorLogs = importLogs.filter((x) => x.status === "error");
  const importSuccessLogs = importLogs.filter(
    (x) => x.status === "success" && x.harvestId,
  );

  const downloadErrorRows = async () => {
    if (!importErrorLogs.length || downloadingErrors) return;
    setDownloadingErrors(true);
    setError("");
    try {
      await downloadHarvestImportErrors(
        importErrorLogs.map((x) => ({
          rowNumber: x.rowNumber,
          message: x.message,
          source: x.source,
        })),
        mapping ?? {},
        fileName,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("downloadErrorFailed"));
    } finally {
      setDownloadingErrors(false);
    }
  };

  return (
    <RequireAuth>
      <DashboardLayout>
        {importDenied ? (
          <div className="p-4 lg:p-8">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 space-y-3">
              <h1 className="text-xl font-semibold text-amber-900">{t("title")}</h1>
              <p className="text-sm text-amber-800">
                You do not have permission to import harvest data.
              </p>
              <button
                type="button"
                onClick={() => router.push("/harvest")}
                className="px-4 py-2 rounded-lg border border-amber-300 text-sm text-amber-900 hover:bg-amber-100"
              >
                {t("backToHarvests")}
              </button>
            </div>
          </div>
        ) : (
        <div className="p-4 lg:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">
              {t("title")}
            </h1>
            <button
              type="button"
              onClick={() => router.push("/harvest")}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
            >
              {t("backToHarvests")}
            </button>
          </div>

          <AlertRouteCategoryBanner routeKey="harvest_import" />

          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-sm text-gray-700">
              {t("uploadHint")}
            </p>
            <a
              href="/api/harvest/import-template"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-800 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              {t("downloadTemplate")}
            </a>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-button-primary px-4 py-2 text-white hover:bg-[#196A40]">
              <Upload className="h-4 w-4" />
              {t("uploadExcel")}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {fileName ? <p className="text-sm text-gray-600">File: {fileName}</p> : null}
            {sameFileWarning ? (
              <p className="text-sm text-amber-700">{sameFileWarning}</p>
            ) : null}
          </div>

          {headers.length ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">{t("columnMapping")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="text-sm">
                    <span className="mb-1 block text-gray-700">{t(`fields.${f.key}`)}</span>
                    <select
                      value={mapping?.[f.key] ?? ""}
                      onChange={(e) => {
                        const col = e.target.value;
                        setMapping((prev) => {
                          if (!prev) return prev;
                          const next = { ...prev, [f.key]: col };
                          if (f.key === "actualDate") {
                            logHarvestImportDates("actualDate column selected", {
                              workbookDate1904,
                              excelColumn: col,
                              samples: rows.slice(0, 8).map((row, idx) => {
                                const raw = col ? row[col] : undefined;
                                return {
                                  row: idx + 2,
                                  raw,
                                  rawType: raw == null ? "empty" : typeof raw,
                                  parsed: tryParseDate(raw, {
                                    date1904: workbookDate1904,
                                  }),
                                };
                              }),
                            });
                          }
                          return next;
                        });
                      }}
                      className={cn(
                        "w-full rounded-lg border border-input px-3 py-2 text-sm",
                        bgSurfaceFilter(Boolean((mapping?.[f.key] ?? "").trim())),
                      )}
                    >
                      <option value="">{t("selectExcelColumn")}</option>
                      {headers.map((h) => (
                        <option key={`${f.key}-${h}`} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {mappedRows.length ? (
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testing}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  <FlaskConical className="h-4 w-4" />
                  {testing ? t("testing") : t("testData")}
                </button>
                <button
                  type="button"
                  onClick={openImportPicker}
                  disabled={!testResult || importing}
                  className="inline-flex items-center gap-2 rounded-lg bg-button-primary px-4 py-2 text-white hover:bg-[#196A40] disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {importing ? t("importing") : t("importAllowWarnings")}
                </button>
              </div>

              {testResult ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p>
                    {t("testWarnings", { count: testResult.warningRows })}
                  </p>
                  {testResult.rowsWithWarnings.slice(0, 10).map((w) => (
                    <p key={`w-${w.rowIndex}`} className="text-amber-700">
                      {t("rowPrefix", { row: w.rowIndex })}: {w.messages.join("; ")}
                    </p>
                  ))}
                </div>
              ) : null}

              {importLogs.length ? (
                <div className="space-y-3">
                  {importErrorLogs.length ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void downloadErrorRows()}
                        disabled={downloadingErrors}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        <Download className="h-4 w-4" />
                        {downloadingErrors
                          ? t("downloadingErrors")
                          : t("downloadError", { count: errorCount })}
                      </button>
                    </div>
                  ) : null}

                  {importErrorLogs.length ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                      <p className="font-medium text-red-700">
                        Import errors ({importErrorLogs.length})
                      </p>
                      <div className="mt-1 space-y-1 text-red-700">
                        {importErrorLogs.slice(0, 20).map((log) => (
                          <p key={`e-${log.rowNumber}-${log.message}`}>
                            Row {log.rowNumber}: {log.message}
                          </p>
                        ))}
                        {importErrorLogs.length > 20 ? (
                          <p className="text-xs text-red-600">
                            {t("showingFirstErrors", { shown: 20, total: importErrorLogs.length })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {importSuccessLogs.length ? (
                    <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                      <p className="font-medium text-green-800">
                        {t("importSuccessListTitle", { count: importSuccessLogs.length })}
                      </p>
                      <ul className="mt-2 space-y-2">
                        {importSuccessLogs.map((log) => {
                          const detailHref = `/harvest/detail?id=${encodeURIComponent(log.harvestId!)}&returnTo=${encodeURIComponent(HARVEST_IMPORT_RETURN_TO)}`;
                          return (
                            <li
                              key={`s-${log.rowNumber}-${log.harvestId}`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-white px-3 py-2"
                            >
                              <div className="min-w-0 text-green-900">
                                <p className="font-medium">
                                  {t("rowPrefix", { row: log.rowNumber })}
                                  {log.projectName ? ` · ${log.projectName}` : ""}
                                </p>
                                <p className="text-xs text-green-700">
                                  {[log.farm, log.zone, log.grass]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  {log.quantity
                                    ? ` · ${log.quantity}${log.uom ? ` ${log.uom}` : ""}`
                                    : ""}
                                </p>
                              </div>
                              <Link
                                href={detailHref}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t("viewHarvestDetail")}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="overflow-auto rounded-md border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <SortableTh
                        label={t("table.index")}
                        columnKey="index"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.project")}
                        columnKey="project"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.farm")}
                        columnKey="farm"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.zone")}
                        columnKey="zone"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.grass")}
                        columnKey="grass"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.type")}
                        columnKey="type"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.uom")}
                        columnKey="uom"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.qty")}
                        columnKey="qty"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.estAct")}
                        columnKey="dates"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMappedRows.slice(0, 50).map((r) => (
                      <tr key={`r-${r.rowNumber}`} className="border-t border-gray-100">
                        <td className="px-3 py-2">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.projectName}</td>
                        <td className="px-3 py-2">{r.farm}</td>
                        <td className="px-3 py-2">{r.zone}</td>
                        <td className="px-3 py-2">{r.grass}</td>
                        <td className="px-3 py-2">
                          {harvestTypeDisplayLabel(r.harvestType) || "—"}
                        </td>
                        <td className="px-3 py-2">{r.uom}</td>
                        <td className="px-3 py-2">{r.quantity}</td>
                        <td className="px-3 py-2">
                          {r.estimatedDate || "—"} / {r.actualDate || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sortedMappedRows.length > 50 ? (
                <p className="text-xs text-gray-500">
                  {t("showingTopRows", { shown: 50, total: sortedMappedRows.length })}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {summary ? <p className="text-sm text-green-700">{summary}</p> : null}

          {importPickerOpen ? (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
              role="presentation"
              onClick={() => {
                if (!importing) setImportPickerOpen(false);
              }}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-gray-200 bg-white text-gray-900 shadow-xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="harvest-import-picker-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="border-b border-gray-200 px-5 py-4">
                  <h2
                    id="harvest-import-picker-title"
                    className="text-lg font-semibold text-gray-900"
                  >
                    {t("importPickerTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">{t("importPickerHint")}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setAllImportRowsSelected(true)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {t("selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllImportRowsSelected(false)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {t("deselectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={selectImportRowsWithoutWarnings}
                    className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50"
                  >
                    {t("selectWithoutWarnings")}
                  </button>
                  <span className="ml-auto text-sm text-gray-600">
                    {t("selectedCount", { count: selectedImportRows.size, total: mappedRows.length })}
                  </span>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-left">
                      <tr>
                        <th className="w-10 px-2 py-2">
                          <input
                            type="checkbox"
                            checked={
                              mappedRows.length > 0 &&
                              selectedImportRows.size === mappedRows.length
                            }
                            ref={(el) => {
                              if (!el) return;
                              el.indeterminate =
                                selectedImportRows.size > 0 &&
                                selectedImportRows.size < mappedRows.length;
                            }}
                            onChange={(e) => setAllImportRowsSelected(e.target.checked)}
                            aria-label={t("selectAll")}
                          />
                        </th>
                        <th className="px-3 py-2 text-gray-700">{t("table.index")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.project")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.farm")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.zone")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.grass")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.type")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.qty")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("table.estAct")}</th>
                        <th className="px-3 py-2 text-gray-700">{t("importPickerWarnings")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMappedRows.map((r) => {
                        const warnings = warningByRow.get(r.rowNumber);
                        const checked = selectedImportRows.has(r.rowNumber);
                        return (
                          <tr
                            key={`pick-${r.rowNumber}`}
                            className={cn(
                              "border-t border-gray-100",
                              warnings?.length ? "bg-amber-50/60" : undefined,
                            )}
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  toggleImportRow(r.rowNumber, e.target.checked)
                                }
                                aria-label={t("rowPrefix", { row: r.rowNumber })}
                              />
                            </td>
                            <td className="px-3 py-2">{r.rowNumber}</td>
                            <td className="px-3 py-2">{r.projectName}</td>
                            <td className="px-3 py-2">{r.farm}</td>
                            <td className="px-3 py-2">{r.zone}</td>
                            <td className="px-3 py-2">{r.grass}</td>
                            <td className="px-3 py-2">
                              {harvestTypeDisplayLabel(r.harvestType) || "—"}
                            </td>
                            <td className="px-3 py-2">{r.quantity}</td>
                            <td className="px-3 py-2">
                              {r.estimatedDate || "—"} / {r.actualDate || "—"}
                            </td>
                            <td className="px-3 py-2 text-amber-700">
                              {warnings?.length ? warnings.join("; ") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setImportPickerOpen(false)}
                    disabled={importing}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImport(selectedImportRows)}
                    disabled={importing || selectedImportRows.size === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-button-primary px-4 py-2 text-sm text-white hover:bg-[#196A40] disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {importing
                      ? t("importing")
                      : t("confirmImport", { count: selectedImportRows.size })}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        )}
      </DashboardLayout>
    </RequireAuth>
  );
}

