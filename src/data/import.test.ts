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
// mirroring companies.test.ts / interactions.test.ts EXACTLY. This exercises
// the real client.ts proxy + real Drizzle SQL. Apply all three migrations so
// the firmen/kontakte/kontakt_mails/interaktionen/followups schema exists.
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
// trips the proxy makes. The no-transaction tests read this to assert importCsv
// and clearAllData do NOT wrap their writes in db.transaction(), independent of
// object identity across the vi.mock module boundary (mirrors interactions.test).
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
const {
  normFn,
  normDomain,
  normName,
  tokenizeEmails,
  validateHeader,
  mergeLessons,
  hasAnyContactField,
  matchCompany,
  classifyRows,
  importCsv,
  clearAllData,
  HEADER,
} = await import("./import");
const { db } = await import("../db/client");
const { firmen, kontakte, kontakt_mails, interaktionen, followups } = await import(
  "../db/schema"
);

// Read the literal lead-hunter CSVs from the repo root as fixtures (mirrors
// companies.test.ts:3). Used only to pull the real legal-form names the D-02
// match must / must not collide on — no papaparse here (Plan 02 owns parsing).
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const beispielCsv = readFileSync(REPO_ROOT + "leads-beispiel.csv", "utf8");
const book1Csv = readFileSync(REPO_ROOT + "leads-book1.csv", "utf8");

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  applyMigration(sqlite);
  executedSql.length = 0;
});

