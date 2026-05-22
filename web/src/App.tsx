import { useState, useEffect } from "react";
import { isConfigured, isUnlocked, onLockChange, touch } from "./lib/config";
import Settings from "./pages/Settings";
import UnlockScreen from "./pages/UnlockScreen";
import Planner from "./pages/Planner";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Sync state from the config module
  useEffect(() => {
    function refresh() {
      setConfigured(isConfigured());
      setUnlocked(isUnlocked());
    }
    refresh();
    const off = onLockChange(refresh);
    return off;
  }, []);

  // Touch on any user activity so we don't auto-lock during use
  useEffect(() => {
    if (!unlocked) return;
    function onActivity() { touch(); }
    window.addEventListener("mousedown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [unlocked]);

  // Periodic check for auto-lock (re-reads isUnlocked which auto-locks
  // if idle past threshold)
  useEffect(() => {
    const t = setInterval(() => {
      setUnlocked(isUnlocked());
    }, 60_000); // every minute
    return () => clearInterval(t);
  }, []);

  // First-time setup OR user explicitly opened Settings
  if (!configured || showSettings) {
    return <Settings onSaved={() => { setShowSettings(false); }} />;
  }

  // Configured but locked — prompt for password
  if (!unlocked) {
    return <UnlockScreen onUnlocked={() => setUnlocked(isUnlocked())} />;
  }

  // Normal operation
  return <Planner onOpenSettings={() => setShowSettings(true)} />;
}
