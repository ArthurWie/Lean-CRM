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
