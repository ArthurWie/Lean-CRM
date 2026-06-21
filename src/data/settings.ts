// Thin data layer (DATA-02): the "rest of the app knows no SQL" boundary.
// Components import THIS module (via App), never drizzle or the schema directly.
// This joins companies.ts/interactions.ts/import.ts as the only modules that
// import drizzle/schema. Holds the key/value `settings` table (D6-04): app
// configuration that travels inside the synced DB file.
import { db } from "../db/client";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";

// The one known settings key today: the "Erfasst als" name stamped onto every
// new interaction's bearbeiter field (D6-02/D6-03).
const BEARBEITER_KEY = "bearbeiter";

/**
 * Read a setting's value, or null when no row exists for the key.
 */
export async function getSetting(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key));
  return rows[0]?.value ?? null;
}

/**
 * Upsert a setting (insert or overwrite). NO db.transaction() — the sqlite-proxy
 * pool landmine (see interactions.ts module note) means begin/commit can land on
 * different pooled connections and the write rejects. We use drizzle's
 * onConflictDoUpdate, which is a SINGLE INSERT ... ON CONFLICT statement (one
 * round-trip, atomic at the statement level), not a transaction wrapper.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

/**
 * The configured logging name, or "" (empty string) when unset — never a hard-coded default.
 * "" is intentional: logInteraction stamps it into bearbeiter (NOT NULL column),
 * recording "no configured name yet" without violating the constraint.
 */
export async function getBearbeiter(): Promise<string> {
  return (await getSetting(BEARBEITER_KEY)) ?? "";
}

/**
 * Persist the logging name.
 */
export async function setBearbeiter(name: string): Promise<void> {
  await setSetting(BEARBEITER_KEY, name);
}
