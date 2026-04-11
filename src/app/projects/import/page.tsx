"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FlaskConical, CheckCircle2, Download } from "lucide-react";
import * as XLSX from "xlsx";

import RequireAuth from "@/features/auth/RequireAuth";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import {
  fetchMondayProjectRowsFromServer,
  updateMondayProjectParentItem,
} from "@/entities/projects";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { SortableTh } from "@/components/ui/sortable-th";
import { useTableColumnSort } from "@/shared/hooks/useTableColumnSort";
import { compareNumbers, compareStrings } from "@/shared/lib/tableSort";
import { normalizeProjectTypeFromImportCell } from "@/features/project/lib/projectTypeDisplay";

type FieldKey =
  | "projectName"
  | "company"
  | "golfClub"
  | "architect"
  | "country"
  | "stsPic"
  | "estimateStartDate"
  | "actualStartDate"
  | "endDate"
  | "projectType"
  | "holes"
  | "keyAreas"
  | "grass"
  | "grassType"
  | "grassRequired";

type ExcelRow = Record<string, unknown>;
type FieldMapping = Record<FieldKey, string>;

type MappedRow = {
  rowNumber: number;
  source: ExcelRow;
  projectName: string;
  company: string;
  golfClub: string;
  architect: string;
  country: string;
  stsPic: string;
  estimateStartDate: string;
  actualStartDate: string;
  endDate: string;
  projectType: string;
  holes: string;
  keyAreas: string[];
  grass: string;
  grassType: string;
  grassRequired: string;
};

type RowIssue = { rowIndex: number; messages: string[] };
type TestResult = {
  okRows: number;
  warningRows: number;
  rowsWithWarnings: RowIssue[];
};

type ImportLog = {
  rowNumber: number;
  status: "success" | "error";
  message: string;
  source: ExcelRow;
};

type ImportedGrassItem = {
  sourceRowNumber: number;
  product_id: string;
  quantity: string;
  uom: string;
};

function pickCandidateId(source: Record<string, unknown>): string {
  const direct =
    toStringSafe(source.id) ||
    toStringSafe(source.product_id) ||
    toStringSafe(source.productId) ||
    toStringSafe(source.commodity_id) ||
    toStringSafe(source.commodityId) ||
    toStringSafe(source.value);
  if (direct) return direct;
  const dynamic = Object.entries(source).find(([k, v]) => {
    const nk = normalizeHeader(k);
    if (!(typeof v === "string" || typeof v === "number")) return false;
    return nk === "id" || nk.endsWith("id") || nk.includes("productid") || nk.includes("commodityid");
  });
  return dynamic ? toStringSafe(dynamic[1]) : "";
}

const FIELDS: { key: FieldKey; required?: boolean }[] = [
  { key: "projectName", required: true },
  { key: "company", required: true },
  { key: "golfClub", required: true },
  { key: "architect", required: true },
  { key: "country", required: true },
  { key: "stsPic", required: true },
  { key: "estimateStartDate" },
  { key: "actualStartDate" },
  { key: "endDate", required: true },
  { key: "projectType", required: true },
  { key: "holes", required: true },
  { key: "keyAreas", required: true },
  { key: "grass", required: true },
  { key: "grassType", required: true },
  { key: "grassRequired", required: true },
];

