// @vitest-environment node
// Verifies migration 0002 adds firmen.last_viewed (DB-05/D-07): an in-memory
// SQLite built from 0001 + 0002 must have a nullable text last_viewed column,
// and the breakpoint splitter that companies.test.ts relies on must still yield
// only executable statements.
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

function applyMigration(dbInstance: DatabaseSyncType, path: string) {
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) dbInstance.exec(stmt);
}

describe("migration 0002: firmen.last_viewed (DB-05)", () => {
  it("adds a nullable text last_viewed column accepting a value or NULL", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigration(sqlite, MIGRATION_0001);
    applyMigration(sqlite, MIGRATION_0002);

    const cols = sqlite.prepare("PRAGMA table_info(`firmen`)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const lastViewed = cols.find((c) => c.name === "last_viewed");
    expect(lastViewed).toBeDefined();
    expect(lastViewed!.type.toLowerCase()).toBe("text");
    expect(lastViewed!.notnull).toBe(0); // nullable = never viewed

    // Insert a row with a timestamp and a row with NULL — both must succeed.
    const insert =
      "INSERT INTO `firmen` (`id`,`name`,`created_at`,`updated_at`,`last_viewed`) VALUES (?,?,?,?,?)";
    sqlite.prepare(insert).run("a", "Has viewed", "2026-06-19T00:00:00.000Z", "2026-06-19T00:00:00.000Z", "2026-06-19T10:00:00.000Z");
    sqlite.prepare(insert).run("b", "Never viewed", "2026-06-19T00:00:00.000Z", "2026-06-19T00:00:00.000Z", null);

    const rows = sqlite
      .prepare("SELECT `id`,`last_viewed` FROM `firmen` ORDER BY `id`")
      .all() as Array<{ id: string; last_viewed: string | null }>;
    expect(rows).toEqual([
      { id: "a", last_viewed: "2026-06-19T10:00:00.000Z" },
      { id: "b", last_viewed: null },
    ]);
  });
});
