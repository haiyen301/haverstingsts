"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  scheduleDefaultMonthYear,
  scheduleMonthCacheKey,
  scheduleMonthRangeYmd,
} from "@/features/harvest/scheduleMonthYear";
import {
  harvestScheduleMonthEntryToCalendar,
  normalizeHarvestScheduleMonthEntry,
  type HarvestScheduleMonthEntry,
} from "@/features/harvest/harvestScheduleMonthNormalize";
import type { HarvestScheduleCalendarEntry } from "@/features/harvest/harvestScheduleTypes";
import { stsProxyGetHarvestingIndex } from "@/shared/api/stsProxyClient";

const CALENDAR_FETCH_PER_PAGE = 200;

type UseHarvestScheduleMonthDataOptions = {
  enabled?: boolean;
};

export function useHarvestScheduleMonthData({
  enabled = true,
}: UseHarvestScheduleMonthDataOptions = {}) {
  const t = useTranslations("HarvestSchedule");
  const loadErrorMessage = t("loadError");

  const [filterMonth, setFilterMonth] = useState(() => scheduleDefaultMonthYear().month);
  const [filterYear, setFilterYear] = useState(() => scheduleDefaultMonthYear().year);
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [scheduleRows, setScheduleRows] = useState<HarvestScheduleMonthEntry[]>([]);
  const [rowsForCacheKey, setRowsForCacheKey] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scheduleCacheRef = useRef<Map<string, HarvestScheduleMonthEntry[]>>(new Map());
  const hasLoadedOnceRef = useRef(false);

  const scheduleDateRange = useMemo(
    () => scheduleMonthRangeYmd(filterYear, filterMonth),
    [filterYear, filterMonth],
  );

  const activeMonthCacheKey = scheduleMonthCacheKey(
    scheduleDateRange.start,
    scheduleDateRange.end,
  );
  const monthDataReady = rowsForCacheKey === activeMonthCacheKey;

  const viewMonth = useMemo(
    () => new Date(filterYear, filterMonth, 1),
    [filterYear, filterMonth],
  );

  const handleFilterMonthYearChange = useCallback((month: number, year: number) => {
    setFilterMonth(month);
    setFilterYear(year);
    setSelectedDayYmd(null);
  }, []);

  const handleViewMonthChange = useCallback((month: Date) => {
    setFilterMonth(month.getMonth());
    setFilterYear(month.getFullYear());
    setSelectedDayYmd(null);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cacheKey = scheduleMonthCacheKey(scheduleDateRange.start, scheduleDateRange.end);
    const cached = scheduleCacheRef.current.get(cacheKey);
    if (cached) {
      setScheduleRows(cached);
      setRowsForCacheKey(cacheKey);
      setError(null);
      setInitialLoading(false);
      setFetching(false);
      return;
    }

    let alive = true;
    const isFirstLoad = !hasLoadedOnceRef.current;

    void (async () => {
      if (isFirstLoad) {
        setInitialLoading(true);
      } else {
        setFetching(true);
      }
      setError(null);

      try {
        const rows: HarvestScheduleMonthEntry[] = [];
        let page = 1;
        let totalPages = 1;

        do {
          const res = await stsProxyGetHarvestingIndex({
            page,
            per_page: CALENDAR_FETCH_PER_PAGE,
            actual_harvest_date_from: scheduleDateRange.start,
            actual_harvest_date_to: scheduleDateRange.end,
          });

          rows.push(
            ...res.rows
              .map(normalizeHarvestScheduleMonthEntry)
              .filter((entry): entry is HarvestScheduleMonthEntry => entry !== null),
          );

          totalPages = Math.max(1, res.totalPages);
          page += 1;
        } while (page <= totalPages);

        if (!alive) return;

        const sorted = rows.sort(
          (a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project),
        );
        scheduleCacheRef.current.set(cacheKey, sorted);
        hasLoadedOnceRef.current = true;
        setScheduleRows(sorted);
        setRowsForCacheKey(cacheKey);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : loadErrorMessage);
        if (isFirstLoad) {
          setScheduleRows([]);
          setRowsForCacheKey(null);
        }
      } finally {
        if (alive) {
          setInitialLoading(false);
          setFetching(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [enabled, scheduleDateRange.start, scheduleDateRange.end, loadErrorMessage]);

  const monthEntries = useMemo(
    () => (monthDataReady ? scheduleRows : []),
    [monthDataReady, scheduleRows],
  );

  const toCalendarEntries = useCallback(
    (rows: HarvestScheduleMonthEntry[]): HarvestScheduleCalendarEntry[] =>
      rows.map(harvestScheduleMonthEntryToCalendar),
    [],
  );

  return {
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
    initialLoading: enabled ? initialLoading : false,
    fetching: enabled ? fetching : false,
    monthDataReady: enabled ? monthDataReady : false,
    navigationDisabled: enabled && (initialLoading || fetching),
    error: enabled ? error : null,
    statusMessage: enabled && initialLoading ? t("loading") : enabled && error ? error : null,
    statusIsError: Boolean(enabled && error && !initialLoading),
    isLoading: enabled && (initialLoading || (fetching && !monthDataReady)),
  };
}
