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
// Mock @tauri-apps/plugin-sql over a real in-memory SQLite (node:sqlite).
// This exercises the ACTUAL src/db/client.ts proxy callback — including the
// Object.values value-array contract (RESEARCH.md Pitfall 1) — against real
// SQL produced by Drizzle, not a hand-rolled fake. The mock mirrors the real
// plugin: .select() returns row OBJECTS, .execute() runs the statement.
// ---------------------------------------------------------------------------

// Apply migrations in order, exactly as add_migrations does Rust-side.
const MIGRATION_PATHS = [
  "../../src-tauri/migrations/0001_init.sql",
  "../../src-tauri/migrations/0002_add_last_viewed.sql",
].map((p) => fileURLToPath(new URL(p, import.meta.url)));

let sqlite: DatabaseSyncType;

function applyMigration(dbInstance: DatabaseSyncType) {
  for (const path of MIGRATION_PATHS) {
    const sql = readFileSync(path, "utf8");
    // Strip drizzle-kit's breakpoint markers; run each statement.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) dbInstance.exec(stmt);
  }
}

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    async select(query: string, params: unknown[] = []) {
      // Real plugin returns an array of plain row objects.
      const rows = sqlite.prepare(query).all(...(params as any[]));
      return rows.map((r) => ({ ...r }));
    },
    async execute(query: string, params: unknown[] = []) {
      const info = sqlite.prepare(query).run(...(params as any[]));
      return { rowsAffected: Number(info.changes), lastInsertId: 0 };
    },
  };
  return {
    default: { load: vi.fn(async () => fakeDb) },
  };
});

// Import AFTER the mock is registered.
const {
  seedIfEmpty,
  listCompanies,
  listContacts,
  markViewed,
  setManualStatus,
  addCompany,
  updateCompanyField,
} = await import("./companies");
const { db } = await import("../db/client");
const { firmen, kontakte, kontakt_mails } = await import("../db/schema");
const { eq } = await import("drizzle-orm");

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
});

