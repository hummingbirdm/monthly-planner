// Spreadsheet import. Takes CSV/XLSX bytes or a Google Sheets URL,
// parses into rows, then maps user-chosen columns onto Teamwork
// fields (client, tasklist, task, assignee, minutes, dates).
//
// Matching strategy:
//   - exact (case-insensitive trim) wins
//   - else "contains" / substring
//   - else "starts with" for assignee first names
// Anything ambiguous or unmatched is surfaced to the user via the
// resolution UI; nothing is silently guessed.

// XLSX is heavy (~700kb) so we load it on demand the first time the
// user actually imports something
let _xlsx: typeof import("xlsx") | null = null;
async function getXlsx() {
  if (!_xlsx) {
    _xlsx = await import("xlsx");
  }
  return _xlsx;
}

export type RawRow = Record<string, string | number | null>;

export type ParsedSheet = {
  columns: string[];      // header names, in order
  rows: RawRow[];         // one object per data row
};

// Logical fields we need to fill on each task
export type LogicalField =
  | "client"
  | "tasklist"
  | "task"
  | "assignee"
  | "minutes"
  | "startDate"
  | "dueDate";

// User's mapping from logical field → spreadsheet column name (or null if unmapped)
export type ColumnMapping = Record<LogicalField, string | null>;

// Unit for the minutes column
export type MinutesUnit = "minutes" | "hours";

export type ImportOptions = {
  mapping: ColumnMapping;
  minutesUnit: MinutesUnit;
  mode: "replace" | "merge";
};

// What we get out the other end of the matching pass
export type StagedRow = {
  rowIndex: number;            // 1-based for user display
  rawClient: string;
  rawTasklist: string;
  rawAssignee: string;
  taskName: string;
  minutes: number;
  startDate: string | null;
  dueDate: string | null;

  // Resolved IDs (null = unresolved, needs user input)
  projectId: number | null;
  tasklistId: number | null;
  assigneeUserIds: number[];   // [] = unresolved

  // Surfaces for the resolution UI
  projectOptions?: { id: number; name: string }[];
  tasklistOptions?: { id: number; name: string }[];
  assigneeOptions?: { id: number; name: string }[];

  issues: string[]; // human-readable issues e.g. "no client column", "invalid date"
};

// ========== Parsing ==========

export async function parseFile(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  return parseBuffer(buf, file.name);
}

export async function parseBuffer(buf: ArrayBuffer, filename: string): Promise<ParsedSheet> {
  const XLSX = await getXlsx();
  // SheetJS handles xlsx, xls, csv all through the same read()
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error("Empty workbook");
  const sheet = wb.Sheets[firstSheetName];

  // header: 1 returns array-of-arrays with the first row as headers
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: false });
  if (aoa.length === 0) throw new Error("No rows found");

  // Find the header row — usually row 0, but handle the case where there
  // are leading blank rows (common in human-edited spreadsheets)
  let headerRowIdx = 0;
  while (
    headerRowIdx < aoa.length &&
    aoa[headerRowIdx].every((v: any) => v == null || String(v).trim() === "")
  ) {
    headerRowIdx += 1;
  }
  if (headerRowIdx >= aoa.length) throw new Error("No header row found");

  const headers = (aoa[headerRowIdx] as any[]).map((v, i) => {
    const s = v == null ? "" : String(v).trim();
    return s || `Column ${i + 1}`;
  });

  // Convert remaining rows into objects keyed by header
  const rows: RawRow[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] as any[];
    if (!row || row.every((v: any) => v == null || String(v).trim() === "")) continue;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      const v = row[c];
      obj[headers[c]] = v == null ? null : (typeof v === "number" ? v : String(v));
    }
    rows.push(obj);
  }

  return { columns: headers, rows };
}

// Fetch a Google Sheets URL as CSV. Only works for sheets that are either:
//   - Published to the web (File → Share → Publish to web → CSV)
//   - Shared "anyone with link can view"
// We rewrite the URL to the CSV export endpoint, which respects either of
// those sharing modes.
export async function fetchGoogleSheet(url: string): Promise<ParsedSheet> {
  const csvUrl = toGoogleCsvUrl(url);
  if (!csvUrl) {
    throw new Error("Not a recognised Google Sheets URL. Use a normal sheet URL like https://docs.google.com/spreadsheets/d/SHEET_ID/edit");
  }
  const resp = await fetch(csvUrl);
  if (!resp.ok) {
    throw new Error(
      `Couldn't fetch sheet (${resp.status}). Make sure the sheet is shared as "Anyone with the link can view" or published to the web.`,
    );
  }
  const buf = await resp.arrayBuffer();
  return await parseBuffer(buf, "google-sheet.csv");
}

