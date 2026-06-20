// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly.
// This, companies.ts, and src/db/client.ts are the ONLY modules that import
// drizzle/schema. The SQL home for everything Phase 2 writes (LOG-01/03/04,
// DATA-05/06, DB-06): log/list/edit/delete interactions, capture follow-ups,
// set 🔥 — and on EVERY mutation, RE-DERIVE firmen.status via the pure
// derive module and persist it (D-06). firmen.status is a MATERIALIZED cache.
import { db } from "../db/client";
import { interaktionen, followups, firmen } from "../db/schema";
import { eq } from "drizzle-orm";
import { deriveStatus } from "./derive";
import type { ManualOverride } from "../types";

export type Interaction = typeof interaktionen.$inferSelect;

// WHY NO db.transaction() (mirrors companies.deleteCompany): the data layer
// runs on drizzle's sqlite-proxy (src/db/client.ts) over @tauri-apps/plugin-sql
// v2. drizzle's sqlite-proxy transaction() issues `begin`, each statement, and
// `commit` as SEPARATE proxy round-trips — every one a distinct
// invoke('plugin:sql|execute') IPC call. The Rust plugin serves each call from
// an sqlx connection POOL, so `begin`, the writes, and `commit` can each land on
// a DIFFERENT pooled connection. The `begin` then opens a transaction on a
// connection the writes never touch, and `commit` runs on a connection with no
// active transaction → it throws, the whole write rejects, App's handler
// swallows it, and nothing persists. A single-connection mock hides this (the
// test DB shares one handle), so the mocked tests passed while the real Tauri
// app silently failed to log interactions and persist edited notes.
//
// Fix: sequential awaited statements, no transaction wrapper — each is its own
// pooled-connection round-trip and commits on its own (sqlx autocommit per
// statement). We accept best-effort, non-atomic writes here: this is a
// single-user local SQLite DB. The re-derive runs LAST so even on a partial
// failure firmen.status is only ever recomputed after the write it reflects;
// the worst case is a stale status row, recoverable by the next mutation — far
// better than the previous "nothing persists at all" failure.

/**
 * Re-derive firmen.status from the current interaktionen set and persist it
 * (D-06). A sticky manual "Tot"/"Geparkt" status is preserved (D-02): when the
 * firma currently holds one of those, it is passed as the override to
 * deriveStatus so a new/edited/deleted interaction never overwrites it.
 *
 * Runs as plain sequential statements on the shared db handle (no transaction —
 * see the module note above). Called LAST in each mutation so firmen.status
 * always reflects the writes that preceded it.
 */
async function rederive(firmaId: string): Promise<void> {
  const interactions = await db
    .select()
    .from(interaktionen)
    .where(eq(interaktionen.firma_id, firmaId));

  const firmaRows = await db
    .select()
    .from(firmen)
    .where(eq(firmen.id, firmaId));
  const current = firmaRows[0]?.status;
  const override: ManualOverride =
    current === "Tot" || current === "Geparkt" ? current : null;

  const status = deriveStatus(interactions, override);
  await db
    .update(firmen)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(firmen.id, firmaId));
}

export async function logInteraction(input: {
  firma_id: string;
  kanal: string;
  outcome: string;
  notiz: string;
  kontakt_id?: string;
  heiss?: boolean;
  followup?: { faellig_am: string; grund?: string };
}): Promise<void> {
  // Sequential awaited writes, no db.transaction() (see module note): insert the
  // interaction, set 🔥, capture the follow-up, then re-derive status LAST.
  await db.insert(interaktionen).values({
    id: crypto.randomUUID(),
    firma_id: input.firma_id,
    kontakt_id: input.kontakt_id ?? null,
    datum: new Date().toISOString(), // UTC ISO, matches created_at convention
    kanal: input.kanal,
    outcome: input.outcome,
    notiz: input.notiz,
    bearbeiter: "Arthur", // D-08: single-user default (column also defaults this)
  });

  // 🔥 writes the boolean integer-mode column unconditionally on every log, so
  // un-ticking the checkbox actually clears it (WR-02: heiss is a toggle, not a
  // one-way ratchet). LogForm always emits a concrete boolean; default false.
  await db
    .update(firmen)
    .set({ heiss: input.heiss ?? false })
    .where(eq(firmen.id, input.firma_id));

  // Phase 2 only CAPTURES the follow-up (no surfacing — D-05).
  if (input.followup) {
    await db.insert(followups).values({
      id: crypto.randomUUID(),
      firma_id: input.firma_id,
      faellig_am: input.followup.faellig_am,
      grund: input.followup.grund ?? null,
      erledigt: false,
    });
  }

  await rederive(input.firma_id);
}

/**
 * One company's interactions, newest-first (sorted here by datum desc for the
 * UI's convenience; the Phase-1 convention leaves sorting to the UI, so callers
 * may re-sort freely).
 */
export async function listInteractions(firmaId: string): Promise<Interaction[]> {
  const rows = await db
    .select()
    .from(interaktionen)
    .where(eq(interaktionen.firma_id, firmaId));
  return rows.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
}

export async function editInteraction(
  id: string,
  patch: { kanal?: string; outcome?: string; notiz?: string },
): Promise<void> {
  const rows = await db
    .select()
    .from(interaktionen)
    .where(eq(interaktionen.id, id));
  const row = rows[0];
  if (!row) return; // nothing to edit

  // Edit then re-derive, sequential awaited writes (no db.transaction — see
  // module note). This path also backs updateInteractionNote (Notizen inline-edit).
  await db.update(interaktionen).set(patch).where(eq(interaktionen.id, id));
  await rederive(row.firma_id);
}

/**
 * Rewrite a single interaction's note text (Notizen inline-edit, Addition 1).
 *
 * The Notizen column renders the NEWEST interaction's note (deriveNewestNote);
 * editing that cell flows here with that interaction's id. We patch ONLY `notiz`
 * — outcome/kanal are untouched, so the derived Status/Nächster Schritt do not
 * change. We still re-derive (a cheap no-op for a note-only change today) so this
 * stays on the one edit+re-derive path and can never drift from editInteraction.
 *
 * This is intentionally NOT a standalone "company note" field: the note lives on
 * the interaction (D-07 amended) so the Phase-2 derivation stays the single
 * source of truth. A missing id is a no-op.
 */
export async function updateInteractionNote(
  id: string,
  notiz: string,
): Promise<void> {
  await editInteraction(id, { notiz });
}

export async function deleteInteraction(id: string): Promise<void> {
  const rows = await db
    .select()
    .from(interaktionen)
    .where(eq(interaktionen.id, id));
  const row = rows[0];
  if (!row) return; // nothing to delete

  // Delete then re-derive, sequential awaited writes (no db.transaction — see
  // module note).
  await db.delete(interaktionen).where(eq(interaktionen.id, id));
  await rederive(row.firma_id);
}
