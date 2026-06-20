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
import { useState } from "react";
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
  // Zurück zur Tabelle — fired from the empty-start and completion screens.
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
  onClose,
}: Props) {
  // -------------------------------------------------------------------------
  // In-memory cursor (D-07/D-08/D-09, FOCUS-05/06). No analog file — pure
  // useState. The COUNTER FORMULA (the one bit RESEARCH flagged ambiguous,
  // Open Question 1):
  //
  //   Y (denominator, "von Y")     = snapshot.length          — FIXED for the
  //                                  whole session; a re-queued skip never grows
  //                                  it (D-07 / Pitfall 5).
  //   X (numerator,   "Firma X")   = calledIds.size + 1        — distinct
  //                                  companies already finished via Speichern &
  //                                  weiter, plus the one currently shown; capped
  //                                  at Y so it never reads "Firma 4 von 3".
  //
  // `queue` is the working order (init = snapshot). Überspringen moves the
  // current company to the END of the queue (still in the queue, still un-called,
  // still counted in Y) — so a skip-only session never auto-completes; the user
  // keeps cycling skipped companies until they call them or press Zurück (D-08).
  // Speichern & weiter adds the company to `calledIds` (removed from rotation).
  // Completion fires only when NO un-called company remains.
  // -------------------------------------------------------------------------
  const [queue, setQueue] = useState<FocusCompany[]>(snapshot);
  const [index, setIndex] = useState(0);
  const [calledIds, setCalledIds] = useState<Set<string>>(() => new Set());

  const total = snapshot.length; // Y — fixed.

  // Empty at start (D-10): the snapshot is empty -> "Nichts zu tun", never a card.
  if (total === 0) {
    return (
      <div className="focus-page">
        <div className="focus-card">
          <div className="focus-end">
            <h2>Nichts zu tun</h2>
            <p>Keine fälligen Wiedervorlagen.</p>
            <button type="button" className="focus-back" onClick={onClose}>
              Zurück zur Tabelle
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Find the current un-called company starting at `index` (a called company can
  // sit in the queue if it was skipped before being called — defensive skip).
  const currentPos = (() => {
    for (let i = index; i < queue.length; i++) {
      if (!calledIds.has(queue[i].id)) return i;
    }
    return -1; // no un-called company remains -> completion
  })();

  // Completion (D-09): every company has been called. calledCount = finished;
  // skippedCount = companies the session ended without ever calling (total minus
  // called). At the natural completion screen skippedCount is 0 (completion
  // requires no un-called remaining); the formula stays robust if a parent ever
  // forces an early close.
  if (currentPos === -1) {
    const calledCount = calledIds.size;
    const skippedCount = total - calledCount;
    return (
      <div className="focus-page">
        <div className="focus-card">
          <div className="focus-end">
            <h2>
              {calledCount} angerufen, {skippedCount} übersprungen
            </h2>
            <button type="button" className="focus-back" onClick={onClose}>
              Zurück zur Tabelle
            </button>
          </div>
        </div>
      </div>
    );
  }

  const company = queue[currentPos];

  // X = distinct finished + the one currently shown, capped at Y.
  const counterX = Math.min(calledIds.size + 1, total);

  const primary = contactsByFirma[company.id]?.[0];
  const primaryEmail = primary?.emails[0];
  const interactions = interactionsByFirma[company.id] ?? [];
  // Newest-first (datum desc) — defensive re-sort, never depends on caller order.
  const history = [...interactions].sort((a, b) =>
    a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0,
  );

  function handleSkip() {
    // Re-queue the current company to the END (D-08); advance past it. We rebuild
    // the queue moving `company` last, then keep `index` at currentPos so the
    // next un-called company (now occupying this slot) is served.
    onSkip(company.id);
    setQueue((q) => {
      const rest = q.filter((_, i) => i !== currentPos);
      return [...rest, company];
    });
    // After removal, the next company shifts into currentPos; keep index there.
    setIndex(currentPos);
  }

  async function handleSave(entry: LogEntry) {
    await onSaveAndNext(company.id, entry);
    setCalledIds((prev) => {
      const next = new Set(prev);
      next.add(company.id);
      return next;
    });
    // Advance to the next un-called company from the current position. The render
    // pass recomputes currentPos from `index` + the updated calledIds.
    setIndex(currentPos + 1);
  }

  return (
    <div className="focus-page">
      <div className="focus-card">
        <div className="focus-counter">
          Firma {counterX} von {total}
        </div>

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

        <LogForm onSave={handleSave} />

        <div className="focus-foot">
          <button type="button" className="act-skip" onClick={handleSkip}>
            Überspringen
          </button>
        </div>
      </div>
    </div>
  );
}
