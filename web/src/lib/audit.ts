import { lsGet, lsSet } from "./storage";
import type { CreateResult } from "./teamwork";

export type PushRun = {
  id: string;
  sourceMonth: string;
  targetMonth: string;
  total: number;
  successes: number;
  failures: number;
  results: CreateResult[];
  createdAt: string; // ISO
};

const KEY = "mp_runs";
const MAX_RUNS = 20;

export function getRuns(): PushRun[] {
  return lsGet<PushRun[]>(KEY) || [];
}

export function saveRun(run: PushRun): void {
  const existing = getRuns();
  const next = [run, ...existing].slice(0, MAX_RUNS);
  lsSet(KEY, next);
}

export function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
