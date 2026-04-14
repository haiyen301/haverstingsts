import { format } from "date-fns";

import { STS_API_PATHS } from "@/shared/api/stsApiPaths";
import {
  buildStsProxyGetUrl,
  stsProxyGetFullJson,
  stsProxyPostJson,
} from "@/shared/api/stsProxyClient";

/** Row shape returned by STSPortal `Timeline` + `timeline_tasks` (JSON object). */
export type ApiTimelineTaskRow = {
  id: number;
  title: string;
  description?: string | null;
  status?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  priority?: string | null;
  /** Comma-separated or free-text tags (max 500 chars on server). */
  tags?: string | null;
  assignee_user_id?: number | null;
  sort_order?: number;
  /** Optional swimlane / row index for Gantt UI. */
  lane_index?: number;
  created_user_id?: number | null;
  updated_by_user_id?: number | null;
};

export function formatPhpDatetime(d: Date): string {
  return format(d, "yyyy-MM-dd HH:mm:ss");
}

export async function fetchTimelineTasks(params: {
  from: Date;
  to: Date;
  includeUnscheduled?: boolean;
}): Promise<{ scheduled: ApiTimelineTaskRow[]; unscheduled: ApiTimelineTaskRow[] }> {
  const from = formatPhpDatetime(params.from);
  const to = formatPhpDatetime(params.to);
  const url = buildStsProxyGetUrl(STS_API_PATHS.timeline, {
    from,
    to,
    include_unscheduled: params.includeUnscheduled ? 1 : undefined,
  });
  const json = await stsProxyGetFullJson(url);
  const data = Array.isArray(json.data) ? (json.data as ApiTimelineTaskRow[]) : [];
  const unscheduled =
    params.includeUnscheduled && Array.isArray(json.unscheduled)
      ? (json.unscheduled as ApiTimelineTaskRow[])
      : [];
  return { scheduled: data, unscheduled };
}

export async function fetchTimelineTaskDetail(id: number): Promise<ApiTimelineTaskRow> {
  const url = buildStsProxyGetUrl(STS_API_PATHS.timelineDetail, { id });
  const json = await stsProxyGetFullJson(url);
  const data = json.data;
  if (!data || typeof data !== "object") {
    throw new Error("No task data");
  }
  return data as ApiTimelineTaskRow;
}

export async function saveTimelineTask(payload: {
  id?: number;
  title: string;
  description?: string | null;
  start_at: string | null;
  end_at: string | null;
  status?: string;
  priority?: string | null;
  tags?: string | null;
  assignee_user_id?: number | null;
  sort_order?: number;
  lane_index?: number;
}): Promise<{ id?: number }> {
  return stsProxyPostJson<{ id?: number }>(STS_API_PATHS.timelineSave, payload);
}
