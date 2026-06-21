// Einstellungen — the settings view (SET-01/02/04, D6-01/05). A full-pane top-
// level view (like FocusView/CompanyTable) with three sections: Allgemein (the
// "Erfasst als" logging name), Stillgelegte Firmen (a view-only Tot/Geparkt
// list), and Daten (the type-to-confirm danger-zone clear-all).
//
// DATA-02: this component NEVER reaches the SQL layer. It imports ONLY type-only
// data + its own CSS; App owns every read/write (settings.ts, listCompanies,
// clearAllData) and passes values + callbacks as Props. The component holds only
// local UI state (active section, the controlled name draft, the confirm-word
// input). Reuses existing direction-B classes — no new color/font/radius.
import { useState } from "react";
import type { Company } from "../data/companies";
import "./Einstellungen.css";

// The exact word the user must type to arm the destructive clear-all (D6-01).
// Case-sensitive, trimmed before compare. A misclick on the disabled button
// does nothing — two layers of friction (relocated here AND gated).
const CONFIRM_WORD = "LÖSCHEN";

// The unset-bearbeiter nudge (UI-SPEC): informational, muted — NOT an error.
const BEARBEITER_NUDGE =
  "Noch kein Name gesetzt — neue Einträge werden ohne Bearbeiter gespeichert. Trag hier ein, wer Kontakte erfasst.";

type Section = "allgemein" | "stillgelegte" | "daten";

const TABS: { id: Section; label: string }[] = [
  { id: "allgemein", label: "Allgemein" },
  { id: "stillgelegte", label: "Stillgelegte Firmen" },
  { id: "daten", label: "Daten" },
];

type Props = {
  // The configured "Erfasst als" name ("" when unset). App reads it via settings.ts.
  bearbeiter: string;
  // Persist a new logging name. App calls setBearbeiter then updates its state.
  onSaveBearbeiter: (name: string) => void;
  // The Tot/Geparkt companies (App filters listCompanies). View-only here.
  stillgelegte: Company[];
  // Fire the irreversible clear-all (App calls clearAllData + refreshes).
  onClearAll: () => void;
};

export function Einstellungen({
  bearbeiter,
  onSaveBearbeiter,
  stillgelegte,
  onClearAll,
}: Props) {
  const [section, setSection] = useState<Section>("allgemein");
  // The Allgemein name draft, seeded from the persisted value.
  const [nameDraft, setNameDraft] = useState(bearbeiter);
  // The Daten type-to-confirm input. Armed only when it === CONFIRM_WORD.
  const [confirmInput, setConfirmInput] = useState("");

  const armed = confirmInput.trim() === CONFIRM_WORD;

  return (
    <div className="settings">
      {/* Tab strip — reuses the .filt pill pattern so it reads as part of the
          family (UI-SPEC §2). aria-pressed marks the active tab. */}
      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={section === t.id ? "filt on" : "filt"}
            aria-pressed={section === t.id}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "allgemein" && (
        <section className="settings-sec" data-section="allgemein">
          <h4>Allgemein</h4>
          <label className="settings-field">
            <span className="settings-field-label">Erfasst als</span>
            <input
              className="cell-input"
              type="text"
              value={nameDraft}
              placeholder="z. B. dein Name"
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </label>
          <p className="settings-help">
            Dieser Name wird bei jeder neuen Interaktion als Bearbeiter
            gespeichert.
          </p>
          {!bearbeiter && (
            <p className="settings-nudge">{BEARBEITER_NUDGE}</p>
          )}
          <button
            type="button"
            className="save"
            onClick={() => onSaveBearbeiter(nameDraft.trim())}
          >
            Speichern
          </button>
        </section>
      )}

      {section === "stillgelegte" && (
        <section className="settings-sec" data-section="stillgelegte">
          <h4>Stillgelegte Firmen</h4>
          {stillgelegte.length === 0 ? (
            <div className="settings-empty">
              <div className="settings-empty-h">Keine stillgelegten Firmen</div>
              <div className="settings-empty-b">
                Als Tot oder Geparkt markierte Firmen erscheinen hier. Aktive
                Firmen findest du in der Datenbank.
              </div>
            </div>
          ) : (
            // View-only (D6-05 / DATA-05): a muted dead-dimmed list with a status
            // pill — NO manual-status control (no select, no setStatus button).
            <ul className="still-list">
              {stillgelegte.map((c) => (
                <li key={c.id} className="still-row row-dead">
                  <span className="still-name">{c.name}</span>
                  <span className="stp tot">{c.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === "daten" && (
        <section className="settings-sec" data-section="daten">
          <h4>Daten</h4>
          {/* Danger zone — reuses the .danger-zone dashed-top block + the
              del-trigger/del-yes muted-danger recipe (2px corners, #b3261e).
              The typed word IS the confirmation — no second modal (D6-01). */}
          <div className="danger-zone">
            <p className="settings-danger-lead">
              Achtung — das kann nicht rückgängig gemacht werden.
            </p>
            <label className="settings-field">
              <span className="settings-field-label">
                Tippe <code>LÖSCHEN</code>, um das endgültige Löschen
                freizugeben.
              </span>
              <input
                className="cell-input"
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="del-yes"
              disabled={!armed}
              onClick={onClearAll}
            >
              Alle Daten löschen
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
