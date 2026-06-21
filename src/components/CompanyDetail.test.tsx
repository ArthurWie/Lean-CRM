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
    relevant: false,
    emails: [],
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
    bearbeiter: "Max",
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
    const lines = within(hist).getAllByText(/Max|enthusiastisch|angenommen/);
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

  // --- D-08: editable contact management (Plan 03-04) ---

  it("renders BOTH emails of a contact in the Ansprechpartner block (DATA-04, multi-email)", () => {
    render(
      <CompanyDetail
        contacts={[
          contact({
            id: "k1",
            firma_id: "f1",
            name: "Eva Mandl",
            rolle: "Geschäftsführerin",
            emails: ["office@himmelhoch.at", "eva@himmelhoch.at"],
          }),
        ]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={vi.fn()}
        onDeleteContact={vi.fn()}
        onSetContactEmails={vi.fn()}
      />,
    );
    // Both emails are present as input values (multi-email display; emails[0] is
    // the primary used by Plan 01's Mail action).
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const values = inputs.map((i) => i.value);
    expect(values).toContain("office@himmelhoch.at");
    expect(values).toContain("eva@himmelhoch.at");
  });

  it("clicking + Ansprechpartner reveals an editable person block and committing a name calls onAddContact", () => {
    const onAddContact = vi.fn();
    render(
      <CompanyDetail
        contacts={[]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={onAddContact}
        onUpdateContact={vi.fn()}
        onDeleteContact={vi.fn()}
        onSetContactEmails={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Ansprechpartner" }));
    // The new-person name field appears; fill it and commit (Speichern). Scope to
    // the add block so we don't collide with the LogForm's own Speichern button.
    const addBlock = document.querySelector(".person-add") as HTMLElement;
    const nameInput = within(addBlock).getByPlaceholderText("Name");
    fireEvent.change(nameInput, { target: { value: "Neuer Kontakt" } });
    fireEvent.click(within(addBlock).getByRole("button", { name: "Speichern" }));
    expect(onAddContact).toHaveBeenCalledTimes(1);
    expect(onAddContact.mock.calls[0][0]).toMatchObject({ name: "Neuer Kontakt" });
  });

  it("committing an inline field edit calls onUpdateContact with the changed patch", () => {
    const onUpdateContact = vi.fn();
    render(
      <CompanyDetail
        contacts={[
          contact({ id: "k1", firma_id: "f1", name: "Eva Mandl", rolle: "GF" }),
        ]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={onUpdateContact}
        onDeleteContact={vi.fn()}
        onSetContactEmails={vi.fn()}
      />,
    );
    // Edit the role field inline (the existing contact's rolle input) and blur.
    const roleInput = screen.getByDisplayValue("GF") as HTMLInputElement;
    fireEvent.change(roleInput, { target: { value: "Geschäftsführerin" } });
    fireEvent.blur(roleInput);
    expect(onUpdateContact).toHaveBeenCalledTimes(1);
    expect(onUpdateContact.mock.calls[0][0]).toBe("k1");
    expect(onUpdateContact.mock.calls[0][1]).toMatchObject({
      rolle: "Geschäftsführerin",
    });
  });

  it("Entfernen shows the inline confirm (no modal); Ja calls onDeleteContact with the contact id", () => {
    const onDeleteContact = vi.fn();
    render(
      <CompanyDetail
        contacts={[contact({ id: "k1", firma_id: "f1", name: "Eva Mandl" })]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={vi.fn()}
        onDeleteContact={onDeleteContact}
        onSetContactEmails={vi.fn()}
      />,
    );
    // No dialog role anywhere (inline confirm, not a modal).
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));
    // First click only reveals the confirm — it must NOT delete.
    expect(onDeleteContact).not.toHaveBeenCalled();
    expect(screen.getByText("Wirklich entfernen?")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull(); // still inline, no modal

    fireEvent.click(screen.getByRole("button", { name: "Ja" }));
    expect(onDeleteContact).toHaveBeenCalledTimes(1);
    expect(onDeleteContact.mock.calls[0][0]).toBe("k1");
  });

  it("Abbrechen dismisses the contact-remove confirm without firing onDeleteContact", () => {
    const onDeleteContact = vi.fn();
    render(
      <CompanyDetail
        contacts={[contact({ id: "k1", firma_id: "f1", name: "Eva Mandl" })]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={vi.fn()}
        onDeleteContact={onDeleteContact}
        onSetContactEmails={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onDeleteContact).not.toHaveBeenCalled();
    expect(screen.queryByText("Wirklich entfernen?")).toBeNull();
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeTruthy();
  });

  it("editing an existing contact's email commits via onSetContactEmails", () => {
    const onSetContactEmails = vi.fn();
    render(
      <CompanyDetail
        contacts={[
          contact({
            id: "k1",
            firma_id: "f1",
            name: "Eva Mandl",
            emails: ["old@x.at"],
          }),
        ]}
        interactions={[]}
        onSave={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={vi.fn()}
        onDeleteContact={vi.fn()}
        onSetContactEmails={onSetContactEmails}
      />,
    );
    const mailInput = screen.getByDisplayValue("old@x.at") as HTMLInputElement;
    fireEvent.change(mailInput, { target: { value: "neu@x.at" } });
    fireEvent.blur(mailInput);
    expect(onSetContactEmails).toHaveBeenCalledTimes(1);
    expect(onSetContactEmails.mock.calls[0][0]).toBe("k1");
    expect(onSetContactEmails.mock.calls[0][1]).toEqual(["neu@x.at"]);
  });

  it("does not render contact-edit affordances when the handler props are absent (back-compat)", () => {
    render(
      <CompanyDetail
        contacts={[contact({ id: "k1", firma_id: "f1", name: "Eva Mandl" })]}
        interactions={[]}
        onSave={vi.fn()}
      />,
    );
    // The read-only block still shows the name, but no add/remove affordances.
    expect(screen.getByText("Eva Mandl")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Ansprechpartner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
  });
});
