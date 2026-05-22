// Config + session management.
//
// At rest: only the Teamwork site (which is non-secret — it's basically
// a hostname like company.teamwork.com) and an encrypted blob containing
// the API key are stored in localStorage. The blob can't be decrypted
// without the user's session password.
//
// At runtime: the decrypted Teamwork key lives in a module-level
// variable here. It's never written to disk. Auto-lock clears it after
// a period of inactivity.

import { lsGet, lsSet, lsRemove } from "./storage";
import { encryptString, decryptString } from "./crypto";

// Persisted state — safe to store in localStorage
export type StoredConfig = {
  twSite: string;
  twKeyEncrypted: string; // base64 blob from encryptString()
};

// Runtime state — only in memory
type UnlockedState = {
  twSite: string;
  twKey: string;
};

const KEY = "mp_config";
const IDLE_LOCK_MS = 30 * 60 * 1000; // 30 minutes

let unlocked: UnlockedState | null = null;
let lastActivity = Date.now();
let lockListeners: Array<() => void> = [];

// Read raw stored config — returns null if not configured.
export function getStoredConfig(): StoredConfig | null {
  const c = lsGet<StoredConfig>(KEY);
  if (!c || !c.twSite || !c.twKeyEncrypted) return null;
  return c;
}

// Has the user completed initial setup?
export function isConfigured(): boolean {
  return getStoredConfig() != null;
}

// Is the app currently unlocked (decrypted key in memory)?
export function isUnlocked(): boolean {
  if (!unlocked) return false;
  // Auto-lock if idle
  if (Date.now() - lastActivity > IDLE_LOCK_MS) {
    lock();
    return false;
  }
  return true;
}

// Notify activity so we don't auto-lock during use
export function touch(): void {
  lastActivity = Date.now();
}

// Subscribe to lock events (so the UI can re-render)
export function onLockChange(cb: () => void): () => void {
  lockListeners.push(cb);
  return () => {
    lockListeners = lockListeners.filter((x) => x !== cb);
  };
}

function notifyLockChange() {
  lockListeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

// Encrypt and persist a new config. Used on first setup or when the
// user changes their key or password.
export async function setConfig(
  twSite: string,
  twKey: string,
  password: string,
): Promise<void> {
  const cleanSite = twSite.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const cleanKey = twKey.trim();
  if (!cleanSite || !cleanKey || !password) {
    throw new Error("twSite, twKey and password are all required");
  }
  const twKeyEncrypted = await encryptString(cleanKey, password);
  const stored: StoredConfig = { twSite: cleanSite, twKeyEncrypted };
  lsSet(KEY, stored);
  // Set runtime state too so the user doesn't have to immediately re-unlock
  unlocked = { twSite: cleanSite, twKey: cleanKey };
  lastActivity = Date.now();
  notifyLockChange();
}

// Attempt to decrypt the stored config with the given password.
// Returns true on success, false on wrong password.
export async function unlock(password: string): Promise<boolean> {
  const stored = getStoredConfig();
  if (!stored) throw new Error("Not configured");
  try {
    const twKey = await decryptString(stored.twKeyEncrypted, password);
    unlocked = { twSite: stored.twSite, twKey };
    lastActivity = Date.now();
    notifyLockChange();
    return true;
  } catch {
    return false;
  }
}

// Clear decrypted state from memory. localStorage is unaffected.
export function lock(): void {
  unlocked = null;
  notifyLockChange();
}

// Forget everything — wipes localStorage. Used when user wants to
// reset / start over.
export function clearConfig(): void {
  unlocked = null;
  lsRemove(KEY);
  notifyLockChange();
}

// Read the current unlocked state. Throws if locked.
export function requireUnlocked(): UnlockedState {
  if (!isUnlocked() || !unlocked) {
    throw new Error("Locked — enter your session password to unlock");
  }
  touch();
  return unlocked;
}
