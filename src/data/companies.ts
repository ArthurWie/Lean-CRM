// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module, never drizzle or the schema directly.
// This and src/db/client.ts are the ONLY modules that import drizzle/schema.
import { db } from "../db/client";
import { firmen, kontakte, kontakt_mails } from "../db/schema";

export type Company = typeof firmen.$inferSelect;

export async function listCompanies(): Promise<Company[]> {
  // Sorting/filtering is done in the UI for Phase 1.
  return db.select().from(firmen);
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
