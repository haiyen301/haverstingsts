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
import {
  calculateDeliveredQuantityDeliveryOnly,
  hasAnyDeliveryHarvestMatchingRequirementLines,
  hasAnyActualHarvestMatchingRequirementLines,
} from "./subitemDeliveredQuantity";
import { effectiveRequiredQuantity } from "./effectiveRequirementQuantity";
import { formatProjectTypeForDisplay } from "./projectTypeDisplay";

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
  let parsed = parseJsonMaybe(raw);
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as Record<string, unknown>).data)
  ) {
    parsed = (parsed as Record<string, unknown>).data as unknown[];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x === "object")
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({
      product_id: String(x.product_id ?? "").trim() || undefined,
      quantity: x.quantity as string | number | undefined,
      quantity_m2: x.quantity_m2 as string | number | null | undefined,
      quantity_kg: x.quantity_kg as string | number | null | undefined,
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
      project_id: String(x.project_id ?? "").trim() || undefined,
      product_id: String(x.product_id ?? "").trim() || undefined,
      quantity: x.quantity as string | number | undefined,
      quantity_harvested: x.quantity_harvested as string | number | undefined,
      delivery_harvest_date: String(x.delivery_harvest_date ?? "").trim() || undefined,
      actual_harvest_date: String(x.actual_harvest_date ?? "").trim() || undefined,
      uom: String(x.uom ?? "").trim() || undefined,
    }));
}

/** Real deadline for Warning; empty / placeholder => no Warning (Done vs Ongoing from quantities only). */
function hasDeadlineSetForWarning(deadlineRaw: unknown): boolean {
  const s = String(deadlineRaw ?? "").trim();
  if (!s || s === "0000-00-00" || s.toLowerCase() === "null") return false;
  if (s.startsWith("0000-00-00")) return false;
  const d = new Date(s.includes(" ") ? s.split(" ")[0]! : s);
  return !Number.isNaN(d.getTime());
}

/** Signed calendar days until deadline (0 = today is deadline); null if invalid. */
function deadlineCalendarDaysUntil(deadlineRaw: unknown): number | null {
  if (!hasDeadlineSetForWarning(deadlineRaw)) return null;
  const s = String(deadlineRaw ?? "").trim();
  const part = (s.includes(" ") ? s.split(" ")[0]! : s).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return null;
  const [y, m, d] = part.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const deadlineUtc = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((deadlineUtc - todayUtc) / 86400000);
}

/** Matches Harvesting.php: overdue, or last 7 days up to and including deadline, when not fully delivered. */
function shouldWarnDeadlineShortfall(deadlineRaw: unknown): boolean {
  const diff = deadlineCalendarDaysUntil(deadlineRaw);
  if (diff === null) return false;
  return diff < 0 || diff <= 7;
}

/**
 * Fallback when API omits status: mirrors server plan rules.
 */
function computeMondayStatus(
  subitems: SubItem[],
  requirements: QuantityRequiredProject[],
  deadlineRaw: unknown,
  harvestProjectId?: string,
  /** Parity with PHP: sts_project_harvesting_plan + quantity_required lines; null = infer from subitems only. */
  harvestPlanStarted?: boolean | null,
): ProjectStatus {
  if (!requirements.length) return "Ongoing";

  const hasPlannableLines = requirements.some(
    (r) => String(r.product_id ?? "").trim() !== "" && effectiveRequiredQuantity(r) > 0,
  );

  if (hasPlannableLines) {
    if (harvestPlanStarted === false) {
      return "Future";
    }
    if (harvestPlanStarted == null && !hasAnyDeliveryHarvestMatchingRequirementLines(subitems, requirements, harvestProjectId)) {
      return "Future";
    }
  } else {
    if (subitems.length === 0) return "Future";
    const hasAnyQuantity = subitems.some((item) => {
      const q = String(item.quantity ?? "").trim();
      return q !== "" && q !== "0";
    });
    if (!hasAnyQuantity) return "Future";
  }

  let allDone = true;
  let anyEvaluated = false;
  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    const requiredQty = effectiveRequiredQuantity(r);
    if (!pid || requiredQty <= 0) continue;
    anyEvaluated = true;
    const delivered = calculateDeliveredQuantityDeliveryOnly(
      subitems,
      r.product_id,
      r.uom,
      harvestProjectId,
    );
    if (delivered < requiredQty) {
      allDone = false;
      break;
    }
  }
  if (anyEvaluated && allDone) return "Done";

  // Business rule: actual date without delivery date remains Ongoing (never Warning).
  if (
    hasAnyActualHarvestMatchingRequirementLines(subitems, requirements, harvestProjectId) &&
    !hasAnyDeliveryHarvestMatchingRequirementLines(subitems, requirements, harvestProjectId)
  ) {
    return "Ongoing";
  }

  if (shouldWarnDeadlineShortfall(deadlineRaw) && anyEvaluated && !allDone) return "Warning";

  return "Ongoing";
}

