// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompanyTable } from "./CompanyTable";
import type { Company, Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";

// Mock the OS-shell opener so contact-action clicks assert the exact URL handed
// to openUrl without touching the OS (mirrors the plugin-sql mock shape).
const openUrl = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

function contact(
  over: Partial<Contact> & Pick<Contact, "id" | "firma_id">,
): Contact {
  return {
    name: "Eva Mandl",
    rolle: null,
    telefon: null,
    linkedin: null,
    li_angenommen: false,
    relevant: false,
    emails: [],
    ...over,
  } as Contact;
}

// Minimal Company fixtures. Only the fields the table reads are meaningful;
// the rest satisfy the type. created_at/updated_at are required strings.
function company(over: Partial<Company> & Pick<Company, "id" | "name" | "status">): Company {
  return {
    fn: null,
    branche: null,
    groesse: null,
    heiss: false,
    website: null,
    lessons: null,
    last_viewed: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Company;
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

const HEADERS = [
  "Unternehmen",
  "Branche",
  "Größe",
  "Ansprechpartner",
  "Kontakt",
  "Status",
  "Nächster Schritt",
  "Notizen",
  "Lessons learned",
];

describe("CompanyTable", () => {
  it("renders exactly the nine column headers in order (DB-01)", () => {
    render(<CompanyTable companies={[company({ id: "1", name: "Acme GmbH", status: "Neu" })]} />);
    const ths = screen.getAllByRole("columnheader").map((th) => th.textContent?.trim());
    expect(ths).toEqual(HEADERS);
  });

  it("hides Tot/Geparkt rows by default and reveals them via the Tot/Geparkt filter (DB-03)", () => {
    render(
      <CompanyTable
        companies={[
          company({ id: "1", name: "Lebendig GmbH", status: "Offen" }),
          company({ id: "2", name: "Verstorben GmbH", status: "Tot" }),
          company({ id: "3", name: "Geparkt GmbH", status: "Geparkt" }),
        ]}
      />,
    );

    // Default: only the active company is visible.
    expect(screen.queryByText("Lebendig GmbH")).toBeTruthy();
    expect(screen.queryByText("Verstorben GmbH")).toBeNull();
    expect(screen.queryByText("Geparkt GmbH")).toBeNull();

    // Toggle the Tot/Geparkt filter on.
    fireEvent.click(screen.getByRole("button", { name: "Tot/Geparkt" }));

    expect(screen.queryByText("Verstorben GmbH")).toBeTruthy();
    expect(screen.queryByText("Geparkt GmbH")).toBeTruthy();
  });

  it("renders the 🔥 glyph beside a hot company name and nowhere else (UI-02)", () => {
    render(
      <CompanyTable
        companies={[
          company({ id: "1", name: "Heisse GmbH", status: "Im Gespräch", heiss: true }),
          company({ id: "2", name: "Kalte GmbH", status: "Neu", heiss: false }),
        ]}
      />,
    );

    const hot = screen.getByText("Heisse GmbH").closest("td");
    const cold = screen.getByText("Kalte GmbH").closest("td");
    expect(within(hot as HTMLElement).queryByText("🔥")).toBeTruthy();
    expect(within(cold as HTMLElement).queryByText("🔥")).toBeNull();
  });

  it("maps each status to its mockup pill variant class", () => {
    render(
      <CompanyTable
        showDeadInitially
        companies={[
          company({ id: "1", name: "A", status: "Neu" }),
          company({ id: "2", name: "B", status: "Offen" }),
          company({ id: "3", name: "C", status: "Im Gespräch" }),
          company({ id: "4", name: "D", status: "Termin" }),
          company({ id: "5", name: "E", status: "Kein Interesse" }),
          company({ id: "6", name: "F", status: "Tot" }),
          company({ id: "7", name: "G", status: "Geparkt" }),
        ]}
      />,
    );
    const pillClass = (text: string) =>
      screen.getByText(text).className;
    expect(pillClass("Neu")).toContain("neu");
    expect(pillClass("Offen")).toContain("offen");
    expect(pillClass("Im Gespräch")).toContain("gespraech");
    expect(pillClass("Termin")).toContain("termin");
    expect(pillClass("Kein Interesse")).toContain("kein");
    expect(pillClass("Tot")).toContain("tot");
    expect(pillClass("Geparkt")).toContain("tot");
  });

  it("shows the no-companies empty state when given an empty list", () => {
    render(<CompanyTable companies={[]} />);
    expect(screen.queryByText("Noch keine Firmen")).toBeTruthy();
  });

  it("shows the filter-empty state when the active filter hides everything", () => {
    render(
      <CompanyTable companies={[company({ id: "1", name: "Tote GmbH", status: "Tot" })]} />,
    );
    expect(
      screen.queryByText(/Keine aktiven Firmen/),
    ).toBeTruthy();
  });

  it("clicking a row reveals an inline detail region and a second click hides it (DB-06)", () => {
    render(
      <CompanyTable
        companies={[company({ id: "1", name: "Himmelhoch GmbH", status: "Im Gespräch" })]}
        interactionsByFirma={{ "1": [] }}
      />,
    );
    // The Unternehmen cell is now inline-editable (D-07), so the row-open target
    // is a non-editable cell (the Status pill). Clicking the name edits, not opens.
    expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
    fireEvent.click(screen.getByText("Im Gespräch"));
    expect(screen.queryByText("Verlauf (Notizen)")).toBeTruthy();
    fireEvent.click(screen.getByText("Im Gespräch"));
    expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
  });

  it("calls onOpenRow when a row is expanded (DB-05/markViewed)", () => {
    const onOpenRow = vi.fn();
    render(
      <CompanyTable
        companies={[company({ id: "1", name: "Himmelhoch GmbH", status: "Neu" })]}
        interactionsByFirma={{ "1": [] }}
        onOpenRow={onOpenRow}
      />,
    );
    // Open via a non-editable cell (Status pill); the name cell now edits (D-07).
    fireEvent.click(screen.getByText("Neu"));
    expect(onOpenRow).toHaveBeenCalledWith("1");
  });

  describe("contact actions (CONTACT-01/02/03)", () => {
    beforeEach(() => openUrl.mockClear());

    const fullContact = contact({
      id: "k1",
      firma_id: "1",
      telefon: "+43 1 234-567",
      emails: ["office@himmelhoch.at", "eva@himmelhoch.at"],
      linkedin: "linkedin.com/in/eva-mandl",
    });

    function renderWithContact(c: Contact) {
      return render(
        <CompanyTable
          companies={[company({ id: "1", name: "Himmelhoch GmbH", status: "Im Gespräch" })]}
          interactionsByFirma={{ "1": [] }}
          contactsByFirma={{ "1": [c] }}
        />,
      );
    }

    it("enables Tel/Mail/in with title = underlying value when data present", () => {
      renderWithContact(fullContact);
      const tel = screen.getByText("Tel");
      const mail = screen.getByText("Mail");
      const li = screen.getByText("in");
      expect(tel.className).toContain("tel");
      expect(tel.className).not.toContain("off");
      expect(tel.getAttribute("title")).toBe("+43 1 234-567");
      // Mail title = first/primary email (D-02).
      expect(mail.getAttribute("title")).toBe("office@himmelhoch.at");
      expect(mail.className).not.toContain("off");
      expect(li.className).toContain("acc");
      expect(li.getAttribute("title")).toBe("linkedin.com/in/eva-mandl");
    });

    it("clicking Tel fires openUrl with a tel: URL and does NOT toggle the row (stopPropagation, Pitfall 3)", () => {
      renderWithContact(fullContact);
      expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
      fireEvent.click(screen.getByText("Tel"));
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith("tel:+431234567");
      // Detail panel stays closed.
      expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
    });

    it("clicking Mail fires openUrl with mailto: of the first email", () => {
      renderWithContact(fullContact);
      fireEvent.click(screen.getByText("Mail"));
      expect(openUrl).toHaveBeenCalledWith("mailto:office@himmelhoch.at");
    });

    it("clicking in fires openUrl with the https-normalized LinkedIn URL", () => {
      renderWithContact(fullContact);
      fireEvent.click(screen.getByText("in"));
      expect(openUrl).toHaveBeenCalledWith("https://linkedin.com/in/eva-mandl");
    });

    it("greys out a span (ci off) when its data is missing and the click is a no-op", () => {
      renderWithContact(contact({ id: "k2", firma_id: "1" })); // no telefon/email/linkedin
      const tel = screen.getByText("Tel");
      expect(tel.className).toContain("off");
      fireEvent.click(tel);
      expect(openUrl).not.toHaveBeenCalled();
    });
  });

  it("shows a blue dot on Notizen when the newest note is newer than last_viewed, and none when older (DB-05)", () => {
    render(
      <CompanyTable
        companies={[
          company({ id: "new", name: "Neu Notiz GmbH", status: "Im Gespräch", last_viewed: "2026-06-01T00:00:00Z" }),
          company({ id: "old", name: "Alt Notiz GmbH", status: "Im Gespräch", last_viewed: "2026-06-30T00:00:00Z" }),
        ]}
        interactionsByFirma={{
          new: [interaction({ id: "i1", firma_id: "new", datum: "2026-06-10T00:00:00Z", notiz: "frisch" })],
          old: [interaction({ id: "i2", firma_id: "old", datum: "2026-06-10T00:00:00Z", notiz: "alt" })],
        }}
      />,
    );
    const newCell = screen.getByText("frisch").closest("td");
    const oldCell = screen.getByText("alt").closest("td");
    expect((newCell as HTMLElement).querySelector(".ndot")).toBeTruthy();
    expect((oldCell as HTMLElement).querySelector(".ndot")).toBeNull();
  });

  describe("live search (DB-08, D-10/11)", () => {
    function search() {
      return screen.getByPlaceholderText("Suchen…");
    }

    it("the search input is enabled (not disabled) and starts empty", () => {
      render(<CompanyTable companies={[company({ id: "1", name: "Acme GmbH", status: "Neu" })]} />);
      const input = search() as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.value).toBe("");
    });

    it("typing a query filters the rendered rows live (name match)", () => {
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Himmelhoch GmbH", status: "Offen" }),
            company({ id: "2", name: "Chapter 4 GmbH", status: "Offen" }),
          ]}
        />,
      );
      expect(screen.queryByText("Chapter 4 GmbH")).toBeTruthy();
      fireEvent.change(search(), { target: { value: "himmel" } });
      expect(screen.queryByText("Himmelhoch GmbH")).toBeTruthy();
      expect(screen.queryByText("Chapter 4 GmbH")).toBeNull();
    });

    it("search matches a contact name (D-10)", () => {
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Himmelhoch GmbH", status: "Offen" }),
            company({ id: "2", name: "Chapter 4 GmbH", status: "Offen" }),
          ]}
          contactsByFirma={{ "2": [contact({ id: "k", firma_id: "2", name: "Max Müller" })] }}
        />,
      );
      fireEvent.change(search(), { target: { value: "müller" } });
      expect(screen.queryByText("Chapter 4 GmbH")).toBeTruthy();
      expect(screen.queryByText("Himmelhoch GmbH")).toBeNull();
    });

    it("clearing the search box restores the full set", () => {
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Himmelhoch GmbH", status: "Offen" }),
            company({ id: "2", name: "Chapter 4 GmbH", status: "Offen" }),
          ]}
        />,
      );
      fireEvent.change(search(), { target: { value: "himmel" } });
      expect(screen.queryByText("Chapter 4 GmbH")).toBeNull();
      fireEvent.change(search(), { target: { value: "" } });
      expect(screen.queryByText("Chapter 4 GmbH")).toBeTruthy();
    });

    it("a no-match query shows the no-search-match empty state with the query (D-10)", () => {
      render(
        <CompanyTable companies={[company({ id: "1", name: "Himmelhoch GmbH", status: "Offen" })]} />,
      );
      fireEvent.change(search(), { target: { value: "zzz" } });
      expect(screen.queryByText(/Keine Firma passt zu/)).toBeTruthy();
      expect(screen.queryByText(/zzz/)).toBeTruthy();
      expect(screen.queryByText("Himmelhoch GmbH")).toBeNull();
    });

    it("search stacks with the dead-row toggle (D-11)", () => {
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Alpha GmbH", status: "Offen" }),
            company({ id: "2", name: "Alpha Tot GmbH", status: "Tot" }),
          ]}
        />,
      );
      fireEvent.change(search(), { target: { value: "alpha" } });
      // Both names match the query, but the dead one stays hidden by the toggle.
      expect(screen.queryByText("Alpha GmbH")).toBeTruthy();
      expect(screen.queryByText("Alpha Tot GmbH")).toBeNull();
      // Reveal dead rows → the dead match now appears too.
      fireEvent.click(screen.getByRole("button", { name: "Tot/Geparkt" }));
      expect(screen.queryByText("Alpha Tot GmbH")).toBeTruthy();
    });
  });

  describe("manual add + inline editing (DB-07, D-05/06/07)", () => {
    it("the + Neue Firma button is enabled (not disabled)", () => {
      render(<CompanyTable companies={[company({ id: "1", name: "Acme GmbH", status: "Neu" })]} />);
      const btn = screen.getByRole("button", { name: "+ Neue Firma" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("clicking + Neue Firma renders an editable row at the top with a Neu pill", () => {
      render(<CompanyTable companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]} />);
      expect(screen.queryByPlaceholderText("Unternehmen")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "+ Neue Firma" }));
      // The draft name input appears...
      const nameInput = screen.getByPlaceholderText("Unternehmen");
      expect(nameInput).toBeTruthy();
      // ...inside the FIRST body row (pinned at the top).
      const firstRow = document.querySelector("tbody tr") as HTMLElement;
      expect(within(firstRow).queryByPlaceholderText("Unternehmen")).toBeTruthy();
      // The draft row shows a Neu status pill.
      expect(within(firstRow).getByText("Neu").className).toContain("neu");
    });

    it("the inline-add row aligns to the 9-column grid and Speichern lives in its own full-width action row (regression: clipped Speichern)", () => {
      render(<CompanyTable companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]} />);
      fireEvent.click(screen.getByRole("button", { name: "+ Neue Firma" }));

      // The draft data row mirrors the header exactly: 9 cells, one per column.
      const draftRow = screen
        .getByPlaceholderText("Unternehmen")
        .closest("tr") as HTMLElement;
      expect(draftRow.querySelectorAll("td")).toHaveLength(HEADERS.length);

      // Speichern is NOT inside the draft data row (where it would be clipped by a
      // single column); it lives in a dedicated full-width action row spanning all
      // columns, guaranteeing it is fully visible.
      expect(within(draftRow).queryByRole("button", { name: "Speichern" })).toBeNull();
      const saveBtn = screen.getByRole("button", { name: "Speichern" });
      const actionCell = saveBtn.closest("td") as HTMLElement;
      expect(actionCell.getAttribute("colspan")).toBe(String(HEADERS.length));
      // Abbrechen sits in the same action cell.
      expect(within(actionCell).getByText("Abbrechen")).toBeTruthy();
    });

    it("Save is blocked while Unternehmen is empty and does not call onAddCompany", () => {
      const onAddCompany = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          onAddCompany={onAddCompany}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "+ Neue Firma" }));
      const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.click(save);
      expect(onAddCompany).not.toHaveBeenCalled();
    });

    it("typing a name then Saving calls onAddCompany and clears the draft row", () => {
      const onAddCompany = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          onAddCompany={onAddCompany}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "+ Neue Firma" }));
      fireEvent.change(screen.getByPlaceholderText("Unternehmen"), {
        target: { value: "Neue Firma GmbH" },
      });
      const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      fireEvent.click(save);
      expect(onAddCompany).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Neue Firma GmbH" }),
      );
      // Draft row is gone after save.
      expect(screen.queryByPlaceholderText("Unternehmen")).toBeNull();
    });

    it("committing an inline edit on an existing cell calls onEditCell with the field patch", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" })]}
          onEditCell={onEditCell}
        />,
      );
      // Click the Branche cell to edit, change the value, press Enter to commit.
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "Beratung" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onEditCell).toHaveBeenCalledWith("1", { branche: "Beratung" });
    });

    it("Escape cancels an inline edit without calling onEditCell", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" })]}
          onEditCell={onEditCell}
        />,
      );
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "Verworfen" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onEditCell).not.toHaveBeenCalled();
      // Cell reverts to the original value.
      expect(screen.queryByText("IT")).toBeTruthy();
    });

    it("clearing a required Unternehmen on commit reverts and does not call onEditCell", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          onEditCell={onEditCell}
        />,
      );
      fireEvent.click(screen.getByText("Acme GmbH"));
      const input = screen.getByDisplayValue("Acme GmbH");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onEditCell).not.toHaveBeenCalled();
      expect(screen.queryByText("Acme GmbH")).toBeTruthy();
    });

    // Round-trip: a stateful parent (mimicking App's onEditCell → setCompanies)
    // must show the committed value as plain text after Enter. The plain vi.fn()
    // tests above never re-render with the patch, so they missed the runtime path
    // where the new value flows back into the rendered cell.
    it("Enter commits and the new value becomes visible after the parent re-renders", () => {
      function Harness() {
        const [companies, setCompanies] = useState([
          company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" }),
        ]);
        return (
          <CompanyTable
            companies={companies}
            onEditCell={(id, patch) =>
              setCompanies((cs) =>
                cs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
              )
            }
          />
        );
      }
      render(<Harness />);
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "Beratung" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // Value persisted into the table AND the cell left edit mode.
      expect(screen.getByText("Beratung")).toBeTruthy();
      expect(screen.queryByDisplayValue("Beratung")).toBeNull();
    });

    it("blur commits the edited value (commit-on-blur)", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" }),
          ]}
          onEditCell={onEditCell}
        />,
      );
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "ViaBlur" } });
      fireEvent.blur(input);
      expect(onEditCell).toHaveBeenCalledWith("1", { branche: "ViaBlur" });
    });

    // Regression guard for the real bug class: pressing Escape unmounts the
    // focused input, which can fire a trailing onBlur. That trailing blur must
    // NOT commit the discarded draft (Escape always reverts).
    it("Escape followed by the unmount blur does NOT commit the discarded draft", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" }),
          ]}
          onEditCell={onEditCell}
        />,
      );
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "Verworfen" } });
      fireEvent.keyDown(input, { key: "Escape" });
      // Simulate the trailing native blur some engines dispatch on teardown.
      fireEvent.blur(input);
      expect(onEditCell).not.toHaveBeenCalled();
      expect(screen.getByText("IT")).toBeTruthy();
    });

    // Enter must commit exactly once even though unmounting the input can emit a
    // trailing onBlur (Enter→commit then blur→commit would double-write).
    it("Enter commits exactly once even if a trailing blur fires on unmount", () => {
      const onEditCell = vi.fn();
      render(
        <CompanyTable
          companies={[
            company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" }),
          ]}
          onEditCell={onEditCell}
        />,
      );
      fireEvent.click(screen.getByText("IT"));
      const input = screen.getByDisplayValue("IT");
      fireEvent.change(input, { target: { value: "Beratung" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input); // trailing unmount blur
      expect(onEditCell).toHaveBeenCalledTimes(1);
      expect(onEditCell).toHaveBeenCalledWith("1", { branche: "Beratung" });
    });

    it("clicking an editable cell to edit does NOT toggle the detail panel", () => {
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen", branche: "IT" })]}
          interactionsByFirma={{ "1": [] }}
        />,
      );
      expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
      fireEvent.click(screen.getByText("IT"));
      expect(screen.queryByText("Verlauf (Notizen)")).toBeNull(); // still closed
    });

    // Addition 1 (D-07 amended): the Notizen cell is inline-editable and rewrites
    // the NEWEST interaction's note via onEditNote(firmaId, interactionId, text).
    it("committing a Notizen edit calls onEditNote with the newest interaction's id", () => {
      const onEditNote = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          interactionsByFirma={{
            "1": [
              interaction({ id: "i1", firma_id: "1", datum: "2026-06-01T00:00:00Z", notiz: "Alt" }),
            ],
          }}
          onEditNote={onEditNote}
        />,
      );
      fireEvent.click(screen.getByText("Alt"));
      const input = screen.getByDisplayValue("Alt");
      fireEvent.change(input, { target: { value: "Neu notiert" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onEditNote).toHaveBeenCalledWith("1", "i1", "Neu notiert");
    });

    it("edits the NEWEST interaction's note when several exist", () => {
      const onEditNote = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          interactionsByFirma={{
            "1": [
              interaction({ id: "old", firma_id: "1", datum: "2026-05-01T00:00:00Z", notiz: "Älter" }),
              interaction({ id: "new", firma_id: "1", datum: "2026-06-10T00:00:00Z", notiz: "Neueste" }),
            ],
          }}
          onEditNote={onEditNote}
        />,
      );
      // The Notizen cell shows the newest note ("Neueste"), not "Älter".
      fireEvent.click(screen.getByText("Neueste"));
      const input = screen.getByDisplayValue("Neueste");
      fireEvent.change(input, { target: { value: "Korrigiert" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onEditNote).toHaveBeenCalledWith("1", "new", "Korrigiert");
    });

    it("Escape cancels a Notizen edit without calling onEditNote", () => {
      const onEditNote = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          interactionsByFirma={{
            "1": [
              interaction({ id: "i1", firma_id: "1", datum: "2026-06-01T00:00:00Z", notiz: "Behalten" }),
            ],
          }}
          onEditNote={onEditNote}
        />,
      );
      fireEvent.click(screen.getByText("Behalten"));
      const input = screen.getByDisplayValue("Behalten");
      fireEvent.change(input, { target: { value: "verworfen" } });
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input); // trailing unmount blur must not commit
      expect(onEditNote).not.toHaveBeenCalled();
      expect(screen.getByText("Behalten")).toBeTruthy();
    });

    // Addition 2: deleting a company from the detail panel bubbles onDeleteCompany
    // with the firma id and closes the panel.
    it("confirming Löschen in the detail panel calls onDeleteCompany and closes the panel", () => {
      const onDeleteCompany = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          interactionsByFirma={{ "1": [] }}
          onDeleteCompany={onDeleteCompany}
        />,
      );
      // Open the row (click the Status pill, not an editable cell).
      fireEvent.click(screen.getByText("Offen"));
      expect(screen.getByText("Verlauf (Notizen)")).toBeTruthy();
      // Two-step inline confirm.
      fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
      fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
      expect(onDeleteCompany).toHaveBeenCalledWith("1");
      // Panel closed.
      expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
    });

    // Edge case: a company with NO interactions has no newest note to override,
    // so the Notizen cell is a non-editable em-dash placeholder (no input on click).
    it("a company with no interactions shows a non-editable Notizen placeholder", () => {
      const onEditNote = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Neu GmbH", status: "Neu" })]}
          interactionsByFirma={{ "1": [] }}
          onEditNote={onEditNote}
        />,
      );
      // Clicking the placeholder toggles the row detail (no editor appears).
      const notizCell = document.querySelector("td.notiz") as HTMLElement;
      expect(notizCell).toBeTruthy();
      expect(notizCell.classList.contains("editable")).toBe(false);
      fireEvent.click(notizCell);
      expect(screen.queryByDisplayValue("—")).toBeNull();
      expect(onEditNote).not.toHaveBeenCalled();
    });
  });

  // Addition 3: a RIGHT-CLICK context menu on a real company row offers Löschen →
  // two-step confirm → onDeleteCompany. Second entry point to the same delete path
  // (the detail-panel danger zone stays). Only saved rows; not the draft/empty rows.
  describe("right-click context menu delete (Addition 3)", () => {
    function tableWithRow(extra?: Partial<Parameters<typeof CompanyTable>[0]>) {
      const onDeleteCompany = vi.fn();
      render(
        <CompanyTable
          companies={[company({ id: "1", name: "Acme GmbH", status: "Offen" })]}
          interactionsByFirma={{ "1": [] }}
          onDeleteCompany={onDeleteCompany}
          {...extra}
        />,
      );
      return { onDeleteCompany };
    }

    // The data row carrying the company name (not the detail/add/action rows).
    function dataRow(name: string) {
      return screen.getByText(name).closest("tr") as HTMLElement;
    }

    it("right-clicking a real row opens a custom menu with a Löschen item and suppresses the native menu", () => {
      tableWithRow();
      expect(screen.queryByRole("menu")).toBeNull();
      const evt = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      });
      fireEvent(dataRow("Acme GmbH"), evt);
      // Native menu suppressed.
      expect(evt.defaultPrevented).toBe(true);
      // Custom menu visible with Löschen.
      const menu = screen.getByRole("menu");
      expect(menu).toBeTruthy();
      expect(within(menu).getByRole("button", { name: "Löschen" })).toBeTruthy();
    });

    it("Löschen → Ja, löschen calls onDeleteCompany with the row id and closes the menu", () => {
      const { onDeleteCompany } = tableWithRow();
      fireEvent.contextMenu(dataRow("Acme GmbH"));
      fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
      // Transitions to the confirm step in the SAME menu.
      fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
      expect(onDeleteCompany).toHaveBeenCalledWith("1");
      // Menu closed afterwards.
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("Abbrechen in the confirm step closes the menu without deleting", () => {
      const { onDeleteCompany } = tableWithRow();
      fireEvent.contextMenu(dataRow("Acme GmbH"));
      fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(onDeleteCompany).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("pressing Escape closes the menu without deleting", () => {
      const { onDeleteCompany } = tableWithRow();
      fireEvent.contextMenu(dataRow("Acme GmbH"));
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onDeleteCompany).not.toHaveBeenCalled();
    });

    it("clicking outside the menu closes it without deleting", () => {
      const { onDeleteCompany } = tableWithRow();
      fireEvent.contextMenu(dataRow("Acme GmbH"));
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).toBeNull();
      expect(onDeleteCompany).not.toHaveBeenCalled();
    });

    it("right-clicking the inline-add draft row does NOT open the menu", () => {
      tableWithRow();
      fireEvent.click(screen.getByRole("button", { name: "+ Neue Firma" }));
      const draftRow = screen
        .getByPlaceholderText("Unternehmen")
        .closest("tr") as HTMLElement;
      fireEvent.contextMenu(draftRow);
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("right-clicking an empty-state row does NOT open the menu", () => {
      render(<CompanyTable companies={[]} onDeleteCompany={vi.fn()} />);
      const emptyRow = screen
        .getByText("Noch keine Firmen")
        .closest("tr") as HTMLElement;
      fireEvent.contextMenu(emptyRow);
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("renders 🔥 companies above non-🔥 companies, then alphabetical (DB-04, D-12)", () => {
    render(
      <CompanyTable
        companies={[
          company({ id: "1", name: "Alpha GmbH", status: "Offen", heiss: false }),
          company({ id: "2", name: "Zeta GmbH", status: "Offen", heiss: true }),
        ]}
      />,
    );
    const rows = screen.getAllByText(/GmbH$/).map((el) => el.textContent);
    // Hot "Zeta" renders before non-hot "Alpha".
    expect(rows[0]).toContain("Zeta GmbH");
    expect(rows[1]).toContain("Alpha GmbH");
  });

  // --- "Zuletzt gelöscht" trash view (Part B) ---
  describe("Zuletzt gelöscht trash view", () => {
    // A soft-deleted company deleted `days` ago.
    function deleted(
      over: Partial<Company> & Pick<Company, "id" | "name">,
      days = 0,
    ): Company {
      const ts = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      return company({ status: "Neu", deleted_at: ts, ...over });
    }

    it("the Zuletzt gelöscht toggle renders the soft-deleted companies, not the active ones", () => {
      render(
        <CompanyTable
          companies={[company({ id: "a", name: "Aktiv GmbH", status: "Neu" })]}
          deletedCompanies={[deleted({ id: "d", name: "Gelöscht GmbH" })]}
        />,
      );
      // Active list shows the active company, not the deleted one.
      expect(screen.getByText("Aktiv GmbH")).toBeTruthy();
      expect(screen.queryByText("Gelöscht GmbH")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Zuletzt gelöscht" }));

      // Trash view: deleted company visible, active one gone.
      expect(screen.getByText("Gelöscht GmbH")).toBeTruthy();
      expect(screen.queryByText("Aktiv GmbH")).toBeNull();
    });

    it("shows 'noch X Tage' for each trashed row (7 minus days since deletion, floored)", () => {
      render(
        <CompanyTable
          companies={[]}
          deletedCompanies={[
            deleted({ id: "fresh", name: "Frisch GmbH" }, 0), // noch 7 Tage
            deleted({ id: "old", name: "Alt GmbH" }, 5), // noch 2 Tage
          ]}
          trashViewInitially
        />,
      );
      expect(screen.getByText("noch 7 Tage")).toBeTruthy();
      expect(screen.getByText("noch 2 Tage")).toBeTruthy();
    });

    it("clicking Wiederherstellen calls onRestoreCompany with the firma id", () => {
      const onRestoreCompany = vi.fn();
      render(
        <CompanyTable
          companies={[]}
          deletedCompanies={[deleted({ id: "d", name: "Zurück GmbH" })]}
          onRestoreCompany={onRestoreCompany}
          trashViewInitially
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
      expect(onRestoreCompany).toHaveBeenCalledWith("d");
    });

    it("Endgültig löschen requires the inline confirm before calling onPermanentDelete", () => {
      const onPermanentDelete = vi.fn();
      render(
        <CompanyTable
          companies={[]}
          deletedCompanies={[deleted({ id: "d", name: "Weg GmbH" })]}
          onPermanentDelete={onPermanentDelete}
          trashViewInitially
        />,
      );
      // First click reveals the confirm; nothing deleted yet.
      fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
      expect(onPermanentDelete).not.toHaveBeenCalled();
      expect(screen.getByText("Wirklich löschen?")).toBeTruthy();

      // Confirming fires the permanent delete with the id.
      fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
      expect(onPermanentDelete).toHaveBeenCalledWith("d");
    });

    it("Abbrechen on the purge confirm does not call onPermanentDelete", () => {
      const onPermanentDelete = vi.fn();
      render(
        <CompanyTable
          companies={[]}
          deletedCompanies={[deleted({ id: "d", name: "Bleibt GmbH" })]}
          onPermanentDelete={onPermanentDelete}
          trashViewInitially
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
      fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(onPermanentDelete).not.toHaveBeenCalled();
      // Back to the action buttons.
      expect(screen.getByRole("button", { name: "Endgültig löschen" })).toBeTruthy();
    });

    it("shows an empty-state when the trash is empty", () => {
      render(
        <CompanyTable companies={[]} deletedCompanies={[]} trashViewInitially />,
      );
      expect(screen.getByText("Papierkorb ist leer")).toBeTruthy();
    });

    it("the trash view offers no add / inline-edit / contact actions", () => {
      render(
        <CompanyTable
          companies={[]}
          deletedCompanies={[deleted({ id: "d", name: "Nur Lesen GmbH" })]}
          trashViewInitially
        />,
      );
      // No "+ Neue Firma" button and no contact-action cells in trash view.
      expect(screen.queryByRole("button", { name: "+ Neue Firma" })).toBeNull();
      expect(screen.queryByText("Tel")).toBeNull();
      expect(screen.queryByText("Mail")).toBeNull();
    });
  });
});
