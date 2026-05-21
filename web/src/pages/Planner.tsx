import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  loadMonth,
  createTask,
  type LoadedMonth,
  type V3User,
  type CreateResult,
} from "../lib/teamwork";
import {
  thisMonth, nextMonth, prevMonth, monthLabel, shiftDateToMonth, monthStartEnd,
} from "../lib/dates";
import { lsGet, lsSet, lsRemove } from "../lib/storage";
import { getRuns, saveRun, newRunId, type PushRun } from "../lib/audit";
import RunResultsDialog from "../components/RunResultsDialog";
import RecentRuns from "../components/RecentRuns";
import BulkActionsBar from "../components/BulkActionsBar";

export type EditableTask = {
  rowId: string;
  sourceTaskId: number | null;
  tasklistId: number;
  name: string;
  assigneeUserIds: number[];
  estimateMinutes: number;
  startDate: string | null;
  dueDate: string | null;
  selected: boolean;
};

type DraftStorage = {
  targetMonth: string;
  sourceMonth: string;
  rows: EditableTask[];
  savedAt: string;
};

export default function Planner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [sourceMonth, setSourceMonth] = useState<string>(thisMonth());
  const [targetMonth, setTargetMonth] = useState<string>(nextMonth(thisMonth()));
  // Independent control of source/target — when false, target auto-tracks source+1
  const [unlinkMonths, setUnlinkMonths] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<LoadedMonth | null>(null);
  // Previous-month data for per-client deltas. Loaded lazily after main load.
  const [prevData, setPrevData] = useState<LoadedMonth | null>(null);
  const [rows, setRows] = useState<EditableTask[]>([]);

  const [filterUserId, setFilterUserId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [hideUnselected, setHideUnselected] = useState(false);

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [draftRestored, setDraftRestored] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [pushResults, setPushResults] = useState<PushRun | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [recentRuns, setRecentRuns] = useState<PushRun[]>(() => getRuns());

  const [addClientOpen, setAddClientOpen] = useState(false);

  const draftKey = `mp_draft_${targetMonth}`;

  // Save draft on every change
  useEffect(() => {
    if (rows.length === 0 || !data) return;
    const draft: DraftStorage = {
      targetMonth, sourceMonth, rows, savedAt: new Date().toISOString(),
    };
    lsSet(draftKey, draft);
  }, [rows, draftKey, targetMonth, sourceMonth, data]);

  function load() {
    setLoading(true);
    setLoadError(null);
    setData(null);
    setPrevData(null);
    setRows([]);
    setDraftRestored(false);

    loadMonth(sourceMonth)
      .then((loaded) => {
        setData(loaded);

        // Check for draft first
        const draft = lsGet<DraftStorage>(`mp_draft_${targetMonth}`);
        if (draft && draft.rows.length > 0) {
          setRows(draft.rows);
          setDraftRestored(true);
        } else {
          const initial: EditableTask[] = loaded.tasks.map((t, i) => ({
            rowId: `loaded-${t.id}-${i}`,
            sourceTaskId: t.id,
            tasklistId: t.tasklistId,
            name: t.name,
            assigneeUserIds: t.assigneeUserIds,
            estimateMinutes: t.estimateMinutes,
            startDate: shiftDateToMonth(t.startDate, sourceMonth, targetMonth),
            dueDate: shiftDateToMonth(t.dueDate, sourceMonth, targetMonth),
            selected: true,
          }));
          setRows(initial);
        }

        // Lazy-load previous month for deltas — non-blocking, doesn't fail the page
        const prev = prevMonth(sourceMonth);
        loadMonth(prev).then(setPrevData).catch(() => { /* swallow */ });
      })
      .catch((e) => setLoadError((e as Error).message))
      .finally(() => setLoading(false));
  }

  function discardDraft() {
    lsRemove(draftKey);
    setDraftRestored(false);
    if (!data) return;
    const initial: EditableTask[] = data.tasks.map((t, i) => ({
      rowId: `loaded-${t.id}-${i}`,
      sourceTaskId: t.id,
      tasklistId: t.tasklistId,
      name: t.name,
      assigneeUserIds: t.assigneeUserIds,
      estimateMinutes: t.estimateMinutes,
      startDate: shiftDateToMonth(t.startDate, sourceMonth, targetMonth),
      dueDate: shiftDateToMonth(t.dueDate, sourceMonth, targetMonth),
      selected: true,
    }));
    setRows(initial);
  }

  // ===== Derived state =====

  const tasklistById = useMemo(() => {
    const m = new Map<number, { id: number; name: string; projectId: number }>();
    data?.tasklists.forEach((tl) => m.set(tl.id, tl));
    return m;
  }, [data]);

  const userById = useMemo(() => {
    const m = new Map<number, V3User>();
    data?.users.forEach((u) => m.set(u.id, u));
    return m;
  }, [data]);

  const tasklistsByProject = useMemo(() => {
    const m = new Map<number, { id: number; name: string }[]>();
    if (!data) return m;
    for (const tl of data.tasklists) {
      const arr = m.get(tl.projectId) || [];
      arr.push({ id: tl.id, name: tl.name });
      m.set(tl.projectId, arr);
    }
    return m;
  }, [data]);

  const rowsByProject = useMemo(() => {
    const m = new Map<number, EditableTask[]>();
    for (const r of rows) {
      const tl = tasklistById.get(r.tasklistId);
      const pid = tl?.projectId ?? 0;
      const arr = m.get(pid) || [];
      arr.push(r);
      m.set(pid, arr);
    }
    return m;
  }, [rows, tasklistById]);

  // Previous-month total minutes per project, for delta badges
  const prevMinutesByProject = useMemo(() => {
    const m = new Map<number, number>();
    if (!prevData) return m;
    const prevTlById = new Map<number, { projectId: number }>();
    prevData.tasklists.forEach((tl) => prevTlById.set(tl.id, { projectId: tl.projectId }));
    for (const t of prevData.tasks) {
      const tl = prevTlById.get(t.tasklistId);
      if (!tl) continue;
      m.set(tl.projectId, (m.get(tl.projectId) || 0) + (t.estimateMinutes || 0));
    }
    return m;
  }, [prevData]);

  const projectsToShow = useMemo(() => {
    if (!data) return [];
    return [...data.projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const searchLower = searchText.trim().toLowerCase();
  const isRowVisible = useCallback(
    (r: EditableTask) => {
      if (filterUserId != null) {
        if (r.sourceTaskId == null) return true; // unsaved rows always show
        if (!r.assigneeUserIds.includes(filterUserId)) return false;
      }
      if (hideUnselected && !r.selected) return false;
      if (searchLower) {
        const tl = tasklistById.get(r.tasklistId);
        const haystack = `${r.name} ${tl?.name || ""}`.toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }
      return true;
    },
    [filterUserId, hideUnselected, searchLower, tasklistById],
  );

  const isProjectVisible = useCallback(
    (projectName: string) => {
      if (!searchLower) return true;
      return projectName.toLowerCase().includes(searchLower);
    },
    [searchLower],
  );

  // Hours per assignee for the utilisation bar — selected & named rows only
  const hoursByUser = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      if (!r.selected || !r.name.trim()) continue;
      if (r.assigneeUserIds.length === 0) continue;
      for (const uid of r.assigneeUserIds) {
        m.set(uid, (m.get(uid) || 0) + r.estimateMinutes);
      }
    }
    return m;
  }, [rows]);

  // ===== Row mutations =====

  function updateRow(rowId: string, patch: Partial<EditableTask>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }
  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }
  function addRow(projectId: number) {
    const tls = tasklistsByProject.get(projectId) || [];
    if (tls.length === 0) return;
    const { start, end } = monthStartEnd(targetMonth);
    const tasklistId = tls[0].id;
    const sibling = rows.find((r) => r.tasklistId === tasklistId && r.assigneeUserIds.length > 0);
    const defaultAssignees = filterUserId != null ? [filterUserId] : (sibling?.assigneeUserIds || []);
    setRows((prev) => [
      ...prev,
      {
        rowId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceTaskId: null,
        tasklistId,
        name: "",
        assigneeUserIds: defaultAssignees,
        estimateMinutes: sibling?.estimateMinutes || 60,
        startDate: start,
        dueDate: end,
        selected: true,
      },
    ]);
  }
  function toggleProject(projectId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }
  function collapseAll() {
    setCollapsed(new Set(projectsToShow.map((p) => p.id)));
  }
  function expandAll() {
    setCollapsed(new Set());
  }

  // ===== Bulk actions =====

  const visibleRowIds = useMemo(() => {
    return rows.filter(isRowVisible).map((r) => r.rowId);
  }, [rows, isRowVisible]);

  function bulkReassign(toUserId: number) {
    setRows((prev) => prev.map((r) =>
      visibleRowIds.includes(r.rowId) && r.selected
        ? { ...r, assigneeUserIds: [toUserId] }
        : r,
    ));
  }
  function bulkAddAssignee(uid: number) {
    setRows((prev) => prev.map((r) =>
      visibleRowIds.includes(r.rowId) && r.selected && !r.assigneeUserIds.includes(uid)
        ? { ...r, assigneeUserIds: [...r.assigneeUserIds, uid] }
        : r,
    ));
  }
  function bulkShiftDays(days: number) {
    if (!days) return;
    setRows((prev) => prev.map((r) => {
      if (!visibleRowIds.includes(r.rowId)) return r;
      return {
        ...r,
        startDate: shiftDays(r.startDate, days),
        dueDate: shiftDays(r.dueDate, days),
      };
    }));
  }
  function bulkClearZeroEstimates() {
    setRows((prev) => prev.filter(
      (r) => !visibleRowIds.includes(r.rowId) || r.estimateMinutes > 0,
    ));
  }
  function bulkDeselect() {
    setRows((prev) => prev.map((r) =>
      visibleRowIds.includes(r.rowId) ? { ...r, selected: false } : r,
    ));
  }
  function bulkSelect() {
    setRows((prev) => prev.map((r) =>
      visibleRowIds.includes(r.rowId) ? { ...r, selected: true } : r,
    ));
  }

  // ===== Push =====

  const pushableTasks = useMemo(() => {
    return rows.filter((r) => r.selected && r.name.trim().length > 0 && r.tasklistId);
  }, [rows]);
  const priorRunForTarget = useMemo(() => {
    return recentRuns.find((r) => r.targetMonth === targetMonth && r.successes > 0);
  }, [recentRuns, targetMonth]);

  async function pushAll() {
    setPushing(true);
    setPushProgress({ done: 0, total: pushableTasks.length });
    const results: CreateResult[] = [];
    const DELAY_MS = 200;
    for (let i = 0; i < pushableTasks.length; i++) {
      const task = pushableTasks[i];
      const r = await createTask({
        tasklistId: task.tasklistId,
        name: task.name,
        assigneeUserIds: task.assigneeUserIds,
        estimateMinutes: task.estimateMinutes,
        startDate: task.startDate,
        dueDate: task.dueDate,
      }, i);
      results.push(r);
      setPushProgress({ done: i + 1, total: pushableTasks.length });
      if (i < pushableTasks.length - 1) {
        await new Promise((res) => setTimeout(res, DELAY_MS));
      }
    }
    const successes = results.filter((r) => r.ok).length;
    const failures = results.filter((r) => !r.ok).length;
    const run: PushRun = {
      id: newRunId(),
      sourceMonth, targetMonth,
      total: pushableTasks.length,
      successes, failures, results,
      createdAt: new Date().toISOString(),
    };
    saveRun(run);
    setRecentRuns(getRuns());
    setPushResults(run);
    setShowResults(true);
    setPushing(false);
    setPushProgress(null);
    setPushConfirmOpen(false);
    if (failures === 0) lsRemove(draftKey);
  }

  // ===== Render =====

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-zinc-600">Loading tasks from Teamwork…</div>
      </div>
    );
  }

  // Projects already in the grid - for the Add Client picker, we show the rest
  const projectsInGrid = new Set(
    Array.from(rowsByProject.keys()).filter((pid) => (rowsByProject.get(pid) || []).length > 0),
  );

  return (
    <div className="min-h-screen pb-32">
      <Header
        sourceMonth={sourceMonth}
        targetMonth={targetMonth}
        unlinkMonths={unlinkMonths}
        setSourceMonth={(m) => {
          setSourceMonth(m);
          if (!unlinkMonths) setTargetMonth(nextMonth(m));
        }}
        setTargetMonth={setTargetMonth}
        setUnlinkMonths={setUnlinkMonths}
        onLoad={load}
        loading={loading}
        onOpenSettings={onOpenSettings}
        loaded={data != null}
      />

      {loadError && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-900">
            Load failed: {loadError}
          </div>
        </div>
      )}

      {draftRestored && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900 flex items-center justify-between">
            <span>Restored your unsaved edits from this browser. Discard to reset to last-month's tasks.</span>
            <button onClick={discardDraft} className="text-amber-900 underline hover:no-underline">
              Discard
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          <UtilisationBar
            hoursByUser={hoursByUser}
            loggedMinutesByUser={data.loggedMinutesByUser}
            userById={userById}
            filterUserId={filterUserId}
            setFilterUserId={setFilterUserId}
          />

          <div className="max-w-7xl mx-auto px-6 mt-4 flex items-center gap-3 flex-wrap">
            <input
              type="search"
              placeholder="Search tasks or clients…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="px-3 py-1.5 text-sm border border-zinc-300 rounded-md w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="text-xs text-zinc-600 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hideUnselected}
                onChange={(e) => setHideUnselected(e.target.checked)}
              />
              Hide unselected
            </label>
            <button
              onClick={expandAll}
              className="text-xs text-zinc-600 underline hover:no-underline"
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="text-xs text-zinc-600 underline hover:no-underline"
            >
              Collapse all
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setAddClientOpen(true)}
              className="text-xs px-3 py-1.5 border border-zinc-300 rounded-md hover:bg-zinc-50"
            >
              + Add client
            </button>
          </div>

          <BulkActionsBar
            visibleCount={visibleRowIds.length}
            filterActive={!!searchLower || filterUserId != null || hideUnselected}
            users={Array.from(userById.values())}
            onReassign={bulkReassign}
            onAddAssignee={bulkAddAssignee}
            onShiftDays={bulkShiftDays}
            onClearZero={bulkClearZeroEstimates}
            onDeselectAll={bulkDeselect}
            onSelectAll={bulkSelect}
          />

          <RecentRuns
            runs={recentRuns}
            onSelect={(r) => {
              setPushResults(r);
              setShowResults(true);
            }}
          />

          <div className="max-w-7xl mx-auto px-6 mt-6 space-y-3">
            {projectsToShow.map((p) => {
              if (!isProjectVisible(p.name)) {
                // If the project name doesn't match search, only show if it has matching tasks
                const allRows = rowsByProject.get(p.id) || [];
                const anyMatch = allRows.some(isRowVisible);
                if (!anyMatch) return null;
              }
              const projectRows = (rowsByProject.get(p.id) || []).filter(isRowVisible);
              const allProjectRows = rowsByProject.get(p.id) || [];
              const totalMins = projectRows.reduce(
                (s, r) => s + (r.selected && r.name.trim() ? r.estimateMinutes : 0),
                0,
              );
              const prevMins = prevMinutesByProject.get(p.id) || 0;
              const isCollapsed = collapsed.has(p.id);
              if (filterUserId != null && projectRows.length === 0) return null;
              return (
                <ProjectCard
                  key={p.id}
                  project={p}
                  rows={projectRows}
                  allRowsCount={allProjectRows.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleProject(p.id)}
                  totalMins={totalMins}
                  prevMins={prevMins}
                  prevAvailable={prevData != null}
                  tasklists={tasklistsByProject.get(p.id) || []}
                  userById={userById}
                  updateRow={updateRow}
                  removeRow={removeRow}
                  addRow={() => addRow(p.id)}
                />
              );
            })}
          </div>

          <PushBar
            pushableCount={pushableTasks.length}
            totalHours={
              Math.round((pushableTasks.reduce((s, r) => s + r.estimateMinutes, 0) / 60) * 10) / 10
            }
            disabled={pushableTasks.length === 0 || pushing}
            onPush={() => setPushConfirmOpen(true)}
            pushing={pushing}
            progress={pushProgress}
          />
        </>
      )}

      {pushConfirmOpen && (
        <PushConfirmDialog
          pushableCount={pushableTasks.length}
          targetMonth={targetMonth}
          priorRun={priorRunForTarget}
          onCancel={() => setPushConfirmOpen(false)}
          onConfirm={pushAll}
        />
      )}

      {showResults && pushResults && (
        <RunResultsDialog
          run={pushResults}
          onClose={() => setShowResults(false)}
        />
      )}

      {addClientOpen && data && (
        <AddClientDialog
          projects={data.projects.filter((p) => !projectsInGrid.has(p.id))}
          tasklistsByProject={tasklistsByProject}
          onCancel={() => setAddClientOpen(false)}
          onAdd={(projectId) => {
            addRow(projectId);
            setAddClientOpen(false);
            // Make sure the newly-added project is expanded
            setCollapsed((prev) => {
              const next = new Set(prev);
              next.delete(projectId);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

// ===== Helpers =====

function shiftDays(date: string | null, days: number): string | null {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ===== Components =====

function Header({
  sourceMonth, targetMonth, unlinkMonths, setSourceMonth, setTargetMonth, setUnlinkMonths,
  onLoad, loading, onOpenSettings, loaded,
}: {
  sourceMonth: string;
  targetMonth: string;
  unlinkMonths: boolean;
  setSourceMonth: (m: string) => void;
  setTargetMonth: (m: string) => void;
  setUnlinkMonths: (b: boolean) => void;
  onLoad: () => void;
  loading: boolean;
  onOpenSettings: () => void;
  loaded: boolean;
}) {
  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold">Monthly Planner</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Plan <strong>{monthLabel(targetMonth)}</strong> using <strong>{monthLabel(sourceMonth)}</strong> as template
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-600">Source:</label>
            <input
              type="month"
              value={sourceMonth}
              onChange={(e) => setSourceMonth(e.target.value)}
              className="px-2 py-1.5 border border-zinc-300 rounded-md text-sm"
            />
          </div>
          {unlinkMonths && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-600">Target:</label>
              <input
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="px-2 py-1.5 border border-zinc-300 rounded-md text-sm"
              />
            </div>
          )}
          <label className="text-xs text-zinc-600 flex items-center gap-1">
            <input
              type="checkbox"
              checked={unlinkMonths}
              onChange={(e) => setUnlinkMonths(e.target.checked)}
            />
            Custom target
          </label>
          <button
            onClick={() => {
              const p = prevMonth(sourceMonth);
              setSourceMonth(p);
            }}
            className="text-xs text-zinc-600 underline hover:no-underline"
          >
            ← Earlier
          </button>
          <button
            onClick={onLoad}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Loading…" : (loaded ? "Reload" : "Load tasks")}
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}

function UtilisationBar({
  hoursByUser, loggedMinutesByUser, userById, filterUserId, setFilterUserId,
}: {
  hoursByUser: Map<number, number>;
  loggedMinutesByUser: Record<string, number>;
  userById: Map<number, V3User>;
  filterUserId: number | null;
  setFilterUserId: (uid: number | null) => void;
}) {
  const userIds = useMemo(() => {
    const s = new Set<number>();
    hoursByUser.forEach((_, uid) => s.add(uid));
    Object.keys(loggedMinutesByUser).forEach((k) => s.add(Number(k)));
    return Array.from(s);
  }, [hoursByUser, loggedMinutesByUser]);

  const userPills = userIds.map((uid) => {
    const u = userById.get(uid);
    const plannedMins = hoursByUser.get(uid) || 0;
    const loggedMins = Number(loggedMinutesByUser[String(uid)] || 0);
    const name = u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : `User ${uid}`;
    return { uid, name, plannedH: plannedMins / 60, loggedH: loggedMins / 60 };
  }).sort((a, b) => b.plannedH - a.plannedH);

  return (
    <div className="sticky top-0 bg-zinc-50 border-b border-zinc-200 z-20">
      <div className="max-w-7xl mx-auto px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">
            Hours per assignee
          </h2>
          {filterUserId != null && (
            <button
              onClick={() => setFilterUserId(null)}
              className="text-xs text-zinc-600 underline hover:no-underline"
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {userPills.map(({ uid, name, plannedH, loggedH }) => {
            const isActive = filterUserId === uid;
            const variance = plannedH - loggedH;
            const varianceColor =
              Math.abs(variance) / Math.max(loggedH, 1) <= 0.1
                ? "text-zinc-500"
                : variance < 0
                ? "text-amber-600"
                : "text-blue-600";
            return (
              <button
                key={uid}
                onClick={() => setFilterUserId(isActive ? null : uid)}
                className={`px-3 py-1.5 text-xs rounded-full border transition ${
                  isActive
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-zinc-800 border-zinc-300 hover:border-zinc-400"
                }`}
              >
                <span className="font-medium">{name}</span>
                <span className="ml-2 font-mono">{plannedH.toFixed(1)}h</span>
                {loggedH > 0 && (
                  <span className={`ml-1.5 font-mono ${isActive ? "text-blue-100" : varianceColor}`}>
                    · {loggedH.toFixed(1)}h logged
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project, rows, allRowsCount, collapsed, onToggle, totalMins, prevMins, prevAvailable,
  tasklists, userById, updateRow, removeRow, addRow,
}: {
  project: { id: number; name: string };
  rows: EditableTask[];
  allRowsCount: number;
  collapsed: boolean;
  onToggle: () => void;
  totalMins: number;
  prevMins: number;
  prevAvailable: boolean;
  tasklists: { id: number; name: string }[];
  userById: Map<number, V3User>;
  updateRow: (rowId: string, patch: Partial<EditableTask>) => void;
  removeRow: (rowId: string) => void;
  addRow: () => void;
}) {
  const hours = (totalMins / 60).toFixed(1);
  const deltaMins = totalMins - prevMins;
  const deltaHours = (deltaMins / 60);
  const showDelta = prevAvailable && prevMins > 0;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-zinc-400 text-xs">{collapsed ? "▶" : "▼"}</span>
          <h3 className="font-medium text-sm">{project.name}</h3>
          <span className="text-xs text-zinc-500">
            {allRowsCount} task{allRowsCount !== 1 ? "s" : ""} · {hours}h
          </span>
          {showDelta && (
            <DeltaBadge deltaHours={deltaHours} prevHours={prevMins / 60} />
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600 text-xs">
              <tr>
                <th className="px-3 py-2 text-left w-8">✓</th>
                <th className="px-3 py-2 text-left">Task</th>
                <th className="px-3 py-2 text-left w-40">Tasklist</th>
                <th className="px-3 py-2 text-left w-48">Assignees</th>
                <th className="px-3 py-2 text-left w-20">Mins</th>
                <th className="px-3 py-2 text-left w-32">Start</th>
                <th className="px-3 py-2 text-left w-32">Due</th>
                <th className="px-3 py-2 text-left w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RowEditor
                  key={r.rowId}
                  row={r}
                  tasklists={tasklists}
                  userById={userById}
                  onUpdate={(patch) => updateRow(r.rowId, patch)}
                  onRemove={() => removeRow(r.rowId)}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-zinc-500">
                    No tasks
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-zinc-100">
            <button
              onClick={addRow}
              disabled={tasklists.length === 0}
              className="text-xs text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
            >
              + Add task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeltaBadge({ deltaHours, prevHours }: { deltaHours: number; prevHours: number }) {
  const sign = deltaHours > 0.05 ? "+" : (deltaHours < -0.05 ? "" : "");
  const abs = Math.abs(deltaHours);
  if (abs < 0.05) return (
    <span className="text-xs text-zinc-400">· same as {prevHours.toFixed(1)}h previously</span>
  );
  const pct = prevHours > 0 ? (deltaHours / prevHours) * 100 : 0;
  const color =
    Math.abs(pct) <= 10 ? "text-zinc-500"
      : deltaHours < 0 ? "text-emerald-700"
      : deltaHours > 0 && Math.abs(pct) > 15 ? "text-amber-700"
      : "text-zinc-600";
  return (
    <span className={`text-xs ${color}`} title={`Previously ${prevHours.toFixed(1)}h`}>
      · {sign}{deltaHours.toFixed(1)}h vs prev
    </span>
  );
}

function RowEditor({
  row, tasklists, userById, onUpdate, onRemove,
}: {
  row: EditableTask;
  tasklists: { id: number; name: string }[];
  userById: Map<number, V3User>;
  onUpdate: (patch: Partial<EditableTask>) => void;
  onRemove: () => void;
}) {
  const issues: string[] = [];
  if (row.selected && row.name.trim() && row.estimateMinutes === 0) issues.push("0 minutes");
  if (row.selected && row.name.trim() && row.assigneeUserIds.length === 0) issues.push("no assignee");
  if (row.startDate && row.dueDate && row.startDate > row.dueDate) issues.push("start > due");

  return (
    <tr className={`border-t border-zinc-100 ${!row.selected ? "opacity-50" : ""}`}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onUpdate({ selected: e.target.checked })}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {issues.length > 0 && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" title={issues.join(", ")} />
          )}
          <input
            type="text"
            value={row.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Task name"
            className="w-full px-2 py-1 text-sm border border-zinc-200 rounded focus:outline-none focus:border-blue-500"
          />
        </div>
      </td>
      <td className="px-3 py-2">
        <select
          value={row.tasklistId}
          onChange={(e) => onUpdate({ tasklistId: Number(e.target.value) })}
          className="w-full px-2 py-1 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-blue-500"
        >
          {tasklists.map((tl) => (
            <option key={tl.id} value={tl.id}>
              {tl.name || `#${tl.id}`}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <AssigneePicker
          users={Array.from(userById.values())}
          selectedIds={row.assigneeUserIds}
          onChange={(ids) => onUpdate({ assigneeUserIds: ids })}
        />
      </td>
      <td className="px-3 py-2">
        <EstimateInput
          rowId={row.rowId}
          value={row.estimateMinutes}
          onChange={(v) => onUpdate({ estimateMinutes: v })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={row.startDate || ""}
          onChange={(e) => onUpdate({ startDate: e.target.value || null })}
          className="w-full px-2 py-1 text-sm border border-zinc-200 rounded focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={row.dueDate || ""}
          onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
          className="w-full px-2 py-1 text-sm border border-zinc-200 rounded focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-3 py-2">
        <button
          onClick={onRemove}
          className="text-zinc-400 hover:text-red-600 text-sm"
          title="Remove task"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// Estimate input with keyboard navigation between rows.
// Up / Down / Enter jump between estimate inputs in document order.
function EstimateInput({
  rowId, value, onChange,
}: { rowId: string; value: number; onChange: (v: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-mp-est]"));
    const visible = all.filter((el) => el.offsetParent !== null);
    const idx = visible.findIndex((el) => el.dataset.mpEst === rowId);
    if (idx === -1) return;
    const next = e.key === "ArrowUp" ? visible[idx - 1] : visible[idx + 1];
    if (next) {
      next.focus();
      next.select();
    }
  }

  return (
    <input
      ref={inputRef}
      type="number"
      step="15"
      min="0"
      data-mp-est={rowId}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      onFocus={(e) => e.target.select()}
      onKeyDown={handleKey}
      className="w-full px-2 py-1 text-sm border border-zinc-200 rounded focus:outline-none focus:border-blue-500"
    />
  );
}

function AssigneePicker({
  users, selectedIds, onChange,
}: {
  users: V3User[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedNames = selectedIds.map((id) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : `#${id}`;
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2 py-1 text-sm text-left border border-zinc-200 rounded bg-white focus:outline-none focus:border-blue-500 truncate"
      >
        {selectedNames.length > 0 ? selectedNames.join(", ") : <span className="text-zinc-400">— pick —</span>}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 bg-white border border-zinc-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
          {users.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No users available</div>
          )}
          {users
            .sort((a, b) => (a.firstName || "").localeCompare(b.firstName || ""))
            .map((u) => {
              const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || `User ${u.id}`;
              const isSelected = selectedIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    onChange(
                      isSelected
                        ? selectedIds.filter((x) => x !== u.id)
                        : [...selectedIds, u.id],
                    );
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-50 flex items-center gap-2 ${
                    isSelected ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="inline-block w-4">{isSelected ? "✓" : ""}</span>
                  {name}
                </button>
              );
            })}
          <div className="border-t border-zinc-100 px-3 py-1.5 text-right">
            <button onClick={() => setOpen(false)} className="text-xs text-zinc-600">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PushBar({
  pushableCount, totalHours, disabled, onPush, pushing, progress,
}: {
  pushableCount: number;
  totalHours: number;
  disabled: boolean;
  onPush: () => void;
  pushing: boolean;
  progress: { done: number; total: number } | null;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t border-zinc-200 shadow-lg z-30">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="text-sm">
          <strong>{pushableCount}</strong> tasks to push · <strong>{totalHours}h</strong> total
        </div>
        {pushing && progress ? (
          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-600">
              Pushing {progress.done} of {progress.total}…
            </div>
            <div className="w-48 h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={onPush}
            disabled={disabled}
            className="px-6 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Push to Teamwork
          </button>
        )}
      </div>
    </div>
  );
}

function PushConfirmDialog({
  pushableCount, targetMonth, priorRun, onCancel, onConfirm,
}: {
  pushableCount: number;
  targetMonth: string;
  priorRun: PushRun | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-semibold mb-3">Push {pushableCount} tasks to Teamwork?</h2>
        <p className="text-sm text-zinc-600 mb-4">
          Tasks will be created in <strong>{monthLabel(targetMonth)}</strong>. This can't be undone from this tool.
        </p>
        {priorRun && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900 mb-4">
            ⚠️ You've already pushed to <strong>{monthLabel(targetMonth)}</strong> — {priorRun.successes}/{priorRun.total} tasks on{" "}
            {new Date(priorRun.createdAt).toLocaleString("en-GB")}. Pushing again will create <strong>duplicate tasks in Teamwork</strong>.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
              priorRun ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {priorRun ? "Push anyway" : "Confirm push"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddClientDialog({
  projects, tasklistsByProject, onCancel, onAdd,
}: {
  projects: { id: number; name: string }[];
  tasklistsByProject: Map<number, { id: number; name: string }[]>;
  onCancel: () => void;
  onAdd: (projectId: number) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = projects
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[70vh] flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">Add a client</h2>
          <p className="text-sm text-zinc-600 mt-1">
            Pick an active Teamwork project that isn't in this month's plan yet.
          </p>
          <input
            type="search"
            placeholder="Search projects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-3 w-full px-3 py-2 border border-zinc-300 rounded-md text-sm"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-zinc-500 text-center">No matching projects</div>
          )}
          {filtered.map((p) => {
            const tls = tasklistsByProject.get(p.id) || [];
            const hasTls = tls.length > 0;
            return (
              <button
                key={p.id}
                onClick={() => hasTls && onAdd(p.id)}
                disabled={!hasTls}
                className="w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md flex items-center justify-between"
              >
                <span>{p.name}</span>
                {!hasTls && <span className="text-xs text-zinc-400">no tasklists</span>}
              </button>
            );
          })}
        </div>
        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
