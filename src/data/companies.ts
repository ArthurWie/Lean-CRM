// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly.
// This and src/db/client.ts are the ONLY modules that import drizzle/schema.
import { db } from "../db/client";
import { firmen, kontakte, kontakt_mails } from "../db/schema";
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
