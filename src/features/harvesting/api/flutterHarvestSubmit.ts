/**
 * Calls the same STSPortal endpoint and multipart shape as the **Flutter mobile app**
 * (`HarvestingRepo.flutterAddNewSubRow`, `mapFileImage` → `{field}_image`). The name marks
 * API compatibility, not the runtime: **Next.js uses this too** (`submitFlutterHarvest`).
 */

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import { stsProxyPostFormData } from "@/shared/api/stsProxyClient";

/** API base field names (match PHP `imageNamesNeedSaved` / Flutter keys). */
export const HARVEST_DOC_PHOTO_FIELDS = [
  "payment_img",
  "shipping_note_img",
  "thermostats_img",
  "truck_license_plate_img",
  "product_being_cut_img",
  "truck_loaded_img",
] as const;

export type HarvestDocPhotoField = (typeof HARVEST_DOC_PHOTO_FIELDS)[number];

export type FlutterNewHarvestInput = {
  /** New sub-row id; "0" for create. */
  id?: string;
  projectId: string;
  productId: string;
  zone: string;
  farmId: string;
  quantity: string;
  /** e.g. M2, Kg — matches backend harvesting plan */
  uom: string;
  harvestType: string;
  estimatedHarvestDate: string;
  estimatedHarvestEndDate?: string;
  actualHarvestDate: string;
  actualHarvestEndDate?: string;
  deliveryHarvestDate: string;
  doSoNumber: string;
  truckNote: string;
  shippingDispatchDetails?: string;
  generalNote?: string;
  licensePlate: string;
  country?: string;
  assignedTo?: string;
  status?: string;
  statusId?: string;
  name?: string;
  customerId?: string;
  shipmentRequiredDate?: string;
  doSoDate?: string;
  paymentId?: string;
  refHrvQtySprig?: string;
  referenceHarvestUom?: string;
  turfType?: string;
  /**
   * Maps to `harvested_area` (Flutter `harvestedAreaController`).
   * Required when Actual Harvest Date is set (Sod, Sod -> Sprig, or Sprig/Kg).
   */
  harvestedArea?: string;
  /** Maps to `created_by` in `project_harvesting_plan` (set on create). */
  createdBy?: string;
};

export type HarvestPhotoFiles = Partial<Record<HarvestDocPhotoField, File>>;

export type HarvestingRemovedPayload = {
  /** Per field, basenames to remove (Flutter `images_removed`). */
  imagesRemoved?: Partial<Record<HarvestDocPhotoField, string[]>>;
  filesRemoved?: Partial<Record<HarvestDocPhotoField, string[]>>;
};

function stripCommas(n: string): string {
  return n.replace(/,/g, "").trim();
}

function buildRecordsJson(
  input: FlutterNewHarvestInput,
  removed?: HarvestingRemovedPayload,
) {
  const newSub: Record<string, string | null> = {
    id: input.id ?? "0",
    project_id: input.projectId,
    name: input.name ?? "",
    estimated_harvest_date: input.estimatedHarvestDate.trim() || null,
    estimated_harvest_end_date: input.estimatedHarvestEndDate?.trim() || null,
    actual_harvest_end_date: input.actualHarvestEndDate?.trim() || null,
    product_id: input.productId,
    farm_id: input.farmId,
    zone: input.zone,
    quantity: stripCommas(input.quantity),
    uom: input.uom.trim(),
    assigned_to: (input.assignedTo ?? "").trim(),
    actual_harvest_date: input.actualHarvestDate.trim() || null,
    delivery_harvest_date: input.deliveryHarvestDate.trim() || null,
    shipment_required_date: input.shipmentRequiredDate?.trim() || null,
    truck_note: input.truckNote.trim() || null,
    shipping_dispatch_details: input.shippingDispatchDetails?.trim() || null,
    general_note: input.generalNote?.trim() || null,
    load_type: input.harvestType.trim() || null,
    country: (input.country ?? "").trim(),
    status: (input.status ?? "").trim(),
    status_id: (input.statusId ?? "").trim(),
    customer_id: input.customerId?.trim() || null,
    do_so_date: input.doSoDate?.trim() || null,
    do_so_number: input.doSoNumber.trim() || null,
    payment_id: input.paymentId?.trim() || null,
    ref_hrv_qty_sprig: input.refHrvQtySprig?.trim()
      ? stripCommas(input.refHrvQtySprig)
      : null,
    reference_harvest_uom: input.referenceHarvestUom?.trim() || null,
    turf_type: input.turfType?.trim() || null,
    harvested_area: input.harvestedArea?.trim()
      ? stripCommas(input.harvestedArea)
      : null,
    license_plate: input.licensePlate.trim() || null,
    created_by: input.createdBy?.trim() || null,
  };

  const uploadTypes: Record<string, "single"> = {};
  for (const f of HARVEST_DOC_PHOTO_FIELDS) {
    uploadTypes[f] = "single";
  }

  const images_removed: Record<string, string[]> = {};
  const files_removed: Record<string, string[]> = {};
  if (removed?.imagesRemoved) {
    for (const [k, v] of Object.entries(removed.imagesRemoved)) {
      if (v?.length) images_removed[k] = v;
    }
  }
  if (removed?.filesRemoved) {
    for (const [k, v] of Object.entries(removed.filesRemoved)) {
      if (v?.length) files_removed[k] = v;
    }
  }

  const recordsData = {
    newSub,
    images_removed,
    files_removed,
    upload_types: uploadTypes,
  };

  return JSON.stringify(recordsData);
}

/** Multipart body: `records` JSON string + one file per key `{apiField}_image`. */
export function buildFlutterHarvestFormData(
  input: FlutterNewHarvestInput,
  photos: HarvestPhotoFiles,
  removed?: HarvestingRemovedPayload,
): FormData {
  const fd = new FormData();
  fd.append("records", buildRecordsJson(input, removed));
  for (const field of HARVEST_DOC_PHOTO_FIELDS) {
    const file = photos[field];
    if (file) {
      fd.append(`${field}_image`, file, file.name);
    }
  }
  return fd;
}

export async function submitFlutterHarvest(
  input: FlutterNewHarvestInput,
  photos: HarvestPhotoFiles,
  removed?: HarvestingRemovedPayload,
): Promise<unknown> {
  const fd = buildFlutterHarvestFormData(input, photos, removed);
  return stsProxyPostFormData<unknown>(
    STS_API_PATHS.flutterAddHarvestSubRow,
    fd,
  );
}
