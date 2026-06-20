// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
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
    expect(screen.queryByText("Verlauf (Notizen)")).toBeNull();
    fireEvent.click(screen.getByText("Himmelhoch GmbH"));
    expect(screen.queryByText("Verlauf (Notizen)")).toBeTruthy();
    fireEvent.click(screen.getByText("Himmelhoch GmbH"));
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
    fireEvent.click(screen.getByText("Himmelhoch GmbH"));
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
});
