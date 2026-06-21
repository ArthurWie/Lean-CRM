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
// mirroring companies.test.ts EXACTLY. This exercises the real client.ts proxy
// + real Drizzle SQL. Apply BOTH 0001 and 0002 so firmen.last_viewed exists.
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

// A hoisted recorder of every non-SELECT statement that reaches the plugin's
// execute() — i.e. the real INSERT/UPDATE/DELETE (and any begin/commit) round-
// trips the proxy makes. The regression test reads this to assert the logging /
// note / delete writes do NOT wrap themselves in db.transaction(), independent
// of object identity across the vi.mock module boundary (mirrors companies.test).
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

// D6-02/D6-03: logInteraction now reads the configured name via settings.ts.
// Mock getBearbeiter so each test controls the recorded bearbeiter independently
// of any persisted setting. Default: "" (unset). Individual tests override it.
const { bearbeiterValue } = vi.hoisted(() => ({ bearbeiterValue: { current: "" } }));
vi.mock("./settings", () => ({
  getBearbeiter: vi.fn(async () => bearbeiterValue.current),
}));

// Import AFTER the mock is registered.
const {
  logInteraction,
  listInteractions,
  editInteraction,
  deleteInteraction,
  updateInteractionNote,
} = await import("./interactions");
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

async function getFirma(id: string) {
  const rows = await db.select().from(firmen).where(eq(firmen.id, id));
  return rows[0];
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
  bearbeiterValue.current = ""; // default: no configured name
});

