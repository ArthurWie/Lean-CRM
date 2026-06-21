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
// copied VERBATIM from interactions.test.ts. This exercises the real client.ts
// proxy + real Drizzle SQL. Apply 0001/0002/0003 so the full schema exists.
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
// execute() — i.e. the real INSERT/UPDATE/DELETE (and any begin/commit). The
// no-begin/commit guard reads this to assert resolveDueFollowups does NOT wrap
// its write in db.transaction(), independent of object identity across the
// vi.mock module boundary (mirrors interactions.test.ts).
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
const { getFocusSnapshot, resolveDueFollowups } = await import("./focus");
const { db } = await import("../db/client");
const { firmen, interaktionen, followups } = await import("../db/schema");
const { eq } = await import("drizzle-orm");

// Seed a single firma directly via db, return its id.
async function seedFirma(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  await db.insert(firmen).values({
    id,
    name: "Test GmbH",
    status: "Neu",
    heiss: false,
    created_at: ts,
    updated_at: ts,
    ...overrides,
  });
  return id;
}

// Seed an open (or resolved) follow-up for a firma.
async function seedFollowup(
  firmaId: string,
  faellig_am: string,
  erledigt = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(followups).values({
    id,
    firma_id: firmaId,
    faellig_am,
    grund: null,
    erledigt,
  });
  return id;
}

// Seed a single interaction row for a firma (marks it "contacted").
async function seedInteraction(firmaId: string): Promise<void> {
  await db.insert(interaktionen).values({
    id: crypto.randomUUID(),
    firma_id: firmaId,
    datum: new Date().toISOString(),
    kanal: "Telefon",
    outcome: "Gesprochen",
    notiz: "x",
    bearbeiter: "Max",
  });
}

const NOW = new Date("2026-07-01T10:00:00Z");

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
});

describe("focus data layer — getFocusSnapshot", () => {
  it("order: due (most-overdue first, name tiebreak) -> hot (de-alpha) -> neu (de-alpha)", async () => {
    // due group (two firms, different overdue), one with a name tiebreak handled
    const dueOld = await seedFirma({ name: "Zeta GmbH", status: "Im Gespräch" });
    await seedFollowup(dueOld, "2026-06-25T00:00:00.000Z"); // 6 days overdue
    await seedInteraction(dueOld);
    const dueNew = await seedFirma({ name: "Alpha GmbH", status: "Offen" });
    await seedFollowup(dueNew, "2026-06-29T00:00:00.000Z"); // 2 days overdue
    await seedInteraction(dueNew);

    // hot group (de-alpha) — must come after all due
    const hotB = await seedFirma({ name: "Bär GmbH", status: "Offen", heiss: true });
    await seedInteraction(hotB);
    const hotA = await seedFirma({ name: "Ähre GmbH", status: "Offen", heiss: true });
    await seedInteraction(hotA);

    // neu group (zero interactions, de-alpha)
    await seedFirma({ name: "Wolke GmbH", status: "Neu" });
    await seedFirma({ name: "Insel GmbH", status: "Neu" });

    const snap = await getFocusSnapshot(NOW);
    const names = snap.map((c) => c.name);

    // due first, most-overdue (Zeta, 6d) before less-overdue (Alpha, 2d)
    expect(names.slice(0, 2)).toEqual(["Zeta GmbH", "Alpha GmbH"]);
    expect(snap[0].reason).toBe("followup");
    expect(snap[0].daysOverdue).toBe(6);
    // hot group, de-alpha (Ähre before Bär)
    expect(names.slice(2, 4)).toEqual(["Ähre GmbH", "Bär GmbH"]);
    expect(snap[2].reason).toBe("hot");
    // neu group, de-alpha (Insel before Wolke)
    expect(names.slice(4, 6)).toEqual(["Insel GmbH", "Wolke GmbH"]);
    expect(snap[4].reason).toBe("neu");
  });

  it("qualif: Tot/Geparkt excluded; Offen-no-due-not-hot excluded; Neu = zero interactions", async () => {
    // Tot/Geparkt with a due follow-up — still excluded
    const tot = await seedFirma({ name: "Tot GmbH", status: "Tot" });
    await seedFollowup(tot, "2026-06-20T00:00:00.000Z");
    const geparkt = await seedFirma({ name: "Geparkt GmbH", status: "Geparkt", heiss: true });
    await seedFollowup(geparkt, "2026-06-20T00:00:00.000Z");

    // Offen, contacted, no due follow-up, not hot — excluded
    const quiet = await seedFirma({ name: "Quiet GmbH", status: "Offen" });
    await seedInteraction(quiet);

    // Neu = zero interactions — included
    const neu = await seedFirma({ name: "Neu GmbH", status: "Neu" });

    const snap = await getFocusSnapshot(NOW);
    const ids = snap.map((c) => c.id);
    expect(ids).not.toContain(tot);
    expect(ids).not.toContain(geparkt);
    expect(ids).not.toContain(quiet);
    expect(ids).toContain(neu);
    expect(snap.find((c) => c.id === neu)!.reason).toBe("neu");
  });

  it("hot+due ranks in the due group (reason followup), ahead of hot-only", async () => {
    const hotAndDue = await seedFirma({ name: "Both GmbH", status: "Offen", heiss: true });
    await seedFollowup(hotAndDue, "2026-06-28T00:00:00.000Z"); // 3 days overdue
    await seedInteraction(hotAndDue);
    const hotOnly = await seedFirma({ name: "HotOnly GmbH", status: "Offen", heiss: true });
    await seedInteraction(hotOnly);

    const snap = await getFocusSnapshot(NOW);
    expect(snap[0].id).toBe(hotAndDue);
    expect(snap[0].reason).toBe("followup");
    expect(snap[0].daysOverdue).toBe(3);
    expect(snap[1].id).toBe(hotOnly);
    expect(snap[1].reason).toBe("hot");
  });

  it("due surfaces: an open follow-up dated <= today appears with reason followup and daysOverdue >= 0", async () => {
    const f = await seedFirma({ name: "Due Today GmbH", status: "Im Gespräch" });
    await seedFollowup(f, "2026-07-01T00:00:00.000Z"); // due today
    await seedInteraction(f);

    const snap = await getFocusSnapshot(NOW);
    const row = snap.find((c) => c.id === f);
    expect(row).toBeDefined();
    expect(row!.reason).toBe("followup");
    expect(row!.daysOverdue).toBeGreaterThanOrEqual(0);
    expect(row!.daysOverdue).toBe(0);
  });

  it("a resolved (erledigt=true) follow-up does NOT surface the company", async () => {
    const f = await seedFirma({ name: "Resolved GmbH", status: "Im Gespräch" });
    await seedFollowup(f, "2026-06-25T00:00:00.000Z", true); // already resolved
    await seedInteraction(f);

    const snap = await getFocusSnapshot(NOW);
    expect(snap.map((c) => c.id)).not.toContain(f);
  });
});

