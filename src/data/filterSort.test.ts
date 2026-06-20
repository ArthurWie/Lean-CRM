// @vitest-environment node
//
// Pure filter+sort unit tests (DB-04 / DB-08, D-10/11/12). filterSort.ts is a pure
// data-in/data-out module (mirrors derive.ts) — these tests need NO sqlite mock and
// NO jsdom: plain input→output assertions over Company[] + contactsByFirma.
import { describe, expect, it } from "vitest";
import { filterCompanies, sortCompanies, visibleCompanies, DEAD } from "./filterSort";
import type { Company, Contact } from "./companies";

// Minimal Company fixture — only the fields filter/sort read are meaningful.
function company(
  over: Partial<Company> & Pick<Company, "id" | "name" | "status">,
): Company {
  return {
    fn: null,
    branche: null,
    groesse: null,
    heiss: false,
    website: null,
    lessons: null,
    last_viewed: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Company;
}

function contact(
  over: Partial<Contact> & Pick<Contact, "id" | "firma_id">,
): Contact {
  return {
    name: null,
    rolle: null,
    telefon: null,
    linkedin: null,
    li_angenommen: false,
    relevant: false,
    emails: [],
    ...over,
  } as Contact;
}

describe("DEAD set", () => {
  it("contains exactly Tot and Geparkt", () => {
    expect(DEAD.has("Tot")).toBe(true);
    expect(DEAD.has("Geparkt")).toBe(true);
    expect(DEAD.has("Neu")).toBe(false);
    expect(DEAD.has("Offen")).toBe(false);
  });
});

describe("filterCompanies — dead toggle (D-11)", () => {
  const rows = [
    company({ id: "1", name: "Lebendig GmbH", status: "Offen" }),
    company({ id: "2", name: "Verstorben GmbH", status: "Tot" }),
    company({ id: "3", name: "Geparkt GmbH", status: "Geparkt" }),
  ];

  it("empty search + showDead=false returns only non-dead companies", () => {
    const out = filterCompanies(rows, {}, { search: "", showDead: false });
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });

  it("empty search + showDead=true returns ALL companies", () => {
    const out = filterCompanies(rows, {}, { search: "", showDead: true });
    expect(out.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
});

describe("filterCompanies — search match (D-10)", () => {
  const contactsByFirma: Record<string, Contact[]> = {
    "1": [contact({ id: "k1", firma_id: "1", name: "Eva Mandl" })],
    "2": [contact({ id: "k2", firma_id: "2", name: "Max Müller" })],
  };
  const rows = [
    company({
      id: "1",
      name: "Himmelhoch GmbH",
      status: "Offen",
      branche: "PR/Events",
      lessons: "Geheimwort steht hier",
    }),
    company({
      id: "2",
      name: "Chapter 4 GmbH",
      status: "Offen",
      branche: "IT-Security",
    }),
  ];

  it("matches case-insensitively against the company name", () => {
    const out = filterCompanies(rows, contactsByFirma, {
      search: "himmel",
      showDead: false,
    });
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });

  it("matches case-insensitively against branche", () => {
    const out = filterCompanies(rows, contactsByFirma, {
      search: "security",
      showDead: false,
    });
    expect(out.map((c) => c.id)).toEqual(["2"]);
  });

  it("matches case-insensitively against a contact name", () => {
    const out = filterCompanies(rows, contactsByFirma, {
      search: "müller",
      showDead: false,
    });
    expect(out.map((c) => c.id)).toEqual(["2"]);
  });

  it("does NOT match against lessons/notes", () => {
    const out = filterCompanies(rows, contactsByFirma, {
      search: "Geheimwort",
      showDead: false,
    });
    expect(out).toEqual([]);
  });

  it("trims surrounding whitespace from the query", () => {
    const out = filterCompanies(rows, contactsByFirma, {
      search: "  himmel  ",
      showDead: false,
    });
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });
});

describe("filterCompanies — stacked search + dead toggle (D-11)", () => {
  const rows = [
    company({ id: "1", name: "Alpha GmbH", status: "Offen", branche: "PR" }),
    company({ id: "2", name: "Alpha Tot GmbH", status: "Tot", branche: "PR" }),
  ];

  it("only rows passing BOTH predicates appear (search matches both, toggle hides the dead one)", () => {
    const out = filterCompanies(rows, {}, { search: "alpha", showDead: false });
    expect(out.map((c) => c.id)).toEqual(["1"]);
  });

  it("with showDead=true both matching rows appear", () => {
    const out = filterCompanies(rows, {}, { search: "alpha", showDead: true });
    expect(out.map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("sortCompanies — 🔥-first then German alpha (D-12)", () => {
  it("puts every hot company before every non-hot company", () => {
    const out = sortCompanies([
      company({ id: "1", name: "Alpha", status: "Offen", heiss: false }),
      company({ id: "2", name: "Zeta", status: "Offen", heiss: true }),
    ]);
    // Hot "Zeta" precedes non-hot "Alpha".
    expect(out.map((c) => c.name)).toEqual(["Zeta", "Alpha"]);
  });

  it("sorts alphabetically (German) within each group", () => {
    const out = sortCompanies([
      company({ id: "1", name: "Bravo", status: "Offen", heiss: true }),
      company({ id: "2", name: "Alpha", status: "Offen", heiss: true }),
      company({ id: "3", name: "Delta", status: "Offen", heiss: false }),
      company({ id: "4", name: "Charlie", status: "Offen", heiss: false }),
    ]);
    expect(out.map((c) => c.name)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("orders umlauts per German locale (ä sorts with a, not after z)", () => {
    const out = sortCompanies([
      company({ id: "1", name: "Zürich", status: "Offen" }),
      company({ id: "2", name: "Ärger", status: "Offen" }),
      company({ id: "3", name: "Anton", status: "Offen" }),
    ]);
    // German locale: Ä collates near A, well before Z.
    expect(out.map((c) => c.name)).toEqual(["Anton", "Ärger", "Zürich"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      company({ id: "1", name: "Beta", status: "Offen" }),
      company({ id: "2", name: "Alpha", status: "Offen" }),
    ];
    const snapshot = input.map((c) => c.name);
    sortCompanies(input);
    expect(input.map((c) => c.name)).toEqual(snapshot);
  });
});

describe("visibleCompanies — filter then sort composed", () => {
  it("applies the dead toggle + search, then 🔥-first German-alpha sort", () => {
    const rows = [
      company({ id: "1", name: "Zeta GmbH", status: "Offen", heiss: true, branche: "PR" }),
      company({ id: "2", name: "Alpha GmbH", status: "Offen", heiss: false, branche: "PR" }),
      company({ id: "3", name: "Tote GmbH", status: "Tot", heiss: true, branche: "PR" }),
    ];
    const out = visibleCompanies(rows, {}, { search: "pr", showDead: false });
    // "Tote" is dead → dropped; remaining sorted 🔥-first: Zeta(hot) then Alpha.
    expect(out.map((c) => c.id)).toEqual(["1", "2"]);
  });
});
