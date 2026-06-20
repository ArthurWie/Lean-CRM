// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly.
// This and src/db/client.ts are the ONLY modules that import drizzle/schema.
import { db } from "../db/client";
import {
  firmen,
  kontakte,
  kontakt_mails,
  interaktionen,
  followups,
} from "../db/schema";
import { eq, inArray } from "drizzle-orm";

export type Company = typeof firmen.$inferSelect;
// DATA-04: a contact carries its many emails inline. emails[0] is the primary
// (D-02) — Mail actions and the table use the first element.
export type Contact = typeof kontakte.$inferSelect & { emails: string[] };

export async function listCompanies(): Promise<Company[]> {
  // Sorting/filtering is done in the UI for Phase 1.
  return db.select().from(firmen);
}

// DB-06: the contacts (Ansprechpartner) shown in a company's detail panel.
// One company's kontakte rows; the UI renders name/rolle (emails are a separate
// table not surfaced this phase). Components never call drizzle — they call this.
export async function listContacts(firmaId: string): Promise<Contact[]> {
  const rows = await db
    .select()
    .from(kontakte)
    .where(eq(kontakte.firma_id, firmaId));
  if (rows.length === 0) return [];

  // DATA-04: attach each contact's emails. Fetch the mail rows for these
  // contacts and group by kontakt_id. emails[0] = primary (D-02; preserve the
  // stored insert order). A contact with no mail rows gets emails: [].
  const ids = rows.map((k) => k.id);
  const mails = await db
    .select()
    .from(kontakt_mails)
    .where(inArray(kontakt_mails.kontakt_id, ids));

  const byContact = new Map<string, string[]>();
  for (const m of mails) {
    const list = byContact.get(m.kontakt_id) ?? [];
    list.push(m.email);
    byContact.set(m.kontakt_id, list);
  }

  return rows.map((k) => ({ ...k, emails: byContact.get(k.id) ?? [] }));
}

// DB-05/D-07: record that this firma's detail/history was opened, clearing the
// "new note since last viewed" blue dot. Writes the current UTC ISO timestamp.
export async function markViewed(firmaId: string): Promise<void> {
  await db
    .update(firmen)
    .set({ last_viewed: new Date().toISOString() })
    .where(eq(firmen.id, firmaId));
}

// D-02: the ONE allowed hand-set status path. "Tot"/"Geparkt" are sticky manual
// overrides (the data layer's rederive() preserves them); they are never derived
// from an outcome. This does NOT touch interactions. Clearing the override /
// returning to a derived status is out of scope for Phase 2.
export async function setManualStatus(
  firmaId: string,
  status: "Tot" | "Geparkt",
): Promise<void> {
  await db
    .update(firmen)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(firmen.id, firmaId));
}

// DB-07 / D-05 / D-06: manually add a company via "+ Neue Firma". The new firma
// gets Status "Neu" — the no-interaction deriveStatus default (hand-set here; this
// path never routes through derive.ts since there are no interactions yet) — heiss
// false, a UUID id, and matching UTC-ISO created_at/updated_at. Unternehmen (name)
// is the only required field (D-06): it is trimmed and an empty/whitespace-only
// name is rejected so no nameless "—" company is ever created (Pitfall 5 / T-03-VAL).
// No dedupe runs on manual add this phase (D-09; FN→domain→name dedupe lands with
// CSV import in Phase 5). Returns the new firma id.
export async function addCompany(input: {
  name: string;
  fn?: string;
  branche?: string;
  groesse?: string;
  website?: string;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Unternehmen darf nicht leer sein.");
  }

  const id = crypto.randomUUID();
  const ts = new Date().toISOString();

  await db.insert(firmen).values({
    id,
    name,
    fn: input.fn ?? null,
    branche: input.branche ?? null,
    groesse: input.groesse ?? null,
    website: input.website ?? null,
    status: "Neu", // matches deriveStatus([]) — never taken from user input (T-03-STATUS)
    heiss: false,
    created_at: ts,
    updated_at: ts,
  });

  return id;
}

// D-07: patch the inline-editable company text fields (Unternehmen, FN, Branche,
// Größe, Website, Lessons) on a single firma and bump updated_at. Mirrors
// setManualStatus' parameterized update shape — all writes stay in this data layer
// (DATA-02) and Drizzle parameterizes them (T-03-SQLI). Status is NOT editable here.
export async function updateCompanyField(
  id: string,
  patch: Partial<
    Pick<Company, "name" | "fn" | "branche" | "groesse" | "website" | "lessons">
  >,
): Promise<void> {
  await db
    .update(firmen)
    .set({ ...patch, updated_at: new Date().toISOString() })
    .where(eq(firmen.id, id));
}

