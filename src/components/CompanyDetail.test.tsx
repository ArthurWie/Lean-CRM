// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompanyDetail } from "./CompanyDetail";
import type { Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";

function contact(over: Partial<Contact> & Pick<Contact, "id" | "firma_id" | "name">): Contact {
  return {
    rolle: null,
    telefon: null,
    linkedin: null,
    li_angenommen: false,
    relevant: false,
    ...over,
  } as Contact;
}

function interaction(
  over: Partial<Interaction> & Pick<Interaction, "id" | "firma_id" | "datum">,
): Interaction {
  return {
    kontakt_id: null,
    kanal: "Telefon",
    outcome: "Gesprochen",
    notiz: "",
    bearbeiter: "Arthur",
    ...over,
  } as Interaction;
}

describe("CompanyDetail", () => {
  it("renders the Verlauf (Notizen) heading and one history line per interaction, newest-first (DB-06)", () => {
    const interactions: Interaction[] = [
      interaction({
        id: "i2",
        firma_id: "f1",
        datum: "2026-06-09T08:00:00Z",
        kanal: "Telefon",
        notiz: "Sehr enthusiastisch.",
      }),
      interaction({
        id: "i1",
        firma_id: "f1",
        datum: "2026-06-02T08:00:00Z",
        kanal: "LinkedIn",
        notiz: "Vernetzungsanfrage angenommen.",
      }),
    ];
    render(
      <CompanyDetail
        contacts={[]}
        interactions={interactions}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Verlauf (Notizen)")).toBeTruthy();
    const hist = document.querySelector(".hist") as HTMLElement;
    const lines = within(hist).getAllByText(/Arthur|enthusiastisch|angenommen/);
    // The two notes both render; newest (Telefon 09.06) appears before the older one.
    const text = hist.textContent ?? "";
    expect(text.indexOf("Sehr enthusiastisch.")).toBeLessThan(
      text.indexOf("Vernetzungsanfrage angenommen."),
    );
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders the Ansprechpartner block when contacts are present (DB-06)", () => {
    render(
      <CompanyDetail
        contacts={[contact({ id: "k1", firma_id: "f1", name: "Eva Mandl", rolle: "Geschäftsführerin" })]}
        interactions={[]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Ansprechpartner")).toBeTruthy();
    expect(screen.getByText("Eva Mandl")).toBeTruthy();
  });

  it("embeds the LogForm (Telefon channel button present) (DB-06/LOG-01)", () => {
    render(
      <CompanyDetail contacts={[]} interactions={[]} onSave={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Telefon" })).toBeTruthy();
  });

  it("calls onSave when the embedded form saves (LOG-03)", () => {
    const onSave = vi.fn();
    render(
      <CompanyDetail contacts={[]} interactions={[]} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Notiz." } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].outcome).toBe("Gesprochen");
  });

  // Addition 2: inline-confirm delete.
  it("does not render the Löschen action when onDelete is not provided", () => {
    render(<CompanyDetail contacts={[]} interactions={[]} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();
  });

  it("Löschen requires a second confirm click before firing onDelete (accidental-click guard)", () => {
    const onDelete = vi.fn();
    render(
      <CompanyDetail
        contacts={[]}
        interactions={[]}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    // First click only reveals the inline confirm — it must NOT delete.
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Wirklich löschen?")).toBeTruthy();

    // Confirming fires onDelete exactly once.
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Abbrechen dismisses the delete confirm without firing onDelete", () => {
    const onDelete = vi.fn();
    render(
      <CompanyDetail
        contacts={[]}
        interactions={[]}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onDelete).not.toHaveBeenCalled();
    // Back to the unconfirmed trigger.
    expect(screen.getByRole("button", { name: "Löschen" })).toBeTruthy();
    expect(screen.queryByText("Wirklich löschen?")).toBeNull();
  });
});
