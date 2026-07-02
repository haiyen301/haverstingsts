"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  buildEquipmentProductSelectOption,
  fetchEquipmentFormOptions,
  saveEquipment,
  type EquipmentProductOption,
  type EquipmentRow,
  type EquipmentStatus,
} from "@/features/fleet/api/equipmentApi";
import { useMachineryTypes } from "@/features/fleet/hooks/useMachineryTypes";
import { fetchStaffOptions } from "@/features/fleet/api/machineryApi";
import { formatEquipmentModelDisplay } from "@/features/fleet/lib/equipmentModelDisplay";
import { cn } from "@/lib/utils";
import { useScopedFarmSelectOptions } from "@/shared/store/farmUserScope";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const inputClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";
const readOnlyClass = cn(inputClass, "bg-muted/50");
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;
const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const btnOutline =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnGhost =
  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FormState = {
  item_id: string;
  brand: string;
  model_display: string;
  type: string;
  engine_code: string;
  hours_between_service: string;
  farm_id: string;
  assigned_to_user_id: string;
};

function emptyForm(typeDefault = "", farmId = ""): FormState {
  return {
    item_id: "",
    brand: "",
    model_display: "",
    type: typeDefault,
    engine_code: "",
    hours_between_service: "250",
    farm_id: farmId,
    assigned_to_user_id: "",
  };
}

function equipmentToForm(eq: EquipmentRow): FormState {
  return {
    item_id: eq.item_id ? String(eq.item_id) : "",
    brand: eq.brand,
    model_display: eq.model || "",
    type: eq.type,
    engine_code: String(eq.engine_code ?? ""),
    hours_between_service: String(eq.hours_between_service ?? "250"),
    farm_id: String(eq.farm_id),
    assigned_to_user_id: eq.assigned_to_user_id ? String(eq.assigned_to_user_id) : "",
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

  const [products, setProducts] = useState<EquipmentProductOption[]>([]);
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
      setProducts(options.products ?? []);
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
      setProducts([]);
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

  const equipmentOptions = useMemo(
    () =>
      products.map((product) => {
        const parts = buildEquipmentProductSelectOption(product);
        return {
          value: String(product.id),
          label: parts.label,
          subLabel: parts.subLabel,
        };
      }),
    [products],
  );

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === form.item_id) ?? null,
    [products, form.item_id],
  );

  const applyEquipmentSelection = (itemId: string) => {
    const product = products.find((p) => String(p.id) === itemId);
    if (!product) {
      setForm((f) => ({ ...f, item_id: itemId, brand: "", model_display: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      item_id: itemId,
      brand: String(product.brand ?? "").trim(),
      model_display: formatEquipmentModelDisplay(product),
    }));
  };

  const handleSave = async () => {
    const itemId = Number(form.item_id);
    const farmId = Number(form.farm_id);
    if (
      !form.item_id ||
      !form.type ||
      !Number.isFinite(itemId) ||
      itemId <= 0 ||
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
        item_id: itemId,
        brand: form.brand.trim() || selectedProduct?.brand,
        equipment_name:
          selectedProduct?.equipment_name ?? selectedProduct?.model_short ?? "",
        type: form.type,
        engine_code: form.engine_code.trim() || undefined,
        farm_id: farmId,
        assigned_to_user_id: form.assigned_to_user_id
          ? Number(form.assigned_to_user_id)
          : null,
        hours_between_service: form.hours_between_service
          ? Number(form.hours_between_service)
          : undefined,
        status: isEdit
          ? (equipment.status as EquipmentStatus)
          : "Active",
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? t("editTitle") : t("createTitle")}
          </h2>
          <button type="button" className={btnGhost} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.equipment")} *</span>
            <MultiSelect
              options={equipmentOptions}
              values={form.item_id ? [form.item_id] : []}
              onChange={(next) => applyEquipmentSelection(next[0] ?? "")}
              placeholder={
                optionsLoading ? t("form.loadingProducts") : t("form.selectEquipment")
              }
              className={selectClass}
              rightIcon={selectChevron}
              disabled={optionsLoading || saving || equipmentOptions.length === 0}
              multi={false}
              maxSelections={1}
              selectionSummary="full"
              showSelectedChipsInPopover={false}
            />
            {!optionsLoading && equipmentOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("form.noProducts")}</p>
            ) : null}
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.brand")} *</span>
            <input className={readOnlyClass} value={form.brand} readOnly placeholder="—" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("form.type")} *</span>
            <select
              className={inputClass}
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
            <span className="text-xs font-medium">{t("form.model")} *</span>
            <textarea
              className={cn(readOnlyClass, "min-h-[120px] resize-none py-2 font-mono text-xs leading-relaxed")}
              value={form.model_display}
              readOnly
              rows={6}
              placeholder="—"
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
              className={inputClass}
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
            <span className="text-xs font-medium">{t("form.pic")}</span>
            <select
              className={inputClass}
              value={form.assigned_to_user_id}
              disabled={saving}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to_user_id: e.target.value }))}
            >
              <option value="">{t("form.selectPic")}</option>
              {staff.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.label}
                </option>
              ))}
            </select>
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