function toGoogleCsvUrl(url: string): string | null {
  // Match /spreadsheets/d/{SHEET_ID}/...
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const sheetId = m[1];
  // Try to capture a gid if it's in the URL (so we get the right tab)
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

// ========== Auto-mapping ==========

// Guess which spreadsheet column matches each logical field, based on
// common header names. User can override anything before importing.
export function autoGuessMapping(columns: string[]): ColumnMapping {
  const lower = columns.map((c) => c.toLowerCase().trim());
  const find = (...candidates: string[]): string | null => {
    for (const cand of candidates) {
      const idx = lower.findIndex((c) => c === cand);
      if (idx !== -1) return columns[idx];
    }
    // Fallback: substring match
    for (const cand of candidates) {
      const idx = lower.findIndex((c) => c.includes(cand));
      if (idx !== -1) return columns[idx];
    }
    return null;
  };

  return {
    client: find("client", "project", "account", "customer", "company"),
    tasklist: find("tasklist", "task list", "list", "service", "category", "workstream"),
    task: find("task", "task name", "title", "activity", "description", "work"),
    assignee: find("assignee", "owner", "responsible", "person", "who", "lead", "user"),
    minutes: find("minutes", "mins", "time", "hours", "hrs", "estimate", "estimated"),
    startDate: find("start", "start date", "from", "begin"),
    dueDate: find("due", "due date", "end date", "deadline", "to", "end"),
  };
}

// ========== Matching against Teamwork data ==========

type MatchRef = { id: number; name: string };

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Given a search term, find matches in the haystack.
// Returns 0, 1, or several candidates. Caller decides what to do.
function fuzzyFind(needle: string, haystack: MatchRef[]): {
  exact: MatchRef[];
  fuzzy: MatchRef[];
} {
  const n = normalise(needle);
  if (!n) return { exact: [], fuzzy: [] };
  const exact: MatchRef[] = [];
  const fuzzy: MatchRef[] = [];
  for (const h of haystack) {
    const hn = normalise(h.name);
    if (hn === n) exact.push(h);
    else if (hn.includes(n) || n.includes(hn)) fuzzy.push(h);
  }
  return { exact, fuzzy };
}

// Parse a value that might be hours-as-decimal, hours-as-string ("1.5"),
// or minutes ("90"), depending on the user's choice
function parseMinutes(raw: any, unit: MinutesUnit): number {
  if (raw == null) return 0;
  // Allow strings like "1h 30m", "1:30", "1.5h"
  const s = String(raw).trim().toLowerCase();
  if (!s) return 0;
  // h/m format
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s+(\d+)\s*m)?$/);
  if (hm) {
    return Math.round(Number(hm[1]) * 60 + Number(hm[2] || 0));
  }
  // colon format
  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    return Number(colon[1]) * 60 + Number(colon[2]);
  }
  // plain number
  const n = Number(s);
  if (isNaN(n)) return 0;
  return unit === "hours" ? Math.round(n * 60) : Math.round(n);
}

