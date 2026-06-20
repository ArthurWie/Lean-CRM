// Shared date display helpers. Stored ISO timestamps are UTC; display helpers
// MUST read UTC fields (getUTC*) so a non-zero local offset never shifts the
// rendered day/month. Arthur runs this on a European (UTC+1/+2) machine, where
// local getters would render midnight-UTC timestamps as the prior day.

// "2026-06-09T08:00:00Z" → "09.06." (Notizen column + history line date shape).
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.`;
}

// Whole-day difference between today and a stored follow-up timestamp, DATE-ONLY
// in UTC. Both the stored ISO and `now` are floored to their UTC calendar day
// (Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)) before subtracting, so a
// non-zero local offset never shifts the day boundary on Arthur's UTC+1/+2
// machine (Pitfall 3 — the same UTC-only rule shortDate follows above).
//   0  = "heute fällig" (due today)
//   >0 = overdue days
//   <0 = future (caller treats <0 as not-due)
export function daysOverdue(iso: string, now: Date = new Date()): number {
  const due = new Date(iso);
  const dueUtc = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((todayUtc - dueUtc) / 86_400_000);
}
