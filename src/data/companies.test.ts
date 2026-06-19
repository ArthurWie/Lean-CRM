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

const MIGRATION_PATH = fileURLToPath(
  new URL("../../src-tauri/migrations/0001_init.sql", import.meta.url)
);

let sqlite: DatabaseSyncType;

function applyMigration(dbInstance: DatabaseSyncType) {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  // Strip drizzle-kit's breakpoint markers; run each CREATE TABLE statement.
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) dbInstance.exec(stmt);
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
const { seedIfEmpty, listCompanies } = await import("./companies");
const { db } = await import("../db/client");
const { kontakte, kontakt_mails } = await import("../db/schema");
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

  it("is idempotent: a second seedIfEmpty does not duplicate rows", async () => {
    await seedIfEmpty();
    const afterFirst = (await listCompanies()).length;
    await seedIfEmpty();
    const afterSecond = (await listCompanies()).length;
    expect(afterSecond).toBe(afterFirst);
    expect(afterFirst).toBe(3); // the three seeded fixtures
  });
});