describe("interactions data layer", () => {
  it("logInteraction records the configured bearbeiter + UTC datum and re-derives firmen.status (LOG-01/04, DATA-06, SET-02)", async () => {
    bearbeiterValue.current = "Max"; // configured name
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "Kurz gesprochen.",
    });

    const rows = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect(rows).toHaveLength(1);
    expect(rows[0].bearbeiter).toBe("Max");
    expect(rows[0].datum).toMatch(/^\d{4}-\d{2}-\d{2}T/); // UTC ISO

    const firma = await getFirma(firmaId);
    // Telefon "Gesprochen" → "Im Gespräch" per derive.ts
    expect(firma.status).toBe("Im Gespräch");
    expect(firma.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("logInteraction records bearbeiter '' (blank) when no name is configured — never a hard-coded default (SET-02/D6-03)", async () => {
    bearbeiterValue.current = ""; // unset
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "Ohne Namen.",
    });

    const rows = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect(rows).toHaveLength(1);
    expect(rows[0].bearbeiter).toBe("");
  });

  it("logInteraction with a follow-up inserts a followups row with erledigt false (LOG-03)", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Rückruf vereinbart",
      notiz: "Ruft zurück.",
      followup: { faellig_am: "2026-07-01T00:00:00.000Z", grund: "Rückruf" },
    });

    const fups = await db
      .select()
      .from(followups)
      .where(eq(followups.firma_id, firmaId));
    expect(fups).toHaveLength(1);
    expect(fups[0].faellig_am).toBe("2026-07-01T00:00:00.000Z");
    expect(fups[0].grund).toBe("Rückruf");
    expect(fups[0].erledigt).toBe(false);
  });

  it("logInteraction with heiss:true sets firmen.heiss (🔥)", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "Interessiert.",
      heiss: true,
    });
    const firma = await getFirma(firmaId);
    expect(firma.heiss).toBe(true);
  });

  it("editInteraction changing outcome re-derives firmen.status (D-06)", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen", // → Im Gespräch
      notiz: "x",
    });
    const [row] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect((await getFirma(firmaId)).status).toBe("Im Gespräch");

    await editInteraction(row.id, { outcome: "Termin vereinbart" }); // → Termin
    expect((await getFirma(firmaId)).status).toBe("Termin");
  });

  it("deleteInteraction of the only interaction returns firmen.status to Neu (D-06)", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "x",
    });
    const [row] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect((await getFirma(firmaId)).status).toBe("Im Gespräch");

    await deleteInteraction(row.id);
    const rows = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect(rows).toHaveLength(0);
    expect((await getFirma(firmaId)).status).toBe("Neu");
  });

  it("a sticky manual Tot override is preserved through logInteraction, but the row is still inserted (D-02)", async () => {
    const firmaId = await seedFirma({ status: "Tot" });
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen", // would normally → Im Gespräch
      notiz: "Doch erreicht.",
    });

    // Status stays Tot (manual override is sticky)...
    expect((await getFirma(firmaId)).status).toBe("Tot");
    // ...but the interaktionen row IS inserted (history preserved).
    const rows = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect(rows).toHaveLength(1);
  });

  it("updateInteractionNote rewrites only the target interaction's notiz, leaving outcome/kanal (and thus status) intact", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen", // → Im Gespräch
      notiz: "Alte Notiz.",
    });
    const [row] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));
    expect((await getFirma(firmaId)).status).toBe("Im Gespräch");

    await updateInteractionNote(row.id, "Neue Notiz.");

    const after = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.id, row.id));
    expect(after[0].notiz).toBe("Neue Notiz.");
    // outcome/kanal untouched → derived status unchanged
    expect(after[0].outcome).toBe("Gesprochen");
    expect(after[0].kanal).toBe("Telefon");
    expect((await getFirma(firmaId)).status).toBe("Im Gespräch");
  });

  it("updateInteractionNote on a missing id is a no-op (does not throw)", async () => {
    await expect(
      updateInteractionNote(crypto.randomUUID(), "x"),
    ).resolves.toBeUndefined();
  });

  it("listInteractions returns only the target firma's interactions", async () => {
    const a = await seedFirma({ name: "A GmbH" });
    const b = await seedFirma({ name: "B GmbH" });
    await logInteraction({ firma_id: a, kanal: "Telefon", outcome: "Gesprochen", notiz: "a1" });
    await logInteraction({ firma_id: a, kanal: "Telefon", outcome: "Nicht erreicht", notiz: "a2" });
    await logInteraction({ firma_id: b, kanal: "Telefon", outcome: "Gesprochen", notiz: "b1" });

    const aRows = await listInteractions(a);
    expect(aRows).toHaveLength(2);
    expect(aRows.every((r) => r.firma_id === a)).toBe(true);
  });

  // REGRESSION (runtime logging/note bug): the interaction mutations must NOT wrap
  // their writes in db.transaction(). The sqlite-proxy issues begin/statements/
  // commit as separate proxy round-trips, and the real Tauri plugin serves each
  // from an sqlx pool, so begin/writes/commit can land on different connections →
  // commit throws → logging and edited notes silently fail to persist in the
  // running app (the single-connection test mock hid it). These tests assert NO
  // begin/commit reach the execute path — they fail if anyone reintroduces a
  // transaction wrapper around logInteraction/editInteraction/deleteInteraction.
  it("logInteraction issues its writes with no begin/commit (no db.transaction)", async () => {
    const firmaId = await seedFirma();
    executedSql.length = 0;
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Rückruf vereinbart",
      notiz: "x",
      heiss: true,
      followup: { faellig_am: "2026-07-01T00:00:00.000Z", grund: "Rückruf" },
    });

    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
    // The real writes still fire: insert interaction, set heiss, insert followup,
    // update status on re-derive.
    expect(executedSql.some((s) => /insert into "interaktionen"/i.test(s))).toBe(true);
    expect(executedSql.some((s) => /insert into "followups"/i.test(s))).toBe(true);
    expect(executedSql.some((s) => /update "firmen"/i.test(s))).toBe(true);
  });

  it("editInteraction (and updateInteractionNote) issues its writes with no begin/commit", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "alt",
    });
    const [row] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));

    executedSql.length = 0;
    await updateInteractionNote(row.id, "neu");

    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
    expect(executedSql.some((s) => /update "interaktionen"/i.test(s))).toBe(true);
    // and the note actually persisted (the runtime symptom this guards against)
    const [after] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.id, row.id));
    expect(after.notiz).toBe("neu");
  });

  it("deleteInteraction issues its writes with no begin/commit", async () => {
    const firmaId = await seedFirma();
    await logInteraction({
      firma_id: firmaId,
      kanal: "Telefon",
      outcome: "Gesprochen",
      notiz: "x",
    });
    const [row] = await db
      .select()
      .from(interaktionen)
      .where(eq(interaktionen.firma_id, firmaId));

    executedSql.length = 0;
    await deleteInteraction(row.id);

    const ctrl = executedSql.filter((sql) =>
      /^\s*(begin|commit|rollback)\b/i.test(sql),
    );
    expect(ctrl).toHaveLength(0);
    expect(executedSql.some((s) => /delete from "interaktionen"/i.test(s))).toBe(true);
  });
});
