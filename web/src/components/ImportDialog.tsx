import { useState, useEffect, useMemo } from "react";
import {
  parseFile,
  fetchGoogleSheet,
  autoGuessMapping,
  stageRows,
  buildTeamworkRefs,
  type ParsedSheet,
  type ColumnMapping,
  type MinutesUnit,
  type LogicalField,
  type StagedRow,
} from "../lib/spreadsheet";
import { lsGet, lsSet } from "../lib/storage";

type Mode = "replace" | "merge";
type Step = "upload" | "map" | "resolve";

type SavedMapping = {
  columns: string[];
  mapping: ColumnMapping;
  minutesUnit: MinutesUnit;
};

const SAVED_MAPPING_KEY = "mp_saved_mapping";

const LOGICAL_FIELDS: { key: LogicalField; label: string; optional?: boolean }[] = [
  { key: "client", label: "Client (project)" },
  { key: "tasklist", label: "Tasklist", optional: true },
  { key: "task", label: "Task name" },
  { key: "assignee", label: "Assignee", optional: true },
  { key: "minutes", label: "Estimate", optional: true },
  { key: "startDate", label: "Start date", optional: true },
  { key: "dueDate", label: "Due date", optional: true },
];

export type ImportDialogProps = {
  // Teamwork reference data, already loaded by the parent
  projects: { id: number; name: string }[];
  tasklists: { id: number; name: string; projectId: number }[];
  users: { id: number; firstName?: string; lastName?: string }[];
  // Default dates for rows that don't supply them — usually target month start/end
  defaultStart: string;
  defaultEnd: string;
  // Called when the user confirms import
  onImport: (
    rows: Array<{
      tasklistId: number;
      name: string;
      assigneeUserIds: number[];
      estimateMinutes: number;
      startDate: string | null;
      dueDate: string | null;
    }>,
    mode: Mode,
  ) => void;
  onCancel: () => void;
};

