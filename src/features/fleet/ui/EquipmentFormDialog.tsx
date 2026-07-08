"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchEquipmentFormOptions,
  saveEquipment,
  type EquipmentBrandOption,
  type EquipmentRow,
  type EquipmentStatus,
} from "@/features/fleet/api/equipmentApi";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import { fetchStaffOptions } from "@/features/fleet/api/machineryApi";
import { useScopedFarmSelectOptions } from "@/shared/store/farmUserScope";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const STATUS_OPTIONS: Array<{ value: EquipmentStatus; labelKey: string }> = [
  { value: "Active", labelKey: "status.operational" },
  { value: "Under Maintenance", labelKey: "status.maintenance" },
  { value: "Out of Service", labelKey: "status.outOfService" },
];

type FormState = {
  brand_id: string;
  model: string;
  type: string;
  engine_code: string;
  hours_between_service: string;
  farm_id: string;
  assigned_to_user_id: string;
  status: EquipmentStatus;
};

function emptyForm(typeDefault = "", farmId = ""): FormState {
  return {
    brand_id: "",
    model: "",
    type: typeDefault,
    engine_code: "",
    hours_between_service: "250",
    farm_id: farmId,
    assigned_to_user_id: "",
    status: "Active",
  };
}

function equipmentToForm(eq: EquipmentRow): FormState {
  return {
    brand_id: eq.brand_id ? String(eq.brand_id) : "",
    model: eq.model_name || eq.model_short || eq.equipment_name || "",
    type: eq.type,
    engine_code: String(eq.engine_code ?? ""),
    hours_between_service: String(eq.hours_between_service ?? "250"),
    farm_id: String(eq.farm_id),
    assigned_to_user_id: eq.assigned_to_user_id ? String(eq.assigned_to_user_id) : "",
    status: (eq.status as EquipmentStatus) || "Active",
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (row: EquipmentRow) => void;
  equipment?: EquipmentRow | null;
};

export function EquipmentFormDialog({ open, onClose, onSaved, equipment = null }: Props) {
  const t = useTranslations("Equipment");
  const { types: machineryTypes } = useMachineryTypes();
  const farmOptions = useScopedFarmSelectOptions("equipment");

  const [brands, setBrands] = useState<EquipmentBrandOption[]>([]);
  const [staff, setStaff] = useState<Array<{ id: number | string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const isEdit = equipment != null;

  const loadFormOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [options, staffRows] = await Promise.all([
        fetchEquipmentFormOptions(),
        staff.length ? Promise.resolve(null) : fetchStaffOptions().catch(() => []),
      ]);
      setBrands(options.brands ?? []);
      if (staffRows) {
        setStaff(
          staffRows.map((s) => ({
            id: s.id,
            label:
              `${String(s.first_name ?? "").trim()} ${String(s.last_name ?? "").trim()}`.trim() ||
              String(s.id),
          })),
        );
      }
    } catch {
      setBrands([]);
    } finally {
      setOptionsLoading(false);
    }
  }, [staff.length]);

  useEffect(() => {
    if (!open) return;
    if (equipment) {
      setForm(equipmentToForm(equipment));
    } else {
      setForm(emptyForm(machineryTypes[0] ?? "", farmOptions[0]?.id ?? ""));
    }
    void loadFormOptions();
  }, [open, equipment, farmOptions, machineryTypes, loadFormOptions]);

  const brandOptions = useMemo(
    () =>
      brands.map((brand) => ({
        value: String(brand.id),
        label: brand.name || brand.title || `#${brand.id}`,
      })),
    [brands],
  );

  const picOptions = useMemo(
    () =>
      staff.map((s) => ({
        value: String(s.id),
        label: s.label,
      })),
    [staff],
  );

  const handleSave = async () => {
    const brandId = Number(form.brand_id);
    const farmId = Number(form.farm_id);
    if (
      !form.brand_id ||
      !form.type ||
      !Number.isFinite(brandId) ||
      brandId <= 0 ||
      !Number.isFinite(farmId) ||
      farmId <= 0
    ) {
      toast.error(t("errors.requiredFields"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    try {
      setSaving(true);
      const row = await saveEquipment({
        id: equipment?.id,
        brand_id: brandId,
        model_name: form.model.trim() || undefined,
        type: form.type,
        engine_code: form.engine_code.trim() || undefined,
        farm_id: farmId,
        assigned_to_user_id: form.assigned_to_user_id
          ? Number(form.assigned_to_user_id)
          : null,
        hours_between_service: form.hours_between_service
          ? Number(form.hours_between_service)
          : undefined,
        status: form.status,
      });
      toast.success(isEdit ? t("updated") : t("saved"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
      onSaved(row);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("errors.save"), {
        containerId: TOAST_CONTAINER_TOP_RIGHT,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? t("editTitle") : t("createTitle")}
          </h2>
          <button type="button" className={btnGhost} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.brand")} *</span>
            <MultiSelect
              options={brandOptions}
              values={form.brand_id ? [form.brand_id] : []}
              onChange={(next) => setForm((f) => ({ ...f, brand_id: next[0] ?? "" }))}
              placeholder={
                optionsLoading ? t("form.loadingBrands") : t("form.selectBrand")
              }
              className={selectClass}
              rightIcon={selectChevron}
              disabled={optionsLoading || saving || brandOptions.length === 0}
              multi={false}
              maxSelections={1}
              selectionSummary="full"
              showSelectedChipsInPopover={false}
            />
            {!optionsLoading && brandOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("form.noBrands")}</p>
            ) : null}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.type")} *</span>
            <select
              className={selectClass}
              value={form.type}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">{t("form.selectType")}</option>
              {machineryTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.model")}</span>
            <input
              className={inputClass}
              value={form.model}
              disabled={saving}
              placeholder={t("form.modelPlaceholder")}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.engineCode")}</span>
            <input
              className={inputClass}
              placeholder={t("form.engineCodePlaceholder")}
              value={form.engine_code}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, engine_code: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.hoursBetweenService")}</span>
            <input
              type="number"
              className={inputClass}
              placeholder={t("form.hoursBetweenServicePlaceholder")}
              value={form.hours_between_service}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, hours_between_service: e.target.value }))}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.farm")} *</span>
            <select
              className={selectClass}
              value={form.farm_id}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, farm_id: e.target.value }))}
            >
              <option value="">{t("form.selectFarm")}</option>
              {farmOptions.map((farm) => (
                <option key={farm.id} value={farm.id}>
                  {farm.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.status")} *</span>
            <select
              className={selectClass}
              value={form.status}
              disabled={saving}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as EquipmentStatus }))
              }
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.pic")}</span>
            <MultiSelect
              options={picOptions}
              values={form.assigned_to_user_id ? [form.assigned_to_user_id] : []}
              onChange={(next) =>
                setForm((f) => ({ ...f, assigned_to_user_id: next[0] ?? "" }))
              }
              placeholder={t("form.selectPic")}
              className={selectClass}
              rightIcon={selectChevron}
              disabled={saving}
              multi={false}
              maxSelections={1}
              selectionSummary="full"
              showSelectedChipsInPopover={false}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={btnOutline} onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {isEdit ? t("saveChanges") : t("registerSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
