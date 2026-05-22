// Tiny localStorage wrapper with JSON serialisation and safe parsing.
// Used for config, draft edits, and audit log — everything that
// would be in Supabase if we had a server.

export function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function lsSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — silently ignore. The UI
    // already works with in-memory state for the current session.
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // see lsSet
  }
}
