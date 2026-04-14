"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Ban,
  Bell,
  CalendarDays,
  ChevronDown,
  Filter,
  Flag,
  HelpCircle,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";

import {
  type ApiTimelineTaskRow,
  fetchTimelineTaskDetail,
  fetchTimelineTasks,
  formatPhpDatetime,
  saveTimelineTask,
} from "@/features/timeline/api/timelineApi";
import { useAppTranslations } from "@/shared/i18n/useAppTranslations";
import { useHarvestingDataStore } from "@/shared/store/harvestingDataStore";
import { TimelineTaskDateTimePanel } from "@/widgets/timeline/TimelineTaskDateTimePanel";

export type TimeFrameId = "tf7" | "tf14" | "tfDays" | "tfWeeks" | "tfMonths";

type ColumnUnit = "day" | "week" | "month";

type TimelineColumn = {
  key: string;
  start: Date;
  end: Date;
  unit: ColumnUnit;
  dayOfMonth?: number;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function startOfWeekMon(d: Date): Date {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthYearLabel(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function shortMonth(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "short" });
}

function formatDayNum(d: Date): string {
  return String(d.getDate());
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function parseYmd(s: string): Date {
  const dayPart = s.length >= 10 ? s.slice(0, 10) : s.trim();
  const [y, m, d] = dayPart.split("-").map(Number);
  return startOfDay(new Date(y, m - 1, d));
}

function parseDbDateTime(s: string | null | undefined): Date | null {
  if (!s?.trim()) return null;
  const normalized = s.trim().replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short time range shown inside a task bar (locale-aware). */
function formatBarTimeRange(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  locale: string,
  allDayLabel: string,
): string {
  const s = parseDbDateTime(startAt);
  const e = parseDbDateTime(endAt);
  const tOpt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (!s && !e) return "";
  if (s && e) {
    const sameDay =
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();
    const startMidnight =
      s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0;
    const endLate =
      e.getHours() === 23 && e.getMinutes() === 59 && e.getSeconds() >= 59;
    if (sameDay && startMidnight && endLate) return allDayLabel;
    return `${s.toLocaleTimeString(locale, tOpt)} – ${e.toLocaleTimeString(locale, tOpt)}`;
  }
  if (s) return s.toLocaleTimeString(locale, tOpt);
  if (e) return e.toLocaleTimeString(locale, tOpt);
  return "";
}

type DemoTask = {
  id: string;
  title: string;
  status: string;
  start: string | null;
  end: string | null;
};

type DraftChecklistLine = {
  id: string;
  text: string;
  done: boolean;
};

function newDraftChecklistLine(): DraftChecklistLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    text: "",
    done: false,
  };
}

type DemoBar = {
  id: string;
  label: string;
  start: string;
  end: string;
  className: string;
  /** Time span label inside the bar (e.g. 09:00 – 17:00). */
  timeLabel: string;
  /** Resolved assignee display name when `assignee_user_id` is set. */
  assigneeLabel?: string;
};

const BAR_PALETTES = [
  "bg-violet-400/90",
  "bg-emerald-500/85",
  "bg-sky-500/85",
  "bg-amber-500/85",
  "bg-rose-400/90",
  "bg-indigo-500/85",
] as const;

function statusBarClass(status: string): string {
  let h = 0;
  for (let i = 0; i < status.length; i++) {
    h = (h + status.charCodeAt(i) * 17) % BAR_PALETTES.length;
  }
  return BAR_PALETTES[h] ?? BAR_PALETTES[0];
}

function sidebarPriorityDotClass(p: string | null | undefined): string {
  const x = (p ?? "").trim().toLowerCase();
  if (x === "urgent") return "border-red-500 bg-red-50";
  if (x === "high") return "border-amber-500 bg-amber-50";
  if (x === "normal") return "border-blue-500 bg-blue-50";
  if (x === "low") return "border-slate-300 bg-slate-100";
  return "border-gray-300 bg-white";
}

function barClassFromRow(row: ApiTimelineTaskRow): string {
  const pr = (row.priority ?? "").trim().toLowerCase();
  if (pr === "urgent") return "bg-red-500/90";
  if (pr === "high") return "bg-amber-500/85";
  if (pr === "normal") return "bg-blue-500/85";
  if (pr === "low") return "bg-slate-400/90";
  return statusBarClass(row.status || "todo");
}

function apiRowToDemoTask(row: ApiTimelineTaskRow): DemoTask {
  const startRaw = row.start_at?.trim();
  const endRaw = row.end_at?.trim();
  return {
    id: String(row.id),
    title: row.title,
    status: row.status || "todo",
    start: startRaw ? startRaw.slice(0, 10) : null,
    end: endRaw ? endRaw.slice(0, 10) : startRaw ? startRaw.slice(0, 10) : null,
  };
}

function apiRowToDemoBar(
  row: ApiTimelineTaskRow,
  locale: string,
  allDayLabel: string,
  assigneeDisplay: string,
): DemoBar {
  const startRaw = row.start_at?.trim();
  const endRaw = row.end_at?.trim();
  const start = startRaw ? startRaw.slice(0, 10) : "";
  const end = endRaw ? endRaw.slice(0, 10) : start || "";
  return {
    id: String(row.id),
    label: row.title,
    start,
    end,
    className: barClassFromRow(row),
    timeLabel: formatBarTimeRange(row.start_at, row.end_at, locale, allDayLabel),
    assigneeLabel: assigneeDisplay || undefined,
  };
}

function buildStaffNameById(staffs: unknown[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const raw of staffs) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const id = Number(s.id);
    if (!Number.isFinite(id)) continue;
    const name = String(s.first_name ?? s.full_name ?? s.name ?? "").trim();
    if (name) m.set(id, name);
  }
  return m;
}

export type TimelineWorkspaceProps = {
  immersiveMode?: boolean;
  onImmersiveModeChange?: (next: boolean) => void;
};

const ZOOM_MIN = 0.65;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.12;

