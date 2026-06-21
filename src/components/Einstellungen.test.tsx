// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Einstellungen } from "./Einstellungen";
import type { Company } from "../data/companies";

// Minimal Company fixtures for the Stillgelegte list (only the fields the view
// reads: id, name, status).
function company(overrides: Partial<Company> = {}): Company {
  return {
    id: crypto.randomUUID(),
    name: "Test GmbH",
    fn: null,
    branche: null,
    groesse: null,
    status: "Tot",
    heiss: false,
    website: null,
    lessons: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_viewed: null,
    deleted_at: null,
    ...overrides,
  } as Company;
}

function renderView(props: Partial<Parameters<typeof Einstellungen>[0]> = {}) {
  const onSaveBearbeiter = vi.fn();
  const onClearAll = vi.fn();
  render(
    <Einstellungen
      bearbeiter=""
      onSaveBearbeiter={onSaveBearbeiter}
      stillgelegte={[]}
      onClearAll={onClearAll}
      {...props}
    />,
  );
  return { onSaveBearbeiter, onClearAll };
}

// If the view is tabbed, reveal a section by clicking its tab; if stacked, the
// section is already present. Either way, find the tab/heading by its label.
function openSection(label: string) {
  const tab = screen.queryByRole("button", { name: label });
  if (tab) fireEvent.click(tab);
}

describe("Einstellungen", () => {
  it("renders the three sections: Allgemein, Stillgelegte Firmen, Daten", () => {
    renderView();
    // The three section tabs are always present (their panels switch on click).
    expect(screen.getByRole("button", { name: "Allgemein" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Stillgelegte Firmen" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Daten" })).toBeTruthy();
  });

  // --- Daten danger zone ----------------------------------------------------
  it("clear-all button is disabled on mount", () => {
    renderView();
    openSection("Daten");
    const btn = screen.getByRole("button", {
      name: "Alle Daten löschen",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("typing anything other than the confirm word leaves the button disabled", () => {
    renderView();
    openSection("Daten");
    const input = screen.getByLabelText(/LÖSCHEN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "loschen" } });
    const btn = screen.getByRole("button", {
      name: "Alle Daten löschen",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("typing exactly LÖSCHEN enables the button and clicking calls onClearAll once", () => {
    const { onClearAll } = renderView();
    openSection("Daten");
    const input = screen.getByLabelText(/LÖSCHEN/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "LÖSCHEN" } });
    const btn = screen.getByRole("button", {
      name: "Alle Daten löschen",
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  // --- Allgemein ------------------------------------------------------------
  it("editing the Erfasst-als input and saving calls onSaveBearbeiter with the typed name", () => {
    const { onSaveBearbeiter } = renderView({ bearbeiter: "" });
    openSection("Allgemein");
    const input = screen.getByLabelText(/Erfasst als/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Eva" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(onSaveBearbeiter).toHaveBeenCalledTimes(1);
    expect(onSaveBearbeiter).toHaveBeenCalledWith("Eva");
  });

  it("shows the unset nudge (not the danger color) when bearbeiter is blank", () => {
    renderView({ bearbeiter: "" });
    openSection("Allgemein");
    expect(screen.getByText(/Noch kein Name gesetzt/)).toBeTruthy();
  });

  it("does not show the unset nudge when a name is configured", () => {
    renderView({ bearbeiter: "Max" });
    openSection("Allgemein");
    expect(screen.queryByText(/Noch kein Name gesetzt/)).toBeNull();
  });

  // --- Stillgelegte Firmen --------------------------------------------------
  it("renders the passed stillgelegte companies as a view-only list (no manual-status control)", () => {
    renderView({
      stillgelegte: [
        company({ name: "Chapter 4 GmbH", status: "Tot" }),
        company({ name: "Verlag Österreich GmbH", status: "Geparkt" }),
      ],
    });
    openSection("Stillgelegte Firmen");
    expect(screen.getByText("Chapter 4 GmbH")).toBeTruthy();
    expect(screen.getByText("Verlag Österreich GmbH")).toBeTruthy();
    // View-only: there is no status-setting control (no select, no
    // reactivate/setStatus button) in the Stillgelegte section.
    const list = screen
      .getByText("Chapter 4 GmbH")
      .closest("[data-section='stillgelegte']") as HTMLElement;
    expect(within(list).queryByRole("combobox")).toBeNull();
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("shows the empty-state copy when stillgelegte is empty", () => {
    renderView({ stillgelegte: [] });
    openSection("Stillgelegte Firmen");
    expect(screen.getByText("Keine stillgelegten Firmen")).toBeTruthy();
  });
});