function normalizeHeader(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toStringSafe(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeLoose(v: string): string {
  return v.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
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

function normalizeProjectType(v: string): string {
  return normalizeProjectTypeFromImportCell(v);
}

function normalizeHoles(v: string): string {
  const n = Number.parseInt(v.trim(), 10);
  if ([9, 18, 27, 36].includes(n)) return String(n);
  return "";
}

function normalizeKeyAreas(v: string): string[] {
  const map = new Map<string, string>([
    ["tees", "Tees"],
    ["roughs", "Roughs"],
    ["fairways", "Fairways"],
    ["greens", "Greens"],
  ]);
  return v
    .split(",")
    .map((x) => map.get(normalizeLoose(x)))
    .filter((x): x is string => Boolean(x));
}

function normalizeUom(v: string): string {
  const raw = toStringSafe(v);
  if (!raw) return "";
  // NFKC helps normalize spreadsheet unicode variants (e.g. "m²" -> "m2").
  const canonical = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\^/g, "")
    .replace(/\./g, " ")
    .replace(/[^a-z0-9/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!canonical) return "";

  const compact = canonical.replace(/\s+/g, "");
  const hasSprig =
    /(^|[ /-])sprig($|[ /-])/.test(canonical) ||
    /(^|[ /-])kg($|[ /-])/.test(canonical) ||
    compact.includes("sprig") ||
    compact === "1" ||
    compact.includes("kilogram");
  const hasSod =
    /(^|[ /-])sod($|[ /-])/.test(canonical) ||
    compact.includes("sod") ||
    compact === "2" ||
    compact.includes("m2") ||
    compact.includes("sqm") ||
    compact.includes("squaremeter") ||
    compact.includes("squaremetre");

  // If both appear (e.g. "Sod/Sprig"), default to Sprig=>Kg for backward compatibility.
  if (hasSprig) return "Kg";
  if (hasSod) return "M2";
  return "";
}

function guessUomRawFromRow(source: ExcelRow): string {
  const entries = Object.entries(source ?? {});
  if (!entries.length) return "";
  // Prefer headers that look like UOM columns first.
  const preferred = entries
    .filter(([h]) => {
      const n = normalizeHeader(h);
      return (
        n.includes("sodsprig") ||
        n === "uom" ||
        n.includes("kgm2") ||
        n.includes("unit")
      );
    })
    .map(([, v]) => toStringSafe(v))
    .filter(Boolean);
  for (const v of preferred) {
    if (normalizeUom(v)) return v;
  }
  // Fallback: scan all row values to recover from hidden header/mapping issues.
  const allValues = entries.map(([, v]) => toStringSafe(v)).filter(Boolean);
  for (const v of allValues) {
    if (normalizeUom(v)) return v;
  }
  return "";
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
    projectName: pick(["project name", "project", "name"]),
    company: pick(["company"]),
    golfClub: pick(["golf club", "alias title", "club"]),
    architect: pick(["architect"]),
    country: pick(["country"]),
    stsPic: pick(["sts pic", "pic", "person in charge"]),
    estimateStartDate: pick(["estimate start date", "estimate date"]),
    actualStartDate: pick(["actual start date", "start date"]),
    endDate: pick(["end date", "deadline"]),
    projectType: pick(["project type", "type"]),
    holes: pick(["holes", "no of holes"]),
    keyAreas: pick(["key areas", "areas"]),
    grass: pick(["grass", "product"]),
    // Avoid generic "type" here to prevent wrong mapping to "Project Type".
    grassType: pick(["sod/sprig", "sod sprig", "uom", "kg/m2", "kg m2", "unit"]),
    grassRequired: pick(["required", "quantity", "qty"]),
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

function downloadSuccessWorkbook(
  fileName: string,
  rows: Record<string, unknown>[],
  logs: RowIssue[],
) {
  const wb = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, dataSheet, "projects");
  const logRows = logs.map((l) => ({
    row: l.rowIndex,
    message: l.messages.join("; "),
  }));
  const logSheet = XLSX.utils.json_to_sheet(logRows);
  XLSX.utils.book_append_sheet(wb, logSheet, "logs");
  XLSX.writeFile(wb, fileName);
}

export default function ProjectImportPage() {
  const tBase = useAppTranslations();
  const t = (
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ) =>
    values
      ? tBase(`ProjectImport.${key}`, values as Parameters<typeof tBase>[1])
      : tBase(`ProjectImport.${key}`);
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ExcelRow[]>([]);
  const [mapping, setMapping] = useState<FieldMapping | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState("");
  const [error, setError] = useState("");
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [currentFileHash, setCurrentFileHash] = useState("");
  const [sameFileWarning, setSameFileWarning] = useState("");
  const [dbExistingProjectNames, setDbExistingProjectNames] = useState<Set<string>>(
    new Set(),
  );
  const [dbExistingProjectKeys, setDbExistingProjectKeys] = useState<Set<string>>(
    new Set(),
  );

  const projects = useHarvestingDataStore((s) => s.projects);
  const countries = useHarvestingDataStore((s) => s.countries);
  const staffs = useHarvestingDataStore((s) => s.staffs);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );
  const upsertProjectInList = useHarvestingDataStore((s) => s.upsertProjectInList);

  useEffect(() => {
    void fetchAllHarvestingReferenceData(true);
  }, [fetchAllHarvestingReferenceData]);

  const existingProjectNames = useMemo(() => {
    const set = new Set<string>();
    (projects as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .forEach((p) => {
        const label = toStringSafe(p.title ?? p.name);
        if (label) set.add(normalizeLoose(label));
      });
    return set;
  }, [projects]);

  const buildProjectBusinessKey = (input: {
    projectName: string;
    estimateStartDate: string;
    actualStartDate: string;
    endDate: string;
  }): string => {
    return [
      normalizeLoose(input.projectName),
      input.estimateStartDate.trim(),
      input.actualStartDate.trim(),
      input.endDate.trim(),
    ].join("|");
  };

  const splitCsvLoose = (raw: string): string[] => {
    const text = String(raw ?? "").trim();
    if (!text) return [];
    return text
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const buildImportedGrassItems = (rowsInGroup: MappedRow[]): ImportedGrassItem[] => {
    const out: ImportedGrassItem[] = [];
    for (const rr of rowsInGroup) {
      const grassParts = splitCsvLoose(rr.grass);
      const uomPartsRaw = splitCsvLoose(rr.grassType);
      const qtyParts = splitCsvLoose(rr.grassRequired);
      const maxParts = Math.max(grassParts.length, uomPartsRaw.length, qtyParts.length, 1);

      for (let i = 0; i < maxParts; i += 1) {
        const grassRaw =
          grassParts.length > 1
            ? (grassParts[i] ?? "")
            : (grassParts[0] ?? rr.grass);
        const uomRaw =
          uomPartsRaw.length > 1
            ? (uomPartsRaw[i] ?? "")
            : (uomPartsRaw[0] ?? rr.grassType);
        const qtyRaw =
          qtyParts.length > 1
            ? (qtyParts[i] ?? "")
            : (qtyParts[0] ?? rr.grassRequired);

        const productId = resolveByLooseText(grassRaw, productCandidates);
        const uom = normalizeUom(uomRaw);
        if (!productId || !uom) continue;

        const qty = Number.parseFloat(String(qtyRaw).replaceAll(",", "").trim());
        if (!Number.isFinite(qty) || qty <= 0) continue;

        out.push({
          sourceRowNumber: rr.rowNumber,
          product_id: productId,
          quantity: String(qty),
          uom,
        });
      }
    }
    return out;
  };

  const computeFileHash = async (file: File): Promise<string> => {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const fetchDbExistingProjectNames = async (): Promise<{
    names: Set<string>;
    keys: Set<string>;
  }> => {
    const result = await fetchMondayProjectRowsFromServer({
      module: "project",
      page: 1,
      perPage: 1000,
    });
    const names = new Set<string>();
    const keys = new Set<string>();
    for (const row of result.rows) {
      const name = toStringSafe(
        (row as Record<string, unknown>).title ??
        (row as Record<string, unknown>).project_name ??
        row.project_id,
      );
      const estimateStartDate = toStringSafe(
        (row as Record<string, unknown>).estimate_start_date,
      );
      const actualStartDate = toStringSafe(
        (row as Record<string, unknown>).start_date,
      );
      const endDate = toStringSafe((row as Record<string, unknown>).deadline);
      if (name) {
        names.add(normalizeLoose(name));
        keys.add(
          buildProjectBusinessKey({
            projectName: name,
            estimateStartDate,
            actualStartDate,
            endDate,
          }),
        );
      }
    }
    setDbExistingProjectNames(names);
    setDbExistingProjectKeys(keys);
    return { names, keys };
  };

  type LooseCandidate = { id: string; label: string; aliases?: string[] };

  const countryCandidates = useMemo(() => {
    return (countries as unknown[])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        id: toStringSafe(c.id),
        label: toStringSafe(c.country_name ?? c.name ?? c.title),
      }));
  }, [countries]);

  const productCandidates = useMemo<LooseCandidate[]>(() => {
    return (grasses as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => {
        const dynamicAliases = Object.entries(p)
          .filter(([k, v]) => {
            if (typeof v !== "string" && typeof v !== "number") return false;
            const nk = normalizeHeader(k);
            return (
              nk.includes("name") ||
              nk.includes("title") ||
              nk.includes("product") ||
              nk.includes("commodity") ||
              nk.includes("grass") ||
              nk.includes("variety") ||
              nk.includes("code") ||
              nk.includes("sku")
            );
          })
          .map(([, v]) => toStringSafe(v))
          .filter(Boolean);
        const aliases = Array.from(
          new Set([
            toStringSafe(p.name),
            toStringSafe(p.title),
            toStringSafe(p.commodity_name),
            toStringSafe(p.product_name),
            toStringSafe(p.grass_name),
            toStringSafe(p.variety),
            toStringSafe(p.code),
            toStringSafe(p.sku),
            toStringSafe(p.short_name),
            ...dynamicAliases,
          ].filter(Boolean)),
        );
        const label = toStringSafe(
          p.name ?? p.title ?? p.commodity_name ?? p.product_name ?? aliases[0] ?? "",
        );
        return {
          id: pickCandidateId(p),
          label,
          aliases,
        };
      })
      .filter((x) => x.id && (x.label || (x.aliases?.length ?? 0) > 0));
  }, [grasses]);

  const productLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of productCandidates) {
      if (p.id && p.label) map.set(p.id, p.label);
    }
    return map;
  }, [productCandidates]);

  const staffCandidates = useMemo(() => {
    return (staffs as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        id: toStringSafe(s.id),
        firstName: toStringSafe(s.first_name),
        lastName: toStringSafe(s.last_name),
        fullName: toStringSafe(s.full_name || `${toStringSafe(s.first_name)} ${toStringSafe(s.last_name)}`),
        altName: toStringSafe(s.name),
      }));
  }, [staffs]);

  const resolveByLooseText = (raw: string, candidates: LooseCandidate[]) => {
    const text = raw.trim();
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;
    const norm = normalizeLoose(text);
    const qTokens = tokensOf(text);
    const candidateTexts = (c: LooseCandidate): string[] =>
      [c.label, ...(c.aliases ?? [])].map((x) => normalizeLoose(x)).filter(Boolean);
    const exact = candidates.find((c) => candidateTexts(c).some((x) => x === norm));
    if (exact) return exact.id;
    const allTokens = candidates.find((c) => {
      const texts = candidateTexts(c);
      return qTokens.length > 0 && texts.some((txt) => qTokens.every((t) => txt.includes(t)));
    });
    if (allTokens) return allTokens.id;
    const startsWithTokens = candidates.find((c) => {
      const texts = candidateTexts(c);
      return qTokens.length > 0 && texts.some((txt) => {
        const tks = txt.split(" ").filter(Boolean);
        return qTokens.every((q) => tks.some((tk) => tk.startsWith(q) || q.startsWith(tk)));
      });
    });
    if (startsWithTokens) return startsWithTokens.id;
    const like = candidates.find((c) => {
      const texts = candidateTexts(c);
      return texts.some((txt) => txt.includes(norm) || norm.includes(txt));
    });
    return like?.id ?? "";
  };

  const resolveStaffId = (raw: string) => {
    const text = raw.trim();
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;
    const norm = normalizeLoose(text);
    const qTokens = tokensOf(text);

    const exact = staffCandidates.find((s) => {
      return (
        normalizeLoose(s.fullName) === norm ||
        normalizeLoose(s.firstName) === norm ||
        normalizeLoose(s.lastName) === norm ||
        normalizeLoose(s.altName) === norm
      );
    });
    if (exact?.id) return exact.id;

    const tokenFirstLast = staffCandidates.find((s) => {
      const first = normalizeLoose(s.firstName);
      const last = normalizeLoose(s.lastName);
      return qTokens.some((t) => t === first || t === last);
    });
    if (tokenFirstLast?.id) return tokenFirstLast.id;

    const containsAll = staffCandidates.find((s) => {
      const combined = normalizeLoose(
        `${s.firstName} ${s.lastName} ${s.fullName} ${s.altName}`,
      );
      return qTokens.length > 0 && qTokens.every((t) => combined.includes(t));
    });
    if (containsAll?.id) return containsAll.id;

    const like = staffCandidates.find((s) => {
      const combined = normalizeLoose(
        `${s.firstName} ${s.lastName} ${s.fullName} ${s.altName}`,
      );
      return combined.includes(norm) || norm.includes(combined);
    });
    return like?.id ?? "";
  };

  const mappedRows = useMemo((): MappedRow[] => {
    if (!mapping) return [];
    return rows.map((r, i) => {
      const get = (k: FieldKey) => r[mapping[k]];
      const getFallbackGrassTypeRaw = (): string => {
        const fallbackHeader = Object.keys(r).find((h) => {
          const n = normalizeHeader(h);
          return (
            n.includes("sodsprig") ||
            n === "uom" ||
            n.includes("kgm2") ||
            n.includes("unit")
          );
        });
        if (!fallbackHeader) return "";
        return toStringSafe(r[fallbackHeader]);
      };
      const mappedGrassTypeRaw = toStringSafe(get("grassType"));
      const grassTypeRaw = normalizeUom(mappedGrassTypeRaw)
        ? mappedGrassTypeRaw
        : (getFallbackGrassTypeRaw() || guessUomRawFromRow(r) || mappedGrassTypeRaw);
      return {
        rowNumber: i + 2,
        source: r,
        projectName: toStringSafe(get("projectName")),
        company: toStringSafe(get("company")),
        golfClub: toStringSafe(get("golfClub")),
        architect: toStringSafe(get("architect")),
        country: toStringSafe(get("country")),
        stsPic: toStringSafe(get("stsPic")),
        estimateStartDate: tryParseDate(get("estimateStartDate")),
        actualStartDate: tryParseDate(get("actualStartDate")),
        endDate: tryParseDate(get("endDate")),
        projectType: normalizeProjectType(toStringSafe(get("projectType"))),
        holes: normalizeHoles(toStringSafe(get("holes"))),
        keyAreas: normalizeKeyAreas(toStringSafe(get("keyAreas"))),
        grass: toStringSafe(get("grass")),
        grassType: grassTypeRaw,
        grassRequired: toStringSafe(get("grassRequired")),
      };
    });
  }, [mapping, rows]);

  type GroupKey = string;
  type GroupedProject = {
    key: GroupKey;
    projectName: string;
    estimateStartDate: string;
    actualStartDate: string;
    endDate: string;
    rows: MappedRow[];
  };

  const groupedProjects = useMemo((): GroupedProject[] => {
    const map = new Map<GroupKey, GroupedProject>();
    for (const r of mappedRows) {
      const nameKey = normalizeLoose(r.projectName);
      const key = [
        nameKey,
        r.estimateStartDate || "",
        r.actualStartDate || "",
        r.endDate || "",
      ].join("|");
      const cur = map.get(key);
      if (cur) {
        cur.rows.push(r);
      } else {
        map.set(key, {
          key,
          projectName: r.projectName,
          estimateStartDate: r.estimateStartDate,
          actualStartDate: r.actualStartDate,
          endDate: r.endDate,
          rows: [r],
        });
      }
    }
    return Array.from(map.values());
  }, [mappedRows]);

  type ProjectImportSortKey =
    | "index"
    | "project"
    | "country"
    | "stsPic"
    | "type"
    | "holes"
    | "grass"
    | "uom"
    | "quantity";

  const { sortKey, sortDir, onSort } =
    useTableColumnSort<ProjectImportSortKey>("project");

  const sortedGroupedProjects = useMemo(() => {
    const list = [...groupedProjects];
    list.sort((a, b) => {
      const r0 = a.rows[0];
      const r1 = b.rows[0];
      const grass0 = a.rows.map((x) => x.grass).filter(Boolean).join(", ");
      const grass1 = b.rows.map((x) => x.grass).filter(Boolean).join(", ");
      const uom0 = a.rows.map((x) => x.grassType).filter(Boolean).join(", ");
      const uom1 = b.rows.map((x) => x.grassType).filter(Boolean).join(", ");
      const qty0 = a.rows.map((x) => x.grassRequired).filter(Boolean).join(", ");
      const qty1 = b.rows.map((x) => x.grassRequired).filter(Boolean).join(", ");
      switch (sortKey) {
        case "index":
          return compareNumbers(r0.rowNumber, r1.rowNumber, sortDir);
        case "project":
          return compareStrings(a.projectName, b.projectName, sortDir);
        case "country":
          return compareStrings(r0.country, r1.country, sortDir);
        case "stsPic":
          return compareStrings(r0.stsPic, r1.stsPic, sortDir);
        case "type":
          return compareStrings(r0.projectType, r1.projectType, sortDir);
        case "holes":
          return compareStrings(r0.holes, r1.holes, sortDir);
        case "grass":
          return compareStrings(grass0, grass1, sortDir);
        case "uom":
          return compareStrings(uom0, uom1, sortDir);
        case "quantity":
          return compareStrings(qty0, qty1, sortDir);
        default:
          return 0;
      }
    });
    return list;
  }, [groupedProjects, sortKey, sortDir]);

  const handleFile = async (file: File) => {
    setError("");
    setImportSummary("");
    setTestResult(null);
    setImportLogs([]);
    const hash = await computeFileHash(file);
    setCurrentFileHash(hash);
    const lastHash = localStorage.getItem("stsrenew:projects-import:last-file-hash") ?? "";
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
    setRows(data);
    setHeaders(Object.keys(data[0] ?? {}));
    setFileName(file.name);
    setMapping(suggestMapping(Object.keys(data[0] ?? {})));
  };

  const runTest = async () => {
    setTesting(true);
    try {
      if (!productCandidates.length || !countryCandidates.length || !staffCandidates.length) {
        await fetchAllHarvestingReferenceData(true);
      }
      const db = await fetchDbExistingProjectNames();
      const dbNames = db.names;
      const dbKeys = db.keys;
      const seenBatchKeys = new Set<string>();
      const warnings: RowIssue[] = [];
      groupedProjects.forEach((g) => {
        const r0 = g.rows[0];
        const rowKey = buildProjectBusinessKey(r0);
        const rowWarnings: string[] = [];
        if (!r0.projectName) rowWarnings.push(t("warnProjectNameEmpty"));
        if (!r0.company) rowWarnings.push(t("warnCompanyEmpty"));
        if (!r0.golfClub) rowWarnings.push(t("warnGolfClubEmpty"));
        if (!r0.architect) rowWarnings.push(t("warnArchitectEmpty"));
        if (!r0.endDate) rowWarnings.push(t("warnEndDateEmpty"));
        if (!r0.country) rowWarnings.push(t("warnCountryEmpty"));
        if (!r0.stsPic) rowWarnings.push(t("warnStsPicEmpty"));
        if (!r0.projectType) rowWarnings.push(t("warnProjectTypeInvalid"));
        if (!r0.holes) rowWarnings.push(t("warnHolesInvalid"));
        if (!r0.keyAreas.length) rowWarnings.push(t("warnKeyAreasInvalid"));
        if (!r0.actualStartDate && !r0.estimateStartDate) {
          rowWarnings.push(t("warnStartDatePairEmpty"));
        }
        if (r0.country && !resolveByLooseText(r0.country, countryCandidates)) {
          rowWarnings.push(t("warnCountryNotFound", { value: r0.country }));
        }
        if (r0.stsPic && !resolveStaffId(r0.stsPic)) {
          rowWarnings.push(t("warnStsPicNotFound", { value: r0.stsPic }));
        }
        if (
          g.rows.length > 1 &&
          r0.projectName &&
          (r0.estimateStartDate || r0.actualStartDate || r0.endDate)
        ) {
          rowWarnings.push(t("warnWillMergeRows", { count: g.rows.length }));
        }
        for (const rr of g.rows) {
          if (!rr.grass) rowWarnings.push(t("warnGrassEmptyAtRow", { row: rr.rowNumber }));
          const uomParts = splitCsvLoose(rr.grassType).map((x) => normalizeUom(x)).filter(Boolean);
          if (!uomParts.length) {
            rowWarnings.push(t("warnGrassTypeInvalidAtRow", { row: rr.rowNumber }));
          }
          const qty = Number.parseFloat(rr.grassRequired);
          if (!Number.isFinite(qty) || qty <= 0) {
            rowWarnings.push(t("warnGrassQtyInvalidAtRow", { row: rr.rowNumber }));
          }
          if (rr.grass && !resolveByLooseText(rr.grass, productCandidates)) {
            rowWarnings.push(t("warnGrassNotFoundAtRow", { row: rr.rowNumber, value: rr.grass }));
          }
        }
        if (
          r0.projectName &&
          (existingProjectNames.has(normalizeLoose(r0.projectName)) ||
            dbNames.has(normalizeLoose(r0.projectName)) ||
            dbKeys.has(rowKey))
        ) {
          rowWarnings.push(t("warnProjectExistsSkip", { value: r0.projectName }));
        }
        if (seenBatchKeys.has(rowKey)) {
          rowWarnings.push(t("warnDuplicateInFile"));
        } else {
          seenBatchKeys.add(rowKey);
        }
        if (rowWarnings.length) {
          warnings.push({ rowIndex: r0.rowNumber, messages: rowWarnings });
        }
      });
      setTestResult({
        okRows: groupedProjects.length - warnings.length,
        warningRows: warnings.length,
        rowsWithWarnings: warnings,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleImport = async () => {
    if (!testResult) return;
    setImporting(true);
    setError("");
    setImportSummary("");
    setImportLogs([]);
    const logs: ImportLog[] = [];
    try {
      if (!productCandidates.length || !countryCandidates.length || !staffCandidates.length) {
        await fetchAllHarvestingReferenceData(true);
      }
      const db =
        dbExistingProjectNames.size > 0 || dbExistingProjectKeys.size > 0
          ? { names: new Set(dbExistingProjectNames), keys: new Set(dbExistingProjectKeys) }
          : await fetchDbExistingProjectNames();
      const dbNames = db.names;
      const dbKeys = db.keys;
      const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 1 });
      const defaultTableId = toStringSafe(
        (Array.isArray(res.raw) ? res.raw[0]?.table_id : "") ||
          res.rows[0]?.table_id,
      );
      if (!defaultTableId) {
        setError(t("missingTableId"));
        return;
      }

      const seenBatchKeys = new Set<string>();
      for (const g of groupedProjects) {
        const r0 = g.rows[0];
        const rowKey = buildProjectBusinessKey(r0);
        if (
          r0.projectName &&
          (existingProjectNames.has(normalizeLoose(r0.projectName)) ||
            dbNames.has(normalizeLoose(r0.projectName)) ||
            dbKeys.has(rowKey) ||
            seenBatchKeys.has(rowKey))
        ) {
          for (const rr of g.rows) {
            logs.push({
              rowNumber: rr.rowNumber,
              status: "error",
              message: t("logSkippedExists"),
              source: rr.source,
            });
          }
          continue;
        }
        seenBatchKeys.add(rowKey);

        const countryId = resolveByLooseText(r0.country, countryCandidates);
        const staffId = resolveStaffId(r0.stsPic);

        const grassItems = buildImportedGrassItems(g.rows);
        if (!grassItems.length) {
          for (const rr of g.rows) {
            const hasProduct = !!resolveByLooseText(rr.grass, productCandidates);
            const hasUom = splitCsvLoose(rr.grassType).some((x) => !!normalizeUom(x));
            logs.push({
              rowNumber: rr.rowNumber,
              status: "error",
              message: hasProduct
                ? t("warnGrassTypeInvalidAtRow", { row: rr.rowNumber })
                : t("warnGrassNotFoundAtRow", { row: rr.rowNumber, value: rr.grass }),
              source: rr.source,
            });
          }
          continue;
        }

        try {
          const payload: Record<string, unknown> = {
            id: globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${r0.rowNumber}`,
            table_id: defaultTableId,
            client_source: "nextjs",
            data: {
              project_name: r0.projectName,
              alias_title: r0.golfClub,
              company_name: r0.company,
              golf_course_architect: r0.architect,
              estimate_start_date: r0.estimateStartDate,
              start_date: r0.actualStartDate,
              deadline: r0.endDate,
              country_id: countryId,
              pic: staffId,
              project_type: r0.projectType,
              no_of_holes: r0.holes,
              key_areas: r0.keyAreas.join(","),
              quantity_required_sprig_sod: grassItems.map((x) => ({
                // Keep the same shape used by dynamic table rows on STSPortal.
                id:
                  globalThis.crypto?.randomUUID?.() ??
                  `g-${Date.now()}-${x.sourceRowNumber}`,
                product_id: x.product_id,
                quantity: x.quantity,
                uom: x.uom,
                quantity_kg:
                  String(x.uom).toLowerCase() === "kg"
                    ? Number.parseFloat(x.quantity)
                    : null,
                date: null,
                quantity_m2:
                  String(x.uom).toLowerCase() === "m2"
                    ? Number.parseFloat(x.quantity)
                    : null,
                zone_id: "",
                farm_id: "",
              })),
            },
          };
          const saveResponse = await updateMondayProjectParentItem(payload);
          if (saveResponse?.project && typeof saveResponse.project === "object") {
            upsertProjectInList(saveResponse.project);
          }
          if (r0.projectName) dbNames.add(normalizeLoose(r0.projectName));
          dbKeys.add(rowKey);
          for (const rr of g.rows) {
            logs.push({
              rowNumber: rr.rowNumber,
              status: "success",
              message:
                g.rows.length > 1
                  ? `Imported via merged project (${g.rows.length} rows)`
                  : t("logImportedSuccess"),
              source: rr.source,
            });
          }
        } catch (e) {
          for (const rr of g.rows) {
            logs.push({
              rowNumber: rr.rowNumber,
              status: "error",
              message: e instanceof Error ? e.message : t("logImportFailed"),
              source: rr.source,
            });
          }
        }
      }

      const successRows = logs.filter((l) => l.status === "success");
      const errorRows = logs.filter((l) => l.status === "error");
      setImportLogs(logs);
      setImportSummary(
        t("summaryDone", {
          success: successRows.length,
          error: errorRows.length,
          projects: new Set(
            successRows
              .map((x) => normalizeLoose(toStringSafe(x.source[mapping?.projectName ?? ""])))
              .filter(Boolean),
          ).size,
        }),
      );
      if (currentFileHash) {
        localStorage.setItem("stsrenew:projects-import:last-file-hash", currentFileHash);
      }
    } finally {
      setImporting(false);
    }
  };

  const downloadResult = (kind: "success" | "error") => {
    const picked = importLogs.filter((x) => x.status === kind);
    if (!picked.length) return;

    if (kind === "error") {
      const rowsOut = picked.map((x) => x.source);
      const logs = picked.map((x) => ({ rowIndex: x.rowNumber, messages: [x.message] }));
      downloadWorkbook("import-error.xlsx", rowsOut, logs);
      return;
    }

    const successRows = new Set(picked.map((x) => x.rowNumber));
    const out: Record<string, unknown>[] = [];
    const outLogs: RowIssue[] = [];
    for (const g of groupedProjects) {
      const successInGroup = g.rows.filter((r) => successRows.has(r.rowNumber));
      if (!successInGroup.length) continue;
      const base = successInGroup[0];
      const grassItems = successInGroup.map((r) => ({
        grassRaw: r.grass,
        uom: r.grassType,
        qty: r.grassRequired,
      }));
      const grassNames = grassItems
        .map((x) => {
          const idOrName = String(x.grassRaw ?? "").trim();
          if (!idOrName) return "";
          if (/^\d+$/.test(idOrName)) return productLabelById.get(idOrName) ?? idOrName;
          return idOrName;
        })
        .filter(Boolean);
      const qtyUomInline = grassItems
        .map((x, idx) => {
          const raw = String(x.grassRaw ?? "").trim();
          const name = grassNames[idx] ?? (raw || "-");
          const qty = String(x.qty ?? "").trim() || "-";
          const uom = String(x.uom ?? "").trim() || "-";
          return `${name}: ${qty} ${uom}`;
        })
        .join(" | ");
      out.push({
        project_name: base.projectName,
        alias_title: base.golfClub,
        company_name: base.company,
        golf_course_architect: base.architect,
        country: base.country,
        sts_pic: base.stsPic,
        estimate_start_date: base.estimateStartDate,
        actual_start_date: base.actualStartDate,
        deadline: base.endDate,
        project_type: base.projectType,
        no_of_holes: base.holes,
        key_areas: base.keyAreas.join(", "),
        grass_item_count: grassItems.length,
        grass_names: grassNames.join(" | "),
        grass_qty_uom: qtyUomInline,
        grass_summary: qtyUomInline,
      });
      outLogs.push({
        rowIndex: base.rowNumber,
        messages: [
          `Created project from ${successInGroup.length} grass row(s): ${successInGroup
            .map((x) => x.rowNumber)
            .join(", ")}`,
        ],
      });
    }
    downloadSuccessWorkbook("import-success.xlsx", out, outLogs);
  };

  const successCount = importLogs.filter((x) => x.status === "success").length;
  const errorCount = importLogs.filter((x) => x.status === "error").length;

  return (
    <RequireAuth>
      <DashboardLayout>
        <div className="p-4 lg:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl lg:text-3xl font-semibold text-gray-900">{t("title")}</h1>
            <button
              type="button"
              onClick={() => router.push("/projects")}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
            >
              {t("backToProjects")}
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-sm text-gray-700">
              {t("uploadHint")}
            </p>
            <a
              href="/api/projects/import-template"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 mr-2 text-sm text-gray-800 hover:bg-gray-50"
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
                    <span className="mb-1 block text-gray-700">
                      {t(`fields.${f.key}`)} {f.required ? <span className="text-red-600">*</span> : null}
                    </span>
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
                    {t("testResult", {
                      clean: testResult.okRows,
                      warning: testResult.warningRows,
                    })}
                  </p>
                  {testResult.rowsWithWarnings.slice(0, 10).map((warn) => (
                    <p key={`w-${warn.rowIndex}`} className="text-amber-700">
                      {t("rowPrefix", { row: warn.rowIndex })}: {warn.messages.join("; ")}
                    </p>
                  ))}
                </div>
              ) : null}

              {importLogs.length ? (
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
                        label={t("table.country")}
                        columnKey="country"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.stsPic")}
                        columnKey="stsPic"
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
                        label={t("table.holes")}
                        columnKey="holes"
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
                        label={t("table.uom")}
                        columnKey="uom"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                      <SortableTh
                        label={t("table.quantity")}
                        columnKey="quantity"
                        activeKey={sortKey}
                        direction={sortDir}
                        onSort={onSort}
                        className="px-3 py-2 text-gray-700 !normal-case"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroupedProjects.slice(0, 50).map((g) => {
                      const r0 = g.rows[0];
                      return (
                        <tr key={`g-${g.key}`} className="border-t border-gray-100">
                          <td className="px-3 py-2">{r0.rowNumber}</td>
                          <td className="px-3 py-2">
                            {r0.projectName}
                            {g.rows.length > 1 ? (
                              <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                                {t("grassRowsBadge", { count: g.rows.length })}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{r0.country}</td>
                          <td className="px-3 py-2">{r0.stsPic}</td>
                          <td className="px-3 py-2">{r0.projectType}</td>
                          <td className="px-3 py-2">{r0.holes}</td>
                          <td className="px-3 py-2">
                            {g.rows.map((x) => x.grass).filter(Boolean).join(", ")}
                          </td>
                          <td className="px-3 py-2">
                            {g.rows.map((x) => x.grassType).filter(Boolean).join(", ")}
                          </td>
                          <td className="px-3 py-2">
                            {g.rows.map((x) => x.grassRequired).filter(Boolean).join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {importSummary ? <p className="text-sm text-green-700">{importSummary}</p> : null}
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
