// Teamwork API client. All requests flow through the app's own
// /api/proxy Vercel Serverless Function which adds the Basic auth
// header and CORS — required because the browser can't call Teamwork
// directly.
//
// Ports the logic from the Hub's supabase/functions/monthly-planning-tasks
// and create-monthly-tasks edge functions. Key invariants kept:
//   - V3 endpoints throughout
//   - showCompletedLists=true and includeCompletedTasks=true on the tasks
//     fetch (the combination that surfaces tasks from completed lists)
//   - showCompleted=true&getEmptyLists=true on the per-project tasklists
//     backfill (so empty / closed lists appear in the picker)
//   - V3 CREATE field shape: { task: { assignees: { userIds }, startAt,
//     dueAt, estimatedMinutes } } — different from the READ shape

import { requireUnlocked, getStoredConfig } from "./config";

export type V3Project = { id: number; name: string };
export type V3Tasklist = { id: number; name: string; projectId: number };
export type V3User = { id: number; firstName?: string; lastName?: string };

export type LoadedTask = {
  id: number;
  name: string;
  tasklistId: number;
  assigneeUserIds: number[];
  estimateMinutes: number;
  startDate: string | null;
  dueDate: string | null;
};

export type LoadedMonth = {
  startDate: string;
  endDate: string;
  projects: V3Project[];
  tasklists: V3Tasklist[];
  users: V3User[];
  tasks: LoadedTask[];
  loggedMinutesByUser: Record<string, number>;
};

export type CreateTask = {
  tasklistId: number;
  name: string;
  assigneeUserIds: number[];
  estimateMinutes: number;
  startDate: string | null;
  dueDate: string | null;
};

export type CreateResult =
  | { ok: true; id: number; url: string; name: string; index: number }
  | { ok: false; error: string; name: string; index: number };

