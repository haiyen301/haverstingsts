import type { HarvestListExportResolveContext } from "@/features/harvest/lib/harvestListExport";

export const DEMO_HARVEST_EXPORT_FARMS = [
  { id: "1", label: "Hoi An Farm" },
  { id: "2", label: "Da Nang Farm" },
] as const;

export const DEMO_HARVEST_EXPORT_GRASSES = [
  { id: "101", title: "Zeon Stolon" },
  { id: "102", title: "Primo Stolon" },
  { id: "103", title: "Zeon sod" },
  { id: "104", title: "TifEagle" },
  { id: "105", title: "Primo" },
] as const;

export const DEMO_HARVEST_EXPORT_PROJECTS = [
  { id: "p1", title: "Fairwinds - Pakistan", alias_title: "Fairwinds - Pakistan" },
  { id: "p2", title: "Floratine JP", alias_title: "Floratine JP" },
  { id: "p3", title: "Eco Park", alias_title: "Eco Park" },
  { id: "p4", title: "Tam Dao Golf", alias_title: "Tam Dao Golf" },
  { id: "p5", title: "DAI LAI GOLF CLUB", alias_title: "DAI LAI GOLF CLUB" },
  { id: "p6", title: "Sentosa Cove", alias_title: "Sentosa Cove" },
] as const;

export const DEMO_HARVEST_EXPORT_STATUSES = [
  "planned",
  "scheduled",
  "harvested",
  "delivered",
] as const;

type DemoHarvestSeed = {
  id: string;
  project_id: string;
  project_name: string;
  product_id: string;
  grass_name: string;
  farm_id: string;
  farm_name: string;
  quantity: number;
  uom: string;
  harvest_status: string;
  actual_harvest_date: string;
  delivery_harvest_date: string;
  shipment_required_date: string;
  general_note: string;
};

