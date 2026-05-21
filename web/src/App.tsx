import { useState, useEffect } from "react";
import { isConfigured } from "./lib/config";
import Settings from "./pages/Settings";
import Planner from "./pages/Planner";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    setConfigured(isConfigured());
  }, []);

  function handleSettingsSaved() {
    setConfigured(isConfigured());
    setShowSettings(false);
  }

  if (!configured || showSettings) {
    return <Settings onSaved={handleSettingsSaved} />;
  }

  return <Planner onOpenSettings={() => setShowSettings(true)} />;
}
