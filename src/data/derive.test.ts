// @vitest-environment node
//
// Pure-derivation unit tests (DATA-05 / LOG-04 / DB-05). derive.ts is a pure
// data-in/data-out module, so — unlike companies.test.ts — these tests need NO
// sqlite mock and NO migration: plain input→output assertions.
import { describe, expect, it } from "vitest";
import {
  deriveStatus,
  deriveNextStep,
  deriveNewestNote,
  hasNewNote,
} from "./derive";

// Interaction fixture factory, mirroring CompanyTable.test.tsx's company() style.
// Produces objects with the interaktionen field shape (id, firma_id, kontakt_id,
// datum, kanal, outcome, notiz, bearbeiter). Only datum/kanal/outcome/notiz/bearbeiter
// are meaningful to derivation; the rest satisfy the row shape.
function interaction(
  over: Partial<{
    id: string;
    firma_id: string;
    kontakt_id: string | null;
    datum: string;
    kanal: string | null;
    outcome: string | null;
    notiz: string | null;
    bearbeiter: string;
  }> = {},
) {
  return {
    id: "i1",
    firma_id: "f1",
    kontakt_id: null,
    datum: "2026-06-10T09:00:00.000Z",
    kanal: "Telefon",
    outcome: "Gesprochen",
    notiz: "Note text",
    bearbeiter: "Max",
    ...over,
  };
}

describe("deriveStatus (DATA-05 / D-01 / D-02 / D-06)", () => {
  it("returns Neu when there are no interactions (DATA-05)", () => {
    expect(deriveStatus([])).toBe("Neu");
  });

  it("maps every locked Telefon outcome to its status (D-01)", () => {
    const cases: Array<[string, string]> = [
      ["Gesprochen", "Im Gespräch"],
      ["Nicht erreicht", "Offen"],
      ["Rückruf vereinbart", "Offen"],
      ["Warteschlange", "Offen"],
      ["Termin vereinbart", "Termin"],
      ["Kein Interesse", "Kein Interesse"],
    ];
    for (const [outcome, status] of cases) {
      expect(
        deriveStatus([interaction({ kanal: "Telefon", outcome })]),
      ).toBe(status);
    }
  });

  it("uses the latest interaction by datum, order-independent in the input array (DATA-05)", () => {
    const older = interaction({
      id: "old",
      datum: "2026-06-01T09:00:00.000Z",
      outcome: "Kein Interesse",
    });
    const newer = interaction({
      id: "new",
      datum: "2026-06-15T09:00:00.000Z",
      outcome: "Gesprochen",
    });
    // Newest wins regardless of input order.
    expect(deriveStatus([older, newer])).toBe("Im Gespräch");
    expect(deriveStatus([newer, older])).toBe("Im Gespräch");
  });

  it("maps E-Mail outcomes per the resolved map (DATA-05)", () => {
    expect(
      deriveStatus([interaction({ kanal: "E-Mail", outcome: "Antwort erhalten" })]),
    ).toBe("Im Gespräch");
    expect(
      deriveStatus([interaction({ kanal: "E-Mail", outcome: "Gesendet" })]),
    ).toBe("Offen");
    expect(
      deriveStatus([interaction({ kanal: "E-Mail", outcome: "Termin vereinbart" })]),
    ).toBe("Termin");
  });

  it("maps LinkedIn outcomes per the resolved map (DATA-05)", () => {
    expect(
      deriveStatus([interaction({ kanal: "LinkedIn", outcome: "Angenommen" })]),
    ).toBe("Offen");
    expect(
      deriveStatus([interaction({ kanal: "LinkedIn", outcome: "Antwort erhalten" })]),
    ).toBe("Im Gespräch");
    expect(
      deriveStatus([interaction({ kanal: "LinkedIn", outcome: "Anfrage gesendet" })]),
    ).toBe("Offen");
  });

  it("returns a sticky manual Tot/Geparkt override regardless of interactions (D-02)", () => {
    const wouldBeTermin = interaction({ outcome: "Termin vereinbart" });
    expect(deriveStatus([wouldBeTermin], "Tot")).toBe("Tot");
    expect(deriveStatus([wouldBeTermin], "Geparkt")).toBe("Geparkt");
    // Override even wins over an empty set.
    expect(deriveStatus([], "Tot")).toBe("Tot");
  });

  it("re-derives correctly when the newest interaction is removed (D-06: pure function of the set)", () => {
    const older = interaction({
      id: "old",
      datum: "2026-06-01T09:00:00.000Z",
      outcome: "Kein Interesse",
    });
    const newer = interaction({
      id: "new",
      datum: "2026-06-15T09:00:00.000Z",
      outcome: "Gesprochen",
    });
    const full = [older, newer];
    expect(deriveStatus(full)).toBe("Im Gespräch");
    // Removing the newest flips back to the prior latest outcome — no stored state.
    expect(deriveStatus([older])).toBe("Kein Interesse");
  });

  it("does not mutate the input array (D-06)", () => {
    const a = interaction({ id: "a", datum: "2026-06-15T09:00:00.000Z" });
    const b = interaction({ id: "b", datum: "2026-06-01T09:00:00.000Z" });
    const input = [a, b];
    deriveStatus(input);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });

  it("falls back to Offen for an unmapped outcome (DATA-05)", () => {
    expect(
      deriveStatus([interaction({ kanal: "Telefon", outcome: "Unbekannt" })]),
    ).toBe("Offen");
  });
});

