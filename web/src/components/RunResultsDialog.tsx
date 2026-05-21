import type { PushRun } from "../lib/audit";
import { monthLabel } from "../lib/dates";

export default function RunResultsDialog({
  run, onClose,
}: {
  run: PushRun;
  onClose: () => void;
}) {
  const failures = run.results.filter((r) => !r.ok);
  const successes = run.results.filter((r) => r.ok);

  function downloadFailuresCsv() {
    const rows = ["Task name,Error"];
    failures.forEach((f) => {
      if (!f.ok) {
        const name = (f.name || "").replace(/"/g, '""');
        const error = (f.error || "").replace(/"/g, '""');
        rows.push(`"${name}","${error}"`);
      }
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monthly-planner-failures-${run.targetMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">
            Push results · {monthLabel(run.targetMonth)}
          </h2>
          <p className="text-sm text-zinc-600 mt-1">
            <span className="text-green-700">✓ {run.successes} created</span>
            {run.failures > 0 && <span className="text-red-700 ml-3">✗ {run.failures} failed</span>}
            <span className="text-zinc-500 ml-3">
              · {new Date(run.createdAt).toLocaleString("en-GB")}
            </span>
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {failures.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-red-900 mb-2">Failures</h3>
              <div className="border border-red-200 rounded-md divide-y divide-red-100">
                {failures.map((f, i) => (
                  f.ok ? null : (
                    <div key={i} className="px-3 py-2 text-sm">
                      <div className="font-medium">{f.name || <em className="text-zinc-500">(no name)</em>}</div>
                      <div className="text-xs text-red-700 mt-0.5">{f.error}</div>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {successes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-900 mb-2">Created</h3>
              <div className="border border-zinc-200 rounded-md divide-y divide-zinc-100 max-h-64 overflow-y-auto">
                {successes.map((s, i) => (
                  s.ok ? (
                    <div key={i} className="px-3 py-1.5 text-sm flex items-center justify-between">
                      <span>{s.name}</span>
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View ↗
                        </a>
                      )}
                    </div>
                  ) : null
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-between items-center">
          {failures.length > 0 && (
            <button
              onClick={downloadFailuresCsv}
              className="text-sm text-zinc-700 underline hover:no-underline"
            >
              Download failures CSV
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
