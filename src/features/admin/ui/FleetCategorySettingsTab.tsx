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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  itemCategoryDisplayPath,
  sortItemCategoriesByPath,
} from "@/shared/lib/itemCategoryPath";
import { TOAST_CONTAINER_TOP_RIGHT } from "@/shared/ui/AppToasts";
import { MultiSelect } from "@/shared/ui/multi-select";

const btnPrimary =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const formSelectClass =
  "h-10 w-full rounded-md border-input bg-background text-sm text-foreground shadow-sm !border-border hover:bg-background";

const selectChevron = <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />;

type ModuleState = {
  selectedIds: string[];
  excludedIds: string[];
  savedSelectedIds: string[];
  savedExcludedIds: string[];
};

function categoryLabel(cat: FleetCategoryOption, all: FleetCategoryOption[]): string {
  return itemCategoryDisplayPath(cat, all);
}

function idsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function labelsFromIds(ids: string[], all: FleetCategoryOption[]): string[] {
  return ids
    .map((id) => {
      const cat = all.find((c) => String(c.id) === id);
      return cat ? categoryLabel(cat, all) : "";
    })
    .filter(Boolean);
}

function CategoryPathSegments({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-muted-foreground/40">/</span> : null}
          <span
            className={cn(
              "leading-tight",
              index === parts.length - 1 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {part}
          </span>
        </span>
      ))}
    </span>
  );
}

function SelectedCategoryList({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {labels.map((label, index) => (
        <li
          key={`${label}-${index}`}
          className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs sm:text-sm"
        >
          <CategoryPathSegments path={label} />
        </li>
      ))}
    </ul>
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

  const selectedLabels = useMemo(
    () => labelsFromIds(state.selectedIds, categories),
    [categories, state.selectedIds],
  );
  const excludedLabels = useMemo(
    () => labelsFromIds(state.excludedIds, categories),
    [categories, state.excludedIds],
  );

  const isDirty =
    !idsEqual(state.selectedIds, state.savedSelectedIds) ||
    !idsEqual(state.excludedIds, state.savedExcludedIds);

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <CardDescription className="text-sm">{hint}</CardDescription>
            {note ? <p className="text-xs text-muted-foreground italic">{note}</p> : null}
          </div>
          {isDirty ? (
            <Badge variant="outline" className="shrink-0 font-normal text-amber-700 border-amber-300 bg-amber-50">
              {tCommon("unsavedChanges")}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{fieldLabel}</label>
          <p className="text-xs leading-relaxed text-muted-foreground">{fieldHint}</p>
          <MultiSelect
            options={categoryOptions}
            values={state.selectedIds}
            onChange={onSelectedChange}
            placeholder={t("selectPlaceholder")}
            className={formSelectClass}
            rightIcon={selectChevron}
            disabled={saving}
            multi
            selectionSummary="count"
            formatSelectedCount={(count) => t("selectedCount", { count })}
          />
          <SelectedCategoryList labels={selectedLabels} />
        </div>

        {excludedFieldLabel && onExcludedChange ? (
          <div className="space-y-2 border-t border-border/60 pt-5">
            <label className="text-sm font-medium text-foreground">{excludedFieldLabel}</label>
            <p className="text-xs leading-relaxed text-muted-foreground">{excludedFieldHint}</p>
            <MultiSelect
              options={categoryOptions}
              values={state.excludedIds}
              onChange={onExcludedChange}
              placeholder={t("selectExcludedPlaceholder")}
              className={formSelectClass}
              rightIcon={selectChevron}
              disabled={saving}
              multi
              selectionSummary="count"
              formatSelectedCount={(count) => t("selectedCount", { count })}
            />
            <SelectedCategoryList labels={excludedLabels} />
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="justify-end border-t border-border/60 bg-muted/10">
        <button
          type="button"
          className={btnPrimary}
          disabled={saving || !isDirty || state.selectedIds.length === 0}
          onClick={onSave}
        >
          {saving ? tCommon("saving") : tCommon("save")}
        </button>
      </CardFooter>
    </Card>
  );
}

function moduleStateFromConfig(
  config: FleetCategoryModuleConfig | undefined,
): ModuleState {
  const selectedIds = (config?.category_ids ?? []).map(String);
  const excludedIds = (config?.excluded_category_ids ?? []).map(String);
  return {
    selectedIds,
    excludedIds,
    savedSelectedIds: [...selectedIds],
    savedExcludedIds: [...excludedIds],
  };
}

const emptyModuleState = (): ModuleState => ({
  selectedIds: [],
  excludedIds: [],
  savedSelectedIds: [],
  savedExcludedIds: [],
});

export function FleetCategorySettingsTab() {
  const t = useTranslations("AdminFleetCategories");
  const [loading, setLoading] = useState(true);
  const [savingModule, setSavingModule] = useState<FleetCategoryModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FleetCategoryOption[]>([]);
  const [equipment, setEquipment] = useState<ModuleState>(emptyModuleState());

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
      setEquipment(moduleStateFromConfig(data.equipment));
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
      const nextSelected = (config.category_ids ?? []).map(String);
      const nextExcluded = (config.excluded_category_ids ?? []).map(String);
      setState({
        selectedIds: nextSelected,
        excludedIds: nextExcluded,
        savedSelectedIds: [...nextSelected],
        savedExcludedIds: [...nextExcluded],
      });
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setSavingModule(null);
    }
  };

  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("subtitle")}</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!loading ? (
        <div className="space-y-5">
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
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Use FleetCategorySettingsTab */
export { FleetCategorySettingsTab as EquipmentCategoryTab };
