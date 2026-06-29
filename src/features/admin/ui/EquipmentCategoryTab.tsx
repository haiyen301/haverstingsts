"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";

import {
  fetchEquipmentCategoryConfig,
  saveEquipmentCategory,
  type EquipmentCategoryOption,
} from "@/features/fleet/api/equipmentApi";
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

function categoryLabel(
  cat: EquipmentCategoryOption,
  all: EquipmentCategoryOption[],
): string {
  return itemCategoryDisplayPath(cat, all);
}

export function EquipmentCategoryTab() {
  const t = useTranslations("AdminEquipmentCategory");
  const tCommon = useTranslations("Common");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<EquipmentCategoryOption[]>([]);
  const [savedLabels, setSavedLabels] = useState<string[]>([]);

  const sortedCategories = useMemo(
    () => sortItemCategoriesByPath(categories),
    [categories],
  );

  const categoryOptions = useMemo(
    () =>
      sortedCategories.map((cat) => ({
        value: String(cat.id),
        label: categoryLabel(cat, sortedCategories),
      })),
    [sortedCategories],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEquipmentCategoryConfig();
      setCategories(data.categories ?? []);
      const ids = (data.category?.category_ids ?? []).map(String);
      setSelectedIds(ids);
      const saved = data.category?.categories ?? [];
      setSavedLabels(
        saved
          .map((c) =>
            itemCategoryDisplayPath(
              {
                id: Number(c.id),
                title: String(c.title ?? ""),
                parent_id: c.parent_id ?? null,
                path: c.path ?? null,
              },
              data.categories ?? [],
            ),
          )
          .filter(Boolean),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const ids = selectedIds.map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      toast.error(t("errors.required"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveEquipmentCategory(ids);
      setSavedLabels(
        (saved.categories ?? [])
          .map((c) =>
            itemCategoryDisplayPath(
              {
                id: Number(c.id),
                title: String(c.title ?? ""),
                parent_id: c.parent_id ?? null,
                path: c.path ?? null,
              },
              categories,
            ),
          )
          .filter(Boolean),
      );
      toast.success(t("saved"), { containerId: TOAST_CONTAINER_TOP_RIGHT });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestFailed"));
    } finally {
      setSaving(false);
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
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="equipment-category">
                {t("fieldLabel")}
              </label>
              <p className="text-xs text-muted-foreground">{t("fieldHint")}</p>
              <MultiSelect
                options={categoryOptions}
                values={selectedIds}
                onChange={setSelectedIds}
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

            {savedLabels.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t("currentLabel")}</p>
                <ul className="space-y-0.5 text-sm text-foreground">
                  {savedLabels.map((label, index) => (
                    <li key={`${label}-${index}`} className="font-mono text-xs sm:text-sm">
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              type="button"
              className={btnPrimary}
              disabled={saving || selectedIds.length === 0}
              onClick={() => void handleSave()}
            >
              {saving ? tCommon("saving") : tCommon("save")}
            </button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
