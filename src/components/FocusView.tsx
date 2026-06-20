// FocusView — the distraction-free Focus card (FOCUS-01/02/03/05/06, LOG-06).
//
// One company large and alone: name (+🔥 if hot), Branche · Größe, a why-now line,
// pre-call context (Letzte Notizen newest-first + Lessons learned), the primary-
// contact actions, the reused LogForm, and Überspringen — driven by an in-memory
// cursor over a FIXED snapshot (D-07). The parent (App, Plan 03) owns all data
// calls and lazy-loads each served company's contacts/interactions.
//
// DATA-02: this component NEVER reaches the SQL layer. It imports ONLY ./LogForm,
// ../lib/contactActions, the OS-shell sanitizers, type-only imports from
// ../data/* (FocusCompany/Contact/Interaction/LogEntry), and ../utils/date. It
// touches no query — the boundary the sql-boundary test enforces is simply an
// import it never writes.
//
// Security: notes/Lessons render as escaped React text only — never via a raw
// inner-HTML escape hatch (T-04-06; the absence-grep gate asserts this). Tel/Mail/
// in route through the sanitizing contactActions, never an inline opener
// (T-04-05/07).
import type { FocusCompany } from "../data/focus";
import type { Contact } from "../data/companies";
import type { Interaction } from "../data/interactions";
import { LogForm, type LogEntry } from "./LogForm";
import { openTel, openMail, openLinkedIn } from "../lib/contactActions";
import { shortDate } from "../utils/date";
import "./FocusView.css";

const EMPTY = "—";

type Props = {
  // The fixed ordered stream from getFocusSnapshot. Y (counter denominator) =
  // snapshot.length, stable for the whole session (D-07).
  snapshot: FocusCompany[];
  // Lazily loaded per served company (Plan 03 fills these on advance). The
  // primary contact is contactsByFirma[currentId]?.[0]; its first email is
  // primary.emails[0] (D-12).
  contactsByFirma: Record<string, Contact[]>;
  // Lazily loaded per served company; rendered newest-first as Letzte Notizen.
  interactionsByFirma: Record<string, Interaction[]>;
  // Speichern & weiter: parent logs + resolves the follow-up; FocusView advances
  // the cursor after it resolves.
  onSaveAndNext: (firmaId: string, entry: LogEntry) => void | Promise<void>;
  // Überspringen: FocusView re-queues to the end (D-08). The parent may use this
  // to lazy-load the next company's details.
  onSkip: (firmaId: string) => void;
  // Zurück zur Tabelle.
  onClose: () => void;
};

// why-now line (pure). Reads the serve-order reason; specifics live in the notes
// + Lessons block (D-06). Singular "Tag" only at n === 1 (UI-SPEC copy contract).
function whyNow(company: FocusCompany): string {
  if (company.reason === "followup") {
    const n = company.daysOverdue ?? 0;
    if (n === 0) return "Wiedervorlage heute fällig";
    return `Wiedervorlage fällig – seit ${n} ${n === 1 ? "Tag" : "Tagen"}`;
  }
  if (company.reason === "hot") return "🔥 Heiss";
  return "Neu – noch nie kontaktiert";
}

function whyNowClass(reason: FocusCompany["reason"]): string {
  // Semantic tint per reason (UI-SPEC color): amber for due, hot for 🔥, neutral
  // for neu. Accent (violet) is reserved for the single Anrufen CTA, not here.
  if (reason === "followup") return "whynow due";
  if (reason === "hot") return "whynow hot";
  return "whynow neu";
}

export function FocusView({
  snapshot,
  contactsByFirma,
  interactionsByFirma,
  onSaveAndNext,
  onSkip,
}: Props) {
  // The current company is snapshot[0] for Task 1; the in-memory cursor (Task 2)
  // replaces this with a working queue + index.
  const company = snapshot[0];

  // Empty-start guard placeholder (filled in Task 2). For Task 1 we always have a
  // company in the fixtures.

  const primary = contactsByFirma[company.id]?.[0];
  const primaryEmail = primary?.emails[0];
  const interactions = interactionsByFirma[company.id] ?? [];
  // Newest-first (datum desc) — defensive re-sort, never depends on caller order.
  const history = [...interactions].sort((a, b) =>
    a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0,
  );

  return (
    <div className="focus-page">
      <div className="focus-card">
        <div className="focus-head">
          <div className="focus-name">
            {company.name}
            {company.heiss && <span className="flame"> 🔥</span>}
          </div>
          <div className="focus-meta">
            {company.branche || EMPTY} · {company.groesse || EMPTY}
          </div>
          <div className={whyNowClass(company.reason)}>{whyNow(company)}</div>
        </div>

        <div className="focus-context">
          <h4>Letzte Notizen</h4>
          {history.length === 0 ? (
            <div className="ctx-empty">Noch kein Kontakt.</div>
          ) : (
            <div className="ctx-hist">
              {history.map((i) => (
                <div className="ctx-hi" key={i.id}>
                  <div className="ctx-hm">
                    {shortDate(i.datum)} · {i.kanal || EMPTY}{" "}
                    <span className="by">{i.bearbeiter}</span>
                  </div>
                  {i.notiz || EMPTY}
                </div>
              ))}
            </div>
          )}

          <h4 className="mt">Lessons learned</h4>
          <div className="ctx-lessons">{company.lessons || EMPTY}</div>
        </div>

        <div className="focus-actions">
          <button
            type="button"
            className="act-call"
            disabled={!primary?.telefon}
            title={primary?.telefon ?? undefined}
            onClick={() => primary?.telefon && openTel(primary.telefon)}
          >
            Anrufen
          </button>
          <button
            type="button"
            className="act-sec"
            disabled={!primaryEmail}
            title={primaryEmail ?? undefined}
            onClick={() => primaryEmail && openMail(primaryEmail)}
          >
            Mail
          </button>
          <button
            type="button"
            className="act-sec"
            disabled={!primary?.linkedin}
            title={primary?.linkedin ?? undefined}
            onClick={() => primary?.linkedin && openLinkedIn(primary.linkedin)}
          >
            in
          </button>
        </div>

        <LogForm onSave={(entry) => onSaveAndNext(company.id, entry)} />

        <div className="focus-foot">
          <button type="button" className="act-skip" onClick={() => onSkip(company.id)}>
            Überspringen
          </button>
        </div>
      </div>
    </div>
  );
}
