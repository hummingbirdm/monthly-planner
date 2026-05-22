import { useState } from "react";
import { unlock, getStoredConfig, clearConfig } from "../lib/config";

export default function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [trying, setTrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = getStoredConfig();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setTrying(true);
    setError(null);
    try {
      const ok = await unlock(password);
      if (!ok) {
        setError("Incorrect password");
        setPassword("");
      } else {
        onUnlocked();
      }
    } finally {
      setTrying(false);
    }
  }

  function handleReset() {
    if (!confirm("Forget saved details and start over? You'll need to re-enter your Teamwork key.")) return;
    clearConfig();
    onUnlocked();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-1">Monthly Planner</h1>
          <p className="text-sm text-zinc-600">
            Enter your session password to unlock
          </p>
          {stored && (
            <p className="text-xs text-zinc-500 mt-2">
              {stored.twSite}
            </p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Session password"
            className="w-full px-3 py-2.5 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {error && (
            <div className="p-2.5 rounded-md text-sm bg-red-50 text-red-900 border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!password || trying}
            className="w-full px-4 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {trying ? "Unlocking…" : "Unlock"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={handleReset}
            className="text-xs text-zinc-500 underline hover:no-underline"
          >
            Forgot password — start over
          </button>
        </div>
      </div>
    </div>
  );
}
