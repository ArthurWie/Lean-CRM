// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LogForm, type LogEntry } from "./LogForm";

// The locked D-03 outcome sets (CONTEXT lines 43-46). Note LinkedIn uses
// "Antwort erhalten" (CONTEXT), NOT the mockup's "Geantwortet".
const TELEFON = [
  "Gesprochen",
  "Nicht erreicht",
  "Rückruf vereinbart",
  "Warteschlange",
  "Termin vereinbart",
  "Kein Interesse",
];
const EMAIL = [
  "Gesendet",
  "Antwort erhalten",
  "Keine Antwort",
  "Termin vereinbart",
  "Kein Interesse",
];
const LINKEDIN = [
  "Anfrage gesendet",
  "Angenommen",
  "Nachricht gesendet",
  "Antwort erhalten",
  "Kein Interesse",
];

// Outcome buttons live in the .out container; scope queries there so the
// channel buttons (also <button>) don't collide.
function outcomeButtonNames(): string[] {
  const out = document.querySelector(".out") as HTMLElement;
  return within(out)
    .getAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "");
}

describe("LogForm", () => {
  it("defaults to Telefon and shows exactly the six Telefon outcomes (LOG-02/D-03)", () => {
    render(<LogForm onSave={vi.fn()} />);
    // Telefon channel button is selected.
    expect(screen.getByRole("button", { name: "Telefon" }).className).toContain("s");
    expect(outcomeButtonNames()).toEqual(TELEFON);
  });

  it("switches to the five E-Mail outcomes and hides the Telefon ones (LOG-02/D-03)", () => {
    render(<LogForm onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "E-Mail" }));
    expect(outcomeButtonNames()).toEqual(EMAIL);
    expect(outcomeButtonNames()).not.toContain("Gesprochen");
  });

  it("LinkedIn shows 'Antwort erhalten' and never 'Geantwortet' (LOG-02/D-03)", () => {
    render(<LogForm onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(outcomeButtonNames()).toEqual(LINKEDIN);
    expect(outcomeButtonNames()).toContain("Antwort erhalten");
    expect(outcomeButtonNames()).not.toContain("Geantwortet");
  });

  it("clears a previously selected outcome when the channel changes (LOG-01)", () => {
    render(<LogForm onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    expect(screen.getByRole("button", { name: "Gesprochen" }).className).toContain("s");
    // Switch channel — outcome selection resets, Speichern disabled again.
    fireEvent.click(screen.getByRole("button", { name: "E-Mail" }));
    const selected = outcomeButtonNames().filter((_n, i) => {
      const out = document.querySelector(".out") as HTMLElement;
      return within(out).getAllByRole("button")[i].className.includes("s");
    });
    expect(selected).toEqual([]);
    expect(
      (screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables Speichern until an outcome is chosen (LOG-01/03)", () => {
    render(<LogForm onSave={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    expect(
      (screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("emits onSave with kanal/outcome/notiz on Speichern (LOG-01/03)", () => {
    const onSave = vi.fn();
    render(<LogForm onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Sehr interessiert, will mehr hören." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const entry = onSave.mock.calls[0][0] as LogEntry;
    expect(entry.kanal).toBe("Telefon");
    expect(entry.outcome).toBe("Gesprochen");
    expect(entry.notiz).toBe("Sehr interessiert, will mehr hören.");
  });

  it("checking the 🔥 box makes the onSave payload heiss true (LOG-03)", () => {
    const onSave = vi.fn();
    render(<LogForm onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    // The hot-mark checkbox — find by its accessible label text "heiß".
    const hot = screen.getByLabelText(/heiß/);
    fireEvent.click(hot);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const entry = onSave.mock.calls[0][0] as LogEntry;
    expect(entry.heiss).toBe(true);
  });

  it("emits a followup with a faellig_am ISO date when Follow-up is enabled (LOG-03/D-05)", () => {
    const onSave = vi.fn();
    render(<LogForm onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Gesprochen" }));
    const fu = screen.getByLabelText(/Follow-up/);
    fireEvent.click(fu); // enable
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const entry = onSave.mock.calls[0][0] as LogEntry;
    expect(entry.followup).not.toBeNull();
    expect(entry.followup?.faellig_am).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("renders the German copy and derive hint (LOG-01..04)", () => {
    render(<LogForm onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
    expect(screen.getByText(/Wird erfasst als/)).toBeTruthy();
    expect(screen.getByText(/^Daraus wird gesetzt:/)).toBeTruthy();
  });

  it("renders 🔥 as the only emoji; channel/outcome/save are text (UI-02)", () => {
    const { container } = render(<LogForm onSave={vi.fn()} />);
    const text = container.textContent ?? "";
    // Strip 🔥, then assert no other emoji-range glyph remains.
    const withoutFlame = text.replace(/🔥/g, "");
    const otherEmoji = withoutFlame.match(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u,
    );
    expect(otherEmoji).toBeNull();
    // 🔥 IS present.
    expect(text).toContain("🔥");
  });
});