/** Day label stride 1 (zoomed in) … 8 (zoomed out), like reference UIs. */
function labelStrideFromZoom(zoom: number): number {
  const t = (zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  return Math.max(1, Math.min(8, Math.round(8 - t * 7)));
}

/** More days in range when zoomed out so more months fit horizontally. */
function tfDaysCountFromStride(stride: number): number {
  return Math.min(120, 28 + stride * 12);
}

const EXTEND_DAY_CHUNK = 42;
const MAX_DAY_SPAN = 800;
const SCROLL_LOAD_THRESHOLD_PX = 240;

/** Extra blank timeline rows so every horizontal lane is clickable like the reference UI. */
const EXTRA_CLICKABLE_LANES = 8;

function withDefaultTaskTimes(startDay: Date, endDay: Date): { start: Date; end: Date } {
  const s = startOfDay(startDay);
  const e = startOfDay(endDay);
  s.setHours(9, 0, 0, 0);
  e.setHours(17, 0, 0, 0);
  return { start: s, end: e };
}

export function TimelineWorkspace({
  immersiveMode = false,
  onImmersiveModeChange,
}: TimelineWorkspaceProps = {}) {
  const t = useAppTranslations();
  const tt = (k: string) => t(`Timeline.${k}`);
  const locale =
    typeof navigator !== "undefined" ? navigator.language : "en-US";

  const [timeFrame, setTimeFrame] = useState<TimeFrameId>("tfDays");
  const [timeFrameOpen, setTimeFrameOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rangeStart, setRangeStart] = useState(() => startOfWeekMon(new Date()));

  const dayLabelStride = useMemo(() => labelStrideFromZoom(zoom), [zoom]);
  const [daySpan, setDaySpan] = useState(() => tfDaysCountFromStride(labelStrideFromZoom(1)));
  const pendingScrollAdjustPx = useRef(0);
  const extendCooldownRef = useRef(false);

  useEffect(() => {
    const min = tfDaysCountFromStride(dayLabelStride);
    setDaySpan((d) => Math.max(d, min));
  }, [dayLabelStride]);

  const [apiScheduled, setApiScheduled] = useState<ApiTimelineTaskRow[]>([]);
  const [apiUnscheduled, setApiUnscheduled] = useState<ApiTimelineTaskRow[]>([]);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
  const [taskDetailRow, setTaskDetailRow] = useState<ApiTimelineTaskRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDetailRange, setEditDetailRange] = useState<{ start: Date; end: Date } | null>(
    null,
  );
  const [editAssigneeUserId, setEditAssigneeUserId] = useState<number | null>(null);
  const [editPriority, setEditPriority] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("todo");
  const [detailDatePickerOpen, setDetailDatePickerOpen] = useState(false);
  const [detailAssigneeMenuOpen, setDetailAssigneeMenuOpen] = useState(false);
  const [detailPriorityMenuOpen, setDetailPriorityMenuOpen] = useState(false);
  const detailAssigneeRef = useRef<HTMLDivElement>(null);
  const detailPriorityRef = useRef<HTMLDivElement>(null);
  const [detailSavePending, setDetailSavePending] = useState(false);
  const [detailSaveError, setDetailSaveError] = useState<string | null>(null);

  const [draftAssigneeUserId, setDraftAssigneeUserId] = useState<number | null>(null);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const assigneeMenuRef = useRef<HTMLDivElement>(null);

  /** Stored as lowercase slug for API (`timeline_tasks.priority`). */
  const [draftPriority, setDraftPriority] = useState<string | null>(null);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const priorityMenuRef = useRef<HTMLDivElement>(null);

  const staffs = useHarvestingDataStore((s) => s.staffs);
  const fetchReferenceData = useHarvestingDataStore((s) => s.fetchAllHarvestingReferenceData);

  useEffect(() => {
    if (staffs.length > 0) return;
    void fetchReferenceData();
  }, [staffs.length, fetchReferenceData]);

  const staffNameById = useMemo(() => buildStaffNameById(staffs), [staffs]);

  const staffOptions = useMemo(
    () =>
      staffs
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({
          id: Number(s.id),
          name: String(s.first_name ?? s.full_name ?? s.name ?? "").trim(),
        }))
        .filter((x) => Number.isFinite(x.id) && x.name),
    [staffs],
  );

  const draftAssigneeLabel = useMemo(() => {
    if (draftAssigneeUserId == null) return "";
    return staffNameById.get(draftAssigneeUserId) ?? `#${draftAssigneeUserId}`;
  }, [draftAssigneeUserId, staffNameById]);

  /** Which grid cell is hovered: row index matches timeline lane index (0 = first task row). */
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    start: number;
    curr: number;
    row: number;
  } | null>(null);
  const dragActiveRef = useRef(false);
  const dragRef = useRef<{ start: number; curr: number; row: number } | null>(null);
  const activeGridElRef = useRef<HTMLElement | null>(null);

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"find" | "create">("create");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftChecklist, setDraftChecklist] = useState<DraftChecklistLine[]>([
    newDraftChecklistLine(),
  ]);
  const [draftRange, setDraftRange] = useState<{ start: Date; end: Date } | null>(
    null,
  );
  const [dateTimePickerOpen, setDateTimePickerOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const columns = useMemo((): TimelineColumn[] => {
    const start = startOfDay(rangeStart);
    const out: TimelineColumn[] = [];

    if (timeFrame === "tf7") {
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        out.push({
          key: d.toISOString(),
          start: d,
          end: d,
          unit: "day",
          dayOfMonth: d.getDate(),
        });
      }
      return out;
    }

    if (timeFrame === "tf14") {
      for (let i = 0; i < 14; i++) {
        const d = addDays(start, i);
        out.push({
          key: d.toISOString(),
          start: d,
          end: d,
          unit: "day",
          dayOfMonth: d.getDate(),
        });
      }
      return out;
    }

    if (timeFrame === "tfDays") {
      const count = daySpan;
      for (let i = 0; i < count; i++) {
        const d = addDays(start, i);
        out.push({
          key: d.toISOString(),
          start: d,
          end: d,
          unit: "day",
          dayOfMonth: d.getDate(),
        });
      }
      return out;
    }

    if (timeFrame === "tfWeeks") {
      let w = startOfWeekMon(start);
      for (let i = 0; i < 12; i++) {
        const wEnd = addDays(w, 6);
        out.push({
          key: w.toISOString(),
          start: w,
          end: wEnd,
          unit: "week",
        });
        w = addDays(w, 7);
      }
      return out;
    }

    let m = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let i = 0; i < 8; i++) {
      const next = addMonths(m, 1);
      const last = addDays(next, -1);
      out.push({
        key: m.toISOString(),
        start: m,
        end: last,
        unit: "month",
      });
      m = next;
    }
    return out;
  }, [rangeStart, timeFrame, daySpan]);

  /** Visible grid range → `from` / `to` for `GET /api/timeline`. */
  const queryRange = useMemo(() => {
    if (columns.length === 0) return null;
    const first = columns[0].start;
    const lastCol = columns[columns.length - 1];
    const from = startOfDay(new Date(first.getTime()));
    const toBase =
      lastCol.unit === "day"
        ? startOfDay(new Date(lastCol.start.getTime()))
        : startOfDay(new Date(lastCol.end.getTime()));
    const to = new Date(toBase.getTime());
    to.setHours(23, 59, 59, 0);
    return { from, to };
  }, [columns]);

  const sortedScheduledRows = useMemo(() => {
    return [...apiScheduled].sort((a, b) => {
      const as = a.start_at ?? "";
      const bs = b.start_at ?? "";
      return as.localeCompare(bs) || (a.id ?? 0) - (b.id ?? 0);
    });
  }, [apiScheduled]);

  const interactionLanes = useMemo(() => {
    const allDayLabel = t("Timeline.allDay");
    return [
      ...sortedScheduledRows.map((row) => {
        const aid = row.assignee_user_id;
        const assigneeDisplay =
          aid != null && Number.isFinite(Number(aid))
            ? (staffNameById.get(Number(aid)) ?? "")
            : "";
        return {
          key: `task-${row.id}`,
          label: row.title,
          bar: apiRowToDemoBar(row, locale, allDayLabel, assigneeDisplay),
        };
      }),
      ...Array.from({ length: EXTRA_CLICKABLE_LANES }, (_, k) => ({
        key: `empty-lane-${k}`,
        label: "",
        bar: null as null | DemoBar,
      })),
    ];
  }, [sortedScheduledRows, locale, t, staffNameById]);

  useEffect(() => {
    if (!queryRange) return;
    let cancelled = false;
    setApiLoading(true);
    setApiError(null);
    (async () => {
      try {
        const { scheduled, unscheduled } = await fetchTimelineTasks({
          from: queryRange.from,
          to: queryRange.to,
          includeUnscheduled: true,
        });
        if (cancelled) return;
        setApiScheduled(scheduled);
        setApiUnscheduled(unscheduled);
      } catch (e) {
        if (!cancelled) {
          setApiError(e instanceof Error ? e.message : String(e));
          setApiScheduled([]);
          setApiUnscheduled([]);
        }
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryRange?.from.getTime(), queryRange?.to.getTime()]);

  const monthSpans = useMemo(() => {
    if (columns.length === 0 || columns[0].unit !== "day") return [];
    const spans: { label: string; count: number }[] = [];
    let cur = monthYearLabel(columns[0].start, locale);
    let count = 1;
    for (let i = 1; i < columns.length; i++) {
      const lab = monthYearLabel(columns[i].start, locale);
      if (lab === cur) count++;
      else {
        spans.push({ label: cur, count });
        cur = lab;
        count = 1;
      }
    }
    spans.push({ label: cur, count });
    return spans;
  }, [columns, locale]);

  const baseCell = 36;
  const cellW = Math.round(baseCell * zoom);
  const gridWidth = columns.length * cellW;

  const today = useMemo(() => startOfDay(new Date()), []);
  const todayOffsetPx = useMemo(() => {
    const idx = columns.findIndex((c) => isSameDay(c.start, today));
    if (idx < 0) return null;
    return idx * cellW + cellW / 2;
  }, [columns, today, cellW]);

  const goToday = useCallback(() => {
    const anchor = startOfWeekMon(new Date());
    setRangeStart(anchor);
    setTimeFrame("tfDays");
    const stride = labelStrideFromZoom(zoom);
    setDaySpan(tfDaysCountFromStride(stride));
    window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.round(
        (startOfDay(new Date()).getTime() - startOfDay(anchor).getTime()) /
          86400000,
      );
      const w = Math.round(36 * zoom);
      if (idx >= 0) {
        const target = Math.max(0, idx * w - el.clientWidth / 2);
        el.scrollLeft = target;
      }
    }, 50);
  }, [zoom]);

  useLayoutEffect(() => {
    const add = pendingScrollAdjustPx.current;
    if (add === 0) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft += add;
    pendingScrollAdjustPx.current = 0;
  }, [rangeStart, daySpan, timeFrame]);

  const handleTimelineScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || timeFrame !== "tfDays" || extendCooldownRef.current) return;
    const w = Math.round(36 * zoom);
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;

    if (el.scrollLeft < SCROLL_LOAD_THRESHOLD_PX && daySpan < MAX_DAY_SPAN) {
      extendCooldownRef.current = true;
      pendingScrollAdjustPx.current += EXTEND_DAY_CHUNK * w;
      setRangeStart((prev) => addDays(prev, -EXTEND_DAY_CHUNK));
      setDaySpan((d) => Math.min(d + EXTEND_DAY_CHUNK, MAX_DAY_SPAN));
      window.setTimeout(() => {
        extendCooldownRef.current = false;
      }, 150);
      return;
    }

    if (
      el.scrollLeft > maxScroll - SCROLL_LOAD_THRESHOLD_PX &&
      daySpan < MAX_DAY_SPAN
    ) {
      extendCooldownRef.current = true;
      setDaySpan((d) => Math.min(d + EXTEND_DAY_CHUNK, MAX_DAY_SPAN));
      window.setTimeout(() => {
        extendCooldownRef.current = false;
      }, 150);
    }
  }, [zoom, timeFrame, daySpan]);

  /** All tasks loaded for this view (scheduled in range + unscheduled), deduped by id. */
  const allSidebarTasks = useMemo(() => {
    const byId = new Map<number, ApiTimelineTaskRow>();
    for (const r of apiUnscheduled) {
      const id = Number(r.id);
      if (Number.isFinite(id)) byId.set(id, r);
    }
    for (const r of apiScheduled) {
      const id = Number(r.id);
      if (Number.isFinite(id)) byId.set(id, r);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const ta = (a.start_at ?? "").trim();
      const tb = (b.start_at ?? "").trim();
      if (!ta && tb) return 1;
      if (ta && !tb) return -1;
      if (ta && tb && ta !== tb) return ta.localeCompare(tb);
      return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
  }, [apiScheduled, apiUnscheduled]);

  const editAssigneeLabel = useMemo(() => {
    if (editAssigneeUserId == null) return "";
    return staffNameById.get(editAssigneeUserId) ?? `#${editAssigneeUserId}`;
  }, [editAssigneeUserId, staffNameById]);

  const timeFrameLabel = tt(timeFrame);

  const barLayout = useCallback(
    (startStr: string, endStr: string) => {
      const s = parseYmd(startStr);
      const e = parseYmd(endStr);
      if (columns[0]?.unit !== "day") {
        const i0 = columns.findIndex((c) => s <= c.end && e >= c.start);
        if (i0 < 0) return null;
        let i1 = i0;
        for (let j = i0; j < columns.length; j++) {
          if (e >= columns[j].start && s <= columns[j].end) i1 = j;
        }
        const left = i0 * cellW + 4;
        const width = (i1 - i0 + 1) * cellW - 8;
        return { left, width };
      }
      let i0 = columns.findIndex((c) => isSameDay(c.start, s));
      let i1 = columns.findIndex((c) => isSameDay(c.start, e));
      if (i0 < 0) {
        i0 = columns.findIndex((c) => c.start > s);
        if (i0 < 0) return null;
      }
      if (i1 < 0) {
        for (let i = columns.length - 1; i >= 0; i--) {
          if (columns[i].start <= e) {
            i1 = i;
            break;
          }
        }
        if (i1 < 0) return null;
      }
      if (i1 < i0) i1 = i0;
      const left = i0 * cellW + 4;
      const width = (i1 - i0 + 1) * cellW - 8;
      return { left, width };
    },
    [cellW, columns],
  );

  const indexFromGridClientX = useCallback(
    (clientX: number, gridEl: HTMLElement | null) => {
      if (!gridEl || columns.length === 0) return null;
      const r = gridEl.getBoundingClientRect();
      const x = clientX - r.left;
      if (x < 0 || x > r.width) return null;
      return Math.max(0, Math.min(columns.length - 1, Math.floor(x / cellW)));
    },
    [cellW, columns.length],
  );

  const openTaskModal = useCallback((i0: number, i1: number) => {
    const a = Math.min(i0, i1);
    const b = Math.max(i0, i1);
    const startDay = columns[a]?.start;
    const endDay = columns[b]?.start;
    if (!startDay || !endDay) return;
    setDraftRange(withDefaultTaskTimes(startDay, endDay));
    setDraftTitle("");
    setDraftDescription("");
    setDraftChecklist([newDraftChecklistLine()]);
    setDraftAssigneeUserId(null);
    setAssigneeMenuOpen(false);
    setDraftPriority(null);
    setPriorityMenuOpen(false);
    setModalTab("create");
    setDateTimePickerOpen(false);
    setTaskModalOpen(true);
  }, [columns]);

  const openTaskDetail = useCallback(async (id: number) => {
    if (!Number.isFinite(id) || id < 1) return;
    setDetailDatePickerOpen(false);
    setDetailAssigneeMenuOpen(false);
    setDetailPriorityMenuOpen(false);
    setTaskDetailOpen(true);
    setTaskDetailLoading(true);
    setTaskDetailError(null);
    setTaskDetailRow(null);
    try {
      const row = await fetchTimelineTaskDetail(id);
      setTaskDetailRow(row);
    } catch (e) {
      setTaskDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!taskDetailRow?.id) return;
    setEditTitle(String(taskDetailRow.title ?? ""));
    setEditDescription(String(taskDetailRow.description ?? ""));
    const s = parseDbDateTime(taskDetailRow.start_at ?? null);
    const e = parseDbDateTime(taskDetailRow.end_at ?? null);
    if (s && e) setEditDetailRange({ start: s, end: e });
    else setEditDetailRange(null);
    const aid = taskDetailRow.assignee_user_id;
    setEditAssigneeUserId(
      aid != null && Number.isFinite(Number(aid)) ? Number(aid) : null,
    );
    const pr = (taskDetailRow.priority ?? "").trim().toLowerCase();
    setEditPriority(["urgent", "high", "normal", "low"].includes(pr) ? pr : null);
    setEditStatus(String(taskDetailRow.status ?? "todo"));
    setDetailSaveError(null);
  }, [taskDetailRow]);

  useEffect(() => {
    if (
      !assigneeMenuOpen &&
      !priorityMenuOpen &&
      !detailAssigneeMenuOpen &&
      !detailPriorityMenuOpen
    )
      return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (assigneeMenuOpen && !assigneeMenuRef.current?.contains(n)) {
        setAssigneeMenuOpen(false);
      }
      if (priorityMenuOpen && !priorityMenuRef.current?.contains(n)) {
        setPriorityMenuOpen(false);
      }
      if (detailAssigneeMenuOpen && !detailAssigneeRef.current?.contains(n)) {
        setDetailAssigneeMenuOpen(false);
      }
      if (detailPriorityMenuOpen && !detailPriorityRef.current?.contains(n)) {
        setDetailPriorityMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [
    assigneeMenuOpen,
    priorityMenuOpen,
    detailAssigneeMenuOpen,
    detailPriorityMenuOpen,
  ]);

  useEffect(() => {
    if (!taskDetailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailDatePickerOpen) {
        setDetailDatePickerOpen(false);
      } else if (detailAssigneeMenuOpen) {
        setDetailAssigneeMenuOpen(false);
      } else if (detailPriorityMenuOpen) {
        setDetailPriorityMenuOpen(false);
      } else {
        setTaskDetailOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    taskDetailOpen,
    detailDatePickerOpen,
    detailAssigneeMenuOpen,
    detailPriorityMenuOpen,
  ]);

  const onGridMouseDown = useCallback(
    (rowIndex: number) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (columns[0]?.unit !== "day") return;
      if (e.button !== 0) return;
      e.preventDefault();
      const gridEl = e.currentTarget;
      const idx = indexFromGridClientX(e.clientX, gridEl);
      if (idx == null) return;
      activeGridElRef.current = gridEl;
      dragActiveRef.current = true;
      dragRef.current = { start: idx, curr: idx, row: rowIndex };
      setDragPreview({ start: idx, curr: idx, row: rowIndex });
    },
    [columns, indexFromGridClientX],
  );

  const onGridMouseMoveHover = useCallback(
    (rowIndex: number) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (columns[0]?.unit !== "day") return;
      if (dragActiveRef.current) return;
      const idx = indexFromGridClientX(e.clientX, e.currentTarget);
      if (idx == null) {
        setHoverCell(null);
        return;
      }
      setHoverCell({ row: rowIndex, col: idx });
    },
    [columns, indexFromGridClientX],
  );

  const onGridMouseLeave = useCallback(() => {
    if (!dragActiveRef.current) setHoverCell(null);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragActiveRef.current || !dragRef.current) return;
      const idx = indexFromGridClientX(e.clientX, activeGridElRef.current);
      if (idx == null) return;
      const row = dragRef.current.row;
      dragRef.current = { start: dragRef.current.start, curr: idx, row };
      setDragPreview({ start: dragRef.current.start, curr: idx, row });
    };

    const onUp = (e: MouseEvent) => {
      if (!dragActiveRef.current) return;
      const d = dragRef.current;
      const gridEl = activeGridElRef.current;
      dragActiveRef.current = false;
      dragRef.current = null;
      activeGridElRef.current = null;
      setDragPreview(null);
      if (!d || columns[0]?.unit !== "day") return;
      const idx = indexFromGridClientX(e.clientX, gridEl);
      const endIdx = idx ?? d.curr;
      openTaskModal(d.start, endIdx);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [columns, indexFromGridClientX, openTaskModal]);

  useEffect(() => {
    if (!taskModalOpen) {
      setAssigneeMenuOpen(false);
      setPriorityMenuOpen(false);
    }
  }, [taskModalOpen]);

  useEffect(() => {
    if (!taskModalOpen) return;
    setCreateError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dateTimePickerOpen) {
        setDateTimePickerOpen(false);
      } else if (assigneeMenuOpen) {
        setAssigneeMenuOpen(false);
      } else if (priorityMenuOpen) {
        setPriorityMenuOpen(false);
      } else {
        setTaskModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskModalOpen, dateTimePickerOpen, assigneeMenuOpen, priorityMenuOpen]);

  const laneSelectionPreview = useCallback(
    (rowIndex: number) => {
      if (!dragPreview || dragPreview.row !== rowIndex || columns[0]?.unit !== "day") {
        return null;
      }
      const a = Math.min(dragPreview.start, dragPreview.curr);
      const b = Math.max(dragPreview.start, dragPreview.curr);
      return { left: a * cellW, width: (b - a + 1) * cellW };
    },
    [dragPreview, cellW, columns],
  );

  const laneHoverPreview = useCallback(
    (rowIndex: number) => {
      if (
        !hoverCell ||
        hoverCell.row !== rowIndex ||
        dragPreview != null ||
        columns[0]?.unit !== "day"
      ) {
        return null;
      }
      return { left: hoverCell.col * cellW, width: cellW };
    },
    [hoverCell, dragPreview, columns],
  );

  const formatRangeChip = useCallback(
    (start: Date, end: Date) => {
      const dOpt: Intl.DateTimeFormatOptions = {
        year: "2-digit",
        month: "numeric",
        day: "numeric",
      };
      const tOpt: Intl.DateTimeFormatOptions = {
        hour: "numeric",
        minute: "2-digit",
      };
      return `${start.toLocaleDateString(locale, dOpt)} ${start.toLocaleTimeString(locale, tOpt)} – ${end.toLocaleDateString(locale, dOpt)} ${end.toLocaleTimeString(locale, tOpt)}`;
    },
    [locale],
  );

  const submitCreateTask = useCallback(async () => {
    if (!draftRange) return;
    const title = draftTitle.trim() || tt("taskTitlePlaceholder");
    const checklistBlock = draftChecklist
      .filter((l) => l.text.trim())
      .map((l) => `${l.done ? "[x]" : "[ ]"} ${l.text.trim()}`)
      .join("\n");
    const desc = draftDescription.trim();
    let description: string | null = null;
    if (desc && checklistBlock) description = `${desc}\n\n${checklistBlock}`;
    else if (desc) description = desc;
    else if (checklistBlock) description = checklistBlock;
    setCreateError(null);
    setCreatePending(true);
    try {
      await saveTimelineTask({
        title,
        description,
        start_at: formatPhpDatetime(draftRange.start),
        end_at: formatPhpDatetime(draftRange.end),
        status: "todo",
        priority: draftPriority?.trim() || null,
        assignee_user_id:
          draftAssigneeUserId != null && Number.isFinite(draftAssigneeUserId)
            ? draftAssigneeUserId
            : null,
      });
      if (queryRange) {
        const { scheduled, unscheduled } = await fetchTimelineTasks({
          from: queryRange.from,
          to: queryRange.to,
          includeUnscheduled: true,
        });
        setApiScheduled(scheduled);
        setApiUnscheduled(unscheduled);
      }
      setTaskModalOpen(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatePending(false);
    }
  }, [
    draftRange,
    draftTitle,
    draftDescription,
    draftChecklist,
    draftAssigneeUserId,
    draftPriority,
    queryRange,
    tt,
  ]);

  const submitDetailSave = useCallback(async () => {
    if (!taskDetailRow?.id) return;
    const id = Number(taskDetailRow.id);
    if (!Number.isFinite(id) || id < 1) return;
    setDetailSavePending(true);
    setDetailSaveError(null);
    try {
      await saveTimelineTask({
        id,
        title: editTitle.trim() || tt("taskTitlePlaceholder"),
        description: editDescription.trim() || null,
        start_at: editDetailRange ? formatPhpDatetime(editDetailRange.start) : null,
        end_at: editDetailRange ? formatPhpDatetime(editDetailRange.end) : null,
        status: editStatus.trim() || "todo",
        priority: editPriority?.trim() || null,
        assignee_user_id:
          editAssigneeUserId != null && Number.isFinite(editAssigneeUserId)
            ? editAssigneeUserId
            : null,
      });
      const refreshed = await fetchTimelineTaskDetail(id);
      setTaskDetailRow(refreshed);
      if (queryRange) {
        const { scheduled, unscheduled } = await fetchTimelineTasks({
          from: queryRange.from,
          to: queryRange.to,
          includeUnscheduled: true,
        });
        setApiScheduled(scheduled);
        setApiUnscheduled(unscheduled);
      }
      setDetailDatePickerOpen(false);
      setDetailAssigneeMenuOpen(false);
      setDetailPriorityMenuOpen(false);
    } catch (e) {
      setDetailSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailSavePending(false);
    }
  }, [
    taskDetailRow?.id,
    editTitle,
    editDescription,
    editDetailRange,
    editStatus,
    editPriority,
    editAssigneeUserId,
    queryRange,
    tt,
  ]);

  const dayHeaderStride =
    columns[0]?.unit === "day"
      ? timeFrame === "tf7"
        ? 1
        : dayLabelStride
      : 1;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] min-h-[560px] bg-white border-b border-gray-200">
      <header className="shrink-0 border-b border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3 bg-white">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 mr-2">{tt("title")}</h1>
          <button
            type="button"
            onClick={goToday}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {tt("today")}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setTimeFrameOpen((o) => !o)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50"
            >
              {timeFrameLabel}
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
            {timeFrameOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default bg-transparent"
                  onClick={() => setTimeFrameOpen(false)}
                />
                <div className="absolute left-0 top-full mt-1 z-20 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="px-3 py-1 text-xs font-medium text-gray-500">
                    {tt("timeFrame")}
                  </div>
                  {(
                    [
                      "tf7",
                      "tf14",
                      "tfDays",
                      "tfWeeks",
                      "tfMonths",
                    ] as TimeFrameId[]
                  ).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                        timeFrame === id ? "font-medium text-violet-700" : "text-gray-800"
                      }`}
                      onClick={() => {
                        setTimeFrame(id);
                        setTimeFrameOpen(false);
                      }}
                    >
                      {timeFrame === id ? "✓ " : ""}
                      {tt(id)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {onImmersiveModeChange ? (
            <button
              type="button"
              onClick={() => onImmersiveModeChange(!immersiveMode)}
              className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-700 hover:bg-gray-50 shadow-sm"
              title={immersiveMode ? tt("fullscreenExit") : tt("fullscreenEnter")}
            >
              {immersiveMode ? (
                <Minimize2 className="w-4 h-4" aria-hidden />
              ) : (
                <Maximize2 className="w-4 h-4" aria-hidden />
              )}
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            className="inline-flex items-stretch rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden divide-x divide-gray-200"
            role="group"
            aria-label={tt("zoomControls")}
          >
            <button
              type="button"
              className="px-2.5 py-2 text-gray-700 hover:bg-gray-50"
              title={tt("zoomOut")}
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="px-2.5 py-2 text-gray-700 hover:bg-gray-50"
              title={tt("zoomIn")}
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            className="hidden sm:inline-flex p-2 rounded-md text-gray-500 hover:bg-gray-100"
            title="Layers"
          >
            <Layers className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex p-2 rounded-md text-gray-500 hover:bg-gray-100"
            title="Filter"
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex p-2 rounded-md text-gray-500 hover:bg-gray-100"
            title="Search"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex p-2 rounded-md text-gray-500 hover:bg-gray-100"
            title="Help"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="hidden sm:inline-flex p-2 rounded-md text-gray-500 hover:bg-gray-100"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            className="px-4 py-2 rounded-md text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 shadow-sm"
          >
            {tt("addTask")}
          </button>
        </div>
      </header>

      {apiError || apiLoading ? (
        <p className="px-4 py-1 text-xs border-b border-gray-100">
          {apiError ? (
            <span className="text-red-600">{apiError}</span>
          ) : (
            <span className="text-gray-500">{tt("loadingTasks")}</span>
          )}
        </p>
      ) : null}

      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200">
          <div
            ref={scrollRef}
            onScroll={handleTimelineScroll}
            className="flex-1 overflow-x-auto overflow-y-hidden min-h-[320px] relative"
          >
            <div style={{ width: gridWidth + 200 }} className="min-h-full flex flex-col">
              {columns[0]?.unit === "day" ? (
                <div className="flex shrink-0 border-b border-gray-200 bg-white">
                  <div className="w-[200px] shrink-0 bg-gray-50 border-r border-gray-200" />
                  <div className="flex" style={{ width: gridWidth }}>
                    {monthSpans.map((span, i) => (
                      <div
                        key={`m${i}`}
                        className="text-center text-xs font-medium text-gray-600 py-2 border-r border-gray-100 truncate px-1 flex items-center justify-center"
                        style={{ width: span.count * cellW }}
                      >
                        {span.label}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex shrink-0 border-b border-gray-200 bg-white">
                  <div className="w-[200px] shrink-0 bg-gray-50 border-r border-gray-200" />
                  <div className="flex" style={{ width: gridWidth }}>
                    {columns.map((c) => (
                      <div
                        key={c.key}
                        className="text-center text-xs font-medium text-gray-600 py-2 border-r border-gray-100 flex items-center justify-center"
                        style={{ width: cellW }}
                      >
                        {c.unit === "week"
                          ? `${shortMonth(c.start, locale)} ${c.start.getDate()} – ${c.end.getDate()}`
                          : `${shortMonth(c.start, locale)} ${c.start.getFullYear()}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex shrink-0 border-b border-gray-200 bg-gray-50">
                <div className="w-[200px] shrink-0 border-r border-gray-200 bg-gray-50" />
                <div className="flex" style={{ width: gridWidth }}>
                  {columns.map((c, i) => {
                    const isTodayCol = c.unit === "day" && isSameDay(c.start, today);
                    const showDayNum =
                      c.unit === "day" && (isTodayCol || i % dayHeaderStride === 0);
                    return (
                      <div
                        key={`d-${c.key}`}
                        style={{ width: cellW }}
                        className={`text-center text-xs py-1.5 border-r border-gray-200 ${
                          isTodayCol ? "text-violet-700 font-semibold" : "text-gray-700"
                        }`}
                      >
                        {c.unit === "day" ? (
                          showDayNum ? (
                            <span
                              className={
                                isTodayCol
                                  ? "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 text-white font-semibold px-1"
                                  : ""
                              }
                            >
                              {formatDayNum(c.start)}
                            </span>
                          ) : (
                            <span className="text-gray-300 select-none">·</span>
                          )
                        ) : c.unit === "week" ? (
                          "W"
                        ) : (
                          "•"
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-1 flex-col min-h-[200px] max-h-[min(55vh,520px)] overflow-y-auto border-t border-gray-100">
                {interactionLanes.map((lane, laneIdx) => {
                  const rowIndex = laneIdx;
                  const hp = laneHoverPreview(rowIndex);
                  const sp = laneSelectionPreview(rowIndex);
                  const lay =
                    lane.bar != null ? barLayout(lane.bar.start, lane.bar.end) : null;
                  return (
                    <div
                      key={lane.key}
                      className="flex shrink-0 border-b border-gray-100 bg-white select-none"
                    >
                      <div
                        className="w-[200px] shrink-0 border-r border-gray-200 bg-white h-12 flex items-center px-2 text-xs text-gray-700 truncate"
                        title={lane.label || undefined}
                      >
                        {lane.label || (
                          <span className="text-gray-300 select-none" aria-hidden>
                            ·
                          </span>
                        )}
                      </div>
                      <div
                        className={`relative h-12 shrink-0 overflow-hidden ${
                          columns[0]?.unit === "day"
                            ? "cursor-crosshair"
                            : "cursor-not-allowed opacity-50"
                        }`}
                        style={{ width: gridWidth, minWidth: gridWidth }}
                        onMouseDown={onGridMouseDown(rowIndex)}
                        onMouseMove={onGridMouseMoveHover(rowIndex)}
                        onMouseLeave={onGridMouseLeave}
                      >
                        <div
                          className="absolute inset-0 grid pointer-events-none"
                          style={{
                            gridTemplateColumns: `repeat(${columns.length}, ${cellW}px)`,
                          }}
                        >
                          {columns.map((c) => (
                            <div
                              key={`bg-${rowIndex}-${c.key}`}
                              className="border-r border-gray-100 bg-white"
                              style={
                                c.unit === "day" && isWeekend(c.start)
                                  ? {
                                      backgroundImage:
                                        "repeating-linear-gradient(-45deg, #f3f4f6, #f3f4f6 4px, #e8e8e8 4px, #e8e8e8 8px)",
                                    }
                                  : undefined
                              }
                            />
                          ))}
                        </div>
                        {todayOffsetPx != null ? (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
                            style={{ left: todayOffsetPx }}
                          />
                        ) : null}
                        {hp ? (
                          <div
                            className="absolute top-1 bottom-1 rounded-md bg-gray-400/25 pointer-events-none z-2"
                            style={{ left: hp.left + 2, width: hp.width - 4 }}
                          />
                        ) : null}
                        {sp ? (
                          <div
                            className="absolute top-1 bottom-1 rounded-md bg-violet-500/35 border border-violet-400/60 pointer-events-none z-3"
                            style={{
                              left: sp.left + 2,
                              width: Math.max(sp.width - 4, cellW - 4),
                            }}
                          />
                        ) : null}
                        {lane.bar != null && lay ? (
                          <div className="absolute inset-0 flex items-center z-20 pointer-events-none">
                            <div
                              role="button"
                              tabIndex={0}
                              className={`absolute min-h-[30px] max-h-[52px] rounded-md shadow-sm ${lane.bar.className} flex flex-col justify-center gap-0.5 overflow-hidden px-1.5 py-0.5 border border-black/10 cursor-pointer pointer-events-auto hover:brightness-110 active:brightness-95`}
                              style={{
                                left: lay.left,
                                width: Math.max(lay.width, 64),
                              }}
                              title={
                                lane.bar.timeLabel
                                  ? `${lane.bar.label} — ${lane.bar.timeLabel}`
                                  : lane.bar.label
                              }
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openTaskDetail(Number(lane.bar!.id));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void openTaskDetail(Number(lane.bar!.id));
                                }
                              }}
                            >
                              <span className="text-[10px] sm:text-[11px] font-semibold text-white leading-tight truncate drop-shadow-sm">
                                {lane.bar.label}
                              </span>
                              {lane.bar.timeLabel ? (
                                <span className="text-[9px] sm:text-[10px] text-white/95 leading-tight truncate drop-shadow-sm">
                                  {lane.bar.timeLabel}
                                </span>
                              ) : null}
                              {lane.bar.assigneeLabel ? (
                                <span className="text-[8px] sm:text-[9px] text-white/90 leading-tight truncate drop-shadow-sm flex items-center gap-0.5">
                                  <User className="w-2.5 h-2.5 shrink-0 opacity-90" />
                                  {lane.bar.assigneeLabel}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {sidebarOpen ? (
          <aside className="w-[min(100%,320px)] shrink-0 flex flex-col bg-white border-l border-gray-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
              <span className="font-semibold text-gray-900">{tt("tasks")}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
                  title={t("Common.search")}
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-md"
                  title="Collapse"
                  onClick={() => setSidebarOpen(false)}
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-3 py-2 border-b border-gray-100 space-y-1">
              <p className="text-xs text-gray-500 leading-snug">{tt("allTimelineTasks")}</p>
              <p className="text-xs font-medium text-gray-700">
                {allSidebarTasks.length} {tt("tasks")}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {allSidebarTasks.length === 0 ? (
                <p className="text-sm text-gray-500 px-2 py-4">{tt("noTasks")}</p>
              ) : (
                allSidebarTasks.map((task) => {
                  const tid = Number(task.id);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="w-full flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 text-left border border-transparent hover:border-gray-100"
                      onClick={() => void openTaskDetail(tid)}
                    >
                      <span
                        className={`mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 ${sidebarPriorityDotClass(task.priority)}`}
                        aria-hidden
                      />
                      <span className="text-sm text-gray-800 leading-snug line-clamp-3">
                        {task.title}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="shrink-0 w-10 border-l border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 hover:bg-gray-100"
            title={tt("tasks")}
          >
            <PanelRightOpen className="w-5 h-5" />
          </button>
        )}
      </div>

      {taskDetailOpen ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setTaskDetailOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">{tt("taskDetails")}</h2>
              <button
                type="button"
                className="p-2 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                aria-label={tt("closeDetail")}
                onClick={() => setTaskDetailOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[min(80vh,520px)] overflow-y-auto">
              {taskDetailLoading ? (
                <p className="text-sm text-gray-500">{tt("loadingTasks")}</p>
              ) : null}
              {taskDetailError ? (
                <p className="text-sm text-red-600">{taskDetailError}</p>
              ) : null}
              {!taskDetailLoading && taskDetailRow ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 pr-2">
                    {taskDetailRow.title}
                  </h3>
                  {taskDetailRow.description?.trim() ? (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {tt("taskDescription")}
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">
                        {taskDetailRow.description}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-medium text-gray-700">
                      {taskDetailRow.status || "—"}
                    </span>
                    {taskDetailRow.priority?.trim() ? (
                      <span className="inline-flex rounded-full border border-gray-200 px-2.5 py-1 text-gray-600">
                        {taskDetailRow.priority}
                      </span>
                    ) : null}
                  </div>
                  {(() => {
                    const ds = parseDbDateTime(taskDetailRow.start_at ?? null);
                    const de = parseDbDateTime(taskDetailRow.end_at ?? null);
                    if (!ds || !de) {
                      return (
                        <p className="text-sm text-gray-600">
                          {taskDetailRow.start_at || "—"} → {taskDetailRow.end_at || "—"}
                        </p>
                      );
                    }
                    return (
                      <p className="text-sm text-gray-700">
                        <span className="font-medium text-gray-500">{tt("dateRangeLabel")}: </span>
                        {formatRangeChip(ds, de)}
                      </p>
                    );
                  })()}
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-gray-500">{tt("assignee")}: </span>
                    {(() => {
                      const aid = taskDetailRow.assignee_user_id;
                      if (aid == null || !Number.isFinite(Number(aid)))
                        return tt("assigneeNone");
                      return staffNameById.get(Number(aid)) ?? `#${aid}`;
                    })()}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {taskModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex border-b border-gray-200">
              <button
                type="button"
                className={`flex-1 py-3 text-sm font-medium ${
                  modalTab === "find"
                    ? "text-violet-700 border-b-2 border-violet-600 bg-violet-50/40"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
                onClick={() => setModalTab("find")}
              >
                {tt("findTask")}
              </button>
              <button
                type="button"
                className={`flex-1 py-3 text-sm font-medium ${
                  modalTab === "create"
                    ? "text-violet-700 border-b-2 border-violet-600 bg-violet-50/40"
                    : "text-gray-500 hover:bg-gray-50"
                }`}
                onClick={() => setModalTab("create")}
              >
                {tt("createTask")}
              </button>
              <button
                type="button"
                className="px-3 text-gray-400 hover:text-gray-700"
                aria-label={t("Common.cancel")}
                onClick={() => setTaskModalOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalTab === "find" ? (
              <div className="p-6 text-sm text-gray-600">{tt("findTaskHint")}</div>
            ) : (
              <div className="p-4 space-y-3">
                <input
                  type="text"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  placeholder={tt("taskTitlePlaceholder")}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  autoFocus
                />
                <textarea
                  className="w-full min-h-[72px] rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400 resize-y"
                  placeholder={tt("descriptionPlaceholder")}
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                />

                <div className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/50">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    {tt("checklistTitle")}
                  </p>
                  <ul className="space-y-2">
                    {draftChecklist.map((line) => (
                      <li key={line.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={line.done}
                          onChange={() => {
                            setDraftChecklist((rows) =>
                              rows.map((r) =>
                                r.id === line.id ? { ...r, done: !r.done } : r,
                              ),
                            );
                          }}
                          className="h-4 w-4 shrink-0 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                          aria-label={tt("checklistToggleDone")}
                        />
                        <input
                          type="text"
                          value={line.text}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftChecklist((rows) =>
                              rows.map((r) => (r.id === line.id ? { ...r, text: v } : r)),
                            );
                          }}
                          placeholder={tt("checklistLinePlaceholder")}
                          className={`min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400 ${
                            line.done ? "line-through text-gray-400" : "text-gray-900"
                          }`}
                        />
                        {draftChecklist.length > 1 ? (
                          <button
                            type="button"
                            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                            aria-label={tt("removeChecklistLine")}
                            onClick={() => {
                              setDraftChecklist((rows) =>
                                rows.filter((r) => r.id !== line.id),
                              );
                            }}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="w-8 shrink-0" aria-hidden />
                        )}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftChecklist((rows) => [...rows, newDraftChecklistLine()])
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {tt("addChecklistLine")}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1 items-start">
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">
                    {tt("statusTodo")}
                  </span>
                  <div className="relative" ref={assigneeMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setPriorityMenuOpen(false);
                        setAssigneeMenuOpen((o) => !o);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 max-w-[220px]"
                    >
                      <User className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                      <span className="truncate">
                        {draftAssigneeUserId != null
                          ? draftAssigneeLabel || tt("assignee")
                          : tt("assigneePick")}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    </button>
                    {assigneeMenuOpen ? (
                      <div className="absolute left-0 top-full z-[70] mt-1 w-56 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                          onClick={() => {
                            setDraftAssigneeUserId(null);
                            setAssigneeMenuOpen(false);
                          }}
                        >
                          {tt("assigneeNone")}
                        </button>
                        {staffOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                              draftAssigneeUserId === opt.id
                                ? "font-medium text-violet-700 bg-violet-50/50"
                                : "text-gray-800"
                            }`}
                            onClick={() => {
                              setDraftAssigneeUserId(opt.id);
                              setAssigneeMenuOpen(false);
                            }}
                          >
                            {opt.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {draftRange ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 pl-1 pr-0.5 py-0.5 text-xs text-violet-900">
                      <button
                        type="button"
                        className="inline-flex max-w-[min(100%,240px)] items-center gap-1 truncate rounded-full px-2 py-0.5 text-left hover:bg-violet-100/80"
                        onClick={() => setDateTimePickerOpen(true)}
                        title={tt("editDateTime")}
                      >
                        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {formatRangeChip(draftRange.start, draftRange.end)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-violet-200/60"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDraftRange(null);
                        }}
                        aria-label={tt("clearDates")}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ) : null}
                  <div className="relative" ref={priorityMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setAssigneeMenuOpen(false);
                        setPriorityMenuOpen((o) => !o);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 max-w-[200px]"
                    >
                      <Flag
                        className={`w-3.5 h-3.5 shrink-0 ${
                          draftPriority === "urgent"
                            ? "text-red-600"
                            : draftPriority === "high"
                              ? "text-amber-500"
                              : draftPriority === "normal"
                                ? "text-blue-600"
                                : draftPriority === "low"
                                  ? "text-gray-400"
                                  : "text-gray-500"
                        }`}
                        aria-hidden
                      />
                      <span className="truncate">
                        {draftPriority === "urgent"
                          ? tt("priorityUrgent")
                          : draftPriority === "high"
                            ? tt("priorityHigh")
                            : draftPriority === "normal"
                              ? tt("priorityNormal")
                              : draftPriority === "low"
                                ? tt("priorityLow")
                                : tt("priorityPick")}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    </button>
                    {priorityMenuOpen ? (
                      <div className="absolute left-0 top-full z-[70] mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg overflow-hidden">
                        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                          {tt("priority")}
                        </div>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setDraftPriority("urgent");
                            setPriorityMenuOpen(false);
                          }}
                        >
                          <Flag className="h-4 w-4 shrink-0 text-red-600" strokeWidth={2} aria-hidden />
                          {tt("priorityUrgent")}
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setDraftPriority("high");
                            setPriorityMenuOpen(false);
                          }}
                        >
                          <Flag className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
                          {tt("priorityHigh")}
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setDraftPriority("normal");
                            setPriorityMenuOpen(false);
                          }}
                        >
                          <Flag className="h-4 w-4 shrink-0 text-blue-600" strokeWidth={2} aria-hidden />
                          {tt("priorityNormal")}
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setDraftPriority("low");
                            setPriorityMenuOpen(false);
                          }}
                        >
                          <Flag className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={2} aria-hidden />
                          {tt("priorityLow")}
                        </button>
                        <div className="my-1 border-t border-gray-100" />
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                          onClick={() => {
                            setDraftPriority(null);
                            setPriorityMenuOpen(false);
                          }}
                        >
                          <Ban className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2} aria-hidden />
                          {tt("priorityClear")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">
                    {tt("tags")}
                  </span>
                </div>

                {createError ? (
                  <p className="text-sm text-red-600 pt-1">{createError}</p>
                ) : null}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                  <div className="flex gap-1 text-gray-400">
                    <button type="button" className="p-2 rounded-md hover:bg-gray-100">
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <button type="button" className="p-2 rounded-md hover:bg-gray-100">
                      <Bell className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitCreateTask()}
                    disabled={!draftRange || createPending}
                    className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
                  >
                    {createPending ? tt("creatingTask") : tt("createTaskSubmit")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {draftRange ? (
        <TimelineTaskDateTimePanel
          open={dateTimePickerOpen}
          onClose={() => setDateTimePickerOpen(false)}
          value={draftRange}
          onApply={(next) => setDraftRange(next)}
          t={tt}
        />
      ) : null}
    </div>
  );
}
