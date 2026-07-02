"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchFleetCategorySettingsConfig,
  saveFleetCategorySettings,
  type FleetCategoryModule,
  type FleetCategoryModuleConfig,
  type FleetCategoryOption,
} from "@/features/fleet/api/fleetItemCategoriesApi";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  itemCategoryDisplayPath,
  sortItemCategoriesByPath,
} from "@/shared/lib/itemCategoryPath";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const selectClass = "h-9 w-full max-w-2xl rounded-md text-sm shadow-sm";
const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;

type ModuleState = {
  selectedIds: string[];
  excludedIds: string[];
  savedLabels: string[];
  savedExcludedLabels: string[];
};

function categoryLabel(cat: FleetCategoryOption, all: FleetCategoryOption[]): string {
  return itemCategoryDisplayPath(cat, all);
}

function labelsFromConfig(
  config: FleetCategoryModuleConfig | undefined,
  all: FleetCategoryOption[],
  key: "categories" | "excluded_categories" = "categories",
): string[] {
  return (config?.[key] ?? [])
    .map((c) =>
      itemCategoryDisplayPath(
        {
          id: Number(c.id),
          title: String(c.title ?? ""),
          parent_id: c.parent_id ?? null,
          path: c.path ?? null,
        },
        all,
      ),
    )
    .filter(Boolean);
}