// Internal: build a proxy URL for a given Teamwork path.
// Uses the same-origin /api/proxy endpoint (Vercel Serverless Function).
function buildProxyUrl(path: string, params?: Record<string, string>): string {
  // Always relative — same origin as the app.
  const url = new URL("/api/proxy", window.location.origin);
  url.searchParams.set("path", path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function callWorker<T>(
  path: string,
  opts: { params?: Record<string, string>; method?: string; body?: unknown } = {},
): Promise<T> {
  const config = requireUnlocked();

  const url = buildProxyUrl(path, opts.params);
  const init: RequestInit = {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-tw-site": config.twSite,
      "x-tw-key": config.twKey,
    },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Teamwork ${resp.status}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Bad JSON from Teamwork (via proxy)");
  }
}

// Lightweight smoke test for Settings — confirms config + Worker + key
// all work. Hits the V3 me endpoint which is cheap and proves auth.
export async function pingTeamwork(): Promise<{ ok: boolean; message: string; user?: string }> {
  try {
    const data = await callWorker<any>("/projects/api/v3/me.json");
    const me = data?.person || data?.user || data?.me || {};
    const name = `${me.firstName || ""} ${me.lastName || ""}`.trim() || me.email || "(unknown)";
    return { ok: true, message: "Connection working", user: name };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// Public: load everything we need for the planning grid for one month.
// Mirrors the Hub edge function's "load_month" action.
export async function loadMonth(month: string): Promise<LoadedMonth> {
  const { start, end } = monthRange(month);

  // 1) Active projects (for the project name lookup)
  const projData = await callWorker<any>("/projects/api/v3/projects.json", {
    params: { status: "active", pageSize: "100" },
  });
  const projects: V3Project[] = (projData.projects || []).map((p: any) => ({
    id: Number(p.id),
    name: String(p.name || ""),
  }));

  // 2) Tasks for the date window with the magic flags
  const tasklistsById = new Map<number, V3Tasklist>();
  const usersById = new Map<number, V3User>();
  const tasks: LoadedTask[] = [];

  let page = 1;
  let totalPages = 1;
  // Soft cap of 10 pages = 5,000 tasks — far above any realistic monthly volume.
  while (page <= totalPages && page <= 10) {
    const data = await callWorker<any>("/projects/api/v3/tasks.json", {
      params: {
        startDate: start,
        endDate: end,
        include: "tasklists,users",
        includeCompletedTasks: "true",
        showCompletedLists: "true", // critical — surfaces tasks from completed lists
        filter: "anyTime",
        pageSize: "500",
        page: String(page),
      },
    });

    for (const t of (data.tasks || [])) {
      const minutes = Number(t.estimateMinutes ?? t.estimatedMinutes ?? 0);
      const assignees: number[] = Array.isArray(t.assigneeUserIds)
        ? t.assigneeUserIds
        : Array.isArray(t.assignees?.userIds)
        ? t.assignees.userIds
        : [];
      tasks.push({
        id: Number(t.id),
        name: String(t.name || ""),
        tasklistId: Number(t.tasklistId ?? t.tasklist?.id ?? 0),
        assigneeUserIds: assignees.map(Number),
        estimateMinutes: minutes,
        startDate: normaliseDate(t.startDate ?? t.startAt ?? t["start-date"]),
        dueDate: normaliseDate(t.dueDate ?? t.dueAt ?? t["due-date"]),
      });
    }

    // Sideloaded tasklists & users
    const included = data.included || {};
    const tlSrc = included.tasklists || {};
    const tlList = Array.isArray(tlSrc) ? tlSrc : Object.values(tlSrc);
    for (const tl of tlList as any[]) {
      const id = Number(tl?.id || 0);
      if (!id) continue;
      tasklistsById.set(id, {
        id,
        name: String(tl.name || ""),
        projectId: Number(tl.projectId || tl.project?.id || 0),
      });
    }
    const uSrc = included.users || {};
    const uList = Array.isArray(uSrc) ? uSrc : Object.values(uSrc);
    for (const u of uList as any[]) {
      const id = Number(u?.id || 0);
      if (!id) continue;
      usersById.set(id, {
        id,
        firstName: u.firstName || u["first-name"] || "",
        lastName: u.lastName || u["last-name"] || "",
      });
    }

    const meta = data.meta || {};
    const pageInfo = meta.page || {};
    totalPages = pageInfo.totalPages || pageInfo.pageCount || (data.tasks?.length === 500 ? page + 1 : page);
    page += 1;
  }

  // 3) Per-project tasklist backfill (empty & completed lists missed by step 2)
  await Promise.all(projects.map(async (p) => {
    try {
      const data = await callWorker<any>(`/projects/api/v3/projects/${p.id}/tasklists.json`, {
        params: { pageSize: "100", getEmptyLists: "true", showCompleted: "true", showDeleted: "false" },
      });
      const taskLists: any[] = data.tasklists || data["task-lists"] || data.taskLists || [];
      for (const tl of taskLists) {
        const id = Number(tl?.id || 0);
        if (!id || tasklistsById.has(id)) continue;
        tasklistsById.set(id, { id, name: String(tl.name || ""), projectId: p.id });
      }
    } catch {
      // non-fatal — some projects may 404 or have permissions issues
    }
  }));

  // 4) Logged time for the source month, summed per user (sense-check)
  const loggedMinutesByUser: Record<string, number> = {};
  try {
    let tpage = 1;
    let hasMore = true;
    while (hasMore && tpage <= 10) {
      const td = await callWorker<any>("/projects/api/v3/time.json", {
        params: { startDate: start, endDate: end, pageSize: "500", page: String(tpage) },
      });
      const entries: any[] = td["time-entries"] || td.timeEntries || td.entries || td.time || [];
      if (!Array.isArray(entries) || entries.length === 0) break;
      for (const e of entries) {
        const uid = Number(e.userId ?? e["user-id"] ?? e.personId ?? e.user?.id ?? 0);
        if (!uid) continue;
        const mins = Number(
          e.minutes ?? e.timeMinutes ?? e.minutesLogged ?? (
            e.hours != null ? Number(e.hours) * 60 + Number(e.minutes ?? 0) : 0
          ),
        );
        if (!mins) continue;
        const k = String(uid);
        loggedMinutesByUser[k] = (loggedMinutesByUser[k] || 0) + mins;
      }
      if (entries.length < 500) hasMore = false;
      tpage += 1;
    }
  } catch {
    // non-fatal
  }

  return {
    startDate: start,
    endDate: end,
    projects,
    tasklists: Array.from(tasklistsById.values()),
    users: Array.from(usersById.values()),
    tasks,
    loggedMinutesByUser,
  };
}

// Create one task. Returns ok/error with index for batching.
export async function createTask(task: CreateTask, index: number): Promise<CreateResult> {
  if (!task.tasklistId) return { ok: false, error: "Missing tasklistId", name: task.name, index };
  if (!task.name?.trim()) return { ok: false, error: "Missing task name", name: task.name, index };

  const body: Record<string, any> = {
    task: {
      tasklistId: task.tasklistId,
      name: task.name,
      assignees: task.assigneeUserIds.length > 0
        ? { userIds: task.assigneeUserIds }
        : undefined,
      estimatedMinutes: task.estimateMinutes || 0,
      startAt: task.startDate || undefined,
      dueAt: task.dueDate || undefined,
      priority: "normal",
      description: "",
    },
  };

  try {
    const data = await callWorker<any>(
      `/projects/api/v3/tasklists/${task.tasklistId}/tasks.json`,
      { method: "POST", body },
    );
    const id = Number(data.task?.id ?? data.id ?? 0);
    if (!id) return { ok: false, error: "Teamwork returned no task id", name: task.name, index };
    // Build the link URL from the site (non-secret, doesn't need unlock)
    const stored = getStoredConfig();
    const site = stored ? stored.twSite.replace(/\/$/, "") : "";
    return { ok: true, id, url: site ? `https://${site}/app/tasks/${id}` : "", name: task.name, index };
  } catch (e) {
    return { ok: false, error: (e as Error).message, name: task.name, index };
  }
}

// Helpers
function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const startD = new Date(y, m - 1, 1);
  const endD = new Date(y, m, 0);
  return {
    start: isoDate(startD),
    end: isoDate(endD),
  };
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normaliseDate(v: any): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}
