// CompanyTable — the Phase 1 read-only Excel-like company table (DB-01/02/03, UI-01/02).
//
// Receives Company[] as props (loaded by App via the data layer). It NEVER imports
// drizzle or the schema — the SQL boundary (DATA-02) stays intact.
//
// The look is reproduced verbatim from lean-crm-mockup.html via CompanyTable.css:
// nine columns, sticky first column + sticky header, single grid lines, navy/2px
// palette, status pills, dead-row dimming, 🔥 as the sole emoji. Phase 3 wires the
// Tot+Geparkt filter (DB-03), search/sort (DB-04/08), contact actions (CONTACT-*),
// and — this plan — "+ Neue Firma" inline-add (DB-07/D-05) plus inline cell editing
// (D-07). CSV importieren stays render-only (Phase 5).
import { Fragment, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Company, Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";
import type { Status } from "../types";
import {
  deriveNewestNote,
  deriveNextStep,
  hasNewNote,
  latestInteraction,
} from "../data/derive";
import { CompanyDetail } from "./CompanyDetail";
import type { LogEntry } from "./LogForm";
import { openLinkedIn, openMail, openTel } from "../lib/contactActions";
import { DEAD, visibleCompanies } from "../data/filterSort";
import { shortDate } from "../utils/date";
import "./CompanyTable.css";

// Status pill → mockup variant class (UI-SPEC Status pill → color map).
const PILL_VARIANT: Record<Status, string> = {
  Neu: "neu",
  Offen: "offen",
  "Im Gespräch": "gespraech",
  Termin: "termin",
  "Kein Interesse": "kein",
  Tot: "tot",
  Geparkt: "tot",
};

const EMPTY = "—"; // em dash for empty cells

// D-07: the company text fields that are inline-editable on any row. Notizen /
// Nächster Schritt / Status / Kontakt are derived/action cells and stay read-only.
type EditableField = "name" | "branche" | "groesse" | "website" | "fn" | "lessons";

// A brand-new company being entered via "+ Neue Firma" (held outside the sorted
// list until saved; D-05). Mirrors the editable fields; name is required (D-06).
type AddDraft = Record<EditableField, string>;

const EMPTY_DRAFT: AddDraft = {
  name: "",
  branche: "",
  groesse: "",
  website: "",
  fn: "",
  lessons: "",
};

// Shared input metrics for inline edit / add (UI-SPEC §2/§3: mirror .search —
// padding 7px 11px, radius 8px, 13px, 1px var(--line), focus border = accent).
// Styling lives in CompanyTable.css under .cell-input; this class is the hook.
type EditableCellProps = {
  value: string | null;
  // Render class for the static (non-editing) cell text.
  className?: string;
  // Placeholder shown for an empty value while editing (e.g. the field name).
  placeholder?: string;
  // Commit the trimmed new value. Returning false rejects the commit (e.g. a
  // required field went empty) and the cell reverts to the previous value.
  onCommit: (next: string) => boolean | void;
};

// An inline-editable table cell: click to edit, render an input in place,
// commit-on-blur, Enter commits, Escape cancels (UI-SPEC §3). The click
// stopPropagation's so editing a cell never toggles the row detail panel.
function EditableCell({
  value,
  className,
  placeholder,
  onCommit,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function begin(e: ReactMouseEvent) {
    e.stopPropagation(); // never toggle the row
    setDraft(value ?? "");
    setEditing(true);
  }

  function commit() {
    const result = onCommit(draft.trim());
    // A falsy return rejects the commit; keep the cell out of edit mode either
    // way (the parent state reverts the displayed value when rejected).
    if (result === false) {
      setEditing(false);
      return;
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <td className={className} onClick={(e) => e.stopPropagation()}>
        <input
          className="cell-input"
          autoFocus
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
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
      </td>
    );
  }

  return (
    <td className={className ? `${className} editable` : "editable"} onClick={begin}>
      {value || EMPTY}
    </td>
  );
}

// The sticky Unternehmen cell (.co) — editable like the others but it also carries
// the 🔥 glyph and the sticky/dead styling, so it gets a dedicated editor that
// preserves that markup. Required field: an empty commit reverts (D-06).
function NameCell({
  name,
  heiss,
  onCommit,
}: {
  name: string;
  heiss: boolean;
  onCommit: (next: string) => boolean | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    return (
      <td className="co" onClick={(e) => e.stopPropagation()}>
        <input
          className="cell-input"
          autoFocus
          value={draft}
          placeholder="Unternehmen"
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            onCommit(draft.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(draft.trim());
              setEditing(false);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      </td>
    );
  }

  return (
    <td
      className="co editable"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(name);
        setEditing(true);
      }}
    >
      {name}
      {heiss && <span className="fire">🔥</span>}
    </td>
  );
}

type Props = {
  companies: Company[];
  // Per-company interactions (loaded by App), keyed by firma id. Drives the
  // derived Notizen/Nächster-Schritt columns, the blue dot, and the detail panel.
  interactionsByFirma?: Record<string, Interaction[]>;
  // Per-company contacts (loaded lazily by App on open), keyed by firma id.
  contactsByFirma?: Record<string, Contact[]>;
  // Called when a row is expanded (App uses it for markViewed + lazy loads).
  onOpenRow?: (firmaId: string) => void;
  // Called when the embedded LogForm saves; App logs the interaction + refreshes.
  onSave?: (firmaId: string, entry: LogEntry) => void;
  // DB-07/D-05: called when a new company is saved from the inline-add row. App
  // persists it (Status "Neu") and refreshes the list.
  onAddCompany?: (input: {
    name: string;
    fn?: string;
    branche?: string;
    groesse?: string;
    website?: string;
  }) => void;
  // D-07: called when an inline cell edit commits. App patches the field + refreshes.
  onEditCell?: (
    firmaId: string,
    patch: Partial<Record<EditableField, string>>,
  ) => void;
  // Test-only seam: lets a test render with dead rows already visible.
  showDeadInitially?: boolean;
};

export function CompanyTable({
  companies,
  interactionsByFirma = {},
  contactsByFirma = {},
  onOpenRow,
  onSave,
  onAddCompany,
  onEditCell,
  showDeadInitially = false,
}: Props) {
  const [showDead, setShowDead] = useState(showDeadInitially);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // DB-07/D-05: the in-progress "+ Neue Firma" draft, or null when not adding.
  // Held outside the sorted list and pinned at the top of the tbody until saved.
  const [addDraft, setAddDraft] = useState<AddDraft | null>(null);

  // Build the data-layer input from the draft, dropping empty optional fields.
  function saveAddDraft() {
    if (!addDraft) return;
    const name = addDraft.name.trim();
    if (!name) return; // D-06: Unternehmen required — block save
    onAddCompany?.({
      name,
      fn: addDraft.fn.trim() || undefined,
      branche: addDraft.branche.trim() || undefined,
      groesse: addDraft.groesse.trim() || undefined,
      website: addDraft.website.trim() || undefined,
    });
    setAddDraft(null);
  }

  // Commit an inline edit on an existing company. Required Unternehmen reverts on
  // empty (return false so the cell shows the previous value); other fields accept
  // any trimmed value (including clearing to empty).
  function commitEdit(
    c: Company,
    field: EditableField,
    next: string,
  ): boolean {
    if (field === "name" && next === "") return false; // revert
    const current = (c[field] as string | null) ?? "";
    if (next === current) return true; // no-op, no write
    onEditCell?.(c.id, { [field]: next });
    return true;
  }

  function toggleRow(id: string) {
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next === id) onOpenRow?.(id); // opening → markViewed (DB-05)
      return next;
    });
  }

  // DB-08 search (D-10) stacked with the dead toggle (D-11), then always-on
  // 🔥-first German-alpha sort (DB-04, D-12) — all in the pure filterSort module.
  const visible = useMemo(
    () => visibleCompanies(companies, contactsByFirma, { search, showDead }),
    [companies, contactsByFirma, search, showDead],
  );

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="filt on" type="button" disabled>
          Aktiv
        </button>
        <button className="filt" type="button" disabled>
          🔥 Heiß
        </button>
        <button
          className={showDead ? "filt on" : "filt"}
          type="button"
          aria-pressed={showDead}
          onClick={() => setShowDead((v) => !v)}
        >
          Tot/Geparkt
        </button>
        <button className="impbtn" type="button" disabled>
          CSV importieren
        </button>
        <button
          className="addbtn"
          type="button"
          onClick={() => setAddDraft((d) => d ?? { ...EMPTY_DRAFT })}
        >
          + Neue Firma
        </button>
      </div>

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Unternehmen</th>
              <th>Branche</th>
              <th>Größe</th>
              <th>Ansprechpartner</th>
              <th>Kontakt</th>
              <th>Status</th>
              <th>Nächster Schritt</th>
              <th>Notizen</th>
              <th>Lessons learned</th>
            </tr>
          </thead>
          <tbody>
            {addDraft && (
              <tr className="r-main r-add">
                <td className="co">
                  <input
                    className="cell-input"
                    autoFocus
                    placeholder="Unternehmen"
                    value={addDraft.name}
                    onChange={(e) =>
                      setAddDraft((d) => (d ? { ...d, name: e.target.value } : d))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveAddDraft();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setAddDraft(null);
                      }
                    }}
                  />
                </td>
                {(["branche", "groesse"] as const).map((f) => (
                  <td key={f}>
                    <input
                      className="cell-input"
                      placeholder={f === "branche" ? "Branche" : "Größe"}
                      value={addDraft[f]}
                      onChange={(e) =>
                        setAddDraft((d) =>
                          d ? { ...d, [f]: e.target.value } : d,
                        )
                      }
                    />
                  </td>
                ))}
                {/* Ansprechpartner + Kontakt are managed in the detail panel (D-08). */}
                <td className="dim">{EMPTY}</td>
                <td className="dim">{EMPTY}</td>
                <td>
                  <span className="stp neu">Neu</span>
                </td>
                <td className="next dim">{EMPTY}</td>
                <td className="notiz dim">{EMPTY}</td>
                <td className="lessons">
                  <input
                    className="cell-input"
                    placeholder="Lessons"
                    value={addDraft.lessons}
                    onChange={(e) =>
                      setAddDraft((d) =>
                        d ? { ...d, lessons: e.target.value } : d,
                      )
                    }
                  />
                </td>
              </tr>
            )}
            {addDraft && (
              // Speichern/Abbrechen live in a dedicated full-width action row
              // (colSpan = all 9 columns, like the detail row) so the buttons are
              // never clipped by an individual column's width.
              <tr className="r-main r-add r-add-actions">
                <td className="addrow-actions" colSpan={9}>
                  <button
                    type="button"
                    className="save"
                    disabled={!addDraft.name.trim()}
                    onClick={saveAddDraft}
                  >
                    Speichern
                  </button>
                  <button
                    type="button"
                    className="cancel"
                    onClick={() => setAddDraft(null)}
                  >
                    Abbrechen
                  </button>
                </td>
              </tr>
            )}
            {visible.map((c) => {
              const dead = DEAD.has(c.status as Status);
              const interactions = interactionsByFirma[c.id] ?? [];
              const contacts = contactsByFirma[c.id] ?? [];

              // Derived columns (Plan 02 pure derive module).
              const newest = deriveNewestNote(interactions);
              const latest = latestInteraction(interactions);
              const nextStep = deriveNextStep(latest);
              const showDot = hasNewNote(newest, c.last_viewed);

              // First contact for the Ansprechpartner column + contact actions
              // (full list lives in the detail panel). emails[0] = primary (D-02).
              const c0 = contacts.find((k) => k.name) ?? contacts[0];
              const apName = c0?.name ?? null;
              const primaryEmail = c0?.emails?.[0] ?? null;
              const tel = c0?.telefon ?? null;
              const li = c0?.linkedin ?? null;

              const expanded = expandedId === c.id;

              return (
                <Fragment key={c.id}>
                  <tr
                    className={dead ? "r-main row-dead" : "r-main"}
                    onClick={() => toggleRow(c.id)}
                  >
                    <NameCell
                      name={c.name}
                      heiss={c.heiss}
                      onCommit={(next) => commitEdit(c, "name", next)}
                    />
                    <EditableCell
                      className="dim"
                      placeholder="Branche"
                      value={c.branche}
                      onCommit={(next) => commitEdit(c, "branche", next)}
                    />
                    <EditableCell
                      className="dim"
                      placeholder="Größe"
                      value={c.groesse}
                      onCommit={(next) => commitEdit(c, "groesse", next)}
                    />
                    <td className="dim">{apName || EMPTY}</td>
                    <td>
                      <span className="cIcons">
                        {/* CONTACT-01/02/03: enabled only when data present;
                            title reveals the value on hover (D-02); click fires
                            the OS-shell URL and stopPropagation keeps the row
                            from toggling (Pitfall 3, D-03 no confirmation). */}
                        <span
                          className={tel ? "ci tel" : "ci off"}
                          title={tel ?? undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (tel) openTel(tel);
                          }}
                        >
                          Tel
                        </span>
                        <span
                          className={primaryEmail ? "ci" : "ci off"}
                          title={primaryEmail ?? undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (primaryEmail) openMail(primaryEmail);
                          }}
                        >
                          Mail
                        </span>
                        <span
                          className={li ? "ci li acc" : "ci off"}
                          title={li ?? undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (li) openLinkedIn(li);
                          }}
                        >
                          in
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className={`stp ${PILL_VARIANT[c.status as Status]}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="next dim">{nextStep || EMPTY}</td>
                    <td className="notiz dim">
                      {newest ? (
                        <>
                          {showDot && <span className="ndot" />}
                          <span className="src">
                            {newest.kanal || EMPTY} {shortDate(newest.datum)}
                          </span>
                          <span className="txt">{newest.notiz || EMPTY}</span>
                        </>
                      ) : (
                        EMPTY
                      )}
                    </td>
                    <EditableCell
                      className="lessons dim"
                      placeholder="Lessons"
                      value={c.lessons}
                      onCommit={(next) => commitEdit(c, "lessons", next)}
                    />
                  </tr>
                  {expanded && (
                    <tr className="detail">
                      <td colSpan={9}>
                        <CompanyDetail
                          contacts={contacts}
                          interactions={interactions}
                          onSave={(entry) => onSave?.(c.id, entry)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {companies.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  <div className="empty-h">Noch keine Firmen</div>
                  <div className="empty-b">
                    Importiere die Lead-Liste über „CSV importieren" oder lege mit
                    „+ Neue Firma" eine an.
                  </div>
                </td>
              </tr>
            )}
            {companies.length > 0 && visible.length === 0 && search.trim() && (
              <tr>
                <td colSpan={9} className="empty">
                  <div className="empty-b">
                    {`Keine Firma passt zu „${search.trim()}".`}
                  </div>
                </td>
              </tr>
            )}
            {companies.length > 0 && visible.length === 0 && !search.trim() && (
              <tr>
                <td colSpan={9} className="empty">
                  <div className="empty-b">
                    Keine aktiven Firmen. Aktiviere „Tot/Geparkt", um stillgelegte
                    Firmen zu sehen.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="hint">
        Die HEISS-Markierung wird beim Loggen gesetzt und sortiert die Firma nach oben.
        Notizen-Spalte zeigt die neueste Notiz mit Datum und Kanal; blauer Punkt = neu
        seit letztem Blick. Zeile anklicken zum Eintragen.
      </div>
    </>
  );
}