function CategoryLabels({ title, labels }: { title: string; labels: string[] }) {
  if (labels.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-0.5 text-sm text-foreground">
        {labels.map((label, index) => (
          <li key={`${label}-${index}`} className="font-mono text-xs sm:text-sm">
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

type ModuleSectionProps = {
  module: FleetCategoryModule;
  title: string;
  hint: string;
  fieldLabel: string;
  fieldHint: string;
  excludedFieldLabel?: string;
  excludedFieldHint?: string;
  note?: string;
  categories: FleetCategoryOption[];
  state: ModuleState;
  saving: boolean;
  onSelectedChange: (ids: string[]) => void;
  onExcludedChange?: (ids: string[]) => void;
  onSave: () => void;
};

function ModuleSection({
  title,
  hint,
  fieldLabel,
  fieldHint,
  excludedFieldLabel,
  excludedFieldHint,
  note,
  categories,
  state,
  saving,
  onSelectedChange,
  onExcludedChange,
  onSave,
}: ModuleSectionProps) {
  const t = useTranslations("AdminFleetCategories");
  const tCommon = useTranslations("Common");

  const categoryOptions = useMemo(
    () =>
      categories.map((cat) => ({
        value: String(cat.id),
        label: categoryLabel(cat, categories),
      })),
    [categories],
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
          {note ? <p className="text-xs text-muted-foreground italic">{note}</p> : null}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">{fieldLabel}</label>
          <p className="text-xs text-muted-foreground">{fieldHint}</p>
          <MultiSelect
            options={categoryOptions}
            values={state.selectedIds}
            onChange={onSelectedChange}
            placeholder={t("selectPlaceholder")}
            className={cn(selectClass)}
            rightIcon={selectChevron}
            disabled={saving}
            multi
            selectionSummary="compact"
            compactNameThreshold={1}
            showSelectedChipsInPopover
            formatSelectedCount={(count) => t("selectedCount", { count })}
          />
        </div>

        {excludedFieldLabel && onExcludedChange ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">{excludedFieldLabel}</label>
            <p className="text-xs text-muted-foreground">{excludedFieldHint}</p>
            <MultiSelect
              options={categoryOptions}
              values={state.excludedIds}
              onChange={onExcludedChange}
              placeholder={t("selectExcludedPlaceholder")}
              className={cn(selectClass)}
              rightIcon={selectChevron}
              disabled={saving}
              multi
              selectionSummary="compact"
              compactNameThreshold={1}
              showSelectedChipsInPopover
              formatSelectedCount={(count) => t("selectedCount", { count })}
            />
          </div>
        ) : null}

        <CategoryLabels title={t("currentLabel")} labels={state.savedLabels} />
        {state.savedExcludedLabels.length > 0 ? (
          <CategoryLabels title={t("currentExcludedLabel")} labels={state.savedExcludedLabels} />
        ) : null}

        <button
          type="button"
          className={btnPrimary}
          disabled={saving || state.selectedIds.length === 0}
          onClick={onSave}
        >
          {saving ? tCommon("saving") : tCommon("save")}
        </button>
      </CardContent>
    </Card>
  );
}

function moduleStateFromConfig(
  config: FleetCategoryModuleConfig | undefined,
  all: FleetCategoryOption[],
): ModuleState {
  return {
    selectedIds: (config?.category_ids ?? []).map(String),
    excludedIds: (config?.excluded_category_ids ?? []).map(String),
    savedLabels: labelsFromConfig(config, all, "categories"),
    savedExcludedLabels: labelsFromConfig(config, all, "excluded_categories"),
  };
}

export function FleetCategorySettingsTab() {
  const t = useTranslations("AdminFleetCategories");
  const [loading, setLoading] = useState(true);
  const [savingModule, setSavingModule] = useState<FleetCategoryModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FleetCategoryOption[]>([]);
  const [equipment, setEquipment] = useState<ModuleState>({
    selectedIds: [],
    excludedIds: [],
    savedLabels: [],
    savedExcludedLabels: [],
  });
  const [fertilizerUsage, setFertilizerUsage] = useState<ModuleState>({
    selectedIds: [],
    excludedIds: [],
    savedLabels: [],
    savedExcludedLabels: [],
  });
  const [vehicleInspection, setVehicleInspection] = useState<ModuleState>({
    selectedIds: [],
    excludedIds: [],
    savedLabels: [],
    savedExcludedLabels: [],
  });

  const sortedCategories = useMemo(
    () => sortItemCategoriesByPath(categories),
    [categories],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFleetCategorySettingsConfig();
      const all = data.categories ?? [];
      setCategories(all);
      setEquipment(moduleStateFromConfig(data.equipment, all));
      setFertilizerUsage(moduleStateFromConfig(data.fertilizer_usage, all));
      setVehicleInspection(moduleStateFromConfig(data.vehicle_inspection, all));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (
    module: FleetCategoryModule,
    selectedIds: string[],
    excludedIds: string[],
    setState: (state: ModuleState) => void,
  ) => {
    const ids = selectedIds.map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      toast.error(t("errors.required"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }

    const excluded = excludedIds
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0);

    setSavingModule(module);
    setError(null);
    try {
      const saved = await saveFleetCategorySettings(
        module,
        ids,
        module === "vehicle_inspection" ? excluded : undefined,
      );
      const config = saved.config;
      setState({
        selectedIds: (config.category_ids ?? []).map(String),
        excludedIds: (config.excluded_category_ids ?? []).map(String),
        savedLabels: labelsFromConfig(config, sortedCategories, "categories"),
        savedExcludedLabels: labelsFromConfig(config, sortedCategories, "excluded_categories"),
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setSavingModule(null);
    }
  };

  return (
    <div className="space-y-6 p-4 text-foreground lg:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground lg:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!loading ? (
        <div className="space-y-6">
          <ModuleSection
            module="equipment"
            title={t("equipment.title")}
            hint={t("equipment.hint")}
            fieldLabel={t("fieldLabel")}
            fieldHint={t("fieldHint")}
            categories={sortedCategories}
            state={equipment}
            saving={savingModule === "equipment"}
            onSelectedChange={(ids) => setEquipment((s) => ({ ...s, selectedIds: ids }))}
            onSave={() =>
              void handleSave("equipment", equipment.selectedIds, [], setEquipment)
            }
          />

          <ModuleSection
            module="fertilizer_usage"
            title={t("fertilizerUsage.title")}
            hint={t("fertilizerUsage.hint")}
            fieldLabel={t("fieldLabel")}
            fieldHint={t("fieldHint")}
            categories={sortedCategories}
            state={fertilizerUsage}
            saving={savingModule === "fertilizer_usage"}
            onSelectedChange={(ids) => setFertilizerUsage((s) => ({ ...s, selectedIds: ids }))}
            onSave={() =>
              void handleSave(
                "fertilizer_usage",
                fertilizerUsage.selectedIds,
                [],
                setFertilizerUsage,
              )
            }
          />

          <ModuleSection
            module="vehicle_inspection"
            title={t("vehicleInspection.title")}
            hint={t("vehicleInspection.hint")}
            note={t("fuelUsageNote")}
            fieldLabel={t("fieldLabel")}
            fieldHint={t("fieldHint")}
            excludedFieldLabel={t("excludedFieldLabel")}
            excludedFieldHint={t("excludedFieldHint")}
            categories={sortedCategories}
            state={vehicleInspection}
            saving={savingModule === "vehicle_inspection"}
            onSelectedChange={(ids) =>
              setVehicleInspection((s) => ({ ...s, selectedIds: ids }))
            }
            onExcludedChange={(ids) =>
              setVehicleInspection((s) => ({ ...s, excludedIds: ids }))
            }
            onSave={() =>
              void handleSave(
                "vehicle_inspection",
                vehicleInspection.selectedIds,
                vehicleInspection.excludedIds,
                setVehicleInspection,
              )
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Use FleetCategorySettingsTab */
export { FleetCategorySettingsTab as EquipmentCategoryTab };
