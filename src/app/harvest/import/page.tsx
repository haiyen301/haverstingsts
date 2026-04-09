"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FlaskConical, CheckCircle2, Download } from "lucide-react";
import * as XLSX from "xlsx";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { useAuthUserStore } from "@/shared/store/authUserStore";
import { submitFlutterHarvest } from "@/features/harvesting/api/flutterHarvestSubmit";
import { stsProxyGetHarvestingIndex, stsProxyPostJson } from "@/shared/api/stsProxyClient";
import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import { compareNumbers, compareStrings } from "@/shared/lib/tableSort";

type FieldKey =
  | "customerName"
  | "projectName"
  | "farm"
  | "zone"
  | "grass"
  | "harvestType"
  | "quantity"
  | "estimatedDate"
  | "actualDate"
  | "deliveryDate"
  | "doSoDate"
  | "doSoNumber"
  | "truckNote"
  | "licensePlate"
  | "harvestedArea";

type ExcelRow = Record<string, unknown>;
type FieldMapping = Record<FieldKey, string>;

type RowIssue = { rowIndex: number; messages: string[] };

type MappedRow = {
  rowNumber: number;
  source: ExcelRow;
  customerName: string;
  projectName: string;
  farm: string;
  zone: string;
  grass: string;
  harvestType: string; // Sod | Sprig
  quantity: string;
  uom: "M2" | "Kg";
  estimatedDate: string;
  actualDate: string;
  deliveryDate: string;
  doSoDate: string;
  doSoNumber: string;
  truckNote: string;
  licensePlate: string;
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
};

const FIELDS: { key: FieldKey }[] = [
  { key: "customerName" },
  { key: "projectName" },
  { key: "farm" },
  { key: "zone" },
  { key: "grass" },
  { key: "harvestType" },
  { key: "quantity" },
  { key: "estimatedDate" },
  { key: "actualDate" },
  { key: "deliveryDate" },
  { key: "doSoDate" },
  { key: "doSoNumber" },
  { key: "truckNote" },
  { key: "licensePlate" },
  { key: "harvestedArea" },
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
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function tryParseDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    const excelDate = XLSX.SSF.parse_date_code(v);
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

function normalizeHarvestType(v: string): { harvestType: "Sod" | "Sprig" | ""; uom: "M2" | "Kg" } {
  const s = normalizeLoose(v);
  if (!s) return { harvestType: "", uom: "M2" };
  // Accept direct values and mixed strings (e.g. "Sprig / KG", "Sod - M2").
  if (s === "sod" || s.includes("sod") || s === "m2" || s === "m²" || s.includes("m2") || s.includes("m²")) {
    return { harvestType: "Sod", uom: "M2" };
  }
  if (s === "sprig" || s.includes("sprig") || s === "kg" || s.includes("kg")) {
    return { harvestType: "Sprig", uom: "Kg" };
  }
  return { harvestType: "", uom: "M2" };
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
    farm: pick(["farm", "farm name"]),
    zone: pick(["zone"]),
    grass: pick(["grass", "product"]),
    harvestType: pick(["harvest type", "load type", "sod/sprig", "sod sprig", "type", "uom", "unit"]),
    quantity: pick(["quantity", "qty"]),
    estimatedDate: pick(["estimated harvest date", "estimated date", "estimate date"]),
    actualDate: pick(["actual harvest date", "actual date"]),
    deliveryDate: pick(["delivery harvest date", "delivery date"]),
    doSoNumber: pick(["do/so", "do so", "do so number", "do_so_number"]),
    doSoDate: pick(["do so date", "do_so_date", "doso date"]),
    truckNote: pick(["truck note", "note"]),
    licensePlate: pick(["license plate", "license", "plate"]),
    harvestedArea: pick(["harvested area", "area"]),
  };
}

