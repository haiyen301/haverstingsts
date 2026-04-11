import { STS_PUBLIC_PATHS, getStsDomainUrl } from "@/shared/config/stsUrls";
import * as dateFormat from "@/shared/lib/format/date";
import type {
  BuildProjectDataOptions,
  MondayProjectServerRow,
  ProjectData,
  ProjectItem,
  ProjectStatus,
  QuantityRequiredProject,
  SubItem,
} from "@/entities/projects";
import { parseJsonMaybe } from "./parseJson";
import { calculateDeliveredQuantity } from "./subitemDeliveredQuantity";

const DEFAULT_ASSIGNEE_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23E5E7EB'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%239CA3AF'/%3E%3Cpath d='M12 56c2.8-11.2 11-16 20-16s17.2 4.8 20 16' fill='%239CA3AF'/%3E%3C/svg%3E";

function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeProjectType(v: unknown): string {
  const t = String(v ?? "").toLowerCase().trim();
  if (t === "new" || t === "grassing_project") return "New";
  if (t === "renovation" || t === "renovation_project") return "Renovation";
  return "";
}

function normalizeStatus(v: unknown): ProjectStatus {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return "Done";
  if (s.includes("future")) return "Future";
  if (s.includes("warning")) return "Warning";
  return "Ongoing";
}

function parseKeyAreas(value: unknown): { full: string; display: string } {
  const decoded = parseJsonMaybe(value);
  let full = "";

  if (Array.isArray(decoded)) {
    full = decoded.map((x) => String(x)).join(", ");
  } else if (typeof decoded === "string") {
    full = decoded;
  }

  const parts = full
    .split(/,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

  // const display = parts.length >= 2 ? `${parts[0]}, ${parts[1]} ...` : full;
  const display = full;
  return { full, display };
}

function extractFileNameFromProjectImg(projectImg: unknown): string | null {
  const parsed = parseJsonMaybe(projectImg);
  const pickFileName = (v: unknown, allowPlainString = false): string | null => {
    if (!v) return null;
    if (typeof v === "string") {
      const s = v.trim();
      return allowPlainString ? s || null : null;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        const hit = pickFileName(item, allowPlainString);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const direct = String(rec.file_name ?? "").trim();
      if (direct) return direct;
      for (const value of Object.values(rec)) {
        const hit = pickFileName(value, false);
        if (hit) return hit;
      }
    }
    return null;
  };
  return pickFileName(parsed, true);
}

/** Resolve relative harvesting file path to absolute URL (Flutter UrlContainer.harvestingHref). */
export function resolveReactHarvestingImageUrl(fileNameOrUrl: string): string {
  const s = fileNameOrUrl.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const domain = getStsDomainUrl().replace(/\/$/, "");
  if (!domain) return s;

  if (s.startsWith("/")) return `${domain}${s}`;
  if (s.startsWith("files/")) return `${domain}/${s}`;
  if (s.startsWith("timeline_files/")) return `${domain}/files/${s}`;

  return `${domain}${STS_PUBLIC_PATHS.reactHarvesting}/${s}`;
}

function normalizeRequirements(raw: unknown): QuantityRequiredProject[] {
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x === "object")
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      product_id: String(x.product_id ?? "").trim() || undefined,
      quantity: x.quantity as string | number | undefined,
      uom: String(x.uom ?? "").trim() || undefined,
      zone_id: String(x.zone_id ?? "").trim() || undefined,
    }));
}

function normalizeSubitems(raw: unknown): SubItem[] {
  const parsed = parseJsonMaybe(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x === "object")
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      product_id: String(x.product_id ?? "").trim() || undefined,
      quantity: x.quantity as string | number | undefined,
      quantity_harvested: x.quantity_harvested as string | number | undefined,
      delivery_harvest_date: String(x.delivery_harvest_date ?? "").trim() || undefined,
      actual_harvest_date: String(x.actual_harvest_date ?? "").trim() || undefined,
      uom: String(x.uom ?? "").trim() || undefined,
    }));
}

function computeMondayStatus(
  subitems: SubItem[],
  requirements: QuantityRequiredProject[],
  deadlineRaw: unknown,
): ProjectStatus {
  if (!requirements.length) return "Ongoing";

  let allDone = true;
  for (const r of requirements) {
    const requiredQty = parseNumber(r.quantity);
    if (requiredQty <= 0) continue;
    const delivered = calculateDeliveredQuantity(subitems, r.product_id, r.uom);
    if (delivered < requiredQty) {
      allDone = false;
      break;
    }
  }
  if (allDone) return "Done";

  const deadline = String(deadlineRaw ?? "").trim();
  if (!deadline) return "Ongoing";

  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return "Ongoing";

  const today = new Date();
  const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  if (d.getTime() > endToday.getTime()) return "Future";
  return "Warning";
}