const DEMO_HARVEST_SEEDS: DemoHarvestSeed[] = [
  {
    id: "3",
    project_id: "p1",
    project_name: "Fairwinds - Pakistan",
    product_id: "101",
    grass_name: "Zeon Stolon",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 5000,
    uom: "KG",
    harvest_status: "delivered",
    actual_harvest_date: "2026-05-07",
    delivery_harvest_date: "2026-05-11",
    shipment_required_date: "2026-05-12",
    general_note: "ETD 14th May - ETA 17th May · Xe tải lạnh 9m",
  },
  {
    id: "4",
    project_id: "p2",
    project_name: "Floratine JP",
    product_id: "102",
    grass_name: "Primo Stolon",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 1400,
    uom: "KG",
    harvest_status: "delivered",
    actual_harvest_date: "2026-05-08",
    delivery_harvest_date: "2026-05-11",
    shipment_required_date: "2026-05-12",
    general_note: "ETD 14th May - ETA 17th May",
  },
  {
    id: "5a",
    project_id: "p1",
    project_name: "Fairwinds - Pakistan",
    product_id: "101",
    grass_name: "Zeon Stolon",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 1400,
    uom: "KG",
    harvest_status: "delivered",
    actual_harvest_date: "2026-05-09",
    delivery_harvest_date: "2026-05-11",
    shipment_required_date: "2026-05-12",
    general_note: "ETD 14th May - ETA 17th May · Xe tải lạnh 9m",
  },
  {
    id: "5b",
    project_id: "p1",
    project_name: "Fairwinds - Pakistan",
    product_id: "102",
    grass_name: "Primo Stolon",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 2500,
    uom: "KG",
    harvest_status: "delivered",
    actual_harvest_date: "2026-05-09",
    delivery_harvest_date: "2026-05-11",
    shipment_required_date: "2026-05-12",
    general_note: "ETD 14th May - ETA 17th May · Xe tải lạnh 9m",
  },
  {
    id: "8",
    project_id: "p4",
    project_name: "Tam Dao Golf",
    product_id: "101",
    grass_name: "Zeon stolon",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 3750,
    uom: "KG",
    harvest_status: "harvested",
    actual_harvest_date: "2026-05-30",
    delivery_harvest_date: "2026-06-02",
    shipment_required_date: "2026-06-03",
    general_note: "Xe tải lạnh 9m",
  },
  {
    id: "10a",
    project_id: "p3",
    project_name: "Eco Park",
    product_id: "103",
    grass_name: "Zeon sod",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 500,
    uom: "m2",
    harvest_status: "scheduled",
    actual_harvest_date: "2026-06-02",
    delivery_harvest_date: "2026-06-08",
    shipment_required_date: "2026-06-08",
    general_note: "Xe thường - nóng",
  },
  {
    id: "10b",
    project_id: "p3",
    project_name: "Eco Park",
    product_id: "103",
    grass_name: "Zeon sod",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 800,
    uom: "m2",
    harvest_status: "scheduled",
    actual_harvest_date: "2026-06-02",
    delivery_harvest_date: "2026-06-08",
    shipment_required_date: "2026-06-08",
    general_note: "Xe thường - nóng",
  },
  {
    id: "10c",
    project_id: "p3",
    project_name: "Eco Park",
    product_id: "103",
    grass_name: "Zeon sod",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 1200,
    uom: "m2",
    harvest_status: "scheduled",
    actual_harvest_date: "2026-06-02",
    delivery_harvest_date: "2026-06-08",
    shipment_required_date: "2026-06-08",
    general_note: "Xe thường - nóng",
  },
  {
    id: "10d",
    project_id: "p3",
    project_name: "Eco Park",
    product_id: "103",
    grass_name: "Zeon sod",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 600,
    uom: "m2",
    harvest_status: "scheduled",
    actual_harvest_date: "2026-06-02",
    delivery_harvest_date: "2026-06-08",
    shipment_required_date: "2026-06-08",
    general_note: "Xe thường - nóng",
  },
  {
    id: "17a",
    project_id: "p5",
    project_name: "DAI LAI GOLF CLUB",
    product_id: "105",
    grass_name: "Primo",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 100,
    uom: "Kg",
    harvest_status: "delivered",
    actual_harvest_date: "2024-06-22",
    delivery_harvest_date: "2024-06-22",
    shipment_required_date: "2024-06-23",
    general_note: "Domestic delivery",
  },
  {
    id: "17b",
    project_id: "p5",
    project_name: "DAI LAI GOLF CLUB",
    product_id: "104",
    grass_name: "TifEagle",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 500,
    uom: "Kg",
    harvest_status: "delivered",
    actual_harvest_date: "2024-06-22",
    delivery_harvest_date: "2024-06-22",
    shipment_required_date: "2024-06-23",
    general_note: "Domestic delivery",
  },
  {
    id: "17c",
    project_id: "p5",
    project_name: "DAI LAI GOLF CLUB",
    product_id: "105",
    grass_name: "Primo",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 2000,
    uom: "Kg",
    harvest_status: "delivered",
    actual_harvest_date: "2024-06-22",
    delivery_harvest_date: "2024-06-22",
    shipment_required_date: "2024-06-23",
    general_note: "Domestic delivery",
  },
  {
    id: "17d",
    project_id: "p5",
    project_name: "DAI LAI GOLF CLUB",
    product_id: "104",
    grass_name: "TifEagle",
    farm_id: "1",
    farm_name: "Hoi An Farm",
    quantity: 750,
    uom: "Kg",
    harvest_status: "delivered",
    actual_harvest_date: "2024-06-22",
    delivery_harvest_date: "2024-06-22",
    shipment_required_date: "2024-06-23",
    general_note: "Domestic delivery",
  },
  {
    id: "21",
    project_id: "p6",
    project_name: "Sentosa Cove",
    product_id: "101",
    grass_name: "Zeon Stolon",
    farm_id: "2",
    farm_name: "Da Nang Farm",
    quantity: 2200,
    uom: "KG",
    harvest_status: "planned",
    actual_harvest_date: "2026-07-10",
    delivery_harvest_date: "2026-07-15",
    shipment_required_date: "2026-07-18",
    general_note: "Reefer truck 12m",
  },
  {
    id: "22",
    project_id: "p2",
    project_name: "Floratine JP",
    product_id: "102",
    grass_name: "Primo Stolon",
    farm_id: "2",
    farm_name: "Da Nang Farm",
    quantity: 900,
    uom: "KG",
    harvest_status: "harvested",
    actual_harvest_date: "2026-06-15",
    delivery_harvest_date: "2026-06-18",
    shipment_required_date: "2026-06-20",
    general_note: "Air freight option",
  },
];

export function buildHarvestExportDemoRows(): Array<Record<string, unknown>> {
  return DEMO_HARVEST_SEEDS.map((row) => ({ ...row }));
}

export function buildHarvestExportDemoResolveContext(): HarvestListExportResolveContext {
  return {
    projects: DEMO_HARVEST_EXPORT_PROJECTS.map((p) => ({ ...p })),
    grasses: DEMO_HARVEST_EXPORT_GRASSES.map((g) => ({ ...g })),
    locale: "en",
  };
}

export function buildHarvestExportDemoProjectOptions(): Array<{ id: string; label: string }> {
  return DEMO_HARVEST_EXPORT_PROJECTS.map((p) => ({
    id: p.id,
    label: p.title,
  }));
}
