// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly. The SQL
// home for Focus mode (LOG-05 surfacing/resolution, FOCUS-04 selection/order):
// a one-time ordered snapshot of who to call next, and the follow-up resolution
// the "Speichern & weiter" log routes through (D-04). The view stays pure
// presentation — it receives the snapshot and never touches a query.
import { db } from "../db/client";
import { firmen, followups, interaktionen } from "../db/schema";
import { eq, and, isNull, lte } from "drizzle-orm";
import type { Company } from "./companies";
import { DEAD } from "./filterSort";
import type { Status } from "../types";
import { daysOverdue } from "../utils/date";

// The serve-order reason for a focus company (D-02): a due/overdue follow-up
// outranks 🔥 hot, which outranks a never-contacted Neu.
export type FocusReason = "followup" | "hot" | "neu";

// A company in the focus stream, tagged with WHY it surfaced. daysOverdue is the
// count for "seit X Tagen"/"heute fällig" — non-null only when reason is
// "followup" (0 = due today, >0 = overdue days).
export type FocusCompany = Company & {
  reason: FocusReason;
  daysOverdue: number | null;
};

/**
 * The one-time ordered curated call stream (D-01/D-02/FOCUS-04). Called once
 * when Focus opens (D-07) — never re-queried mid-session.
 *
 * Qualification (D-01): Tot/Geparkt are always excluded. A company surfaces when
 * it has a due/overdue OPEN follow-up (faellig_am <= today, erledigt=false) ->
 * "followup"; else if 🔥 hot -> "hot"; else if it has ZERO interactions (Neu by
 * RESEARCH A5, not status === "Neu") -> "neu"; otherwise it is excluded.
 *
 * Order (D-02): due (most-overdue first, German-alpha name tiebreak) -> hot
 * (German-alpha) -> neu (German-alpha). A company that is BOTH hot AND due ranks
 * in the due group.
 *
 * Reads are plain sequential awaited SELECTs (no transaction needed for reads;
 * the no-proxy-transaction rule that binds the writes lives on resolveDueFollowups).
 */
export async function getFocusSnapshot(
  now: Date = new Date(),
): Promise<FocusCompany[]> {
  // 1. Candidate sets — sequential awaited single SELECTs.
  const companies = await db
    .select()
    .from(firmen)
    .where(isNull(firmen.deleted_at)); // mirror listCompanies: skip soft-deleted
  const openFollowups = await db
    .select()
    .from(followups)
    .where(eq(followups.erledigt, false));
  const interactionRows = await db
    .select({ firma_id: interaktionen.firma_id })
    .from(interaktionen);
  const contacted = new Set(interactionRows.map((r) => r.firma_id));

  // 2. Max non-negative daysOverdue per firma over its open follow-ups (date-only
  //    UTC via the shared helper; >= 0 means due/overdue, < 0 means future).
  const dueDaysByFirma = new Map<string, number>();
  for (const f of openFollowups) {
    const overdue = daysOverdue(f.faellig_am, now);
    if (overdue < 0) continue; // future-dated → not due
    const prev = dueDaysByFirma.get(f.firma_id);
    if (prev === undefined || overdue > prev) {
      dueDaysByFirma.set(f.firma_id, overdue);
    }
  }

  // 3. Qualify (D-01) into the three serve groups.
  const due: FocusCompany[] = [];
  const hot: FocusCompany[] = [];
  const neu: FocusCompany[] = [];
  for (const c of companies) {
    if (DEAD.has(c.status as Status)) continue; // never Tot/Geparkt
    const overdue = dueDaysByFirma.get(c.id);
    if (overdue !== undefined) {
      // due group even if also hot (D-02: hot+due ranks in due)
      due.push({ ...c, reason: "followup", daysOverdue: overdue });
    } else if (c.heiss) {
      hot.push({ ...c, reason: "hot", daysOverdue: null });
    } else if (!contacted.has(c.id)) {
      neu.push({ ...c, reason: "neu", daysOverdue: null }); // zero interactions
    }
    // else: Offen/Im Gespräch, no due follow-up, not hot → excluded (D-01)
  }

  // 4. Order (D-02). German-locale alpha mirrors filterSort.sortCompanies' collation.
  const byName = (a: Company, b: Company) => a.name.localeCompare(b.name, "de");
  due.sort(
    (a, b) => b.daysOverdue! - a.daysOverdue! || byName(a, b), // most-overdue first
  );
  hot.sort(byName);
  neu.sort(byName);

  return [...due, ...hot, ...neu];
}

/**
 * Mark every currently-due OPEN follow-up for a firma erledigt=true (D-04 —
 * "logging a call resolves the follow-up"). This is the resolution side of the
 * "Speichern & weiter" path: logInteraction already inserts the NEW (future-
 * dated) follow-up, and this then closes only the due (<= end-of-today) ones, so
 * the freshly-set follow-up survives (Pitfall 4 / D-04).
 *
 * Single parameterized statement — drizzle builds the WHERE from eq/and/lte (no
 * string-built SQL). It runs as one UPDATE on the shared db handle, which the
 * sqlx-backed plugin autocommits on its own; wrapping it in a multi-statement
 * proxy transaction would split begin/commit across pooled connections and
 * silently fail to persist in the real Tauri app (see interactions.ts:16-35).
 */
export async function resolveDueFollowups(
  firmaId: string,
  now: Date = new Date(),
): Promise<void> {
  // End-of-today UTC bound: a midnight-UTC "today" follow-up resolves, a future
  // one does not (Pitfall 4). Built with Date.UTC so the local offset never
  // shifts the day on a European UTC+1/+2 machine.
  const endOfTodayUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  ).toISOString();

  await db
    .update(followups)
    .set({ erledigt: true })
    .where(
      and(
        eq(followups.firma_id, firmaId),
        eq(followups.erledigt, false),
        lte(followups.faellig_am, endOfTodayUtc),
      ),
    );
}
