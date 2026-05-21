import { lsGet, lsSet, lsRemove } from "./storage";

export type Config = {
  twSite: string;
  twKey: string;
};

const KEY = "mp_config";

export function getConfig(): Config | null {
  const c = lsGet<Config>(KEY);
  if (!c || !c.twSite || !c.twKey) return null;
  return c;
}

export function setConfig(c: Config): void {
  lsSet(KEY, c);
}

export function clearConfig(): void {
  lsRemove(KEY);
}

export function isConfigured(): boolean {
  return getConfig() != null;
}