describe("deriveNextStep (LOG-04 / D-04)", () => {
  it("returns Erstkontakt planen when there is no latest interaction (LOG-04)", () => {
    expect(deriveNextStep(undefined)).toBe("Erstkontakt planen");
  });

  it("returns the locked label per outcome (D-04)", () => {
    const cases: Array<[string, string]> = [
      ["Gesprochen", "nachfassen"],
      ["Nicht erreicht", "nochmal anrufen"],
      ["Rückruf vereinbart", "Rückruf"],
      ["Warteschlange", "später nochmal"],
      ["Termin vereinbart", "Termin vorbereiten"],
      ["Kein Interesse", "—"],
      ["Gesendet", "nachfassen"],
      ["Antwort erhalten", "antworten"],
      ["Keine Antwort", "nachfassen"],
      ["Anfrage gesendet", "abwarten"],
      ["Angenommen", "Nachricht senden"],
      ["Nachricht gesendet", "abwarten"],
    ];
    for (const [outcome, label] of cases) {
      expect(deriveNextStep(interaction({ outcome }))).toBe(label);
    }
  });

  it("falls back to nachfassen for an unknown outcome (LOG-04)", () => {
    expect(deriveNextStep(interaction({ outcome: "Unbekannt" }))).toBe("nachfassen");
    expect(deriveNextStep(interaction({ outcome: null }))).toBe("nachfassen");
  });
});

describe("deriveNewestNote (DB-05 / D-08)", () => {
  it("returns null when there are no interactions (DB-05)", () => {
    expect(deriveNewestNote([])).toBeNull();
  });

  it("returns the newest interaction shaped as date/kanal/bearbeiter/notiz (D-08)", () => {
    const older = interaction({
      id: "old",
      datum: "2026-06-01T09:00:00.000Z",
      kanal: "Telefon",
      bearbeiter: "Max",
      notiz: "alt",
    });
    const newer = interaction({
      id: "new",
      datum: "2026-06-15T09:00:00.000Z",
      kanal: "E-Mail",
      bearbeiter: "Max",
      notiz: "neu",
    });
    expect(deriveNewestNote([older, newer])).toEqual({
      datum: "2026-06-15T09:00:00.000Z",
      kanal: "E-Mail",
      bearbeiter: "Max",
      notiz: "neu",
    });
  });

  it("coerces null kanal/notiz to empty strings (D-08)", () => {
    expect(
      deriveNewestNote([interaction({ kanal: null, notiz: null })]),
    ).toEqual({
      datum: "2026-06-10T09:00:00.000Z",
      kanal: "",
      bearbeiter: "Max",
      notiz: "",
    });
  });
});

describe("hasNewNote (DB-05 / D-07)", () => {
  const newest = { datum: "2026-06-15T09:00:00.000Z", kanal: "Telefon", bearbeiter: "Max", notiz: "x" };

  it("is false when there is no newest note (DB-05)", () => {
    expect(hasNewNote(null, null)).toBe(false);
    expect(hasNewNote(null, "2026-06-01T00:00:00.000Z")).toBe(false);
  });

  it("is true when the company was never viewed (D-07)", () => {
    expect(hasNewNote(newest, null)).toBe(true);
  });

  it("is true only when the newest datum is later than last_viewed (D-07)", () => {
    expect(hasNewNote(newest, "2026-06-10T00:00:00.000Z")).toBe(true); // newer than viewed
    expect(hasNewNote(newest, "2026-06-20T00:00:00.000Z")).toBe(false); // viewed after
    expect(hasNewNote(newest, "2026-06-15T09:00:00.000Z")).toBe(false); // equal → not new
  });
});
