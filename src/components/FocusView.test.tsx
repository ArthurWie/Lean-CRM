// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FocusView } from "./FocusView";
import type { FocusCompany } from "../data/focus";
import type { Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";

// The contact-action helpers are mocked so "actions" can assert openTel/openMail/
// openLinkedIn are invoked with the primary contact's field (and never reach the
// real @tauri-apps/plugin-opener in jsdom).
vi.mock("../lib/contactActions", () => ({
  openTel: vi.fn(),
  openMail: vi.fn(),
  openLinkedIn: vi.fn(),
}));
import { openTel, openMail, openLinkedIn } from "../lib/contactActions";

function company(
  over: Partial<FocusCompany> & Pick<FocusCompany, "id" | "name" | "reason">,
): FocusCompany {
  return {
    branche: null,
    groesse: null,
    status: "Offen",
    heiss: false,
    lessons: null,
    daysOverdue: null,
    // remaining firmen columns are not read by FocusView; cast covers them.
    ...over,
  } as FocusCompany;
}

function contact(
  over: Partial<Contact> & Pick<Contact, "id" | "firma_id" | "name">,
): Contact {
  return {
    rolle: null,
    telefon: null,
    linkedin: null,
    li_angenommen: false,
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
    bearbeiter: "Arthur",
    ...over,
  } as Interaction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Task 1 — card render, why-now, actions, log routing, escaping
// ---------------------------------------------------------------------------

describe("FocusView renders", () => {
  it("shows the company name large with inline 🔥, Branche · Größe, and the context headings", () => {
    const snapshot = [
      company({
        id: "f1",
        name: "Acme GmbH",
        reason: "hot",
        heiss: true,
        branche: "IT",
        groesse: "~37",
        lessons: "Bevorzugt Termine am Vormittag.",
      }),
    ];
    render(
      <FocusView
        snapshot={snapshot}
        contactsByFirma={{}}
        interactionsByFirma={{
          f1: [interaction({ id: "i1", firma_id: "f1", datum: "2026-06-09T08:00:00Z", notiz: "Erstes Gespräch." })],
        }}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Acme GmbH")).toBeTruthy();
    // 🔥 renders next to the name when the company is hot.
    expect(screen.getByText(/🔥/)).toBeTruthy();
    expect(screen.getByText(/IT/)).toBeTruthy();
    expect(screen.getByText(/~37/)).toBeTruthy();
    expect(screen.getByText("Letzte Notizen")).toBeTruthy();
    expect(screen.getByText("Lessons learned")).toBeTruthy();
    expect(screen.getByText("Erstes Gespräch.")).toBeTruthy();
    expect(screen.getByText("Bevorzugt Termine am Vormittag.")).toBeTruthy();
  });
});

describe("FocusView why-now", () => {
  function renderReason(over: Partial<FocusCompany>) {
    render(
      <FocusView
        snapshot={[company({ id: "f1", name: "Acme GmbH", reason: "neu", ...over })]}
        contactsByFirma={{}}
        interactionsByFirma={{}}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  }

  it("followup overdue 3 days -> 'Wiedervorlage fällig – seit 3 Tagen'", () => {
    renderReason({ reason: "followup", daysOverdue: 3 });
    expect(screen.getByText("Wiedervorlage fällig – seit 3 Tagen")).toBeTruthy();
  });

  it("followup overdue 1 day -> singular 'Tag'", () => {
    renderReason({ reason: "followup", daysOverdue: 1 });
    expect(screen.getByText("Wiedervorlage fällig – seit 1 Tag")).toBeTruthy();
  });

  it("followup due today -> 'Wiedervorlage heute fällig'", () => {
    renderReason({ reason: "followup", daysOverdue: 0 });
    expect(screen.getByText("Wiedervorlage heute fällig")).toBeTruthy();
  });

  it("hot -> '🔥 Heiss'", () => {
    renderReason({ reason: "hot", heiss: true });
    expect(screen.getByText("🔥 Heiss")).toBeTruthy();
  });

  it("neu -> 'Neu – noch nie kontaktiert'", () => {
    renderReason({ reason: "neu" });
    expect(screen.getByText("Neu – noch nie kontaktiert")).toBeTruthy();
  });
});

describe("FocusView actions", () => {
  it("enables Anrufen/Mail/in for a primary contact with all fields and routes through contactActions", () => {
    const snapshot = [company({ id: "f1", name: "Acme GmbH", reason: "neu" })];
    render(
      <FocusView
        snapshot={snapshot}
        contactsByFirma={{
          f1: [
            contact({
              id: "k1",
              firma_id: "f1",
              name: "Eva Mandl",
              telefon: "+43 1 234 567",
              linkedin: "linkedin.com/in/eva",
              emails: ["eva@acme.at"],
            }),
          ],
        }}
        interactionsByFirma={{}}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const call = screen.getByRole("button", { name: "Anrufen" }) as HTMLButtonElement;
    const mail = screen.getByRole("button", { name: "Mail" }) as HTMLButtonElement;
    const inBtn = screen.getByRole("button", { name: "in" }) as HTMLButtonElement;
    expect(call.disabled).toBe(false);
    expect(mail.disabled).toBe(false);
    expect(inBtn.disabled).toBe(false);

    fireEvent.click(call);
    expect(openTel).toHaveBeenCalledWith("+43 1 234 567");
    fireEvent.click(mail);
    expect(openMail).toHaveBeenCalledWith("eva@acme.at");
    fireEvent.click(inBtn);
    expect(openLinkedIn).toHaveBeenCalledWith("linkedin.com/in/eva");
  });

  it("disables an action whose field is absent (no primary contact at all)", () => {
    render(
      <FocusView
        snapshot={[company({ id: "f1", name: "Acme GmbH", reason: "neu" })]}
        contactsByFirma={{}}
        interactionsByFirma={{}}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Anrufen" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Mail" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "in" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("greys only the missing field and exposes present values via title", () => {
    render(
      <FocusView
        snapshot={[company({ id: "f1", name: "Acme GmbH", reason: "neu" })]}
        contactsByFirma={{
          f1: [contact({ id: "k1", firma_id: "f1", name: "Eva", telefon: "+431234567", emails: [] })],
        }}
        interactionsByFirma={{}}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const call = screen.getByRole("button", { name: "Anrufen" }) as HTMLButtonElement;
    const mail = screen.getByRole("button", { name: "Mail" }) as HTMLButtonElement;
    expect(call.disabled).toBe(false);
    expect(call.getAttribute("title")).toBe("+431234567");
    expect(mail.disabled).toBe(true);
  });
});

describe("FocusView log", () => {
  it("mounts LogForm and routes a save to onSaveAndNext(currentFirmaId, entry)", () => {
    const onSaveAndNext = vi.fn();
    render(
      <FocusView
        snapshot={[company({ id: "f1", name: "Acme GmbH", reason: "neu" })]}
        contactsByFirma={{}}
        interactionsByFirma={{}}
        onSaveAndNext={onSaveAndNext}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // LogForm is mounted (its Telefon channel button is present).
    expect(screen.getByRole("button", { name: "Telefon" })).toBeTruthy();
    // Pick an outcome so Speichern enables, then save.
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(onSaveAndNext).toHaveBeenCalledTimes(1);
    expect(onSaveAndNext.mock.calls[0][0]).toBe("f1");
    expect(onSaveAndNext.mock.calls[0][1]).toMatchObject({ kanal: "Telefon", outcome: "Gesprochen" });
  });
});

describe("FocusView escaped", () => {
  it("renders HTML-ish note text literally (no dangerouslySetInnerHTML)", () => {
    render(
      <FocusView
        snapshot={[company({ id: "f1", name: "Acme GmbH", reason: "neu", lessons: "<b>boss</b>" })]}
        contactsByFirma={{}}
        interactionsByFirma={{
          f1: [interaction({ id: "i1", firma_id: "f1", datum: "2026-06-09T08:00:00Z", notiz: "<script>x</script>" })],
        }}
        onSaveAndNext={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // The literal text is present and no real <script>/<b> element was created.
    expect(screen.getByText("<script>x</script>")).toBeTruthy();
    expect(screen.getByText("<b>boss</b>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});
