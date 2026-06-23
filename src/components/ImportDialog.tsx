// ImportDialog — the ONE shared modal shell for the CSV-import preview AND report
// (UI-SPEC §2/§3/§5a, D-05/D-06). A single component renders both views from one
// shell + one itemized-group renderer; the modes differ ONLY in title, summary
// wording, and footer buttons. The `error` mode reuses the same shell for the
// wrong-file rejection (5a).
//
// DATA-02: this component imports ONLY types from ../data/import (ClassifiedRow /
// RawRow) — never drizzle / ../db/{client,schema}. It builds no SQL; the import
// flow's data calls all live in App.tsx → import.ts.
//
// Security (T-05-XSS): every CSV-derived name and reason is rendered as an escaped
// React text child. There is NO dangerouslySetInnerHTML anywhere in this file —
// the absence is the mitigation (a malicious "<img onerror>" company name renders
// as inert text, never as DOM).
import { useEffect } from "react";
import { IconUpload, IconCheck } from "@tabler/icons-react";
import type { ClassifiedRow, RawRow } from "../data/import";
import "./ImportDialog.css";

// "preview" = dry-run before writing (Bestätigen/Abbrechen). "report" = after the
// write (single Schließen). "error" = wrong-file rejection (5a; no groups, single
// Schließen).
export type ImportDialogMode = "preview" | "report" | "error";

type Props = {
  mode: ImportDialogMode;
  // The full classification of the picked file (empty for `error`). The dialog
  // derives every count + group from this single list, so preview and report stay
  // identical row-for-row.
  rows: ClassifiedRow[];
  // Bestätigen (preview only): receives ONLY the neu rows to write.
  onConfirm: (neuRows: RawRow[]) => void;
  // Abbrechen / Schließen / Escape — close without (further) writing.
  onClose: () => void;
};

// The four classification groups, in the locked render order (UI-SPEC §2).
const GROUP_ORDER: ClassifiedRow["kind"][] = [
  "neu",
  "duplikat",
  "nicht-kontaktieren",
  "fehlerhaft",
];

const GROUP_LABEL: Record<ClassifiedRow["kind"], string> = {
  neu: "Neu",
  duplikat: "Duplikate",
  "nicht-kontaktieren": "Nicht kontaktieren",
  fehlerhaft: "Fehlerhaft",
};

// One reusable itemized-group renderer, consumed by BOTH preview and report. Each
// row shows the company name (escaped text) + its reason; fehlerhaft rows are
// prefixed "Zeile {N}: " using their 1-based position in the original file.
function ItemizedGroup({
  kind,
  rows,
  lineFor,
}: {
  kind: ClassifiedRow["kind"];
  rows: ClassifiedRow[];
  lineFor: (row: ClassifiedRow) => number;
}) {
  if (rows.length === 0) return null;
  const loud = kind === "nicht-kontaktieren";
  const error = kind === "fehlerhaft";
  return (
    <section
      data-testid={`group-${kind}`}
      className={`imp-group${loud ? " imp-group-hot" : ""}${error ? " imp-group-error" : ""}`}
    >
      <h3 className="imp-group-h">
        {GROUP_LABEL[kind]}
        {!loud && <span className="imp-group-count"> ({rows.length})</span>}
      </h3>
      <ul className="imp-list">
        {rows.map((r, i) => {
          // fehlerhaft rows may have an empty name — fall back to the line ref only.
          const name = r.row.unternehmen.trim();
          return (
            <li key={i} className="imp-item">
              <span className="imp-name">
                {error ? `Zeile ${lineFor(r)}: ` : ""}
                {name || (error ? "" : "—")}
              </span>
              <span className="imp-reason">{r.reason}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ImportDialog({ mode, rows, onConfirm, onClose }: Props) {
  // Escape closes (cancel for preview, dismiss for report/error). One window-level
  // listener mirrors the app's other overlay (FocusView) interaction convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Stable line numbers: a row's 1-based index in the original parsed file. The
  // dialog receives the rows in file order, so the array index +1 is the CSV line
  // (header is line 0 conceptually; first data row is "Zeile 1").
  const lineByRow = new Map<ClassifiedRow, number>();
  rows.forEach((r, i) => lineByRow.set(r, i + 1));
  const lineFor = (r: ClassifiedRow) => lineByRow.get(r) ?? 0;

  const grouped: Record<ClassifiedRow["kind"], ClassifiedRow[]> = {
    neu: [],
    duplikat: [],
    "nicht-kontaktieren": [],
    fehlerhaft: [],
  };
  for (const r of rows) grouped[r.kind].push(r);

  const nNeu = grouped.neu.length;
  const nDup = grouped.duplikat.length;
  const nDead = grouped["nicht-kontaktieren"].length;
  const nErr = grouped.fehlerhaft.length;
  // "übersprungen" = everything not written: duplicates + nicht-kontaktieren
  // (fehlerhaft is reported on its own line per D-07, not folded into this count).
  const nSkipped = nDup + nDead;

  const title =
    mode === "preview"
      ? "Import-Vorschau"
      : mode === "report"
        ? "Import abgeschlossen"
        : "Falsches Dateiformat";

  return (
    <div className="imp-scrim" onClick={mode === "report" ? onClose : undefined}>
      <div
        className="imp-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {/* error mode carries its title inside the .state-error block (5a), so the
            shell title is suppressed to avoid duplicating "Falsches Dateiformat". */}
        {mode !== "error" && (
          <h2 className="imp-title">
            <IconUpload size={16} />
            {title}
          </h2>
        )}

        {mode === "error" ? (
          <div className="state-error imp-error-body" role="alert">
            <div className="state-h">Falsches Dateiformat</div>
            <div className="state-b">
              Die Datei hat nicht das erwartete Spaltenformat (unternehmen, fn,
              branche, … notiz). Bitte exportiere die Datei im Lead-Hunter-Format.
            </div>
          </div>
        ) : (
          <>
            {mode === "preview" ? (
              <p className="imp-summary">
                <strong>{nNeu}</strong> neu, <strong>{nDup}</strong> Duplikate,{" "}
                <strong>{nDead}</strong> nicht-kontaktieren, <strong>{nErr}</strong>{" "}
                fehlerhaft
              </p>
            ) : (
              <>
                <p className="imp-summary">
                  {`${nNeu} neu, ${nSkipped} übersprungen (davon ${nDead} nicht-kontaktieren)`}
                </p>
                {nErr > 0 && (
                  <p className="imp-summary imp-summary-error">{`${nErr} fehlerhaft übersprungen`}</p>
                )}
              </>
            )}

            <div className="imp-body">
              {GROUP_ORDER.map((kind) => (
                <ItemizedGroup
                  key={kind}
                  kind={kind}
                  rows={grouped[kind]}
                  lineFor={lineFor}
                />
              ))}
            </div>

            {mode === "preview" && nNeu === 0 && (
              <p className="empty-b imp-empty">Keine neuen Firmen zu importieren.</p>
            )}
          </>
        )}

        <div className="imp-actions">
          {mode === "preview" ? (
            <>
              <button
                type="button"
                className="addbtn imp-confirm"
                disabled={nNeu === 0}
                onClick={() => onConfirm(grouped.neu.map((r) => r.row))}
              >
                <IconCheck size={16} />
                Bestätigen
              </button>
              <button type="button" className="cancel imp-cancel" onClick={onClose}>
                Abbrechen
              </button>
            </>
          ) : (
            <button type="button" className="cancel imp-close" onClick={onClose}>
              Schließen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
