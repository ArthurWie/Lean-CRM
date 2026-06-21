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
  // Überspringen: records the company as skipped for THIS session and advances to
  // the next unseen company — it is NOT re-queued (D-08 amended, skip-counts-once).
  // Across sessions a skipped company still resurfaces because its follow-up stays
  // due (Plan 03's concern, not this component's). The parent may use this to
  // lazy-load the next company's details.
  onSkip: (firmaId: string) => void;
  // Zurück zur Tabelle — fired from the empty-start and completion screens.
  onClose: () => void;
  // D6-03: the configured "Erfasst als" name, threaded down to the embedded
  // LogForm. Optional (default "") so existing callers/tests get the unset nudge.
  bearbeiter?: string;
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
  bearbeiter = "",
}: Props) {
  // -------------------------------------------------------------------------
  // In-memory cursor (D-07/D-08-amended/D-09, FOCUS-05/06). No analog file —
  // pure useState. SKIP-COUNTS-ONCE model (D-08 amended at the human-verify gate;
  // the original "re-queue forever" model was rejected):
  //
  // Each company is in exactly one of three states: unseen, called (finished via
  // Speichern & weiter), or skipped (Überspringen). Within a session a company is
  // presented at most once — a skip does NOT re-queue it.
  //
  // The COUNTER FORMULA (the one bit RESEARCH flagged ambiguous, Open Question 1):
  //
  //   Y (denominator, "von Y")   = snapshot.length              — FIXED for the
  //                                whole session (D-07 / Pitfall 5).
  //   X (numerator,   "Firma X") = calledIds.size + skippedIds.size + 1
  //                                — every company already resolved (called OR
  //                                skipped) plus the one currently shown; capped
  //                                at Y so it never reads "Firma 4 von 3". The
  //                                first company shows "Firma 1 von Y", the last
  //                                "Firma Y von Y".
  //
  // The snapshot order is fixed (D-07); the cursor walks forward past any company
  // that is already called or skipped. Überspringen adds the company to
  // `skippedIds`; Speichern & weiter adds it to `calledIds`. Completion fires when
  // NO unseen company remains (calledIds.size + skippedIds.size === total).
  // -------------------------------------------------------------------------
  const [index, setIndex] = useState(0);
  const [calledIds, setCalledIds] = useState<Set<string>>(() => new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());

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

  // Find the current unseen company starting at `index` over the FIXED snapshot
  // order — walk forward past any company already called or skipped this session.
  const currentPos = (() => {
    for (let i = index; i < snapshot.length; i++) {
      const id = snapshot[i].id;
      if (!calledIds.has(id) && !skippedIds.has(id)) return i;
    }
    return -1; // no unseen company remains -> completion
  })();

  // Completion (D-09): no unseen company remains. Under skip-counts-once both
  // counts are meaningful — calledCount = companies finished via Speichern &
  // weiter, skippedCount = companies the user pressed Überspringen on.
  if (currentPos === -1) {
    const calledCount = calledIds.size;
    const skippedCount = skippedIds.size;
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

  const company = snapshot[currentPos];

  // X = every company already resolved (called OR skipped) + the one currently
  // shown, capped at Y.
  const counterX = Math.min(calledIds.size + skippedIds.size + 1, total);

  const primary = contactsByFirma[company.id]?.[0];
  const primaryEmail = primary?.emails[0];
  const interactions = interactionsByFirma[company.id] ?? [];
  // Newest-first (datum desc) — defensive re-sort, never depends on caller order.
  const history = [...interactions].sort((a, b) =>
    a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0,
  );

  function handleSkip() {
    // Skip-counts-once (D-08 amended): record the company as skipped and advance
    // past it in the fixed snapshot order. It is NOT re-queued, so it never
    // reappears this session. Across sessions it resurfaces via its still-due
    // follow-up (Plan 03).
    onSkip(company.id);
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(company.id);
      return next;
    });
    // Advance from the current position; the next render recomputes currentPos
    // over the updated skippedIds.
    setIndex(currentPos + 1);
  }

  async function handleSave(entry: LogEntry) {
    await onSaveAndNext(company.id, entry);
    setCalledIds((prev) => {
      const next = new Set(prev);
      next.add(company.id);
      return next;
    });
    // Advance to the next unseen company from the current position. The render
    // pass recomputes currentPos from `index` + the updated called/skipped sets.
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

        <LogForm onSave={handleSave} bearbeiter={bearbeiter} />

        <div className="focus-foot">
          <button type="button" className="act-skip" onClick={handleSkip}>
            Überspringen
          </button>
        </div>
      </div>
    </div>
  );
}
