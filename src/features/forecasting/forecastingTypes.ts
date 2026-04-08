export type ForecastHarvestRow = {
  id: string;
  farm: string;
  grassType: string;
  harvestType: "sod" | "sprig";
  harvestDate: string;
  readyDate: string;
  quantity: number;
  isReady: boolean;
  daysUntilReady: number;
  /** Kg / M2 từ plan — để nhãn biểu đồ */
  uom?: string;
};