/**
 * Overall progress: sum(delivered per requirement) / sum(required), same basis as row %.
 * (Legacy Flutter-style “count of fully satisfied lines” made the bar stay at 0% until 100% delivered.)
 */
function calculateProgress(
  subitems: SubItem[],
  requirements: QuantityRequiredProject[],
  harvestProjectId?: string,
): number {
  let totalRequired = 0;
  let totalDelivered = 0;
  for (const r of requirements) {
    const pid = String(r.product_id ?? "").trim();
    const required = effectiveRequiredQuantity(r);
    if (!pid || required <= 0) continue;
    totalRequired += required;
    totalDelivered += calculateDeliveredQuantityDeliveryOnly(
      subitems,
      r.product_id,
      r.uom,
      harvestProjectId,
    );
  }
  if (totalRequired <= 0) return 0;
  return Math.round((totalDelivered / totalRequired) * 100);
}

/**
 * Same status resolution as the project card badge (`buildProjectDataFromServerRow.status`):
 * when the API still says Ongoing but local quantities are fully delivered, treat as Done.
 * Use this for list filters so multi-select matches what the user sees on the card.
 */
export function resolveMondayCardStatusForListFilter(row: MondayProjectServerRow): ProjectStatus {
  const projectId = String(row.project_id ?? "").trim() || undefined;
  const requirements = normalizeRequirements(row.quantity_required_sprig_sod);
  const subitems = normalizeSubitems(row.subitems);
  const localMondayStatus = computeMondayStatus(
    subitems,
    requirements,
    row.deadline,
    projectId,
    row.harvest_plan_started,
  );
  const apiStatusRaw = String(row.status_app ?? row.status ?? "").trim();
  if (apiStatusRaw === "") return localMondayStatus;
  const apiNorm = normalizeStatus(apiStatusRaw);
  if (apiNorm === "Ongoing" && localMondayStatus === "Done") return "Done";
  return apiNorm;
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

  const progress = Math.round(calculateProgress(subitems, requirements, projectId));

  /** Harvesting.php sets this from `_mondayEffectiveStatusLabel` (includes per-line uom vs subitems). */
  const apiStatusRaw = String(row.status_app ?? row.status ?? "").trim();
  const localMondayStatus = computeMondayStatus(
    subitems,
    requirements,
    row.deadline,
    projectId,
    row.harvest_plan_started,
  );
  const resolvedStatus: ProjectStatus =
    apiStatusRaw !== ""
      ? (() => {
          const apiNorm = normalizeStatus(apiStatusRaw);
          if (apiNorm === "Ongoing" && localMondayStatus === "Done") return "Done";
          return apiNorm;
        })()
      : localMondayStatus;

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
    const requiredQty = effectiveRequiredQuantity(r);
    const deliveredQty = calculateDeliveredQuantityDeliveryOnly(
      subitems,
      r.product_id,
      r.uom,
      projectId,
    );
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
    /** API status; if API says Ongoing but delivery quantities satisfy all lines, show Done. */
    status: resolvedStatus,
    items,
    tags: [
      (() => {
        const raw = String(row.project_type ?? "").trim();
        const fromOpt = options.getProjectTypeLabel?.(raw);
        if (fromOpt) return fromOpt;
        return formatProjectTypeForDisplay(row.project_type);
      })(),
      noOfHoles ? `${noOfHoles} hole(s)` : "",
      keyAreas.display,
    ].filter(Boolean),
    assignee: {
      name: assigneeName,
      /** Empty when lookup misses; UI (`ProjectListItem`) resolves from staff store + full parser. */
      avatar: assigneeAvatar?.trim() || "",
    },
  };
}