function downloadWorkbook(fileName: string, rows: ExcelRow[], logs: RowIssue[]) {
  const wb = XLSX.utils.book_new();
  const errorByRow = new Map<number, string>();
  for (const l of logs) {
    errorByRow.set(l.rowIndex, l.messages.join("; "));
  }
  const rowsWithErrorColumn = rows.map((r, idx) => {
    // `sheet_to_json` starts at row 2 (row 1 = header)
    const rowNumber = idx + 2;
    const msg = errorByRow.get(rowNumber) ?? "";
    return { ...(r as Record<string, unknown>), error_message: msg };
  });
  const dataSheet = XLSX.utils.json_to_sheet(rowsWithErrorColumn);
  XLSX.utils.book_append_sheet(wb, dataSheet, "data");
  const logRows = logs.map((l) => ({
    row: l.rowIndex,
    message: l.messages.join("; "),
  }));
  const logSheet = XLSX.utils.json_to_sheet(logRows);
  XLSX.utils.book_append_sheet(wb, logSheet, "logs");
  XLSX.writeFile(wb, fileName);
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
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ExcelRow[]>([]);
  const [mapping, setMapping] = useState<FieldMapping | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [currentFileHash, setCurrentFileHash] = useState("");
  const [sameFileWarning, setSameFileWarning] = useState("");
  const [dynamicRowCache, setDynamicRowCache] = useState<
    Map<string, { idRow: string; tableId: string }>
  >(new Map());

  const farms = useHarvestingDataStore((s) => s.farms);
  const projects = useHarvestingDataStore((s) => s.projects);
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
    return rows.map((r, i) => {
      const get = (k: FieldKey) => r[mapping[k]];
      const ht = normalizeHarvestType(toStringSafe(get("harvestType")));
      return {
        rowNumber: i + 2,
        source: r,
        customerName: toStringSafe(get("customerName")),
        projectName: toStringSafe(get("projectName")),
        farm: toStringSafe(get("farm")),
        zone: toStringSafe(get("zone")),
        grass: toStringSafe(get("grass")),
        harvestType: ht.harvestType || "",
        quantity: toStringSafe(get("quantity")).replaceAll(",", ""),
        uom: ht.uom,
        estimatedDate: tryParseDate(get("estimatedDate")),
        actualDate: tryParseDate(get("actualDate")),
        deliveryDate: tryParseDate(get("deliveryDate")),
        doSoDate: tryParseDate(get("doSoDate")),
        doSoNumber: toStringSafe(get("doSoNumber")),
        truckNote: toStringSafe(get("truckNote")),
        licensePlate: toStringSafe(get("licensePlate")),
        harvestedArea: toStringSafe(get("harvestedArea")).replaceAll(",", ""),
      };
    });
  }, [mapping, rows]);

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
    const sheet = wb.Sheets[wb.SheetNames[0]];
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
    setTesting(true);
    try {
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

  const handleImport = async () => {
    if (!testResult) return;
    setImporting(true);
    setError("");
    setSummary("");
    const logs: ImportLog[] = [];
    try {
      for (const r of mappedRows) {
        const projectId = resolveByLooseText(r.projectName, projectCandidates);
        const farmId = resolveByLooseText(r.farm, farmCandidates);
        const productId = resolveByLooseText(r.grass, productCandidates);
        const assignedTo = user?.id != null ? String(user.id) : "";
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

          await submitFlutterHarvest(
            {
              projectId,
              productId,
              farmId,
              zone: r.zone,
              quantity: r.quantity,
              uom: r.uom,
              harvestType: r.harvestType,
              estimatedHarvestDate: r.estimatedDate,
              actualHarvestDate: r.actualDate,
              deliveryHarvestDate: r.deliveryDate,
              doSoDate: r.doSoDate,
              doSoNumber: r.doSoNumber,
              truckNote: r.truckNote,
              licensePlate: r.licensePlate,
              assignedTo,
              harvestedArea: r.harvestedArea || undefined,
            },
            {},
          );
          logs.push({
            rowNumber: r.rowNumber,
            status: "success",
            message: `Imported successfully (id_row=${dynamicRow.idRow}, table_id=${dynamicRow.tableId})`,
            source: r.source,
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
      if (currentFileHash) {
        localStorage.setItem("stsrenew:harvest-import:last-file-hash", currentFileHash);
      }
    } finally {
      setImporting(false);
    }
  };

  const successCount = importLogs.filter((x) => x.status === "success").length;
  const errorCount = importLogs.filter((x) => x.status === "error").length;
  const importErrorLogs = importLogs.filter((x) => x.status === "error");

  const downloadResult = (kind: "success" | "error") => {
    const picked = importLogs.filter((x) => x.status === kind);
    if (!picked.length) return;
    const rowsOut = picked.map((x) => x.source);
    const logs = picked.map((x) => ({ rowIndex: x.rowNumber, messages: [x.message] }));
    downloadWorkbook(
      kind === "success" ? "harvest-import-success.xlsx" : "harvest-import-error.xlsx",
      rowsOut,
      logs,
    );
  };

  return (
    <RequireAuth>
      <DashboardLayout>
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
                      onChange={(e) =>
                        setMapping((prev) =>
                          prev ? { ...prev, [f.key]: e.target.value } : prev,
                        )
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
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
                  onClick={() => void handleImport()}
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
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadResult("success")}
                      className="inline-flex items-center gap-2 rounded-lg border border-green-300 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                    >
                      <Download className="h-4 w-4" />
                      {t("downloadSuccess", { count: successCount })}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadResult("error")}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                    >
                      <Download className="h-4 w-4" />
                      {t("downloadError", { count: errorCount })}
                    </button>
                  </div>

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
                            Showing first 20 errors. Download the error file for full details.
                          </p>
                        ) : null}
                      </div>
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
                        <td className="px-3 py-2">{r.harvestType}</td>
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
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}

