// CompanyDetail — the inline expand panel below a company row (DB-06).
//
// Two columns (direction B): left = Ansprechpartner + "Verlauf (Notizen)" history
// (newest-first); right = the LogForm. DATA-02: this component NEVER imports
// drizzle/db — it receives company/contacts/interactions as props and bubbles
// saves up via onSave. The parent (App) owns every data-layer call and the
// markViewed-on-open behaviour. Structure + German copy from lean-crm-mockup.html
// lines 192-215; colors from direction B (CompanyTable.css :root). 🔥 lives only
// inside the embedded LogForm.
import { useState } from "react";
import type { Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";
import { LogForm, type LogEntry } from "./LogForm";
import { shortDate } from "../utils/date";
import "./CompanyDetail.css";

const EMPTY = "—";

type Props = {
  contacts: Contact[];
  interactions: Interaction[];
  onSave: (entry: LogEntry) => void;
  // Addition 2: hard-delete this company (cascade). Optional so existing tests /
  // callers that don't wire it simply hide the Löschen action.
  onDelete?: () => void;
};

export function CompanyDetail({ contacts, interactions, onSave, onDelete }: Props) {
  // Addition 2: the "Löschen" action uses a two-step INLINE confirm (no modal),
  // mirroring the D-08 contact-removal pattern: click Löschen → "Wirklich löschen?
  // Ja / Abbrechen". The confirm step is the sole guard against an accidental click.
  const [confirming, setConfirming] = useState(false);
  // Newest-first (datum desc). listInteractions already sorts this way, but the
  // panel re-sorts defensively so it never depends on caller order.
  const history = [...interactions].sort((a, b) =>
    a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0,
  );

  return (
    <div className="dpanel">
      <div className="dcol">
        {contacts.length > 0 && (
          <>
            <h4>Ansprechpartner</h4>
            {contacts.map((c) => (
              <div className="person" key={c.id}>
                <div>
                  <div className="pn">
                    {c.name || EMPTY}
                    {c.relevant && <span className="badge">relevant</span>}
                  </div>
                  {c.rolle && <div className="pr">{c.rolle}</div>}
                </div>
              </div>
            ))}
          </>
        )}

        <h4 className={contacts.length > 0 ? "mt" : undefined}>Verlauf (Notizen)</h4>
        {history.length === 0 ? (
          <div className="hist-empty">Noch kein Kontakt.</div>
        ) : (
          <div className="hist">
            {history.map((i) => (
              <div className="hi" key={i.id}>
                <span className="dot" />
                <div className="hm">
                  {shortDate(i.datum)} · {i.kanal || EMPTY}{" "}
                  <span className="by">{i.bearbeiter}</span>
                </div>
                {i.notiz || EMPTY}
              </div>
            ))}
          </div>
        )}

        {onDelete && (
          <div className="danger-zone">
            {confirming ? (
              <span className="confirm-del">
                Wirklich löschen?{" "}
                <button
                  type="button"
                  className="del-yes"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                >
                  Ja, löschen
                </button>
                <button
                  type="button"
                  className="del-cancel"
                  onClick={() => setConfirming(false)}
                >
                  Abbrechen
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="del-trigger"
                onClick={() => setConfirming(true)}
              >
                Löschen
              </button>
            )}
          </div>
        )}
      </div>

      <div className="dcol">
        <h4>Neuer Eintrag</h4>
        <LogForm onSave={onSave} />
      </div>
    </div>
  );
}
