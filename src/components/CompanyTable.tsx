// CompanyTable — the Phase 1 read-only Excel-like company table (DB-01/02/03, UI-01/02).
//
// Receives Company[] as props (loaded by App via the data layer). It NEVER imports
// drizzle or the schema — the SQL boundary (DATA-02) stays intact.
//
// The look is reproduced verbatim from lean-crm-mockup.html via CompanyTable.css:
// nine columns, sticky first column + sticky header, single grid lines, navy/2px
// palette, status pills, dead-row dimming, 🔥 as the sole emoji. The ONE wired
// interaction is the Aktiv / Tot+Geparkt filter (DB-03); everything else (row click,
// Tel/Mail/in OS actions, search, + Neue Firma, CSV importieren) is render-only this phase.
import { Fragment, useMemo, useState } from "react";
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
  // Test-only seam: lets a test render with dead rows already visible.
  showDeadInitially?: boolean;
};

export function CompanyTable({
  companies,
  interactionsByFirma = {},
  contactsByFirma = {},
  onOpenRow,
  onSave,
  showDeadInitially = false,
}: Props) {
  const [showDead, setShowDead] = useState(showDeadInitially);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <button className="addbtn" type="button" disabled>
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
                    <td className="co">
                      {c.name}
                      {c.heiss && <span className="fire">🔥</span>}
                    </td>
                    <td className="dim">{c.branche || EMPTY}</td>
                    <td className="dim">{c.groesse || EMPTY}</td>
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
                    <td className="lessons dim">{c.lessons || EMPTY}</td>
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
