import { useState, useEffect } from "react";
import { getConfig, setConfig, type Config } from "../lib/config";
import { pingTeamwork } from "../lib/teamwork";

export default function Settings({ onSaved }: { onSaved: () => void }) {
  const [twSite, setTwSite] = useState("");
  const [twKey, setTwKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; user?: string } | null>(null);

  useEffect(() => {
    const c = getConfig();
    if (c) {
      setTwSite(c.twSite);
      setTwKey(c.twKey);
    }
  }, []);

  function save() {
    const config: Config = {
      twSite: twSite.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
      twKey: twKey.trim(),
    };
    setConfig(config);
    onSaved();
  }

  async function test() {
    setConfig({
      twSite: twSite.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
      twKey: twKey.trim(),
    });
    setTesting(true);
    setTestResult(null);
    const res = await pingTeamwork();
    setTestResult(res);
    setTesting(false);
  }

  const canTest = twSite.trim() && twKey.trim();

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-sm text-zinc-600 mb-8">
        Your Teamwork details stay in your browser. Nothing is stored on any server.
      </p>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1.5">Teamwork site</label>
          <input
            type="text"
            value={twSite}
            onChange={(e) => setTwSite(e.target.value)}
            placeholder="yourcompany.teamwork.com"
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Your Teamwork hostname &mdash; no <span className="font-mono">https://</span> prefix.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Teamwork API key</label>
          <input
            type="password"
            value={twKey}
            onChange={(e) => setTwKey(e.target.value)}
            placeholder="twp_..."
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Teamwork &rarr; your profile &rarr; Edit my details &rarr; API &amp; Mobile &rarr; API Keys
          </p>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t border-zinc-200">
          <button
            onClick={test}
            disabled={!canTest || testing}
            className="px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={save}
            disabled={!canTest}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save &amp; continue
          </button>
        </div>

        {testResult && (
          <div className={`p-3 rounded-md text-sm ${testResult.ok ? "bg-green-50 text-green-900 border border-green-200" : "bg-red-50 text-red-900 border border-red-200"}`}>
            {testResult.ok ? (
              <>✓ Connection works. Logged in as <strong>{testResult.user}</strong>.</>
            ) : (
              <>✗ {testResult.message}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