describe("companies data layer", () => {
  it("round-trips a seeded company with identical field values (DATA-03)", async () => {
    await seedIfEmpty();
    const companies = await listCompanies();

    const himmelhoch = companies.find((c) => c.name === "Himmelhoch GmbH");
    expect(himmelhoch).toBeDefined();
    // Exact field-value round-trip — guards the Object.values proxy contract.
    expect(himmelhoch!.branche).toBe("PR/Events");
    expect(himmelhoch!.groesse).toBe("~37");
    expect(himmelhoch!.status).toBe("Im Gespräch");
    expect(himmelhoch!.heiss).toBe(true); // boolean integer-mode round-trip
    expect(himmelhoch!.website).toBe("himmelhoch.at");
    expect(typeof himmelhoch!.created_at).toBe("string");
    expect(himmelhoch!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // UTC ISO
  });

  it("stores a contact with exactly two emails (DATA-04)", async () => {
    await seedIfEmpty();
    const eva = (await db.select().from(kontakte)).find(
      (k) => k.name === "Eva Mandl"
    );
    expect(eva).toBeDefined();
    const mails = await db
      .select()
      .from(kontakt_mails)
      .where(eq(kontakt_mails.kontakt_id, eva!.id));
    expect(mails).toHaveLength(2);
    expect(mails.map((m) => m.email).sort()).toEqual([
      "eva@himmelhoch.at",
      "office@himmelhoch.at",
    ]);
  });

  it("listContacts attaches each contact's emails array (DATA-04 join)", async () => {
    await seedIfEmpty();
    const himmelhoch = (await listCompanies()).find(
      (c) => c.name === "Himmelhoch GmbH"
    )!;

    const contacts = await listContacts(himmelhoch.id);
    const eva = contacts.find((k) => k.name === "Eva Mandl");
    expect(eva).toBeDefined();
    expect(eva!.emails).toHaveLength(2);
    expect([...eva!.emails].sort()).toEqual([
      "eva@himmelhoch.at",
      "office@himmelhoch.at",
    ]);
  });

  it("listContacts returns emails: [] for a contact with no kontakt_mails", async () => {
    await seedIfEmpty();
    const himmelhoch = (await listCompanies()).find(
      (c) => c.name === "Himmelhoch GmbH"
    )!;
    // Add a second contact with no mail rows.
    const lonelyId = crypto.randomUUID();
    await db.insert(kontakte).values({
      id: lonelyId,
      firma_id: himmelhoch.id,
      name: "Ohne Mail",
      relevant: false,
    });

    const contacts = await listContacts(himmelhoch.id);
    const lonely = contacts.find((k) => k.id === lonelyId);
    expect(lonely).toBeDefined();
    expect(lonely!.emails).toEqual([]);
  });

  it("is idempotent: a second seedIfEmpty does not duplicate rows", async () => {
    await seedIfEmpty();
    const afterFirst = (await listCompanies()).length;
    await seedIfEmpty();
    const afterSecond = (await listCompanies()).length;
    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).toBe(3); // the three seeded fixtures
  });

  it("markViewed writes a UTC ISO last_viewed on the target firma only (DB-05)", async () => {
    await seedIfEmpty();
    const before = await listCompanies();
    const himmelhoch = before.find((c) => c.name === "Himmelhoch GmbH")!;
    const other = before.find((c) => c.name === "Chapter 4 GmbH")!;
    expect(himmelhoch.last_viewed).toBeNull(); // never viewed yet

    await markViewed(himmelhoch.id);

    const after = await listCompanies();
    const viewed = after.find((c) => c.id === himmelhoch.id)!;
    const untouched = after.find((c) => c.id === other.id)!;
    expect(viewed.last_viewed).toMatch(/^\d{4}-\d{2}-\d{2}T/); // UTC ISO
    expect(untouched.last_viewed).toBeNull(); // only the target firma changed
  });

  it("setManualStatus sets the sticky Geparkt override (D-02)", async () => {
    await seedIfEmpty();
    const himmelhoch = (await listCompanies()).find(
      (c) => c.name === "Himmelhoch GmbH"
    )!;
    expect(himmelhoch.status).toBe("Im Gespräch");

    await setManualStatus(himmelhoch.id, "Geparkt");

    const [updated] = await db
      .select()
      .from(firmen)
      .where(eq(firmen.id, himmelhoch.id));
    expect(updated.status).toBe("Geparkt");
  });

  // --- DB-07: manual add + inline edit (Plan 03-03) ---

  it("addCompany inserts one firma with Status Neu, heiss false, UUID id, UTC-ISO timestamps", async () => {
    const before = (await listCompanies()).length;
    const id = await addCompany({ name: "Acme GmbH" });

    const after = await listCompanies();
    expect(after.length).toBe(before + 1);
    const acme = after.find((c) => c.id === id)!;
    expect(acme).toBeDefined();
    expect(acme.name).toBe("Acme GmbH");
    expect(acme.status).toBe("Neu"); // the no-interaction deriveStatus default
    expect(acme.heiss).toBe(false);
    // crypto.randomUUID() shape
    expect(acme.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(acme.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // UTC ISO
    expect(acme.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(acme.created_at).toBe(acme.updated_at); // same instant on insert
  });

  it("addCompany trims the name and rejects an empty/whitespace name (no row created)", async () => {
    const before = (await listCompanies()).length;
    await expect(addCompany({ name: "   " })).rejects.toThrow();
    expect((await listCompanies()).length).toBe(before); // nothing inserted

    const id = await addCompany({ name: "  Trimmed GmbH  " });
    const created = (await listCompanies()).find((c) => c.id === id)!;
    expect(created.name).toBe("Trimmed GmbH"); // trimmed
  });

  it("addCompany persists optional fields when given and leaves them null when omitted", async () => {
    const withFields = await addCompany({
      name: "Voll GmbH",
      fn: "FN 123x",
      branche: "IT",
      groesse: "~10",
      website: "voll.at",
    });
    const minimal = await addCompany({ name: "Leer GmbH" });

    const all = await listCompanies();
    const full = all.find((c) => c.id === withFields)!;
    const min = all.find((c) => c.id === minimal)!;

    expect(full.fn).toBe("FN 123x");
    expect(full.branche).toBe("IT");
    expect(full.groesse).toBe("~10");
    expect(full.website).toBe("voll.at");

    expect(min.fn).toBeNull();
    expect(min.branche).toBeNull();
    expect(min.groesse).toBeNull();
    expect(min.website).toBeNull();
  });

  it("updateCompanyField updates only the targeted row and bumps updated_at", async () => {
    const aId = await addCompany({ name: "Eins GmbH" });
    const bId = await addCompany({ name: "Zwei GmbH" });
    const before = await listCompanies();
    const aBefore = before.find((c) => c.id === aId)!;
    const bBefore = before.find((c) => c.id === bId)!;

    // Ensure a later timestamp than the insert.
    await new Promise((r) => setTimeout(r, 2));
    await updateCompanyField(aId, { fn: "FN 999z" });

    const after = await listCompanies();
    const aAfter = after.find((c) => c.id === aId)!;
    const bAfter = after.find((c) => c.id === bId)!;

    expect(aAfter.fn).toBe("FN 999z");
    // updated_at is bumped forward (strictly later than the insert timestamp).
    expect(aAfter.updated_at > aBefore.updated_at).toBe(true);
    // The other row is untouched.
    expect(bAfter.fn).toBe(bBefore.fn);
    expect(bAfter.updated_at).toBe(bBefore.updated_at);
  });
});
