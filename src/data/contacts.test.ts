// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Load node:sqlite at runtime via createRequire so vite's static import
// analysis never tries to resolve/bundle the experimental builtin.
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

// ---------------------------------------------------------------------------
// Mock @tauri-apps/plugin-sql over a real in-memory SQLite (node:sqlite) — the
// SAME harness as companies.test.ts. This exercises the ACTUAL src/db/client.ts
// proxy callback against real SQL produced by Drizzle. The mock mirrors the real
// plugin: .select() returns row OBJECTS, .execute() runs the statement.
// ---------------------------------------------------------------------------

const MIGRATION_PATHS = [
  "../../src-tauri/migrations/0001_init.sql",
  "../../src-tauri/migrations/0002_add_last_viewed.sql",
  "../../src-tauri/migrations/0003_add_deleted_at.sql",
].map((p) => fileURLToPath(new URL(p, import.meta.url)));

let sqlite: DatabaseSyncType;

function applyMigration(dbInstance: DatabaseSyncType) {
  for (const path of MIGRATION_PATHS) {
    const sql = readFileSync(path, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) dbInstance.exec(stmt);
  }
}

// A hoisted recorder of every non-SELECT statement that reaches the plugin's
// execute() — i.e. the real INSERT/UPDATE/DELETE (and any begin/commit) round-
// trips the proxy makes. The CRITICAL constraint for this module: the contact
// writes must NOT be wrapped in db.transaction() (the sqlite-proxy over pooled
// @tauri-apps/plugin-sql cannot span begin/commit across connections — this
// phase proved it silently breaks writes in the real app). We assert on
// executedSql to prove the writes fire bare, with no begin/commit leaking in.
const { executedSql } = vi.hoisted(() => ({ executedSql: [] as string[] }));

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    async select(query: string, params: unknown[] = []) {
      const rows = sqlite.prepare(query).all(...(params as any[]));
      return rows.map((r) => ({ ...r }));
    },
    async execute(query: string, params: unknown[] = []) {
      executedSql.push(query);
      const info = sqlite.prepare(query).run(...(params as any[]));
      return { rowsAffected: Number(info.changes), lastInsertId: 0 };
    },
  };
  return {
    default: { load: vi.fn(async () => fakeDb) },
  };
});

// Import AFTER the mock is registered.
const { addContact, updateContact, setContactEmails, deleteContact } =
  await import("./contacts");
const { addCompany, listContacts } = await import("./companies");
const { db } = await import("../db/client");
const { kontakte, kontakt_mails } = await import("../db/schema");
const { eq } = await import("drizzle-orm");

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
});

