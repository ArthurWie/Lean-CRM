// @vitest-environment node
// Verifies migration 0004 adds the key/value `settings` table (D6-04): an
// in-memory SQLite built from 0001 + 0002 + 0003 + 0004 must have a `settings`
// table with a text `key` PRIMARY KEY (notnull=1, pk=1) and a nullable text
// `value` column. Inserting (key, value) and (key, NULL) must both succeed, and
// the breakpoint splitter the data-layer tests rely on must still yield only
// executable statements.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const MIGRATION_0001 = fileURLToPath(
  new URL("../../src-tauri/migrations/0001_init.sql", import.meta.url)
);
const MIGRATION_0002 = fileURLToPath(
  new URL("../../src-tauri/migrations/0002_add_last_viewed.sql", import.meta.url)
);
const MIGRATION_0003 = fileURLToPath(
  new URL("../../src-tauri/migrations/0003_add_deleted_at.sql", import.meta.url)
);
const MIGRATION_0004 = fileURLToPath(
  new URL("../../src-tauri/migrations/0004_add_settings.sql", import.meta.url)
);

function applyMigration(dbInstance: DatabaseSyncType, path: string) {
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) dbInstance.exec(stmt);
}

describe("migration 0004: settings key/value table", () => {
  it("creates a settings table with a text key PK and a nullable text value", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigration(sqlite, MIGRATION_0001);
    applyMigration(sqlite, MIGRATION_0002);
    applyMigration(sqlite, MIGRATION_0003);
    applyMigration(sqlite, MIGRATION_0004);

    const cols = sqlite.prepare("PRAGMA table_info(`settings`)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;

    const key = cols.find((c) => c.name === "key");
    expect(key).toBeDefined();
    expect(key!.type.toLowerCase()).toBe("text");
    expect(key!.notnull).toBe(1); // PK is NOT NULL
    expect(key!.pk).toBe(1); // primary key

    const value = cols.find((c) => c.name === "value");
    expect(value).toBeDefined();
    expect(value!.type.toLowerCase()).toBe("text");
    expect(value!.notnull).toBe(0); // nullable
    expect(value!.pk).toBe(0);
  });

  it("accepts both a (key, value) row and a (key, NULL) row", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigration(sqlite, MIGRATION_0001);
    applyMigration(sqlite, MIGRATION_0002);
    applyMigration(sqlite, MIGRATION_0003);
    applyMigration(sqlite, MIGRATION_0004);

    const insert = "INSERT INTO `settings` (`key`,`value`) VALUES (?,?)";
    sqlite.prepare(insert).run("bearbeiter", "Max");
    sqlite.prepare(insert).run("unset_key", null);

    const rows = sqlite
      .prepare("SELECT `key`,`value` FROM `settings` ORDER BY `key`")
      .all() as Array<{ key: string; value: string | null }>;
    expect(rows).toEqual([
      { key: "bearbeiter", value: "Max" },
      { key: "unset_key", value: null },
    ]);
  });

  it("the breakpoint splitter yields only executable statements for 0004", () => {
    const sql = readFileSync(MIGRATION_0004, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    // Single-statement migration: exactly one CREATE TABLE.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE TABLE `settings`/);
  });
});