describe("focus data layer — resolveDueFollowups", () => {
  it("resolve marks due: every open follow-up dated <= end-of-today becomes erledigt=true", async () => {
    const f = await seedFirma();
    await seedFollowup(f, "2026-06-25T00:00:00.000Z"); // overdue
    await seedFollowup(f, "2026-07-01T00:00:00.000Z"); // due today (midnight UTC)

    await resolveDueFollowups(f, NOW);

    const rows = await db.select().from(followups).where(eq(followups.firma_id, f));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.erledigt === true)).toBe(true);
  });

  it("survives: a future-dated follow-up is NOT resolved (the new follow-up the same log created)", async () => {
    const f = await seedFirma();
    const dueId = await seedFollowup(f, "2026-06-25T00:00:00.000Z"); // overdue
    const futureId = await seedFollowup(f, "2026-07-08T00:00:00.000Z"); // +7 days

    await resolveDueFollowups(f, NOW);

    const rows = await db.select().from(followups).where(eq(followups.firma_id, f));
    const due = rows.find((r) => r.id === dueId)!;
    const future = rows.find((r) => r.id === futureId)!;
    expect(due.erledigt).toBe(true);
    expect(future.erledigt).toBe(false);
  });

  it("only touches the target firma's follow-ups", async () => {
    const a = await seedFirma({ name: "A GmbH" });
    const b = await seedFirma({ name: "B GmbH" });
    await seedFollowup(a, "2026-06-25T00:00:00.000Z");
    const bDue = await seedFollowup(b, "2026-06-25T00:00:00.000Z");

    await resolveDueFollowups(a, NOW);

    const bRows = await db.select().from(followups).where(eq(followups.id, bDue));
    expect(bRows[0].erledigt).toBe(false);
  });

  // REGRESSION (mirrors interactions.test.ts:270-291): resolveDueFollowups must
  // NOT wrap its write in db.transaction(). The sqlite-proxy issues begin/commit
  // as separate pooled round-trips, so a transaction silently fails to persist in
  // the real Tauri app (a single-connection mock hides it). Assert NO begin/commit
  // reaches the execute path, and that at least one update "followups" does.
  it("no begin: resolveDueFollowups issues its write with no begin/commit (no db.transaction)", async () => {
    const f = await seedFirma();
    await seedFollowup(f, "2026-06-25T00:00:00.000Z");

    executedSql.length = 0;
    await resolveDueFollowups(f, NOW);

    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
    expect(executedSql.some((s) => /update "followups"/i.test(s))).toBe(true);
  });
});
