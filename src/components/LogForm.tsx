// LogForm — the logging form (LOG-01..04, D-03/05/08). The core-value input:
// channel → channel-specific outcome → one-sentence note → optional follow-up →
// optional 🔥 → Speichern, with a "Daraus wird gesetzt: …" derive hint.
//
// DATA-02: this component NEVER imports drizzle/db. It only calls the onSave prop;
// the parent (App) owns the data-layer call. State is React useState, replacing the
// mockup's DOM-mutating pick()/ob() (lean-crm-mockup.html lines 395-405). Colors come
// from direction B (CompanyTable.css :root tokens); structure/copy from the mockup.
import { useState } from "react";
import "./LogForm.css";

export type Channel = "Telefon" | "E-Mail" | "LinkedIn";

// What a single log emits upward. The parent maps this onto logInteraction.
export type LogEntry = {
  kanal: Channel;
  outcome: string;
  notiz: string;
  heiss: boolean;
  followup: { faellig_am: string } | null;
};

// D-03 (locked): channel-specific outcome sets. CONTEXT lines 43-46 — LinkedIn
// uses "Antwort erhalten" (NOT the mockup's "Geantwortet").
const OUTCOMES: Record<Channel, string[]> = {
  Telefon: [
    "Gesprochen",
    "Nicht erreicht",
    "Rückruf vereinbart",
    "Warteschlange",
    "Termin vereinbart",
    "Kein Interesse",
  ],
  "E-Mail": [
    "Gesendet",
    "Antwort erhalten",
    "Keine Antwort",
    "Termin vereinbart",
    "Kein Interesse",
  ],
  LinkedIn: [
    "Anfrage gesendet",
    "Angenommen",
    "Nachricht gesendet",
    "Antwort erhalten",
    "Kein Interesse",
  ],
};

const PLACEHOLDER: Record<Channel, string> = {
  Telefon: "Was wurde gesagt? (ein Satz reicht)",
  "E-Mail": "Worum ging es in der Mail?",
  LinkedIn: "Was wurde geschrieben?",
};

const CHANNELS: Channel[] = ["Telefon", "E-Mail", "LinkedIn"];

// D-05 follow-up presets + a custom date. Presets resolve to concrete UTC dates
// at save time (Phase 2 only CAPTURES the follow-up — no surfacing yet).
type Preset = "in 3 Tagen" | "nächste Woche" | "Ende Juni" | "custom";
const PRESETS: Preset[] = ["in 3 Tagen", "nächste Woche", "Ende Juni"];

function resolvePreset(preset: Preset, customDate: string): string {
  const now = new Date();
  if (preset === "in 3 Tagen") {
    const d = new Date(now);
    d.setDate(d.getDate() + 3);
    return d.toISOString();
  }
  if (preset === "nächste Woche") {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }
  if (preset === "Ende Juni") {
    // 30 June this year if still future, else next year. (Kept simple per plan.)
    const year = now.getFullYear();
    const thisJune = new Date(Date.UTC(year, 5, 30, 12, 0, 0));
    const target = thisJune.getTime() > now.getTime() ? thisJune : new Date(Date.UTC(year + 1, 5, 30, 12, 0, 0));
    return target.toISOString();
  }
  // custom: an <input type="date"> value is "YYYY-MM-DD" (or empty → today).
  if (customDate) return new Date(customDate + "T12:00:00.000Z").toISOString();
  return now.toISOString();
}

type Props = {
  onSave: (entry: LogEntry) => void;
  // D6-03: the configured "Erfasst als" name, supplied by the parent (App reads
  // it via settings.ts — LogForm stays DATA-02 and never imports settings).
  // "" (blank) means no name is set yet → render the informational nudge.
  bearbeiter: string;
};

// The unset-bearbeiter nudge (UI-SPEC): informational, muted — NOT an error.
const BEARBEITER_NUDGE =
  "Noch kein Name gesetzt — neue Einträge werden ohne Bearbeiter gespeichert. Trag unter Einstellungen ein, wer Kontakte erfasst.";

export function LogForm({ onSave, bearbeiter }: Props) {
  const [kanal, setKanal] = useState<Channel>("Telefon");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notiz, setNotiz] = useState("");
  const [heiss, setHeiss] = useState(false);
  const [fuEnabled, setFuEnabled] = useState(false);
  const [preset, setPreset] = useState<Preset>("nächste Woche");
  const [customDate, setCustomDate] = useState("");

  function pickChannel(next: Channel) {
    setKanal(next);
    setOutcome(null); // switching channel clears the previously selected outcome
  }

  function save() {
    if (!outcome) return; // Speichern is disabled in this state anyway
    const followup = fuEnabled
      ? { faellig_am: resolvePreset(preset, customDate) }
      : null;
    onSave({ kanal, outcome, notiz, heiss, followup });
    // Reset the transient fields so a second log in the same panel starts clean.
    setOutcome(null);
    setNotiz("");
    setHeiss(false);
    setFuEnabled(false);
  }

  return (
    <div className="log">
      <div className="ch">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            className={c === kanal ? "chb s" : "chb"}
            onClick={() => pickChannel(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="out">
        {OUTCOMES[kanal].map((o) => (
          <button
            key={o}
            type="button"
            className={o === outcome ? "ob s" : "ob"}
            onClick={() => setOutcome(o)}
          >
            {o}
          </button>
        ))}
      </div>

      <textarea
        className="n"
        placeholder={PLACEHOLDER[kanal]}
        value={notiz}
        onChange={(e) => setNotiz(e.target.value)}
      />

      <div className="logfoot">
        <label className="fu">
          <input
            type="checkbox"
            checked={fuEnabled}
            onChange={(e) => setFuEnabled(e.target.checked)}
          />
          Follow-up
          <select
            value={preset}
            disabled={!fuEnabled}
            onChange={(e) => setPreset(e.target.value as Preset)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="custom">eigenes Datum…</option>
          </select>
          {fuEnabled && preset === "custom" && (
            <input
              type="date"
              className="fudate"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          )}
        </label>

        <label className="hotmark">
          <input
            type="checkbox"
            checked={heiss}
            onChange={(e) => setHeiss(e.target.checked)}
          />
          🔥 heiß
        </label>
      </div>

      <div className="logby">
        {bearbeiter ? (
          <>
            Wird erfasst als <b>{bearbeiter}</b>
          </>
        ) : (
          <span className="logby-nudge">{BEARBEITER_NUDGE}</span>
        )}
      </div>

      <button
        type="button"
        className="save"
        disabled={!outcome}
        onClick={save}
      >
        Speichern
      </button>

      <div className="derive">
        Daraus wird gesetzt: Status, Notiz (mit Datum + Kanal), letzter Kontakt,
        Nächster Schritt. Du tippst einen Satz.
      </div>
    </div>
  );
}
