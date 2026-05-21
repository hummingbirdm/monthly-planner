import { useState } from "react";
import type { PushRun } from "../lib/audit";
import { monthLabel } from "../lib/dates";

export default function RecentRuns({
  runs, onSelect,
}: {
  runs: PushRun[];
  onSelect: (run: PushRun) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (runs.length === 0) return null;

  return (
    <div className="max-w-7xl mx-auto px-6 mt-4">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="text-xs text-zinc-600 hover:text-zinc-900"
      >
        {expanded ? "▼" : "▶"} Recent pushes ({runs.length})
      </button>
      {expanded && (
        <div className="mt-2 border border-zinc-200 rounded-md bg-white divide-y divide-zinc-100">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-zinc-50 text-left"
            >
              <div>
                <span className="font-medium">{monthLabel(r.sourceMonth)} → {monthLabel(r.targetMonth)}</span>
                <span className="text-xs text-zinc-500 ml-3">
                  {new Date(r.createdAt).toLocaleString("en-GB")}
                </span>
              </div>
              <div className="text-xs">
                <span className="text-green-700">{r.successes} created</span>
                {r.failures > 0 && <span className="text-red-700 ml-2">{r.failures} failed</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
