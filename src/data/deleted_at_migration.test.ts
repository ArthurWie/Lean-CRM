// @vitest-environment node
// Verifies migration 0003 adds firmen.deleted_at (soft-delete / "Zuletzt
// gelöscht"): an in-memory SQLite built from 0001 + 0002 + 0003 must have a
// nullable text deleted_at column, and the breakpoint splitter the data-layer
// tests rely on must still yield only executable statements.
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

function applyMigration(dbInstance: DatabaseSyncType, path: string) {
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) dbInstance.exec(stmt);
}

describe("migration 0003: firmen.deleted_at (soft-delete)", () => {
  it("adds a nullable text deleted_at column accepting a value or NULL", () => {
    const sqlite = new DatabaseSync(":memory:");
    applyMigration(sqlite, MIGRATION_0001);
    applyMigration(sqlite, MIGRATION_0002);
    applyMigration(sqlite, MIGRATION_0003);

    const cols = sqlite.prepare("PRAGMA table_info(`firmen`)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const deletedAt = cols.find((c) => c.name === "deleted_at");
    expect(deletedAt).toBeDefined();
    expect(deletedAt!.type.toLowerCase()).toBe("text");
    expect(deletedAt!.notnull).toBe(0); // nullable = not deleted

    // Insert a row with a timestamp and a row with NULL — both must succeed.
    const insert =
      "INSERT INTO `firmen` (`id`,`name`,`created_at`,`updated_at`,`deleted_at`) VALUES (?,?,?,?,?)";
    sqlite
      .prepare(insert)
      .run("a", "Soft deleted", "2026-06-19T00:00:00.000Z", "2026-06-19T00:00:00.000Z", "2026-06-20T10:00:00.000Z");
    sqlite
      .prepare(insert)
      .run("b", "Active", "2026-06-19T00:00:00.000Z", "2026-06-19T00:00:00.000Z", null);

    const rows = sqlite
      .prepare("SELECT `id`,`deleted_at` FROM `firmen` ORDER BY `id`")
      .all() as Array<{ id: string; deleted_at: string | null }>;
    expect(rows).toEqual([
      { id: "a", deleted_at: "2026-06-20T10:00:00.000Z" },
      { id: "b", deleted_at: null },
    ]);
  });
});
