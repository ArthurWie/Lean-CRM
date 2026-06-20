// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ImportDialog } from "./ImportDialog";
import type { ClassifiedRow, RawRow } from "../data/import";

// Minimal RawRow factory — only `unternehmen` is read by the dialog (the itemized
// name), the rest are filled blank so the 13-column shape type-checks.
function rawRow(name: string): RawRow {
  return {
    unternehmen: name,
    fn: "",
    branche: "",
    groesse: "",
    website: "",
    ansprechpartner: "",
    rolle: "",
    telefon: "",
    email: "",
    linkedin: "",
    lessons: "",
    quelle: "",
    notiz: "",
  };
}

function classified(
  kind: ClassifiedRow["kind"],
  name: string,
  reason: string,
): ClassifiedRow {
  return { row: rawRow(name), kind, reason, match: null };
}

// A representative mix: 2 neu, 1 duplikat, 1 nicht-kontaktieren (Tot), 1 fehlerhaft.
function mixedRows(): ClassifiedRow[] {
  return [
    classified("neu", "Alpha GmbH", "neu"),
    classified("neu", "Beta AG", "neu"),
    classified("duplikat", "Gamma KG", "bereits vorhanden"),
    classified("nicht-kontaktieren", "Delta Tot GmbH", "als Tot markiert"),
    classified("fehlerhaft", "", "leerer Firmenname"),
  ];
}

describe("ImportDialog", () => {
  describe("preview mode", () => {
    it("shows the Import-Vorschau title and the preview summary line", () => {
      render(
        <ImportDialog mode="preview" rows={mixedRows()} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText("Import-Vorschau")).toBeTruthy();
      // Preview summary: X neu, Y Duplikate, Z nicht-kontaktieren, N fehlerhaft.
      expect(
        screen.getByText(/2 neu, 1 Duplikate, 1 nicht-kontaktieren, 1 fehlerhaft/),
      ).toBeTruthy();
    });

    it("renders the four itemized groups with their names", () => {
      render(
        <ImportDialog mode="preview" rows={mixedRows()} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText("Alpha GmbH")).toBeTruthy();
      expect(screen.getByText("Beta AG")).toBeTruthy();
      expect(screen.getByText("Gamma KG")).toBeTruthy();
      expect(screen.getByText("Delta Tot GmbH")).toBeTruthy();
      // group headings present
      expect(screen.getByText(/^Neu/)).toBeTruthy();
      expect(screen.getByText(/^Duplikate/)).toBeTruthy();
      expect(screen.getByText("Nicht kontaktieren")).toBeTruthy();
      expect(screen.getByText(/^Fehlerhaft/)).toBeTruthy();
    });

    it("renders Tot rows in the --hot Nicht-kontaktieren callout and NOT Geparkt rows", () => {
      // Geparkt matches are classified `duplikat` upstream (D-04), so they never
      // carry kind nicht-kontaktieren. The callout must contain only the Tot row.
      const rows: ClassifiedRow[] = [
        classified("duplikat", "Geparkt Firma GmbH", "bereits vorhanden"),
        classified("nicht-kontaktieren", "Toter Betrieb GmbH", "als Tot markiert"),
      ];
      render(
        <ImportDialog mode="preview" rows={rows} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      const callout = screen.getByTestId("group-nicht-kontaktieren");
      expect(within(callout).getByText("Toter Betrieb GmbH")).toBeTruthy();
      expect(within(callout).queryByText("Geparkt Firma GmbH")).toBeNull();
    });

    it("fires onConfirm with the neu rows when Bestätigen is clicked", () => {
      const onConfirm = vi.fn();
      render(
        <ImportDialog mode="preview" rows={mixedRows()} onConfirm={onConfirm} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const passed = onConfirm.mock.calls[0][0] as RawRow[];
      expect(passed.map((r) => r.unternehmen)).toEqual(["Alpha GmbH", "Beta AG"]);
    });

    it("disables Bestätigen and shows the empty hint when 0 neu", () => {
      const rows: ClassifiedRow[] = [
        classified("duplikat", "Gamma KG", "bereits vorhanden"),
        classified("nicht-kontaktieren", "Delta Tot GmbH", "als Tot markiert"),
      ];
      render(
        <ImportDialog mode="preview" rows={rows} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      const confirm = screen.getByRole("button", { name: "Bestätigen" }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      expect(screen.getByText("Keine neuen Firmen zu importieren.")).toBeTruthy();
    });

    it("closes on Escape (cancel)", () => {
      const onClose = vi.fn();
      render(
        <ImportDialog mode="preview" rows={mixedRows()} onConfirm={vi.fn()} onClose={onClose} />,
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("report mode", () => {
    it("shows the Import abgeschlossen title and the verbatim IMPORT-06 summary", () => {
      render(
        <ImportDialog mode="report" rows={mixedRows()} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText("Import abgeschlossen")).toBeTruthy();
      // 2 neu; übersprungen = duplikat (1) + nicht-kontaktieren (1) = 2; davon 1 nicht-kontaktieren.
      expect(
        screen.getByText("2 neu, 2 übersprungen (davon 1 nicht-kontaktieren)"),
      ).toBeTruthy();
    });

    it("shows the N-fehlerhaft line in report mode when there are errors", () => {
      render(
        <ImportDialog mode="report" rows={mixedRows()} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText("1 fehlerhaft übersprungen")).toBeTruthy();
    });

    it("has a single Schließen footer button that calls onClose", () => {
      const onClose = vi.fn();
      render(
        <ImportDialog mode="report" rows={mixedRows()} onConfirm={vi.fn()} onClose={onClose} />,
      );
      expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("uses the verbatim IMPORT-06 line with no fehlerhaft sub-line when N=0", () => {
      const rows: ClassifiedRow[] = [
        classified("neu", "Alpha GmbH", "neu"),
        classified("duplikat", "Gamma KG", "bereits vorhanden"),
      ];
      render(
        <ImportDialog mode="report" rows={rows} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(
        screen.getByText("1 neu, 1 übersprungen (davon 0 nicht-kontaktieren)"),
      ).toBeTruthy();
      expect(screen.queryByText(/fehlerhaft übersprungen/)).toBeNull();
    });
  });

  describe("error mode (wrong file format, 5a)", () => {
    it("shows Falsches Dateiformat and the schema hint, no groups, no Bestätigen", () => {
      render(<ImportDialog mode="error" rows={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByText("Falsches Dateiformat")).toBeTruthy();
      expect(screen.getByText(/erwartete Spaltenformat/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();
      expect(screen.getByRole("button", { name: "Schließen" })).toBeTruthy();
    });
  });
});
