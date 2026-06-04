"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { HarvestScheduleCalendar } from "@/features/harvest/HarvestScheduleCalendar";
import { useHarvestScheduleMonthData } from "@/features/harvest/useHarvestScheduleMonthData";
import type { HarvestScheduleStatus } from "@/features/harvest/harvestScheduleTypes";
import type { HarvestScheduleMonthEntry } from "@/features/harvest/harvestScheduleMonthNormalize";

type FarmOption = { id: string; label: string };

type HarvestListCalendarPanelProps = {
  detailHref: (id: string) => string;
  farmFilterIds: string[];
  farmOptions: FarmOption[];
  grassSelectValues: string[];
  grassLabelByProductId: Map<string, string>;
  statusSelectValues: string[];
  projectSelectValues: string[];
  debouncedSearch: string;
  /** Fill remaining viewport height (harvest list calendar mode). */
  fillViewport?: boolean;
  className?: string;
};

function entryMatchesGrassFilter(
  entry: HarvestScheduleMonthEntry,
  grassIds: string[],
  grassLabelByProductId: Map<string, string>,
): boolean {
  if (grassIds.length === 0) return true;
  return grassIds.some((grassId) => {
    if (entry.grassProductId && entry.grassProductId === grassId) return true;
    const want = grassLabelByProductId.get(grassId);
    if (want && entry.grassType.trim() && entry.grassType.trim() === want.trim()) {
      return true;
    }
    return false;
  });
}

function entryMatchesSearch(entry: HarvestScheduleMonthEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.id,
    entry.project,
    entry.farm,
    entry.grassType,
    entry.zone,
    entry.harvestType,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function HarvestListCalendarPanel({
  detailHref,
  farmFilterIds,
  farmOptions,
  grassSelectValues,
  grassLabelByProductId,
  statusSelectValues,
  projectSelectValues,
  debouncedSearch,
  fillViewport = false,
  className,
}: HarvestListCalendarPanelProps) {
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
  } = useHarvestScheduleMonthData({ enabled: true });

  const selectedFarmNames = useMemo(() => {
    if (farmFilterIds.length === 0) return null;
    const names = new Set<string>();
    for (const id of farmFilterIds) {
      const label = farmOptions.find((f) => f.id === id)?.label?.trim();
      if (label) names.add(label);
    }
    return names;
  }, [farmFilterIds, farmOptions]);

  const searchQ = debouncedSearch.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      monthEntries.filter((entry) => {
        if (!entry.date) return false;
        if (selectedFarmNames && !selectedFarmNames.has(entry.farm)) return false;
        if (!entryMatchesGrassFilter(entry, grassSelectValues, grassLabelByProductId)) {
          return false;
        }
        if (
          statusSelectValues.length > 0 &&
          !statusSelectValues.includes(entry.status as HarvestScheduleStatus)
        ) {
          return false;
        }
        if (
          projectSelectValues.length > 0 &&
          !projectSelectValues.includes(entry.projectId)
        ) {
          return false;
        }
        if (!entryMatchesSearch(entry, searchQ)) return false;
        return true;
      }),
    [
      monthEntries,
      selectedFarmNames,
      grassSelectValues,
      grassLabelByProductId,
      statusSelectValues,
      projectSelectValues,
      searchQ,
    ],
  );

  const calendarEntries = useMemo(
    () => toCalendarEntries(filtered),
    [filtered, toCalendarEntries],
  );

  return (
    <div
      className={cn(
        fillViewport
          ? "sts-hsc-harvest-list-calendar-panel flex min-h-0 min-w-0 flex-none flex-col overflow-visible"
          : "overflow-hidden rounded-xl",
        className,
      )}
    >
      <HarvestScheduleCalendar
        className={cn(
          fillViewport
            ? "sts-hsc-board--harvest-list min-h-0 flex-none"
            : "sts-hsc-board--embedded min-h-[32rem] lg:min-h-[40rem]",
        )}
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
        detailHref={detailHref}
        isLoading={isLoading}
        navigationDisabled={navigationDisabled}
        statusMessage={statusMessage}
        statusIsError={statusIsError}
      />
    </div>
  );
}
