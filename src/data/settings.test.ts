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
// Mock @tauri-apps/plugin-sql over a real in-memory SQLite (node:sqlite),
// mirroring companies.test.ts / interactions.test.ts. Exercises the real
// client.ts proxy + real Drizzle SQL. Stack 0001→0004 so `settings` exists.
// ---------------------------------------------------------------------------

const MIGRATION_PATHS = [
  "../../src-tauri/migrations/0001_init.sql",
  "../../src-tauri/migrations/0002_add_last_viewed.sql",
  "../../src-tauri/migrations/0003_add_deleted_at.sql",
  "../../src-tauri/migrations/0004_add_settings.sql",
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

// Records every non-SELECT statement reaching execute() so we can assert the
// upsert issues NO begin/commit (the sqlite-proxy pool landmine guard).
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
const { getSetting, setSetting, getBearbeiter, setBearbeiter } = await import(
  "./settings"
);

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
  executedSql.length = 0;
});

describe("settings data layer", () => {
  it("getSetting returns null when no row exists for the key", async () => {
    expect(await getSetting("missing")).toBeNull();
  });

  it("setSetting then getSetting round-trips the value", async () => {
    await setSetting("foo", "bar");
    expect(await getSetting("foo")).toBe("bar");
  });

  it("setSetting on an existing key overwrites it (upsert)", async () => {
    await setSetting("foo", "first");
    await setSetting("foo", "second");
    expect(await getSetting("foo")).toBe("second");

    // Exactly one row for the key (upsert, not duplicate insert).
    const rows = sqlite
      .prepare("SELECT `key`,`value` FROM `settings` WHERE `key` = ?")
      .all("foo");
    expect(rows).toHaveLength(1);
  });

  it("setSetting issues its write with no begin/commit (no db.transaction)", async () => {
    await setSetting("foo", "bar");
    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
  });

  it("getBearbeiter returns '' when unset — never 'Arthur'", async () => {
    const b = await getBearbeiter();
    expect(b).toBe("");
    expect(b).not.toBe("Arthur");
  });

  it("setBearbeiter then getBearbeiter round-trips the configured name", async () => {
    await setBearbeiter("Max");
    expect(await getBearbeiter()).toBe("Max");
  });

  it("setBearbeiter overwrites a previously configured name", async () => {
    await setBearbeiter("Max");
    await setBearbeiter("Eva");
    expect(await getBearbeiter()).toBe("Eva");
  });
});
