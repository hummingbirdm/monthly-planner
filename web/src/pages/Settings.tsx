import { useState, useEffect } from "react";
import { setConfig, getStoredConfig, isUnlocked, lock, clearConfig } from "../lib/config";
import { pingTeamwork } from "../lib/teamwork";

export default function Settings({ onSaved }: { onSaved: () => void }) {
  const [twSite, setTwSite] = useState("");
  const [twKey, setTwKey] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; user?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stored = getStoredConfig();
  const hasStored = stored != null;
  const currentlyUnlocked = isUnlocked();

  useEffect(() => {
    if (stored) setTwSite(stored.twSite);
  }, [stored]);

  async function save() {
    setError(null);
    if (password !== passwordConfirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 6) {
      setError("Use a session password of at least 6 characters");
      return;
    }
    setSaving(true);
    try {
      await setConfig(twSite, twKey, password);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setError(null);
    setTestResult(null);
    if (password !== passwordConfirm) {
      setError("Passwords don't match — confirm to test");
      return;
    }
    setTesting(true);
    try {
      // Save (in memory + storage) so the test call has credentials
      await setConfig(twSite, twKey, password);
      const res = await pingTeamwork();
      setTestResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  function handleReset() {
    if (!confirm("This will erase your saved Teamwork details from this browser. Continue?")) return;
    clearConfig();
    setTwSite("");
    setTwKey("");
    setPassword("");
    setPasswordConfirm("");
    setTestResult(null);
    setError(null);
  }

  const canTest = twSite.trim() && twKey.trim() && password && passwordConfirm;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-sm text-zinc-600 mb-6">
        Your Teamwork API key is encrypted in this browser with a session password only you know.
        Nothing readable leaves your machine — even the proxy can't see your key at rest.
      </p>

      {hasStored && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900 mb-6">
          You already have saved details for <strong>{stored?.twSite}</strong>.
          Re-entering below will overwrite them.
          {currentlyUnlocked && (
            <button
              onClick={() => { lock(); onSaved(); }}
              className="ml-2 underline hover:no-underline"
            >
              Lock now
            </button>
          )}
        </div>
      )}

      <div className="space-y-5">
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

        <div className="pt-4 border-t border-zinc-200">
          <h2 className="text-sm font-semibold mb-2">Session password</h2>
          <p className="text-xs text-zinc-500 mb-3">
            Used to encrypt the API key in this browser. You'll enter it each time you open the planner.
            <strong className="text-zinc-700"> If you lose this password, your saved key can't be recovered — you'd just reset and paste in a fresh Teamwork key.</strong>
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Session password"
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
          />
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            placeholder="Confirm session password"
            className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="p-3 rounded-md text-sm bg-red-50 text-red-900 border border-red-200">
            {error}
          </div>
        )}

        {testResult && (
          <div className={`p-3 rounded-md text-sm ${testResult.ok ? "bg-green-50 text-green-900 border border-green-200" : "bg-red-50 text-red-900 border border-red-200"}`}>
            {testResult.ok ? (
              <>✓ Connection works. Logged in as <strong>{testResult.user}</strong>.</>
            ) : (
              <>✗ {testResult.message}</>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={test}
            disabled={!canTest || testing || saving}
            className="px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={save}
            disabled={!canTest || saving}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
          {hasStored && (
            <button
              onClick={handleReset}
              className="ml-auto text-xs text-zinc-500 underline hover:no-underline"
            >
              Reset / forget details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
