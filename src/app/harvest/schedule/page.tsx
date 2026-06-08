"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlignLeft, ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import RequireAuth from "@/features/auth/RequireAuth";
import { HarvestScheduleCalendar } from "@/features/harvest/HarvestScheduleCalendar";
import { useHarvestScheduleMonthData } from "@/features/harvest/useHarvestScheduleMonthData";
import { useSyncedFarmMultiSelect } from "@/shared/hooks/useSyncedFarmMultiSelect";
import { useGrassFilterByFarm } from "@/shared/hooks/useGrassFilterByFarm";
import { mapRowsToSelectOptions } from "@/shared/lib/harvestReferenceData";
import { bgSurfaceFilter } from "@/shared/lib/surfaceFilter";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { MultiSelect } from "@/shared/ui/multi-select";
import { DashboardLayout } from "@/widgets/layout/DashboardLayout";

const SCHEDULE_RETURN_TO = "/harvest/schedule";

export default function HarvestSchedulePage() {
  const t = useTranslations("HarvestSchedule");
  const tHarvest = useTranslations("Harvest");
  const [grassFilterIds, setGrassFilterIds] = useState<string[]>([]);

  const harvestDetailHref = useCallback(
    (id: string) =>
      `/harvest/detail?id=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(SCHEDULE_RETURN_TO)}`,
    [],
  );
  const { selectedFarmIds, setSelectedFarmIds } = useSyncedFarmMultiSelect();
  const farms = useHarvestingDataStore((s) => s.farms);
  const grasses = useHarvestingDataStore((s) => s.grasses);
  const zoneConfigurations = useHarvestingDataStore((s) => s.zoneConfigurations);
  const fetchAllHarvestingReferenceData = useHarvestingDataStore(
    (s) => s.fetchAllHarvestingReferenceData,
  );

  const { grassFilterOptions } = useGrassFilterByFarm({
    grasses: grasses as unknown[],
    zoneConfigs: zoneConfigurations,
    selectedFarmIds,
    selectedGrassIds: grassFilterIds,
    onSelectedGrassIdsChange: setGrassFilterIds,
    catalogMode: "all",
  });

  const {
    filterMonth,
    filterYear,
    viewMonth,
    scheduleDateRange,
    selectedDayYmd,
    setSelectedDayYmd,
    handleFilterMonthYearChange,
    handleViewMonthChange,
    monthEntries,
    toCalendarEntries,
    navigationDisabled,
    statusMessage,
    statusIsError,
    isLoading,
  } = useHarvestScheduleMonthData();

  useEffect(() => {
    void fetchAllHarvestingReferenceData();
  }, [fetchAllHarvestingReferenceData]);

  const farmOptions = useMemo(
    () => mapRowsToSelectOptions(farms as unknown[], "name"),
    [farms],
  );

  const selectedFarmNames = useMemo(() => {
    if (selectedFarmIds.length === 0) return null;
    const names = new Set<string>();
    for (const id of selectedFarmIds) {
      const label = farmOptions.find((f) => f.id === id)?.label?.trim();
      if (label) names.add(label);
    }
    return names;
  }, [selectedFarmIds, farmOptions]);

  const grassLabelByProductId = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grasses) {
      if (!g || typeof g !== "object") continue;
      const rec = g as Record<string, unknown>;
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      const label = String(rec.title ?? rec.name ?? "").trim();
      if (label) m.set(id, label);
    }
    return m;
  }, [grasses]);

  const grassFilterOptionsSorted = useMemo(
    () => [...grassFilterOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [grassFilterOptions],
  );

  const filtered = useMemo(
    () =>
      monthEntries.filter((entry) => {
        if (selectedFarmNames && !selectedFarmNames.has(entry.farm)) return false;
        if (grassFilterIds.length === 0) return true;
        return grassFilterIds.some((grassId) => {
          if (entry.grassProductId && entry.grassProductId === grassId) return true;
          const want = grassLabelByProductId.get(grassId);
          if (want && entry.grassType.trim() && entry.grassType.trim() === want.trim()) {
            return true;
          }
          return false;
        });
      }),
    [monthEntries, selectedFarmNames, grassFilterIds, grassLabelByProductId],
  );

  const calendarEntries = useMemo(
    () => toCalendarEntries(filtered),
    [filtered, toCalendarEntries],
  );

  const filterTriggerIcon = (
    <>
      <AlignLeft className="h-3.5 w-3.5 shrink-0" />
      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
    </>
  );

  const multiSelectBaseClass =
    "h-9 w-auto shrink-0 min-w-[120px] max-w-[160px] rounded-md border border-input text-sm hover:bg-btnhover/40";

  const scheduleToolbarFilters = (
    <>
      <MultiSelect
        options={farmOptions.map((f) => ({ value: f.id, label: f.label }))}
        values={selectedFarmIds}
        onChange={setSelectedFarmIds}
        placeholder={tHarvest("allFarms")}
        showAllOption
        className={cn(multiSelectBaseClass, bgSurfaceFilter(selectedFarmIds.length > 0))}
        rightIcon={filterTriggerIcon}
      />
      <MultiSelect
        options={grassFilterOptionsSorted}
        values={grassFilterIds}
        onChange={setGrassFilterIds}
        placeholder={t("allGrasses")}
        showAllOption
        className={cn(multiSelectBaseClass, bgSurfaceFilter(grassFilterIds.length > 0))}
        rightIcon={filterTriggerIcon}
      />
    </>
  );

  return (
    <RequireAuth>
      <DashboardLayout
        defaultSidebarCollapsed
        hideAppHeaderWhenSidebarCollapsed
        flushMainPadding
      >
        <div className="dashboard-harvesting-skin sts-hsc-viewport-fill flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <HarvestScheduleCalendar
            className="min-h-0 flex-1"
            entries={calendarEntries}
            filterRangeStart={scheduleDateRange.start}
            filterRangeEnd={scheduleDateRange.end}
            filterMonth={filterMonth}
            filterYear={filterYear}
            onFilterMonthYearChange={handleFilterMonthYearChange}
            viewMonth={viewMonth}
            onViewMonthChange={handleViewMonthChange}
            selectedDayYmd={selectedDayYmd}
            onSelectedDayYmdChange={setSelectedDayYmd}
            detailHref={harvestDetailHref}
            isLoading={isLoading}
            navigationDisabled={navigationDisabled}
            statusMessage={statusMessage}
            statusIsError={statusIsError}
            toolbarLeading={scheduleToolbarFilters}
          />
        </div>
      </DashboardLayout>
    </RequireAuth>
  );
}
