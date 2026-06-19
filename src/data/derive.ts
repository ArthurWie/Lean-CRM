// Pure derivation (DATA-05 / LOG-04 / DB-05 / D-01..D-08).
//
// Every derived value the app reads — Status, Nächster Schritt, the newest dated
// note, and the "new since last viewed" flag — is a PURE function of the interaction
// set (+ the manual Tot/Geparkt override, D-02). D-06: these are never stored as
// independently-editable values; they are always recomputed, so an edit/delete of a
// past interaction simply re-runs these functions.
//
// DATA-02 purity: this module imports ONLY from "../types". It must NEVER import
// drizzle-orm, ../db/client, or ../db/schema — it builds no SQL. The structural
// `DerivableInteraction` input type below avoids depending on the drizzle row type.
import type { ManualOverride, Status, DerivedNote } from "../types";

// Structural shape of the fields derivation reads from an interaktionen row.
// Kept local + structural so derive.ts never imports the schema (purity gate).
export type DerivableInteraction = {
  datum: string;
  kanal: string | null;
  outcome: string | null;
  notiz: string | null;
  bearbeiter: string;
};

// --- Locked outcome → status maps (lookup-table-over-union, per CompanyTable.tsx) ---

// D-01 (locked): Telefon outcome → status.
const TELEFON_STATUS: Record<string, Status> = {
  Gesprochen: "Im Gespräch",
  "Nicht erreicht": "Offen",
  "Rückruf vereinbart": "Offen",
  Warteschlange: "Offen",
  "Termin vereinbart": "Termin",
  "Kein Interesse": "Kein Interesse",
};

// Resolved at planning (CONTEXT lines 86-89): E-Mail outcome → status.
const EMAIL_STATUS: Record<string, Status> = {
  Gesendet: "Offen",
  "Antwort erhalten": "Im Gespräch",
  "Keine Antwort": "Offen",
  "Termin vereinbart": "Termin",
  "Kein Interesse": "Kein Interesse",
};

// Resolved at planning (CONTEXT lines 86-89): LinkedIn outcome → status.
const LINKEDIN_STATUS: Record<string, Status> = {
  "Anfrage gesendet": "Offen",
  Angenommen: "Offen",
  "Nachricht gesendet": "Offen",
  "Antwort erhalten": "Im Gespräch",
  "Kein Interesse": "Kein Interesse",
};

// Dispatch by channel → the right outcome→status table.
const OUTCOME_STATUS: Record<string, Record<string, Status>> = {
  Telefon: TELEFON_STATUS,
  "E-Mail": EMAIL_STATUS,
  LinkedIn: LINKEDIN_STATUS,
};

// D-04 (locked): outcome → Nächster-Schritt label.
const NEXT_STEP: Record<string, string> = {
  Gesprochen: "nachfassen",
  "Nicht erreicht": "nochmal anrufen",
  "Rückruf vereinbart": "Rückruf",
  Warteschlange: "später nochmal",
  "Termin vereinbart": "Termin vorbereiten",
  "Kein Interesse": "—",
  Gesendet: "nachfassen",
  "Antwort erhalten": "antworten",
  "Keine Antwort": "nachfassen",
  "Anfrage gesendet": "abwarten",
  Angenommen: "Nachricht senden",
  "Nachricht gesendet": "abwarten",
};

const NEXT_STEP_DEFAULT = "nachfassen";

// Return the latest interaction by `datum` (max ISO string) without mutating input.
// Exported so the UI (CompanyTable) reuses the same tie-breaking/ordering rule
// instead of an inline copy that could silently diverge (WR-04).
export function latestInteraction<T extends { datum: string }>(
  interactions: readonly T[],
): T | undefined {
  if (interactions.length === 0) return undefined;
  return interactions.reduce((latest, cur) =>
    cur.datum > latest.datum ? cur : latest,
  );
}

/**
 * Derive the current Status (DATA-05 / D-01 / D-02 / D-06).
 * - A manual "Tot"/"Geparkt" override is sticky: it wins over all interactions (D-02).
 * - With no interactions and no override → "Neu".
 * - Else the latest interaction's outcome (by datum) maps via the channel table,
 *   falling back to "Offen" for an unmapped outcome.
 */
export function deriveStatus(
  interactions: readonly DerivableInteraction[],
  manualOverride: ManualOverride = null,
): Status {
  if (manualOverride === "Tot" || manualOverride === "Geparkt") {
    return manualOverride;
  }
  const latest = latestInteraction(interactions);
  if (!latest) return "Neu";
  const table = latest.kanal ? OUTCOME_STATUS[latest.kanal] : undefined;
  const mapped = table && latest.outcome ? table[latest.outcome] : undefined;
  return mapped ?? "Offen";
}

/**
 * Derive the Nächster-Schritt label (LOG-04 / D-04).
 * No latest interaction → "Erstkontakt planen"; else the locked label per outcome,
 * defaulting to "nachfassen" for an unknown/missing outcome.
 */
export function deriveNextStep(latest: DerivableInteraction | undefined): string {
  if (!latest) return "Erstkontakt planen";
  if (!latest.outcome) return NEXT_STEP_DEFAULT;
  return NEXT_STEP[latest.outcome] ?? NEXT_STEP_DEFAULT;
}

/**
 * Derive the newest dated note (DB-05 / D-08).
 * null when empty; else the newest-by-datum interaction shaped as
 * {datum, kanal, bearbeiter, notiz}, with null kanal/notiz coerced to "".
 */
export function deriveNewestNote(
  interactions: readonly DerivableInteraction[],
): DerivedNote | null {
  const latest = latestInteraction(interactions);
  if (!latest) return null;
  return {
    datum: latest.datum,
    kanal: latest.kanal ?? "",
    bearbeiter: latest.bearbeiter,
    notiz: latest.notiz ?? "",
  };
}

/**
 * Whether the newest note is "new since last viewed" — the blue dot (DB-05 / D-07).
 * false if there is no newest note; true if never viewed (lastViewed null);
 * else true only when the newest datum is strictly later than lastViewed.
 */
export function hasNewNote(
  newest: DerivedNote | null,
  lastViewed: string | null,
): boolean {
  if (!newest) return false;
  if (lastViewed === null) return true;
  return newest.datum > lastViewed;
}
