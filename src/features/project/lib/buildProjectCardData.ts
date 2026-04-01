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

  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0] as unknown;
    if (first && typeof first === "object" && "file_name" in (first as Record<string, unknown>)) {
      const name = String((first as Record<string, unknown>).file_name ?? "").trim();
      return name || null;
    }
    if (typeof first === "string" && first.trim()) return first.trim();
  }

  if (parsed && typeof parsed === "object" && "file_name" in (parsed as Record<string, unknown>)) {
    const name = String((parsed as Record<string, unknown>).file_name ?? "").trim();
    return name || null;
  }

  if (typeof parsed === "string" && parsed.trim()) {
    return parsed.trim();
  }

  return null;
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
      uom: String(x.uom ?? "").trim() || undefined,
    }));
}

function calculateDeliveredQuantity(subitems: SubItem[], productId?: string, uom?: string): number {
  if (!productId) return 0;
  const uomNorm = String(uom ?? "").toLowerCase().trim();

  let total = 0;
  for (const s of subitems) {
    if (String(s.product_id ?? "") !== productId) continue;
    if (uomNorm) {
      const su = String(s.uom ?? "").toLowerCase().trim();
      if (su !== uomNorm) continue;
    }
    total += parseNumber(s.quantity);
  }
  return total;
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

/** Flutter _calculateProgress: satisfied requirements / total requirements * 100 */
function calculateProgress(subitems: SubItem[], requirements: QuantityRequiredProject[]): number {
  if (!requirements.length) return 0;

  const deliveredByProduct = new Map<string, number>();
  for (const s of subitems) {
    const pid = String(s.product_id ?? "").trim();
    if (!pid) continue;
    const q = parseNumber(s.quantity);
    if (q <= 0) continue;
    deliveredByProduct.set(pid, (deliveredByProduct.get(pid) ?? 0) + q);
  }

  let total = 0;
  let satisfied = 0;

  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    const required = parseNumber(r.quantity);
    if (!pid || required <= 0) continue;

    total += 1;
    const delivered = deliveredByProduct.get(pid) ?? 0;
    if (delivered >= required) satisfied += 1;
  }

  return total > 0 ? (satisfied / total) * 100 : 0;
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
    const percentage = requiredQty > 0 ? Math.round((remaining / requiredQty) * 100) : 0;

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
      avatar: assigneeAvatar || "https://i.pravatar.cc/64?img=11",
    },
  };
}
