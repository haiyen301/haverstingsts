import * as XLSX from "xlsx";

import type { GrassRequirementLine } from "@/features/harvesting/lib/createMinimalProjectForHarvestImport";
import { buildProjectGrassRequirementsEditHref } from "@/features/harvesting/lib/buildProjectEditHref";
import { harvestTypeDisplayLabel } from "@/shared/lib/harvestType";

export type HarvestImportCreatedProjectExportItem = {
  projectName: string;
  projectId: string;
  rowId: string;
  tableId: string;
  customerName?: string;
  grassRequirements: GrassRequirementLine[];
};

const EXPORT_FILE_NAME = "Harvest-Import-Created-Projects.xlsx";
const EDIT_LINK_HEADER = "Edit Project Link";
const STATUS_HEADER = "Status";
const STATUS_MESSAGE =
  "Project did not exist — auto-created from harvest import. Please update project details.";

type TemplateColumnKey =
  | "projectName"
  | "customerName"
  | "grassType"
  | "quantity"
  | "sodSprig"
  | "editLink"
  | "status";

const TEMPLATE_HEADER_TO_KEY: Record<string, TemplateColumnKey> = {
  "Project Name": "projectName",
  "Customer Name": "customerName",
  "Grass Type": "grassType",
  Quantity: "quantity",
  "Sod/Sprig": "sodSprig",
};

function readTemplateHeaderRow(ws: XLSX.WorkSheet): string[] {
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
  const raw = (aoa[0] ?? []) as string[];
  let last = raw.length - 1;
  while (last >= 0 && !String(raw[last] ?? "").trim()) last -= 1;
  return raw.slice(0, last + 1).map((h) => String(h ?? "").trim());
}

function clearDataRows(ws: XLSX.WorkSheet, maxCol: number): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = 1; r <= range.e.r; r += 1) {
    for (let c = 0; c <= maxCol; c += 1) {
      delete ws[XLSX.utils.encode_cell({ r, c })];
    }
  }
}

function setTextCell(ws: XLSX.WorkSheet, row: number, col: number, value: string): void {
  const text = value.trim();
  if (!text) return;
  ws[XLSX.utils.encode_cell({ r: row, c: col })] = { v: text, t: "s" };
}

function setNumberCell(ws: XLSX.WorkSheet, row: number, col: number, value: number): void {
  if (!Number.isFinite(value)) return;
  ws[XLSX.utils.encode_cell({ r: row, c: col })] = { v: value, t: "n" };
}

function setHyperlinkCell(
  ws: XLSX.WorkSheet,
  row: number,
  col: number,
  url: string,
  label?: string,
): void {
  const href = url.trim();
  if (!href) return;
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const display = (label ?? href).trim() || href;
  ws[addr] = {
    v: display,
    t: "s",
    l: { Target: href, Tooltip: display },
  };
}

function sodSprigLabel(loadType: string): string {
  const label = harvestTypeDisplayLabel(loadType);
  return label ? label.toLowerCase().replace(/\s*->\s*/g, " ") : loadType.trim().toLowerCase();
}

/**
 * Builds an Excel workbook from `Projects-Import-Template.xlsx` for projects
 * auto-created during harvest import, with an edit-project link column.
 */
export async function downloadHarvestImportCreatedProjects(
  projects: HarvestImportCreatedProjectExportItem[],
  productLabelById: (productId: string) => string,
  origin?: string,
  statusMessage = STATUS_MESSAGE,
): Promise<void> {
  if (!projects.length) return;

  const res = await fetch("/api/projects/import-template", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Could not load project import template (${res.status}).`);
  }

  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Project import template has no sheet.");

  const headers = readTemplateHeaderRow(ws);
  const colByKey = new Map<TemplateColumnKey, number>();
  headers.forEach((header, idx) => {
    const key = TEMPLATE_HEADER_TO_KEY[header];
    if (key) colByKey.set(key, idx);
  });

  const editLinkColIdx = headers.length;
  const statusColIdx = headers.length + 1;
  clearDataRows(ws, statusColIdx);

  ws[XLSX.utils.encode_cell({ r: 0, c: editLinkColIdx })] = {
    v: EDIT_LINK_HEADER,
    t: "s",
  };
  ws[XLSX.utils.encode_cell({ r: 0, c: statusColIdx })] = {
    v: STATUS_HEADER,
    t: "s",
  };

  const exportRows: Array<{
    project: HarvestImportCreatedProjectExportItem;
    grass: GrassRequirementLine;
  }> = [];
  for (const project of projects) {
    for (const grass of project.grassRequirements) {
      exportRows.push({ project, grass });
    }
  }

  exportRows.forEach(({ project, grass }, i) => {
    const rowIdx = i + 1;
    const editHref = buildProjectGrassRequirementsEditHref({
      rowId: project.rowId,
      tableId: project.tableId,
      origin,
    });

    const projectNameCol = colByKey.get("projectName");
    if (projectNameCol != null) {
      setTextCell(ws, rowIdx, projectNameCol, project.projectName);
    }

    const customerCol = colByKey.get("customerName");
    if (customerCol != null && project.customerName?.trim()) {
      setTextCell(ws, rowIdx, customerCol, project.customerName);
    }

    const grassCol = colByKey.get("grassType");
    if (grassCol != null) {
      const grassLabel = productLabelById(grass.product_id) || grass.product_id;
      setTextCell(ws, rowIdx, grassCol, grassLabel);
    }

    const qtyCol = colByKey.get("quantity");
    if (qtyCol != null) {
      const qty = Number.parseFloat(String(grass.quantity).replaceAll(",", ""));
      if (Number.isFinite(qty)) setNumberCell(ws, rowIdx, qtyCol, qty);
    }

    const sodSprigCol = colByKey.get("sodSprig");
    if (sodSprigCol != null) {
      setTextCell(ws, rowIdx, sodSprigCol, sodSprigLabel(grass.load_type));
    }

    setHyperlinkCell(ws, rowIdx, editLinkColIdx, editHref, "Edit project");
    setTextCell(ws, rowIdx, statusColIdx, statusMessage);
  });

  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, exportRows.length), c: statusColIdx },
  });

  XLSX.writeFile(wb, EXPORT_FILE_NAME);
}
