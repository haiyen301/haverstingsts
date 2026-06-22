import {
  fetchMondayProjectRowsFromServer,
  updateMondayProjectParentItem,
} from "@/entities/projects";
import {
  HARVEST_IMPORT_CLIENT_SOURCE,
} from "@/features/harvesting/lib/harvestImportForecastBatch";
import {
  defaultHarvestTypeForUom,
  normalizeHarvestTypeStorageKey,
  type HarvestTypeStorageKey,
} from "@/shared/lib/harvestType";

export type HarvestImportRowForProjectSetup = {
  projectName: string;
  grass: string;
  harvestType: string;
  uom: "M2" | "Kg";
  quantity: string;
};

export type GrassRequirementLine = {
  product_id: string;
  quantity: string;
  uom: "Kg" | "M2";
  load_type: HarvestTypeStorageKey;
};

export type MissingProjectForHarvestImport = {
  projectName: string;
  reason: "not_found" | "no_dynamic_row";
  existingProjectId?: string;
  grassRequirements: GrassRequirementLine[];
};

function normalizeLoose(v: string): string {
  return v
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function uomForLoadType(loadType: HarvestTypeStorageKey): "Kg" | "M2" {
  return loadType === "sod" ? "M2" : "Kg";
}

export function resolveLoadTypeForHarvestRow(
  harvestType: string,
  uom: "M2" | "Kg",
): HarvestTypeStorageKey {
  const fromHarvest = normalizeHarvestTypeStorageKey(harvestType);
  if (fromHarvest) return fromHarvest;
  return defaultHarvestTypeForUom(uom);
}

/** Sum grass qty per product + load type for one project across all Excel rows. */
export function aggregateGrassRequirementsForProject(
  projectName: string,
  allRows: HarvestImportRowForProjectSetup[],
  resolveProductId: (grass: string) => string,
): GrassRequirementLine[] {
  const normProject = normalizeLoose(projectName);
  const agg = new Map<
    string,
    {
      productId: string;
      loadType: HarvestTypeStorageKey;
      uom: "Kg" | "M2";
      total: number;
    }
  >();

  for (const row of allRows) {
    if (!row.projectName.trim()) continue;
    if (normalizeLoose(row.projectName) !== normProject) continue;
    const productId = resolveProductId(row.grass);
    if (!productId) continue;
    const qty = Number.parseFloat(String(row.quantity ?? "").replaceAll(",", ""));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const loadType = resolveLoadTypeForHarvestRow(row.harvestType, row.uom);
    const uom = uomForLoadType(loadType);
    const key = `${productId}::${loadType}`;
    const prev = agg.get(key);
    if (prev) {
      prev.total += qty;
    } else {
      agg.set(key, { productId, loadType, uom, total: qty });
    }
  }

  return [...agg.values()].map((x) => ({
    product_id: x.productId,
    quantity: String(x.total),
    uom: x.uom,
    load_type: x.loadType,
  }));
}

export async function resolveDefaultProjectTableId(): Promise<string> {
  const res = await fetchMondayProjectRowsFromServer({ page: 1, perPage: 1 });
  const fromRaw = Array.isArray(res.raw)
    ? String((res.raw[0] as Record<string, unknown> | undefined)?.table_id ?? "").trim()
    : "";
  const fromRow = String(res.rows[0]?.table_id ?? "").trim();
  return fromRaw || fromRow;
}

export async function createMinimalProjectForHarvestImport(params: {
  projectName: string;
  tableId: string;
  grassRequirements: GrassRequirementLine[];
  existingProjectId?: string;
}): Promise<{ projectId: string; project: unknown; rowId: string; tableId: string }> {
  const projectName = params.projectName.trim();
  if (!projectName) {
    throw new Error("Project name is required.");
  }
  if (!params.tableId.trim()) {
    throw new Error("Missing table_id for project create.");
  }
  if (!params.grassRequirements.length) {
    throw new Error("At least one grass requirement is required to create the project.");
  }

  const rowId =
    globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random()}`;
  const isExisting = Boolean(params.existingProjectId?.trim());

  const payload: Record<string, unknown> = {
    id: rowId,
    table_id: params.tableId,
    ...(isExisting ? {} : { client_source: HARVEST_IMPORT_CLIENT_SOURCE }),
    data: {
      project_name: projectName,
      ...(isExisting ? { project_id: params.existingProjectId!.trim() } : {}),
      alias_title: "",
      company_name: "",
      golf_course_architect: "",
      estimate_start_date: "",
      start_date: "",
      deadline: "",
      country_id: "",
      pic: "",
      odoo_customer_id: "",
      project_type: "",
      no_of_holes: "none",
      key_areas: "",
      main_contact_name: "",
      main_contact_email: "",
      main_contact_phone: "",
      project_pace: "",
      pace_grass_batch_quantities: [],
      actual_completion_date: "",
      quantity_required_sprig_sod: params.grassRequirements.map((g) => ({
        id: globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${g.product_id}`,
        product_id: g.product_id,
        quantity: g.quantity,
        uom: g.uom,
        load_type: g.load_type,
      })),
    },
  };

  const saveResponse = await updateMondayProjectParentItem(payload);
  const proj = saveResponse?.project;
  const rowData = saveResponse?.row_data;

  const projectId = (() => {
    if (proj && typeof proj === "object") {
      const o = proj as Record<string, unknown>;
      const fromProject = String(o.project_id ?? o.id ?? "").trim();
      if (fromProject) return fromProject;
    }
    if (rowData && typeof rowData === "object") {
      const fromRow = String(
        (rowData as Record<string, unknown>).project_id ?? "",
      ).trim();
      if (fromRow) return fromRow;
    }
    if (isExisting) return params.existingProjectId!.trim();
    return "";
  })();

  if (!projectId) {
    throw new Error("Project created but missing project id in response.");
  }

  const mondayRowId = (() => {
    const savedId = String(saveResponse?.saved_id ?? "").trim();
    if (savedId) return savedId;
    if (rowData && typeof rowData === "object") {
      const rd = rowData as Record<string, unknown>;
      const fromRow = String(rd.id ?? rd.row_id ?? rd.id_row ?? "").trim();
      if (fromRow) return fromRow;
    }
    return rowId;
  })();

  return {
    projectId,
    project: proj ?? null,
    rowId: mondayRowId,
    tableId: params.tableId.trim(),
  };
}