// Try hard to coerce arbitrary date-looking strings into YYYY-MM-DD
function parseDate(raw: any): string | null {
  if (raw == null) return null;
  // SheetJS might give us a Date object or a number (Excel serial)
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") {
    // Excel serial: days since 1899-12-30
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ISO YYYY-MM-DD already?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY (UK style, what we should default to given user is UK)
  const uk = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (uk) {
    const day = Number(uk[1]);
    const month = Number(uk[2]);
    let year = Number(uk[3]);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  // Fallback: let Date constructor have a go
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export type TeamworkRefs = {
  projects: MatchRef[];
  tasklistsByProject: Map<number, MatchRef[]>;
  users: MatchRef[]; // name is "firstName lastName"
};

export function buildTeamworkRefs(
  projects: { id: number; name: string }[],
  tasklists: { id: number; name: string; projectId: number }[],
  users: { id: number; firstName?: string; lastName?: string }[],
): TeamworkRefs {
  const projRefs: MatchRef[] = projects.map((p) => ({ id: p.id, name: p.name }));
  const tlByProj = new Map<number, MatchRef[]>();
  for (const tl of tasklists) {
    const arr = tlByProj.get(tl.projectId) || [];
    arr.push({ id: tl.id, name: tl.name });
    tlByProj.set(tl.projectId, arr);
  }
  const userRefs: MatchRef[] = users.map((u) => ({
    id: u.id,
    name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || `User ${u.id}`,
  }));
  return { projects: projRefs, tasklistsByProject: tlByProj, users: userRefs };
}

// Main entrypoint: take parsed rows + user mapping + Teamwork refs,
// return one StagedRow per spreadsheet row with as much resolved as possible
export function stageRows(
  parsed: ParsedSheet,
  opts: ImportOptions,
  refs: TeamworkRefs,
): StagedRow[] {
  const m = opts.mapping;
  const staged: StagedRow[] = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const issues: string[] = [];

    const rawClient = m.client ? String(row[m.client] ?? "").trim() : "";
    const rawTasklist = m.tasklist ? String(row[m.tasklist] ?? "").trim() : "";
    const rawAssignee = m.assignee ? String(row[m.assignee] ?? "").trim() : "";
    const taskName = m.task ? String(row[m.task] ?? "").trim() : "";
    const minutes = m.minutes ? parseMinutes(row[m.minutes], opts.minutesUnit) : 0;
    const startDate = m.startDate ? parseDate(row[m.startDate]) : null;
    const dueDate = m.dueDate ? parseDate(row[m.dueDate]) : null;

    if (!taskName) issues.push("missing task name");
    if (m.startDate && !startDate && row[m.startDate]) issues.push("invalid start date");
    if (m.dueDate && !dueDate && row[m.dueDate]) issues.push("invalid due date");

    // Project resolution
    let projectId: number | null = null;
    let projectOptions: MatchRef[] | undefined;
    if (rawClient) {
      const r = fuzzyFind(rawClient, refs.projects);
      if (r.exact.length === 1) projectId = r.exact[0].id;
      else if (r.exact.length > 1) projectOptions = r.exact;
      else if (r.fuzzy.length === 1) projectId = r.fuzzy[0].id;
      else if (r.fuzzy.length > 1) projectOptions = r.fuzzy;
      else {
        projectOptions = refs.projects;
        issues.push(`no project match for "${rawClient}"`);
      }
    } else {
      issues.push("missing client");
    }

    // Tasklist resolution — only meaningful once we have a project
    let tasklistId: number | null = null;
    let tasklistOptions: MatchRef[] | undefined;
    if (projectId != null) {
      const candidates = refs.tasklistsByProject.get(projectId) || [];
      if (rawTasklist) {
        const r = fuzzyFind(rawTasklist, candidates);
        if (r.exact.length === 1) tasklistId = r.exact[0].id;
        else if (r.fuzzy.length === 1) tasklistId = r.fuzzy[0].id;
        else if (candidates.length > 0) {
          tasklistOptions = candidates;
          issues.push(`pick a tasklist`);
        } else {
          issues.push(`no tasklists in project`);
        }
      } else if (candidates.length === 1) {
        tasklistId = candidates[0].id;
      } else if (candidates.length > 1) {
        tasklistOptions = candidates;
        issues.push("pick a tasklist");
      }
    }

    // Assignee resolution
    let assigneeUserIds: number[] = [];
    let assigneeOptions: MatchRef[] | undefined;
    if (rawAssignee) {
      // Split on common separators in case of multi-assignee cells
      const names = rawAssignee.split(/[,;\/&]|\sand\s/i).map((n) => n.trim()).filter(Boolean);
      const resolved: number[] = [];
      let anyMissed = false;
      for (const name of names) {
        const r = fuzzyFind(name, refs.users);
        if (r.exact.length === 1) resolved.push(r.exact[0].id);
        else if (r.fuzzy.length === 1) resolved.push(r.fuzzy[0].id);
        else {
          anyMissed = true;
          break;
        }
      }
      if (!anyMissed && resolved.length > 0) {
        assigneeUserIds = resolved;
      } else {
        assigneeOptions = refs.users;
        issues.push(`pick assignee for "${rawAssignee}"`);
      }
    }

    staged.push({
      rowIndex: i + 1,
      rawClient,
      rawTasklist,
      rawAssignee,
      taskName,
      minutes,
      startDate,
      dueDate,
      projectId,
      tasklistId,
      assigneeUserIds,
      projectOptions,
      tasklistOptions,
      assigneeOptions,
      issues,
    });
  }

  return staged;
}