export default function ImportDialog({
  projects, tasklists, users, defaultStart, defaultEnd, onImport, onCancel,
}: ImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    client: null, tasklist: null, task: null, assignee: null,
    minutes: null, startDate: null, dueDate: null,
  });
  const [minutesUnit, setMinutesUnit] = useState<MinutesUnit>("minutes");
  const [mode, setMode] = useState<Mode>("merge");
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleUrl, setGoogleUrl] = useState("");

  const refs = useMemo(
    () => buildTeamworkRefs(projects, tasklists, users),
    [projects, tasklists, users],
  );

  // ===== Upload step =====

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const p = await parseFile(file);
      onParsed(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleUrl() {
    setError(null);
    setBusy(true);
    try {
      const p = await fetchGoogleSheet(googleUrl);
      onParsed(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onParsed(p: ParsedSheet) {
    setParsed(p);
    // Try a saved mapping first (if columns match)
    const saved = lsGet<SavedMapping>(SAVED_MAPPING_KEY);
    if (saved && sameColumns(saved.columns, p.columns)) {
      setMapping(saved.mapping);
      setMinutesUnit(saved.minutesUnit);
    } else {
      setMapping(autoGuessMapping(p.columns));
    }
    setStep("map");
  }

  // ===== Mapping step =====

  function confirmMapping() {
    if (!parsed) return;
    // Persist for next time
    lsSet<SavedMapping>(SAVED_MAPPING_KEY, {
      columns: parsed.columns,
      mapping,
      minutesUnit,
    });
    const s = stageRows(parsed, { mapping, minutesUnit, mode }, refs);
    setStaged(s);
    setStep("resolve");
  }

  // ===== Resolve step =====

  function updateStaged(rowIndex: number, patch: Partial<StagedRow>) {
    setStaged((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  }

  function skipRow(rowIndex: number) {
    setStaged((prev) => prev.filter((r) => r.rowIndex !== rowIndex));
  }

  const allResolved = staged.every(
    (r) =>
      r.taskName &&
      r.projectId != null &&
      r.tasklistId != null,
  );

  function commitImport() {
    const out = staged
      .filter((r) => r.tasklistId != null && r.taskName)
      .map((r) => ({
        tasklistId: r.tasklistId!,
        name: r.taskName,
        assigneeUserIds: r.assigneeUserIds,
        estimateMinutes: r.minutes,
        startDate: r.startDate || defaultStart,
        dueDate: r.dueDate || defaultEnd,
      }));
    onImport(out, mode);
  }

  // ===== Render =====

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Import from spreadsheet</h2>
            <div className="text-xs text-zinc-500 mt-0.5">
              Step {step === "upload" ? 1 : step === "map" ? 2 : 3} of 3 ·{" "}
              {step === "upload" && "Choose a file or paste a Google Sheets URL"}
              {step === "map" && "Tell us which columns mean what"}
              {step === "resolve" && "Confirm clients, tasklists, and assignees"}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-zinc-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "upload" && (
            <UploadStep
              busy={busy}
              error={error}
              googleUrl={googleUrl}
              setGoogleUrl={setGoogleUrl}
              onFile={handleFile}
              onGoogle={handleGoogleUrl}
              mode={mode}
              setMode={setMode}
            />
          )}

          {step === "map" && parsed && (
            <MapStep
              parsed={parsed}
              mapping={mapping}
              setMapping={setMapping}
              minutesUnit={minutesUnit}
              setMinutesUnit={setMinutesUnit}
            />
          )}

          {step === "resolve" && (
            <ResolveStep
              staged={staged}
              refs={refs}
              updateStaged={updateStaged}
              skipRow={skipRow}
            />
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between gap-2">
          <div className="text-xs text-zinc-500">
            {step === "resolve" && (
              <>
                {staged.filter((r) => r.tasklistId != null && r.taskName).length} ready ·{" "}
                {staged.filter((r) => !r.tasklistId || !r.taskName).length} need attention
              </>
            )}
          </div>
          <div className="flex gap-2">
            {step === "map" && (
              <button
                onClick={() => setStep("upload")}
                className="px-4 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
              >
                Back
              </button>
            )}
            {step === "resolve" && (
              <button
                onClick={() => setStep("map")}
                className="px-4 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
              >
                Back
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm border border-zinc-300 rounded-md hover:bg-zinc-50"
            >
              Cancel
            </button>
            {step === "map" && (
              <button
                onClick={confirmMapping}
                disabled={!mapping.client || !mapping.task}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Continue →
              </button>
            )}
            {step === "resolve" && (
              <button
                onClick={commitImport}
                disabled={!allResolved || staged.length === 0}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Import {staged.filter((r) => r.tasklistId && r.taskName).length} rows ({mode})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sameColumns(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ===== Step components =====

function UploadStep({
  busy, error, googleUrl, setGoogleUrl, onFile, onGoogle, mode, setMode,
}: {
  busy: boolean;
  error: string | null;
  googleUrl: string;
  setGoogleUrl: (s: string) => void;
  onFile: (f: File) => void;
  onGoogle: () => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2">Upload CSV or Excel file</h3>
        <label
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="block border-2 border-dashed border-zinc-300 rounded-lg p-8 text-center cursor-pointer hover:border-zinc-400 hover:bg-zinc-50"
        >
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            className="hidden"
          />
          <div className="text-sm text-zinc-600">
            {busy ? "Reading…" : (
              <>
                <div className="font-medium">Drop a file here or click to choose</div>
                <div className="text-xs text-zinc-500 mt-1">.csv, .xlsx, .xls</div>
              </>
            )}
          </div>
        </label>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-2 text-xs text-zinc-500">OR</span>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Paste a Google Sheets URL</h3>
        <div className="flex gap-2">
          <input
            type="url"
            value={googleUrl}
            onChange={(e) => setGoogleUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="flex-1 px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={onGoogle}
            disabled={!googleUrl.trim() || busy}
            className="px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50"
          >
            {busy ? "Fetching…" : "Fetch"}
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          The sheet must be shared as "Anyone with the link can view" or published to the web.
        </p>
      </div>

      <div className="pt-4 border-t border-zinc-200">
        <h3 className="text-sm font-semibold mb-2">When imported:</h3>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Merge with Teamwork data</div>
              <div className="text-xs text-zinc-500">Add these rows on top of whatever was already loaded</div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
              className="mt-1"
            />
            <div>
              <div className="font-medium">Replace all Teamwork data</div>
              <div className="text-xs text-zinc-500">Clear the grid first, then add only the spreadsheet rows</div>
            </div>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md text-sm bg-red-50 text-red-900 border border-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function MapStep({
  parsed, mapping, setMapping, minutesUnit, setMinutesUnit,
}: {
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  minutesUnit: MinutesUnit;
  setMinutesUnit: (u: MinutesUnit) => void;
}) {
  function set(field: LogicalField, column: string | null) {
    setMapping({ ...mapping, [field]: column });
  }

  // Sample of the first row for preview
  const sampleRow = parsed.rows[0];

  return (
    <div className="space-y-6">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-900">
        <strong>{parsed.rows.length}</strong> rows · <strong>{parsed.columns.length}</strong> columns detected.
        We've made a best guess at which column means what &mdash; check below and adjust if needed.
      </div>

      <div className="grid grid-cols-1 gap-3">
        {LOGICAL_FIELDS.map(({ key, label, optional }) => {
          const sampleValue = mapping[key] && sampleRow ? sampleRow[mapping[key] as string] : null;
          return (
            <div key={key} className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-3 text-sm">
                <span className="font-medium">{label}</span>
                {optional && <span className="text-zinc-400 text-xs ml-1">optional</span>}
              </div>
              <div className="col-span-4">
                <select
                  value={mapping[key] ?? ""}
                  onChange={(e) => set(key, e.target.value || null)}
                  className="w-full px-2 py-1.5 text-sm border border-zinc-300 rounded-md bg-white"
                >
                  <option value="">— none —</option>
                  {parsed.columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-5 text-xs text-zinc-500 truncate">
                {sampleValue != null ? (
                  <>
                    Sample: <span className="font-mono">{String(sampleValue).slice(0, 60)}</span>
                  </>
                ) : (
                  mapping[key] ? <em>(empty in first row)</em> : null
                )}
              </div>
            </div>
          );
        })}
      </div>

      {mapping.minutes && (
        <div className="grid grid-cols-12 gap-3 items-center pt-3 border-t border-zinc-200">
          <div className="col-span-3 text-sm font-medium">Estimate column units</div>
          <div className="col-span-4">
            <select
              value={minutesUnit}
              onChange={(e) => setMinutesUnit(e.target.value as MinutesUnit)}
              className="w-full px-2 py-1.5 text-sm border border-zinc-300 rounded-md bg-white"
            >
              <option value="minutes">Minutes (90 = 90 mins)</option>
              <option value="hours">Hours (1.5 = 90 mins)</option>
            </select>
          </div>
          <div className="col-span-5 text-xs text-zinc-500">
            Also accepts: "1h 30m", "1:30", decimals.
          </div>
        </div>
      )}

      <div className="text-xs text-zinc-500">
        Your mapping will be saved for next time you import a sheet with these same column headers.
      </div>
    </div>
  );
}

function ResolveStep({
  staged, refs, updateStaged, skipRow,
}: {
  staged: StagedRow[];
  refs: { projects: { id: number; name: string }[]; tasklistsByProject: Map<number, { id: number; name: string }[]>; users: { id: number; name: string }[] };
  updateStaged: (rowIndex: number, patch: Partial<StagedRow>) => void;
  skipRow: (rowIndex: number) => void;
}) {
  const needsAttention = staged.filter((r) => !r.tasklistId || !r.taskName);
  const ready = staged.filter((r) => r.tasklistId && r.taskName);

  return (
    <div className="space-y-4">
      {needsAttention.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-amber-900">
            {needsAttention.length} {needsAttention.length === 1 ? "row needs" : "rows need"} attention
          </h3>
          <div className="space-y-2">
            {needsAttention.map((r) => (
              <RowResolver
                key={r.rowIndex}
                row={r}
                refs={refs}
                onUpdate={(patch) => updateStaged(r.rowIndex, patch)}
                onSkip={() => skipRow(r.rowIndex)}
              />
            ))}
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-green-900">
            {ready.length} {ready.length === 1 ? "row" : "rows"} ready
          </h3>
          <div className="border border-zinc-200 rounded-md max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">Row</th>
                  <th className="px-2 py-1.5 text-left">Task</th>
                  <th className="px-2 py-1.5 text-left">Client</th>
                  <th className="px-2 py-1.5 text-left">Tasklist</th>
                  <th className="px-2 py-1.5 text-left">Assignee</th>
                  <th className="px-2 py-1.5 text-left">Mins</th>
                </tr>
              </thead>
              <tbody>
                {ready.map((r) => {
                  const project = refs.projects.find((p) => p.id === r.projectId);
                  const tasklists = refs.tasklistsByProject.get(r.projectId ?? -1) || [];
                  const tl = tasklists.find((t) => t.id === r.tasklistId);
                  const aNames = r.assigneeUserIds
                    .map((id) => refs.users.find((u) => u.id === id)?.name || `#${id}`)
                    .join(", ");
                  return (
                    <tr key={r.rowIndex} className="border-t border-zinc-100">
                      <td className="px-2 py-1">{r.rowIndex}</td>
                      <td className="px-2 py-1 truncate max-w-xs" title={r.taskName}>{r.taskName}</td>
                      <td className="px-2 py-1 truncate max-w-xs">{project?.name}</td>
                      <td className="px-2 py-1 truncate max-w-xs">{tl?.name}</td>
                      <td className="px-2 py-1 truncate max-w-xs">{aNames || <span className="text-zinc-400">none</span>}</td>
                      <td className="px-2 py-1">{r.minutes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RowResolver({
  row, refs, onUpdate, onSkip,
}: {
  row: StagedRow;
  refs: { projects: { id: number; name: string }[]; tasklistsByProject: Map<number, { id: number; name: string }[]>; users: { id: number; name: string }[] };
  onUpdate: (patch: Partial<StagedRow>) => void;
  onSkip: () => void;
}) {
  // Available tasklists depend on project
  const availableTasklists = row.projectId != null
    ? (refs.tasklistsByProject.get(row.projectId) || [])
    : [];

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs">
          <strong>Row {row.rowIndex}:</strong>{" "}
          {row.taskName || <em className="text-amber-700">no task name</em>}
        </div>
        <button onClick={onSkip} className="text-xs text-zinc-500 underline hover:no-underline">
          Skip row
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <label className="block text-zinc-600 mb-1">Client</label>
          <select
            value={row.projectId ?? ""}
            onChange={(e) => {
              const projectId = e.target.value ? Number(e.target.value) : null;
              onUpdate({ projectId, tasklistId: null });
            }}
            className="w-full px-2 py-1 border border-zinc-300 rounded text-xs bg-white"
          >
            <option value="">— pick —</option>
            {refs.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {row.rawClient && (
            <div className="text-zinc-500 mt-1 truncate" title={row.rawClient}>
              From sheet: {row.rawClient}
            </div>
          )}
        </div>

        <div>
          <label className="block text-zinc-600 mb-1">Tasklist</label>
          <select
            value={row.tasklistId ?? ""}
            onChange={(e) => onUpdate({ tasklistId: e.target.value ? Number(e.target.value) : null })}
            disabled={row.projectId == null}
            className="w-full px-2 py-1 border border-zinc-300 rounded text-xs bg-white disabled:opacity-50"
          >
            <option value="">— pick —</option>
            {availableTasklists.map((tl) => (
              <option key={tl.id} value={tl.id}>{tl.name}</option>
            ))}
          </select>
          {row.rawTasklist && (
            <div className="text-zinc-500 mt-1 truncate" title={row.rawTasklist}>
              From sheet: {row.rawTasklist}
            </div>
          )}
        </div>

        <div>
          <label className="block text-zinc-600 mb-1">Assignee</label>
          <select
            value={row.assigneeUserIds[0] ?? ""}
            onChange={(e) => onUpdate({ assigneeUserIds: e.target.value ? [Number(e.target.value)] : [] })}
            className="w-full px-2 py-1 border border-zinc-300 rounded text-xs bg-white"
          >
            <option value="">— none —</option>
            {refs.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          {row.rawAssignee && (
            <div className="text-zinc-500 mt-1 truncate" title={row.rawAssignee}>
              From sheet: {row.rawAssignee}
            </div>
          )}
        </div>
      </div>

      {row.issues.length > 0 && (
        <div className="text-xs text-amber-800 mt-2">
          ⚠ {row.issues.join(" · ")}
        </div>
      )}
    </div>
  );
}