/**
 * Overall progress: sum(delivered per requirement) / sum(required), same basis as row %.
 * (Legacy Flutter-style “count of fully satisfied lines” made the bar stay at 0% until 100% delivered.)
 */
function calculateProgress(subitems: SubItem[], requirements: QuantityRequiredProject[]): number {
  let totalRequired = 0;
  let totalDelivered = 0;
  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    const required = parseNumber(r.quantity);
    if (!pid || required <= 0) continue;
    totalRequired += required;
    totalDelivered += calculateDeliveredQuantity(subitems, r.product_id, r.uom);
  }
  if (totalRequired <= 0) return 0;
  return Math.round((totalDelivered / totalRequired) * 100);
}

/**
 * Clone from Flutter MondayProjectCard._loadData + _calculateProgress + _buildSubitemsList mapping.
 */
export function buildProjectDataFromServerRow(
  row: MondayProjectServerRow,
  options: BuildProjectDataOptions = {},
): ProjectData {

  const projectId = String(row.project_id ?? "").trim() || undefined;
  const requirements = normalizeRequirements(row.quantity_required_sprig_sod);
  const subitems = normalizeSubitems(row.subitems);
  const actualStartDate = dateFormat.formatDateDisplay(row.start_date ?? "").trim();
  const estimateStartDate = dateFormat.formatDateDisplay(row.estimate_start_date ?? "").trim();
  const endDate = dateFormat.formatDateDisplay(row.deadline ?? "").trim();
  const keyAreas = parseKeyAreas(row.key_areas);
  const noOfHoles = String(row.no_of_holes ?? "").trim();

  const progress = Math.round(calculateProgress(subitems, requirements));

  const projectImageFile = extractFileNameFromProjectImg(row.project_img);
  const image = options.projectImageUrl?.trim()
    ? options.projectImageUrl
    : projectImageFile
      ? resolveReactHarvestingImageUrl(projectImageFile)
      : "";

  const titleFromLookup = options.getProjectTitleById?.(projectId);
  const fromRow = String(row.title ?? row.name ?? "").trim();
  let name = titleFromLookup?.trim() || fromRow;
  if (!name) {
    if (projectId && /^\d+$/.test(projectId)) {
      name = `Project #${projectId}`;
    } else if (projectId) {
      name = projectId;
    } else {
      name = "Unknown Project";
    }
  }

  const countryId = String(row.country_id ?? "").trim() || undefined;
  const countryName =
    options.getCountryNameById?.(countryId) || String(row.country ?? "").trim();

  const assigneeName =
    options.getUserNameById?.(String(row.pic ?? "").trim()) ||
    String(row.pic ?? "").trim() ||
    "N/A";
  const assigneeAvatar = options.getUserAvatarById?.(String(row.pic ?? "").trim())?.trim();

  const items: ProjectItem[] = requirements.map((r) => {
    const requiredQty = parseNumber(r.quantity);
    const deliveredQty = calculateDeliveredQuantity(subitems, r.product_id, r.uom);
    const remaining = Math.max(0, requiredQty - deliveredQty);
    const percentage = requiredQty > 0 ? Math.round((deliveredQty / requiredQty) * 100) : 0;

    const productName = options.getProductNameById?.(r.product_id) || r.product_id || "N/A";
    const uom = String(r.uom ?? "").trim();

    return {
      name: uom ? `${productName} (${uom})` : productName,
      required: requiredQty,
      delivered: deliveredQty,
      remaining,
      percentage: Math.max(0, Math.min(100, percentage)),
    };
  });

  return {
    id: String(row.row_id ?? row.id ?? ""),
    name: name.toUpperCase(),
    subtitle: String(row.alias_title ?? "").trim(),
    country_id: countryId || "",
    country_name: countryName,
    holes: Number.parseInt(noOfHoles, 10) || 0,
    estimatedStartDate: estimateStartDate,
    actualStartDate: actualStartDate,
    endDate: endDate,
    image,
    progress,
    status: row.status_app
      ? normalizeStatus(row.status_app)
      : row.status
        ? normalizeStatus(row.status)
        : computeMondayStatus(subitems, requirements, row.deadline),
    items,
    tags: [
      normalizeProjectType(row.project_type),
      noOfHoles ? `${noOfHoles} hole(s)` : "",
      keyAreas.display,
    ].filter(Boolean),
    assignee: {
      name: assigneeName,
      avatar: assigneeAvatar || DEFAULT_ASSIGNEE_AVATAR,
    },
  };
}
