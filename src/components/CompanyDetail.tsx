// CompanyDetail — the inline expand panel below a company row (DB-06).
//
// Two columns (direction B): left = Ansprechpartner + "Verlauf (Notizen)" history
// (newest-first); right = the LogForm. DATA-02: this component NEVER imports
// drizzle/db — it receives company/contacts/interactions as props and bubbles
// saves up via onSave. The parent (App) owns every data-layer call and the
// markViewed-on-open behaviour. Structure + German copy from lean-crm-mockup.html
// lines 192-215; colors from direction B (CompanyTable.css :root). 🔥 lives only
// inside the embedded LogForm.
//
// Plan 03-04 (D-08): the Ansprechpartner block is now EDITABLE — add / edit /
// remove contacts (each with multiple emails) for new and existing companies.
// The component owns FORM/EDIT state only; App owns all data-layer calls (DATA-02)
// via the onAddContact / onUpdateContact / onDeleteContact / onSetContactEmails
// callback props. Removal uses an inline confirm (no modal), mirroring Löschen.
import { useEffect, useRef, useState } from "react";
import {
  IconBuildingSkyscraper,
  IconTargetArrow,
  IconNote,
} from "@tabler/icons-react";
import type { Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";
import { LogForm, type LogEntry } from "./LogForm";
import { shortDate } from "../utils/date";
import "./CompanyDetail.css";

const EMPTY = "—";

// D-08: the editable text fields of a contact (emails are managed separately).
type ContactField = "name" | "rolle" | "telefon" | "linkedin";

type ContactInput = {
  name?: string;
  rolle?: string;
  telefon?: string;
  linkedin?: string;
  emails?: string[];
};

type Props = {
  contacts: Contact[];
  interactions: Interaction[];
  onSave: (entry: LogEntry) => void;
  // D6-03: the configured "Erfasst als" name, threaded down to the embedded
  // LogForm. Optional (default "") so existing callers/tests that don't wire it
  // get the unset-nudge behavior without breaking — App supplies the real value.
  bearbeiter?: string;
  // Addition 2: hard-delete this company (cascade). Optional so existing tests /
  // callers that don't wire it simply hide the Löschen action.
  onDelete?: () => void;
  // D-08 contact management (Plan 03-04). Optional so callers/tests that don't
  // wire them get the read-only Phase-2 block (back-compat). When present, the
  // Ansprechpartner block becomes editable.
  onAddContact?: (input: ContactInput) => void;
  onUpdateContact?: (kontaktId: string, patch: Partial<Record<ContactField, string>>) => void;
  onDeleteContact?: (kontaktId: string) => void;
  onSetContactEmails?: (kontaktId: string, emails: string[]) => void;
};

// An inline-editable text input that commits on blur / Enter and reverts on
// Escape. Adopts the shared .cell-input metrics (UI-SPEC §2/§3). The single-shot
// `handled` guard mirrors CompanyTable's EditableCell so WebView2's trailing
// unmount-blur never double-commits and Escape never commits the discarded draft.
function InlineField({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const handled = useRef(false);

  // Keep the draft in sync when the upstream value changes (e.g. after a reload).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (handled.current) return;
    handled.current = true;
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
    // Reset the guard on the next tick so a subsequent edit of the same field works.
    setTimeout(() => {
      handled.current = false;
    }, 0);
  }

  function cancel() {
    if (handled.current) return;
    handled.current = true;
    setDraft(value); // revert
    setTimeout(() => {
      handled.current = false;
    }, 0);
  }

  return (
    <input
      className={className ? `cell-input ${className}` : "cell-input"}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}

// One editable person row for an existing contact (D-08). Each text field commits
// independently via onUpdateContact; the email field replaces the contact's whole
// email set via onSetContactEmails (DATA-04). Entfernen uses an inline confirm.
function EditablePerson({
  contact,
  onUpdateContact,
  onDeleteContact,
  onSetContactEmails,
}: {
  contact: Contact;
  onUpdateContact: (kontaktId: string, patch: Partial<Record<ContactField, string>>) => void;
  onDeleteContact: (kontaktId: string) => void;
  onSetContactEmails: (kontaktId: string, emails: string[]) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // Render each stored email as an editable field, plus one trailing empty field
  // so a new email can always be added (DATA-04: multiple emails per contact).
  // Committing rebuilds the whole set and replaces it via onSetContactEmails;
  // empties are filtered (the data layer filters again defensively).
  const emails = [...contact.emails, ""];

  function commitEmail(index: number, next: string) {
    const updated = [...emails];
    updated[index] = next;
    onSetContactEmails(
      contact.id,
      updated.map((e) => e.trim()).filter(Boolean),
    );
  }

  return (
    <div className="person person-edit">
      <div className="person-fields">
        <InlineField
          className="pn-input"
          value={contact.name ?? ""}
          placeholder="Name"
          onCommit={(next) => onUpdateContact(contact.id, { name: next })}
        />
        <InlineField
          value={contact.rolle ?? ""}
          placeholder="Rolle"
          onCommit={(next) => onUpdateContact(contact.id, { rolle: next })}
        />
        <InlineField
          value={contact.telefon ?? ""}
          placeholder="Telefon"
          onCommit={(next) => onUpdateContact(contact.id, { telefon: next })}
        />
        <InlineField
          value={contact.linkedin ?? ""}
          placeholder="LinkedIn"
          onCommit={(next) => onUpdateContact(contact.id, { linkedin: next })}
        />
        {emails.map((email, i) => (
          <InlineField
            key={i}
            value={email}
            placeholder={i === 0 ? "E-Mail" : "Weitere E-Mail"}
            onCommit={(next) => commitEmail(i, next)}
          />
        ))}
      </div>
      <div className="person-actions">
        {confirming ? (
          <span className="confirm-del">
            Wirklich entfernen?{" "}
            <button
              type="button"
              className="del-yes"
              onClick={() => {
                setConfirming(false);
                onDeleteContact(contact.id);
              }}
            >
              Ja
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
            className="del-trigger person-remove"
            onClick={() => setConfirming(true)}
          >
            Entfernen
          </button>
        )}
      </div>
    </div>
  );
}

// The "+ Ansprechpartner" add block (D-08): an editable draft person committed
// via onAddContact. Name is the lead field; all fields optional at the data layer.
function AddPerson({
  onAddContact,
  onCancel,
}: {
  onAddContact: (input: ContactInput) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<{
    name: string;
    rolle: string;
    telefon: string;
    linkedin: string;
    email: string;
  }>({ name: "", rolle: "", telefon: "", linkedin: "", email: "" });

  function save() {
    const name = draft.name.trim();
    if (!name) return; // a nameless contact has no use in the panel
    onAddContact({
      name,
      rolle: draft.rolle.trim() || undefined,
      telefon: draft.telefon.trim() || undefined,
      linkedin: draft.linkedin.trim() || undefined,
      emails: draft.email.trim() ? [draft.email.trim()] : [],
    });
  }

  return (
    <div className="person person-edit person-add">
      <div className="person-fields">
        <input
          className="cell-input pn-input"
          autoFocus
          placeholder="Name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <input
          className="cell-input"
          placeholder="Rolle"
          value={draft.rolle}
          onChange={(e) => setDraft((d) => ({ ...d, rolle: e.target.value }))}
        />
        <input
          className="cell-input"
          placeholder="Telefon"
          value={draft.telefon}
          onChange={(e) => setDraft((d) => ({ ...d, telefon: e.target.value }))}
        />
        <input
          className="cell-input"
          placeholder="LinkedIn"
          value={draft.linkedin}
          onChange={(e) => setDraft((d) => ({ ...d, linkedin: e.target.value }))}
        />
        <input
          className="cell-input"
          placeholder="E-Mail"
          value={draft.email}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
        />
      </div>
      <div className="person-actions">
        <button
          type="button"
          className="save"
          disabled={!draft.name.trim()}
          onClick={save}
        >
          Speichern
        </button>
        <button type="button" className="cancel" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

export function CompanyDetail({
  contacts,
  interactions,
  onSave,
  onDelete,
  onAddContact,
  onUpdateContact,
  onDeleteContact,
  onSetContactEmails,
  bearbeiter = "",
}: Props) {
  // Addition 2: the "Löschen" action uses a two-step INLINE confirm (no modal),
  // mirroring the D-08 contact-removal pattern: click Löschen → "Wirklich löschen?
  // Ja / Abbrechen". The confirm step is the sole guard against an accidental click.
  const [confirming, setConfirming] = useState(false);
  // D-08: whether the "+ Ansprechpartner" add block is open.
  const [adding, setAdding] = useState(false);
  // The contact block is editable only when the full handler set is wired (App).
  // Without them we fall back to the read-only Phase-2 block (back-compat).
  const editable =
    !!onAddContact && !!onUpdateContact && !!onDeleteContact && !!onSetContactEmails;
  // Newest-first (datum desc). listInteractions already sorts this way, but the
  // panel re-sorts defensively so it never depends on caller order.
  const history = [...interactions].sort((a, b) =>
    a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0,
  );

  return (
    <div className="dpanel">
      <div className="dcol">
        {editable ? (
          // D-08: editable Ansprechpartner block. Always shown (even with no
          // contacts) so "+ Ansprechpartner" is reachable for a freshly added
          // company that has none yet.
          <>
            <h4>
              <IconBuildingSkyscraper size={16} />
              Ansprechpartner
            </h4>
            {contacts.map((c) => (
              <EditablePerson
                key={c.id}
                contact={c}
                onUpdateContact={onUpdateContact!}
                onDeleteContact={onDeleteContact!}
                onSetContactEmails={onSetContactEmails!}
              />
            ))}
            {adding ? (
              <AddPerson
                onAddContact={(input) => {
                  onAddContact!(input);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <button
                type="button"
                className="add-contact"
                onClick={() => setAdding(true)}
              >
                + Ansprechpartner
              </button>
            )}
          </>
        ) : (
          // Read-only Phase-2 block (no contact handlers wired).
          contacts.length > 0 && (
            <>
              <h4>
                <IconBuildingSkyscraper size={16} />
                Ansprechpartner
              </h4>
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
          )
        )}

        <h4 className={editable || contacts.length > 0 ? "mt" : undefined}>
          <IconNote size={16} />
          Verlauf (Notizen)
        </h4>
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
        <h4>
          <IconTargetArrow size={16} />
          Neuer Eintrag
        </h4>
        <LogForm onSave={onSave} bearbeiter={bearbeiter} />
      </div>
    </div>
  );
}