// Minimal RawRow factory: every column defaults to "" so a test sets only what
// it exercises (mirrors the real papaparse header:true row shape).
function row(overrides: Partial<Record<(typeof HEADER)[number], string>> = {}) {
  const base = Object.fromEntries(HEADER.map((h) => [h, ""])) as Record<
    (typeof HEADER)[number],
    string
  >;
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// PURE HELPERS (Task 1)
// ---------------------------------------------------------------------------

describe("validateHeader (IMPORT-01 / D-06)", () => {
  const good = [
    "unternehmen", "fn", "branche", "groesse", "website", "ansprechpartner",
    "rolle", "telefon", "email", "linkedin", "lessons", "quelle", "notiz",
  ];

  it("accepts the exact 13-column lead-hunter header in order", () => {
    expect(validateHeader(good)).toBe(true);
  });

  it("accepts the literal header line of both sample CSVs", () => {
    const beHeader = beispielCsv.split(/\r?\n/)[0].split(",");
    const bkHeader = book1Csv.split(/\r?\n/)[0].split(",");
    expect(validateHeader(beHeader)).toBe(true);
    expect(validateHeader(bkHeader)).toBe(true);
  });

  it("rejects a header of the wrong length", () => {
    expect(validateHeader(good.slice(0, 12))).toBe(false);
    expect(validateHeader([...good, "extra"])).toBe(false);
  });

  it("rejects a header in the wrong order", () => {
    const swapped = [...good];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(validateHeader(swapped)).toBe(false);
  });

  it("rejects a duplicate column (papaparse renames it to notiz_1 → no exact match)", () => {
    const dup = [...good];
    dup[12] = "notiz_1"; // what papaparse produces for a second "notiz"
    expect(validateHeader(dup)).toBe(false);
  });

  it("rejects undefined fields", () => {
    expect(validateHeader(undefined)).toBe(false);
  });

  // BOM contract: a U+FEFF-prefixed first header fails validation, documenting
  // that the caller (Plan 02 parse path) MUST strip the BOM before validating.
  it("rejects a header whose first column carries a leading BOM (caller must strip first)", () => {
    const bommed = ["﻿unternehmen", ...good.slice(1)];
    expect(validateHeader(bommed)).toBe(false);
  });
});

describe("tokenizeEmails (IMPORT-02 / D-09)", () => {
  it("splits on ; into trimmed tokens", () => {
    expect(tokenizeEmails("a@x.at;b@x.at")).toEqual(["a@x.at", "b@x.at"]);
  });
  it("drops a trailing empty token", () => {
    expect(tokenizeEmails("a@x.at;b@x.at;")).toEqual(["a@x.at", "b@x.at"]);
  });
  it("returns [] for empty / undefined", () => {
    expect(tokenizeEmails("")).toEqual([]);
    expect(tokenizeEmails(undefined)).toEqual([]);
  });
  it("trims surrounding whitespace and drops blank tokens", () => {
    expect(tokenizeEmails("  a@x.at ; ; b@x.at ")).toEqual(["a@x.at", "b@x.at"]);
  });
  it("matches the literal beispiel multi-email cell", () => {
    expect(tokenizeEmails("office@falter.at;schlager@falter.at")).toEqual([
      "office@falter.at",
      "schlager@falter.at",
    ]);
  });
});

describe("normFn (IMPORT-03)", () => {
  it("strips a leading 'FN ' prefix", () => {
    expect(normFn("FN 123456a")).toBe("123456a");
  });
  it("is a no-op on a bare number", () => {
    expect(normFn("123456a")).toBe("123456a");
  });
  it("returns '' for empty", () => {
    expect(normFn("")).toBe("");
  });
  it("lowercases", () => {
    expect(normFn("FN 71400X")).toBe("71400x");
  });
});

describe("normDomain (IMPORT-03)", () => {
  it("strips protocol, www, and path/query", () => {
    expect(normDomain("https://www.bettertogether.com/de?x=1")).toBe(
      "bettertogether.com",
    );
  });
  it("lowercases", () => {
    expect(normDomain("Bettertogether.com")).toBe("bettertogether.com");
  });
  it("returns '' for empty", () => {
    expect(normDomain("")).toBe("");
  });
});

describe("normName + legal-form strip (D-02)", () => {
  it("Himmelhoch GmbH collides with the seed name Himmelhoch", () => {
    expect(normName("Himmelhoch GmbH")).toBe(normName("Himmelhoch"));
  });

  it("the two Trauner variants do NOT collide", () => {
    expect(normName("Trauner Verlag GmbH")).not.toBe(
      normName("Trauner Verlag + Buchservice GmbH"),
    );
  });

  it("strips the literal book1 multi-word legal-form suffixes (keeps the stem)", () => {
    // "Gesellschaft m.b.H." is itself the trailing legal-form token (D-02) — the
    // descriptive stem that remains is "Bohmann Druck und Verlag".
    expect(normName("Bohmann Druck- und Verlag Gesellschaft m.b.H.")).toBe(
      "bohmann druck und verlag",
    );
    // "Verlagsgesellschaft" is the descriptive stem; only the "m.b.H." suffix strips.
    expect(normName("Falter Verlagsgesellschaft m.b.H.")).toBe(
      "falter verlagsgesellschaft",
    );
    // "Werbegesellschaft" is the descriptive stem; only "mbH" strips.
    expect(normName("Demner, Merlicek & Bergmann Werbegesellschaft mbH")).toBe(
      "demner merlicek bergmann werbegesellschaft",
    );
    // "GmbH & Co. KG" strips as one trailing token (longest-first).
    expect(normName("Serviceplan Austria GmbH & Co. KG")).toBe(
      "serviceplan austria",
    );
  });

  it("returns '' for empty", () => {
    expect(normName("")).toBe("");
  });
});

describe("mergeLessons (D-01)", () => {
  it("uses notiz when lessons empty", () => {
    expect(mergeLessons("", "ACHTUNG: Nummer existiert nicht")).toBe(
      "ACHTUNG: Nummer existiert nicht",
    );
  });
  it("joins both with ' — '", () => {
    expect(mergeLessons("a", "b")).toBe("a — b");
  });
  it("returns null when both empty", () => {
    expect(mergeLessons("", "")).toBeNull();
  });
});

describe("hasAnyContactField (D-09)", () => {
  it("true when any of ansprechpartner/rolle/telefon/linkedin/email is set", () => {
    expect(hasAnyContactField(row({ telefon: "+43 1 2345" }))).toBe(true);
    expect(hasAnyContactField(row({ ansprechpartner: "Eva" }))).toBe(true);
    expect(hasAnyContactField(row({ email: "a@x.at" }))).toBe(true);
    expect(hasAnyContactField(row({ linkedin: "in/x" }))).toBe(true);
    expect(hasAnyContactField(row({ rolle: "GF" }))).toBe(true);
  });
  it("false when all contact fields empty (name/branche/groesse only)", () => {
    expect(
      hasAnyContactField(
        row({ unternehmen: "X GmbH", branche: "PR", groesse: "~30" }),
      ),
    ).toBe(false);
  });
});

// matchCompany / classifyRows operate over a Candidate shape carrying the
// normalizable raw fields + status. Existing DB companies are mapped into it;
// accepted-this-run rows are appended (D-03).
function candidate(
  name: string,
  status = "Neu",
  extra: { fn?: string; website?: string } = {},
) {
  return { name, status, fn: extra.fn ?? "", website: extra.website ?? "" };
}

describe("matchCompany cascade (D-03)", () => {
  it("FN hit stops before domain/name (different name still matches by FN)", () => {
    const cands = [candidate("Other GmbH", "Neu", { fn: "FN 123456a" })];
    const hit = matchCompany(
      row({ unternehmen: "Totally Different GmbH", fn: "FN 123456a" }),
      cands,
    );
    expect(hit).toBe(cands[0]);
  });

  it("empty FN falls through to domain", () => {
    const cands = [candidate("X GmbH", "Neu", { website: "bettertogether.com" })];
    const hit = matchCompany(
      row({ unternehmen: "Different GmbH", website: "https://www.bettertogether.com/de" }),
      cands,
    );
    expect(hit).toBe(cands[0]);
  });

  it("empty domain falls through to name", () => {
    const cands = [candidate("Himmelhoch GmbH")];
    const hit = matchCompany(row({ unternehmen: "Himmelhoch" }), cands);
    expect(hit).toBe(cands[0]);
  });

  it("returns null when nothing matches", () => {
    const cands = [candidate("Himmelhoch GmbH")];
    expect(matchCompany(row({ unternehmen: "Brand New GmbH" }), cands)).toBeNull();
  });
});

describe("classifyRows (D-04 / D-05 / D-07)", () => {
  it("a row matching a Tot company → nicht-kontaktieren", () => {
    const existing = [candidate("Chapter 4 GmbH", "Tot")];
    const out = classifyRows([row({ unternehmen: "Chapter 4 GmbH" })], existing);
    expect(out[0].kind).toBe("nicht-kontaktieren");
  });

  it("a row matching a Geparkt company → duplikat (NOT loud)", () => {
    const existing = [candidate("Verlag Österreich GmbH", "Geparkt")];
    const out = classifyRows(
      [row({ unternehmen: "Verlag Österreich GmbH" })],
      existing,
    );
    expect(out[0].kind).toBe("duplikat");
  });

  it("a row matching an active company → duplikat", () => {
    const existing = [candidate("Himmelhoch GmbH", "Im Gespräch")];
    const out = classifyRows([row({ unternehmen: "Himmelhoch" })], existing);
    expect(out[0].kind).toBe("duplikat");
  });

  it("an empty-name row → fehlerhaft with the leerer-Firmenname reason", () => {
    const out = classifyRows([row({ unternehmen: "   " })], []);
    expect(out[0].kind).toBe("fehlerhaft");
    expect(out[0].reason).toMatch(/leerer Firmenname/i);
  });

  it("a brand-new row → neu", () => {
    const out = classifyRows([row({ unternehmen: "Brand New GmbH" })], []);
    expect(out[0].kind).toBe("neu");
  });

  it("within-file repeat → duplikat (first occurrence wins)", () => {
    const out = classifyRows(
      [
        row({ unternehmen: "Doppelt GmbH" }),
        row({ unternehmen: "Doppelt GmbH" }),
      ],
      [],
    );
    expect(out[0].kind).toBe("neu");
    expect(out[1].kind).toBe("duplikat");
    expect(out[1].reason).toMatch(/bereits in dieser Datei/i);
  });

  it("every classified row carries its raw row + a reason string", () => {
    const out = classifyRows([row({ unternehmen: "Brand New GmbH" })], []);
    expect(out[0].row.unternehmen).toBe("Brand New GmbH");
    expect(typeof out[0].reason).toBe("string");
  });
});
