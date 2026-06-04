export type HarvestScheduleStatus = "planned" | "scheduled" | "harvested" | "delivered";

export type HarvestSchedulePrimaryDateKind = "actual" | "estimated";

export type HarvestScheduleCalendarEntry = {
  id: string;
  date: string;
  actualDate: string;
  estimatedDateStart: string;
  estimatedDateEnd: string;
  project: string;
  farm: string;
  zone: string;
  grassType: string;
  harvestType: string;
  quantity: number;
  quantityUom: string;
  status: HarvestScheduleStatus;
  estimatedAreaM2: number;
  deliveryDate: string;
  truckNote: string;
  generalNote: string;
};
