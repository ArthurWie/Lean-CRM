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

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    async select(query: string, params: unknown[] = []) {
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
});

describe("interactions data layer", () => {
  it("logInteraction inserts a row with bearbeiter Arthur + UTC datum and re-derives firmen.status (LOG-01/04, DATA-06)", async () => {
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
    expect(rows[0].bearbeiter).toBe("Arthur");
    expect(rows[0].datum).toMatch(/^\d{4}-\d{2}-\d{2}T/); // UTC ISO

    const firma = await getFirma(firmaId);
    // Telefon "Gesprochen" → "Im Gespräch" per derive.ts
    expect(firma.status).toBe("Im Gespräch");
    expect(firma.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
});
