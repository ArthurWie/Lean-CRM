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
import { useState } from "react";
import type { Company } from "../data/companies";
import type { Status } from "../types";
import "./CompanyTable.css";

const DEAD = new Set<Status>(["Tot", "Geparkt"]);

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
  // Test-only seam: lets a test render with dead rows already visible.
  showDeadInitially?: boolean;
};

export function CompanyTable({ companies, showDeadInitially = false }: Props) {
  const [showDead, setShowDead] = useState(showDeadInitially);

  const visible = companies.filter((c) => showDead || !DEAD.has(c.status as Status));

  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Suchen…" disabled />
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
              return (
                <tr key={c.id} className={dead ? "r-main row-dead" : "r-main"}>
                  <td className="co">
                    {c.name}
                    {c.heiss && <span className="fire">🔥</span>}
                  </td>
                  <td className="dim">{c.branche || EMPTY}</td>
                  <td className="dim">{c.groesse || EMPTY}</td>
                  {/* Contacts live in a separate table not loaded in Phase 1. */}
                  <td className="dim">{EMPTY}</td>
                  <td>
                    <span className="cIcons">
                      <span className="ci off">Tel</span>
                      <span className="ci off">Mail</span>
                      <span className="ci off">in</span>
                    </span>
                  </td>
                  <td>
                    <span className={`stp ${PILL_VARIANT[c.status as Status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="next dim">{EMPTY}</td>
                  <td className="notiz dim">{EMPTY}</td>
                  <td className="lessons dim">{c.lessons || EMPTY}</td>
                </tr>
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
            {companies.length > 0 && visible.length === 0 && (
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