// Addition 2: hard-delete a company and every row that depends on it, for fixing
// a mistaken add. The schema's foreign keys are ON DELETE NO ACTION and SQLite's
// FK enforcement is off in this app, so there is no DB-level cascade — we delete
// the dependents explicitly, in FK-safe order: kontakt_mails (→ kontakte) →
// kontakte → interaktionen → followups → firmen.
//
// WHY NO db.transaction(): the data layer runs on drizzle's sqlite-proxy
// (src/db/client.ts) over @tauri-apps/plugin-sql v2. drizzle's sqlite-proxy
// transaction() issues `begin`, each statement, and `commit` as SEPARATE proxy
// round-trips — every one a distinct invoke('plugin:sql|execute') IPC call. The
// Rust plugin serves each call from an sqlx connection POOL, so `begin`, the
// deletes, and `commit` can each land on a DIFFERENT pooled connection. The
// `begin` then opens a transaction on a connection the deletes never touch, and
// `commit` runs on a connection with no active transaction → it throws, the whole
// delete rejects, App.handleDeleteCompany swallows it, and the row stays. A
// single-connection mock hides this (the test DB shares one handle), so the
// mocked tests passed while the real Tauri app silently failed to delete.
//
// Fix: sequential awaited statements, no transaction wrapper — each is its own
// pooled-connection round-trip and commits on its own (sqlx autocommit per
// statement). We accept best-effort, non-atomic writes here: this is a single-user
// local SQLite DB, the order is FK-safe, and FK enforcement is off, so a partial
// failure cannot orphan rows in a way that breaks the app. (interactions.ts has
// the same db.transaction() pattern and the same latent bug — fixed separately.)
export async function deleteCompany(firmaId: string): Promise<void> {
  // kontakt_mails reference kontakte, not firmen — resolve this firma's contact
  // ids first, then delete their mail rows before the contacts themselves.
  const contacts = await db
    .select({ id: kontakte.id })
    .from(kontakte)
    .where(eq(kontakte.firma_id, firmaId));
  const contactIds = contacts.map((k) => k.id);
  if (contactIds.length > 0) {
    await db
      .delete(kontakt_mails)
      .where(inArray(kontakt_mails.kontakt_id, contactIds));
  }

  await db.delete(kontakte).where(eq(kontakte.firma_id, firmaId));
  await db.delete(interaktionen).where(eq(interaktionen.firma_id, firmaId));
  await db.delete(followups).where(eq(followups.firma_id, firmaId));
  await db.delete(firmen).where(eq(firmen.id, firmaId));
}

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select().from(firmen).limit(1);
  if (existing.length) return; // idempotent: only seed an empty DB

  const ts = new Date().toISOString();
  const himmelhochId = crypto.randomUUID();

  await db.insert(firmen).values([
    {
      id: himmelhochId,
      name: "Himmelhoch GmbH",
      branche: "PR/Events",
      groesse: "~37",
      status: "Im Gespräch",
      heiss: true,
      website: "himmelhoch.at",
      created_at: ts,
      updated_at: ts,
    },
    {
      id: crypto.randomUUID(),
      name: "Chapter 4 GmbH",
      branche: "PR-Agentur",
      groesse: "~40",
      status: "Tot", // exercises DB-03 dimming in Plan 02
      heiss: false,
      created_at: ts,
      updated_at: ts,
    },
    {
      id: crypto.randomUUID(),
      name: "Milestones in Communication",
      branche: "PR-Agentur",
      status: "Geparkt", // exercises DB-03 dimming in Plan 02
      heiss: false,
      created_at: ts,
      updated_at: ts,
    },
  ]);

  // DATA-04: one contact, multiple emails.
  const kontaktId = crypto.randomUUID();
  await db.insert(kontakte).values({
    id: kontaktId,
    firma_id: himmelhochId,
    name: "Eva Mandl",
    rolle: "Geschäftsführerin",
    relevant: true,
  });
  await db.insert(kontakt_mails).values([
    { id: crypto.randomUUID(), kontakt_id: kontaktId, email: "office@himmelhoch.at" },
    { id: crypto.randomUUID(), kontakt_id: kontaktId, email: "eva@himmelhoch.at" },
  ]);
}
