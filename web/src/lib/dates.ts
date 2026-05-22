// Date math for monthly planning. All "months" are strings like
// "2026-06" (ISO yyyy-mm). All dates are YYYY-MM-DD strings.

export function isoMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function thisMonth(): string {
  return isoMonth(new Date());
}

export function nextMonth(month?: string): string {
  const base = month ? new Date(month + "-01T00:00:00") : new Date();
  base.setMonth(base.getMonth() + 1);
  return isoMonth(base);
}

export function prevMonth(month?: string): string {
  const base = month ? new Date(month + "-01T00:00:00") : new Date();
  base.setMonth(base.getMonth() - 1);
  return isoMonth(base);
}

export function monthLabel(month: string): string {
  const d = new Date(month + "-01T00:00:00");
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export function monthStartEnd(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0); // day 0 of next month = last day of this month
  return { start: isoDate(start), end: isoDate(end) };
}

// Shift a date from one month to another, keeping the day of month
// where possible. e.g. 2026-05-15 shifted to 2026-06 → 2026-06-15.
// If the source day doesn't exist in the target month (e.g. 31 May →
// June), clamp to last day of target month.
export function shiftDateToMonth(
  date: string | null,
  fromMonth: string,
  toMonth: string,
): string | null {
  if (!date) return null;
  const [, , dayStr] = date.split("-");
  if (!dayStr) return null;
  const day = Number(dayStr);
  const [ty, tm] = toMonth.split("-").map(Number);
  // Last day of target month
  const lastDay = new Date(ty, tm, 0).getDate();
  const clamped = Math.min(day, lastDay);
  return `${ty}-${String(tm).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