describe("contacts data layer", () => {
  it("addContact stores one kontakte row and one kontakt_mails row per email (DATA-04)", async () => {
    const firmaId = await addCompany({ name: "Kontakt GmbH" });
    const id = await addContact(firmaId, {
      name: "Max Muster",
      rolle: "GF",
      telefon: "+43 1 234",
      linkedin: "https://linkedin.com/in/max",
      emails: ["a@kontakt.at", "b@kontakt.at"],
    });

    const rows = await db.select().from(kontakte).where(eq(kontakte.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Max Muster");
    expect(rows[0].rolle).toBe("GF");
    expect(rows[0].telefon).toBe("+43 1 234");
    expect(rows[0].linkedin).toBe("https://linkedin.com/in/max");
    expect(rows[0].firma_id).toBe(firmaId);

    const mails = await db
      .select()
      .from(kontakt_mails)
      .where(eq(kontakt_mails.kontakt_id, id));
    expect(mails).toHaveLength(2);
    expect(mails.map((m) => m.email).sort()).toEqual([
      "a@kontakt.at",
      "b@kontakt.at",
    ]);
  });

  it("addContact skips empty/whitespace emails", async () => {
    const firmaId = await addCompany({ name: "Leer GmbH" });
    const id = await addContact(firmaId, {
      name: "Ohne Mail",
      emails: ["", "  ", "echt@leer.at", "   "],
    });

    const mails = await db
      .select()
      .from(kontakt_mails)
      .where(eq(kontakt_mails.kontakt_id, id));
    expect(mails).toHaveLength(1);
    expect(mails[0].email).toBe("echt@leer.at");
  });

  it("addContact with no emails creates the contact with zero kontakt_mails rows", async () => {
    const firmaId = await addCompany({ name: "Solo GmbH" });
    const id = await addContact(firmaId, { name: "Niemand" });

    expect(await db.select().from(kontakte).where(eq(kontakte.id, id))).toHaveLength(1);
    expect(
      await db.select().from(kontakt_mails).where(eq(kontakt_mails.kontakt_id, id)),
    ).toHaveLength(0);
  });

  it("addContact returns a UUID-shaped id matching the inserted kontakte row", async () => {
    const firmaId = await addCompany({ name: "Id GmbH" });
    const id = await addContact(firmaId, { name: "Wer" });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("updateContact updates only the given field, leaving other fields and other contacts untouched", async () => {
    const firmaId = await addCompany({ name: "Edit GmbH" });
    const a = await addContact(firmaId, { name: "A", rolle: "GF", telefon: "1" });
    const b = await addContact(firmaId, { name: "B", rolle: "Assistenz", telefon: "2" });

    await updateContact(a, { telefon: "999" });

    const [aRow] = await db.select().from(kontakte).where(eq(kontakte.id, a));
    const [bRow] = await db.select().from(kontakte).where(eq(kontakte.id, b));
    expect(aRow.telefon).toBe("999");
    expect(aRow.name).toBe("A"); // other fields untouched
    expect(aRow.rolle).toBe("GF");
    expect(bRow.telefon).toBe("2"); // other contact untouched
    expect(bRow.rolle).toBe("Assistenz");
  });

  it("setContactEmails replaces the whole email set atomically (old gone, new present)", async () => {
    const firmaId = await addCompany({ name: "Mails GmbH" });
    const id = await addContact(firmaId, {
      name: "Viel Mail",
      emails: ["old1@x.at", "old2@x.at"],
    });

    await setContactEmails(id, ["new@x.at", "  ", "neu2@x.at"]);

    const mails = await db
      .select()
      .from(kontakt_mails)
      .where(eq(kontakt_mails.kontakt_id, id));
    expect(mails.map((m) => m.email).sort()).toEqual(["neu2@x.at", "new@x.at"]);
    // The old rows are gone.
    expect(mails.find((m) => m.email.startsWith("old"))).toBeUndefined();
  });

  it("setContactEmails to an empty set clears all the contact's emails", async () => {
    const firmaId = await addCompany({ name: "Clear GmbH" });
    const id = await addContact(firmaId, { name: "X", emails: ["a@x.at"] });

    await setContactEmails(id, []);

    expect(
      await db.select().from(kontakt_mails).where(eq(kontakt_mails.kontakt_id, id)),
    ).toHaveLength(0);
  });

  it("deleteContact removes the contact AND all its kontakt_mails rows (children before parent)", async () => {
    const firmaId = await addCompany({ name: "Weg GmbH" });
    const keep = await addContact(firmaId, { name: "Bleibt", emails: ["keep@x.at"] });
    const drop = await addContact(firmaId, {
      name: "Geht",
      emails: ["a@x.at", "b@x.at"],
    });

    await deleteContact(drop);

    // The dropped contact and its mails are gone.
    expect(await db.select().from(kontakte).where(eq(kontakte.id, drop))).toHaveLength(0);
    expect(
      await db.select().from(kontakt_mails).where(eq(kontakt_mails.kontakt_id, drop)),
    ).toHaveLength(0);
    // The other contact and its mail survive.
    expect(await db.select().from(kontakte).where(eq(kontakte.id, keep))).toHaveLength(1);
    expect(
      await db.select().from(kontakt_mails).where(eq(kontakt_mails.kontakt_id, keep)),
    ).toHaveLength(1);
  });

  it("DATA-04: a contact round-trips with multiple emails through listContacts (Plan 01 join)", async () => {
    const firmaId = await addCompany({ name: "Roundtrip GmbH" });
    await addContact(firmaId, {
      name: "Eva Mandl",
      rolle: "GF",
      emails: ["office@x.at", "eva@x.at"],
    });

    const contacts = await listContacts(firmaId);
    const eva = contacts.find((k) => k.name === "Eva Mandl");
    expect(eva).toBeDefined();
    expect([...eva!.emails].sort()).toEqual(["eva@x.at", "office@x.at"]);
  });

  // REGRESSION GUARD (matches companies/interactions): the contact writes must
  // NOT be wrapped in db.transaction(). The sqlite-proxy issues begin/commit as
  // separate proxy round-trips, and the real Tauri plugin serves each from an
  // sqlx pool, so begin/writes/commit can land on different connections → commit
  // throws → the write silently fails in the running app (the single-connection
  // test mock hides it). This asserts NO begin/commit/rollback reach the execute
  // path — it fails if anyone reintroduces a transaction wrapper here.
  it("addContact issues no begin/commit/rollback (no db.transaction — pooled-proxy constraint)", async () => {
    const firmaId = await addCompany({ name: "Bare GmbH" });
    executedSql.length = 0;
    await addContact(firmaId, { name: "Bare", emails: ["a@x.at", "b@x.at"] });
    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
  });

  it("setContactEmails and deleteContact issue no begin/commit/rollback (no db.transaction)", async () => {
    const firmaId = await addCompany({ name: "Bare2 GmbH" });
    const id = await addContact(firmaId, { name: "Bare2", emails: ["a@x.at"] });

    executedSql.length = 0;
    await setContactEmails(id, ["c@x.at"]);
    await deleteContact(id);
    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
  });
});
