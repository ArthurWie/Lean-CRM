// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly.
// This, companies.ts, interactions.ts, and src/db/client.ts are the ONLY
// modules that import drizzle/schema. The SQL home for D-08 contact management:
// add/edit/remove an Ansprechpartner and its emails across the two tables
// kontakte + kontakt_mails. emails[0] is the primary (D-02) used by Plan 01's
// Mail action.
import { db } from "../db/client";
import { kontakte, kontakt_mails } from "../db/schema";
import { eq } from "drizzle-orm";

// WHY NO db.transaction() (mirrors companies.deleteCompany & interactions.ts):
// the data layer runs on drizzle's sqlite-proxy (src/db/client.ts) over
// @tauri-apps/plugin-sql v2. drizzle's sqlite-proxy transaction() issues
// `begin`, each statement, and `commit` as SEPARATE proxy round-trips — every
// one a distinct invoke('plugin:sql|execute') IPC call. The Rust plugin serves
// each call from an sqlx connection POOL, so `begin`, the writes, and `commit`
// can each land on a DIFFERENT pooled connection. The `begin` then opens a
// transaction on a connection the writes never touch, and `commit` runs on a
// connection with no active transaction → it throws, the whole write rejects,
// App's handler swallows it, and nothing persists. A single-connection mock
// hides this (the test DB shares one handle), so mocked tests pass while the
// real Tauri app silently fails — this phase proved it on delete, logging, and
// note persistence.
//
// Fix: sequential awaited statements, no transaction wrapper — each is its own
// pooled-connection round-trip and commits on its own (sqlx autocommit per
// statement). We accept best-effort, non-atomic writes here: this is a
// single-user local SQLite DB with FK enforcement off; the delete removes
// children (kontakt_mails) before the parent (kontakte) so a partial failure
// cannot orphan a kontakt_mails row in a way that breaks the app.

// Filter a raw email list down to the trimmed, non-empty values (D-08: empty /
// whitespace-only inputs are skipped — they never become a kontakt_mails row).
function cleanEmails(emails: string[] | undefined): string[] {
  return (emails ?? []).map((e) => e.trim()).filter(Boolean);
}

// D-08: add an Ansprechpartner to a firma. Inserts one kontakte row plus one
// kontakt_mails row per non-empty email (DATA-04). Sequential awaited writes,
// no db.transaction() (see module note). Returns the new kontakte id.
export async function addContact(
  firmaId: string,
  input: {
    name?: string;
    rolle?: string;
    telefon?: string;
    linkedin?: string;
    emails?: string[];
  },
): Promise<string> {
  const id = crypto.randomUUID();

  await db.insert(kontakte).values({
    id,
    firma_id: firmaId,
    name: input.name ?? null,
    rolle: input.rolle ?? null,
    telefon: input.telefon ?? null,
    linkedin: input.linkedin ?? null,
  });

  const emails = cleanEmails(input.emails);
  if (emails.length > 0) {
    await db.insert(kontakt_mails).values(
      emails.map((email) => ({
        id: crypto.randomUUID(),
        kontakt_id: id,
        email,
      })),
    );
  }

  return id;
}

// D-08: patch a single contact's text fields (name/rolle/telefon/linkedin).
// Single-table update — emails are managed separately via setContactEmails.
// Drizzle parameterizes the write (T-04-SQLI); SQL stays in this data layer.
export async function updateContact(
  id: string,
  patch: Partial<Pick<typeof kontakte.$inferSelect, "name" | "rolle" | "telefon" | "linkedin">>,
): Promise<void> {
  await db.update(kontakte).set(patch).where(eq(kontakte.id, id));
}

// D-08 / DATA-04: replace a contact's entire email set. Sequential awaited
// writes, no db.transaction() (see module note): delete the existing rows first,
// then insert the new trimmed non-empty set. An empty list clears all emails.
export async function setContactEmails(
  kontaktId: string,
  emails: string[],
): Promise<void> {
  await db.delete(kontakt_mails).where(eq(kontakt_mails.kontakt_id, kontaktId));

  const clean = cleanEmails(emails);
  if (clean.length > 0) {
    await db.insert(kontakt_mails).values(
      clean.map((email) => ({
        id: crypto.randomUUID(),
        kontakt_id: kontaktId,
        email,
      })),
    );
  }
}

// D-08: remove a contact and all its emails. Sequential awaited writes, no
// db.transaction() (see module note): delete the kontakt_mails children FIRST,
// then the kontakte parent (FK-safe order, mirroring companies.deleteCompany /
// interactions.ts). Leaves no orphaned kontakt_mails rows.
export async function deleteContact(kontaktId: string): Promise<void> {
  await db.delete(kontakt_mails).where(eq(kontakt_mails.kontakt_id, kontaktId));
  await db.delete(kontakte).where(eq(kontakte.id, kontaktId));
}
