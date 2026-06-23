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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { Company, Contact } from "../data/companies";
import { TRASH_RETENTION_DAYS } from "../data/companies";
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
import {
  IconPhone,
  IconMail,
  IconBrandLinkedin,
  IconPlus,
  IconDotsVertical,
} from "@tabler/icons-react";
import "./CompanyTable.css";

// Status pill → Twenty tag variant class (RDS-03; UI-SPEC §Status tag pills).
// Covers ALL 7 derived statuses from derive.ts. Derivation is untouched — this is
// purely the real-vocabulary → pill-class lookup.
const PILL_VARIANT: Record<Status, string> = {
  Neu: "t-neu",
  Offen: "t-kontaktiert",
  "Im Gespräch": "t-interessiert",
  Termin: "t-kunde",
  "Kein Interesse": "t-tot",
  Tot: "t-tot",
  Geparkt: "t-geparkt",
};

// Deterministic cosmetic avatar tint: hash the company name to one of the Twenty
// accent palette hexes (RDS-03 avatar tile). Pure — no state, no data layer.
const AVATAR_COLORS = ["#3e63dd", "#30a46c", "#8e4ec6", "#f76b15", "#0091c4"];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const EMPTY = "—"; // em dash for empty cells

// "Zuletzt gelöscht": days remaining before auto-purge, given a deleted_at ISO
// stamp. retention minus whole days elapsed, floored at 0 so an expired-but-not-
// yet-purged row never shows a negative count. TRASH_RETENTION_DAYS is the single
// source of truth shared with the data layer's purge.
function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return TRASH_RETENTION_DAYS;
  const elapsedMs = Date.now() - new Date(deletedAt).getTime();
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}

// D-07: the company text fields that are inline-editable on any row. Nächster
// Schritt / Status / Kontakt are derived/action cells and stay read-only.
// Notizen is ALSO inline-editable (Addition 1, D-07 amended) but it is NOT a
// company field — it edits the newest interaction's note via onEditNote, so it
// is handled separately (NotizCell) and is intentionally absent from this union.
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

// The inline-edit state machine shared by the three click-to-reveal table cells
// (EditableCell / NameCell / NotizCell). Holds the editing toggle, the draft, the
// focus-on-enter effect, and the single-shot `handled` guard that makes WebView2's
// trailing unmount-blur a no-op — so Enter never double-writes and Escape never
// commits the discarded draft. Returns the <input> wiring all three share verbatim
// (`inputProps`); each cell renders only its own markup + placeholder. begin(seed)
// enters edit mode with the seed text; onCommit's falsy return reverts (the parent
// rejects, e.g. a required field gone empty).
function useInlineEdit(onCommit: (next: string) => boolean | void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const handled = useRef(false);

  // Focus + select the text on entering edit mode (explicit ref focus is more
  // reliable than `autoFocus` inside a re-rendered table in WebView2, and the
  // select gives the Excel-like "click then type to replace" feel), and reset the
  // single-shot guard so the next commit/cancel runs.
  useEffect(() => {
    if (!editing) return;
    handled.current = false;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  function begin(seed: string) {
    setDraft(seed);
    setEditing(true);
  }

  function commit() {
    if (handled.current) return; // already committed/cancelled (trailing blur)
    handled.current = true;
    onCommit(draft.trim()); // a falsy return reverts via the parent's state
    setEditing(false);
  }

  function cancel() {
    if (handled.current) return;
    handled.current = true;
    setEditing(false); // revert: never call onCommit
  }

  // The input wiring every cell shares. onClick stopPropagation keeps editing a
  // cell from toggling the row detail panel.
  const inputProps = {
    ref: inputRef,
    className: "cell-input",
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onClick: (e: ReactMouseEvent) => e.stopPropagation(),
    onBlur: commit,
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
  };

  return { editing, begin, inputProps };
}

// An inline-editable table cell: click to edit, render an input in place,
// commit-on-blur, Enter commits, Escape cancels (UI-SPEC §3). The click
// stopPropagation's so editing a cell never toggles the row detail panel.
function EditableCell({
  value,
  className,
  placeholder,
  onCommit,
}: EditableCellProps) {
  const { editing, begin, inputProps } = useInlineEdit(onCommit);

  if (editing) {
    return (
      <td className={className} onClick={(e) => e.stopPropagation()}>
        <input {...inputProps} placeholder={placeholder} />
      </td>
    );
  }

  return (
    <td
      className={className ? `${className} editable` : "editable"}
      onClick={(e) => {
        e.stopPropagation();
        begin(value ?? "");
      }}
    >
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
  const { editing, begin, inputProps } = useInlineEdit(onCommit);

  if (editing) {
    return (
      <td className="co" onClick={(e) => e.stopPropagation()}>
        <input {...inputProps} placeholder="Unternehmen" />
      </td>
    );
  }

  return (
    <td
      className="co editable"
      onClick={(e) => {
        e.stopPropagation();
        begin(name);
      }}
    >
      <span className="cellfirm">
        <span className="avatar" style={{ background: avatarColor(name) }}>
          {name.charAt(0).toUpperCase()}
        </span>
        {name}
        {heiss && <span className="fire">🔥</span>}
      </span>
    </td>
  );
}

// The Notizen cell (.notiz) — shows the newest interaction's note (channel + date
// header, then the note text) and is inline-editable (Addition 1, D-07 amended).
// Editing rewrites ONLY the note text; the channel/date header (derived from the
// interaction) is preserved as static context. Reuses EditableCell's mechanism:
// the single-shot `handled` guard for WebView2's trailing unmount-blur, and the
// explicit ref focus+select. Required: rendered ONLY when a newest note exists;
// a company with no interactions has no note to edit (placeholder em-dash, no
// editor) — the way to create a first note is logging an interaction.
function NotizCell({
  header,
  showDot,
  notiz,
  onCommit,
}: {
  // The "{kanal} {date}" source line shown above the editable note text.
  header: string;
  showDot: boolean;
  notiz: string;
  onCommit: (next: string) => boolean | void;
}) {
  const { editing, begin, inputProps } = useInlineEdit(onCommit);

  if (editing) {
    return (
      <td className="notiz dim" onClick={(e) => e.stopPropagation()}>
        <span className="src">{header}</span>
        <input {...inputProps} placeholder="Notiz" />
      </td>
    );
  }

  return (
    <td
      className="notiz dim editable"
      onClick={(e) => {
        e.stopPropagation();
        begin(notiz);
      }}
    >
      {showDot && <span className="ndot" />}
      <span className="src">{header}</span>
      <span className="txt">{notiz || EMPTY}</span>
    </td>
  );
}

type Props = {
  companies: Company[];
  // "Zuletzt gelöscht": the soft-deleted companies (loaded by App). Rendered in
  // the trash view; each carries deleted_at so we can show "noch X Tage".
  deletedCompanies?: Company[];
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
  // Addition 1 (D-07 amended): called when the Notizen cell edit commits. App
  // rewrites the newest interaction's note (interactionId) + refreshes.
  onEditNote?: (firmaId: string, interactionId: string, text: string) => void;
  // Addition 2 / "Zuletzt gelöscht": called when "Löschen" is confirmed (right-
  // click or detail panel). App now SOFT-deletes (moves to trash) + refreshes.
  onDeleteCompany?: (firmaId: string) => void;
  // Trash view: restore a soft-deleted company back to the active list.
  onRestoreCompany?: (firmaId: string) => void;
  // Trash view: "Endgültig löschen" — permanent hard-delete (cascade).
  onPermanentDelete?: (firmaId: string) => void;
  // D-08 (Plan 03-04): contact management in the detail panel. Threaded down to
  // CompanyDetail the same way onSave is, binding firmaId = c.id. App calls the
  // contacts data layer then reloads contactsByFirma.
  onAddContact?: (
    firmaId: string,
    input: {
      name?: string;
      rolle?: string;
      telefon?: string;
      linkedin?: string;
      emails?: string[];
    },
  ) => void;
  onUpdateContact?: (
    firmaId: string,
    kontaktId: string,
    patch: Partial<Record<"name" | "rolle" | "telefon" | "linkedin", string>>,
  ) => void;
  onDeleteContact?: (firmaId: string, kontaktId: string) => void;
  onSetContactEmails?: (
    firmaId: string,
    kontaktId: string,
    emails: string[],
  ) => void;
  // D-11: opens Focus mode. The sidebar "Fokus" nav row is the canonical launcher;
  // App snapshots getFocusSnapshot() once and mounts FocusView.
  onOpenFocus?: () => void;
  // Phase 07 (RDS-02): a request nonce bumped by the topbar "Neue Firma" button in
  // App.tsx. Each increment asks the table to open its add-draft row. Import is now
  // owned by the topbar (App reads file.text() → parse → preview), so CompanyTable
  // no longer carries an onImport prop — the SQL boundary (DATA-02) stays in App.
  addRequest?: number;
  // D6-03: the configured "Erfasst als" name, threaded down to the embedded
  // CompanyDetail → LogForm. Optional (default "") so existing tests get the
  // unset nudge. App supplies the real value (read via settings.ts).
  bearbeiter?: string;
  // Test-only seam: lets a test render the "Zuletzt gelöscht" trash view directly.
  trashViewInitially?: boolean;
};

export function CompanyTable({
  companies,
  deletedCompanies = [],
  interactionsByFirma = {},
  contactsByFirma = {},
  onOpenRow,
  onSave,
  onAddCompany,
  onEditCell,
  onEditNote,
  onDeleteCompany,
  onRestoreCompany,
  onPermanentDelete,
  onAddContact,
  onUpdateContact,
  onDeleteContact,
  onSetContactEmails,
  addRequest,
  bearbeiter = "",
  trashViewInitially = false,
}: Props) {
  // "Zuletzt gelöscht": when true, the trash view replaces the normal table.
  const [trashView, setTrashView] = useState(trashViewInitially);
  // The trash row currently in its inline "Wirklich löschen?" confirm, or null.
  const [confirmPurgeId, setConfirmPurgeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // DB-07/D-05: the in-progress "+ Neue Firma" draft, or null when not adding.
  // Held outside the sorted list and pinned at the top of the tbody until saved.
  const [addDraft, setAddDraft] = useState<AddDraft | null>(null);
  // Addition 3: the right-click context menu. A single state slot guarantees only
  // one menu is open at a time. `firmaId` is the row to delete, `x`/`y` are the
  // cursor coordinates for fixed positioning, `confirming` flips the menu from the
  // single "Löschen" item to the two-step "Ja, löschen / Abbrechen" confirm.
  const [contextMenu, setContextMenu] = useState<{
    firmaId: string;
    x: number;
    y: number;
    confirming: boolean;
  } | null>(null);

  // Open the menu at the cursor for a real (saved) company row. Suppresses the
  // native WebView2/browser context menu so only our custom menu shows. Right-
  // clicking another row just replaces the state → the menu moves, never stacks.
  function openContextMenu(e: ReactMouseEvent, firmaId: string) {
    e.preventDefault();
    setContextMenu({ firmaId, x: e.clientX, y: e.clientY, confirming: false });
  }

  // Close on Escape, on any outside mousedown, or on a right-click elsewhere
  // (the document-level contextmenu also re-fires for row right-clicks, but the
  // row handler's setState runs after and re-opens at the new spot). The menu's
  // own clicks stopPropagation so they never reach these document listeners.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Phase 07 (RDS-02): the topbar "Neue Firma" button bumps `addRequest`; each
  // bump opens the add-draft row (the in-table "+ Neue Firma" button is gone). The
  // `if (addRequest)` guard skips the initial 0 so the draft isn't open on mount.
  useEffect(() => {
    if (addRequest) setAddDraft((d) => d ?? { ...EMPTY_DRAFT });
  }, [addRequest]);

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

  // DB-08 search (D-10) over the active list (Tot/Geparkt unconditionally excluded,
  // D6-07), then always-on 🔥-first German-alpha sort (DB-04, D-12) — all in the
  // pure filterSort module.
  const visible = useMemo(
    () => visibleCompanies(companies, contactsByFirma, { search }),
    [companies, contactsByFirma, search],
  );

  // Phase 07 (RDS-03): the detail surface is now a 500px right-side panel beside
  // the narrowed table (a .detail-wrap flex row), not an in-row colSpan expand.
  // Resolve the selected company + its primary-contact values once for the panel.
  const selected = expandedId
    ? visible.find((c) => c.id === expandedId)
    : undefined;
  const selContacts = selected ? contactsByFirma[selected.id] ?? [] : [];
  const selInteractions = selected
    ? interactionsByFirma[selected.id] ?? []
    : [];
  const selC0 = selContacts.find((k) => k.name) ?? selContacts[0];
  const selTel = selC0?.telefon ?? null;
  const selEmail = selC0?.emails?.[0] ?? null;
  const selLi = selC0?.linkedin ?? null;

  return (
    <>
      {/* View toolbar (RDS-02): the Twenty `.viewbar`. The `.vtab` view tabs re-tone
          the existing wired Aktiv / Zuletzt-gelöscht toggle (handlers unchanged;
          active tab = --gray4 fill). The dashed `.chip` "Filter" and the overflow
          IconDotsVertical are render-only affordances per the approved mockup. Import
          + Neue Firma live in the App.tsx topbar now (Plan 01). */}
      <div className="viewbar">
        <span
          className={!trashView ? "vtab active" : "vtab"}
          role="button"
          tabIndex={0}
          aria-pressed={!trashView}
          onClick={() => setTrashView(false)}
        >
          Aktiv
        </span>
        <span
          className={trashView ? "vtab active" : "vtab"}
          role="button"
          tabIndex={0}
          aria-pressed={trashView}
          onClick={() => {
            setTrashView(true);
            setConfirmPurgeId(null);
          }}
        >
          Zuletzt gelöscht
        </span>
        <span className="chip">
          <IconPlus size={14} />
          Filter
        </span>
        <input
          className="search"
          placeholder="Suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <span className="vtab">
          <IconDotsVertical size={16} />
        </span>
      </div>

      {trashView && (
        // "Zuletzt gelöscht": a focused, read-only trash table. Each row shows the
        // company name + "noch X Tage" until auto-purge, and two text actions —
        // Wiederherstellen (restore) and Endgültig löschen (permanent, with the
        // same inline confirm used elsewhere). No add / inline-edit / contact
        // actions here by design.
        <div className="tw">
          <table className="trash-table">
            <thead>
              <tr>
                <th>Unternehmen</th>
                <th>Verbleibend</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {deletedCompanies.map((c) => {
                const left = daysLeft(c.deleted_at);
                return (
                  <tr key={c.id} className="r-main r-trash">
                    <td className="co">
                      {c.name}
                      {c.heiss && <span className="fire">🔥</span>}
                    </td>
                    <td className="trash-left dim">{`noch ${left} ${
                      left === 1 ? "Tag" : "Tage"
                    }`}</td>
                    <td className="trash-actions">
                      {confirmPurgeId === c.id ? (
                        <span className="confirm-del">
                          Wirklich löschen?{" "}
                          <button
                            type="button"
                            className="del-yes"
                            onClick={() => {
                              setConfirmPurgeId(null);
                              onPermanentDelete?.(c.id);
                            }}
                          >
                            Ja, löschen
                          </button>
                          <button
                            type="button"
                            className="del-cancel"
                            onClick={() => setConfirmPurgeId(null)}
                          >
                            Abbrechen
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="trash-restore"
                            onClick={() => onRestoreCompany?.(c.id)}
                          >
                            Wiederherstellen
                          </button>
                          <button
                            type="button"
                            className="trash-purge del-trigger"
                            onClick={() => setConfirmPurgeId(c.id)}
                          >
                            Endgültig löschen
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {deletedCompanies.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty">
                    <div className="empty-h">Papierkorb ist leer</div>
                    <div className="empty-b">
                      Gelöschte Firmen erscheinen hier und bleiben{" "}
                      {TRASH_RETENTION_DAYS} Tage wiederherstellbar.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!trashView && (
      <div className="detail-wrap">
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
                  <span className="tag t-neu">
                    <span className="dot" />
                    Neu
                  </span>
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

              return (
                <Fragment key={c.id}>
                  <tr
                    className={dead ? "r-main row-dead" : "r-main"}
                    onClick={() => toggleRow(c.id)}
                    onContextMenu={(e) => openContextMenu(e, c.id)}
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
                      {tel || primaryEmail || li ? (
                        <span className="linkrow">
                          {/* CONTACT-01/02/03: enabled only when data present;
                              title reveals the value on hover (D-02); click fires
                              the OS-shell URL and stopPropagation keeps the row
                              from toggling (Pitfall 3, D-03 no confirmation). */}
                          <span
                            className={tel ? "minilink tel" : "minilink off"}
                            title={tel ?? undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (tel) openTel(tel);
                            }}
                          >
                            <IconPhone size={14} />
                            Tel
                          </span>
                          <span
                            className={primaryEmail ? "minilink" : "minilink off"}
                            title={primaryEmail ?? undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (primaryEmail) openMail(primaryEmail);
                            }}
                          >
                            <IconMail size={14} />
                            Mail
                          </span>
                          <span
                            className={li ? "minilink acc" : "minilink off"}
                            title={li ?? undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (li) openLinkedIn(li);
                            }}
                          >
                            <IconBrandLinkedin size={14} />
                            in
                          </span>
                        </span>
                      ) : (
                        <span className="muted-cell">{EMPTY}</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${PILL_VARIANT[c.status as Status]}`}>
                        <span className="dot" />
                        {c.status}
                      </span>
                    </td>
                    <td className="next dim">{nextStep || EMPTY}</td>
                    {newest && latest ? (
                      // Addition 1 (D-07 amended): editable Notizen — rewrites the
                      // newest interaction's note (latest.id). Channel/date header
                      // stays static context.
                      <NotizCell
                        header={`${newest.kanal || EMPTY} ${shortDate(newest.datum)}`}
                        showDot={showDot}
                        notiz={newest.notiz}
                        onCommit={(next) => {
                          if (next === (newest.notiz ?? "")) return true; // no-op
                          onEditNote?.(c.id, latest.id, next);
                          return true;
                        }}
                      />
                    ) : (
                      // No interactions yet → no note to override. Non-editable
                      // placeholder; logging an interaction is how a first note is
                      // created (Addition 1 edge case).
                      <td className="notiz dim">{EMPTY}</td>
                    )}
                    <EditableCell
                      className="lessons dim"
                      placeholder="Lessons"
                      value={c.lessons}
                      onCommit={(next) => commitEdit(c, "lessons", next)}
                    />
                  </tr>
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
                    Keine aktiven Firmen. Stillgelegte (Tot/Geparkt) Firmen findest
                    du unter Einstellungen.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && (
        <CompanyDetail
          name={selected.name}
          status={selected.status}
          statusClass={PILL_VARIANT[selected.status as Status]}
          avatarBg={avatarColor(selected.name)}
          tel={selTel}
          email={selEmail}
          linkedin={selLi}
          onTel={() => selTel && openTel(selTel)}
          onMail={() => selEmail && openMail(selEmail)}
          onLinkedIn={() => selLi && openLinkedIn(selLi)}
          contacts={selContacts}
          interactions={selInteractions}
          bearbeiter={bearbeiter}
          onSave={(entry) => onSave?.(selected.id, entry)}
          onDelete={
            onDeleteCompany
              ? () => {
                  // Close the panel (the row vanishes after the parent refresh)
                  // and bubble the delete up.
                  setExpandedId(null);
                  onDeleteCompany(selected.id);
                }
              : undefined
          }
          onAddContact={
            onAddContact ? (input) => onAddContact(selected.id, input) : undefined
          }
          onUpdateContact={
            onUpdateContact
              ? (kontaktId, patch) =>
                  onUpdateContact(selected.id, kontaktId, patch)
              : undefined
          }
          onDeleteContact={
            onDeleteContact
              ? (kontaktId) => onDeleteContact(selected.id, kontaktId)
              : undefined
          }
          onSetContactEmails={
            onSetContactEmails
              ? (kontaktId, emails) =>
                  onSetContactEmails(selected.id, kontaktId, emails)
              : undefined
          }
        />
      )}
      </div>
      )}

      {/* Addition 3: the right-click context menu. Fixed-positioned at the cursor.
          Corporate look (sharp 2px corners, muted navy, thin line, text items). Its
          own mousedown/click stopPropagation so document listeners don't close it
          before the action fires. Mirrors the detail-panel confirm classes so the
          two delete entry points share one look. */}
      {contextMenu && (
        <div
          role="menu"
          className="ctxmenu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.confirming ? (
            <span className="confirm-del">
              Wirklich löschen?{" "}
              <button
                type="button"
                className="del-yes"
                onClick={() => {
                  const id = contextMenu.firmaId;
                  setContextMenu(null);
                  // If this company's detail panel is open, close it too — the row
                  // vanishes after the parent refresh removes the company.
                  setExpandedId((cur) => (cur === id ? null : cur));
                  onDeleteCompany?.(id);
                }}
              >
                Ja, löschen
              </button>
              <button
                type="button"
                className="del-cancel"
                onClick={() => setContextMenu(null)}
              >
                Abbrechen
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="ctx-item del-trigger"
              onClick={() =>
                setContextMenu((m) => (m ? { ...m, confirming: true } : m))
              }
            >
              Löschen
            </button>
          )}
        </div>
      )}

      <div className="hint">
        Die HEISS-Markierung wird beim Loggen gesetzt und sortiert die Firma nach oben.
        Notizen-Spalte zeigt die neueste Notiz mit Datum und Kanal; blauer Punkt = neu
        seit letztem Blick. Zeile anklicken zum Eintragen.
      </div>
    </>
  );
}
